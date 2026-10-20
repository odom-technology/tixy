'use client';

import Script from 'next/script';
import { useEffect, useRef, useState } from 'react';

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
  makeRewardedVisible?: () => boolean;
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

async function postJson<T>(url: string, body: Record<string, unknown>, signal?: AbortSignal) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
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

type RewardPhase = 'idle' | 'loading' | 'showing' | 'claiming' | 'retry' | 'done';
type RewardRequest = <T>(url: string, body: Record<string, unknown>, signal?: AbortSignal) => Promise<T>;

// Kept independent of React so lifecycle regressions can use a mocked GPT and
// request transport. Web rewarded ads expose client events, not an SSV callback.
export function createRewardedAdAttempt({
  rewardType,
  gameType,
  getGoogleTag,
  onPhase,
  onError,
  onReward,
  onFinish,
  request = postJson,
  timeoutMs = 30_000,
}: {
  rewardType: RewardedAdRewardType;
  gameType: string | null;
  getGoogleTag: () => GoogleTag;
  onPhase: (phase: RewardPhase) => void;
  onError: (message: string | null) => void;
  onReward: (payload: RewardClaimResponse) => void;
  onFinish: () => void;
  request?: RewardRequest;
  timeoutMs?: number;
}) {
  let active = true;
  let started = false;
  let visible = false;
  let closed = false;
  let granted = false;
  let claiming = false;
  let claimed = false;
  let intentId: string | null = null;
  let googleTag: GoogleTag | null = null;
  let slot: GptSlot | null = null;
  let pubads: GptPubAds | null = null;
  let loadingTimer: ReturnType<typeof setTimeout> | undefined;
  let claimTimer: ReturnType<typeof setTimeout> | undefined;
  const loadingRequest = new AbortController();
  let claimRequest: AbortController | null = null;
  const grantId = createClientGrantId();

  const destroySlot = () => {
    if (!slot || !pubads || !googleTag) return;
    const oldSlot = slot;
    slot = null;
    for (const [name, listener] of listeners) {
      pubads.removeEventListener?.(name, listener);
    }
    try {
      googleTag.destroySlots([oldSlot]);
    } catch {
      // GPT may already have disposed its slot. Still release our attempt.
    }
  };
  const dispose = () => {
    active = false;
    clearTimeout(loadingTimer);
    clearTimeout(claimTimer);
    loadingRequest.abort();
    claimRequest?.abort();
    destroySlot();
  };
  const finish = (phase: 'idle' | 'done', message: string | null = null) => {
    if (!active) return;
    dispose();
    onError(message);
    onPhase(phase);
    onFinish();
  };
  const failLoading = (message: string) => {
    if (active && !visible && !granted) finish('idle', message);
  };

  const claimReward = async () => {
    if (!active || !granted || claiming || claimed || !intentId) return;
    claiming = true;
    onError(null);
    onPhase('claiming');
    const controller = new AbortController();
    claimRequest = controller;
    claimTimer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const claim = await request<RewardClaimResponse>(
        `/api/ads/reward-intents/${encodeURIComponent(intentId)}/claim`,
        { clientGrantId: grantId },
        controller.signal,
      );
      if (!active) return;
      if (controller.signal.aborted) throw new Error('Reward confirmation timed out.');
      claimed = true;
      try {
        onReward(claim);
      } catch (error) {
        console.error('Rewarded ad UI refresh failed:', error);
      }
      // Granting a reward may precede the end of the ad. The user retains
      // control of the close button; do not destroy the creative here.
      if (closed) finish('done');
      else onPhase('showing');
    } catch (error) {
      if (!active) return;
      onError(controller.signal.aborted
        ? 'Reward confirmation timed out. Retry your reward without watching another ad.'
        : (error as Error).message || 'Could not claim reward. Retry without watching another ad.');
      onPhase(closed ? 'retry' : 'showing');
    } finally {
      clearTimeout(claimTimer);
      claiming = false;
    }
  };

  function onReady(event: GptEvent) {
    if (!active || event.slot !== slot || visible || !event.makeRewardedVisible) return;
    try {
      if (!event.makeRewardedVisible()) {
        failLoading('The rewarded ad could not be shown. Please try again.');
        return;
      }
      visible = true;
      clearTimeout(loadingTimer);
      onPhase('showing');
    } catch {
      failLoading('The rewarded ad could not be shown. Please try again.');
    }
  }
  function onGranted(event: GptEvent) {
    if (!active || !visible || closed || event.slot !== slot || granted) return;
    granted = true;
    void claimReward();
  }
  function onClosed(event: GptEvent) {
    if (!active || event.slot !== slot) return;
    closed = true;
    destroySlot();
    if (!granted) finish('idle', 'Ad closed before the reward was granted.');
    else if (claimed) finish('done');
    else if (!claiming) onPhase('retry');
  }
  function onRenderEnded(event: GptEvent) {
    if (active && event.slot === slot && event.isEmpty && !visible) {
      failLoading('No rewarded ad is available right now. Please try again later.');
    }
  }
  const listeners: Array<[string, (event: GptEvent) => void]> = [
    ['rewardedSlotReady', onReady],
    ['rewardedSlotGranted', onGranted],
    ['rewardedSlotClosed', onClosed],
    ['slotRenderEnded', onRenderEnded],
  ];

  return {
    async start() {
      if (!active || started) return;
      started = true;
      onPhase('loading');
      loadingTimer = setTimeout(() => {
        failLoading('Rewarded ads did not load. Check your connection or try again later.');
      }, timeoutMs);
      try {
        const response = await request<RewardIntentResponse>(
          '/api/ads/reward-intents', { rewardType, gameType }, loadingRequest.signal,
        );
        if (!active) return;
        if (!response.intent?.id || !response.adUnitPath) throw new Error('Rewarded ad is not ready.');
        intentId = response.intent.id;
        googleTag = getGoogleTag();
        googleTag.cmd.push(() => {
          if (!active) return;
          try {
            if (!googleTag?.defineOutOfPageSlot) throw new Error('Rewarded ads failed to load.');
            slot = googleTag.defineOutOfPageSlot(response.adUnitPath!, googleTag.enums.OutOfPageFormat.REWARDED);
            if (!slot) throw new Error('No rewarded ad is available on this device.');
            pubads = googleTag.pubads();
            for (const [name, listener] of listeners) pubads.addEventListener(name, listener);
            slot.addService(pubads);
            googleTag.enableServices();
            googleTag.display(slot);
          } catch (error) {
            failLoading((error as Error).message || 'Rewarded ads failed to load.');
          }
        });
      } catch (error) {
        failLoading((error as Error).message || 'Could not start rewarded ad.');
      }
    },
    retryClaim() { if (closed) void claimReward(); },
    failLoading,
    cancel: dispose,
  };
}

export function RewardedAdButton({
  enabled,
  rewardType,
  gameType = null,
  children,
  onReward,
}: {
  enabled: boolean;
  rewardType: RewardedAdRewardType;
  gameType?: string | null;
  children: string;
  onReward?: (payload: RewardClaimResponse) => void;
}) {
  const [phase, setPhase] = useState<RewardPhase>('idle');
  const [error, setError] = useState<string | null>(null);
  const attemptRef = useRef<ReturnType<typeof createRewardedAdAttempt> | null>(null);
  const mountedRef = useRef(false);
  const scriptFailedRef = useRef(false);
  const onRewardRef = useRef(onReward);
  onRewardRef.current = onReward;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      attemptRef.current?.cancel();
      attemptRef.current = null;
    };
  }, []);

  const handleClick = () => {
    if (!enabled) return;
    if (attemptRef.current) {
      if (phase === 'retry') attemptRef.current.retryClaim();
      return;
    }
    if (scriptFailedRef.current) {
      setError('Rewarded ads could not load. Check your connection, then reload this page to try again.');
      return;
    }
    setError(null);
    const attempt = createRewardedAdAttempt({
      rewardType,
      gameType,
      getGoogleTag: () => {
        window.googletag = window.googletag ?? ({ cmd: [] } as GoogleTag);
        return window.googletag;
      },
      onPhase: setPhase,
      onError: setError,
      onReward: (claim) => onRewardRef.current?.(claim),
      onFinish: () => { attemptRef.current = null; },
    });
    // React state updates are asynchronous. Lock the attempt before any work
    // starts so a rapid second click cannot create another request or slot.
    attemptRef.current = attempt;
    void attempt.start();
  };

  const label =
    phase === 'loading'
      ? 'Loading...'
      : phase === 'showing'
        ? 'Showing...'
        : phase === 'claiming'
          ? 'Claiming...'
          : phase === 'retry'
            ? 'Retry reward claim'
            : phase === 'done'
              ? 'Reward claimed'
              : children;

  if (!enabled) return null;

  return (
    <div className='flex flex-col items-start gap-2'>
      <Script
        async
        src='https://securepubads.g.doubleclick.net/tag/js/gpt.js'
        strategy='afterInteractive'
        onReady={() => { scriptFailedRef.current = false; }}
        onError={() => {
          if (!mountedRef.current) return;
          scriptFailedRef.current = true;
          const message = 'Rewarded ads could not load. Check your connection, then reload this page to try again.';
          if (attemptRef.current) attemptRef.current.failLoading(message);
          else setError(message);
        }}
      />
      <ArcadeButton
        type='button'
        tone='tickets'
        onClick={() => void handleClick()}
        disabled={phase === 'loading' || phase === 'showing' || phase === 'claiming'}
      >
        {label}
      </ArcadeButton>
      {error ? <p role='status' className='text-xs text-danger-text'>{error}</p> : null}
    </div>
  );
}
