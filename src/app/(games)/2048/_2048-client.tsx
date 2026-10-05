'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ArcadeButton } from '@/features/arcade/components/ui/arcade-ui';
import { Num } from '@/features/arcade/components/ui/num';

import { GameLeaderboard } from '@/features/arcade/components/game-leaderboard';
import { GameInventoryModal } from '@/features/arcade/components/game-inventory-modal';
import { GameLeaderboardModal } from '@/features/arcade/components/game-leaderboard-modal';
import { GameInventoryButton } from '@/features/arcade/components/game-inventory-button';
import { GameLeaderboardButton } from '@/features/arcade/components/game-leaderboard-button';
import {
  GameShell,
  GameStage,
  GameStageNotice,
  GameStat,
  type GameHint,
  type GameHowTo,
  type GamePhase,
} from '@/features/arcade/components/shell/game-shell';
import {
  ArcadeRematchButton,
  ArcadeRunResult,
} from '@/features/arcade/components/results/arcade-run-result';
import {
  beginArcadeInput,
  markArcadeGameReady,
  type ArcadePerformanceSpan,
} from '@/features/arcade/lib/arcade-performance';
import { SoundManager } from '@/features/arcade/lib/sound-manager';
import { useArcadeRunResult } from '@/features/arcade/lib/run-result';
import { useGameFeedback, usePitchLadder } from '@/features/arcade/lib/use-game-feedback';
import { useRollingNumber } from '@/features/arcade/lib/use-rolling-number';
import { useGameplayCallouts, useNewBestMoment } from '@/features/arcade/lib/use-gameplay-callouts';
import { ArcadeGameplayCallouts } from '@/features/arcade/components/gameplay/arcade-game-hud';
import { squashElement } from '@/features/arcade/lib/game-feel';
import {
  isControlTarget,
  isDialogOpen,
  type GameInput,
} from '@/features/arcade/lib/use-first-input';
import type { AccountXpReward } from '@/server/arcade/rewards/types';
import { createSpawnRng, type Game2048MoveCode, type SpawnRng } from '@/server/arcade/game-2048-replay';

import type {
  Direction,
  Game2048CosmeticTheme,
  Game2048ScoreSubmitResponse,
  InventoryCosmeticResponse,
} from './_2048-types';
import { DEFAULT_2048_THEME, buildGame2048Theme } from './_2048-theme';
import { GAME_2048_CSS, Game2048Board } from './_2048-board';
import {
  DIRECTION_KEYS,
  createInitialState,
  getSubmitErrorMessage,
  GUEST_RUN_MESSAGE,
  hasLegalMove,
  hasWon,
  moveTiles,
  spawnTile,
  type Game2048State,
} from './_2048-helpers';

type GameState = 'idle' | 'playing' | 'gameover' | 'won' | 'error';

const SWIPE_MIN_DISTANCE_PX = 24;

// A session armed as the page opened is used for the first run if it is
// younger than this. An older one is dropped and the run fetches its own.
const ARMED_SESSION_MAX_AGE_MS = 30 * 60 * 1000;

// The wire form of a move in the log the score route replays.
const MOVE_CODES: Record<Direction, Game2048MoveCode> = {
  UP: 'U',
  DOWN: 'D',
  LEFT: 'L',
  RIGHT: 'R',
};

// The shell's first-frame hint and ? sheet (docs/design/tixy-rebrand/SHELL.md).
const HINT: GameHint = {
  touch: 'Swipe to slide.',
  pointer: 'Press an arrow key to slide.',
};
const HOW_TO: GameHowTo = {
  lines: [
    'Swipe or press an arrow key to slide, and equal tiles merge.',
    'The run ends when the board is full and nothing can merge.',
    'A score of 1,000 pays 18 tickets, and 3,000 pays 47.',
  ],
};

// Keys that start a run. A move key also makes the first move.
const CODE_DIRECTIONS: Record<string, Direction> = {
  ArrowUp: 'UP',
  KeyW: 'UP',
  ArrowDown: 'DOWN',
  KeyS: 'DOWN',
  ArrowLeft: 'LEFT',
  KeyA: 'LEFT',
  ArrowRight: 'RIGHT',
  KeyD: 'RIGHT',
};
const START_KEYS = ['Space', 'Enter', ...Object.keys(CODE_DIRECTIONS)] as const;
const directionFromInput = (input: GameInput): Direction | undefined =>
  input.kind === 'key' ? CODE_DIRECTIONS[input.code] : undefined;

// A run that just ended ignores the restart keys for this long.
const RESTART_GRACE_MS = 500;
// Gap between the haptic ticks of merges in one move.
const MERGE_TICK_GAP_MS = 55;

// One undo a day on this device, by the player's local calendar day. The run
// logs it as a move ('Z'), and the score route replays the run from its seed:
// the undo takes back the last move, the score and the spawn together, so the
// same tile comes back after it. The server holds a run to one undo and a
// player to a few undo runs a day.
const UNDO_DAY_KEY = 'tixy-2048-undo-day';
const todayKey = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const readUndoSpentToday = () => {
  try {
    return window.localStorage.getItem(UNDO_DAY_KEY) === todayKey();
  } catch {
    return false;
  }
};
const writeUndoSpentToday = () => {
  try {
    window.localStorage.setItem(UNDO_DAY_KEY, todayKey());
  } catch {
    // Storage is off: the ref keeps it to one undo for this visit.
  }
};


const emptyState = (): Game2048State => ({
  tiles: [],
  score: 0,
  highestTile: 0,
  nextId: 1,
});

export default function Game2048Client() {
  // Game state
  const [state, setState] = useState<Game2048State>(emptyState);
  const [gameState, setGameState] = useState<GameState>('idle');
  const [highScore, setHighScore] = useState(0);
  const [hasSeenWin, setHasSeenWin] = useState(false);

  // Shell state (mirrors Snake's pattern)
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const [showInventory, setShowInventory] = useState(false);
  const [theme, setTheme] = useState<Game2048CosmeticTheme>(DEFAULT_2048_THEME);
  // A skin set's sound tint colours this game's cues while it is open.
  const skinSound = theme.skin?.sound ?? 'house';
  useEffect(() => {
    SoundManager.setTint(skinSound);
    return () => SoundManager.setTint('house');
  }, [skinSound]);
  const [walletBalances, setWalletBalances] = useState({ credits: 0 });
  // The daily cap still comes back with each save; the shell doesn't show it.
  const [, setDailyCreditsProgress] = useState({ earned: 0, cap: 300 });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [runRewardMessage, setRunRewardMessage] = useState<string | null>(null);
  const [, setRunRewardIsCapHit] = useState(false);
  const [, setRunAccountXp] = useState<AccountXpReward | null>(null);
  const { result: runResult, capture: captureRunResult, reset: resetRunResult } = useArcadeRunResult();
  // Undo: one a day. `undoReady` is true while there is a move to take back.
  const [undoReady, setUndoReady] = useState(false);
  const [undoSpent, setUndoSpent] = useState(false);
  const [hasLoadedTheme, setHasLoadedTheme] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [isStartingSession, setIsStartingSession] = useState(false);
  const [isArming, setIsArming] = useState(true);
  const [banUntilMs, setBanUntilMs] = useState<number | null>(null);
  const [banIndefinite, setBanIndefinite] = useState(false);
  const [banNowMs, setBanNowMs] = useState(Date.now());
  const [leaderboardRefreshKey, setLeaderboardRefreshKey] = useState(0);

  // Refs — authoritative game values for score submission
  const stateRef = useRef<Game2048State>(state);
  const moveCountRef = useRef(0);
  // The session fetched as the page opened, and the request while it is out.
  const armedSessionRef = useRef<{ token: string; sessionId: string | null; armedAt: number } | null>(null);
  const armingRef = useRef<Promise<void> | null>(null);
  // The run's spawn stream, from the session's seed. Null on a guest run,
  // which nobody scores.
  const spawnRngRef = useRef<SpawnRng | null>(null);
  // Every move the board took, and the undo, with ms since the run began.
  // The score route replays this to score the run.
  const moveLogRef = useRef<Array<[number, Game2048MoveCode]>>([]);
  const gameStateRef = useRef<GameState>('idle');
  const hasSeenWinRef = useRef(false);
  const sessionTokenRef = useRef<string | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const startTimeRef = useRef<number>(0);
  // Accumulated time the tab was hidden during this run; subtracted from the
  // wall-clock duration on submit so game-time metrics reflect active play
  // rather than "tab left open overnight" inflation.
  const hiddenElapsedMsRef = useRef<number>(0);
  const hiddenSinceRef = useRef<number | null>(null);
  const isStartingRef = useRef(false);
  const isGuestRunRef = useRef(false);
  const submitGuardRef = useRef(false);
  const bestScoreCacheRef = useRef<number | null>(null);
  const perfLoadStartedAtRef = useRef<number | undefined>(
    typeof window === 'undefined' ? undefined : performance.now(),
  );
  const perfReadyRef = useRef(false);
  const pendingInputSpanRef = useRef<ArcadePerformanceSpan | null>(null);

  // Sound and haptics: press first on every input, a tick on each merge, and
  // a pitch ladder that climbs while moves keep merging.
  const { trigger } = useGameFeedback();
  const mergeLadder = usePitchLadder();
  const boardRef = useRef<HTMLDivElement>(null);
  const applyMoveRef = useRef<(direction: Direction, inputAt?: number) => void>(() => {});
  // The board before the last move, for undo.
  const undoSnapshotRef = useRef<{ state: Game2048State; moves: number; rng: number | null } | null>(null);
  // The local day an undo was spent on, kept in memory too in case storage is off.
  const undoSpentDayRef = useRef<string | null>(null);
  const undoSpentToday = useCallback(
    () => undoSpentDayRef.current === todayKey() || readUndoSpentToday(),
    [],
  );
  // A move (arrow key or swipe) that started the run waits for the session.
  const firstDirectionRef = useRef<Direction | null>(null);
  const endedAtRef = useRef(0);
  const bestAtRunStartRef = useRef(0);
  // The new-best moment: once a run, when the score passes the best it
  // started with.
  const { items: callouts, push: pushCallout, clear: clearCallouts } = useGameplayCallouts();
  const { check: newBestCheck, reset: resetNewBest } = useNewBestMoment(pushCallout, { unit: 'points' });
  const timersRef = useRef<Set<number>>(new Set());
  const after = useCallback((ms: number, fn: () => void) => {
    const id = window.setTimeout(() => {
      timersRef.current.delete(id);
      fn();
    }, ms);
    timersRef.current.add(id);
  }, []);
  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      for (const id of timers) window.clearTimeout(id);
      timers.clear();
    };
  }, []);
  // Whether today's undo is gone. Read on mount, when the tab comes back, and
  // at local midnight, so a page left open past midnight gets the new day's.
  useEffect(() => {
    const refresh = () => setUndoSpent(undoSpentToday());
    refresh();
    let midnight: number | undefined;
    const arm = () => {
      const now = new Date();
      const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 1);
      midnight = window.setTimeout(() => {
        refresh();
        arm();
      }, next.getTime() - now.getTime());
    };
    arm();
    const onVisible = () => {
      if (!document.hidden) refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearTimeout(midnight);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [undoSpentToday]);

  useEffect(() => {
    if (banUntilMs === null && !banIndefinite) return;
    const interval = setInterval(() => setBanNowMs(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [banUntilMs, banIndefinite]);

  const formatBanCountdown = (targetMs: number) => {
    const totalSeconds = Math.max(0, Math.floor((targetMs - banNowMs) / 1000));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return `${hours.toString().padStart(2, '0')}:${minutes
      .toString()
      .padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  };

  const fetchUserBestScore = useCallback(async () => {
    if (bestScoreCacheRef.current !== null) {
      setHighScore(bestScoreCacheRef.current);
      return;
    }
    try {
      const response = await fetch('/api/games/2048/score', {
        cache: 'no-store',
      });
      if (response.ok) {
        const data = await response.json();
        if (typeof data.bestScore === 'number') {
          setHighScore(data.bestScore);
          bestScoreCacheRef.current = data.bestScore;
        }
      }
    } catch (error) {
      console.error('Failed to fetch 2048 best score:', error);
    }
  }, []);

  const loadTheme = useCallback(async () => {
    try {
      const response = await fetch('/api/store/inventory?gameType=2048', {
        cache: 'no-store',
      });
      if (!response.ok) {
        setTheme(DEFAULT_2048_THEME);
        setHasLoadedTheme(true);
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
      setTheme(buildGame2048Theme(payload));
      setHasLoadedTheme(true);
    } catch {
      setWalletBalances({ credits: 0 });
      setDailyCreditsProgress({ earned: 0, cap: 300 });
      setTheme(DEFAULT_2048_THEME);
      setHasLoadedTheme(true);
    }
  }, []);

  useEffect(() => {
    void loadTheme();
    void fetchUserBestScore();
  }, [loadTheme, fetchUserBestScore]);

  // The theme gates the playable board. Mark readiness on the following frame
  // so the measurement includes the committed DOM rather than the fetch alone.
  useEffect(() => {
    if (!hasLoadedTheme || perfReadyRef.current) return;
    const frame = window.requestAnimationFrame(() => {
      if (perfReadyRef.current) return;
      perfReadyRef.current = true;
      markArcadeGameReady('2048', perfLoadStartedAtRef.current, {
        renderer: 'dom',
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [hasLoadedTheme]);

  // Pause the active-play clock when the tab is hidden and resume when it
  // regains focus. Without this, leaving 2048 open in a background tab
  // would inflate game-time metrics with idle wall-clock time.
  useEffect(() => {
    const onVisibilityChange = () => {
      if (gameStateRef.current !== 'playing') return;
      if (document.hidden) {
        if (hiddenSinceRef.current === null) {
          hiddenSinceRef.current = performance.now();
        }
      } else if (hiddenSinceRef.current !== null) {
        hiddenElapsedMsRef.current += performance.now() - hiddenSinceRef.current;
        hiddenSinceRef.current = null;
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, []);

  const saveScore = useCallback(async () => {
    if (submitGuardRef.current) return;
    if (isGuestRunRef.current) {
      setRunRewardMessage(GUEST_RUN_MESSAGE);
      setRunRewardIsCapHit(false);
      setRunAccountXp(null);
      return;
    }
    if (!sessionTokenRef.current) return;
    const finalState = stateRef.current;
    const finalScore = finalState.score;
    const finalTile = finalState.highestTile;
    const finalMoves = moveCountRef.current;
    if (finalScore <= 0 && finalMoves === 0) return;

    submitGuardRef.current = true;
    setSubmitError(null);
    setRunRewardMessage(null);
    setRunAccountXp(null);
    setRunRewardIsCapHit(false);
    setIsSubmitting(true);
    try {
      const response = await fetch('/api/games/2048/score', {
        method: 'POST',
        keepalive: true,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          score: finalScore,
          sessionToken: sessionTokenRef.current,
          highestTile: finalTile,
          moves: finalMoves,
          moveLog: moveLogRef.current,
          clientDurationMs: Math.max(
            0,
            Math.round(
              performance.now()
                - startTimeRef.current
                - hiddenElapsedMsRef.current
                - (hiddenSinceRef.current !== null
                    ? performance.now() - hiddenSinceRef.current
                    : 0),
            ),
          ),
        }),
      });

      const rawBody = await response.text();
      let data: Game2048ScoreSubmitResponse | null = null;
      if (rawBody.trim().length > 0) {
        try {
          data = JSON.parse(rawBody) as Game2048ScoreSubmitResponse;
        } catch {
          data = null;
        }
      }

      if (!response.ok) {
        const retryAfterHeader = response.headers.get('retry-after');
        const retryAfterSecFromHeader = retryAfterHeader
          ? Number.parseInt(retryAfterHeader, 10)
          : Number.NaN;
        const normalizedData =
          data ??
          (response.status === 429
            ? {
                error: 'Too many runs.',
                retryAfterSec: Number.isFinite(retryAfterSecFromHeader)
                  ? retryAfterSecFromHeader
                  : undefined,
              }
            : null);
        setSubmitError(getSubmitErrorMessage(response.status, normalizedData));
        return;
      }

      captureRunResult(data);
      const reward = data?.reward;
      if (reward) {
        setRunAccountXp(reward.account ?? null);
        const awardedCredits = Number(reward.awardedCredits ?? 0);
        const wantedCredits = Number(reward.wantedCredits ?? 0);
        const capRemaining = Number(reward.capRemaining ?? 0);
        const balanceAfter = Number(reward.balanceAfter);
        setWalletBalances((prev) => ({
          credits: Number.isFinite(balanceAfter)
            ? Math.max(0, Math.floor(balanceAfter))
            : Math.max(0, prev.credits + Math.max(0, awardedCredits)),
        }));
        if (awardedCredits > 0) {
          setRunRewardMessage(`+${awardedCredits} tickets this run.`);
          setRunRewardIsCapHit(false);
        } else if (wantedCredits > 0 && capRemaining <= 0) {
          setRunRewardMessage(
            'Daily ticket cap reached. No tickets this run.',
          );
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

      if (finalScore > (bestScoreCacheRef.current ?? 0)) {
        bestScoreCacheRef.current = finalScore;
        setHighScore(finalScore);
      }

      setLeaderboardRefreshKey((prev) => prev + 1);
    } catch (error) {
      console.error('Failed to save 2048 score:', error);
      setSubmitError('Could not save your run. Try again.');
    } finally {
      setIsSubmitting(false);
    }
  }, [captureRunResult]);

  const commitState = useCallback((next: Game2048State) => {
    stateRef.current = next;
    setState(next);
  }, []);

  // The real first frame: the two tiles the run will start with. A signed-in
  // player's run is scored by replaying it from the session's seed, so the
  // session is fetched as the page opens and the first board is the seeded
  // deal, the one the run starts on. Until it answers the shell shows
  // "Starting your run." and no board. A guest (401), or a session that can't
  // be had, gets a random board nobody scores. Dealt on the client, after
  // hydration, because the deal depends on the answer.
  useEffect(() => {
    let cancelled = false;
    const arming = (async () => {
      try {
        const response = await fetch('/api/games/session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ gameType: '2048' }),
        });
        if (response.ok) {
          const data = await response.json();
          if (typeof data.game2048Seed === 'number' && typeof data.token === 'string') {
            if (cancelled) return;
            const rng = createSpawnRng(data.game2048Seed);
            armedSessionRef.current = {
              token: data.token,
              sessionId: data.sessionId ?? null,
              armedAt: Date.now(),
            };
            spawnRngRef.current = rng;
            commitState(createInitialState(rng.next));
            return;
          }
        }
      } catch {
        // Fall through to a random board; starting the run fetches its own session.
      }
      if (!cancelled && gameStateRef.current === 'idle' && stateRef.current.tiles.length === 0) {
        commitState(createInitialState());
      }
    })().finally(() => {
      if (!cancelled) {
        armingRef.current = null;
        setIsArming(false);
      }
    });
    armingRef.current = arming;
    return () => {
      cancelled = true;
    };
  }, [commitState]);

  const startGame = useCallback(async (firstDirection?: Direction) => {
    resetRunResult();
    if (isStartingRef.current) return;
    isStartingRef.current = true;
    firstDirectionRef.current = firstDirection ?? null;
    isGuestRunRef.current = false;
    setIsStartingSession(true);
    setSubmitError(null);
    setStartError(null);
    setRunRewardMessage(null);
    setRunAccountXp(null);
    setRunRewardIsCapHit(false);

    let sessionSuccess = false;
    // The run starts on the session the page armed, when there is a fresh
    // one: the board on screen is already its seeded deal.
    if (armingRef.current) await armingRef.current;
    const armed = armedSessionRef.current;
    armedSessionRef.current = null;
    const useArmed =
      armed !== null &&
      gameStateRef.current === 'idle' &&
      spawnRngRef.current !== null &&
      Date.now() - armed.armedAt < ARMED_SESSION_MAX_AGE_MS;
    if (useArmed) {
      // Nothing to wait for, but not the same event: the shell and the window
      // both see the press that starts the run, and the second must still find
      // the run starting, as it did while the session was fetched, or it
      // would play the press as a move too.
      await new Promise((resolve) => setTimeout(resolve, 0));
      sessionTokenRef.current = armed.token;
      sessionIdRef.current = armed.sessionId;
      isGuestRunRef.current = false;
      sessionSuccess = true;
      setBanIndefinite(false);
      setBanUntilMs(null);
    }
    try {
      const sessionResponse = useArmed ? null : await fetch('/api/games/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gameType: '2048' }),
      });
      if (sessionResponse === null) {
        // Armed session: nothing to fetch.
      } else if (sessionResponse.ok) {
        setBanIndefinite(false);
        setBanUntilMs(null);
        const sessionData = await sessionResponse.json();
        sessionTokenRef.current = sessionData.token;
        sessionIdRef.current = sessionData.sessionId ?? null;
        spawnRngRef.current =
          typeof sessionData.game2048Seed === 'number'
            ? createSpawnRng(sessionData.game2048Seed)
            : null;
        // A session with no seed can't be scored; don't start a run on it.
        sessionSuccess = spawnRngRef.current !== null;
        if (!sessionSuccess) setStartError('Could not start your run. Try again.');
      } else if (sessionResponse.status === 401) {
        // Not signed in — allow a guest/practice run; scores won't be saved.
        sessionTokenRef.current = null;
        sessionIdRef.current = null;
        spawnRngRef.current = null;
        isGuestRunRef.current = true;
        sessionSuccess = true;
      } else {
        const data = await sessionResponse.json().catch(() => null);
        console.error('Failed to start 2048 session:', data);
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
      console.error('Failed to start 2048 session:', error);
      setStartError('Could not reach the server. Try again.');
    } finally {
      isStartingRef.current = false;
      setIsStartingSession(false);
    }

    if (!sessionSuccess || (!sessionTokenRef.current && !isGuestRunRef.current)) {
      setGameState('error');
      gameStateRef.current = 'error';
      return;
    }

    // The first frame is the board the run starts on: keep the preview that
    // was showing, and deal a new one only for a rematch.
    // A scored run deals its first two tiles from the session's seed, so the
    // board it starts on is the one the server replays; the idle preview was
    // dealt at random. A guest run keeps the preview.
    const preview = stateRef.current;
    const seeded = spawnRngRef.current;
    const fresh = useArmed
      ? preview
      : seeded
      ? createInitialState(seeded.next)
      : gameStateRef.current === 'idle' && preview.tiles.length > 0
        ? preview
        : createInitialState();
    bestAtRunStartRef.current = bestScoreCacheRef.current ?? 0;
    resetNewBest();
    clearCallouts();
    moveCountRef.current = 0;
    moveLogRef.current = [];
    hasSeenWinRef.current = false;
    submitGuardRef.current = false;
    startTimeRef.current = performance.now();
    hiddenElapsedMsRef.current = 0;
    hiddenSinceRef.current = null;

    commitState(fresh);
    setHasSeenWin(false);
    undoSnapshotRef.current = null;
    setUndoReady(false);
    mergeLadder.reset();
    gameStateRef.current = 'playing';
    setGameState('playing');

    // The first input is also the first move: an arrow key or a swipe that
    // started the run slides the board once the run is on.
    const firstMove = firstDirectionRef.current;
    firstDirectionRef.current = null;
    if (firstMove) applyMoveRef.current(firstMove);
  }, [clearCallouts, commitState, mergeLadder, resetNewBest, resetRunResult]);

  // A move goes in the log at the time of the press or swipe that made it
  // (the event's timeStamp), not the time its handler ran. After a busy frame
  // the browser hands over the presses it queued back to back, and stamped
  // as they're handled, two presses 20 ms apart log 3 ms apart and the
  // server's pace check turns an honest run away. Never earlier than the
  // entry before it, and never before the run began.
  const logMove = useCallback((code: Game2048MoveCode, inputAt?: number) => {
    const now = performance.now();
    const at =
      inputAt !== undefined && Number.isFinite(inputAt) && inputAt > 0 && inputAt <= now
        ? inputAt
        : now;
    const log = moveLogRef.current;
    const previous = log.length > 0 ? log[log.length - 1]![0] : 0;
    log.push([Math.max(previous, Math.round(at - startTimeRef.current)), code]);
  }, []);

  const finishRun = useCallback(
    (finalState: 'gameover') => {
      endedAtRef.current = performance.now();
      gameStateRef.current = finalState;
      setGameState(finalState);
      setUndoReady(false);
      void saveScore();
    },
    [saveScore],
  );

  const applyMove = useCallback(
    (direction: Direction, inputAt?: number) => {
      if (gameStateRef.current !== 'playing') return;
      // Press first: every move answers this frame, before any checks.
      trigger('press', { motion: false });
      const inputSpan = beginArcadeInput('2048:move', { direction });
      const current = stateRef.current;
      const { state: moved, moved: didMove } = moveTiles(current, direction);
      if (!didMove) {
        inputSpan.cancel();
        return;
      }

      pendingInputSpanRef.current?.cancel();
      pendingInputSpanRef.current = inputSpan;

      // Keep the board as it was, for undo (flags cleared so an undo doesn't
      // replay the merge or spawn animations).
      undoSnapshotRef.current = {
        state: {
          ...current,
          tiles: current.tiles.map((t) => ({ id: t.id, value: t.value, row: t.row, col: t.col })),
        },
        moves: moveCountRef.current,
        rng: spawnRngRef.current?.state ?? null,
      };
      setUndoReady(true);
      logMove(MOVE_CODES[direction], inputAt);

      // Spawn a new tile in the same state commit so the browser can run
      // the slide transition on surviving tiles and the spawn keyframe on
      // the fresh tile concurrently.
      const spawn = spawnTile(moved.tiles, moved.nextId, spawnRngRef.current?.next);
      const committed: Game2048State = {
        tiles: spawn.tile ? [...moved.tiles, spawn.tile] : moved.tiles,
        score: moved.score,
        highestTile: spawn.tile
          ? Math.max(moved.highestTile, spawn.tile.value)
          : moved.highestTile,
        nextId: spawn.nextId,
      };
      moveCountRef.current += 1;
      commitState(committed);

      // ── Feel (presentation only) ──
      // A tick and a rising note per merge, each one a rung up the pitch
      // ladder. The ladder resets on a move that merges nothing.
      const mergedTiles = moved.tiles.filter((t) => t.merged);
      if (mergedTiles.length === 0) {
        mergeLadder.reset();
      } else {
        mergedTiles.forEach((_, index) => {
          const pitch = mergeLadder.next();
          const tick = () => trigger('collect', { motion: false, haptic: true, pitch });
          if (index === 0) tick();
          else after(index * MERGE_TICK_GAP_MS, tick);
        });
      }

      if (!hasSeenWinRef.current && hasWon(committed)) {
        hasSeenWinRef.current = true;
        endedAtRef.current = performance.now();
        gameStateRef.current = 'won';
        setGameState('won');
        // Nothing to undo back to once 2048 is on the board.
        undoSnapshotRef.current = null;
        setUndoReady(false);
        trigger('round-win', { motion: false, haptic: true });
        return;
      }

      if (!hasLegalMove(committed)) {
        SoundManager.play('lose');
        finishRun('gameover');
      }
    },
    [after, commitState, finishRun, logMove, mergeLadder, trigger],
  );
  applyMoveRef.current = applyMove;

  // Undo: one a day, on this device. It restores the board, the score and the
  // move count from before the last move, so what the run reports stays what
  // the board shows.
  const undoMove = useCallback((inputAt?: number) => {
    if (gameStateRef.current !== 'playing') return;
    const snapshot = undoSnapshotRef.current;
    if (!snapshot) return;
    trigger('press', { motion: false });
    if (undoSpentToday()) {
      setUndoSpent(true);
      return;
    }
    undoSpentDayRef.current = todayKey();
    writeUndoSpentToday();
    setUndoSpent(true);
    undoSnapshotRef.current = null;
    setUndoReady(false);
    mergeLadder.reset();
    moveCountRef.current = snapshot.moves;
    if (spawnRngRef.current && snapshot.rng !== null) spawnRngRef.current.state = snapshot.rng;
    logMove('Z', inputAt);
    commitState(snapshot.state);
  }, [commitState, logMove, mergeLadder, trigger, undoSpentToday]);

  // React passive effects run after the tile DOM has committed. This is the
  // clearest DOM-game endpoint for input-to-visible-response timing.
  useEffect(() => {
    const pending = pendingInputSpanRef.current;
    if (!pending) return;
    pendingInputSpanRef.current = null;
    pending.end({ response: 'tile-dom-commit' });
  }, [state]);

  useEffect(
    () => () => {
      pendingInputSpanRef.current?.cancel();
      pendingInputSpanRef.current = null;
    },
    [],
  );

  // Merged tiles squash when the slide lands (the kit's squash; none under
  // reduced motion).
  useEffect(() => {
    const board = boardRef.current;
    if (!board || !theme.mergePulseEnabled || !state.tiles.some((t) => t.merged)) return;
    const timers = timersRef.current;
    const landed = window.setTimeout(() => {
      timers.delete(landed);
      board
        .querySelectorAll<HTMLElement>('.tile2048-tile[data-merged="true"]')
        .forEach((el) => squashElement(el, { force: 0.85 }));
    }, theme.slideDurationMs);
    timers.add(landed);
    return () => {
      window.clearTimeout(landed);
      timers.delete(landed);
    };
  }, [state, theme.mergePulseEnabled, theme.slideDurationMs]);

  const handleContinueAfterWin = useCallback(() => {
    setHasSeenWin(true);
    gameStateRef.current = 'playing';
    setGameState('playing');
  }, []);

  const handleEndAfterWin = useCallback(() => {
    hasSeenWinRef.current = true;
    setHasSeenWin(true);
    finishRun('gameover');
  }, [finishRun]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.altKey) return;
      // Keys typed into a field (Z, WASD) and keys for an open sheet or a
      // control are not the game's.
      if (isControlTarget(event.target) || isDialogOpen()) return;
      const key = event.key.toLowerCase();
      const s = gameStateRef.current;
      const direction = DIRECTION_KEYS[key];

      if (direction || key === ' ') {
        event.preventDefault();
      }

      // Undo: Z, or Ctrl or Command with Z.
      if (key === 'z' && !event.repeat) {
        if (s === 'playing') {
          event.preventDefault();
          undoMove(event.timeStamp);
        }
        return;
      }
      if (event.ctrlKey || event.metaKey) return;

      const activate = key === ' ' || key === 'enter';

      // The shell normally swallows the press that starts a run and calls
      // startGame with the move; this branch only runs if it is bypassed.
      if (s === 'idle') {
        if (event.repeat) return;
        if (direction) void startGame(direction);
        else if (activate) void startGame();
        return;
      }

      // Space or Enter plays again. After a run it waits out the grace
      // period, so keys still held from the last slide can't skip the result.
      if (s === 'gameover' || s === 'error') {
        if (event.repeat || !activate) return;
        if (s === 'gameover' && performance.now() - endedAtRef.current < RESTART_GRACE_MS) {
          return;
        }
        void startGame();
        return;
      }

      if (s === 'won') {
        // A key still held from the winning slide must not click through.
        if (event.repeat) return;
        if (key === 'escape') {
          hasSeenWinRef.current = true;
          finishRun('gameover');
          return;
        }
        if (
          (direction || activate) &&
          performance.now() - endedAtRef.current >= RESTART_GRACE_MS
        ) {
          handleContinueAfterWin();
        }
        return;
      }

      if (s !== 'playing' || !direction) return;
      applyMove(direction, event.timeStamp);
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [applyMove, finishRun, handleContinueAfterWin, startGame, undoMove]);

  // Swipe anywhere on the page: the listeners sit on the window, in the
  // capture phase, so a swipe that starts outside the board counts and the
  // shell's swallowed first press doesn't hide the swipe that started the run.
  // While a run is on, a drag never scrolls the page.
  useEffect(() => {
    let start: { x: number; y: number } | null = null;

    const onTouchStart = (event: TouchEvent) => {
      const t = event.touches[0];
      if (!t || event.touches.length > 1 || isControlTarget(event.target) || isDialogOpen()) {
        start = null;
        return;
      }
      start = { x: t.clientX, y: t.clientY };
    };

    const onTouchMove = (event: TouchEvent) => {
      if (start && gameStateRef.current === 'playing' && event.cancelable) {
        event.preventDefault();
      }
    };

    const onTouchEnd = (event: TouchEvent) => {
      const origin = start;
      start = null;
      const t = event.changedTouches[0];
      if (!origin || !t || isDialogOpen()) return;
      const dx = t.clientX - origin.x;
      const dy = t.clientY - origin.y;
      const absX = Math.abs(dx);
      const absY = Math.abs(dy);
      if (absX < SWIPE_MIN_DISTANCE_PX && absY < SWIPE_MIN_DISTANCE_PX) return;
      const direction: Direction =
        absX > absY ? (dx > 0 ? 'RIGHT' : 'LEFT') : dy > 0 ? 'DOWN' : 'UP';
      const s = gameStateRef.current;
      if (s === 'playing') {
        applyMoveRef.current(direction, event.timeStamp);
      } else if (s === 'idle' && isStartingRef.current && !firstDirectionRef.current) {
        // The swipe that started the run: it moves once the session is ready.
        firstDirectionRef.current = direction;
      }
    };

    window.addEventListener('touchstart', onTouchStart, { capture: true, passive: true });
    window.addEventListener('touchmove', onTouchMove, { capture: true, passive: false });
    window.addEventListener('touchend', onTouchEnd, { capture: true, passive: true });
    return () => {
      window.removeEventListener('touchstart', onTouchStart, { capture: true });
      window.removeEventListener('touchmove', onTouchMove, { capture: true });
      window.removeEventListener('touchend', onTouchEnd, { capture: true });
    };
  }, []);

  // The shell's phase: the first frame, the run, then the result, the
  // 2048 choice or an error over the stage.
  // Turn-based: nothing moves while the ? sheet is open, so pausing is a no-op
  // and ? stays available during a run.
  const pauseRun = useCallback(() => {}, []);

  const phase: GamePhase =
    gameState === 'idle'
      ? 'ready'
      : gameState === 'gameover' || gameState === 'won' || gameState === 'error'
        ? 'over'
        : 'playing';
  const inRun = phase === 'playing';
  const isBest = state.score > 0 && state.score > bestAtRunStartRef.current;
  useEffect(() => {
    if (gameState === 'playing') newBestCheck(state.score, bestAtRunStartRef.current);
  }, [gameState, state.score, newBestCheck]);
  const shownScore = useRollingNumber(state.score, { duration: 300 });

  const end =
    gameState === 'gameover' ? (
      <ArcadeRunResult
        title={isBest ? 'New best' : 'Run over'}
        tone={isBest ? 'best' : 'neutral'}
        stats={[
          { label: 'score', value: state.score, highlight: isBest },
          { label: 'top tile', value: state.highestTile },
          { label: 'moves', value: moveCountRef.current },
        ]}
        reward={runResult.reward}
        achievements={runResult.achievements}
        saving={isSubmitting}
        error={submitError}
        guest={runRewardMessage === GUEST_RUN_MESSAGE}
        actions={<ArcadeRematchButton onClick={() => void startGame()} />}
      />
    ) : gameState === 'won' && !hasSeenWin ? (
      <GameStageNotice
        title='2048 reached'
        action={
          <>
            <ArcadeButton tone='primary' onClick={handleContinueAfterWin}>
              keep going
            </ArcadeButton>
            <ArcadeButton tone='key' onClick={handleEndAfterWin}>
              end run
            </ArcadeButton>
          </>
        }
      >
        <p>
          You are at <Num value={state.score} /> points. Keep going, or end the run to save it.
        </p>
      </GameStageNotice>
    ) : gameState === 'error' ? (
      <GameStageNotice
        title={banIndefinite || banUntilMs ? 'Banned from games' : 'Connection lost'}
        action={
          <ArcadeButton
            tone='primary'
            onClick={() => void startGame()}
            disabled={isStartingSession}
          >
            retry
          </ArcadeButton>
        }
      >
        {banIndefinite || banUntilMs ? (
          <p>
            {banIndefinite
              ? 'You are banned until an admin lifts it.'
              : `Ban ends in ${formatBanCountdown(banUntilMs!)}.`}
          </p>
        ) : (
          <p>{startError ?? 'Could not reach the server. Try again.'}</p>
        )}
      </GameStageNotice>
    ) : null;

  const controls = (
    <div className='tile2048-controls'>
      <div className='tile2048-score' aria-live='off'>
        <small>score</small>
        <Num value={shownScore} labelValue={state.score} />
      </div>
      <div className='tile2048-undo'>
        <small>{undoSpent ? '0 left today' : '1 left today'}</small>
        <ArcadeButton
          tone='key'
          size='sm'
          onClick={(event) => undoMove(event.timeStamp)}
          disabled={!inRun || !undoReady || undoSpent}
          aria-keyshortcuts='Z'
        >
          undo
        </ArcadeButton>
      </div>
    </div>
  );

  return (
    <GameShell
      game='2048'
      stat={<GameStat value={highScore} label='best' />}
      howTo={HOW_TO}
      tickets={walletBalances.credits}
      below={
        <div className='flex flex-wrap items-center justify-center gap-2'>
          <GameLeaderboardButton onClick={() => setShowLeaderboard(true)} />
          <GameInventoryButton onClick={() => setShowInventory(true)} />
        </div>
      }
    >
      {/* Scoped CSS for the board and tiles (_2048-board.tsx). */}
      <style>{GAME_2048_CSS}</style>

      <GameStage
        phase={phase}
        hint={HINT}
        busy={
          isStartingSession || isArming
            ? 'Starting your run.'
            : !hasLoadedTheme
              ? 'Loading your tiles.'
              : null
        }
        onStart={(input) => void startGame(directionFromInput(input))}
        startKeys={START_KEYS}
        onPause={pauseRun}
        aspect={1}
        controls={controls}
        end={end}
      >
        <Game2048Board theme={theme} tiles={state.tiles} boardRef={boardRef} />
        {gameState === 'playing' ? <ArcadeGameplayCallouts items={callouts} /> : null}
      </GameStage>

      <GameLeaderboardModal
        open={showLeaderboard}
        onOpenChange={setShowLeaderboard}
        title='2048 board'
        description='Top runs and your rank.'
      >
        <GameLeaderboard
          gameType='2048'
          maxEntries={5}
          enableFullLeaderboardModal
          fullLeaderboardDisplay='inline'
          refreshKey={leaderboardRefreshKey}
        />
      </GameLeaderboardModal>

      <GameInventoryModal
        open={showInventory}
        onOpenChange={(next) => {
          setShowInventory(next);
          if (!next) void loadTheme();
        }}
        gameType='2048'
        title='2048 inventory'
        description='Equip tile, grid, and background themes.'
      />
    </GameShell>
  );
}
