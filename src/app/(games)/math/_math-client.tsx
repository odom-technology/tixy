'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { Calculator, CircleHelp, Delete, CornerDownLeft, Flame } from 'lucide-react';
import { ArcadeButton } from '@/features/arcade/components/ui/arcade-ui';
import { GameLeaderboard } from '@/features/arcade/components/game-leaderboard';
import { GameLeaderboardModal } from '@/features/arcade/components/game-leaderboard-modal';
import { GameLeaderboardButton } from '@/features/arcade/components/game-leaderboard-button';
import { PageHeader, GamesWalletCard } from '@/features/arcade/components/shell/page-header';
import { MuteButton } from '@/features/arcade/components/mute-button';
import { EnvMonitor } from '@/features/arcade/lib/game-anti-cheat';
import { usePreventGameGestures, useIsTouchDevice } from '@/features/arcade/lib/game-mobile-utils';
import { SoundManager } from '@/features/arcade/lib/sound-manager';
import {
  createGameFrameLoop,
  type GameFrameLoop,
} from '@/features/arcade/lib/game-frame-loop';
import { isNewBest } from '@/features/arcade/lib/new-best';
import { ArcadeRematchButton, ArcadeRunResult } from '@/features/arcade/components/results/arcade-run-result';
import { useArcadeRunResult } from '@/features/arcade/lib/run-result';
import {
  mathProblemFor,
  MATH_SPRINT_DURATION_SEC,
  MATH_MAX_ANSWERS,
  MATH_MIN_ANSWER_INTERVAL_MS,
  type MathProblem,
} from '@/server/arcade/math-sprint';

import {
  DEFAULT_MATH_THEME,
  buildMathTheme,
  mathThemeCssVars,
  type InventoryCosmeticResponse,
  type MathCosmeticTheme,
} from './_math-theme';

import './_math-midway.css';

const SPRINT_MS = MATH_SPRINT_DURATION_SEC * 1000;
const TICK_MS = 100; // countdown UI refresh cadence
const LOW_TIME_MS = 10_000; // bar turns red under 10s
// Hot-streak threshold for the enamel chip swapping to teal-prize.
const HOT_STREAK = 5;
// Blazing-streak threshold — chip swaps to danger-red enamel, ember seam paints
// along the readout's bottom edge.
const BLAZE_STREAK = 10;
// Max digits a player can enter (largest legit answer is 2-digit×2-digit < 10k).
const MAX_ENTRY_DIGITS = 6;

const REWARDS_HINT_TEXT =
  'Rewards hint: more correct answers in 60 seconds earns more tickets. Score = the number you solve correctly. Rewards taper at higher scores.';

// Distinct existing SoundManager names — a correct chime, a wrong thud, a key
// click, and a final whistle. (We never modify SoundManager.)
const SFX = {
  correct: 'coinCorrect',
  wrong: 'coinWrong',
  key: 'arcadeBet',
  start: 'arcadeReveal',
  over: 'arcadeLose',
} as const;

type GameState = 'idle' | 'playing' | 'gameover' | 'error';

type SubmittedAnswer = { index: number; value: number; t: number };

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

export default function MathClient() {
  const [gameState, setGameState] = useState<GameState>('idle');
  const [problem, setProblem] = useState<MathProblem | null>(null);
  const [entry, setEntry] = useState('');
  const [score, setScore] = useState(0);
  const [streak, setStreak] = useState(0);
  const [comboPulse, setComboPulse] = useState(0);
  const [readoutFeedback, setReadoutFeedback] = useState<'correct' | 'wrong' | null>(null);
  const [runIsNewBest, setRunIsNewBest] = useState(false);
  const [remainingMs, setRemainingMs] = useState(SPRINT_MS);
  const [highScore, setHighScore] = useState(0);
  const [pressedKey, setPressedKey] = useState<string | null>(null);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const [walletBalances, setWalletBalances] = useState({ credits: 0 });
  const [dailyCreditsProgress, setDailyCreditsProgress] = useState({ earned: 0, cap: 300 });
  const [mathTheme, setMathTheme] =
    useState<MathCosmeticTheme>(DEFAULT_MATH_THEME);
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

  const touchDevice = useIsTouchDevice();

  usePreventGameGestures(gameState === 'playing');

  // Mirrors for async closures (timers/handlers fire outside React state).
  const gameStateRef = useRef<GameState>('idle');
  const sessionTokenRef = useRef<string | null>(null);
  const seedRef = useRef<number | null>(null);
  const envMonitorRef = useRef(new EnvMonitor());
  const isStartingRef = useRef(false);
  const isGuestRunRef = useRef(false);

  const startPerfRef = useRef(0); // performance.now() when the sprint began
  const indexRef = useRef(0); // next problem index to render
  const entryRef = useRef('');
  const scoreRef = useRef(0);
  const streakRef = useRef(0);
  const answersRef = useRef<SubmittedAnswer[]>([]);
  // Client clock (ms since first problem) of the last answer we COUNTED toward
  // the score — mirrors the server's cadence anchor in validateMathRun so the
  // client never counts an answer the server will drop. `null` until the first.
  const lastCountedTRef = useRef<number | null>(null);
  const tickLoopRef = useRef<GameFrameLoop | null>(null);
  const lastCountdownPaintRef = useRef(0);
  const feedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveScoreRef = useRef<((score: number, answers: SubmittedAnswer[], durMs: number) => Promise<void>) | null>(null);
  const endRunRef = useRef<(() => void) | null>(null);

  const clearTimers = useCallback(() => {
    tickLoopRef.current?.stop();
    lastCountdownPaintRef.current = 0;
    if (feedbackTimerRef.current) {
      clearTimeout(feedbackTimerRef.current);
      feedbackTimerRef.current = null;
    }
  }, []);

  const fetchUserBestScore = useCallback(async () => {
    if (bestScoreCacheRef.current !== null) {
      setHighScore(bestScoreCacheRef.current);
      return;
    }
    try {
      const response = await fetch('/api/games/math/score', { cache: 'no-store' });
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
      const response = await fetch('/api/store/inventory?gameType=math', {
        cache: 'no-store',
      });
      if (!response.ok) return;
      const payload = (await response.json()) as InventoryCosmeticResponse;
      setWalletBalances({ credits: payload.wallet?.credits ?? 0 });
      setDailyCreditsProgress({
        earned: payload.dailyGameCredits?.earned ?? 0,
        cap: payload.dailyGameCredits?.cap ?? 300,
      });
      setMathTheme(buildMathTheme(payload));
    } catch {
      /* wallet is best-effort */
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
    answers: SubmittedAnswer[],
    durationMs: number,
  ) => {
    if (isGuestRunRef.current) {
      return;
    }
    if (!sessionTokenRef.current) return;

    envMonitorRef.current.stop();
    setSubmitError(null);
    setIsSubmitting(true);
    try {
      const response = await fetch('/api/games/math/score', {
        method: 'POST',
        keepalive: true,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          score: finalScore,
          sessionToken: sessionTokenRef.current,
          answers,
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
        console.error(`[Math] Score rejected (${response.status}): ${reason}`);
        setSubmitError(getSubmitErrorMessage(response.status, errData));
        return;
      }

      captureRunResult(data);

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
    const durationMs = performance.now() - startPerfRef.current;
    gameStateRef.current = 'gameover';
    setGameState('gameover');
    setRemainingMs(0);
    setProblem(null);
    SoundManager.play(SFX.over);
    // "New best" is judged against the best we knew BEFORE this run, so the
    // game-over card can celebrate the beat instead of comparing score to itself.
    const prevBest = Math.max(highScore, bestScoreCacheRef.current ?? 0);
    const wasBest = isNewBest(scoreRef.current, prevBest);
    setRunIsNewBest(wasBest);
    if (wasBest) bestScoreCacheRef.current = scoreRef.current;
    if (scoreRef.current > highScore) setHighScore(scoreRef.current);
    saveScoreRef.current?.(scoreRef.current, answersRef.current.slice(), durationMs);
  }, [clearTimers, highScore]);
  endRunRef.current = endRun;

  // Advance to the next problem (deterministic from the seed).
  const showProblem = useCallback((index: number) => {
    const seed = seedRef.current;
    if (seed === null) return;
    indexRef.current = index;
    setProblem(mathProblemFor(seed, index));
    entryRef.current = '';
    setEntry('');
  }, []);

  const flashReadout = useCallback((kind: 'correct' | 'wrong') => {
    setReadoutFeedback(kind);
    if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current);
    feedbackTimerRef.current = setTimeout(() => setReadoutFeedback(null), 340);
  }, []);

  // Submit the current entry as the answer to the current problem.
  const submitEntry = useCallback(() => {
    if (gameStateRef.current !== 'playing') return;
    const raw = entryRef.current;
    if (raw.length === 0) return;
    const seed = seedRef.current;
    if (seed === null) return;

    const value = parseInt(raw, 10);
    const index = indexRef.current;
    const t = Math.max(0, Math.floor(performance.now() - startPerfRef.current));

    // Cap stored answers defensively so a pathological run can't balloon memory;
    // the server caps scoring at MATH_MAX_ANSWERS anyway.
    if (answersRef.current.length < MATH_MAX_ANSWERS * 2) {
      answersRef.current.push({ index, value, t });
    }

    // Mirror the server's cadence floor (validateMathRun): an answer landing
    // < MATH_MIN_ANSWER_INTERVAL_MS after the previous COUNTED answer is dropped
    // server-side. We must not count it here either, or the displayed/submitted
    // score would exceed the authoritative count and the whole run would be
    // rejected on mismatch. A too-fast answer is a no-op for scoring but still
    // advances the sprint — exactly what the server does (it updates its cadence
    // anchor only on counted answers, correct or wrong).
    const last = lastCountedTRef.current;
    if (last !== null && t - last < MATH_MIN_ANSWER_INTERVAL_MS) {
      SoundManager.play(SFX.key);
      showProblem(index + 1);
      return;
    }
    lastCountedTRef.current = t;

    const correctAnswer = mathProblemFor(seed, index).answer;
    if (Number.isFinite(value) && value === correctAnswer) {
      scoreRef.current += 1;
      setScore(scoreRef.current);
      streakRef.current += 1;
      setStreak(streakRef.current);
      setComboPulse((p) => p + 1);
      SoundManager.play(SFX.correct);
      flashReadout('correct');
    } else {
      streakRef.current = 0;
      setStreak(0);
      SoundManager.play(SFX.wrong);
      flashReadout('wrong');
    }

    // Always advance — even a wrong answer moves to the next problem (sprint).
    showProblem(index + 1);
  }, [flashReadout, showProblem]);

  const appendDigit = useCallback((digit: string) => {
    if (gameStateRef.current !== 'playing') return;
    if (entryRef.current.length >= MAX_ENTRY_DIGITS) return;
    // Avoid a leading zero turning into "007".
    if (entryRef.current === '0') entryRef.current = '';
    entryRef.current += digit;
    setEntry(entryRef.current);
    SoundManager.play(SFX.key);
  }, []);

  /** Delete the last digit (calculator backspace). */
  const backspaceEntry = useCallback(() => {
    if (gameStateRef.current !== 'playing') return;
    if (entryRef.current.length === 0) return;
    entryRef.current = entryRef.current.slice(0, -1);
    setEntry(entryRef.current);
    SoundManager.play(SFX.key);
  }, []);

  /** Wipe the whole entry (Escape). */
  const clearEntry = useCallback(() => {
    if (gameStateRef.current !== 'playing') return;
    if (entryRef.current.length === 0) return;
    entryRef.current = '';
    setEntry('');
    SoundManager.play(SFX.key);
  }, []);

  const pressKeyVisual = useCallback((key: string) => {
    setPressedKey(key);
    window.setTimeout(
      () => setPressedKey((cur) => (cur === key ? null : cur)),
      90,
    );
  }, []);

  const handleKeypadPress = useCallback(
    (key: string) => {
      pressKeyVisual(key);
      if (key === 'clear') {
        backspaceEntry();
      } else if (key === 'clear-all') {
        clearEntry();
      } else if (key === 'enter') {
        submitEntry();
      } else {
        appendDigit(key);
      }
    },
    [appendDigit, backspaceEntry, clearEntry, pressKeyVisual, submitEntry],
  );

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
        body: JSON.stringify({ gameType: 'math' }),
      });
      if (sessionResponse.ok) {
        setBanIndefinite(false);
        setBanUntilMs(null);
        const sessionData = await sessionResponse.json();
        sessionTokenRef.current = sessionData.token;
        seedRef.current =
          typeof sessionData.mathSeed === 'number' ? sessionData.mathSeed : null;
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

    // Reset run state.
    indexRef.current = 0;
    entryRef.current = '';
    scoreRef.current = 0;
    streakRef.current = 0;
    answersRef.current = [];
    lastCountedTRef.current = null;
    setScore(0);
    setStreak(0);
    setComboPulse(0);
    setRunIsNewBest(false);
    setEntry('');
    setReadoutFeedback(null);
    setRemainingMs(SPRINT_MS);
    startPerfRef.current = performance.now();
    gameStateRef.current = 'playing';
    setGameState('playing');
    SoundManager.play(SFX.start);
    showProblem(0);

    // The shared runtime owns countdown scheduling and fully parks while the
    // document is hidden. The displayed value is still derived from the same
    // wall clock used for answer timestamps, so resume cannot extend the run.
    tickLoopRef.current?.start();
  }, [clearTimers, resetRunResult, showProblem]);

  const handlePrimaryAction = useCallback(() => {
    const current = gameStateRef.current;
    if (current === 'idle' || current === 'gameover' || current === 'error') {
      startGame();
    }
  }, [startGame]);

  // Physical keyboard: digits during play, Enter/Backspace, Space/Enter to
  // start or restart from overlays.
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.repeat) return;
      if (gameStateRef.current === 'playing') {
        if (e.key >= '0' && e.key <= '9') {
          e.preventDefault();
          handleKeypadPress(e.key);
          return;
        }
        if (e.key === 'Enter' || e.key === '=') {
          e.preventDefault();
          handleKeypadPress('enter');
          return;
        }
        if (e.key === 'Backspace' || e.key === 'Delete') {
          e.preventDefault();
          handleKeypadPress('clear'); // one digit, like a calculator
          return;
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          handleKeypadPress('clear-all');
          return;
        }
        return;
      }
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        handlePrimaryAction();
      }
    },
    [handleKeypadPress, handlePrimaryAction],
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  useEffect(() => {
    const loop = createGameFrameLoop({
      simulate: () => {},
      render: (_alpha, frame) => {
        if (gameStateRef.current !== 'playing') {
          loop.stop();
          return;
        }
        const elapsed = frame.nowMs - startPerfRef.current;
        const left = SPRINT_MS - elapsed;
        if (left <= 0) {
          setRemainingMs(0);
          endRunRef.current?.();
          return;
        }
        if (
          lastCountdownPaintRef.current === 0 ||
          frame.nowMs - lastCountdownPaintRef.current >= TICK_MS
        ) {
          lastCountdownPaintRef.current = frame.nowMs;
          setRemainingMs(left);
        }
      },
    });
    tickLoopRef.current = loop;
    return () => {
      loop.destroy();
      if (tickLoopRef.current === loop) tickLoopRef.current = null;
    };
  }, []);

  useEffect(() => {
    const monitor = envMonitorRef.current;
    return () => {
      clearTimers();
      monitor.stop();
    };
  }, [clearTimers]);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setPrefersReducedMotion(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);

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
    if (!banUntilMs) return;
    let timer: number | null = null;
    const schedule = () => {
      if (document.hidden || timer !== null) return;
      timer = window.setTimeout(() => {
        timer = null;
        setBanNowMs(Date.now());
        schedule();
      }, 1000);
    };
    const onVisibilityChange = () => {
      if (document.hidden) {
        if (timer !== null) window.clearTimeout(timer);
        timer = null;
        return;
      }
      setBanNowMs(Date.now());
      schedule();
    };
    setBanNowMs(Date.now());
    schedule();
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      if (timer !== null) window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [banUntilMs]);

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
  const hotStreak = streak >= HOT_STREAK;
  // Escalating streak presentation: warm amber chip → hot teal chip w/ flame →
  // blazing red enamel + an ember seam painted along the readout's bottom edge.
  const streakTier =
    streak >= BLAZE_STREAK
      ? 'blaze'
      : streak >= HOT_STREAK
        ? 'hot'
        : streak >= 2
          ? 'warm'
          : null;
  const readoutHeat = isPlaying && (streakTier === 'hot' || streakTier === 'blaze')
    ? streakTier
    : undefined;

  // Keypad layout: 1-9, then [clear, 0, enter]. Element-factory for the action
  // glyphs (no `const C = MAP[x]; <C/>` — lint forbids that in render).
  const keypadDigits = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];
  const renderActionGlyph = (action: 'clear' | 'enter') => {
    if (action === 'clear') return <Delete aria-hidden size={26} />;
    return <CornerDownLeft aria-hidden size={26} />;
  };

  return (
    <div
      className='math-midway arc-game-flow'
      style={mathThemeCssVars(mathTheme)}
    >
      <div className='w-full space-y-3 sm:space-y-4'>
        <div className='mx-auto w-full max-w-4xl'>
          <div className='hidden sm:block'>
            <PageHeader
              eyebrow='Arcade'
              icon={<Calculator aria-hidden className='h-6 w-6' />}
              title='Mental Math Sprint'
              subtitle='Solve as many problems as you can in 60 seconds. Difficulty ramps as you go.'
              wallet={walletCard}
            />
          </div>
          <div className='sm:hidden'>
            <GamesWalletCard wallet={walletCard} compact />
          </div>
        </div>

        <div className='math-stats mx-auto w-full max-w-md px-1'>
          <span className='math-stat'>
            <span className='math-stat-label'>Score</span>
            <span className='math-stat-value arcade-num'>{score}</span>
          </span>
          <span
            className='math-stat'
            data-low={isPlaying && lowTime ? 'true' : undefined}
          >
            <span className='math-stat-label'>Time</span>
            <span className='math-stat-value arcade-num'>
              {isPlaying || gameState === 'gameover'
                ? `${secondsLeft}s`
                : `${MATH_SPRINT_DURATION_SEC}s`}
            </span>
          </span>
          <span className='math-stat'>
            <span className='math-stat-label'>Best</span>
            <span className='math-stat-value arcade-num'>{highScore}</span>
          </span>
        </div>

        <div className='relative flex w-full justify-center'>
          <div className='math-stage relative w-full'>
            <div
              className='math-readout'
              data-feedback={readoutFeedback ?? undefined}
              data-heat={readoutHeat}
            >
              {/* Ambient painted math glyphs + streak ember seam (static, no loops) */}
              <div className='math-decor' aria-hidden>
                <span className='math-decor-glyph math-decor-glyph-a'>×</span>
                <span className='math-decor-glyph math-decor-glyph-b'>+</span>
                <span className='math-decor-glyph math-decor-glyph-c'>−</span>
              </div>

              {/* Countdown bar */}
              <div className='math-timebar' aria-hidden>
                <div
                  className='math-timebar-fill'
                  data-low={isPlaying && lowTime ? 'true' : undefined}
                  style={{ width: `${timePct}%` }}
                />
              </div>

              {/* Combo / streak enamel chip — brightness pulse, no glow */}
              {isPlaying && streak >= 2 && (
                <span
                  key={`combo-${comboPulse}`}
                  className='math-combo'
                  data-pulse={prefersReducedMotion ? undefined : 'true'}
                  data-hot={hotStreak ? 'true' : undefined}
                  data-tier={streakTier ?? undefined}
                  aria-label={`Streak ${streak}`}
                >
                  {hotStreak ? <Flame aria-hidden size={13} /> : null}
                  {streak}
                </span>
              )}

              {/* Per-answer score float — remounts (re-runs) on every correct */}
              {isPlaying && comboPulse > 0 && (
                <span key={`float-${comboPulse}`} className='math-float' aria-hidden>
                  +1
                </span>
              )}

              <span className='math-readout-label'>
                {isPlaying ? 'Solve' : 'Mental Math Sprint'}
              </span>
              <div className='math-problem' aria-live='polite'>
                {problem ? (
                  <span key={problem.index} className='math-problem-line'>
                    <span className='math-operand'>{problem.a}</span>
                    <span className='math-op' data-op={problem.op}>
                      {problem.prompt.split(' ')[1]}
                    </span>
                    <span className='math-operand'>{problem.b}</span>
                    <span className='math-equals'>=</span>
                  </span>
                ) : (
                  '— —'
                )}
              </div>
              <div
                className='math-entry'
                data-empty={entry.length === 0 ? 'true' : undefined}
                aria-label='Your answer'
              >
                {entry.split('').map((digit, i) => (
                  <span key={i} className='math-entry-digit'>
                    {digit}
                  </span>
                ))}
                {isPlaying && <span className='math-caret' aria-hidden />}
              </div>
            </div>

            {/* Numeric keypad */}
            <div
              className='math-keypad'
              data-disabled={!isPlaying || undefined}
              data-armed={isPlaying && entry.length > 0 ? 'true' : undefined}
              aria-label='Numeric keypad'
            >
              {keypadDigits.map((digit) => (
                <button
                  key={digit}
                  type='button'
                  className='math-key'
                  data-pressed={pressedKey === digit ? 'true' : undefined}
                  aria-label={digit}
                  disabled={!isPlaying}
                  onPointerDown={(e) => {
                    if (e.pointerType === 'mouse' && e.button !== 0) return;
                    e.preventDefault();
                    handleKeypadPress(digit);
                  }}
                >
                  {digit}
                </button>
              ))}
              <button
                type='button'
                className='math-key'
                data-action='clear'
                data-pressed={
                  pressedKey === 'clear' || pressedKey === 'clear-all'
                    ? 'true'
                    : undefined
                }
                aria-label='Backspace'
                disabled={!isPlaying}
                onPointerDown={(e) => {
                  if (e.pointerType === 'mouse' && e.button !== 0) return;
                  e.preventDefault();
                  handleKeypadPress('clear');
                }}
              >
                {renderActionGlyph('clear')}
              </button>
              <button
                type='button'
                className='math-key'
                data-pressed={pressedKey === '0' ? 'true' : undefined}
                aria-label='0'
                disabled={!isPlaying}
                onPointerDown={(e) => {
                  if (e.pointerType === 'mouse' && e.button !== 0) return;
                  e.preventDefault();
                  handleKeypadPress('0');
                }}
              >
                0
              </button>
              <button
                type='button'
                className='math-key'
                data-action='enter'
                data-pressed={pressedKey === 'enter' ? 'true' : undefined}
                aria-label='Enter'
                disabled={!isPlaying}
                onPointerDown={(e) => {
                  if (e.pointerType === 'mouse' && e.button !== 0) return;
                  e.preventDefault();
                  handleKeypadPress('enter');
                }}
              >
                {renderActionGlyph('enter')}
              </button>
            </div>

            {/* Overlay for idle / gameover / error */}
            {!isPlaying && (
              <div
                className='math-overlay absolute inset-0 flex touch-none flex-col items-center justify-center rounded-well px-4'
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
                    <Calculator size={48} className='mb-3 text-tickets-text' />
                    <h1 className='arcade-display mb-3 text-center text-2xl text-strong uppercase sm:text-3xl'>
                      Mental Math Sprint
                    </h1>
                    <div className='math-overlay-chips' aria-hidden>
                      <span className='math-chip'>60 seconds</span>
                      <span className='math-chip'>+ − ×</span>
                      <span className='math-chip'>Ramps up</span>
                    </div>
                    <button
                      type='button'
                      className='math-cta'
                      disabled={isStartingSession}
                      onPointerDown={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        handlePrimaryAction();
                      }}
                    >
                      {isStartingSession ? 'Starting…' : 'Start'}
                    </button>
                    <p className='mt-3 max-w-xs text-center text-xs text-body sm:text-sm'>
                      {touchDevice
                        ? 'Tap the keypad, hit enter, next problem. Solve as many as you can before the clock runs out.'
                        : 'Press Space to start. Type each answer and hit enter — solve as many as you can before the clock runs out.'}
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
                    <h2 className='arcade-display mb-2 text-2xl text-danger-text uppercase sm:text-3xl'>
                      Could not start
                    </h2>
                    <p className='mb-4 text-center text-sm text-strong sm:text-base'>
                      {startError ?? 'The game could not reach the server.'}
                    </p>
                    {(banIndefinite || banUntilMs) && (
                      <p className='mb-2 text-center text-xs text-tickets-text sm:text-sm'>
                        {banIndefinite
                          ? 'You are banned from games until an admin unbans you.'
                          : `Ban time left: ${formatBanCountdown(banUntilMs!)}`}
                      </p>
                    )}
                    <button
                      type='button'
                      className='math-cta'
                      onPointerDown={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        handlePrimaryAction();
                      }}
                    >
                      Retry
                    </button>
                    <p className='mt-3 text-center text-xs text-body sm:text-sm'>
                      Or tap anywhere / press Space
                    </p>
                  </>
                )}
              </div>
            )}
          </div>
        </div>

        <div className='mt-2 flex flex-col items-center gap-3 sm:mt-4 sm:gap-4'>
          <div className='flex w-full flex-wrap items-center justify-center gap-2 pb-1 sm:gap-4'>
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
      </div>

      <GameLeaderboardModal
        open={showLeaderboard}
        onOpenChange={setShowLeaderboard}
        title='Mental Math Sprint board'
        description='Most problems solved in 60 seconds, and your rank.'
      >
        <GameLeaderboard
          gameType='math'
          maxEntries={5}
          enableFullLeaderboardModal
          fullLeaderboardDisplay='inline'
          refreshKey={leaderboardRefreshKey}
        />
      </GameLeaderboardModal>
    </div>
  );
}
