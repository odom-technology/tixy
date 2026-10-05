'use client';

import { useState, useRef, useEffect, useCallback, type ReactNode } from 'react';
import { ArcadeButton } from '@/features/arcade/components/ui/arcade-ui';
import { Num } from '@/features/arcade/components/ui/num';
import { GameLeaderboard } from '@/features/arcade/components/game-leaderboard';
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
import { EnvMonitor } from '@/features/arcade/lib/game-anti-cheat';
import { connectGameWs, type GameWsHandle } from '@/features/arcade/lib/game-ws';
import { SoundManager } from '@/features/arcade/lib/sound-manager';
import {
  ArcadeRematchButton,
  ArcadeRunResult,
} from '@/features/arcade/components/results/arcade-run-result';
import { useArcadeRunResult } from '@/features/arcade/lib/run-result';
import {
  useFeelReducedMotion,
  useGameFeedback,
  usePitchLadder,
} from '@/features/arcade/lib/use-game-feedback';
import { settleEase, squashAt } from '@/features/arcade/lib/game-feel';
import { calloutLifeMs } from '@/features/arcade/components/gameplay/callout-motion';
import {
  drawCanvasCallout,
  readCanvasCalloutLook,
} from '@/features/arcade/components/gameplay/callout-canvas';
import type { AccountXpReward } from '@/server/arcade/rewards/types';
import { gameCanvasDpr } from '@/features/arcade/lib/game-frame-loop';
import {
  STACK_BASE_WIDTH as BASE_WIDTH,
  STACK_RULES_VERSION,
  STACK2_FAST_FROM,
  STACK2_NARROW_FROM,
  createStackRun,
  stackDropAt,
  stackInputMs,
  stackMoverLeft,
  stackMoverWidth,
  stackRow,
  stackRunTickets,
  type StackDropResult,
  type StackRunState,
} from '@/server/arcade/stack-replay';
import { stackerDisplayLeadMs } from '@/server/arcade/stack-cabinet-engine';
import {
  type StackCosmeticTheme,
  type InventoryCosmeticResponse,
  DEFAULT_STACK_THEME,
  resolveMidwayStackTheme,
  buildStackTheme,
} from './_stack-theme';
import { drawSkinMaterial, drawSkinPiece } from './_stack-skin-draw';

/* ──────────────────────────────────────────────────────────────────────────
   STACK — a slab sweeps left<->right at the current tower height; tap/space
   DROPS it; the overhang beyond the block below is sliced off. A near-center
   drop is a PERFECT (snap, no cut); 5+ consecutive perfects GROW the slab back.
   A full miss = game over; score = height (number of successful drops).

   DETERMINISM: the rules live in src/server/arcade/stack-replay.ts (rules 2),
   shared with the score route. The block's position is a pure function of
   the time since its row began. Every frame draws that function at the
   display's refresh rate, a little ahead of the frame's time (the moment the
   frame reaches the screen). A drop is the input event's own time in whole
   ms; it is scored at once with the same function, sent over WS as `drop`
   {t}, and replayed by the route from the same numbers, so what you see when
   you tap is what lands at every refresh rate. Everything else in this file
   (colours, camera, squash, falling pieces, sound) is drawing only and never
   feeds back into the rules.
   ────────────────────────────────────────────────────────────────────────── */

// ── Render-only constants (never touch the shared sim) ──────────────────────
const BASE_HEIGHT = 720;
const BLOCK_HEIGHT = 30; // front-face height of a row, logical px
const DEPTH_X = 30; // 2.5D iso depth offset (right)
const DEPTH_Y = 16; // 2.5D iso depth offset (up)
const ISO_SHIFT_X = -DEPTH_X / 2; // center the projected box on the sim x-band
const BASELINE_Y = BASE_HEIGHT - 96; // screen y of the tower base (row 0 bottom)
const CAMERA_ANCHOR = 384; // px of tower above which the camera starts rising
const CAMERA_TAU_MS = 120; // the camera eases toward its target with this time constant
const PALETTE_SEGMENT = 10; // layers per hue-gradient segment
const RING_MS = 380; // perfect ring expansion time
const FLASH_MS = 160; // white flash on the placed block
const SNAP_MS = 90; // a perfect drop slides the last few px into line
const PIECE_FADE_MS = 650; // a falling overhang fades out over this long
const PIECE_GRAVITY = 0.0021; // px per ms², logical px
const TRAIL_MS = [18, 36, 54]; // a fast row's afterimages, ms behind it
const CALLOUT_MS = 1600; // a new pressure's callout stays this long (the callout's own duration)
const DEATH_BEAT_MS = 500; // pause before the game-over zoom-out
const DEATH_ZOOM_MS = 900; // zoom-out duration
const MIN_TAP_INTERVAL_MS = 130; // client-side guard (> WS 110ms abuse floor)

const RESTART_GRACE_PERIOD = 500;

// The shell's first-frame hint and ? sheet (docs/design/tixy-rebrand/SHELL.md).
const HINT: GameHint = { touch: 'Tap to drop.', pointer: 'Press space or click to drop.' };
const HOW_TO: GameHowTo = {
  lines: [
    'Drop the moving block on the tower, and whatever hangs over falls off.',
    `A full miss ends the run, and the blocks get faster from height ${STACK2_FAST_FROM} and narrower from ${STACK2_NARROW_FROM}.`,
    `A height of 40 pays ${stackRunTickets(40)} tickets, and 100 pays ${stackRunTickets(100)}.`,
  ],
  picture: <HowToPicture />,
};

/** The ? sheet's picture for endless: the tower of tri-tone slabs as the
 *  canvas draws them (drawIsoBox), the new slab landing a little off, and
 *  its overhang falling. */
function HowToPicture() {
  const FACE = { front: '#EE9A2C', top: '#F5BE6E', side: '#C47A20' };
  const H = 7;
  const DX = 7;
  const DY = 3.7;
  const slab = (x: number, top: number, w: number, key: string, tilt?: string) => (
    <g key={key} transform={tilt}>
      <rect x={x} y={top} width={w} height={H} fill={FACE.front} />
      <path d={`M${x},${top} l${DX},${-DY} h${w} l${-DX},${DY} Z`} fill={FACE.top} />
      <path d={`M${x + w},${top} l${DX},${-DY} v${H} l${-DX},${DY} Z`} fill={FACE.side} />
    </g>
  );
  const rows = Array.from({ length: 7 }, (_, i) => slab(54, 92 - (i + 1) * H, 46, `r${i}`));
  return (
    <svg viewBox='0 0 160 100' width={320} height={200} role='img' aria-label='A tower of amber slabs; the top slab landed a little to the left and its overhang falls.'>
      <rect width='160' height='100' fill='#1C1D18' />
      {rows}
      {slab(54, 92 - 8 * H, 40, 'top')}
      {slab(48, 92 - 8 * H, 6, 'over', 'rotate(-24 50 40) translate(-6 14)')}
      <text x='80' y='22' textAnchor='middle' fontSize='18' fontWeight='800' fill='#F4EBDC' style={{ fontFamily: "var(--font-big-shoulders, 'Big Shoulders'), sans-serif" }}>
        8
      </text>
    </svg>
  );
}

/** Pointer and key events carry epoch or timeOrigin stamps depending on the
 *  browser; put them on the performance.now() clock. */
const eventTime = (timeStamp: number | undefined) => {
  if (timeStamp === undefined || !Number.isFinite(timeStamp) || timeStamp <= 0) return performance.now();
  return timeStamp > 1e12 ? timeStamp - performance.timeOrigin : timeStamp;
};

/** The run's reward note while signed out. The result checks for this exact value. */
const GUEST_RUN_MESSAGE = 'Sign in to save scores and earn tickets.';

const getSubmitErrorMessage = (
  status: number,
  data: { error?: string; details?: string; retryAfterSec?: number } | null,
) => {
  if (status === 429) {
    const retry =
      typeof data?.retryAfterSec === 'number'
        ? ` Try again in ${data.retryAfterSec}s.`
        : '';
    return `${data?.error ?? 'Too many runs.'}${retry}`;
  }
  if (typeof data?.details === 'string' && data.details.trim()) {
    return data.details;
  }
  if (typeof data?.error === 'string' && data.error.trim()) {
    return data.error;
  }
  return 'Could not save your run. Try again.';
};

// ── Color helpers (render-only) ──────────────────────────────────────────────
type Hsl = { h: number; s: number; l: number };

const clamp = (v: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, v));

const rgbToHsl = (r: number, g: number, b: number): Hsl => {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l: l * 100 };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return { h: h * 360, s: s * 100, l: l * 100 };
};

/** Parse #rgb/#rrggbb, rgb()/rgba(), or hsl()/hsla() into HSL. */
const parseColorToHsl = (input: string, fallback: Hsl): Hsl => {
  const str = (input || '').trim();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(str);
  if (hex) {
    let raw = hex[1]!;
    if (raw.length === 3) raw = raw.split('').map((c) => c + c).join('');
    return rgbToHsl(
      parseInt(raw.slice(0, 2), 16),
      parseInt(raw.slice(2, 4), 16),
      parseInt(raw.slice(4, 6), 16),
    );
  }
  const rgb = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i.exec(str);
  if (rgb) {
    return rgbToHsl(Number(rgb[1]), Number(rgb[2]), Number(rgb[3]));
  }
  const hsl = /^hsla?\(\s*([\d.]+)(?:deg)?[,\s]+([\d.]+)%[,\s]+([\d.]+)%/i.exec(
    str,
  );
  if (hsl) {
    return { h: Number(hsl[1]), s: Number(hsl[2]), l: Number(hsl[3]) };
  }
  return fallback;
};

const hslCss = (c: Hsl, alpha = 1, dL = 0, dS = 0) =>
  `hsla(${c.h.toFixed(1)}, ${clamp(c.s + dS, 0, 100).toFixed(1)}%, ${clamp(
    c.l + dL,
    0,
    100,
  ).toFixed(1)}%, ${alpha})`;

/** HSL to #rrggbb, for a skin set's pieces (the canvas shapes read hex). */
const hslToHex = (c: Hsl, dL = 0): string => {
  const h = c.h / 360;
  const sat = clamp(c.s, 0, 100) / 100;
  const l = clamp(c.l + dL, 0, 100) / 100;
  const q = l < 0.5 ? l * (1 + sat) : l + sat - l * sat;
  const p = 2 * l - q;
  const channel = (t: number) => {
    const k = (t + 1) % 1;
    if (k < 1 / 6) return p + (q - p) * 6 * k;
    if (k < 1 / 2) return q;
    if (k < 2 / 3) return p + (q - p) * (2 / 3 - k) * 6;
    return p;
  };
  const hex = (v: number) => Math.round(clamp(v, 0, 1) * 255).toString(16).padStart(2, '0');
  return `#${hex(channel(h + 1 / 3))}${hex(channel(h))}${hex(channel(h - 1 / 3))}`;
};

/** Lerp two HSL colors, taking the shortest hue path. */
const lerpHsl = (a: Hsl, b: Hsl, t: number): Hsl => {
  let dh = b.h - a.h;
  if (dh > 180) dh -= 360;
  if (dh < -180) dh += 360;
  return {
    h: (a.h + dh * t + 360) % 360,
    s: a.s + (b.s - a.s) * t,
    l: a.l + (b.l - a.l) * t,
  };
};

const easeOutCubic = (t: number) => 1 - Math.pow(1 - clamp(t, 0, 1), 3);

// ── Render-only entity types ─────────────────────────────────────────────────
/** A falling sliced-off piece (world coords: y is "no-camera" screen space).
 *  Its path is a function of time since `t0`: px per ms, radians per ms. */
type Piece = {
  x: number;
  y: number; // world top y at t0
  w: number;
  vx: number;
  vy: number;
  vr: number;
  t0: number;
  color: Hsl;
  /** The whole block on a miss: it doesn't fade, it falls out of shot. */
  whole?: boolean;
};
/** Expanding white outline ring on a PERFECT drop. */
type Ring = { cx: number; cy: number; w: number; h: number; t0: number };
/** Brief white flash on a landed block. */
type Flash = { row: number; left: number; width: number; t0: number };
/** Squash on a landed block, and the slide into line on a perfect. */
type Landing = { row: number; t0: number; force: number; fromLeft: number; fromWidth: number };
/** A new pressure, named over the stage for a moment. */
type Callout = { text: string; t0: number };

/** `modeSwitch` draws stacker's mode switch in the strip (page.tsx); it is
 *  locked while a run is on. Nothing else about endless depends on it. */
export default function StackClient({
  modeSwitch,
}: { modeSwitch?: (locked: boolean) => ReactNode } = {}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  type GameState = 'idle' | 'playing' | 'dying' | 'gameover' | 'error';
  const [gameState, setGameState] = useState<GameState>('idle');
  const [score, setScore] = useState(0);
  const [streak, setStreak] = useState(0);
  const [runPerfects, setRunPerfects] = useState(0);
  const [runBestStreak, setRunBestStreak] = useState(0);
  const [highScore, setHighScore] = useState(0);
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const [walletBalances, setWalletBalances] = useState({ credits: 0 });
  // The daily cap still comes back with each save; the shell doesn't show it.
  const [, setDailyCreditsProgress] = useState({ earned: 0, cap: 300 });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [runRewardMessage, setRunRewardMessage] = useState<string | null>(null);
  const [, setRunRewardIsCapHit] = useState(false);
  const [, setRunAccountXp] = useState<AccountXpReward | null>(null);
  const { result: runResult, capture: captureRunResult, reset: resetRunResult } = useArcadeRunResult();
  const [startError, setStartError] = useState<string | null>(null);
  const [isStartingSession, setIsStartingSession] = useState(false);
  const [banUntilMs, setBanUntilMs] = useState<number | null>(null);
  const [banIndefinite, setBanIndefinite] = useState(false);
  const [banNowMs, setBanNowMs] = useState(Date.now());
  const [leaderboardRefreshKey, setLeaderboardRefreshKey] = useState(0);
  const [theme, setTheme] = useState<StackCosmeticTheme>(DEFAULT_STACK_THEME);
  // Reduced motion follows the OS, through the feel kit.
  const reducedMotion = useFeelReducedMotion();
  // Sound, haptics and shake (FEEL.md). The canvas reads shakeOffset().
  const { trigger, shakeOffset } = useGameFeedback();
  const ladder = usePitchLadder();
  const [canvasSize, setCanvasSize] = useState({
    width: BASE_WIDTH,
    height: BASE_HEIGHT,
    dpr: 1,
  });

  // ── Refs (mutable, no re-render): the whole sim lives here ────────────────
  const gameStateRef = useRef<GameState>('idle');
  const sessionTokenRef = useRef<string | null>(null);
  const envMonitorRef = useRef(new EnvMonitor());
  const wsRef = useRef<GameWsHandle | null>(null);
  const animationRef = useRef<number>(0);
  const gameStartTimeRef = useRef(0);
  const frameIntervalRef = useRef(1000 / 60);
  const scaleRef = useRef(1);
  const scoreRef = useRef(0);
  const isStartingRef = useRef(false);
  const isGuestRunRef = useRef(false);
  const gameOverTimeRef = useRef<number>(0);
  const saveScoreRef = useRef<((score: number) => Promise<void>) | null>(null);
  const themeRef = useRef<StackCosmeticTheme>(DEFAULT_STACK_THEME);
  const reducedMotionRef = useRef(false);

  // The run (shared rules from stack-replay.ts). Drops are scored here, at
  // their own event time, the moment they happen.
  const simRef = useRef<StackRunState>(createStackRun());
  // Landed tower rows for rendering: [left, width] per row (row 0 = base slab).
  const towerRef = useRef<Array<{ left: number; width: number }>>([]);
  // Every drop sent this run, ms since the run began (what the route replays).
  const dropsRef = useRef<number[]>([]);
  const lastDropTRef = useRef(-Infinity);

  // Render-only state (NEVER read by the rules).
  const piecesRef = useRef<Piece[]>([]);
  const ringsRef = useRef<Ring[]>([]);
  const flashesRef = useRef<Flash[]>([]);
  const landingsRef = useRef<Landing[]>([]);
  const calloutRef = useRef<Callout | null>(null);
  const cameraRef = useRef(0); // smoothed downward shift as the tower rises
  const paletteRef = useRef<Hsl[]>([]); // hue-drift gradient endpoints
  const dyingStartRef = useRef(0);
  const deathCamRef = useRef(0);
  const lastFrameAtRef = useRef(0);
  const perfRef = useRef(false);

  useEffect(() => {
    themeRef.current = theme;
  }, [theme]);
  // A skin set's sound tint colours this game's cues while it is open.
  const skinSound = theme.skin?.sound ?? 'house';
  useEffect(() => {
    SoundManager.setTint(skinSound);
    return () => SoundManager.setTint('house');
  }, [skinSound]);
  useEffect(() => {
    reducedMotionRef.current = reducedMotion;
  }, [reducedMotion]);

  const bestScoreCacheRef = useRef<number | null>(null);

  const fetchUserBestScore = useCallback(async () => {
    if (bestScoreCacheRef.current !== null) {
      setHighScore(bestScoreCacheRef.current);
      return;
    }
    try {
      const response = await fetch('/api/games/stack/score', {
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
      const response = await fetch('/api/store/inventory?gameType=stack', {
        cache: 'no-store',
      });
      if (!response.ok) {
        setTheme(resolveMidwayStackTheme());
        return;
      }
      const payload = (await response.json()) as InventoryCosmeticResponse;
      setWalletBalances({ credits: payload.wallet?.credits ?? 0 });
      setDailyCreditsProgress({
        earned: payload.dailyGameCredits?.earned ?? 0,
        cap: payload.dailyGameCredits?.cap ?? 300,
      });
      setTheme(buildStackTheme(payload));
    } catch {
      /* wallet is non-essential; still resolve the on-theme default */
      setTheme(resolveMidwayStackTheme());
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

  const saveScore = async (finalScore: number) => {
    if (isGuestRunRef.current) {
      setRunRewardMessage(GUEST_RUN_MESSAGE);
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
      const response = await fetch('/api/games/stack/score', {
        method: 'POST',
        keepalive: true,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          score: finalScore,
          rules: STACK_RULES_VERSION,
          sessionToken: sessionTokenRef.current,
          clientDurationMs: Math.max(
            0,
            performance.now() - gameStartTimeRef.current,
          ),
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
        const reason = errData?.details || errData?.error || `HTTP ${response.status}`;
        console.error(`[Stack] Score rejected (${response.status}): ${reason}`);
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
                  (Number.isFinite(awardedCredits) ? Math.max(0, awardedCredits) : 0),
              ),
        }));
        if (Number.isFinite(awardedCredits) && awardedCredits > 0) {
          setRunRewardMessage(`+${awardedCredits} tickets this run.`);
          setRunRewardIsCapHit(false);
        } else if (wantedCredits > 0 && capRemaining <= 0) {
          setRunRewardMessage('Daily ticket cap reached. No tickets this run.');
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
      setSubmitError('Could not save your run. Try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  saveScoreRef.current = saveScore;

  // ── Palette (hue-drift gradient; render-only randomness) ──────────────────
  const seedPalette = () => {
    const t = themeRef.current;
    paletteRef.current = [
      parseColorToHsl(t.toneAFace, { h: 33, s: 87, l: 59 }),
      parseColorToHsl(t.toneBFace, { h: 172, s: 60, l: 45 }),
    ];
  };

  const ensurePalette = (count: number) => {
    const p = paletteRef.current;
    if (p.length === 0) seedPalette();
    while (paletteRef.current.length < count) {
      const last = paletteRef.current[paletteRef.current.length - 1]!;
      paletteRef.current.push({
        h: (last.h + 40 + Math.random() * 140) % 360,
        s: 45 + Math.random() * 30,
        l: 50 + Math.random() * 15,
      });
    }
  };

  /** Color of tower layer `i` — lerped along the rolling gradient. */
  const layerColor = (i: number): Hsl => {
    // A skin set is flat: two tones, row by row, no hue drift.
    if (themeRef.current.skin) {
      const t = themeRef.current;
      return parseColorToHsl(i % 2 === 0 ? t.toneAFace : t.toneBFace, { h: 0, s: 0, l: 50 });
    }
    const seg = Math.floor(i / PALETTE_SEGMENT);
    ensurePalette(seg + 2);
    const p = paletteRef.current;
    return lerpHsl(p[seg]!, p[seg + 1]!, (i % PALETTE_SEGMENT) / PALETTE_SEGMENT);
  };

  // ── Projection helpers ─────────────────────────────────────────────────────
  /** World top-y of a row's front face (add cameraRef for screen y). */
  const rowTopWorld = (row: number) => BASELINE_Y - (row + 1) * BLOCK_HEIGHT;

  /**
   * Draw one flat-shaded 2.5D box: bright top face, mid front face, dark right
   * side face — the tri-tone Stack look. `x`/`top` are screen coords of the
   * front face; pass a css color to override the tri-tone (used for flashes).
   */
  const drawIsoBox = (
    ctx: CanvasRenderingContext2D,
    x: number,
    top: number,
    width: number,
    color: Hsl,
    overrideCss?: string,
    alpha = 1,
  ) => {
    const left = x + ISO_SHIFT_X;
    ctx.save();
    // Equipped 'effects' cosmetics can enable a block glow (e.g. Prism Stack).
    // Stock themes keep this off, so the default look stays calm and flat.
    if (themeRef.current.blockGlowEnabled) {
      ctx.shadowColor = themeRef.current.blockGlowColor;
      ctx.shadowBlur = themeRef.current.blockGlowSize;
    }
    ctx.globalAlpha = alpha;
    // Front face (mid tone). A skin set draws it in its signature shape.
    const skin = themeRef.current.skin;
    if (skin && !overrideCss) {
      drawSkinPiece(ctx, skin, left, top, width, BLOCK_HEIGHT, hslToHex(color, -4));
    } else {
      ctx.fillStyle = overrideCss ?? hslCss(color, 1, -4);
      ctx.fillRect(left, top, width, BLOCK_HEIGHT);
    }
    // Top face (brightest).
    ctx.fillStyle = overrideCss ?? hslCss(color, 1, 12, -4);
    ctx.beginPath();
    ctx.moveTo(left, top);
    ctx.lineTo(left + DEPTH_X, top - DEPTH_Y);
    ctx.lineTo(left + width + DEPTH_X, top - DEPTH_Y);
    ctx.lineTo(left + width, top);
    ctx.closePath();
    ctx.fill();
    // Right side face (darkest).
    ctx.fillStyle = overrideCss ?? hslCss(color, 1, -16, -6);
    ctx.beginPath();
    ctx.moveTo(left + width, top);
    ctx.lineTo(left + width + DEPTH_X, top - DEPTH_Y);
    ctx.lineTo(left + width + DEPTH_X, top - DEPTH_Y + BLOCK_HEIGHT);
    ctx.lineTo(left + width, top + BLOCK_HEIGHT);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  };

  // ── Scene ──────────────────────────────────────────────────────────────────
  const drawScene = (ctx: CanvasRenderingContext2D, frameNow: number) => {
    const t = themeRef.current;
    const reduced = reducedMotionRef.current;
    const sim = simRef.current;
    const state = gameStateRef.current;

    // Background: theme gradient drifting toward a muted, darker version of
    // the current layer hue as the tower rises (respects equipped 'background'
    // cosmetics — their colors stay the blend base).
    const drift = layerColor(sim.height);
    const driftAmt = clamp(sim.height / 45, 0, 0.55);
    const bgTopBase = parseColorToHsl(t.screenTop, { h: 150, s: 20, l: 14 });
    const bgBotBase = parseColorToHsl(t.screenBottom, { h: 150, s: 17, l: 7 });
    const bgTop = lerpHsl(
      bgTopBase,
      { h: drift.h, s: drift.s * 0.42, l: 17 },
      driftAmt,
    );
    const bgBot = lerpHsl(
      bgBotBase,
      { h: (drift.h + 24) % 360, s: drift.s * 0.35, l: 7 },
      driftAmt,
    );
    if (t.skin) {
      // A skin set's material: flat and hard-edged, still while the tower rises.
      drawSkinMaterial(ctx, t.skin, BASE_WIDTH, BASE_HEIGHT, 60, 0, 0, {
        x: 16,
        y: 16,
        w: BASE_WIDTH - 32,
        h: BASE_HEIGHT - 32,
      });
    } else {
      const bg = ctx.createLinearGradient(0, 0, 0, BASE_HEIGHT);
      bg.addColorStop(0, hslCss(bgTop));
      bg.addColorStop(1, hslCss(bgBot));
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, BASE_WIDTH, BASE_HEIGHT);
    }

    // Optional background accent (equipped 'background' skins only).
    if (t.bgAccent) {
      const accent = ctx.createRadialGradient(
        BASE_WIDTH / 2,
        BASE_HEIGHT * 0.18,
        0,
        BASE_WIDTH / 2,
        BASE_HEIGHT * 0.18,
        BASE_WIDTH * 0.75,
      );
      accent.addColorStop(0, t.bgAccent);
      accent.addColorStop(1, 'transparent');
      ctx.save();
      ctx.globalAlpha = 0.24;
      ctx.fillStyle = accent;
      ctx.fillRect(0, 0, BASE_WIDTH, BASE_HEIGHT);
      ctx.restore();
    }

    // ── Camera + game-over zoom ──
    const height = sim.height;
    const dt = clamp(frameNow - lastFrameAtRef.current, 0, 100);
    let zoom = 1;
    if (state === 'dying' || state === 'gameover') {
      // Zoom out to frame the whole tower (the trophy shot).
      const towerPx = Math.max(1, height) * BLOCK_HEIGHT + DEPTH_Y + 60;
      const zFit = Math.min(1, (BASE_HEIGHT - 180) / towerPx);
      const camFit = BASE_HEIGHT / 2 - (BASELINE_Y - (height * BLOCK_HEIGHT) / 2);
      const elapsed = frameNow - dyingStartRef.current;
      const k = reduced
        ? elapsed > 120 ? 1 : 0
        : easeOutCubic((elapsed - DEATH_BEAT_MS) / DEATH_ZOOM_MS);
      cameraRef.current = deathCamRef.current + (camFit - deathCamRef.current) * k;
      zoom = 1 + (zFit - 1) * k;
    } else {
      // Keep the moving row at a fixed anchor once the tower is tall enough
      // (rows render at world y + shift). The mover occupies tower index
      // height + 1, hence the +2. The camera eases on wall time, so it moves
      // the same at 60 and 144 Hz; reduced motion jumps.
      const target = Math.max(0, (height + 2) * BLOCK_HEIGHT - CAMERA_ANCHOR);
      if (reduced) cameraRef.current = target;
      else cameraRef.current += (target - cameraRef.current) * (1 - Math.exp(-dt / CAMERA_TAU_MS));
    }
    // The camera shift moves rows DOWN as the tower grows; during the death
    // zoom it interpolates toward the tower-centering shift instead.
    const shift = cameraRef.current;
    const yFor = (row: number) => rowTopWorld(row) + shift;

    ctx.save();
    // A break shakes the camera (2 to 4 px, none under reduced motion).
    const jolt = shakeOffset(frameNow);
    if (jolt.x !== 0 || jolt.y !== 0) ctx.translate(jolt.x, jolt.y);
    if (zoom !== 1) {
      ctx.translate(BASE_WIDTH / 2, BASE_HEIGHT / 2);
      ctx.scale(zoom, zoom);
      ctx.translate(-BASE_WIDTH / 2, -BASE_HEIGHT / 2);
    }

    // ── Tower rows (bottom → top) ──
    const tower = towerRef.current;
    const landings = landingsRef.current;
    const flashes = flashesRef.current;
    const minY = -BLOCK_HEIGHT * 3 - (zoom < 1 ? BASE_HEIGHT / zoom : 0);
    const maxY = BASE_HEIGHT + BLOCK_HEIGHT * 2 + (zoom < 1 ? BASE_HEIGHT / zoom : 0);
    for (let i = 0; i < tower.length; i++) {
      const y = yFor(i);
      if (y > maxY || y < minY) continue;
      let left = tower[i]!.left;
      let width = tower[i]!.width;
      let scaleX = 1;
      let scaleY = 1;
      const landing = reduced ? undefined : landings.find((l) => l.row === i);
      if (landing) {
        const since = frameNow - landing.t0;
        // A perfect slides its last few px into line (and grows back, from
        // the fifth in a row) on the settle curve.
        const k = settleEase(clamp(since / SNAP_MS, 0, 1));
        left = landing.fromLeft + (left - landing.fromLeft) * k;
        width = landing.fromWidth + (width - landing.fromWidth) * k;
        // The landing squash: wide and low, then a spring back.
        ({ scaleX, scaleY } = squashAt(since, { force: landing.force, reduced: false }));
      }
      const squashed = scaleX !== 1 || scaleY !== 1;
      if (squashed) {
        const cx = left + width / 2 + ISO_SHIFT_X + DEPTH_X / 2;
        ctx.save();
        ctx.translate(cx, y + BLOCK_HEIGHT);
        ctx.scale(scaleX, scaleY);
        ctx.translate(-cx, -(y + BLOCK_HEIGHT));
      }
      drawIsoBox(ctx, left, y, width, layerColor(i));
      // The landing flash rides the same slide and squash as its row.
      const flash = flashes.find((f) => f.row === i);
      if (flash) {
        const k = clamp((frameNow - flash.t0) / FLASH_MS, 0, 1);
        if (k < 1) {
          drawIsoBox(ctx, left, y, width, { h: 0, s: 0, l: 100 }, `rgba(255,255,255,${(0.75 * (1 - k)).toFixed(3)})`);
        }
      }
      if (squashed) ctx.restore();
    }

    // ── Moving slab (sweeping at the next row) ──
    if (state === 'playing') {
      const row = stackRow(height);
      const width = stackMoverWidth(sim);
      // Drawn for the moment this frame reaches the screen, about one frame
      // from now, so the block on screen is where a tap would land it.
      const runMs =
        frameNow - gameStartTimeRef.current + stackerDisplayLeadMs(frameIntervalRef.current);
      const elapsed = Math.max(0, runMs - sim.rowStartMs);
      const moverY = yFor(height + 1);
      const moverColor = layerColor(height + 1);
      if (row.fast && !reduced) {
        // A fast row leaves afterimages, so you can see it's fast before it bites.
        for (let k = TRAIL_MS.length - 1; k >= 0; k--) {
          const back = elapsed - TRAIL_MS[k]!;
          if (back <= 0) continue;
          drawIsoBox(
            ctx,
            stackMoverLeft(row, width, back),
            moverY,
            width,
            moverColor,
            undefined,
            0.2 * (1 - k / TRAIL_MS.length),
          );
        }
      }
      // The tower includes the base row, so the top placed row sits at index
      // `height` and the sweeping slab hovers one row above it.
      const moverLeft = stackMoverLeft(row, width, elapsed);
      drawIsoBox(ctx, moverLeft, moverY, width, moverColor);
      if (perfRef.current) {
        const w = window as unknown as { __stackFrames?: number[][] };
        const frames = (w.__stackFrames ??= []);
        if (frames.length < 20000) frames.push([frameNow, runMs, height, moverLeft]);
      }
    }

    // ── Falling pieces (world space). Each is a function of time since it
    // let go: gravity, drift and spin, and an overhang fades as it falls. ──
    const pieces = piecesRef.current;
    const overrideCss = t.particleColor || t.sliceColor || undefined;
    for (let i = pieces.length - 1; i >= 0; i--) {
      const p = pieces[i]!;
      const ms = Math.max(0, frameNow - p.t0);
      const sy = p.y + p.vy * ms + 0.5 * PIECE_GRAVITY * ms * ms + shift;
      const alpha = p.whole
        ? 1
        : 1 - clamp((ms - PIECE_FADE_MS * 0.3) / (PIECE_FADE_MS * 0.7), 0, 1);
      if (alpha <= 0 || sy > BASE_HEIGHT + 260 + (zoom < 1 ? BASE_HEIGHT / zoom : 0)) {
        pieces.splice(i, 1);
        continue;
      }
      const cx = p.x + p.vx * ms + p.w / 2 + ISO_SHIFT_X + DEPTH_X / 2;
      const cy = sy + BLOCK_HEIGHT / 2;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(p.vr * ms);
      drawIsoBox(ctx, -p.w / 2 - ISO_SHIFT_X - DEPTH_X / 2, -BLOCK_HEIGHT / 2, p.w, p.color, overrideCss, alpha);
      ctx.restore();
    }

    // ── PERFECT rings (expanding white outline) ──
    const rings = ringsRef.current;
    for (let i = rings.length - 1; i >= 0; i--) {
      const r = rings[i]!;
      const k = clamp((frameNow - r.t0) / RING_MS, 0, 1);
      if (k >= 1) {
        rings.splice(i, 1);
        continue;
      }
      const grow = reduced ? 1 : 1 + 0.7 * easeOutCubic(k);
      const w = r.w * grow;
      const h = r.h * grow;
      ctx.save();
      ctx.globalAlpha = (1 - k) * 0.9;
      ctx.strokeStyle = t.perfectFlashColor;
      ctx.lineWidth = 3;
      ctx.strokeRect(r.cx - w / 2, r.cy + shift - h / 2, w, h);
      ctx.restore();
    }

    // Expire finished flashes and landings.
    for (let i = flashes.length - 1; i >= 0; i--) {
      if (frameNow - flashes[i]!.t0 >= FLASH_MS) flashes.splice(i, 1);
    }
    landingsRef.current = landings.filter((l) => frameNow - l.t0 < Math.max(SNAP_MS, 240));

    ctx.restore();

    // ── A new pressure, named for a moment under the score: the tixy
    // callout plate, drawn on the canvas ──
    const callout = calloutRef.current;
    if (callout && state === 'playing') {
      const ms = frameNow - callout.t0;
      const life = calloutLifeMs(reduced, CALLOUT_MS);
      if (ms >= life) {
        calloutRef.current = null;
      } else {
        // Under the score and the perfect line, clear of both.
        drawCanvasCallout(ctx, readCanvasCalloutLook(ctx.canvas), {
          text: callout.text,
          x: BASE_WIDTH / 2,
          y: 205,
          u: ms / life,
          reducedMotion: reduced,
        });
      }
    }
  };

  // ── Drop feedback (render, sound and haptics only; the rules already
  // decided). `at` is the drop's time on the frame clock. ────────────────────
  const onDropResolved = (outcome: StackDropResult, at: number) => {
    const sim = simRef.current;
    const reduced = reducedMotionRef.current;

    if (outcome.kind === 'miss') {
      // The whole slab falls; the run ends. It falls from the mover's row,
      // one above the top tower row.
      if (!reduced) {
        const side = outcome.movingLeft + outcome.movingWidth / 2 < sim.left + sim.width / 2 ? -1 : 1;
        piecesRef.current.push({
          x: outcome.movingLeft,
          y: rowTopWorld(sim.height + 1),
          w: outcome.movingWidth,
          vx: side * 0.036,
          vy: 0.036,
          vr: side * 0.0021,
          t0: at,
          color: layerColor(sim.height + 1),
          whole: true,
        });
      }
      ladder.reset();
      SoundManager.play('stackMiss');
      trigger('loss', { motion: false, sound: false, haptic: true });
      return;
    }

    // Tower index of the row we just placed: the base occupies index 0, so
    // after the drop increments height the new row lands at `height`.
    const row = sim.height;
    towerRef.current.push({ left: outcome.left, width: outcome.width });
    scoreRef.current = sim.height;
    setScore(sim.height);
    setRunPerfects(sim.perfects);
    setRunBestStreak(sim.bestStreak);

    if (outcome.kind === 'perfect') {
      setStreak(outcome.streak);
      landingsRef.current.push({
        row,
        t0: at,
        force: 0.45,
        fromLeft: outcome.movingLeft,
        fromWidth: outcome.movingWidth,
      });
      // Expanding outline ring, a white flash and a chime one semitone up.
      ringsRef.current.push({
        cx: outcome.left + outcome.width / 2 + ISO_SHIFT_X + DEPTH_X / 2,
        cy: rowTopWorld(row) + (BLOCK_HEIGHT - DEPTH_Y) / 2,
        w: outcome.width + DEPTH_X + 10,
        h: BLOCK_HEIGHT + DEPTH_Y + 10,
        t0: at,
      });
      flashesRef.current.push({ row, left: outcome.left, width: outcome.width, t0: at });
      SoundManager.play('stackPerfect', { pitch: ladder.next() });
      trigger('combo', { motion: false, sound: false, haptic: true });
    } else {
      // A cut: a thock, and the overhang falls away and fades.
      setStreak(0);
      ladder.reset();
      landingsRef.current.push({ row, t0: at, force: 0.3, fromLeft: outcome.left, fromWidth: outcome.width });
      if (outcome.sliceWidth > 0.5) {
        if (!reduced) {
          piecesRef.current.push({
            x: outcome.sliceLeft,
            y: rowTopWorld(row),
            w: outcome.sliceWidth,
            vx: outcome.sliceSide * (0.03 + Math.random() * 0.05),
            vy: -0.04 - Math.random() * 0.05,
            vr: outcome.sliceSide * (0.0012 + Math.random() * 0.0018),
            t0: at,
            color: layerColor(row),
          });
        }
        // A big break shakes the stage a little; a sliver doesn't.
        const force = clamp((outcome.sliceWidth - 12) / 90, 0, 1);
        trigger('impact', { motion: false, sound: false, shake: force > 0 ? force : undefined, haptic: true });
      } else {
        trigger('collect', { motion: false, sound: false, haptic: true });
      }
      SoundManager.play('stackPlace');
    }

    // The next row's rules: name a pressure when it arrives, and trim a
    // block that is wider than the new limit. The trim falls off the end at
    // the wall, clear of the tower.
    const next = stackRow(sim.height);
    const before = stackRow(sim.height - 1);
    if (sim.height === STACK2_FAST_FROM + 1) {
      calloutRef.current = { text: 'fast rows', t0: at };
    }
    if (next.limit < before.limit) {
      calloutRef.current = { text: 'narrow blocks', t0: at };
    }
    const trim = sim.width - next.limit;
    if (trim > 0.5 && !reduced) {
      const startLeft = stackMoverLeft(next, next.limit, 0);
      piecesRef.current.push({
        x: next.dir === 1 ? startLeft - trim : startLeft + next.limit,
        y: rowTopWorld(sim.height + 1),
        w: trim,
        vx: -next.dir * 0.04,
        vy: -0.03,
        vr: -next.dir * 0.002,
        t0: at,
        color: layerColor(sim.height + 1),
      });
    }
  };

  const beginDeath = (frameNow: number) => {
    wsRef.current?.close();
    gameStateRef.current = 'dying';
    setGameState('dying');
    dyingStartRef.current = frameNow;
    deathCamRef.current = cameraRef.current;
    setHighScore((prev) => Math.max(prev, scoreRef.current));
    saveScoreRef.current?.(scoreRef.current);
  };

  const drawSceneScaled = (
    ctx: CanvasRenderingContext2D,
    frameNow: number,
  ) => {
    ctx.save();
    ctx.setTransform(scaleRef.current, 0, 0, scaleRef.current, 0, 0);
    drawScene(ctx, frameNow);
    ctx.restore();
  };

  // ── Main loop: draws every frame at the display's rate. The rules need no
  // stepping; a drop is scored by its handler, at its own time. ──────────────
  const gameLoop = useCallback((frameNow: number) => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    const previous = lastFrameAtRef.current;
    if (previous > 0 && frameNow - previous > 0 && frameNow - previous < 100) {
      frameIntervalRef.current = frameIntervalRef.current * 0.8 + (frameNow - previous) * 0.2;
    }

    if (gameStateRef.current === 'dying') {
      const elapsed = frameNow - dyingStartRef.current;
      const total = reducedMotionRef.current
        ? 260
        : DEATH_BEAT_MS + DEATH_ZOOM_MS + 150;
      if (elapsed >= total) {
        gameStateRef.current = 'gameover';
        setGameState('gameover');
        gameOverTimeRef.current = performance.now();
      }
    }

    drawSceneScaled(ctx, frameNow);
    lastFrameAtRef.current = frameNow;

    // Keep animating through the death zoom and while debris settles; stop
    // once the game-over scene is static.
    const still =
      gameStateRef.current === 'gameover' &&
      piecesRef.current.length === 0 &&
      ringsRef.current.length === 0 &&
      flashesRef.current.length === 0 &&
      performance.now() - dyingStartRef.current > 4000;
    if (gameStateRef.current === 'idle' || gameStateRef.current === 'error' || still) {
      return;
    }
    animationRef.current = requestAnimationFrame(gameLoop);
    // Fully ref-driven; intentionally stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startGame = useCallback(async () => {
    resetRunResult();
    if (isStartingRef.current) return;
    isStartingRef.current = true;
    isGuestRunRef.current = false;
    sessionTokenRef.current = null;
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
        body: JSON.stringify({ gameType: 'stack' }),
      });
      if (sessionResponse.ok) {
        setBanIndefinite(false);
        setBanUntilMs(null);
        const sessionData = await sessionResponse.json();
        sessionTokenRef.current = sessionData.token;
        // STACK is deterministic — no seed is required. Start anti-cheat + WS.
        envMonitorRef.current.start();
        try {
          wsRef.current?.close();
          wsRef.current = await connectGameWs(sessionData.token);
          wsRef.current.onDisconnect((reason) => {
            console.error('Stack socket disconnected:', reason);
            gameStateRef.current = 'error';
            setGameState('error');
            cancelAnimationFrame(animationRef.current);
          });
        } catch (error) {
          console.warn('Stack realtime channel unavailable; continuing over HTTP.', error);
          wsRef.current = null;
        }
        sessionSuccess = true;
      } else if (sessionResponse.status === 401) {
        sessionTokenRef.current = null;
        wsRef.current = null;
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
      setStartError('Could not reach the server. Try again.');
    } finally {
      isStartingRef.current = false;
      setIsStartingSession(false);
    }

    if (!sessionSuccess || (!sessionTokenRef.current && !isGuestRunRef.current)) {
      setGameState('error');
      return;
    }

    cancelAnimationFrame(animationRef.current);
    // Reset the deterministic sim + render state. Base slab centered at row 0.
    simRef.current = createStackRun();
    towerRef.current = [
      { left: simRef.current.left, width: simRef.current.width },
    ];
    dropsRef.current = [];
    lastDropTRef.current = -Infinity;
    piecesRef.current = [];
    ringsRef.current = [];
    flashesRef.current = [];
    landingsRef.current = [];
    calloutRef.current = null;
    ladder.reset();
    cameraRef.current = 0;
    seedPalette();
    scoreRef.current = 0;
    setScore(0);
    setStreak(0);
    setRunPerfects(0);
    setRunBestStreak(0);

    const now = performance.now();
    gameStartTimeRef.current = now;
    lastFrameAtRef.current = now;
    gameStateRef.current = 'playing';
    setGameState('playing');

    animationRef.current = requestAnimationFrame(gameLoop);
  }, [gameLoop, ladder, resetRunResult]);

  // The single player action: DROP, at the input event's own time. It is
  // scored now with the shared rules, sent over WS with that same time, and
  // drawn in this frame.
  const drop = useCallback((timeStamp?: number) => {
    if (gameStateRef.current === 'playing') {
      // Answer first: a haptic tap before anything is decided.
      trigger('press', { sound: false, haptic: true });
      const at = eventTime(timeStamp);
      const t = Math.max(simRef.current.rowStartMs, stackInputMs(at, gameStartTimeRef.current));
      // Guard against double-taps faster than the server's WS abuse floor so
      // every drop is also recorded server-side (replay parity).
      if (t - lastDropTRef.current < MIN_TAP_INTERVAL_MS) return;
      lastDropTRef.current = t;
      dropsRef.current.push(t);
      wsRef.current?.sendEvent('drop', { t });
      const outcome = stackDropAt(simRef.current, t);
      onDropResolved(outcome, gameStartTimeRef.current + t);
      if (simRef.current.died) beginDeath(performance.now());
      // Paint now, so the frame that shows the press shows the landing.
      const ctx = canvasRef.current?.getContext('2d');
      if (ctx) drawSceneScaled(ctx, performance.now());
    } else if (gameStateRef.current === 'idle') {
      startGame();
    } else if (gameStateRef.current === 'gameover') {
      const timeSinceGameOver = performance.now() - gameOverTimeRef.current;
      if (timeSinceGameOver >= RESTART_GRACE_PERIOD) {
        startGame();
      }
    } else if (gameStateRef.current === 'error') {
      startGame();
    }
    // onDropResolved and the drawing are ref-driven.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startGame, trigger]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if ((e.code === 'Space' || e.code === 'ArrowUp') && e.repeat) return;
      if (e.code === 'Space' || e.code === 'ArrowUp') {
        e.preventDefault();
        drop(e.timeStamp);
      }
    },
    [drop],
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      drop(e.timeStamp);
    },
    [drop],
  );

  useEffect(() => {
    return () => {
      wsRef.current?.close();
      cancelAnimationFrame(animationRef.current);
    };
  }, []);

  // Read-only introspection hook for automated play-testing. Exposes nothing
  // score-affecting: the sim is deterministic public code and every score is
  // re-verified by the server replay regardless of what the client reports.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const w = window as unknown as Record<string, unknown>;
    w.__stackTest = {
      rules: STACK_RULES_VERSION,
      get sim() {
        return { ...simRef.current };
      },
      get drops() {
        return dropsRef.current.slice();
      },
      get startedAt() {
        return gameStartTimeRef.current;
      },
      get state() {
        return gameStateRef.current;
      },
    };
    // ?arcadePerf=1: every frame's drawn block, for the smoothness check.
    perfRef.current = new URLSearchParams(window.location.search).get('arcadePerf') === '1';
    return () => {
      delete w.__stackTest;
    };
  }, []);

  // Canvas sizing: the shell's stage reports its screen size (logical
  // BASE_WIDTH×BASE_HEIGHT, scale + dpr).
  const fitCanvas = useCallback(({ width, height }: GameStageSize) => {
    const scale = Math.min(width / BASE_WIDTH, height / BASE_HEIGHT);
    const cssWidth = Math.floor(BASE_WIDTH * scale);
    const cssHeight = Math.floor(BASE_HEIGHT * scale);
    const dpr = gameCanvasDpr(cssWidth, cssHeight);
    scaleRef.current = scale * dpr;
    setCanvasSize({ width: cssWidth, height: cssHeight, dpr });
  }, []);

  // Initial / idle render — the base slab rests at the bottom of the screen
  // (camera at rest); the moving slab is never drawn outside of play, so no
  // stray bar can appear behind the start overlay.
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    if (towerRef.current.length === 0) {
      const sim = simRef.current;
      towerRef.current = [{ left: sim.left, width: sim.width }];
      cameraRef.current = 0;
      seedPalette();
    }
    if (gameStateRef.current !== 'playing' && gameStateRef.current !== 'dying') {
      drawSceneScaled(ctx, performance.now());
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvasSize, handleKeyDown, theme]);

  useEffect(() => {
    fetchUserBestScore();
  }, [fetchUserBestScore]);

  useEffect(() => {
    void loadWallet();
  }, [loadWallet]);

  // Resolve live Midway tokens once mounted so idle render is on-theme before
  // the inventory fetch (loadWallet) overlays any equipped skin.
  useEffect(() => {
    setTheme(resolveMidwayStackTheme());
  }, []);

  // Re-seed the gradient endpoints from the (possibly cosmetic) block palette
  // whenever the theme changes outside a run.
  useEffect(() => {
    if (gameStateRef.current === 'idle') seedPalette();
  }, [theme]);

  // The ban countdown ticks only while there is a ban to count down. It used
  // to tick every second for everyone, re-rendering the whole page under the
  // canvas once a second mid-run.
  useEffect(() => {
    if (!banUntilMs) return;
    setBanNowMs(Date.now());
    const timer = window.setInterval(() => setBanNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [banUntilMs]);

  useEffect(() => {
    if (!banUntilMs) return;
    if (banNowMs >= banUntilMs) {
      setBanUntilMs(null);
      setBanIndefinite(false);
    }
  }, [banNowMs, banUntilMs]);

  // The shell's phase: the first frame, the run (the death zoom included),
  // then the result or an error over the stage.
  const phase: GamePhase =
    gameState === 'idle'
      ? 'ready'
      : gameState === 'gameover' || gameState === 'error'
        ? 'over'
        : 'playing';
  const inRun = phase === 'playing';
  const isBest = score > 0 && score === highScore;

  const end =
    gameState === 'gameover' ? (
      <ArcadeRunResult
        title={isBest ? 'New best' : 'Run over'}
        tone={isBest ? 'best' : 'neutral'}
        stats={[
          { label: 'height', value: score, highlight: isBest },
          { label: 'perfect drops', value: runPerfects },
          { label: 'best streak', value: runBestStreak },
        ]}
        reward={runResult.reward}
        achievements={runResult.achievements}
        saving={isSubmitting}
        error={submitError}
        guest={runRewardMessage === GUEST_RUN_MESSAGE}
        actions={<ArcadeRematchButton onClick={() => void startGame()} />}
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
      game='stack'
      className='stack-midway'
      stat={<GameStat value={highScore} label='best' />}
      modes={modeSwitch?.(inRun)}
      howTo={HOW_TO}
      tickets={walletBalances.credits}
      below={
        <div className='flex flex-wrap items-center justify-center gap-2'>
          <GameLeaderboardButton onClick={() => setShowLeaderboard(true)} />
        </div>
      }
    >
      <GameStage
        phase={phase}
        hint={HINT}
        busy={isStartingSession ? 'Starting your run.' : null}
        onStart={() => void startGame()}
        aspect={BASE_WIDTH / BASE_HEIGHT}
        onSize={fitCanvas}
        end={end}
      >
        <canvas
          ref={canvasRef}
          width={Math.floor(canvasSize.width * canvasSize.dpr)}
          height={Math.floor(canvasSize.height * canvasSize.dpr)}
          onPointerDown={handlePointerDown}
          className='cursor-pointer'
          style={{ width: canvasSize.width, height: canvasSize.height }}
        />

        {/* live score HUD (cream numeral, hard offset shadow, no glow). The
            cream is set here: the theme's key face is dark on the tixy stage. */}
        {inRun && (
          <div className='pointer-events-none absolute inset-x-0 top-3 flex flex-col items-center'>
            <span
              className='arcade-num text-5xl font-semibold sm:text-6xl'
              style={{
                color: '#f7e7c6',
                textShadow: '2px 3px 0 rgba(8,7,4,0.85)',
              }}
            >
              {score}
            </span>
            {streak >= 2 && gameState === 'playing' && (
              <span key={streak} className='stc-perfect mt-1'>
                perfect <span className='stc-times'>×</span>
                <Num value={streak} />
              </span>
            )}
          </div>
        )}
      </GameStage>

      <GameLeaderboardModal
        open={showLeaderboard}
        onOpenChange={setShowLeaderboard}
        title='Stack board'
        description='Top runs and your rank.'
      >
        <GameLeaderboard
          gameType='stack'
          maxEntries={5}
          enableFullLeaderboardModal
          fullLeaderboardDisplay='inline'
          refreshKey={leaderboardRefreshKey}
        />
      </GameLeaderboardModal>
    </GameShell>
  );
}
