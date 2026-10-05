'use client';

/* The weekly paid boards on the leaderboards page: this week's 3 games with
   their top 3, your place and the time left, and last week's winners. Three
   games a week pay 300, 200 and 100 tickets, and first also gets the first
   place medal (rewards/weekly-boards.ts). */

import { use, useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react';

import { getArcadeGameBySlug } from '@/features/arcade/components/arcade-game-registry';
import { ArcadeLinkButton, ArcadeStub } from '@/features/arcade/components/ui/arcade-ui';
import { Num } from '@/features/arcade/components/ui/num';
import { getGameDisplayRoute } from '@/features/arcade/lib/game-renames';
import { WEEKLY_BOARD_MEDAL, WEEKLY_BOARD_PRIZES, ordinal } from '@/features/arcade/lib/weekly-boards';
import type { WeeklyBoardRow, WeeklyBoardView, WeeklyBoardsView } from '@/server/arcade/rewards/weekly-boards';

/* The server's clock, carried forward by the time since the page mounted, so
   the time left matches the server and never mismatches on hydration. */
function useServerNow(serverNow: number) {
  const [now, setNow] = useState(serverNow);
  const mounted = useRef<number | null>(null);
  useEffect(() => {
    mounted.current = performance.now();
    const tick = () => setNow(serverNow + (performance.now() - (mounted.current ?? 0)));
    const id = window.setInterval(tick, 30_000);
    return () => window.clearInterval(id);
  }, [serverNow]);
  return now;
}

function Left({ ms, starts }: { ms: number; starts: boolean }) {
  const minutes = Math.max(1, Math.ceil(ms / 60_000));
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = minutes % 60;
  const part = (n: number, one: string, many: string) => (
    <>
      <Num className='lb-num' value={n} /> {n === 1 ? one : many}
    </>
  );
  const parts =
    days > 0
      ? [part(days, 'day', 'days'), hours > 0 ? part(hours, 'hour', 'hours') : null]
      : hours > 0
        ? [part(hours, 'hour', 'hours'), part(mins, 'minute', 'minutes')]
        : [part(mins, 'minute', 'minutes')];
  return (
    <span className='lb-week-left'>
      {starts ? 'starts in ' : null}
      {parts.filter(Boolean).map((p, i) => (
        <span key={i}>
          {i > 0 ? ' ' : null}
          {p}
        </span>
      ))}
      {starts ? null : ' left'}
    </span>
  );
}

export function MedalIcon({ size = 22 }: { size?: number }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img className='lb-week-medal' src={WEEKLY_BOARD_MEDAL.art} alt='' width={size} height={size} />;
}

/* 1st 300 and a medal, 2nd 200, 3rd 100. */
function Prizes() {
  return (
    <ol className='lb-week-prizes' aria-label='prizes'>
      {WEEKLY_BOARD_PRIZES.map((tickets, index) => (
        <li key={tickets}>
          <span className='lb-week-place'>{ordinal(index + 1)}</span>
          <ArcadeStub size='sm'>
            <Num value={tickets} labelSuffix='tickets' />
          </ArcadeStub>
          {index === 0 ? (
            <span className='lb-week-plus'>
              <MedalIcon />
              <span>and a medal</span>
            </span>
          ) : null}
        </li>
      ))}
    </ol>
  );
}

function Row({ row, you, tickets }: { row: WeeklyBoardRow; you: boolean; tickets?: number }) {
  return (
    <li className='lb-week-row' data-you={you || undefined}>
      <Num className='lb-num lb-week-rank' value={row.rank} label={`rank ${row.rank}`} />
      <span className='lb-week-name'>{you ? 'you' : row.userName}</span>
      {tickets != null ? (
        <span className='lb-week-won'>
          {row.rank === 1 ? <MedalIcon size={20} /> : null}
          <ArcadeStub size='sm'>
            <Num value={tickets} labelSuffix='tickets' />
          </ArcadeStub>
        </span>
      ) : (
        <Num className='lb-num lb-week-score' value={row.score} label={`score ${row.score}`} />
      )}
    </li>
  );
}

function BoardCard({
  board,
  upcoming,
  signedIn,
  still,
  onPick,
  head = true,
}: {
  board: WeeklyBoardView;
  upcoming: boolean;
  signedIn: boolean;
  still: ReactNode;
  onPick?: (slug: string) => void;
  head?: boolean;
}) {
  const mine = board.you;
  const inTop = mine ? board.top.some((row) => row.userId === mine.userId) : false;
  return (
    <section className='lb-week-card' aria-label={`${board.name} this week`}>
      {head ? (
        <header className='lb-week-head'>
          <a
            href={`?game=${board.game}`}
            className='lb-week-game'
            onClick={(event: MouseEvent) => {
              if (!onPick || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
              event.preventDefault();
              onPick(board.game);
            }}
          >
            <span className='lb-screen' data-size='sm' aria-hidden='true'>
              {still}
            </span>
            <span className='lb-week-game-name'>{board.name}</span>
          </a>
          <ArcadeLinkButton tone='primary' size='sm' href={getGameDisplayRoute(board.game, getArcadeGameBySlug(board.game)?.href ?? `/${board.game}`)}>
            play
          </ArcadeLinkButton>
        </header>
      ) : null}
      {upcoming ? null : board.top.length > 0 ? (
        <ol className='lb-week-rows'>
          {board.top.map((row) => (
            <Row key={row.userId} row={row} you={row.userId === mine?.userId} />
          ))}
        </ol>
      ) : (
        <p className='lb-week-empty'>No runs yet.</p>
      )}
      {!upcoming && mine && !inTop ? (
        <ol className='lb-week-rows lb-week-mine'>
          <Row row={mine} you />
        </ol>
      ) : null}
      {!upcoming && signedIn && !mine ? <p className='lb-week-empty'>You have no run this week.</p> : null}
    </section>
  );
}

function LastWeek({ last }: { last: NonNullable<WeeklyBoardsView['last']> }) {
  return (
    <section className='lb-week-last' aria-labelledby='lb-week-last-title'>
      <h3 id='lb-week-last-title' className='lb-h3'>
        last week
      </h3>
      {last.paid ? null : <p className='lb-board-note'>The prizes go out within 15 minutes of the close.</p>}
      <ul className='lb-week-last-list'>
        {last.boards.map((board) => (
          <li key={board.game}>
            <span className='lb-week-last-game'>{board.name}</span>
            {board.winners.length > 0 ? (
              <ol className='lb-week-rows'>
                {board.winners.map((row) => (
                  <Row key={row.userId} row={row} you={false} tickets={row.tickets} />
                ))}
              </ol>
            ) : (
              <p className='lb-week-empty'>Nobody played it.</p>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function WeeklyBody({
  weekly,
  stills,
  signedIn,
  onPick,
}: {
  weekly: Promise<WeeklyBoardsView | null>;
  stills: Record<string, ReactNode>;
  signedIn: boolean;
  onPick: (slug: string) => void;
}) {
  const view = use(weekly);
  const now = useServerNow(view?.now ?? 0);
  if (!view || view.boards.length === 0) return <p className='lb-board-note'>No board pays this week.</p>;
  return (
    <>
      <div className='lb-week-top'>
        <Prizes />
        <Left ms={(view.upcoming ? view.start : view.end) - now} starts={view.upcoming} />
      </div>
      <div className='lb-week-cards'>
        {view.boards.map((board) => (
          <BoardCard
            key={board.game}
            board={board}
            upcoming={view.upcoming}
            signedIn={signedIn}
            still={stills[board.game] ?? null}
            onPick={onPick}
          />
        ))}
      </div>
      {view.last ? <LastWeek last={view.last} /> : null}
    </>
  );
}

/** The overview's section. `weekly` streams in; the heading renders at once. */
export function WeeklyBoards(props: {
  weekly: Promise<WeeklyBoardsView | null>;
  stills: Record<string, ReactNode>;
  signedIn: boolean;
  onPick: (slug: string) => void;
}) {
  return (
    <section className='lb-week' aria-labelledby='lb-week-title'>
      <h2 id='lb-week-title' className='lb-h2'>
        boards that pay this week
      </h2>
      <WeeklyBody {...props} />
    </section>
  );
}

/** On a picked game's board: its weekly standings, when it is one of this week's paid boards. */
export function WeeklyBoardNote({
  weekly,
  slug,
  signedIn,
}: {
  weekly: Promise<WeeklyBoardsView | null>;
  slug: string;
  signedIn: boolean;
}) {
  const view = use(weekly);
  const now = useServerNow(view?.now ?? 0);
  const board = view?.boards.find((b) => b.game === slug);
  if (!view || !board) return null;
  return (
    <section className='lb-week lb-week-pane' aria-label='paid this week'>
      <div className='lb-week-top'>
        <span className='lb-week-pane-title'>paid this week</span>
        <Left ms={(view.upcoming ? view.start : view.end) - now} starts={view.upcoming} />
      </div>
      <Prizes />
      <BoardCard board={board} upcoming={view.upcoming} signedIn={signedIn} still={null} head={false} />
    </section>
  );
}
