'use client';

import { Check, Share2 } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { trackProductEvent } from '@/features/analytics/product-events';
import { ArcadeButton } from '@/features/arcade/components/ui/arcade-ui';
import {
  getScoreChallengeGameFromPath,
  scoreChallengeVerb,
} from '@/features/arcade/lib/score-challenge';
import { ArcadeLoadingDots } from '@/features/arcade/components/ui/arcade-states';

type PreparedChallenge = {
  href: string;
  challenge: {
    gameSlug: string;
    gameTitle: string;
    metricLabel: string;
    direction: 'high' | 'low';
    formattedScore: string;
    mode: string | null;
  };
};

type ShareCopy = {
  title: string;
  text: string;
  url: string;
};

async function copyText(text: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.readOnly = true;
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand('copy');
  textarea.remove();
  if (!copied) throw new Error('Clipboard unavailable.');
}

export function ArcadeResultShare({
  guest = false,
  ready = true,
}: {
  guest?: boolean;
  ready?: boolean;
}) {
  const pathname = usePathname();
  const game = useMemo(() => getScoreChallengeGameFromPath(pathname), [pathname]);
  const [prepared, setPrepared] = useState<PreparedChallenge | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const clearStatusTimerRef = useRef<number | null>(null);

  const showStatus = useCallback((message: string) => {
    setStatus(message);
    if (clearStatusTimerRef.current !== null) {
      window.clearTimeout(clearStatusTimerRef.current);
    }
    clearStatusTimerRef.current = window.setTimeout(() => setStatus(null), 2_500);
  }, []);

  useEffect(() => () => {
    if (clearStatusTimerRef.current !== null) {
      window.clearTimeout(clearStatusTimerRef.current);
    }
  }, []);

  useEffect(() => {
    setPrepared(null);
    setPreparing(false);
    setStatus(null);
  }, [game, guest, ready]);

  if (!game || !ready) return null;

  const shareCopy = (challenge: PreparedChallenge | null): ShareCopy => {
    const href = challenge?.href ?? game.href;
    const url = new URL(href, window.location.origin).toString();
    if (challenge) {
      const target = challenge.challenge;
      const mode = target.mode ? ` (${target.mode})` : '';
      return {
        title: `${target.gameTitle} score challenge`,
        text: `I posted ${target.formattedScore} ${target.metricLabel.toLowerCase()}${mode} in ${target.gameTitle}. ${scoreChallengeVerb(target.direction)}`,
        url,
      };
    }
    return {
      title: `Play ${game.title} on tixy`,
      text: `I just finished a run in ${game.title}. Think you can do better?`,
      url,
    };
  };

  const recordShare = (method: 'native' | 'clipboard', verified: boolean) => {
    void trackProductEvent('result_shared', {
      gameSlug: game.slug,
      source: `${method}_${verified ? 'verified' : 'game'}`,
    });
  };

  const prepareChallenge = async () => {
    if (prepared || guest) return prepared;
    setPreparing(true);
    try {
      const response = await fetch('/api/games/score-challenges', {
        method: 'POST',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gameSlug: game.slug }),
      });
      if (!response.ok) return null;
      const payload = (await response.json()) as PreparedChallenge;
      if (payload?.href && payload.challenge?.gameSlug === game.slug) {
        setPrepared(payload);
        return payload;
      }
      return null;
    } catch {
      return null;
    } finally {
      setPreparing(false);
    }
  };

  const shareChallenge = async () => {
    if (preparing) return;
    const challenge = await prepareChallenge();
    const copy = shareCopy(challenge);
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share(copy);
        recordShare('native', Boolean(challenge));
        showStatus('shared');
        return;
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return;
      }
    }
    try {
      await copyText(`${copy.text}\n${copy.url}`);
      recordShare('clipboard', Boolean(challenge));
      showStatus('copied');
    } catch {
      showStatus('unavailable');
    }
  };

  return (
    <div className='flex min-h-8 items-center justify-center' aria-label='Share this game result'>
      <ArcadeButton
        type='button'
        tone='ghost'
        size='xs'
        disabled={preparing}
        onClick={() => void shareChallenge()}
        aria-label={`Share ${game.title} result`}
        title={guest ? `Share ${game.title}` : 'Share a verified score challenge'}
      >
        {preparing ? (
          <ArcadeLoadingDots />
        ) : status === 'shared' || status === 'copied' ? (
          <Check size={13} aria-hidden />
        ) : (
          <Share2 size={13} aria-hidden />
        )}
        {preparing ? 'preparing' : status ?? 'share'}
      </ArcadeButton>
      <span className='sr-only' aria-live='polite'>{status}</span>
    </div>
  );
}
