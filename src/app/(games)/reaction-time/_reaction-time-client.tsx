'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import type { CSSProperties } from 'react';
import {
  RotateCcw,
  Trophy,
  Clock,
  Target,
  AlertCircle,
  CircleHelp,
} from 'lucide-react';
import { ArcadeButton, ArcadePanel } from '@/features/arcade/components/ui/arcade-ui';
import { GameLeaderboard } from '@/features/arcade/components/game-leaderboard';
import { PageHeader, GamesWalletCard } from '@/features/arcade/components/shell/page-header';
import { GameInventoryModal } from '@/features/arcade/components/game-inventory-modal';
import { GameLeaderboardModal } from '@/features/arcade/components/game-leaderboard-modal';
import { GameInventoryButton } from '@/features/arcade/components/game-inventory-button';
import { GameLeaderboardButton } from '@/features/arcade/components/game-leaderboard-button';
import { GamesRouteSwitcher } from '@/features/arcade/components/games-route-switcher';
import { useGameLeaderboard } from '@/features/arcade/components/use-game-leaderboard';
import { EnvMonitor } from '@/features/arcade/lib/game-anti-cheat';
import { connectGameWs, type GameWsHandle } from '@/features/arcade/lib/game-ws';
import { usePreventGameGestures, useIsTouchDevice, getReactionTier } from '@/features/arcade/lib/game-mobile-utils';
import { playHaptic } from '@/features/arcade/lib/game-haptics';
import { ArcadeRunRewards } from '@/features/arcade/components/results/arcade-run-result';
import { MuteButton } from '@/features/arcade/components/mute-button';
import { SoundManager } from '@/features/arcade/lib/sound-manager';
import {
  createGameFrameLoop,
  type GameFrameLoop,
} from '@/features/arcade/lib/game-frame-loop';
import { useArcadeRunResult } from '@/features/arcade/lib/run-result';
import { ReactionTimelineChart } from './_reaction-time-chart';
import {
  type ReactionTimeCosmeticTheme,
  type InventoryCosmeticResponse,
  DEFAULT_REACTION_THEME,
  buildReactionTimeTheme,
} from './_reaction-time-theme';
import {
  MIN_DELAY,
  NEXT_ROUND_DELAY_MS,
  TRIALS,
  INPUT_LOCK_MS,
  REWARDS_HINT_TEXT,
  roundToHundredth,
  formatMs,
  normalizeEventTimestamp,
  computeReactionRunStats,
  getSubmitErrorMessage,
  isRetryableTranscriptError,
  type SubmitResponseData,
} from './_reaction-time-helpers';

const REWARDS_HINT_TRIGGER_SELECTOR = '[data-rewards-hint-trigger]';
type ServerVerifiedRun = {
  averageTime: number;
  bestTime: number;
  worstTime: number;
  range: number;
  score: number;
  attempts: number;
};

type CurrentAccountResponse = {
  account?: {
    id?: string;
  };
};

// Session storage helpers that survive React re-renders
const SESSION_STORAGE_KEY = 'reaction-time-session';
const getSessionData = () => {
  try {
    const data = sessionStorage.getItem(SESSION_STORAGE_KEY);
    return data
      ? JSON.parse(data)
      : { sessionId: null, sessionToken: null };
  } catch {
    return { sessionId: null, sessionToken: null };
  }
};
const setSessionData = (
  sessionId: string | null,
  sessionToken: string | null,
) => {
  try {
    sessionStorage.setItem(
      SESSION_STORAGE_KEY,
      JSON.stringify({ sessionId, sessionToken }),
    );
  } catch (error) {
    console.error('Failed to store session data:', error);
  }
};
const clearSessionData = () => {
  try {
    sessionStorage.removeItem(SESSION_STORAGE_KEY);
  } catch (error) {
    console.error('Failed to clear session data:', error);
  }
};

export default function ReactionTimePage() {
  const touchDevice = useIsTouchDevice();
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [gameState, setGameState] = useState<
    'waiting' | 'ready' | 'click' | 'too_early' | 'result' | 'error'
  >('waiting');
  const [reactionTime, setReactionTime] = useState<number | null>(null);
  const [results, setResults] = useState<number[]>([]);
  const [attempts, setAttempts] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const {
    reward: runReward,
    achievements: runAchievements,
    capture: captureRunResult,
    reset: resetRunResult,
  } = useArcadeRunResult();
  const [startError, setStartError] = useState<string | null>(null);
  const [isStartingSession, setIsStartingSession] = useState(false);
  const [banUntilMs, setBanUntilMs] = useState<number | null>(null);
  const [banIndefinite, setBanIndefinite] = useState(false);
  const [banNowMs, setBanNowMs] = useState(Date.now());
  const [serverVerifiedRun, setServerVerifiedRun] =
    useState<ServerVerifiedRun | null>(null);
  const [leaderboardRefreshKey, setLeaderboardRefreshKey] = useState(0);
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const [showInventory, setShowInventory] = useState(false);
  const [reactionTheme, setReactionTheme] =
    useState<ReactionTimeCosmeticTheme>(DEFAULT_REACTION_THEME);
  const [walletBalances, setWalletBalances] = useState({ credits: 0 });
  const [dailyCreditsProgress, setDailyCreditsProgress] = useState({
    earned: 0,
    cap: 300,
  });
  const [prefireWarning, setPrefireWarning] = useState(false);
  const [nextRoundCountdown, setNextRoundCountdown] = useState<number | null>(
    null,
  );
  const [personalBestMs, setPersonalBestMs] = useState<number | null>(null);
  const [showPbConfetti, setShowPbConfetti] = useState(false);
  const [showRewardsHint, setShowRewardsHint] = useState(false);
  // Presentation-only juice: a "go" pop when the panel flips green, a jittered
  // shake on a prefire, and a radial spark burst on a valid smack. None of these
  // touch the /ws round wiring — they only observe gameState.
  const [goPulse, setGoPulse] = useState(false);
  const [failShake, setFailShake] = useState(false);
  const [hitBurst, setHitBurst] = useState<number | null>(null);
  // Expanding reveal ring the instant the panel flips green (render-only).
  const [goRing, setGoRing] = useState<number | null>(null);
  const prefersReducedMotionRef = useRef(false);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    prefersReducedMotionRef.current = mq.matches;
    const onChange = () => { prefersReducedMotionRef.current = mq.matches; };
    mq.addEventListener?.('change', onChange);
    return () => mq.removeEventListener?.('change', onChange);
  }, []);

  // Sound + haptics + juice observer. Reacts to gameState transitions only —
  // the actual round/click event contract (rt_ready / rt_click over the WS
  // channel) is untouched. Cues reuse existing SoundManager entries; haptics
  // use the shared game-haptics cues (silent no-ops where unsupported).
  useEffect(() => {
    if (gameState === 'ready') {
      SoundManager.play('arcadeReelTick', { volume: 0.4 });
      playHaptic('light');
    } else if (gameState === 'click') {
      SoundManager.play('coinCorrect', { volume: 0.6 });
      playHaptic('medium');
      setGoPulse(true);
      if (!prefersReducedMotionRef.current) setGoRing(Date.now());
      const t = window.setTimeout(() => setGoPulse(false), 380);
      return () => window.clearTimeout(t);
    } else if (gameState === 'too_early') {
      SoundManager.play('foul', { volume: 0.6 });
      playHaptic('failure');
      setFailShake(true);
      const t = window.setTimeout(() => setFailShake(false), 500);
      return () => window.clearTimeout(t);
    } else if (gameState === 'result') {
      const rt = reactionTime ?? 300;
      // faster smack → brighter chime (reuse stackPerfect's pitch ladder)
      const pitch = Math.min(1.9, Math.max(0.72, 470 / (rt + 130)));
      SoundManager.play('stackPerfect', { volume: 0.5, pitch });
      playHaptic('success');
      if (!prefersReducedMotionRef.current) setHitBurst(Date.now());
      if (attemptsRef.current >= TRIALS) {
        const t = window.setTimeout(
          () => SoundManager.play('arcadeWin', { volume: 0.55 }),
          260,
        );
        return () => window.clearTimeout(t);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameState]);

  useEffect(() => {
    if (goRing === null) return;
    const t = window.setTimeout(() => setGoRing(null), 560);
    return () => window.clearTimeout(t);
  }, [goRing]);

  useEffect(() => {
    if (hitBurst === null) return;
    const t = window.setTimeout(() => setHitBurst(null), 620);
    return () => window.clearTimeout(t);
  }, [hitBurst]);

  // Block pull-to-refresh, scroll bounce, pinch zoom during active gameplay
  const isGameActive = gameState === 'ready' || gameState === 'click' || gameState === 'too_early';
  usePreventGameGestures(isGameActive);

  const { leaderboard: liveReactionLeaderboard } = useGameLeaderboard({
    gameType: 'reaction-time',
    refreshKey: leaderboardRefreshKey,
  });

  const togglePanelWithoutScrollJump = useCallback(
    (setOpen: (updater: (prev: boolean) => boolean) => void) => {
      const previousScrollY = window.scrollY;
      setOpen((prev) => {
        const next = !prev;
        if (next) {
          requestAnimationFrame(() => {
            window.scrollTo({ top: previousScrollY, left: 0, behavior: 'auto' });
          });
        }
        return next;
      });
    },
    [],
  );

  const gameStateRef = useRef(gameState);
  const startTimeRef = useRef<number>(0);
  const gameSurfaceRef = useRef<HTMLDivElement | null>(null);
  const canClickRef = useRef(true);
  const consecutivePrefiresRef = useRef(0);
  const attemptsRef = useRef(attempts);
  const resultsRef = useRef<number[]>(results);
  const inputLockUntilRef = useRef(0);
  const personalBestRef = useRef<number | null>(null);
  const sessionTokenRef = useRef<string | null>(null);
  const envMonitorRef = useRef(new EnvMonitor());
  const wsRef = useRef<GameWsHandle | null>(null);
  const activeRoundIdRef = useRef<string | null>(null);
  const pendingGreenRef = useRef<{ roundId: string } | null>(null);
  const schedulingLoopRef = useRef<GameFrameLoop | null>(null);
  const guestRoundTimerRef = useRef<number | null>(null);
  const gameplayTimersRef = useRef<Set<number>>(new Set());
  const autoContinueRef = useRef(false);
  const initialEnvFingerprintRef = useRef<unknown>(null);
  const isGuestRunRef = useRef(false);

  const formatBanCountdown = (targetMs: number) => {
    const totalSeconds = Math.max(0, Math.floor((targetMs - banNowMs) / 1000));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return `${hours.toString().padStart(2, '0')}:${minutes
      .toString()
      .padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  };

  useEffect(() => {
    gameStateRef.current = gameState;
  }, [gameState]);

  useEffect(() => {
    attemptsRef.current = attempts;
  }, [attempts]);

  useEffect(() => {
    resultsRef.current = results;
  }, [results]);

  useEffect(() => {
    if (gameState !== 'waiting') {
      setShowRewardsHint(false);
    }
  }, [gameState]);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const response = await fetch('/api/account/me', { cache: 'no-store' });
        if (!response.ok) return;
        const payload = (await response.json()) as CurrentAccountResponse;
        const userId = payload.account?.id;
        if (!cancelled && typeof userId === 'string') {
          setCurrentUserId(userId);
        }
      } catch {
        // Guest play keeps using local personal-best storage.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    personalBestRef.current = personalBestMs;
  }, [personalBestMs]);

  const clearGuestRoundTimer = useCallback(() => {
    if (guestRoundTimerRef.current === null) return;
    window.clearTimeout(guestRoundTimerRef.current);
    guestRoundTimerRef.current = null;
  }, []);

  const clearGameplayTimers = useCallback(() => {
    for (const timer of gameplayTimersRef.current) {
      window.clearTimeout(timer);
    }
    gameplayTimersRef.current.clear();
  }, []);

  const scheduleGameplayTimeout = useCallback(
    (callback: () => void, delayMs: number) => {
      const timer = window.setTimeout(() => {
        gameplayTimersRef.current.delete(timer);
        if (!document.hidden) callback();
      }, delayMs);
      gameplayTimersRef.current.add(timer);
      return timer;
    },
    [],
  );

  const initializeGame = useCallback(async () => {
    setIsStartingSession(true);
    isGuestRunRef.current = false;
    try {
      setStartError(null);
      const response = await fetch('/api/games/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gameType: 'reaction-time' }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => null);
        if (response.status === 401) {
          // Guest/logged-out visitor — allow a local practice run
          isGuestRunRef.current = true;
          sessionTokenRef.current = null;
          wsRef.current = null;
          setBanIndefinite(false);
          setBanUntilMs(null);
          return true;
        }
        if (response.status === 403) {
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
        setStartError(getSubmitErrorMessage(response.status, data));
        setGameState('error');
        return false;
      }
      setBanIndefinite(false);
      setBanUntilMs(null);

      const data = await response.json();
      const sessionToken = data.token; // Use 'token' not 'sessionToken'
      const sessionId = data.sessionId;

      // Store in sessionStorage (survives React re-renders)
      setSessionData(sessionId, sessionToken);

      // Also keep refs for compatibility
      sessionTokenRef.current = sessionToken;

      try {
        wsRef.current?.close();
        wsRef.current = await connectGameWs(sessionToken);
        wsRef.current.onDisconnect((reason) => {
          console.error('Reaction Time socket disconnected:', reason);
          autoContinueRef.current = false;
          canClickRef.current = true;
          setGameState('error');
        });
        wsRef.current.onMessage((msg) => {
          if (msg.type === 'rt_green') {
            if (document.hidden || gameStateRef.current !== 'ready') {
              return;
            }
            pendingGreenRef.current = { roundId: msg.roundId };
          }
        });
      } catch (error) {
        console.error('Failed to connect realtime channel:', error);
        setGameState('error');
        return false;
      }

      envMonitorRef.current.start();

      // Capture initial environment fingerprint for consistency validation
      initialEnvFingerprintRef.current = envMonitorRef.current.getFingerprint();

      return true;
    } catch (error) {
      console.error('Failed to initialize game:', error);
      setGameState('error');
      return false;
    } finally {
      setIsStartingSession(false);
    }
  }, [envMonitorRef, sessionTokenRef, setGameState]);

  const loadReactionTheme = useCallback(async () => {
    try {
      const response = await fetch('/api/store/inventory?gameType=reaction-time', {
        cache: 'no-store',
      });
      if (!response.ok) {
        setWalletBalances({ credits: 0 });
        setDailyCreditsProgress({ earned: 0, cap: 300 });
        setReactionTheme(DEFAULT_REACTION_THEME);
        return;
      }
      const payload = (await response.json()) as InventoryCosmeticResponse;
      setWalletBalances({
        credits: payload.wallet?.credits ?? 0,
      });
      setDailyCreditsProgress({
        earned: payload.dailyGameCredits?.earned ?? 0,
        cap: payload.dailyGameCredits?.cap ?? 300,
      });
      setReactionTheme(buildReactionTimeTheme(payload));
    } catch {
      setWalletBalances({ credits: 0 });
      setDailyCreditsProgress({ earned: 0, cap: 300 });
      setReactionTheme(DEFAULT_REACTION_THEME);
    }
  }, []);

  const resetGame = useCallback(() => {
    wsRef.current?.close();
    clearGuestRoundTimer();
    clearGameplayTimers();

    // Clear sessionStorage
    clearSessionData();

    gameStateRef.current = 'waiting';
    setGameState('waiting');
    setReactionTime(null);
    setResults([]);
    setAttempts(0);
    setSubmitError(null);
    resetRunResult();
    setServerVerifiedRun(null);
    setNextRoundCountdown(null);
    canClickRef.current = true;
    consecutivePrefiresRef.current = 0;
    inputLockUntilRef.current = 0;
    sessionTokenRef.current = null;
    wsRef.current = null;
    isGuestRunRef.current = false;
    autoContinueRef.current = false;
    initialEnvFingerprintRef.current = null;
    activeRoundIdRef.current = null;
    pendingGreenRef.current = null;

    envMonitorRef.current.stop();
  }, [clearGuestRoundTimer, clearGameplayTimers, resetRunResult]);

  const startGame = useCallback(async () => {
    if (!canClickRef.current) return;
    canClickRef.current = false;
    clearGuestRoundTimer();

    // Reset if game is completed
    if (attempts >= TRIALS) {
      resetGame();
      return;
    }

    // Only initialize session on first attempt
    if (attempts === 0) {
      const success = await initializeGame();
      if (!success) {
        canClickRef.current = true;
        return;
      }
    } else {
      // Check if we have a session for subsequent rounds
      const { sessionId } = getSessionData();
      if (!isGuestRunRef.current && !sessionId) {
        setGameState('error');
        canClickRef.current = true;
        return;
      }
    }

    setReactionTime(null);
    setNextRoundCountdown(null);
    gameStateRef.current = 'ready';
    setGameState('ready');

    // Reset action tracking
    if (isGuestRunRef.current) {
      const roundId = `guest-${Date.now()}-${attemptsRef.current}`;
      const delayMs = MIN_DELAY + Math.floor(Math.random() * 3000);
      guestRoundTimerRef.current = window.setTimeout(() => {
        guestRoundTimerRef.current = null;
        if (gameStateRef.current !== 'ready') return;
        activeRoundIdRef.current = roundId;
        pendingGreenRef.current = null;
        startTimeRef.current = performance.now();
        gameStateRef.current = 'click';
        setGameState('click');
        canClickRef.current = true;
      }, delayMs);
      return;
    }

    if (!wsRef.current) {
      setGameState('error');
      return;
    }

    activeRoundIdRef.current = null;
    pendingGreenRef.current = null;
    wsRef.current.requestReactionRound();
  }, [clearGuestRoundTimer, initializeGame, attempts, resetGame]);

  const saveScore = useCallback(
    async (finalResults: number[]) => {
      if (isGuestRunRef.current) {
        return;
      }

      const { sessionToken } = getSessionData();
      if (!sessionToken || isSubmitting) return;

      setSubmitError(null);
      setIsSubmitting(true);
      const stats = computeReactionRunStats(finalResults);
      const score = stats.finalScore;

      try {
        const payload = {
          score,
          averageTime: stats.average,
          bestTime: stats.best,
          sessionToken: sessionToken,
          env: envMonitorRef.current.getFingerprint(),
          clientStats: {
            attempts: stats.attempts,
            average: stats.average,
            best: stats.best,
            worst: stats.worst,
            totalReactionTime: stats.totalReactionTime,
            variance: stats.variance,
            finalScore: score,
          },
        };

        const MAX_SUBMIT_ATTEMPTS = 4;
        let response: Response | null = null;
        let data: SubmitResponseData | null = null;

        for (let attempt = 1; attempt <= MAX_SUBMIT_ATTEMPTS; attempt += 1) {
          response = await fetch('/api/games/reaction-time/score', {
            method: 'POST',
            keepalive: true,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });

          data = (await response
            .json()
            .catch(() => null)) as SubmitResponseData | null;

          if (response.ok) break;

          const hasEmptyErrorPayload =
            !data ||
            (typeof data === 'object' &&
              Object.keys(data as Record<string, unknown>).length === 0);
          const isPotentialTranscriptRace =
            hasEmptyErrorPayload ||
            isRetryableTranscriptError(response.status, data);

          if (isPotentialTranscriptRace && attempt < MAX_SUBMIT_ATTEMPTS) {
            await new Promise<void>((resolve) => window.setTimeout(resolve, 220));
            continue;
          }

          console.error('Reaction Time score submission failed', {
            status: response.status,
            statusText: response.statusText,
            body: data,
          });
          setSubmitError(getSubmitErrorMessage(response.status, data));
          return;
        }

        if (!response || !response.ok) {
          setSubmitError('Could not submit score. Please try again.');
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
            setDailyCreditsProgress({
              earned,
              cap,
            });
          }
        }

        const verified = data?.verifiedRun as Record<string, unknown> | undefined;
        if (
          verified &&
          typeof verified.averageTime === 'number' &&
          typeof verified.bestTime === 'number' &&
          typeof verified.worstTime === 'number' &&
          typeof verified.range === 'number' &&
          typeof verified.score === 'number' &&
          typeof verified.attempts === 'number'
        ) {
          setServerVerifiedRun({
            averageTime: roundToHundredth(Number(verified.averageTime)),
            bestTime: roundToHundredth(Number(verified.bestTime)),
            worstTime: roundToHundredth(Number(verified.worstTime)),
            range: roundToHundredth(Number(verified.range)),
            score: roundToHundredth(Number(verified.score)),
            attempts: Math.max(0, Math.floor(Number(verified.attempts))),
          });
        }

        setLeaderboardRefreshKey((prev) => prev + 1);
      } catch (error) {
        console.error('Failed to save score:', error);
        setSubmitError('Network error while submitting score. Please try again.');
      } finally {
        setIsSubmitting(false);
      }
    },
    [
      isSubmitting,
      envMonitorRef,
      setLeaderboardRefreshKey,
      captureRunResult,
    ],
  );

  const completeInput = useCallback(
    (eventTs: number) => {
      const now = performance.now();
      if (now < inputLockUntilRef.current) return;
      inputLockUntilRef.current = now + INPUT_LOCK_MS;

      const state = gameStateRef.current;
      if (state === 'ready') {
        clearGuestRoundTimer();
        consecutivePrefiresRef.current += 1;
        canClickRef.current = false;
        // Cancel any pending green — it won't count as a valid round
        pendingGreenRef.current = null;
        activeRoundIdRef.current = null;
        gameStateRef.current = 'too_early';
        setGameState('too_early');

        if (consecutivePrefiresRef.current >= 3) {
          scheduleGameplayTimeout(() => {
            setPrefireWarning(true);
          }, MIN_DELAY);
        } else {
          autoContinueRef.current = true;
          scheduleGameplayTimeout(() => {
            if (autoContinueRef.current && attemptsRef.current < TRIALS) {
              autoContinueRef.current = false;
              gameStateRef.current = 'waiting';
              setGameState('waiting');
              canClickRef.current = true;
              void startGame();
            }
          }, MIN_DELAY);
        }
        return;
      }

      if (!canClickRef.current) return;

      // Block clicks during too_early auto-continue cooldown
      if (state === 'too_early') return;

      if (state === 'waiting') {
        autoContinueRef.current = false;
        void startGame();
        return;
      }

      if (state !== 'click') return;

      canClickRef.current = false;
      consecutivePrefiresRef.current = 0;
      const inputTime = normalizeEventTimestamp(eventTs);
      const reactionMs = Math.max(
        0,
        roundToHundredth(inputTime - startTimeRef.current),
      );
      const newResults = [...resultsRef.current, reactionMs];
      const newAttempts = attemptsRef.current + 1;

      const roundId = activeRoundIdRef.current;
      if (!roundId) {
        setGameState('error');
        return;
      }

      wsRef.current?.sendReactionClick(roundId, reactionMs);
      activeRoundIdRef.current = null;
      pendingGreenRef.current = null;

      resultsRef.current = newResults;
      attemptsRef.current = newAttempts;
      setReactionTime(reactionMs);
      setResults(newResults);
      setAttempts(newAttempts);
      gameStateRef.current = 'result';
      setGameState('result');

      if (newAttempts >= TRIALS) {
        void saveScore(newResults);
        const runAverage = roundToHundredth(
          newResults.reduce((sum, value) => sum + value, 0) / newResults.length,
        );
        const currentPb = personalBestRef.current;
        if (currentPb === null || runAverage < currentPb) {
          setPersonalBestMs(runAverage);
          setShowPbConfetti(true);
          scheduleGameplayTimeout(() => setShowPbConfetti(false), 1800);
          if (!currentUserId) {
            try {
              localStorage.setItem('reaction-time-guest-best', String(runAverage));
            } catch {
              // noop
            }
          }
        }
        scheduleGameplayTimeout(() => {
          gameStateRef.current = 'waiting';
          setGameState('waiting');
          canClickRef.current = true;
        }, MIN_DELAY);
      }
    },
    [
      clearGuestRoundTimer,
      saveScore,
      scheduleGameplayTimeout,
      startGame,
      currentUserId,
    ],
  );

  useEffect(() => {
    const loop = createGameFrameLoop({
      simulate: () => {},
      render: (_alpha, frame) => {
        if (!pendingGreenRef.current || gameStateRef.current !== 'ready') return;
        const pending = pendingGreenRef.current;
        pendingGreenRef.current = null;
        activeRoundIdRef.current = pending.roundId;
        // Keep the reaction anchor on the browser's monotonic wall clock. The
        // shared loop only owns visibility-aware delivery of the green event.
        startTimeRef.current = frame.nowMs;
        gameStateRef.current = 'click';
        setGameState('click');
        canClickRef.current = true;
      },
    });
    schedulingLoopRef.current = loop;
    loop.start();
    return () => {
      loop.destroy();
      if (schedulingLoopRef.current === loop) schedulingLoopRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (gameState !== 'result') return;
    if (attempts >= TRIALS) return;

    autoContinueRef.current = true;
    const deadline = performance.now() + NEXT_ROUND_DELAY_MS;
    let displayed = Math.max(1, Math.ceil(NEXT_ROUND_DELAY_MS / 1000));
    setNextRoundCountdown(displayed);
    const loop = createGameFrameLoop({
      simulate: () => {},
      render: (_alpha, frame) => {
        if (!autoContinueRef.current || gameStateRef.current !== 'result') {
          loop.stop();
          return;
        }
        const leftMs = deadline - frame.nowMs;
        if (leftMs <= 0) {
          autoContinueRef.current = false;
          gameStateRef.current = 'waiting';
          setGameState('waiting');
          canClickRef.current = true;
          setNextRoundCountdown(null);
          loop.stop();
          void startGame();
          return;
        }
        const nextDisplay = Math.max(1, Math.ceil(leftMs / 1000));
        if (nextDisplay !== displayed) {
          displayed = nextDisplay;
          setNextRoundCountdown(nextDisplay);
        }
      },
    });
    loop.start();

    return () => {
      loop.destroy();
    };
  }, [gameState, attempts, startGame]);

  const handlePrefireWarningDismiss = useCallback(() => {
    setPrefireWarning(false);
    resetGame();
  }, [resetGame, setPrefireWarning]);

  // Focus management for accessibility
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
    void loadReactionTheme();
  }, [loadReactionTheme]);

  useEffect(() => {
    if (!banUntilMs) return;
    if (banNowMs >= banUntilMs) {
      setBanUntilMs(null);
      setBanIndefinite(false);
    }
  }, [banNowMs, banUntilMs]);

  useEffect(() => {
    if (currentUserId) {
      const myEntry = liveReactionLeaderboard.find((entry) => entry.userId === currentUserId);
      if (myEntry && typeof myEntry.averageTime === 'number') {
        setPersonalBestMs(roundToHundredth(myEntry.averageTime));
      }
      return;
    }
    try {
      const guestPb = localStorage.getItem('reaction-time-guest-best');
      if (!guestPb) return;
      const parsed = Number(guestPb);
      if (Number.isFinite(parsed) && parsed > 0) {
        setPersonalBestMs(roundToHundredth(parsed));
      }
    } catch {
      // noop
    }
  }, [liveReactionLeaderboard, currentUserId]);

  useEffect(() => {
    const handleVisibility = () => {
      if (!document.hidden) return;
      clearGuestRoundTimer();
      clearGameplayTimers();
      setShowPbConfetti(false);
      pendingGreenRef.current = null;
      activeRoundIdRef.current = null;
      autoContinueRef.current = false;
      setNextRoundCountdown(null);
      const state = gameStateRef.current;
      if (
        state === 'ready' ||
        state === 'click' ||
        state === 'too_early' ||
        state === 'result'
      ) {
        gameStateRef.current = 'waiting';
        setGameState('waiting');
        canClickRef.current = true;
      }
    };

    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [clearGuestRoundTimer, clearGameplayTimers]);

  useEffect(() => {
    const surface = gameSurfaceRef.current;
    if (!surface) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Tab') return;
      if (e.key === 'Escape' && gameStateRef.current !== 'waiting') {
        e.preventDefault();
        resetGame();
        return;
      }
      if (e.key === 'Enter' && prefireWarning) {
        e.preventDefault();
        handlePrefireWarningDismiss();
        return;
      }
      if (e.key !== ' ' && e.key !== 'Spacebar') return;
      if (
        document.activeElement instanceof Element &&
        document.activeElement.closest(REWARDS_HINT_TRIGGER_SELECTOR)
      ) {
        return;
      }
      if (e.repeat) return;
      e.preventDefault();
      completeInput(e.timeStamp);
    };

    const onMouseDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      if (
        e.target instanceof Element &&
        e.target.closest(REWARDS_HINT_TRIGGER_SELECTOR)
      ) {
        return;
      }
      e.preventDefault();
      completeInput(e.timeStamp);
    };

    const onTouchStart = (e: TouchEvent) => {
      if (
        e.target instanceof Element &&
        e.target.closest(REWARDS_HINT_TRIGGER_SELECTOR)
      ) {
        return;
      }
      e.preventDefault();
      completeInput(e.timeStamp);
    };

    window.addEventListener('keydown', onKeyDown, { passive: false });
    surface.addEventListener('mousedown', onMouseDown, { passive: false });
    surface.addEventListener('touchstart', onTouchStart, { passive: false });

    return () => {
      window.removeEventListener('keydown', onKeyDown);
      surface.removeEventListener('mousedown', onMouseDown);
      surface.removeEventListener('touchstart', onTouchStart);
    };
  }, [completeInput, prefireWarning, handlePrefireWarningDismiss, resetGame]);

  // Cleanup on unmount
  useEffect(() => {
    const envMonitor = envMonitorRef.current;
    return () => {
      wsRef.current?.close();
      clearGuestRoundTimer();
      clearGameplayTimers();
      schedulingLoopRef.current?.destroy();
      schedulingLoopRef.current = null;
      envMonitor.stop();

      // Clear session data
      sessionTokenRef.current = null;
      wsRef.current = null;
      autoContinueRef.current = false;
      initialEnvFingerprintRef.current = null;
      pendingGreenRef.current = null;
    };
  }, [clearGuestRoundTimer, clearGameplayTimers]);

  const averageTime =
    results.length > 0
      ? roundToHundredth(results.reduce((a, b) => a + b, 0) / results.length)
      : 0;
  const bestTime = results.length > 0 ? Math.min(...results) : 0;
  const worstTime = results.length > 0 ? Math.max(...results) : 0;
  const hasVerifiedRun =
    attempts >= TRIALS &&
    !!serverVerifiedRun &&
    serverVerifiedRun.attempts >= TRIALS &&
    !submitError;
  const displayAverageTime = hasVerifiedRun
    ? serverVerifiedRun.averageTime
    : averageTime;
  const displayBestTime = hasVerifiedRun ? serverVerifiedRun.bestTime : bestTime;
  const displayWorstTime = hasVerifiedRun
    ? serverVerifiedRun.worstTime
    : worstTime;
  const displayRange =
    hasVerifiedRun && serverVerifiedRun
      ? serverVerifiedRun.range
      : roundToHundredth(worstTime - bestTime);

  // Performance tier system
  const getPerformanceRating = (time: number) => {
    const tier = getReactionTier(time);
    const colorClass =
      tier.label === 'Lightning' ? 'text-tickets-text' :
      tier.label === 'Blazing' ? 'text-danger-text' :
      tier.label === 'Fast' ? 'text-prize-text' :
      tier.label === 'Average' ? 'text-info-text' :
      tier.label === 'Steady' ? 'text-body' :
      'text-faint';
    return { rating: tier.label, color: colorClass };
  };

  const getPerformanceTips = (time: number) => {
    const tier = getReactionTier(time);
    return tier.description;
  };

  const getBackgroundColor = () => {
    switch (gameState) {
      case 'waiting':
        return reactionTheme.panelBg;
      case 'ready':
        return reactionTheme.waitColor;
      case 'click':
        return reactionTheme.goColor;
      case 'too_early':
        return reactionTheme.tooSoonColor;
      case 'result':
        return reactionTheme.panelBg;
      case 'error':
        return '#7f1d1d';
      default:
        return reactionTheme.panelBg;
    }
  };

  const getTitle = () => {
    if (isStartingSession) {
      return 'Starting your run…';
    }
    switch (gameState) {
      case 'waiting':
        return 'Reaction time';
      case 'ready':
        return 'Wait for green';
      case 'click':
        return 'SMACK IT';
      case 'too_early':
        return 'Too early';
      case 'result':
        return 'Round complete';
      case 'error':
        return 'Connection dropped';
      default:
        return '';
    }
  };

  const getSubtitle = () => {
    if (isStartingSession) {
      return 'Connecting to the server.';
    }
    switch (gameState) {
      case 'waiting':
        return 'Smack the panel the instant it flips.';
      case 'ready':
        return 'Hold steady.';
      case 'click':
        return '';
      case 'too_early':
        return 'Wait for the green panel.';
      case 'result':
        return attempts < TRIALS
          ? `Attempt ${attempts}/${TRIALS} — next round in a beat${nextRoundCountdown ?? ''}`
          : 'Run complete. Space restarts.';
      case 'error':
        return 'The run could not reach the game server.';
      default:
        return '';
    }
  };

  const getGameStateDescription = (touch: boolean) => {
    if (isStartingSession) {
      return 'Starting a new reaction-time session';
    }
    switch (gameState) {
      case 'waiting':
        return touch ? 'Tap to start the game' : 'Click or press Space to start the game';
      case 'ready':
        return touch ? 'Wait for green, then tap as fast as you can' : 'Wait for the green screen, then click as fast as you can';
      case 'click':
        return touch ? 'Tap now! The screen is green' : 'Click now! The screen is green';
      case 'too_early':
        return 'You clicked too early! Wait for the green screen';
      case 'result':
        return 'Round complete. Your reaction time is being recorded';
      case 'error':
        return 'Connection error. Please try again';
      default:
        return 'Game is ready';
    }
  };

  const walletCard = {
    credits: walletBalances.credits,
    progress: {
      label: 'Daily Tickets',
      current: dailyCreditsProgress.earned,
      max: dailyCreditsProgress.cap,
    },
  };

  return (
    <div
      className='arc-game-flow'
    >
      <div className='w-full space-y-3 sm:space-y-4'>
        <div className='mx-auto w-full max-w-4xl'>
          <div className='hidden md:block'>
            <PageHeader
              eyebrow='tixy'
              icon='target'
              title='Reaction Time'
              subtitle='Train reflexes, improve consistency, and climb the board.'
              wallet={walletCard}
            />
          </div>
          <div className='md:hidden'>
            <GamesWalletCard wallet={walletCard} compact />
          </div>
        </div>
        <GamesRouteSwitcher />
        <div className='relative touch-none flex justify-center'>
          <div className='rt-stage-frame w-full max-w-4xl'>
          <div
            ref={gameSurfaceRef}
            className={`rt-stage relative h-[min(20rem,52vh)] w-full cursor-pointer select-none rounded-well transition-colors duration-100 sm:h-[min(30rem,56vh)]${goPulse ? ' rt-go-pop' : ''}${failShake ? ' rt-fail-shake' : ''}${gameState === 'ready' ? ' rt-ready-breathe' : ''}`}
            style={
              {
                backgroundColor: getBackgroundColor(),
                // Optional target glow (OFF by default; an equipped 'target'
                // skin can enable it). Layered onto the lit-state box-shadow.
                '--rt-glow-color': reactionTheme.targetGlowEnabled
                  ? reactionTheme.targetGlowColor || reactionTheme.goColor
                  : 'transparent',
                '--rt-glow-size': `${
                  reactionTheme.targetGlowEnabled
                    ? reactionTheme.targetGlowSize
                    : 0
                }px`,
              } as CSSProperties
            }
            data-lit={gameState === 'ready' || gameState === 'click' || gameState === 'too_early'}
            role='button'
            tabIndex={0}
            aria-label={`Reaction time game - ${getGameStateDescription(touchDevice)}`}
          >
            <div className='absolute inset-0 flex flex-col items-center justify-center p-4 text-strong sm:p-8'>
              {goRing !== null && (
                <div
                  key={`go-ring-${goRing}`}
                  aria-hidden='true'
                  className='rt-go-ring pointer-events-none absolute left-1/2 top-1/2'
                />
              )}
              {hitBurst !== null && (
                <div
                  key={`hit-${hitBurst}`}
                  aria-hidden='true'
                  className='rt-hit-burst pointer-events-none absolute left-1/2 top-1/2'
                >
                  <span className='rt-hit-ring' />
                  {[...Array(10)].map((_, idx) => (
                    <span
                      key={idx}
                      className='rt-spark'
                      style={
                        {
                          '--rt-spark-angle': `${idx * 36}deg`,
                          backgroundColor:
                            idx % 2 === 0
                              ? reactionTheme.badgeColor
                              : 'var(--enamel-prize)',
                        } as CSSProperties
                      }
                    />
                  ))}
                </div>
              )}
              {showPbConfetti && (
                <div
                  aria-hidden='true'
                  className='pointer-events-none absolute inset-0 overflow-hidden'
                >
                  {[...Array(18)].map((_, idx) => (
                    <span
                      key={`pb-confetti-${idx}`}
                      className='absolute h-2 w-2 rounded-full animate-ping'
                      style={{
                        backgroundColor:
                          idx % 2 === 0
                            ? reactionTheme.badgeColor
                            : 'var(--enamel-prize)',
                        left: `${(idx % 6) * 18 + 6}%`,
                        top: `${Math.floor(idx / 6) * 22 + 8}%`,
                        animationDelay: `${idx * 30}ms`,
                        animationDuration: `${900 + (idx % 5) * 120}ms`,
                      }}
                    />
                  ))}
                </div>
              )}

              {/* Progress indicator */}
              {attempts > 0 && (
                <div className='absolute top-4 right-4 flex items-center gap-2'>
                  <div className='flex gap-1.5'>
                    {[...Array(TRIALS)].map((_, i) => (
                      <div
                        key={i}
                        className='rt-pip'
                        data-on={i < attempts}
                        style={
                          i < attempts
                            ? { backgroundColor: reactionTheme.badgeColor }
                            : undefined
                        }
                      />
                    ))}
                  </div>
                  <span className='arcade-num text-xs opacity-70'>
                    {attempts}/{TRIALS}
                  </span>
                </div>
              )}

              {/* Main content */}
              <div className='flex flex-col items-center justify-center'>
                {gameState === 'click' && (
                  <Target className='w-16 h-16 mb-4 text-white' />
                )}
                {gameState === 'ready' && (
                  <Clock className='w-16 h-16 mb-4 text-white' />
                )}
                {gameState === 'too_early' && (
                  <div className='mb-4 flex flex-col items-center gap-2'>
                    <AlertCircle className='w-8 h-8 text-tickets-text' />
                  </div>
                )}

                <h2
                  className={`mb-4 text-4xl font-bold sm:text-5xl ${
                    gameState === 'ready' || gameState === 'click' || gameState === 'too_early'
                      ? 'text-white'
                      : ''
                  }`}
                >
                  {getTitle()}
                </h2>
                {gameState === 'waiting' ? (
                  <div className='flex items-center justify-center gap-2 text-lg opacity-80 text-center'>
                    <p>
                      {touchDevice
                        ? 'Tap anywhere to start'
                        : <>Press <kbd className='arcade-card-inset px-2 py-1 text-strong'>Space</kbd> or click to play</>}
                    </p>
                    <span className='group relative inline-flex'>
                      <ArcadeButton
                        tone='ghost'
                        size='icon-sm'
                        data-rewards-hint-trigger='true'
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
                        className={`pointer-events-none absolute right-0 top-full z-20 mt-2 w-[calc(100vw-2rem)] max-w-72 rounded-tag border-2 border-ink bg-raised px-3 py-2 text-left text-xs leading-relaxed text-body shadow-chip transition-opacity duration-150 sm:left-1/2 sm:right-auto sm:w-72 sm:max-w-none sm:-translate-x-1/2 ${
                          showRewardsHint
                            ? 'opacity-100'
                            : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100'
                        }`}
                      >
                        {REWARDS_HINT_TEXT}
                      </span>
                    </span>
                  </div>
                ) : (
                  <p className='text-lg opacity-80'>
                    {gameState === 'error'
                      ? (startError ?? getSubtitle())
                      : getSubtitle()}
                  </p>
                )}
                {gameState === 'error' && (banIndefinite || banUntilMs) && (
                  <p className='mt-2 text-tickets-text text-xs sm:text-sm text-center'>
                    {banIndefinite
                      ? 'You are banned from games until an admin unbans you.'
                      : `Ban time left: ${formatBanCountdown(banUntilMs!)}`}
                  </p>
                )}

                {/* Reaction time display */}
                {reactionTime && gameState === 'result' && (
                  <div className='mt-4 flex flex-col items-center max-w-md'>
                    <div
                      className='rt-readout text-4xl font-bold sm:text-5xl'
                      style={{ color: reactionTheme.badgeColor }}
                    >
                      {formatMs(reactionTime)}ms
                    </div>
                    <div
                      className={`mt-2 text-sm font-medium ${getPerformanceRating(reactionTime).color}`}
                    >
                      {getPerformanceRating(reactionTime).rating}
                    </div>
                    <div className='mt-2 text-center text-xs text-faint'>
                      {getPerformanceTips(reactionTime)}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
          </div>
        </div>

        {/* Controls and Results */}
        <div className='mt-4 sm:mt-6 flex flex-col items-center gap-3 sm:gap-4 w-full'>
          {results.length > 0 && (
            <ArcadePanel className='mx-auto w-full max-w-4xl p-4 sm:p-6'>
              <div className='flex items-center justify-between mb-4 flex-wrap gap-4'>
                <h2 className='flex items-center gap-2 text-lg sm:text-xl font-semibold text-strong'>
                  <Trophy size={20} className='text-tickets-text' />
                  Your results
                </h2>
                <div className='flex flex-wrap gap-2 text-sm'>
                  <span className='rt-result-plate inline-flex items-center gap-1.5 text-prize-text'>
                    Avg <span className='rt-readout font-semibold'>{formatMs(displayAverageTime)}ms</span>
                  </span>
                  <span className='rt-result-plate inline-flex items-center gap-1.5 text-info-text'>
                    Best <span className='rt-readout font-semibold'>{formatMs(displayBestTime)}ms</span>
                  </span>
                  <span className='rt-result-plate inline-flex items-center gap-1.5 text-danger-text'>
                    Worst <span className='rt-readout font-semibold'>{formatMs(displayWorstTime)}ms</span>
                  </span>
                  {results.length >= 3 && (
                    <span className='rt-result-plate inline-flex items-center gap-1.5 text-body'>
                      Range <span className='rt-readout font-semibold'>{formatMs(displayRange)}ms</span>
                    </span>
                  )}
                </div>
              </div>

              {attempts >= TRIALS && (
                <div className='rt-result-plate p-4 text-center'>
                  <div className='flex flex-col items-center gap-2'>
                    <span className='font-semibold text-prize-text'>
                      Final avg{' '}
                      <span className='rt-readout text-lg'>{formatMs(displayAverageTime)}ms</span>
                    </span>
                    {personalBestMs !== null && (
                      <div className='text-xs text-faint'>
                        Your best{' '}
                        <span className='arcade-num'>{formatMs(personalBestMs)}ms</span>
                      </div>
                    )}
                    <div className='mt-2 text-xs text-faint'>
                      {getPerformanceTips(displayAverageTime)}
                    </div>
                    <ArcadeRunRewards
                      reward={runReward}
                      achievements={runAchievements}
                      saving={isSubmitting}
                      error={submitError}
                      guest={isGuestRunRef.current}
                      className='mt-2 max-w-xs'
                    />
                  </div>
                </div>
              )}

              <div className='arcade-card-inset mt-4 p-3'>
                <div className='arcade-kicker mb-2'>
                  Trial timeline
                </div>
                <ReactionTimelineChart
                  results={results}
                  accentColor={reactionTheme.badgeColor}
                />
              </div>
            </ArcadePanel>
          )}

          <div className='w-full max-w-4xl mx-auto flex flex-col items-center gap-2 sm:flex-row sm:justify-center'>
            <div className='order-2 sm:order-1 flex flex-wrap items-center justify-center gap-2 sm:gap-3'>
              {attempts >= TRIALS && (
                <ArcadeButton
                  tone='primary'
                  size='sm'
                  onClick={resetGame}
                  className='shrink-0'
                  aria-label='Restart game'
                >
                  <RotateCcw size={15} />
                  Restart
                </ArcadeButton>
              )}
              <GameLeaderboardButton
                onClick={() => setShowLeaderboard(true)}
                className='h-10 shrink-0 px-3 py-0 text-xs sm:text-sm'
              />
              <GameInventoryButton
                onClick={() => togglePanelWithoutScrollJump(setShowInventory)}
                className='h-10 shrink-0 px-3 py-0 text-xs sm:text-sm'
              />
              <MuteButton />
            </div>
          </div>

        </div>
      </div>

      <GameLeaderboardModal
        open={showLeaderboard}
        onOpenChange={setShowLeaderboard}
        title='Reaction Time Leaderboard'
        description='Fastest verified reaction runs.'
      >
        <GameLeaderboard
          gameType='reaction-time'
          maxEntries={5}
          enableFullLeaderboardModal
          fullLeaderboardDisplay='inline'
          refreshKey={leaderboardRefreshKey}
        />
      </GameLeaderboardModal>

      <GameInventoryModal
        open={showInventory}
        onOpenChange={setShowInventory}
        gameType='reaction-time'
        title='Reaction Time Inventory'
        description='No equip slots are active for this game yet.'
      />

      {/* Prefire Warning Modal */}
      {prefireWarning && (
        <div
          className='fixed inset-0 z-50 flex items-center justify-center p-4'
          style={{
            background: 'color-mix(in srgb, var(--scrim) 78%, transparent)',
          }}
          role='dialog'
          aria-modal='true'
          aria-labelledby='prefire-title'
          aria-describedby='prefire-description'
        >
          <ArcadePanel variant='cabinet' className='w-full max-w-md p-6 shadow-modal'>
            <div className='flex items-center gap-3 mb-4'>
              <AlertCircle className='w-6 h-6 text-tickets-text' />
              <h3
                id='prefire-title'
                className='text-lg font-semibold text-strong'
              >
                Prefire flagged
              </h3>
            </div>
            <p
              id='prefire-description'
              className='mb-6 leading-relaxed text-body'
            >
              You clicked early several times in a row. Wait for the green
              panel before you smack it — it keeps the board fair.
            </p>
            <div className='flex gap-3'>
              <ArcadeButton
                tone='primary'
                size='sm'
                onClick={handlePrefireWarningDismiss}
                className='flex-1'
                aria-label='Dismiss warning and restart game'
              >
                Got it
              </ArcadeButton>
            </div>
          </ArcadePanel>
        </div>
      )}
    </div>
  );
}
