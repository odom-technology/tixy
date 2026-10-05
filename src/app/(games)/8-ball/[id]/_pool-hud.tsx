'use client';

/* The row under the strip: you on the left, the other player on the right,
   each with the balls they have left, and the clock and whose shot it is
   in the middle. A potted ball drops out of its row. */

import { useEffect, useRef, useState } from 'react';

import { Num } from '@/features/arcade/components/ui/num';
import { useFeelReducedMotion } from '@/features/arcade/lib/use-game-feedback';
import { BALL_COLORS, isSolid, isStripe, type Ball } from '@/features/arcade/lib/pool-physics';
import type { FrameId } from '@/features/brand/avatars/frames';
import { FramedAvatar } from '@/features/users/components/framed-avatar';
import type { ClientPlayerCard } from '@/features/users/use-player-cards';
import type { PoolMatch } from '@/server/arcade/pool-match';

const DROP_MS = 420;

type Side = {
  id: string;
  name: string;
  avatarUrl?: string | null;
  /** The equipped avatar frame, from the player's card. */
  frame?: FrameId | null;
  note?: string | null;
  you: boolean;
  group: 'solids' | 'stripes' | null;
};

export function PoolHud({
  match,
  userId,
  isSpectator,
  isAnimating,
  placingCue,
  avatars,
  cards = {},
  turnTimeRemainingMs,
}: {
  match: PoolMatch;
  userId: string | null;
  isSpectator: boolean;
  isAnimating: boolean;
  placingCue: boolean;
  avatars: Record<string, string | null>;
  /** Each player's card: the equipped frame, and an avatar if `avatars` has none. */
  cards?: Record<string, ClientPlayerCard>;
  turnTimeRemainingMs: number | null;
}) {
  const meIsP2 = !isSpectator && userId != null && match.player2Id === userId;
  const p1: Side = {
    id: match.player1Id,
    name: match.player1Name,
    avatarUrl: avatars[match.player1Id] ?? cards[match.player1Id]?.avatarUrl,
    frame: cards[match.player1Id]?.flair?.frameArt ?? null,
    you: !isSpectator && match.player1Id === userId,
    group: match.player1Group,
  };
  const p2Id = match.player2Id ?? '';
  const p2IsBot = p2Id.startsWith('bot:');
  const p2: Side = {
    id: p2Id,
    name: (match.player2Name ?? 'waiting').replace(/ \(bot\)$/i, ''),
    avatarUrl: p2IsBot ? null : (avatars[p2Id] ?? cards[p2Id]?.avatarUrl),
    frame: p2IsBot ? null : (cards[p2Id]?.flair?.frameArt ?? null),
    note: p2IsBot ? `${p2Id.replace('bot:', '')} bot` : null,
    you: !isSpectator && p2Id === userId,
    group: match.player2Group,
  };
  const left = meIsP2 ? p2 : p1;
  const right = meIsP2 ? p1 : p2;

  const over = match.phase === 'game_over' || match.status === 'completed' || match.status === 'forfeited';
  const waiting = match.status === 'waiting';
  const turnId = match.currentTurn;
  const mine = !isSpectator && !over && !waiting && turnId === userId;
  const shooter = turnId === left.id ? left : right;
  const turnLabel = over
    ? 'final'
    : waiting
      ? 'waiting'
      : mine
        ? placingCue && !isAnimating
          ? 'ball in hand'
          : match.phase === 'break'
            ? 'your break'
            : 'your shot'
        : `${shooter.name}'s shot`;

  const humanMatch = Boolean(match.player2Id && !p2IsBot);
  const clock = useCountdown(humanMatch && !over && !waiting ? turnTimeRemainingMs : null);

  return (
    <div className='pool-hud' data-surface='ink'>
      <PlayerSide side='left' player={left} balls={match.balls} turn={!over && turnId === left.id} />
      <div className='pool-centre'>
        {clock != null ? (
          <span className='pool-clock'>
            <Num value={formatClock(clock)} label={`${formatClock(clock)} left on this shot`} />
          </span>
        ) : null}
        <span className='pool-turn' data-mine={mine || undefined} aria-live='polite'>
          {turnLabel}
        </span>
      </div>
      <PlayerSide side='right' player={right} balls={match.balls} turn={!over && turnId === right.id} />
    </div>
  );
}

function PlayerSide({
  side,
  player,
  balls,
  turn,
}: {
  side: 'left' | 'right';
  player: Side;
  balls: Ball[];
  turn: boolean;
}) {
  const left = player.group
    ? balls
        .filter((b) => !b.pocketed && (player.group === 'solids' ? isSolid(b.id) : isStripe(b.id)))
        .map((b) => b.id)
    : [];
  const cleared = player.group != null && left.length === 0;
  return (
    <div className='pool-player' data-side={side}>
      <span className='pool-avatar' data-you={player.you || undefined} data-turn={turn || undefined} data-framed={player.frame ? '' : undefined} aria-hidden>
        <FramedAvatar name={player.name} imageUrl={player.avatarUrl} frame={player.frame} size='sm' />
      </span>
      <div className='pool-who'>
        <span className='pool-name'>
          {player.you ? 'you' : player.name}
          {player.note ? <small>{player.note}</small> : null}
        </span>
        {player.group == null ? (
          <span className='pool-row'><span className='pool-row-note'>open table</span></span>
        ) : cleared ? (
          <span className='pool-row'><span className='pool-row-note'>on the 8</span></span>
        ) : (
          <BallRow ids={left} label={`${player.you ? 'Your' : `${player.name}'s`} ${player.group}: ${left.length} left`} />
        )}
      </div>
    </div>
  );
}

/** The balls a player has left. One that leaves the list drops out first. */
function BallRow({ ids, label }: { ids: number[]; label: string }) {
  const reduced = useFeelReducedMotion();
  const key = ids.join(',');
  const [shown, setShown] = useState<Array<{ id: number; dropping: boolean }>>(() =>
    ids.map((id) => ({ id, dropping: false })),
  );
  const timers = useRef<number[]>([]);

  useEffect(() => {
    const next = new Set(ids);
    setShown((prev) => {
      const kept = prev.map((entry) => (next.has(entry.id) ? entry : { ...entry, dropping: true }));
      for (const id of ids) {
        if (!kept.some((entry) => entry.id === id)) kept.push({ id, dropping: false });
      }
      kept.sort((a, b) => a.id - b.id);
      return kept;
    });
    const timer = window.setTimeout(
      () => setShown((prev) => prev.filter((entry) => next.has(entry.id))),
      reduced ? 0 : DROP_MS,
    );
    timers.current.push(timer);
    // `key` stands for `ids`; a new array with the same balls changes nothing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, reduced]);

  useEffect(() => () => {
    for (const timer of timers.current) window.clearTimeout(timer);
  }, []);

  return (
    <span className='pool-row' role='img' aria-label={label}>
      {shown.map(({ id, dropping }) => (
        <MiniBall key={id} id={id} dropping={dropping} />
      ))}
    </span>
  );
}

function MiniBall({ id, dropping }: { id: number; dropping: boolean }) {
  const info = BALL_COLORS[id] ?? { fill: '#888', stripe: false };
  return (
    <span
      className='pool-ball'
      data-dropping={dropping || undefined}
      style={{
        background: info.stripe
          ? `linear-gradient(180deg, #fff 22%, ${info.fill} 22%, ${info.fill} 78%, #fff 78%)`
          : info.fill,
      }}
    >
      <span>{id}</span>
    </span>
  );
}

function useCountdown(remainingMs: number | null): number | null {
  const [now, setNow] = useState(() => Date.now());
  const [base, setBase] = useState<{ at: number; ms: number } | null>(null);
  useEffect(() => {
    setBase(remainingMs == null ? null : { at: Date.now(), ms: remainingMs });
  }, [remainingMs]);
  useEffect(() => {
    if (base == null) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [base]);
  if (base == null) return null;
  return Math.max(0, base.ms - (now - base.at));
}

function formatClock(ms: number): string {
  const total = Math.ceil(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}
