'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Heart,
  Trophy,
  Share2,
  RotateCcw,
  Check,
  Grid2x2,
} from 'lucide-react';
import { ArcadeButton, ArcadeChip, ArcadeNotice } from '@/features/arcade/components/ui/arcade-ui';
import { DAILY_BOARD_MODES, GameLeaderboard } from '@/features/arcade/components/game-leaderboard';
import { PageHeader, GamesWalletCard } from '@/features/arcade/components/shell/page-header';
import { GameLeaderboardModal } from '@/features/arcade/components/game-leaderboard-modal';
import { GameLeaderboardButton } from '@/features/arcade/components/game-leaderboard-button';
import { GameInventoryModal } from '@/features/arcade/components/game-inventory-modal';
import { GameInventoryButton } from '@/features/arcade/components/game-inventory-button';
import { GamesRouteSwitcher } from '@/features/arcade/components/games-route-switcher';
import { ArcadeRunRewards } from '@/features/arcade/components/results/arcade-run-result';
import { MuteButton } from '@/features/arcade/components/mute-button';
import { SoundManager } from '@/features/arcade/lib/sound-manager';
import {
  createGameFrameLoop,
  type GameFrameLoop,
} from '@/features/arcade/lib/game-frame-loop';
import { useArcadeRunResult } from '@/features/arcade/lib/run-result';
import {
  type ConnectionsCosmeticTheme,
  DEFAULT_CONNECTIONS_THEME,
  buildConnectionsTheme,
  connectionsThemeToCssVars,
} from './_connections-theme';
import './_connections-midway.css';
import { ArcadeLoading } from '@/features/arcade/components/ui/arcade-states';

// ─── Types ──────────────────────────────────────────────────────────────────
type ConnectionsGroup = {
  category: string;
  words: [string, string, string, string];
  color: '#f8d74e' | '#7ed66e' | '#6eb4f8' | '#c97ed6';
};

type ConnectionsPuzzle = {
  groups: [ConnectionsGroup, ConnectionsGroup, ConnectionsGroup, ConnectionsGroup];
};

// ─── Constants ──────────────────────────────────────────────────────────────
const MAX_LIVES = 4;
const MAX_SELECTED = 4;
const SHAKE_DURATION = 600;
const REVEAL_DURATION = 500;
const CONFETTI_DURATION = 3000;

// NYT-style pre-submit pop animation
const POP_PER_TILE_MS = 220;
const POP_STAGGER_MS = 70;
// Total time before the pop cascade has fully played out
const POP_TOTAL_MS = POP_PER_TILE_MS + POP_STAGGER_MS * (MAX_SELECTED - 1);

// Toast lifetime (e.g. "One away!", "Already guessed!")
const TOAST_DURATION = 1600;

// Normalize a selection so order doesn't matter when checking duplicates.
const selectionKey = (words: string[]) =>
  [...words].sort().join('|');

const getSubmitErrorMessage = (payload: { error?: unknown } | null) =>
  typeof payload?.error === 'string' && payload.error.trim().length > 0
    ? payload.error
    : 'Could not submit score. Please try again.';

// ─── Date helpers ───────────────────────────────────────────────────────────
const pad2 = (n: number) => n.toString().padStart(2, '0');

const getDateKey = (d: Date = new Date()) =>
  `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

const formatDateDisplay = (d: Date = new Date()) => {
  const months = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  ];
  return `${months[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
};

// ─── Shuffle (Fisher-Yates with date-seeded PRNG for consistency) ───────────
const seededRandom = (seed: number) => {
  let s = seed;
  return () => {
    s = (s * 16807 + 0) % 2147483647;
    return (s - 1) / 2147483646;
  };
};

const shuffleWithSeed = <T,>(arr: T[], seed: number): T[] => {
  const out = [...arr];
  const rand = seededRandom(seed);
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
};

const dateToSeed = (d: Date): number => {
  const str = getDateKey(d);
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) || 1;
};

const getPuzzleWords = (puzzle: ConnectionsPuzzle): string[] =>
  puzzle.groups.flatMap((g) => g.words);

// ─── Enamel band mapping ─────────────────────────────────────────────────────
// The puzzle data carries NYT-style difficulty colors. We DON'T touch that data
// (seed/logic/validation depend on it) — we only remap each color to one of the
// four Midway enamel tones at render time so solved bands read as painted plates.
// yellow → tickets (amber) · green → prize (teal) · blue → info · purple → primary (red)
type EnamelTone = 'tickets' | 'prize' | 'info' | 'primary';
const ENAMEL_FOR_COLOR: Record<ConnectionsGroup['color'], EnamelTone> = {
  '#f8d74e': 'tickets',
  '#7ed66e': 'prize',
  '#6eb4f8': 'info',
  '#c97ed6': 'primary',
};
const toneForGroup = (group: ConnectionsGroup): EnamelTone =>
  ENAMEL_FOR_COLOR[group.color] ?? 'tickets';

// ─── LocalStorage helpers ───────────────────────────────────────────────────
type SavedState = {
  dateKey: string;
  foundGroups: number[];
  mistakes: number;
  elapsedMs: number;
  gameOver: boolean;
  won: boolean;
  submitted: boolean;
};

const LS_KEY_PREFIX = 'connections_';

const loadSavedState = (dateKey: string): SavedState | null => {
  try {
    const raw = localStorage.getItem(`${LS_KEY_PREFIX}${dateKey}`);
    return raw ? (JSON.parse(raw) as SavedState) : null;
  } catch {
    return null;
  }
};

const saveSavedState = (state: SavedState) => {
  try {
    localStorage.setItem(`${LS_KEY_PREFIX}${state.dateKey}`, JSON.stringify(state));
  } catch {
    // Ignore quota errors
  }
};

// ─── Confetti ───────────────────────────────────────────────────────────────
function ConfettiBurst() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    // Respect reduced-motion: skip the confetti animation entirely.
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    const particles: Array<{
      x: number;
      y: number;
      vx: number;
      vy: number;
      color: string;
      size: number;
      rotation: number;
      rotationSpeed: number;
      life: number;
    }> = [];

    // Midway enamel paints — amber, teal, blue, red, green, violet (no glow).
    const colors = ['#f2a33c', '#2fb8a6', '#6c8fe0', '#c73538', '#5fc06a', '#9a52d6'];
    for (let i = 0; i < 150; i++) {
      particles.push({
        x: canvas.width / 2 + (Math.random() - 0.5) * 200,
        y: canvas.height / 2,
        vx: (Math.random() - 0.5) * 15,
        vy: -Math.random() * 15 - 5,
        color: colors[Math.floor(Math.random() * colors.length)]!,
        size: Math.random() * 8 + 4,
        rotation: Math.random() * Math.PI * 2,
        rotationSpeed: (Math.random() - 0.5) * 0.3,
        life: 1,
      });
    }

    const frameLoop = createGameFrameLoop({
      // Preserve the original per-painted-frame confetti motion; the shared
      // runtime owns scheduling and hidden-tab suspension only.
      simulate: () => undefined,
      render: () => {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        let alive = false;
        for (const p of particles) {
          if (p.life <= 0) continue;
          alive = true;
          p.x += p.vx;
          p.y += p.vy;
          p.vy += 0.3;
          p.vx *= 0.99;
          p.rotation += p.rotationSpeed;
          p.life -= 0.008;
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(p.rotation);
          ctx.globalAlpha = Math.max(0, p.life);
          ctx.fillStyle = p.color;
          ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
          ctx.restore();
        }
        if (!alive) frameLoop.stop();
      },
    });
    frameLoop.start();
    return () => frameLoop.destroy();
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className='fixed inset-0 pointer-events-none z-50'
      aria-hidden='true'
    />
  );
}

// ─── Main component ─────────────────────────────────────────────────────────
export default function ConnectionsPage() {
  const [dateKey] = useState(() => getDateKey());
  const isWeekday = new Date().getDay() !== 0 && new Date().getDay() !== 6;

  // Detect date rollover (midnight) and reload the page
  useEffect(() => {
    let timer: number | null = null;
    const check = () => {
      const currentKey = getDateKey();
      if (currentKey !== dateKey) {
        // Date changed — reload to get the new puzzle
        window.location.reload();
      }
    };
    const stop = () => {
      if (timer === null) return;
      window.clearInterval(timer);
      timer = null;
    };
    const start = () => {
      if (timer !== null || document.hidden) return;
      check();
      timer = window.setInterval(check, 60_000);
    };
    const onVisibility = () => {
      if (document.hidden) stop();
      else start();
    };
    start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [dateKey]);

  // ─── State ──────────────────────────────────────────────────────────────
  const [puzzle, setPuzzle] = useState<ConnectionsPuzzle | null>(null);
  const [puzzleLoading, setPuzzleLoading] = useState(true);
  const [puzzleError, setPuzzleError] = useState<string | null>(null);
  const [noPuzzleMessage, setNoPuzzleMessage] = useState<string | null>(null);
  const [gameStarted, setGameStarted] = useState(false);
  const [shuffledWords, setShuffledWords] = useState<string[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [foundGroups, setFoundGroups] = useState<ConnectionsGroup[]>([]);
  const [foundGroupIndices, setFoundGroupIndices] = useState<number[]>([]);
  const [mistakes, setMistakes] = useState(0);
  const [gameOver, setGameOver] = useState(false);
  const [won, setWon] = useState(false);
  const [shakingWords, setShakingWords] = useState<Set<string>>(new Set());
  const [jumpingWords, setJumpingWords] = useState<string[]>([]);
  const [revealingGroup, setRevealingGroup] = useState<ConnectionsGroup | null>(null);
  const [showConfetti, setShowConfetti] = useState(false);
  // Set of normalized selection keys the player has already submitted
  // (incorrectly). NYT shows "Already guessed!" without consuming a mistake.
  const [previousGuesses, setPreviousGuesses] = useState<Set<string>>(new Set());
  // Floating toast at the top of the play area ("One away!", "Already guessed!", etc.)
  // The nonce forces React to remount the toast element so the CSS animation
  // restarts even when the message text is identical to the previous toast.
  const [toast, setToast] = useState<{ message: string; nonce: number } | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [timerRunning, setTimerRunning] = useState(false);
  const [hasSubmittedScore, setHasSubmittedScore] = useState(false);
  const [shareMessage, setShareMessage] = useState('');
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const [showInventory, setShowInventory] = useState(false);
  const [leaderboardRefreshKey, setLeaderboardRefreshKey] = useState(0);
  const [leaderboardMode, setLeaderboardMode] = useState<'daily' | 'alltime'>('daily');
  const [walletBalances, setWalletBalances] = useState({ credits: 0 });
  const [dailyCreditsProgress, setDailyCreditsProgress] = useState({ earned: 0, cap: 300 });
  const [theme, setTheme] = useState<ConnectionsCosmeticTheme>(
    DEFAULT_CONNECTIONS_THEME,
  );
  const {
    reward: runReward,
    achievements: runAchievements,
    capture: captureRunResult,
    reset: resetRunResult,
  } = useArcadeRunResult();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmittingScore, setIsSubmittingScore] = useState(false);

  const timerRef = useRef<GameFrameLoop | null>(null);
  const startTimeRef = useRef<number>(0);
  const elapsedAtStartRef = useRef<number>(0);
  const restoredPendingSubmitRef = useRef<{
    solved: boolean;
    mistakes: number;
    elapsedMs: number;
  } | null>(null);
  const autoRetryAttemptedRef = useRef(false);

  // ─── Fetch puzzle from API ──────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    const fetchPuzzle = async () => {
      try {
        const res = await fetch('/api/games/connections/puzzle', { cache: 'no-store' });
        if (!res.ok) {
          setPuzzleError('Failed to load puzzle');
          return;
        }
        const data = await res.json();
        if (cancelled) return;
        if (data.puzzle) {
          setPuzzle(data.puzzle as ConnectionsPuzzle);
        } else {
          setPuzzleError(data.reason ?? 'no-puzzle');
          if (data.message) setNoPuzzleMessage(data.message as string);
        }
      } catch {
        if (!cancelled) setPuzzleError('Failed to load puzzle');
      } finally {
        if (!cancelled) setPuzzleLoading(false);
      }
    };
    void fetchPuzzle();
    return () => { cancelled = true; };
  }, []);

  // ─── Initialize game when puzzle loads ──────────────────────────────────
  useEffect(() => {
    if (!puzzle) return;

    const saved = loadSavedState(dateKey);
    const words = getPuzzleWords(puzzle);
    // Derive seed from dateKey (stable string) instead of the Date object
    const seed = dateToSeed(
      (() => { const [y, m, d] = dateKey.split('-').map(Number); return new Date(y!, m! - 1, d!); })(),
    );

    if (saved && saved.dateKey === dateKey) {
      const restoredFoundGroups = saved.foundGroups.map((i) => puzzle.groups[i]!);
      const restoredFoundWords = new Set(restoredFoundGroups.flatMap((g) => g.words));
      const remainingWords = words.filter((w) => !restoredFoundWords.has(w));
      setShuffledWords(shuffleWithSeed(remainingWords, seed));
      setFoundGroups(restoredFoundGroups);
      setFoundGroupIndices(saved.foundGroups);
      setMistakes(saved.mistakes);
      setElapsedMs(saved.elapsedMs);
      setGameOver(saved.gameOver);
      setWon(saved.won);
      setHasSubmittedScore(saved.submitted);
      restoredPendingSubmitRef.current =
        saved.gameOver && !saved.submitted
          ? {
              solved: saved.won,
              mistakes: saved.mistakes,
              elapsedMs: saved.elapsedMs,
            }
          : null;
      autoRetryAttemptedRef.current = false;
      setGameStarted(true); // Already in progress — skip pregame
      if (!saved.gameOver) {
        startTimeRef.current = Date.now();
        elapsedAtStartRef.current = saved.elapsedMs;
        setTimerRunning(true);
      }
    } else {
      resetRunResult();
      setShuffledWords(shuffleWithSeed(words, seed));
      setGameStarted(false); // Fresh puzzle — show pregame
      setFoundGroups([]);
      setFoundGroupIndices([]);
      setMistakes(0);
      setElapsedMs(0);
      setGameOver(false);
      setWon(false);
      setHasSubmittedScore(false);
      setPreviousGuesses(new Set());
      setSubmitError(null);
      restoredPendingSubmitRef.current = null;
      autoRetryAttemptedRef.current = false;
    }
  }, [puzzle, dateKey, resetRunResult]);

  // ─── Timer ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!timerRunning) {
      timerRef.current?.destroy();
      timerRef.current = null;
      return;
    }
    let displayedTenth = -1;
    const frameLoop = createGameFrameLoop({
      // Final score timing still reads Date.now() directly. Keep the existing
      // decisecond persistence cadence while suspending display work hidden.
      simulate: () => undefined,
      render: () => {
        const elapsed =
          elapsedAtStartRef.current + (Date.now() - startTimeRef.current);
        const tenth = Math.floor(elapsed / 100);
        if (tenth === displayedTenth) return;
        displayedTenth = tenth;
        setElapsedMs(elapsed);
      },
    });
    timerRef.current = frameLoop;
    frameLoop.start();
    return () => {
      frameLoop.destroy();
      if (timerRef.current === frameLoop) timerRef.current = null;
    };
  }, [timerRunning]);

  // ─── Load wallet data ──────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    const loadWallet = async () => {
      try {
        const res = await fetch('/api/store/inventory?gameType=connections', {
          cache: 'no-store',
        });
        if (!res.ok) return;
        const payload = (await res.json()) as {
          wallet?: { credits?: number };
          dailyGameCredits?: { earned?: number; cap?: number };
          equipped?: Array<{
            slot?: string;
            item?: { assetRef?: Record<string, unknown> | null } | null;
          }>;
        };
        if (cancelled) return;
        setWalletBalances({
          credits: payload.wallet?.credits ?? 0,
        });
        setDailyCreditsProgress({
          earned: payload.dailyGameCredits?.earned ?? 0,
          cap: payload.dailyGameCredits?.cap ?? 300,
        });
        setTheme(buildConnectionsTheme(payload));
      } catch {
        /* silently fail */
      }
    };
    void loadWallet();
    return () => { cancelled = true; };
  }, []);

  // ─── Save state on change ──────────────────────────────────────────────
  useEffect(() => {
    if (!puzzle) return;
    saveSavedState({
      dateKey,
      foundGroups: foundGroupIndices,
      mistakes,
      elapsedMs,
      gameOver,
      won,
      submitted: hasSubmittedScore,
    });
  }, [dateKey, foundGroupIndices, mistakes, elapsedMs, gameOver, won, hasSubmittedScore, puzzle]);

  // ─── Submit score ─────────────────────────────────────────────────────
  const submitScore = useCallback(async (solved: boolean, finalMistakes: number, timeMs: number) => {
    if (hasSubmittedScore) return;

    // Use current date at submission time (not stale render-time date)
    const submitDateKey = getDateKey();
    let submitted = false;

    try {
      setIsSubmittingScore(true);
      setSubmitError(null);
      const res = await fetch('/api/games/connections/score', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          puzzleDate: submitDateKey,
          mistakes: finalMistakes,
          timeSeconds: Math.round(timeMs / 100) / 10,
          solved,
        }),
      });
      const data = (await res.json().catch(() => null)) as
        | {
            error?: string;
            reward?: {
              awardedCredits?: number;
              capRemaining?: number;
              earnedTodayTotal?: number;
              balanceAfter?: number;
            };
          }
        | null;
      if (res.ok) {
        submitted = true;
        setHasSubmittedScore(true);
        captureRunResult(data);
        const reward = data?.reward as {
          awardedCredits?: number;
          capRemaining?: number;
          earnedTodayTotal?: number;
          balanceAfter?: number;
        } | undefined;

        if (reward) {
          const awarded = Number(reward.awardedCredits ?? 0);
          const balanceAfter = Number(reward.balanceAfter);

          setWalletBalances((prev) => ({
            ...prev,
            credits: Number.isFinite(balanceAfter)
              ? Math.max(0, Math.floor(balanceAfter))
              : Math.max(0, prev.credits + (Number.isFinite(awarded) ? Math.max(0, awarded) : 0)),
          }));

          if (
            Number.isFinite(Number(reward.earnedTodayTotal)) &&
            Number.isFinite(Number(reward.capRemaining))
          ) {
            setDailyCreditsProgress({
              earned: Math.max(0, Number(reward.earnedTodayTotal)),
              cap: Math.max(0, Number(reward.earnedTodayTotal)) + Math.max(0, Number(reward.capRemaining)),
            });
          }
        }

        setLeaderboardRefreshKey((k) => k + 1);
        setSubmitError(null);
        restoredPendingSubmitRef.current = null;
      } else {
        setSubmitError(getSubmitErrorMessage(data));
      }
    } catch {
      setSubmitError('Network error while submitting score. Please try again.');
    } finally {
      setIsSubmittingScore(false);
    }

    saveSavedState({
      dateKey,
      foundGroups: foundGroupIndices,
      mistakes: finalMistakes,
      elapsedMs: timeMs,
      gameOver: true,
      won: solved,
      submitted,
    });
  }, [captureRunResult, hasSubmittedScore, dateKey, foundGroupIndices]);

  useEffect(() => {
    if (hasSubmittedScore || !gameOver || autoRetryAttemptedRef.current) return;
    const pending = restoredPendingSubmitRef.current;
    if (!pending) return;

    autoRetryAttemptedRef.current = true;
    void submitScore(pending.solved, pending.mistakes, pending.elapsedMs);
  }, [gameOver, hasSubmittedScore, submitScore]);

  // ─── Game actions ─────────────────────────────────────────────────────
  const toggleWord = useCallback((word: string) => {
    if (gameOver || revealingGroup) return;

    if (!timerRunning && foundGroups.length === 0 && mistakes === 0) {
      startTimeRef.current = Date.now();
      elapsedAtStartRef.current = 0;
      setTimerRunning(true);
    }

    // Compute the transition from current state BEFORE the updater so the SFX
    // fires exactly once (a setState updater can run twice under StrictMode /
    // concurrent rendering).
    const willSelect = !selected.has(word) && selected.size < MAX_SELECTED;
    if (willSelect) {
      // soft key-press tick on selecting a tile
      SoundManager.play('arcadeBet', { volume: 0.28 });
    }

    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(word)) {
        next.delete(word);
      } else if (next.size < MAX_SELECTED) {
        next.add(word);
      }
      return next;
    });
  }, [gameOver, revealingGroup, timerRunning, foundGroups.length, mistakes, selected]);

  const deselectAll = useCallback(() => {
    if (gameOver || revealingGroup) return;
    setSelected(new Set());
  }, [gameOver, revealingGroup]);

  const shuffleRemaining = useCallback(() => {
    if (gameOver || revealingGroup) return;
    setShuffledWords((prev) => {
      const shuffled = [...prev];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
      }
      return shuffled;
    });
  }, [gameOver, revealingGroup]);

  // Show a transient toast above the grid (NYT-style "One away!" etc.)
  const showToast = useCallback((message: string) => {
    setToast({ message, nonce: Date.now() });
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => {
      setToast(null);
      toastTimerRef.current = null;
    }, TOAST_DURATION);
  }, []);

  // Cleanup any pending toast timer on unmount
  useEffect(() => {
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, []);

  const handleSubmit = useCallback(() => {
    if (!puzzle || selected.size !== MAX_SELECTED || gameOver || revealingGroup) return;
    // Don't accept new submits while the pop cascade is still playing
    if (jumpingWords.length > 0) return;

    const selectedArr = Array.from(selected);

    // Already guessed this exact set? Surface a toast and bail without
    // consuming a mistake or playing any animation, matching NYT.
    const key = selectionKey(selectedArr);
    if (previousGuesses.has(key)) {
      showToast('Already guessed!');
      return;
    }

    // Order the cascade by visual position (left → right, top → bottom)
    // so the pop reads as a wave across the grid rather than selection order.
    const cascadeOrder = shuffledWords.filter((w) => selected.has(w));
    setJumpingWords(cascadeOrder);

    setTimeout(() => {
      setJumpingWords([]);

      // Did this selection match a single group exactly?
      let matchedGroupIndex = -1;
      let bestOverlap = 0;
      for (let i = 0; i < puzzle.groups.length; i++) {
        if (foundGroupIndices.includes(i)) continue;
        const groupWords = new Set(puzzle.groups[i]!.words);
        const overlap = selectedArr.filter((w) => groupWords.has(w)).length;
        if (overlap > bestOverlap) bestOverlap = overlap;
        if (overlap === groupWords.size && selectedArr.length === groupWords.size) {
          matchedGroupIndex = i;
          break;
        }
      }

      if (matchedGroupIndex >= 0) {
        const group = puzzle.groups[matchedGroupIndex]!;
        setRevealingGroup(group);
        setSelected(new Set());
        SoundManager.play('coinCorrect', { volume: 0.5 });

        setTimeout(() => {
          const newFoundGroups = [...foundGroups, group];
          const newFoundIndices = [...foundGroupIndices, matchedGroupIndex];
          const remainingWords = shuffledWords.filter((w) => !group.words.includes(w));

          setFoundGroups(newFoundGroups);
          setFoundGroupIndices(newFoundIndices);
          setShuffledWords(remainingWords);
          setRevealingGroup(null);

          if (newFoundGroups.length === 4) {
            const finalElapsed = elapsedAtStartRef.current + (Date.now() - startTimeRef.current);
            setElapsedMs(finalElapsed);
            setTimerRunning(false);
            setWon(true);
            setGameOver(true);
            setShowConfetti(true);
            SoundManager.play('arcadeBigWin', { volume: 0.6 });
            setTimeout(() => setShowConfetti(false), CONFETTI_DURATION);
            submitScore(true, mistakes, finalElapsed);
          }
        }, REVEAL_DURATION);
      } else {
        // Wrong guess. Record it so the player can't accidentally retry the
        // same combo, then run the shake + (optionally) the "One away!" toast.
        setPreviousGuesses((prev) => {
          const next = new Set(prev);
          next.add(key);
          return next;
        });
        setShakingWords(new Set(selectedArr));
        const newMistakes = mistakes + 1;
        setMistakes(newMistakes);
        SoundManager.play('arcadeLose', { volume: 0.5 });

        if (bestOverlap === MAX_SELECTED - 1) {
          showToast('One away!');
        }

        setTimeout(() => {
          setShakingWords(new Set());
          setSelected(new Set());

          if (newMistakes >= MAX_LIVES) {
            const finalElapsed = elapsedAtStartRef.current + (Date.now() - startTimeRef.current);
            setElapsedMs(finalElapsed);
            setTimerRunning(false);
            setGameOver(true);
            SoundManager.play('lose', { volume: 0.6 });
            submitScore(false, newMistakes, finalElapsed);
          }
        }, SHAKE_DURATION);
      }
    }, POP_TOTAL_MS);
  }, [
    puzzle, selected, gameOver, revealingGroup, jumpingWords.length,
    previousGuesses, foundGroups, foundGroupIndices, shuffledWords, mistakes,
    submitScore, showToast,
  ]);

  // ─── Share ────────────────────────────────────────────────────────────
  const handleShare = useCallback(() => {
    const text = won
      ? `I solved today's Connections in ${mistakes} mistake${mistakes !== 1 ? 's' : ''}! 🧠 #Connections`
      : `I attempted today's Connections (${foundGroups.length}/4 groups found) 🧠 #Connections`;
    navigator.clipboard.writeText(text).then(() => {
      setShareMessage('Copied to clipboard!');
      setTimeout(() => setShareMessage(''), 2000);
    }).catch(() => {
      setShareMessage(text);
    });
  }, [won, mistakes, foundGroups.length]);

  // ─── Keyboard support ─────────────────────────────────────────────────
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && selected.size === MAX_SELECTED && !gameOver) {
        e.preventDefault();
        handleSubmit();
      }
      if (e.key === 'Escape') {
        deselectAll();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selected, gameOver, handleSubmit, deselectAll]);

  // ─── Format time ──────────────────────────────────────────────────────
  const formatTime = (ms: number) => {
    const totalSec = Math.floor(ms / 1000);
    const min = Math.floor(totalSec / 60);
    const sec = totalSec % 60;
    return `${min}:${sec.toString().padStart(2, '0')}`;
  };

  const walletCard = {
    credits: walletBalances.credits,
    progress: {
      label: 'Daily Tickets',
      current: dailyCreditsProgress.earned,
      max: dailyCreditsProgress.cap,
    },
  };

  // ─── Loading state ────────────────────────────────────────────────────
  if (puzzleLoading) {
    return (
      <section className='mx-auto w-full max-w-4xl space-y-4 px-3 pt-3 pb-[calc(8rem+env(safe-area-inset-bottom))] sm:space-y-8 sm:px-4 sm:pt-6 sm:pb-12'>
        <div className='hidden sm:block'>
          <PageHeader eyebrow='tixy' icon='grid2x2' title='Connections' subtitle='Loading today&apos;s puzzle...' wallet={walletCard} />
        </div>
        <div className='sm:hidden'><GamesWalletCard wallet={walletCard} compact /></div>
        <GamesRouteSwitcher />
        <div className='flex items-center justify-center py-20'>
          <ArcadeLoading label='Loading today&apos;s puzzle.' />
        </div>
      </section>
    );
  }

  // ─── Weekend / no puzzle view ─────────────────────────────────────────
  if (!puzzle || puzzleError) {
    return (
      <section className='mx-auto w-full max-w-4xl space-y-4 px-3 pt-3 pb-[calc(8rem+env(safe-area-inset-bottom))] sm:space-y-8 sm:px-4 sm:pt-6 sm:pb-12'>
        <div className='hidden sm:block'>
          <PageHeader eyebrow='tixy' icon='grid2x2' title='Connections' wallet={walletCard} />
        </div>
        <div className='sm:hidden'><GamesWalletCard wallet={walletCard} compact /></div>
        <GamesRouteSwitcher />
        <div className='arcade-card px-4 py-12 text-center'>
          <Grid2x2 size={48} className='mx-auto text-faint/40 mb-4' />
          <h2 className='text-xl font-bold text-strong'>Connections</h2>
          <p className='mt-2 text-sm text-faint'>
            {noPuzzleMessage
              ?? (puzzleError === 'weekend' || !isWeekday
                ? 'Puzzles are available on workdays. Enjoy your weekend!'
                : 'No puzzle available for today. Check back next workday!')}
          </p>
        </div>
      </section>
    );
  }

  // ─── Revealed groups on game over ─────────────────────────────────────
  const allGroups = puzzle.groups;
  const unfoundGroups = gameOver && !won
    ? allGroups.filter((_, i) => !foundGroupIndices.includes(i))
    : [];

  return (
    <section
      className='mx-auto w-full max-w-4xl space-y-4 px-3 pt-3 pb-[calc(8rem+env(safe-area-inset-bottom))] sm:space-y-8 sm:px-4 sm:pt-6 sm:pb-12'
      style={connectionsThemeToCssVars(theme)}
    >
      {showConfetti && <ConfettiBurst />}

      <div className='hidden sm:block'>
        <PageHeader
          eyebrow='tixy'
          icon='grid2x2'
          title='Connections'
          subtitle={`Today\u2019s Puzzle \u2014 ${formatDateDisplay()}`}
          wallet={walletCard}
        />
      </div>
      <div className='sm:hidden'>
        <GamesWalletCard wallet={walletCard} compact />
      </div>
      <GamesRouteSwitcher />

      <div className='flex justify-end gap-2'>
        <GameLeaderboardButton
          onClick={() => setShowLeaderboard(true)}
          className='bg-background font-semibold hover:bg-raised max-sm:px-3 max-sm:py-1.5 max-sm:text-xs'
        />
        <GameInventoryButton
          onClick={() => setShowInventory(true)}
          className='bg-background font-semibold hover:bg-raised max-sm:px-3 max-sm:py-1.5 max-sm:text-xs'
        />
        <MuteButton />
      </div>

      {/* Main Game Area */}
      <div className='arcade-game-surface px-4 py-5 sm:px-8 sm:py-10'>
        <div className='text-center space-y-2'>
          <ArcadeChip tone='primary' className='inline-flex items-center gap-2 px-4 py-2'>
            <Grid2x2 size={20} className='text-info-text' />
            <span className='text-lg font-bold'>Connections</span>
          </ArcadeChip>
          <p className='text-sm text-faint sm:hidden'>
            {formatDateDisplay()}
          </p>
        </div>

        {/* Pregame screen — prevents pre-solving */}
        {!gameStarted && !gameOver && (
          <div className='mt-6 flex flex-col items-center gap-5 py-8'>
            <div className='text-center space-y-2'>
              <p className='text-base font-semibold text-strong'>
                Ready to play?
              </p>
              <p className='text-sm text-faint max-w-xs mx-auto'>
                Group 16 words into 4 categories of 4. You have {MAX_LIVES} mistakes before it&apos;s game over.
              </p>
            </div>
            <ArcadeButton
              tone='primary'
              size='lg'
              onClick={() => {
                // Start the timer immediately so the recorded play time
                // matches the actual time on the puzzle, not just the time
                // since the first tile click.
                startTimeRef.current = Date.now();
                elapsedAtStartRef.current = 0;
                setTimerRunning(true);
                setGameStarted(true);
              }}
            >
              <Grid2x2 size={20} />
              Start Puzzle
            </ArcadeButton>
            <div className='flex items-center gap-3 text-xs text-faint'>
              <span>{MAX_LIVES} lives</span>
              <span className='text-border'>|</span>
              <span>4 groups of 4</span>
              <span className='text-border'>|</span>
              <span>Timed</span>
            </div>
          </div>
        )}

        {/* Lives, grid, and game controls — hidden until player starts */}
        {(gameStarted || gameOver) && (<>
        <div className='cn-hud mt-4'>
          <div className='cn-lives' aria-label={`${MAX_LIVES - mistakes} lives remaining`}>
            <span className='cn-hud-label'>Lives</span>
            <div className='cn-lives-dots'>
              {Array.from({ length: MAX_LIVES }).map((_, i) => (
                <Heart
                  key={i}
                  size={18}
                  className='cn-heart'
                  data-spent={i >= MAX_LIVES - mistakes ? 'true' : undefined}
                />
              ))}
            </div>
            <span className='cn-hud-mono'>{mistakes}/{MAX_LIVES}</span>
          </div>
          <div className='cn-timer'>
            <span className='cn-hud-label'>Time</span>
            <span className='cn-hud-mono cn-timer-val'>{formatTime(elapsedMs)}</span>
          </div>
        </div>

        {/* Found groups — enamel plates */}
        <div className='space-y-2 mt-4'>
          {foundGroups.map((group, i) => (
            <div
              key={i}
              className='cn-band connections-group-strip'
              data-tone={toneForGroup(group)}
            >
              <p className='cn-band-title'>{group.category}</p>
              <p className='cn-band-words'>{group.words.join(', ')}</p>
            </div>
          ))}

          {revealingGroup && (
            <div
              className='cn-band connections-group-strip'
              data-tone={toneForGroup(revealingGroup)}
            >
              <p className='cn-band-title'>{revealingGroup.category}</p>
              <p className='cn-band-words'>{revealingGroup.words.join(', ')}</p>
            </div>
          )}
        </div>

        {/* Word grid */}
        {!gameOver && (
          <div className='relative mt-4'>
            {/* Floating toast (NYT-style "One away!", "Already guessed!") */}
            {toast && (
              <div
                key={toast.nonce}
                className='pointer-events-none absolute -top-2 left-1/2 z-10 -translate-x-1/2 -translate-y-full'
                role='status'
                aria-live='polite'
              >
                <div className='cn-toast connections-toast'>
                  {toast.message}
                </div>
              </div>
            )}
            <div
              className='cn-bezel'
              role='group'
              aria-label='Word selection grid'
            >
              {shuffledWords.map((word) => {
                const isSelected = selected.has(word);
                const isShaking = shakingWords.has(word);
                const jumpIndex = jumpingWords.indexOf(word);
                const isJumping = jumpIndex >= 0;
                return (
                  <button
                    key={word}
                    type='button'
                    onClick={() => toggleWord(word)}
                    disabled={!!revealingGroup || jumpingWords.length > 0}
                    aria-pressed={isSelected}
                    data-selected={isSelected ? 'true' : undefined}
                    data-locked={revealingGroup ? 'true' : undefined}
                    style={isJumping ? { animationDelay: `${jumpIndex * POP_STAGGER_MS}ms` } : undefined}
                    className={`cn-tile${isShaking ? ' connections-shake' : ''}${isJumping ? ' connections-pop' : ''}`}
                  >
                    <span className='cn-tile-word'>{word}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Unfound groups (game over, lost) — dimmed enamel plates */}
        {unfoundGroups.length > 0 && (
          <div className='space-y-2 mt-4'>
            {unfoundGroups.map((group, i) => (
              <div
                key={i}
                className='cn-band cn-band-missed'
                data-tone={toneForGroup(group)}
              >
                <p className='cn-band-title'>{group.category}</p>
                <p className='cn-band-words'>{group.words.join(', ')}</p>
              </div>
            ))}
          </div>
        )}

        {/* Action buttons */}
        {!gameOver && (
          <div className='flex items-center justify-center gap-3 pt-4'>
            <ArcadeButton
              tone='ghost'
              size='sm'
              onClick={shuffleRemaining}
              disabled={!!revealingGroup}
            >
              <RotateCcw size={14} />
              Shuffle
            </ArcadeButton>
            <ArcadeButton
              tone='ghost'
              size='sm'
              onClick={deselectAll}
              disabled={selected.size === 0 || !!revealingGroup}
            >
              Deselect All
            </ArcadeButton>
            <ArcadeButton
              tone='primary'
              size='sm'
              onClick={handleSubmit}
              disabled={selected.size !== MAX_SELECTED || !!revealingGroup}
            >
              <Check size={14} />
              Submit
            </ArcadeButton>
          </div>
        )}

        {/* Game over results */}
        {gameOver && (
          <div className='arcade-card-inset p-5 text-center space-y-4 mt-6 sm:p-6'>
            <div>
              <h2 className='cn-result-title text-xl font-bold text-strong'>
                {won ? 'Congratulations!' : 'Game Over'}
              </h2>
              <p className='text-sm text-faint mt-1'>
                {won
                  ? `Solved in ${formatTime(elapsedMs)} with ${mistakes} mistake${mistakes !== 1 ? 's' : ''}!`
                  : `${foundGroups.length}/4 groups found with ${mistakes} mistake${mistakes !== 1 ? 's' : ''}.`}
              </p>
            </div>

            <ArcadeRunRewards
              reward={runReward}
              achievements={runAchievements}
              className='mx-auto max-w-sm'
            />

            {submitError && (
              <ArcadeNotice tone='danger'>{submitError}</ArcadeNotice>
            )}

            <div className='text-xs text-faint'>
              Daily Tickets: {dailyCreditsProgress.earned}/{dailyCreditsProgress.cap}
            </div>

            <div className='flex items-center justify-center gap-3 flex-wrap'>
              <ArcadeButton
                tone='ghost'
                size='sm'
                onClick={handleShare}
              >
                <Share2 size={14} />
                Share
              </ArcadeButton>
              <ArcadeButton
                tone='ghost'
                size='sm'
                onClick={() => setShowLeaderboard(true)}
              >
                <Trophy size={14} />
                Leaderboard
              </ArcadeButton>
              {!hasSubmittedScore && (
                <ArcadeButton
                  tone='ghost'
                  size='sm'
                  onClick={() => void submitScore(won, mistakes, elapsedMs)}
                  disabled={isSubmittingScore}
                >
                  {isSubmittingScore ? 'Submitting...' : 'Retry Score Submit'}
                </ArcadeButton>
              )}
            </div>

            {shareMessage && (
              <p className='cn-share-msg text-xs font-medium animate-in fade-in duration-300'>
                {shareMessage}
              </p>
            )}
          </div>
        )}
        </>)}
      </div>

      <GameLeaderboardModal
        open={showLeaderboard}
        onOpenChange={setShowLeaderboard}
        title='Connections Leaderboard'
        description={leaderboardMode === 'daily' ? "Today's solvers" : 'All-time standings'}
      >
        <GameLeaderboard
          gameType='connections'
          mode={leaderboardMode}
          modes={DAILY_BOARD_MODES}
          onModeChange={(next) => setLeaderboardMode(next as 'daily' | 'alltime')}
          refreshKey={leaderboardRefreshKey}
        />
      </GameLeaderboardModal>

      <GameInventoryModal
        open={showInventory}
        onOpenChange={setShowInventory}
        title='Connections Inventory'
        description='No equip slots are active for this game yet.'
      />

    </section>
  );
}
