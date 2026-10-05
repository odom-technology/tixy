'use client';

import {
  useState,
  useRef,
  useEffect,
  useCallback,
  useMemo,
  type MouseEvent,
} from 'react';
import {
  RotateCcw,
  Share2,
  Check,
} from 'lucide-react';
import { ArcadeButton } from '@/features/arcade/components/ui/arcade-ui';
import { GameLeaderboard, TIMER_BOARD_MODES } from '@/features/arcade/components/game-leaderboard';
import { GameInventoryModal } from '@/features/arcade/components/game-inventory-modal';
import { GameLeaderboardModal } from '@/features/arcade/components/game-leaderboard-modal';
import { GameInventoryButton } from '@/features/arcade/components/game-inventory-button';
import { GameLeaderboardButton } from '@/features/arcade/components/game-leaderboard-button';
import { MuteButton } from '@/features/arcade/components/mute-button';
import { PageHeader, GamesWalletCard } from '@/features/arcade/components/shell/page-header';
import { GamesRouteSwitcher } from '@/features/arcade/components/games-route-switcher';
import { EnvMonitor } from '@/features/arcade/lib/game-anti-cheat';
import { connectGameWs, type GameWsHandle } from '@/features/arcade/lib/game-ws';
import { generateSeededWords, ENGLISH_WORDS } from '@/features/arcade/lib/typing-words';
import { usePreventGameGestures, isTouchDevice } from '@/features/arcade/lib/game-mobile-utils';
import { ArcadeRunRewards } from '@/features/arcade/components/results/arcade-run-result';
import { useArcadeRunResult } from '@/features/arcade/lib/run-result';
import { SoundManager } from '@/features/arcade/lib/sound-manager';

import type {
  TypingCosmeticTheme,
  InventoryCosmeticResponse,
  GameState,
  GameMode,
  WpmDataPoint,
} from './_typing-test-types';
import {
  MAX_EXTRA_CHARS,
  DEFAULT_TYPING_THEME,
} from './_typing-test-types';
import { buildTypingTheme, getFontFamilyCss } from './_typing-test-theme';
import { getSubmitErrorMessage } from './_typing-test-helpers';
import { Caret } from './_caret';
import { useTypingLineScroll } from './_use-typing-line-scroll';

// Word list is now imported from @/features/arcade/lib/typing-words

export default function TypingTestPage() {
  const [gameState, setGameState] = useState<GameState>('idle');
  const [mode, setMode] = useState<GameMode>(30);
  const [timeLeft, setTimeLeft] = useState(30);
  const [words, setWords] = useState<string[]>([]);
  const [currentWordIndex, setCurrentWordIndex] = useState(0);
  const [currentInput, setCurrentInput] = useState('');
  const [wordInputHistory, setWordInputHistory] = useState<string[]>([]);

  const [correctChars, setCorrectChars] = useState(0);
  const [incorrectChars, setIncorrectChars] = useState(0);
  const [wpmHistory, setWpmHistory] = useState<WpmDataPoint[]>([]);
  const correctCharsRef = useRef(0);
  const incorrectCharsRef = useRef(0);
  const wordsCompletedRef = useRef(0);

  const [finalWpm, setFinalWpm] = useState(0);
  const [finalRawWpm, setFinalRawWpm] = useState(0);
  const [finalAccuracy, setFinalAccuracy] = useState(0);
  const [isNewPB, setIsNewPB] = useState(false);
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
  const [sessionRetryUntilMs, setSessionRetryUntilMs] = useState<number | null>(null);
  const [banNowMs, setBanNowMs] = useState(Date.now());
  const [copied, setCopied] = useState(false);

  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const [showInventory, setShowInventory] = useState(false);
  const [typingTheme, setTypingTheme] =
    useState<TypingCosmeticTheme>(DEFAULT_TYPING_THEME);
  const [walletBalances, setWalletBalances] = useState({ credits: 0 });
  const [dailyCreditsProgress, setDailyCreditsProgress] = useState({
    earned: 0,
    cap: 300,
  });
  const [leaderboardRefreshKey, setLeaderboardRefreshKey] = useState(0);
  const [highScore, setHighScore] = useState<Record<GameMode, number>>({
    15: 0,
    30: 0,
    60: 0,
  });

  // Block pull-to-refresh, scroll bounce, pinch zoom during active typing
  usePreventGameGestures(gameState === 'playing');

  // On mobile, aggressively re-focus the hidden input to keep the virtual
  // keyboard open during gameplay. Browsers dismiss the keyboard on blur
  // (e.g. when a re-render briefly removes focus).
  useEffect(() => {
    if (gameState !== 'playing' || !isTouchDevice()) return;
    let interval: number | null = null;
    const refocus = () => {
      if (document.activeElement !== inputRef.current) {
        inputRef.current?.focus({ preventScroll: true });
      }
    };
    const stop = () => {
      if (interval === null) return;
      window.clearInterval(interval);
      interval = null;
    };
    const start = () => {
      if (interval !== null || document.hidden) return;
      refocus();
      interval = window.setInterval(refocus, 500);
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
  }, [gameState]);

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

  const inputRef = useRef<HTMLInputElement>(null);
  const sessionTokenRef = useRef<string | null>(null);
  const envMonitorRef = useRef(new EnvMonitor());
  const wsRef = useRef<GameWsHandle | null>(null);
  const initCounterRef = useRef(0);
  const startTimeRef = useRef<number>(0);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const wpmIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const lastInputLengthRef = useRef<number>(0);
  const lastRestartAtRef = useRef<number>(0);
  const typingSeedRef = useRef<number | null>(null);
  const isGuestRunRef = useRef(false);
  const isSubmittingRef = useRef(false);
  const endGameRef = useRef<(() => void) | null>(null);

  const {
    containerRef: wordsContainerRef,
    isScrolled: isWordsScrolled,
    style: wordsScrollStyle,
  } = useTypingLineScroll({
    currentWordIndex,
    layoutKey: `${currentInput.length}:${typingTheme.textFontFamily}:${typingTheme.textFontWeight}:${typingTheme.textLetterSpacing}:${typingTheme.textWordSpacing}`,
    enabled: gameState !== 'finished',
  });

  const formatBanCountdown = (targetMs: number) => {
    const totalSeconds = Math.max(0, Math.floor((targetMs - banNowMs) / 1000));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return `${hours.toString().padStart(2, '0')}:${minutes
      .toString()
      .padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  };

  // Sync refs with state
  useEffect(() => {
    correctCharsRef.current = correctChars;
  }, [correctChars]);

  useEffect(() => {
    incorrectCharsRef.current = incorrectChars;
  }, [incorrectChars]);

  const generateWords = useCallback(
    (count: number = 200, seed?: number): string[] => {
      if (seed !== undefined) {
        return generateSeededWords(seed, count);
      }
      // Fallback to random (only used before session is created)
      const result: string[] = [];
      let lastWord = '';
      for (let i = 0; i < count; i++) {
        let word =
          ENGLISH_WORDS[Math.floor(Math.random() * ENGLISH_WORDS.length)];
        while (word === lastWord && ENGLISH_WORDS.length > 1) {
          word =
            ENGLISH_WORDS[Math.floor(Math.random() * ENGLISH_WORDS.length)];
        }
        result.push(word);
        lastWord = word;
      }
      return result;
    },
    [],
  );

  const fetchUserBestScore = useCallback(async () => {
    try {
      const response = await fetch(`/api/games/typing-test/score?mode=${mode}`);
      if (response.ok) {
        const data = await response.json();
        if (data.bestWpm) {
          setHighScore((prev) => ({ ...prev, [mode]: data.bestWpm }));
        }
      }
    } catch (err) {
      console.error('Failed to fetch user best score:', err);
    }
  }, [mode]);

  const loadTypingTheme = useCallback(async () => {
    try {
      const response = await fetch('/api/store/inventory?gameType=typing-test', {
        cache: 'no-store',
      });
      if (!response.ok) {
        setWalletBalances({ credits: 0 });
        setDailyCreditsProgress({ earned: 0, cap: 300 });
        setTypingTheme(DEFAULT_TYPING_THEME);
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
      setTypingTheme(buildTypingTheme(payload));
    } catch {
      setWalletBalances({ credits: 0 });
      setDailyCreditsProgress({ earned: 0, cap: 300 });
      setTypingTheme(DEFAULT_TYPING_THEME);
    }
  }, []);

  const saveScore = useCallback(
    async (
      wpm: number,
      rawWpm: number,
      accuracy: number,
      correct: number,
      incorrect: number,
      total: number,
      completed: number,
    ) => {
      if (isSubmittingRef.current) return;
      if (isGuestRunRef.current) {
        return;
      }
      isSubmittingRef.current = true;
      setSubmitError(null);

      try {
        const response = await fetch('/api/games/typing-test/score', {
          method: 'POST',
          keepalive: true,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            wpm,
            rawWpm,
            accuracy,
            mode,
            correctChars: correct,
            incorrectChars: incorrect,
            totalChars: total,
            wordsCompleted: completed,
            sessionToken: sessionTokenRef.current,
            env: envMonitorRef.current.getFingerprint(),
          }),
        });

        const data = await response.json().catch(() => null);
        if (!response.ok) {
          console.error('Typing Test score submission failed:', data);
          setSubmitError(getSubmitErrorMessage(response.status, data));
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

        if (data?.isNewPB) {
          setIsNewPB(true);
          setHighScore((prev) => ({ ...prev, [mode]: wpm }));
        }
        setLeaderboardRefreshKey((prev) => prev + 1);
      } catch (err) {
        console.error('Failed to save score:', err);
        setSubmitError('Network error while submitting score. Please try again.');
      } finally {
        isSubmittingRef.current = false;
      }
    },
    [captureRunResult, mode],
  );

  const endGame = useCallback(async () => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (wpmIntervalRef.current) clearInterval(wpmIntervalRef.current);
    envMonitorRef.current.stop();

    const elapsedSeconds = mode;
    const correct = correctCharsRef.current;
    const incorrect = incorrectCharsRef.current;
    const completed = wordsCompletedRef.current;
    const totalChars = correct + incorrect;
    const accuracy = totalChars > 0 ? (correct / totalChars) * 100 : 0;
    const wpm = Math.round(correct / 5 / (elapsedSeconds / 60));
    const rawWpm = Math.round(totalChars / 5 / (elapsedSeconds / 60));

    setFinalWpm(wpm);
    setFinalRawWpm(rawWpm);
    setFinalAccuracy(accuracy);
    setGameState('finished');

    await saveScore(
      wpm,
      rawWpm,
      accuracy,
      correct,
      incorrect,
      totalChars,
      completed,
    );
  }, [mode, saveScore]);

  useEffect(() => {
    endGameRef.current = endGame;
  }, [endGame]);

  const initializeGame = useCallback(async (sessionMode: GameMode) => {
    const initId = ++initCounterRef.current;
    setIsStartingSession(true);
    isGuestRunRef.current = false;
    sessionTokenRef.current = null;
    let sessionSuccess = false;
    const finishStarting = () => {
      if (initCounterRef.current === initId) {
        setIsStartingSession(false);
      }
    };
    try {
      setStartError(null);
      const sessionResponse = await fetch('/api/games/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gameType: 'typing-test', mode: sessionMode }),
      });
      if (sessionResponse.ok) {
        setBanIndefinite(false);
        setBanUntilMs(null);
        setSessionRetryUntilMs(null);
        const sessionData = await sessionResponse.json();
        if (initCounterRef.current !== initId) {
          return;
        }
        sessionTokenRef.current = sessionData.token;
        typingSeedRef.current = sessionData.typingSeed ?? null;
        lastInputLengthRef.current = 0;
        envMonitorRef.current.start();
        try {
          wsRef.current?.close();
          wsRef.current = await connectGameWs(sessionData.token);
          wsRef.current.onDisconnect((reason) => {
            console.error('Typing Test socket disconnected:', reason);
            setGameState('error');
          });
        } catch (error) {
          console.error('Failed to connect realtime channel:', error);
          setGameState('error');
          finishStarting();
          return;
        }
        sessionSuccess = true;
      } else if (sessionResponse.status === 401) {
        if (initCounterRef.current !== initId) {
          return;
        }
        isGuestRunRef.current = true;
        sessionTokenRef.current = null;
        typingSeedRef.current = (Math.floor(Math.random() * 0xffffffff)) >>> 0;
        lastInputLengthRef.current = 0;
        wsRef.current?.close();
        wsRef.current = null;
        setBanIndefinite(false);
        setBanUntilMs(null);
        setSessionRetryUntilMs(null);
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
          setSessionRetryUntilMs(null);
        } else if (sessionResponse.status === 429) {
          setBanIndefinite(false);
          setBanUntilMs(null);
          setSessionRetryUntilMs(
            typeof data?.retryAfterSec === 'number'
              ? Date.now() + data.retryAfterSec * 1000
              : null,
          );
        } else {
          setBanIndefinite(false);
          setBanUntilMs(null);
          setSessionRetryUntilMs(null);
        }
        setStartError(getSubmitErrorMessage(sessionResponse.status, data));
      }
    } catch (err) {
      console.error('Session error:', err);
      setStartError('Network error while starting game. Please try again.');
      finishStarting();
    }

    if (initCounterRef.current !== initId) {
      return;
    }

    // Don't start the game if session failed (guest runs have no token)
    if (!sessionSuccess || (!sessionTokenRef.current && !isGuestRunRef.current)) {
      setGameState('error');
      finishStarting();
      return;
    }

    const newWords = generateWords(200, typingSeedRef.current ?? undefined);
    setWords(newWords);
    setCurrentWordIndex(0);
    setCurrentInput('');
    setWordInputHistory(newWords.map(() => ''));
    setCorrectChars(0);
    setIncorrectChars(0);
    correctCharsRef.current = 0;
    incorrectCharsRef.current = 0;
    wordsCompletedRef.current = 0;
    setWpmHistory([]);
    setTimeLeft(sessionMode);
    setIsNewPB(false);
    setCopied(false);
    setGameState('idle');
    finishStarting();

    setTimeout(() => {
      inputRef.current?.focus({ preventScroll: true });
    }, 50);
  }, [generateWords]);

  const startGameTimer = useCallback(() => {
    setGameState('playing');
    startTimeRef.current = Date.now();

    timerRef.current = setInterval(() => {
      const elapsed = Math.floor((Date.now() - startTimeRef.current) / 1000);
      const remaining = mode - elapsed;
      setTimeLeft(remaining);
      if (remaining <= 0) {
        endGameRef.current?.();
      }
    }, 100);

    wpmIntervalRef.current = setInterval(() => {
      const elapsed = (Date.now() - startTimeRef.current) / 1000;
      if (elapsed <= 0) return;
      const correct = correctCharsRef.current;
      const incorrect = incorrectCharsRef.current;
      const total = correct + incorrect;
      const wpm = Math.round(correct / 5 / (elapsed / 60));
      const rawWpm = Math.round(total / 5 / (elapsed / 60));
      const accuracy = total > 0 ? (correct / total) * 100 : 100;
      setWpmHistory((history) => [
        ...history,
        { time: elapsed, wpm, rawWpm, accuracy },
      ]);
    }, 500);

  }, [mode]);

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (gameState === 'idle' && e.target.value.length > 0) {
        startGameTimer();
      }

      if (gameState !== 'playing' && gameState !== 'idle') return;
      if (gameState === 'idle' && e.target.value.length === 0) return;

      const value = e.target.value;
      const currentWord = words[currentWordIndex];

      // Log each new character for anti-cheat replay
      const prevLen = lastInputLengthRef.current;
      if (value.length > prevLen) {
        // One or more characters were added
        for (let ci = prevLen; ci < value.length; ci++) {
          const newChar = value[ci];
          wsRef.current?.sendTypingKey(newChar);
        }
      } else if (value.length < prevLen) {
        // Backspace(s)
        for (let ci = 0; ci < prevLen - value.length; ci++) {
          wsRef.current?.sendTypingKey('\b');
        }
      }

      if (value.endsWith(' ')) {
        const typedWord = value.slice(0, -1);

        // Calculate correct/incorrect for this word
        let wordCorrect = 0;
        let wordIncorrect = 0;

        for (
          let i = 0;
          i < Math.max(typedWord.length, currentWord.length);
          i++
        ) {
          if (i < typedWord.length && i < currentWord.length) {
            if (typedWord[i] === currentWord[i]) {
              wordCorrect++;
            } else {
              wordIncorrect++;
            }
          } else if (i < typedWord.length) {
            wordIncorrect++;
          } else {
            wordIncorrect++;
          }
        }

        // Count space as correct if word was perfect
        if (typedWord === currentWord) {
          wordCorrect++;
        } else {
          wordIncorrect++;
        }

        // Save the typed word
        setWordInputHistory((prev) => {
          const newHistory = [...prev];
          newHistory[currentWordIndex] = typedWord;
          return newHistory;
        });

        setCorrectChars((prev) => {
          const newVal = prev + wordCorrect;
          correctCharsRef.current = newVal;
          return newVal;
        });
        setIncorrectChars((prev) => {
          const newVal = prev + wordIncorrect;
          incorrectCharsRef.current = newVal;
          return newVal;
        });
        wordsCompletedRef.current++;

        setCurrentWordIndex((prev) => prev + 1);
        setCurrentInput('');
        lastInputLengthRef.current = 0;
        return;
      }

      // Cap input length at word length + MAX_EXTRA_CHARS (like Monkeytype)
      const maxLength = currentWord.length + MAX_EXTRA_CHARS;
      const cappedValue = value.slice(0, maxLength);

      lastInputLengthRef.current = cappedValue.length;
      setCurrentInput(cappedValue);
    },
    [gameState, words, currentWordIndex, startGameTimer],
  );

  const restartGame = useCallback(() => {
    if (isStartingSession) return;
    const now = Date.now();
    if (now - lastRestartAtRef.current < 500) return;
    lastRestartAtRef.current = now;
    if (timerRef.current) clearInterval(timerRef.current);
    if (wpmIntervalRef.current) clearInterval(wpmIntervalRef.current);
    setSubmitError(null);
    resetRunResult();
    initializeGame(mode);
  }, [initializeGame, isStartingSession, mode, resetRunResult]);

  const typingSoundPitch = useCallback((key: string) => {
    if (key === ' ') return 0.82;
    if (key === 'Backspace') return 1.14;
    const code = key.codePointAt(0) ?? 0;
    return 0.94 + (code % 9) * 0.015;
  }, []);

  const playTypingSound = useCallback(
    (key: string, release = false) => {
      if (key !== 'Backspace' && key.length !== 1) return;
      SoundManager.play(release ? 'typingThockRelease' : 'typingThock', {
        volume: release ? 0.38 : key === ' ' ? 0.7 : 0.58,
        pitch: typingSoundPitch(key),
      });
    },
    [typingSoundPitch],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (
        (gameState === 'playing' || gameState === 'idle') &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.altKey
      ) {
        playTypingSound(e.key);
      }
      if (e.key === ' ') {
        e.preventDefault();
        if (gameState === 'playing' || gameState === 'idle') {
          const currentValue = inputRef.current?.value ?? '';
          const newValue = currentValue + ' ';
          handleInputChange({
            target: { value: newValue },
          } as React.ChangeEvent<HTMLInputElement>);
        }
      }
      if (
        e.key === 'Backspace' &&
        currentInput === '' &&
        currentWordIndex > 0
      ) {
        e.preventDefault();
        wsRef.current?.sendEvent('typing_prev_word');
        const prevWord = wordInputHistory[currentWordIndex - 1] || '';
        setCurrentWordIndex((prev) => prev - 1);
        setCurrentInput(prevWord);
        lastInputLengthRef.current = prevWord.length;
      }
    },
    [
      gameState,
      currentInput,
      handleInputChange,
      currentWordIndex,
      wordInputHistory,
      playTypingSound,
    ],
  );

  const handleKeyUp = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (
        (gameState === 'playing' || gameState === 'idle') &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.altKey
      ) {
        playTypingSound(e.key, true);
      }
    },
    [gameState, playTypingSound],
  );

  const changeMode = useCallback(
    (newMode: GameMode) => {
      if (gameState === 'playing') return;
      setMode(newMode);
      setTimeLeft(newMode);
      setSubmitError(null);
    },
    [gameState],
  );

  const copyResults = useCallback(() => {
    const text = `typing test results\n${finalWpm} wpm | ${finalRawWpm} raw | ${finalAccuracy.toFixed(1)}% acc | ${mode}s`;
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [finalWpm, finalRawWpm, finalAccuracy, mode]);

  // Prevent spacebar scroll
  useEffect(() => {
    const preventScroll = (e: KeyboardEvent) => {
      if ((gameState === 'playing' || gameState === 'idle') && e.key === ' ') {
        e.preventDefault();
      }
    };
    window.addEventListener('keydown', preventScroll);
    return () => window.removeEventListener('keydown', preventScroll);
  }, [gameState]);

  // Allow Tab restart from anywhere on the page (including inventory controls).
  useEffect(() => {
    const handleGlobalTabRestart = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      if (e.repeat) return;
      if (isStartingSession) return;
      e.preventDefault();
      restartGame();
    };
    window.addEventListener('keydown', handleGlobalTabRestart, { capture: true });
    return () =>
      window.removeEventListener('keydown', handleGlobalTabRestart, {
        capture: true,
      });
  }, [isStartingSession, restartGame]);

  // Initialize on mount
  useEffect(() => {
    initializeGame(mode);
  }, [initializeGame, mode]);

  // Fetch data on mode change
  useEffect(() => {
    fetchUserBestScore();
  }, [fetchUserBestScore]);

  // Cleanup
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (wpmIntervalRef.current) clearInterval(wpmIntervalRef.current);
      wsRef.current?.close();
    };
  }, []);

  const currentWpm = useMemo(() => {
    if (gameState !== 'playing') return 0;
    const elapsed = (Date.now() - startTimeRef.current) / 1000;
    if (elapsed <= 0) return 0;
    return Math.round(correctChars / 5 / (elapsed / 60));
  }, [gameState, correctChars]);

  const currentAccuracy = useMemo(() => {
    const total = correctChars + incorrectChars;
    if (total === 0) return 100;
    return (correctChars / total) * 100;
  }, [correctChars, incorrectChars]);

  const hudProgressPct = useMemo(() => {
    if (gameState === 'finished') return 100;
    if (gameState !== 'playing') return 0;
    const elapsed = Math.max(0, mode - timeLeft);
    return Math.max(0, Math.min(100, (elapsed / mode) * 100));
  }, [gameState, mode, timeLeft]);

  const hudFrameClass = useMemo(() => {
    if (typingTheme.hudFrameStyle === 'glass') return 'border backdrop-blur-sm';
    if (typingTheme.hudFrameStyle === 'terminal') return 'border border-dashed';
    if (typingTheme.hudFrameStyle === 'neon') return 'border-2';
    return 'border-2 inset-shadow-well';
  }, [typingTheme.hudFrameStyle]);

  const hudFrameStyle = useMemo(() => {
    if (typingTheme.hudFrameStyle === 'neon') {
      return {
        backgroundColor: typingTheme.hudSurfaceColor,
        borderColor: typingTheme.hudAccentColor,
        boxShadow: `0 0 ${Math.round(typingTheme.hudShadowStrength / 2)}px ${typingTheme.hudAccentColor}, 0 0 ${Math.round(typingTheme.hudShadowStrength / 4)}px ${typingTheme.hudAccentColor} inset`,
      };
    }
    if (typingTheme.hudFrameStyle === 'terminal') {
      return {
        backgroundColor: typingTheme.hudSurfaceColor,
        borderColor: typingTheme.hudBorderColor,
        backgroundImage:
          'repeating-linear-gradient(0deg, rgba(255,255,255,0.03) 0px, rgba(255,255,255,0.03) 1px, transparent 1px, transparent 3px)',
        boxShadow: `inset 0 0 ${Math.round(typingTheme.hudShadowStrength / 4)}px ${typingTheme.hudAccentColor}44`,
      };
    }
    if (typingTheme.hudFrameStyle === 'glass') {
      return {
        background: `linear-gradient(135deg, ${typingTheme.hudSurfaceColor}ee, ${typingTheme.hudSurfaceColor}aa)`,
        borderColor: typingTheme.hudBorderColor,
        boxShadow: `0 8px 24px ${typingTheme.hudAccentColor}22`,
      };
    }
    return {
      backgroundColor: typingTheme.hudSurfaceColor,
      borderColor: typingTheme.hudBorderColor,
    };
  }, [typingTheme]);

  const [hoveredPoint, setHoveredPoint] = useState<number | null>(null);

  const wordsContainerTypographyStyle = useMemo(
    () => ({
      fontFamily: getFontFamilyCss(typingTheme.textFontFamily),
      fontWeight: typingTheme.textFontWeight,
      letterSpacing: `${typingTheme.textLetterSpacing}px`,
      columnGap: `${typingTheme.textWordSpacing}px`,
      rowGap: `${Math.max(8, typingTheme.textWordSpacing - 3)}px`,
    }),
    [typingTheme],
  );
  const hudTypographyStyle = useMemo(
    () => ({
      fontFamily: getFontFamilyCss(typingTheme.hudFontFamily),
      fontWeight: typingTheme.hudFontWeight,
    }),
    [typingTheme.hudFontFamily, typingTheme.hudFontWeight],
  );

  const feedbackCharStyle = useCallback(
    (isMiss: boolean) => {
      if (!isMiss || typingTheme.feedbackStyle === 'none') return undefined;
      const duration = Math.max(80, typingTheme.feedbackDurationMs);
      const strength = Math.max(0, typingTheme.feedbackStrength);
      const base: Record<string, string | number> = {
        transitionDuration: `${duration}ms`,
      };

      if (typingTheme.feedbackStyle === 'underline') {
        return {
          ...base,
          borderBottom: `2px solid ${typingTheme.missEffectColor}`,
        };
      }
      if (typingTheme.feedbackStyle === 'shake') {
        return {
          ...base,
          display: 'inline-block',
          animation: `typingFeedbackShake ${duration}ms ease-in-out 1`,
        };
      }
      if (typingTheme.feedbackStyle === 'flash') {
        return {
          ...base,
          display: 'inline-block',
          animation: `typingFeedbackFlash ${duration}ms ease-in-out 1`,
        };
      }
      return {
        ...base,
        display: 'inline-block',
        textShadow: `0 0 ${4 + Math.round(strength / 6)}px ${typingTheme.missEffectColor}, 0 0 ${8 + Math.round(strength / 4)}px ${typingTheme.missEffectColor}`,
        animation: typingTheme.feedbackParticlesEnabled
          ? `typingFeedbackParticlePulse ${duration}ms ease-in-out 1`
          : undefined,
      };
    },
    [
      typingTheme.feedbackDurationMs,
      typingTheme.feedbackParticlesEnabled,
      typingTheme.feedbackStrength,
      typingTheme.feedbackStyle,
      typingTheme.missEffectColor,
    ],
  );

  const renderGraph = useCallback(() => {
    if (wpmHistory.length < 2) return null;

    const chartWidth = 860;
    const chartHeight = 280;
    const padding = { top: 20, right: 24, bottom: 34, left: 46 };
    const plotLeft = padding.left;
    const plotRight = chartWidth - padding.right;
    const plotTop = padding.top;
    const plotBottom = chartHeight - padding.bottom;
    const plotWidth = plotRight - plotLeft;
    const plotHeight = plotBottom - plotTop;

    const maxWpm = Math.max(
      ...wpmHistory.map((p) => Math.max(p.wpm || 0, p.rawWpm || 0)),
      1,
    );
    const yMax = Math.max(20, Math.ceil((maxWpm * 1.15) / 5) * 5);
    const ySpan = Math.max(1, yMax);

    const getX = (index: number) =>
      plotLeft + (plotWidth * index) / Math.max(1, wpmHistory.length - 1);
    const getY = (value: number) =>
      plotTop + ((yMax - Math.max(0, value)) / ySpan) * plotHeight;

    const graphPoints = wpmHistory.map((point, index) => ({
      ...point,
      x: getX(index),
      wpmY: getY(point.wpm),
      rawY: getY(point.rawWpm),
    }));

    const wpmLinePath = graphPoints
      .map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.wpmY}`)
      .join(' ');
    const rawLinePath = graphPoints
      .map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.rawY}`)
      .join(' ');

    const yTicks = Array.from({ length: 5 }, (_, index) => {
      const value = Math.round(yMax - (index * ySpan) / 4);
      const y = getY(value);
      return { value, y };
    });
    const xTicks = Array.from({ length: 5 }, (_, index) => {
      const ratio = index / 4;
      const pointIndex = Math.round(ratio * (graphPoints.length - 1));
      const point = graphPoints[pointIndex];
      return {
        x: point.x,
        label: `${Math.round(point.time)}s`,
      };
    });

    const hoveredData =
      hoveredPoint !== null && hoveredPoint >= 0 && hoveredPoint < graphPoints.length
        ? graphPoints[hoveredPoint]
        : null;

    return (
      <div className='arcade-card-inset relative mt-4 p-3'>
        <div className='arcade-kicker mb-2 text-left'>Wpm timeline</div>
        <svg
          className='h-52 w-full'
          viewBox={`0 0 ${chartWidth} ${chartHeight}`}
          preserveAspectRatio='none'
          role='img'
          aria-label='Typing speed trend graph'
        >
          {yTicks.map((tick) => (
            <g key={`y-tick-${tick.value}`}>
              <line
                x1={plotLeft}
                y1={tick.y}
                x2={plotRight}
                y2={tick.y}
                style={{ stroke: 'var(--border-soft)' }}
                strokeDasharray='3 6'
              />
              <text
                x={plotLeft - 8}
                y={tick.y + 4}
                textAnchor='end'
                fontSize='11'
                style={{ fill: 'var(--text-muted)' }}
              >
                {tick.value}
              </text>
            </g>
          ))}

          {xTicks.map((tick, index) => (
            <g key={`x-tick-${index}`}>
              <line
                x1={tick.x}
                y1={plotTop}
                x2={tick.x}
                y2={plotBottom}
                style={{ stroke: 'var(--border-soft)' }}
                strokeDasharray='2 8'
              />
              <text
                x={tick.x}
                y={plotBottom + 16}
                textAnchor='middle'
                fontSize='11'
                style={{ fill: 'var(--text-muted)' }}
              >
                {tick.label}
              </text>
            </g>
          ))}

          <line
            x1={plotLeft}
            y1={plotTop}
            x2={plotLeft}
            y2={plotBottom}
            style={{ stroke: 'var(--border-soft)' }}
            strokeWidth='1.5'
          />
          <line
            x1={plotLeft}
            y1={plotBottom}
            x2={plotRight}
            y2={plotBottom}
            style={{ stroke: 'var(--border-soft)' }}
            strokeWidth='1.5'
          />

          <path
            d={rawLinePath}
            fill='none'
            style={{ stroke: 'var(--text-muted)' }}
            strokeWidth='2'
            strokeDasharray='5 6'
            strokeLinecap='round'
            strokeLinejoin='round'
          />
          <path
            d={wpmLinePath}
            fill='none'
            style={{ stroke: typingTheme.hudAccentColor }}
            strokeWidth='3'
            strokeLinecap='round'
            strokeLinejoin='round'
          />

          {graphPoints.map((point, index) => {
            const isHovered = hoveredPoint === index;
            return (
              <g key={`graph-point-${index}`}>
                <circle
                  cx={point.x}
                  cy={point.wpmY}
                  r={isHovered ? 6 : 4}
                  style={{
                    fill: isHovered
                      ? 'var(--text-strong)'
                      : typingTheme.hudAccentColor,
                    stroke: typingTheme.hudAccentColor,
                  }}
                  strokeWidth={isHovered ? 3 : 2}
                  className='cursor-pointer transition-all duration-150'
                  onMouseEnter={() => setHoveredPoint(index)}
                  onMouseLeave={() => setHoveredPoint((current) => (current === index ? null : current))}
                  onFocus={() => setHoveredPoint(index)}
                  onBlur={() => setHoveredPoint((current) => (current === index ? null : current))}
                  tabIndex={0}
                >
                  <title>{`${point.wpm} WPM | ${point.rawWpm} raw | ${point.accuracy.toFixed(1)}% @ ${Math.round(point.time)}s`}</title>
                </circle>
              </g>
            );
          })}
        </svg>

        {hoveredData && (
          <div
            className='pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-tag border-2 border-ink bg-raised px-3 py-2 text-left text-xs text-body shadow-chip'
            style={{
              left: `${(hoveredData.x / chartWidth) * 100}%`,
              top: `${(hoveredData.wpmY / chartHeight) * 100}%`,
            }}
          >
            <div className='arcade-num leading-relaxed'>
              <div className='font-semibold' style={{ color: typingTheme.hudAccentColor }}>
                {hoveredData.wpm} wpm
              </div>
              <div className='text-body'>{hoveredData.rawWpm} raw</div>
              <div className='text-faint'>{hoveredData.accuracy.toFixed(1)}% acc</div>
              <div className='text-faint'>{Math.round(hoveredData.time)}s</div>
            </div>
          </div>
        )}
      </div>
    );
  }, [hoveredPoint, typingTheme.hudAccentColor, wpmHistory]);

  // Focus input when clicking anywhere
  const handleContainerClick = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      const target = event.target as HTMLElement | null;
      if (!target) return;
      if (
        target.closest(
          'input, textarea, select, option, button, a, label, details, summary, [role="button"], [data-no-typing-focus]',
        )
      ) {
        return;
      }
      const activeElement = document.activeElement;
      if (activeElement instanceof HTMLElement && activeElement !== document.body) {
        activeElement.blur();
      }
      setShowInventory(false);
      inputRef.current?.focus({ preventScroll: true });
    },
    [],
  );

  useEffect(() => {
    if (!banUntilMs && !sessionRetryUntilMs) return;
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
  }, [banUntilMs, sessionRetryUntilMs]);

  useEffect(() => {
    if (!showInventory) {
      void loadTypingTheme();
    }
  }, [loadTypingTheme, showInventory]);

  useEffect(() => {
    const handleInventoryUpdate = () => {
      void loadTypingTheme();
    };
    window.addEventListener('store-inventory-updated', handleInventoryUpdate);
    return () => {
      window.removeEventListener(
        'store-inventory-updated',
        handleInventoryUpdate,
      );
    };
  }, [loadTypingTheme]);

  useEffect(() => {
    if (!banUntilMs) return;
    if (banNowMs >= banUntilMs) {
      setBanUntilMs(null);
      setBanIndefinite(false);
    }
  }, [banNowMs, banUntilMs]);

  useEffect(() => {
    if (!sessionRetryUntilMs) return;
    if (banNowMs >= sessionRetryUntilMs) {
      setSessionRetryUntilMs(null);
    }
  }, [banNowMs, sessionRetryUntilMs]);

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
      className='flex min-h-[calc(100vh-3.5rem)] min-h-[calc(100dvh-3.5rem)] select-none flex-col items-center justify-start bg-background px-3 pt-3 pb-[calc(5.5rem+env(safe-area-inset-bottom))] sm:justify-center sm:p-5'
      onClick={handleContainerClick}
    >
      {/* Hidden input — positioned off-screen but not display:none so the
          mobile keyboard stays attached. Additional attributes disable
          predictive text, autocorrect, and autocomplete across iOS & Android. */}
      <input
        ref={inputRef}
        type='text'
        value={currentInput}
        onChange={handleInputChange}
        onKeyDown={handleKeyDown}
        onKeyUp={handleKeyUp}
        aria-label='Typing test input'
        className='absolute opacity-0 pointer-events-none'
        style={{ position: 'absolute', left: -9999, top: -9999, width: 1, height: 1 }}
        autoComplete='off'
        autoCapitalize='off'
        autoCorrect='off'
        spellCheck={false}
        data-gramm='false'
        data-gramm_editor='false'
        data-enable-grammarly='false'
        enterKeyHint='next'
        inputMode='text'
      />

      <div className='w-full max-w-7xl px-0 sm:px-6 lg:px-8'>
        {/* Header */}
        <div className='mb-3 sm:mb-8 lg:mb-12'>
          <div className='hidden sm:block'>
            <PageHeader
              eyebrow='Arcade'
              icon='keyboard'
              title='Typing Test'
              subtitle='Sharpen speed and accuracy across timed modes.'
              wallet={walletCard}
            />
          </div>
          <div className='sm:hidden'>
            <GamesWalletCard wallet={walletCard} compact />
          </div>
        </div>
        <div className='mb-4 sm:mb-6'>
          <GamesRouteSwitcher />
        </div>

        {/* Stats bar */}
        {gameState !== 'finished' && (
        <div
          className={`tt-hud mb-3 rounded-well px-3 py-3 sm:mb-5 sm:px-4 sm:py-4 ${
            typingTheme.hudFrameStyle === 'minimal' ? '' : hudFrameClass
          }`}
          style={
            typingTheme.hudFrameStyle === 'minimal'
              ? hudTypographyStyle
              : { ...hudFrameStyle, ...hudTypographyStyle }
          }
        >
        <div className='flex h-14 items-center justify-center gap-3 sm:gap-6 md:gap-8 lg:gap-10'>
          <div className='tt-stat-cell text-center'>
            <div
              className='arcade-num text-2xl sm:text-3xl lg:text-4xl font-bold transition-colors duration-200'
              style={{
                color: typingTheme.hudAccentColor,
              }}
            >
              {gameState === 'playing' ? timeLeft : mode}
            </div>
            <div
              className='arcade-kicker mt-1'
              style={{ color: typingTheme.hudTextColor, opacity: 0.6 }}
            >
              seconds
            </div>
          </div>
          <div className='tt-stat-cell text-center'>
            <div
              className='arcade-num text-2xl sm:text-3xl lg:text-4xl font-bold transition-colors duration-200'
              style={{
                color: typingTheme.hudTextColor,
              }}
            >
              {gameState === 'playing' ? currentWpm : '-'}
            </div>
            <div
              className='arcade-kicker mt-1'
              style={{ color: typingTheme.hudTextColor, opacity: 0.6 }}
            >
              wpm
            </div>
          </div>
          <div className='tt-stat-cell text-center'>
            <div
              className='arcade-num text-2xl sm:text-3xl lg:text-4xl font-bold transition-colors duration-200'
              style={{
                color: typingTheme.hudTextColor,
              }}
            >
              {gameState === 'playing' ? `${currentAccuracy.toFixed(0)}%` : '-'}
            </div>
            <div
              className='arcade-kicker mt-1'
              style={{ color: typingTheme.hudTextColor, opacity: 0.6 }}
            >
              accuracy
            </div>
          </div>
        </div>
        {typingTheme.hudMeterStyle !== 'none' ? (
          <div className='mt-3 flex items-center justify-center'>
            {typingTheme.hudMeterStyle === 'ring' ? (
              <svg width='34' height='34' viewBox='0 0 36 36'>
                <circle
                  cx='18'
                  cy='18'
                  r='15'
                  fill='none'
                  stroke={`${typingTheme.hudTextColor}33`}
                  strokeWidth='4'
                />
                <circle
                  cx='18'
                  cy='18'
                  r='15'
                  fill='none'
                  stroke={typingTheme.hudAccentColor}
                  strokeWidth='4'
                  strokeDasharray={`${(hudProgressPct / 100) * 94.2} 94.2`}
                  transform='rotate(-90 18 18)'
                  strokeLinecap='round'
                />
              </svg>
            ) : (
              <div className='h-2 w-full overflow-hidden rounded-full bg-well'>
                  <div
                    className={
                      typingTheme.hudMeterStyle === 'pulse'
                        ? 'hud-pulse-progress'
                        : ''
                    }
                    style={{
                      width: `${hudProgressPct}%`,
                      height: '100%',
                      backgroundColor: typingTheme.hudAccentColor,
                      color: typingTheme.hudAccentColor,
                    }}
                  />
                </div>
            )}
          </div>
        ) : null}
        </div>
        )}

        {isStartingSession && (
          <div className='mb-6 text-center text-sm text-faint'>
            Starting your run…
          </div>
        )}

        {/* Words display - Monkeytype style, framed in a lacquered cabinet well */}
        {(gameState === 'idle' || gameState === 'playing') && (
          <div className='tt-well-frame mb-4 flex flex-col items-stretch p-2.5 sm:mb-8 sm:p-3'>
          <div className='relative mb-2 flex min-h-11 items-center justify-center'>
            <span className='tt-well-tab'>{mode}s sprint</span>
            <div className='absolute right-0 flex items-center gap-1.5' data-no-typing-focus>
              <span className='hidden text-[10px] uppercase tracking-[0.12em] text-faint sm:inline'>
                thock
              </span>
              <MuteButton />
            </div>
          </div>
          <div
            className='tt-well-screen tt-words-viewport relative h-[158px] overflow-hidden rounded-well border-2 px-3 py-3 sm:h-[192px] lg:h-[230px]'
            data-scrolled={isWordsScrolled}
            style={{
              borderColor: typingTheme.panelBorder,
              backgroundColor: typingTheme.panelBg,
            }}
          >
            <div
              ref={wordsContainerRef}
              className='tt-words-track relative flex flex-wrap content-start gap-x-2 gap-y-2 font-mono text-[22px] leading-[1.55] sm:gap-x-3 sm:gap-y-3 sm:text-[28px] md:gap-x-4 md:gap-y-4 lg:text-[32px]'
              style={{ ...wordsContainerTypographyStyle, ...wordsScrollStyle }}
            >
              {/* Single smooth caret */}
              <Caret
                wordsContainerRef={wordsContainerRef}
                currentWordIndex={currentWordIndex}
                currentInputLength={currentInput.length}
                caretColor={typingTheme.caretColor}
                caretType={typingTheme.caretType}
                caretThickness={typingTheme.caretThickness}
                caretGlowStrength={typingTheme.caretGlowStrength}
                caretPulseMode={typingTheme.caretPulseMode}
                caretTrailEnabled={typingTheme.caretTrailEnabled}
              />

              {words.map((word, wordIndex) => {
                const isActive = wordIndex === currentWordIndex;
                const isTyped = wordIndex < currentWordIndex;
                const typedInput = isActive
                  ? currentInput
                  : wordInputHistory[wordIndex] || '';

                return (
                  <span
                    key={wordIndex}
                    data-word-index={wordIndex}
                    className={`tt-word relative ${
                      isActive ? 'word-active tt-word-active' : ''
                    } ${isTyped ? 'tt-word-complete opacity-60' : 'opacity-100'}`}
                    style={
                      isActive
                        ? (() => {
                            const alpha = Math.max(
                              0.08,
                              Math.min(
                                0.7,
                                typingTheme.textCurrentWordStrength / 100,
                              ),
                            );
                            if (typingTheme.textCurrentWordStyle === 'underline') {
                              return {
                                textDecoration: `underline 2px ${typingTheme.textCurrentWordColor}`,
                                textUnderlineOffset: '0.24em',
                              };
                            }
                            if (typingTheme.textCurrentWordStyle === 'box') {
                              return {
                                borderRadius: '0.35rem',
                                backgroundColor: `${typingTheme.textCurrentWordColor}${Math.round(alpha * 255)
                                  .toString(16)
                                  .padStart(2, '0')}`,
                                boxShadow: `0 0 0 3px ${typingTheme.textCurrentWordColor}${Math.round(alpha * 160)
                                  .toString(16)
                                  .padStart(2, '0')}`,
                              };
                            }
                            if (typingTheme.textCurrentWordStyle === 'glow') {
                              return {
                                textShadow: `0 0 ${Math.round(typingTheme.textCurrentWordStrength / 8) + 4}px ${typingTheme.textCurrentWordColor}`,
                              };
                            }
                            return undefined;
                          })()
                        : undefined
                    }
                  >
                    {word.split('').map((char, charIndex) => {
                      let colorValue = typingTheme.textColor;
                      let isMissChar = false;

                      if (isTyped || isActive) {
                        if (charIndex < typedInput.length) {
                          if (typedInput[charIndex] === char) {
                            colorValue = typingTheme.correctColor;
                          } else {
                            colorValue = typingTheme.errorColor;
                            isMissChar = true;
                          }
                        } else if (isTyped) {
                          colorValue = typingTheme.missEffectColor;
                          isMissChar = true;
                        }
                      }

                      return (
                        <span
                          key={charIndex}
                          data-char-index={charIndex}
                          className={`tt-char ${
                            isActive && charIndex === typedInput.length - 1
                              ? isMissChar
                                ? 'tt-char-impact-error'
                                : 'tt-char-impact'
                              : ''
                          }`}
                          style={{
                            color: colorValue,
                            ...feedbackCharStyle(isMissChar),
                          }}
                        >
                          {char}
                        </span>
                      );
                    })}

                    {/* Extra typed characters - capped at MAX_EXTRA_CHARS */}
                    {(isActive || isTyped) &&
                      typedInput.length > word.length && (
                        <span
                          className='transition-colors duration-100 ease-out'
                          style={{ color: typingTheme.missEffectColor }}
                        >
                          {typedInput
                            .slice(word.length, word.length + MAX_EXTRA_CHARS)
                            .split('')
                            .map((char, i) => (
                              <span
                                key={i}
                                data-extra-index={i}
                                className={
                                  isActive &&
                                  word.length + i === typedInput.length - 1
                                    ? 'tt-char-impact-error'
                                    : undefined
                                }
                                style={feedbackCharStyle(true)}
                              >
                                {char}
                              </span>
                            ))}
                        </span>
                      )}
                  </span>
                );
              })}
            </div>

            {/* A shallow fade hints that more text continues without hiding the read-ahead row. */}
            <div
              className='pointer-events-none absolute right-0 bottom-0 left-0 h-6'
              style={{
                background: `linear-gradient(transparent, ${typingTheme.panelBg})`,
              }}
            />
          </div>
          </div>
        )}

        {/* Results */}
        {gameState === 'finished' && (
          <div className='text-center py-8 animate-in fade-in duration-300'>
            {isNewPB && (
              <div className='mb-6'>
                <span className='arcade-kicker rounded-tag border-2 border-ink bg-prize px-2.5 py-1 text-prize-on shadow-chip'>
                  New personal best
                </span>
              </div>
            )}

            <div className='mx-auto mb-8 grid max-w-xl grid-cols-3 gap-3'>
              <div className='tt-result-plate' data-accent>
                <div
                  className='arcade-num text-3xl font-bold sm:text-5xl'
                  style={{ color: typingTheme.hudAccentColor }}
                >
                  {finalWpm}
                </div>
                <div className='arcade-kicker mt-2'>wpm</div>
              </div>
              <div className='tt-result-plate'>
                <div
                  className='arcade-num text-3xl font-bold sm:text-5xl'
                  style={{ color: typingTheme.hudTextColor }}
                >
                  {finalRawWpm}
                </div>
                <div className='arcade-kicker mt-2'>raw</div>
              </div>
              <div className='tt-result-plate'>
                <div
                  className='arcade-num text-3xl font-bold sm:text-5xl'
                  style={{ color: typingTheme.hudTextColor }}
                >
                  {finalAccuracy.toFixed(1)}%
                </div>
                <div className='arcade-kicker mt-2'>accuracy</div>
              </div>
            </div>

            {renderGraph()}

            <div className='flex justify-center gap-3 mt-8'>
              <ArcadeButton
                tone='primary'
                size='md'
                onClick={restartGame}
              >
                <RotateCcw size={15} />
                Go again
              </ArcadeButton>
              <ArcadeButton
                tone='ghost'
                onClick={copyResults}
              >
                {copied ? <Check size={15} /> : <Share2 size={15} />}
                {copied ? 'Copied' : 'Share'}
              </ArcadeButton>
            </div>
            <ArcadeRunRewards
              reward={runReward}
              achievements={runAchievements}
              error={submitError}
              guest={isGuestRunRef.current}
              className='mx-auto mt-4 max-w-md'
            />
          </div>
        )}

        {/* Error state */}
        {gameState === 'error' && (
          <div className='text-center py-8 animate-in fade-in duration-300'>
            <div className='mb-4 text-xl font-semibold text-danger-text'>
              Connection dropped
            </div>
            <p className='text-body mb-6 text-sm'>
              {startError ?? 'The run could not reach the game server.'}
            </p>
            {(banIndefinite || banUntilMs) && (
              <p className='text-tickets-text text-xs mb-6'>
                {banIndefinite
                  ? 'You are banned from games until an admin unbans you.'
                  : <>Ban time left: <span className='arcade-num'>{formatBanCountdown(banUntilMs!)}</span></>}
              </p>
            )}
            {!banIndefinite && !banUntilMs && sessionRetryUntilMs && (
              <p className='text-tickets-text text-xs mb-6'>
                Retry available in <span className='arcade-num'>{formatBanCountdown(sessionRetryUntilMs)}</span>
              </p>
            )}
            <div className='flex justify-center'>
              <ArcadeButton
                tone='primary'
                size='md'
                onClick={restartGame}
              >
                <RotateCcw size={15} />
                Retry
              </ArcadeButton>
            </div>
          </div>
        )}

        {/* Footer hints */}
        <div className='mt-5 flex w-full items-center gap-4 overflow-x-auto py-1 text-sm text-faint sm:mt-10'>
          {gameState === 'idle' && <span>Start typing to begin</span>}
          {isStartingSession && (
            <span className='text-faint'>Connecting…</span>
          )}
          {gameState !== 'finished' && gameState !== 'error' && (
            <button
              type='button'
              onClick={restartGame}
              className='flex items-center gap-1.5 transition-colors hover:text-body'
            >
              <RotateCcw size={14} />
              <span>Tab restarts</span>
            </button>
          )}
          <GameLeaderboardButton
            onClick={() => setShowLeaderboard(true)}
            label='Leaderboard'
            iconSize={14}
            tone='ghost'
            size='xs'
            className='shrink-0'
          />
          <GameInventoryButton
            onClick={() => togglePanelWithoutScrollJump(setShowInventory)}
            label='Inventory'
            iconSize={14}
            tone='ghost'
            size='xs'
            className='shrink-0'
          />
          {highScore[mode] > 0 && (
            <span className='text-faint'>
              Best{' '}
              <span className='arcade-num font-semibold text-tickets-text'>
                {highScore[mode]}
              </span>
            </span>
          )}
          <div className='ml-auto flex shrink-0 gap-1.5'>
            {([15, 30, 60] as GameMode[]).map((m) => (
              <button
                type='button'
                key={m}
                onClick={() => changeMode(m)}
                disabled={gameState === 'playing'}
                data-active={mode === m}
                className='tt-mode'
              >
                {m}
              </button>
            ))}
          </div>
        </div>

      </div>

      <GameLeaderboardModal
        open={showLeaderboard}
        onOpenChange={setShowLeaderboard}
        title={`Typing Test Leaderboard (${mode}s)`}
        description='Top typing runs for the selected timer mode.'
      >
        <GameLeaderboard
          gameType='typing-test'
          mode={mode}
          modes={TIMER_BOARD_MODES}
          refreshKey={leaderboardRefreshKey}
        />
      </GameLeaderboardModal>

      <div data-no-typing-focus>
        <GameInventoryModal
          open={showInventory}
          onOpenChange={setShowInventory}
          gameType='typing-test'
          title='Typing Test Inventory'
          description='Customize theme, caret, text style, and feedback.'
        />
      </div>
    </div>
  );
}
