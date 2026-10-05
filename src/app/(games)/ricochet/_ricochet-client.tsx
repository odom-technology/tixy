'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { ArcadeButton } from '@/features/arcade/components/ui/arcade-ui';
import { GameLeaderboard } from '@/features/arcade/components/game-leaderboard';
import { GameLeaderboardModal } from '@/features/arcade/components/game-leaderboard-modal';
import { GameLeaderboardButton } from '@/features/arcade/components/game-leaderboard-button';
import { ArcadeGameplayCallouts } from '@/features/arcade/components/gameplay/arcade-game-hud';
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
import { ArcadeRematchButton, ArcadeRunResult } from '@/features/arcade/components/results/arcade-run-result';
import { EnvMonitor } from '@/features/arcade/lib/game-anti-cheat';
import {
  createGameFrameLoop,
  gameCanvasDpr,
  getGame2dContext,
  lerp,
  type GameFrameLoop,
} from '@/features/arcade/lib/game-frame-loop';
import { createPitchLadder } from '@/features/arcade/lib/game-feel';
import { SoundManager } from '@/features/arcade/lib/sound-manager';
import { isControlTarget } from '@/features/arcade/lib/use-first-input';
import { useFeelReducedMotion, useGameFeedback } from '@/features/arcade/lib/use-game-feedback';
import { useGameplayCallouts, useNewBestMoment } from '@/features/arcade/lib/use-gameplay-callouts';
import { useArcadeRunResult } from '@/features/arcade/lib/run-result';
import {
  RICOCHET_BASE_HEIGHT,
  RICOCHET_BASE_WIDTH,
  RICOCHET_MAX_WALLS,
  RICOCHET_START_X,
  RICOCHET_START_Y,
  createRicochetState,
  ricochetGapFor,
  stepRicochet,
  type RicochetEvent,
  type RicochetState,
} from '@/server/arcade/ricochet-replay';

import {
  DEATH_HOLD_MS,
  advanceFx,
  buildStaticLayer,
  drawRicochet,
  freshFx,
  spawnBounce,
  spawnDeath,
  spawnFlap,
  type RicochetFonts,
  type RicochetFx,
  type RicochetView,
} from './_ricochet-draw';
import {
  fetchRunSession,
  getSubmitErrorMessage,
  randomSeed,
  SESSION_MAX_AGE_MS,
  stampRunStart,
  type PreparedFailed,
  type PreparedOk,
  type PreparedRun,
} from './_ricochet-session';
import { HOUSE_LOOK, buildRicochetLook, type InventoryCosmeticResponse, type RicochetLook } from './_ricochet-theme';

import './_ricochet.css';

/* Ricochet. A bird flies between two walls; tap to flap through the gap in
   each. The rules, the step and the replay live in
   src/server/arcade/ricochet-replay.ts; this file draws and listens, and
   docs/design/tixy-rebrand/RICOCHET.md is the feel spec.

   The sim steps at 60 Hz through the shared frame loop and the bird is drawn
   between two steps, so a 120 or 144 Hz display sees motion on every frame.
   Every effect (squash, sparks, slides, the death) runs on a clock of its
   own that real frame time advances and a hit-stop holds still.

   A tap is logged as the steps already played when it landed and flaps on the
   next step. When the run ends the client posts those taps; the server plays
   them again from the session's seed to get the score. The session hands out
   the seed and the server stamps the run's start before the clock starts.
   Signed out, a run uses a local seed and saves nothing. */

const HINT: GameHint = { touch: 'Tap to flap.', pointer: 'Press space or click to flap.' };
const HOW_TO: GameHowTo = {
  lines: [
    'Tap to flap, and cross to the other wall through its gap.',
    'Each crossing is faster, and a hit on the wall, the floor or the ceiling ends the run.',
    '10 walls pay 22 tickets, and 25 pay 47.',
  ],
};

/** A press after a run ends waits this long before it starts the next. */
const RESTART_GRACE_MS = 500;

type GameState = 'idle' | 'playing' | 'dying' | 'over' | 'error';

declare global {
  interface Window {
    /** ?arcadePerf=1 only: frame times and a handle on the run, for QA. */
    __ricochetFrames?: number[];
    /** Epoch ms of each wall cleared, flap and death, for lining up a video. */
    __ricochetEvents?: Array<{ kind: 'bounce' | 'flap' | 'death'; at: number }>;
    /** What each paint drew: epoch ms, x, y of the bird. */
    __ricochetPaints?: Array<[number, number, number]>;
    __ricochet?: {
      state: () => RicochetState;
      seed: () => number;
      taps: () => number[];
      gapFor: (wall: number) => { start: number; end: number; height: number };
      phase: () => GameState;
    };
  }
}

export default function RicochetClient() {
  const reducedMotion = useFeelReducedMotion();
  const shakeRef = useRef<HTMLDivElement>(null);
  const { trigger, hitStopClock } = useGameFeedback({ stage: shakeRef });
  const { items: callouts, push: pushCallout, clear: clearCallouts } = useGameplayCallouts();
  const { check: newBestCheck, reset: resetNewBest } = useNewBestMoment(pushCallout, { unit: 'walls', y: 22 });

  const [gameState, setGameState] = useState<GameState>('idle');
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0, dpr: 1 });
  const [result, setResult] = useState<{ score: number } | null>(null);
  const [best, setBest] = useState<number | null>(null);
  const [previousBest, setPreviousBest] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const [banned, setBanned] = useState(false);
  const [guestRun, setGuestRun] = useState(false);
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const [leaderboardRefreshKey, setLeaderboardRefreshKey] = useState(0);
  const [look, setLook] = useState<RicochetLook>(HOUSE_LOOK);
  const { result: runResult, capture: captureRunResult, reset: resetRunResult } = useArcadeRunResult();

  // The sim and what is drawn between two of its steps.
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const liveRef = useRef<HTMLParagraphElement>(null);
  const simRef = useRef<RicochetState>(createRicochetState());
  const prevRef = useRef({ x: RICOCHET_START_X, y: RICOCHET_START_Y });
  const seedRef = useRef(0);
  const tapsRef = useRef<number[]>([]);
  const lastTapRef = useRef(-1);
  const flapPendingRef = useRef(false);
  const gameStateRef = useRef<GameState>('idle');
  const fxRef = useRef<RicochetFx>(freshFx());
  const lookRef = useRef<RicochetLook>(HOUSE_LOOK);
  const layerRef = useRef<HTMLCanvasElement | null>(null);
  const fontsRef = useRef<RicochetFonts>({ num: 'sans-serif', text: 'sans-serif' });
  const ladderRef = useRef(createPitchLadder({ maxSteps: 12 }));
  const loopRef = useRef<GameFrameLoop | null>(null);
  const lastPaintRef = useRef(0);
  const bestAtStartRef = useRef(0);
  const endedAtRef = useRef(0);
  const timersRef = useRef<Set<number>>(new Set());
  const perfRef = useRef(false);

  // The latest callbacks, so the loop and the mount effect never restart.
  const paintRef = useRef<(now: number, alpha: number) => void>(() => {});
  const stepOnceRef = useRef<() => void>(() => {});
  const prepareRunRef = useRef<() => Promise<PreparedRun>>(() => fetchRunSession());

  // The run's session.
  const runRef = useRef<PreparedOk | null>(null);
  const preparingRef = useRef<Promise<PreparedRun> | null>(null);
  const startingRef = useRef(false);
  const envMonitorRef = useRef<EnvMonitor | null>(null);

  /** The screen reader line, written straight to the page: no render a wall. */
  const say = useCallback((text: string) => {
    if (liveRef.current) liveRef.current.textContent = text;
  }, []);

  /** ?arcadePerf=1 only: a timestamped event for QA. */
  const logEvent = useCallback((kind: 'bounce' | 'flap' | 'death') => {
    if (perfRef.current) window.__ricochetEvents?.push({ kind, at: performance.timeOrigin + performance.now() });
  }, []);

  const after = useCallback((ms: number, fn: () => void) => {
    const id = window.setTimeout(() => {
      timersRef.current.delete(id);
      fn();
    }, ms);
    timersRef.current.add(id);
  }, []);

  const setState = useCallback((next: GameState) => {
    gameStateRef.current = next;
    setGameState(next);
  }, []);

  useEffect(() => {
    fxRef.current.reduced = reducedMotion;
  }, [reducedMotion]);

  /* ── drawing ──────────────────────────────────────────────────────── */

  const viewAt = useCallback((alpha: number): RicochetView => {
    const sim = simRef.current;
    const phase = gameStateRef.current;
    const live = phase === 'playing';
    return {
      x: live ? lerp(prevRef.current.x, sim.x, alpha) : sim.x,
      y: live ? lerp(prevRef.current.y, sim.y, alpha) : sim.y,
      vy: phase === 'idle' ? 0 : sim.vy,
      dir: sim.dir,
      wall: sim.wall,
      score: sim.score,
      phase: phase === 'idle' || phase === 'error' ? 'ready' : phase === 'over' ? 'over' : phase,
      seed: seedRef.current,
    };
  }, []);

  const rebuildLayer = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || canvas.width < 2) return;
    layerRef.current = buildStaticLayer(lookRef.current, canvas.width / RICOCHET_BASE_WIDTH);
  }, []);

  const finishRun = useCallback(() => {
    if (gameStateRef.current !== 'dying') return;
    const score = simRef.current.score;
    setResult({ score });
    setBest((previous) => Math.max(previous ?? 0, score));
    setState('over');
    loopRef.current?.stop();
    endedAtRef.current = performance.now();
    // The next run's session, so rematch starts at once.
    void prepareRunRef.current();
  }, [setState]);

  const paint = useCallback(
    (now: number, alpha: number) => {
      const canvas = canvasRef.current;
      if (!canvas || canvas.width < 2) return;
      const ctx = getGame2dContext(canvas, { alpha: false });
      if (!ctx) return;
      const fx = fxRef.current;
      // Effects run on their own clock, which a hit-stop holds still.
      const last = lastPaintRef.current || now;
      const dt = Math.min(100, Math.max(0, now - last - hitStopClock.frozenWithin(last, now)));
      lastPaintRef.current = now;
      const view = viewAt(alpha);
      advanceFx(fx, view, dt);
      if (!layerRef.current) rebuildLayer();
      const scale = canvas.width / RICOCHET_BASE_WIDTH;
      ctx.setTransform(scale, 0, 0, scale, 0, 0);
      drawRicochet(ctx, view, lookRef.current, fx, { layer: layerRef.current, fonts: fontsRef.current });
      if (perfRef.current && view.phase === 'playing') window.__ricochetPaints?.push([now, view.x, view.y]);
      if (gameStateRef.current === 'dying' && fx.death && fx.now - fx.death.at >= (fx.reduced ? 0 : DEATH_HOLD_MS)) {
        finishRun();
      }
    },
    [finishRun, hitStopClock, rebuildLayer, viewAt],
  );

  /** One still frame, for the ready screen and after a resize. */
  const paintStill = useCallback(() => {
    lastPaintRef.current = 0;
    paint(performance.now(), 1);
  }, [paint]);

  /* ── the run ──────────────────────────────────────────────────────── */

  const saveRun = useCallback(
    async (prepared: PreparedOk, taps: number[], score: number) => {
      if (prepared.guest || !prepared.token) return;
      envMonitorRef.current?.stop();
      setSaving(true);
      setSubmitError(null);
      try {
        const response = await fetch('/api/games/ricochet/score', {
          method: 'POST',
          keepalive: true,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            score,
            sessionToken: prepared.token,
            taps,
            env: envMonitorRef.current?.getFingerprint(),
          }),
        });
        const data = (await response.json().catch(() => null)) as Record<string, unknown> | null;
        if (!response.ok) {
          const err = data as { error?: string; details?: string; retryAfterSec?: number } | null;
          console.error(`[ricochet] score rejected (${response.status}): ${err?.details ?? err?.error ?? ''}`);
          setSubmitError(getSubmitErrorMessage(response.status, err));
          return;
        }
        captureRunResult(data);
        setLeaderboardRefreshKey((key) => key + 1);
        // The strip's balance reloads and rolls.
        window.dispatchEvent(new Event('store-inventory-updated'));
      } catch {
        setSubmitError('Could not save your run. Try again.');
      } finally {
        setSaving(false);
      }
    },
    [captureRunResult],
  );

  const endRun = useCallback(
    (event: Extract<RicochetEvent, { kind: 'death' }> | { kind: 'cap' }) => {
      if (gameStateRef.current !== 'playing') return;
      const sim = simRef.current;
      const fx = fxRef.current;
      setState('dying');
      ladderRef.current.reset();
      const cause = event.kind === 'cap' ? 'cap' : event.cause;
      const side = event.kind === 'cap' ? (sim.dir > 0 ? 'left' : 'right') : event.side;
      spawnDeath(fx, { cause, side, x: sim.x, y: sim.y, dir: sim.dir }, lookRef.current);
      // The one impact that shakes and holds: the bird meets a wall, the floor
      // or the ceiling.
      trigger('impact', { sound: false, motion: false, haptic: true, shake: 1, hitStop: true });
      SoundManager.play('hit');
      after(90, () => SoundManager.play('fall'));
      say(`Run over. ${sim.score} ${sim.score === 1 ? 'wall' : 'walls'}.`);
      logEvent('death');
      const prepared = runRef.current;
      runRef.current = null;
      if (prepared) void saveRun(prepared, tapsRef.current.slice(), sim.score);
      // Reduced motion shows the end at once; otherwise the next frames play
      // the fall and finishRun closes it.
      if (fx.reduced) {
        paint(performance.now(), 1);
        finishRun();
      }
    },
    [after, finishRun, logEvent, paint, saveRun, say, setState, trigger],
  );

  const stepOnce = useCallback(() => {
    if (gameStateRef.current !== 'playing') return;
    const sim = simRef.current;
    const flap = flapPendingRef.current;
    flapPendingRef.current = false;
    const event = stepRicochet(sim, seedRef.current, flap);
    if (!event) return;
    if (event.kind === 'death') {
      endRun(event);
      return;
    }
    // A wall cleared: the bird turns, squashes into the face and the pitch
    // climbs a semitone.
    const fx = fxRef.current;
    fx.scoreAt = fx.now;
    logEvent('bounce');
    spawnBounce(fx, event.side, event.y, lookRef.current);
    trigger('collect', { motion: false, haptic: true, pitch: ladderRef.current.next() });
    say(`${sim.score} ${sim.score === 1 ? 'wall' : 'walls'}.`);
    newBestCheck(sim.score, bestAtStartRef.current);
    if (sim.score >= RICOCHET_MAX_WALLS) endRun({ kind: 'cap' });
  }, [endRun, logEvent, newBestCheck, say, trigger]);

  paintRef.current = paint;
  stepOnceRef.current = stepOnce;

  // The frame loop: 60 Hz steps, a paint on every display frame. Made once.
  useEffect(() => {
    const loop = createGameFrameLoop({
      hitStop: hitStopClock,
      beforeSimulate: () => {
        prevRef.current = { x: simRef.current.x, y: simRef.current.y };
      },
      simulate: () => {
        stepOnceRef.current();
        return true;
      },
      render: (alpha, frame) => {
        if (perfRef.current && frame.deltaMs > 0) window.__ricochetFrames?.push(frame.deltaMs);
        paintRef.current(frame.nowMs, alpha);
      },
    });
    loopRef.current = loop;
    return () => {
      loop.destroy();
      if (loopRef.current === loop) loopRef.current = null;
    };
  }, [hitStopClock]);

  /* ── session ──────────────────────────────────────────────────────── */

  const prepareRun = useCallback((): Promise<PreparedRun> => {
    if (preparingRef.current) return preparingRef.current;
    const promise = fetchRunSession();
    preparingRef.current = promise;
    void promise.then((prepared) => {
      if (preparingRef.current !== promise) return;
      if (!prepared.ok) {
        // Let the next press try again.
        preparingRef.current = null;
        return;
      }
      // Show the session's own first frame before the first press.
      if (gameStateRef.current === 'idle' && !prepared.guest) {
        seedRef.current = prepared.seed;
        paintStill();
      }
    });
    return promise;
  }, [paintStill]);
  prepareRunRef.current = prepareRun;

  const fetchBest = useCallback(async () => {
    try {
      const response = await fetch('/api/games/ricochet/score', { cache: 'no-store' });
      if (!response.ok) return;
      const data = (await response.json()) as { bestScore?: number };
      if (typeof data.bestScore === 'number') setBest(data.bestScore);
    } catch {
      /* the strip just shows nothing */
    }
  }, []);

  const loadLook = useCallback(async () => {
    try {
      const response = await fetch('/api/store/inventory?gameType=ricochet', { cache: 'no-store' });
      if (!response.ok) return;
      const payload = (await response.json()) as InventoryCosmeticResponse;
      setLook(buildRicochetLook(payload));
    } catch {
      /* the house look stays */
    }
  }, []);

  useEffect(() => {
    perfRef.current = new URLSearchParams(window.location.search).get('arcadePerf') === '1';
    if (perfRef.current) {
      window.__ricochetFrames = [];
      window.__ricochetEvents = [];
      window.__ricochetPaints = [];
      window.__ricochet = {
        state: () => ({ ...simRef.current }),
        seed: () => seedRef.current,
        taps: () => tapsRef.current.slice(),
        gapFor: (wall) => ricochetGapFor(seedRef.current, wall),
        phase: () => gameStateRef.current,
      };
    }
    const root = getComputedStyle(document.documentElement);
    const num = root.getPropertyValue('--tixy-font-num').trim();
    const text = root.getPropertyValue('--tixy-font-text').trim();
    fontsRef.current = { num: num || "'Big Shoulders', sans-serif", text: text || "'Gabarito', sans-serif" };
    const param = new URLSearchParams(window.location.search).get('seed');
    seedRef.current = param && /^\d+$/.test(param) ? Number(param) : randomSeed();
    envMonitorRef.current = new EnvMonitor();
    void prepareRunRef.current();
    void fetchBest();
    void loadLook();
    const timers = timersRef.current;
    return () => {
      timers.forEach((id) => window.clearTimeout(id));
      timers.clear();
      envMonitorRef.current?.stop();
    };
  }, [fetchBest, loadLook]);

  // A skin set's sound tint colours this game's cues while the page is open.
  useEffect(() => {
    lookRef.current = look;
    layerRef.current = null;
    SoundManager.setTint(look.sound);
    if (gameStateRef.current !== 'playing') paintStill();
    return () => SoundManager.setTint('house');
  }, [look, paintStill]);

  const fitCanvas = useCallback(
    ({ width, height }: GameStageSize) => {
      setCanvasSize({ width, height, dpr: gameCanvasDpr(width, height) });
    },
    [],
  );

  // Repaint a still frame when its inputs change, and once the fonts load.
  useEffect(() => {
    layerRef.current = null;
    if (gameStateRef.current !== 'playing') paintStill();
  }, [canvasSize, reducedMotion, paintStill, gameState]);
  useEffect(() => {
    void document.fonts?.ready.then(() => {
      if (gameStateRef.current !== 'playing') paintStill();
    });
  }, [paintStill]);

  /* ── starting a run ───────────────────────────────────────────────── */

  const startRun = useCallback(async () => {
    if (gameStateRef.current === 'playing' || gameStateRef.current === 'dying' || startingRef.current) return;
    startingRef.current = true;
    trigger('press', { haptic: true });
    resetRunResult();
    setSubmitError(null);
    setStartError(null);

    let prepared = runRef.current ?? (await prepareRun());
    if (prepared.ok && !prepared.guest && Date.now() - prepared.fetchedAt > SESSION_MAX_AGE_MS) {
      preparingRef.current = null;
      setBusy(true);
      prepared = await prepareRun();
    }
    if (!prepared.ok) {
      // One fresh try before giving up.
      preparingRef.current = null;
      setBusy(true);
      prepared = await prepareRun();
    }
    preparingRef.current = null;

    // The server stamps the start before the clock starts, so it can bound the
    // run from both ends. If the stamp fails or times out, the session may or
    // may not be stamped, so it is never stamped again: a fresh session is
    // fetched and stamped instead.
    if (prepared.ok && !prepared.guest) {
      setBusy(true);
      let stamped = await stampRunStart(prepared.sessionId);
      if (!stamped) {
        preparingRef.current = null;
        const fresh = await prepareRun();
        preparingRef.current = null;
        prepared = fresh;
        stamped = fresh.ok && !fresh.guest ? await stampRunStart(fresh.sessionId) : fresh.ok;
      }
      if (prepared.ok && !stamped) {
        prepared = { ok: false, status: 0, error: 'Could not start your run. Try again.', banned: false, retryAfterSec: null };
      }
    }
    setBusy(false);
    startingRef.current = false;

    if (prepared.ok === false) {
      const failed = prepared as PreparedFailed;
      setStartError(failed.error);
      setBanned(failed.banned);
      setState('error');
      return;
    }

    runRef.current = prepared;
    setGuestRun(prepared.guest);
    // A signed-in run flies the session's seed. A guest keeps the local seed
    // already on the ready screen, and takes a new one after each run.
    if (!prepared.guest) seedRef.current = prepared.seed;
    else if (gameStateRef.current === 'over') seedRef.current = randomSeed();

    simRef.current = createRicochetState();
    prevRef.current = { x: simRef.current.x, y: simRef.current.y };
    tapsRef.current = [];
    lastTapRef.current = -1;
    flapPendingRef.current = false;
    const reduced = fxRef.current.reduced;
    fxRef.current = { ...freshFx(), reduced, now: fxRef.current.now };
    ladderRef.current.reset();
    bestAtStartRef.current = best ?? 0;
    resetNewBest();
    clearCallouts();
    setResult(null);
    setPreviousBest(best);
    say('');
    if (!prepared.guest) envMonitorRef.current?.start();
    lastPaintRef.current = 0;
    setState('playing');
    loopRef.current?.start();
  }, [best, clearCallouts, prepareRun, resetNewBest, resetRunResult, say, setState, trigger]);

  /* ── input ────────────────────────────────────────────────────────── */

  /** A tap: the sound, the haptic and the wing answer in this frame; the
   *  flap itself lands on the next step. */
  const flap = useCallback(() => {
    if (gameStateRef.current !== 'playing') return;
    trigger('press', { sound: false, haptic: true });
    SoundManager.play('flap');
    logEvent('flap');
    const sim = simRef.current;
    spawnFlap(fxRef.current, sim.x, sim.y, sim.dir, lookRef.current);
    // Logged with the steps played so far; two taps before the same step log
    // once, since the second changes nothing.
    if (sim.step > lastTapRef.current) {
      tapsRef.current.push(sim.step);
      lastTapRef.current = sim.step;
    }
    flapPendingRef.current = true;
  }, [logEvent, trigger]);

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (gameStateRef.current !== 'playing') return;
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      event.preventDefault();
      flap();
    },
    [flap],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code !== 'Space' && event.code !== 'Enter' && event.code !== 'ArrowUp') return;
      if (isControlTarget(event.target)) return;
      const state = gameStateRef.current;
      if (state === 'playing') {
        event.preventDefault();
        if (!event.repeat) flap();
      } else if (state === 'over' && event.code === 'Space') {
        event.preventDefault();
        if (!event.repeat && performance.now() - endedAtRef.current >= RESTART_GRACE_MS) void startRun();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [flap, startRun]);

  /* ── the shell ────────────────────────────────────────────────────── */

  const phase: GamePhase = gameState === 'idle' ? 'ready' : gameState === 'over' || gameState === 'error' ? 'over' : 'playing';
  const score = result?.score ?? 0;
  const isBest = gameState === 'over' && score > 0 && score > (previousBest ?? 0);

  const end =
    gameState === 'error' ? (
      <GameStageNotice
        title={banned ? 'Banned from games' : 'Connection lost'}
        action={
          banned ? undefined : (
            <ArcadeButton tone='primary' onClick={() => void startRun()} disabled={busy}>
              retry
            </ArcadeButton>
          )
        }
      >
        <p>{startError ?? 'Could not reach the server. Try again.'}</p>
      </GameStageNotice>
    ) : gameState === 'over' && result ? (
      <ArcadeRunResult
        title={isBest ? 'New best' : 'Run over'}
        tone={isBest ? 'best' : 'neutral'}
        stats={[
          { label: 'walls', value: score, highlight: isBest },
          { label: 'best', value: Math.max(best ?? 0, score) },
        ]}
        reward={runResult.reward}
        achievements={runResult.achievements}
        saving={saving}
        error={submitError}
        guest={guestRun}
        actions={<ArcadeRematchButton onClick={() => void startRun()} />}
      />
    ) : null;

  return (
    <GameShell
      game='ricochet'
      stat={<GameStat value={best} label='best' />}
      howTo={HOW_TO}
      below={
        <div className='flex flex-wrap items-center justify-center gap-2'>
          <GameLeaderboardButton onClick={() => setShowLeaderboard(true)} />
        </div>
      }
    >
      <GameStage
        phase={phase}
        hint={HINT}
        busy={busy ? 'Starting your run.' : null}
        onStart={() => void startRun()}
        aspect={RICOCHET_BASE_WIDTH / RICOCHET_BASE_HEIGHT}
        onSize={fitCanvas}
        end={end}
      >
        <div
          ref={shakeRef}
          className='ricochet-stage'
          onPointerDown={onPointerDown}
          role={gameState === 'playing' ? 'group' : undefined}
          aria-label={gameState === 'playing' ? 'Press space or tap to flap.' : undefined}
        >
          <canvas
            ref={canvasRef}
            width={Math.max(1, Math.floor(canvasSize.width * canvasSize.dpr))}
            height={Math.max(1, Math.floor(canvasSize.height * canvasSize.dpr))}
            style={{ width: canvasSize.width, height: canvasSize.height }}
            aria-hidden
          />
          <p ref={liveRef} className='sr-only' aria-live='polite' />
        </div>
        {gameState === 'playing' ? <ArcadeGameplayCallouts items={callouts} /> : null}
      </GameStage>

      <GameLeaderboardModal open={showLeaderboard} onOpenChange={setShowLeaderboard} title='ricochet board'>
        <GameLeaderboard
          gameType='ricochet'
          maxEntries={5}
          enableFullLeaderboardModal
          fullLeaderboardDisplay='inline'
          refreshKey={leaderboardRefreshKey}
        />
      </GameLeaderboardModal>
    </GameShell>
  );
}
