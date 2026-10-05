'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { Hammer, CircleHelp } from 'lucide-react';
import { ArcadeButton } from '@/features/arcade/components/ui/arcade-ui';
import { GameLeaderboard } from '@/features/arcade/components/game-leaderboard';
import { GameLeaderboardModal } from '@/features/arcade/components/game-leaderboard-modal';
import { GameLeaderboardButton } from '@/features/arcade/components/game-leaderboard-button';
import { PageHeader, GamesWalletCard } from '@/features/arcade/components/shell/page-header';
import { MuteButton } from '@/features/arcade/components/mute-button';
import { EnvMonitor } from '@/features/arcade/lib/game-anti-cheat';
import { usePreventGameGestures, useIsTouchDevice } from '@/features/arcade/lib/game-mobile-utils';
import { playHaptic } from '@/features/arcade/lib/game-haptics';
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
  deriveGopherSchedule,
  createGopherScorer,
  gopherComboMultiplierX2,
  GOPHER_SPRINT_DURATION_SEC,
  GOPHER_HOLE_COUNT,
  GOPHER_MAX_BONKS,
  type GopherPop,
  type GopherScorer,
  type GopherEscape,
  type GopherKind,
} from '@/server/arcade/gopher-replay';
import {
  DEFAULT_GOPHER_THEME,
  buildGopherTheme,
  type GopherCosmeticTheme,
  type InventoryCosmeticResponse,
} from './_gopher-theme';

import './_gopher.css';
import {
  drawCanvasCallout,
  readCanvasCalloutLook,
  type CanvasCalloutTone,
} from '@/features/arcade/components/gameplay/callout-canvas';

const SPRINT_MS = GOPHER_SPRINT_DURATION_SEC * 1000;
const TICK_MS = 100; // countdown UI refresh cadence
const LOW_TIME_MS = 10_000; // bar turns red under 10s
const FLATTEN_MS = 320; // how long a bonked gopher stays pancaked (render-only)
const TELEGRAPH_MS = 170; // pre-emerge dirt trickle lead time (render-only)

// ── Logical playfield (wide cabinet stage). The canvas fills this space;
//    scale + dpr keep the draw coordinates display-independent. ──
const BASE_WIDTH = 760;
const BASE_HEIGHT = 520;
const FRAME_TIME = PHYSICS_DT_MS;

const GRID_COLS = 3;
const GRID_ROWS = 3;
// Field inset within the logical canvas; the 3×3 hole cells tile the rest.
const FIELD_PAD = 28;
const CELL_W = (BASE_WIDTH - FIELD_PAD * 2) / GRID_COLS;
const CELL_H = (BASE_HEIGHT - FIELD_PAD * 2) / GRID_ROWS;

// SoundManager cue names. `gopherBonk` is played with a pitch ladder that
// climbs with the combo tier; the rest are one-shots.
const SFX = {
  bonk: 'gopherBonk',
  clank: 'gopherClank',
  golden: 'gopherGolden',
  escape: 'gopherEscape',
  bomb: 'arcadeExplode',
  whiff: 'arcadeBet',
  comboBreak: 'coinWrong',
  tierUp: 'coinStreakMilestone',
  start: 'arcadeReveal',
  over: 'arcadeCashout',
} as const;

const REWARDS_HINT_TEXT =
  'Rewards hint: rack up points in 60 seconds to earn tickets. Chain bonks without a whiff or an escape to grow your combo (up to ×3), bonk fast for a QUICK ×1.5 bonus, and watch for golden (50) and armored (30, two taps) gophers. Tap a bomb and the run ends. Rewards taper at higher scores.';

// Combo streak thresholds where the multiplier steps up (mirrors the tiers in
// gopherComboMultiplierX2) — used by the combo meter's "next tier" progress.
const COMBO_TIER_STEPS = [5, 10, 15, 20] as const;

type GameState = 'idle' | 'playing' | 'gameover' | 'error';

type SubmittedBonk = { hole: number; t: number };

// Per-hole render state for the pop animation (eased up/down + bonk/bomb flash).
type HoleVisual = {
  /** 0 = fully ducked, 1 = fully up (may overshoot slightly on the pop-in). */
  raise: number;
  /** previous frame's raise — velocity drives squash & stretch. */
  prevRaise: number;
  /** the pop index currently shown at this hole, or -1. */
  popIndex: number;
  /** short-lived bonk flash 0..1 (decays each frame). */
  bonkFlash: number;
  /** short-lived bomb flash 0..1 (decays each frame). */
  bombFlash: number;
  /** elapsed-ms when the occupant was bonked (drives the flattened+dizzy pose), or 0. */
  bonkedAt: number;
  /** elapsed-ms of an armor-break clank at this hole, or 0. */
  armorHitAt: number;
  /** pop index we already burst emerge-dirt for (once per pop). */
  dirtFor: number;
  /** pop index we already played the pre-emerge trickle for (once per pop). */
  telegraphFor: number;
};

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

// Midway enamel palette (read as literals — the canvas never reads CSS tokens
// per-frame, matching the breakout fallback approach). Tuned to the lacquered
// wood board, recessed holes, and rosy-cheeked critters in
// public/games/gopher/poster.webp. NOTHING glows by default.
//
// The wood board, holes/rims, and the gopher critter are now driven by the
// cosmetic theme (turf + gopher slots) so equipped skins recolor them; their
// stock values live in DEFAULT_GOPHER_THEME. The constants below are the
// un-slotted neutrals (bomb hazard, top deco band, cream highlights, mallet).
// Bomb.
const BOMB_BODY = '#262320';
const BOMB_BODY_HI = '#55504a';
const BOMB_FUSE = '#9a6e38';
const BOMB_SPARK = '#f7bd5e';
const BOMB_SPARK_HI = '#fff0cc';
// Deco enamel + neutrals.
const ENAMEL_RED = '#c33b3c';
const ENAMEL_AMBER = '#e8a23c';
const ENAMEL_TEAL = '#2bb2a0';
const CREAM = '#f6eddc';
const MALLET_HEAD = '#f3e4c6';
const MALLET_HEAD_LO = '#caa86f';
const MALLET_HANDLE = '#7c4f24';
// Golden gopher — fixed enamel golds (a special spawn, like the bomb's fixed
// iron; the regular critter stays fully theme-driven for cosmetics).
const GOLD_BODY = '#f2b93f';
const GOLD_BODY_HI = '#ffe08a';
const GOLD_BODY_LO = '#c78d1f';
const GOLD_BELLY = '#fff3cd';
const GOLD_EDGE = '#8a5c10';
// Armored gopher helmet — riveted steel.
const STEEL = '#9aa2ab';
const STEEL_HI = '#d6dce2';
const STEEL_LO = '#5d666f';
const STEEL_EDGE = '#2f353b';

// A short-lived bonk star (render-only juice). Never touches the sim.
type BonkStar = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  rot: number;
  vr: number;
  size: number;
  color: string;
};

// Floating score plate ("+30", "quick", "combo break"): the shared callout
// plate. Render-only.
type FloatText = {
  x: number;
  y: number;
  life: number;
  text: string;
  tone: CanvasCalloutTone;
};

// Dirt clod kicked up when a pop emerges. Render-only.
type DirtClod = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  size: number;
  color: string;
};

// Expanding dust ring (whiff near-miss / escape puff). Render-only.
type DustPuff = {
  x: number;
  y: number;
  r: number;
  vr: number;
  life: number;
  color: string;
};

// easeOutBack — overshoot ease for the pop-in (anticipation + settle).
const easeOutBack = (x: number) => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  const p = x - 1;
  return 1 + c3 * p * p * p + c1 * p * p;
};

// Five-pointed star path (used by the bonk burst).
const starPath = (
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  rot: number,
) => {
  ctx.beginPath();
  for (let i = 0; i < 10; i += 1) {
    const rr = i % 2 === 0 ? r : r * 0.46;
    const a = rot + (i / 10) * Math.PI * 2 - Math.PI / 2;
    const x = cx + Math.cos(a) * rr;
    const y = cy + Math.sin(a) * rr;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
};

export default function GopherClient() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const [gameState, setGameState] = useState<GameState>('idle');
  const [score, setScore] = useState(0);
  const [remainingMs, setRemainingMs] = useState(SPRINT_MS);
  const [highScore, setHighScore] = useState(0);

  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const [walletBalances, setWalletBalances] = useState({ credits: 0 });
  const [dailyCreditsProgress, setDailyCreditsProgress] = useState({ earned: 0, cap: 300 });
  const [gopherTheme, setGopherTheme] = useState<GopherCosmeticTheme>(DEFAULT_GOPHER_THEME);
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
  const [bombEnded, setBombEnded] = useState(false);
  // Combo meter UI state (streak + multiplier of the LAST scored bonk).
  const [combo, setCombo] = useState({ streak: 0, multX2: 2 });
  const [bestStreak, setBestStreak] = useState(0);
  // Monotonic keys that remount the combo chip so its CSS pulse/shake replays.
  const [comboPulseKey, setComboPulseKey] = useState(0);
  const [comboBreakKey, setComboBreakKey] = useState(0);
  const [canvasSize, setCanvasSize] = useState({
    width: BASE_WIDTH,
    height: BASE_HEIGHT,
    dpr: 1,
  });
  const bestScoreCacheRef = useRef<number | null>(null);

  usePreventGameGestures(gameState === 'playing');
  const touchDevice = useIsTouchDevice();

  // Mirrors for async closures (timers/handlers fire outside React state).
  const gameStateRef = useRef<GameState>('idle');
  const sessionTokenRef = useRef<string | null>(null);
  const seedRef = useRef<number | null>(null);
  const scheduleRef = useRef<GopherPop[]>([]);
  const envMonitorRef = useRef(new EnvMonitor());
  const isStartingRef = useRef(false);
  const isGuestRunRef = useRef(false);

  const startPerfRef = useRef(0); // performance.now() when the sprint began
  const scoreRef = useRef(0);
  const bonksRef = useRef<SubmittedBonk[]>([]);
  // THE deterministic run scorer — the exact same state machine the server
  // replays on submit (single source of truth in gopher-replay.ts). All combo /
  // quick / special scoring flows through it; the client never invents points.
  const scorerRef = useRef<GopherScorer | null>(null);
  // Multiplier tier of the last scored bonk (detects tier-ups for fanfare).
  const prevMultX2Ref = useRef(2);
  const holesRef = useRef<HoleVisual[]>([]);
  // Render-only juice: bonk star bursts, floating score texts, dirt clods,
  // dust puffs, screen shake / bomb flash, the pointer-tracked mallet, and its
  // swing impulse (0..1, decays each frame). None of these touch the sim.
  const starsRef = useRef<BonkStar[]>([]);
  const popupsRef = useRef<FloatText[]>([]);
  const dirtRef = useRef<DirtClod[]>([]);
  const puffsRef = useRef<DustPuff[]>([]);
  const shakeRef = useRef(0); // 0..1, decays
  const flashRef = useRef(0); // 0..1, decays (bomb white-out)
  const bombEndTimeoutRef = useRef<number | null>(null);
  const pointerRef = useRef<{ x: number; y: number } | null>(null);
  const malletSwingRef = useRef(0);
  // Live theme mirror so the rAF draw loop reads the current colors without
  // recreating the memoized draw callbacks (state copy drives idle re-renders).
  const themeRef = useRef<GopherCosmeticTheme>(DEFAULT_GOPHER_THEME);

  const frameLoopRef = useRef<GameFrameLoop | null>(null);
  const scaleRef = useRef(1);
  const tickTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const reducedMotionRef = useRef(false);
  const saveScoreRef = useRef<((score: number, bonks: SubmittedBonk[], durMs: number) => Promise<void>) | null>(null);
  const endRunRef = useRef<((bombHit: boolean) => void) | null>(null);

  const clearTimers = useCallback(() => {
    if (tickTimerRef.current) {
      clearInterval(tickTimerRef.current);
      tickTimerRef.current = null;
    }
  }, []);

  const resetHoles = useCallback(() => {
    holesRef.current = Array.from({ length: GOPHER_HOLE_COUNT }, () => ({
      raise: 0,
      prevRaise: 0,
      popIndex: -1,
      bonkFlash: 0,
      bombFlash: 0,
      bonkedAt: 0,
      armorHitAt: 0,
      dirtFor: -1,
      telegraphFor: -1,
    }));
  }, []);

  const fetchUserBestScore = useCallback(async () => {
    if (bestScoreCacheRef.current !== null) {
      setHighScore(bestScoreCacheRef.current);
      return;
    }
    try {
      const response = await fetch('/api/games/gopher/score', { cache: 'no-store' });
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
      const response = await fetch('/api/store/inventory?gameType=gopher', {
        cache: 'no-store',
      });
      if (!response.ok) return;
      const payload = (await response.json()) as InventoryCosmeticResponse;
      setWalletBalances({ credits: payload.wallet?.credits ?? 0 });
      setDailyCreditsProgress({
        earned: payload.dailyGameCredits?.earned ?? 0,
        cap: payload.dailyGameCredits?.cap ?? 300,
      });
      const nextTheme = buildGopherTheme(payload);
      themeRef.current = nextTheme;
      setGopherTheme(nextTheme);
    } catch {
      /* wallet + cosmetics are best-effort; default theme stays in place */
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

  const saveScore = async (
    finalScore: number,
    bonks: SubmittedBonk[],
    durationMs: number,
  ) => {
    if (isGuestRunRef.current) {
      setRunRewardMessage('Guest run — sign in to save scores and earn tickets.');
      setRunAccountXp(null);
      setRunRewardIsCapHit(false);
      return;
    }
    if (!sessionTokenRef.current) return;

    envMonitorRef.current.stop();
    setSubmitError(null);
    setRunRewardMessage(null);
    setRunAccountXp(null);
    setRunRewardIsCapHit(false);
    setIsSubmitting(true);
    try {
      const response = await fetch('/api/games/gopher/score', {
        method: 'POST',
        keepalive: true,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          score: finalScore,
          sessionToken: sessionTokenRef.current,
          bonks,
          clientDurationMs: Math.max(0, durationMs),
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
        const reason = errData?.details || errData?.error || `HTTP ${response.status}`;
        console.error(`[Gopher] Score rejected (${response.status}): ${reason}`);
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

  // End the run. `bombHit` distinguishes a bomb tap from a natural time-out so
  // the overlay can say so. The score + bonk log are submitted exactly once.
  const endRun = useCallback(
    (bombHit: boolean) => {
      if (gameStateRef.current !== 'playing') return;
      clearTimers();
      if (bombEndTimeoutRef.current !== null) {
        window.clearTimeout(bombEndTimeoutRef.current);
        bombEndTimeoutRef.current = null;
      }
      frameLoopRef.current?.stop();
      const durationMs = performance.now() - startPerfRef.current;
      gameStateRef.current = 'gameover';
      setGameState('gameover');
      setRemainingMs(0);
      setBombEnded(bombHit);
      setBestStreak(scorerRef.current?.bestStreak ?? 0);
      // The bomb blast sound already played at tap time; time-outs get a chime.
      if (!bombHit) {
        SoundManager.play(SFX.over);
        playHaptic('medium');
      }
      if (scoreRef.current > highScore) setHighScore(scoreRef.current);
      saveScoreRef.current?.(scoreRef.current, bonksRef.current.slice(), durationMs);
    },
    [clearTimers, highScore],
  );
  endRunRef.current = endRun;

  // ── Geometry: hole center (logical coords) for hole index 0..8 ──
  const holeCenter = useCallback((hole: number) => {
    const col = hole % GRID_COLS;
    const row = Math.floor(hole / GRID_COLS);
    return {
      cx: FIELD_PAD + col * CELL_W + CELL_W / 2,
      cy: FIELD_PAD + row * CELL_H + CELL_H / 2,
    };
  }, []);

  // ── Render-only juice spawners (never touch the sim). ──
  const pushPopup = useCallback(
    (x: number, y: number, text: string, tone: CanvasCalloutTone) => {
      if (popupsRef.current.length > 24) popupsRef.current.shift();
      popupsRef.current.push({ x, y, life: 1, text: text.toLowerCase(), tone });
    },
    [],
  );

  const spawnStars = useCallback(
    (cx: number, cy: number, colors: readonly string[], count: number) => {
      if (reducedMotionRef.current) return;
      for (let s = 0; s < count; s += 1) {
        const a = (s / count) * Math.PI * 2 + Math.random() * 0.5;
        const spd = 2.4 + Math.random() * 3.4;
        starsRef.current.push({
          x: cx,
          y: cy - 14,
          vx: Math.cos(a) * spd,
          vy: Math.sin(a) * spd - 1.5,
          life: 1,
          rot: Math.random() * Math.PI,
          vr: (Math.random() - 0.5) * 0.4,
          size: 4 + Math.random() * 4,
          color: colors[s % colors.length]!,
        });
      }
    },
    [],
  );

  const spawnDirt = useCallback((cx: number, cy: number) => {
    if (reducedMotionRef.current) return;
    const theme = themeRef.current;
    const colors = [theme.rimLo, theme.woodGrainDk, theme.holeFloor];
    for (let s = 0; s < 8; s += 1) {
      const a = -Math.PI * (0.2 + Math.random() * 0.6); // upward fan
      const spd = 1.6 + Math.random() * 2.6;
      dirtRef.current.push({
        x: cx + (Math.random() - 0.5) * 28,
        y: cy - 4,
        vx: Math.cos(a) * spd,
        vy: Math.sin(a) * spd - 1.2,
        life: 0.9,
        size: 2 + Math.random() * 3.4,
        color: colors[s % colors.length]!,
      });
    }
  }, []);

  const spawnPuff = useCallback((cx: number, cy: number, color: string) => {
    if (reducedMotionRef.current) return;
    puffsRef.current.push({ x: cx, y: cy - 8, r: 8, vr: 1.6, life: 1, color });
  }, []);

  // Pre-emerge telegraph: a tiny dirt trickle leaking from the hole a beat
  // before the occupant bursts out (render-only anticipation; reads the
  // schedule, never writes it).
  const spawnTrickle = useCallback((cx: number, cy: number) => {
    if (reducedMotionRef.current) return;
    const theme = themeRef.current;
    for (let s = 0; s < 3; s += 1) {
      dirtRef.current.push({
        x: cx + (Math.random() - 0.5) * 20,
        y: cy - 2,
        vx: (Math.random() - 0.5) * 0.8,
        vy: -(0.6 + Math.random() * 0.9),
        life: 0.55,
        size: 1.4 + Math.random() * 1.8,
        color: s % 2 === 0 ? theme.rimLo : theme.woodGrainDk,
      });
    }
  }, []);

  // Combo-break moment: reset the meter, shake the chip, and (for a real
  // streak) call it out on the field.
  const onComboBroken = useCallback(
    (prevStreak: number, cx: number, cy: number) => {
      prevMultX2Ref.current = 2;
      setCombo({ streak: 0, multX2: 2 });
      setComboBreakKey((k) => k + 1);
      if (prevStreak >= 5) {
        SoundManager.play(SFX.comboBreak);
        pushPopup(cx, cy - 46, 'COMBO BREAK', 'warning');
      } else if (prevStreak >= 3) {
        pushPopup(cx, cy - 46, 'combo lost', 'warning');
      }
    },
    [pushPopup],
  );

  // Surface scorer escape events: a gopher slipping away puffs dust at its
  // hole and (if it wiped a streak) triggers the combo-break moment.
  const handleEscapes = useCallback(
    (escapes: GopherEscape[]) => {
      for (const esc of escapes) {
        const { cx, cy } = holeCenter(esc.hole);
        spawnPuff(cx, cy, 'rgba(214,196,160,0.65)');
        SoundManager.play(SFX.escape, { volume: 0.7 });
        if (esc.brokeStreak) onComboBroken(esc.prevStreak, cx, cy);
      }
    },
    [holeCenter, onComboBroken, spawnPuff],
  );

  // Bomb tap: blast feedback now, end (and submit) the run a beat later so the
  // boom is readable before the overlay drops in.
  const triggerBombFx = useCallback((cx: number, cy: number) => {
    SoundManager.play(SFX.bomb);
    playHaptic('failure');
    flashRef.current = 1;
    if (!reducedMotionRef.current) {
      shakeRef.current = 1;
      const boomColors = [BOMB_SPARK, BOMB_SPARK_HI, ENAMEL_RED, '#ffffff'];
      for (let s = 0; s < 16; s += 1) {
        const a = (s / 16) * Math.PI * 2 + Math.random() * 0.4;
        const spd = 3 + Math.random() * 5;
        starsRef.current.push({
          x: cx,
          y: cy - 12,
          vx: Math.cos(a) * spd,
          vy: Math.sin(a) * spd - 2,
          life: 1,
          rot: Math.random() * Math.PI,
          vr: (Math.random() - 0.5) * 0.6,
          size: 5 + Math.random() * 6,
          color: boomColors[s % boomColors.length]!,
        });
      }
    }
    if (bombEndTimeoutRef.current === null) {
      bombEndTimeoutRef.current = window.setTimeout(() => {
        bombEndTimeoutRef.current = null;
        endRunRef.current?.(true);
      }, 520);
    }
  }, []);

  // ── Handle a tap on a hole during play. Records {t, hole}, then steps the
  //    SHARED scorer — the same machine the server replays on submit — and
  //    renders feedback from its outcome. ──
  const tapHole = useCallback(
    (hole: number) => {
      if (gameStateRef.current !== 'playing') return;
      const scorer = scorerRef.current;
      if (!scorer) return;
      const t = Math.max(0, Math.floor(performance.now() - startPerfRef.current));

      // Cap stored bonks defensively (the route rejects oversized payloads).
      // A tap that can't be recorded must NOT step the scorer either: the
      // server never sees it, so scoring/whiffing it live would diverge from
      // the authoritative replay. (Only reachable at >20 taps/sec sustained.)
      if (bonksRef.current.length >= GOPHER_MAX_BONKS * 2) return;
      bonksRef.current.push({ hole, t });

      // Escapes that happened up to this instant first (combo meter accuracy).
      handleEscapes(scorer.advanceTo(t));

      const outcome = scorer.bonk(hole, t);
      const vis = holesRef.current[hole];
      const { cx, cy } = holeCenter(hole);

      if (outcome.type === 'bomb') {
        if (vis) vis.bombFlash = 1;
        triggerBombFx(cx, cy);
        return;
      }

      if (outcome.type === 'whiff') {
        // Near-miss feedback: a dust ring where the mallet hit dirt.
        spawnPuff(cx, cy, 'rgba(210,190,150,0.55)');
        playHaptic('tap');
        if (outcome.brokeStreak) onComboBroken(outcome.prevStreak, cx, cy);
        else SoundManager.play(SFX.whiff);
        return;
      }

      if (outcome.type === 'ignored') return; // cadence floor — tap fizzles

      if (outcome.type === 'armor-break') {
        // Helmet knocked off — no points yet, combo preserved.
        if (vis) vis.armorHitAt = t;
        SoundManager.play(SFX.clank);
        playHaptic('tap');
        pushPopup(cx, cy - 58, 'CLANK', 'score');
        spawnStars(cx, cy, [STEEL_HI, STEEL, STEEL_LO], 5);
        return;
      }

      // A scoring hit.
      scoreRef.current = scorer.score;
      setScore(scorer.score);
      setCombo({ streak: outcome.streak, multX2: outcome.multX2 });
      if (vis) {
        vis.bonkFlash = 1;
        vis.bonkedAt = t;
      }

      const mult = outcome.multX2 / 2;
      const isGolden = outcome.kind === 'golden';
      pushPopup(
        cx,
        cy - 58,
        `+${outcome.points}`,
        isGolden ? 'combo' : 'score',
      );
      if (outcome.quick) {
        pushPopup(cx + 34, cy - 82, 'QUICK', 'score');
      }
      spawnStars(
        cx,
        cy,
        isGolden ? [GOLD_BODY_HI, GOLD_BODY, CREAM] : themeRef.current.particleColors,
        isGolden ? 14 : 9,
      );
      // Impact: a shock ring at the mallet strike + a dirt kick from the hole;
      // golden hits thump the whole board. All render-only, reduced-motion
      // gated inside the spawners / the draw pass.
      spawnPuff(cx, cy - 4, isGolden ? 'rgba(255,224,138,0.8)' : 'rgba(246,237,220,0.6)');
      spawnDirt(cx, cy);
      if (isGolden && !reducedMotionRef.current) {
        shakeRef.current = Math.max(shakeRef.current, 0.3);
      }
      playHaptic(isGolden ? 'medium' : 'light');

      // Sound: pitched bonk ladder rises with the combo tier; golden gets a
      // payday chime on top; a tier-up gets its own fanfare + callout.
      if (isGolden) SoundManager.play(SFX.golden);
      SoundManager.play(SFX.bonk, { pitch: 2 ** ((outcome.multX2 - 2) / 8) });
      if (outcome.multX2 > prevMultX2Ref.current) {
        prevMultX2Ref.current = outcome.multX2;
        SoundManager.play(SFX.tierUp);
        playHaptic('success');
        if (!reducedMotionRef.current) {
          shakeRef.current = Math.max(shakeRef.current, 0.18);
        }
        setComboPulseKey((k) => k + 1);
        pushPopup(BASE_WIDTH / 2, 96, `COMBO ×${mult}`, 'combo');
      }
    },
    [
      handleEscapes,
      holeCenter,
      onComboBroken,
      pushPopup,
      spawnDirt,
      spawnPuff,
      spawnStars,
      triggerBombFx,
    ],
  );

  // ── Map a pointer event to the hole index it fell on (or -1) ──
  const pointerToHole = useCallback((clientX: number, clientY: number): number => {
    const canvas = canvasRef.current;
    if (!canvas) return -1;
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return -1;
    const lx = ((clientX - rect.left) / rect.width) * BASE_WIDTH;
    const ly = ((clientY - rect.top) / rect.height) * BASE_HEIGHT;
    if (lx < FIELD_PAD || lx > BASE_WIDTH - FIELD_PAD) return -1;
    if (ly < FIELD_PAD || ly > BASE_HEIGHT - FIELD_PAD) return -1;
    const col = Math.floor((lx - FIELD_PAD) / CELL_W);
    const row = Math.floor((ly - FIELD_PAD) / CELL_H);
    if (col < 0 || col >= GRID_COLS || row < 0 || row >= GRID_ROWS) return -1;
    return row * GRID_COLS + col;
  }, []);

  // ── Draw one gopher body rising from a hole (clipped to the hole mouth) ──
  //    `kind` recolors specials (golden) and adds the armored helmet; `stretch`
  //    is the squash-and-stretch factor from the raise velocity; `wobble` is a
  //    small lean (radians) telegraphing an imminent duck.
  const drawGopher = useCallback(
    (
      ctx: CanvasRenderingContext2D,
      cx: number,
      cy: number,
      rx: number,
      raise: number,
      bonkFlash: number,
      kind: GopherKind,
      armorBroken: boolean,
      stretch: number,
      wobble: number,
      elapsed: number,
    ) => {
      // The critter PEEKS from the hole: its head rises by `raise` while the
      // lower body stays anchored inside (the front rim, drawn after, hides the
      // seam). headR/peek/rest tuned so it pokes out cutely without overshooting.
      const theme = themeRef.current;
      const golden = kind === 'golden';
      const bodyC = golden ? GOLD_BODY : theme.gopherBody;
      const bodyHiC = golden ? GOLD_BODY_HI : theme.gopherBodyHi;
      const bodyLoC = golden ? GOLD_BODY_LO : theme.gopherBodyLo;
      const bellyC = golden ? GOLD_BELLY : theme.gopherBelly;
      const edgeC = golden ? GOLD_EDGE : theme.gopherEdge;
      const headR = rx * 0.6;
      const peek = rx * 0.52; // head rise above the mouth at full pop
      const rest = headR * 0.9; // how far below the mouth it rests when ducked
      const hy = cy + rest - Math.min(raise, 1.12) * (peek + rest);
      // Squash & stretch: rising stretches tall, settling/bonk squashes flat.
      const squashY = Math.max(0.8, Math.min(1.18, stretch)) * (bonkFlash > 0 ? 1 - bonkFlash * 0.16 : 1);
      const squashX = Math.max(0.86, Math.min(1.14, 2 - squashY));

      ctx.save();
      // Clip to (everything above the mouth) ∪ (the mouth ellipse) so the body
      // disappears into the hole below the rim line.
      ctx.beginPath();
      ctx.rect(cx - rx * 1.3, cy - rx * 3.4, rx * 2.6, rx * 3.4 - rx * 0.08);
      ctx.ellipse(cx, cy, rx * 0.98, rx * 0.62, 0, 0, Math.PI * 2);
      ctx.clip();

      ctx.save();
      ctx.translate(cx, hy);
      if (wobble !== 0) ctx.rotate(wobble);
      ctx.scale(squashX, squashY);

      // Chest/body below the head (sinks toward the hole).
      ctx.fillStyle = bodyC;
      ctx.beginPath();
      ctx.ellipse(0, headR * 1.02, headR * 0.96, headR * 1.16, 0, 0, Math.PI * 2);
      ctx.fill();
      // Cream chest/belly.
      ctx.fillStyle = bellyC;
      ctx.beginPath();
      ctx.ellipse(0, headR * 1.08, headR * 0.52, headR * 0.82, 0, 0, Math.PI * 2);
      ctx.fill();
      // Little paws on the chest.
      ctx.fillStyle = golden ? GOLD_BODY_LO : theme.gopherPaw;
      ctx.beginPath();
      ctx.ellipse(-headR * 0.46, headR * 0.96, headR * 0.2, headR * 0.16, 0.4, 0, Math.PI * 2);
      ctx.ellipse(headR * 0.46, headR * 0.96, headR * 0.2, headR * 0.16, -0.4, 0, Math.PI * 2);
      ctx.fill();

      // Ears (behind the head).
      ctx.fillStyle = bodyLoC;
      ctx.beginPath();
      ctx.arc(-headR * 0.74, -headR * 0.74, headR * 0.34, 0, Math.PI * 2);
      ctx.arc(headR * 0.74, -headR * 0.74, headR * 0.34, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = golden ? GOLD_BODY_HI : theme.gopherInnerEar;
      ctx.beginPath();
      ctx.arc(-headR * 0.74, -headR * 0.72, headR * 0.17, 0, Math.PI * 2);
      ctx.arc(headR * 0.74, -headR * 0.72, headR * 0.17, 0, Math.PI * 2);
      ctx.fill();

      // Head — radial-shaded fur ball lit from the upper-left.
      const headG = ctx.createRadialGradient(
        -headR * 0.32,
        -headR * 0.4,
        headR * 0.2,
        0,
        0,
        headR * 1.18,
      );
      headG.addColorStop(0, bodyHiC);
      headG.addColorStop(0.6, bodyC);
      headG.addColorStop(1, bodyLoC);
      // Optional cool effect: a soft glow halo around the head (off by default,
      // always on for the golden special so it reads as the jackpot).
      if (theme.gopherGlowEnabled || golden) {
        ctx.save();
        ctx.shadowColor = golden ? GOLD_BODY_HI : theme.gopherGlowColor;
        ctx.shadowBlur = headR * 0.9;
        ctx.fillStyle = headG;
        ctx.beginPath();
        ctx.arc(0, 0, headR, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
      ctx.fillStyle = headG;
      ctx.beginPath();
      ctx.arc(0, 0, headR, 0, Math.PI * 2);
      ctx.fill();
      ctx.lineWidth = Math.max(1.5, rx * 0.035);
      ctx.strokeStyle = edgeC;
      ctx.beginPath();
      ctx.arc(0, 0, headR - 0.6, 0, Math.PI * 2);
      ctx.stroke();

      // Light muzzle.
      ctx.fillStyle = bellyC;
      ctx.beginPath();
      ctx.ellipse(0, headR * 0.36, headR * 0.5, headR * 0.4, 0, 0, Math.PI * 2);
      ctx.fill();

      if (raise > 0.28) {
        // Rosy cheeks.
        ctx.fillStyle = theme.gopherCheek;
        ctx.globalAlpha = 0.8;
        ctx.beginPath();
        ctx.ellipse(-headR * 0.58, headR * 0.28, headR * 0.22, headR * 0.15, 0, 0, Math.PI * 2);
        ctx.ellipse(headR * 0.58, headR * 0.28, headR * 0.22, headR * 0.15, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
        // Eyes + catchlights.
        ctx.fillStyle = theme.gopherEyes;
        ctx.beginPath();
        ctx.arc(-headR * 0.34, -headR * 0.04, headR * 0.16, 0, Math.PI * 2);
        ctx.arc(headR * 0.34, -headR * 0.04, headR * 0.16, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = CREAM;
        ctx.beginPath();
        ctx.arc(-headR * 0.29, -headR * 0.1, headR * 0.05, 0, Math.PI * 2);
        ctx.arc(headR * 0.39, -headR * 0.1, headR * 0.05, 0, Math.PI * 2);
        ctx.fill();
        // Angry brows once the helmet has been knocked off (round two!).
        if (kind === 'armored' && armorBroken) {
          ctx.strokeStyle = theme.gopherEyes;
          ctx.lineWidth = Math.max(1.5, headR * 0.09);
          ctx.beginPath();
          ctx.moveTo(-headR * 0.52, -headR * 0.34);
          ctx.lineTo(-headR * 0.16, -headR * 0.22);
          ctx.moveTo(headR * 0.52, -headR * 0.34);
          ctx.lineTo(headR * 0.16, -headR * 0.22);
          ctx.stroke();
        }
        // Nose.
        ctx.fillStyle = golden ? GOLD_EDGE : theme.gopherNose;
        ctx.beginPath();
        ctx.ellipse(0, headR * 0.2, headR * 0.14, headR * 0.1, 0, 0, Math.PI * 2);
        ctx.fill();
        // Whisker dots.
        ctx.fillStyle = edgeC;
        ctx.globalAlpha = 0.55;
        ctx.beginPath();
        ctx.arc(-headR * 0.34, headR * 0.3, headR * 0.03, 0, Math.PI * 2);
        ctx.arc(-headR * 0.44, headR * 0.4, headR * 0.03, 0, Math.PI * 2);
        ctx.arc(headR * 0.34, headR * 0.3, headR * 0.03, 0, Math.PI * 2);
        ctx.arc(headR * 0.44, headR * 0.4, headR * 0.03, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
        // Two big incisors.
        const tw = headR * 0.13;
        const th = headR * 0.24;
        const ty = headR * 0.32;
        ctx.fillStyle = CREAM;
        ctx.fillRect(-tw - headR * 0.02, ty, tw, th);
        ctx.fillRect(headR * 0.02, ty, tw, th);
        ctx.strokeStyle = edgeC;
        ctx.lineWidth = 1;
        ctx.strokeRect(-tw - headR * 0.02, ty, tw, th);
        ctx.strokeRect(headR * 0.02, ty, tw, th);
      }

      // Riveted steel helmet (armored, until it gets knocked off).
      if (kind === 'armored' && !armorBroken) {
        const hg = ctx.createLinearGradient(-headR, -headR * 1.2, headR, -headR * 0.1);
        hg.addColorStop(0, STEEL_HI);
        hg.addColorStop(0.55, STEEL);
        hg.addColorStop(1, STEEL_LO);
        ctx.fillStyle = hg;
        ctx.beginPath();
        ctx.arc(0, -headR * 0.14, headR * 1.04, Math.PI * 1.02, Math.PI * 1.98);
        ctx.closePath();
        ctx.fill();
        // Brim.
        ctx.fillStyle = STEEL_LO;
        ctx.fillRect(-headR * 1.1, -headR * 0.24, headR * 2.2, headR * 0.16);
        ctx.strokeStyle = STEEL_EDGE;
        ctx.lineWidth = Math.max(1.5, rx * 0.03);
        ctx.strokeRect(-headR * 1.1, -headR * 0.24, headR * 2.2, headR * 0.16);
        ctx.beginPath();
        ctx.arc(0, -headR * 0.14, headR * 1.04, Math.PI * 1.02, Math.PI * 1.98);
        ctx.stroke();
        // Rivets.
        ctx.fillStyle = STEEL_EDGE;
        for (const rxOff of [-0.62, 0, 0.62]) {
          ctx.beginPath();
          ctx.arc(headR * rxOff, -headR * 0.7, headR * 0.06, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      ctx.restore(); // squash transform

      // Golden sparkle — small twinkling stars orbit the head (crisp shapes,
      // not a glow; static at mid-alpha under reduced motion).
      if (golden && raise > 0.2) {
        const sparkPts = [
          { x: -headR * 1.15, y: -headR * 0.9, p: 0 },
          { x: headR * 1.2, y: -headR * 0.4, p: 2.1 },
          { x: -headR * 0.2, y: -headR * 1.5, p: 4.2 },
        ];
        for (const sp of sparkPts) {
          const tw = reducedMotionRef.current
            ? 0.6
            : (Math.sin(elapsed / 110 + sp.p) + 1) / 2;
          if (tw < 0.15) continue;
          ctx.globalAlpha = 0.35 + tw * 0.6;
          ctx.fillStyle = GOLD_BODY_HI;
          starPath(ctx, cx + sp.x, hy + sp.y, headR * (0.1 + tw * 0.1), sp.p);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
      }

      // Bonk flash — a hard pop over the critter (opacity only, no glow).
      if (bonkFlash > 0) {
        ctx.globalAlpha = Math.min(1, bonkFlash) * 0.7;
        ctx.fillStyle = theme.bonkFlashColor;
        ctx.beginPath();
        ctx.arc(cx, hy, headR * 1.15, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      }

      ctx.restore(); // clip
    },
    [],
  );

  // ── Flattened "just bonked" pose: a pancaked critter with dizzy stars,
  //    distinct from an escape (which simply ducks with a dust puff). ──
  const drawFlattenedGopher = useCallback(
    (
      ctx: CanvasRenderingContext2D,
      cx: number,
      cy: number,
      rx: number,
      kind: GopherKind,
      progress: number, // 0 just hit → 1 done
      elapsed: number,
    ) => {
      const theme = themeRef.current;
      const golden = kind === 'golden';
      const bodyC = golden ? GOLD_BODY : theme.gopherBody;
      const edgeC = golden ? GOLD_EDGE : theme.gopherEdge;
      const bellyC = golden ? GOLD_BELLY : theme.gopherBelly;
      const headR = rx * 0.6;
      const sink = progress * headR * 0.5; // slowly slides back into the hole
      const w = headR * (1.5 - progress * 0.25);
      const h = headR * 0.42 * (1 - progress * 0.4);

      ctx.save();
      ctx.beginPath();
      ctx.rect(cx - rx * 1.3, cy - rx * 3.4, rx * 2.6, rx * 3.4 - rx * 0.08);
      ctx.ellipse(cx, cy, rx * 0.98, rx * 0.62, 0, 0, Math.PI * 2);
      ctx.clip();

      const by = cy - headR * 0.3 + sink;
      ctx.fillStyle = bodyC;
      ctx.beginPath();
      ctx.ellipse(cx, by, w, h, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = edgeC;
      ctx.lineWidth = Math.max(1.5, rx * 0.035);
      ctx.stroke();
      ctx.fillStyle = bellyC;
      ctx.beginPath();
      ctx.ellipse(cx, by + h * 0.25, w * 0.5, h * 0.5, 0, 0, Math.PI * 2);
      ctx.fill();
      // X-ed out eyes.
      ctx.strokeStyle = theme.gopherEyes;
      ctx.lineWidth = Math.max(1.5, headR * 0.07);
      const ex = headR * 0.42;
      const er = headR * 0.1;
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(cx + side * ex - er, by - er * 0.6);
        ctx.lineTo(cx + side * ex + er, by + er * 1.4);
        ctx.moveTo(cx + side * ex + er, by - er * 0.6);
        ctx.lineTo(cx + side * ex - er, by + er * 1.4);
        ctx.stroke();
      }
      ctx.restore();

      // Dizzy stars orbiting above the pancake (outside the clip so they float).
      if (!reducedMotionRef.current) {
        const orbitA = elapsed / 140;
        for (let s = 0; s < 3; s += 1) {
          const a = orbitA + (s / 3) * Math.PI * 2;
          const ox = Math.cos(a) * headR * 0.9;
          const oy = Math.sin(a) * headR * 0.24 - headR * 0.9;
          ctx.globalAlpha = 0.85 * (1 - progress);
          ctx.fillStyle = golden ? GOLD_BODY_HI : ENAMEL_AMBER;
          starPath(ctx, cx + ox, by + oy, headR * 0.14, a);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
      }
    },
    [],
  );

  // ── Draw a bomb peeking from a hole (round black bomb + lit fuse) ──
  const drawBomb = useCallback(
    (
      ctx: CanvasRenderingContext2D,
      cx: number,
      cy: number,
      rx: number,
      raise: number,
      bombFlash: number,
      flicker: number,
    ) => {
      const r = rx * 0.62;
      const peek = rx * 0.46;
      const rest = r * 0.8;
      const by = cy + rest - raise * (peek + rest);

      ctx.save();
      ctx.beginPath();
      ctx.rect(cx - rx * 1.3, cy - rx * 3.4, rx * 2.6, rx * 3.4 - rx * 0.08);
      ctx.ellipse(cx, cy, rx * 0.98, rx * 0.62, 0, 0, Math.PI * 2);
      ctx.clip();

      // Iron body — radial-shaded sphere.
      const bg = ctx.createRadialGradient(
        cx - r * 0.34,
        by - r * 0.4,
        r * 0.15,
        cx,
        by,
        r * 1.2,
      );
      bg.addColorStop(0, BOMB_BODY_HI);
      bg.addColorStop(0.5, BOMB_BODY);
      bg.addColorStop(1, '#16130f');
      ctx.fillStyle = bg;
      ctx.beginPath();
      ctx.arc(cx, by, r, 0, Math.PI * 2);
      ctx.fill();
      // Red enamel warning band across the equator (bomb reads at a glance).
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, by, r - 0.5, 0, Math.PI * 2);
      ctx.clip();
      ctx.fillStyle = ENAMEL_RED;
      ctx.fillRect(cx - r, by - r * 0.12, r * 2, r * 0.26);
      ctx.fillStyle = 'rgba(255,255,255,0.16)';
      ctx.fillRect(cx - r, by - r * 0.12, r * 2, r * 0.08);
      ctx.restore();
      // Tight specular dot.
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.beginPath();
      ctx.arc(cx - r * 0.34, by - r * 0.4, r * 0.16, 0, Math.PI * 2);
      ctx.fill();
      // Collar + fuse.
      ctx.fillStyle = '#3a342c';
      ctx.fillRect(cx - r * 0.22, by - r * 1.12, r * 0.44, r * 0.3);
      ctx.strokeStyle = BOMB_FUSE;
      ctx.lineWidth = Math.max(2, rx * 0.07);
      ctx.beginPath();
      ctx.moveTo(cx, by - r * 1.05);
      ctx.quadraticCurveTo(cx + r * 0.55, by - r * 1.5, cx + r * 0.28, by - r * 1.95);
      ctx.stroke();
      // Spark (flickers; static under reduced motion via flicker arg).
      const sparkR = r * (0.2 + flicker * 0.12);
      ctx.fillStyle = BOMB_SPARK;
      ctx.beginPath();
      ctx.arc(cx + r * 0.28, by - r * 2.0, sparkR, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = BOMB_SPARK_HI;
      ctx.beginPath();
      ctx.arc(cx + r * 0.28, by - r * 2.0, sparkR * 0.5, 0, Math.PI * 2);
      ctx.fill();

      if (bombFlash > 0) {
        ctx.globalAlpha = Math.min(1, bombFlash);
        ctx.fillStyle = bombFlash > 0.5 ? '#ffffff' : '#f2a33c';
        ctx.beginPath();
        ctx.arc(cx, by, r * 1.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      }

      ctx.restore();
    },
    [],
  );

  // ── Full-field render ──
  const draw = useCallback(
    (ctx: CanvasRenderingContext2D, elapsed: number) => {
      const theme = themeRef.current;
      // Screen shake (bomb) — jitter the whole board while the impulse decays.
      ctx.save();
      if (shakeRef.current > 0 && !reducedMotionRef.current) {
        ctx.translate(
          (Math.random() - 0.5) * shakeRef.current * 16,
          (Math.random() - 0.5) * shakeRef.current * 11,
        );
        // Oversized backing fill so the jittered board never exposes stale edges.
        ctx.fillStyle = theme.woodBottom;
        ctx.fillRect(-24, -24, BASE_WIDTH + 48, BASE_HEIGHT + 48);
      }
      // ── Lacquered-wood board: vertical sheen + grain + a soft center light. ──
      const bg = ctx.createLinearGradient(0, 0, 0, BASE_HEIGHT);
      bg.addColorStop(0, theme.woodTop);
      bg.addColorStop(0.55, theme.woodMid);
      bg.addColorStop(1, theme.woodBottom);
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, BASE_WIDTH, BASE_HEIGHT);
      // Grain.
      ctx.save();
      ctx.globalAlpha = 0.05;
      ctx.lineWidth = 1;
      for (let y = 10; y < BASE_HEIGHT; y += 11) {
        const wob = Math.sin(y * 0.21) * 4;
        ctx.strokeStyle = y % 33 === 0 ? theme.woodGrainDk : theme.woodGrain;
        ctx.beginPath();
        ctx.moveTo(0, y + wob);
        ctx.lineTo(BASE_WIDTH, y - wob);
        ctx.stroke();
      }
      ctx.restore();
      // Soft center light + edge vignette (no glow — a radial multiply-ish wash).
      const vig = ctx.createRadialGradient(
        BASE_WIDTH / 2,
        BASE_HEIGHT * 0.46,
        80,
        BASE_WIDTH / 2,
        BASE_HEIGHT / 2,
        BASE_WIDTH * 0.62,
      );
      vig.addColorStop(0, 'rgba(255,231,189,0.10)');
      vig.addColorStop(0.6, 'rgba(0,0,0,0)');
      vig.addColorStop(1, 'rgba(0,0,0,0.32)');
      ctx.fillStyle = vig;
      ctx.fillRect(0, 0, BASE_WIDTH, BASE_HEIGHT);
      // Top deco band — three enamel tabs (red/amber/teal) like the poster.
      const tabW = 30;
      const tabGap = 8;
      const tabY = 9;
      const tabTotal = tabW * 3 + tabGap * 2;
      const tabX0 = BASE_WIDTH / 2 - tabTotal / 2;
      const tabColors = [ENAMEL_RED, ENAMEL_AMBER, ENAMEL_TEAL];
      for (let i = 0; i < 3; i += 1) {
        const x = tabX0 + i * (tabW + tabGap);
        ctx.fillStyle = 'rgba(0,0,0,0.3)';
        ctx.fillRect(x + 1, tabY + 2, tabW, 7);
        ctx.fillStyle = tabColors[i]!;
        ctx.fillRect(x, tabY, tabW, 7);
        ctx.fillStyle = 'rgba(255,255,255,0.25)';
        ctx.fillRect(x, tabY, tabW, 2);
      }

      const holes = holesRef.current;
      const rx = Math.min(CELL_W, CELL_H) * 0.4;
      const ry = rx * 0.62;
      const flicker = reducedMotionRef.current ? 0.5 : (Math.sin(elapsed / 90) + 1) / 2;

      for (let hole = 0; hole < GOPHER_HOLE_COUNT; hole += 1) {
        const { cx, cy } = holeCenter(hole);
        const vis = holes[hole];

        // Raised wooden rim around the hole (a mound: light top, dark bottom).
        const rimR = rx + 7;
        ctx.fillStyle = 'rgba(0,0,0,0.34)';
        ctx.beginPath();
        ctx.ellipse(cx, cy + 6, rimR, rimR * 0.62, 0, 0, Math.PI * 2);
        ctx.fill();
        const rimG = ctx.createLinearGradient(cx, cy - rimR * 0.62, cx, cy + rimR * 0.62);
        rimG.addColorStop(0, theme.rimHi);
        rimG.addColorStop(1, theme.rimLo);
        ctx.fillStyle = rimG;
        ctx.beginPath();
        ctx.ellipse(cx, cy, rimR, rimR * 0.62, 0, 0, Math.PI * 2);
        ctx.fill();
        // Recessed dark interior (radial — darkest at the back/top of the pit).
        const inG = ctx.createRadialGradient(cx, cy - ry * 0.3, ry * 0.2, cx, cy, rx);
        inG.addColorStop(0, theme.holeDark);
        inG.addColorStop(0.7, theme.holeDark);
        inG.addColorStop(1, theme.holeFloor);
        ctx.fillStyle = inG;
        ctx.beginPath();
        ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
        ctx.fill();
        // Inner top overhang shadow (the rim casts into the pit).
        ctx.strokeStyle = 'rgba(0,0,0,0.55)';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.ellipse(cx, cy, rx - 1, ry - 1, 0, Math.PI * 1.08, Math.PI * 1.92);
        ctx.stroke();

        // The occupant (gopher or bomb), if any is up. A just-bonked critter
        // renders as the flattened + dizzy pancake pose instead (distinct from
        // an escape, which simply ducks away with a dust puff).
        const flattenAge =
          vis && vis.bonkedAt > 0 ? elapsed - vis.bonkedAt : Infinity;
        if (vis && vis.popIndex >= 0 && flattenAge < FLATTEN_MS) {
          const pop = scheduleRef.current[vis.popIndex];
          if (pop && !pop.isBomb) {
            drawFlattenedGopher(
              ctx,
              cx,
              cy,
              rx,
              pop.kind,
              Math.max(0, Math.min(1, flattenAge / FLATTEN_MS)),
              elapsed,
            );
          }
        } else if (vis && vis.popIndex >= 0 && vis.raise > 0.001) {
          const pop = scheduleRef.current[vis.popIndex];
          if (pop && pop.isBomb) {
            drawBomb(ctx, cx, cy, rx, vis.raise, vis.bombFlash, flicker);
          } else if (pop) {
            // Squash & stretch from the raise velocity (rising = tall+narrow,
            // settling = short+wide) + a duck-telegraph wobble late in the window.
            const vel = vis.raise - vis.prevRaise;
            const stretch = 1 + vel * 1.9;
            const outT = pop.upEnd - elapsed;
            const wobble =
              !reducedMotionRef.current &&
              gameStateRef.current === 'playing' &&
              outT > 0 &&
              outT < 220
                ? Math.sin(elapsed / 55) * 0.09
                : 0;
            drawGopher(
              ctx,
              cx,
              cy,
              rx,
              vis.raise,
              vis.bonkFlash,
              pop.kind,
              scorerRef.current?.isArmorBroken(pop.index) ?? false,
              stretch,
              wobble,
              elapsed,
            );
          }
        }

        // FRONT rim — the lower half of the wooden mound, painted over the
        // occupant's base so it reads as emerging from inside the hole.
        ctx.save();
        ctx.beginPath();
        ctx.ellipse(cx, cy, rx, ry, 0, 0.04 * Math.PI, 0.96 * Math.PI);
        ctx.lineWidth = 7;
        ctx.strokeStyle = theme.rimLo;
        ctx.stroke();
        ctx.lineWidth = 2.5;
        ctx.strokeStyle = 'rgba(0,0,0,0.45)';
        ctx.beginPath();
        ctx.ellipse(cx, cy, rx - 1, ry - 1, 0, 0.08 * Math.PI, 0.92 * Math.PI);
        ctx.stroke();
        ctx.restore();
      }

      // ── Emerge-dirt clods (render-only juice). ──
      const dirt = dirtRef.current;
      for (let i = dirt.length - 1; i >= 0; i -= 1) {
        const d = dirt[i]!;
        d.life -= 0.05;
        d.x += d.vx;
        d.y += d.vy;
        d.vy += 0.3;
        if (d.life <= 0) {
          dirt.splice(i, 1);
          continue;
        }
        ctx.globalAlpha = Math.max(0, Math.min(1, d.life));
        ctx.fillStyle = d.color;
        ctx.beginPath();
        ctx.arc(d.x, d.y, d.size, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      // ── Bonk star-burst particles (render-only juice). ──
      const stars = starsRef.current;
      for (let i = stars.length - 1; i >= 0; i -= 1) {
        const st = stars[i]!;
        st.life -= 0.045;
        st.x += st.vx;
        st.y += st.vy;
        st.vy += 0.22;
        st.rot += st.vr;
        if (st.life <= 0) {
          stars.splice(i, 1);
          continue;
        }
        ctx.globalAlpha = Math.max(0, Math.min(1, st.life));
        ctx.fillStyle = st.color;
        starPath(ctx, st.x, st.y, st.size, st.rot);
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      // ── Dust rings (whiff near-miss + escape puffs). ──
      const puffs = puffsRef.current;
      for (let i = puffs.length - 1; i >= 0; i -= 1) {
        const p = puffs[i]!;
        p.life -= 0.06;
        p.r += p.vr;
        if (p.life <= 0) {
          puffs.splice(i, 1);
          continue;
        }
        ctx.globalAlpha = Math.max(0, Math.min(1, p.life)) * 0.9;
        ctx.strokeStyle = p.color;
        ctx.lineWidth = 3 * p.life + 1;
        ctx.beginPath();
        ctx.ellipse(p.x, p.y, p.r, p.r * 0.55, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;

      // ── Floating score plates ("+30", "quick", "combo break"). ──
      const popups = popupsRef.current;
      const calloutLook = readCanvasCalloutLook(ctx.canvas);
      for (let i = popups.length - 1; i >= 0; i -= 1) {
        const fp = popups[i]!;
        fp.life -= reducedMotionRef.current ? 0.045 : 0.022;
        if (fp.life <= 0) {
          popups.splice(i, 1);
          continue;
        }
        drawCanvasCallout(ctx, calloutLook, {
          text: fp.text,
          x: fp.x,
          y: fp.y,
          u: 1 - fp.life,
          tone: fp.tone,
          reducedMotion: reducedMotionRef.current,
          within: { left: 0, top: 0, right: BASE_WIDTH, bottom: BASE_HEIGHT },
        });
      }

      // ── Swinging mallet at the pointer (the player's whacker). ──
      const ptr = pointerRef.current;
      if (gameStateRef.current === 'playing' && ptr) {
        const swing = malletSwingRef.current;
        const angle = -0.62 + swing * 0.95; // rest raised; dips on a whack
        const len = rx * 1.5;
        const headW = rx * 1.15;
        const headH = rx * 0.52;
        ctx.save();
        ctx.translate(ptr.x, ptr.y);
        ctx.rotate(angle);
        // Handle.
        ctx.fillStyle = MALLET_HANDLE;
        ctx.fillRect(-headH * 0.16, -len, headH * 0.32, len);
        ctx.fillStyle = 'rgba(255,255,255,0.18)';
        ctx.fillRect(-headH * 0.16, -len, headH * 0.12, len);
        // Head (cream keycap drum).
        const hg = ctx.createLinearGradient(0, -len - headH, 0, -len + headH);
        hg.addColorStop(0, MALLET_HEAD);
        hg.addColorStop(1, MALLET_HEAD_LO);
        ctx.fillStyle = hg;
        ctx.beginPath();
        ctx.ellipse(0, -len, headW / 2, headH / 2, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = 'rgba(0,0,0,0.32)';
        ctx.stroke();
        ctx.fillStyle = 'rgba(255,255,255,0.4)';
        ctx.beginPath();
        ctx.ellipse(0, -len - headH * 0.16, headW * 0.32, headH * 0.16, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      ctx.restore(); // shake translate

      // ── Bomb flash — a hard white/amber wash over everything (fast decay;
      //    kept brief + dimmer under reduced motion via the lower start alpha). ──
      if (flashRef.current > 0) {
        const f = Math.max(0, Math.min(1, flashRef.current));
        ctx.globalAlpha = f * (reducedMotionRef.current ? 0.35 : 0.75);
        ctx.fillStyle = f > 0.5 ? '#fff4dd' : '#f2a33c';
        ctx.fillRect(0, 0, BASE_WIDTH, BASE_HEIGHT);
        ctx.globalAlpha = 1;
      }
    },
    [drawBomb, drawFlattenedGopher, drawGopher, holeCenter],
  );

  // ── Per-frame update: surface escapes from the shared scorer, advance hole
  //    raise toward the scheduled target (overshoot pop-in ease), spawn emerge
  //    dirt, decay flashes / shake / bomb flash. ──
  const stepHoles = useCallback(
    (elapsed: number, dtFrames: number) => {
      const holes = holesRef.current;
      const schedule = scheduleRef.current;

      // Escapes up to this instant. The INTEGER clock matters: submitted bonk
      // timestamps are floored the same way, so the scorer's escape ordering is
      // identical to the server replay.
      const scorer = scorerRef.current;
      if (scorer && !scorer.bombHit) {
        handleEscapes(scorer.advanceTo(Math.floor(elapsed)));
      }

      // Decay the mallet swing back to its resting raised pose.
      if (malletSwingRef.current > 0) {
        malletSwingRef.current = Math.max(0, malletSwingRef.current - 0.14 * dtFrames);
      }
      // Decay bomb shake + flash impulses.
      if (shakeRef.current > 0) {
        shakeRef.current = Math.max(0, shakeRef.current - 0.05 * dtFrames);
      }
      if (flashRef.current > 0) {
        flashRef.current = Math.max(0, flashRef.current - 0.055 * dtFrames);
      }

      // Determine the active pop per hole at this instant (≤1 each), and the
      // next upcoming one (for the pre-emerge dirt-trickle telegraph).
      for (let hole = 0; hole < GOPHER_HOLE_COUNT; hole += 1) {
        const vis = holes[hole];
        if (!vis) continue;

        let active: GopherPop | null = null;
        let upcoming: GopherPop | null = null;
        for (let i = 0; i < schedule.length; i += 1) {
          const pop = schedule[i]!;
          if (pop.hole !== hole) continue;
          if (elapsed < pop.upStart) {
            if (!upcoming) upcoming = pop;
            continue;
          }
          if (elapsed > pop.upEnd) continue;
          active = pop;
          break;
        }

        // Anticipation: a tiny dirt trickle leaks from the hole a beat before
        // the next occupant bursts out. Render-only — reads the schedule,
        // never writes it; one-shot per pop via telegraphFor.
        if (
          !active &&
          upcoming &&
          upcoming.upStart > elapsed &&
          upcoming.upStart - elapsed <= TELEGRAPH_MS &&
          vis.telegraphFor !== upcoming.index
        ) {
          vis.telegraphFor = upcoming.index;
          const { cx, cy } = holeCenter(hole);
          spawnTrickle(cx, cy);
        }

        // Decide the raise target. A bonked gopher stays down for the rest of
        // its window; an active bomb/gopher rises; otherwise it ducks.
        let target = 0;
        if (active) {
          if (active.isBomb || !(scorer?.isUsed(active.index) ?? false)) {
            // Anticipation pop-in: overshoot ease over the first ~200ms, then a
            // quick duck over the last ~170ms.
            const inT = elapsed - active.upStart;
            const outT = active.upEnd - elapsed;
            const up = easeOutBack(Math.max(0, Math.min(1, inT / 200)));
            const down = Math.max(0, Math.min(1, outT / 170));
            target = Math.max(0, up * down);
          }
          if (vis.popIndex !== active.index) {
            // A new occupant claims this hole — reset its per-pop feedback and
            // kick up dirt as it bursts out.
            vis.popIndex = active.index;
            vis.bonkedAt = 0;
            vis.armorHitAt = 0;
          }
          if (vis.dirtFor !== active.index && elapsed - active.upStart < 250) {
            vis.dirtFor = active.index;
            const { cx, cy } = holeCenter(hole);
            spawnDirt(cx, cy);
          }
        } else if (
          vis.raise <= 0.02 &&
          (vis.bonkedAt <= 0 || elapsed - vis.bonkedAt >= FLATTEN_MS)
        ) {
          // The window has passed, the occupant has fully ducked, and any
          // flatten pose has played out — clear it so the hole renders empty.
          // While still ducking/flattened we keep popIndex so the correct
          // sprite animates out.
          vis.popIndex = -1;
          vis.bonkedAt = 0;
        }

        // Approach target (snappy spring; instant under reduced motion).
        vis.prevRaise = vis.raise;
        if (reducedMotionRef.current) {
          vis.raise = target;
        } else {
          const k = Math.min(1, 0.42 * dtFrames);
          vis.raise += (target - vis.raise) * k;
        }

        // Decay flashes.
        if (vis.bonkFlash > 0) vis.bonkFlash = Math.max(0, vis.bonkFlash - 0.12 * dtFrames);
        if (vis.bombFlash > 0) vis.bombFlash = Math.max(0, vis.bombFlash - 0.08 * dtFrames);
      }
    },
    [handleEscapes, holeCenter, spawnDirt, spawnTrickle],
  );

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
    setBombEnded(false);
    clearTimers();

    let sessionSuccess = false;
    try {
      const sessionResponse = await fetch('/api/games/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gameType: 'gopher' }),
      });
      if (sessionResponse.ok) {
        setBanIndefinite(false);
        setBanUntilMs(null);
        const sessionData = await sessionResponse.json();
        sessionTokenRef.current = sessionData.token;
        seedRef.current =
          typeof sessionData.gopherSeed === 'number' ? sessionData.gopherSeed : null;
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

    // Build the deterministic schedule from the seed (identical to the server)
    // and a fresh scorer over it (the same machine the server replays).
    scheduleRef.current = deriveGopherSchedule(seedRef.current ?? 1);
    scorerRef.current = createGopherScorer(scheduleRef.current);

    // Reset run state.
    scoreRef.current = 0;
    bonksRef.current = [];
    prevMultX2Ref.current = 2;
    if (bombEndTimeoutRef.current !== null) {
      window.clearTimeout(bombEndTimeoutRef.current);
      bombEndTimeoutRef.current = null;
    }
    starsRef.current = [];
    popupsRef.current = [];
    dirtRef.current = [];
    puffsRef.current = [];
    shakeRef.current = 0;
    flashRef.current = 0;
    resetHoles();
    setScore(0);
    setCombo({ streak: 0, multX2: 2 });
    setBestStreak(0);
    setRemainingMs(SPRINT_MS);
    startPerfRef.current = performance.now();
    gameStateRef.current = 'playing';
    setGameState('playing');
    SoundManager.play(SFX.start);
    playHaptic('light');

    frameLoopRef.current?.destroy();
    frameLoopRef.current = createGameFrameLoop({
      stepMs: FRAME_TIME,
      // Gopher scoring/scheduling is derived from the wall clock and the tap
      // log, not an integrated physics state. Fixed simulation ticks are kept
      // empty while presentation advances once per high-refresh paint below.
      simulate: () => undefined,
      render: (_alpha, frame) => {
        const canvas = canvasRef.current;
        const ctx = canvas ? getGame2dContext(canvas, { alpha: false }) : null;
        if (!canvas || !ctx) {
          frameLoopRef.current?.stop();
          return;
        }
        const elapsed = frame.nowMs - startPerfRef.current;
        if (gameStateRef.current === 'playing') {
          stepHoles(elapsed, frame.deltaMs / FRAME_TIME);
        }
        ctx.save();
        ctx.scale(scaleRef.current, scaleRef.current);
        draw(ctx, elapsed);
        ctx.restore();
        if (gameStateRef.current !== 'playing') frameLoopRef.current?.stop();
      },
    });
    frameLoopRef.current.start();

    // Countdown driven by the wall clock (display only — the SERVER clock is
    // authoritative for scoring). When it hits 0 we end the run + submit.
    tickTimerRef.current = setInterval(() => {
      const left = SPRINT_MS - (performance.now() - startPerfRef.current);
      if (left <= 0) {
        setRemainingMs(0);
        endRunRef.current?.(false);
      } else {
        setRemainingMs(left);
      }
    }, TICK_MS);
  }, [clearTimers, draw, resetHoles, resetRunResult, stepHoles]);

  const handlePrimaryAction = useCallback(() => {
    const current = gameStateRef.current;
    if (current === 'idle' || current === 'gameover' || current === 'error') {
      startGame();
    }
  }, [startGame]);

  // ── Pointer handling ──
  // Convert a pointer event to logical canvas coords (for the mallet position).
  const pointerToLogical = useCallback((clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    return {
      x: ((clientX - rect.left) / rect.width) * BASE_WIDTH,
      y: ((clientY - rect.top) / rect.height) * BASE_HEIGHT,
    };
  }, []);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      if (gameStateRef.current === 'playing') {
        pointerRef.current = pointerToLogical(e.clientX, e.clientY);
        malletSwingRef.current = 1; // swing the mallet on every whack
        const hole = pointerToHole(e.clientX, e.clientY);
        if (hole >= 0) tapHole(hole);
      } else {
        handlePrimaryAction();
      }
    },
    [handlePrimaryAction, pointerToHole, pointerToLogical, tapHole],
  );

  // Track the pointer so the mallet follows the cursor during play.
  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (gameStateRef.current !== 'playing') return;
      pointerRef.current = pointerToLogical(e.clientX, e.clientY);
    },
    [pointerToLogical],
  );

  const handlePointerLeave = useCallback(() => {
    pointerRef.current = null;
  }, []);

  // Physical keyboard: 1-9 numpad-style mapping to the 9 holes during play
  // (keeps the game playable without a pointer); Space/Enter to start/restart.
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.repeat) return;
      if (gameStateRef.current === 'playing') {
        if (e.key >= '1' && e.key <= '9') {
          e.preventDefault();
          // Map 1-9 to a top-left → bottom-right grid (1 = top-left).
          tapHole(parseInt(e.key, 10) - 1);
        }
        return;
      }
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        handlePrimaryAction();
      }
    },
    [handlePrimaryAction, tapHole],
  );

  // ── Effects ──
  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  useEffect(() => {
    const monitor = envMonitorRef.current;
    return () => {
      clearTimers();
      frameLoopRef.current?.destroy();
      frameLoopRef.current = null;
      if (bombEndTimeoutRef.current !== null) {
        window.clearTimeout(bombEndTimeoutRef.current);
        bombEndTimeoutRef.current = null;
      }
      monitor.stop();
    };
  }, [clearTimers]);

  // Reduced-motion preference.
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

  // Responsive sizing — the canvas fills the wide stage.
  useEffect(() => {
    const updateSize = () => {
      const container = containerRef.current;
      if (!container) return;
      const reservedVertical = window.innerHeight < 700 ? 240 : 300;
      const maxWidth = Math.min(container.clientWidth || window.innerWidth, 900);
      const maxHeight = Math.min(window.innerHeight - reservedVertical, BASE_HEIGHT);
      const scale = Math.min(maxWidth / BASE_WIDTH, maxHeight / BASE_HEIGHT, 1.25);
      const cssWidth = Math.floor(BASE_WIDTH * scale);
      const cssHeight = Math.floor(BASE_HEIGHT * scale);
      const dpr = gameCanvasDpr(cssWidth, cssHeight);
      scaleRef.current = scale * dpr;
      setCanvasSize({
        width: cssWidth,
        height: cssHeight,
        dpr,
      });
    };
    updateSize();
    window.addEventListener('resize', updateSize);
    return () => window.removeEventListener('resize', updateSize);
  }, []);

  // Idle/static render whenever we're not animating (idle, gameover, error, or
  // after a resize). Keeps the field on-theme without running the loop.
  useEffect(() => {
    if (gameState === 'playing') return;
    const canvas = canvasRef.current;
    const ctx = canvas ? getGame2dContext(canvas, { alpha: false }) : null;
    if (!canvas || !ctx) return;
    if (holesRef.current.length === 0) resetHoles();
    ctx.save();
    ctx.scale(scaleRef.current, scaleRef.current);
    draw(ctx, 0);
    ctx.restore();
    // gopherTheme is a dep so the idle board repaints once cosmetics load.
  }, [canvasSize, draw, gameState, gopherTheme, resetHoles]);

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

  const isPlaying = gameState === 'playing';
  const secondsLeft = Math.ceil(remainingMs / 1000);
  const timePct = Math.max(0, Math.min(100, (remainingMs / SPRINT_MS) * 100));
  const lowTime = remainingMs <= LOW_TIME_MS;

  // Combo meter derived values: current multiplier + progress to the next tier.
  const comboMult = combo.multX2 / 2;
  const nextMult = gopherComboMultiplierX2(combo.streak + 1) / 2;
  const nextTierIdx = COMBO_TIER_STEPS.findIndex((s) => combo.streak < s);
  const comboPct =
    nextTierIdx === -1
      ? 100
      : Math.max(
          0,
          Math.min(
            100,
            ((combo.streak - (nextTierIdx === 0 ? 0 : COMBO_TIER_STEPS[nextTierIdx - 1]!)) /
              (COMBO_TIER_STEPS[nextTierIdx]! -
                (nextTierIdx === 0 ? 0 : COMBO_TIER_STEPS[nextTierIdx - 1]!))) *
              100,
          ),
        );

  return (
    <div className="gopher-midway arc-game-flow">
      <div className="w-full space-y-3 sm:space-y-4">
        <div className="mx-auto w-full max-w-5xl">
          <div className="hidden sm:block">
            <PageHeader
              eyebrow="Arcade"
              icon={<Hammer aria-hidden className="h-6 w-6" />}
              title="Gopher Pop"
              subtitle="Chain bonks for combo points in 60 seconds — quick hits pay extra, golden gophers pay big, and one bomb ends it all."
              wallet={walletCard}
            />
          </div>
          <div className="sm:hidden">
            <GamesWalletCard wallet={walletCard} compact />
          </div>
        </div>

        <div ref={containerRef} className="relative flex w-full justify-center">
          <div
            className="gopher-stage relative"
            style={{ width: canvasSize.width }}
          >
            <div className="gopher-hud">
              <span className="gopher-hud-stat">
                Score <b>{score}</b>
              </span>
              <span className="gopher-hud-stat" data-low={lowTime ? 'true' : undefined}>
                Time{' '}
                <b>
                  {isPlaying || gameState === 'gameover'
                    ? `${secondsLeft}s`
                    : `${GOPHER_SPRINT_DURATION_SEC}s`}
                </b>
              </span>
              <span className="gopher-hud-stat">
                Best <b>{highScore}</b>
              </span>
            </div>

            <div className="gopher-timebar" aria-hidden>
              <div
                className="gopher-timebar-fill"
                data-low={lowTime ? 'true' : undefined}
                style={{ width: `${timePct}%` }}
              />
            </div>

            {/* Combo meter — streak, current multiplier, progress to next tier.
                Remounts on a break so the shake animation replays. */}
            <div
              key={`combo-${comboBreakKey}`}
              className="gopher-combo"
              data-live={combo.streak > 0 ? 'true' : undefined}
              data-broke={
                comboBreakKey > 0 && combo.streak === 0 ? 'true' : undefined
              }
              aria-label={`Combo ${combo.streak} streak, multiplier ${comboMult}x`}
            >
              <span
                key={`pulse-${comboPulseKey}`}
                className="gopher-combo-mult"
                data-max={combo.multX2 >= 6 ? 'true' : undefined}
              >
                ×{comboMult}
              </span>
              <span className="gopher-combo-track" aria-hidden>
                <span
                  className="gopher-combo-fill"
                  style={{ width: `${comboPct}%` }}
                />
              </span>
              <span className="gopher-combo-streak">
                {combo.streak > 0
                  ? `${combo.streak} streak${comboMult < nextMult ? ` · next ×${nextMult}` : ''}`
                  : 'combo — chain bonks!'}
              </span>
            </div>

            <div className="gopher-field">
              <canvas
                ref={canvasRef}
                className="gopher-canvas"
                width={Math.floor(canvasSize.width * canvasSize.dpr)}
                height={Math.floor(canvasSize.height * canvasSize.dpr)}
                style={{ width: canvasSize.width, height: canvasSize.height }}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerLeave={handlePointerLeave}
                aria-label="Gopher Pop grid"
              />

              {/* Overlay for idle / gameover / error */}
              {!isPlaying && (
                <div
                  className="gopher-overlay absolute inset-0 flex touch-none flex-col items-center justify-center rounded-well px-4"
                  style={{
                    background:
                      'color-mix(in srgb, var(--scrim) 80%, transparent)',
                  }}
                  onPointerDown={(e) => {
                    e.preventDefault();
                    handlePrimaryAction();
                  }}
                >
                  {gameState === 'idle' && (
                    <>
                      <Hammer size={56} className="mb-4 text-tickets-text" />
                      <h1 className="arcade-display mb-2 text-center text-2xl text-strong uppercase sm:text-3xl">
                        Gopher Pop
                      </h1>
                      <p className="mb-2 text-center text-sm text-strong sm:text-base">
                        {isStartingSession
                          ? 'Starting your run…'
                          : touchDevice
                            ? 'Tap anywhere to start'
                            : 'Press Space or click to start'}
                      </p>
                      <p className="max-w-xs text-center text-xs text-body sm:text-sm">
                        Bonk gophers as they pop up — chain hits without a whiff
                        or an escape to grow your combo, and bonk fast for a
                        QUICK bonus. Golden pays big, armored takes two taps,
                        and one bomb ends the run.
                      </p>
                    </>
                  )}

                  {gameState === 'gameover' && (
                    <>
                      <h2 className="arcade-display mb-2 text-2xl text-strong uppercase sm:text-3xl">
                        {bombEnded ? 'Boom!' : 'Time!'}
                      </h2>
                      <p className="mb-1 text-xl text-strong sm:text-2xl">
                        Score{' '}
                        <span className="arcade-num font-semibold">{score}</span>
                      </p>
                      {bombEnded && (
                        <p className="mb-1 text-base text-tickets-text sm:text-lg">
                          You hit a bomb.
                        </p>
                      )}
                      <p className="mb-4 text-base text-body sm:text-lg">
                        Best <span className="arcade-num">{highScore}</span>
                        {bestStreak > 1 ? (
                          <>
                            {' · '}Top streak{' '}
                            <span className="arcade-num">{bestStreak}</span>
                          </>
                        ) : null}
                      </p>
                      <ArcadeRunRewards reward={runResult.reward} achievements={runResult.achievements} saving={isSubmitting} error={submitError} guest={runRewardMessage?.startsWith('Guest run')} className="mb-4 max-w-xs" />
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
        </div>

        <p className="mt-3 text-center text-xs text-faint sm:text-sm">
          {touchDevice ? (
            'Tap the gophers — dodge the bombs'
          ) : (
            <>
              Click the gophers, or use the{' '}
              <kbd className="arcade-card-inset px-2 py-1 text-strong">1</kbd>–
              <kbd className="arcade-card-inset px-2 py-1 text-strong">9</kbd> keys
            </>
          )}
        </p>

        <div className="mt-2 flex flex-col items-center gap-3 sm:mt-4 sm:gap-4">
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
        title="Gopher Pop board"
        description="Highest combo score in 60 seconds, and your rank."
      >
        <GameLeaderboard
          gameType="gopher"
          maxEntries={5}
          enableFullLeaderboardModal
          fullLeaderboardDisplay="inline"
          refreshKey={leaderboardRefreshKey}
        />
      </GameLeaderboardModal>
    </div>
  );
}
