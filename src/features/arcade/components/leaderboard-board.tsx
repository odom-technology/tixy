'use client';

import Link from 'next/link';
import type { CSSProperties } from 'react';

import { TixyHost } from '@/features/brand/tixy-host';
import { ProfileAvatar } from '@/features/users/components/profile-avatar';

import './leaderboard-board.css';

/* The board: one leaderboard design for every game. Your rank and the scores
   around you first, then the top. Everything that varies by game (what a
   score reads like, which tabs there are) is decided before it gets here. */

export type BoardRowData = {
  key: string;
  userId: string;
  name: string;
  imageUrl?: string | null;
  rank: number;
  /** The score as it reads: "1,240", "0:42", "75 wpm". */
  score: string;
  /** One quiet line under the name: "gold · 12-3", "best tile 512". */
  sub?: string;
};

export type BoardViewer = {
  id: string;
  rank: number;
  score: string;
  /** What it takes to pass the player above, in the board's own units. */
  gap?: string | null;
};

export type BoardTabItem<T extends string | number = string> = {
  value: T;
  label: string;
};

export function BoardTabs<T extends string | number>({
  items,
  value,
  onChange,
  label,
}: {
  items: ReadonlyArray<BoardTabItem<T>>;
  value: T;
  onChange?: (value: T) => void;
  label: string;
}) {
  return (
    <div className='arc-board-tabs' role='tablist' aria-label={label}>
      {items.map((item) => (
        <button
          key={String(item.value)}
          type='button'
          role='tab'
          className='arc-board-tab'
          aria-selected={item.value === value}
          disabled={!onChange}
          onClick={() => onChange?.(item.value)}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

function BoardRow({ row, you }: { row: BoardRowData; you: boolean }) {
  const href = row.userId.startsWith('guest:') ? undefined : `/u/${encodeURIComponent(row.userId)}`;
  const inner = (
    <>
      <span className='arc-board-rank'>{row.rank}</span>
      <span className='arc-board-avatar'>
        <ProfileAvatar name={row.name} imageUrl={row.imageUrl ?? null} size='sm' />
      </span>
      <span className='arc-board-who'>
        <span className='arc-board-name block'>{row.name}</span>
        {row.sub ? <span className='arc-board-sub block'>{row.sub}</span> : null}
      </span>
      <span className='arc-board-score'>{row.score}</span>
    </>
  );
  return (
    <li data-you={you || undefined}>
      {href ? (
        <Link href={href} className='arc-board-row' data-you={you || undefined}>
          {inner}
        </Link>
      ) : (
        <div className='arc-board-row' data-you={you || undefined}>
          {inner}
        </div>
      )}
    </li>
  );
}

function BoardList({
  title,
  rows,
  youId,
}: {
  title: string;
  rows: BoardRowData[];
  youId: string | null;
}) {
  return (
    <section>
      <h3 className='arc-board-title'>{title}</h3>
      <ol className='arc-board-list'>
        {rows.map((row) => (
          <BoardRow key={row.key} row={row} you={youId != null && row.userId === youId} />
        ))}
      </ol>
    </section>
  );
}

export const BOARD_TOP = 10;

export function BoardView({
  loading,
  rows,
  around,
  viewer,
  signedIn,
  emptyText,
  expanded,
  onToggleExpanded,
  scoreLabel = 'your score',
}: {
  loading: boolean;
  rows: BoardRowData[];
  around: BoardRowData[];
  viewer: BoardViewer | null;
  /** null while it isn't known yet. */
  signedIn: boolean | null;
  emptyText: string;
  expanded: boolean;
  onToggleExpanded: () => void;
  /** What the viewer's number is called: "your score", "your biggest win". */
  scoreLabel?: string;
}) {
  if (loading) {
    return (
      <div className='arc-board-skeleton' role='status'>
        <span className='sr-only'>Loading the board.</span>
        <span aria-hidden />
        <span aria-hidden />
        <span aria-hidden />
        <span aria-hidden />
      </div>
    );
  }

  if (rows.length === 0 && !viewer) {
    return (
      <div className='arc-board-empty'>
        <TixyHost width={84} />
        <p>{emptyText}</p>
      </div>
    );
  }

  const top = expanded ? rows : rows.slice(0, BOARD_TOP);
  const youInTop = viewer ? top.some((row) => row.userId === viewer.id) : false;
  const showAround = viewer != null && !youInTop && around.length > 0;
  const cols = viewer ? (viewer.gap ? 3 : 2) : 0;

  return (
    <>
      {viewer ? (
        <div className='arc-board-you' style={{ '--cols': cols } as CSSProperties}>
          <div>
            <b>{viewer.rank}</b>
            <small>your rank</small>
          </div>
          <div>
            <b>{viewer.score}</b>
            <small>{scoreLabel}</small>
          </div>
          {viewer.gap ? (
            <div>
              <b>{viewer.gap}</b>
              <small>to move up</small>
            </div>
          ) : null}
        </div>
      ) : signedIn === false ? (
        <p className='arc-board-note'>Sign in to see where you rank.</p>
      ) : signedIn ? (
        <p className='arc-board-note'>You have no score on this board yet.</p>
      ) : null}

      {showAround ? <BoardList title='around you' rows={around} youId={viewer.id} /> : null}

      {top.length > 0 ? (
        <BoardList title={`top ${top.length}`} rows={top} youId={viewer?.id ?? null} />
      ) : null}

      {rows.length > BOARD_TOP ? (
        <button type='button' className='arc-board-more' onClick={onToggleExpanded}>
          {expanded ? `top ${BOARD_TOP}` : `show all ${rows.length}`}
        </button>
      ) : null}
    </>
  );
}
