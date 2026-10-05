'use client';

/* The flagship: 8-ball drawn as the game, top-down, with its live state on
   the felt and play (or the match waiting for you), challenge and practice
   under the name. Geometry follows
   build-mockup.mjs table(). Pointing at the table draws the cue back. */

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';

import { Num } from '@/features/arcade/components/ui/arcade-ui';
import { SoundManager } from '@/features/arcade/lib/sound-manager';

import { joinVerb } from './home-on-now';
import type { HomeOnNow, HomeRecord, HomeTables, HomeWaiting } from './tixy-home-types';
import { useJoinMatch } from './use-join-match';

const C = {
  felt: '#2E7566',
  cushion: '#245E52',
  rail: '#2B2119',
  pocket: '#100C09',
  lit: '#F7E7C6',
  cue: '#E9C48A',
};
const BALL: Record<number, string> = {
  1: '#F2A33C',
  2: '#4F7FC0',
  3: '#B83627',
  4: '#6B4C9A',
  5: '#E07A2E',
  6: '#2F8F4E',
  7: '#8A2B2B',
  8: '#141110',
};
const RACK_ORDER = [1, 9, 2, 10, 8, 3, 11, 4, 12, 5, 6, 13, 7, 14, 15];

function Ball({ x, y, n, r, clip }: { x: number; y: number; n: number; r: number; clip: string }) {
  if (n === 0) return <circle cx={x} cy={y} r={r} fill={C.lit} />;
  const base = n > 8 ? BALL[n - 8]! : BALL[n]!;
  if (n > 8) {
    const id = `${clip}-${n}`;
    return (
      <g>
        <clipPath id={id}>
          <circle cx={x} cy={y} r={r} />
        </clipPath>
        <circle cx={x} cy={y} r={r} fill={C.lit} />
        <rect x={x - r} y={y - r * 0.5} width={2 * r} height={r} fill={base} clipPath={`url(#${id})`} />
        <circle cx={x} cy={y} r={r * 0.42} fill={C.lit} />
      </g>
    );
  }
  return (
    <g>
      <circle cx={x} cy={y} r={r} fill={base} />
      <circle cx={x} cy={y} r={r * 0.42} fill={C.lit} />
    </g>
  );
}

function TableArt({ w, h, shape }: { w: number; h: number; shape: 'wide' | 'phone' }) {
  const clip = useId().replace(/:/g, '');
  const pad = Math.round(Math.min(w, h) * 0.07);
  const cush = Math.round(pad * 0.55);
  const fx = pad + cush * 0.4;
  const fy = pad + cush * 0.4;
  const fw = w - 2 * fx;
  const fh = h - 2 * fy;
  const r = shape === 'phone' ? 8 : 11;
  const pockets: [number, number][] = [
    [fx, fy],
    [fx + fw / 2, fy - 3],
    [fx + fw, fy],
    [fx, fy + fh],
    [fx + fw / 2, fy + fh + 3],
    [fx + fw, fy + fh],
  ];
  const diamonds = [1, 2, 3, 5, 6, 7];

  // The rack, apex towards the cue ball.
  const ax = fx + fw * 0.72;
  const ay = fy + fh / 2;
  const rack: ReactNode[] = [];
  let k = 0;
  for (let row = 0; row < 5; row += 1) {
    for (let i = 0; i <= row; i += 1) {
      const n = RACK_ORDER[k]!;
      k += 1;
      rack.push(
        <Ball key={n} x={ax + row * r * 1.75} y={ay + (i - row / 2) * r * 2.02} n={n} r={r} clip={clip} />,
      );
    }
  }

  // Cue ball, the aim line to the apex, the cue behind on the same line.
  const cx = fx + fw * 0.5;
  const cy = fy + fh * 0.3;
  const tx = ax - r;
  const ty = ay;
  const d = Math.hypot(tx - cx, ty - cy);
  const ux = (tx - cx) / d;
  const uy = (ty - cy) / d;
  const p = (t: number) => `${(cx + ux * t).toFixed(1)},${(cy + uy * t).toFixed(1)}`;
  const len = fw * 0.3;
  const sw = shape === 'phone' ? 4.5 : 6;

  return (
    <svg
      className='tx-table-art'
      data-shape={shape}
      viewBox={`0 0 ${w} ${h}`}
      aria-hidden='true'
      focusable='false'
    >
      <rect width={w} height={h} fill={C.rail} />
      {diamonds.map((i) => (
        <g key={i} fill={C.lit} opacity={0.45}>
          <circle cx={fx + (fw * i) / 8} cy={pad / 2} r={2} />
          <circle cx={fx + (fw * i) / 8} cy={h - pad / 2} r={2} />
        </g>
      ))}
      <rect x={pad} y={pad} width={w - 2 * pad} height={h - 2 * pad} rx={6} fill={C.cushion} />
      <rect x={fx} y={fy} width={fw} height={fh} rx={3} fill={C.felt} />
      {pockets.map(([x, y]) => (
        <circle key={`${x}-${y}`} cx={x} cy={y} r={r * 1.45} fill={C.pocket} />
      ))}
      {rack}
      <Ball x={cx} y={cy} n={0} r={r} clip={clip} />
      <path
        className='tx-aim'
        d={`M${p(r + 5)} L${p(d - r - 3)}`}
        stroke={C.lit}
        strokeWidth={2}
        strokeDasharray='6 7'
        opacity={0.7}
      />
      <g className='tx-cue' style={{ ['--ux' as string]: ux.toFixed(3), ['--uy' as string]: uy.toFixed(3) }}>
        <path d={`M${p(-r - 9)} L${p(-r - 9 - len)}`} stroke={C.cue} strokeWidth={sw} strokeLinecap='round' />
        <path d={`M${p(-r - 9)} L${p(-r - 14)}`} stroke={C.lit} strokeWidth={sw} strokeLinecap='round' />
      </g>
    </svg>
  );
}

function plural(n: number, one: string, many: string) {
  return n === 1 ? one : many;
}

/* The line under the name: what is happening at the tables now, then how you
   have been doing. Only numbers we have; nothing when there is nothing. */
function TableLine({
  tables,
  record,
  onNow,
  waiting,
}: {
  tables: HomeTables | null;
  record: HomeRecord | null;
  onNow: HomeOnNow | null;
  waiting: HomeWaiting | null;
}) {
  const parts: ReactNode[] = [];
  const turn = onNow?.turns.find((entry) => entry.game === '8-ball');
  const pool = tables?.['8-ball'];
  if (waiting) {
    const stake = waiting.wager ? (
      <>
        {' '}
        for <Num className='tx-num' value={waiting.wager} /> tickets
      </>
    ) : null;
    parts.push(
      waiting.kind === 'invite' ? (
        <span key='invite'>
          {waiting.name} {waiting.rematch ? 'wants a rematch' : 'challenged you'}
          {stake}.
        </span>
      ) : (
        <span key='friend'>
          {waiting.name} has a table open{stake}.
        </span>
      ),
    );
  } else if (turn) {
    parts.push(<span key='turn'>It is your shot against {turn.opponent}.</span>);
  } else if (pool && pool.open > 0) {
    parts.push(
      <span key='open'>
        <Num className='tx-num' value={pool.open} /> {plural(pool.open, 'table', 'tables')} open.
      </span>,
    );
  } else if (pool && pool.live > 0) {
    parts.push(
      <span key='live'>
        <Num className='tx-num' value={pool.live} /> {plural(pool.live, 'match', 'matches')} on now.
      </span>,
    );
  }
  if (record) {
    parts.push(
      <span key='record'>
        You have won <Num className='tx-num' value={record.won} /> of your last{' '}
        <Num className='tx-num' value={record.played} />.
      </span>,
    );
  }
  if (parts.length === 0) {
    parts.push(<span key='idle'>Practice against the house, or bring a friend.</span>);
  }
  return (
    <p className='tx-table-line'>
      {parts.map((part, index) => (
        <span key={index}>
          {index > 0 ? ' ' : null}
          {part}
        </span>
      ))}
    </p>
  );
}

const SIGN_IN = '/signin?next=%2F8-ball';
const PICKER_SEARCH_FROM = 8;

type PickerFriend = { userId: string; name: string };

/* Every friend, loaded when the picker opens. Search shows from 8 friends
   on; the list scrolls. */
function ChallengePicker({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [friends, setFriends] = useState<PickerFriend[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  useEffect(() => {
    let cancelled = false;
    fetch('/api/friends', { cache: 'no-store' })
      .then(async (res) => {
        const payload = (await res.json().catch(() => ({}))) as { friends?: PickerFriend[] };
        if (!res.ok || !Array.isArray(payload.friends)) throw new Error();
        if (!cancelled) setFriends(payload.friends.map(({ userId, name }) => ({ userId, name })));
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    panelRef.current?.querySelector<HTMLElement>('input, button, a')?.focus();
  }, [friends]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const challenge = useCallback(
    async (targetUserId: string) => {
      if (busy) return;
      SoundManager.play('boardSelect', { volume: 0.5 });
      setBusy(targetUserId);
      setError(null);
      try {
        const res = await fetch('/api/games/8-ball/challenge', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ targetUserId }),
        });
        const payload = (await res.json().catch(() => ({}))) as { matchId?: string; error?: string };
        if (!res.ok || !payload.matchId) throw new Error(payload.error || 'The challenge did not send.');
        router.push(`/8-ball/${payload.matchId}`);
      } catch (caught) {
        setError((caught as Error).message);
        setBusy(null);
      }
    },
    [busy, router],
  );

  const term = search.trim().toLowerCase();
  const shown = (friends ?? []).filter((friend) => !term || friend.name.toLowerCase().includes(term));

  return (
    <div ref={panelRef} className='tx-picker' role='dialog' aria-modal='false' aria-labelledby={titleId}>
      <h3>
        <span id={titleId}>challenge</span>
        <button type='button' className='tx-picker-close' onClick={onClose}>
          close
        </button>
      </h3>
      {failed ? (
        <p>Your friends are not loading right now.</p>
      ) : friends === null ? (
        <p>Loading your friends.</p>
      ) : friends.length === 0 ? (
        <>
          <p>Add a friend to challenge them here.</p>
          <Link href='/friends' className='tx-btn' data-size='sm'>
            find friends
          </Link>
        </>
      ) : (
        <>
          {friends.length >= PICKER_SEARCH_FROM ? (
            <input
              type='search'
              className='tx-picker-search'
              placeholder='find a friend'
              aria-label='find a friend'
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          ) : null}
          <div className='tx-picker-list'>
            {shown.map((friend) => (
              <div key={friend.userId} className='tx-who'>
                <span className='tx-av' aria-hidden='true'>
                  {friend.name.slice(0, 1).toLowerCase()}
                </span>
                <div>
                  <strong>{friend.name}</strong>
                </div>
                <button
                  type='button'
                  className='tx-btn tx-accept'
                  data-size='sm'
                  data-busy={busy === friend.userId || undefined}
                  disabled={busy != null}
                  onClick={() => void challenge(friend.userId)}
                  aria-label={`challenge ${friend.name}`}
                >
                  <span>{busy === friend.userId ? 'sending' : 'challenge'}</span>
                </button>
              </div>
            ))}
            {shown.length === 0 ? <p>No friend matches that.</p> : null}
          </div>
        </>
      )}
      {error ? (
        <p role='alert' className='tx-who-error' style={{ marginLeft: 0 }}>
          {error}
        </p>
      ) : null}
    </div>
  );
}

/* The table's first button: the match waiting for you (accept or join, with
   its stake), else your shot, else play. */
function PrimaryButton({
  waiting,
  turnMatchId,
  onGone,
}: {
  waiting: HomeWaiting | null;
  turnMatchId: string | null;
  onGone: () => void;
}) {
  const { busy, confirming, error, start, confirm, cancel } = useJoinMatch(waiting, onGone);
  if (waiting) {
    const verb = joinVerb(waiting);
    return (
      <>
        {confirming ? (
          <>
            <button type='button' className='tx-btn tx-accept' data-tone='paper' disabled={busy} onClick={() => void confirm()}>
              <span>
                {busy ? 'joining' : 'stake'} <Num className='tx-num' value={waiting.wager ?? 0} />
              </span>
            </button>
            <button type='button' className='tx-btn' data-tone='on-dark' disabled={busy} onClick={cancel}>
              cancel
            </button>
          </>
        ) : (
          <button
            type='button'
            className='tx-btn tx-accept'
            data-tone='paper'
            data-busy={busy || undefined}
            disabled={busy}
            onClick={start}
            aria-label={`${verb} ${waiting.name}${waiting.wager ? `, stakes ${waiting.wager} tickets` : ''}`}
          >
            <span>
              {busy ? 'joining' : verb}
              {waiting.wager && !busy ? (
                <>
                  {' '}
                  <Num className='tx-num' value={waiting.wager} />
                </>
              ) : null}
            </span>
          </button>
        )}
        {error ? <span className='tx-table-error' role='alert'>{error}</span> : null}
      </>
    );
  }
  if (turnMatchId) {
    return (
      <Link href={`/8-ball/${turnMatchId}`} className='tx-btn' data-tone='paper'>
        your shot
      </Link>
    );
  }
  return (
    <Link href='/8-ball' className='tx-btn' data-tone='paper'>
      play
    </Link>
  );
}

export function HomeTable({
  tables,
  record,
  onNow,
  signedIn,
  closed,
  onStale,
}: {
  tables: HomeTables | null;
  record: HomeRecord | null;
  onNow: HomeOnNow | null;
  signedIn: boolean;
  closed: boolean;
  onStale: () => void;
}) {
  const router = useRouter();
  const [picking, setPicking] = useState(false);
  const [practicing, setPracticing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const challengeRef = useRef<HTMLButtonElement>(null);
  const turn = onNow?.turns.find((entry) => entry.game === '8-ball') ?? null;
  const waiting =
    onNow?.waiting.find((entry) => entry.game === '8-ball' && entry.kind === 'invite') ??
    onNow?.waiting.find((entry) => entry.game === '8-ball' && entry.kind === 'table') ??
    null;

  const closePicker = useCallback(() => {
    setPicking(false);
    challengeRef.current?.focus();
  }, []);

  // Practice starts in one tap at medium (PLAN.md, 8-ball row).
  const practice = useCallback(async () => {
    if (practicing) return;
    SoundManager.play('boardSelect', { volume: 0.5 });
    setPracticing(true);
    setError(null);
    try {
      const res = await fetch('/api/games/8-ball/match/bot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ difficulty: 'medium' }),
      });
      const payload = (await res.json().catch(() => ({}))) as { match?: { id: string }; error?: string };
      if (!res.ok || !payload.match) throw new Error(payload.error || 'The practice table did not open.');
      router.push(`/8-ball/${payload.match.id}`);
    } catch (caught) {
      setError((caught as Error).message);
      setPracticing(false);
    }
  }, [practicing, router]);

  return (
    <section className='tx-table' aria-labelledby='tx-table-name'>
      <TableArt w={910} h={392} shape='wide' />
      <TableArt w={370} h={250} shape='phone' />
      <div className='tx-table-copy'>
        <h2 id='tx-table-name'>
          <Link href='/8-ball'>8-ball</Link>
        </h2>
        {closed ? (
          <p className='tx-table-line'>The tables are closed for now.</p>
        ) : (
          <>
            <TableLine tables={tables} record={record} onNow={onNow} waiting={waiting} />
            <div className='tx-table-btns'>
              <PrimaryButton key={waiting?.matchId ?? 'none'} waiting={waiting} turnMatchId={turn?.matchId ?? null} onGone={onStale} />
              {signedIn ? (
                <button
                  ref={challengeRef}
                  type='button'
                  className='tx-btn'
                  data-tone='on-dark'
                  aria-expanded={picking}
                  aria-haspopup='dialog'
                  onClick={() => (picking ? closePicker() : setPicking(true))}
                >
                  challenge
                </button>
              ) : (
                <Link href={SIGN_IN} className='tx-btn' data-tone='on-dark'>
                  challenge
                </Link>
              )}
              {signedIn ? (
                <button
                  type='button'
                  className='tx-btn'
                  data-tone='on-dark'
                  disabled={practicing}
                  onClick={() => void practice()}
                >
                  {practicing ? 'racking' : 'practice'}
                </button>
              ) : (
                <Link href={SIGN_IN} className='tx-btn' data-tone='on-dark'>
                  practice
                </Link>
              )}
            </div>
            {error ? (
              <p role='alert' className='tx-table-line' style={{ margin: '10px 0 0' }}>
                {error}
              </p>
            ) : null}
          </>
        )}
      </div>
      {picking && signedIn ? <ChallengePicker onClose={closePicker} /> : null}
    </section>
  );
}
