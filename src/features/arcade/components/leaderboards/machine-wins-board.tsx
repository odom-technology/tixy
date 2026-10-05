'use client';

import { useContext, useEffect, useMemo, useState } from 'react';

import { BoardView, type BoardRowData } from '@/features/arcade/components/leaderboard-board';
import { AccountIdentityContext } from '@/features/arcade/components/shell/use-account-summary';
import { formatNum } from '@/features/arcade/components/ui/num';
import { usePlayerCards } from '@/features/users/use-player-cards';
import { subscribeLive } from '@/lib/liveEvents';

import type { MachineWinRow, MachineWins } from '@/server/arcade/leaderboard-overview';

/* A ticket machine's board: the biggest win each player landed this week.
   Drawn by the shared BoardView, so it reads like every other board: your
   rank first, the rows around you, then the top. */
export function MachineWinsBoard({ slug, label }: { slug: string; label: string }) {
  const signedIn = useContext(AccountIdentityContext);
  const [data, setData] = useState<{ slug: string; wins: MachineWins } | null>(null);
  const [failed, setFailed] = useState(false);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    let controller: AbortController | null = null;
    const load = async () => {
      controller?.abort();
      const requestController = new AbortController();
      controller = requestController;
      try {
        const response = await fetch(`/api/leaderboard/wins?game=${encodeURIComponent(slug)}`, {
          cache: 'no-store',
          signal: requestController.signal,
        });
        if (!response.ok) throw new Error(String(response.status));
        const wins = (await response.json()) as MachineWins;
        requestController.signal.throwIfAborted();
        setData({ slug, wins });
        setFailed(false);
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        setFailed(true);
      }
    };
    void load();
    const refreshIfVisible = () => {
      if (!document.hidden) void load();
    };
    const interval = window.setInterval(refreshIfVisible, 30000);
    const unsubscribe = subscribeLive(['gameLeaderboards'], (payload) => {
      if (payload.reason === 'profile-updated') refreshIfVisible();
    });
    document.addEventListener('visibilitychange', refreshIfVisible);
    return () => {
      controller?.abort();
      window.clearInterval(interval);
      unsubscribe();
      document.removeEventListener('visibilitychange', refreshIfVisible);
    };
  }, [slug]);

  const wins = data?.slug === slug ? data.wins : null;
  const ids = useMemo(
    () => [...(wins?.rows ?? []), ...(wins?.around ?? [])].map((row) => row.userId),
    [wins],
  );
  const cards = usePlayerCards(ids);

  const toRow = (row: MachineWinRow): BoardRowData => {
    const card = cards[row.userId];
    return {
      key: `${row.userId}-${row.rank}`,
      userId: row.userId,
      name: row.userName,
      imageUrl: card?.avatarUrl ?? null,
      rank: row.rank,
      score: formatNum(row.payout),
      sub: `${Number(row.multiplier.toFixed(2))}× on ${formatNum(row.wager)}`,
    };
  };

  return (
    <div className='arc-board' aria-label={label} aria-busy={(!wins && !failed) || undefined}>
      <p className='lb-board-note'>Each player&apos;s biggest win in the last 7 days, in tickets.</p>
      <div className='arc-board-body grid gap-3.5'>
        <BoardView
          loading={!wins && !failed}
          rows={(wins?.rows ?? []).map(toRow)}
          around={(wins?.around ?? []).map(toRow)}
          viewer={
            wins?.viewer
              ? { id: wins.viewer.userId, rank: wins.viewer.rank, score: formatNum(wins.viewer.payout), gap: null }
              : null
          }
          signedIn={signedIn}
          emptyText={failed ? 'The board did not load. Try again in a minute.' : 'No wins on this machine this week.'}
          expanded={expanded}
          onToggleExpanded={() => setExpanded((prev) => !prev)}
          scoreLabel='your biggest win'
        />
      </div>
    </div>
  );
}
