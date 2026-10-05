'use client';

import { renameGameNamesInText } from '@/features/arcade/lib/game-renames';
import {
  useState,
  useRef,
  useEffect,
  useCallback,
  type TouchEvent as ReactTouchEvent,
} from 'react';
import {
  DAS_DELAY,
  ARR_SPEED,
  TETRIS_MAX_CLIENT_SCORE,
  PIECE_SHAPES,
} from './_tetris-config';
import { TetrisEngine, type GameOverData, type LineClearEvent } from './_tetris-engine';
import { TetrisFx, type LockedCell } from './_tetris-effects';
import { TetrisMusic, type TrackId } from './_tetris-music';
import { DEFAULT_TETRIS_THEME, buildTetrisTheme } from './_tetris-theme';
import { drawBoard, drawMiniPiece } from './_tetris-renderer';
import type {
  InventoryCosmeticResponse,
  TetrisCosmeticTheme,
} from './_tetris-types';
import { SoundManager } from '@/features/arcade/lib/sound-manager';
import { useArcadeRunResult } from '@/features/arcade/lib/run-result';
import { playHaptic } from '@/features/arcade/lib/game-haptics';
import { connectGameWs, type GameWsHandle } from '@/features/arcade/lib/game-ws';
import {
  createGameFrameLoop,
  gameCanvasDpr,
  type GameFrameLoop,
} from '@/features/arcade/lib/game-frame-loop';
import { PageHeader, GamesWalletCard } from '@/features/arcade/components/shell/page-header';
import { GamesRouteSwitcher } from '@/features/arcade/components/games-route-switcher';
import { GameLeaderboard } from '@/features/arcade/components/game-leaderboard';
import { GameLeaderboardButton } from '@/features/arcade/components/game-leaderboard-button';
import { GameLeaderboardModal } from '@/features/arcade/components/game-leaderboard-modal';
import { GameInventoryButton } from '@/features/arcade/components/game-inventory-button';
import { GameInventoryModal } from '@/features/arcade/components/game-inventory-modal';
import { useGameplayCallouts } from '@/features/arcade/lib/use-gameplay-callouts';
import { TetrisLeftPanel } from './components/_tetris-left-panel';
import { TetrisMobileBar } from './components/_tetris-mobile-bar';
import { TetrisPlayfield, type TetrisGameState } from './components/_tetris-playfield';
import { TetrisRightPanel } from './components/_tetris-right-panel';

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export default function TetrisClient() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const holdCanvasRef = useRef<HTMLCanvasElement>(null);
  const nextCanvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef(new TetrisEngine());
  const fxRef = useRef(new TetrisFx());
  const frameLoopRef = useRef<GameFrameLoop | null>(null);

  // Only state that drives overlays/UI — NOT updated every frame
  const [gameState, setGameState] = useState<TetrisGameState>('idle');
  const [gameOverData, setGameOverData] = useState<GameOverData | null>(null);
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const [showInventory, setShowInventory] = useState(false);
  const [leaderboardRefresh, setLeaderboardRefresh] = useState(0);
  // The saved track lives in localStorage, which the server can't read:
  // start on the default and pick up the saved one after mount.
  const [currentTrack, setCurrentTrack] = useState<TrackId>('classic');
  // The server has no audio and renders muted, so the first client render
  // does too; the real state (on by default since the feel kit) comes in
  // after mount. Reading it during render broke hydration.
  const [musicMuted, setMusicMuted] = useState(true);

  useEffect(() => {
    setCurrentTrack(TetrisMusic.getTrack());
    setMusicMuted(TetrisMusic.isEffectivelyMuted());
    return SoundManager.subscribe(() => {
      setMusicMuted(TetrisMusic.isEffectivelyMuted());
    });
  }, []);
  const {
    items: gameplayCallouts,
    push: pushGameplayCallout,
    clear: clearGameplayCallouts,
  } = useGameplayCallouts();
  const [isStartingSession, setIsStartingSession] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const {
    reward: runReward,
    achievements: runAchievements,
    capture: captureRunResult,
    reset: resetRunResult,
  } = useArcadeRunResult();
  const [walletBalances, setWalletBalances] = useState({ credits: 0 });
  const [dailyCreditsProgress, setDailyCreditsProgress] = useState({
    earned: 0,
    cap: 300,
  });

  // Theme — stored as ref for 60fps canvas reads AND as state for UI panel colors.
  // Theme only changes infrequently (on load or equip) so the state cost is negligible.
  const themeRef = useRef<TetrisCosmeticTheme>({ ...DEFAULT_TETRIS_THEME });
  const [themeState, setThemeState] = useState<TetrisCosmeticTheme>(DEFAULT_TETRIS_THEME);

  // Use refs for rapidly-changing values to avoid React re-renders every frame
  const scoreRef = useRef(0);
  const levelRef = useRef(1);
  const linesRef = useRef(0);

  // DOM refs for direct manipulation (no React re-render needed)
  const scoreLabelRef = useRef<HTMLParagraphElement>(null);
  const levelLabelRef = useRef<HTMLParagraphElement>(null);
  const linesLabelRef = useRef<HTMLParagraphElement>(null);
  const mobileLabelRef = useRef<HTMLSpanElement>(null);

  // DAS state
  const dasDirectionRef = useRef<'left' | 'right' | null>(null);
  const dasTimerRef = useRef(0);
  const dasActiveRef = useRef(false);
  const softDropRef = useRef(false);

  // Touch state
  const touchStartRef = useRef<{ x: number; y: number; time: number } | null>(null);

  const hasSubmittedRef = useRef(false);
  const sessionTokenRef = useRef<string | null>(null);
  const wsRef = useRef<GameWsHandle | null>(null);
  const gameStartTimeRef = useRef(0);
  const isGuestRunRef = useRef(false);
  const [isGuestRun, setIsGuestRun] = useState(false);

  // ---------------------------------------------------------------------------
  // Direct DOM updates for score/level/lines (no React re-render)
  // ---------------------------------------------------------------------------
  const updateLabels = useCallback(() => {
    const e = engineRef.current;
    if (scoreLabelRef.current && scoreRef.current !== e.stats.score) {
      scoreRef.current = e.stats.score;
      scoreLabelRef.current.textContent = e.stats.score.toLocaleString();
    }
    if (levelLabelRef.current && levelRef.current !== e.stats.level) {
      levelRef.current = e.stats.level;
      levelLabelRef.current.textContent = String(e.stats.level);
    }
    if (linesLabelRef.current && linesRef.current !== e.stats.lines) {
      linesRef.current = e.stats.lines;
      linesLabelRef.current.textContent = String(e.stats.lines);
    }
    if (mobileLabelRef.current) {
      mobileLabelRef.current.textContent = `${e.stats.score.toLocaleString()} | Lv${e.stats.level} | ${e.stats.lines}L`;
    }
  }, []);

  // ---------------------------------------------------------------------------
  // Draw side panels (hold + next) — only when engine.dirty
  // ---------------------------------------------------------------------------
  const drawSidePanels = useCallback(() => {
    const e = engineRef.current;
    const theme = themeRef.current;

    // Hold
    const holdCtx = holdCanvasRef.current?.getContext('2d');
    if (holdCtx) {
      holdCtx.clearRect(0, 0, 80, 60);
      if (e.holdPiece) {
        drawMiniPiece(holdCtx, e.holdPiece, 16, 8, 12, theme, e.holdUsed ? 0.3 : 1.0);
      }
    }

    // Next
    const nextCtx = nextCanvasRef.current?.getContext('2d');
    if (nextCtx) {
      nextCtx.clearRect(0, 0, 80, 320);
      const nextPieces = e.getNextPieces();
      for (let i = 0; i < nextPieces.length; i++) {
        drawMiniPiece(
          nextCtx,
          nextPieces[i],
          16,
          5 + i * 60,
          11,
          theme,
          i === 0 ? 1.0 : 0.5,
        );
      }
    }
  }, []);

  // ---------------------------------------------------------------------------
  // Load theme + wallet from equipped cosmetics
  // ---------------------------------------------------------------------------
  const loadTetrisTheme = useCallback(async () => {
    try {
      const response = await fetch('/api/store/inventory?gameType=tetris', {
        cache: 'no-store',
      });
      if (!response.ok) return;
      const payload = (await response.json()) as InventoryCosmeticResponse;
      setWalletBalances({
        credits: payload.wallet?.credits ?? 0,
      });
      setDailyCreditsProgress({
        earned: payload.dailyGameCredits?.earned ?? 0,
        cap: payload.dailyGameCredits?.cap ?? 300,
      });
      const nextTheme = buildTetrisTheme(payload);
      themeRef.current = nextTheme;
      setThemeState(nextTheme);
      // Force a redraw on the side panels in case we're not in a game loop
      engineRef.current.dirty = true;
      // Force a main board redraw by triggering RAF manually if no game is running
      const canvas = canvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext('2d');
        if (ctx) drawBoard(ctx, engineRef.current, themeRef.current);
      }
    } catch {
      themeRef.current = { ...DEFAULT_TETRIS_THEME };
      setThemeState(DEFAULT_TETRIS_THEME);
    }
  }, []);

  useEffect(() => {
    void loadTetrisTheme();
    const handler = () => {
      void loadTetrisTheme();
    };
    window.addEventListener('store-inventory-updated', handler);
    return () => window.removeEventListener('store-inventory-updated', handler);
  }, [loadTetrisTheme]);

  // ---------------------------------------------------------------------------
  // Game session
  // ---------------------------------------------------------------------------
  const createSession = useCallback(async () => {
    setIsStartingSession(true);
    setStartError(null);
    sessionTokenRef.current = null;
    isGuestRunRef.current = false;
    try {
      const response = await fetch('/api/games/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gameType: 'tetris' }),
      });
      const data = await response.json().catch(() => null);
      if (response.status === 401) {
        // Guest/logged-out visitor — allow a local practice run
        isGuestRunRef.current = true;
        setIsGuestRun(true);
        sessionTokenRef.current = null;
        wsRef.current = null;
        return true;
      }
      if (!response.ok || !data?.token) {
        setStartError(
          typeof data?.error === 'string' && data.error.trim().length > 0
            ? data.error
            : renameGameNamesInText('Could not start a Tetris session. Please try again.'),
        );
        return false;
      }
      setIsGuestRun(false);
      sessionTokenRef.current = data.token;
      // Connect WebSocket for server-side action recording
      try {
        wsRef.current?.close();
        wsRef.current = await connectGameWs(data.token);
      } catch {
        wsRef.current = null;
      }
      return true;
    } catch {
      setStartError(renameGameNamesInText('Could not start a Tetris session. Please try again.'));
      return false;
    } finally {
      setIsStartingSession(false);
    }
  }, []);

  // ---------------------------------------------------------------------------
  // Score submission
  // ---------------------------------------------------------------------------
  const submitScore = useCallback(async (data: GameOverData) => {
    if (hasSubmittedRef.current) return;
    // Guest runs have no token — skip network submission
    if (!sessionTokenRef.current) return;
    if (data.score < 0 || data.score > TETRIS_MAX_CLIENT_SCORE) return;
    hasSubmittedRef.current = true;
    setIsSubmitting(true);
    try {
      const response = await fetch('/api/games/tetris/score', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          score: data.score, level: data.level, lines: data.lines,
          sessionToken: sessionTokenRef.current,
          clientDurationMs: data.durationMs, stats: data.stats,
        }),
      });
      const result = await response.json();
      if (response.ok && result.success) {
        captureRunResult(result);
        setLeaderboardRefresh((n) => n + 1);
        // Reload wallet + theme — Tickets may have updated
        void loadTetrisTheme();
      } else {
        setSubmitError(result.error ?? 'Failed to submit score.');
      }
    } catch {
      setSubmitError('Failed to submit score.');
    } finally {
      setIsSubmitting(false);
    }
  }, [captureRunResult, loadTetrisTheme]);

  // ---------------------------------------------------------------------------
  // Engine callbacks
  // ---------------------------------------------------------------------------
  // Snapshot the current piece's absolute board cells. Engine lock callbacks
  // fire while `current` still points at the placed piece, so this reads the
  // final resting position without touching engine state.
  const snapshotCurrentCells = useCallback((): LockedCell[] => {
    const e = engineRef.current;
    if (!e.current) return [];
    const shape = PIECE_SHAPES[e.current.type][e.current.rotation];
    const cells: LockedCell[] = [];
    for (let r = 0; r < shape.length; r++) {
      for (let c = 0; c < shape[r].length; c++) {
        if (!shape[r][c]) continue;
        cells.push({ x: e.current.x + c, y: e.current.y + r, type: e.current.type });
      }
    }
    return cells;
  }, []);

  // Reduced motion — suppresses shake/particles; flash fades stay subtle.
  useEffect(() => {
    const mql = window.matchMedia('(prefers-reduced-motion: reduce)');
    const apply = () => {
      fxRef.current.reducedMotion = mql.matches;
    };
    apply();
    mql.addEventListener('change', apply);
    return () => mql.removeEventListener('change', apply);
  }, []);

  useEffect(() => {
    const e = engineRef.current;
    e.onLineClear = (event: LineClearEvent) => {
      let clearLabel = '';
      if (event.isTSpin) {
        clearLabel = event.isTSpinMini ? 'T-Spin Mini' : 'T-Spin';
        if (event.linesCleared > 0) {
          clearLabel += ` ${['', 'Single', 'Double', 'Triple'][event.linesCleared]}`;
        }
        SoundManager.play('tetrisTSpin');
      } else if (event.linesCleared === 4) {
        clearLabel = renameGameNamesInText('TETRIS!');
        SoundManager.play('tetrisLineClearMulti');
      } else if (event.linesCleared > 1) {
        clearLabel = ['', 'Single', 'Double', 'Triple'][event.linesCleared] ?? '';
        SoundManager.play('tetrisLineClearMulti');
      } else {
        clearLabel = 'Single';
        SoundManager.play('tetrisLineClear');
      }
      if (event.isBackToBack) clearLabel = `B2B ${clearLabel}`;

      const difficultClear = event.linesCleared === 4 || event.isTSpin;
      pushGameplayCallout({
        label: clearLabel,
        detail: `+${event.points.toLocaleString()}`,
        tone: difficultClear ? 'combo' : 'score',
        x: 50,
        y: 22,
        duration: difficultClear ? 980 : 760,
        announce: difficultClear
          ? `${clearLabel}, ${event.points.toLocaleString()} points`
          : undefined,
      });
      if (event.combo > 0) {
        pushGameplayCallout({
          label: `${event.combo}× combo`,
          detail: event.isBackToBack ? 'back to back' : undefined,
          tone: 'combo',
          x: 50,
          y: 34,
          duration: 900,
          announce:
            event.combo >= 3 ? `${event.combo} times combo` : undefined,
        });
      }

      // Cosmetic burst — board rows are still intact during this callback
      // (they are removed when the clear animation finishes).
      const theme = themeRef.current;
      fxRef.current.onLineClear(event.clearedRows, (row) =>
        engineRef.current.board[row].map((cell) =>
          cell ? theme.blockColors[cell] : theme.lineClearColor,
        ),
      );
      if (event.linesCleared === 4 || event.isTSpin) {
        fxRef.current.onDifficultClear();
        playHaptic('success');
      } else {
        playHaptic('light');
      }
    };
    e.onGameOver = (data: GameOverData) => {
      setGameState('gameover');
      setGameOverData(data);
      TetrisMusic.stop();
      SoundManager.play('tetrisGameOver');
      playHaptic('failure');
      submitScore(data);
    };
    e.onLevelUp = (lvl: number) => {
      SoundManager.play('tetrisLevelUp');
      TetrisMusic.setTempo(1 + Math.min(0.15, (lvl - 1) * 0.01));
      pushGameplayCallout({
        label: `level ${lvl}`,
        detail: 'faster',
        tone: 'success',
        x: 50,
        y: 46,
        duration: 1100,
        announce: `Level ${lvl}`,
      });
    };
    e.onPieceLock = () => {
      SoundManager.play('tetrisPieceLock');
      playHaptic('light');
      const theme = themeRef.current;
      fxRef.current.onPieceLock(
        snapshotCurrentCells(),
        theme.lockFlashColor,
        theme.lockFlashIntensity,
      );
      wsRef.current?.sendEvent('piece_lock', {
        t: Math.max(0, performance.now() - gameStartTimeRef.current),
      });
    };
    e.onHardDrop = () => {
      SoundManager.play('tetrisHardDrop');
      playHaptic('medium');
      const theme = themeRef.current;
      fxRef.current.onHardDrop(
        snapshotCurrentCells(),
        theme.hardDropImpactColor,
        theme.hardDropImpactSize,
      );
    };
    e.onBackToBack = () => SoundManager.play('tetrisBackToBack');
  }, [pushGameplayCallout, submitScore, snapshotCurrentCells]);

  // ---------------------------------------------------------------------------
  // Start game
  // ---------------------------------------------------------------------------
  const startGame = useCallback(async () => {
    if (isStartingSession) return;
    TetrisMusic.unlock();
    const sessionReady = await createSession();
    // Require success; guests are allowed (isGuestRunRef set in createSession)
    if (!sessionReady) {
      return;
    }

    // Sync guest-run state from ref (set during createSession)
    setIsGuestRun(isGuestRunRef.current);

    engineRef.current.start();
    fxRef.current.reset();
    gameStartTimeRef.current = performance.now();
    setGameState('playing');
    setGameOverData(null);
    setSubmitError(null);
    resetRunResult();
    setStartError(null);
    hasSubmittedRef.current = false;
    clearGameplayCallouts();
    drawSidePanels();
    updateLabels();
    TetrisMusic.play();
  }, [clearGameplayCallouts, createSession, drawSidePanels, isStartingSession, resetRunResult, updateLabels]);
  const togglePause = useCallback(() => {
    const paused = engineRef.current.togglePause();
    setGameState(paused ? 'paused' : 'playing');
    if (paused) TetrisMusic.pause();
    else {
      TetrisMusic.unlock();
      TetrisMusic.resume();
    }
  }, []);

  // ---------------------------------------------------------------------------
  // Runtime-owned frame update — canvas draw without per-frame React state.
  // The engine retains its existing delta accumulator for NES gravity timing.
  // ---------------------------------------------------------------------------
  const runFrame = useCallback((dt: number) => {
    const e = engineRef.current;

    if (e.isGameOver) {
      e.updateGameOverAnimation(dt);
    } else if (!e.isPaused) {
      // DAS
      if (dasDirectionRef.current && e.current && e.clearingRows.length === 0) {
        dasTimerRef.current += dt;
        if (!dasActiveRef.current && dasTimerRef.current >= DAS_DELAY) {
          dasActiveRef.current = true;
          dasTimerRef.current = 0;
        }
        if (dasActiveRef.current && dasTimerRef.current >= ARR_SPEED) {
          dasTimerRef.current -= ARR_SPEED;
          if (dasDirectionRef.current === 'left') e.moveLeft();
          else e.moveRight();
        }
      }
      // Soft drop
      if (softDropRef.current) e.softDrop();
      e.update(dt);
    }

    // Cosmetic effects (lock flash, impacts, particles, shake)
    fxRef.current.update(dt);

    // Direct DOM label updates (no React re-render)
    updateLabels();

    // Redraw side panels only when dirty
    if (e.dirty) {
      drawSidePanels();
      e.dirty = false;
    }

    // Draw main board
    const canvas = canvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext('2d');
      if (ctx) drawBoard(ctx, e, themeRef.current, fxRef.current);
    }

  }, [updateLabels, drawSidePanels]);

  // Start/stop the shared scheduler based on game state. Recreating it on
  // pause/game-over preserves the old zero-delta first frame at each boundary.
  useEffect(() => {
    if (gameState === 'playing' || gameState === 'paused' || gameState === 'gameover') {
      frameLoopRef.current?.destroy();
      frameLoopRef.current = createGameFrameLoop({
        simulate: () => undefined,
        render: (_alpha, frame) => runFrame(frame.deltaMs),
        // Preserve the prior clamped catch-up frame after browser throttling;
        // engine.update() still owns gravity and active-play accumulation.
        pauseWhenHidden: false,
      });
      frameLoopRef.current.start();
    }
    return () => {
      frameLoopRef.current?.destroy();
      frameLoopRef.current = null;
    };
  }, [gameState, runFrame]);

  // ---------------------------------------------------------------------------
  // Canvas sizing
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const resize = () => {
      const parent = canvas.parentElement;
      if (!parent) return;
      const width = Math.max(1, Math.floor(parent.clientWidth));
      const height = Math.max(1, Math.floor(parent.clientHeight));
      const dpr = gameCanvasDpr(width, height);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      canvas.width = Math.max(1, Math.floor(width * dpr));
      canvas.height = Math.max(1, Math.floor(height * dpr));
    };
    resize();
    const parent = canvas.parentElement;
    const resizeObserver =
      parent && typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(() => resize())
        : null;
    if (parent && resizeObserver) resizeObserver.observe(parent);
    window.addEventListener('resize', resize);
    window.visualViewport?.addEventListener('resize', resize);
    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener('resize', resize);
      window.visualViewport?.removeEventListener('resize', resize);
    };
  }, []);

  // ---------------------------------------------------------------------------
  // Keyboard
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const e = engineRef.current;
    const onKeyDown = (ev: KeyboardEvent) => {
      if (gameState === 'idle' || gameState === 'gameover') {
        if (ev.key === ' ' || ev.key === 'Enter') { ev.preventDefault(); void startGame(); }
        return;
      }
      if (ev.key === 'Escape' || ev.key === 'p' || ev.key === 'P') {
        ev.preventDefault();
        togglePause();
        return;
      }
      if (e.isPaused || e.isGameOver) return;
      switch (ev.key) {
        case 'ArrowLeft':
          ev.preventDefault();
          if (dasDirectionRef.current !== 'left') {
            dasDirectionRef.current = 'left'; dasTimerRef.current = 0; dasActiveRef.current = false;
            e.moveLeft(); SoundManager.play('tetrisPieceMove');
          }
          break;
        case 'ArrowRight':
          ev.preventDefault();
          if (dasDirectionRef.current !== 'right') {
            dasDirectionRef.current = 'right'; dasTimerRef.current = 0; dasActiveRef.current = false;
            e.moveRight(); SoundManager.play('tetrisPieceMove');
          }
          break;
        case 'ArrowDown': ev.preventDefault(); softDropRef.current = true; break;
        case 'ArrowUp': case 'x': case 'X':
          ev.preventDefault(); if (e.rotateCW()) SoundManager.play('tetrisPieceRotate'); break;
        case 'z': case 'Z':
          ev.preventDefault(); if (e.rotateCCW()) SoundManager.play('tetrisPieceRotate'); break;
        case ' ': ev.preventDefault(); e.hardDrop(); break;
        case 'c': case 'C': case 'Shift': ev.preventDefault(); e.hold(); break;
      }
    };
    const onKeyUp = (ev: KeyboardEvent) => {
      if (ev.key === 'ArrowLeft' && dasDirectionRef.current === 'left') { dasDirectionRef.current = null; dasActiveRef.current = false; }
      if (ev.key === 'ArrowRight' && dasDirectionRef.current === 'right') { dasDirectionRef.current = null; dasActiveRef.current = false; }
      if (ev.key === 'ArrowDown') softDropRef.current = false;
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => { window.removeEventListener('keydown', onKeyDown); window.removeEventListener('keyup', onKeyUp); };
  }, [gameState, startGame, togglePause]);

  // ---------------------------------------------------------------------------
  // Touch
  // ---------------------------------------------------------------------------
  const handleTouchStart = useCallback((ev: ReactTouchEvent) => {
    if (gameState !== 'playing') return;
    const t = ev.touches[0];
    if (t) touchStartRef.current = { x: t.clientX, y: t.clientY, time: Date.now() };
  }, [gameState]);

  const handleTouchEnd = useCallback((ev: ReactTouchEvent) => {
    if (gameState !== 'playing') return;
    const start = touchStartRef.current;
    const t = ev.changedTouches[0];
    if (!start || !t) return;
    const dx = t.clientX - start.x, dy = t.clientY - start.y;
    const absDx = Math.abs(dx), absDy = Math.abs(dy);
    const e = engineRef.current;
    if (absDx < 30 && absDy < 30 && Date.now() - start.time < 300) {
      if (e.rotateCW()) SoundManager.play('tetrisPieceRotate');
    } else if (absDx > absDy && absDx > 30) {
      const moves = Math.max(1, Math.floor(absDx / 40));
      for (let i = 0; i < moves; i++) { if (dx < 0) e.moveLeft(); else e.moveRight(); }
      SoundManager.play('tetrisPieceMove');
    } else if (absDy > 30) {
      if (dy < 0) e.hardDrop(); else e.softDrop();
    }
    touchStartRef.current = null;
  }, [gameState]);

  useEffect(() => {
    if (gameState !== 'playing' && gameState !== 'paused') return;
    const prevent = (ev: Event) => ev.preventDefault();
    document.addEventListener('touchmove', prevent, { passive: false });
    return () => document.removeEventListener('touchmove', prevent);
  }, [gameState]);

  const handleMobileMoveLeft = useCallback(() => {
    if (gameState !== 'playing') return;
    const e = engineRef.current;
    if (e.moveLeft()) SoundManager.play('tetrisPieceMove');
  }, [gameState]);

  const handleMobileRotate = useCallback(() => {
    if (gameState !== 'playing') return;
    const e = engineRef.current;
    if (e.rotateCW()) SoundManager.play('tetrisPieceRotate');
  }, [gameState]);

  const handleMobileMoveRight = useCallback(() => {
    if (gameState !== 'playing') return;
    const e = engineRef.current;
    if (e.moveRight()) SoundManager.play('tetrisPieceMove');
  }, [gameState]);

  const handleMobileSoftDrop = useCallback(() => {
    if (gameState !== 'playing') return;
    engineRef.current.softDrop();
  }, [gameState]);

  const handleMobileHardDrop = useCallback(() => {
    if (gameState !== 'playing') return;
    engineRef.current.hardDrop();
  }, [gameState]);

  const handleMobileHold = useCallback(() => {
    if (gameState !== 'playing') return;
    engineRef.current.hold();
  }, [gameState]);

  // ---------------------------------------------------------------------------
  // Music
  // ---------------------------------------------------------------------------
  const handleTrackChange = useCallback((id: TrackId) => {
    TetrisMusic.unlock();
    TetrisMusic.setTrack(id);
    setCurrentTrack(id);
  }, []);
  const toggleMusicMute = useCallback(() => {
    const effectiveMuted = TetrisMusic.isEffectivelyMuted();
    if (effectiveMuted) {
      TetrisMusic.unlock();
      if (SoundManager.isMuted()) SoundManager.setMuted(false);
      TetrisMusic.setMusicMuted(false);
    } else {
      TetrisMusic.setMusicMuted(true);
    }
    setMusicMuted(TetrisMusic.isEffectivelyMuted());
  }, []);
  useEffect(() => () => { TetrisMusic.stop(); wsRef.current?.close(); }, []);

  const formatTime = (ms: number) => { const s = Math.floor(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
  const walletCard = {
    credits: walletBalances.credits,
    progress: {
      label: 'Daily Tickets',
      current: dailyCreditsProgress.earned,
      max: dailyCreditsProgress.cap,
    },
  };
  const playfieldGlowClass =
    gameState === 'playing'
      ? 'border-prize'
      : gameState === 'paused'
        ? 'border-tickets'
        : gameState === 'gameover'
          ? 'border-danger'
          : 'border-soft';

  return (
    <div className='arc-game-flow bg-background'>
      <div className='mx-auto flex w-full max-w-6xl flex-col gap-3 sm:gap-4'>
        <div className='hidden sm:block'>
          <PageHeader
            eyebrow='tixy'
            icon='circle-dot'
            title={renameGameNamesInText('Tetris')}
            subtitle='Stack fast, keep combos alive, and chase high-score runs.'
            wallet={walletCard}
          />
        </div>
        <div className='sm:hidden'>
          <GamesWalletCard wallet={walletCard} compact />
        </div>
        <GamesRouteSwitcher />
        <div className='arcade-game-surface p-2 sm:p-3'>
          <div className='relative flex min-h-[min(34rem,68dvh)] flex-col items-center justify-center gap-2 px-1 sm:min-h-[min(42rem,78vh)] sm:flex-row sm:gap-3 sm:px-2'>
            <TetrisLeftPanel
              scoreLabelRef={scoreLabelRef}
              levelLabelRef={levelLabelRef}
              linesLabelRef={linesLabelRef}
              currentTrack={currentTrack}
              onTrackChange={handleTrackChange}
              musicMuted={musicMuted}
              onToggleMusicMute={toggleMusicMute}
            />

            <TetrisPlayfield
              canvasRef={canvasRef}
              gameState={gameState}
              playfieldGlowClass={playfieldGlowClass}
              onTouchStart={handleTouchStart}
              onTouchEnd={handleTouchEnd}
              onStartGame={() => {
                void startGame();
              }}
              isStartingSession={isStartingSession}
              startError={startError}
              gameOverData={gameOverData}
              isSubmitting={isSubmitting}
              submitError={submitError}
              reward={runReward}
              achievements={runAchievements}
              isGuestRun={isGuestRun}
              onShowLeaderboard={() => setShowLeaderboard(true)}
              gameplayCallouts={gameplayCallouts}
              formatTime={formatTime}
            />

            <TetrisRightPanel
              themeState={themeState}
              holdCanvasRef={holdCanvasRef}
              nextCanvasRef={nextCanvasRef}
            />

            <TetrisMobileBar
              mobileLabelRef={mobileLabelRef}
              currentTrack={currentTrack}
              onTrackChange={handleTrackChange}
              musicMuted={musicMuted}
              onToggleMusicMute={toggleMusicMute}
              onMoveLeft={handleMobileMoveLeft}
              onRotate={handleMobileRotate}
              onMoveRight={handleMobileMoveRight}
              onSoftDrop={handleMobileSoftDrop}
              onHardDrop={handleMobileHardDrop}
              onHold={handleMobileHold}
              onPauseToggle={togglePause}
              gameState={gameState}
            />
          </div>
        </div>
        <div className='flex flex-wrap items-center justify-center gap-2'>
          <GameInventoryButton
            onClick={() => setShowInventory(true)}
            className='h-10 px-3 py-0 text-xs'
          />
          <GameLeaderboardButton
            onClick={() => setShowLeaderboard(true)}
            className='h-10 px-3 py-0 text-xs'
          />
        </div>
      </div>

      <GameLeaderboardModal
        open={showLeaderboard}
        onOpenChange={setShowLeaderboard}
        title={renameGameNamesInText('Tetris Leaderboard')}
      >
        <GameLeaderboard gameType='tetris' refreshKey={leaderboardRefresh} showFullLeaderboard limit='all' />
      </GameLeaderboardModal>

      <GameInventoryModal
        open={showInventory}
        onOpenChange={(open) => {
          setShowInventory(open);
          if (!open) {
            // Reload theme when inventory closes — user may have equipped something
            void loadTetrisTheme();
          }
        }}
        gameType='tetris'
        title={renameGameNamesInText('Tetris Inventory')}
        description={renameGameNamesInText('Equip blocks, board, effects, and ghost styles for Tetris.')}
      />
    </div>
  );
}
