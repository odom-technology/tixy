'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Delete } from 'lucide-react';
import { ArcadeButton } from '@/features/arcade/components/ui/arcade-ui';
import { DAILY_BOARD_MODES, GameLeaderboard } from '@/features/arcade/components/game-leaderboard';
import {
  GameShell,
  GameStage,
  GameStat,
  type GameHint,
  type GameHowTo,
  type GamePhase,
} from '@/features/arcade/components/shell/game-shell';
import { GameLeaderboardModal } from '@/features/arcade/components/game-leaderboard-modal';
import { GameLeaderboardButton } from '@/features/arcade/components/game-leaderboard-button';
import { GameInventoryModal } from '@/features/arcade/components/game-inventory-modal';
import { GameInventoryButton } from '@/features/arcade/components/game-inventory-button';
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
import { isDialogOpen } from '@/features/arcade/lib/use-first-input';
import { getGameDisplayName } from '@/features/arcade/lib/game-renames';
import {
  type WordGridCosmeticTheme,
  DEFAULT_WORD_GRID_THEME,
  buildWordGridTheme,
  wordGridSkinAttrs,
  wordGridThemeToCssVars,
} from './_word-grid-theme';
import { FriendResults, useFriendResults } from './_word-grid-friends';
import './_word-grid-midway.css';

// ─── Constants ────────────────────────────────────────────────────────────────
const WORD_LENGTH = 5;
const MAX_GUESSES = 6;
const FLIP_PER_TILE_MS = 520;
const FLIP_STAGGER_MS = 280;
const SHAKE_DURATION = 500;
const TOAST_DURATION = 1600;
// The win hop: 620 ms a tile, 95 ms apart (the wg-win keyframes).
const WIN_HOP_MS = 620 + 95 * (WORD_LENGTH - 1);
// How long a loss waits before the result covers the board.
const LOSS_BEAT_MS = 500;
// Friends listed under the board once the puzzle is done.
const FRIENDS_ON_BOARD = 3;

// The board is drawn in container units, so these mirror _word-grid-midway.css
// (.wg-board inset, .wg-board and .wg-row gap). The screen takes the aspect
// that makes every tile square.
const BOARD_PAD = 3;
const BOARD_GAP = 2.4;
const TILE_SIZE = (100 - 2 * BOARD_PAD - (WORD_LENGTH - 1) * BOARD_GAP) / WORD_LENGTH;
const BOARD_ASPECT =
  100 / (MAX_GUESSES * TILE_SIZE + (MAX_GUESSES - 1) * BOARD_GAP + 2 * BOARD_PAD);

type TileResult = 'correct' | 'present' | 'absent';
type KeyState = 'correct' | 'present' | 'absent' | 'unused';

// What a screen reader hears for each tile.
const TILE_LABEL: Record<TileResult, string> = {
  correct: 'right spot',
  present: 'wrong spot',
  absent: 'not in the word',
};

// The shell's hint and ? sheet (docs/design/tixy-rebrand/SHELL.md).
const FIRST_HINT: GameHint = {
  touch: 'Tap letters to guess.',
  pointer: 'Type a word to guess.',
};

// The ? sheet's picture, in the tixy palette: three guesses, graded.
function HowToPicture() {
  const rows: Array<Array<[string, TileResult | 'empty']>> = [
    [['B', 'absent'], ['O', 'present'], ['O', 'absent'], ['T', 'absent'], ['H', 'absent']],
    [['S', 'correct'], ['T', 'present'], ['A', 'absent'], ['M', 'absent'], ['P', 'absent']],
    [['S', 'correct'], ['T', 'correct'], ['U', 'correct'], ['B', 'correct'], ['S', 'correct']],
  ];
  const size = 22;
  const gap = 4;
  const x0 = (160 - (5 * size + 4 * gap)) / 2;
  const y0 = (100 - (3 * size + 2 * gap)) / 2;
  return (
    <svg
      viewBox='0 0 160 100'
      width={320}
      height={200}
      role='img'
      aria-label='Three guesses. Green tiles with a dot are in the right spot, and yellow tiles with a ring are in the word.'
    >
      <rect width='160' height='100' fill='#2A231D' />
      {rows.map((row, r) =>
        row.map(([letter, state], c) => {
          const x = x0 + c * (size + gap);
          const y = y0 + r * (size + gap);
          const fill = state === 'correct' ? '#538D4E' : state === 'present' ? '#B59F3B' : '#3A3A3C';
          const ink = '#FFFFFF';
          return (
            <g key={`${r}-${c}`}>
              <rect x={x} y={y} width={size} height={size} rx='3.5' fill={fill} />
              <text
                x={x + size / 2}
                y={y + size / 2 + 5.5}
                textAnchor='middle'
                fontSize='15'
                fontWeight='800'
                fontFamily='Gabarito, system-ui, sans-serif'
                fill={ink}
              >
                {letter}
              </text>
              {state === 'correct' ? <circle cx={x + size - 4.5} cy={y + 4.5} r='2.2' fill='#FFFFFF' /> : null}
              {state === 'present' ? (
                <circle cx={x + size - 4.5} cy={y + 4.5} r='1.7' fill='none' stroke='#FFFFFF' strokeWidth='1.1' />
              ) : null}
            </g>
          );
        }),
      )}
    </svg>
  );
}

const HOW_TO: GameHowTo = {
  lines: [
    'Type a five-letter word and press enter.',
    'Green is the right spot, yellow is in the word elsewhere.',
    'You get six guesses, and a solve pays 72 tickets less 10 per extra guess.',
  ],
  picture: <HowToPicture />,
};

// ─── Date helpers (UTC — must match the server) ───────────────────────────────
const pad2 = (n: number) => n.toString().padStart(2, '0');

const getDateKey = (d: Date = new Date()) =>
  `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;

const EPOCH_UTC_MS = Date.UTC(2025, 0, 1);
const DAY_MS = 86_400_000;

const dayNumberFor = (dateKey: string): number => {
  const [y, m, d] = dateKey.split('-').map(Number);
  if (!y || !m || !d) return 0;
  return Math.floor((Date.UTC(y, m - 1, d) - EPOCH_UTC_MS) / DAY_MS) + 1;
};

// ─── Keyboard layout ──────────────────────────────────────────────────────────
const KEY_ROWS = [
  ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'],
  ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l'],
  ['enter', 'z', 'x', 'c', 'v', 'b', 'n', 'm', 'back'],
] as const;

// ─── Color recomputation (mirror of the server's two-pass algorithm) ──────────
// We never store colors. They are recomputed from the stored per-guess server
// results (kept alongside guesses) on load, so the answer logic lives only on
// the server. `results` is the authoritative per-letter grading returned by the
// /validate endpoint for each submitted guess.

const keyStatePriority: Record<KeyState, number> = {
  unused: 0,
  absent: 1,
  present: 2,
  correct: 3,
};

const buildKeyStates = (
  guesses: string[],
  results: TileResult[][],
  revealingRow: number | null,
  revealedTiles: number,
): Record<string, KeyState> => {
  const map: Record<string, KeyState> = {};
  for (let r = 0; r < guesses.length; r++) {
    const guess = guesses[r]!;
    const res = results[r];
    if (!res) continue;
    for (let i = 0; i < guess.length; i++) {
      if (r === revealingRow && i >= revealedTiles) continue;
      const ch = guess[i]!;
      const next = res[i]!;
      const cur = map[ch] ?? 'unused';
      if (keyStatePriority[next] > keyStatePriority[cur]) map[ch] = next;
    }
  }
  return map;
};

// ─── LocalStorage ─────────────────────────────────────────────────────────────
type SavedState = {
  dateKey: string;
  guesses: string[];
  results: TileResult[][];
  gameOver: boolean;
  won: boolean;
  submitted: boolean;
  elapsedMs: number;
};

const LS_KEY_PREFIX = 'word_grid_';

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
    // ignore quota errors
  }
};

// Emoji squares for the share grid, matching the tiles: green, yellow, black.
const EMOJI: Record<TileResult, string> = {
  correct: '🟩',
  present: '🟨',
  absent: '⬛',
};

// "Next puzzle in 5 h 40 min." The puzzle changes at UTC midnight.
const nextPuzzleLine = (nowMs: number) => {
  const left = Math.max(0, DAY_MS - (nowMs % DAY_MS));
  const minutes = Math.ceil(left / 60_000);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `Next puzzle in ${h} h ${m} min.` : `Next puzzle in ${m} min.`;
};

const isTypingTarget = (target: EventTarget | null) =>
  target instanceof Element &&
  target.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]') !== null;

// ─── Main component ───────────────────────────────────────────────────────────
export default function WordGridPage() {
  const [dateKey] = useState(() => getDateKey());
  const [dayNumber] = useState(() => dayNumberFor(getDateKey()));

  // Detect UTC date rollover (midnight) and reload to the new day's puzzle.
  // The same tick keeps "next puzzle in" current.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const check = setInterval(() => {
      if (getDateKey() !== dateKey) window.location.reload();
      setNow(Date.now());
    }, 60_000);
    return () => clearInterval(check);
  }, [dateKey]);

  // ─── State ────────────────────────────────────────────────────────────────
  const [guesses, setGuesses] = useState<string[]>([]);
  const [results, setResults] = useState<TileResult[][]>([]);
  const [current, setCurrent] = useState('');
  const [gameOver, setGameOver] = useState(false);
  const [won, setWon] = useState(false);
  const [answer, setAnswer] = useState<string | null>(null); // revealed only after game over
  const [hasSubmittedScore, setHasSubmittedScore] = useState(false);
  const [revealingRow, setRevealingRow] = useState<number | null>(null);
  const [revealedTiles, setRevealedTiles] = useState(0);
  const [shakeRow, setShakeRow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  const [toast, setToast] = useState<{ message: string; nonce: number } | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shakeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [announcement, setAnnouncement] = useState('');

  // The result covers the board once the last row has landed; "board" hides
  // it to look at the grid, and "result" brings it back.
  const [resultReady, setResultReady] = useState(false);
  const [resultOpen, setResultOpen] = useState(true);
  const freshFinishRef = useRef(false);

  const [shareFallback, setShareFallback] = useState('');
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const [showInventory, setShowInventory] = useState(false);
  const [leaderboardRefreshKey, setLeaderboardRefreshKey] = useState(0);
  const [leaderboardMode, setLeaderboardMode] = useState<'daily' | 'alltime'>('daily');

  const [walletBalances, setWalletBalances] = useState({ credits: 0 });
  // The daily cap still comes back with each save; the shell doesn't show it.
  const [, setDailyCreditsProgress] = useState({ earned: 0, cap: 300 });
  const [theme, setTheme] = useState<WordGridCosmeticTheme>(
    DEFAULT_WORD_GRID_THEME,
  );
  const {
    reward: runReward,
    achievements: runAchievements,
    capture: captureRunResult,
    reset: resetRunResult,
  } = useArcadeRunResult();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmittingScore, setIsSubmittingScore] = useState(false);
  const [guestRun, setGuestRun] = useState(false);

  const startTimeRef = useRef<number>(Date.now());
  const elapsedAtStartRef = useRef<number>(0);
  const revealTimersRef = useRef<Array<ReturnType<typeof setTimeout>>>([]);

  // Reduced motion follows the OS, through the feel kit.
  const reducedMotion = useFeelReducedMotion();
  const reducedMotionRef = useRef(reducedMotion);
  reducedMotionRef.current = reducedMotion;
  // Sound and haptics: press first on every input, a tick and a rising note
  // for each right-spot tile, a win haptic on a solve.
  const { trigger } = useGameFeedback();
  const ladder = usePitchLadder();

  const keyStates = buildKeyStates(
    guesses,
    results,
    revealingRow,
    revealedTiles,
  );

  const clearRevealTimers = useCallback(() => {
    for (const timer of revealTimersRef.current) clearTimeout(timer);
    revealTimersRef.current = [];
  }, []);

  useEffect(() => clearRevealTimers, [clearRevealTimers]);

  // ─── Hydrate from localStorage ──────────────────────────────────────────────
  useEffect(() => {
    resetRunResult();
    const saved = loadSavedState(dateKey);
    if (saved && saved.dateKey === dateKey) {
      setGuesses(saved.guesses ?? []);
      setResults(saved.results ?? []);
      setGameOver(saved.gameOver);
      setWon(saved.won);
      setHasSubmittedScore(saved.submitted);
      elapsedAtStartRef.current = saved.elapsedMs ?? 0;
      startTimeRef.current = Date.now();
    }
    setHydrated(true);
  }, [dateKey, resetRunResult]);

  // ─── Load wallet ────────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    const loadWallet = async () => {
      try {
        const res = await fetch('/api/store/inventory?gameType=word-grid', {
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
        setWalletBalances({ credits: payload.wallet?.credits ?? 0 });
        setDailyCreditsProgress({
          earned: payload.dailyGameCredits?.earned ?? 0,
          cap: payload.dailyGameCredits?.cap ?? 300,
        });
        setTheme(buildWordGridTheme(payload));
      } catch {
        /* silently fail */
      }
    };
    void loadWallet();
    return () => { cancelled = true; };
  }, []);

  // ─── Persist on change ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!hydrated) return;
    saveSavedState({
      dateKey,
      guesses,
      results,
      gameOver,
      won,
      submitted: hasSubmittedScore,
      elapsedMs: elapsedAtStartRef.current,
    });
  }, [hydrated, dateKey, guesses, results, gameOver, won, hasSubmittedScore]);

  // ─── Toast helper ───────────────────────────────────────────────────────────
  const showToast = useCallback((message: string) => {
    setToast({ message, nonce: Date.now() });
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => {
      setToast(null);
      toastTimerRef.current = null;
    }, TOAST_DURATION);
  }, []);

  useEffect(() => () => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    if (shakeTimerRef.current) clearTimeout(shakeTimerRef.current);
  }, []);

  // The row shakes when a word is short or not in the list.
  const shakeCurrentRow = useCallback(() => {
    setShakeRow(true);
    if (shakeTimerRef.current) clearTimeout(shakeTimerRef.current);
    shakeTimerRef.current = setTimeout(() => {
      setShakeRow(false);
      shakeTimerRef.current = null;
    }, SHAKE_DURATION);
  }, []);

  // ─── Submit final score ─────────────────────────────────────────────────────
  const submitScore = useCallback(
    async (finalGuesses: string[]) => {
      // Use the date at submission time, not the stale render-time key.
      const submitDateKey = getDateKey();
      try {
        setIsSubmittingScore(true);
        setSubmitError(null);
        const elapsedMs = elapsedAtStartRef.current + (Date.now() - startTimeRef.current);
        const res = await fetch('/api/games/word-grid/score', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            puzzleDate: submitDateKey,
            guesses: finalGuesses,
            timeSeconds: Math.round(elapsedMs / 100) / 10,
          }),
        });
        const data = (await res.json().catch(() => null)) as
          | {
              error?: string;
              answer?: string;
              reward?: {
                awardedCredits?: number;
                capRemaining?: number;
                earnedTodayTotal?: number;
                balanceAfter?: number;
              };
            }
          | null;

        if (res.ok) {
          setGuestRun(false);
          setHasSubmittedScore(true);
          captureRunResult(data);
          if (typeof data?.answer === 'string') setAnswer(data.answer.toUpperCase());

          const reward = data?.reward;
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
        } else if (res.status === 401) {
          // Signed out: the puzzle plays, and the result says what signing in saves.
          setGuestRun(true);
          setSubmitError(null);
        } else {
          if (typeof data?.answer === 'string') setAnswer(data.answer.toUpperCase());
          setSubmitError(
            typeof data?.error === 'string' && data.error.trim()
              ? data.error
              : 'Could not save your score. Try again.',
          );
        }
      } catch {
        setSubmitError('Could not save your score. Try again.');
      } finally {
        setIsSubmittingScore(false);
      }
    },
    [captureRunResult],
  );

  // ─── Finish the game (win or loss) ──────────────────────────────────────────
  const finishGame = useCallback(
    (didWin: boolean, finalGuesses: string[]) => {
      freshFinishRef.current = true;
      setGameOver(true);
      setWon(didWin);
      trigger(didWin ? 'round-win' : 'loss', { motion: false, haptic: true });
      void submitScore(finalGuesses);
    },
    [submitScore, trigger],
  );

  // The result covers the board after the win hop or a short beat; a run
  // loaded already finished shows it at once.
  useEffect(() => {
    if (!gameOver) {
      setResultReady(false);
      setResultOpen(true);
      return;
    }
    const wait =
      freshFinishRef.current && !reducedMotionRef.current ? (won ? WIN_HOP_MS + 100 : LOSS_BEAT_MS) : 0;
    freshFinishRef.current = false;
    if (wait === 0) {
      setResultReady(true);
      return;
    }
    const timer = setTimeout(() => setResultReady(true), wait);
    return () => clearTimeout(timer);
  }, [gameOver, won]);

  // ─── Submit the current row ─────────────────────────────────────────────────
  const submitGuess = useCallback(async () => {
    if (gameOver || busy || revealingRow !== null) return;
    if (current.length !== WORD_LENGTH) {
      showToast('Not enough letters.');
      shakeCurrentRow();
      trigger('loss', { sound: false, motion: false, haptic: true });
      return;
    }

    const guess = current.toLowerCase();
    setBusy(true);
    try {
      const res = await fetch('/api/games/word-grid/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dateKey: getDateKey(), guess }),
      });
      const data = (await res.json().catch(() => null)) as
        | { valid?: boolean; result?: TileResult[]; won?: boolean; error?: string }
        | null;

      if (!res.ok || !data) {
        showToast(
          typeof data?.error === 'string' && data.error.trim() ? data.error : 'Could not check that word. Try again.',
        );
        setBusy(false);
        return;
      }

      if (!data.valid || !data.result) {
        showToast('Not in the word list.');
        shakeCurrentRow();
        trigger('loss', { motion: false, haptic: true, volume: 0.5 });
        setBusy(false);
        return;
      }

      const rowIndex = guesses.length;
      const nextGuesses = [...guesses, guess];
      const nextResults = [...results, data.result];
      const grade = data.result;
      setGuesses(nextGuesses);
      setResults(nextResults);
      setCurrent('');

      const didWin = Boolean(data.won);
      const settle = () => {
        setRevealingRow(null);
        setRevealedTiles(0);
        setAnnouncement(
          `Guess ${rowIndex + 1}. ${guess
            .split('')
            .map((ch, i) => `${ch}, ${TILE_LABEL[grade[i]!]}`)
            .join('. ')}.`,
        );
        if (didWin) {
          finishGame(true, nextGuesses);
        } else if (nextGuesses.length >= MAX_GUESSES) {
          finishGame(false, nextGuesses);
        }
      };

      // Flip the row in a stagger, then resolve win or loss. A right-spot
      // tile ticks as it turns, each a step up the pitch ladder. Reduced
      // motion skips the flip; the cues keep their timing.
      clearRevealTimers();
      ladder.reset();
      const instant = reducedMotionRef.current;
      if (!instant) {
        setRevealingRow(rowIndex);
        setRevealedTiles(0);
      }
      for (let i = 0; i < WORD_LENGTH; i++) {
        const midpoint = FLIP_STAGGER_MS * i + FLIP_PER_TILE_MS / 2;
        revealTimersRef.current.push(setTimeout(() => {
          if (!instant) setRevealedTiles(i + 1);
          if (grade[i] === 'correct') {
            trigger('collect', { motion: false, haptic: true, pitch: ladder.next() });
          } else if (grade[i] === 'present') {
            trigger('move', { motion: false });
          }
        }, midpoint));
      }
      if (instant) {
        settle();
      } else {
        const revealTotal = FLIP_PER_TILE_MS + FLIP_STAGGER_MS * (WORD_LENGTH - 1);
        revealTimersRef.current.push(setTimeout(settle, revealTotal));
      }
    } catch {
      showToast('Could not check that word. Try again.');
    } finally {
      setBusy(false);
    }
  }, [
    gameOver,
    busy,
    revealingRow,
    current,
    guesses,
    results,
    showToast,
    shakeCurrentRow,
    finishGame,
    clearRevealTimers,
    ladder,
    trigger,
  ]);

  // ─── Key input ──────────────────────────────────────────────────────────────
  const onKey = useCallback(
    (raw: string) => {
      if (gameOver || busy || revealingRow !== null) return;
      const key = raw.toLowerCase();
      const isLetter = /^[a-z]$/.test(key);
      const isBack = key === 'back' || key === 'backspace';
      if (key !== 'enter' && !isBack && !isLetter) return;
      // Press first: every key answers this frame, before any checks.
      trigger('press', { motion: false, haptic: true });
      if (key === 'enter') {
        void submitGuess();
        return;
      }
      if (isBack) {
        setCurrent((c) => c.slice(0, -1));
        return;
      }
      setCurrent((c) => (c.length < WORD_LENGTH ? c + key : c));
    },
    [gameOver, busy, revealingRow, submitGuess, trigger],
  );

  // Physical keyboard support. A key typed into a field (the lobby chat) or
  // aimed at an open sheet is not the grid's. Space and Enter on a button are
  // kept from this listener by the shell's key guard.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.isComposing) return;
      if (isTypingTarget(e.target) || isDialogOpen()) return;
      if (e.key === 'Enter') {
        e.preventDefault();
        if (!e.repeat) onKey('enter');
        return;
      }
      if (e.key === 'Backspace') {
        onKey('back');
        return;
      }
      if (/^[a-zA-Z]$/.test(e.key) && !e.repeat) onKey(e.key);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onKey]);

  // ─── Share ──────────────────────────────────────────────────────────────────
  // Plain text: the game's name, the day, the score and the grid.
  const handleShare = useCallback(() => {
    const gameName = getGameDisplayName('word-grid', 'Word Grid').toLowerCase();
    const score = won ? `${guesses.length}/${MAX_GUESSES}` : `x/${MAX_GUESSES}`;
    const grid = results
      .map((row) => row.map((r) => EMOJI[r]).join(''))
      .join('\n');
    const text = `${gameName} ${dayNumber} ${score}\n\n${grid}`;
    setShareFallback('');
    navigator.clipboard
      .writeText(text)
      .then(() => showToast('Copied.'))
      .catch(() => setShareFallback(text));
  }, [won, guesses.length, results, dayNumber, showToast]);

  const friends = useFriendResults(gameOver && hasSubmittedScore);

  const cosmeticStyle = useMemo(() => wordGridThemeToCssVars(theme), [theme]);
  const skinAttrs = wordGridSkinAttrs(theme);

  // ─── Render helpers ─────────────────────────────────────────────────────────
  // Build the full 6×5 board model: filled rows from `guesses`, the active row
  // from `current`, the rest empty.
  const renderRows = () => {
    const rows: Array<{
      letters: string[];
      states: Array<TileResult | 'empty' | 'filled'>;
      isRevealing: boolean;
      rowIndex: number;
    }> = [];

    for (let r = 0; r < MAX_GUESSES; r++) {
      const letters: string[] = [];
      const states: Array<TileResult | 'empty' | 'filled'> = [];

      if (r < guesses.length) {
        const guess = guesses[r]!;
        const res = results[r]!;
        for (let i = 0; i < WORD_LENGTH; i++) {
          letters.push(guess[i]!.toUpperCase());
          states.push(res[i]!);
        }
      } else if (r === guesses.length && !gameOver) {
        for (let i = 0; i < WORD_LENGTH; i++) {
          const ch = current[i];
          letters.push(ch ? ch.toUpperCase() : '');
          states.push(ch ? 'filled' : 'empty');
        }
      } else {
        for (let i = 0; i < WORD_LENGTH; i++) {
          letters.push('');
          states.push('empty');
        }
      }

      rows.push({ letters, states, isRevealing: revealingRow === r, rowIndex: r });
    }
    return rows;
  };

  // The shell's phase: always the board until the last row lands, then the
  // result. A puzzle has no first input, so `ready` has no onStart.
  const phase: GamePhase = gameOver && resultReady && resultOpen ? 'over' : 'ready';

  // Only the first guess needs saying; after that the board shows where you are.
  const hint: GameHint | undefined = !gameOver && guesses.length === 0 ? FIRST_HINT : undefined;

  const needsSave = !hasSubmittedScore && !isSubmittingScore;

  const end =
    gameOver && resultReady && resultOpen ? (
      <ArcadeRunResult
        title={won ? 'Solved' : 'Out of guesses'}
        tone={won ? 'win' : 'loss'}
        stats={[
          { label: 'guesses', value: `${won ? guesses.length : 'x'}/${MAX_GUESSES}` },
          { label: 'puzzle', value: dayNumber },
        ]}
        reward={runReward}
        achievements={runAchievements}
        saving={isSubmittingScore}
        error={submitError}
        guest={guestRun}
        actions={
          <>
            {/* One puzzle a day, so there is no rematch: share takes its place. */}
            <ArcadeRematchButton onClick={handleShare}>share</ArcadeRematchButton>
            <ArcadeButton tone='key' onClick={() => setResultOpen(false)}>
              board
            </ArcadeButton>
            <ArcadeButton tone='key' onClick={() => setShowLeaderboard(true)}>
              scores
            </ArcadeButton>
            {needsSave && !guestRun ? (
              <ArcadeButton tone='key' onClick={() => void submitScore(guesses)}>
                {submitError ? 'retry' : 'save'}
              </ArcadeButton>
            ) : null}
          </>
        }
      >
        {!won && answer ? <p>The word was {answer.toLowerCase()}.</p> : null}
        {shareFallback ? <p className='wg-share-copy'>{shareFallback}</p> : null}
      </ArcadeRunResult>
    ) : null;

  const controls = (
    <div className='wg-controls' style={cosmeticStyle} {...skinAttrs}>
      {!gameOver ? (
        <div className='wg-keyboard' role='group' aria-label='Keyboard'>
          {KEY_ROWS.map((rowKeys, r) => (
            <div key={r} className='wg-key-row'>
              {rowKeys.map((k) => {
                const isAction = k === 'enter' || k === 'back';
                const state: KeyState = isAction ? 'unused' : (keyStates[k] ?? 'unused');
                return (
                  <button
                    key={k}
                    type='button'
                    // Keys keep the focus where it was, so the physical keyboard
                    // goes on typing after a tap, and Enter never repeats a key.
                    tabIndex={-1}
                    onPointerDown={(e) => e.preventDefault()}
                    onClick={() => onKey(k)}
                    aria-label={
                      k === 'back'
                        ? 'backspace'
                        : k === 'enter'
                          ? 'enter'
                          : state === 'unused'
                            ? k
                            : `${k}, ${TILE_LABEL[state]}`
                    }
                    className={`wg-key${isAction ? ' wg-key-wide' : ''}${state !== 'unused' ? ` wg-key-${state}` : ''}`}
                    data-key={k}
                  >
                    {k === 'back' ? (
                      <Delete size={20} strokeWidth={2} strokeLinecap='square' aria-hidden />
                    ) : (
                      k
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      ) : (
        <div className='wg-after' data-surface='ink'>
          <FriendResults friends={friends} maxGuesses={MAX_GUESSES} limit={FRIENDS_ON_BOARD} />
          <p className='wg-next'>{nextPuzzleLine(now)}</p>
          {!resultOpen ? (
            <div className='wg-after-buttons'>
              <ArcadeButton tone='key' onClick={() => setResultOpen(true)}>
                result
              </ArcadeButton>
              <ArcadeButton tone='key' onClick={handleShare}>
                share
              </ArcadeButton>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );

  return (
    <GameShell
      game='word-grid'
      className='word-grid-root'
      stat={<GameStat value={dayNumber} label='puzzle' />}
      howTo={HOW_TO}
      tickets={walletBalances.credits}
      below={
        <div className='flex flex-wrap items-center justify-center gap-2'>
          <GameLeaderboardButton onClick={() => setShowLeaderboard(true)} />
          <GameInventoryButton onClick={() => setShowInventory(true)} />
        </div>
      }
    >
      <GameStage
        phase={phase}
        hint={hint}
        busy={busy ? 'Checking your word.' : null}
        aspect={BOARD_ASPECT}
        controls={controls}
        end={end}
      >
        <div className='wg-frame' style={cosmeticStyle} {...skinAttrs}>
          {toast && (
            <div key={toast.nonce} className='wg-toast' role='status' aria-live='polite'>
              {toast.message}
            </div>
          )}
          <div role='status' aria-live='polite' className='sr-only'>
            {announcement}
          </div>

          <div className='wg-board' role='grid' aria-label='Word grid board'>
            {renderRows().map((row) => (
              <div
                key={row.rowIndex}
                role='row'
                className={`wg-row${shakeRow && row.rowIndex === guesses.length && !gameOver ? ' wg-shake' : ''}`}
              >
                {row.letters.map((letter, i) => {
                  const state = row.states[i]!;
                  const graded = state === 'correct' || state === 'present' || state === 'absent';
                  const isWinRow =
                    won && gameOver && graded && row.rowIndex === guesses.length - 1;
                  return (
                    <div
                      key={i}
                      role='gridcell'
                      aria-label={
                        graded
                          ? `${letter.toLowerCase()}, ${TILE_LABEL[state]}`
                          : letter
                            ? letter.toLowerCase()
                            : 'empty'
                      }
                      className={`wg-tile${graded ? ` wg-${state}` : ''}${state === 'filled' ? ' wg-filled' : ''}${row.isRevealing && graded ? ' wg-flip' : ''}${isWinRow ? ' wg-win' : ''}`}
                      style={
                        row.isRevealing && graded
                          ? ({ '--wg-delay': `${i * FLIP_STAGGER_MS}ms` } as React.CSSProperties)
                          : isWinRow
                            ? { animationDelay: `${i * 95}ms` }
                            : undefined
                      }
                      data-state={state}
                    >
                      <span className='wg-tile-face' aria-hidden>
                        {letter}
                      </span>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </GameStage>

      <GameLeaderboardModal
        open={showLeaderboard}
        onOpenChange={setShowLeaderboard}
        title='Word grid board'
        description={leaderboardMode === 'daily' ? 'Today’s solvers.' : 'All-time standings.'}
      >
        <GameLeaderboard
          gameType='word-grid'
          mode={leaderboardMode}
          modes={DAILY_BOARD_MODES}
          onModeChange={(next) => setLeaderboardMode(next as 'daily' | 'alltime')}
          refreshKey={leaderboardRefreshKey}
        />
      </GameLeaderboardModal>

      <GameInventoryModal
        open={showInventory}
        onOpenChange={setShowInventory}
        title='Word grid inventory'
      />
    </GameShell>
  );
}
