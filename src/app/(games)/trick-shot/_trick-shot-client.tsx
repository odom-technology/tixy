'use client';

/* Trick shot: one pool table a day, as many tries as you like. Each try is
   replayed by the server; the day's best stands, and the board ranks it by
   balls down and then the tries it took. The table and the shot are
   8-ball's: its canvas, its controls, its engine.
   docs/design/tixy-rebrand/TRICK_SHOT.md has the feel spec. */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { ArcadeButton } from '@/features/arcade/components/ui/arcade-ui';
import { DAILY_BOARD_MODES, GameLeaderboard } from '@/features/arcade/components/game-leaderboard';
import { GameLeaderboardModal } from '@/features/arcade/components/game-leaderboard-modal';
import { GameLeaderboardButton } from '@/features/arcade/components/game-leaderboard-button';
import {
  GameShell,
  GameStage,
  GameStageNotice,
  GameStat,
  type GameHint,
  type GameHowTo,
  type GamePhase,
  type GameStageSize,
} from '@/features/arcade/components/shell/game-shell';
import {
  ArcadeRematchButton,
  ArcadeRunResult,
} from '@/features/arcade/components/results/arcade-run-result';
import { useArcadeRunResult } from '@/features/arcade/lib/run-result';
import { useGameFeedback, usePitchLadder, useFeelReducedMotion } from '@/features/arcade/lib/use-game-feedback';
import { isControlTarget, isDialogOpen } from '@/features/arcade/lib/use-first-input';
import { SoundManager } from '@/features/arcade/lib/sound-manager';
import { getGameDisplayName } from '@/features/arcade/lib/game-renames';
import {
  simulatePreview,
  type Ball,
  type ShotInput,
  type Vec2,
} from '@/features/arcade/lib/pool-physics';
import {
  isBetterTrickShotTry,
  playTrickShot,
  snapTrickShot,
  toEngineBalls,
  toShotInput,
  trickShotTickets,
  TRICK_SHOT_ANGLE_STEP,
  type TrickShotBall,
  type TrickShotInput,
  type TrickShotPlay,
} from '@/features/arcade/lib/trick-shot';
import { PoolCanvas, type PoolFeelEvent } from '../8-ball/[id]/_pool-canvas';
import { PoolControls } from '../8-ball/[id]/_pool-controls';
import { CUE_DEFLECTION_LENGTH, TARGET_LINE_LENGTH } from '../8-ball/[id]/_pool-ui-constants';
import { useTrickShotAim } from './_trick-shot-aim';
import { FineAim } from './_fine-aim';
import { TrickShotHud } from './_trick-shot-hud';
import { TrickShotOverlay, type TrickMoment } from './_trick-shot-overlay';
import { TrickShotFriends, useTrickShotFriends } from './_trick-shot-friends';
import { useTrickShotTheme } from './_trick-shot-theme';
import '../8-ball/pool-shell.css';
import './_trick-shot.css';

type Outcome = {
  pots: number;
  ballCount: number;
  scratch: boolean;
  clear: boolean;
  score: number;
  pottedIds: number[];
};

/** The day's best try. */
type Best = Omit<Outcome, 'pottedIds'> & { bestTry: number };

type DayView = {
  id: string;
  status: 'armed' | 'shot';
  tries: number;
  result: Best | null;
};

type Day = {
  dateKey: string;
  dayNumber: number;
  weekday: string;
  table: { balls: TrickShotBall[]; ballCount: number; difficulty: string };
  signedIn?: boolean;
  attempt?: DayView | null;
  best?: number;
  streak?: number;
};

type Mode = 'player' | 'guest';

/** A try as the result card shows it. `seq` ties the server's answer to
 *  the try it is for. */
type TryView = {
  seq: number;
  outcome: Outcome;
  tryNumber: number;
  /** It set the day's best (the first try always does). */
  improved: boolean;
};

const SHOT_HINT: GameHint = {
  touch: 'Drag to aim, pull back to shoot.',
  pointer: 'Click, then drag back to shoot.',
};
const POWER_HINT: GameHint = {
  touch: 'Let go to shoot.',
  pointer: 'Let go to shoot. Right-click cancels.',
};
const RACK_HINT: GameHint = { touch: 'Tap to rack again.', pointer: 'Click to rack again.' };

const HOW_TO: GameHowTo = {
  lines: [
    'Drag to aim, pull the cue ball back and let go.',
    'The board ranks most balls down, then fewest tries.',
    `Your best pays once a day: ${trickShotTickets(100)} tickets for a clear, ${trickShotTickets(0)} for a miss.`,
  ],
};

/** Stillness after the balls stop, before the result covers the table. */
const RESULT_BEAT_MS = 600;
const RACK_MS = 360;
const MOMENT_MS = 1300;
const STAMP_MS = 1800;
/** Friends' lines on the result card; the rest fold into "2 more". */
const FRIENDS_ON_CARD = 4;
/** The canvas's strike: the cue ball moves 30 ms after release. */
const LAUNCH_DELAY_MS = 30;

const settle = (t: number) => {
  // cubic-bezier(.15,.8,.25,1), close enough for a 360 ms glide.
  const u = 1 - t;
  return 1 - u * u * u * u;
};

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

const outcomeLine = (o: Pick<Outcome, 'clear' | 'pots' | 'ballCount'>) =>
  o.clear ? 'Clear' : o.pots === 0 ? 'No pots' : `${o.pots} of ${o.ballCount}`;

function shareLine(name: string, dayNumber: number, best: Best) {
  const marks = Array.from({ length: best.ballCount }, (_, i) => (i < best.pots ? '🎱' : '⚪')).join('');
  return `${name} ${dayNumber} ${best.pots}/${best.ballCount}${best.clear ? ' clear' : ''}, ${plural(best.bestTry, 'try', 'tries')}\n\n${marks}`;
}

export default function TrickShotClient() {
  const [day, setDay] = useState<Day | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [stageSize, setStageSize] = useState<GameStageSize | null>(null);
  const [balls, setBalls] = useState<Ball[]>([]);
  const [animShot, setAnimShot] = useState<ShotInput | null>(null);
  const [remaining, setRemaining] = useState<number[]>([]);
  const [spinX, setSpinX] = useState(0);
  const [spinY, setSpinY] = useState(0);
  const [keyPower, setKeyPower] = useState(0.5);
  const [lastPower, setLastPower] = useState(0.5);
  const [moments, setMoments] = useState<TrickMoment[]>([]);
  /** Tries taken today, the one rolling included. */
  const [tries, setTries] = useState(0);
  const [best, setBest] = useState<Best | null>(null);
  const bestRef = useRef<Best | null>(null);
  bestRef.current = best;
  const [streak, setStreak] = useState(0);
  const [lastTry, setLastTry] = useState<TryView | null>(null);
  const [resultOpen, setResultOpen] = useState(false);
  const [mode, setModeState] = useState<Mode>('player');
  const [saving, setSaving] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [bestRun, setBestRun] = useState(false);
  const [friendsKey, setFriendsKey] = useState(0);
  const [boardOpen, setBoardOpen] = useState(false);
  const [boardMode, setBoardMode] = useState<'daily' | 'alltime'>('daily');
  const [racked, setRacked] = useState(true);
  const [banner, setBanner] = useState<string | null>(null);
  const [shareFallback, setShareFallback] = useState('');

  const { reward, achievements, capture: captureRunResult, reset: resetRunResult } = useArcadeRunResult();
  const modeRef = useRef<Mode>('player');
  const setMode = useCallback((next: Mode) => {
    modeRef.current = next;
    setModeState(next);
  }, []);
  /** The arm for the try in hand, made at its first touch. */
  const armPromise = useRef<Promise<string | null> | null>(null);
  /** The try still saving, if any: the next arm waits for it to land. */
  const inFlight = useRef<Promise<void> | null>(null);
  const pendingShot = useRef<{ input: TrickShotInput; pots: number; seq: number } | null>(null);
  const serverTry = useRef<TryView | null>(null);
  const shotSeq = useRef(0);
  /** The balance refreshes when the result shows, not while balls roll. */
  const walletDue = useRef(false);
  const tableRef = useRef<HTMLDivElement>(null);
  const timers = useRef<number[]>([]);
  const playRef = useRef<{ play: TrickShotPlay; seq: number; tryNumber: number; pots: number } | null>(null);
  /** Where the last try was aimed: the next rack points the cue there. */
  const lastAngle = useRef<number | null>(null);
  const momentId = useRef(0);
  const rackFrame = useRef<number | null>(null);

  const reducedMotion = useFeelReducedMotion();
  const { trigger, hitStopClock, shakeOffset } = useGameFeedback();
  const ladder = usePitchLadder();
  const press = useCallback(() => trigger('press', { haptic: true }), [trigger]);

  const later = useCallback((fn: () => void, ms: number) => {
    timers.current.push(window.setTimeout(fn, ms));
  }, []);
  useEffect(
    () => () => {
      for (const t of timers.current) window.clearTimeout(t);
      if (rackFrame.current != null) cancelAnimationFrame(rackFrame.current);
    },
    [],
  );

  /** The day as the server has it: tries, the best and the streak. */
  const applyDay = useCallback((view: DayView | null | undefined, nextStreak?: number | null) => {
    if (view) {
      setTries(view.tries);
      setBest(view.result ? { ...view.result, bestTry: Math.max(1, view.result.bestTry ?? 1) } : null);
    }
    if (typeof nextStreak === 'number') setStreak(nextStreak);
  }, []);

  // ── The day ──────────────────────────────────────────────────────────
  const loadDay = useCallback(async () => {
    setLoadError(null);
    try {
      const res = await fetch('/api/games/trick-shot/day', { cache: 'no-store' });
      const payload = (await res.json().catch(() => null)) as (Day & { error?: string }) | null;
      if (!res.ok || !payload?.table) {
        setLoadError(payload?.error ?? 'Could not rack the table. Try again.');
        return;
      }
      setDay(payload);
      setBalls(toEngineBalls(payload.table.balls));
      setRemaining(payload.table.balls.filter((b) => b.id !== 0).map((b) => b.id));
      setMode(payload.signedIn ? 'player' : 'guest');
      applyDay(payload.attempt ?? null, payload.streak ?? 0);
    } catch {
      setLoadError('Could not rack the table. Try again.');
    }
  }, [setMode, applyDay]);
  useEffect(() => {
    void loadDay();
  }, [loadDay]);

  // ── A try: armed by the server at its first touch ────────────────────
  const arm = useCallback((): Promise<string | null> => {
    if (!day || modeRef.current !== 'player') return Promise.resolve(null);
    if (armPromise.current) return armPromise.current;
    const promise = (async () => {
      // The try before this one records first, so this arm is its own.
      if (inFlight.current) await inFlight.current;
      try {
        const res = await fetch('/api/games/trick-shot/start', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ dateKey: day.dateKey }),
        });
        if (res.status === 401) {
          setMode('guest');
          return null;
        }
        const data = (await res.json().catch(() => null)) as { attempt?: DayView; error?: string } | null;
        if (!res.ok || !data?.attempt) {
          if (armPromise.current === promise) armPromise.current = null;
          return null;
        }
        return data.attempt.id;
      } catch {
        if (armPromise.current === promise) armPromise.current = null;
        return null;
      }
    })();
    armPromise.current = promise;
    return promise;
  }, [day, setMode]);

  /** Every input: the press, and on a try's first touch, the arm. */
  const onInput = useCallback(() => {
    press();
    void arm();
  }, [press, arm]);

  const submit = useCallback(
    (input: TrickShotInput, clientPots: number, seq: number): Promise<void> => {
      if (!day) return Promise.resolve();
      pendingShot.current = { input, pots: clientPots, seq };
      setSaving(true);
      setSubmitError(null);
      const armed = arm();
      // The next touch arms the next try.
      armPromise.current = null;
      const run = (async () => {
        try {
          const attemptId = await armed;
          if (!attemptId) {
            if (modeRef.current === 'player') setSubmitError('Could not save your try. Try again.');
            return;
          }
          const res = await fetch('/api/games/trick-shot/shot', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ attemptId, dateKey: day.dateKey, shot: input, clientPots }),
          });
          const data = (await res.json().catch(() => null)) as {
            result?: Omit<Outcome, 'pottedIds'> & { pottedIds?: number[] };
            tryNumber?: number;
            improved?: boolean;
            day?: DayView;
            streak?: number | null;
            isNewBest?: boolean;
            payoutError?: string;
            duplicate?: boolean;
            error?: string;
          } | null;
          if (res.ok && data?.result) {
            const view: TryView = {
              seq,
              outcome: { ...data.result, pottedIds: data.result.pottedIds ?? [] },
              tryNumber: data.tryNumber ?? 1,
              improved: Boolean(data.improved),
            };
            serverTry.current = view;
            // The server's count is the one that stands.
            setLastTry((prev) => (prev && prev.seq === seq ? view : prev));
            applyDay(data.day, data.streak);
            captureRunResult(data);
            setBestRun(Boolean(data.isNewBest));
            if (data.payoutError) setSubmitError(data.payoutError);
            pendingShot.current = null;
            setFriendsKey((k) => k + 1);
            walletDue.current = Boolean(data.improved);
          } else if (res.status === 409 && data?.duplicate) {
            pendingShot.current = null;
            void loadDay();
          } else if (res.status === 401) {
            pendingShot.current = null;
            setMode('guest');
          } else {
            setSubmitError(data?.error ?? 'Could not save your try. Try again.');
          }
        } catch {
          setSubmitError('Could not reach the server. Try again.');
        } finally {
          setSaving(false);
        }
      })();
      inFlight.current = run;
      return run;
    },
    [day, arm, applyDay, captureRunResult, loadDay, setMode],
  );

  const tableBalls = useMemo(() => (day ? toEngineBalls(day.table.balls) : []), [day]);
  const firstAngle = useMemo(() => {
    const cue = day?.table.balls.find((b) => b.id === 0);
    const first = day?.table.balls.find((b) => b.id !== 0);
    return cue && first ? Math.atan2(first.y - cue.y, first.x - cue.x) : 0;
  }, [day]);
  const cuePos: Vec2 | null = useMemo(() => {
    const cue = balls.find((b) => b.id === 0 && !b.pocketed);
    return cue ? cue.pos : null;
  }, [balls]);

  const animating = animShot !== null;
  const canAim = Boolean(day) && !animating && racked && !resultOpen;

  // ── The shot ─────────────────────────────────────────────────────────
  const fire = useCallback(
    (angle: number, power: number, spin?: { x: number; y: number }) => {
      if (!day || animating || !racked) return;
      const input: TrickShotInput = snapTrickShot({ angle, power, spinX: spin?.x ?? spinX, spinY: spin?.y ?? spinY });
      const play = playTrickShot(day.table.balls, input);
      const seq = ++shotSeq.current;
      const tryNumber = tries + 1;
      playRef.current = { play, seq, tryNumber, pots: 0 };
      serverTry.current = null;
      lastAngle.current = input.angle;
      setTries(tryNumber);
      setLastPower(input.power);
      setRacked(false);
      setMoments([]);
      setBanner(null);
      setBestRun(false);
      resetRunResult();
      ladder.reset();

      // Near misses are known before the first frame; each lands when the
      // ball reaches the jaws. A clear has none, so no hit-stop moves them.
      for (const miss of play.nearMisses) {
        if (miss.kind !== 'jaws') continue;
        later(() => {
          const id = ++momentId.current;
          setMoments((prev) => [...prev, { id, kind: 'near', pocket: miss.pocket }]);
          SoundManager.play('skeeRimRattle', { volume: 0.7 });
          trigger('near-miss', { sound: false, motion: false, haptic: true });
          later(() => setMoments((prev) => prev.filter((m) => m.id !== id)), MOMENT_MS);
        }, LAUNCH_DELAY_MS + (miss.frame * 1000) / 60);
      }
      setAnimShot(toShotInput(input));
      if (mode === 'player') void submit(input, play.pots, seq);
    },
    [day, animating, racked, spinX, spinY, tries, mode, ladder, later, trigger, submit, resetRunResult],
  );

  // A test hook for the Playwright checks, only with ?qa in the address:
  // fire an exact shot. It gives nothing the API doesn't already take.
  useEffect(() => {
    if (!new URLSearchParams(window.location.search).has('qa')) return;
    const qa = {
      touch: () => onInput(),
      fire: (angle: number, power: number, x = 0, y = 0) => fire(angle, power, { x, y }),
      rack: () => rack(),
      rematch: () => playAgain(),
      ready: () => Boolean(day) && racked && !animating && !resultOpen,
      result: () => resultOpen && !saving,
    };
    (window as unknown as { __trickShotQa?: typeof qa }).__trickShotQa = qa;
  });

  const { aim, onDown, onMove, release, cancel, nudge, powerBar, resetTo } = useTrickShotAim({
    cuePos,
    balls,
    enabled: canAim,
    initialAngle: firstAngle,
    onFire: fire,
    onPress: onInput,
  });

  // Feel: the canvas reports what its precomputed frames show.
  const onFeelEvent = useCallback(
    (event: PoolFeelEvent) => {
      const current = playRef.current;
      if (!current || event.type !== 'pot') return;
      if (event.ballId === 0) {
        const id = ++momentId.current;
        setMoments((prev) => [...prev, { id, kind: 'scratch' }]);
        SoundManager.play('foul', { volume: 0.8 });
        trigger('loss', { sound: false, motion: false, haptic: true });
        later(() => setMoments((prev) => prev.filter((m) => m.id !== id)), MOMENT_MS);
        return;
      }
      current.pots += 1;
      setRemaining((prev) => prev.filter((id) => id !== event.ballId));
      SoundManager.play('skeeChime', { volume: 0.55, pitch: ladder.next() });
      const clearing = current.play.clear && current.pots === current.play.ballCount;
      if (clearing) {
        // The single biggest moment: hit-stop and a shake, once.
        trigger('round-win', { haptic: true, hitStop: true, shake: 0.5 });
        const id = ++momentId.current;
        setMoments((prev) => [...prev, { id, kind: 'clear' }]);
        later(() => setMoments((prev) => prev.filter((m) => m.id !== id)), STAMP_MS);
      } else {
        trigger('collect', { sound: false, motion: false, haptic: true });
      }
    },
    [ladder, later, trigger],
  );
  const canvasFeel = useMemo(
    () => ({ hitStop: hitStopClock, shakeOffset, onEvent: onFeelEvent }),
    [hitStopClock, shakeOffset, onFeelEvent],
  );

  const onAnimationEnd = useCallback(
    (finalBalls: Ball[]) => {
      setAnimShot(null);
      setBalls(finalBalls);
      const current = playRef.current;
      if (!current) return;
      const { play, seq, tryNumber } = current;
      for (const miss of play.nearMisses) {
        if (miss.kind !== 'short') continue;
        const id = ++momentId.current;
        setMoments((prev) => [...prev, { id, kind: 'near', pocket: miss.pocket }]);
        SoundManager.play('skeeRimRattle', { volume: 0.5 });
        trigger('near-miss', { sound: false, motion: false, haptic: true });
        later(() => setMoments((prev) => prev.filter((m) => m.id !== id)), MOMENT_MS);
      }
      const outcome: Outcome = {
        pots: play.pots,
        ballCount: play.ballCount,
        scratch: play.scratch,
        clear: play.clear,
        score: play.score,
        pottedIds: play.pottedIds,
      };
      // A guest's tries stay in the browser, so the best is kept here. A
      // player's best comes from the server with the try.
      const guest = modeRef.current === 'guest';
      const guestBest = guest && isBetterTrickShotTry(outcome, bestRef.current);
      if (guestBest) setBest({ ...outcome, bestTry: tryNumber });
      later(() => {
        const server = serverTry.current;
        setLastTry(server && server.seq === seq ? server : { seq, outcome, tryNumber, improved: guestBest });
        setResultOpen(true);
      }, RESULT_BEAT_MS);
    },
    [later, trigger],
  );

  // ── Rack it again ────────────────────────────────────────────────────
  const rack = useCallback(() => {
    if (!day || animating) return;
    setMoments([]);
    setBanner(null);
    setRemaining(day.table.balls.filter((b) => b.id !== 0).map((b) => b.id));
    const from = balls;
    const to = tableBalls;
    // The cue comes back where the last try was aimed, so the next one
    // starts from it.
    const aimAt = lastAngle.current ?? firstAngle;
    const done = () => {
      setBalls(to);
      setRacked(true);
      resetTo(aimAt);
      rackFrame.current = null;
    };
    if (reducedMotion) {
      done();
      return;
    }
    const start = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / RACK_MS);
      const k = settle(t);
      setBalls(
        to.map((target) => {
          const was = from.find((b) => b.id === target.id);
          // A potted ball comes back from its spot, not from the pocket.
          if (!was || was.pocketed) return { ...target, pos: { ...target.pos } };
          return {
            ...target,
            pos: { x: was.pos.x + (target.pos.x - was.pos.x) * k, y: was.pos.y + (target.pos.y - was.pos.y) * k },
          };
        }),
      );
      if (t < 1) rackFrame.current = requestAnimationFrame(step);
      else done();
    };
    rackFrame.current = requestAnimationFrame(step);
  }, [day, animating, balls, tableBalls, reducedMotion, resetTo, firstAngle]);

  const onCanvasDown = useCallback(
    (pos: Vec2, pointerType?: string) => {
      if (!racked && !animating && !resultOpen) {
        press();
        rack();
        return;
      }
      onDown(pos, pointerType);
    },
    [racked, animating, resultOpen, press, rack, onDown],
  );

  // ── Keyboard: arrows turn and set power, space shoots ────────────────
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (isControlTarget(event.target) || isDialogOpen() || event.repeat && event.code === 'Space') return;
      if (!canAim) {
        if (!racked && !animating && !resultOpen && (event.code === 'Space' || event.code === 'Enter')) {
          event.preventDefault();
          rack();
        }
        return;
      }
      const big = event.shiftKey ? 10 : 1;
      if (event.code.startsWith('Arrow')) void arm();
      if (event.code === 'ArrowLeft') nudge(-big);
      else if (event.code === 'ArrowRight') nudge(big);
      else if (event.code === 'ArrowUp') setKeyPower((p) => Math.min(1, Math.round((p + big / 100) * 100) / 100));
      else if (event.code === 'ArrowDown') setKeyPower((p) => Math.max(0.05, Math.round((p - big / 100) * 100) / 100));
      else if (event.code === 'Space' || event.code === 'Enter') {
        onInput();
        fire(aim.angle, keyPower);
      } else return;
      event.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [canAim, racked, animating, resultOpen, rack, nudge, onInput, arm, fire, aim.angle, keyPower]);

  // ── The guide: 8-ball's, on the shooting grid ────────────────────────
  const showAim = canAim && aim.phase !== 'idle';
  const gridAngle = Math.round(aim.angle / TRICK_SHOT_ANGLE_STEP) * TRICK_SHOT_ANGLE_STEP;
  const preview = useMemo(
    () =>
      showAim && cuePos
        ? simulatePreview(balls, { angle: gridAngle, power: 0.5, cuePosition: null, spinX, spinY })
        : null,
    [showAim, cuePos, balls, gridAngle, spinX, spinY],
  );
  const hasSpin = Math.abs(spinX) > 0.05 || Math.abs(spinY) > 0.05;
  const ghostBall = preview?.firstContactPos ?? null;
  const targetBall = preview?.firstContactBallId
    ? balls.find((b) => b.id === preview.firstContactBallId && !b.pocketed) ?? null
    : null;
  const targetLine =
    targetBall && preview?.targetDirection
      ? {
          start: targetBall.pos,
          end: {
            x: targetBall.pos.x + preview.targetDirection.x * TARGET_LINE_LENGTH,
            y: targetBall.pos.y + preview.targetDirection.y * TARGET_LINE_LENGTH,
          },
        }
      : null;
  const cueDeflectionLine =
    !hasSpin && preview?.firstContactPos && preview.cueDeflection
      ? {
          start: preview.firstContactPos,
          end: {
            x: preview.firstContactPos.x + preview.cueDeflection.x * CUE_DEFLECTION_LENGTH,
            y: preview.firstContactPos.y + preview.cueDeflection.y * CUE_DEFLECTION_LENGTH,
          },
        }
      : null;
  const cueStick = showAim && cuePos ? { angle: gridAngle, power: aim.power, cuePos } : null;

  // ── Shell ────────────────────────────────────────────────────────────
  const phase: GamePhase = resultOpen ? 'over' : animating ? 'playing' : 'ready';
  const hint: GameHint | undefined = !day
    ? undefined
    : !racked && !animating
      ? RACK_HINT
      : aim.phase === 'powering'
        ? POWER_HINT
        : SHOT_HINT;
  const shownPower = aim.phase === 'powering' ? aim.power : canAim ? keyPower : lastPower;
  const gameName = getGameDisplayName('trick-shot', 'Trick Shot').toLowerCase();
  useEffect(() => {
    if (!resultOpen || saving || !walletDue.current) return;
    walletDue.current = false;
    window.dispatchEvent(new Event('store-inventory-updated'));
  }, [resultOpen, saving]);
  const signedIn = mode === 'player';
  const friends = useTrickShotFriends(signedIn && best !== null, friendsKey);
  const poolTheme = useTrickShotTheme(Boolean(day?.signedIn));
  /** The try the HUD names: the one in hand, or the one just taken. */
  const tryShown = racked && !animating ? tries + 1 : Math.max(1, tries);

  const handleShare = useCallback(() => {
    if (!day || !best) return;
    const text = shareLine(gameName, day.dayNumber, best);
    setShareFallback('');
    navigator.clipboard
      .writeText(text)
      .then(() => setBanner('Copied.'))
      .catch(() => setShareFallback(text));
  }, [day, best, gameName]);

  const playAgain = useCallback(() => {
    setResultOpen(false);
    setShareFallback('');
    resetRunResult();
    rack();
  }, [rack, resetRunResult]);

  const shown = lastTry?.outcome ?? null;
  // Under the title: why a full rack wasn't a clear, or where the day's
  // best stands when this try didn't beat it.
  const bestNote =
    lastTry && best && !saving && !lastTry.improved && best.bestTry !== lastTry.tryNumber
      ? best.clear
        ? `You cleared it on try ${best.bestTry}.`
        : `Your best is ${best.pots} of ${best.ballCount}, on try ${best.bestTry}.`
      : null;
  const end = resultOpen && shown && lastTry && day ? (
    <ArcadeRunResult
      title={outcomeLine(shown)}
      tone={bestRun ? 'best' : shown.clear ? 'win' : 'neutral'}
      stats={[
        { label: 'balls', value: `${shown.pots}/${shown.ballCount}`, highlight: shown.clear },
        { label: 'try', value: lastTry.tryNumber },
        ...(signedIn && streak > 0 ? [{ label: 'streak', value: streak, highlight: shown.clear && streak > 1 }] : []),
      ]}
      reward={reward}
      achievements={achievements}
      saving={saving}
      error={submitError}
      guest={mode === 'guest'}
      actions={
        <>
          <ArcadeRematchButton onClick={playAgain} />
          {submitError && pendingShot.current ? (
            <ArcadeButton
              tone='key'
              onClick={() => {
                const pending = pendingShot.current;
                if (pending) void submit(pending.input, pending.pots, pending.seq);
              }}
            >
              retry
            </ArcadeButton>
          ) : null}
          {signedIn && best ? (
            <ArcadeButton tone='key' onClick={handleShare}>
              share
            </ArcadeButton>
          ) : null}
          <ArcadeButton tone='key' onClick={() => setBoardOpen(true)}>
            scores
          </ArcadeButton>
        </>
      }
    >
      {shown.scratch && !shown.clear && shown.pots === shown.ballCount ? <p>Scratch. No clear bonus.</p> : null}
      {bestNote ? <p>{bestNote}</p> : null}
      <TrickShotFriends friends={friends} limit={FRIENDS_ON_CARD} />
      {shareFallback ? <p className='trick-share-copy'>{shareFallback}</p> : null}
    </ArcadeRunResult>
  ) : loadError ? (
    <GameStageNotice
      title='Table closed'
      action={
        <ArcadeButton tone='primary' onClick={() => void loadDay()}>
          retry
        </ArcadeButton>
      }
    >
      <p>{loadError}</p>
    </GameStageNotice>
  ) : null;

  const controls = day ? (
    <div className='trick-controls' data-surface='ink'>
      <PoolControls
        spinX={spinX}
        spinY={spinY}
        onSpin={(x, y) => {
          setSpinX(x);
          setSpinY(y);
        }}
        spinEnabled={canAim && aim.phase !== 'powering'}
        power={shownPower}
        onPress={onInput}
        powerDrag={canAim ? powerBar : null}
      />
    </div>
  ) : null;

  return (
    <GameShell
      game='trick-shot'
      className='pool-midway trick-shot'
      stat={<GameStat value={day?.dayNumber ?? null} label='table' />}
      howTo={HOW_TO}
      below={
        <div className='flex flex-wrap items-center justify-center gap-2'>
          {signedIn && best && !resultOpen ? (
            <ArcadeButton tone='key' onClick={handleShare}>
              share
            </ArcadeButton>
          ) : null}
          <GameLeaderboardButton onClick={() => setBoardOpen(true)} />
        </div>
      }
    >
      <TrickShotHud
        weekday={day?.weekday ?? null}
        difficulty={day?.table.difficulty ?? null}
        remaining={remaining}
        tryNumber={day ? tryShown : null}
        best={best}
        streak={signedIn ? streak : 0}
      />
      <GameStage
        phase={phase}
        hint={hint}
        busy={day || loadError ? null : 'Racking the table.'}
        onSize={setStageSize}
        end={end}
        controls={controls}
      >
        <div ref={tableRef} className='pool-table trick-table'>
          {day ? (
            <PoolCanvas
              theme={poolTheme}
              balls={balls}
              fitBox={stageSize ? { width: stageSize.width - 8, height: stageSize.height - 8 } : null}
              feel={canvasFeel}
              canvasClassName='block'
              animateShot={animShot}
              onAnimationEnd={onAnimationEnd}
              aimGuideEmphasis={1}
              ghostBall={showAim ? ghostBall : null}
              targetLine={showAim ? targetLine : null}
              cueDeflectionLine={showAim ? cueDeflectionLine : null}
              aimPath={showAim && preview?.cuePath?.length ? preview.cuePath : null}
              cueStick={cueStick}
              spinIndicator={showAim ? { x: spinX, y: spinY } : null}
              onCanvasInteraction={onCanvasDown}
              onCanvasMove={onMove}
              onCanvasRelease={release}
              onCanvasCancel={cancel}
            />
          ) : null}
          {day ? <FineAim enabled={canAim} onNudge={nudge} onPress={onInput} /> : null}
          <TrickShotOverlay
            hostRef={tableRef}
            moments={moments}
            measureKey={`${stageSize?.width ?? 0}x${stageSize?.height ?? 0}:${day?.dateKey ?? ''}`}
          />
        </div>
        {banner ? (
          <div key={banner} className='pool-banner' role='status'>
            {banner}
          </div>
        ) : null}
      </GameStage>

      <GameLeaderboardModal
        open={boardOpen}
        onOpenChange={setBoardOpen}
        title='Trick shot board'
        description={boardMode === 'daily' ? 'Most balls today, then fewest tries.' : 'Days cleared, all time.'}
      >
        <GameLeaderboard
          gameType='trick-shot'
          mode={boardMode}
          modes={DAILY_BOARD_MODES}
          onModeChange={(next) => setBoardMode(next as 'daily' | 'alltime')}
          refreshKey={friendsKey}
        />
      </GameLeaderboardModal>
    </GameShell>
  );
}
