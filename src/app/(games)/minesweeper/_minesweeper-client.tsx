'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Bomb, Flag, CircleHelp } from 'lucide-react';

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
  MINESWEEPER_CONFIG,
  MINESWEEPER_DIFFICULTIES,
  formatClock,
  floodReveal,
  generateMinesweeper,
  type GeneratedMinesweeper,
  type MinesweeperDifficulty,
} from './_minesweeper-shared';

import {
  DEFAULT_MINESWEEPER_THEME,
  buildMinesweeperTheme,
  minesweeperThemeCssVars,
  type InventoryCosmeticResponse,
  type MinesweeperCosmeticTheme,
} from './_minesweeper-theme';

import './_minesweeper-midway.css';

type GameState = 'idle' | 'loading' | 'playing' | 'won' | 'lost' | 'error';

const STORAGE_DIFFICULTY_KEY = 'minesweeper_difficulty';

const REWARDS_HINT_TEXT =
  'Rewards hint: clear every safe cell to bank tickets — faster clears and harder difficulties pay more. Tickets taper toward the daily cap.';

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
  return 'Could not record the clear. Try again.';
};

export default function MinesweeperClient() {
  const [difficulty, setDifficulty] = useState<MinesweeperDifficulty>('beginner');
  const [gameState, setGameState] = useState<GameState>('idle');

  const [board, setBoard] = useState<GeneratedMinesweeper | null>(null);
  const [revealed, setRevealed] = useState<Set<number>>(() => new Set());
  const [flags, setFlags] = useState<Set<number>>(() => new Set());
  const [explodedCell, setExplodedCell] = useState<number | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [flagMode, setFlagMode] = useState(false);
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
  const [theme, setTheme] = useState<MinesweeperCosmeticTheme>(
    DEFAULT_MINESWEEPER_THEME,
  );

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
  const startedAtRef = useRef<number | null>(null);
  const isStartingRef = useRef(false);
  const submittedRef = useRef(false);
  const difficultyRef = useRef<MinesweeperDifficulty>('beginner');
  const boardRef = useRef<GeneratedMinesweeper | null>(null);
  const revealedRef = useRef<Set<number>>(new Set());
  const flagsRef = useRef<Set<number>>(new Set());
  const flagModeRef = useRef(false);

  usePreventGameGestures(gameState === 'playing');

  const touchDevice = useIsTouchDevice();

  useEffect(() => {
    difficultyRef.current = difficulty;
  }, [difficulty]);
  useEffect(() => {
    boardRef.current = board;
  }, [board]);
  useEffect(() => {
    revealedRef.current = revealed;
  }, [revealed]);
  useEffect(() => {
    flagsRef.current = flags;
  }, [flags]);
  useEffect(() => {
    flagModeRef.current = flagMode;
  }, [flagMode]);

  // Restore last difficulty.
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_DIFFICULTY_KEY);
      if (
        stored &&
        (MINESWEEPER_DIFFICULTIES as readonly string[]).includes(stored)
      ) {
        setDifficulty(stored as MinesweeperDifficulty);
      }
    } catch {
      /* storage blocked */
    }
  }, []);

  // ── Wallet ──
  const loadWallet = useCallback(async () => {
    try {
      const response = await fetch('/api/store/inventory?gameType=minesweeper', {
        cache: 'no-store',
      });
      if (!response.ok) return;
      const payload = (await response.json()) as InventoryCosmeticResponse;
      setWalletBalances({ credits: payload.wallet?.credits ?? 0 });
      setDailyCreditsProgress({
        earned: payload.dailyGameCredits?.earned ?? 0,
        cap: payload.dailyGameCredits?.cap ?? 300,
      });
      setTheme(buildMinesweeperTheme(payload));
    } catch {
      setWalletBalances({ credits: 0 });
      setDailyCreditsProgress({ earned: 0, cap: 300 });
    }
  }, []);

  const fetchBest = useCallback(async (diff: MinesweeperDifficulty) => {
    try {
      const response = await fetch(
        `/api/games/minesweeper/score?difficulty=${diff}`,
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

  const minesRemaining = board ? board.mineCount - flags.size : 0;

  // ── Submit the cleared board ──
  const submitClear = useCallback(
    async (revealedArray: number[], force = false) => {
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
        const response = await fetch('/api/games/minesweeper/score', {
          method: 'POST',
          keepalive: true,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sessionToken: sessionTokenRef.current,
            difficulty: difficultyRef.current,
            revealedCells: revealedArray,
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
          const reason =
            errData?.details || errData?.error || `HTTP ${response.status}`;
          console.error(
            `[Minesweeper] Clear rejected (${response.status}): ${reason}`,
          );
          setSubmitError(getSubmitErrorMessage(response.status, errData));
          // A full safe clear is verifiable, so any error here is transient
          // (session / rate / network) — offer a manual retry.
          setCanRetrySubmit(true);
          return;
        }

        captureRunResult(data);

        SoundManager.play('win');
        const solveTimeMs =
          typeof data?.solveTimeMs === 'number'
            ? data.solveTimeMs
            : clientDurationMs;
        setFinalSolveMs(solveTimeMs);
        setIsNewPB(Boolean(data?.isNewPB));
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
                    (Number.isFinite(awardedCredits)
                      ? Math.max(0, awardedCredits)
                      : 0),
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
        console.error('Failed to submit minesweeper clear:', error);
        setSubmitError('Network error while recording your clear. Try again.');
        setCanRetrySubmit(true);
      } finally {
        setIsSubmitting(false);
      }
    },
    [bestSolveMs, captureRunResult],
  );

  // ── Reveal a cell ──
  const revealCell = useCallback(
    (cell: number) => {
      if (gameState !== 'playing') return;
      const b = boardRef.current;
      if (!b) return;
      if (revealedRef.current.has(cell)) return;
      if (flagsRef.current.has(cell)) return;

      // Flag-mode tap (touch) toggles a flag instead of revealing.
      if (flagModeRef.current) {
        setFlags((prev) => {
          const next = new Set(prev);
          if (next.has(cell)) next.delete(cell);
          else next.add(cell);
          return next;
        });
        SoundManager.play('tetrisPieceMove');
        return;
      }

      // Hit a mine → loss. Reveal all mines for the post-mortem board.
      if (b.mineSet.has(cell)) {
        setExplodedCell(cell);
        setRevealed((prev) => {
          const next = new Set(prev);
          for (const m of b.mines) next.add(m);
          return next;
        });
        submittedRef.current = true; // no score submission on a loss
        envMonitorRef.current.stop();
        setGameState('lost');
        SoundManager.play('lose');
        setShake(true);
        setTimeout(() => setShake(false), 360);
        return;
      }

      // Safe → flood-reveal the opening. Compute the next set synchronously from
      // the ref so the win check + submission never race a deferred state update.
      const opened = floodReveal(b, cell);
      const next = new Set(revealedRef.current);
      for (const c of opened) next.add(c);
      revealedRef.current = next;
      setRevealed(next);
      // A revealed cell can't stay flagged.
      if (flagsRef.current.has(cell)) {
        setFlags((prev) => {
          if (!prev.has(cell)) return prev;
          const f = new Set(prev);
          f.delete(cell);
          return f;
        });
      }
      SoundManager.play('arcadeReveal');

      // Win check: every safe cell revealed.
      if (next.size >= b.total - b.mineCount) {
        setGameState('won');
        void submitClear([...next]);
      }
    },
    [gameState, submitClear],
  );

  // ── Toggle a flag (right-click / long-press) ──
  const toggleFlag = useCallback(
    (cell: number) => {
      if (gameState !== 'playing') return;
      if (revealedRef.current.has(cell)) return;
      setFlags((prev) => {
        const next = new Set(prev);
        if (next.has(cell)) next.delete(cell);
        else next.add(cell);
        return next;
      });
      SoundManager.play('tetrisPieceMove');
    },
    [gameState],
  );

  // ── Start a new board ──
  const startGame = useCallback(
    async (diff: MinesweeperDifficulty) => {
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
      setExplodedCell(null);
      setFlags(new Set());
      setRevealed(new Set());
      setBoard(null);
      setElapsedMs(0);

      try {
        const sessionResponse = await fetch('/api/games/session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ gameType: 'minesweeper' }),
        });

        if (sessionResponse.status === 401) {
          // Boards are served + verified per account; guests can't play a
          // verifiable board, so prompt them to sign in.
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

        // Fetch safe board metadata (dims, mine count, seed, first-safe cell).
        const puzzleResponse = await fetch(
          `/api/games/minesweeper/puzzle?token=${encodeURIComponent(token)}&difficulty=${diff}`,
          { cache: 'no-store' },
        );
        if (!puzzleResponse.ok) {
          const data = await puzzleResponse.json().catch(() => null);
          setStartError(getSubmitErrorMessage(puzzleResponse.status, data));
          setGameState('error');
          return;
        }
        const puzzleData = (await puzzleResponse.json()) as {
          seed?: number;
          firstSafeCell?: number;
        };
        if (
          typeof puzzleData.seed !== 'number' ||
          typeof puzzleData.firstSafeCell !== 'number'
        ) {
          setStartError('The board could not be loaded. Try again.');
          setGameState('error');
          return;
        }

        // Derive the identical board locally for play.
        const generated = generateMinesweeper(puzzleData.seed, diff);

        // Auto-open the guaranteed-safe opening cell (a free flood-fill).
        const opening = floodReveal(generated, generated.firstSafeCell);

        envMonitorRef.current.start();
        startedAtRef.current = performance.now();
        setBoard(generated);
        setRevealed(new Set(opening));
        setFlags(new Set());
        setSelected(generated.firstSafeCell);
        setFlagMode(false);
        setGameState('playing');
      } catch (error) {
        console.error('Failed to start minesweeper session:', error);
        setStartError('Network error while starting the board. Try again.');
        setGameState('error');
      } finally {
        isStartingRef.current = false;
      }
    },
    [resetRunResult],
  );

  // ── Keyboard input ──
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (gameState !== 'playing') return;
      const b = boardRef.current;
      if (!b) return;
      const key = e.key;

      if (selected === null) {
        if (key.startsWith('Arrow')) {
          e.preventDefault();
          setSelected(b.firstSafeCell);
        }
        return;
      }

      if (key === ' ' || key === 'Enter') {
        e.preventDefault();
        revealCell(selected);
        return;
      }
      if (key === 'f' || key === 'F') {
        e.preventDefault();
        toggleFlag(selected);
        return;
      }

      const r = Math.floor(selected / b.cols);
      const c = selected % b.cols;
      let nr = r;
      let nc = c;
      if (key === 'ArrowUp') nr = Math.max(0, r - 1);
      else if (key === 'ArrowDown') nr = Math.min(b.rows - 1, r + 1);
      else if (key === 'ArrowLeft') nc = Math.max(0, c - 1);
      else if (key === 'ArrowRight') nc = Math.min(b.cols - 1, c + 1);
      else return;
      e.preventDefault();
      setSelected(nr * b.cols + nc);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [gameState, selected, revealCell, toggleFlag]);

  // Stop the env monitor on unmount.
  useEffect(() => {
    const monitor = envMonitorRef.current;
    return () => monitor.stop();
  }, []);

  const handleDifficultyChange = useCallback((next: MinesweeperDifficulty) => {
    setDifficulty(next);
    try {
      window.localStorage.setItem(STORAGE_DIFFICULTY_KEY, next);
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

  const boardActive = gameState === 'playing';
  const showAllMines = gameState === 'lost';

  const boardStyle = useMemo(() => {
    const vars = minesweeperThemeCssVars(theme) as Record<string, string>;
    // Before a board is dealt, fall back to the *selected* difficulty's
    // dimensions so the reserved board area (.ms-stage[data-empty]) matches the
    // board that's about to appear and the pre-game overlay centers inside it.
    const cfg = MINESWEEPER_CONFIG[difficulty];
    return {
      ...vars,
      ['--ms-cols']: String(board?.cols ?? cfg.cols),
      ['--ms-rows']: String(board?.rows ?? cfg.rows),
    } as React.CSSProperties;
  }, [theme, board, difficulty]);

  // ── Cell renderer ──
  const renderCell = (i: number) => {
    if (!board) return null;
    const isRevealed = revealed.has(i);
    const isFlag = flags.has(i);
    const isMine = board.mineSet.has(i);
    const adj = board.adjacency[i] ?? 0;
    const showMine = showAllMines && isMine;
    const showNumber = isRevealed && !isMine && adj > 0;

    return (
      <button
        key={i}
        type='button'
        className='ms-cell'
        data-revealed={(isRevealed && !showMine) || undefined}
        data-flag={(isFlag && !isRevealed) || undefined}
        data-mine={showMine || undefined}
        data-exploded={(showMine && explodedCell === i) || undefined}
        data-adj={showNumber ? String(adj) : undefined}
        data-selected={selected === i || undefined}
        style={
          {
            ['--ms-i']: Math.floor(i / board.cols) + (i % board.cols),
          } as React.CSSProperties
        }
        disabled={!boardActive}
        aria-label={`Row ${Math.floor(i / board.cols) + 1}, column ${
          (i % board.cols) + 1
        }${isFlag ? ', flagged' : isRevealed ? ', revealed' : ', covered'}`}
        onClick={() => revealCell(i)}
        onContextMenu={(e) => {
          e.preventDefault();
          toggleFlag(i);
        }}
      >
        <span className='ms-cell-face' aria-hidden>
          {showMine ? (
            <Bomb size={14} />
          ) : isFlag && !isRevealed ? (
            <Flag size={14} fill='currentColor' />
          ) : showNumber ? (
            adj
          ) : (
            ''
          )}
        </span>
      </button>
    );
  };

  return (
    <div
      className='minesweeper-midway arc-game-flow'
      style={boardStyle}
    >
      <div className='w-full max-w-2xl space-y-3 sm:space-y-4'>
        <div className='hidden sm:block'>
          <PageHeader
            eyebrow='tixy'
            icon='grid'
            title='Minesweeper'
            subtitle='Clear every safe cell, race the clock, climb each difficulty board.'
            wallet={walletCard}
          />
        </div>
        <div className='sm:hidden'>
          <GamesWalletCard wallet={walletCard} compact />
        </div>

        {/* Difficulty + clock bar */}
        <div className='flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between'>
          <ArcadeSegmented<MinesweeperDifficulty>
            items={MINESWEEPER_DIFFICULTIES.map((d) => ({
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
              <span className='arcade-kicker'>Mines</span>
              <span className='arcade-num ml-2 text-lg font-semibold text-strong tabular-nums'>
                {board ? Math.max(0, minesRemaining) : '—'}
              </span>
            </div>
            <div className='rounded-panel border-2 border-ink bg-panel px-3 py-1.5 shadow-panel'>
              <span className='arcade-kicker'>Time</span>
              <span className='arcade-num ml-2 text-lg font-semibold text-strong tabular-nums'>
                {formatClock(
                  gameState === 'won' ? (finalSolveMs ?? elapsedMs) : elapsedMs,
                )}
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
        <div className='ms-stage relative' data-empty={!board || undefined}>
          <div
            className='ms-board'
            data-shake={shake || undefined}
            data-won={gameState === 'won' || undefined}
            role='grid'
            aria-label='Minesweeper board'
          >
            {board
              ? Array.from({ length: board.total }, (_, i) => renderCell(i))
              : null}
          </div>

          {gameState !== 'playing' && gameState !== 'won' && gameState !== 'lost' && (
            <div
              className='ms-overlay absolute inset-0 flex flex-col items-center justify-center rounded-well px-4'
              style={{
                background: 'color-mix(in srgb, var(--scrim) 80%, transparent)',
              }}
            >
              {gameState === 'idle' && (
                <>
                  <Bomb size={52} className='mb-4 text-tickets-text' />
                  <h1 className='arcade-display mb-2 text-center text-2xl text-strong uppercase sm:text-3xl'>
                    Minesweeper
                  </h1>
                  <p className='mb-6 max-w-xs text-center text-sm text-strong sm:text-base'>
                    Pick a difficulty and start. Your first opening is always
                    safe — clear every mine-free cell as fast as you can.
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
                  <Bomb size={52} className='mb-4 text-tickets-text' />
                  <p className='text-center text-sm text-strong sm:text-base'>
                    Laying a fresh minefield…
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
                      ? 'Minesweeper boards are served and verified per account. Sign in to play and save your times.'
                      : (startError ?? 'The board could not be loaded.')}
                  </p>
                  {(banIndefinite || banUntilMs) && (
                    <p className='mb-2 text-center text-xs text-tickets-text sm:text-sm'>
                      {banIndefinite
                        ? 'You are banned from games until an admin unbans you.'
                        : `Ban time left: ${formatBanCountdown(banUntilMs!)}`}
                    </p>
                  )}
                  {!needsSignIn && (
                    <ArcadeButton tone='tickets' onClick={() => startGame(difficulty)}>
                      Try again
                    </ArcadeButton>
                  )}
                </>
              )}
            </div>
          )}

          {gameState === 'lost' && (
            <div
              className='ms-overlay absolute inset-0 flex flex-col items-center justify-center rounded-well px-4'
              style={{
                background: 'color-mix(in srgb, var(--scrim) 82%, transparent)',
              }}
            >
              <Bomb size={48} className='mb-3 text-danger-text' />
              <h2 className='arcade-display mb-2 text-2xl text-strong uppercase sm:text-3xl'>
                Boom
              </h2>
              <p className='mb-4 max-w-xs text-center text-sm text-body sm:text-base'>
                You hit a mine. No time recorded — try again for a clean clear.
              </p>
              <div className='mt-2 flex flex-wrap items-center justify-center gap-2'>
                <ArcadeButton tone='tickets' onClick={() => startGame(difficulty)}>
                  New board
                </ArcadeButton>
                <ArcadeButton tone='ghost' onClick={() => setShowLeaderboard(true)}>
                  Leaderboard
                </ArcadeButton>
              </div>
            </div>
          )}

          {gameState === 'won' && (
            <div
              className='ms-overlay absolute inset-0 flex flex-col items-center justify-center rounded-well px-4'
              style={{
                background: 'color-mix(in srgb, var(--scrim) 82%, transparent)',
              }}
            >
              <ArcadeRunResult
                title={isNewPB ? 'new best' : 'cleared'}
                tone={isNewPB ? 'best' : 'win'}
                stats={[
                  { label: 'time', value: formatClock(finalSolveMs ?? elapsedMs), highlight: isNewPB },
                  { label: 'level', value: DIFFICULTY_LABELS[difficulty].toLowerCase() },
                ]}
                reward={runReward}
                achievements={runAchievements}
                actions={
                  <>
                    <ArcadeRematchButton onClick={() => startGame(difficulty)}>new board</ArcadeRematchButton>
                    <ArcadeButton tone='key' onClick={() => setShowLeaderboard(true)}>
                      leaderboard
                    </ArcadeButton>
                  </>
                }
              />
            </div>
          )}
        </div>

        {/* Submit feedback. A full safe clear is verifiable, so any error here
            is transient (session / rate / network) — offer a manual retry. */}
        {submitError && gameState === 'won' && (
          <div className='flex flex-col items-center gap-2'>
            <p className='text-center text-xs text-danger-text sm:text-sm'>
              {submitError}
            </p>
            {canRetrySubmit && !isSubmitting && (
              <ArcadeButton
                tone='tickets'
                size='sm'
                onClick={() => void submitClear([...revealed], true)}
              >
                Record again
              </ArcadeButton>
            )}
          </div>
        )}
        {isSubmitting && (
          <p className='text-center text-xs text-faint sm:text-sm'>
            Recording your clear…
          </p>
        )}

        {/* Flag-mode toggle (handy on touch) */}
        <div className='grid grid-cols-1'>
          <button
            type='button'
            className='ms-flag-toggle flex items-center justify-center gap-2 rounded-panel border-2 border-ink bg-panel px-3 py-2.5 text-sm font-semibold text-strong shadow-panel disabled:opacity-50'
            data-on={flagMode || undefined}
            disabled={gameState !== 'playing'}
            onClick={() => setFlagMode((m) => !m)}
            aria-pressed={flagMode}
            aria-label='Toggle flag mode'
            style={
              flagMode
                ? {
                    background:
                      'color-mix(in srgb, var(--enamel-tickets, #b46b16) 22%, var(--panel))',
                  }
                : undefined
            }
          >
            <Flag size={18} fill={flagMode ? 'currentColor' : 'none'} />
            <span>Flag mode{flagMode ? ' on' : ''}</span>
          </button>
        </div>

        <p className='text-center text-xs text-faint sm:text-sm'>
          {touchDevice ? (
            'Tap to reveal. Turn on Flag mode to mark mines.'
          ) : (
            <>
              <kbd className='arcade-card-inset px-2 py-1 text-strong'>Click</kbd>{' '}
              to reveal,{' '}
              <kbd className='arcade-card-inset px-2 py-1 text-strong'>
                right-click
              </kbd>{' '}
              to flag,{' '}
              <kbd className='arcade-card-inset px-2 py-1 text-strong'>arrows</kbd>
              {' / '}
              <kbd className='arcade-card-inset px-2 py-1 text-strong'>F</kbd> to
              flag
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
        title='Minesweeper board'
        description='Fastest clears per difficulty.'
      >
        <GameLeaderboard
          gameType='minesweeper'
          mode={difficulty}
          modes={MINESWEEPER_DIFFICULTIES.map((d) => ({ value: d, label: DIFFICULTY_LABELS[d] }))}
          onModeChange={(next) => handleDifficultyChange(next as MinesweeperDifficulty)}
          refreshKey={leaderboardRefreshKey}
        />
      </GameLeaderboardModal>
    </div>
  );
}
