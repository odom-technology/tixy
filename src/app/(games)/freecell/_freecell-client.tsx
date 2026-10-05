'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Spade, Undo2, Sparkles, CircleHelp } from 'lucide-react';

import { ArcadeButton, ArcadeSegmented } from '@/features/arcade/components/ui/arcade-ui';
import { GameLeaderboard } from '@/features/arcade/components/game-leaderboard';
import { GameLeaderboardModal } from '@/features/arcade/components/game-leaderboard-modal';
import { GameLeaderboardButton } from '@/features/arcade/components/game-leaderboard-button';
import { PageHeader, GamesWalletCard } from '@/features/arcade/components/shell/page-header';
import { MuteButton } from '@/features/arcade/components/mute-button';
import { PlayingCardFace } from '@/features/arcade/components/ui/playing-card';
import type { PlayingCardSuit } from '@/features/arcade/components/ui/playing-card';
import { EnvMonitor } from '@/features/arcade/lib/game-anti-cheat';
import { createGameFrameLoop } from '@/features/arcade/lib/game-frame-loop';
import { usePreventGameGestures, useIsTouchDevice } from '@/features/arcade/lib/game-mobile-utils';
import { SoundManager } from '@/features/arcade/lib/sound-manager';
import { ArcadeRematchButton, ArcadeRunResult } from '@/features/arcade/components/results/arcade-run-result';
import { useArcadeRunResult } from '@/features/arcade/lib/run-result';

import {
  initialState,
  applyMove,
  isWon,
  rankOf,
  suitOf,
  canStack,
  maxSupermove,
  NUM_CASCADES,
  NUM_FREECELLS,
  NUM_FOUNDATIONS,
  LOC_FREECELL_BASE,
  LOC_FOUNDATION,
  type FreeCellState,
  type FreeCellEvent,
  type FreeCellMove,
} from '@/server/arcade/freecell-replay';

import {
  DEFAULT_FREECELL_THEME,
  buildFreecellTheme,
  freecellThemeCssVars,
  type InventoryCosmeticResponse,
  type FreecellCosmeticTheme,
} from './_freecell-theme';

import './_freecell-midway.css';

type GameState = 'idle' | 'loading' | 'playing' | 'solved' | 'error';
type FreecellMode = 'daily' | 'free';

const MODES: FreecellMode[] = ['daily', 'free'];
const MODE_LABELS: Record<FreecellMode, string> = { daily: 'Daily deal', free: 'Free play' };
const RANK_NAMES = ['Ace', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Jack', 'Queen', 'King'];
const SUIT_NAMES = ['Spades', 'Hearts', 'Diamonds', 'Clubs'];
const STORAGE_MODE_KEY = 'freecell_mode';

const REWARDS_HINT_TEXT =
  'Rewards hint: clear the whole board to bank tickets — faster clears pay more, and ties break on fewer moves. Every deal is guaranteed solvable. Tickets taper toward the daily cap.';

const formatClock = (ms: number) => {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
};

const getSubmitErrorMessage = (
  status: number,
  data: { error?: string; details?: string; retryAfterSec?: number } | null,
) => {
  if (status === 429) {
    const retry =
      typeof data?.retryAfterSec === 'number' ? ` Try again in ${data.retryAfterSec}s.` : '';
    return `${data?.error ?? 'Too many submissions.'}${retry}`;
  }
  if (typeof data?.details === 'string' && data.details.trim()) return data.details;
  if (typeof data?.error === 'string' && data.error.trim()) return data.error;
  return 'Could not submit the run. Try again.';
};

const cloneState = (s: FreeCellState): FreeCellState => ({
  cascades: s.cascades.map((c) => c.slice()),
  free: s.free.slice(),
  found: s.found.slice(),
});

// A selection: a source location + the run length being carried.
type Selection = { loc: number; n: number };

export default function FreecellClient() {
  const [mode, setMode] = useState<FreecellMode>('daily');
  const [gameState, setGameState] = useState<GameState>('idle');
  const [state, setState] = useState<FreeCellState | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [moveCount, setMoveCount] = useState(0);

  const [elapsedMs, setElapsedMs] = useState(0);
  const [bestSolveMs, setBestSolveMs] = useState<number | null>(null);

  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const [showRewardsHint, setShowRewardsHint] = useState(false);
  const [leaderboardRefreshKey, setLeaderboardRefreshKey] = useState(0);

  const [walletBalances, setWalletBalances] = useState({ credits: 0 });
  const [dailyCreditsProgress, setDailyCreditsProgress] = useState({ earned: 0, cap: 300 });
  const [theme, setTheme] = useState<FreecellCosmeticTheme>(DEFAULT_FREECELL_THEME);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const [needsSignIn, setNeedsSignIn] = useState(false);
  const {
    reward: runReward,
    achievements: runAchievements,
    capture: captureRunResult,
    reset: resetRunResult,
  } = useArcadeRunResult();
  const [finalSolveMs, setFinalSolveMs] = useState<number | null>(null);
  const [finalMoves, setFinalMoves] = useState(0);
  const [isNewPB, setIsNewPB] = useState(false);
  const [shake, setShake] = useState(false);

  const [banUntilMs, setBanUntilMs] = useState<number | null>(null);
  const [banIndefinite, setBanIndefinite] = useState(false);
  const [banNowMs, setBanNowMs] = useState(Date.now());

  // ── Refs ──
  const sessionTokenRef = useRef<string | null>(null);
  const envMonitorRef = useRef(new EnvMonitor());
  const startedAtRef = useRef<number | null>(null);
  const isStartingRef = useRef(false);
  const submittedRef = useRef(false);
  const modeRef = useRef<FreecellMode>('daily');
  const gameStateRef = useRef<GameState>('idle');
  const stateRef = useRef<FreeCellState | null>(null);
  const eventsRef = useRef<FreeCellEvent[]>([]);
  const historyRef = useRef<FreeCellState[]>([]);
  const selectionRef = useRef<Selection | null>(null);
  const pressRef = useRef<{ loc: number; idx: number; x: number; y: number; moved: boolean } | null>(null);
  const autoFinishTimerRef = useRef<number | null>(null);

  usePreventGameGestures(gameState === 'playing');

  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);
  useEffect(() => {
    gameStateRef.current = gameState;
  }, [gameState]);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);
  useEffect(() => {
    selectionRef.current = selection;
  }, [selection]);

  // Restore last mode.
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_MODE_KEY);
      if (stored === 'daily' || stored === 'free') setMode(stored);
    } catch {
      /* storage blocked */
    }
  }, []);

  // ── Wallet + theme ──
  const loadWallet = useCallback(async () => {
    try {
      const response = await fetch('/api/store/inventory?gameType=freecell', {
        cache: 'no-store',
      });
      if (!response.ok) return;
      const payload = (await response.json()) as InventoryCosmeticResponse;
      setWalletBalances({ credits: payload.wallet?.credits ?? 0 });
      setDailyCreditsProgress({
        earned: payload.dailyGameCredits?.earned ?? 0,
        cap: payload.dailyGameCredits?.cap ?? 300,
      });
      setTheme(buildFreecellTheme(payload));
    } catch {
      setWalletBalances({ credits: 0 });
      setDailyCreditsProgress({ earned: 0, cap: 300 });
    }
  }, []);

  const fetchBest = useCallback(async (m: FreecellMode) => {
    try {
      const response = await fetch(`/api/games/freecell/score?mode=${m}`, { cache: 'no-store' });
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
    void fetchBest(mode);
  }, [mode, fetchBest]);

  // ── Timer (display only; server measures authoritative time) ──
  useEffect(() => {
    if (gameState !== 'playing') return;
    let displayedSecond = -1;
    const frameLoop = createGameFrameLoop({
      // Move replay and submission durations read performance.now() directly;
      // this hidden-aware loop owns only the whole-second display.
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

  // ── Submit ──
  const submitRun = useCallback(async () => {
    if (!sessionTokenRef.current || submittedRef.current) return;
    submittedRef.current = true;

    const clientDurationMs =
      startedAtRef.current !== null ? Math.max(0, performance.now() - startedAtRef.current) : 0;

    envMonitorRef.current.stop();
    setIsSubmitting(true);
    setSubmitError(null);

    try {
      const response = await fetch('/api/games/freecell/score', {
        method: 'POST',
        keepalive: true,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionToken: sessionTokenRef.current,
          mode: modeRef.current,
          events: eventsRef.current.map((e) =>
            e.kind === 'undo' ? [-1, -1, 0] : [e.f, e.t, e.n],
          ),
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
        const errData = data as { error?: string; details?: string; retryAfterSec?: number } | null;
        const reason = errData?.details || errData?.error || `HTTP ${response.status}`;
        console.error(`[FreeCell] Run rejected (${response.status}): ${reason}`);
        setSubmitError(getSubmitErrorMessage(response.status, errData));
        SoundManager.play('lose');
        setGameState('error');
        return;
      }

      captureRunResult(data);

      SoundManager.play('win');
      const solveTimeMs =
        typeof data?.solveTimeMs === 'number' ? data.solveTimeMs : clientDurationMs;
      setFinalSolveMs(solveTimeMs);
      setFinalMoves(typeof data?.moveCount === 'number' ? data.moveCount : 0);
      setIsNewPB(Boolean(data?.isNewPB));
      setGameState('solved');
      if (bestSolveMs === null || (typeof solveTimeMs === 'number' && solveTimeMs < bestSolveMs)) {
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
            : Math.max(0, prev.credits + (Number.isFinite(awardedCredits) ? Math.max(0, awardedCredits) : 0)),
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
      console.error('Failed to submit freecell run:', error);
      setSubmitError('Network error while submitting your run. Try again.');
      setGameState('error');
    } finally {
      setIsSubmitting(false);
    }
  }, [bestSolveMs, captureRunResult]);

  // ── Start a new deal ──
  const startGame = useCallback(
    async (m: FreecellMode) => {
      if (isStartingRef.current) return;
      isStartingRef.current = true;
      submittedRef.current = false;
      sessionTokenRef.current = null;
      startedAtRef.current = null;
      eventsRef.current = [];
      historyRef.current = [];
      selectionRef.current = null;
      pressRef.current = null;
      setSelection(null);
      setMoveCount(0);
      setGameState('loading');
      setSubmitError(null);
      setStartError(null);
      setNeedsSignIn(false);
      resetRunResult();
      setFinalSolveMs(null);
      setFinalMoves(0);
      setIsNewPB(false);
      setElapsedMs(0);

      try {
        const sessionResponse = await fetch('/api/games/session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ gameType: 'freecell' }),
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
              typeof data?.retryAfterSec === 'number' ? Date.now() + data.retryAfterSec * 1000 : null,
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
          `/api/games/freecell/puzzle?token=${encodeURIComponent(token)}&mode=${m}`,
          { cache: 'no-store' },
        );
        if (!puzzleResponse.ok) {
          const data = await puzzleResponse.json().catch(() => null);
          setStartError(getSubmitErrorMessage(puzzleResponse.status, data));
          setGameState('error');
          return;
        }
        const puzzleData = await puzzleResponse.json();
        const deal = puzzleData.deal as number[][] | undefined;
        if (!Array.isArray(deal) || deal.length !== NUM_CASCADES) {
          setStartError('The deal could not be loaded. Try again.');
          setGameState('error');
          return;
        }

        envMonitorRef.current.start();
        startedAtRef.current = performance.now();
        const fresh = initialState(deal);
        stateRef.current = fresh;
        setState(fresh);
        setGameState('playing');
      } catch (error) {
        console.error('Failed to start freecell session:', error);
        setStartError('Network error while starting the deal. Try again.');
        setGameState('error');
      } finally {
        isStartingRef.current = false;
      }
    },
    [resetRunResult],
  );

  // ── Apply a move (records the event, updates state, detects win). ──
  const commitMove = useCallback(
    (move: FreeCellMove) => {
      const cur = stateRef.current;
      if (!cur) return false;
      const next = applyMove(cur, move);
      if (!next) return false;
      historyRef.current.push(cloneState(cur));
      eventsRef.current.push({ kind: 'move', f: move.f, t: move.t, n: move.n });
      stateRef.current = next;
      setState(next);
      setMoveCount((c) => c + 1);
      if (move.t === LOC_FOUNDATION) SoundManager.play('arcadeReveal');
      else SoundManager.play('tetrisPieceMove');
      if (isWon(next)) {
        setSelection(null);
        selectionRef.current = null;
        void submitRun();
      }
      return true;
    },
    [submitRun],
  );

  const undo = useCallback(() => {
    if (gameStateRef.current !== 'playing') return;
    const prev = historyRef.current.pop();
    if (!prev) return;
    eventsRef.current.push({ kind: 'undo' });
    stateRef.current = prev;
    setState(prev);
    setMoveCount((c) => c + 1); // undo counts toward the move tiebreak
    setSelection(null);
    selectionRef.current = null;
    SoundManager.play('tetrisPieceMove');
  }, []);

  // ── Best destination for a source run (foundation > tableau > free cell). ──
  const bestDestFor = useCallback((s: FreeCellState, loc: number, n: number): number | null => {
    // Identify the moving cards.
    let bottom: number;
    if (loc >= 0 && loc < NUM_CASCADES) {
      const col = s.cascades[loc];
      if (!col || col.length < n) return null;
      bottom = col[col.length - n]!;
    } else if (loc >= LOC_FREECELL_BASE && loc < LOC_FREECELL_BASE + NUM_FREECELLS) {
      const c = s.free[loc - LOC_FREECELL_BASE];
      if (c === null || c === undefined) return null;
      bottom = c;
    } else {
      return null;
    }
    if (n === 1) {
      // Foundation first.
      if (s.found[suitOf(bottom)] === rankOf(bottom) - 1) return LOC_FOUNDATION;
    }
    // Tableau: prefer a non-empty column it stacks on.
    for (let d = 0; d < NUM_CASCADES; d += 1) {
      if (d === loc) continue;
      const col = s.cascades[d]!;
      if (col.length === 0) continue;
      if (canStack(bottom, col[col.length - 1]!) && n <= maxSupermove(s, false)) return d;
    }
    // Then an empty column.
    for (let d = 0; d < NUM_CASCADES; d += 1) {
      if (d === loc) continue;
      if (s.cascades[d]!.length === 0 && n <= maxSupermove(s, true)) return d;
    }
    // Then a free cell (single card only).
    if (n === 1) {
      for (let i = 0; i < NUM_FREECELLS; i += 1) {
        if (s.free[i] === null) return LOC_FREECELL_BASE + i;
      }
    }
    return null;
  }, []);

  // The maximal movable ordered tail run in a cascade ending at `idx`.
  const runLengthFrom = (s: FreeCellState, loc: number, idx: number): number | null => {
    const col = s.cascades[loc];
    if (!col) return null;
    if (idx < 0 || idx >= col.length) return null;
    // Every card from idx to top must form a descending, alternating run.
    for (let i = idx; i < col.length - 1; i += 1) {
      if (!canStack(col[i + 1]!, col[i]!)) return null;
    }
    return col.length - idx;
  };

  // ── Unified pointer interaction (tap-to-move + drag-and-drop) ──
  const destFromPoint = (x: number, y: number): number | null => {
    const el = document.elementFromPoint(x, y);
    const dest = el?.closest('[data-dest]') as HTMLElement | null;
    if (!dest) return null;
    const loc = Number(dest.dataset.dest);
    return Number.isFinite(loc) ? loc : null;
  };

  const tryMoveSelectionTo = useCallback(
    (dest: number): boolean => {
      const sel = selectionRef.current;
      const s = stateRef.current;
      if (!sel || !s) return false;
      if (dest === sel.loc) return false;
      const ok = commitMove({ f: sel.loc, t: dest, n: sel.n });
      if (ok) {
        setSelection(null);
        selectionRef.current = null;
      }
      return ok;
    },
    [commitMove],
  );

  const onPointerDownCard = (e: React.PointerEvent, loc: number, idx: number) => {
    if (gameStateRef.current !== 'playing') return;
    e.preventDefault();
    try {
      (e.target as Element).releasePointerCapture?.(e.pointerId);
    } catch {
      /* not captured */
    }
    pressRef.current = { loc, idx, x: e.clientX, y: e.clientY, moved: false };
  };

  const onPointerMoveBoard = (e: React.PointerEvent) => {
    const p = pressRef.current;
    if (!p) return;
    if (Math.abs(e.clientX - p.x) > 8 || Math.abs(e.clientY - p.y) > 8) {
      p.moved = true;
    }
  };

  const resolveSourceRun = (loc: number, idx: number): Selection | null => {
    const s = stateRef.current;
    if (!s) return null;
    if (loc >= 0 && loc < NUM_CASCADES) {
      const n = runLengthFrom(s, loc, idx);
      if (n === null) return null;
      return { loc, n };
    }
    if (loc >= LOC_FREECELL_BASE && loc < LOC_FREECELL_BASE + NUM_FREECELLS) {
      if (s.free[loc - LOC_FREECELL_BASE] === null) return null;
      return { loc, n: 1 };
    }
    return null;
  };

  // Tap behaviour shared by pointer taps and keyboard activation (Enter/Space
  // on a focused card wrapper): select / move / auto-move.
  const handleTapCard = (loc: number, idx: number) => {
    const sel = selectionRef.current;
    if (sel) {
      if (sel.loc === loc) {
        // Tapped the same source again → auto-move to best destination.
        const s = stateRef.current!;
        const dest = bestDestFor(s, sel.loc, sel.n);
        if (dest !== null) {
          tryMoveSelectionTo(dest);
        } else {
          setSelection(null);
          selectionRef.current = null;
        }
        return;
      }
      // Otherwise treat the tapped card's COLUMN as the destination.
      const destLoc =
        loc >= 0 && loc < NUM_CASCADES
          ? loc
          : loc >= LOC_FREECELL_BASE && loc < LOC_FREECELL_BASE + NUM_FREECELLS
          ? loc
          : LOC_FOUNDATION;
      const moved = tryMoveSelectionTo(destLoc);
      if (!moved) {
        // Re-select the tapped card instead.
        const next = resolveSourceRun(loc, idx);
        setSelection(next);
        selectionRef.current = next;
      }
      return;
    }

    // No selection: select the tapped run.
    const next = resolveSourceRun(loc, idx);
    setSelection(next);
    selectionRef.current = next;
  };

  const onPointerUpBoard = (e: React.PointerEvent) => {
    const p = pressRef.current;
    pressRef.current = null;
    if (!p || gameStateRef.current !== 'playing') return;

    if (p.moved) {
      // Drag-and-drop: source is where the press started, dest is under the pointer.
      const src = resolveSourceRun(p.loc, p.idx);
      if (!src) return;
      const dest = destFromPoint(e.clientX, e.clientY);
      if (dest === null) return;
      selectionRef.current = src;
      const moved = tryMoveSelectionTo(dest);
      if (!moved) {
        setShake(true);
        setTimeout(() => setShake(false), 200);
        selectionRef.current = null;
        setSelection(null);
      }
      return;
    }

    handleTapCard(p.loc, p.idx);
  };

  // Keyboard activation mirrors a tap: Enter/Space on a focused card or empty
  // destination slot runs the exact same handlers as a pointer tap.
  const onKeyDownCard = (e: React.KeyboardEvent, loc: number, idx: number) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    if (gameStateRef.current !== 'playing') return;
    e.preventDefault();
    handleTapCard(loc, idx);
  };

  const onKeyDownEmptyDest = (e: React.KeyboardEvent, dest: number) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    onTapEmptyDest(dest);
  };

  // Tapping an EMPTY destination slot (empty cascade / free cell / foundation).
  const onTapEmptyDest = (dest: number) => {
    if (gameStateRef.current !== 'playing') return;
    if (!selectionRef.current) return;
    const moved = tryMoveSelectionTo(dest);
    if (!moved) {
      setShake(true);
      setTimeout(() => setShake(false), 200);
    }
  };

  // ── Auto-complete: repeatedly send any playable card home. The timer chain
  //    is tracked so unmount can cancel it (review fix: it previously kept
  //    committing moves against refs on a dead component). ──
  const autoComplete = useCallback(() => {
    if (gameStateRef.current !== 'playing') return;
    setSelection(null);
    selectionRef.current = null;
    const step = () => {
      autoFinishTimerRef.current = null;
      const s = stateRef.current;
      if (!s || gameStateRef.current !== 'playing') return;
      // Find any card (cascade top or free cell) that can go to its foundation.
      let move: FreeCellMove | null = null;
      for (let c = 0; c < NUM_CASCADES; c += 1) {
        const col = s.cascades[c]!;
        if (col.length === 0) continue;
        const card = col[col.length - 1]!;
        if (s.found[suitOf(card)] === rankOf(card) - 1) {
          move = { f: c, t: LOC_FOUNDATION, n: 1 };
          break;
        }
      }
      if (!move) {
        for (let i = 0; i < NUM_FREECELLS; i += 1) {
          const card = s.free[i];
          if (card === null || card === undefined) continue;
          if (s.found[suitOf(card)] === rankOf(card) - 1) {
            move = { f: LOC_FREECELL_BASE + i, t: LOC_FOUNDATION, n: 1 };
            break;
          }
        }
      }
      if (!move) return;
      commitMove(move);
      if (!isWon(stateRef.current!)) {
        autoFinishTimerRef.current = window.setTimeout(step, 90);
      }
    };
    step();
  }, [commitMove]);

  // Whether the board is trivially auto-completable (no card is blocked).
  const canAutoComplete = useMemo(() => {
    if (!state || gameState !== 'playing') return false;
    // Playable iff every cascade is a fully-ordered descending run AND at least
    // one card can currently move home (otherwise there is nothing to auto-do).
    for (let c = 0; c < NUM_CASCADES; c += 1) {
      const col = state.cascades[c]!;
      for (let i = 0; i < col.length - 1; i += 1) {
        if (rankOf(col[i]!) !== rankOf(col[i + 1]!) + 1) return false;
      }
    }
    return true;
  }, [state, gameState]);

  const handleModeChange = useCallback((next: FreecellMode) => {
    const st = gameStateRef.current;
    if (st === 'playing' || st === 'loading') return;
    setMode(next);
    try {
      window.localStorage.setItem(STORAGE_MODE_KEY, next);
    } catch {
      /* storage blocked */
    }
  }, []);

  useEffect(() => {
    const monitor = envMonitorRef.current;
    return () => {
      monitor.stop();
      // Cancel a running auto-finish chain and stop the run state machine so
      // no further moves/submits fire against an unmounted tree (review fix).
      if (autoFinishTimerRef.current !== null) {
        window.clearTimeout(autoFinishTimerRef.current);
        autoFinishTimerRef.current = null;
      }
      gameStateRef.current = 'idle';
    };
  }, []);

  const walletCard = {
    credits: walletBalances.credits,
    progress: { label: 'Daily tickets', current: dailyCreditsProgress.earned, max: dailyCreditsProgress.cap },
  };

  const freeEmpties = state ? state.free.filter((c) => c === null).length : 0;
  const emptyCols = state ? state.cascades.filter((c) => c.length === 0).length : 0;
  const maxMove = state ? (freeEmpties + 1) * 2 ** emptyCols : 1;

  // ── Card renderer ──
  // PlayingCardFace is presentational (no DOM-prop passthrough), so the
  // interactive wrapper carries data-loc/data-idx + the pointer handler.
  // Interactive cards (loc >= 0) are also keyboard-operable: focusable, with
  // Enter/Space running the same tap handler as a pointer tap.
  const renderCard = (card: number, loc: number, idx: number, selected: boolean) => (
    <div
      className='fc-cardwrap'
      data-loc={loc}
      data-idx={idx}
      onPointerDown={loc >= 0 ? (e) => onPointerDownCard(e, loc, idx) : undefined}
      {...(loc >= 0
        ? {
            role: 'button',
            tabIndex: 0,
            'aria-label': `${RANK_NAMES[rankOf(card) - 1]} of ${SUIT_NAMES[suitOf(card)]}`,
            onKeyDown: (e: React.KeyboardEvent) => onKeyDownCard(e, loc, idx),
          }
        : {})}
    >
      <PlayingCardFace
        rank={rankOf(card)}
        suit={suitOf(card) as PlayingCardSuit}
        size='sm'
        className={`fc-card ${selected ? 'fc-selected' : ''}`}
        style={{ ['--pcw' as string]: 'var(--fc-card-w)' }}
      />
    </div>
  );

  const isPlaying = gameState === 'playing';
  const touchDevice = useIsTouchDevice();

  return (
    <div
      className='freecell-midway arc-game-flow'
      style={freecellThemeCssVars(theme)}
    >
      <div className='w-full max-w-xl space-y-3 sm:space-y-4'>
        <div className='hidden sm:block'>
          <PageHeader
            eyebrow='Arcade'
            icon='grid'
            title='FreeCell Sprint'
            subtitle='Clear every card to the foundations — race the clock, every deal is solvable.'
            wallet={walletCard}
          />
        </div>
        <div className='sm:hidden'>
          <GamesWalletCard wallet={walletCard} compact />
        </div>

        {/* Mode + clock bar */}
        <div className='flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between'>
          <ArcadeSegmented<FreecellMode>
            items={MODES.map((m) => ({ value: m, label: MODE_LABELS[m] }))}
            value={mode}
            onChange={isPlaying || gameState === 'loading' ? undefined : handleModeChange}
            ariaLabel='Game mode'
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

        {/* Board */}
        <div className='fc-stage relative'>
          <div
            className='fc-table'
            data-shake={shake || undefined}
            onPointerMove={onPointerMoveBoard}
            onPointerUp={onPointerUpBoard}
            onContextMenu={(e) => e.preventDefault()}
          >
            {/* Top row: free cells + foundations */}
            <div className='fc-top'>
              <div className='fc-frees'>
                {Array.from({ length: NUM_FREECELLS }, (_, i) => {
                  const card = state?.free[i] ?? null;
                  const loc = LOC_FREECELL_BASE + i;
                  const selected = selection?.loc === loc;
                  return (
                    <div
                      key={`free-${i}`}
                      className='fc-slot fc-freecell'
                      data-dest={loc}
                      onClick={() => card === null && onTapEmptyDest(loc)}
                      {...(card === null
                        ? {
                            role: 'button',
                            tabIndex: 0,
                            'aria-label': `Free cell ${i + 1}, empty`,
                            onKeyDown: (e: React.KeyboardEvent) => onKeyDownEmptyDest(e, loc),
                          }
                        : { 'aria-label': `Free cell ${i + 1}` })}
                    >
                      {card !== null ? renderCard(card, loc, 0, selected) : null}
                    </div>
                  );
                })}
              </div>
              <div className='fc-founds'>
                {Array.from({ length: NUM_FOUNDATIONS }, (_, s) => {
                  const rank = state?.found[s] ?? 0;
                  return (
                    <div
                      key={`found-${s}`}
                      className='fc-slot fc-foundation'
                      data-dest={LOC_FOUNDATION}
                      onClick={() => onTapEmptyDest(LOC_FOUNDATION)}
                      role='button'
                      tabIndex={0}
                      aria-label={`${SUIT_NAMES[s]} foundation`}
                      onKeyDown={(e) => onKeyDownEmptyDest(e, LOC_FOUNDATION)}
                    >
                      {rank > 0 ? (
                        renderCard(s * 13 + (rank - 1), -1, -1, false)
                      ) : (
                        <span className='fc-suit-hint' aria-hidden>
                          {['♠', '♥', '♦', '♣'][s]}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Cascades */}
            <div className='fc-cascades'>
              {Array.from({ length: NUM_CASCADES }, (_, c) => {
                const col = state?.cascades[c] ?? [];
                return (
                  <div
                    key={`casc-${c}`}
                    className='fc-col'
                    data-dest={c}
                    onClick={() => col.length === 0 && onTapEmptyDest(c)}
                  >
                    {col.length === 0 ? (
                      <div
                        className='fc-slot fc-empty-col'
                        role='button'
                        tabIndex={0}
                        aria-label={`Column ${c + 1}, empty`}
                        onKeyDown={(e) => onKeyDownEmptyDest(e, c)}
                      />
                    ) : null}
                    {col.map((card, idx) => {
                      const selected =
                        selection?.loc === c && idx >= col.length - selection.n;
                      return (
                        <div
                          key={`${c}-${idx}-${card}`}
                          className='fc-stacked'
                          style={{ marginTop: idx === 0 ? 0 : 'calc(var(--fc-card-w) * -1.02)' }}
                        >
                          {renderCard(card, c, idx, selected)}
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Overlays */}
          {gameState !== 'playing' && gameState !== 'solved' && (
            <div
              className='fc-overlay absolute inset-0 flex flex-col items-center justify-center rounded-well px-4'
              style={{ background: 'color-mix(in srgb, var(--scrim) 80%, transparent)' }}
            >
              {gameState === 'idle' && (
                <>
                  <Spade size={52} className='mb-4 text-tickets-text' />
                  <h1 className='arcade-display mb-2 text-center text-2xl text-strong uppercase sm:text-3xl'>
                    FreeCell Sprint
                  </h1>
                  <p className='mb-6 max-w-xs text-center text-sm text-strong sm:text-base'>
                    Move every card up to the four foundations, ace to king. Tap a card to lift it,
                    tap again to auto-place. Your time starts when the deal lands.
                  </p>
                  <ArcadeButton tone='tickets' size='lg' onClick={() => startGame(mode)}>
                    Deal {MODE_LABELS[mode]}
                  </ArcadeButton>
                </>
              )}
              {gameState === 'loading' && (
                <>
                  <Spade size={52} className='mb-4 text-tickets-text' />
                  <p className='text-center text-sm text-strong sm:text-base'>Shuffling a solvable deal…</p>
                </>
              )}
              {gameState === 'error' && (
                <>
                  <h2 className='arcade-display mb-2 text-2xl text-danger-text uppercase sm:text-3xl'>
                    {needsSignIn ? 'Sign in to play' : 'Something went wrong'}
                  </h2>
                  <p className='mb-4 max-w-xs text-center text-sm text-strong sm:text-base'>
                    {needsSignIn
                      ? 'FreeCell deals are served and verified per account. Sign in to play and save your times.'
                      : (submitError ?? startError ?? 'The deal could not be loaded.')}
                  </p>
                  {(banIndefinite || banUntilMs) && (
                    <p className='mb-2 text-center text-xs text-tickets-text sm:text-sm'>
                      {banIndefinite
                        ? 'You are banned from games until an admin unbans you.'
                        : `Ban time left: ${formatBanCountdown(banUntilMs!)}`}
                    </p>
                  )}
                  {!needsSignIn && (
                    <ArcadeButton tone='tickets' onClick={() => startGame(mode)}>
                      Try again
                    </ArcadeButton>
                  )}
                </>
              )}
            </div>
          )}

          {gameState === 'solved' && (
            <div
              className='fc-overlay absolute inset-0 flex flex-col items-center justify-center rounded-well px-4'
              style={{ background: 'color-mix(in srgb, var(--scrim) 74%, transparent)' }}
            >
              <ArcadeRunResult
                title={isNewPB ? 'new best' : 'cleared'}
                tone={isNewPB ? 'best' : 'win'}
                stats={[
                  { label: 'time', value: formatClock(finalSolveMs ?? elapsedMs), highlight: isNewPB },
                  { label: 'mode', value: MODE_LABELS[mode].toLowerCase() },
                  { label: 'moves', value: finalMoves },
                ]}
                reward={runReward}
                achievements={runAchievements}
                actions={
                  <>
                    <ArcadeRematchButton onClick={() => startGame(mode)}>new deal</ArcadeRematchButton>
                    <ArcadeButton tone='key' onClick={() => setShowLeaderboard(true)}>
                      leaderboard
                    </ArcadeButton>
                  </>
                }
              />
            </div>
          )}
        </div>

        {isSubmitting && <p className='text-center text-xs text-faint sm:text-sm'>Submitting your clear…</p>}

        {/* Action toolbar */}
        <div className='flex flex-wrap items-center justify-center gap-2 sm:gap-3'>
          <ArcadeButton
            tone='ghost'
            size='sm'
            disabled={!isPlaying || historyRef.current.length === 0}
            onClick={undo}
          >
            <Undo2 size={16} className='mr-1' />
            Undo
          </ArcadeButton>
          <ArcadeButton
            tone='tickets'
            size='sm'
            disabled={!isPlaying || !canAutoComplete}
            onClick={autoComplete}
          >
            <Sparkles size={16} className='mr-1' />
            Auto-finish
          </ArcadeButton>
          <div className='rounded-panel border-2 border-ink bg-panel px-3 py-1.5 shadow-panel'>
            <span className='arcade-kicker'>Moves</span>
            <span className='arcade-num ml-2 text-base font-semibold text-strong tabular-nums'>{moveCount}</span>
          </div>
          <div className='rounded-panel border-2 border-ink bg-panel px-3 py-1.5 shadow-panel'>
            <span className='arcade-kicker'>Can move</span>
            <span className='arcade-num ml-2 text-base font-semibold text-strong tabular-nums'>{maxMove}</span>
          </div>
        </div>

        <p className='text-center text-xs text-faint sm:text-sm'>
          {touchDevice
            ? 'Tap a card to lift it, tap a spot to drop — or tap it again to auto-place. Drag works too.'
            : 'Click a card to lift it, click a spot to drop — or click it again to auto-place. Drag works too.'}
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
                showRewardsHint ? 'opacity-100' : 'opacity-0 peer-hover:opacity-100 peer-focus:opacity-100'
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
        title='FreeCell Sprint'
        description={mode === 'daily' ? "Today's shared deal — fastest clear wins." : 'Fastest clear ever, any deal.'}
      >
        <GameLeaderboard
          gameType='freecell'
          mode={mode}
          modes={MODES.map((m) => ({ value: m, label: MODE_LABELS[m] }))}
          onModeChange={
            isPlaying || gameState === 'loading'
              ? undefined
              : (next) => handleModeChange(next as FreecellMode)
          }
          refreshKey={leaderboardRefreshKey}
        />
      </GameLeaderboardModal>
    </div>
  );
}
