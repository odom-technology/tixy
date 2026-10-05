'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { Gem, CircleHelp } from 'lucide-react';
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
import { ArcadeRunRewards } from '@/features/arcade/components/results/arcade-run-result';
import { useArcadeRunResult } from '@/features/arcade/lib/run-result';
import type { AccountXpReward } from '@/server/arcade/rewards/types';
import { gameCanvasDpr } from '@/features/arcade/lib/game-frame-loop';
import {
  GRID,
  CELLS,
  EMPTY,
  BASE_POINTS,
  GEM_GAME_DURATION_MS,
  generateInitialBoard,
  createDrawState,
  applySwap,
  areAdjacent,
  findMatches,
  hasLegalMove,
  cascadeMultiplier,
  gemRefillColor,
  type DrawState,
  type GemSwap,
} from '@/server/arcade/gem-swap-replay';
import {
  DEFAULT_GEM_THEME,
  buildGemTheme,
  type GemCosmeticTheme,
  type GemInventoryResponse,
} from './_gem-swap-theme';

import './_gem-swap.css';
import {
  drawCanvasCallout,
  readCanvasCalloutLook,
  type CanvasCalloutTone,
} from '@/features/arcade/components/gameplay/callout-canvas';

// ── Logical playfield geometry (the canvas draws into BASE x BASE; a dpr-scaled
//    buffer keeps it crisp; pointer coords are mapped back). ──
const CELL = 40; // gem cell size (logical px)
const PAD = 10; // board frame thickness
const BASE = PAD * 2 + GRID * CELL; // 340 — square board
const GAP = 3; // inset between the cell well and its gem

const RESTART_GRACE_PERIOD = 400;

// ── Animation timings (ms). These are PURELY VISUAL — the board state + score
//    are resolved synchronously by applySwap before any frame plays. Input is
//    locked while a swap animation runs, which also guarantees consecutive
//    recorded swaps are spaced well above the server's MIN_SWAP_INTERVAL_MS. ──
const SWAP_MS = 120; // slide two gems into each other (ease-out)
const BOUNCE_MS = 150; // illegal swap: slide in then snap back
const CLEAR_MS = 180; // matched gems flash → pop
const FALL_BASE_MS = 120; // gravity floor
const FALL_PER_ROW_MS = 24; // extra per row fallen (longer drops take longer)
const FALL_MAX_MS = 320;
const RESHUFFLE_MS = 240; // crossfade when the board deterministically reshuffles
const HINT_DELAY_MS = 4200; // idle time before the hint pulse appears

const REWARDS_HINT_TEXT =
  'Rewards hint: swap two adjacent gems to line up 3+ of a colour. Matches clear for points, gems above fall, and new gems drop in — chain reactions multiply your score. Rack up as much as you can before the 60-second clock runs out. Tickets taper at higher scores.';

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

// ── Animation model ─────────────────────────────────────────────────────────
// A gem that survives a clear and settles into a lower row.
type FallMove = { col: number; color: number; fromRow: number; toRow: number };
// A freshly drawn gem dropping in from above the top edge into a vacated row.
type SpawnMove = { col: number; color: number; fromRow: number; toRow: number };

// One resolution step of a cascade — reconstructed on a COPY of the board so the
// authoritative state is never touched. `points` here is for the floating "+N"
// popups only; the real score comes from applySwap.scoreGained.
type CascadeStep = {
  depth: number; // 1-indexed chain depth (drives multiplier + SFX pitch)
  matched: number[]; // cell indices cleared this step
  matchedSet: Set<number>;
  movingSet: Set<number>; // destination cells of falls + spawns (skipped as statics)
  boardBefore: number[]; // board shown during the clear flash
  boardAfter: number[]; // settled board shown during the fall
  falls: FallMove[];
  spawns: SpawnMove[];
  clusters: { cx: number; cy: number; points: number }[];
};

type AnimPhase = {
  type: 'swap' | 'bounce' | 'clear' | 'fall' | 'reshuffle';
  step: number; // index into steps[] for clear/fall, else -1
  start: number; // ms offset from anim.startTime
  dur: number;
};

type SwapAnim = {
  kind: 'legal' | 'illegal';
  a: number;
  b: number;
  swapColorA: number;
  swapColorB: number;
  preBoard: number[];
  steps: CascadeStep[];
  finalBoard: number[]; // authoritative settled board (incl. any reshuffle)
  phases: AnimPhase[];
  startTime: number;
  totalDur: number;
  firedClears: Set<number>; // clear-step indices whose SFX/FX already fired
};

type Particle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  color: string;
  size: number;
};

// A floating "+N" or chain multiplier: the shared callout plate.
type FloatText = {
  x: number;
  y: number;
  life: number;
  max: number;
  text: string;
  tone: CanvasCalloutTone;
};

// ── Geometry helpers (cell index ↔ logical pixel) ──
const cellRowCol = (idx: number): [number, number] => [
  Math.floor(idx / GRID),
  idx % GRID,
];
const cellX = (col: number) => PAD + col * CELL;
const cellY = (row: number) => PAD + row * CELL;
const cellCenterX = (col: number) => cellX(col) + CELL / 2;
const cellCenterY = (row: number) => cellY(row) + CELL / 2;

const clamp01 = (p: number) => (p < 0 ? 0 : p > 1 ? 1 : p);
const easeOut = (p: number) => 1 - (1 - p) * (1 - p);
const easeIn = (p: number) => p * p;

const roundRectPath = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) => {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
};

// Draw a single gem centred at (cx, cy), scaled + faded. The facet highlight
// scales with the body so a popping gem stays glossy as it shrinks.
const drawGemAt = (
  ctx: CanvasRenderingContext2D,
  theme: GemCosmeticTheme,
  colorIdx: number,
  cx: number,
  cy: number,
  scale: number,
  alpha: number,
) => {
  const hex = theme.gemColors[colorIdx] ?? '#888888';
  const gs = (CELL - GAP * 2) * scale;
  if (gs <= 0.5 || alpha <= 0) return;
  const gx = cx - gs / 2;
  const gy = cy - gs / 2;
  ctx.globalAlpha = alpha;
  ctx.fillStyle = hex;
  roundRectPath(ctx, gx, gy, gs, gs, 8 * scale);
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = '#00000044';
  ctx.stroke();
  ctx.globalAlpha = alpha * 0.45;
  ctx.fillStyle = '#ffffff';
  roundRectPath(ctx, gx + gs * 0.18, gy + gs * 0.14, gs * 0.4, gs * 0.26, 5 * scale);
  ctx.fill();
  ctx.globalAlpha = 1;
};

// Gem Swap keeps its pitch ladder, but routes it through the shared mixer so
// gesture unlock, global/cross-tab mute, cooldowns, and teardown stay uniform.
const GemAudio = {
  select: () => SoundManager.play('gemSelect'),
  swap: () => SoundManager.play('gemSwap'),
  invalid: () => SoundManager.play('gemInvalid'),
  clear(depth: number) {
    const semitones = Math.min((depth - 1) * 3, 27);
    SoundManager.play('gemClear', { pitch: Math.pow(2, semitones / 12) });
  },
  gameOver: () => SoundManager.play('gemGameOver'),
};

// ── Pure animation reconstruction ───────────────────────────────────────────
// Connected-component clustering of the cleared cells (4-neighbour) so each
// distinct cleared shape gets ONE "+N" popup. Cluster points sum exactly to the
// step total (clusterSize × BASE_POINTS × mult), so popups never imply a score
// different from applySwap's.
const computeClusters = (matchedArr: number[], mult: number) => {
  const set = new Set(matchedArr);
  const seen = new Set<number>();
  const clusters: { cx: number; cy: number; points: number }[] = [];
  for (const start of matchedArr) {
    if (seen.has(start)) continue;
    const stack = [start];
    seen.add(start);
    const comp: number[] = [];
    while (stack.length) {
      const cur = stack.pop()!;
      comp.push(cur);
      const r = Math.floor(cur / GRID);
      const c = cur % GRID;
      const nbrs: number[] = [];
      if (c > 0) nbrs.push(cur - 1);
      if (c < GRID - 1) nbrs.push(cur + 1);
      if (r > 0) nbrs.push(cur - GRID);
      if (r < GRID - 1) nbrs.push(cur + GRID);
      for (const n of nbrs) {
        if (set.has(n) && !seen.has(n)) {
          seen.add(n);
          stack.push(n);
        }
      }
    }
    let sx = 0;
    let sy = 0;
    for (const idx of comp) {
      const [r, c] = cellRowCol(idx);
      sx += cellCenterX(c);
      sy += cellCenterY(r);
    }
    clusters.push({
      cx: sx / comp.length,
      cy: sy / comp.length,
      points: comp.length * BASE_POINTS * mult,
    });
  }
  return clusters;
};

// Replicates the server's collapseAndRefill EXACTLY (same column order, same
// top-down refill, same gemRefillColor draw cursor) on a copy — and additionally
// records which gems fell and which spawned, for the gravity animation. Because
// it advances `draw.index` identically, the reconstructed colours match the
// authoritative board byte-for-byte.
const localCollapseAndRefill = (board: number[], draw: DrawState) => {
  const falls: FallMove[] = [];
  const spawns: SpawnMove[] = [];
  for (let c = 0; c < GRID; c += 1) {
    const survivors: { row: number; color: number }[] = [];
    for (let r = GRID - 1; r >= 0; r -= 1) {
      const v = board[r * GRID + c]!;
      if (v !== EMPTY) survivors.push({ row: r, color: v });
    }
    const emptyCount = GRID - survivors.length;
    for (let r = 0; r < emptyCount; r += 1) {
      const color = gemRefillColor(draw.seed, draw.index);
      draw.index += 1;
      board[r * GRID + c] = color;
      // Drop in from above the board: top-most new gem starts highest.
      spawns.push({ col: c, color, toRow: r, fromRow: r - emptyCount });
    }
    for (let i = 0; i < survivors.length; i += 1) {
      const destRow = GRID - 1 - i;
      const s = survivors[i]!;
      board[destRow * GRID + c] = s.color;
      if (destRow !== s.row) {
        falls.push({ col: c, color: s.color, fromRow: s.row, toRow: destRow });
      }
    }
  }
  return { falls, spawns };
};

// Re-derive the per-step cascade keyframes for ONE swap, working entirely on a
// copy of the board + draw cursor. Mirrors applySwap's resolution loop so the
// keyframes track the authoritative board; the score itself still comes from the
// authoritative applySwap call in trySwap.
const simulateSwap = (
  preBoard: number[],
  drawBefore: DrawState,
  a: number,
  b: number,
): { steps: CascadeStep[]; reshuffled: boolean } => {
  const board = preBoard.slice();
  // Apply the player's swap first — exactly as applySwap did — so the cascade
  // reconstruction starts from the SWAPPED board. (Without this, findMatches runs
  // on the pre-swap board, finds nothing, and the clear/fall/score animation is
  // skipped entirely — the board just snaps to the result.)
  const swapTmp = board[a]!;
  board[a] = board[b]!;
  board[b] = swapTmp;
  const draw = { ...drawBefore };
  const steps: CascadeStep[] = [];
  let matched = findMatches(board);
  let depth = 0;
  while (matched.size > 0 && depth < 100) {
    depth += 1;
    const mult = cascadeMultiplier(depth);
    const matchedArr = [...matched];
    const boardBefore = board.slice();
    const clusters = computeClusters(matchedArr, mult);
    for (const idx of matched) board[idx] = EMPTY;
    const { falls, spawns } = localCollapseAndRefill(board, draw);
    const movingSet = new Set<number>();
    for (const f of falls) movingSet.add(f.toRow * GRID + f.col);
    for (const s of spawns) movingSet.add(s.toRow * GRID + s.col);
    steps.push({
      depth,
      matched: matchedArr,
      matchedSet: new Set(matchedArr),
      movingSet,
      boardBefore,
      boardAfter: board.slice(),
      falls,
      spawns,
      clusters,
    });
    matched = findMatches(board);
  }
  return { steps, reshuffled: !hasLegalMove(board) };
};

const fallDuration = (step: CascadeStep): number => {
  let maxDrop = 1;
  for (const f of step.falls) maxDrop = Math.max(maxDrop, f.toRow - f.fromRow);
  for (const s of step.spawns) maxDrop = Math.max(maxDrop, s.toRow - s.fromRow);
  return Math.min(FALL_MAX_MS, FALL_BASE_MS + maxDrop * FALL_PER_ROW_MS);
};

const buildLegalAnim = (
  a: number,
  b: number,
  preBoard: number[],
  steps: CascadeStep[],
  reshuffled: boolean,
  finalBoard: number[],
  startTime: number,
): SwapAnim => {
  const phases: AnimPhase[] = [];
  let cursor = 0;
  phases.push({ type: 'swap', step: -1, start: 0, dur: SWAP_MS });
  cursor = SWAP_MS;
  steps.forEach((step, i) => {
    phases.push({ type: 'clear', step: i, start: cursor, dur: CLEAR_MS });
    cursor += CLEAR_MS;
    const dur = fallDuration(step);
    phases.push({ type: 'fall', step: i, start: cursor, dur });
    cursor += dur;
  });
  if (reshuffled) {
    phases.push({ type: 'reshuffle', step: -1, start: cursor, dur: RESHUFFLE_MS });
    cursor += RESHUFFLE_MS;
  }
  return {
    kind: 'legal',
    a,
    b,
    // swapColorA is the gem that STARTED at a and slides to b (ends matching the
    // swapped board's cell b); swapColorB starts at b and slides to a.
    swapColorA: preBoard[a]!,
    swapColorB: preBoard[b]!,
    preBoard: (() => {
      // The board shown during the swap slide already has a/b swapped (matching
      // the first clear step's boardBefore), so statics line up seamlessly.
      const shown = preBoard.slice();
      const tmp = shown[a]!;
      shown[a] = shown[b]!;
      shown[b] = tmp;
      return shown;
    })(),
    steps,
    finalBoard,
    phases,
    startTime,
    totalDur: cursor,
    firedClears: new Set<number>(),
  };
};

const buildIllegalAnim = (
  a: number,
  b: number,
  preBoard: number[],
  startTime: number,
): SwapAnim => ({
  kind: 'illegal',
  a,
  b,
  swapColorA: preBoard[a]!,
  swapColorB: preBoard[b]!,
  preBoard: preBoard.slice(),
  steps: [],
  finalBoard: preBoard.slice(),
  phases: [{ type: 'bounce', step: -1, start: 0, dur: BOUNCE_MS }],
  startTime,
  totalDur: BOUNCE_MS,
  firedClears: new Set<number>(),
});

const getActivePhase = (anim: SwapAnim, elapsed: number): AnimPhase | null => {
  if (elapsed < 0) return anim.phases[0] ?? null;
  for (const ph of anim.phases) {
    if (elapsed >= ph.start && elapsed < ph.start + ph.dur) return ph;
  }
  return null; // past the end → caller treats the anim as finished
};

// Spawn the clear-step visual feedback: floating "+N" per cluster, a multiplier
// popup on chains, and a sparkle burst from each cleared gem.
const spawnClearFx = (
  step: CascadeStep,
  theme: GemCosmeticTheme,
  particles: Particle[],
  floats: FloatText[],
) => {
  for (const cl of step.clusters) {
    floats.push({
      x: cl.cx,
      y: cl.cy,
      life: 760,
      max: 760,
      text: `+${cl.points}`,
      tone: 'score',
    });
  }
  const mult = cascadeMultiplier(step.depth);
  if (mult > 1) {
    floats.push({
      x: PAD + (GRID * CELL) / 2,
      y: PAD + CELL * 0.85,
      life: 900,
      max: 900,
      text: `x${mult}`,
      tone: 'combo',
    });
  }
  let budget = 40;
  for (const idx of step.matched) {
    if (budget <= 0) break;
    const [r, c] = cellRowCol(idx);
    const cx = cellCenterX(c);
    const cy = cellCenterY(r);
    const color = theme.gemColors[step.boardBefore[idx]!] ?? '#ffffff';
    for (let k = 0; k < 3 && budget > 0; k += 1, budget -= 1) {
      const ang = Math.random() * Math.PI * 2;
      const spd = 0.04 + Math.random() * 0.1;
      particles.push({
        x: cx,
        y: cy,
        vx: Math.cos(ang) * spd,
        vy: Math.sin(ang) * spd - 0.03,
        life: 360 + Math.random() * 180,
        max: 540,
        color,
        size: 1.8 + Math.random() * 2.4,
      });
    }
  }
  if (particles.length > 160) particles.splice(0, particles.length - 160);
  if (floats.length > 24) floats.splice(0, floats.length - 24);
};

export default function GemSwapClient() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const [gameState, setGameState] = useState<GameState>('idle');
  const [score, setScore] = useState(0);
  const [highScore, setHighScore] = useState(0);
  const [timeLeft, setTimeLeft] = useState(GEM_GAME_DURATION_MS / 1000);
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
    width: BASE,
    height: BASE,
    dpr: 1,
  });
  const [gemTheme, setGemTheme] = useState<GemCosmeticTheme>(DEFAULT_GEM_THEME);

  usePreventGameGestures(gameState === 'playing');
  const touchDevice = useIsTouchDevice();

  // ── Refs (mutable sim state; no re-render) ──
  const gameStateRef = useRef<GameState>('idle');
  const sessionTokenRef = useRef<string | null>(null);
  const seedRef = useRef<number | null>(null);
  const envMonitorRef = useRef(new EnvMonitor());
  const scoreRef = useRef(0); // AUTHORITATIVE running score (== server replay)
  const displayScoreRef = useRef(0); // the ticking counter shown to the player
  const themeRef = useRef<GemCosmeticTheme>(DEFAULT_GEM_THEME);

  // Board + swap log. `grid` is the authoritative board (shared replay logic);
  // `swaps` is the recorded { a, b, t } log POSTed for server re-verification.
  const gridRef = useRef<number[]>([]);
  const drawRef = useRef<DrawState>(createDrawState(0));
  const swapsRef = useRef<GemSwap[]>([]);
  const selectedCellRef = useRef<number | null>(null);
  const dragStartRef = useRef<number | null>(null);

  // Animation/feedback layer (purely visual; never feeds back into the model).
  const animRef = useRef<SwapAnim | null>(null);
  const particlesRef = useRef<Particle[]>([]);
  const floatsRef = useRef<FloatText[]>([]);
  const shakeRef = useRef(0); // screen-shake magnitude (decays)
  const rimFlashRef = useRef(0); // board-rim flash on big cascades (decays)
  const hintRef = useRef<[number, number] | null>(null);
  const lastInteractionRef = useRef(0);
  const lastTickRef = useRef(0);

  const animationRef = useRef<number>(0);
  const gameStartTimeRef = useRef(0);
  const gameEndTimeRef = useRef(0);
  const lastShownSecondRef = useRef(GEM_GAME_DURATION_MS / 1000);
  const gameOverTimeRef = useRef<number>(0);
  const isStartingRef = useRef(false);
  const isGuestRunRef = useRef(false);
  const reducedMotionRef = useRef(false);
  const saveScoreRef = useRef<
    ((score: number, swaps: GemSwap[]) => Promise<void>) | null
  >(null);
  const bestScoreCacheRef = useRef<number | null>(null);

  const fetchUserBestScore = useCallback(async () => {
    if (bestScoreCacheRef.current !== null) {
      setHighScore(bestScoreCacheRef.current);
      return;
    }
    try {
      const response = await fetch('/api/games/gem-swap/score', {
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
      const response = await fetch('/api/store/inventory?gameType=gem-swap', {
        cache: 'no-store',
      });
      if (!response.ok) return;
      const payload = (await response.json()) as GemInventoryResponse;
      setWalletBalances({ credits: payload.wallet?.credits ?? 0 });
      setDailyCreditsProgress({
        earned: payload.dailyGameCredits?.earned ?? 0,
        cap: payload.dailyGameCredits?.cap ?? 300,
      });
      setGemTheme(buildGemTheme(payload));
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

  const saveScore = async (finalScore: number, swaps: GemSwap[]) => {
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
      const response = await fetch('/api/games/gem-swap/score', {
        method: 'POST',
        keepalive: true,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          score: finalScore,
          sessionToken: sessionTokenRef.current,
          swaps,
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
        const errData = data as
          | { error?: string; details?: string; retryAfterSec?: number }
          | null;
        const reason =
          errData?.details || errData?.error || `HTTP ${response.status}`;
        console.error(`[GemSwap] Score rejected (${response.status}): ${reason}`);
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

  // ── End the run (time up) ──
  const endRun = useCallback(() => {
    if (gameStateRef.current !== 'playing') return;
    GemAudio.gameOver();
    selectedCellRef.current = null;
    dragStartRef.current = null;
    animRef.current = null;
    particlesRef.current = [];
    floatsRef.current = [];
    shakeRef.current = 0;
    rimFlashRef.current = 0;
    hintRef.current = null;
    gameStateRef.current = 'gameover';
    setGameState('gameover');
    cancelAnimationFrame(animationRef.current);
    gameOverTimeRef.current = performance.now();
    setTimeLeft(0);
    // Snap the displayed counter to the authoritative total before saving.
    displayScoreRef.current = scoreRef.current;
    setScore(scoreRef.current);
    if (scoreRef.current > highScore) setHighScore(scoreRef.current);
    saveScoreRef.current?.(scoreRef.current, swapsRef.current.slice());
  }, [highScore]);

  // Attempt a swap of two cells. Uses the SHARED applySwap so the client score is
  // byte-identical to the server replay; the animation is reconstructed AFTERWARD
  // on a copy and never alters the board, score, or recorded swap.
  const trySwap = useCallback((a: number, b: number) => {
    if (gameStateRef.current !== 'playing') return;
    if (seedRef.current === null) return;
    if (animRef.current) return; // locked while a swap animation is playing
    if (!areAdjacent(a, b)) return;

    // Snapshot the pre-swap state for the animation reconstruction.
    const preBoard = gridRef.current.slice();
    const drawBefore = { ...drawRef.current };

    // ── AUTHORITATIVE: mutate the board + draw cursor + score exactly as before.
    const outcome = applySwap(gridRef.current, a, b, drawRef.current);

    if (!outcome.legal) {
      GemAudio.invalid();
      if (!reducedMotionRef.current) {
        animRef.current = buildIllegalAnim(a, b, preBoard, performance.now());
      }
      return;
    }

    // Record the swap EXACTLY as before ({ a, b, t } with t = elapsed ms).
    const elapsed = Math.min(
      GEM_GAME_DURATION_MS,
      Math.max(0, performance.now() - gameStartTimeRef.current),
    );
    swapsRef.current.push({ a, b, t: elapsed });
    scoreRef.current += outcome.scoreGained; // authoritative running total
    hintRef.current = null;

    GemAudio.swap();

    if (reducedMotionRef.current) {
      // No motion: the authoritative board is already updated, so the static draw
      // reflects it immediately. Snap the counter and play the clear cue.
      GemAudio.clear(Math.max(1, outcome.cascades));
      displayScoreRef.current = scoreRef.current;
      setScore(scoreRef.current);
      return;
    }

    // Reconstruct cascade keyframes on a COPY (does not touch authoritative state).
    const { steps, reshuffled } = simulateSwap(preBoard, drawBefore, a, b);
    animRef.current = buildLegalAnim(
      a,
      b,
      preBoard,
      steps,
      reshuffled,
      gridRef.current.slice(),
      performance.now(),
    );
  }, []);

  // ── Render (2D canvas) ──
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const t = themeRef.current;
    const anim = animRef.current;
    const playing = gameStateRef.current === 'playing';
    const now = performance.now();

    ctx.save();
    ctx.scale(canvasSize.dpr, canvasSize.dpr);
    ctx.clearRect(0, 0, BASE, BASE);

    // Stage backdrop.
    ctx.fillStyle = t.bgColor;
    ctx.fillRect(0, 0, BASE, BASE);

    // Screen shake (big cascades).
    if (shakeRef.current > 0.1) {
      ctx.translate(
        (Math.random() * 2 - 1) * shakeRef.current,
        (Math.random() * 2 - 1) * shakeRef.current,
      );
    }

    // Board panel + (optional) rim flash on big cascades — a hard cream stroke,
    // not a glow, to stay in the Midway look.
    ctx.fillStyle = t.boardColor;
    roundRectPath(ctx, PAD - 4, PAD - 4, GRID * CELL + 8, GRID * CELL + 8, 10);
    ctx.fill();
    if (rimFlashRef.current > 0.02) {
      ctx.globalAlpha = Math.min(1, rimFlashRef.current);
      ctx.strokeStyle = t.selectColor;
      ctx.lineWidth = 3;
      roundRectPath(ctx, PAD - 4, PAD - 4, GRID * CELL + 8, GRID * CELL + 8, 10);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // Recessed cell wells (always drawn).
    for (let idx = 0; idx < CELLS; idx += 1) {
      const [r, c] = cellRowCol(idx);
      ctx.fillStyle = t.cellColor;
      roundRectPath(ctx, cellX(c) + 1, cellY(r) + 1, CELL - 2, CELL - 2, 6);
      ctx.fill();
    }

    const phase = anim ? getActivePhase(anim, now - anim.startTime) : null;

    if (!anim || !phase) {
      // ── STATIC: authoritative settled board + selection + idle hint ──
      const grid = gridRef.current;
      for (let idx = 0; idx < CELLS; idx += 1) {
        const color = grid[idx];
        if (color === undefined || color === EMPTY) continue;
        const [r, c] = cellRowCol(idx);
        drawGemAt(ctx, t, color, cellCenterX(c), cellCenterY(r), 1, 1);
      }

      const selected = selectedCellRef.current;
      if (selected !== null && playing) {
        const [r, c] = cellRowCol(selected);
        const pulse = 0.5 + 0.5 * Math.sin(now / 170);
        ctx.strokeStyle = t.selectColor;
        ctx.lineWidth = 3;
        roundRectPath(ctx, cellX(c) + 1.5, cellY(r) + 1.5, CELL - 3, CELL - 3, 7);
        ctx.stroke();
        ctx.globalAlpha = 0.3 + 0.35 * pulse;
        roundRectPath(ctx, cellX(c) - 1, cellY(r) - 1, CELL + 2, CELL + 2, 9);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }

      const hint = hintRef.current;
      if (hint && playing && selected === null) {
        const pulse = 0.5 + 0.5 * Math.sin(now / 230);
        ctx.globalAlpha = 0.2 + 0.5 * pulse;
        ctx.strokeStyle = t.selectColor;
        ctx.lineWidth = 2.5;
        for (const cell of hint) {
          const [r, c] = cellRowCol(cell);
          roundRectPath(ctx, cellX(c) + 2, cellY(r) + 2, CELL - 4, CELL - 4, 7);
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
      }
    } else if (phase.type === 'swap' || phase.type === 'bounce') {
      const board = anim.preBoard;
      const p = clamp01((now - anim.startTime - phase.start) / phase.dur);
      for (let idx = 0; idx < CELLS; idx += 1) {
        if (idx === anim.a || idx === anim.b) continue;
        const color = board[idx];
        if (color === undefined || color === EMPTY) continue;
        const [r, c] = cellRowCol(idx);
        drawGemAt(ctx, t, color, cellCenterX(c), cellCenterY(r), 1, 1);
      }
      const [ar, ac] = cellRowCol(anim.a);
      const [br, bc] = cellRowCol(anim.b);
      const ax = cellCenterX(ac);
      const ay = cellCenterY(ar);
      const bx = cellCenterX(bc);
      const by = cellCenterY(br);
      // swap: ease all the way over (1). bounce: out to 1 then back to 0.
      const f = phase.type === 'swap' ? easeOut(p) : Math.sin(Math.PI * p);
      drawGemAt(ctx, t, anim.swapColorA, ax + (bx - ax) * f, ay + (by - ay) * f, 1, 1);
      drawGemAt(ctx, t, anim.swapColorB, bx + (ax - bx) * f, by + (ay - by) * f, 1, 1);
    } else if (phase.type === 'clear') {
      const step = anim.steps[phase.step]!;
      const board = step.boardBefore;
      const p = clamp01((now - anim.startTime - phase.start) / phase.dur);
      for (let idx = 0; idx < CELLS; idx += 1) {
        const color = board[idx];
        if (color === undefined || color === EMPTY) continue;
        const [r, c] = cellRowCol(idx);
        const cx = cellCenterX(c);
        const cy = cellCenterY(r);
        if (step.matchedSet.has(idx)) {
          // Flash up (first 35%) then pop down + fade.
          let scale: number;
          let alpha: number;
          if (p < 0.35) {
            scale = 1 + 0.28 * (p / 0.35);
            alpha = 1;
          } else {
            const u = (p - 0.35) / 0.65;
            scale = 1.28 * (1 - u);
            alpha = 1 - u;
          }
          drawGemAt(ctx, t, color, cx, cy, Math.max(0.01, scale), Math.max(0, alpha));
          if (p < 0.45) {
            const gs = (CELL - GAP * 2) * scale;
            ctx.globalAlpha = (1 - p / 0.45) * 0.6;
            ctx.fillStyle = '#ffffff';
            roundRectPath(ctx, cx - gs / 2, cy - gs / 2, gs, gs, 8);
            ctx.fill();
            ctx.globalAlpha = 1;
          }
        } else {
          drawGemAt(ctx, t, color, cx, cy, 1, 1);
        }
      }
    } else if (phase.type === 'fall') {
      const step = anim.steps[phase.step]!;
      const board = step.boardAfter;
      const p = clamp01((now - anim.startTime - phase.start) / phase.dur);
      const ip = easeIn(p);
      // Statics: settled gems that didn't move this step.
      for (let idx = 0; idx < CELLS; idx += 1) {
        if (step.movingSet.has(idx)) continue;
        const color = board[idx];
        if (color === undefined || color === EMPTY) continue;
        const [r, c] = cellRowCol(idx);
        drawGemAt(ctx, t, color, cellCenterX(c), cellCenterY(r), 1, 1);
      }
      // Moving gems (falls + spawns) clipped to the board so spawns slide in from
      // under the top edge.
      ctx.save();
      roundRectPath(ctx, PAD, PAD, GRID * CELL, GRID * CELL, 8);
      ctx.clip();
      for (const fm of step.falls) {
        const row = fm.fromRow + (fm.toRow - fm.fromRow) * ip;
        drawGemAt(ctx, t, fm.color, cellCenterX(fm.col), PAD + row * CELL + CELL / 2, 1, 1);
      }
      for (const sp of step.spawns) {
        const row = sp.fromRow + (sp.toRow - sp.fromRow) * ip;
        drawGemAt(ctx, t, sp.color, cellCenterX(sp.col), PAD + row * CELL + CELL / 2, 1, 1);
      }
      ctx.restore();
    } else if (phase.type === 'reshuffle') {
      const p = clamp01((now - anim.startTime - phase.start) / phase.dur);
      const last =
        anim.steps.length > 0
          ? anim.steps[anim.steps.length - 1]!.boardAfter
          : anim.preBoard;
      for (let idx = 0; idx < CELLS; idx += 1) {
        const co = last[idx];
        if (co !== undefined && co !== EMPTY) {
          const [r, c] = cellRowCol(idx);
          drawGemAt(ctx, t, co, cellCenterX(c), cellCenterY(r), 1, 1 - p);
        }
      }
      for (let idx = 0; idx < CELLS; idx += 1) {
        const cn = anim.finalBoard[idx];
        if (cn !== undefined && cn !== EMPTY) {
          const [r, c] = cellRowCol(idx);
          drawGemAt(ctx, t, cn, cellCenterX(c), cellCenterY(r), 1, p);
        }
      }
    }

    // Particles (sparkle bursts).
    for (const pt of particlesRef.current) {
      ctx.globalAlpha = clamp01(pt.life / pt.max);
      ctx.fillStyle = pt.color;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, pt.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // Floating score / multiplier plates.
    const calloutLook = readCanvasCalloutLook(canvas);
    for (const fl of floatsRef.current) {
      drawCanvasCallout(ctx, calloutLook, {
        text: fl.text,
        x: fl.x,
        y: fl.y,
        u: 1 - clamp01(fl.life / fl.max),
        tone: fl.tone,
        reducedMotion: reducedMotionRef.current,
        within: { left: 0, top: 0, right: BASE, bottom: BASE },
      });
    }
    ctx.globalAlpha = 1;

    ctx.restore();
  }, [canvasSize.dpr]);

  const gameLoop = useCallback(() => {
    const now = performance.now();
    if (gameStateRef.current !== 'playing') {
      draw();
      return;
    }

    const dt = Math.min(48, lastTickRef.current ? now - lastTickRef.current : 16);
    lastTickRef.current = now;

    // Advance the active swap animation: fire per-step clear SFX + feedback when
    // each clear phase begins, and retire the anim when it ends.
    const anim = animRef.current;
    if (anim) {
      const elapsed = now - anim.startTime;
      for (const ph of anim.phases) {
        if (
          ph.type === 'clear' &&
          elapsed >= ph.start &&
          !anim.firedClears.has(ph.step)
        ) {
          anim.firedClears.add(ph.step);
          const step = anim.steps[ph.step]!;
          GemAudio.clear(step.depth);
          spawnClearFx(step, themeRef.current, particlesRef.current, floatsRef.current);
          if (step.depth >= 2 || step.matched.length >= 5) {
            shakeRef.current = Math.min(
              7,
              shakeRef.current + step.depth * 1.4 + step.matched.length * 0.15,
            );
            rimFlashRef.current = Math.min(1, rimFlashRef.current + 0.5 + step.depth * 0.12);
          }
        }
      }
      if (elapsed >= anim.totalDur) {
        animRef.current = null;
        lastInteractionRef.current = now; // delay the hint after a resolved swap
      }
    }

    // Decay feedback layers.
    if (particlesRef.current.length > 0) {
      particlesRef.current = particlesRef.current.filter((p) => {
        p.life -= dt;
        if (p.life <= 0) return false;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vy += 0.0006 * dt; // gravity
        return true;
      });
    }
    if (floatsRef.current.length > 0) {
      floatsRef.current = floatsRef.current.filter((f) => {
        f.life -= dt;
        if (f.life <= 0) return false;
        return true;
      });
    }
    if (shakeRef.current > 0.05) shakeRef.current *= Math.pow(0.86, dt / 16.67);
    else shakeRef.current = 0;
    if (rimFlashRef.current > 0.02) rimFlashRef.current *= Math.pow(0.9, dt / 16.67);
    else rimFlashRef.current = 0;

    // Tick the displayed score counter toward the authoritative total.
    if (displayScoreRef.current !== scoreRef.current) {
      const diff = scoreRef.current - displayScoreRef.current;
      const stepAmt = reducedMotionRef.current
        ? diff
        : Math.sign(diff) * Math.max(1, Math.ceil(Math.abs(diff) * 0.2));
      let next = displayScoreRef.current + stepAmt;
      if (
        (stepAmt > 0 && next > scoreRef.current) ||
        (stepAmt < 0 && next < scoreRef.current)
      ) {
        next = scoreRef.current;
      }
      displayScoreRef.current = next;
      setScore(next);
    }

    // Idle hint: surface a legal move if the player stalls.
    if (
      !animRef.current &&
      selectedCellRef.current === null &&
      now - lastInteractionRef.current > HINT_DELAY_MS
    ) {
      if (!hintRef.current) hintRef.current = findHintMove(gridRef.current);
    }

    // Only re-render the countdown when the displayed second changes.
    const remainingMs = gameEndTimeRef.current - now;
    const secondsLeft = Math.max(0, Math.ceil(remainingMs / 1000));
    if (secondsLeft !== lastShownSecondRef.current) {
      lastShownSecondRef.current = secondsLeft;
      setTimeLeft(secondsLeft);
    }

    draw();

    if (remainingMs <= 0) {
      endRun();
      return;
    }
    animationRef.current = requestAnimationFrame(gameLoop);
  }, [draw, endRun]);

  const resetRun = useCallback(() => {
    cancelAnimationFrame(animationRef.current);
    const seed = seedRef.current ?? 0;
    gridRef.current = generateInitialBoard(seed);
    drawRef.current = createDrawState(seed);
    swapsRef.current = [];
    selectedCellRef.current = null;
    dragStartRef.current = null;
    animRef.current = null;
    particlesRef.current = [];
    floatsRef.current = [];
    shakeRef.current = 0;
    rimFlashRef.current = 0;
    hintRef.current = null;
    scoreRef.current = 0;
    displayScoreRef.current = 0;
    setScore(0);
    const start = performance.now();
    gameStartTimeRef.current = start;
    gameEndTimeRef.current = start + GEM_GAME_DURATION_MS;
    lastShownSecondRef.current = GEM_GAME_DURATION_MS / 1000;
    lastInteractionRef.current = start;
    lastTickRef.current = 0;
    setTimeLeft(GEM_GAME_DURATION_MS / 1000);
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
        body: JSON.stringify({ gameType: 'gem-swap' }),
      });
      if (sessionResponse.ok) {
        setBanIndefinite(false);
        setBanUntilMs(null);
        const sessionData = await sessionResponse.json();
        sessionTokenRef.current = sessionData.token;
        seedRef.current =
          typeof sessionData.gemSeed === 'number' ? sessionData.gemSeed : null;
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
    animationRef.current = requestAnimationFrame(gameLoop);
  }, [gameLoop, resetRun, resetRunResult]);

  const primaryAction = useCallback(() => {
    const current = gameStateRef.current;
    if (current === 'idle' || current === 'error') {
      startGame();
    } else if (current === 'gameover') {
      const since = performance.now() - gameOverTimeRef.current;
      if (since >= RESTART_GRACE_PERIOD) startGame();
    }
  }, [startGame]);

  // Map a pointer event to the cell index under it (or null if off the board).
  const cellAtPointer = useCallback(
    (clientX: number, clientY: number): number | null => {
      const canvas = canvasRef.current;
      if (!canvas) return null;
      const rect = canvas.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return null;
      const x = ((clientX - rect.left) / rect.width) * BASE;
      const y = ((clientY - rect.top) / rect.height) * BASE;
      const col = Math.floor((x - PAD) / CELL);
      const row = Math.floor((y - PAD) / CELL);
      if (row < 0 || row >= GRID || col < 0 || col >= GRID) return null;
      return row * GRID + col;
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
      lastInteractionRef.current = performance.now();
      hintRef.current = null;
      if (animRef.current) return; // ignore taps while a swap resolves
      const cell = cellAtPointer(e.clientX, e.clientY);
      if (cell === null) return;

      const selected = selectedCellRef.current;
      dragStartRef.current = cell;
      if (selected === null) {
        selectedCellRef.current = cell;
        GemAudio.select();
      } else if (selected === cell) {
        selectedCellRef.current = null;
      } else if (areAdjacent(selected, cell)) {
        trySwap(selected, cell);
        selectedCellRef.current = null;
        dragStartRef.current = null;
      } else {
        selectedCellRef.current = cell;
        GemAudio.select();
      }
    },
    [cellAtPointer, primaryAction, trySwap],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (gameStateRef.current !== 'playing') return;
      if (animRef.current) return;
      const start = dragStartRef.current;
      if (start === null) return;
      const cell = cellAtPointer(e.clientX, e.clientY);
      if (cell === null || cell === start) return;
      if (areAdjacent(start, cell)) {
        // Drag-swipe swap onto an adjacent gem.
        lastInteractionRef.current = performance.now();
        trySwap(start, cell);
        selectedCellRef.current = null;
        dragStartRef.current = null;
      }
    },
    [cellAtPointer, trySwap],
  );

  const handlePointerUp = useCallback(() => {
    dragStartRef.current = null;
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

  // Responsive sizing — the canvas fills the square stage.
  useEffect(() => {
    const updateSize = () => {
      const reservedVertical = window.innerHeight < 700 ? 220 : 300;
      const maxWidth = Math.min(window.innerWidth - 24, 460);
      const maxHeight = Math.min(window.innerHeight - reservedVertical, 460);
      const scale = Math.min(maxWidth / BASE, maxHeight / BASE, 1.3);
      const cssSize = Math.floor(BASE * scale);
      const dpr = gameCanvasDpr(cssSize, cssSize);
      setCanvasSize({
        width: cssSize,
        height: cssSize,
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
    canvas.width = Math.floor(BASE * canvasSize.dpr);
    canvas.height = Math.floor(BASE * canvasSize.dpr);
    if (gameStateRef.current !== 'playing') draw();
  }, [canvasSize, draw]);

  // Apply equipped cosmetics; repaint a still frame when idle.
  useEffect(() => {
    themeRef.current = gemTheme;
    if (gameStateRef.current !== 'playing') draw();
  }, [gemTheme, draw]);

  useEffect(() => {
    gameStateRef.current = gameState;
  }, [gameState]);

  // Keyboard: Space/Enter to start or restart.
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.code === 'Space' || e.code === 'Enter') {
        if (e.repeat) return;
        if (gameStateRef.current !== 'playing') {
          e.preventDefault();
          primaryAction();
        }
      }
    },
    [primaryAction],
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      cancelAnimationFrame(animationRef.current);
    };
  }, [handleKeyDown]);

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
      cancelAnimationFrame(animationRef.current);
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
    <div className="gem-midway arc-game-flow">
      <div className="w-full space-y-3 sm:space-y-4">
        <div className="mx-auto w-full max-w-3xl">
          <div className="hidden sm:block">
            <PageHeader
              eyebrow="Arcade"
              icon={<Gem aria-hidden className="h-6 w-6" />}
              title="Gem Swap"
              subtitle="Swap adjacent gems to line up 3 or more of a colour. Matches clear and new gems drop in — chain cascades for bonus points. Score as much as you can in 60 seconds."
              wallet={walletCard}
            />
          </div>
          <div className="sm:hidden">
            <GamesWalletCard wallet={walletCard} compact />
          </div>
        </div>

        <div className="mx-auto flex w-full max-w-md items-center justify-between gap-3 px-1">
          <span className="arcade-num text-sm text-body sm:text-base">
            Score <span className="font-semibold text-strong">{score}</span>
          </span>
          <span className="arcade-num text-sm text-body sm:text-base">
            Time <span className="font-semibold text-strong">{timeLeft}s</span>
          </span>
          <span className="arcade-num text-sm text-body sm:text-base">
            Best <span className="font-semibold text-strong">{highScore}</span>
          </span>
        </div>

        <div ref={containerRef} className="relative touch-none flex justify-center">
          <div
            className="gem-stage relative"
            style={{ width: canvasSize.width, height: canvasSize.height }}
          >
            <canvas
              ref={canvasRef}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              className="block cursor-pointer rounded-well border-2 border-ink"
              style={{
                touchAction: 'none',
                width: canvasSize.width,
                height: canvasSize.height,
              }}
            />

            {gameState !== 'playing' && (
              <div
                className="gem-overlay absolute inset-0 flex touch-none flex-col items-center justify-center rounded-well px-4"
                style={{
                  background:
                    'color-mix(in srgb, var(--scrim) 78%, transparent)',
                }}
                onPointerDown={handlePointerDown}
              >
                {gameState === 'idle' && (
                  <>
                    <Gem size={56} className="mb-4 text-tickets-text" />
                    <h1 className="arcade-display mb-2 text-center text-2xl text-strong uppercase sm:text-3xl">
                      Gem Swap
                    </h1>
                    <p className="mb-2 text-center text-sm text-strong sm:text-base">
                      {isStartingSession
                        ? 'Starting your run…'
                        : touchDevice
                          ? 'Tap to start — swap gems to match 3+'
                          : 'Press Space or click to start'}
                    </p>
                    <p className="max-w-xs text-center text-xs text-body sm:text-sm">
                      Match 3+ of a colour. Chain cascades before the clock runs out.
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
                      Time&apos;s up
                    </h2>
                    <p className="mb-1 text-xl text-strong sm:text-2xl">
                      Score <span className="arcade-num font-semibold">{score}</span>
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
          {touchDevice
            ? 'Tap a gem, then tap an adjacent gem to swap — or drag onto it'
            : 'Click a gem, then click an adjacent gem to swap — or drag onto it'}
        </p>

        <div className="mt-4 sm:mt-6 flex flex-col items-center gap-3 sm:gap-4 w-full">
          <div className="flex w-full flex-wrap items-center justify-center gap-2 pb-1 sm:gap-4">
            <GameLeaderboardButton
              onClick={(e) => {
                e.stopPropagation();
                setShowLeaderboard(true);
              }}
              className="h-10 shrink-0 px-3 py-0 text-xs sm:text-sm"
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
                className={`pointer-events-none absolute right-0 bottom-full z-20 mb-2 w-[calc(100vw-2rem)] max-w-sm arcade-card-inset px-3 py-2 text-left text-xs leading-relaxed text-body transition-opacity duration-150 sm:w-80 ${
                  showRewardsHint
                    ? 'opacity-100'
                    : 'opacity-0 peer-hover:opacity-100 peer-focus:opacity-100'
                }`}
              >
                {REWARDS_HINT_TEXT}
              </span>
            </div>
          </div>
        </div>
      </div>

      <GameLeaderboardModal
        open={showLeaderboard}
        onOpenChange={setShowLeaderboard}
        title="Gem Swap board"
        description="Highest scores, and your rank."
      >
        <GameLeaderboard
          gameType="gem-swap"
          maxEntries={5}
          enableFullLeaderboardModal
          fullLeaderboardDisplay="inline"
          refreshKey={leaderboardRefreshKey}
        />
      </GameLeaderboardModal>
    </div>
  );
}

// Find any legal move (the two cells whose swap forms a match) for the idle hint.
// Mirrors the server's hasLegalMove scan order but returns the pair it finds.
function findHintMove(board: number[]): [number, number] | null {
  const wouldMatch = (a: number, b: number): boolean => {
    const tmp = board[a]!;
    board[a] = board[b]!;
    board[b] = tmp;
    const ok = findMatches(board).size > 0;
    board[b] = board[a]!;
    board[a] = tmp;
    return ok;
  };
  for (let r = 0; r < GRID; r += 1) {
    for (let c = 0; c < GRID; c += 1) {
      const idx = r * GRID + c;
      if (c < GRID - 1 && wouldMatch(idx, idx + 1)) return [idx, idx + 1];
      if (r < GRID - 1 && wouldMatch(idx, idx + GRID)) return [idx, idx + GRID];
    }
  }
  return null;
}
