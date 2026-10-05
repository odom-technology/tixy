'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import Matter from 'matter-js';
import { Candy, CircleHelp } from 'lucide-react';
import { ArcadeButton } from '@/features/arcade/components/ui/arcade-ui';
import { GameLeaderboard } from '@/features/arcade/components/game-leaderboard';
import { GameLeaderboardModal } from '@/features/arcade/components/game-leaderboard-modal';
import { GameLeaderboardButton } from '@/features/arcade/components/game-leaderboard-button';
import {
  PageHeader,
  GamesWalletCard,
} from '@/features/arcade/components/shell/page-header';
import { MuteButton } from '@/features/arcade/components/mute-button';
import { EnvMonitor } from '@/features/arcade/lib/game-anti-cheat';
import {
  usePreventGameGestures,
  useIsTouchDevice,
} from '@/features/arcade/lib/game-mobile-utils';
import { SoundManager } from '@/features/arcade/lib/sound-manager';
import {
  PHYSICS_DT_MS,
  MAX_PHYSICS_STEPS_PER_FRAME,
  createGameFrameLoop,
  getGame2dContext,
  gameCanvasDpr,
  type GameFrameLoop,
} from '@/features/arcade/lib/game-frame-loop';
import { ArcadeRunRewards } from '@/features/arcade/components/results/arcade-run-result';
import { useArcadeRunResult } from '@/features/arcade/lib/run-result';
import type { AccountXpReward } from '@/server/arcade/rewards/types';
import {
  TIER_COUNT,
  MAX_TIER,
  TIER_RADII,
  MERGE_POINTS,
  dropTierForOrdinal,
  type GumballEvent,
} from '@/server/arcade/bubble-shooter-replay';
import {
  DEFAULT_GUMBALL_THEME,
  buildGumballTheme,
  type GumballCosmeticTheme,
  type GumballInventoryResponse,
} from './_bubble-shooter-theme';

import './_bubble-shooter.css';
import {
  drawCanvasCallout,
  readCanvasCalloutLook,
  type CanvasCalloutTone,
} from '@/features/arcade/components/gameplay/callout-canvas';

// ── Logical playfield geometry (the canvas draws into BASE_WIDTH x BASE_HEIGHT;
//    a dpr-scaled buffer keeps it crisp; pointer coords are mapped back). The
//    matter.js world shares these exact logical coordinates. ──
const BASE_WIDTH = 360;
const BASE_HEIGHT = 560;
const WALL = 14; // jar wall thickness (logical px)
const INNER_LEFT = WALL;
const INNER_RIGHT = BASE_WIDTH - WALL;
const FLOOR_Y = BASE_HEIGHT - WALL; // inside face of the jar floor
const SPOUT_Y = 46; // y where the "current" gumball hovers before a drop
const FILL_LINE_Y = 135; // overflow line — a gumball resting above this loses (lowered from 100 to trim round length)

// ── matter.js physics tuning (the fluid Suika pattern: balls ROLL down the pile
//    and nestle into gaps, then settle fast without jitter or explosions). The
//    rolling feel lives in the friction pair below: keep *kinetic* friction
//    (BALL_FRICTION) high-ish so contacts grip and convert slide → spin (a ball
//    that can't grip just skates without rolling), but keep *static* friction
//    (BALL_FRICTION_STATIC) low so a resting ball un-sticks the moment a gap
//    opens beneath it and rolls in instead of freezing where it landed. ──
const GRAVITY_Y = 1; // engine.gravity.y
const GRAVITY_SCALE = 0.0014; // engine.gravity.scale (default 0.001; nudged up so gumballs fall with weight and settle promptly)
const BALL_RESTITUTION = 0.08; // barely-there bounce — lands and settles, roll comes from friction not rebound
const BALL_FRICTION = 0.1; // surface friction: enough grip to ROLL (not skate) but low enough to keep rolling into gaps
const BALL_FRICTION_STATIC = 0.04; // LOW static friction → resting balls release and roll into open gaps instead of sticking
const BALL_DENSITY = 0.001; // base density; mass scales with radius² (and a gentle per-tier bump below)
const BALL_DENSITY_TIER_SCALE = 0.05; // density *= (1 + tier·scale): big gumballs carry more momentum (heavy), small ones stay lively
const BALL_SLOP = 0.01; // tight allowed overlap → snug packing without visible interpenetration
const BALL_AIR_FRICTION = 0.014; // mild linear+angular drag → balls calm quickly after landing but still roll a beat
const WALL_THICKNESS = 80; // thick static walls (anti-tunnel)
const MAX_SPEED = 26; // hard velocity clamp (anti-tunnel / anti-explosion)
const MERGE_POP_VY = -2.2; // upward pop given to a freshly merged gumball (small → settles fast, still feels "born")

// Solver iterations: raised above matter defaults (position 6 / velocity 4) so a
// deep, tightly-packed pile resolves contacts stably each step — this is what
// kills the slow jitter/creep in stacked Suika piles and lets balls nestle.
const POSITION_ITERATIONS = 10;
const VELOCITY_ITERATIONS = 8;
const CONSTRAINT_ITERATIONS = 2; // matter default; no constraints in use, but explicit for clarity

const DROP_COOLDOWN_MS = 420; // > server MIN_DROP_INTERVAL_MS (200) — honest play never trips it
const OVERFLOW_GRACE_MS = 1100; // a settled gumball above the fill-line this long ends the run
const SETTLE_SPEED = 0.6; // below this a gumball counts as "resting"
const SETTLE_AGE_MS = 320; // a freshly dropped ball passing the line doesn't count yet

const FRAME_TIME = PHYSICS_DT_MS;
const RESTART_GRACE_PERIOD = 400;

const REWARDS_HINT_TEXT =
  'Rewards hint: merge matching gumballs to grow them — bigger merges and chains score far more. The jar fills as you drop; let it pile above the line and the run ends. Tickets taper at higher scores.';

// Distinct existing SoundManager names — reused, never modified. SoundManager
// has no pitch control, so the merge SFX ESCALATES by tier band (small tick →
// chime → fanfare) to give the "pitch rises with tier" feel.
const SFX = {
  drop: 'arcadeBounce',
  gameover: 'arcadeCrash',
} as const;
const MERGE_SFX: readonly string[] = [
  'arcadeReelTick',
  'arcadeReelTick',
  'score',
  'score',
  'eat',
  'arcadeWin',
  'arcadeWin',
  'arcadeBigWin',
  'arcadeBigWin',
  'arcadeBigWin',
];

const getSubmitErrorMessage = (
  status: number,
  data: { error?: string; details?: string; retryAfterSec?: number } | null,
) => {
  if (status === 429) {
    const retry =
      typeof data?.retryAfterSec === 'number'
        ? ` Try again in ${data.retryAfterSec}s.`
        : '';
    return `${data?.error ?? 'Too many score submissions.'}${retry}`;
  }
  if (typeof data?.details === 'string' && data.details.trim()) {
    return data.details;
  }
  if (typeof data?.error === 'string' && data.error.trim()) {
    return data.error;
  }
  return 'Could not save the run. Try again.';
};

type GameState = 'idle' | 'playing' | 'gameover' | 'error';

// A matter.js body with our gameplay props attached directly (the canonical
// Suika pattern). `circleRadius`, `position`, `angle`, `speed`, `bounds` and
// `velocity` come from matter; the rest are ours.
type GumballBody = Matter.Body & {
  isGumball: true;
  tier: number;
  merged: boolean;
  dropId: number;
  squash: number; // 0..1 render-only landing squash, decays each frame
  spawnAt: number; // elapsed ms when created (pop-in + overflow grace)
};

type Pop = {
  x: number;
  y: number;
  r: number;
  color: string;
  life: number;
  max: number;
};
type Sparkle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  color: string;
};
type Popup = {
  x: number;
  y: number;
  text: string;
  life: number;
  max: number;
  tone: CanvasCalloutTone;
};

const clamp = (v: number, lo: number, hi: number) =>
  v < lo ? lo : v > hi ? hi : v;

export default function GumballDropClient() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const [gameState, setGameState] = useState<GameState>('idle');
  const [score, setScore] = useState(0);
  const [highScore, setHighScore] = useState(0);
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const [walletBalances, setWalletBalances] = useState({ credits: 0 });
  const [dailyCreditsProgress, setDailyCreditsProgress] = useState({
    earned: 0,
    cap: 300,
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [runRewardMessage, setRunRewardMessage] = useState<string | null>(null);
  const [, setRunRewardIsCapHit] = useState(false);
  const [, setRunAccountXp] = useState<AccountXpReward | null>(null);
  const { result: runResult, capture: captureRunResult, reset: resetRunResult } = useArcadeRunResult();
  const [showRewardsHint, setShowRewardsHint] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [isStartingSession, setIsStartingSession] = useState(false);
  const [banUntilMs, setBanUntilMs] = useState<number | null>(null);
  const [banIndefinite, setBanIndefinite] = useState(false);
  const [banNowMs, setBanNowMs] = useState(Date.now());
  const [leaderboardRefreshKey, setLeaderboardRefreshKey] = useState(0);
  const [canvasSize, setCanvasSize] = useState({
    width: BASE_WIDTH,
    height: BASE_HEIGHT,
    dpr: 1,
  });
  const [theme, setTheme] = useState<GumballCosmeticTheme>(DEFAULT_GUMBALL_THEME);
  // Preview tier surfaced to React for the HUD "next" chip.
  const [nextTier, setNextTier] = useState(0);

  usePreventGameGestures(gameState === 'playing');
  const touchDevice = useIsTouchDevice();

  // ── Refs (mutable sim state; no re-render) ──
  const gameStateRef = useRef<GameState>('idle');
  const sessionTokenRef = useRef<string | null>(null);
  const seedRef = useRef<number | null>(null);
  const envMonitorRef = useRef(new EnvMonitor());
  const scoreRef = useRef(0);
  const themeRef = useRef<GumballCosmeticTheme>(DEFAULT_GUMBALL_THEME);

  // Physics world (matter.js).
  const engineRef = useRef<Matter.Engine | null>(null);
  const ballsRef = useRef<GumballBody[]>([]);
  // Merges discovered during collisionStart are queued here and APPLIED AFTER
  // Engine.update returns — never mutate the world mid event-loop iteration.
  const pendingMergesRef = useRef<Array<[GumballBody, GumballBody]>>([]);
  const nextIdRef = useRef(1);
  const dropOrdinalRef = useRef(0); // how many gumballs have been dropped
  const currentTierRef = useRef(0); // tier of the gumball waiting at the spout
  const nextTierRef = useRef(0); // tier of the gumball after that (preview)
  const dropXRef = useRef(BASE_WIDTH / 2); // x the dropper is aimed at
  const lastDropAtRef = useRef(-DROP_COOLDOWN_MS); // elapsed ms of last drop
  const overflowSinceRef = useRef<number | null>(null); // when overflow first began
  const overflowWarnRef = useRef(false); // pile is touching/over the line (glow)

  // Event log POSTed for server bound-checking (drops + merges, in time order).
  const eventsRef = useRef<GumballEvent[]>([]);

  // Cosmetic-only effects.
  const popsRef = useRef<Pop[]>([]);
  const sparklesRef = useRef<Sparkle[]>([]);
  const popupsRef = useRef<Popup[]>([]);

  // Input.
  const keyLeftRef = useRef(false);
  const keyRightRef = useRef(false);
  const dragDropArmedRef = useRef(false); // true while a pointer gesture begun in-play is active

  const frameLoopRef = useRef<GameFrameLoop | null>(null);
  const stepSimRef = useRef<() => void>(() => {});
  const drawRef = useRef<() => void>(() => {});
  const gameStartTimeRef = useRef(0);
  const gameOverTimeRef = useRef<number>(0);
  const isStartingRef = useRef(false);
  const isGuestRunRef = useRef(false);
  const reducedMotionRef = useRef(false);
  const saveScoreRef = useRef<
    ((score: number, events: GumballEvent[]) => Promise<void>) | null
  >(null);
  const bestScoreCacheRef = useRef<number | null>(null);

  const elapsedMs = () =>
    Math.max(0, performance.now() - gameStartTimeRef.current);

  const fetchUserBestScore = useCallback(async () => {
    if (bestScoreCacheRef.current !== null) {
      setHighScore(bestScoreCacheRef.current);
      return;
    }
    try {
      const response = await fetch('/api/games/bubble-shooter/score', {
        cache: 'no-store',
      });
      if (response.ok) {
        const data = await response.json();
        if (data.bestScore !== undefined) {
          setHighScore(data.bestScore);
          bestScoreCacheRef.current = data.bestScore;
        }
      }
    } catch (error) {
      console.error('Failed to fetch user best score:', error);
    }
  }, []);

  const loadWallet = useCallback(async () => {
    try {
      const response = await fetch(
        '/api/store/inventory?gameType=bubble-shooter',
        { cache: 'no-store' },
      );
      if (!response.ok) return;
      const payload = (await response.json()) as GumballInventoryResponse;
      setWalletBalances({ credits: payload.wallet?.credits ?? 0 });
      setDailyCreditsProgress({
        earned: payload.dailyGameCredits?.earned ?? 0,
        cap: payload.dailyGameCredits?.cap ?? 300,
      });
      setTheme(buildGumballTheme(payload));
    } catch {
      setWalletBalances({ credits: 0 });
      setDailyCreditsProgress({ earned: 0, cap: 300 });
    }
  }, []);

  const formatBanCountdown = (targetMs: number) => {
    const totalSeconds = Math.max(0, Math.floor((targetMs - banNowMs) / 1000));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return `${hours.toString().padStart(2, '0')}:${minutes
      .toString()
      .padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  };

  const saveScore = async (finalScore: number, events: GumballEvent[]) => {
    if (isGuestRunRef.current) {
      setRunRewardMessage('Guest run — sign in to save scores and earn tickets.');
      setRunAccountXp(null);
      setRunRewardIsCapHit(false);
      return;
    }
    if (finalScore <= 0 || !sessionTokenRef.current) return;

    envMonitorRef.current.stop();
    setSubmitError(null);
    setRunRewardMessage(null);
    setRunAccountXp(null);
    setRunRewardIsCapHit(false);
    setIsSubmitting(true);
    try {
      const response = await fetch('/api/games/bubble-shooter/score', {
        method: 'POST',
        keepalive: true,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          score: finalScore,
          sessionToken: sessionTokenRef.current,
          events,
          clientDurationMs: elapsedMs(),
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
        const errData = data as
          | { error?: string; details?: string; retryAfterSec?: number }
          | null;
        const reason =
          errData?.details || errData?.error || `HTTP ${response.status}`;
        console.error(
          `[GumballDrop] Score rejected (${response.status}): ${reason}`,
        );
        setSubmitError(getSubmitErrorMessage(response.status, errData));
        return;
      }

      captureRunResult(data);
      const reward = data?.reward as
        | {
            awardedCredits?: number;
            wantedCredits?: number;
            capRemaining?: number;
            earnedTodayTotal?: number;
            balanceAfter?: number;
            account?: AccountXpReward;
          }
        | undefined;
      if (reward) {
        setRunAccountXp(reward.account ?? null);
        const awardedCredits = Number(reward.awardedCredits ?? 0);
        const wantedCredits = Number(reward.wantedCredits ?? 0);
        const capRemaining = Number(reward.capRemaining ?? 0);
        const balanceAfter = Number(reward.balanceAfter);
        setWalletBalances((prev) => ({
          ...prev,
          credits: Number.isFinite(balanceAfter)
            ? Math.max(0, Math.floor(balanceAfter))
            : Math.max(
                0,
                prev.credits +
                  (Number.isFinite(awardedCredits)
                    ? Math.max(0, awardedCredits)
                    : 0),
              ),
        }));
        if (Number.isFinite(awardedCredits) && awardedCredits > 0) {
          setRunRewardMessage(`+${awardedCredits} tickets this run.`);
          setRunRewardIsCapHit(false);
        } else if (wantedCredits > 0 && capRemaining <= 0) {
          setRunRewardMessage('Daily ticket cap reached — no tickets this run.');
          setRunRewardIsCapHit(true);
        } else {
          setRunRewardMessage('No tickets this run.');
          setRunRewardIsCapHit(false);
        }
        if (
          Number.isFinite(Number(reward.earnedTodayTotal)) &&
          Number.isFinite(Number(reward.capRemaining))
        ) {
          const earned = Math.max(0, Number(reward.earnedTodayTotal));
          const cap = earned + Math.max(0, Number(reward.capRemaining));
          setDailyCreditsProgress({ earned, cap });
        }
      }

      setLeaderboardRefreshKey((prev) => prev + 1);
    } catch (error) {
      console.error('Failed to save score:', error);
      setSubmitError('Network error while saving your run. Try again.');
    } finally {
      setIsSubmitting(false);
    }
  };
  saveScoreRef.current = saveScore;

  // ── End the run (the jar overflowed) ──
  const endRun = useCallback(() => {
    if (gameStateRef.current !== 'playing') return;
    SoundManager.play(SFX.gameover);
    gameStateRef.current = 'gameover';
    setGameState('gameover');
    frameLoopRef.current?.stop();
    gameOverTimeRef.current = performance.now();
    if (scoreRef.current > highScore) setHighScore(scoreRef.current);
    saveScoreRef.current?.(scoreRef.current, eventsRef.current.slice());
  }, [highScore]);

  // Advance the seed-derived drop queue (the tier is NEVER client-chosen — both
  // client and server derive it from dropTierForOrdinal).
  const refreshQueue = useCallback(() => {
    const seed = seedRef.current;
    currentTierRef.current = dropTierForOrdinal(seed, dropOrdinalRef.current);
    nextTierRef.current = dropTierForOrdinal(seed, dropOrdinalRef.current + 1);
    setNextTier(nextTierRef.current);
  }, []);

  // Spawn cosmetic merge effects at (x, y).
  const spawnMergeFx = useCallback(
    (x: number, y: number, tier: number, jackpot: boolean) => {
      if (reducedMotionRef.current) return;
      const t = themeRef.current;
      const color = t.tierColors[Math.min(tier, TIER_COUNT - 1)] ?? '#fff';
      popsRef.current.push({
        x,
        y,
        r: (TIER_RADII[tier] ?? 14) * (jackpot ? 1.4 : 1),
        color,
        life: 1,
        max: jackpot ? 520 : 320,
      });
      const n = jackpot ? 22 : 8 + tier;
      for (let i = 0; i < n; i += 1) {
        const ang = (Math.PI * 2 * i) / n + Math.random() * 0.5;
        const spd = 1.5 + Math.random() * (jackpot ? 4 : 2.5);
        sparklesRef.current.push({
          x,
          y,
          vx: Math.cos(ang) * spd,
          vy: Math.sin(ang) * spd - 1,
          life: 1,
          max: 420 + Math.random() * 240,
          color: i % 2 === 0 ? color : t.glassColor,
        });
      }
    },
    [],
  );

  // ── Create a gumball body in the matter world (the canonical Suika body) ──
  const createBall = useCallback(
    (tier: number, x: number, y: number): GumballBody | null => {
      const engine = engineRef.current;
      if (!engine) return null;
      const r = TIER_RADII[tier] ?? 14;
      const body = Matter.Bodies.circle(x, y, r, {
        restitution: BALL_RESTITUTION,
        friction: BALL_FRICTION,
        frictionStatic: BALL_FRICTION_STATIC,
        frictionAir: BALL_AIR_FRICTION,
        // Big gumballs get a touch more density so they carry weight into the
        // pile and shove smaller ones aside as they roll; small ones stay nimble.
        density: BALL_DENSITY * (1 + tier * BALL_DENSITY_TIER_SCALE),
        slop: BALL_SLOP,
      }) as GumballBody;
      body.isGumball = true;
      body.tier = tier;
      body.merged = false;
      body.dropId = nextIdRef.current++;
      body.squash = 0;
      body.spawnAt = elapsedMs();
      Matter.Composite.add(engine.world, body);
      ballsRef.current.push(body);
      return body;
    },
    [],
  );

  // Merge two equal-tier gumballs into the next tier (applied AFTER the physics
  // step, from the deferred queue — never mid event-loop iteration).
  const doMerge = useCallback(
    (a: GumballBody, b: GumballBody) => {
      const engine = engineRef.current;
      if (!engine) return;
      const tier = a.tier;
      const mx = (a.position.x + b.position.x) / 2;
      const my = (a.position.y + b.position.y) / 2;
      const mvx = (a.velocity.x + b.velocity.x) / 2;

      // Remove both from the world + our render list.
      Matter.Composite.remove(engine.world, a);
      Matter.Composite.remove(engine.world, b);
      ballsRef.current = ballsRef.current.filter((x) => x !== a && x !== b);

      // Score + log (client mirrors the server's MERGE_POINTS exactly).
      eventsRef.current.push({ type: 'merge', tier, t: elapsedMs() });
      scoreRef.current += MERGE_POINTS[tier] ?? 0;
      setScore(scoreRef.current);

      const jackpot = tier >= MAX_TIER;
      spawnMergeFx(mx, my, tier, jackpot);
      popupsRef.current.push({
        x: mx,
        y: my,
        text: jackpot ? 'jackpot' : `+${MERGE_POINTS[tier] ?? 0}`,
        life: 1,
        max: jackpot ? 1100 : 720,
        tone: jackpot ? 'combo' : 'score',
      });

      if (!jackpot) {
        const nt = tier + 1;
        const grown = createBall(nt, mx, my);
        if (grown) {
          grown.squash = 0.5;
          // A small upward pop so the new gumball feels "born", not teleported.
          Matter.Body.setVelocity(grown, { x: mvx * 0.35, y: MERGE_POP_VY });
        }
        SoundManager.play(MERGE_SFX[Math.min(tier, MERGE_SFX.length - 1)]!);
      } else {
        SoundManager.play('arcadeBigWin');
        SoundManager.play('arcadeExplode');
      }
    },
    [createBall, spawnMergeFx],
  );

  // ── One fixed physics step (matter.js drives the sim; we render ourselves) ──
  const stepSim = useCallback(() => {
    const engine = engineRef.current;
    if (!engine) return;

    // 1) Advance the matter world a fixed step. collisionStart fires DURING this
    //    call and only QUEUES merges into pendingMergesRef (no world mutation).
    Matter.Engine.update(engine, FRAME_TIME);

    // 2) Apply the deferred merges now that the event loop has finished. A single
    //    drop can chain through several tiers — each new gumball's contact is
    //    picked up by the next frame's collisionStart, so chains resolve naturally.
    if (pendingMergesRef.current.length) {
      const pending = pendingMergesRef.current;
      pendingMergesRef.current = [];
      for (const [a, b] of pending) doMerge(a, b);
    }

    // 3) Clamp runaway speed (anti-tunnel / anti-explosion) + decay render squash.
    const balls = ballsRef.current;
    for (const b of balls) {
      const sp = b.speed;
      if (sp > MAX_SPEED) {
        const k = MAX_SPEED / sp;
        Matter.Body.setVelocity(b, {
          x: b.velocity.x * k,
          y: b.velocity.y * k,
        });
      }
      if (b.squash > 0) {
        b.squash *= 0.8;
        if (b.squash < 0.01) b.squash = 0;
      }
    }

    // 4) Overflow detection — a settled gumball resting above the fill-line.
    const now = elapsedMs();
    let warn = false;
    let overflowing = false;
    for (const b of balls) {
      if (b.bounds.min.y < FILL_LINE_Y) {
        warn = true;
        if (b.speed < SETTLE_SPEED && now - b.spawnAt > SETTLE_AGE_MS) {
          overflowing = true;
        }
      }
    }
    overflowWarnRef.current = warn;
    if (overflowing) {
      if (overflowSinceRef.current === null) overflowSinceRef.current = now;
      else if (now - overflowSinceRef.current > OVERFLOW_GRACE_MS) endRun();
    } else {
      overflowSinceRef.current = null;
    }

    // 5) Cosmetic effects decay.
    const decay = FRAME_TIME;
    for (const p of popsRef.current) p.life -= decay / p.max;
    popsRef.current = popsRef.current.filter((p) => p.life > 0);
    for (const s of sparklesRef.current) {
      s.x += s.vx;
      s.y += s.vy;
      s.vy += 0.12;
      s.vx *= 0.98;
      s.life -= decay / s.max;
    }
    sparklesRef.current = sparklesRef.current.filter((s) => s.life > 0);
    for (const p of popupsRef.current) {
      p.life -= decay / p.max;
    }
    popupsRef.current = popupsRef.current.filter((p) => p.life > 0);
  }, [doMerge, endRun]);

  // ── Drop the current gumball ──
  const dropCurrent = useCallback(() => {
    if (gameStateRef.current !== 'playing') return;
    const now = elapsedMs();
    if (now - lastDropAtRef.current < DROP_COOLDOWN_MS) return;
    const tier = currentTierRef.current;
    const r = TIER_RADII[tier] ?? 14;
    const x = clamp(dropXRef.current, INNER_LEFT + r, INNER_RIGHT - r);
    const ball = createBall(tier, x, SPOUT_Y);
    if (ball) Matter.Body.setVelocity(ball, { x: 0, y: 1 });
    eventsRef.current.push({ type: 'drop', t: now });
    lastDropAtRef.current = now;
    dropOrdinalRef.current += 1;
    refreshQueue();
    SoundManager.play(SFX.drop);
  }, [createBall, refreshQueue]);

  // ── Render (2D canvas; we draw matter bodies ourselves to keep the theming) ──
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = getGame2dContext(canvas, { alpha: false });
    if (!ctx) return;
    const t = themeRef.current;

    ctx.save();
    ctx.scale(canvasSize.dpr, canvasSize.dpr);
    ctx.clearRect(0, 0, BASE_WIDTH, BASE_HEIGHT);

    // Backdrop.
    ctx.fillStyle = t.bgColor;
    ctx.fillRect(0, 0, BASE_WIDTH, BASE_HEIGHT);

    // Jar interior.
    ctx.fillStyle = t.jarColor;
    ctx.fillRect(INNER_LEFT, 0, INNER_RIGHT - INNER_LEFT, FLOOR_Y);

    // Glass sheen down the left of the interior.
    const sheen = ctx.createLinearGradient(INNER_LEFT, 0, INNER_LEFT + 60, 0);
    sheen.addColorStop(0, `${t.glassColor}22`);
    sheen.addColorStop(1, '#00000000');
    ctx.fillStyle = sheen;
    ctx.fillRect(INNER_LEFT, 0, 60, FLOOR_Y);

    // Fill-line (warns + glows when the pile is at/over it).
    const warn = overflowWarnRef.current && gameStateRef.current === 'playing';
    ctx.save();
    ctx.setLineDash([8, 6]);
    ctx.lineWidth = warn ? 3 : 2;
    ctx.strokeStyle = t.fillLineColor;
    if (warn && !reducedMotionRef.current) {
      ctx.shadowColor = t.fillLineColor;
      ctx.shadowBlur = 16;
    }
    ctx.beginPath();
    ctx.moveTo(INNER_LEFT, FILL_LINE_Y);
    ctx.lineTo(INNER_RIGHT, FILL_LINE_Y);
    ctx.stroke();
    ctx.restore();

    // Gumballs (drawn from matter body state).
    for (const b of ballsRef.current) {
      const r = b.circleRadius ?? TIER_RADII[b.tier] ?? 14;
      const sq = b.squash;
      const sx = 1 + sq * 0.9;
      const sy = 1 - sq * 0.7;
      ctx.save();
      ctx.translate(b.position.x, b.position.y);
      ctx.scale(sx, sy);
      const base = t.tierColors[Math.min(b.tier, TIER_COUNT - 1)] ?? '#fff';
      // The highlight orbits with the body's spin so rolling gumballs feel alive.
      const hlAng = b.angle - Math.PI * 0.7;
      const hx = Math.cos(hlAng) * r * 0.34;
      const hy = Math.sin(hlAng) * r * 0.36;
      const grad = ctx.createRadialGradient(hx, hy, r * 0.1, 0, 0, r);
      grad.addColorStop(0, '#ffffffcc');
      grad.addColorStop(0.25, base);
      grad.addColorStop(1, '#00000055');
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.fillStyle = grad;
      ctx.fill();
      // Watermelon (top tier) gets a green rind ring.
      if (b.tier >= MAX_TIER) {
        ctx.lineWidth = Math.max(3, r * 0.12);
        ctx.strokeStyle = '#3f9a46';
        ctx.beginPath();
        ctx.arc(0, 0, r - ctx.lineWidth / 2, 0, Math.PI * 2);
        ctx.stroke();
      }
      // A small darker speckle that rides on the surface and orbits with the
      // body's spin — gives a clear visual cue that the gumball is ROLLING
      // (the highlight alone reads as a fixed light source; this rotates with it).
      if (r > 9) {
        const spAng = b.angle + Math.PI * 0.35;
        const spx = Math.cos(spAng) * r * 0.55;
        const spy = Math.sin(spAng) * r * 0.55;
        ctx.beginPath();
        ctx.arc(spx, spy, r * 0.13, 0, Math.PI * 2);
        ctx.fillStyle = '#00000033';
        ctx.fill();
      }
      // Glossy highlight (orbits with angle too — see hlAng above).
      ctx.beginPath();
      ctx.arc(hx, hy, r * 0.26, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff66';
      ctx.fill();
      ctx.restore();
    }

    // Merge pops (expanding fading rings).
    for (const p of popsRef.current) {
      const grow = 1 + (1 - p.life) * 0.9;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r * grow, 0, Math.PI * 2);
      ctx.strokeStyle = p.color;
      ctx.globalAlpha = Math.max(0, p.life) * 0.8;
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // Sparkles.
    for (const s of sparklesRef.current) {
      ctx.globalAlpha = Math.max(0, s.life);
      ctx.fillStyle = s.color;
      ctx.fillRect(s.x - 1.5, s.y - 1.5, 3, 3);
      ctx.globalAlpha = 1;
    }

    // Score popups: the shared callout plate.
    if (popupsRef.current.length > 0) {
      const calloutLook = readCanvasCalloutLook(ctx.canvas);
      for (const p of popupsRef.current) {
        drawCanvasCallout(ctx, calloutLook, {
          text: p.text,
          x: p.x,
          y: p.y,
          u: 1 - Math.max(0, Math.min(1, p.life)),
          tone: p.tone,
          reducedMotion: reducedMotionRef.current,
          within: { left: 0, top: 0, right: BASE_WIDTH, bottom: BASE_HEIGHT },
        });
      }
    }

    // The "current" gumball at the spout + a faint drop guide line.
    if (gameStateRef.current === 'playing') {
      const tier = currentTierRef.current;
      const r = TIER_RADII[tier] ?? 14;
      const gx = clamp(dropXRef.current, INNER_LEFT + r, INNER_RIGHT - r);

      ctx.save();
      ctx.setLineDash([4, 8]);
      ctx.strokeStyle = `${t.guideColor}66`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(gx, SPOUT_Y + r);
      ctx.lineTo(gx, FLOOR_Y);
      ctx.stroke();
      ctx.restore();

      // Dropper body.
      ctx.fillStyle = t.dropperBody;
      ctx.fillRect(gx - 16, 6, 32, 14);
      ctx.fillStyle = t.dropperAccent;
      ctx.fillRect(gx - 16, 6, 32, 4);

      const base = t.tierColors[Math.min(tier, TIER_COUNT - 1)] ?? '#fff';
      const grad = ctx.createRadialGradient(
        gx - r * 0.3,
        SPOUT_Y - r * 0.35,
        r * 0.1,
        gx,
        SPOUT_Y,
        r,
      );
      grad.addColorStop(0, '#ffffffcc');
      grad.addColorStop(0.25, base);
      grad.addColorStop(1, '#00000055');
      ctx.beginPath();
      ctx.arc(gx, SPOUT_Y, r, 0, Math.PI * 2);
      ctx.fillStyle = grad;
      ctx.fill();
    }

    // Jar walls / rim (drawn last, framing the interior).
    ctx.fillStyle = t.rimColor;
    ctx.fillRect(0, 0, WALL, BASE_HEIGHT); // left wall
    ctx.fillRect(BASE_WIDTH - WALL, 0, WALL, BASE_HEIGHT); // right wall
    ctx.fillRect(0, FLOOR_Y, BASE_WIDTH, BASE_HEIGHT - FLOOR_Y); // floor

    ctx.restore();
  }, [canvasSize.dpr]);

  stepSimRef.current = stepSim;
  drawRef.current = draw;

  useEffect(() => {
    const loop = createGameFrameLoop({
      stepMs: FRAME_TIME,
      maxStepsPerFrame: MAX_PHYSICS_STEPS_PER_FRAME,
      simulate: () => {
        stepSimRef.current();
      },
      render: () => {
        // Steering was historically paint-rate based rather than part of the
        // deterministic Matter step. Keep it there to avoid changing feel.
        let dir = 0;
        if (keyLeftRef.current) dir -= 1;
        if (keyRightRef.current) dir += 1;
        if (dir !== 0) {
          dropXRef.current = clamp(
            dropXRef.current + dir * 5,
            INNER_LEFT,
            INNER_RIGHT,
          );
        }
        drawRef.current();
      },
    });
    frameLoopRef.current = loop;
    return () => {
      loop.destroy();
      if (frameLoopRef.current === loop) frameLoopRef.current = null;
    };
  }, []);

  // Tear down the matter world (engine + static walls + listeners).
  const destroyWorld = useCallback(() => {
    const engine = engineRef.current;
    if (!engine) return;
    Matter.Events.off(engine, 'collisionStart');
    Matter.World.clear(engine.world, false);
    Matter.Engine.clear(engine);
    engineRef.current = null;
    ballsRef.current = [];
    pendingMergesRef.current = [];
  }, []);

  // Build a fresh matter world: gravity, three static walls, and the merge /
  // squash collision listener (the canonical Suika collisionStart pipeline).
  const buildWorld = useCallback(() => {
    destroyWorld();
    const engine = Matter.Engine.create();
    engine.gravity.y = GRAVITY_Y;
    engine.gravity.scale = GRAVITY_SCALE;
    // Stiffer solver → deep piles pack tight and stop jittering/creeping.
    engine.positionIterations = POSITION_ITERATIONS;
    engine.velocityIterations = VELOCITY_ITERATIONS;
    engine.constraintIterations = CONSTRAINT_ITERATIONS;
    // Sleeping is intentionally LEFT OFF: merges fire ONLY from collisionStart,
    // and a ball that rolls into contact with an already-asleep equal-tier
    // neighbour can fail to emit a fresh collisionStart (the pair is resolved
    // while the neighbour sleeps) — that would silently drop merges. We kill
    // jitter with solver iterations + air-friction damping instead.
    engine.enableSleeping = false;
    engineRef.current = engine;

    const halfW = WALL_THICKNESS / 2;
    // The jar surfaces share the gumball friction pair. matter combines a
    // contact's frictionStatic as Math.max(a, b), so leaving the default 0.5 on
    // the floor/walls would re-stick the bottom row and kill rolling along the
    // base — give the container the same low friction so balls roll & pack there.
    const surface = {
      isStatic: true,
      friction: BALL_FRICTION,
      frictionStatic: BALL_FRICTION_STATIC,
      restitution: BALL_RESTITUTION,
    } as const;
    const leftWall = Matter.Bodies.rectangle(
      INNER_LEFT - halfW,
      BASE_HEIGHT / 2,
      WALL_THICKNESS,
      BASE_HEIGHT * 2,
      surface,
    );
    const rightWall = Matter.Bodies.rectangle(
      INNER_RIGHT + halfW,
      BASE_HEIGHT / 2,
      WALL_THICKNESS,
      BASE_HEIGHT * 2,
      surface,
    );
    const floor = Matter.Bodies.rectangle(
      BASE_WIDTH / 2,
      FLOOR_Y + halfW,
      BASE_WIDTH,
      WALL_THICKNESS,
      surface,
    );
    Matter.Composite.add(engine.world, [leftWall, rightWall, floor]);

    Matter.Events.on(engine, 'collisionStart', (evt) => {
      if (gameStateRef.current !== 'playing') return;
      for (const pair of evt.pairs) {
        const a = pair.bodyA as GumballBody;
        const b = pair.bodyB as GumballBody;
        const aBall = a.isGumball === true;
        const bBall = b.isGumball === true;

        // Render-only landing squash on any hard contact (keyed off impact speed).
        if (aBall) {
          const imp = Math.min(0.42, Math.abs(a.velocity.y) * 0.03);
          if (imp > a.squash) a.squash = imp;
        }
        if (bBall) {
          const imp = Math.min(0.42, Math.abs(b.velocity.y) * 0.03);
          if (imp > b.squash) b.squash = imp;
        }

        if (!aBall || !bBall) continue;
        if (a.merged || b.merged) continue;
        if (a.tier !== b.tier) continue;
        // Equal tiers merge (tier < MAX → grow; tier === MAX → jackpot). Flag both
        // now so a second pair this step can't double-claim either body; the
        // actual world mutation is deferred until after Engine.update returns.
        a.merged = true;
        b.merged = true;
        pendingMergesRef.current.push([a, b]);
      }
    });
  }, [destroyWorld]);

  const resetRun = useCallback(() => {
    frameLoopRef.current?.stop();
    buildWorld();
    eventsRef.current = [];
    popsRef.current = [];
    sparklesRef.current = [];
    popupsRef.current = [];
    nextIdRef.current = 1;
    dropOrdinalRef.current = 0;
    dropXRef.current = BASE_WIDTH / 2;
    lastDropAtRef.current = -DROP_COOLDOWN_MS;
    overflowSinceRef.current = null;
    overflowWarnRef.current = false;
    keyLeftRef.current = false;
    keyRightRef.current = false;
    dragDropArmedRef.current = false;
    scoreRef.current = 0;
    setScore(0);
    refreshQueue();
    gameStartTimeRef.current = performance.now();
  }, [buildWorld, refreshQueue]);

  const startGame = useCallback(async () => {
    resetRunResult();
    if (isStartingRef.current) return;
    isStartingRef.current = true;
    isGuestRunRef.current = false;
    sessionTokenRef.current = null;
    seedRef.current = null;
    setIsStartingSession(true);
    setSubmitError(null);
    setStartError(null);
    setRunRewardMessage(null);
    setRunAccountXp(null);
    setRunRewardIsCapHit(false);

    let sessionSuccess = false;
    try {
      const sessionResponse = await fetch('/api/games/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gameType: 'bubble-shooter' }),
      });
      if (sessionResponse.ok) {
        setBanIndefinite(false);
        setBanUntilMs(null);
        const sessionData = await sessionResponse.json();
        sessionTokenRef.current = sessionData.token;
        seedRef.current =
          typeof sessionData.bubbleSeed === 'number'
            ? sessionData.bubbleSeed
            : null;
        envMonitorRef.current.start();
        sessionSuccess = true;
      } else if (sessionResponse.status === 401) {
        // Guest run — local seed, scores not saved (mirrors other solo games).
        sessionTokenRef.current = null;
        seedRef.current = Math.floor(Math.random() * 0x7fffffff) >>> 0;
        isGuestRunRef.current = true;
        setBanIndefinite(false);
        setBanUntilMs(null);
        sessionSuccess = true;
      } else {
        const data = await sessionResponse.json().catch(() => null);
        console.error('Failed to start game session', data);
        if (sessionResponse.status === 403) {
          setBanIndefinite(Boolean(data?.isIndefinite));
          setBanUntilMs(
            typeof data?.retryAfterSec === 'number'
              ? Date.now() + data.retryAfterSec * 1000
              : null,
          );
        } else {
          setBanIndefinite(false);
          setBanUntilMs(null);
        }
        setStartError(getSubmitErrorMessage(sessionResponse.status, data));
      }
    } catch (error) {
      console.error('Failed to start game session:', error);
      setStartError('Network error while starting the run. Try again.');
    } finally {
      isStartingRef.current = false;
      setIsStartingSession(false);
    }

    if (!sessionSuccess || (!sessionTokenRef.current && !isGuestRunRef.current)) {
      setGameState('error');
      gameStateRef.current = 'error';
      return;
    }

    resetRun();
    gameStateRef.current = 'playing';
    setGameState('playing');
    frameLoopRef.current?.start();
  }, [resetRun, resetRunResult]);

  const primaryAction = useCallback(() => {
    const current = gameStateRef.current;
    if (current === 'idle' || current === 'error') {
      startGame();
    } else if (current === 'gameover') {
      const since = performance.now() - gameOverTimeRef.current;
      if (since >= RESTART_GRACE_PERIOD) startGame();
    }
  }, [startGame]);

  // Map a pointer event to logical canvas coordinates.
  const toLogical = useCallback(
    (clientX: number, clientY: number): [number, number] | null => {
      const canvas = canvasRef.current;
      if (!canvas) return null;
      const rect = canvas.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return null;
      const x = ((clientX - rect.left) / rect.width) * BASE_WIDTH;
      const y = ((clientY - rect.top) / rect.height) * BASE_HEIGHT;
      return [x, y];
    },
    [],
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      if (gameStateRef.current !== 'playing') {
        primaryAction();
        return;
      }
      // Aim now; the drop fires on release (so a touch can drag-aim then drop,
      // and the gesture that started the game can't accidentally drop).
      dragDropArmedRef.current = true;
      const pt = toLogical(e.clientX, e.clientY);
      if (pt) dropXRef.current = pt[0];
    },
    [primaryAction, toLogical],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (gameStateRef.current !== 'playing') return;
      const pt = toLogical(e.clientX, e.clientY);
      if (pt) dropXRef.current = pt[0];
    },
    [toLogical],
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (gameStateRef.current !== 'playing') return;
      if (!dragDropArmedRef.current) return;
      dragDropArmedRef.current = false;
      const pt = toLogical(e.clientX, e.clientY);
      if (pt) dropXRef.current = pt[0];
      dropCurrent();
    },
    [dropCurrent, toLogical],
  );

  const handlePointerCancel = useCallback(() => {
    dragDropArmedRef.current = false;
  }, []);

  // ── Keyboard ──
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.code === 'ArrowLeft' || e.code === 'KeyA') {
        if (gameStateRef.current === 'playing') {
          e.preventDefault();
          keyLeftRef.current = true;
        }
      } else if (e.code === 'ArrowRight' || e.code === 'KeyD') {
        if (gameStateRef.current === 'playing') {
          e.preventDefault();
          keyRightRef.current = true;
        }
      } else if (
        e.code === 'Space' ||
        e.code === 'ArrowDown' ||
        e.code === 'Enter'
      ) {
        if (e.repeat) return;
        e.preventDefault();
        if (gameStateRef.current === 'playing') dropCurrent();
        else primaryAction();
      }
    },
    [dropCurrent, primaryAction],
  );

  const handleKeyUp = useCallback((e: KeyboardEvent) => {
    if (e.code === 'ArrowLeft' || e.code === 'KeyA') keyLeftRef.current = false;
    else if (e.code === 'ArrowRight' || e.code === 'KeyD') {
      keyRightRef.current = false;
    }
  }, []);

  // ── Effects ──
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => {
      reducedMotionRef.current = mq.matches;
    };
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);

  // Responsive sizing — the canvas fills the tall stage (mirrors sky/swerve).
  useEffect(() => {
    const updateSize = () => {
      const container = containerRef.current;
      if (!container) return;
      const reservedVertical = window.innerHeight < 700 ? 200 : 260;
      const maxWidth = Math.min(window.innerWidth - 24, 460);
      const maxHeight = Math.min(
        window.innerHeight - reservedVertical,
        BASE_HEIGHT,
      );
      const scale = Math.min(maxWidth / BASE_WIDTH, maxHeight / BASE_HEIGHT, 1.2);
      const dpr = gameCanvasDpr(BASE_WIDTH, BASE_HEIGHT);
      setCanvasSize({
        width: Math.floor(BASE_WIDTH * scale),
        height: Math.floor(BASE_HEIGHT * scale),
        dpr,
      });
    };
    updateSize();
    window.addEventListener('resize', updateSize);
    return () => window.removeEventListener('resize', updateSize);
  }, []);

  // Keep the canvas drawing buffer sized to the display × dpr, then paint a frame.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = Math.floor(BASE_WIDTH * canvasSize.dpr);
    canvas.height = Math.floor(BASE_HEIGHT * canvasSize.dpr);
    if (gameStateRef.current !== 'playing') draw();
  }, [canvasSize, draw]);

  // Apply equipped cosmetics; repaint a still frame when idle.
  useEffect(() => {
    themeRef.current = theme;
    if (gameStateRef.current !== 'playing') draw();
  }, [theme, draw]);

  useEffect(() => {
    gameStateRef.current = gameState;
  }, [gameState]);

  useEffect(() => {
    scoreRef.current = score;
  }, [score]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [handleKeyDown, handleKeyUp]);

  useEffect(() => {
    fetchUserBestScore();
  }, [fetchUserBestScore]);

  useEffect(() => {
    void loadWallet();
  }, [loadWallet]);

  useEffect(() => {
    const handleInventoryUpdate = () => {
      void loadWallet();
    };
    window.addEventListener('store-inventory-updated', handleInventoryUpdate);
    return () =>
      window.removeEventListener('store-inventory-updated', handleInventoryUpdate);
  }, [loadWallet]);

  useEffect(() => {
    const monitor = envMonitorRef.current;
    return () => {
      frameLoopRef.current?.destroy();
      frameLoopRef.current = null;
      monitor.stop();
      destroyWorld();
    };
  }, [destroyWorld]);

  useEffect(() => {
    const timer = window.setInterval(() => setBanNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!banUntilMs) return;
    if (banNowMs >= banUntilMs) {
      setBanUntilMs(null);
      setBanIndefinite(false);
    }
  }, [banNowMs, banUntilMs]);

  const walletCard = {
    credits: walletBalances.credits,
    progress: {
      label: 'Daily tickets',
      current: dailyCreditsProgress.earned,
      max: dailyCreditsProgress.cap,
    },
  };

  // Small inline gumball chip for the HUD "next" preview (a render helper, not a
  // nested component — called inline so it doesn't remount each render).
  const renderTierChip = (tier: number) => {
    const color = theme.tierColors[Math.min(tier, TIER_COUNT - 1)] ?? '#fff';
    const d = 12 + tier * 1.4;
    return (
      <span
        aria-hidden
        className="inline-block rounded-full align-middle"
        style={{
          width: d,
          height: d,
          background: `radial-gradient(circle at 35% 30%, #ffffffcc, ${color} 45%, #00000055)`,
          boxShadow: 'inset 0 -1px 2px #0006',
        }}
      />
    );
  };

  return (
    <div className="bubble-midway arc-game-flow">
      <div className="w-full space-y-3 sm:space-y-4">
        <div className="mx-auto w-full max-w-3xl">
          <div className="hidden sm:block">
            <PageHeader
              eyebrow="Arcade"
              icon={<Candy aria-hidden className="h-6 w-6" />}
              title="Gumball Drop"
              subtitle="Slide the dropper and release gumballs into the jar. Two of the same size merge into a bigger one — chase big merges and chains. Let the pile spill over the line and the run ends."
              wallet={walletCard}
            />
          </div>
          <div className="sm:hidden">
            <GamesWalletCard wallet={walletCard} compact />
          </div>
        </div>

        <div className="mx-auto flex w-full max-w-xl flex-wrap items-center justify-center gap-2 px-1 text-xs sm:text-sm">
          <div className="arcade-chip flex h-10 items-center gap-2 px-4 text-sm">
            <span className="arcade-kicker">Score</span>
            <span className="arcade-num font-semibold text-strong">{score}</span>
            <span aria-hidden className="text-faint">·</span>
            <span className="arcade-kicker">Best</span>
            <span className="arcade-num font-semibold text-strong">{highScore}</span>
          </div>
          <div className="arcade-chip flex h-10 items-center gap-2 px-3 text-sm">
            <span className="arcade-kicker">Next</span>
            {renderTierChip(nextTier)}
          </div>
          <GameLeaderboardButton
            onClick={(e) => {
              e.stopPropagation();
              setShowLeaderboard(true);
            }}
            iconSize={14}
            className="h-10 px-3 py-0 text-xs sm:text-sm"
          />
          <MuteButton />
          <div className="relative inline-flex items-center gap-1.5">
            <ArcadeButton
              tone="ghost"
              size="icon"
              className="peer"
              aria-label="Show rewards hint"
              aria-expanded={showRewardsHint}
              onMouseDown={(event) => {
                event.preventDefault();
                event.stopPropagation();
              }}
              onTouchStart={(event) => {
                event.preventDefault();
                event.stopPropagation();
              }}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                setShowRewardsHint((prev) => !prev);
              }}
            >
              <CircleHelp size={18} />
            </ArcadeButton>
            <span
              className={`pointer-events-none absolute right-0 top-full z-20 mt-2 w-[calc(100vw-2rem)] max-w-sm arcade-card-inset px-3 py-2 text-left text-xs leading-relaxed text-body transition-opacity duration-150 sm:w-80 ${
                showRewardsHint
                  ? 'opacity-100'
                  : 'opacity-0 peer-hover:opacity-100 peer-focus:opacity-100'
              }`}
            >
              {REWARDS_HINT_TEXT}
            </span>
          </div>
        </div>

        <div ref={containerRef} className="relative touch-none flex justify-center">
          <div
            className="bubble-stage relative"
            style={{ width: canvasSize.width, height: canvasSize.height }}
          >
            <canvas
              ref={canvasRef}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerCancel}
              className="block cursor-pointer rounded-well border-2 border-ink"
              style={{
                touchAction: 'none',
                width: canvasSize.width,
                height: canvasSize.height,
              }}
            />

            {gameState !== 'playing' && (
              <div
                className="bubble-overlay absolute inset-0 flex touch-none flex-col items-center justify-center rounded-well px-4"
                style={{
                  background:
                    'color-mix(in srgb, var(--scrim) 78%, transparent)',
                }}
                onPointerDown={handlePointerDown}
              >
                {gameState === 'idle' && (
                  <>
                    <Candy size={56} className="mb-4 text-tickets-text" />
                    <h1 className="arcade-display mb-2 text-center text-2xl text-strong uppercase sm:text-3xl">
                      Gumball Drop
                    </h1>
                    <p className="mb-2 text-center text-sm text-strong sm:text-base">
                      {isStartingSession
                        ? 'Starting your run…'
                        : touchDevice
                          ? 'Tap to start — drag to aim, lift to drop'
                          : 'Press Space or click to start'}
                    </p>
                    <p className="max-w-xs text-center text-xs text-body sm:text-sm">
                      Merge matching gumballs into bigger ones. Don’t let the jar
                      spill over the line.
                    </p>
                    {isStartingSession && (
                      <p className="mt-3 text-center text-xs text-body sm:text-sm">
                        Connecting to the game…
                      </p>
                    )}
                  </>
                )}

                {gameState === 'gameover' && (
                  <>
                    <h2 className="arcade-display mb-2 text-2xl text-strong uppercase sm:text-3xl">
                      Jar overflowed
                    </h2>
                    <p className="mb-1 text-xl text-strong sm:text-2xl">
                      Score{' '}
                      <span className="arcade-num font-semibold">{score}</span>
                    </p>
                    <p className="mb-4 text-base text-body sm:text-lg">
                      Best <span className="arcade-num">{highScore}</span>
                    </p>
                    <ArcadeRunRewards
                      reward={runResult.reward}
                      achievements={runResult.achievements}
                      saving={isSubmitting}
                      error={submitError}
                      guest={runRewardMessage?.startsWith('Guest run')}
                      className="mb-4 max-w-xs"
                    />
                    <p className="text-center text-sm text-body sm:text-base">
                      {touchDevice
                        ? 'Tap to play again'
                        : 'Press Space to play again'}
                    </p>
                  </>
                )}

                {gameState === 'error' && (
                  <>
                    <h2 className="arcade-display mb-2 text-2xl text-danger-text uppercase sm:text-3xl">
                      Could not start
                    </h2>
                    <p className="mb-4 text-center text-sm text-strong sm:text-base">
                      {startError ?? 'The game could not reach the server.'}
                    </p>
                    {(banIndefinite || banUntilMs) && (
                      <p className="mb-2 text-center text-xs text-tickets-text sm:text-sm">
                        {banIndefinite
                          ? 'You are banned from games until an admin unbans you.'
                          : `Ban time left: ${formatBanCountdown(banUntilMs!)}`}
                      </p>
                    )}
                    <p className="text-center text-sm text-body sm:text-base">
                      Tap or press Space to retry
                    </p>
                  </>
                )}
              </div>
            )}
          </div>
        </div>

        <p className="mt-3 text-center text-xs text-faint sm:text-sm">
          {touchDevice ? (
            'Drag to aim the dropper — lift your finger to drop'
          ) : (
            <>
              Aim with the mouse or{' '}
              <kbd className="arcade-card-inset px-2 py-1 text-strong">←</kbd>{' '}
              <kbd className="arcade-card-inset px-2 py-1 text-strong">→</kbd> —
              click or{' '}
              <kbd className="arcade-card-inset px-2 py-1 text-strong">Space</kbd>{' '}
              to drop
            </>
          )}
        </p>

      </div>

      <GameLeaderboardModal
        open={showLeaderboard}
        onOpenChange={setShowLeaderboard}
        title="Gumball Drop board"
        description="Biggest jars, and your rank."
      >
        <GameLeaderboard
          gameType="bubble-shooter"
          maxEntries={5}
          enableFullLeaderboardModal
          fullLeaderboardDisplay="inline"
          refreshKey={leaderboardRefreshKey}
        />
      </GameLeaderboardModal>
    </div>
  );
}
