'use client';

/* One plinko machine's board: metal pegs, brass slots, and the balls in
   flight. The client settles each ball with the server first and then
   hands it here with launch(); the board only plays back that result.

   Feel (FEEL.md): each peg tick is pitched by its row, an octave from the
   top row to the bottom; the ball squashes on landing (the trajectory's
   squashAt), lands with a thunk, its slot lights, and the board shakes by
   multiplier (none at 1x, the full 4 px at 100x). Reduced motion: the ball
   appears in its slot, the slot lights without moving, nothing shakes. */

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type CSSProperties,
} from 'react';

import { Num } from '@/features/arcade/components/ui/num';
import { semitonesToPitch } from '@/features/arcade/lib/game-feel';
import { createGameFrameLoop, type GameFrameLoop } from '@/features/arcade/lib/game-frame-loop';
import { SoundManager } from '@/features/arcade/lib/sound-manager';
import { useGameFeedback } from '@/features/arcade/lib/use-game-feedback';
import { PLINKO_MULTIPLIERS, type PlinkoRisk, type PlinkoRows } from '@/server/arcade/arcade-constants';

import { deriveSubSeed, mulberry32, type Direction } from './_plinko-path';
import {
  buildPlinkoTrajectory,
  samplePlinkoTrajectory,
  slotPosition,
  spawnPoint,
  type PlinkoTrajectory,
} from './_plinko-trajectory';

import './plinko.css';

/** A settled ball, ready to play back. */
export type PlinkoBall = {
  id: number;
  /** The drop it belongs to: one ball, or ten for drop 10. */
  batchId: number;
  seed: number;
  path: Direction[];
  slotIndex: number;
  multiplier: number;
  payout: number;
  wager: number;
  rows: PlinkoRows;
};

export type PlinkoBoardHandle = {
  launch: (ball: PlinkoBall) => void;
};

type Animator = {
  traj: PlinkoTrajectory;
  startTime: number;
  nextImpact: number;
  landed: boolean;
  positioned: boolean;
};

type BallView = { id: number; slotIndex: number; firstCol: number; instant: boolean };

/** A landed ball in the column of recent hits. */
type Hit = { id: number; multiplier: number; win: boolean };

/** How long a landed ball rests in its slot before fading out. */
const REST_VISIBLE_MS = 1500;
const BALL_FADE_MS = 320;
/** Reduced motion: the ball shows in its slot and reports after this. */
const INSTANT_LAND_MS = 150;
const SLOT_LIT_MS = 600;
/** Recent hits shown beside the board, newest on top. */
const HITS_SHOWN = 6;

/** Shake force for a landing: 0 at 1x and below, 1 (4 px) at 100x. */
export function landingShake(multiplier: number): number {
  return Math.min(1, Math.log10(Math.max(1, multiplier)) / 2);
}

/** Peg tick pitch: one octave from the top row to the bottom row. */
export function pegPitch(row: number, rows: number): number {
  return semitonesToPitch((row * 12) / Math.max(1, rows - 1));
}

export const PlinkoBoard = forwardRef<
  PlinkoBoardHandle,
  {
    risk: PlinkoRisk;
    rows: PlinkoRows;
    reducedMotion: boolean;
    /** A tap on the board drops a ball. Pass it only for the machine on
     *  screen on a phone; on wide screens the buttons are the only trigger. */
    onPress?: () => void;
    onLand: (ball: PlinkoBall) => void;
  }
>(function PlinkoBoard({ risk, rows, reducedMotion, onPress, onLand }, ref) {
  const multipliers = PLINKO_MULTIPLIERS[risk][rows];
  const shakeRef = useRef<HTMLDivElement>(null);
  const boardRef = useRef<HTMLDivElement>(null);
  const { trigger } = useGameFeedback({ stage: shakeRef });

  const [balls, setBalls] = useState<BallView[]>([]);
  const [lit, setLit] = useState<Map<number, number>>(() => new Map());
  const [hits, setHits] = useState<Hit[]>([]);

  const ballEls = useRef(new Map<number, HTMLDivElement>());
  const pegEls = useRef(new Map<string, HTMLDivElement>());
  const animators = useRef(new Map<number, Animator>());
  const ballData = useRef(new Map<number, PlinkoBall>());
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  const loopRef = useRef<GameFrameLoop | null>(null);
  const onLandRef = useRef(onLand);
  onLandRef.current = onLand;
  const reducedRef = useRef(reducedMotion);
  reducedRef.current = reducedMotion;

  const schedule = useCallback((fn: () => void, ms: number) => {
    const timer = setTimeout(() => {
      timers.current.delete(timer);
      fn();
    }, ms);
    timers.current.add(timer);
  }, []);

  // A new row count is a new board: anything resting on the old one goes.
  useEffect(() => {
    animators.current.clear();
    ballData.current.clear();
    setBalls([]);
    setLit(new Map());
    setHits([]);
  }, [rows]);

  // A new table: the old hits were read off other slots.
  useEffect(() => setHits([]), [risk]);

  const land = useCallback(
    (id: number) => {
      const ball = ballData.current.get(id);
      if (!ball) return;
      // The thunk, the slot lighting up, and the board shaking by multiplier.
      SoundManager.play('pocketed', { volume: 0.8 });
      const shake = landingShake(ball.multiplier);
      if (shake > 0) trigger('impact', { sound: false, motion: false, shake });
      trigger(ball.payout > ball.wager ? 'round-win' : 'collect', {
        sound: false,
        motion: false,
        haptic: true,
      });
      const slot = ball.slotIndex;
      setHits((prev) =>
        [{ id: ball.id, multiplier: ball.multiplier, win: ball.payout > ball.wager }, ...prev].slice(0, HITS_SHOWN),
      );
      setLit((prev) => new Map(prev).set(slot, (prev.get(slot) ?? 0) + 1));
      schedule(() => {
        setLit((prev) => {
          const next = new Map(prev);
          const count = (next.get(slot) ?? 1) - 1;
          if (count <= 0) next.delete(slot);
          else next.set(slot, count);
          return next;
        });
      }, SLOT_LIT_MS);
      onLandRef.current(ball);
    },
    [schedule, trigger],
  );

  const exit = useCallback(
    (id: number, afterMs: number) => {
      const remove = () => {
        setBalls((prev) => prev.filter((b) => b.id !== id));
        ballData.current.delete(id);
      };
      schedule(() => {
        // Reduced motion: the ball goes at once instead of fading.
        if (reducedRef.current) {
          remove();
          return;
        }
        const el = ballEls.current.get(id);
        if (el) el.style.opacity = '0';
        schedule(remove, BALL_FADE_MS);
      }, afterMs);
    },
    [schedule],
  );

  const tickRef = useRef<(now: number) => void>(() => {});
  tickRef.current = (now: number) => {
    const board = boardRef.current;
    const w = board?.clientWidth ?? 0;
    const h = board?.clientHeight ?? 0;
    for (const [id, anim] of animators.current) {
      const ball = ballData.current.get(id);
      const t = now - anim.startTime;
      const el = ballEls.current.get(id);
      if (el && w > 0 && h > 0) {
        if (!anim.positioned) {
          anim.positioned = true;
          el.style.left = '0px';
          el.style.top = '0px';
        }
        const s = samplePlinkoTrajectory(anim.traj, t);
        el.style.transform = `translate3d(${((s.x / 100) * w).toFixed(1)}px, ${((s.y / 100) * h).toFixed(1)}px, 0) translate(-50%, -50%) scale(${s.scaleX.toFixed(3)}, ${s.scaleY.toFixed(3)})`;
      }
      while (anim.nextImpact < anim.traj.impacts.length && t >= anim.traj.impacts[anim.nextImpact].time) {
        const impact = anim.traj.impacts[anim.nextImpact];
        anim.nextImpact += 1;
        trigger('impact', { motion: false, pitch: pegPitch(impact.row, ball?.rows ?? rows), volume: 0.7 });
        const peg = pegEls.current.get(`${impact.row}:${impact.col}`);
        if (peg) {
          peg.classList.remove('is-hit');
          void peg.offsetWidth;
          peg.classList.add('is-hit');
          schedule(() => peg.classList.remove('is-hit'), 280);
        }
      }
      if (!anim.landed && t >= anim.traj.landTime) {
        anim.landed = true;
        land(id);
        exit(id, anim.traj.restTime - anim.traj.landTime + REST_VISIBLE_MS);
      }
      if (t >= anim.traj.restTime) animators.current.delete(id);
    }
    if (animators.current.size === 0) loopRef.current?.stop();
  };

  useEffect(() => {
    const pending = timers.current;
    const loop = createGameFrameLoop({
      // Playback of a settled result; the loop never decides anything.
      simulate: () => undefined,
      render: (_alpha, frame) => tickRef.current(frame.nowMs),
    });
    loopRef.current = loop;
    const animatorMap = animators.current;
    return () => {
      for (const timer of pending) clearTimeout(timer);
      pending.clear();
      loop.destroy();
      loopRef.current = null;
      animatorMap.clear();
    };
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      launch(ball) {
        ballData.current.set(ball.id, ball);
        setBalls((prev) => [
          ...prev,
          { id: ball.id, slotIndex: ball.slotIndex, firstCol: ball.path[0] === 'R' ? 1 : 0, instant: reducedMotion },
        ]);
        if (reducedMotion) {
          schedule(() => land(ball.id), INSTANT_LAND_MS);
          exit(ball.id, INSTANT_LAND_MS + REST_VISIBLE_MS);
          return;
        }
        // Same seed, same arcs: the flight is derived from the revealed seed.
        void deriveSubSeed(ball.seed, 'plinko-anim').then((animSeed) => {
          if (!ballData.current.has(ball.id)) return;
          animators.current.set(ball.id, {
            traj: buildPlinkoTrajectory(ball.path, ball.rows, mulberry32(animSeed)),
            startTime: performance.now(),
            nextImpact: 0,
            landed: false,
            positioned: false,
          });
          loopRef.current?.start();
        });
      },
    }),
    [exit, land, reducedMotion, schedule],
  );

  const cols = rows + 1;
  const style = {
    '--plinko-cols': cols,
    '--plinko-aspect': cols / (rows * 0.7 + 2),
  } as CSSProperties;

  return (
    <div className='plinko-fit' data-rows={rows} style={style}>
      {/* The last few slots hit, newest on top: a drop 10 reads here. */}
      <ol className='plinko-hits' aria-hidden='true'>
        {hits.map((hit) => (
          <li key={hit.id} data-win={hit.win || undefined}>
            {hit.multiplier}×
          </li>
        ))}
      </ol>
      <div ref={shakeRef} className='plinko-machine' data-pressable={onPress ? '' : undefined} onClick={onPress}>
        <div ref={boardRef} className='plinko-board'>
          {Array.from({ length: rows }, (_, row) =>
            Array.from({ length: row + 2 }, (_, peg) => {
              const rowWidth = (row + 2) / cols;
              const x = ((1 - rowWidth) / 2 + ((peg + 0.5) / (row + 2)) * rowWidth) * 100;
              const y = ((row + 0.5) / (rows + 0.5)) * 100;
              return (
                <div
                  key={`${row}-${peg}`}
                  ref={(el) => {
                    const key = `${row}:${peg}`;
                    if (el) pegEls.current.set(key, el);
                    else pegEls.current.delete(key);
                  }}
                  className='plinko-peg'
                  style={{ left: `${x}%`, top: `${y}%` }}
                />
              );
            }),
          )}
          {balls.map((ball) => {
            const start = ball.instant ? slotPosition(ball.slotIndex, rows) : spawnPoint(ball.firstCol, rows);
            return (
              <div
                key={ball.id}
                ref={(el) => {
                  if (el) ballEls.current.set(ball.id, el);
                  else ballEls.current.delete(ball.id);
                }}
                className='plinko-ball'
                style={{ left: `${start.x}%`, top: `${start.y}%` }}
              />
            );
          })}
        </div>
        {/* The paytable: each slot's value printed on brass. */}
        <ol className='plinko-slots' aria-label={`${risk} slots`}>
          {multipliers.map((value, index) => (
            <li key={index} className='plinko-slot' data-lit={lit.has(index) || undefined} data-win={value > 1 || undefined}>
              <Num value={String(value)} label={`${value} times`} />
              <span className='plinko-x' aria-hidden='true'>
                ×
              </span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
});
