'use client';

/* Accept a challenge or join a friend's table: the same POST .../match/join
   the game's lobby uses, then open the match. A table with a wager holds the
   stake on join, so a wagered match asks once before it joins. */

import { useRouter } from 'next/navigation';
import { useCallback, useState } from 'react';

import { SoundManager } from '@/features/arcade/lib/sound-manager';

import type { HomeWaiting } from './tixy-home-types';

export function useJoinMatch(entry: HomeWaiting | null, onGone?: () => void) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const join = useCallback(async () => {
    if (!entry || busy) return;
    SoundManager.play('boardSelect', { volume: 0.5 });
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/games/${entry.game}/match/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ matchId: entry.matchId }),
      });
      const payload = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        const message = payload.error || 'That match did not open.';
        const gone = res.status === 404 || res.status === 409 || /not found|not open|claimed|full/i.test(message);
        setError(gone ? 'That match is no longer open.' : message);
        setBusy(false);
        setConfirming(false);
        if (gone) onGone?.();
        return;
      }
      router.push(`/${entry.game}/${entry.matchId}`);
    } catch {
      setError('That match did not open. Try again.');
      setBusy(false);
    }
  }, [busy, entry, onGone, router]);

  /* The button's press: a wagered match asks first. */
  const start = useCallback(() => {
    if (!entry) return;
    if (entry.wager && !confirming) {
      SoundManager.play('boardSelect', { volume: 0.4 });
      setConfirming(true);
      return;
    }
    void join();
  }, [confirming, entry, join]);

  const cancel = useCallback(() => setConfirming(false), []);

  return { busy, confirming, error, start, confirm: join, cancel };
}
