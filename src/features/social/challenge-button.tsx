'use client';

/* One tap challenges a friend and opens the match, where you wait for them.
   The narrow half picks the game; the choice is remembered on this device.
   8-ball and chess take a direct challenge today (their /challenge routes);
   connect four has no invite route, so it isn't offered. */

import { ChevronDown } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useId, useRef, useState } from 'react';

import { renamedPath } from '@/features/arcade/lib/game-renames';
import { SoundManager } from '@/features/arcade/lib/sound-manager';

import './tixy-people.css';

export const CHALLENGE_GAMES = [
  { slug: '8-ball', name: '8-ball' },
  { slug: 'chess', name: 'chess' },
] as const;

type ChallengeGame = (typeof CHALLENGE_GAMES)[number]['slug'];

const STORAGE_KEY = 'tixy:challenge-game';

function readStoredGame(): ChallengeGame {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return CHALLENGE_GAMES.some((game) => game.slug === stored) ? (stored as ChallengeGame) : '8-ball';
  } catch {
    return '8-ball';
  }
}

export function ChallengeButton({
  userId,
  name,
  menuUp = false,
}: {
  userId: string;
  name: string;
  /** Open the game menu above the button, for rows near the bottom. */
  menuUp?: boolean;
}) {
  const router = useRouter();
  const [game, setGame] = useState<ChallengeGame>('8-ball');
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const gameName = CHALLENGE_GAMES.find((entry) => entry.slug === game)?.name ?? game;

  useEffect(() => setGame(readStoredGame()), []);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    rootRef.current?.querySelector<HTMLButtonElement>('[role="menuitemradio"][aria-checked="true"]')?.focus();
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const pick = (slug: ChallengeGame) => {
    setGame(slug);
    setOpen(false);
    try {
      window.localStorage.setItem(STORAGE_KEY, slug);
    } catch {
      // private mode: the choice lasts until the page closes
    }
  };

  const send = useCallback(async () => {
    if (busy) return;
    SoundManager.play('boardSelect', { volume: 0.5 });
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/games/${game}/challenge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetUserId: userId }),
      });
      const payload = (await response.json().catch(() => ({}))) as { matchId?: string; error?: string };
      // A challenge already waiting comes back with its match: open that one.
      if (payload.matchId) {
        router.push(renamedPath(`/${game}/${payload.matchId}`));
        return;
      }
      setError(payload.error || 'The challenge did not send.');
      setBusy(false);
    } catch {
      setError('The challenge did not send. Try again.');
      setBusy(false);
    }
  }, [busy, game, router, userId]);

  return (
    <div className='tp-challenge'>
      <div ref={rootRef} className='tp-split'>
        <button
          type='button'
          className='tp-btn'
          data-size='sm'
          data-busy={busy || undefined}
          disabled={busy}
          onClick={() => void send()}
          aria-label={`challenge ${name} to ${gameName}`}
        >
          <span>{busy ? 'sending' : 'challenge'}</span>
        </button>
        <button
          type='button'
          className='tp-btn'
          data-size='sm'
          aria-haspopup='menu'
          aria-expanded={open}
          aria-controls={open ? menuId : undefined}
          aria-label={`game: ${gameName}. change game`}
          disabled={busy}
          onClick={() => setOpen((value) => !value)}
        >
          <span>{gameName}</span>
          <ChevronDown size={14} strokeLinecap='square' aria-hidden />
        </button>
        {open ? (
          <div id={menuId} role='menu' aria-label='challenge to' className='tp-menu' data-up={menuUp || undefined}>
            {CHALLENGE_GAMES.map((entry) => (
              <button
                key={entry.slug}
                type='button'
                role='menuitemradio'
                aria-checked={entry.slug === game}
                onClick={() => pick(entry.slug)}
              >
                {entry.name}
                {entry.slug === game ? <span className='tp-dot' style={{ background: 'var(--tixy-ink)' }} aria-hidden /> : null}
              </button>
            ))}
          </div>
        ) : null}
      </div>
      {error ? (
        <p role='alert' className='tp-error tp-challenge-error'>
          {error}
        </p>
      ) : null}
    </div>
  );
}
