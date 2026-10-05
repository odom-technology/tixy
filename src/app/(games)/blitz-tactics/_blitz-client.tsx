'use client';

import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { Zap, CircleHelp } from 'lucide-react';
import { ArcadeButton } from '@/features/arcade/components/ui/arcade-ui';
import { GameLeaderboard } from '@/features/arcade/components/game-leaderboard';
import { GameLeaderboardModal } from '@/features/arcade/components/game-leaderboard-modal';
import { GameLeaderboardButton } from '@/features/arcade/components/game-leaderboard-button';
import { PageHeader, GamesWalletCard } from '@/features/arcade/components/shell/page-header';
import { MuteButton } from '@/features/arcade/components/mute-button';
import { EnvMonitor } from '@/features/arcade/lib/game-anti-cheat';
import { usePreventGameGestures, useIsTouchDevice } from '@/features/arcade/lib/game-mobile-utils';
import { SoundManager } from '@/features/arcade/lib/sound-manager';
import { isNewBest } from '@/features/arcade/lib/new-best';
import { ArcadeRematchButton, ArcadeRunResult } from '@/features/arcade/components/results/arcade-run-result';
import { useArcadeRunResult } from '@/features/arcade/lib/run-result';
import { applyUciMove } from '@/features/arcade/lib/chess';
import {
  DEFAULT_CHESS_THEME,
  composeChessTheme,
  type ChessTheme,
} from '@/features/arcade/lib/chess/theme';
import { ChessBoard } from '@/app/(games)/chess/_chess-board';
import { resolveBaseChessTheme, MIDWAY_PIECE_STROKE } from '@/app/(games)/chess/_midway-theme';
import { BLITZ_PUZZLES } from '@/server/arcade/data/blitz-tactics-puzzles';
import {
  buildLadder,
  BLITZ_DURATION_SEC,
  BLITZ_MAX_STRIKES,
  BLITZ_MIN_SOLVE_INTERVAL_MS,
  BLITZ_LADDER_LENGTH,
} from '@/server/arcade/blitz-tactics-replay';

import './_blitz-midway.css';

const RUSH_MS = BLITZ_DURATION_SEC * 1000;
const TICK_MS = 200;
const LOW_TIME_MS = 30_000;
const REPLY_DELAY_MS = 320; // pause before the forced opponent reply lands
const SOLVE_HOLD_MS = 620; // hold the mate before the next puzzle
const MISS_HOLD_MS = 720; // hold the miss flash before the next puzzle

const REWARDS_HINT_TEXT =
  'Rewards hint: more puzzles solved earns more tickets. Score = puzzles solved before three misses or the clock. Rewards taper at higher scores.';

const SFX = {
  solve: 'coinCorrect',
  miss: 'coinWrong',
  start: 'arcadeReveal',
  over: 'arcadeLose',
} as const;

type GameState = 'idle' | 'playing' | 'gameover' | 'error';
type Feedback = { kind: 'solved' | 'miss'; key: number } | null;
type BlitzEvent = { i: number; m: string[]; t: number };

const getSubmitErrorMessage = (
  status: number,
  data: { error?: string; details?: string; retryAfterSec?: number } | null,
) => {
  if (status === 429) {
    const retry =
      typeof data?.retryAfterSec === 'number' ? ` Try again in ${data.retryAfterSec}s.` : '';
    return `${data?.error ?? 'Too many score submissions.'}${retry}`;
  }
  if (typeof data?.details === 'string' && data.details.trim()) return data.details;
  if (typeof data?.error === 'string' && data.error.trim()) return data.error;
  return 'Could not save the run. Try again.';
};

export default function BlitzTacticsClient() {
  const touchDevice = useIsTouchDevice();
  const [gameState, setGameState] = useState<GameState>('idle');
  const [score, setScore] = useState(0);
  const [strikes, setStrikes] = useState(0);
  const [streak, setStreak] = useState(0);
  const [remainingMs, setRemainingMs] = useState(RUSH_MS);
  const [highScore, setHighScore] = useState(0);

  // Board display state (drives ChessBoard re-render).
  const [boardFen, setBoardFen] = useState<string>(BLITZ_PUZZLES[0]?.fen ?? '8/8/8/8/8/8/8/8 w - - 0 1');
  const [boardMyTurn, setBoardMyTurn] = useState(false);
  const [boardLastMove, setBoardLastMove] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [runIsNewBest, setRunIsNewBest] = useState(false);

  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const [walletBalances, setWalletBalances] = useState({ credits: 0 });
  const [dailyCreditsProgress, setDailyCreditsProgress] = useState({ earned: 0, cap: 300 });
  const [chessTheme, setChessTheme] = useState<ChessTheme>(DEFAULT_CHESS_THEME);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const {
    reward: runReward,
    achievements: runAchievements,
    capture: captureRunResult,
    reset: resetRunResult,
  } = useArcadeRunResult();
  const [showRewardsHint, setShowRewardsHint] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [isStartingSession, setIsStartingSession] = useState(false);
  const [banUntilMs, setBanUntilMs] = useState<number | null>(null);
  const [banIndefinite, setBanIndefinite] = useState(false);
  const [banNowMs, setBanNowMs] = useState(Date.now());
  const [leaderboardRefreshKey, setLeaderboardRefreshKey] = useState(0);
  const bestScoreCacheRef = useRef<number | null>(null);

  usePreventGameGestures(gameState === 'playing');

  const gameStateRef = useRef<GameState>('idle');
  const sessionTokenRef = useRef<string | null>(null);
  const seedRef = useRef<number | null>(null);
  const ladderRef = useRef<number[]>([]);
  const slotRef = useRef(0);
  const solIdxRef = useRef(0);
  const curFenRef = useRef<string>('');
  const playerMovesRef = useRef<string[]>([]);
  const eventsRef = useRef<BlitzEvent[]>([]);
  const scoreRef = useRef(0);
  const strikesRef = useRef(0);
  const streakRef = useRef(0);
  const lastCountedSolveTRef = useRef<number | null>(null);
  const startPerfRef = useRef(0);
  const envMonitorRef = useRef(new EnvMonitor());
  const isStartingRef = useRef(false);
  const isGuestRunRef = useRef(false);
  const feedbackSeqRef = useRef(0);
  const busyRef = useRef(false); // true while a reply/advance animation is in flight

  const tickTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const replyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const advanceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveScoreRef = useRef<((events: BlitzEvent[], durMs: number) => Promise<void>) | null>(null);
  const endRunRef = useRef<(() => void) | null>(null);

  const clearTimers = useCallback(() => {
    if (tickTimerRef.current) { clearInterval(tickTimerRef.current); tickTimerRef.current = null; }
    if (replyTimerRef.current) { clearTimeout(replyTimerRef.current); replyTimerRef.current = null; }
    if (advanceTimerRef.current) { clearTimeout(advanceTimerRef.current); advanceTimerRef.current = null; }
  }, []);

  const fetchUserBestScore = useCallback(async () => {
    if (bestScoreCacheRef.current !== null) { setHighScore(bestScoreCacheRef.current); return; }
    try {
      const response = await fetch('/api/games/blitz-tactics/score', { cache: 'no-store' });
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
      // Reuse the player's equipped CHESS board/piece skins — purchases carry
      // over to the puzzle board (no separate blitz-tactics cosmetics).
      const response = await fetch('/api/store/inventory?gameType=chess', { cache: 'no-store' });
      if (!response.ok) return;
      const payload = await response.json();
      setWalletBalances({ credits: payload.wallet?.credits ?? 0 });
      setDailyCreditsProgress({
        earned: payload.dailyGameCredits?.earned ?? 0,
        cap: payload.dailyGameCredits?.cap ?? 300,
      });
      const equipped = payload?.equipped ?? [];
      const fields: Record<string, unknown> = {};
      for (const e of equipped) {
        if (e?.item?.assetRef) Object.assign(fields, e.item.assetRef);
      }
      setChessTheme(composeChessTheme(fields));
    } catch {
      /* wallet + theme are best-effort */
    }
  }, []);

  const formatBanCountdown = (targetMs: number) => {
    const totalSeconds = Math.max(0, Math.floor((targetMs - banNowMs) / 1000));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  };

  const flashFeedback = useCallback((kind: 'solved' | 'miss') => {
    feedbackSeqRef.current += 1;
    setFeedback({ kind, key: feedbackSeqRef.current });
  }, []);

  const saveScore = async (events: BlitzEvent[], durationMs: number) => {
    if (isGuestRunRef.current) {
      return;
    }
    if (!sessionTokenRef.current) return;

    envMonitorRef.current.stop();
    setSubmitError(null);
    setIsSubmitting(true);
    try {
      const response = await fetch('/api/games/blitz-tactics/score', {
        method: 'POST',
        keepalive: true,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          score: scoreRef.current,
          sessionToken: sessionTokenRef.current,
          events,
          clientDurationMs: Math.max(0, durationMs),
          env: envMonitorRef.current.getFingerprint(),
        }),
      });

      const rawText = await response.text();
      let data: Record<string, unknown> | null = null;
      try { data = rawText ? JSON.parse(rawText) : null; } catch { data = null; }
      if (!response.ok) {
        const errData = data as { error?: string; details?: string; retryAfterSec?: number } | null;
        const reason = errData?.details || errData?.error || `HTTP ${response.status}`;
        console.error(`[BlitzTactics] Score rejected (${response.status}): ${reason}`);
        setSubmitError(getSubmitErrorMessage(response.status, errData));
        return;
      }

      captureRunResult(data);

      const reward = data?.reward as
        | { awardedCredits?: number; capRemaining?: number; earnedTodayTotal?: number; balanceAfter?: number }
        | undefined;
      if (reward) {
        const awardedCredits = Number(reward.awardedCredits ?? 0);
        const balanceAfter = Number(reward.balanceAfter);
        setWalletBalances((prev) => ({
          ...prev,
          credits: Number.isFinite(balanceAfter)
            ? Math.max(0, Math.floor(balanceAfter))
            : Math.max(0, prev.credits + (Number.isFinite(awardedCredits) ? Math.max(0, awardedCredits) : 0)),
        }));
        if (Number.isFinite(Number(reward.earnedTodayTotal)) && Number.isFinite(Number(reward.capRemaining))) {
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

  const endRun = useCallback(() => {
    if (gameStateRef.current !== 'playing') return;
    clearTimers();
    busyRef.current = false;
    const durationMs = performance.now() - startPerfRef.current;
    gameStateRef.current = 'gameover';
    setGameState('gameover');
    setRemainingMs(0);
    setBoardMyTurn(false);
    SoundManager.play(SFX.over);
    const prevBest = Math.max(highScore, bestScoreCacheRef.current ?? 0);
    const wasBest = isNewBest(scoreRef.current, prevBest);
    setRunIsNewBest(wasBest);
    if (wasBest) bestScoreCacheRef.current = scoreRef.current;
    if (scoreRef.current > highScore) setHighScore(scoreRef.current);
    saveScoreRef.current?.(eventsRef.current.slice(), durationMs);
  }, [clearTimers, highScore]);
  endRunRef.current = endRun;

  // Load the puzzle at ladder position `slot` into the board.
  const loadPuzzle = useCallback((slot: number) => {
    const ladder = ladderRef.current;
    if (slot >= ladder.length) { endRunRef.current?.(); return; }
    const puzzle = BLITZ_PUZZLES[ladder[slot]];
    if (!puzzle) { endRunRef.current?.(); return; }
    slotRef.current = slot;
    solIdxRef.current = 0;
    playerMovesRef.current = [];
    curFenRef.current = puzzle.fen;
    busyRef.current = false;
    setBoardLastMove(null);
    setBoardFen(puzzle.fen);
    setBoardMyTurn(true);
  }, []);

  // Advance to the next puzzle (or end after 3 strikes).
  const advance = useCallback((afterStrike: boolean) => {
    if (gameStateRef.current !== 'playing') return;
    if (afterStrike && strikesRef.current >= BLITZ_MAX_STRIKES) {
      endRunRef.current?.();
      return;
    }
    loadPuzzle(slotRef.current + 1);
  }, [loadPuzzle]);

  const onSolve = useCallback(() => {
    const t = Math.max(0, Math.floor(performance.now() - startPerfRef.current));
    eventsRef.current.push({ i: slotRef.current, m: playerMovesRef.current.slice(), t });
    // Cadence mirror: a solve too soon after the previous COUNTED solve is not
    // counted (matches the server's BLITZ_MIN_SOLVE_INTERVAL_MS drop) — the
    // puzzle still advances, it just doesn't add to the score.
    const last = lastCountedSolveTRef.current;
    if (last === null || t - last >= BLITZ_MIN_SOLVE_INTERVAL_MS) {
      scoreRef.current += 1;
      setScore(scoreRef.current);
      lastCountedSolveTRef.current = t;
      streakRef.current += 1;
      setStreak(streakRef.current);
    }
    SoundManager.play(SFX.solve);
    flashFeedback('solved');
    setBoardMyTurn(false);
    advanceTimerRef.current = setTimeout(() => advance(false), SOLVE_HOLD_MS);
  }, [advance, flashFeedback]);

  const onStrike = useCallback(() => {
    const t = Math.max(0, Math.floor(performance.now() - startPerfRef.current));
    eventsRef.current.push({ i: slotRef.current, m: playerMovesRef.current.slice(), t });
    strikesRef.current += 1;
    setStrikes(strikesRef.current);
    streakRef.current = 0;
    setStreak(0);
    SoundManager.play(SFX.miss);
    flashFeedback('miss');
    setBoardMyTurn(false);
    advanceTimerRef.current = setTimeout(() => advance(true), MISS_HOLD_MS);
  }, [advance, flashFeedback]);

  // Handle a legal move committed on the board.
  const handleMove = useCallback((uci: string) => {
    if (gameStateRef.current !== 'playing' || busyRef.current) return;
    const ladder = ladderRef.current;
    const puzzle = BLITZ_PUZZLES[ladder[slotRef.current]];
    if (!puzzle) return;
    const solution = puzzle.solution;
    const solIdx = solIdxRef.current;
    const normalized = uci.toLowerCase();

    let applied;
    try {
      applied = applyUciMove(curFenRef.current, normalized);
    } catch {
      // Should not happen (the board only commits legal moves), but a bad move
      // counts as a miss defensively.
      busyRef.current = true;
      playerMovesRef.current.push(normalized);
      onStrike();
      return;
    }

    busyRef.current = true;
    playerMovesRef.current.push(normalized);
    const isFinal = solIdx === solution.length - 1;

    // Show the player's move on the board.
    curFenRef.current = applied.fenAfter;
    setBoardFen(applied.fenAfter);
    setBoardLastMove(normalized);
    setBoardMyTurn(false);

    if (isFinal) {
      if (applied.checkmate) onSolve();
      else onStrike();
      return;
    }

    // Intermediate move: must equal the unique forcing move.
    if (normalized !== solution[solIdx].toLowerCase()) {
      onStrike();
      return;
    }

    // Correct forcing move → play the forced opponent reply after a short beat.
    const reply = solution[solIdx + 1];
    replyTimerRef.current = setTimeout(() => {
      if (gameStateRef.current !== 'playing') return;
      let afterReply: string;
      try {
        afterReply = applyUciMove(applied.fenAfter, reply).fenAfter;
      } catch {
        // Bank is verified, so this cannot happen; fail safe as a miss.
        onStrike();
        return;
      }
      curFenRef.current = afterReply;
      solIdxRef.current = solIdx + 2;
      setBoardFen(afterReply);
      setBoardLastMove(reply);
      setBoardMyTurn(true);
      busyRef.current = false;
    }, REPLY_DELAY_MS);
  }, [onSolve, onStrike]);

  const startGame = useCallback(async () => {
    if (isStartingRef.current) return;
    isStartingRef.current = true;
    isGuestRunRef.current = false;
    sessionTokenRef.current = null;
    seedRef.current = null;
    setIsStartingSession(true);
    setSubmitError(null);
    setStartError(null);
    resetRunResult();
    clearTimers();

    let sessionSuccess = false;
    try {
      const sessionResponse = await fetch('/api/games/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gameType: 'blitz-tactics' }),
      });
      if (sessionResponse.ok) {
        setBanIndefinite(false);
        setBanUntilMs(null);
        const sessionData = await sessionResponse.json();
        sessionTokenRef.current = sessionData.token;
        seedRef.current = typeof sessionData.blitzTacticsSeed === 'number' ? sessionData.blitzTacticsSeed : null;
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
          setBanUntilMs(typeof data?.retryAfterSec === 'number' ? Date.now() + data.retryAfterSec * 1000 : null);
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

    if (!sessionSuccess || seedRef.current === null || (!sessionTokenRef.current && !isGuestRunRef.current)) {
      setGameState('error');
      gameStateRef.current = 'error';
      return;
    }

    // Reset run state + build the seeded ladder.
    ladderRef.current = buildLadder(seedRef.current);
    slotRef.current = 0;
    solIdxRef.current = 0;
    playerMovesRef.current = [];
    eventsRef.current = [];
    scoreRef.current = 0;
    strikesRef.current = 0;
    streakRef.current = 0;
    lastCountedSolveTRef.current = null;
    busyRef.current = false;
    setScore(0);
    setStrikes(0);
    setStreak(0);
    setRunIsNewBest(false);
    setFeedback(null);
    setRemainingMs(RUSH_MS);
    startPerfRef.current = performance.now();
    gameStateRef.current = 'playing';
    setGameState('playing');
    SoundManager.play(SFX.start);
    loadPuzzle(0);

    tickTimerRef.current = setInterval(() => {
      const elapsed = performance.now() - startPerfRef.current;
      const left = RUSH_MS - elapsed;
      if (left <= 0) {
        setRemainingMs(0);
        endRunRef.current?.();
      } else {
        setRemainingMs(left);
      }
    }, TICK_MS);
  }, [clearTimers, loadPuzzle, resetRunResult]);

  const handlePrimaryAction = useCallback(() => {
    const current = gameStateRef.current;
    if (current === 'idle' || current === 'gameover' || current === 'error') startGame();
  }, [startGame]);

  // The overlays advertise "press Space" — honor it (review fix: the copy
  // shipped without a key handler).
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.repeat) return;
      if (gameStateRef.current === 'playing') return;
      if (e.code === 'Space' || e.code === 'Enter') {
        e.preventDefault();
        handlePrimaryAction();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handlePrimaryAction]);

  useEffect(() => {
    const monitor = envMonitorRef.current;
    return () => { clearTimers(); monitor.stop(); };
  }, [clearTimers]);

  useEffect(() => { fetchUserBestScore(); }, [fetchUserBestScore]);
  useEffect(() => { void loadWallet(); }, [loadWallet]);
  useEffect(() => {
    const handleInventoryUpdate = () => { void loadWallet(); };
    window.addEventListener('store-inventory-updated', handleInventoryUpdate);
    return () => window.removeEventListener('store-inventory-updated', handleInventoryUpdate);
  }, [loadWallet]);
  useEffect(() => {
    const timer = window.setInterval(() => setBanNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!banUntilMs) return;
    if (banNowMs >= banUntilMs) { setBanUntilMs(null); setBanIndefinite(false); }
  }, [banNowMs, banUntilMs]);

  const resolvedLook = useMemo(() => resolveBaseChessTheme(chessTheme), [chessTheme]);
  const pieceStrokeWhite = resolvedLook.isBasePieces ? MIDWAY_PIECE_STROKE.white : '#0f172a';
  const pieceStrokeBlack = resolvedLook.isBasePieces ? MIDWAY_PIECE_STROKE.black : '#f8fafc';

  const walletCard = {
    credits: walletBalances.credits,
    progress: { label: 'Daily tickets', current: dailyCreditsProgress.earned, max: dailyCreditsProgress.cap },
  };

  const isPlaying = gameState === 'playing';
  const secondsLeft = Math.ceil(remainingMs / 1000);
  const mm = Math.floor(secondsLeft / 60);
  const ss = secondsLeft % 60;
  const timeLabel = `${mm}:${ss.toString().padStart(2, '0')}`;
  const timePct = Math.max(0, Math.min(100, (remainingMs / RUSH_MS) * 100));
  const lowTime = remainingMs <= LOW_TIME_MS;

  return (
    <div className='blitz-midway arc-game-flow'>
      <div className='w-full space-y-3 sm:space-y-4'>
        <div className='mx-auto w-full max-w-4xl'>
          <div className='hidden sm:block'>
            <PageHeader
              eyebrow='tixy'
              icon={<Zap aria-hidden className='h-6 w-6' />}
              title='Blitz Tactics'
              subtitle='Solve as many chess mate puzzles as you can in five minutes. Difficulty ramps; three misses ends the run.'
              wallet={walletCard}
            />
          </div>
          <div className='sm:hidden'>
            <GamesWalletCard wallet={walletCard} compact />
          </div>
        </div>

        <div className='blitz-stats mx-auto w-full max-w-md px-1'>
          <span className='blitz-stat'>
            <span className='blitz-stat-label'>Solved</span>
            <span className='blitz-stat-value arcade-num'>{score}</span>
          </span>
          <span className='blitz-stat' data-low={isPlaying && lowTime ? 'true' : undefined}>
            <span className='blitz-stat-label'>Time</span>
            <span className='blitz-stat-value arcade-num'>{isPlaying || gameState === 'gameover' ? timeLabel : `${mm}:00`}</span>
          </span>
          <span className='blitz-stat'>
            <span className='blitz-stat-label'>Strikes</span>
            <span className='blitz-stat-value'>
              <span className='blitz-strikes' aria-label={`${strikes} of ${BLITZ_MAX_STRIKES} strikes`}>
                {Array.from({ length: BLITZ_MAX_STRIKES }).map((_, i) => (
                  <span key={i} className='blitz-strike-pip' data-on={i < strikes ? 'true' : undefined} />
                ))}
              </span>
            </span>
          </span>
          <span className='blitz-stat'>
            <span className='blitz-stat-label'>Best</span>
            <span className='blitz-stat-value arcade-num'>{highScore}</span>
          </span>
        </div>

        <div className='mx-auto flex w-full max-w-[640px] justify-center px-1'>
          <div className='blitz-timebar'>
            <div className='blitz-timebar-fill' data-low={isPlaying && lowTime ? 'true' : undefined} style={{ width: `${timePct}%` }} />
          </div>
        </div>

        <div className='relative mx-auto flex w-full max-w-[640px] justify-center px-1'>
          {feedback && isPlaying && (
            <span key={feedback.key} className='blitz-feedback' data-kind={feedback.kind}>
              {feedback.kind === 'solved' ? 'Solved +1' : 'Miss'}
            </span>
          )}
          <div className='relative w-full'>
            <ChessBoard
              fen={boardFen}
              orientation='white'
              myColor='white'
              isMyTurn={isPlaying && boardMyTurn}
              lastMoveUci={boardLastMove}
              onMove={handleMove}
              boardTheme={resolvedLook.board}
              piecesTheme={resolvedLook.pieces}
              pieceStrokeWhite={pieceStrokeWhite}
              pieceStrokeBlack={pieceStrokeBlack}
              interactive={isPlaying}
              dim={!isPlaying}
              lastMoveWasCapture={false}
            />

            {!isPlaying && (
              <div
                className='absolute inset-0 z-20 flex touch-none flex-col items-center justify-center rounded-well px-4'
                style={{ background: 'color-mix(in srgb, var(--scrim) 82%, transparent)' }}
                onPointerDown={(e) => { e.preventDefault(); handlePrimaryAction(); }}
              >
                {gameState === 'idle' && (
                  <>
                    <Zap size={48} className='mb-3 text-tickets-text' />
                    <h1 className='arcade-display mb-3 text-center text-2xl text-strong uppercase sm:text-3xl'>Blitz Tactics</h1>
                    <div className='mb-4 flex flex-wrap items-center justify-center gap-2'>
                      <span className='arcade-card-inset px-2.5 py-1 text-xs'>5 minutes</span>
                      <span className='arcade-card-inset px-2.5 py-1 text-xs'>Find the mate</span>
                      <span className='arcade-card-inset px-2.5 py-1 text-xs'>3 misses out</span>
                    </div>
                    <button
                      type='button'
                      className='blitz-cta'
                      disabled={isStartingSession}
                      onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); handlePrimaryAction(); }}
                    >
                      {isStartingSession ? 'Starting…' : 'Start'}
                    </button>
                    <p className='mt-3 max-w-xs text-center text-xs text-body sm:text-sm'>
                      {touchDevice
                        ? 'You play White. Tap a piece then its target to play the mating move. Solve as many as you can before the clock or three misses.'
                        : 'You play White. Click or drag the mating move. Solve as many as you can before the clock or three misses.'}
                    </p>
                  </>
                )}

                {gameState === 'gameover' && (
                  <div onPointerDown={(event) => event.stopPropagation()} className='flex max-h-full w-full justify-center'>
                    <ArcadeRunResult
                      title={runIsNewBest ? 'new best' : 'time'}
                      tone={runIsNewBest ? 'best' : 'neutral'}
                      stats={[
                        { label: 'solved', value: score, highlight: runIsNewBest },
                        { label: 'best', value: Math.max(highScore, score) },
                      ]}
                      reward={runReward}
                      achievements={runAchievements}
                      saving={isSubmitting}
                      error={submitError}
                      guest={isGuestRunRef.current}
                      actions={<ArcadeRematchButton onClick={handlePrimaryAction}>play again</ArcadeRematchButton>}
                    />
                  </div>
                )}

                {gameState === 'error' && (
                  <>
                    <h2 className='arcade-display mb-2 text-2xl text-danger-text uppercase sm:text-3xl'>Could not start</h2>
                    <p className='mb-4 text-center text-sm text-strong sm:text-base'>{startError ?? 'The game could not reach the server.'}</p>
                    {(banIndefinite || banUntilMs) && (
                      <p className='mb-2 text-center text-xs text-tickets-text sm:text-sm'>
                        {banIndefinite ? 'You are banned from games until an admin unbans you.' : `Ban time left: ${formatBanCountdown(banUntilMs!)}`}
                      </p>
                    )}
                    <button
                      type='button'
                      className='blitz-cta'
                      onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); handlePrimaryAction(); }}
                    >
                      Retry
                    </button>
                    <p className='mt-3 text-center text-xs text-body sm:text-sm'>Or tap anywhere / press Space</p>
                  </>
                )}
              </div>
            )}
          </div>
        </div>

        <div className='mt-2 flex flex-col items-center gap-3 sm:mt-4 sm:gap-4'>
          <div className='flex w-full flex-wrap items-center justify-center gap-2 pb-1 sm:gap-4'>
            <GameLeaderboardButton
              onClick={(e) => { e.stopPropagation(); setShowLeaderboard(true); }}
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
                onMouseDown={(event) => { event.preventDefault(); event.stopPropagation(); }}
                onTouchStart={(event) => { event.preventDefault(); event.stopPropagation(); }}
                onClick={(event) => { event.preventDefault(); event.stopPropagation(); setShowRewardsHint((prev) => !prev); }}
              >
                <CircleHelp size={18} />
              </ArcadeButton>
              <span
                className={`pointer-events-none absolute right-0 bottom-full z-20 mb-2 w-[calc(100vw-2rem)] max-w-sm arcade-card-inset px-3 py-2 text-left text-xs leading-relaxed text-body transition-opacity duration-150 sm:w-80 ${showRewardsHint ? 'opacity-100' : 'opacity-0 peer-hover:opacity-100 peer-focus:opacity-100'}`}
              >
                {REWARDS_HINT_TEXT}
              </span>
            </div>
          </div>
          <p className='max-w-md text-center text-xs text-faint'>
            {isPlaying && streak >= 2 ? `Streak ${streak} · ` : ''}
            {BLITZ_LADDER_LENGTH} puzzles deep · every position is a machine-verified forced mate.
          </p>
        </div>
      </div>

      <GameLeaderboardModal
        open={showLeaderboard}
        onOpenChange={setShowLeaderboard}
        title='Blitz Tactics board'
        description='Most puzzles solved in a five-minute rush, and your rank.'
      >
        <GameLeaderboard
          gameType='blitz-tactics'
          maxEntries={5}
          enableFullLeaderboardModal
          fullLeaderboardDisplay='inline'
          refreshKey={leaderboardRefreshKey}
        />
      </GameLeaderboardModal>
    </div>
  );
}
