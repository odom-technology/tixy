'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Grid3x3, Eraser, Pencil, CircleHelp } from 'lucide-react';

import { ArcadeButton, ArcadeSegmented } from '@/features/arcade/components/ui/arcade-ui';
import { GameLeaderboard } from '@/features/arcade/components/game-leaderboard';
import { GameLeaderboardModal } from '@/features/arcade/components/game-leaderboard-modal';
import { GameLeaderboardButton } from '@/features/arcade/components/game-leaderboard-button';
import { PageHeader, GamesWalletCard } from '@/features/arcade/components/shell/page-header';
import { MuteButton } from '@/features/arcade/components/mute-button';
import { EnvMonitor } from '@/features/arcade/lib/game-anti-cheat';
import { createGameFrameLoop } from '@/features/arcade/lib/game-frame-loop';
import { usePreventGameGestures, useIsTouchDevice } from '@/features/arcade/lib/game-mobile-utils';
import { SoundManager } from '@/features/arcade/lib/sound-manager';
import { ArcadeRematchButton, ArcadeRunResult } from '@/features/arcade/components/results/arcade-run-result';
import { useArcadeRunResult } from '@/features/arcade/lib/run-result';

import {
  DIFFICULTY_LABELS,
  SUDOKU_DIFFICULTIES,
  type SudokuDifficulty,
  colOf,
  findConflicts,
  formatClock,
  isBoardFull,
  parseGivens,
  peersOf,
  remainingCounts,
  rowOf,
} from './_sudoku-shared';

import {
  DEFAULT_SUDOKU_THEME,
  buildSudokuTheme,
  sudokuThemeCssVars,
  type InventoryCosmeticResponse,
  type SudokuCosmeticTheme,
} from './_sudoku-theme';

import './_sudoku-midway.css';

type GameState = 'idle' | 'loading' | 'playing' | 'solved' | 'error';

const STORAGE_DIFFICULTY_KEY = 'sudoku_difficulty';

const REWARDS_HINT_TEXT =
  'Rewards hint: solve the puzzle to bank tickets — faster solves and harder difficulties pay more. Tickets taper toward the daily cap.';

const getSubmitErrorMessage = (
  status: number,
  data: { error?: string; details?: string; retryAfterSec?: number } | null,
) => {
  if (status === 429) {
    const retry =
      typeof data?.retryAfterSec === 'number'
        ? ` Try again in ${data.retryAfterSec}s.`
        : '';
    return `${data?.error ?? 'Too many submissions.'}${retry}`;
  }
  if (typeof data?.details === 'string' && data.details.trim()) return data.details;
  if (typeof data?.error === 'string' && data.error.trim()) return data.error;
  return 'Could not check the solution. Try again.';
};

export default function SudokuClient() {
  const [difficulty, setDifficulty] = useState<SudokuDifficulty>('easy');
  const [gameState, setGameState] = useState<GameState>('idle');
  const [givens, setGivens] = useState<number[]>(() => new Array(81).fill(0));
  const [board, setBoard] = useState<number[]>(() => new Array(81).fill(0));
  const [notes, setNotes] = useState<number[][]>(() =>
    Array.from({ length: 81 }, () => []),
  );
  const [selected, setSelected] = useState<number | null>(null);
  const [noteMode, setNoteMode] = useState(false);
  const [poppedCell, setPoppedCell] = useState<number | null>(null);
  const [shake, setShake] = useState(false);

  const [elapsedMs, setElapsedMs] = useState(0);
  const [bestSolveMs, setBestSolveMs] = useState<number | null>(null);

  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const [showRewardsHint, setShowRewardsHint] = useState(false);
  const [leaderboardRefreshKey, setLeaderboardRefreshKey] = useState(0);

  const [walletBalances, setWalletBalances] = useState({ credits: 0 });
  const [dailyCreditsProgress, setDailyCreditsProgress] = useState({
    earned: 0,
    cap: 300,
  });
  const [sudokuTheme, setSudokuTheme] =
    useState<SudokuCosmeticTheme>(DEFAULT_SUDOKU_THEME);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [canRetrySubmit, setCanRetrySubmit] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [needsSignIn, setNeedsSignIn] = useState(false);
  const {
    reward: runReward,
    achievements: runAchievements,
    capture: captureRunResult,
    reset: resetRunResult,
  } = useArcadeRunResult();
  const [finalSolveMs, setFinalSolveMs] = useState<number | null>(null);
  const [isNewPB, setIsNewPB] = useState(false);

  const [banUntilMs, setBanUntilMs] = useState<number | null>(null);
  const [banIndefinite, setBanIndefinite] = useState(false);
  const [banNowMs, setBanNowMs] = useState(Date.now());

  // ── Refs ──
  const sessionTokenRef = useRef<string | null>(null);
  const envMonitorRef = useRef(new EnvMonitor());
  const startedAtRef = useRef<number | null>(null); // perf clock at first entry
  const isStartingRef = useRef(false);
  const submittedRef = useRef(false);
  const difficultyRef = useRef<SudokuDifficulty>('easy');

  const touchDevice = useIsTouchDevice();

  usePreventGameGestures(gameState === 'playing');

  useEffect(() => {
    difficultyRef.current = difficulty;
  }, [difficulty]);

  // Restore last difficulty.
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_DIFFICULTY_KEY);
      if (stored && (SUDOKU_DIFFICULTIES as readonly string[]).includes(stored)) {
        setDifficulty(stored as SudokuDifficulty);
      }
    } catch {
      /* storage blocked */
    }
  }, []);

  // ── Wallet ──
  const loadWallet = useCallback(async () => {
    try {
      const response = await fetch('/api/store/inventory?gameType=sudoku', {
        cache: 'no-store',
      });
      if (!response.ok) return;
      const payload = (await response.json()) as InventoryCosmeticResponse;
      setWalletBalances({ credits: payload.wallet?.credits ?? 0 });
      setDailyCreditsProgress({
        earned: payload.dailyGameCredits?.earned ?? 0,
        cap: payload.dailyGameCredits?.cap ?? 300,
      });
      setSudokuTheme(buildSudokuTheme(payload));
    } catch {
      setWalletBalances({ credits: 0 });
      setDailyCreditsProgress({ earned: 0, cap: 300 });
    }
  }, []);

  const fetchBest = useCallback(async (diff: SudokuDifficulty) => {
    try {
      const response = await fetch(
        `/api/games/sudoku/score?difficulty=${diff}`,
        { cache: 'no-store' },
      );
      if (!response.ok) {
        setBestSolveMs(null);
        return;
      }
      const data = (await response.json()) as { bestSolveTimeMs?: number | null };
      setBestSolveMs(
        typeof data.bestSolveTimeMs === 'number' ? data.bestSolveTimeMs : null,
      );
    } catch {
      setBestSolveMs(null);
    }
  }, []);

  useEffect(() => {
    void loadWallet();
  }, [loadWallet]);

  useEffect(() => {
    void fetchBest(difficulty);
  }, [difficulty, fetchBest]);

  // ── Timer (display only; server measures authoritative time) ──
  useEffect(() => {
    if (gameState !== 'playing') return;
    let displayedSecond = -1;
    const frameLoop = createGameFrameLoop({
      // Submission timing reads performance.now() directly. This loop owns
      // only the whole-second display and pauses while the document is hidden.
      simulate: () => undefined,
      render: (_alpha, frameInfo) => {
        const startedAt = startedAtRef.current;
        if (startedAt === null) return;
        const elapsed = Math.max(0, frameInfo.nowMs - startedAt);
        const second = Math.floor(elapsed / 1000);
        if (second === displayedSecond) return;
        displayedSecond = second;
        setElapsedMs(elapsed);
      },
    });
    frameLoop.start();
    return () => frameLoop.destroy();
  }, [gameState]);

  // ── Ban countdown ──
  useEffect(() => {
    if (!banUntilMs) return;
    let timer: number | null = null;
    const update = () => setBanNowMs(Date.now());
    const stop = () => {
      if (timer === null) return;
      window.clearInterval(timer);
      timer = null;
    };
    const start = () => {
      if (timer !== null || document.hidden) return;
      update();
      timer = window.setInterval(update, 1000);
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
  }, [banUntilMs]);
  useEffect(() => {
    if (!banUntilMs) return;
    if (banNowMs >= banUntilMs) {
      setBanUntilMs(null);
      setBanIndefinite(false);
    }
  }, [banNowMs, banUntilMs]);

  const formatBanCountdown = (targetMs: number) => {
    const totalSeconds = Math.max(0, Math.floor((targetMs - banNowMs) / 1000));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return `${hours.toString().padStart(2, '0')}:${minutes
      .toString()
      .padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  };

  // ── Derived display state ──
  const conflicts = useMemo(() => findConflicts(board), [board]);
  const remaining = useMemo(() => remainingCounts(board), [board]);
  const selectedValue = selected !== null ? board[selected] : 0;
  const peerSet = useMemo(
    () => (selected !== null ? new Set(peersOf(selected)) : new Set<number>()),
    [selected],
  );

  // ── Start a new puzzle ──
  const startGame = useCallback(
    async (diff: SudokuDifficulty) => {
      if (isStartingRef.current) return;
      isStartingRef.current = true;
      submittedRef.current = false;
      sessionTokenRef.current = null;
      startedAtRef.current = null;
      setGameState('loading');
      setSubmitError(null);
      setCanRetrySubmit(false);
      setStartError(null);
      setNeedsSignIn(false);
      resetRunResult();
      setFinalSolveMs(null);
      setIsNewPB(false);
      setSelected(null);
      setElapsedMs(0);

      try {
        const sessionResponse = await fetch('/api/games/session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ gameType: 'sudoku' }),
        });

        if (sessionResponse.status === 401) {
          // Sudoku's puzzle generation is server-authoritative (the solution
          // never reaches the client), so guests cannot play a verifiable
          // board. Prompt them to sign in.
          setNeedsSignIn(true);
          setGameState('error');
          return;
        }

        if (!sessionResponse.ok) {
          const data = await sessionResponse.json().catch(() => null);
          if (sessionResponse.status === 403) {
            setBanIndefinite(Boolean(data?.isIndefinite));
            setBanUntilMs(
              typeof data?.retryAfterSec === 'number'
                ? Date.now() + data.retryAfterSec * 1000
                : null,
            );
          }
          setStartError(getSubmitErrorMessage(sessionResponse.status, data));
          setGameState('error');
          return;
        }

        setBanIndefinite(false);
        setBanUntilMs(null);
        const sessionData = await sessionResponse.json();
        const token = sessionData.token as string | undefined;
        if (!token) {
          setStartError('Could not start the session. Try again.');
          setGameState('error');
          return;
        }
        sessionTokenRef.current = token;

        // Fetch the puzzle (givens only) from the server.
        const puzzleResponse = await fetch(
          `/api/games/sudoku/puzzle?token=${encodeURIComponent(token)}&difficulty=${diff}`,
          { cache: 'no-store' },
        );
        if (!puzzleResponse.ok) {
          const data = await puzzleResponse.json().catch(() => null);
          setStartError(getSubmitErrorMessage(puzzleResponse.status, data));
          setGameState('error');
          return;
        }
        const puzzleData = await puzzleResponse.json();
        const parsed = parseGivens(puzzleData.givens);
        if (!parsed) {
          setStartError('The puzzle could not be loaded. Try again.');
          setGameState('error');
          return;
        }

        envMonitorRef.current.start();
        setGivens(parsed);
        setBoard(parsed.slice());
        setNotes(Array.from({ length: 81 }, () => []));
        // Auto-select the first empty cell for immediate keyboard play.
        const firstEmpty = parsed.findIndex((v) => v === 0);
        setSelected(firstEmpty >= 0 ? firstEmpty : null);
        setGameState('playing');
      } catch (error) {
        console.error('Failed to start sudoku session:', error);
        setStartError('Network error while starting the puzzle. Try again.');
        setGameState('error');
      } finally {
        isStartingRef.current = false;
      }
    },
    [resetRunResult],
  );

  // ── Submit the solved board ──
  // `force` bypasses the in-flight/submitted guard for a manual "Check again"
  // retry after a transient (non-correctness) failure. The auto-submit effect
  // always calls this without `force`, and we keep `submittedRef` set after a
  // response so a full+valid board never triggers an infinite resubmit loop.
  const submitSolution = useCallback(
    async (finalBoard: number[], force = false) => {
      if (!sessionTokenRef.current) return;
      if (submittedRef.current && !force) return;
      submittedRef.current = true;
      setCanRetrySubmit(false);

      const clientDurationMs =
        startedAtRef.current !== null
          ? Math.max(0, performance.now() - startedAtRef.current)
          : 0;

      envMonitorRef.current.stop();
      setIsSubmitting(true);
      setSubmitError(null);

      try {
        const response = await fetch('/api/games/sudoku/score', {
          method: 'POST',
          keepalive: true,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sessionToken: sessionTokenRef.current,
            difficulty: difficultyRef.current,
            solution: finalBoard,
            clientDurationMs,
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
          console.error(`[Sudoku] Solution rejected (${response.status}): ${reason}`);
          setSubmitError(getSubmitErrorMessage(response.status, errData));
          // Keep `submittedRef` set so the auto-submit effect cannot loop on a
          // full board; offer a manual retry instead. (A full, conflict-free
          // grid is necessarily the unique solution, so any rejection here is
          // transient — session/rate/network — not a wrong answer.)
          setCanRetrySubmit(true);
          SoundManager.play('lose');
          setShake(true);
          setTimeout(() => setShake(false), 360);
          return;
        }

        captureRunResult(data);

        // Accepted — the puzzle is solved.
        SoundManager.play('win');
        const solveTimeMs =
          typeof data?.solveTimeMs === 'number' ? data.solveTimeMs : clientDurationMs;
        setFinalSolveMs(solveTimeMs);
        setIsNewPB(Boolean(data?.isNewPB));
        setGameState('solved');
        if (
          bestSolveMs === null ||
          (typeof solveTimeMs === 'number' && solveTimeMs < bestSolveMs)
        ) {
          setBestSolveMs(solveTimeMs);
        }

        const reward = data?.reward as
          | {
              awardedCredits?: number;
              capRemaining?: number;
              earnedTodayTotal?: number;
              balanceAfter?: number;
            }
          | undefined;
        if (reward) {
          const awardedCredits = Number(reward.awardedCredits ?? 0);
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
        console.error('Failed to submit sudoku solution:', error);
        setSubmitError('Network error while checking your solution. Try again.');
        // Allow a manual retry; the auto-submit effect stays disabled (ref set).
        setCanRetrySubmit(true);
      } finally {
        setIsSubmitting(false);
      }
    },
    [bestSolveMs, captureRunResult],
  );

  // ── Place / clear a value in the selected cell ──
  const enterValue = useCallback(
    (value: number) => {
      if (gameState !== 'playing') return;
      const cell = selected;
      if (cell === null) return;
      if (givens[cell] !== 0) return; // can't edit a clue

      // Anchor the clock to the first real entry.
      if (startedAtRef.current === null) {
        startedAtRef.current = performance.now();
      }

      if (noteMode && value !== 0) {
        setNotes((prev) => {
          const next = prev.slice();
          const cur = next[cell] ?? [];
          next[cell] = cur.includes(value)
            ? cur.filter((d) => d !== value)
            : [...cur, value].sort((a, b) => a - b);
          return next;
        });
        SoundManager.play('tetrisPieceMove');
        return;
      }

      setBoard((prev) => {
        if (prev[cell] === value) return prev;
        const next = prev.slice();
        next[cell] = value;
        return next;
      });
      // Clear notes in this cell when a real value is placed.
      if (value !== 0) {
        setNotes((prev) => {
          if ((prev[cell]?.length ?? 0) === 0) return prev;
          const next = prev.slice();
          next[cell] = [];
          return next;
        });
        setPoppedCell(cell);
        setTimeout(() => setPoppedCell((c) => (c === cell ? null : c)), 200);
        SoundManager.play('arcadeReveal');
      } else {
        SoundManager.play('tetrisPieceMove');
      }
    },
    [gameState, selected, givens, noteMode],
  );

  // When the board becomes full with no conflicts, auto-submit for checking.
  useEffect(() => {
    if (gameState !== 'playing') return;
    if (submittedRef.current) return;
    if (!isBoardFull(board)) return;
    if (conflicts.size > 0) {
      // Full but with duplicates — nudge the player rather than submit.
      SoundManager.play('lose');
      setShake(true);
      setTimeout(() => setShake(false), 360);
      return;
    }
    void submitSolution(board);
  }, [board, conflicts, gameState, submitSolution]);

  // ── Keyboard input ──
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (gameState !== 'playing') return;
      const key = e.key;

      // Digit entry.
      if (key >= '1' && key <= '9') {
        e.preventDefault();
        enterValue(Number(key));
        return;
      }
      if (key === '0' || key === 'Backspace' || key === 'Delete') {
        e.preventDefault();
        enterValue(0);
        return;
      }
      if (key === 'n' || key === 'N') {
        e.preventDefault();
        setNoteMode((m) => !m);
        return;
      }

      // Arrow navigation.
      if (selected === null) {
        if (key.startsWith('Arrow')) {
          e.preventDefault();
          setSelected(0);
        }
        return;
      }
      const r = rowOf(selected);
      const c = colOf(selected);
      let nr = r;
      let nc = c;
      if (key === 'ArrowUp') nr = Math.max(0, r - 1);
      else if (key === 'ArrowDown') nr = Math.min(8, r + 1);
      else if (key === 'ArrowLeft') nc = Math.max(0, c - 1);
      else if (key === 'ArrowRight') nc = Math.min(8, c + 1);
      else return;
      e.preventDefault();
      setSelected(nr * 9 + nc);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [gameState, selected, enterValue]);

  // Stop the env monitor on unmount.
  useEffect(() => {
    const monitor = envMonitorRef.current;
    return () => monitor.stop();
  }, []);

  const handleDifficultyChange = useCallback(
    (next: SudokuDifficulty) => {
      setDifficulty(next);
      try {
        window.localStorage.setItem(STORAGE_DIFFICULTY_KEY, next);
      } catch {
        /* storage blocked */
      }
    },
    [],
  );

  const walletCard = {
    credits: walletBalances.credits,
    progress: {
      label: 'Daily tickets',
      current: dailyCreditsProgress.earned,
      max: dailyCreditsProgress.cap,
    },
  };

  const boardActive = gameState === 'playing' || gameState === 'solved';

  // ── Cell renderer (element-factory; no `const C = MAP[x]` in render) ──
  const renderCell = (i: number) => {
    const value = board[i];
    const isGiven = givens[i] !== 0;
    const isSelected = selected === i;
    const isPeer = peerSet.has(i);
    const isSame =
      !isSelected && value !== 0 && selectedValue !== 0 && value === selectedValue;
    const isConflict = conflicts.has(i);
    const cellNotes = notes[i] ?? [];
    const boxLeft = colOf(i) % 3 === 0 && colOf(i) !== 0;
    const boxTop = rowOf(i) % 3 === 0 && rowOf(i) !== 0;

    return (
      <button
        key={i}
        type='button'
        className='sudoku-cell'
        data-given={isGiven || undefined}
        data-entry={value !== 0 || undefined}
        data-selected={isSelected || undefined}
        data-peer={isPeer || undefined}
        data-same={isSame || undefined}
        data-conflict={isConflict || undefined}
        data-pop={poppedCell === i || undefined}
        data-box-left={boxLeft || undefined}
        data-box-top={boxTop || undefined}
        aria-label={`Row ${rowOf(i) + 1}, column ${colOf(i) + 1}${
          value ? `, value ${value}` : ', empty'
        }${isGiven ? ', clue' : ''}`}
        disabled={!boardActive}
        onClick={() => {
          if (gameState !== 'playing') return;
          setSelected(i);
        }}
      >
        {value !== 0 ? (
          <span className='sudoku-cell-value'>{value}</span>
        ) : cellNotes.length > 0 ? (
          <span className='sudoku-notes' aria-hidden>
            {Array.from({ length: 9 }, (_, n) => (
              <span key={n} className='sudoku-note'>
                {cellNotes.includes(n + 1) ? n + 1 : ''}
              </span>
            ))}
          </span>
        ) : null}
      </button>
    );
  };

  // ── Keypad renderer ──
  const renderDigitKey = (d: number) => {
    const left = remaining[d];
    const exhausted = left <= 0;
    return (
      <button
        key={d}
        type='button'
        className='sudoku-key'
        data-exhausted={exhausted || undefined}
        disabled={gameState !== 'playing'}
        onClick={() => enterValue(d)}
        aria-label={`Place ${d}${exhausted ? ' (none left)' : `, ${left} left`}`}
      >
        {d}
        <span className='sudoku-key-count'>{left > 0 ? left : ''}</span>
      </button>
    );
  };

  return (
    <div
      className='sudoku-midway arc-game-flow'
      style={sudokuThemeCssVars(sudokuTheme)}
    >
      <div className='w-full max-w-2xl space-y-3 sm:space-y-4'>
        <div className='hidden sm:block'>
          <PageHeader
            eyebrow='Arcade'
            icon='grid'
            title='Sudoku'
            subtitle='Fill the grid, race the clock, climb each difficulty board.'
            wallet={walletCard}
          />
        </div>
        <div className='sm:hidden'>
          <GamesWalletCard wallet={walletCard} compact />
        </div>

        {/* Difficulty + clock bar */}
        <div className='flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between'>
          <ArcadeSegmented<SudokuDifficulty>
            items={SUDOKU_DIFFICULTIES.map((d) => ({
              value: d,
              label: DIFFICULTY_LABELS[d],
            }))}
            value={difficulty}
            onChange={gameState === 'playing' ? undefined : handleDifficultyChange}
            ariaLabel='Difficulty'
            tone='tickets'
          />
          <div className='flex items-center justify-between gap-3 sm:justify-end'>
            <div className='rounded-panel border-2 border-ink bg-panel px-3 py-1.5 shadow-panel'>
              <span className='arcade-kicker'>Time</span>
              <span className='arcade-num ml-2 text-lg font-semibold text-strong tabular-nums'>
                {formatClock(gameState === 'solved' ? (finalSolveMs ?? elapsedMs) : elapsedMs)}
              </span>
            </div>
            <div className='rounded-panel border-2 border-ink bg-panel px-3 py-1.5 shadow-panel'>
              <span className='arcade-kicker'>Best</span>
              <span className='arcade-num ml-2 text-lg font-semibold text-tickets-text tabular-nums'>
                {bestSolveMs !== null ? formatClock(bestSolveMs) : '—'}
              </span>
            </div>
          </div>
        </div>

        {/* Board stage */}
        <div className='sudoku-stage relative'>
          <div
            className='sudoku-board'
            data-shake={shake || undefined}
            role='grid'
            aria-label='Sudoku board'
          >
            {Array.from({ length: 81 }, (_, i) => renderCell(i))}
          </div>

          {gameState !== 'playing' && gameState !== 'solved' && (
            <div
              className='sudoku-overlay absolute inset-0 flex flex-col items-center justify-center rounded-well px-4'
              style={{
                background: 'color-mix(in srgb, var(--scrim) 80%, transparent)',
              }}
            >
              {gameState === 'idle' && (
                <>
                  <Grid3x3 size={52} className='mb-4 text-tickets-text' />
                  <h1 className='arcade-display mb-2 text-center text-2xl text-strong uppercase sm:text-3xl'>
                    Sudoku
                  </h1>
                  <p className='mb-6 max-w-xs text-center text-sm text-strong sm:text-base'>
                    Pick a difficulty and start. Your time is recorded the moment
                    you place your first number.
                  </p>
                  <ArcadeButton
                    tone='tickets'
                    size='lg'
                    onClick={() => startGame(difficulty)}
                  >
                    Start {DIFFICULTY_LABELS[difficulty]}
                  </ArcadeButton>
                </>
              )}

              {gameState === 'loading' && (
                <>
                  <Grid3x3 size={52} className='mb-4 text-tickets-text' />
                  <p className='text-center text-sm text-strong sm:text-base'>
                    Dealing a fresh puzzle…
                  </p>
                </>
              )}

              {gameState === 'error' && (
                <>
                  <h2 className='arcade-display mb-2 text-2xl text-danger-text uppercase sm:text-3xl'>
                    {needsSignIn ? 'Sign in to play' : 'Something went wrong'}
                  </h2>
                  <p className='mb-4 max-w-xs text-center text-sm text-strong sm:text-base'>
                    {needsSignIn
                      ? 'Sudoku puzzles are served and verified per account. Sign in to play and save your times.'
                      : (startError ?? 'The puzzle could not be loaded.')}
                  </p>
                  {(banIndefinite || banUntilMs) && (
                    <p className='mb-2 text-center text-xs text-tickets-text sm:text-sm'>
                      {banIndefinite
                        ? 'You are banned from games until an admin unbans you.'
                        : `Ban time left: ${formatBanCountdown(banUntilMs!)}`}
                    </p>
                  )}
                  {!needsSignIn && (
                    <ArcadeButton
                      tone='tickets'
                      onClick={() => startGame(difficulty)}
                    >
                      Try again
                    </ArcadeButton>
                  )}
                </>
              )}
            </div>
          )}

          {gameState === 'solved' && (
            <div
              className='sudoku-overlay absolute inset-0 flex flex-col items-center justify-center rounded-well px-4'
              style={{
                background: 'color-mix(in srgb, var(--scrim) 82%, transparent)',
              }}
            >
              <ArcadeRunResult
                title={isNewPB ? 'new best' : 'solved'}
                tone={isNewPB ? 'best' : 'win'}
                stats={[
                  { label: 'time', value: formatClock(finalSolveMs ?? elapsedMs), highlight: isNewPB },
                  { label: 'level', value: DIFFICULTY_LABELS[difficulty].toLowerCase() },
                ]}
                reward={runReward}
                achievements={runAchievements}
                actions={
                  <>
                    <ArcadeRematchButton onClick={() => startGame(difficulty)}>new puzzle</ArcadeRematchButton>
                    <ArcadeButton tone='key' onClick={() => setShowLeaderboard(true)}>
                      leaderboard
                    </ArcadeButton>
                  </>
                }
              />
            </div>
          )}
        </div>

        {/* Submit feedback. A full, conflict-free board is necessarily the
            unique solution, so any error here is transient (session / rate /
            network) — offer a manual "Check again". */}
        {submitError && gameState === 'playing' && (
          <div className='flex flex-col items-center gap-2'>
            <p className='text-center text-xs text-danger-text sm:text-sm'>
              {submitError}
            </p>
            {canRetrySubmit && !isSubmitting && (
              <ArcadeButton
                tone='tickets'
                size='sm'
                onClick={() => void submitSolution(board, true)}
              >
                Check again
              </ArcadeButton>
            )}
          </div>
        )}
        {isSubmitting && (
          <p className='text-center text-xs text-faint sm:text-sm'>
            Checking your solution…
          </p>
        )}

        {/* Number keypad + tools */}
        <div className='space-y-2'>
          <div className='sudoku-keypad'>
            {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((d) => renderDigitKey(d))}
          </div>
          <div className='grid grid-cols-2 gap-2'>
            <button
              type='button'
              className='sudoku-key sudoku-tool flex items-center justify-center gap-2'
              style={{ aspectRatio: 'auto', paddingBlock: '0.6rem' }}
              disabled={gameState !== 'playing'}
              onClick={() => enterValue(0)}
              aria-label='Erase selected cell'
            >
              <Eraser size={18} />
              <span className='text-sm'>Erase</span>
            </button>
            <button
              type='button'
              className='sudoku-key sudoku-tool flex items-center justify-center gap-2'
              style={{ aspectRatio: 'auto', paddingBlock: '0.6rem' }}
              data-on={noteMode || undefined}
              disabled={gameState !== 'playing'}
              onClick={() => setNoteMode((m) => !m)}
              aria-pressed={noteMode}
              aria-label='Toggle pencil notes'
            >
              <Pencil size={18} />
              <span className='text-sm'>Notes{noteMode ? ' on' : ''}</span>
            </button>
          </div>
        </div>

        <p className='text-center text-xs text-faint sm:text-sm'>
          {touchDevice ? (
            'Tap a cell, then a number. Toggle Notes for pencil marks.'
          ) : (
            <>
              Use{' '}
              <kbd className='arcade-card-inset px-2 py-1 text-strong'>1</kbd>–
              <kbd className='arcade-card-inset px-2 py-1 text-strong'>9</kbd>,{' '}
              <kbd className='arcade-card-inset px-2 py-1 text-strong'>arrows</kbd>{' '}
              to move,{' '}
              <kbd className='arcade-card-inset px-2 py-1 text-strong'>N</kbd> for
              notes
            </>
          )}
        </p>

        {/* Controls row */}
        <div className='flex flex-wrap items-center justify-center gap-2 pb-1 sm:gap-4'>
          <GameLeaderboardButton
            onClick={(e) => {
              e.stopPropagation();
              setShowLeaderboard(true);
            }}
            className='h-10 shrink-0 px-3 py-0 text-xs sm:text-sm'
          />
          <MuteButton />
          <div className='relative inline-flex items-center gap-1.5'>
            <ArcadeButton
              tone='ghost'
              size='icon'
              className='peer'
              aria-label='Show rewards hint'
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

      <GameLeaderboardModal
        open={showLeaderboard}
        onOpenChange={setShowLeaderboard}
        title='Sudoku board'
        description='Fastest solves per difficulty.'
      >
        <GameLeaderboard
          gameType='sudoku'
          mode={difficulty}
          modes={SUDOKU_DIFFICULTIES.map((d) => ({ value: d, label: DIFFICULTY_LABELS[d] }))}
          onModeChange={(next) => handleDifficultyChange(next as SudokuDifficulty)}
          refreshKey={leaderboardRefreshKey}
        />
      </GameLeaderboardModal>
    </div>
  );
}
