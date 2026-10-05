'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { CircleDot, ChevronRight } from 'lucide-react';
import { subscribeLive } from '@/lib/liveEvents';
import { startVisiblePolling } from '@/features/arcade/lib/visible-polling';

type ActiveMatch = {
  id: string;
  player1Id: string;
  player1Name: string;
  player2Id: string | null;
  player2Name: string | null;
  currentTurn: string;
  moveCount: number;
  status: string;
  hardcoreMode?: boolean;
  wagerAmount?: number | null;
};

type MatchSwitcherProps = {
  currentMatchId: string;
  userId: string;
  /** In the page flow under the game shell, instead of fixed to the bottom. */
  inline?: boolean;
};

export function MatchSwitcher({ currentMatchId, userId, inline = false }: MatchSwitcherProps) {
  const [matches, setMatches] = useState<ActiveMatch[]>([]);

  const fetchMatches = useCallback(async () => {
    try {
      const res = await fetch('/api/games/8-ball/matches', { cache: 'no-store' });
      if (!res.ok) return;
      const data = await res.json();
      const active = (data.myMatches ?? []).filter(
        (m: ActiveMatch) => m.status === 'active' && m.id !== currentMatchId,
      );
      setMatches(active);
    } catch { /* ignore */ }
  }, [currentMatchId]);

  useEffect(() => {
    void fetchMatches();
    // Poll every 20s as a baseline
    return startVisiblePolling(fetchMatches, 20_000);
  }, [fetchMatches]);

  // Real-time: re-fetch when any pool match updates via SSE
  useEffect(() => {
    const unsubscribe = subscribeLive(['gameLeaderboards', 'poolChat'], () => {
      void fetchMatches();
    });
    return unsubscribe;
  }, [fetchMatches]);

  if (matches.length === 0) return null;

  return (
    <div className={inline ? 'rounded-panel bg-panel' : 'fixed inset-x-0 bottom-0 z-40 border-t-2 border-ink bg-panel'}>
      <div className={`mx-auto flex max-w-4xl items-center gap-2 overflow-x-auto px-3 py-2 ${inline ? '' : 'justify-center'}`}>
        <span className={inline ? 'shrink-0 text-sm font-bold text-strong' : 'shrink-0 text-xs font-semibold text-faint'}>
          {inline ? 'your other tables' : 'your tables'}
        </span>
        {matches.map((m) => {
          const isMyTurn = m.currentTurn === userId;
          return (
            <Link
              key={m.id}
              href={`/8-ball/${m.id}`}
              className={`inline-flex shrink-0 items-center gap-1.5 rounded-key border-2 px-2.5 py-1.5 text-xs font-medium transition ${
                isMyTurn
                  ? 'border-ink bg-primary text-primary-on shadow-chip'
                  : 'border-ink bg-panel text-faint shadow-chip hover:bg-raised'
              }`}
            >
              <CircleDot size={12} />
              <span className='max-w-[100px] truncate'>
                vs {m.player2Name ?? 'waiting'}
              </span>
              {isMyTurn && (
                <span className='rounded-tag border border-ink bg-key-face px-1 py-0.5 text-[9px] font-bold text-key-face-on'>
                  your shot
                </span>
              )}
              {m.hardcoreMode && (
                <span className='rounded-tag border border-ink bg-danger px-1 py-0.5 text-[9px] font-bold text-danger-on'>
                  hardcore
                </span>
              )}
              <ChevronRight size={10} className='text-faint' />
            </Link>
          );
        })}
      </div>
    </div>
  );
}
