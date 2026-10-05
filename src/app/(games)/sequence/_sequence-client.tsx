'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { Brain, CircleHelp } from 'lucide-react';
import { ArcadeButton } from '@/features/arcade/components/ui/arcade-ui';
import { GameLeaderboard } from '@/features/arcade/components/game-leaderboard';
import { GameLeaderboardModal } from '@/features/arcade/components/game-leaderboard-modal';
import { GameLeaderboardButton } from '@/features/arcade/components/game-leaderboard-button';
import { PageHeader, GamesWalletCard } from '@/features/arcade/components/shell/page-header';
import { MuteButton } from '@/features/arcade/components/mute-button';
import { EnvMonitor } from '@/features/arcade/lib/game-anti-cheat';
import { connectGameWs, type GameWsHandle } from '@/features/arcade/lib/game-ws';
import { usePreventGameGestures, useIsTouchDevice } from '@/features/arcade/lib/game-mobile-utils';
import { SoundManager } from '@/features/arcade/lib/sound-manager';
import { ArcadeRunRewards } from '@/features/arcade/components/results/arcade-run-result';
import { useArcadeRunResult } from '@/features/arcade/lib/run-result';
import type { AccountXpReward } from '@/server/arcade/rewards/types';

import './_sequence-midway.css';
import {
  type SequenceCosmeticTheme,
  type InventoryCosmeticResponse,
  DEFAULT_SEQUENCE_THEME,
  buildSequenceTheme,
  toSequenceCssVars,
} from './_sequence-theme';

const PAD_COUNT = 4;
// Theoretical sequence ceiling — matches the score cap; we never need more pads.
const MAX_SEQUENCE = 100;

// Flash timing for the sequence playback (purely presentational; the score is
// the player's input, never the playback). Slows nothing about the sim.
const FLASH_ON_MS = 440;
const FLASH_GAP_MS = 220;
const PRE_SHOW_DELAY_MS = 620; // beat before a round's playback starts
const RESTART_GRACE_PERIOD = 500;

// One pad = one tone. Four DISTINCT existing SoundManager sounds, ordered low→
// high so the pads are audibly distinguishable (see notes in requirements).
const PAD_SOUNDS = ['arcadeReelStop', 'arcadeBet', 'arcadeReveal', 'coinCorrect'] as const;

const PADS = [
  { id: 0, key: 'red', label: 'Red' },
  { id: 1, key: 'amber', label: 'Amber' },
  { id: 2, key: 'teal', label: 'Teal' },
  { id: 3, key: 'blue', label: 'Blue' },
] as const;

const REWARDS_HINT_TEXT =
  'Rewards hint: longer sequences earn more tickets. Score = the longest sequence you repeat correctly. Rewards taper at higher scores.';

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

type GameState = 'idle' | 'showing' | 'input' | 'gameover' | 'error';

export default function SequenceMemoryPage() {
  const [gameState, setGameState] = useState<GameState>('idle');
  const [score, setScore] = useState(0);
  const [round, setRound] = useState(0);
  const [highScore, setHighScore] = useState(0);
  const [activePad, setActivePad] = useState<number | null>(null);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const [walletBalances, setWalletBalances] = useState({ credits: 0 });
  const [dailyCreditsProgress, setDailyCreditsProgress] = useState({
    earned: 0,
    cap: 300,
  });
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
  const [theme, setTheme] = useState<SequenceCosmeticTheme>(
    DEFAULT_SEQUENCE_THEME,
  );
  const bestScoreCacheRef = useRef<number | null>(null);

  usePreventGameGestures(gameState === 'showing' || gameState === 'input');

  const touchDevice = useIsTouchDevice();

  // Mirror state for the timeout/handler closures that fire asynchronously.
  const gameStateRef = useRef<GameState>('idle');
  const sessionTokenRef = useRef<string | null>(null);
  const envMonitorRef = useRef(new EnvMonitor());
  const isStartingRef = useRef(false);
  const isGuestRunRef = useRef(false);
  const wsRef = useRef<GameWsHandle | null>(null);
  const gameStartTimeRef = useRef(0);
  const seedRef = useRef<number | null>(null);

  // The full deterministic sequence (built once from the seed); round N uses
  // the first N entries. We grow the visible length each completed round.
  const sequenceRef = useRef<number[]>([]);
  const roundRef = useRef(0); // current round length being shown / repeated
  const scoreRef = useRef(0);
  const inputPosRef = useRef(0); // next position in this round the player must hit
  const acceptingInputRef = useRef(false);
  const lastTapTimeRef = useRef(0);
  const flashTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const gameOverTimeRef = useRef(0);
  const saveScoreRef = useRef<((score: number) => Promise<void>) | null>(null);
  const beginRoundRef = useRef<(() => void) | null>(null);

  const clearFlashTimers = useCallback(() => {
    for (const timer of flashTimersRef.current) clearTimeout(timer);
    flashTimersRef.current = [];
  }, []);

  // mulberry32 — byte-identical to createSeededRng in sequence-replay.ts.
  const buildSequence = useCallback((seed: number, length: number): number[] => {
    let state = seed >>> 0;
    const nextRandom = () => {
      state += 0x6d2b79f5;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const pads: number[] = [];
    for (let i = 0; i < length; i += 1) {
      pads.push(Math.floor(nextRandom() * PAD_COUNT));
    }
    return pads;
  }, []);

  const fetchUserBestScore = useCallback(async () => {
    if (bestScoreCacheRef.current !== null) {
      setHighScore(bestScoreCacheRef.current);
      return;
    }
    try {
      const response = await fetch('/api/games/sequence/score', {
        cache: 'no-store',
      });
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
      const response = await fetch('/api/store/inventory?gameType=sequence', {
        cache: 'no-store',
      });
      if (!response.ok) return;
      const payload = (await response.json()) as InventoryCosmeticResponse;
      setWalletBalances({ credits: payload.wallet?.credits ?? 0 });
      setDailyCreditsProgress({
        earned: payload.dailyGameCredits?.earned ?? 0,
        cap: payload.dailyGameCredits?.cap ?? 300,
      });
      setTheme(buildSequenceTheme(payload));
    } catch {
      /* wallet + theme are best-effort; keep the stock default look */
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

  const playPadTone = useCallback((pad: number) => {
    SoundManager.play(PAD_SOUNDS[pad] ?? PAD_SOUNDS[0]);
  }, []);

  const saveScore = async (finalScore: number) => {
    if (isGuestRunRef.current) {
      setRunRewardMessage('Guest run — sign in to save scores and earn tickets.');
      setRunAccountXp(null);
      setRunRewardIsCapHit(false);
      return;
    }
    if (finalScore <= 0 || !sessionTokenRef.current) return;

    envMonitorRef.current.stop();
    setSubmitError(null);
    setRunRewardMessage(null);
    setRunAccountXp(null);
    setRunRewardIsCapHit(false);
    setIsSubmitting(true);
    try {
      const response = await fetch('/api/games/sequence/score', {
        method: 'POST',
        keepalive: true,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          score: finalScore,
          sessionToken: sessionTokenRef.current,
          clientDurationMs: Math.max(
            0,
            performance.now() - gameStartTimeRef.current,
          ),
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
        console.error(`[Sequence] Score rejected (${response.status}): ${reason}`);
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

  const endRun = useCallback(() => {
    clearFlashTimers();
    acceptingInputRef.current = false;
    setActivePad(null);
    wsRef.current?.close();
    gameStateRef.current = 'gameover';
    setGameState('gameover');
    gameOverTimeRef.current = performance.now();
    SoundManager.play('arcadeLose');
    if (scoreRef.current > highScore) {
      setHighScore(scoreRef.current);
    }
    saveScoreRef.current?.(scoreRef.current);
  }, [clearFlashTimers, highScore]);

  // Play back the current round's sequence (presentational), then hand control
  // to the player. Uses chained timeouts; all are tracked so a restart cancels
  // them. Honors reduced motion by using a brief static highlight beat.
  const playbackRound = useCallback(() => {
    clearFlashTimers();
    acceptingInputRef.current = false;
    setActivePad(null);
    const length = roundRef.current;
    const seq = sequenceRef.current;
    const onMs = prefersReducedMotion ? 300 : FLASH_ON_MS;
    const gapMs = prefersReducedMotion ? 300 : FLASH_GAP_MS;

    let cursor = PRE_SHOW_DELAY_MS;
    for (let i = 0; i < length; i += 1) {
      const pad = seq[i]!;
      const onAt = cursor;
      const offAt = cursor + onMs;
      flashTimersRef.current.push(
        setTimeout(() => {
          if (gameStateRef.current !== 'showing') return;
          setActivePad(pad);
          playPadTone(pad);
        }, onAt),
      );
      flashTimersRef.current.push(
        setTimeout(() => {
          if (gameStateRef.current !== 'showing') return;
          setActivePad(null);
        }, offAt),
      );
      cursor = offAt + gapMs;
    }

    // Hand off to input after the last pad turns off.
    flashTimersRef.current.push(
      setTimeout(() => {
        if (gameStateRef.current !== 'showing') return;
        inputPosRef.current = 0;
        acceptingInputRef.current = true;
        gameStateRef.current = 'input';
        setGameState('input');
      }, cursor),
    );
  }, [clearFlashTimers, prefersReducedMotion, playPadTone]);

  const beginRound = useCallback(() => {
    // Grow the sequence by one and replay from the start.
    roundRef.current += 1;
    if (roundRef.current > MAX_SEQUENCE) {
      // Theoretical ceiling reached — bank it as a win.
      endRun();
      return;
    }
    setRound(roundRef.current);
    gameStateRef.current = 'showing';
    setGameState('showing');
    playbackRound();
  }, [endRun, playbackRound]);
  beginRoundRef.current = beginRound;

  const handlePadPress = useCallback(
    (pad: number) => {
      if (!acceptingInputRef.current) return;
      if (gameStateRef.current !== 'input') return;

      // Enforce a client-side minimum interval comfortably above the server's
      // 70ms tap floor so legit taps are never dropped as "too fast".
      const now = performance.now();
      if (now - lastTapTimeRef.current < 90) return;
      lastTapTimeRef.current = now;

      const position = inputPosRef.current;
      const expected = sequenceRef.current[position];

      // Visual + audio feedback for the player's own tap.
      setActivePad(pad);
      playPadTone(pad);
      window.setTimeout(() => {
        setActivePad((current) => (current === pad ? null : current));
      }, prefersReducedMotion ? 220 : 160);

      // Stream the tap to the server (1-based round, 0-based index, pad 0..3).
      wsRef.current?.sendEvent('tap', {
        t: Math.max(0, now - gameStartTimeRef.current),
        round: roundRef.current,
        index: position,
        pad,
      });

      if (pad !== expected) {
        // Wrong pad — run ends; score stays at the last completed round.
        acceptingInputRef.current = false;
        endRun();
        return;
      }

      inputPosRef.current += 1;
      if (inputPosRef.current >= roundRef.current) {
        // Round completed correctly — this becomes the score, then grow.
        acceptingInputRef.current = false;
        scoreRef.current = roundRef.current;
        setScore(scoreRef.current);
        SoundManager.play('arcadeWin');
        const delay = prefersReducedMotion ? 360 : 520;
        flashTimersRef.current.push(
          setTimeout(() => {
            if (gameStateRef.current !== 'input') return;
            beginRoundRef.current?.();
          }, delay),
        );
      }
    },
    [endRun, playPadTone, prefersReducedMotion],
  );

  const startGame = useCallback(async () => {
    resetRunResult();
    if (isStartingRef.current) return;
    isStartingRef.current = true;
    isGuestRunRef.current = false;
    sessionTokenRef.current = null;
    setIsStartingSession(true);
    setSubmitError(null);
    setStartError(null);
    setRunRewardMessage(null);
    setRunAccountXp(null);
    setRunRewardIsCapHit(false);
    clearFlashTimers();

    let sessionSuccess = false;
    try {
      const sessionResponse = await fetch('/api/games/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gameType: 'sequence' }),
      });
      if (sessionResponse.ok) {
        setBanIndefinite(false);
        setBanUntilMs(null);
        const sessionData = await sessionResponse.json();
        sessionTokenRef.current = sessionData.token;
        seedRef.current =
          typeof sessionData.sequenceSeed === 'number'
            ? sessionData.sequenceSeed
            : null;
        if (seedRef.current === null) {
          setGameState('error');
          gameStateRef.current = 'error';
          isStartingRef.current = false;
          setIsStartingSession(false);
          return;
        }
        envMonitorRef.current.start();
        try {
          wsRef.current?.close();
          wsRef.current = await connectGameWs(sessionData.token);
          wsRef.current.onDisconnect((reason) => {
            console.error('Sequence Memory socket disconnected:', reason);
            gameStateRef.current = 'error';
            setGameState('error');
            clearFlashTimers();
            acceptingInputRef.current = false;
          });
        } catch (error) {
          console.warn(
            'Sequence Memory realtime channel unavailable; continuing over HTTP.',
            error,
          );
          wsRef.current = null;
        }
        sessionSuccess = true;
      } else if (sessionResponse.status === 401) {
        sessionTokenRef.current = null;
        seedRef.current = Math.floor(Math.random() * 0xffffffff) >>> 0;
        wsRef.current = null;
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

    // Build the full deterministic sequence once; rounds reveal a growing prefix.
    sequenceRef.current = buildSequence(seedRef.current!, MAX_SEQUENCE);
    roundRef.current = 0;
    scoreRef.current = 0;
    inputPosRef.current = 0;
    lastTapTimeRef.current = 0;
    setScore(0);
    setRound(0);
    setActivePad(null);
    gameStartTimeRef.current = performance.now();

    beginRound();
  }, [beginRound, buildSequence, clearFlashTimers, resetRunResult]);

  // A single entry point used by the overlay tap + keyboard: route to start /
  // restart depending on state. (Pad presses are handled separately.)
  const handlePrimaryAction = useCallback(() => {
    const current = gameStateRef.current;
    if (current === 'idle') {
      startGame();
    } else if (current === 'gameover') {
      if (performance.now() - gameOverTimeRef.current >= RESTART_GRACE_PERIOD) {
        startGame();
      }
    } else if (current === 'error') {
      startGame();
    }
  }, [startGame]);

  // Keyboard: 1-4 / arrow-ish mapping to pads during input; Space/Enter to
  // start or restart from overlays.
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.repeat) return;
      const padByKey: Record<string, number> = {
        Digit1: 0,
        Numpad1: 0,
        KeyQ: 0,
        Digit2: 1,
        Numpad2: 1,
        KeyW: 1,
        Digit3: 2,
        Numpad3: 2,
        KeyA: 2,
        Digit4: 3,
        Numpad4: 3,
        KeyS: 3,
      };
      if (gameStateRef.current === 'input' && e.code in padByKey) {
        e.preventDefault();
        handlePadPress(padByKey[e.code]!);
        return;
      }
      if (
        (e.code === 'Space' || e.code === 'Enter') &&
        gameStateRef.current !== 'input' &&
        gameStateRef.current !== 'showing'
      ) {
        e.preventDefault();
        handlePrimaryAction();
      }
    },
    [handlePadPress, handlePrimaryAction],
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  useEffect(() => {
    return () => {
      clearFlashTimers();
      wsRef.current?.close();
    };
  }, [clearFlashTimers]);

  // Track reduced-motion preference (swaps the flash for a brief static
  // highlight, still distinguishable).
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

  const isPlaying = gameState === 'showing' || gameState === 'input';
  const statusText =
    gameState === 'showing'
      ? 'Watch the sequence'
      : gameState === 'input'
        ? 'Your turn — repeat it'
        : '';

  return (
    <div
      className='sequence-midway arc-game-flow'
      style={toSequenceCssVars(theme)}
    >
      <div className='w-full space-y-3 sm:space-y-4'>
        <div className='mx-auto w-full max-w-4xl'>
          <div className='hidden sm:block'>
            <PageHeader
              eyebrow='Arcade'
              icon='brain'
              title='Sequence Memory'
              subtitle='Watch the pattern, then play it back. One miss ends the run.'
              wallet={walletCard}
            />
          </div>
          <div className='sm:hidden'>
            <GamesWalletCard wallet={walletCard} compact />
          </div>
        </div>

        <div className='mx-auto flex w-full max-w-xl items-center justify-between gap-3 px-1'>
          <span className='arcade-num text-sm text-body sm:text-base'>
            Score <span className='font-semibold text-strong'>{score}</span>
          </span>
          <span className='arcade-num text-sm text-body sm:text-base'>
            Round{' '}
            <span className='font-semibold text-strong'>
              {isPlaying || gameState === 'gameover' ? round : 0}
            </span>
          </span>
          <span className='arcade-num text-sm text-body sm:text-base'>
            Best <span className='font-semibold text-strong'>{highScore}</span>
          </span>
        </div>

        <div className='relative flex w-full justify-center'>
          <div className='sequence-stage relative w-full max-w-xl'>
            <div
              className='sequence-pad-grid'
              data-state={gameState}
              aria-label='Sequence pads'
            >
              {PADS.map((pad) => (
                <button
                  key={pad.id}
                  type='button'
                  className='sequence-pad'
                  data-pad={pad.key}
                  data-active={activePad === pad.id || undefined}
                  data-disabled={gameState !== 'input' || undefined}
                  aria-label={`${pad.label} pad`}
                  onPointerDown={(e) => {
                    if (e.pointerType === 'mouse' && e.button !== 0) return;
                    e.preventDefault();
                    handlePadPress(pad.id);
                  }}
                >
                  <span className='sequence-pad-face' />
                </button>
              ))}

              {/* Center status hub — shows the current beat / count. */}
              <div className='sequence-hub' aria-hidden>
                <span className='sequence-hub-num'>
                  {isPlaying || gameState === 'gameover' ? round : 0}
                </span>
                <span className='sequence-hub-label'>round</span>
              </div>
            </div>

            {/* Overlay for idle / gameover / error (covers the panel). */}
            {!isPlaying && (
              <div
                className='sequence-overlay absolute inset-0 flex touch-none flex-col items-center justify-center rounded-well px-4'
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
                    <Brain size={56} className='mb-4 text-tickets-text' />
                    <h1 className='arcade-display mb-2 text-center text-2xl text-strong uppercase sm:text-3xl'>
                      Sequence Memory
                    </h1>
                    <p className='mb-2 text-center text-sm text-strong sm:text-base'>
                      {isStartingSession
                        ? 'Starting your run…'
                        : touchDevice
                          ? 'Tap anywhere to start'
                          : 'Press Space or click to start'}
                    </p>
                    <p className='max-w-xs text-center text-xs text-body sm:text-sm'>
                      Watch the pads flash, then repeat the pattern. It grows by
                      one each round.
                    </p>
                  </>
                )}

                {gameState === 'gameover' && (
                  <>
                    <h2 className='arcade-display mb-2 text-2xl text-strong uppercase sm:text-3xl'>
                      Run over
                    </h2>
                    <p className='mb-1 text-xl text-strong sm:text-2xl'>
                      Score{' '}
                      <span className='arcade-num font-semibold'>{score}</span>
                    </p>
                    <p className='mb-4 text-base text-body sm:text-lg'>
                      Best <span className='arcade-num'>{highScore}</span>
                    </p>
                    <ArcadeRunRewards
                      reward={runResult.reward}
                      achievements={runResult.achievements}
                      saving={isSubmitting}
                      error={submitError}
                      guest={runRewardMessage?.startsWith('Guest run')}
                      className='mb-4 max-w-xs'
                    />
                    <p className='text-center text-sm text-body sm:text-base'>
                      {touchDevice
                        ? 'Tap to play again'
                        : 'Press Space to play again'}
                    </p>
                  </>
                )}

                {gameState === 'error' && (
                  <>
                    <h2 className='arcade-display mb-2 text-2xl text-danger-text uppercase sm:text-3xl'>
                      Connection error
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
                    <p className='text-center text-sm text-body sm:text-base'>
                      Tap or press Space to retry
                    </p>
                  </>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Live status line during play. */}
        <p className='mt-2 h-5 text-center text-xs font-semibold uppercase tracking-wide text-faint sm:text-sm'>
          {statusText}
        </p>

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
        title='Sequence Memory board'
        description='Longest sequences and your rank.'
      >
        <GameLeaderboard
          gameType='sequence'
          maxEntries={5}
          enableFullLeaderboardModal
          fullLeaderboardDisplay='inline'
          refreshKey={leaderboardRefreshKey}
        />
      </GameLeaderboardModal>
    </div>
  );
}
