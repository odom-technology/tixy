'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { Rocket, CircleHelp } from 'lucide-react';
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
  createGameFrameLoop,
  getGame2dContext,
  gameCanvasDpr,
  type GameFrameLoop,
} from '@/features/arcade/lib/game-frame-loop';
import { ArcadeRunRewards } from '@/features/arcade/components/results/arcade-run-result';
import { useArcadeRunResult } from '@/features/arcade/lib/run-result';
import type { AccountXpReward } from '@/server/arcade/rewards/types';
import {
  FIELD_WIDTH,
  PLATFORM_WIDTH,
  ROW_RISE,
  GRAVITY,
  NORMAL_LAUNCH_V,
  SPRING_LAUNCH_V,
  platformForRow,
  platformTypeForRow,
  type PlatformType,
  type SkyLanding,
} from '@/server/arcade/sky-climber-replay';
import {
  DEFAULT_SKY_THEME,
  buildSkyTheme,
  type SkyCosmeticTheme,
  type SkyInventoryResponse,
} from './_sky-climber-theme';

import './_sky-climber.css';
import {
  drawCanvasCallout,
  readCanvasCalloutLook,
} from '@/features/arcade/components/gameplay/callout-canvas';

// ── Logical playfield geometry (the canvas draws into BASE_WIDTH x BASE_HEIGHT;
//    a dpr-scaled buffer keeps it crisp; pointer coords are mapped back). ──
const BASE_WIDTH = FIELD_WIDTH; // 360
const BASE_HEIGHT = 560;
const CLIMBER_R = 13; // jumper radius (logical px)
const PLATFORM_H = 14; // platform thickness (logical px)

// ── Horizontal steering with momentum (client-only; never affects scoring) ──
// The jumper accelerates toward the steer direction and coasts on release, so
// the controls feel weighty but still snappy. The screen wraps in x.
const H_MAX = 5.3; // top horizontal speed (logical px per frame)
const H_ACCEL = 1.05; // keyboard steer acceleration (px/frame²)
const H_FRICTION = 0.8; // coast decel factor when no key is held
const POINTER_EASE = 0.45; // how hard the pointer pulls the jumper's velocity
const CAMERA_ANCHOR = 0.4; // climber sits ~40% up from the bottom of the view
const CAMERA_EASE = 0.16; // smooth upward camera follow (never scrolls down)
const MOVE_W = 1.6; // moving-platform angular speed (rad/s)
// Death only when the jumper drops below the bottom edge of the view (with a
// hair of slack so it can dip just under the lowest plank without an unfair end).
const DEATH_MARGIN = ROW_RISE * 0.5;

// ── Cosmetic effect tuning (purely client-side — never affect score/landings) ──
const TRAIL_MAX = 12; // motion-trail history length
const PARTICLE_MAX = 90; // hard cap on live dust/spark particles
const MILESTONE_STEP = 25; // flash a banner every N rows of new height
const SPRING_ANIM_FRAMES = 20; // coil compress→extend→settle duration (frames)
const BREAK_ANIM_FRAMES = 30; // breakable crumble/fall-away duration (frames)
const RING_MAX = 8; // hard cap on live launch shock-rings
const FLOATER_MAX = 6; // hard cap on live "+1" row-reward floaters
const SPAWN_FADE_PX = 42; // fade/slide-in distance for planks entering the top edge
// Death ceremony (render-only): how long the jumper tumbles off the bottom
// before the result plate pops in, and how far the camera dips chasing it.
const DEATH_CEREMONY_MS = 600;
const DEATH_CAM_DIP = 34;

const FRAME_TIME = PHYSICS_DT_MS;
const RESTART_GRACE_PERIOD = 400;

const REWARDS_HINT_TEXT =
  'Rewards hint: climb as high as you can — every new platform row is a point. Springs launch you past several platforms at once. Bouncing on the same or a lower plank is fine; you only fall if you drop off the bottom of the screen. Tickets taper at higher scores.';

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

// One cosmetic particle (dust puff / spring spark). World-space; +y is UP.
type Particle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  color: string; // hex; alpha applied at draw time from remaining life
  gravity: number;
};

// An expanding shock-ring drawn at a launch (spring) or milestone. World-space.
type Ring = {
  x: number;
  worldY: number;
  life: number;
  maxLife: number;
  radius: number;
  grow: number;
  color: string;
};

// A floating "+1" that rises off a plank when a landing sets a NEW height
// record. World-space; self-decays.
type Floater = {
  x: number;
  worldY: number;
  life: number;
  maxLife: number;
};

// Frozen snapshot at the moment of the fall, feeding the render-only death
// ceremony (tumble + camera dip). The sim itself still stops in endRun.
type DeathSnap = {
  startT: number; // performance.now() at the fall
  x: number;
  y: number; // jumper feet world y at the fall
  vy: number; // fall speed at the fall (px/frame, negative)
  spin: 1 | -1; // tumble direction (from the last steer)
};

// Distinct existing SoundManager names — reused, never modified. Mute is global
// (the MuteButton toggles the SoundManager), so just calling play() respects it.
const SFX = {
  blip: 'stackPerfect', // pitch-laddered tick on a NEW height record (chime)
  spring: 'arcadeCashout', // catching a spring launch (punchy + distinct)
  land: 'arcadeReelStop', // soft re-bounce on the same / a lower plank
  break: 'arcadeCrash', // a breakable plank shattering away
  milestone: 'score', // crossing a height milestone
  gameover: 'fall', // dropping off the bottom
} as const;

// Shortest signed horizontal distance from `cur` to `target` accounting for the
// screen wrap. Used both for steering and platform x-overlap.
const wrappedDelta = (target: number, cur: number) => {
  let d = ((target - cur) % FIELD_WIDTH + FIELD_WIDTH) % FIELD_WIDTH;
  if (d > FIELD_WIDTH / 2) d -= FIELD_WIDTH;
  return d;
};

const launchVForType = (type: PlatformType) =>
  type === 'spring' ? SPRING_LAUNCH_V : NORMAL_LAUNCH_V;

// Pitch ladder for the new-high blip: one semitone per row inside an octave,
// wrapping every 12 rows (purely cosmetic — the SoundManager's pitch param).
const rowBlipPitch = (row: number) => Math.pow(2, (row % 12) / 12);

// ── Procedural colour helpers (pure) — shade/mix theme hexes for canvas depth ──
const clamp255 = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
const parseHex = (hex: string): [number, number, number] => {
  let h = (hex || '#000000').trim().replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const int = parseInt(h.slice(0, 6).padEnd(6, '0'), 16) || 0;
  return [(int >> 16) & 255, (int >> 8) & 255, int & 255];
};
const rgba = (rgb: [number, number, number], a = 1) =>
  `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${a})`;
// Lighten (pct > 0) or darken (pct < 0) a hex toward white/black.
const shade = (hex: string, pct: number, a = 1) => {
  const [r, g, b] = parseHex(hex);
  const m = pct >= 0 ? 255 : 0;
  const t = Math.abs(pct);
  return rgba(
    [clamp255(r + (m - r) * t), clamp255(g + (m - g) * t), clamp255(b + (m - b) * t)],
    a,
  );
};
// Blend two hexes; returns a "#rrggbb" hex string (for values stored + re-parsed
// later, e.g. particle colours).
const mixHex = (a: string, b: string, t: number) => {
  const ra = parseHex(a);
  const rb = parseHex(b);
  const to = (n: number) => clamp255(n).toString(16).padStart(2, '0');
  return `#${to(ra[0] + (rb[0] - ra[0]) * t)}${to(ra[1] + (rb[1] - ra[1]) * t)}${to(
    ra[2] + (rb[2] - ra[2]) * t,
  )}`;
};
// Blend two hexes; returns an rgba() string.
const mix = (a: string, b: string, t: number, alpha = 1) => {
  const ra = parseHex(a);
  const rb = parseHex(b);
  return rgba(
    [
      clamp255(ra[0] + (rb[0] - ra[0]) * t),
      clamp255(ra[1] + (rb[1] - ra[1]) * t),
      clamp255(ra[2] + (rb[2] - ra[2]) * t),
    ],
    alpha,
  );
};
// Deterministic tiny hash → [0,1) for decorative star/cloud/light placement.
const hash01 = (n: number) => {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
};
// Spring coil length multiplier over its animation clock (0..1 of the anim):
// a quick compress, a springy overshoot, then a settle back to rest. Returns a
// scale on the coil's rest height (1 = rest). Reads as an instant "boing".
const springCoilScale = (p: number) => {
  if (p <= 0 || p >= 1) return 1;
  if (p < 0.16) return 1 - 0.66 * (p / 0.16); // compress to ~0.34
  if (p < 0.5) {
    const u = (p - 0.16) / 0.34; // extend past rest (overshoot)
    return 0.34 + (1.42 - 0.34) * u;
  }
  const u = (p - 0.5) / 0.5; // settle overshoot → rest
  return 1.42 + (1 - 1.42) * u;
};
// Rounded-rect path (older canvases lack ctx.roundRect).
const roundRectPath = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) => {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
};
// A soft puffy cloud built from a few overlapping ellipses.
const drawCloud = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  alpha: number,
) => {
  if (alpha <= 0.01) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = '#d6e2ff';
  for (const [dx, dy, rr] of [
    [-r * 0.72, 5, r * 0.6],
    [0, 0, r * 0.9],
    [r * 0.72, 6, r * 0.55],
    [r * 0.2, 9, r * 0.72],
  ] as const) {
    ctx.beginPath();
    ctx.ellipse(x + dx, y + dy, rr, rr * 0.68, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
};

export default function SkyClimberClient() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const touchDevice = useIsTouchDevice();

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
  // Gates the game-over overlay until the (render-only) death ceremony ends.
  const [deathOverlayReady, setDeathOverlayReady] = useState(true);
  const [canvasSize, setCanvasSize] = useState({
    width: BASE_WIDTH,
    height: BASE_HEIGHT,
    dpr: 1,
  });
  const [skyTheme, setSkyTheme] = useState<SkyCosmeticTheme>(DEFAULT_SKY_THEME);

  usePreventGameGestures(gameState === 'playing');

  // ── Refs (mutable sim state; no re-render) ──
  const gameStateRef = useRef<GameState>('idle');
  const sessionTokenRef = useRef<string | null>(null);
  const seedRef = useRef<number | null>(null);
  const envMonitorRef = useRef(new EnvMonitor());
  const scoreRef = useRef(0);
  const themeRef = useRef<SkyCosmeticTheme>(DEFAULT_SKY_THEME);

  // Jumper world state (+y is UP; row r platform top is at worldY = r*ROW_RISE).
  const cxRef = useRef(FIELD_WIDTH / 2); // jumper x (wraps [0, FIELD_WIDTH))
  const vxRef = useRef(0); // horizontal velocity (momentum steering)
  const cyRef = useRef(0); // jumper feet world y
  const vyRef = useRef(0); // vertical velocity (world px/frame)
  const camYRef = useRef(0); // world y at the bottom edge of the view
  // The highest plank ever reached (= the score = max height). The score is the
  // MAX row across the whole bounce chain, so re-bounces / fall-backs never lower
  // it, they just don't advance it.
  const highRowRef = useRef(0); // row 0 = the start plank

  // Landing log POSTed for server re-verification. The server now validates a
  // TIME-ORDERED bounce chain (not a strictly-ascending one), so we record EVERY
  // real bounce — new highs, re-bounces on the same plank, and bounces on lower
  // planks after a fall — in arrival-time order. This is valid by construction:
  // the jumper launches off each plank with that plank's REAL power, so the next
  // landing is always within reach(typeLeft) rows (springs = 10, else 3) and at
  // least the per-launch min airtime later — exactly the bounds the server checks.
  // submitted score = the MAX row recorded, which equals the server's max.
  const landingsRef = useRef<SkyLanding[]>([]);

  // Breakable planks shatter on first bounce: their row goes here so the landing
  // scan skips them forever after (you can't re-land a broken plank).
  const brokenRef = useRef<Set<number>>(new Set());

  // ── Cosmetic-only effect state (never touches scoring) ──
  const trailRef = useRef<Array<{ x: number; y: number }>>([]);
  const particlesRef = useRef<Particle[]>([]);
  const ringsRef = useRef<Ring[]>([]); // expanding launch shock-rings
  const floatersRef = useRef<Floater[]>([]); // floating "+1" row-reward ticks
  const deathRef = useRef<DeathSnap | null>(null); // fall snapshot (ceremony)
  const milestoneFlashRef = useRef<{ row: number; life: number } | null>(null);
  const squashRef = useRef(0); // 0..1 squash amount on land, decays each frame
  const stretchBoostRef = useRef(0); // extra vertical stretch off a spring (decays)
  const faceDirRef = useRef(0); // -1..1 smoothed look/lean direction (eyes + tilt)
  // Per-row transient animation clocks (0 → 1 over the anim) for spring coils and
  // breakable crumbles. Keyed by row; pruned when the anim completes.
  const springAnimRef = useRef<Map<number, number>>(new Map());
  const breakAnimRef = useRef<Map<number, number>>(new Map());

  // Steering input.
  const keyLeftRef = useRef(false);
  const keyRightRef = useRef(false);
  const pointerActiveRef = useRef(false);
  const pointerXRef = useRef(FIELD_WIDTH / 2);

  const frameLoopRef = useRef<GameFrameLoop | null>(null);
  const deathAnimationRef = useRef<number>(0);
  const gameStartTimeRef = useRef(0);
  const gameOverTimeRef = useRef<number>(0);
  const isStartingRef = useRef(false);
  const isGuestRunRef = useRef(false);
  const reducedMotionRef = useRef(false);
  const saveScoreRef = useRef<
    ((score: number, landings: SkyLanding[]) => Promise<void>) | null
  >(null);
  const bestScoreCacheRef = useRef<number | null>(null);

  const elapsedMs = () => Math.max(0, performance.now() - gameStartTimeRef.current);

  const fetchUserBestScore = useCallback(async () => {
    if (bestScoreCacheRef.current !== null) {
      setHighScore(bestScoreCacheRef.current);
      return;
    }
    try {
      const response = await fetch('/api/games/sky-climber/score', {
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
      const response = await fetch('/api/store/inventory?gameType=sky-climber', {
        cache: 'no-store',
      });
      if (!response.ok) return;
      const payload = (await response.json()) as SkyInventoryResponse;
      setWalletBalances({ credits: payload.wallet?.credits ?? 0 });
      setDailyCreditsProgress({
        earned: payload.dailyGameCredits?.earned ?? 0,
        cap: payload.dailyGameCredits?.cap ?? 300,
      });
      setSkyTheme(buildSkyTheme(payload));
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

  const saveScore = async (finalScore: number, landings: SkyLanding[]) => {
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
      const response = await fetch('/api/games/sky-climber/score', {
        method: 'POST',
        keepalive: true,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          score: finalScore,
          sessionToken: sessionTokenRef.current,
          landings,
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
          `[SkyClimber] Score rejected (${response.status}): ${reason}`,
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

  // ── End the run (the jumper fell) ──
  const endRun = useCallback(() => {
    if (gameStateRef.current !== 'playing') return;
    SoundManager.play(SFX.gameover);
    gameStateRef.current = 'gameover';
    setGameState('gameover');
    frameLoopRef.current?.stop();
    gameOverTimeRef.current = performance.now();
    if (scoreRef.current > highScore) setHighScore(scoreRef.current);
    saveScoreRef.current?.(scoreRef.current, landingsRef.current.slice());
    // Render-only death ceremony: the run + score are final above; freeze a
    // snapshot so the painter can tumble the jumper off the bottom for a beat
    // before the result plate pops in. Reduced motion = a short clean cut.
    if (!reducedMotionRef.current) {
      deathRef.current = {
        startT: performance.now(),
        x: cxRef.current,
        y: cyRef.current,
        vy: vyRef.current,
        spin: vxRef.current >= 0 ? 1 : -1,
      };
      setDeathOverlayReady(false);
    }
  }, [highScore]);

  // Current rendered x of a platform (moving platforms oscillate; everything
  // else is static). Pure given the run's elapsed clock — the server never
  // checks x, so this is for the client's render + landing-overlap only.
  const platformRenderX = useCallback(
    (plat: ReturnType<typeof platformForRow>, elapsedSec: number) =>
      plat.type === 'moving'
        ? plat.x + plat.moveAmp * Math.sin(elapsedSec * MOVE_W + plat.movePhase)
        : plat.x,
    [],
  );

  // Spawn a quick burst of cosmetic particles at a world point.
  const spawnParticles = useCallback(
    (
      x: number,
      y: number,
      color: string,
      count: number,
      spread: number,
      up: number,
    ) => {
      if (reducedMotionRef.current) return;
      const arr = particlesRef.current;
      for (let i = 0; i < count; i += 1) {
        if (arr.length >= PARTICLE_MAX) arr.shift();
        const a = Math.random() * Math.PI * 2;
        const spd = spread * (0.35 + Math.random() * 0.65);
        arr.push({
          x: x + (Math.random() - 0.5) * 12,
          y,
          vx: Math.cos(a) * spd,
          vy: up + Math.abs(Math.sin(a)) * spd,
          life: 16 + Math.random() * 16,
          maxLife: 32,
          size: 1.4 + Math.random() * 2.4,
          color,
          gravity: 0.06 + Math.random() * 0.05,
        });
      }
    },
    [],
  );

  // Bounce off a plank. The jumper AUTO-bounces off EVERY plank it lands on and
  // launches with that plank's REAL power — springs fling it ~10 rows, everything
  // else ~3 rows — whether the plank is above or below the current peak. EVERY
  // bounce is recorded as { row, t } in arrival order (re-bounces and fall-backs
  // included). Because the launch can only carry the jumper reach(type) rows up
  // and takes at least the per-launch min airtime, the recorded chain always
  // satisfies the server's reach + cadence bounds (see replaySkySession). The
  // score is the MAX row ever landed on.
  const bounce = useCallback(
    (row: number) => {
      const seed = seedRef.current;
      if (seed === null) return;
      const type = platformTypeForRow(seed, row);
      const t = themeRef.current;
      cyRef.current = row * ROW_RISE; // snap feet to the plank top
      vyRef.current = launchVForType(type); // launch with this plank's REAL power
      landingsRef.current.push({ row, t: elapsedMs() }); // record every bounce

      const isSpring = type === 'spring';
      const isBreakable = type === 'breakable';
      const isNewHigh = row > highRowRef.current;
      squashRef.current = isSpring ? 1.25 : 1; // deeper squash off a spring

      // ── Per-type visuals + SFX (springs/breakables read instantly) ──
      if (isSpring) {
        // Compress→extend the coil and throw a launch burst + shock-ring.
        springAnimRef.current.set(row, 0);
        stretchBoostRef.current = 1; // big upward stretch on the jumper
        SoundManager.play(SFX.spring);
        spawnParticles(cxRef.current, cyRef.current, t.springColor, 22, 3.8, 3.0);
        spawnParticles(
          cxRef.current,
          cyRef.current,
          mixHex(t.springColor, '#ffffff', 0.6),
          10,
          2.4,
          1.4,
        );
        if (!reducedMotionRef.current && ringsRef.current.length < RING_MAX) {
          ringsRef.current.push({
            x: cxRef.current,
            worldY: cyRef.current,
            life: 16,
            maxLife: 16,
            radius: PLATFORM_WIDTH * 0.34,
            grow: 3.6,
            color: t.springColor,
          });
        }
      } else if (isBreakable) {
        // Shatter: never landable again; kick off the crumble + a crack burst.
        brokenRef.current.add(row);
        breakAnimRef.current.set(row, 0);
        SoundManager.play(SFX.break);
        spawnParticles(
          cxRef.current,
          cyRef.current,
          mixHex(t.platformColors.breakable, '#1a0e06', 0.25),
          12,
          2.6,
          0.4,
        );
      } else {
        // Normal / moving plank: a pitch-laddered blip on a new high (climbs a
        // semitone per row), a softer thud on a re-bounce / fall-back onto a
        // same-or-lower plank.
        SoundManager.play(isNewHigh ? SFX.blip : SFX.land, {
          volume: isNewHigh ? 0.55 : 0.5,
          pitch: isNewHigh ? rowBlipPitch(row) : 1,
        });
        spawnParticles(
          cxRef.current,
          cyRef.current,
          mixHex(t.platformColors[type], '#ffffff', 0.45),
          isNewHigh ? 6 : 5,
          1.7,
          0.7,
        );
      }

      // ── Max-height bookkeeping (= the score) + milestone flash on a NEW best ──
      if (isNewHigh) {
        const prevHigh = highRowRef.current;
        highRowRef.current = row;
        scoreRef.current = row;
        setScore(row);
        // Per-row reward feedback: a floating "+1" rising off the plank (capped,
        // self-decaying; springs/breakables keep their own distinct SFX above).
        {
          const floaters = floatersRef.current;
          if (floaters.length >= FLOATER_MAX) floaters.shift();
          floaters.push({
            x: cxRef.current,
            worldY: cyRef.current + CLIMBER_R * 2,
            life: 42,
            maxLife: 42,
          });
        }
        if (
          Math.floor(row / MILESTONE_STEP) > Math.floor(prevHigh / MILESTONE_STEP)
        ) {
          milestoneFlashRef.current = { row, life: 30 };
          SoundManager.play(SFX.milestone);
          if (!reducedMotionRef.current && ringsRef.current.length < RING_MAX) {
            ringsRef.current.push({
              x: cxRef.current,
              worldY: cyRef.current,
              life: 22,
              maxLife: 22,
              radius: 10,
              grow: 8,
              color: '#ffec96',
            });
          }
        }
      }
    },
    [spawnParticles],
  );

  // ── One fixed sim step: steer horizontally, integrate the bounce, detect a
  //    landing on whatever plank is underfoot, follow the camera up, advance the
  //    cosmetic effects, and test only for a fall off the bottom of the view. ──
  const stepSim = useCallback(() => {
    const seed = seedRef.current;
    if (seed === null) return;

    // Horizontal steering with momentum (keyboard accelerates + coasts; pointer
    // pulls the velocity toward the touch). Snappy but weighty; the screen wraps.
    let dir = 0;
    if (keyLeftRef.current) dir -= 1;
    if (keyRightRef.current) dir += 1;
    if (dir !== 0) {
      vxRef.current += dir * H_ACCEL;
    } else if (pointerActiveRef.current) {
      const d = wrappedDelta(pointerXRef.current, cxRef.current);
      const desired = Math.max(-H_MAX, Math.min(H_MAX, d * 0.32));
      vxRef.current += (desired - vxRef.current) * POINTER_EASE;
    } else {
      vxRef.current *= H_FRICTION; // coast to a stop
    }
    vxRef.current = Math.max(-H_MAX, Math.min(H_MAX, vxRef.current));
    if (Math.abs(vxRef.current) < 0.02) vxRef.current = 0;
    cxRef.current += vxRef.current;
    cxRef.current = ((cxRef.current % FIELD_WIDTH) + FIELD_WIDTH) % FIELD_WIDTH;
    // Smoothed look/lean direction for the jumper's eyes + body tilt.
    const targetDir = Math.max(-1, Math.min(1, vxRef.current / (H_MAX * 0.7)));
    faceDirRef.current += (targetDir - faceDirRef.current) * 0.2;

    // Vertical: gravity once per frame, position advanced in sub-steps so a fast
    // descent can't tunnel past a plank.
    vyRef.current -= GRAVITY;
    const SUB = 3;
    const subDy = vyRef.current / SUB;
    const elapsedSec = elapsedMs() / 1000;
    const falling = vyRef.current < 0;
    // Only planks still on screen are landable; anything below the view edge is
    // already in the death zone.
    const bottomRow = falling
      ? Math.max(0, Math.floor(camYRef.current / ROW_RISE))
      : 0;

    for (let s = 0; s < SUB; s += 1) {
      const prevY = cyRef.current;
      cyRef.current += subDy;
      const newY = cyRef.current;
      if (!falling) continue; // rising — pass through planks (Doodle-Jump style)

      // Descending: land on the HIGHEST plank whose top we crossed this sub-step
      // and that we're horizontally over. Re-bounces on same/lower planks are
      // allowed (they keep you alive); `bounce` decides what gets recorded.
      const topRow = Math.floor(prevY / ROW_RISE);
      let landedRow = -1;
      for (let r = topRow; r >= bottomRow; r -= 1) {
        const top = r * ROW_RISE;
        if (top > prevY || top <= newY) continue; // not crossed downward this sub-step
        if (brokenRef.current.has(r)) continue; // a shattered breakable is gone
        const plat = platformForRow(seed, r);
        const px = platformRenderX(plat, elapsedSec);
        if (
          Math.abs(wrappedDelta(px, cxRef.current)) <
          PLATFORM_WIDTH / 2 + CLIMBER_R * 0.6
        ) {
          landedRow = r;
          break;
        }
      }
      if (landedRow >= 0) {
        bounce(landedRow);
        break; // now moving up again; stop sub-stepping this frame
      }
    }

    // Motion trail (cosmetic only).
    if (!reducedMotionRef.current) {
      const trail = trailRef.current;
      trail.push({ x: cxRef.current, y: cyRef.current });
      if (trail.length > TRAIL_MAX) trail.shift();
    }

    // Advance cosmetic particles + timers (fixed-step so they stay deterministic).
    const parts = particlesRef.current;
    for (let i = parts.length - 1; i >= 0; i -= 1) {
      const p = parts[i];
      p.x += p.vx;
      p.y += p.vy;
      p.vy -= p.gravity; // +y up, so gravity pulls vy down
      p.life -= 1;
      if (p.life <= 0) parts.splice(i, 1);
    }
    const rings = ringsRef.current;
    for (let i = rings.length - 1; i >= 0; i -= 1) {
      const ring = rings[i];
      ring.radius += ring.grow;
      ring.life -= 1;
      if (ring.life <= 0) rings.splice(i, 1);
    }
    // Floating "+1" ticks drift up off the plank and decay.
    const floaters = floatersRef.current;
    for (let i = floaters.length - 1; i >= 0; i -= 1) {
      const fl = floaters[i];
      fl.life -= 1;
      if (fl.life <= 0) floaters.splice(i, 1);
    }
    // Spring coil + breakable crumble clocks (0 → 1, then pruned).
    for (const [row, p] of springAnimRef.current) {
      const np = p + 1 / SPRING_ANIM_FRAMES;
      if (np >= 1) springAnimRef.current.delete(row);
      else springAnimRef.current.set(row, np);
    }
    for (const [row, p] of breakAnimRef.current) {
      const np = p + 1 / BREAK_ANIM_FRAMES;
      if (np >= 1) breakAnimRef.current.delete(row);
      else breakAnimRef.current.set(row, np);
    }
    if (milestoneFlashRef.current) {
      milestoneFlashRef.current.life -= 1;
      if (milestoneFlashRef.current.life <= 0) milestoneFlashRef.current = null;
    }
    if (squashRef.current > 0) {
      squashRef.current = Math.max(0, squashRef.current - 0.09);
    }
    if (stretchBoostRef.current > 0) {
      stretchBoostRef.current = Math.max(0, stretchBoostRef.current - 0.045);
    }

    // Camera follows the jumper upward only — height never scrolls back down.
    // Smoothly eases up to the anchor so big spring launches feel dynamic.
    const camTarget = cyRef.current - CAMERA_ANCHOR * BASE_HEIGHT;
    if (camTarget > camYRef.current) {
      camYRef.current += (camTarget - camYRef.current) * CAMERA_EASE;
      // Never let the jumper outrun the view off the top during a fast launch.
      const minCam = cyRef.current - BASE_HEIGHT * 0.88;
      if (minCam > camYRef.current) camYRef.current = minCam;
    }

    // The ONLY lose condition: the jumper dropped below the bottom edge of the
    // view. Bouncing on the same / a lower plank is fine — you just don't climb.
    if (cyRef.current < camYRef.current - DEATH_MARGIN) {
      endRun();
    }
  }, [bounce, endRun, platformRenderX]);

  // ── Render (2D canvas) ──
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = getGame2dContext(canvas, { alpha: false });
    if (!ctx) return;
    const t = themeRef.current;
    const seed = seedRef.current;
    const reduced = reducedMotionRef.current;

    ctx.save();
    ctx.scale(canvasSize.dpr, canvasSize.dpr);
    ctx.clearRect(0, 0, BASE_WIDTH, BASE_HEIGHT);

    const nowMs = typeof performance !== 'undefined' ? performance.now() : 0;
    const nowSec = nowMs / 1000;
    // ── Death ceremony (render-only) ── the sim froze in endRun; every bit of
    // tumble motion below derives from the snapshot, never from sim state.
    const death = deathRef.current;
    const deathP = death
      ? Math.min(1, (nowMs - death.startT) / DEATH_CEREMONY_MS)
      : 0;
    // A brief camera dip chasing the falling jumper, easing back before the
    // result plate appears. Applied to the local camY only (draw transform).
    const camY =
      camYRef.current - (death ? DEATH_CAM_DIP * Math.sin(deathP * Math.PI) : 0);
    const screenY = (worldY: number) => BASE_HEIGHT - (worldY - camY);
    // 0 at ground level → 1 high up. Drives the parallax palette + cloud/star mix.
    const altitude = Math.max(0, Math.min(1, camY / (ROW_RISE * 220)));

    // ── Background: a sky that climbs from carnival dusk into a starry night ──
    const grad = ctx.createLinearGradient(0, 0, 0, BASE_HEIGHT);
    grad.addColorStop(0, mix(t.skyTop, '#05030f', altitude * 0.85));
    grad.addColorStop(1, mix(t.skyBottom, t.skyTop, altitude * 0.7));
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, BASE_WIDTH, BASE_HEIGHT);

    // Stars fade IN as you climb; gentle twinkle; slow downward parallax drift.
    if (altitude > 0.04) {
      const starA = Math.min(1, (altitude - 0.04) * 1.7);
      for (let i = 0; i < 48; i += 1) {
        const sx = hash01(i * 2.31) * BASE_WIDTH;
        const base = hash01(i * 5.13) * 1600;
        const sy = (((base - camY * 0.12) % BASE_HEIGHT) + BASE_HEIGHT) % BASE_HEIGHT;
        const tw = reduced ? 0.9 : 0.55 + 0.45 * Math.sin(nowSec * 2 + i);
        ctx.fillStyle = rgba(
          [255, 255, 244],
          starA * tw * (0.35 + hash01(i) * 0.6),
        );
        ctx.beginPath();
        ctx.arc(sx, sy, 0.6 + hash01(i * 7.7) * 1.3, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Drifting clouds fade OUT as you climb; horizontal drift + slow parallax.
    if (altitude < 0.86) {
      const cloudA = (1 - altitude / 0.86) * 0.5;
      const span = BASE_HEIGHT * 1.5;
      for (let i = 0; i < 6; i += 1) {
        const baseY = hash01(i * 9.21) * span;
        const cy = (((baseY - camY * 0.28) % span) + span) % span;
        if (cy > BASE_HEIGHT + 40) continue;
        const drift = reduced ? 0 : (nowSec * (5 + i * 2.2)) % (BASE_WIDTH + 200);
        const cx =
          (((hash01(i * 3.74) * BASE_WIDTH + drift) % (BASE_WIDTH + 200)) + 200) %
            (BASE_WIDTH + 200) -
          100;
        drawCloud(ctx, cx, cy, 26 + hash01(i * 1.7) * 22, cloudA);
      }
    }

    // Low-altitude warm horizon glow + a distant string of carnival bulbs anchored
    // near the ground so they scroll away beneath you as you climb.
    if (altitude < 0.5) {
      const a = 1 - altitude / 0.5;
      const hg = ctx.createLinearGradient(0, BASE_HEIGHT - 150, 0, BASE_HEIGHT);
      hg.addColorStop(0, rgba(parseHex(t.hazeColor), 0));
      hg.addColorStop(1, rgba(parseHex(t.hazeColor), 0.45 * a));
      ctx.fillStyle = hg;
      ctx.fillRect(0, BASE_HEIGHT - 150, BASE_WIDTH, 150);

      const ly = screenY(-30);
      if (ly > -30 && ly < BASE_HEIGHT + 30) {
        const bulbs = ['#ff5d73', '#ffd166', '#4ade80', '#38bdf8', '#a78bfa'];
        ctx.strokeStyle = rgba([20, 16, 32], 0.6 * a);
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        for (let i = 0; i <= 12; i += 1) {
          const lx = (i / 12) * BASE_WIDTH;
          const by = ly - 26 + Math.sin((i / 12) * Math.PI) * 12;
          if (i === 0) ctx.moveTo(lx, by);
          else ctx.lineTo(lx, by);
        }
        ctx.stroke();
        for (let i = 0; i <= 12; i += 1) {
          const lx = (i / 12) * BASE_WIDTH;
          const by = ly - 26 + Math.sin((i / 12) * Math.PI) * 12;
          const tw = reduced ? 0.9 : 0.6 + 0.4 * Math.sin(nowSec * 3 + i);
          ctx.fillStyle = rgba(parseHex(bulbs[i % bulbs.length]), 0.9 * a * tw);
          ctx.beginPath();
          ctx.arc(lx, by, 2.6, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }

    // ── Platforms: themed enamel/wood planks with depth + per-type detailing ──
    if (seed !== null) {
      const elapsedSec = elapsedMs() / 1000;
      const lowRow = Math.max(0, Math.floor(camY / ROW_RISE) - 1);
      const highRow = Math.floor((camY + BASE_HEIGHT) / ROW_RISE) + 1;

      // The plank body (shared by every type) — depth shadow, lit gradient face,
      // crisp top highlight.
      const drawBody = (left: number, top: number, base: string) => {
        const w = PLATFORM_WIDTH;
        const h = PLATFORM_H;
        ctx.fillStyle = shade(base, -0.5, 0.85);
        roundRectPath(ctx, left, top + 3.5, w, h, 4);
        ctx.fill();
        const g = ctx.createLinearGradient(0, top, 0, top + h);
        g.addColorStop(0, shade(base, 0.3));
        g.addColorStop(0.5, base);
        g.addColorStop(1, shade(base, -0.2));
        ctx.fillStyle = g;
        roundRectPath(ctx, left, top, w, h, 4);
        ctx.fill();
        ctx.fillStyle = shade(base, 0.6, 0.85);
        roundRectPath(ctx, left + 2.5, top + 1.5, w - 5, 2.4, 1.2);
        ctx.fill();
      };

      // An animated spring: a base block + a real coil that compresses on landing
      // and extends/overshoots on launch, capped by a striker plate. `compress`
      // is the coil-height multiplier from springCoilScale().
      const drawSpring = (cxp: number, top: number, compress: number) => {
        const restH = 16;
        const coilH = Math.max(3, restH * compress);
        const plateY = top - coilH; // striker plate rides the top of the coil
        const halfW = 8;
        const turns = 4;
        // Coil — a zig-zag helix whose vertical span follows the compression.
        ctx.strokeStyle = shade(t.springColor, -0.05);
        ctx.lineWidth = 2.4;
        ctx.lineJoin = 'round';
        ctx.beginPath();
        for (let i = 0; i <= turns * 2; i += 1) {
          const yy = top - (coilH * i) / (turns * 2);
          const xx = cxp + (i % 2 === 0 ? -halfW : halfW);
          if (i === 0) ctx.moveTo(cxp, yy);
          else ctx.lineTo(xx, yy);
        }
        ctx.lineTo(cxp, plateY);
        ctx.stroke();
        // Glow highlight on the coil when it's extended past rest (launch).
        if (compress > 1.05) {
          ctx.strokeStyle = rgba(parseHex(t.springColor), 0.5 * (compress - 1));
          ctx.lineWidth = 4.5;
          ctx.stroke();
        }
        // Striker plate.
        ctx.fillStyle = shade(t.springColor, 0.3);
        roundRectPath(ctx, cxp - 9, plateY - 3, 18, 4.5, 2);
        ctx.fill();
        ctx.fillStyle = shade(t.springColor, -0.2, 0.8);
        roundRectPath(ctx, cxp - 9, plateY + 1, 18, 1.6, 1);
        ctx.fill();
      };

      // A breakable plank mid-shatter: 3 chunks tumble down + out and fade as the
      // crumble clock runs 0 → 1.
      const drawCrumble = (left: number, top: number, p: number) => {
        const base = t.platformColors.breakable;
        const w = PLATFORM_WIDTH;
        const h = PLATFORM_H;
        const fall = p * p * 70; // accelerating drop
        const fade = 1 - p;
        ctx.save();
        ctx.globalAlpha = Math.max(0, fade);
        for (let c = 0; c < 3; c += 1) {
          const cw = w / 3;
          const dx = (c - 1) * (10 + p * 26); // spread outward
          const rot = (c - 1) * p * 0.9;
          const cxp = left + cw * (c + 0.5);
          ctx.save();
          ctx.translate(cxp + dx, top + h / 2 + fall);
          ctx.rotate(rot);
          ctx.fillStyle = shade(base, c === 1 ? 0.05 : -0.2);
          roundRectPath(ctx, -cw / 2, -h / 2, cw - 1.5, h, 2);
          ctx.fill();
          ctx.restore();
        }
        ctx.restore();
      };

      const drawPlank = (
        left: number,
        py: number,
        plat: ReturnType<typeof platformForRow>,
      ) => {
        const w = PLATFORM_WIDTH;
        const h = PLATFORM_H;
        const top = py - h / 2;
        const broken = brokenRef.current.has(plat.row);
        if (broken) {
          const bp = breakAnimRef.current.get(plat.row);
          if (bp !== undefined) drawCrumble(left, top, bp);
          return; // fully gone once the crumble finishes
        }
        const base = t.platformColors[plat.type];
        drawBody(left, top, base);

        if (plat.type === 'breakable') {
          // Cracked enamel — telegraphs that this plank will shatter.
          ctx.strokeStyle = shade(base, -0.6, 0.9);
          ctx.lineWidth = 1.3;
          ctx.beginPath();
          ctx.moveTo(left + w * 0.32, top);
          ctx.lineTo(left + w * 0.4, top + h);
          ctx.moveTo(left + w * 0.62, top);
          ctx.lineTo(left + w * 0.54, top + h);
          ctx.moveTo(left + w * 0.34, top + h * 0.5);
          ctx.lineTo(left + w * 0.6, top + h * 0.45);
          ctx.stroke();
        } else if (plat.type === 'moving') {
          // A bright sheen sweeping along the rail.
          ctx.save();
          roundRectPath(ctx, left, top, w, h, 4);
          ctx.clip();
          const sweep = ((nowSec * 70 + plat.movePhase * 36) % (w + 24)) - 12;
          ctx.fillStyle = 'rgba(255,255,255,0.32)';
          ctx.fillRect(left + sweep, top, 6, h);
          ctx.restore();
          // End caps suggest it rides a rail.
          ctx.fillStyle = shade(base, -0.4, 0.9);
          ctx.fillRect(left - 1, top + 1, 2, h - 2);
          ctx.fillRect(left + w - 1, top + 1, 2, h - 2);
        } else if (plat.type === 'spring') {
          const compress = springCoilScale(springAnimRef.current.get(plat.row) ?? 0);
          drawSpring(left + w * 0.5, top, compress);
        }
      };

      for (let r = lowRow; r <= highRow; r += 1) {
        const plat = platformForRow(seed, r);
        // Skip fully-vanished broken planks (crumble already finished).
        if (brokenRef.current.has(r) && !breakAnimRef.current.has(r)) continue;
        const px = platformRenderX(plat, elapsedSec);
        const py = screenY(r * ROW_RISE);
        const left = px - PLATFORM_WIDTH / 2;
        // Spawn telegraph (render-only): a plank that just crossed the top edge
        // fades + slides into place over its first SPAWN_FADE_PX of travel.
        // Based purely on camera distance to the row — landability is unchanged.
        const entered = camY + BASE_HEIGHT - r * ROW_RISE;
        const fadeIn =
          !reduced && gameStateRef.current === 'playing' && entered > 0 && entered < SPAWN_FADE_PX
            ? entered / SPAWN_FADE_PX
            : 1;
        if (fadeIn < 1) {
          ctx.save();
          ctx.globalAlpha = fadeIn;
          ctx.translate(0, -(1 - fadeIn) * 8);
        }
        drawPlank(left, py, plat);
        // Wrap ghost so a plank near an edge reads continuously.
        if (left < 0) drawPlank(left + FIELD_WIDTH, py, plat);
        else if (left + PLATFORM_WIDTH > FIELD_WIDTH) {
          drawPlank(left - FIELD_WIDTH, py, plat);
        }
        if (fadeIn < 1) ctx.restore();
      }
    }

    // ── Expanding launch shock-rings (spring boosts + milestones) ──
    for (const ring of ringsRef.current) {
      const a = Math.max(0, ring.life / ring.maxLife);
      ctx.strokeStyle = rgba(parseHex(ring.color), a * 0.8);
      ctx.lineWidth = 2 + a * 2;
      ctx.beginPath();
      ctx.arc(ring.x, screenY(ring.worldY), ring.radius, 0, Math.PI * 2);
      ctx.stroke();
    }

    // ── Cosmetic particles (dust puffs / spring sparks) ──
    for (const p of particlesRef.current) {
      const a = Math.max(0, p.life / p.maxLife);
      ctx.fillStyle = rgba(parseHex(p.color), a);
      ctx.beginPath();
      ctx.arc(p.x, screenY(p.y), p.size, 0, Math.PI * 2);
      ctx.fill();
    }

    // ── Floating "+1" row-reward ticks: the shared callout plate, one
    //    plate-height above the plank. ──
    if (floatersRef.current.length > 0) {
      const look = readCanvasCalloutLook(canvas);
      for (const fl of floatersRef.current) {
        drawCanvasCallout(ctx, look, {
          text: '+1',
          x: fl.x,
          y: screenY(fl.worldY) - 14,
          u: 1 - fl.life / fl.maxLife,
          reducedMotion: reduced,
          within: { left: 0, top: 0, right: BASE_WIDTH, bottom: BASE_HEIGHT },
        });
      }
    }

    // ── Jumper: a tin-toy mascot with squash-on-land / stretch-on-rise + trail ──
    const vy = vyRef.current;
    const sq = squashRef.current;
    // Stretch grows with rise speed, plus a big extra boost right off a spring.
    const stretch =
      Math.max(-0.18, Math.min(0.2, vy * 0.012)) + stretchBoostRef.current * 0.24;
    const scaleX = 1 + sq * 0.34 - stretch;
    const scaleY = 1 - sq * 0.34 + stretch;
    const look = vy >= 0 ? -1.6 : 1.6; // eyes glance up when rising, down when falling
    const lookX = faceDirRef.current * 1.9; // eyes lead the steer direction
    const tilt = faceDirRef.current * 0.13; // slight lean into the turn

    const drawTrail = (x: number) => {
      if (reduced || death) return;
      const trail = trailRef.current;
      for (let i = 0; i < trail.length; i += 1) {
        const f = i / trail.length;
        ctx.fillStyle = rgba(parseHex(t.climberBody), f * 0.22);
        ctx.beginPath();
        ctx.arc(x, screenY(trail[i].y) - CLIMBER_R, CLIMBER_R * (0.45 + f * 0.4), 0, Math.PI * 2);
        ctx.fill();
      }
    };

    const drawClimber = (x: number) => {
      const cy = screenY(jumperY) - CLIMBER_R; // body centre
      ctx.save();
      ctx.translate(x, cy);
      if (death) {
        // Tumble, shrink and fade as it drops away off the bottom.
        ctx.globalAlpha = Math.max(0, 1 - deathP * deathP);
        ctx.rotate(tilt + death.spin * deathP * 7);
        const shrink = 1 - 0.5 * deathP;
        ctx.scale(scaleX * shrink, scaleY * shrink);
      } else {
        ctx.rotate(tilt);
        ctx.scale(scaleX, scaleY);
      }
      // Body — rounded tin shell with a soft top-lit radial sheen.
      const bg = ctx.createRadialGradient(
        -CLIMBER_R * 0.35,
        -CLIMBER_R * 0.45,
        2,
        0,
        0,
        CLIMBER_R * 1.4,
      );
      bg.addColorStop(0, shade(t.climberBody, 0.55));
      bg.addColorStop(0.6, t.climberBody);
      bg.addColorStop(1, shade(t.climberBody, -0.3));
      ctx.fillStyle = bg;
      roundRectPath(ctx, -CLIMBER_R, -CLIMBER_R, CLIMBER_R * 2, CLIMBER_R * 2, CLIMBER_R * 0.7);
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = shade(t.climberAccent, 0.05);
      ctx.stroke();
      // Belly panel.
      ctx.fillStyle = shade(t.climberBody, 0.25, 0.65);
      roundRectPath(ctx, -CLIMBER_R * 0.55, -1.5, CLIMBER_R * 1.1, CLIMBER_R * 0.85, 4);
      ctx.fill();
      // Eyes — whites fixed, pupils glance toward the steer + vertical motion.
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(-4.6, -3 + look, 3.4, 0, Math.PI * 2);
      ctx.arc(4.6, -3 + look, 3.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = t.climberAccent;
      ctx.beginPath();
      ctx.arc(-4.6 + lookX, -2.4 + look, 1.7, 0, Math.PI * 2);
      ctx.arc(4.6 + lookX, -2.4 + look, 1.7, 0, Math.PI * 2);
      ctx.fill();
      // Catchlights.
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.beginPath();
      ctx.arc(-5.2 + lookX, -3.1 + look, 0.6, 0, Math.PI * 2);
      ctx.arc(4.0 + lookX, -3.1 + look, 0.6, 0, Math.PI * 2);
      ctx.fill();
      // Smile.
      ctx.strokeStyle = t.climberAccent;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.arc(0, 3.5, 3.2, 0.15 * Math.PI, 0.85 * Math.PI);
      ctx.stroke();
      // Antenna + glowing bulb (the carnival tin-toy flourish).
      ctx.strokeStyle = shade(t.climberAccent, 0.2);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(0, -CLIMBER_R);
      ctx.lineTo(0, -CLIMBER_R - 6);
      ctx.stroke();
      ctx.fillStyle = shade(t.springColor, 0.1);
      ctx.beginPath();
      ctx.arc(0, -CLIMBER_R - 7.5, 2.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    };

    // During the ceremony the jumper keeps falling + tumbling from the frozen
    // snapshot — gravity continues per-frame exactly like the sim (visual only).
    const deathFrames = deathP * (DEATH_CEREMONY_MS / FRAME_TIME);
    const jumperY = death
      ? death.y +
        death.vy * deathFrames -
        (GRAVITY * deathFrames * (deathFrames + 1)) / 2
      : cyRef.current;

    const jx = cxRef.current;
    drawTrail(jx);
    drawClimber(jx);
    if (jx < CLIMBER_R) {
      drawTrail(jx + FIELD_WIDTH);
      drawClimber(jx + FIELD_WIDTH);
    } else if (jx > FIELD_WIDTH - CLIMBER_R) {
      drawTrail(jx - FIELD_WIDTH);
      drawClimber(jx - FIELD_WIDTH);
    }

    // ── Height-milestone flash banner ──
    if (milestoneFlashRef.current) {
      const m = milestoneFlashRef.current;
      const my = screenY(m.row * ROW_RISE);
      drawCanvasCallout(ctx, readCanvasCalloutLook(canvas), {
        text: `${m.row} rows`,
        x: BASE_WIDTH / 2,
        y: my,
        u: 1 - m.life / 30,
        tone: 'combo',
        reducedMotion: reduced,
        within: { left: 0, top: 0, right: BASE_WIDTH, bottom: BASE_HEIGHT },
      });
    }

    // ── Engraved height chip (in-canvas score, top-left) — the score lives in
    //    the play space; the DOM chip above the stage stays as the primary one. ──
    if (gameStateRef.current === 'playing' || death) {
      const label = `▲ ${scoreRef.current}`;
      ctx.font = '600 12px ui-monospace, SFMono-Regular, Menlo, monospace';
      const chipW = Math.ceil(ctx.measureText(label).width) + 18;
      const chipH = 22;
      ctx.fillStyle = 'rgba(5, 4, 12, 0.55)';
      roundRectPath(ctx, 9, 9, chipW, chipH, 6);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.16)';
      ctx.lineWidth = 1;
      ctx.stroke();
      // Engraved numeral: dark offset below, lit face on top.
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
      ctx.fillText(label, 9 + chipW / 2, 9 + chipH / 2 + 1);
      ctx.fillStyle = '#ffec96';
      ctx.fillText(label, 9 + chipW / 2, 9 + chipH / 2);
    }

    ctx.restore();
  }, [canvasSize.dpr, platformRenderX]);

  // Render-only continuation after the fall: repaint the frozen scene with the
  // tumbling jumper until the ceremony runs out, THEN reveal the result plate.
  // Never steps the sim — all motion derives from the deathRef snapshot.
  const deathLoop = useCallback(() => {
    const d = deathRef.current;
    if (!d) return;
    draw();
    if (performance.now() - d.startT >= DEATH_CEREMONY_MS) {
      deathRef.current = null;
      setDeathOverlayReady(true);
      return; // stop; the overlay takes over
    }
    deathAnimationRef.current = requestAnimationFrame(deathLoop);
  }, [draw]);

  const resetRun = useCallback(() => {
    frameLoopRef.current?.destroy();
    frameLoopRef.current = null;
    cancelAnimationFrame(deathAnimationRef.current);
    cxRef.current = FIELD_WIDTH / 2;
    vxRef.current = 0;
    cyRef.current = 0;
    vyRef.current = NORMAL_LAUNCH_V; // launch off the start platform immediately
    camYRef.current = 0 - CAMERA_ANCHOR * BASE_HEIGHT;
    highRowRef.current = 0;
    landingsRef.current = [];
    brokenRef.current = new Set();
    trailRef.current = [];
    particlesRef.current = [];
    ringsRef.current = [];
    floatersRef.current = [];
    deathRef.current = null;
    setDeathOverlayReady(true);
    springAnimRef.current = new Map();
    breakAnimRef.current = new Map();
    milestoneFlashRef.current = null;
    squashRef.current = 0;
    stretchBoostRef.current = 0;
    faceDirRef.current = 0;
    pointerActiveRef.current = false;
    pointerXRef.current = FIELD_WIDTH / 2;
    keyLeftRef.current = false;
    keyRightRef.current = false;
    scoreRef.current = 0;
    setScore(0);
    gameStartTimeRef.current = performance.now();
  }, []);

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
        body: JSON.stringify({ gameType: 'sky-climber' }),
      });
      if (sessionResponse.ok) {
        setBanIndefinite(false);
        setBanUntilMs(null);
        const sessionData = await sessionResponse.json();
        sessionTokenRef.current = sessionData.token;
        seedRef.current =
          typeof sessionData.skySeed === 'number' ? sessionData.skySeed : null;
        if (seedRef.current === null) {
          setGameState('error');
          gameStateRef.current = 'error';
          setStartError('The game could not start a valid run. Try again.');
          isStartingRef.current = false;
          setIsStartingSession(false);
          return;
        }
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
    frameLoopRef.current = createGameFrameLoop({
      stepMs: FRAME_TIME,
      simulate: () => {
        stepSim();
        if (gameStateRef.current !== 'playing') {
          // Match the legacy loop's final frozen gameplay paint before the
          // separate render-only death ceremony takes over.
          draw();
          return false;
        }
        return true;
      },
      render: () => draw(),
    });
    frameLoopRef.current.start();
  }, [draw, resetRun, resetRunResult, stepSim]);

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
      pointerActiveRef.current = true;
      const pt = toLogical(e.clientX, e.clientY);
      if (pt) pointerXRef.current = pt[0];
    },
    [primaryAction, toLogical],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (gameStateRef.current !== 'playing') return;
      if (!pointerActiveRef.current) return;
      const pt = toLogical(e.clientX, e.clientY);
      if (pt) pointerXRef.current = pt[0];
    },
    [toLogical],
  );

  const handlePointerUp = useCallback(() => {
    pointerActiveRef.current = false;
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
        e.code === 'ArrowUp' ||
        e.code === 'Enter'
      ) {
        if (e.repeat) return;
        if (gameStateRef.current !== 'playing') {
          e.preventDefault();
          primaryAction();
        }
      }
    },
    [primaryAction],
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

  // Responsive sizing — the canvas fills the tall stage (mirrors swerve/bubble).
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
    themeRef.current = skyTheme;
    if (gameStateRef.current !== 'playing') draw();
  }, [skyTheme, draw]);

  useEffect(() => {
    gameStateRef.current = gameState;
  }, [gameState]);

  // Kick off the death-ceremony painter once the run ends (render-only; the
  // loop stops itself and reveals the overlay). No-op under reduced motion —
  // endRun never froze a snapshot, so the overlay shows immediately.
  useEffect(() => {
    if (gameState === 'gameover' && deathRef.current) {
      deathAnimationRef.current = requestAnimationFrame(deathLoop);
      return () => cancelAnimationFrame(deathAnimationRef.current);
    }
  }, [gameState, deathLoop]);

  useEffect(() => {
    scoreRef.current = score;
  }, [score]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      cancelAnimationFrame(deathAnimationRef.current);
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
      cancelAnimationFrame(deathAnimationRef.current);
      monitor.stop();
    };
  }, []);

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

  return (
    <div className="sky-midway arc-game-flow">
      <div className="w-full space-y-3 sm:space-y-4">
        <div className="mx-auto w-full max-w-3xl">
          <div className="hidden sm:block">
            <PageHeader
              eyebrow="Arcade"
              icon={<Rocket aria-hidden className="h-6 w-6" />}
              title="Sky Climber"
              subtitle="Steer a non-stop jumper left and right (the screen wraps) and bounce from platform to platform. Catch springs to launch past several at once. Re-bounce on a lower plank to recover — you only fall if you drop off the bottom."
              wallet={walletCard}
            />
          </div>
          <div className="sm:hidden">
            <GamesWalletCard wallet={walletCard} compact />
          </div>
        </div>

        <div className="mx-auto flex w-full max-w-md flex-wrap items-center justify-center gap-2 px-1 text-xs sm:text-sm">
          <div className="arcade-chip flex h-10 items-center gap-2 px-4 text-sm">
            <span className="arcade-kicker">Height</span>
            <span className="arcade-num font-semibold text-strong">{score}</span>
            <span aria-hidden className="text-faint">·</span>
            <span className="arcade-kicker">Best</span>
            <span className="arcade-num font-semibold text-strong">{highScore}</span>
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
            className="sky-stage relative"
            style={{ width: canvasSize.width, height: canvasSize.height }}
          >
            <canvas
              ref={canvasRef}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerUp}
              className="block cursor-pointer rounded-well border-2 border-ink"
              style={{
                touchAction: 'none',
                width: canvasSize.width,
                height: canvasSize.height,
              }}
            />

            {(gameState === 'idle' ||
              gameState === 'error' ||
              (gameState === 'gameover' && deathOverlayReady)) && (
              <div
                className="sky-overlay absolute inset-0 flex touch-none flex-col items-center justify-center rounded-well px-4"
                style={{
                  background:
                    'color-mix(in srgb, var(--scrim) 78%, transparent)',
                }}
                onPointerDown={handlePointerDown}
              >
                {gameState === 'idle' && (
                  <>
                    <Rocket size={56} className="mb-4 text-tickets-text" />
                    <h1 className="arcade-display mb-2 text-center text-2xl text-strong uppercase sm:text-3xl">
                      Sky Climber
                    </h1>
                    <p className="mb-2 text-center text-sm text-strong sm:text-base">
                      {isStartingSession
                        ? 'Starting your run…'
                        : touchDevice
                          ? 'Tap to start — drag left/right to steer'
                          : 'Press Space or click to start'}
                    </p>
                    <p className="max-w-xs text-center text-xs text-body sm:text-sm">
                      Bounce upward forever. Catch springs, dodge the gaps, climb
                      as high as you can.
                    </p>
                    {isStartingSession && (
                      <p className="mt-3 text-center text-xs text-body sm:text-sm">
                        Connecting to the game…
                      </p>
                    )}
                  </>
                )}

                {gameState === 'gameover' && (
                  <div className="sky-result sky-result-enter">
                    <span className="sky-result-eyebrow">You fell</span>
                    <div className="sky-result-scores">
                      <div className="sky-result-score">
                        <span className="sky-result-label">Height</span>
                        <span className="sky-result-num">{score}</span>
                      </div>
                      <span className="sky-result-div" aria-hidden />
                      <div className="sky-result-score">
                        <span className="sky-result-label">Best</span>
                        <span className="sky-result-num sky-result-num--best">
                          {highScore}
                        </span>
                      </div>
                    </div>
                    <ArcadeRunRewards
                      reward={runResult.reward}
                      achievements={runResult.achievements}
                      saving={isSubmitting}
                      error={submitError}
                      guest={runRewardMessage?.startsWith('Guest run')}
                      className="max-w-xs"
                    />
                    <p className="sky-result-prompt">
                      {touchDevice
                        ? 'Tap to play again'
                        : 'Press Space to play again'}
                    </p>
                  </div>
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
            'Drag left or right to steer — the jumper bounces on its own'
          ) : (
            <>
              Steer with{' '}
              <kbd className="arcade-card-inset px-2 py-1 text-strong">←</kbd>{' '}
              <kbd className="arcade-card-inset px-2 py-1 text-strong">→</kbd> —
              the jumper bounces on its own
            </>
          )}
        </p>

      </div>

      <GameLeaderboardModal
        open={showLeaderboard}
        onOpenChange={setShowLeaderboard}
        title="Sky Climber board"
        description="Highest climbs, and your rank."
      >
        <GameLeaderboard
          gameType="sky-climber"
          maxEntries={5}
          enableFullLeaderboardModal
          fullLeaderboardDisplay="inline"
          refreshKey={leaderboardRefreshKey}
        />
      </GameLeaderboardModal>
    </div>
  );
}
