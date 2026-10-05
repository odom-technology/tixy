'use client';

import Script from 'next/script';
import { useCallback, useState } from 'react';

import { ArcadeButton } from '@/features/arcade/components/ui/arcade-ui';

type RewardedAdRewardType = 'store_tickets' | 'free_play' | 'continue';

type RewardIntentResponse = {
  intent?: {
    id: string;
    rewardType: RewardedAdRewardType;
    gameType: string | null;
    amount: number;
  };
  adUnitPath?: string;
  error?: string;
};

type RewardClaimResponse = {
  success?: boolean;
  wallet?: {
    credits?: number;
    storeCredits?: number;
    spendableCredits?: number;
  };
  error?: string;
};

type GoogleTag = {
  cmd: Array<() => void>;
  enums: {
    OutOfPageFormat: {
      REWARDED: string;
    };
  };
  defineOutOfPageSlot: (path: string, format: string) => GptSlot | null;
  pubads: () => GptPubAds;
  enableServices: () => void;
  display: (slot: GptSlot) => void;
  destroySlots: (slots: GptSlot[]) => void;
};

type GptSlot = {
  addService: (service: GptPubAds) => GptSlot;
};

type GptPubAds = {
  addEventListener: (event: string, callback: (event: GptEvent) => void) => void;
  removeEventListener?: (event: string, callback: (event: GptEvent) => void) => void;
};

type GptEvent = {
  slot?: GptSlot;
  makeRewardedVisible?: () => void;
  isEmpty?: boolean;
};

declare global {
  interface Window {
    googletag?: GoogleTag;
  }
}

const createClientGrantId = () => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `grant-${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

async function postJson<T>(url: string, body: Record<string, unknown>) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const payload = (await response.json()) as T;
  if (!response.ok) {
    const message =
      payload && typeof payload === 'object' && 'error' in payload
        ? String((payload as { error?: string }).error ?? '')
        : '';
    throw new Error(message || 'Request failed.');
  }
  return payload;
}

export function RewardedAdButton({
  rewardType,
  gameType = null,
  children,
  onReward,
}: {
  rewardType: RewardedAdRewardType;
  gameType?: string | null;
  children: string;
  onReward?: (payload: RewardClaimResponse) => void;
}) {
  const [phase, setPhase] = useState<
    'idle' | 'loading' | 'showing' | 'claiming' | 'done'
  >('idle');
  const [error, setError] = useState<string | null>(null);

  const cleanupListener = useCallback(
    (pubads: GptPubAds, event: string, callback: (event: GptEvent) => void) => {
      pubads.removeEventListener?.(event, callback);
    },
    [],
  );

  const handleClick = useCallback(async () => {
    if (phase === 'loading' || phase === 'showing' || phase === 'claiming') return;
    setPhase('loading');
    setError(null);

    try {
      const intentResponse = await postJson<RewardIntentResponse>(
        '/api/ads/reward-intents',
        { rewardType, gameType },
      );
      const intent = intentResponse.intent;
      const adUnitPath = intentResponse.adUnitPath;
      if (!intent?.id || !adUnitPath) {
        throw new Error('Rewarded ad is not ready.');
      }

      window.googletag = window.googletag ?? ({ cmd: [] } as GoogleTag);
      window.googletag.cmd.push(() => {
        const googletag = window.googletag;
        if (!googletag?.defineOutOfPageSlot) {
          setPhase('idle');
          setError('Rewarded ads failed to load.');
          return;
        }

        const slot = googletag.defineOutOfPageSlot(
          adUnitPath,
          googletag.enums.OutOfPageFormat.REWARDED,
        );
        if (!slot) {
          setPhase('idle');
          setError('No rewarded ad is available right now.');
          return;
        }

        const pubads = googletag.pubads();
        let granted = false;
        let claimStarted = false;
        let closed = false;

        const cleanup = () => {
          cleanupListener(pubads, 'rewardedSlotReady', onReady);
          cleanupListener(pubads, 'rewardedSlotGranted', onGranted);
          cleanupListener(pubads, 'rewardedSlotClosed', onClosed);
          cleanupListener(pubads, 'slotRenderEnded', onRenderEnded);
          googletag.destroySlots([slot]);
        };

        const claimReward = async () => {
          if (claimStarted) return;
          claimStarted = true;
          setPhase('claiming');
          try {
            const claim = await postJson<RewardClaimResponse>(
              `/api/ads/reward-intents/${encodeURIComponent(intent.id)}/claim`,
              { clientGrantId: createClientGrantId() },
            );
            setPhase('done');
            onReward?.(claim);
          } catch (claimError) {
            setPhase('idle');
            setError((claimError as Error).message || 'Could not claim reward.');
          } finally {
            cleanup();
          }
        };

        const onReady = (event: GptEvent) => {
          if (event.slot !== slot || !event.makeRewardedVisible) return;
          setPhase('showing');
          event.makeRewardedVisible();
        };

        const onGranted = (event: GptEvent) => {
          if (event.slot !== slot) return;
          granted = true;
          void claimReward();
        };

        const onClosed = (event: GptEvent) => {
          if (event.slot !== slot) return;
          closed = true;
          if (!granted && !claimStarted) {
            setPhase('idle');
            setError('Ad closed before the reward was granted.');
            cleanup();
          }
        };

        const onRenderEnded = (event: GptEvent) => {
          if (event.slot !== slot || !event.isEmpty) return;
          if (!closed && !granted) {
            setPhase('idle');
            setError('No rewarded ad is available right now.');
            cleanup();
          }
        };

        pubads.addEventListener('rewardedSlotReady', onReady);
        pubads.addEventListener('rewardedSlotGranted', onGranted);
        pubads.addEventListener('rewardedSlotClosed', onClosed);
        pubads.addEventListener('slotRenderEnded', onRenderEnded);

        slot.addService(pubads);
        googletag.enableServices();
        googletag.display(slot);
      });
    } catch (startError) {
      setPhase('idle');
      setError((startError as Error).message || 'Could not start rewarded ad.');
    }
  }, [cleanupListener, gameType, onReward, phase, rewardType]);

  const label =
    phase === 'loading'
      ? 'Loading...'
      : phase === 'showing'
        ? 'Showing...'
        : phase === 'claiming'
          ? 'Claiming...'
          : phase === 'done'
            ? 'Reward claimed'
            : children;

  const configured = Boolean(process.env.NEXT_PUBLIC_GAM_REWARDED_AD_UNIT_PATH);
  if (!configured) return null;

  return (
    <div className='flex flex-col items-start gap-2'>
      <Script
        async
        src='https://securepubads.g.doubleclick.net/tag/js/gpt.js'
        strategy='afterInteractive'
      />
      <ArcadeButton
        type='button'
        tone='tickets'
        onClick={() => void handleClick()}
        disabled={phase === 'loading' || phase === 'showing' || phase === 'claiming'}
      >
        {label}
      </ArcadeButton>
      {error ? <p className='text-xs text-danger-text'>{error}</p> : null}
    </div>
  );
}
