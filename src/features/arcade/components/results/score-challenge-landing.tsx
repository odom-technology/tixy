'use client';

import { Swords, X } from 'lucide-react';
import { usePathname, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import { trackProductEvent } from '@/features/analytics/product-events';
import { ArcadeButton } from '@/features/arcade/components/ui/arcade-ui';
import { scoreChallengeVerb } from '@/features/arcade/lib/score-challenge';

type ChallengeResponse = {
  challenge?: {
    gameSlug: string;
    gameTitle: string;
    gameHref: string;
    metricLabel: string;
    direction: 'high' | 'low';
    formattedScore: string;
    mode: string | null;
    expiresAt: number;
  };
  error?: string;
};

export function ScoreChallengeLanding() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const token = searchParams.get('scoreChallenge');
  const [payload, setPayload] = useState<ChallengeResponse | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const trackedTokenRef = useRef<string | null>(null);

  useEffect(() => {
    setPayload(null);
    setDismissed(false);
    if (!token || token.length > 1_024) return;
    const controller = new AbortController();
    void fetch(`/api/games/score-challenges?token=${encodeURIComponent(token)}`, {
      cache: 'no-store',
      signal: controller.signal,
    })
      .then(async (response) => {
        const body = (await response.json().catch(() => ({}))) as ChallengeResponse;
        return response.ok ? body : { error: body.error ?? 'This challenge is unavailable.' };
      })
      .then(setPayload)
      .catch(() => {
        if (!controller.signal.aborted) setPayload({ error: 'This challenge is unavailable.' });
      });
    return () => controller.abort();
  }, [token]);

  const challenge = payload?.challenge;
  const onCorrectGame = challenge
    ? pathname === challenge.gameHref || pathname.startsWith(`${challenge.gameHref}/`)
    : false;

  useEffect(() => {
    if (!challenge || !onCorrectGame || trackedTokenRef.current === token) return;
    trackedTokenRef.current = token;
    void trackProductEvent('challenge_opened', {
      gameSlug: challenge.gameSlug,
      source: 'signed_score',
    });
  }, [challenge, onCorrectGame, token]);

  if (!token || dismissed || !payload) return null;
  if (challenge && !onCorrectGame) return null;

  return (
    <aside
      className='arc-enter fixed inset-x-3 top-16 z-[58] mx-auto max-w-sm rounded-key border-2 border-ink bg-info px-2.5 py-2 text-info-on shadow-chip'
      role='status'
      aria-label='Score challenge'
    >
      <div className='flex items-center gap-2'>
        <span className='grid size-7 shrink-0 place-items-center rounded-full border-2 border-ink bg-panel text-strong shadow-chip'>
          <Swords size={14} aria-hidden />
        </span>
        <div className='min-w-0 flex-1 text-left'>
          {challenge ? (
            <p className='truncate text-xs font-black'>
              <span className='mr-1 opacity-75'>Challenge:</span>
              {scoreChallengeVerb(challenge.direction)} {challenge.formattedScore}{' '}
              {challenge.metricLabel.toLowerCase()} in {challenge.gameTitle}
              <span className='sr-only'> This target was verified from an accepted run and cannot grant rewards by itself.</span>
            </p>
          ) : (
            <p className='truncate text-xs font-bold'>{payload.error}</p>
          )}
        </div>
        <ArcadeButton
          type='button'
          tone='ghost'
          size='icon-xs'
          aria-label='Dismiss score challenge'
          onClick={() => setDismissed(true)}
        >
          <X size={14} aria-hidden />
        </ArcadeButton>
      </div>
    </aside>
  );
}
