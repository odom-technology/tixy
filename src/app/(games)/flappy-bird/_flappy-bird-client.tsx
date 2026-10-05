'use client';

/* Flappy bird, the tixy pass (docs/design/tixy-rebrand/FLAPPY.md).

   The run is _flappy-sim.ts stepped at 60 Hz by the shared frame loop and
   painted at the display's rate between steps. A tap sets a pending flap;
   the next step takes it and logs the tick it landed on. The first tap is
   tick 0. When the bird crashes the page posts those ticks, and the server
   plays them again from the session's seed (flappy-replay.ts): the score
   is what the replay passes.

   Everything else here is how it looks and answers: the flap's squash and
   wing beat, the tilt that follows the velocity, the gate bell on a pitch
   ladder, the near-miss whoosh, the crash's hit-stop, shake and fall. None
   of it reaches the sim. */

import { useCallback, useEffect, useRef, useState } from 'react';

import { renameGameNamesInText } from '@/features/arcade/lib/game-renames';
import { ArcadeButton } from '@/features/arcade/components/ui/arcade-ui';
import { GameLeaderboard } from '@/features/arcade/components/game-leaderboard';
import { GameInventoryModal } from '@/features/arcade/components/game-inventory-modal';
import { GameLeaderboardModal } from '@/features/arcade/components/game-leaderboard-modal';
import { GameInventoryButton } from '@/features/arcade/components/game-inventory-button';
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
import { ArcadeRematchButton, ArcadeRunResult } from '@/features/arcade/components/results/arcade-run-result';
import { ArcadeGameplayCallouts } from '@/features/arcade/components/gameplay/arcade-game-hud';
import { EnvMonitor } from '@/features/arcade/lib/game-anti-cheat';
import { SoundManager } from '@/features/arcade/lib/sound-manager';
import { useArcadeRunResult } from '@/features/arcade/lib/run-result';
import { useFeelReducedMotion, useGameFeedback } from '@/features/arcade/lib/use-game-feedback';
import { createPitchLadder, settleEase, squashAt } from '@/features/arcade/lib/game-feel';
import { useGameplayCallouts, useNewBestMoment } from '@/features/arcade/lib/use-gameplay-callouts';
import {
  createGameFrameLoop,
  gameCanvasDpr,
  getGame2dContext,
  lerp,
  type GameFrameLoop,
} from '@/features/arcade/lib/game-frame-loop';

import {
  FLAPPY_BIRD_RADIUS,
  FLAPPY_BIRD_X,
  FLAPPY_GRAVITY,
  FLAPPY_GROUND_Y,
  FLAPPY_HEIGHT,
  FLAPPY_PIPE_SPEED,
  FLAPPY_START_Y,
  FLAPPY_STEP_MS,
  FLAPPY_WIDTH,
  createFlappyState,
  stepFlappy,
  type FlappyState,
} from './_flappy-sim';
import { HOUSE_FLAPPY_LOOK, buildFlappyLook, type FlappyLook } from './_flappy-theme';
import {
  createFlappySprites,
  drawBackdrop,
  drawBird,
  drawGround,
  drawParticles,
  drawPipePair,
  drawScore,
  drawSpeedLines,
  type FlappySprites,
  type Particle,
} from './_flappy-draw';

import './_flappy-bird-midway.css';

// The shell's first-frame hint and ? sheet (docs/design/tixy-rebrand/SHELL.md).
const HINT: GameHint = { touch: 'Tap to flap.', pointer: 'Press space or click to flap.' };
const HOW_TO: GameHowTo = {
  lines: [
    'Each tap flaps the bird up, and it falls in between.',
    'Each gap you clear is a point, and a pipe, the ground or the ceiling ends the run.',
    '10 pipes pay 7 tickets, 50 pay 34, and 100 pay 56.',
  ],
};

/* ── feel (FLAPPY.md) ──────────────────────────────────────────────────── */

/** Tilt: up to 24° nose-up on a flap, down to 83° in a dive. */
const TILT_UP = -0.42;
const TILT_DOWN = 1.45;
/** Velocity (px a step) past which the bird is nose-down. */
const DIVE_AT = 11;
/** Tilt follows its target on an exponential: fast up, slower down. */
const TILT_UP_MS = 45;
const TILT_DOWN_MS = 120;
/** The wing's one beat on a flap: down in 90 ms, back up to glide by 260. */
const WING_UP = -0.7;
const WING_DOWN = 0.85;
const WING_GLIDE = -0.15;
const WING_DOWN_MS = 90;
const WING_BEAT_MS = 260;
/** Squash on a flap (the kit's landing squash at a lower force). */
const FLAP_SQUASH = { force: 0.5, durationMs: 200 } as const;
/** A pass with this little room (play px) is a near miss. */
const NEAR_MISS_PX = 8;
const NEAR_MISS_MS = 240;
/** The score punches when it changes. */
const SCORE_POP_MS = 200;
/** The crash: a white flash, then the fall (render only). */
const FLASH_MS = 110;
const FALL_GRAVITY = (FLAPPY_GRAVITY / (FLAPPY_STEP_MS * FLAPPY_STEP_MS)) * 1.15;
/** After the bird is down, the result shows. */
const SETTLE_MS = 360;
const REDUCED_SETTLE_MS = 300;
const LANDED_SQUASH = { force: 0.7, durationMs: 220 } as const;
/** Gates per bell ladder; the tenth plays the milestone and starts again. */
const LADDER_STEPS = 9;
const RESTART_GRACE_MS = 450;
/** A session fetched ahead is used if it is younger than this. */
const SESSION_FRESH_MS = 30 * 60 * 1000;

const getSubmitErrorMessage = (
  status: number,
  data: { error?: string; details?: string; retryAfterSec?: number } | null,
) => {
  if (status === 429) {
    const retry = typeof data?.retryAfterSec === 'number' ? ` Try again in ${data.retryAfterSec}s.` : '';
    return `${data?.error ?? 'Too many runs.'}${retry}`;
  }
  if (typeof data?.details === 'string' && data.details.trim()) return data.details;
  if (typeof data?.error === 'string' && data.error.trim()) return data.error;
  return 'Could not save your run. Try again.';
};

type InventoryResponse = {
  wallet?: { credits?: number };
  equipped?: Array<{ slot?: string; item?: { assetRef?: Record<string, unknown> | null } | null }>;
};

type SessionResult =
  | { kind: 'ok'; token: string; seed: number; at: number }
  | { kind: 'guest' }
  | { kind: 'error'; status: number; data: { error?: string; details?: string; retryAfterSec?: number; isIndefinite?: boolean } | null };

async function fetchSession(): Promise<SessionResult> {
  try {
    const response = await fetch('/api/games/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gameType: 'flappy-bird' }),
    });
    if (response.status === 401) return { kind: 'guest' };
    const data = await response.json().catch(() => null);
    if (!response.ok) return { kind: 'error', status: response.status, data };
    if (typeof data?.token !== 'string' || typeof data?.flappySeed !== 'number') {
      return { kind: 'error', status: 500, data: { error: 'Could not start your run. Try again.' } };
    }
    return { kind: 'ok', token: data.token, seed: data.flappySeed, at: Date.now() };
  } catch {
    return { kind: 'error', status: 0, data: { error: 'Could not reach the server. Try again.' } };
  }
}

/** Render-only state for one run: what the player sees, never the sim. */
type RunView = {
  /** performance.now() of the first flap. */
  startedAt: number;
  lastFlapAt: number;
  tilt: number;
  scorePopAt: number;
  nearMissAt: number;
  nearMissPipe: number;
  /** The crash, once it happens. */
  deathAt: number | null;
  deathY: number;
  deathVy: number;
  deathTilt: number;
  /** When the fall reached the boards. */
  landedAt: number | null;
  particles: Particle[];
  trailAt: number;
};

const newRunView = (now: number): RunView => ({
  startedAt: now,
  lastFlapAt: now,
  tilt: 0,
  scorePopAt: -Infinity,
  nearMissAt: -Infinity,
  nearMissPipe: -1,
  deathAt: null,
  deathY: FLAPPY_START_Y,
  deathVy: 0,
  deathTilt: 0,
  landedAt: null,
  particles: [],
  trailAt: -Infinity,
});

export default function FlappyBirdClient() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [gameState, setGameState] = useState<'ready' | 'playing' | 'gameover' | 'error'>('ready');
  const [score, setScore] = useState(0);
  const [highScore, setHighScore] = useState(0);
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const [showInventory, setShowInventory] = useState(false);
  const [look, setLook] = useState<FlappyLook>(HOUSE_FLAPPY_LOOK);
  const [walletBalances, setWalletBalances] = useState({ credits: 0 });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [resultIsGuest, setResultIsGuest] = useState(false);
  const { reward: runReward, achievements: runAchievements, capture: captureRunResult, reset: resetRunResult } =
    useArcadeRunResult();
  const [startError, setStartError] = useState<string | null>(null);
  const [isStartingSession, setIsStartingSession] = useState(false);
  const [banUntilMs, setBanUntilMs] = useState<number | null>(null);
  const [banIndefinite, setBanIndefinite] = useState(false);
  const [banNowMs, setBanNowMs] = useState(Date.now());
  const [leaderboardRefreshKey, setLeaderboardRefreshKey] = useState(0);
  const { items: gameplayCallouts, push: pushGameplayCallout, clear: clearGameplayCallouts } = useGameplayCallouts();
  const newBest = useNewBestMoment(pushGameplayCallout, { unit: 'pipes' });
  const { trigger, hitStopClock, shakeOffset } = useGameFeedback();
  const [canvasSize, setCanvasSize] = useState({ width: FLAPPY_WIDTH, height: FLAPPY_HEIGHT, dpr: 1 });

  const gameStateRef = useRef(gameState);
  gameStateRef.current = gameState;
  const lookRef = useRef(look);
  lookRef.current = look;
  const highScoreRef = useRef(0);
  highScoreRef.current = highScore;
  const reducedMotion = useFeelReducedMotion();
  const reducedRef = useRef(reducedMotion);
  reducedRef.current = reducedMotion;

  const scaleRef = useRef(1);
  const spritesRef = useRef<FlappySprites | null>(null);
  const frameLoopRef = useRef<GameFrameLoop | null>(null);
  const envMonitorRef = useRef(new EnvMonitor());
  const bestScoreLoadedRef = useRef(false);

  // The run.
  const simRef = useRef<FlappyState | null>(null);
  const flapLogRef = useRef<number[]>([]);
  const pendingFlapRef = useRef(false);
  const viewRef = useRef<RunView>(newRunView(0));
  const prevRef = useRef({ y: FLAPPY_START_Y, velocity: 0, tick: 0, pipes: new Map<number, number>() });
  const sessionTokenRef = useRef<string | null>(null);
  const isGuestRunRef = useRef(false);
  const bestAtRunStartRef = useRef(0);
  const ladderRef = useRef(createPitchLadder({ maxSteps: LADDER_STEPS }));
  const gameOverAtRef = useRef(0);
  const startingRef = useRef(false);
  /** Paint durations, kept only for the QA hook (?flappyQa). */
  const qaPaintRef = useRef<number[] | null>(null);

  // The session for the next run, fetched ahead so the first tap flies.
  const sessionAheadRef = useRef<Promise<SessionResult> | null>(null);
  const sessionReadyRef = useRef<SessionResult | null>(null);

  const prefetchSession = useCallback(() => {
    if (sessionAheadRef.current) return;
    sessionReadyRef.current = null;
    const pending = fetchSession();
    sessionAheadRef.current = pending;
    void pending.then((result) => {
      if (sessionAheadRef.current === pending) sessionReadyRef.current = result;
    });
  }, []);

  const takeSession = useCallback(async (): Promise<SessionResult> => {
    const pending = sessionAheadRef.current ?? fetchSession();
    sessionAheadRef.current = null;
    sessionReadyRef.current = null;
    const result = await pending;
    if (result.kind === 'ok' && Date.now() - result.at > SESSION_FRESH_MS) return fetchSession();
    if (result.kind === 'error') return fetchSession();
    return result;
  }, []);

  /* ── painting ───────────────────────────────────────────────────────── */

  const ensureSprites = useCallback(() => {
    const scale = scaleRef.current;
    const current = spritesRef.current;
    if (current && current.scale === scale && current.look === lookRef.current) return current;
    spritesRef.current = createFlappySprites(lookRef.current, scale);
    return spritesRef.current;
  }, []);

  /** Wing angle for a beat that started `since` ms ago. */
  const wingAt = useCallback((since: number, alive: boolean) => {
    if (!alive) return WING_GLIDE;
    if (reducedRef.current) return since < WING_DOWN_MS ? WING_DOWN : WING_GLIDE;
    if (since < 0) return WING_GLIDE;
    if (since < WING_DOWN_MS) return lerp(WING_UP, WING_DOWN, settleEase(since / WING_DOWN_MS));
    if (since < WING_BEAT_MS) return lerp(WING_DOWN, WING_GLIDE, settleEase((since - WING_DOWN_MS) / (WING_BEAT_MS - WING_DOWN_MS)));
    return WING_GLIDE;
  }, []);

  const paint = useCallback(
    (alpha: number, now: number, dt: number) => {
      const canvas = canvasRef.current;
      const ctx = canvas ? getGame2dContext(canvas, { alpha: false }) : null;
      const sprites = ensureSprites();
      if (!canvas || !ctx || !sprites) return;
      const lookNow = lookRef.current;
      const reduced = reducedRef.current;
      const sim = simRef.current;
      const view = viewRef.current;
      const prev = prevRef.current;

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.scale(scaleRef.current, scaleRef.current);
      const shake = shakeOffset(now);
      if (shake.x !== 0 || shake.y !== 0) ctx.translate(shake.x, shake.y);

      // The world: interpolated between the last two steps.
      const tick = sim ? lerp(prev.tick, sim.tick, alpha) : 0;
      const scroll = tick * FLAPPY_PIPE_SPEED;
      drawBackdrop(ctx, sprites, scroll);

      if (sim) {
        const nearT = (now - view.nearMissAt) / NEAR_MISS_MS;
        for (const pipe of sim.pipes) {
          const x = lerp(prev.pipes.get(pipe.id) ?? pipe.x, pipe.x, alpha);
          const lit = !reduced && pipe.id === view.nearMissPipe && nearT >= 0 && nearT < 1 ? 1 - nearT : 0;
          drawPipePair(ctx, sprites, x, pipe.topHeight, lit);
        }
      }
      drawGround(ctx, sprites, scroll);

      // The bird.
      let y = FLAPPY_START_Y;
      let tilt = 0;
      let scaleX = 1;
      let scaleY = 1;
      let wing = WING_GLIDE;
      let dead = false;
      if (sim && view.deathAt === null) {
        y = lerp(prev.y, sim.y, alpha);
        const v = lerp(prev.velocity, sim.velocity, alpha);
        const target = v < 0 ? TILT_UP : Math.min(TILT_DOWN, TILT_UP + (TILT_DOWN - TILT_UP) * Math.min(1, v / DIVE_AT) ** 1.6);
        if (reduced) {
          view.tilt = target;
        } else {
          const tau = target < view.tilt ? TILT_UP_MS : TILT_DOWN_MS;
          view.tilt += (target - view.tilt) * (1 - Math.exp(-Math.max(0, dt) / tau));
        }
        tilt = view.tilt;
        const squash = squashAt(now - view.lastFlapAt, { ...FLAP_SQUASH, reduced });
        scaleX = squash.scaleX;
        scaleY = squash.scaleY;
        wing = wingAt(now - view.lastFlapAt, true);
        // A legacy trail: flat dots left behind at world speed, one every
        // 18 ms whatever the refresh rate.
        if (lookNow.trail && !reduced && now - view.trailAt >= 18) {
          view.trailAt = now;
          const colours = lookNow.trail;
          view.particles.push({
            x: FLAPPY_BIRD_X - 14,
            y: y + ((view.particles.length % 5) - 2) * 2,
            vx: -FLAPPY_PIPE_SPEED / FLAPPY_STEP_MS,
            vy: 0,
            g: 0,
            r: 3.2,
            colour: colours[view.particles.length % colours.length]!,
            born: now,
            life: 380,
          });
        }
      } else if (sim && view.deathAt !== null) {
        // The crash, render only: held through the hit-stop, then the fall.
        dead = true;
        const frozen = hitStopClock.frozenWithin(view.deathAt, now);
        const t = Math.max(0, now - view.deathAt - frozen);
        const ground = FLAPPY_GROUND_Y - FLAPPY_BIRD_RADIUS;
        if (reduced) {
          y = ground;
          tilt = TILT_DOWN;
          if (view.landedAt === null) view.landedAt = now;
        } else {
          const fallY = view.deathY + view.deathVy * t + 0.5 * FALL_GRAVITY * t * t;
          y = Math.min(ground, fallY);
          tilt = lerp(view.deathTilt, TILT_DOWN, Math.min(1, t / 380));
          if (y >= ground && view.landedAt === null) {
            view.landedAt = now;
            if (view.deathY < ground - 4) {
              SoundManager.play('flappyThud', { pitch: 1 });
              for (let i = 0; i < 5; i += 1) {
                view.particles.push({
                  x: FLAPPY_BIRD_X + (i - 2) * 5,
                  y: FLAPPY_GROUND_Y - 2,
                  vx: (i - 2) * 0.03,
                  vy: -0.08 - (i % 2) * 0.04,
                  g: 0.0006,
                  r: 2.4,
                  colour: lookNow.groundAlt,
                  born: now,
                  life: 300,
                });
              }
            }
          }
          if (view.landedAt !== null) {
            const squash = squashAt(now - view.landedAt, { ...LANDED_SQUASH, reduced });
            scaleX = squash.scaleY; // lying on its side: the squash is along the body
            scaleY = squash.scaleX;
          }
        }
      }
      if (lookNow.trail || view.particles.length > 0) {
        const alive = drawParticles(ctx, view.particles, now);
        if (alive === 0) view.particles.length = 0;
        else if (view.particles.length > 64) view.particles.splice(0, view.particles.length - 64);
      }
      if (sim && !reduced && view.deathAt === null) {
        drawSpeedLines(ctx, lookNow, FLAPPY_BIRD_X, y, (now - view.nearMissAt) / NEAR_MISS_MS);
      }
      drawBird(ctx, lookNow, {
        x: FLAPPY_BIRD_X,
        y,
        rot: tilt,
        scaleX,
        scaleY,
        wing,
        spin: (now - view.startedAt) / 24,
        dead,
      });

      if (sim) {
        const pop = reduced ? 0 : Math.max(0, 1 - (now - view.scorePopAt) / SCORE_POP_MS);
        drawScore(ctx, lookNow, sim.score, settleEase(pop));
      }

      // The crash's flash.
      if (view.deathAt !== null && !reduced) {
        const f = 1 - (now - view.deathAt) / FLASH_MS;
        if (f > 0) {
          ctx.globalAlpha = 0.5 * f;
          ctx.fillStyle = lookNow.eye;
          ctx.fillRect(-8, -8, FLAPPY_WIDTH + 16, FLAPPY_HEIGHT + 16);
          ctx.globalAlpha = 1;
        }
      }
    },
    [ensureSprites, hitStopClock, shakeOffset, wingAt],
  );

  /** Paint once outside a run: the first frame, the last frame, a resize. */
  const paintStill = useCallback(() => {
    if (frameLoopRef.current?.isRunning()) return;
    paint(1, performance.now(), 0);
  }, [paint]);

  /* ── saving ─────────────────────────────────────────────────────────── */

  const saveRun = useCallback(
    async (finalScore: number, flaps: number[], durationMs: number) => {
      if (isGuestRunRef.current) {
        setResultIsGuest(true);
        prefetchSession();
        return;
      }
      const token = sessionTokenRef.current;
      if (!token || finalScore <= 0) {
        prefetchSession();
        return;
      }
      envMonitorRef.current.stop();
      setSubmitError(null);
      setResultIsGuest(false);
      setIsSubmitting(true);
      try {
        const response = await fetch('/api/games/flappy-bird/score', {
          method: 'POST',
          keepalive: flaps.length < 4000,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            score: finalScore,
            sessionToken: token,
            flaps,
            clientDurationMs: Math.max(0, Math.round(durationMs)),
            env: envMonitorRef.current.getFingerprint(),
          }),
        });
        const rawText = await response.text();
        let data: Record<string, unknown> | null = null;
        try {
          data = rawText ? JSON.parse(rawText) : null;
        } catch {
          data = null;
        }
        if (!response.ok) {
          const errData = data as { error?: string; details?: string; retryAfterSec?: number } | null;
          console.error(`[flappy] Score rejected (${response.status}): ${errData?.details || errData?.error || response.status}`);
          setSubmitError(getSubmitErrorMessage(response.status, errData));
          return;
        }
        const reward = data?.reward as { awardedCredits?: number; balanceAfter?: number } | undefined;
        if (reward) {
          const balanceAfter = Number(reward.balanceAfter);
          const awarded = Number(reward.awardedCredits ?? 0);
          setWalletBalances((prev) => ({
            credits: Number.isFinite(balanceAfter)
              ? Math.max(0, Math.floor(balanceAfter))
              : Math.max(0, prev.credits + (Number.isFinite(awarded) ? Math.max(0, awarded) : 0)),
          }));
        }
        captureRunResult(data);
        setLeaderboardRefreshKey((prev) => prev + 1);
      } catch (error) {
        console.error('Failed to save score:', error);
        setSubmitError('Could not save your run. Try again.');
      } finally {
        setIsSubmitting(false);
        prefetchSession();
      }
    },
    [captureRunResult, prefetchSession],
  );

  /* ── the run's events ───────────────────────────────────────────────── */

  const onGate = useCallback(
    (scoreNow: number, now: number) => {
      const view = viewRef.current;
      view.scorePopAt = now;
      setScore(scoreNow);
      if (scoreNow % (LADDER_STEPS + 1) === 0) {
        ladderRef.current.reset();
        SoundManager.play('flappyMilestone', { pitch: 1 });
        trigger('combo', { sound: false, haptic: true });
        if (!newBest.check(scoreNow, bestAtRunStartRef.current)) {
          pushGameplayCallout({ label: `${scoreNow} pipes`, tone: 'combo', y: 24, duration: 900, announce: `${scoreNow} pipes.` });
        }
      } else {
        SoundManager.play('flappyGate', { pitch: ladderRef.current.next() });
        trigger('collect', { sound: false, haptic: true });
        newBest.check(scoreNow, bestAtRunStartRef.current);
      }
    },
    [newBest, pushGameplayCallout, trigger],
  );

  const onCrash = useCallback(
    (sim: FlappyState, now: number) => {
      const view = viewRef.current;
      view.deathAt = now;
      view.deathY = sim.y;
      // The fall starts from the bird's own speed, upward knocks damped.
      view.deathVy = Math.max(-0.12, sim.velocity / FLAPPY_STEP_MS) * 0.6;
      view.deathTilt = view.tilt;
      view.landedAt = sim.deathBy === 'ground' ? now : null;
      SoundManager.play('flappyCrash', { pitch: 1 });
      trigger('impact', { sound: false, hitStop: true, shake: 1, haptic: true });
      if (!reducedRef.current) {
        const colours = [lookRef.current.bird, lookRef.current.wing, lookRef.current.eye];
        for (let i = 0; i < 7; i += 1) {
          const a = (i / 7) * Math.PI * 2 + 0.4;
          view.particles.push({
            x: FLAPPY_BIRD_X,
            y: sim.y,
            vx: Math.cos(a) * 0.12,
            vy: Math.sin(a) * 0.12 - 0.08,
            g: 0.0005,
            r: 2.6,
            colour: colours[i % colours.length]!,
            born: now,
            life: 520,
          });
        }
      }
      ladderRef.current.reset();
      if (sim.score > highScoreRef.current) setHighScore(sim.score);
      void saveRun(sim.score, [...flapLogRef.current], sim.tick * FLAPPY_STEP_MS);
    },
    [saveRun, trigger],
  );

  const onGateRef = useRef(onGate);
  onGateRef.current = onGate;
  const onCrashRef = useRef(onCrash);
  onCrashRef.current = onCrash;
  const paintRef = useRef(paint);
  paintRef.current = paint;

  /* ── the frame loop ─────────────────────────────────────────────────── */

  useEffect(() => {
    let lastPaint = 0;
    const loop = createGameFrameLoop({
      stepMs: FLAPPY_STEP_MS,
      hitStop: hitStopClock,
      beforeSimulate: () => {
        const sim = simRef.current;
        if (!sim || sim.dead) return;
        const prev = prevRef.current;
        prev.y = sim.y;
        prev.velocity = sim.velocity;
        prev.tick = sim.tick;
        prev.pipes.clear();
        for (const pipe of sim.pipes) prev.pipes.set(pipe.id, pipe.x);
      },
      simulate: () => {
        const sim = simRef.current;
        if (!sim || sim.dead) return;
        const flap = pendingFlapRef.current;
        pendingFlapRef.current = false;
        if (flap) flapLogRef.current.push(sim.tick);
        const step = stepFlappy(sim, flap);
        const now = performance.now();
        if (step.passed) onGateRef.current(sim.score, now);
        if (step.cleared && !sim.dead && step.cleared.clearance <= NEAR_MISS_PX) {
          const view = viewRef.current;
          view.nearMissAt = now;
          view.nearMissPipe = step.cleared.id;
          SoundManager.play('flappyWhoosh', { pitch: 1 });
          trigger('near-miss', { sound: false, haptic: true });
        }
        if (step.died) {
          // The sim is over: settle the interpolation on the last step.
          const prev = prevRef.current;
          prev.y = sim.y;
          prev.velocity = sim.velocity;
          prev.tick = sim.tick;
          for (const pipe of sim.pipes) prev.pipes.set(pipe.id, pipe.x);
          onCrashRef.current(sim, now);
        }
      },
      render: (alpha, frame) => {
        const dt = lastPaint ? frame.nowMs - lastPaint : 0;
        lastPaint = frame.nowMs;
        const paintTimes = qaPaintRef.current;
        const t0 = paintTimes ? performance.now() : 0;
        paintRef.current(alpha, frame.nowMs, dt);
        if (paintTimes) {
          paintTimes.push(performance.now() - t0);
          if (paintTimes.length > 20_000) paintTimes.shift();
        }
        const view = viewRef.current;
        if (view.deathAt !== null && view.landedAt !== null) {
          const settle = reducedRef.current ? REDUCED_SETTLE_MS : SETTLE_MS;
          if (frame.nowMs - view.landedAt >= settle) {
            loop.stop();
            lastPaint = 0;
            gameOverAtRef.current = frame.nowMs;
            gameStateRef.current = 'gameover';
            setGameState('gameover');
          }
        }
      },
    });
    frameLoopRef.current = loop;
    return () => {
      loop.destroy();
      if (frameLoopRef.current === loop) frameLoopRef.current = null;
    };
  }, [hitStopClock, trigger]);

  /* ── starting and flapping ──────────────────────────────────────────── */

  const beginRun = useCallback(
    (seed: number, token: string | null) => {
      const now = performance.now();
      simRef.current = createFlappyState(seed);
      flapLogRef.current = [];
      pendingFlapRef.current = true; // the tap that started it is tick 0
      sessionTokenRef.current = token;
      isGuestRunRef.current = token === null;
      const view = newRunView(now);
      view.tilt = TILT_UP;
      viewRef.current = view;
      const prev = prevRef.current;
      prev.y = FLAPPY_START_Y;
      prev.velocity = 0;
      prev.tick = 0;
      prev.pipes.clear();
      ladderRef.current.reset();
      bestAtRunStartRef.current = highScoreRef.current;
      newBest.reset();
      clearGameplayCallouts();
      setScore(0);
      setSubmitError(null);
      setResultIsGuest(false);
      resetRunResult();
      if (token) envMonitorRef.current.start();
      gameStateRef.current = 'playing';
      setGameState('playing');
      SoundManager.play('flappyFlap', { pitch: 1 });
      frameLoopRef.current?.start();
    },
    [clearGameplayCallouts, newBest, resetRunResult],
  );

  const startGame = useCallback(async () => {
    if (startingRef.current || gameStateRef.current === 'playing') return;
    startingRef.current = true;
    trigger('press', { sound: false, haptic: true });
    setStartError(null);
    // Busy only when the session isn't in hand yet.
    const ready = sessionReadyRef.current;
    if (!ready || ready.kind === 'error') setIsStartingSession(true);
    try {
      const result = await takeSession();
      if (result.kind === 'ok') {
        setBanIndefinite(false);
        setBanUntilMs(null);
        beginRun(result.seed, result.token);
      } else if (result.kind === 'guest') {
        setBanIndefinite(false);
        setBanUntilMs(null);
        beginRun(Math.floor(Math.random() * 2 ** 31), null);
      } else {
        console.error('Failed to start game session', result.data);
        if (result.status === 403) {
          setBanIndefinite(Boolean(result.data?.isIndefinite));
          setBanUntilMs(typeof result.data?.retryAfterSec === 'number' ? Date.now() + result.data.retryAfterSec * 1000 : null);
        } else {
          setBanIndefinite(false);
          setBanUntilMs(null);
        }
        setStartError(getSubmitErrorMessage(result.status, result.data));
        gameStateRef.current = 'error';
        setGameState('error');
      }
    } finally {
      startingRef.current = false;
      setIsStartingSession(false);
    }
  }, [beginRun, takeSession, trigger]);

  /** Back to the first frame for another run. */
  const rematch = useCallback(() => {
    if (gameStateRef.current === 'playing') return;
    frameLoopRef.current?.stop();
    simRef.current = null;
    viewRef.current = newRunView(performance.now());
    clearGameplayCallouts();
    setScore(0);
    gameStateRef.current = 'ready';
    setGameState('ready');
    prefetchSession();
  }, [clearGameplayCallouts, prefetchSession]);

  const flap = useCallback(() => {
    const state = gameStateRef.current;
    if (state === 'playing') {
      const sim = simRef.current;
      if (!sim || sim.dead) return;
      pendingFlapRef.current = true;
      viewRef.current.lastFlapAt = performance.now();
      SoundManager.play('flappyFlap', { pitch: 1 });
      trigger('press', { sound: false, haptic: true });
    } else if (state === 'gameover') {
      if (performance.now() - gameOverAtRef.current >= RESTART_GRACE_MS) rematch();
    } else if (state === 'error') {
      void startGame();
    }
  }, [rematch, startGame, trigger]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'Space' && e.code !== 'ArrowUp' && e.code !== 'KeyW') return;
      if (e.repeat) {
        e.preventDefault();
        return;
      }
      // The stage starts the run from the first frame; this is the rest.
      if (gameStateRef.current === 'ready') return;
      e.preventDefault();
      flap();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [flap]);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      if (gameStateRef.current !== 'playing') return;
      e.preventDefault();
      flap();
    },
    [flap],
  );

  /* ── the canvas ─────────────────────────────────────────────────────── */

  const fitCanvas = useCallback(({ width, height }: GameStageSize) => {
    const scale = Math.min(width / FLAPPY_WIDTH, height / FLAPPY_HEIGHT);
    const nextW = Math.floor(FLAPPY_WIDTH * scale);
    const nextH = Math.floor(FLAPPY_HEIGHT * scale);
    const dpr = gameCanvasDpr(nextW, nextH);
    scaleRef.current = scale * dpr;
    setCanvasSize((prev) =>
      prev.width === nextW && prev.height === nextH && prev.dpr === dpr ? prev : { width: nextW, height: nextH, dpr },
    );
  }, []);

  // Repaint the still frame when the canvas, the look or the phase changes.
  useEffect(() => {
    if (gameState === 'playing') return;
    paintStill();
  }, [canvasSize, gameState, look, paintStill]);

  // Fonts arrive after the first paint; repaint the score once they do.
  useEffect(() => {
    if (typeof document === 'undefined' || !document.fonts) return;
    void document.fonts.ready.then(() => paintStill());
  }, [paintStill]);

  // QA harnesses (scripts/qa-flappy.mjs) read the run with ?flappyQa: the
  // state any page script could already reach, nothing that changes it.
  useEffect(() => {
    if (typeof window === 'undefined' || !new URLSearchParams(window.location.search).has('flappyQa')) return;
    const qa = () => {
      const sim = simRef.current;
      return sim
        ? { state: gameStateRef.current, y: sim.y, velocity: sim.velocity, score: sim.score, tick: sim.tick, dead: sim.dead, pipes: sim.pipes.map((p) => ({ x: p.x, top: p.topHeight })) }
        : { state: gameStateRef.current };
    };
    qaPaintRef.current = [];
    const paints = () => qaPaintRef.current?.splice(0) ?? [];
    (window as unknown as { __flappyQa?: typeof qa; __flappyQaPaints?: typeof paints }).__flappyQa = qa;
    (window as unknown as { __flappyQaPaints?: typeof paints }).__flappyQaPaints = paints;
    return () => {
      delete (window as unknown as { __flappyQa?: typeof qa }).__flappyQa;
      delete (window as unknown as { __flappyQaPaints?: typeof paints }).__flappyQaPaints;
      qaPaintRef.current = null;
    };
  }, []);

  /* ── loading ────────────────────────────────────────────────────────── */

  useEffect(() => {
    if (bestScoreLoadedRef.current) return;
    bestScoreLoadedRef.current = true;
    void (async () => {
      try {
        const response = await fetch('/api/games/flappy-bird/score', { cache: 'no-store' });
        if (!response.ok) return;
        const data = await response.json();
        if (typeof data?.bestScore === 'number') setHighScore(data.bestScore);
      } catch (error) {
        console.error('Failed to fetch user best score:', error);
      }
    })();
    prefetchSession();
  }, [prefetchSession]);

  const loadLook = useCallback(async () => {
    try {
      const response = await fetch('/api/store/inventory?gameType=flappy-bird', { cache: 'no-store' });
      if (!response.ok) return;
      const payload = (await response.json()) as InventoryResponse;
      setWalletBalances({ credits: payload.wallet?.credits ?? 0 });
      setLook(buildFlappyLook(payload.equipped));
    } catch {
      // The house look stays.
    }
  }, []);

  useEffect(() => {
    if (!showInventory) void loadLook();
  }, [loadLook, showInventory]);

  useEffect(() => {
    const onUpdate = () => void loadLook();
    window.addEventListener('store-inventory-updated', onUpdate);
    return () => window.removeEventListener('store-inventory-updated', onUpdate);
  }, [loadLook]);

  // The skin's sound tint, for as long as the page is open.
  useEffect(() => {
    SoundManager.setTint(look.sound);
    return () => SoundManager.setTint('house');
  }, [look.sound]);

  useEffect(() => {
    if (!banUntilMs) return;
    const timer = window.setInterval(() => setBanNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [banUntilMs]);

  useEffect(() => {
    if (banUntilMs && banNowMs >= banUntilMs) {
      setBanUntilMs(null);
      setBanIndefinite(false);
    }
  }, [banNowMs, banUntilMs]);

  const formatBanCountdown = (targetMs: number) => {
    const total = Math.max(0, Math.floor((targetMs - banNowMs) / 1000));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  /* ── the shell ──────────────────────────────────────────────────────── */

  const phase: GamePhase = gameState === 'ready' ? 'ready' : gameState === 'playing' ? 'playing' : 'over';
  const isBest = gameState === 'gameover' && score > 0 && score > bestAtRunStartRef.current;

  const end =
    gameState === 'gameover' ? (
      <ArcadeRunResult
        title={isBest ? 'New best' : 'Run over'}
        tone={isBest ? 'best' : 'neutral'}
        stats={[
          { label: 'pipes', value: score, highlight: isBest },
          { label: 'best', value: highScore },
        ]}
        reward={runReward}
        achievements={runAchievements}
        saving={isSubmitting}
        error={submitError}
        guest={resultIsGuest}
        actions={<ArcadeRematchButton onClick={rematch} disabled={isStartingSession} />}
      />
    ) : gameState === 'error' ? (
      <GameStageNotice
        title={banIndefinite || banUntilMs ? 'Banned from games' : 'Connection lost'}
        action={
          <ArcadeButton tone='primary' onClick={() => void startGame()} disabled={isStartingSession}>
            retry
          </ArcadeButton>
        }
      >
        {banIndefinite || banUntilMs ? (
          <p>
            {banIndefinite
              ? 'You are banned until an admin lifts it.'
              : `Ban ends in ${formatBanCountdown(banUntilMs!)}.`}
          </p>
        ) : (
          <p>{startError ?? 'Could not reach the server. Try again.'}</p>
        )}
      </GameStageNotice>
    ) : null;

  return (
    <GameShell
      game='flappy-bird'
      className='flappy-midway'
      stat={<GameStat value={highScore} label='best' />}
      howTo={HOW_TO}
      tickets={walletBalances.credits}
      below={
        <div className='flex flex-wrap items-center justify-center gap-2'>
          <GameLeaderboardButton onClick={() => setShowLeaderboard(true)} />
          <GameInventoryButton onClick={() => setShowInventory((open) => !open)} />
        </div>
      }
    >
      <GameStage
        phase={phase}
        hint={HINT}
        busy={isStartingSession ? 'Starting your run.' : null}
        onStart={() => void startGame()}
        aspect={FLAPPY_WIDTH / FLAPPY_HEIGHT}
        onSize={fitCanvas}
        end={end}
      >
        <div className='flappy-stage relative h-full w-full' onPointerDown={handlePointerDown}>
          <canvas
            ref={canvasRef}
            width={Math.floor(canvasSize.width * canvasSize.dpr)}
            height={Math.floor(canvasSize.height * canvasSize.dpr)}
            className='block'
            style={{ width: canvasSize.width, height: canvasSize.height }}
          />
          {gameState === 'playing' && <ArcadeGameplayCallouts items={gameplayCallouts} />}
        </div>
      </GameStage>

      <GameLeaderboardModal
        open={showLeaderboard}
        onOpenChange={setShowLeaderboard}
        title={renameGameNamesInText('Flappy Bird board')}
        description='Top runs and your rank.'
      >
        <GameLeaderboard
          gameType='flappy-bird'
          maxEntries={5}
          enableFullLeaderboardModal
          fullLeaderboardDisplay='inline'
          refreshKey={leaderboardRefreshKey}
        />
      </GameLeaderboardModal>

      <GameInventoryModal
        open={showInventory}
        onOpenChange={setShowInventory}
        gameType='flappy-bird'
        title={renameGameNamesInText('Flappy Bird inventory')}
        description='Equip a skin, or an older bird, pipe, sky or trail.'
      />
    </GameShell>
  );
}
