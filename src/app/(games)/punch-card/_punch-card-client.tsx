'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { LayoutGrid, Pencil, X as XIcon, CircleHelp } from 'lucide-react';

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
  PUNCH_CARD_SIZES,
  SIZE_LABELS,
  SIZE_SHORT_LABELS,
  SIZE_TO_N,
  ACTION_FILL,
  ACTION_X,
  ACTION_CLEAR,
  type PunchCardSize,
  type MarkEvent,
  type CellState,
  formatClock,
  parseClues,
  lineMatches,
  isBoardSolved,
} from './_punch-card-shared';

import {
  DEFAULT_PUNCH_CARD_THEME,
  buildPunchCardTheme,
  punchCardThemeCssVars,
  type InventoryCosmeticResponse,
  type PunchCardCosmeticTheme,
} from './_punch-card-theme';

import './_punch-card-midway.css';

type GameState = 'idle' | 'loading' | 'playing' | 'solved' | 'error';
type PaintMode = 'fill' | 'x';

const STORAGE_SIZE_KEY = 'punch_card_size';

const REWARDS_HINT_TEXT =
  'Rewards hint: punch out the picture to bank tickets — faster solves and bigger boards pay more. A wrong fill adds +10s, a clean solve shaves time off. Tickets taper toward the daily cap.';

const CLUE_COLS: Record<PunchCardSize, number> = { '5x5': 3, '10x10': 4, '15x15': 5 };

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

export default function PunchCardClient() {
  const [size, setSize] = useState<PunchCardSize>('10x10');
  const [gameState, setGameState] = useState<GameState>('idle');
  const [n, setN] = useState<number>(10);
  const [rowClues, setRowClues] = useState<number[][]>([]);
  const [colClues, setColClues] = useState<number[][]>([]);
  const [board, setBoard] = useState<CellState[]>(() => []);
  const [cursor, setCursor] = useState<number | null>(null);
  const [paintMode, setPaintMode] = useState<PaintMode>('fill');
  const [poppedCell, setPoppedCell] = useState<number | null>(null);
  const [shake, setShake] = useState(false);

  const [elapsedMs, setElapsedMs] = useState(0);
  const [bestSolveMs, setBestSolveMs] = useState<number | null>(null);

  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const [showRewardsHint, setShowRewardsHint] = useState(false);
  const [leaderboardRefreshKey, setLeaderboardRefreshKey] = useState(0);

  const [walletBalances, setWalletBalances] = useState({ credits: 0 });
  const [dailyCreditsProgress, setDailyCreditsProgress] = useState({ earned: 0, cap: 300 });
  const [theme, setTheme] = useState<PunchCardCosmeticTheme>(DEFAULT_PUNCH_CARD_THEME);

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
  const [finalErrors, setFinalErrors] = useState<number>(0);
  const [isNewPB, setIsNewPB] = useState(false);

  const [banUntilMs, setBanUntilMs] = useState<number | null>(null);
  const [banIndefinite, setBanIndefinite] = useState(false);
  const [banNowMs, setBanNowMs] = useState(Date.now());

  // ── Refs ──
  const sessionTokenRef = useRef<string | null>(null);
  const envMonitorRef = useRef(new EnvMonitor());
  const startedAtRef = useRef<number | null>(null);
  const isStartingRef = useRef(false);
  const submittedRef = useRef(false);
  const sizeRef = useRef<PunchCardSize>('10x10');
  const gameStateRef = useRef<GameState>('idle');
  const eventsRef = useRef<MarkEvent[]>([]);
  const draggingRef = useRef(false);
  const dragValueRef = useRef<CellState>(0);
  const boardRef = useRef<CellState[]>([]);

  usePreventGameGestures(gameState === 'playing');
  const touchDevice = useIsTouchDevice();

  useEffect(() => {
    sizeRef.current = size;
  }, [size]);
  useEffect(() => {
    gameStateRef.current = gameState;
  }, [gameState]);
  useEffect(() => {
    boardRef.current = board;
  }, [board]);

  // Restore last size.
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_SIZE_KEY);
      if (stored && (PUNCH_CARD_SIZES as readonly string[]).includes(stored)) {
        setSize(stored as PunchCardSize);
      }
    } catch {
      /* storage blocked */
    }
  }, []);

  // ── Wallet ──
  const loadWallet = useCallback(async () => {
    try {
      const response = await fetch('/api/store/inventory?gameType=punch-card', {
        cache: 'no-store',
      });
      if (!response.ok) return;
      const payload = (await response.json()) as InventoryCosmeticResponse;
      setWalletBalances({ credits: payload.wallet?.credits ?? 0 });
      setDailyCreditsProgress({
        earned: payload.dailyGameCredits?.earned ?? 0,
        cap: payload.dailyGameCredits?.cap ?? 300,
      });
      setTheme(buildPunchCardTheme(payload));
    } catch {
      setWalletBalances({ credits: 0 });
      setDailyCreditsProgress({ earned: 0, cap: 300 });
    }
  }, []);

  const fetchBest = useCallback(async (sz: PunchCardSize) => {
    try {
      const response = await fetch(`/api/games/punch-card/score?size=${sz}`, {
        cache: 'no-store',
      });
      if (!response.ok) {
        setBestSolveMs(null);
        return;
      }
      const data = (await response.json()) as { bestSolveTimeMs?: number | null };
      setBestSolveMs(typeof data.bestSolveTimeMs === 'number' ? data.bestSolveTimeMs : null);
    } catch {
      setBestSolveMs(null);
    }
  }, []);

  useEffect(() => {
    void loadWallet();
  }, [loadWallet]);
  useEffect(() => {
    void fetchBest(size);
  }, [size, fetchBest]);

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

  // ── Derived: which clues are satisfied (for the "done" dimming). ──
  const rowDone = useMemo(() => {
    if (board.length !== n * n) return [];
    return rowClues.map((clue, r) => {
      const row = new Array<number>(n);
      for (let c = 0; c < n; c += 1) row[c] = board[r * n + c] === 1 ? 1 : 0;
      return lineMatches(row, clue);
    });
  }, [board, rowClues, n]);
  const colDone = useMemo(() => {
    if (board.length !== n * n) return [];
    return colClues.map((clue, c) => {
      const col = new Array<number>(n);
      for (let r = 0; r < n; r += 1) col[r] = board[r * n + c] === 1 ? 1 : 0;
      return lineMatches(col, clue);
    });
  }, [board, colClues, n]);

  const isSolvedView = gameState === 'solved';

  // ── Clue gutter sizing: fit the DEALT puzzle, not the worst case. ──
  // Left gutter width (in cell units) tracks the longest actual row clue and
  // the top gutter height the longest column clue, so no dead cream/board
  // void is reserved and the cells get the reclaimed space. CLUE_COLS[size]
  // stays as the ceiling; 2 units is the floor (pre-deal / tiny clues).
  const clueUnitsLeft = useMemo(() => {
    const longest = rowClues.reduce((m, c) => Math.max(m, c.length || 1), 0);
    return Math.min(CLUE_COLS[size], Math.max(2, longest + 0.4));
  }, [rowClues, size]);
  const clueUnitsTop = useMemo(() => {
    const longest = colClues.reduce((m, c) => Math.max(m, c.length || 1), 0);
    return Math.min(CLUE_COLS[size], Math.max(2, longest + 0.4));
  }, [colClues, size]);

  // ── Start a new puzzle ──
  const startGame = useCallback(
    async (sz: PunchCardSize) => {
      if (isStartingRef.current) return;
      isStartingRef.current = true;
      submittedRef.current = false;
      sessionTokenRef.current = null;
      startedAtRef.current = null;
      eventsRef.current = [];
      draggingRef.current = false;
      setGameState('loading');
      setSubmitError(null);
      setCanRetrySubmit(false);
      setStartError(null);
      setNeedsSignIn(false);
      resetRunResult();
      setFinalSolveMs(null);
      setFinalErrors(0);
      setIsNewPB(false);
      setCursor(null);
      setElapsedMs(0);

      try {
        const sessionResponse = await fetch('/api/games/session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ gameType: 'punch-card' }),
        });

        if (sessionResponse.status === 401) {
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

        const puzzleResponse = await fetch(
          `/api/games/punch-card/puzzle?token=${encodeURIComponent(token)}&size=${sz}`,
          { cache: 'no-store' },
        );
        if (!puzzleResponse.ok) {
          const data = await puzzleResponse.json().catch(() => null);
          setStartError(getSubmitErrorMessage(puzzleResponse.status, data));
          setGameState('error');
          return;
        }
        const puzzleData = await puzzleResponse.json();
        const boardN = SIZE_TO_N[sz];
        const parsedRows = parseClues(puzzleData.rowClues, boardN);
        const parsedCols = parseClues(puzzleData.colClues, boardN);
        if (!parsedRows || !parsedCols) {
          setStartError('The puzzle could not be loaded. Try again.');
          setGameState('error');
          return;
        }

        envMonitorRef.current.start();
        // Start the run clock the moment the board is dealt. The recorded time is
        // server-authoritative (server elapsed since session start), so the local
        // clock must count from deal too — otherwise the live timer would under-
        // show relative to the official recorded time, and time spent planning
        // before the first mark would be unfairly "free" for some players.
        startedAtRef.current = performance.now();
        setN(boardN);
        setRowClues(parsedRows);
        setColClues(parsedCols);
        setBoard(new Array<CellState>(boardN * boardN).fill(0));
        setCursor(0);
        setPaintMode('fill');
        setGameState('playing');
      } catch (error) {
        console.error('Failed to start punch-card session:', error);
        setStartError('Network error while starting the puzzle. Try again.');
        setGameState('error');
      } finally {
        isStartingRef.current = false;
      }
    },
    [resetRunResult],
  );

  // ── Submit the finished board (event log) ──
  const submitSolution = useCallback(
    async (force = false) => {
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
        const response = await fetch('/api/games/punch-card/score', {
          method: 'POST',
          keepalive: true,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sessionToken: sessionTokenRef.current,
            size: sizeRef.current,
            events: eventsRef.current,
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
          console.error(`[PunchCard] Solution rejected (${response.status}): ${reason}`);
          setSubmitError(getSubmitErrorMessage(response.status, errData));
          setCanRetrySubmit(true);
          SoundManager.play('lose');
          setShake(true);
          setTimeout(() => setShake(false), 360);
          return;
        }

        captureRunResult(data);

        SoundManager.play('win');
        const solveTimeMs =
          typeof data?.solveTimeMs === 'number' ? data.solveTimeMs : clientDurationMs;
        setFinalSolveMs(solveTimeMs);
        setFinalErrors(typeof data?.errorCount === 'number' ? data.errorCount : 0);
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
        console.error('Failed to submit punch-card solution:', error);
        setSubmitError('Network error while checking your solution. Try again.');
        setCanRetrySubmit(true);
      } finally {
        setIsSubmitting(false);
      }
    },
    [bestSolveMs, captureRunResult],
  );

  // ── Apply a cell mark, recording the timestamped event. ──
  const applyCell = useCallback(
    (i: number, value: CellState) => {
      const cur = boardRef.current[i];
      if (cur === undefined || cur === value) return;

      if (startedAtRef.current === null) {
        startedAtRef.current = performance.now();
      }
      const t = Math.round(performance.now() - (startedAtRef.current ?? performance.now()));
      const action = value === 1 ? ACTION_FILL : value === 2 ? ACTION_X : ACTION_CLEAR;
      eventsRef.current.push([t, i, action]);

      setBoard((prev) => {
        const next = prev.slice();
        next[i] = value;
        return next;
      });
      if (value === 1) {
        setPoppedCell(i);
        setTimeout(() => setPoppedCell((c) => (c === i ? null : c)), 160);
        SoundManager.play('arcadeReveal');
      } else {
        SoundManager.play('tetrisPieceMove');
      }
    },
    [],
  );

  // The value a press on cell `i` should paint, given the current mode: pressing
  // a cell already in the mode's state clears it (drag then "erases"), else sets.
  const pressValue = useCallback(
    (i: number, mode: PaintMode): CellState => {
      const cur = boardRef.current[i];
      if (mode === 'fill') return cur === 1 ? 0 : 1;
      return cur === 2 ? 0 : 2;
    },
    [],
  );

  const cellIndexFromPoint = (clientX: number, clientY: number): number | null => {
    const el = document.elementFromPoint(clientX, clientY);
    const cell = el?.closest('[data-idx]') as HTMLElement | null;
    if (!cell) return null;
    const idx = Number(cell.dataset.idx);
    return Number.isInteger(idx) ? idx : null;
  };

  const onCellPointerDown = (e: React.PointerEvent, i: number) => {
    if (gameState !== 'playing') return;
    e.preventDefault();
    // Release implicit touch capture so pointermove hit-tests hover siblings.
    try {
      (e.target as Element).releasePointerCapture?.(e.pointerId);
    } catch {
      /* not captured */
    }
    setCursor(i);
    const value = pressValue(i, paintMode);
    dragValueRef.current = value;
    draggingRef.current = true;
    applyCell(i, value);
  };

  const onGridPointerMove = (e: React.PointerEvent) => {
    if (!draggingRef.current || gameState !== 'playing') return;
    const i = cellIndexFromPoint(e.clientX, e.clientY);
    if (i === null) return;
    setCursor(i);
    applyCell(i, dragValueRef.current);
  };

  useEffect(() => {
    const end = () => {
      draggingRef.current = false;
    };
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
    return () => {
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
    };
  }, []);

  // ── Solve detection ──
  useEffect(() => {
    if (gameState !== 'playing') return;
    if (submittedRef.current) return;
    if (board.length !== n * n) return;
    if (isBoardSolved(board, rowClues, colClues, n)) {
      void submitSolution();
    }
  }, [board, rowClues, colClues, n, gameState, submitSolution]);

  // ── Keyboard ──
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (gameState !== 'playing') return;
      const key = e.key;
      if (cursor === null) {
        if (key.startsWith('Arrow')) {
          e.preventDefault();
          setCursor(0);
        }
        return;
      }
      const r = Math.floor(cursor / n);
      const c = cursor % n;
      let nr = r;
      let nc = c;
      if (key === 'ArrowUp') nr = Math.max(0, r - 1);
      else if (key === 'ArrowDown') nr = Math.min(n - 1, r + 1);
      else if (key === 'ArrowLeft') nc = Math.max(0, c - 1);
      else if (key === 'ArrowRight') nc = Math.min(n - 1, c + 1);
      else if (key === 'z' || key === 'Z' || key === ' ' || key === 'Enter') {
        e.preventDefault();
        applyCell(cursor, pressValue(cursor, 'fill'));
        return;
      } else if (key === 'x' || key === 'X') {
        e.preventDefault();
        applyCell(cursor, pressValue(cursor, 'x'));
        return;
      } else if (key === 'f' || key === 'F') {
        e.preventDefault();
        setPaintMode((m) => (m === 'fill' ? 'x' : 'fill'));
        return;
      } else {
        return;
      }
      e.preventDefault();
      setCursor(nr * n + nc);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [gameState, cursor, n, applyCell, pressValue]);

  useEffect(() => {
    const monitor = envMonitorRef.current;
    return () => monitor.stop();
  }, []);

  const handleSizeChange = useCallback((next: PunchCardSize) => {
    // Never switch size mid-deal or mid-solve: the auto-submit reads sizeRef,
    // and a mismatched size gets a legitimately completed board rejected by
    // the server (wrong cell count / different solution).
    const state = gameStateRef.current;
    if (state === 'playing' || state === 'loading') return;
    setSize(next);
    try {
      window.localStorage.setItem(STORAGE_SIZE_KEY, next);
    } catch {
      /* storage blocked */
    }
  }, []);

  const walletCard = {
    credits: walletBalances.credits,
    progress: {
      label: 'Daily tickets',
      current: dailyCreditsProgress.earned,
      max: dailyCreditsProgress.cap,
    },
  };

  const boardActive = gameState === 'playing' || gameState === 'solved';

  // ── Renderers ──
  const renderCell = (i: number) => {
    const state = board[i] ?? 0;
    const r = Math.floor(i / n);
    const c = i % n;
    const blockLeft = c % 5 === 0 && c !== 0;
    const blockTop = r % 5 === 0 && r !== 0;
    return (
      <button
        key={i}
        type='button'
        className='pc-cell'
        data-idx={i}
        data-state={state}
        data-cursor={cursor === i || undefined}
        data-pop={poppedCell === i || undefined}
        data-block-left={blockLeft || undefined}
        data-block-top={blockTop || undefined}
        aria-label={`Row ${r + 1}, column ${c + 1}: ${
          state === 1 ? 'filled' : state === 2 ? 'marked empty' : 'blank'
        }`}
        disabled={!boardActive}
        onPointerDown={(e) => onCellPointerDown(e, i)}
        onContextMenu={(e) => e.preventDefault()}
      />
    );
  };

  return (
    <div
      className='punch-card-midway arc-game-flow'
      style={punchCardThemeCssVars(theme)}
    >
      <div className='w-full max-w-xl space-y-3 sm:space-y-4'>
        <div className='hidden sm:block'>
          <PageHeader
            eyebrow='tixy'
            icon='grid'
            title='Punch Card'
            subtitle='Read the clues, punch out the hidden picture, race the clock.'
            wallet={walletCard}
          />
        </div>
        <div className='sm:hidden'>
          <GamesWalletCard wallet={walletCard} compact />
        </div>

        {/* Size + clock bar */}
        <div className='flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between'>
          <ArcadeSegmented<PunchCardSize>
            items={PUNCH_CARD_SIZES.map((s) => ({ value: s, label: SIZE_SHORT_LABELS[s] }))}
            value={size}
            onChange={
              gameState === 'playing' || gameState === 'loading'
                ? undefined
                : handleSizeChange
            }
            ariaLabel='Board size'
            tone='tickets'
          />
          <div className='flex items-center justify-between gap-3 sm:justify-end'>
            <div className='rounded-panel border-2 border-ink bg-panel px-3 py-1.5 shadow-panel'>
              <span className='arcade-kicker'>Time</span>
              <span className='arcade-num ml-2 text-lg font-semibold text-strong tabular-nums'>
                {formatClock(isSolvedView ? (finalSolveMs ?? elapsedMs) : elapsedMs)}
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
        <div className='pc-stage relative'>
          <div
            className='pc-grid'
            data-shake={shake || undefined}
            data-solved={isSolvedView || undefined}
            style={
              {
                ['--n']: n,
                ['--clue-cols']: clueUnitsLeft,
                ['--clue-rows']: clueUnitsTop,
                // Cells stay square with unequal gutters.
                aspectRatio: `${(n + clueUnitsLeft) / (n + clueUnitsTop)}`,
              } as React.CSSProperties
            }
            role='grid'
            aria-label='Punch card board'
            onPointerMove={onGridPointerMove}
          >
            <div className='pc-corner' aria-hidden>
              {n}×{n}
            </div>
            <div className='pc-col-clues'>
              {colClues.map((clue, c) => (
                <div key={c} className='pc-col-clue' data-done={colDone[c] || undefined}>
                  {(clue.length ? clue : [0]).map((v, k) => (
                    <span key={k}>{v}</span>
                  ))}
                </div>
              ))}
            </div>
            <div className='pc-row-clues'>
              {rowClues.map((clue, r) => (
                <div key={r} className='pc-row-clue' data-done={rowDone[r] || undefined}>
                  {(clue.length ? clue : [0]).map((v, k) => (
                    <span key={k}>{v}</span>
                  ))}
                </div>
              ))}
            </div>
            <div className='pc-cells'>
              {board.length === n * n
                ? Array.from({ length: n * n }, (_, i) => renderCell(i))
                : null}
            </div>
          </div>

          {gameState !== 'playing' && gameState !== 'solved' && (
            <div
              className='pc-overlay absolute inset-0 flex flex-col items-center justify-center rounded-well px-4'
              style={{ background: 'color-mix(in srgb, var(--scrim) 80%, transparent)' }}
            >
              {gameState === 'idle' && (
                <>
                  <LayoutGrid size={52} className='mb-4 text-tickets-text' />
                  <h1 className='arcade-display mb-2 text-center text-2xl text-strong uppercase sm:text-3xl'>
                    Punch Card
                  </h1>
                  <p className='mb-6 max-w-xs text-center text-sm text-strong sm:text-base'>
                    Fill cells that match the row & column clues to reveal a hidden
                    pixel picture. Your time starts when the board is dealt.
                  </p>
                  <ArcadeButton tone='tickets' size='lg' onClick={() => startGame(size)}>
                    Start {SIZE_SHORT_LABELS[size]}
                  </ArcadeButton>
                </>
              )}
              {gameState === 'loading' && (
                <>
                  <LayoutGrid size={52} className='mb-4 text-tickets-text' />
                  <p className='text-center text-sm text-strong sm:text-base'>
                    Punching a fresh card…
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
                      ? 'Punch Card boards are served and verified per account. Sign in to play and save your times.'
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
                    <ArcadeButton tone='tickets' onClick={() => startGame(size)}>
                      Try again
                    </ArcadeButton>
                  )}
                </>
              )}
            </div>
          )}

          {gameState === 'solved' && (
            <div
              className='pc-overlay absolute inset-0 flex flex-col items-center justify-center rounded-well px-4'
              style={{ background: 'color-mix(in srgb, var(--scrim) 74%, transparent)' }}
            >
              <ArcadeRunResult
                title={isNewPB ? 'new best' : 'punched'}
                tone={isNewPB ? 'best' : 'win'}
                stats={[
                  { label: 'time', value: formatClock(finalSolveMs ?? elapsedMs), highlight: isNewPB },
                  { label: 'size', value: SIZE_LABELS[size].toLowerCase() },
                  { label: 'errors', value: finalErrors },
                ]}
                reward={runReward}
                achievements={runAchievements}
                actions={
                  <>
                    <ArcadeRematchButton onClick={() => startGame(size)}>new card</ArcadeRematchButton>
                    <ArcadeButton tone='key' onClick={() => setShowLeaderboard(true)}>
                      leaderboard
                    </ArcadeButton>
                  </>
                }
              />
            </div>
          )}
        </div>

        {submitError && gameState === 'playing' && (
          <div className='flex flex-col items-center gap-2'>
            <p className='text-center text-xs text-danger-text sm:text-sm'>{submitError}</p>
            {canRetrySubmit && !isSubmitting && (
              <ArcadeButton tone='tickets' size='sm' onClick={() => void submitSolution(true)}>
                Check again
              </ArcadeButton>
            )}
          </div>
        )}
        {isSubmitting && (
          <p className='text-center text-xs text-faint sm:text-sm'>Checking your solution…</p>
        )}

        {/* Paint-mode toolbar */}
        <div className='pc-toolbar'>
          <button
            type='button'
            className='pc-tool'
            data-on={paintMode === 'fill' ? 'fill' : undefined}
            aria-pressed={paintMode === 'fill'}
            disabled={gameState !== 'playing'}
            onClick={() => setPaintMode('fill')}
          >
            <Pencil size={18} />
            <span>Fill</span>
          </button>
          <button
            type='button'
            className='pc-tool'
            data-on={paintMode === 'x' ? 'x' : undefined}
            aria-pressed={paintMode === 'x'}
            disabled={gameState !== 'playing'}
            onClick={() => setPaintMode('x')}
          >
            <XIcon size={18} />
            <span>Mark X</span>
          </button>
        </div>

        <p className='text-center text-xs text-faint sm:text-sm'>
          {touchDevice ? (
            'Drag to paint a row or column. Switch Fill / Mark X to plan.'
          ) : (
            <>
              <kbd className='arcade-card-inset px-2 py-1 text-strong'>arrows</kbd> move,{' '}
              <kbd className='arcade-card-inset px-2 py-1 text-strong'>Z</kbd> fill,{' '}
              <kbd className='arcade-card-inset px-2 py-1 text-strong'>X</kbd> mark,{' '}
              <kbd className='arcade-card-inset px-2 py-1 text-strong'>F</kbd> swap mode
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
        title='Punch Card board'
        description='Fastest solves per board size.'
      >
        <GameLeaderboard
          gameType='punch-card'
          mode={size}
          modes={PUNCH_CARD_SIZES.map((s) => ({ value: s, label: SIZE_SHORT_LABELS[s] }))}
          onModeChange={
            gameState === 'playing' || gameState === 'loading'
              ? undefined
              : (next) => handleSizeChange(next as PunchCardSize)
          }
          refreshKey={leaderboardRefreshKey}
        />
      </GameLeaderboardModal>
    </div>
  );
}
