'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { ArcadeButton, ArcadeStub } from '@/features/arcade/components/ui/arcade-ui';
import { Num } from '@/features/arcade/components/ui/num';
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
  type TicketLine,
} from '@/features/arcade/components/results/arcade-run-result';
import { EnvMonitor } from '@/features/arcade/lib/game-anti-cheat';
import { gameCanvasDpr, getGame2dContext } from '@/features/arcade/lib/game-frame-loop';
import { SoundManager } from '@/features/arcade/lib/sound-manager';
import { findEquippedSkinSet } from '@/features/arcade/lib/skins/skin-set';
import { isControlTarget } from '@/features/arcade/lib/use-first-input';
import {
  useFeelReducedMotion,
  useGameFeedback,
  usePitchLadder,
} from '@/features/arcade/lib/use-game-feedback';
import { useArcadeRunResult, wantedRunTickets } from '@/features/arcade/lib/run-result';
import {
  STACKER_END_HOLD_MS,
  STACKER_MAJOR_ROW,
  STACKER_MAJOR_TICKETS,
  STACKER_MINOR_ROW,
  STACKER_MINOR_TICKETS,
  STACKER_ROWS,
  stackerDisplayLeadMs,
  stackerGlideLeft,
  stackerInputMs,
  stackerLayout,
  stackerPress,
  stackerRowStart,
  stackerView,
  type StackerLayout,
  type StackerRowResult,
  type StackerState,
} from '@/server/arcade/stack-cabinet-engine';

import {
  STACKER_COLORS,
  chaseDurationMs,
  drawStacker,
  fallingLampAt,
  rowCentreY,
  shatterLamp,
  stackerGeometry,
  SHARD_MS,
  type FallingLamp,
  type RowPulse,
  type Shard,
  type StackerGeometry,
  type TowerChase,
} from './_stacker-cabinet-draw';
import { buildStackSkinLook, type StackSkinLook } from './_stack-skin-draw';
import './_stacker-cabinet.css';

/* Stacker's cabinet mode. A row of lamps sweeps across a 7 by 15 grid;
   press to stop it on the row below. The rules, the clock and the prizes
   live in src/server/arcade/stack-cabinet-engine.ts, which the score route
   replays. This file draws and listens.

   Input: a stop is the input event's own timestamp, never the frame or the
   handler's time, so a 30 Hz and a 144 Hz screen score the same press the
   same. Every press answers in the same frame: a haptic tap, then the
   thunk and the row's pulse when it stops a row. */

const HINT: GameHint = { touch: 'Tap to light the row.', pointer: 'Press space or click to light the row.' };
const HOW_TO: GameHowTo = {
  lines: [
    'Stop the moving row on top of the one below.',
    'Lamps that miss the row below fall off, and each row is faster.',
    `Row ${STACKER_MINOR_ROW} pays ${STACKER_MINOR_TICKETS} tickets, and row ${STACKER_MAJOR_ROW} pays ${STACKER_MAJOR_TICKETS}.`,
  ],
  picture: <HowToPicture />,
};

const SESSION_MAX_AGE_MS = 30 * 60 * 1000;

type GameState = 'idle' | 'playing' | 'over' | 'error';

type PreparedRun =
  | { ok: true; guest: boolean; token: string | null; sessionId: string | null; seed: number; fetchedAt: number }
  | { ok: false; status: number; error: string; banned: boolean; retryAfterSec: number | null };

const getSubmitErrorMessage = (
  status: number,
  data: { error?: string; details?: string; retryAfterSec?: number } | null,
) => {
  if (status === 429) {
    const retry = typeof data?.retryAfterSec === 'number' ? ` Try again in ${data.retryAfterSec}s.` : '';
    return `${data?.error ?? 'Too many runs.'}${retry}`;
  }
  if (typeof data?.error === 'string' && data.error.trim()) return data.error;
  return 'Could not save your run. Try again.';
};

/** The session route's 403: banned. Plain, with the time left when there is one. */
const banMessage = (data: { retryAfterSec?: number; isIndefinite?: boolean } | null) => {
  if (data?.isIndefinite) return 'You are banned until an admin lifts it.';
  const sec = data?.retryAfterSec;
  if (typeof sec !== 'number') return 'You are banned from games.';
  const total = Math.max(0, Math.floor(sec));
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `Ban ends in ${pad(Math.floor(total / 3600))}:${pad(Math.floor((total % 3600) / 60))}:${pad(total % 60)}.`;
};

const randomSeed = () => {
  const buffer = new Uint32Array(1);
  crypto.getRandomValues(buffer);
  return buffer[0] % 2 ** 31;
};

/** Pointer and key events carry epoch or timeOrigin stamps depending on the
 *  browser; put them on the performance.now() clock. */
const eventTime = (timeStamp: number) => {
  if (!Number.isFinite(timeStamp) || timeStamp <= 0) return performance.now();
  return timeStamp > 1e12 ? timeStamp - performance.timeOrigin : timeStamp;
};

const STAMP_TIMEOUT_MS = 5000;
const stampStart = async (sessionId: string | null) => {
  if (!sessionId) return false;
  try {
    const response = await fetch('/api/games/session', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, action: 'start' }),
      signal: AbortSignal.timeout(STAMP_TIMEOUT_MS),
    });
    return response.ok;
  } catch {
    return false;
  }
};

declare global {
  interface Window {
    /** ?arcadePerf=1 in development only: the run's clock and seed, for QA. */
    __stackerRun?: { runStart: number; seed: number; stops: () => number[] };
  }
}

export default function StackerCabinetClient({
  modeSwitch,
}: {
  modeSwitch?: (locked: boolean) => ReactNode;
}) {
  const reducedMotion = useFeelReducedMotion();
  const shakeRef = useRef<HTMLDivElement>(null);
  const { trigger, hitStopClock } = useGameFeedback({ stage: shakeRef });
  const ladder = usePitchLadder();
  const { result: runResult, capture: captureRunResult, reset: resetRunResult } = useArcadeRunResult();

  const [gameState, setGameState] = useState<GameState>('idle');
  const [geometry, setGeometry] = useState<StackerGeometry | null>(null);
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0, dpr: 1 });
  const [layout, setLayout] = useState<StackerLayout | null>(null);
  const [run, setRun] = useState<StackerState | null>(null);
  const [streak, setStreak] = useState(0);
  const [banked, setBanked] = useState<{ minor: number | null; major: number | null }>({ minor: null, major: null });
  const [best, setBest] = useState<number | null>(null);
  const [previousBest, setPreviousBest] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const [banned, setBanned] = useState(false);
  const [guestRun, setGuestRun] = useState(false);
  const [announce, setAnnounce] = useState('');

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const geometryRef = useRef<StackerGeometry | null>(null);
  const layoutRef = useRef<StackerLayout | null>(null);
  const stopsRef = useRef<number[]>([]);
  const runStartRef = useRef(0);
  const liveRef = useRef(false);
  const gameStateRef = useRef<GameState>('idle');
  const runRef = useRef<Extract<PreparedRun, { ok: true }> | null>(null);
  const preparingRef = useRef<Promise<PreparedRun> | null>(null);
  const startingRef = useRef(false);
  const envMonitorRef = useRef<EnvMonitor | null>(null);
  const reducedRef = useRef(reducedMotion);
  const frameRef = useRef(0);
  const rafAtRef = useRef(0);
  const frameIntervalRef = useRef(1000 / 60);
  const lastFrameRef = useRef(0);
  const effectNowRef = useRef(0);
  const endTimerRef = useRef<number | null>(null);
  const perfRef = useRef(false);

  // Render-only effects (never read by the engine).
  const fallingRef = useRef<FallingLamp[]>([]);
  const shardsRef = useRef<Shard[]>([]);
  const pulseRef = useRef<RowPulse | null>(null);
  const chaseRef = useRef<TowerChase | null>(null);
  const missedRef = useRef(false);
  const bankedRef = useRef({ minor: false, major: false });
  const effectsUntilRef = useRef(0);

  useEffect(() => {
    reducedRef.current = reducedMotion;
  }, [reducedMotion]);

  // The equipped skin set (SKINS.md), if any. It changes how the cabinet looks
  // and sounds, never a rule, a clock or a row's speed.
  const [skin, setSkin] = useState<StackSkinLook | null>(null);
  const skinRef = useRef<StackSkinLook | null>(null);
  skinRef.current = skin;
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch('/api/store/inventory?gameType=stack', { cache: 'no-store' });
        if (!response.ok || cancelled) return;
        const payload = (await response.json()) as {
          equipped?: Array<{ item?: { assetRef?: Record<string, unknown> | null } | null }>;
        };
        const set = findEquippedSkinSet(payload.equipped, 'stack');
        if (!cancelled) setSkin(set ? buildStackSkinLook(set) : null);
      } catch {
        /* the house cabinet */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  const skinSound = skin?.sound ?? 'house';
  useEffect(() => {
    SoundManager.setTint(skinSound);
    return () => SoundManager.setTint('house');
  }, [skinSound]);

  useEffect(() => {
    perfRef.current = new URLSearchParams(window.location.search).get('arcadePerf') === '1';
  }, []);

  const setState = useCallback((next: GameState) => {
    gameStateRef.current = next;
    setGameState(next);
  }, []);

  // ── Session: fetched ahead, so the first press starts at once ──────────
  const prepareRun = useCallback((): Promise<PreparedRun> => {
    if (preparingRef.current) return preparingRef.current;
    const promise = (async (): Promise<PreparedRun> => {
      try {
        const response = await fetch('/api/games/session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ gameType: 'stack-cabinet' }),
        });
        if (response.ok) {
          const data = (await response.json()) as { token?: string; sessionId?: string; stackCabinetSeed?: number };
          if (
            typeof data.token !== 'string' ||
            typeof data.sessionId !== 'string' ||
            typeof data.stackCabinetSeed !== 'number'
          ) {
            return { ok: false, status: 500, error: 'Could not start your run. Try again.', banned: false, retryAfterSec: null };
          }
          return {
            ok: true,
            guest: false,
            token: data.token,
            sessionId: data.sessionId,
            seed: data.stackCabinetSeed,
            fetchedAt: Date.now(),
          };
        }
        if (response.status === 401) {
          // Signed out: a local seed, nothing saved.
          return { ok: true, guest: true, token: null, sessionId: null, seed: randomSeed(), fetchedAt: Date.now() };
        }
        const data = (await response.json().catch(() => null)) as
          | { error?: string; retryAfterSec?: number; isIndefinite?: boolean }
          | null;
        return {
          ok: false,
          status: response.status,
          error: response.status === 403 ? banMessage(data) : getSubmitErrorMessage(response.status, data),
          banned: response.status === 403,
          retryAfterSec: typeof data?.retryAfterSec === 'number' ? data.retryAfterSec : null,
        };
      } catch {
        return { ok: false, status: 0, error: 'Could not reach the server. Try again.', banned: false, retryAfterSec: null };
      }
    })();
    preparingRef.current = promise;
    void promise.then((prepared) => {
      if (preparingRef.current !== promise) return;
      if (!prepared.ok) {
        preparingRef.current = null;
        return;
      }
      // Show the real first row before the first press.
      if (!liveRef.current && gameStateRef.current === 'idle') {
        const next = stackerLayout(prepared.seed);
        layoutRef.current = next;
        setLayout(next);
      }
    });
    return promise;
  }, []);

  const fetchBest = useCallback(async () => {
    try {
      const response = await fetch('/api/games/stack-cabinet/score', { cache: 'no-store' });
      if (!response.ok) return;
      const data = (await response.json()) as { bestScore?: number };
      if (typeof data.bestScore === 'number') setBest(data.bestScore);
    } catch {
      /* the strip shows nothing */
    }
  }, []);

  useEffect(() => {
    void prepareRun();
    void fetchBest();
    envMonitorRef.current = new EnvMonitor();
  }, [fetchBest, prepareRun]);

  // ── Drawing ─────────────────────────────────────────────────────────────
  const paint = useCallback(
    (now: number) => {
      const canvas = canvasRef.current;
      const g = geometryRef.current;
      if (!canvas || !g) return;
      const ctx = getGame2dContext(canvas, { alpha: false });
      if (!ctx) return;
      const dpr = canvas.width / Math.max(1, g.width);
      // Effects run on their own clock, which stands still through a hit-stop.
      const last = lastFrameRef.current || now;
      effectNowRef.current += Math.max(0, now - last - hitStopClock.frozenWithin(last, now));
      lastFrameRef.current = now;
      const effectNow = effectNowRef.current;

      const current = layoutRef.current;
      const started = liveRef.current || stopsRef.current.length > 0;
      // Drawn for when this frame reaches the screen, about one frame
      // interval from now, so the row on screen matches the clock a press
      // is stamped with on every refresh rate.
      const runMs = started ? now - runStartRef.current + stackerDisplayLeadMs(frameIntervalRef.current) : 0;
      const view = current ? stackerView(current, stopsRef.current, runMs) : null;
      if (perfRef.current && current && view?.moving && view.phase === 'move') {
        // ?arcadePerf=1: every frame's drawn row and the lamp a stop would light.
        const w = window as unknown as { __stackerFrames?: number[][] };
        const frames = (w.__stackerFrames ??= []);
        if (frames.length < 20000) {
          const glide = stackerGlideLeft(current, view.row, view.moving.width, runMs - view.rowStartMs);
          frames.push([now, runMs, view.row, glide, view.moving.left]);
        }
      }

      // Lamps that reach the floor break: a crack, pieces, a small shake.
      let landed = 0;
      for (const lamp of fallingRef.current) {
        if (lamp.landed) continue;
        const at = fallingLampAt(g, lamp, effectNow - lamp.t0);
        if (at.landed) {
          lamp.landed = true;
          landed += 1;
          shardsRef.current.push(...shatterLamp(g, at.x, at.y, lamp.color, effectNow, skinRef.current?.hot));
        }
      }
      if (landed > 0) {
        SoundManager.play('stackerShatter');
        trigger('impact', { motion: false, sound: false, shake: Math.min(1, 0.25 + landed * 0.2) });
      }
      fallingRef.current = fallingRef.current.filter((lamp) => !lamp.landed);
      shardsRef.current = shardsRef.current.filter((shard) => effectNow - shard.t0 < SHARD_MS);

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawStacker(ctx, g, {
        layout: current,
        view,
        runMs,
        now: effectNow,
        falling: fallingRef.current,
        shards: shardsRef.current,
        pulse: pulseRef.current,
        chase: chaseRef.current,
        minorBanked: bankedRef.current.minor,
        majorBanked: bankedRef.current.major,
        missed: missedRef.current,
        reducedMotion: reducedRef.current,
        dpr,
        skin: skinRef.current,
      });
    },
    [hitStopClock, trigger],
  );

  const loop = useCallback(
    (now: number) => {
      const previous = rafAtRef.current;
      rafAtRef.current = now;
      if (previous > 0 && now - previous > 0 && now - previous < 100) {
        frameIntervalRef.current = frameIntervalRef.current * 0.8 + (now - previous) * 0.2;
      }
      paint(now);
      const effectsRunning =
        fallingRef.current.length > 0 ||
        shardsRef.current.length > 0 ||
        effectNowRef.current < effectsUntilRef.current;
      if (gameStateRef.current === 'playing' || effectsRunning) {
        frameRef.current = requestAnimationFrame(loop);
      } else {
        frameRef.current = 0;
      }
    },
    [paint],
  );

  const ensureLoop = useCallback(() => {
    if (frameRef.current) return;
    lastFrameRef.current = 0;
    rafAtRef.current = 0;
    frameRef.current = requestAnimationFrame(loop);
  }, [loop]);

  useEffect(
    () => () => {
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
      if (endTimerRef.current) window.clearTimeout(endTimerRef.current);
    },
    [],
  );

  const fitCanvas = useCallback(({ width, height }: GameStageSize) => {
    const g = stackerGeometry(width, height);
    geometryRef.current = g;
    setGeometry(g);
    setCanvasSize({ width, height, dpr: gameCanvasDpr(width, height) });
  }, []);

  // Repaint when anything a still frame shows changes.
  useEffect(() => {
    if (gameStateRef.current !== 'playing') paint(performance.now());
  }, [canvasSize, layout, reducedMotion, skin, paint]);

  // ── Saving ──────────────────────────────────────────────────────────────
  const saveRun = useCallback(
    async (prepared: Extract<PreparedRun, { ok: true }>, stops: number[], rows: number) => {
      if (prepared.guest || !prepared.token) {
        setBest((prev) => Math.max(prev ?? 0, rows));
        return;
      }
      envMonitorRef.current?.stop();
      setSaving(true);
      setSubmitError(null);
      try {
        const response = await fetch('/api/games/stack-cabinet/score', {
          method: 'POST',
          keepalive: true,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            score: rows,
            sessionToken: prepared.token,
            stops,
            env: envMonitorRef.current?.getFingerprint(),
          }),
        });
        const data = (await response.json().catch(() => null)) as Record<string, unknown> | null;
        if (!response.ok) {
          const err = data as { error?: string; details?: string; retryAfterSec?: number } | null;
          console.error(`[stacker] run rejected (${response.status}): ${err?.details ?? err?.error ?? ''}`);
          setSubmitError(getSubmitErrorMessage(response.status, err));
          return;
        }
        captureRunResult(data);
        setBest((prev) => Math.max(prev ?? 0, rows));
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

  const finishRun = useCallback(
    (state: StackerState) => {
      liveRef.current = false;
      const prepared = runRef.current;
      runRef.current = null;
      if (prepared) void saveRun(prepared, stopsRef.current.slice(), state.rows);
      const hold = state.rows >= STACKER_MAJOR_ROW ? STACKER_END_HOLD_MS + 500 : STACKER_END_HOLD_MS;
      endTimerRef.current = window.setTimeout(() => {
        endTimerRef.current = null;
        setState('over');
        void prepareRun();
      }, hold);
    },
    [prepareRun, saveRun, setState],
  );

  // ── A stop's feedback (render and sound only; the engine already decided) ──
  const landStop = useCallback(
    (result: StackerRowResult, state: StackerState) => {
      const g = geometryRef.current;
      const now = effectNowRef.current;
      const reduced = reducedRef.current;
      const { moving, placed } = result;
      // Where the gliding row was drawn at the stop, in lamps from its
      // sockets (never more than half a lamp). It settles in from there.
      const layout = layoutRef.current;
      const fromDx =
        layout && !reduced
          ? stackerGlideLeft(layout, result.row, moving.width, result.stopMs - stackerRowStart(stopsRef.current, result.row)) -
            moving.left
          : 0;

      // Lost lamps fall off, away from the tower, and break on the floor.
      const lostCols: number[] = [];
      for (let c = moving.left; c < moving.left + moving.width; c += 1) {
        if (!placed || c < placed.left || c >= placed.left + placed.width) lostCols.push(c);
      }
      if (lostCols.length > 0) {
        if (reduced || !g) {
          // Under reduced motion they vanish. The crack still sounds.
          SoundManager.play('stackerShatter');
        } else {
          const centre = placed ? placed.left + placed.width / 2 : moving.left + moving.width / 2;
          for (const col of lostCols) {
            const side = col + 0.5 < centre ? -1 : 1;
            fallingRef.current.push({
              col: col + fromDx,
              row: result.row,
              color: skinRef.current?.blockAlt ?? STACKER_COLORS.red,
              t0: now,
              drift: side * (0.6 + Math.random() * 0.8),
              spin: side * (2 + Math.random() * 3),
              landed: false,
            });
          }
        }
      }

      if (!placed) {
        // A miss: the row drops, the tower dims, the ladder resets.
        missedRef.current = true;
        ladder.reset();
        setStreak(0);
        SoundManager.play('stackMiss');
        trigger('loss', { motion: false, sound: false, haptic: true });
        return;
      }

      // Every stop that places a row: the thunk, a tick, the row pulses.
      SoundManager.play('stackerThunk');
      pulseRef.current = { row: result.row, left: placed.left, width: placed.width, t0: now, perfect: result.perfect, fromDx };
      effectsUntilRef.current = Math.max(effectsUntilRef.current, now + 400);
      if (result.perfect) {
        // A perfect stop flashes white-hot, throws a ring and climbs a semitone.
        trigger('combo', { motion: false, sound: false, haptic: true });
        SoundManager.play('stackPerfect', { pitch: ladder.next() });
        setStreak((s) => s + 1);
      } else {
        trigger('collect', { motion: false, sound: false, haptic: true });
        if (result.row > 0) {
          ladder.reset();
          setStreak(0);
        }
      }

      if (state.rows === STACKER_MINOR_ROW) {
        // Row 11: the minor is banked. A band of light runs up the tower,
        // the marks go amber, the stub pops.
        bankedRef.current.minor = true;
        setBanked((b) => ({ ...b, minor: now }));
        chaseRef.current = { t0: now + 60, rows: STACKER_MINOR_ROW, laps: 1, color: skinRef.current?.hot ?? STACKER_COLORS.hot };
        effectsUntilRef.current = Math.max(effectsUntilRef.current, now + 60 + chaseDurationMs(chaseRef.current));
        trigger('round-win', { motion: false, haptic: true });
      }
      if (state.rows === STACKER_MAJOR_ROW) {
        // Row 15: the one hit-stop in the game, then the tower chases twice.
        bankedRef.current.major = true;
        setBanked((b) => ({ ...b, major: now }));
        chaseRef.current = { t0: now + 80, rows: STACKER_ROWS, laps: 2, color: skinRef.current?.hot ?? STACKER_COLORS.hot };
        effectsUntilRef.current = Math.max(effectsUntilRef.current, now + 80 + chaseDurationMs(chaseRef.current));
        trigger('jackpot', { motion: false, haptic: true, hitStop: true });
      }
    },
    [ladder, trigger],
  );

  /** A press during a run, at the event's own time. */
  const handleStop = useCallback(
    (timeStamp: number) => {
      // Answer first: a haptic tap, before anything is decided.
      trigger('press', { sound: false, haptic: true });
      const current = layoutRef.current;
      if (!liveRef.current || !current) return;
      const at = stackerInputMs(eventTime(timeStamp), runStartRef.current);
      const press = stackerPress(current, stopsRef.current, at);
      if (press.kind !== 'stop') {
        // Between rows: a soft click, so the press is never silent.
        SoundManager.play('typingThock', { pitch: 0.6 });
        return;
      }
      stopsRef.current = [...stopsRef.current, at];
      const { result, state } = press;
      landStop(result, state);
      // Paint now; this frame shows the stop with the press.
      paint(performance.now());
      setRun(state);
      setAnnounce(
        result.placed
          ? `Row ${result.row + 1}${result.perfect ? ', perfect' : result.lost > 0 ? `, ${result.lost} lost` : ''}.${
              state.rows === STACKER_MINOR_ROW ? ` Row ${STACKER_MINOR_ROW} pays ${STACKER_MINOR_TICKETS} tickets.` : ''
            }${state.rows === STACKER_MAJOR_ROW ? ` Row ${STACKER_MAJOR_ROW} pays ${STACKER_MAJOR_TICKETS} tickets.` : ''}`
          : `Missed row ${result.row + 1}.`,
      );
      if (state.over) finishRun(state);
    },
    [finishRun, landStop, paint, trigger],
  );

  // ── Starting a run ──────────────────────────────────────────────────────
  const startRun = useCallback(async () => {
    if (startingRef.current || liveRef.current) return;
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
      preparingRef.current = null;
      setBusy(true);
      prepared = await prepareRun();
    }
    preparingRef.current = null;

    // The server stamps the start before the clock starts, so it can bound
    // the run from both ends. A failed or timed-out stamp gets a fresh
    // session, never a second stamp.
    if (prepared.ok && !prepared.guest) {
      setBusy(true);
      let stamped = await stampStart(prepared.sessionId);
      if (!stamped) {
        preparingRef.current = null;
        const fresh = await prepareRun();
        preparingRef.current = null;
        prepared = fresh;
        stamped = fresh.ok && !fresh.guest ? await stampStart(fresh.sessionId) : fresh.ok;
      }
      if (prepared.ok && !stamped) {
        prepared = { ok: false, status: 0, error: 'Could not start your run. Try again.', banned: false, retryAfterSec: null };
      }
    }
    setBusy(false);
    startingRef.current = false;

    if (prepared.ok === false) {
      const failed = prepared as Extract<PreparedRun, { ok: false }>;
      setStartError(failed.error);
      setBanned(failed.banned);
      setState('error');
      return;
    }

    runRef.current = prepared;
    const next = stackerLayout(prepared.seed);
    layoutRef.current = next;
    setLayout(next);
    stopsRef.current = [];
    setRun(null);
    setStreak(0);
    setBanked({ minor: null, major: null });
    bankedRef.current = { minor: false, major: false };
    fallingRef.current = [];
    shardsRef.current = [];
    pulseRef.current = null;
    chaseRef.current = null;
    missedRef.current = false;
    setGuestRun(prepared.guest);
    setPreviousBest(best);
    ladder.reset();
    if (!prepared.guest) envMonitorRef.current?.start();
    runStartRef.current = performance.now();
    if (process.env.NODE_ENV !== 'production' && perfRef.current) {
      window.__stackerRun = { runStart: runStartRef.current, seed: prepared.seed, stops: () => stopsRef.current.slice() };
    }
    liveRef.current = true;
    setState('playing');
    ensureLoop();
  }, [best, ensureLoop, ladder, prepareRun, resetRunResult, setState, trigger]);

  // ── Input during a run ──────────────────────────────────────────────────
  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (gameStateRef.current !== 'playing') return;
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      event.preventDefault();
      handleStop(event.timeStamp);
    },
    [handleStop],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (gameStateRef.current !== 'playing') return;
      if (event.code !== 'Space' && event.code !== 'Enter' && event.code !== 'ArrowUp') return;
      if (isControlTarget(event.target)) return;
      event.preventDefault();
      if (event.repeat) return;
      handleStop(event.timeStamp);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleStop]);

  // ── The result ──────────────────────────────────────────────────────────
  const rows = run?.rows ?? 0;
  const perfects = run?.perfects ?? 0;
  const isBest = gameState === 'over' && rows > 0 && rows > (previousBest ?? 0);
  const wanted = wantedRunTickets(runResult.reward);
  const ticketLines = useMemo<TicketLine[] | undefined>(() => {
    if (wanted <= 0 || rows < STACKER_MINOR_ROW) return undefined;
    return [{ label: rows >= STACKER_MAJOR_ROW ? `row ${STACKER_MAJOR_ROW}` : `row ${STACKER_MINOR_ROW}`, tickets: wanted }];
  }, [rows, wanted]);

  const phase: GamePhase = gameState === 'idle' ? 'ready' : gameState === 'playing' ? 'playing' : 'over';
  const title =
    rows >= STACKER_MAJOR_ROW ? 'Major prize' : rows >= STACKER_MINOR_ROW ? 'Minor prize' : isBest ? 'New best' : 'Run over';

  const end =
    gameState === 'over' ? (
      <ArcadeRunResult
        title={title}
        tone={rows >= STACKER_MINOR_ROW ? 'win' : isBest ? 'best' : 'neutral'}
        stats={[
          { label: 'rows', value: rows, highlight: rows >= STACKER_MINOR_ROW || isBest },
          { label: 'perfect rows', value: perfects },
          { label: 'best', value: Math.max(best ?? 0, rows) },
        ]}
        reward={runResult.reward}
        achievements={runResult.achievements}
        saving={saving}
        error={submitError}
        guest={guestRun}
        ticketLines={ticketLines}
        actions={<ArcadeRematchButton onClick={() => void startRun()} />}
      />
    ) : gameState === 'error' ? (
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
    ) : null;

  const g = geometry;
  const shownRow = Math.min(STACKER_ROWS, (run?.results.length ?? 0) + 1);

  return (
    <GameShell
      game='stack'
      stat={<GameStat value={best == null ? null : `${best}/${STACKER_ROWS}`} label='best' />}
      modes={modeSwitch?.(gameState === 'playing')}
      howTo={HOW_TO}
    >
      <GameStage
        phase={phase}
        hint={HINT}
        busy={busy ? 'Starting your run.' : null}
        onStart={() => void startRun()}
        onSize={fitCanvas}
        end={end}
      >
        <div
          ref={shakeRef}
          className='stc-stage'
          onPointerDown={onPointerDown}
          data-reduced={reducedMotion || undefined}
          role={gameState === 'playing' ? 'group' : undefined}
          aria-label={
            gameState === 'playing' ? `Row ${shownRow} of ${STACKER_ROWS}. Press space or tap to stop the row.` : undefined
          }
        >
          <canvas
            ref={canvasRef}
            width={Math.max(1, Math.floor(canvasSize.width * canvasSize.dpr))}
            height={Math.max(1, Math.floor(canvasSize.height * canvasSize.dpr))}
            style={{ width: canvasSize.width, height: canvasSize.height }}
            aria-hidden
          />
          {g ? (
            <>
              <div className='stc-callout' style={{ top: g.hudTop, height: g.hudH }} aria-hidden>
                {streak >= 2 && gameState === 'playing' ? (
                  <span key={streak} className='stc-perfect'>
                    perfect <span className='stc-times'>×</span>
                    <Num value={streak} />
                  </span>
                ) : null}
              </div>
              {(
                [
                  [STACKER_MAJOR_ROW, STACKER_MAJOR_TICKETS, banked.major],
                  [STACKER_MINOR_ROW, STACKER_MINOR_TICKETS, banked.minor],
                ] as const
              ).map(([row, tickets, at]) => (
                <div
                  key={row}
                  className='stc-prize'
                  data-banked={at != null || undefined}
                  style={{ left: g.stubX, top: rowCentreY(g, row - 1) }}
                >
                  <ArcadeStub size='sm' key={at ?? 'idle'} aria-label={`row ${row} pays ${tickets} tickets`}>
                    <Num value={tickets} />
                  </ArcadeStub>
                </div>
              ))}
            </>
          ) : null}
          <p className='sr-only' aria-live='polite'>
            {announce}
          </p>
        </div>
      </GameStage>
    </GameShell>
  );
}

/** The ? sheet's picture: the cabinet with a tower, the red row and the
 *  two prize rows. */
function HowToPicture() {
  const lit: Record<number, [number, number]> = { 1: [2, 4], 2: [2, 4], 3: [3, 5], 4: [3, 4], 5: [3, 4], 6: [3, 3] };
  const cells = [];
  for (let row = 15; row >= 1; row -= 1) {
    for (let c = 0; c < 7; c += 1) {
      const span = lit[row];
      const on = span && c >= span[0] && c <= span[1];
      const red = row === 7 && c >= 1 && c <= 2;
      cells.push(
        <rect
          key={`${row}-${c}`}
          x={60 + c * 6}
          y={4 + (15 - row) * 6}
          width='5'
          height='5'
          rx='1'
          fill={red ? STACKER_COLORS.red : on ? STACKER_COLORS.amber : STACKER_COLORS.unlit}
        />,
      );
    }
  }
  return (
    <svg viewBox='0 0 160 100' width={320} height={200} role='img' aria-label='The cabinet: a tower of amber lamps, the red row moving above it, and marks at rows 11 and 15.'>
      <rect width='160' height='100' fill={STACKER_COLORS.screen} />
      {cells}
      {[11, 15].map((row) => (
        <path key={row} d={`M55,${6.5 + (15 - row) * 6} H58 M103,${6.5 + (15 - row) * 6} H106`} stroke={STACKER_COLORS.lit} strokeWidth='1' />
      ))}
    </svg>
  );
}
