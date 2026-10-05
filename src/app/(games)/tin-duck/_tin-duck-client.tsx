'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import * as THREE from 'three';
import { ArcadeButton } from '@/features/arcade/components/ui/arcade-ui';
import { GameLeaderboardButton } from '@/features/arcade/components/game-leaderboard-button';
import { GameLeaderboard } from '@/features/arcade/components/game-leaderboard';
import { GameLeaderboardModal } from '@/features/arcade/components/game-leaderboard-modal';
import {
  GameShell,
  GameStage,
  GameStageNotice,
  GameStat,
  type GameHint,
  type GameHowTo,
  type GamePhase,
  type GameStageSize,
} from '@/features/arcade/components/shell/game-shell';
import type { GameInput } from '@/features/arcade/lib/use-first-input';
import { EnvMonitor } from '@/features/arcade/lib/game-anti-cheat';
import { SoundManager } from '@/features/arcade/lib/sound-manager';
import { playHaptic } from '@/features/arcade/lib/game-haptics';
import { useFeelReducedMotion, useGameFeedback, usePitchLadder } from '@/features/arcade/lib/use-game-feedback';
import { createGameFrameLoop, type GameFrameLoop } from '@/features/arcade/lib/game-frame-loop';
import { markArcadeGameReady } from '@/features/arcade/lib/arcade-performance';
import {
  applyMidwayTier,
  createMidwayDeferredTextures,
  createMidwayLightRig,
  createMidwayQualityController,
  createMidwayRenderer,
  disposeSceneDeep,
  markMidwayFirstFrame,
  type MidwayDeferredTextures,
  type MidwayLightRig,
  type MidwayQualityController,
  type MidwayRendererHandle,
} from '@/features/arcade/lib/midway-three';
import { MidwayStill } from '@/features/arcade/components/midway-still';
import { ArcadeRematchButton, ArcadeRunResult } from '@/features/arcade/components/results/arcade-run-result';
import { useArcadeRunResult } from '@/features/arcade/lib/run-result';
import type { AccountXpReward } from '@/server/arcade/rewards/types';
import {
  GALLERY_BONUS,
  GALLERY_ROUND_MS,
  GALLERY_ROWS,
  GALLERY_MAG_SIZE,
  GALLERY_MAX_SHOTS,
  createGalleryScorer,
  deriveGallerySchedule,
  type GalleryScorer,
  type GalleryShot,
} from '@/server/arcade/tin-duck-gallery';
import {
  RIG_CAMERA,
  RIG_RADIUS,
  RIG_TARGET,
  createGalleryScene,
  type GalleryScene,
  type ImpactEvent,
} from './_tin-duck-scene';
import {
  DEFAULT_TIN_DUCK_THEME,
  buildTinDuckTheme,
  type InventoryCosmeticResponse,
  type TinDuckTheme,
} from './_tin-duck-theme';

import './_tin-duck.css';

/** The gallery sets itself for this long before the clock starts. */
const PREROLL_MS = 450;
const KEY_AIM_SPEED = 620;
const AIM_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyW', 'KeyA', 'KeyS', 'KeyD']);
const POPUPS = 5;

const HINT: GameHint = {
  touch: 'Tap a duck to shoot.',
  pointer: 'Click a duck to shoot.',
};
const HOW_TO: GameHowTo = {
  lines: [
    'Tap where you want the cork to go.',
    'You have 30 seconds. Back rows, bullseyes and the gold duck pay more.',
  ],
};

type GameState = 'idle' | 'playing' | 'gameover' | 'error';

const getSubmitErrorMessage = (
  status: number,
  data: { error?: string; details?: string; retryAfterSec?: number } | null,
) => {
  if (status === 429) {
    const retry = typeof data?.retryAfterSec === 'number' ? ` Try again in ${data.retryAfterSec}s.` : '';
    return `${data?.error ?? 'Too many requests.'}${retry}`;
  }
  if (typeof data?.details === 'string' && data.details.trim()) return data.details;
  if (typeof data?.error === 'string' && data.error.trim()) return data.error;
  return 'Could not start your run. Try again.';
};

export default function TinDuckClient() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fieldRef = useRef<HTMLDivElement>(null);
  const crossRef = useRef<HTMLDivElement>(null);
  const ringRef = useRef<HTMLDivElement>(null);
  const popRefs = useRef<(HTMLDivElement | null)[]>([]);

  const [gameState, setGameState] = useState<GameState>('idle');
  const [score, setScore] = useState(0);
  const [stats, setStats] = useState({ hits: 0, shots: 0, bullseyes: 0 });
  const [bestScore, setBestScore] = useState<number | null>(null);
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const [walletBalances, setWalletBalances] = useState({ credits: 0 });
  const [theme, setTheme] = useState<TinDuckTheme>(DEFAULT_TIN_DUCK_THEME);
  // A skin set's sound tint colours this game's cues while it is open.
  const skinSound = theme.skin?.sound ?? 'house';
  useEffect(() => {
    SoundManager.setTint(skinSound);
    return () => SoundManager.setTint('house');
  }, [skinSound]);
  const { result: runResult, capture: captureRunResult, reset: resetRunResult } = useArcadeRunResult();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isGuestRun, setIsGuestRun] = useState(false);
  const [isNewBest, setIsNewBest] = useState(false);
  const [, setRunAccountXp] = useState<AccountXpReward | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const [isStartingSession, setIsStartingSession] = useState(false);
  const [banUntilMs, setBanUntilMs] = useState<number | null>(null);
  const [banIndefinite, setBanIndefinite] = useState(false);
  const [banNowMs, setBanNowMs] = useState(Date.now());
  const [webglError, setWebglError] = useState(false);
  const [sceneReady, setSceneReady] = useState(false);
  const [canvasSize, setCanvasSize] = useState<{ width: number; height: number } | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const [leaderboardRefreshKey, setLeaderboardRefreshKey] = useState(0);

  const reducedMotion = useFeelReducedMotion();
  const { trigger, shakeOffset } = useGameFeedback();
  const ladder = usePitchLadder();

  const gameStateRef = useRef<GameState>('idle');
  const themeRef = useRef<TinDuckTheme>(DEFAULT_TIN_DUCK_THEME);
  const scorerRef = useRef<GalleryScorer | null>(null);
  const shotsRef = useRef<GalleryShot[]>([]);
  const startPerfRef = useRef(0);
  const shownScoreRef = useRef(0);
  const isStartingRef = useRef(false);
  const sessionTokenRef = useRef<string | null>(null);
  const isGuestRunRef = useRef(false);
  const sessionStartRef = useRef(0);
  const envMonitorRef = useRef(new EnvMonitor());
  const bestRef = useRef(0);
  const lastSecondRef = useRef(-1);
  const bonusCueRef = useRef(false);
  const popIndexRef = useRef(0);
  const reducedRef = useRef(false);
  const pointerInsideRef = useRef(false);
  const crossPosRef = useRef({ x: 0, y: 0 });
  const keysRef = useRef<Set<string>>(new Set());
  const kickRef = useRef(1);
  const canvasSize0 = useRef<{ width: number; height: number } | null>(null);
  const moveCrossRef = useRef<(x: number, y: number) => void>(() => {});
  const scheduleBonusStart = useRef<number | null>(null);

  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const galleryRef = useRef<GalleryScene | null>(null);
  const qualityRef = useRef<MidwayQualityController | null>(null);
  const rigRef = useRef<MidwayLightRig | null>(null);
  const rendererHandleRef = useRef<MidwayRendererHandle | null>(null);
  const deferredRef = useRef<MidwayDeferredTextures | null>(null);
  const deferredStartedRef = useRef(false);
  const frameLoopRef = useRef<GameFrameLoop | null>(null);
  const renderSceneRef = useRef<(now?: number, dtMs?: number) => void>(() => {});
  const perfLoadStartedAtRef = useRef<number | undefined>(
    typeof window === 'undefined' ? undefined : performance.now(),
  );
  const perfReadyRef = useRef(false);
  const lastFrameRef = useRef(0);
  const slopeRef = useRef({ x: 0, y: 0 });
  const builtSizeRef = useRef({ w: 0, h: 0 });
  const projRef = useRef({ x: 0, y: 0 });

  const loadWallet = useCallback(async () => {
    try {
      const response = await fetch('/api/store/inventory?gameType=tin-duck', { cache: 'no-store' });
      if (!response.ok) return;
      const payload = (await response.json()) as InventoryCosmeticResponse;
      setWalletBalances({ credits: payload.wallet?.credits ?? 0 });
      const next = buildTinDuckTheme(payload);
      themeRef.current = next;
      setTheme(next);
    } catch {
      /* wallet and cosmetics are best effort */
    }
  }, []);

  const loadBest = useCallback(async () => {
    try {
      const response = await fetch('/api/games/tin-duck/score', { cache: 'no-store' });
      if (!response.ok) return;
      const data = (await response.json()) as { bestScore?: number };
      if (typeof data.bestScore === 'number' && data.bestScore > 0) {
        bestRef.current = Math.max(bestRef.current, data.bestScore);
        setBestScore(bestRef.current);
      }
    } catch {
      /* the strip stays empty */
    }
  }, []);

  /** The run goes to the server as ray slopes and times; it replays them. */
  const saveScore = useCallback(
    async (finalScore: number, shots: GalleryShot[], durationMs: number) => {
      if (isGuestRunRef.current) return;
      const token = sessionTokenRef.current;
      if (!token) return;
      envMonitorRef.current.stop();
      setSubmitError(null);
      setIsSubmitting(true);
      try {
        const response = await fetch('/api/games/tin-duck/score', {
          method: 'POST',
          keepalive: true,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            score: finalScore,
            sessionToken: token,
            shots: shots.slice(0, GALLERY_MAX_SHOTS),
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
          const err = data as { error?: string; details?: string; retryAfterSec?: number } | null;
          console.error(`[TinDuck] Score rejected (${response.status}): ${err?.details || err?.error || ''}`);
          setSubmitError(getSubmitErrorMessage(response.status, err).replace('Could not start your run.', 'Could not save your run.'));
          return;
        }
        captureRunResult(data);
        const reward = data?.reward as { account?: AccountXpReward; balanceAfter?: number } | undefined;
        if (reward) {
          setRunAccountXp(reward.account ?? null);
          const balanceAfter = Number(reward.balanceAfter);
          if (Number.isFinite(balanceAfter)) setWalletBalances({ credits: Math.max(0, Math.floor(balanceAfter)) });
        }
        setLeaderboardRefreshKey((prev) => prev + 1);
      } catch {
        setSubmitError('Could not save your run. Try again.');
      } finally {
        setIsSubmitting(false);
      }
    },
    [captureRunResult],
  );
  const saveScoreRef = useRef(saveScore);
  saveScoreRef.current = saveScore;

  const formatBanCountdown = (targetMs: number) => {
    const totalSeconds = Math.max(0, Math.floor((targetMs - banNowMs) / 1000));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds
      .toString()
      .padStart(2, '0')}`;
  };

  // ── Crosshair and popups: DOM, moved by the input handlers ──
  const moveCross = useCallback((x: number, y: number, show = true) => {
    crossPosRef.current = { x, y };
    const el = crossRef.current;
    if (!el) return;
    el.style.transform = `translate3d(${x}px, ${y}px, 0)`;
    if (show) {
      el.dataset.on = 'true';
      el.dataset.faint = 'false';
    }
    galleryRef.current?.slopes(x, y, slopeRef.current);
    galleryRef.current?.setAim(slopeRef.current.x, slopeRef.current.y);
  }, []);

  moveCrossRef.current = moveCross;

  const kickCross = useCallback(() => {
    const ring = ringRef.current;
    if (!ring || reducedRef.current) return;
    kickRef.current = kickRef.current === 1 ? 2 : 1;
    ring.dataset.kick = String(kickRef.current);
  }, []);

  const popup = useCallback((x: number, y: number, text: string, big: boolean) => {
    const el = popRefs.current[popIndexRef.current % POPUPS];
    popIndexRef.current += 1;
    if (!el) return;
    const label = el.firstElementChild;
    if (label) label.textContent = text;
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    // A bullseye or the bonus is the paper plate, like a combo.
    el.dataset.tone = big ? 'combo' : 'score';
    el.dataset.run = 'false';
    void el.offsetWidth;
    el.dataset.run = 'true';
  }, []);

  canvasSize0.current = canvasSize;

  // ── What a landed cork does: a clang, a ring, a pock, a number ──
  const onImpact = useCallback(
    (e: ImpactEvent) => {
      if (e.type === 'pock') {
        SoundManager.play('duckPock');
        return;
      }
      const scorer = scorerRef.current;
      const gallery = galleryRef.current;
      const value =
        e.kind === 'bonus'
          ? 10
          : GALLERY_ROWS[e.row]!.value * (e.kind === 'bullseye' ? 3 : e.kind === 'plate' ? 2 : 1);
      shownScoreRef.current += value;
      const step = ladder.next();
      if (e.kind === 'duck') {
        SoundManager.play('duckClang', { pitch: step });
        playHaptic('tick');
      } else if (e.kind === 'plate') {
        SoundManager.play('duckPlate', { pitch: step });
        playHaptic('tick');
        trigger('impact', { sound: false, motion: false, shake: 0.25 });
      } else if (e.kind === 'bullseye') {
        SoundManager.play('duckPlate', { pitch: step * 1.5 });
        SoundManager.play('duckChime', { pitch: 1.5 });
        playHaptic('success');
        trigger('impact', { sound: false, motion: false, shake: 0.6 });
      } else {
        SoundManager.play('duckClang', { pitch: 0.8 });
        SoundManager.play('duckChime', { pitch: 1 });
        playHaptic('success');
        trigger('impact', { sound: false, motion: false, shake: 1 });
      }
      if (gallery && scorer) {
        gallery.project(e.x, e.y + 0.3, e.z, projRef.current);
        popup(projRef.current.x, projRef.current.y, `+${value}`, e.kind === 'bullseye' || e.kind === 'bonus');
      }
    },
    [ladder, popup, trigger],
  );

  // ── Firing: the shot is decided here, the cork is the picture of it ──
  const fireAt = useCallback(
    (px: number, py: number, ts: number) => {
      if (gameStateRef.current !== 'playing') return;
      const gallery = galleryRef.current;
      const scorer = scorerRef.current;
      if (!gallery || !scorer) return;
      moveCross(px, py);
      const t = ts - startPerfRef.current;
      if (t < 0) return;
      const slope = slopeRef.current;
      gallery.slopes(px, py, slope);
      const shotT = Math.floor(t);
      const outcome = scorer.shoot(slope.x, slope.y, shotT);
      if (outcome.type === 'ignored') return;
      shotsRef.current.push({ x: slope.x, y: slope.y, t: shotT });
      if (outcome.type === 'reload-dead') {
        SoundManager.play('duckDry');
        playHaptic('light');
        gallery.dry(t);
        kickCross();
        return;
      }
      SoundManager.play('duckPop');
      playHaptic('tap');
      kickCross();
      if (outcome.type === 'miss') {
        ladder.reset();
        const surface = gallery.surfaceFor(slope.x, slope.y);
        gallery.fire(t, surface, { type: 'pock', x: surface.x, y: surface.y, z: surface.z, flat: surface.flat });
      } else {
        gallery.fire(
          t,
          { x: outcome.wx, y: outcome.wy, z: outcome.wz },
          { type: 'hit', kind: outcome.kind, row: outcome.row, index: outcome.index, x: outcome.wx, y: outcome.wy, z: outcome.wz },
          { kind: outcome.kind, row: outcome.row, index: outcome.index, hitAt: t },
        );
      }
      if (outcome.reloading) SoundManager.play('duckReload');
    },
    [kickCross, ladder, moveCross],
  );

  const endRun = useCallback(() => {
    if (gameStateRef.current !== 'playing') return;
    const scorer = scorerRef.current;
    const final = scorer?.score ?? 0;
    gameStateRef.current = 'gameover';
    shownScoreRef.current = final;
    setScore(final);
    setStats({ hits: scorer?.hits ?? 0, shots: scorer?.shotsFired ?? 0, bullseyes: scorer?.bullseyes ?? 0 });
    setAnnouncement(`Time up, ${final} points.`);
    const prior = bestRef.current;
    const best = final > 0 && final > prior;
    setIsNewBest(best);
    if (final > prior) {
      bestRef.current = final;
      setBestScore(final);
    }
    saveScoreRef.current(final, shotsRef.current.slice(), performance.now() - sessionStartRef.current);
    SoundManager.play('arcadeCashout');
    keysRef.current.clear();
    setGameState('gameover');
  }, []);
  const endRunRef = useRef(endRun);
  endRunRef.current = endRun;

  // ── Scene ──
  const resize3D = useCallback((w: number, h: number) => {
    const renderer = rendererRef.current;
    const gallery = galleryRef.current;
    if (!renderer || !gallery) return;
    // The renderer was built at this size: setting it again reallocates the
    // drawing buffer, which is over a second on the CPU renderer.
    if (builtSizeRef.current.w !== w || builtSizeRef.current.h !== h) {
      renderer.setSize(w, h, false);
      builtSizeRef.current = { w, h };
    }
    gallery.setSize(w, h);
  }, []);

  const buildScene = useCallback((width: number, height: number) => {
    const canvas = canvasRef.current;
    if (!canvas || rendererRef.current) return;
    const quality = qualityRef.current ?? createMidwayQualityController({ game: 'tin-duck' });
    qualityRef.current = quality;
    const tier = quality.tier();

    const fallBack = () => {
      frameLoopRef.current?.stop();
      deferredRef.current?.dispose();
      deferredRef.current = null;
      rigRef.current?.dispose();
      rigRef.current = null;
      galleryRef.current?.dispose();
      galleryRef.current = null;
      const current = sceneRef.current;
      if (current) disposeSceneDeep(current);
      sceneRef.current = null;
      setWebglError(true);
      rendererRef.current = null;
      rendererHandleRef.current?.dispose();
      rendererHandleRef.current = null;
    };
    const handle = createMidwayRenderer({
      canvas,
      tier,
      width,
      height,
      onPause: () => frameLoopRef.current?.stop(),
      onRestore: () => {
        rigRef.current?.refreshEnvironment();
        renderSceneRef.current();
        if (gameStateRef.current === 'playing') frameLoopRef.current?.start();
      },
      onFallback: fallBack,
    });
    if (!handle) {
      setWebglError(true);
      return;
    }
    rendererHandleRef.current = handle;
    rendererRef.current = handle.renderer;
    builtSizeRef.current = { w: width, h: height };

    const t = themeRef.current;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(t.skyBottom);
    sceneRef.current = scene;

    const gallery = createGalleryScene(scene, t, tier);
    gallery.setReduced(reducedRef.current);
    galleryRef.current = gallery;

    const rig = createMidwayLightRig(handle.renderer, scene, {
      tier,
      target: RIG_TARGET,
      radius: RIG_RADIUS,
      camera: RIG_CAMERA,
      sky: t.skyTop,
      ground: t.skyBottom,
    });
    rigRef.current = rig;
    // One lamp, under the awning.
    rig.addPractical([0, 5.0, 1.2], { intensity: 2.4, distance: 24 });
    quality.onChange((next) => {
      applyMidwayTier(handle.renderer, rig, next, { scene, camera: gallery.camera });
      if (gameStateRef.current !== 'playing') renderSceneRef.current();
    });

    // Corks, pocks, particles and the gold duck first show mid-run. Compile
    // them while the page is idle.
    const deferred = createMidwayDeferredTextures('tin-duck', { quality });
    deferredRef.current = deferred;
    // A skin set that arrived before the scene existed paints its backboard
    // with the rest of the deferred textures.
    gallery.setTheme(t, (paint, apply) => deferred.add(paint, (tex) => apply(tex)));
    deferred.add(
      () => {
        gallery.warm(handle.renderer);
        return null;
      },
      () => undefined,
    );
  }, []);

  const renderScene = useCallback((now?: number, dtMs = 16) => {
    const renderer = rendererRef.current;
    const gallery = galleryRef.current;
    if (!renderer || !gallery || !sceneRef.current) return;
    const playing = gameStateRef.current === 'playing';
    const scorer = scorerRef.current;
    const clock = now ?? performance.now();
    const t = playing || gameStateRef.current === 'gameover' ? clock - startPerfRef.current : 0;
    const roundT = Math.min(t, GALLERY_ROUND_MS);
    const shake = shakeOffset(clock);
    const seconds = playing || gameStateRef.current === 'gameover' ? Math.ceil((GALLERY_ROUND_MS - Math.max(0, roundT)) / 1000) : 30;
    const ammoShown = scorer ? scorer.displayAmmo(Math.max(0, t)) : GALLERY_MAG_SIZE;
    const reloadFrac = scorer ? scorer.reloadFraction(Math.max(0, t)) : 0;
    gallery.update(
      playing || gameStateRef.current === 'gameover' ? t : 2500,
      dtMs,
      { score: shownScoreRef.current, seconds, warn: playing && seconds <= 5 },
      { shown: ammoShown, reloadFrac },
      shake,
      onImpact,
    );
    renderer.render(sceneRef.current, gallery.camera);
    const cross = crossRef.current;
    if (cross) cross.dataset.dry = reloadFrac > 0 && ammoShown === 0 ? 'true' : 'false';
  }, [onImpact, shakeOffset]);
  renderSceneRef.current = renderScene;

  // ── Starting a run ──
  const startGame = useCallback(async () => {
    resetRunResult();
    if (isStartingRef.current) return;
    if (!rendererRef.current || !galleryRef.current) return;
    isStartingRef.current = true;
    setIsStartingSession(true);
    setStartError(null);

    // The session carries the seed; the score route replays the shots from it.
    let seed: number | null = null;
    sessionTokenRef.current = null;
    isGuestRunRef.current = false;
    setIsGuestRun(false);
    setSubmitError(null);
    let failed = false;
    try {
      const response = await fetch('/api/games/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gameType: 'tin-duck' }),
      });
      if (response.ok) {
        setBanIndefinite(false);
        setBanUntilMs(null);
        const data = await response.json();
        seed = typeof data.tinDuckSeed === 'number' ? data.tinDuckSeed : null;
        if (seed === null) {
          failed = true;
          setStartError('Could not start your run. Try again.');
        } else {
          sessionTokenRef.current = typeof data.token === 'string' ? data.token : null;
          envMonitorRef.current.start();
        }
      } else if (response.status === 401) {
        // A guest run: a local seed, nothing saved.
        seed = Math.floor(Math.random() * 0x7fffffff) >>> 0;
        isGuestRunRef.current = true;
        setIsGuestRun(true);
      } else {
        failed = true;
        const data = await response.json().catch(() => null);
        if (response.status === 403) {
          setBanIndefinite(Boolean(data?.isIndefinite));
          setBanUntilMs(typeof data?.retryAfterSec === 'number' ? Date.now() + data.retryAfterSec * 1000 : null);
        } else {
          setBanIndefinite(false);
          setBanUntilMs(null);
        }
        setStartError(getSubmitErrorMessage(response.status, data));
      }
    } catch {
      failed = true;
      setStartError('Could not start your run. Try again.');
    } finally {
      isStartingRef.current = false;
      setIsStartingSession(false);
    }
    if (failed || seed === null) {
      gameStateRef.current = 'error';
      setGameState('error');
      return;
    }

    const gallery = galleryRef.current;
    if (!gallery) return;
    const schedule = deriveGallerySchedule(seed);
    scorerRef.current = createGalleryScorer(schedule);
    scheduleBonusStart.current = schedule.bonus.startMs;
    shotsRef.current = [];
    shownScoreRef.current = 0;
    lastSecondRef.current = -1;
    bonusCueRef.current = false;
    ladder.reset();
    const now = performance.now();
    sessionStartRef.current = now;
    startPerfRef.current = now + PREROLL_MS;
    gallery.startRound(schedule, -PREROLL_MS);
    setScore(0);
    setStats({ hits: 0, shots: 0, bullseyes: 0 });
    setAnnouncement('');
    gameStateRef.current = 'playing';
    setGameState('playing');
    SoundManager.unlock();
    SoundManager.play('arcadeReveal');
    lastFrameRef.current = 0;
    frameLoopRef.current?.start();
  }, [ladder, resetRunResult]);

  // ── Input ──
  const localPoint = useCallback((clientX: number, clientY: number) => {
    const rect = fieldRef.current?.getBoundingClientRect();
    if (!rect) return null;
    return { x: clientX - rect.left, y: clientY - rect.top };
  }, []);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (gameStateRef.current !== 'playing') return;
      const p = localPoint(e.clientX, e.clientY);
      if (!p) return;
      pointerInsideRef.current = true;
      fireAt(p.x, p.y, e.nativeEvent.timeStamp > 0 ? Math.min(e.nativeEvent.timeStamp, performance.now()) : performance.now());
    },
    [fireAt, localPoint],
  );
  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (gameStateRef.current === 'gameover' || gameStateRef.current === 'error') return;
      if (e.pointerType === 'touch' && e.buttons === 0) return;
      const p = localPoint(e.clientX, e.clientY);
      if (p) moveCross(p.x, p.y);
    },
    [localPoint, moveCross],
  );
  const handlePointerLeave = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'touch') return;
    pointerInsideRef.current = false;
    if (crossRef.current) crossRef.current.dataset.on = 'false';
  }, []);
  const handlePointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    // A finger keeps the sight where it landed, dimmed.
    if (e.pointerType !== 'touch') return;
    if (crossRef.current) crossRef.current.dataset.faint = 'true';
  }, []);

  const handleStart = useCallback(
    (input: GameInput) => {
      if (input.kind === 'pointer') moveCross(input.x, input.y, input.x > 0 || input.y > 0);
      else if (canvasSize) moveCross(canvasSize.width / 2, canvasSize.height * 0.45);
      void startGame();
    },
    [canvasSize, moveCross, startGame],
  );

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (gameStateRef.current !== 'playing') return;
      if (AIM_KEYS.has(e.code)) {
        e.preventDefault();
        keysRef.current.add(e.code);
        return;
      }
      if ((e.code === 'Space' || e.code === 'Enter') && !e.repeat) {
        e.preventDefault();
        const { x, y } = crossPosRef.current;
        fireAt(x, y, e.timeStamp > 0 ? Math.min(e.timeStamp, performance.now()) : performance.now());
      }
    };
    const onKeyUp = (e: KeyboardEvent) => keysRef.current.delete(e.code);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [fireAt]);

  // ── Effects ──
  useEffect(() => {
    reducedRef.current = reducedMotion;
    galleryRef.current?.setReduced(reducedMotion);
  }, [reducedMotion]);

  const fitCanvas = useCallback(({ width, height }: GameStageSize) => {
    setCanvasSize((prev) =>
      prev && prev.width === Math.floor(width) && prev.height === Math.floor(height)
        ? prev
        : { width: Math.floor(width), height: Math.floor(height) },
    );
  }, []);

  useEffect(() => {
    if (!canvasSize) return;
    buildScene(canvasSize.width, canvasSize.height);
    resize3D(canvasSize.width, canvasSize.height);
    renderScene();
    if (rendererRef.current && !deferredStartedRef.current) {
      deferredStartedRef.current = true;
      markMidwayFirstFrame('tin-duck', qualityRef.current?.tier() ?? 'medium');
      setSceneReady(true);
      deferredRef.current?.start(() => {
        if (gameStateRef.current !== 'playing') renderSceneRef.current();
      });
    }
    if (!crossPosRef.current.x) {
      crossPosRef.current = { x: canvasSize.width / 2, y: canvasSize.height * 0.45 };
    }
    if (perfReadyRef.current || !rendererRef.current) return;
    const frame = window.requestAnimationFrame(() => {
      if (perfReadyRef.current || !rendererRef.current) return;
      perfReadyRef.current = true;
      markArcadeGameReady('tin-duck', perfLoadStartedAtRef.current, { renderer: 'webgl' });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [buildScene, resize3D, renderScene, canvasSize]);

  useEffect(() => {
    const loop = createGameFrameLoop({
      // Every position is a function of the round clock: nothing to step.
      simulate: () => {},
      render: (_alpha, frame) => {
        qualityRef.current?.hold(gameStateRef.current === 'playing');
        qualityRef.current?.frame(frame.nowMs, frame.deltaMs);
        const playing = gameStateRef.current === 'playing';
        const clock = frame.nowMs;
        const t = clock - startPerfRef.current;
        // Held aim keys move the sight on the frame's own time.
        if (playing && keysRef.current.size > 0 && canvasSize0.current) {
          const dt = Math.min(0.05, frame.deltaMs / 1000);
          const k = keysRef.current;
          let { x, y } = crossPosRef.current;
          const dx = (k.has('ArrowRight') || k.has('KeyD') ? 1 : 0) - (k.has('ArrowLeft') || k.has('KeyA') ? 1 : 0);
          const dy = (k.has('ArrowDown') || k.has('KeyS') ? 1 : 0) - (k.has('ArrowUp') || k.has('KeyW') ? 1 : 0);
          x = Math.max(0, Math.min(canvasSize0.current.width, x + dx * KEY_AIM_SPEED * dt));
          y = Math.max(0, Math.min(canvasSize0.current.height, y + dy * KEY_AIM_SPEED * dt));
          moveCrossRef.current(x, y);
        }
        if (playing) {
          const secondsLeft = Math.ceil((GALLERY_ROUND_MS - Math.max(0, t)) / 1000);
          if (secondsLeft !== lastSecondRef.current) {
            lastSecondRef.current = secondsLeft;
            if (secondsLeft <= 5 && secondsLeft >= 1 && t > 0) SoundManager.play('arcadeTick', { volume: 0.5 });
          }
          const bonusAt = scheduleBonusStart.current;
          if (!bonusCueRef.current && bonusAt !== null && t >= bonusAt - 700) {
            bonusCueRef.current = true;
            SoundManager.play('duckChime', { pitch: 0.75, volume: 0.7 });
          }
        }
        renderSceneRef.current(clock, frame.deltaMs);
        if (playing && t >= GALLERY_ROUND_MS) {
          endRunRef.current();
          renderSceneRef.current(clock, 16);
        }
        if (gameStateRef.current !== 'playing') loop.stop();
      },
    });
    frameLoopRef.current = loop;
    return () => {
      loop.destroy();
      if (frameLoopRef.current === loop) frameLoopRef.current = null;
    };
  }, []);

  useEffect(() => {
    themeRef.current = theme;
    galleryRef.current?.setTheme(theme, (paint, apply) => deferredRef.current?.add(paint, apply));
    if (crossRef.current) {
      crossRef.current.style.setProperty('--td-sight', theme.sight);
      crossRef.current.style.setProperty('--td-sight-accent', theme.sightAccent);
    }
    if (gameStateRef.current !== 'playing') renderScene();
  }, [theme, renderScene]);

  useEffect(() => {
    void loadBest();
    void loadWallet();
  }, [loadBest, loadWallet]);

  useEffect(() => {
    const handle = () => void loadWallet();
    window.addEventListener('store-inventory-updated', handle);
    return () => window.removeEventListener('store-inventory-updated', handle);
  }, [loadWallet]);

  // The QA bot reads the live targets through this, with ?arcadePerf=1.
  useEffect(() => {
    if (typeof window === 'undefined' || !window.location.search.includes('arcadePerf=1')) return;
    const w = window as unknown as { __tinDuckProbe?: () => unknown; __tinDuckInfo?: () => unknown };
    w.__tinDuckInfo = () => {
      const info = rendererRef.current?.info;
      return info
        ? { calls: info.render.calls, triangles: info.render.triangles, programs: info.programs?.length ?? 0, textures: info.memory.textures, geometries: info.memory.geometries }
        : null;
    };
    w.__tinDuckProbe = () => {
      const gallery = galleryRef.current;
      const rect = fieldRef.current?.getBoundingClientRect();
      if (!gallery || !rect || gameStateRef.current !== 'playing') return [];
      const t = performance.now() - startPerfRef.current;
      if (t < 0) return [];
      const p = { x: 0, y: 0 };
      return gallery.probe(t).map((item) => {
        const vWorld = item.row < GALLERY_ROWS.length ? GALLERY_ROWS[item.row]!.dir * GALLERY_ROWS[item.row]!.speed : GALLERY_BONUS.speed;
        gallery.project(item.wx + vWorld * 0.1, item.wy, item.wz, p);
        const x2 = p.x;
        return {
          x: rect.left + item.x,
          y: rect.top + item.y,
          vx: (x2 - item.x) / 0.1,
          r: item.r,
          kind: item.kind,
          row: item.row,
        };
      });
    };
    return () => {
      delete w.__tinDuckProbe;
      delete w.__tinDuckInfo;
    };
  }, []);

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

  useEffect(() => {
    const monitor = envMonitorRef.current;
    return () => {
      monitor.stop();
      frameLoopRef.current?.destroy();
      frameLoopRef.current = null;
      deferredRef.current?.dispose();
      deferredRef.current = null;
      rigRef.current?.dispose();
      rigRef.current = null;
      galleryRef.current?.dispose();
      galleryRef.current = null;
      qualityRef.current?.dispose();
      qualityRef.current = null;
      const scene = sceneRef.current;
      if (scene) disposeSceneDeep(scene);
      rendererHandleRef.current?.dispose();
      rendererHandleRef.current = null;
      rendererRef.current = null;
      sceneRef.current = null;
    };
  }, []);

  const phase: GamePhase =
    gameState === 'idle' ? 'ready' : gameState === 'gameover' || gameState === 'error' ? 'over' : 'playing';
  const isBest = gameState === 'gameover' && isNewBest;

  const end =
    gameState === 'gameover' ? (
      <ArcadeRunResult
        title={isBest ? 'New best' : 'Time up'}
        tone={isBest ? 'best' : 'neutral'}
        stats={[
          { label: 'score', value: score, highlight: isBest },
          { label: 'hits', value: stats.hits },
          { label: 'bullseyes', value: stats.bullseyes },
        ]}
        reward={runResult.reward}
        achievements={runResult.achievements}
        saving={isSubmitting}
        error={submitError}
        guest={isGuestRun}
        actions={<ArcadeRematchButton onClick={() => void startGame()} />}
      />
    ) : gameState === 'error' ? (
      <GameStageNotice
        title={banIndefinite || banUntilMs ? 'Banned from games' : 'Connection lost'}
        action={
          <ArcadeButton tone='primary' onClick={() => void startGame()} disabled={isStartingSession}>
            retry
          </ArcadeButton>
        }
      >
        <p>{startError ?? 'Could not reach the server. Try again.'}</p>
        {banIndefinite || banUntilMs ? (
          <p>
            {banIndefinite
              ? 'You are banned until an admin lifts it.'
              : `Ban ends in ${formatBanCountdown(banUntilMs!)}.`}
          </p>
        ) : null}
      </GameStageNotice>
    ) : null;

  return (
    <GameShell
      game='tin-duck'
      stat={<GameStat value={bestScore} label='best' />}
      howTo={HOW_TO}
      tickets={walletBalances.credits}
      below={
        <div className='flex flex-wrap items-center justify-center gap-2'>
          <GameLeaderboardButton onClick={() => setShowLeaderboard(true)} />
        </div>
      }
    >
      <GameStage
        phase={phase}
        hint={HINT}
        busy={isStartingSession ? 'Starting your run.' : !sceneReady && !webglError ? 'Loading the gallery.' : null}
        onStart={handleStart}
        onSize={fitCanvas}
        end={end}
      >
        {webglError ? (
          <MidwayStill
            game='tin-duck'
            alt='Rows of tin ducks on chains and a cork gun.'
            style={canvasSize ? { width: canvasSize.width, height: canvasSize.height } : undefined}
          />
        ) : (
          <div
            ref={fieldRef}
            className='td-field'
            style={{ width: canvasSize?.width ?? '100%', height: canvasSize?.height ?? '100%' }}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerLeave={handlePointerLeave}
            onPointerUp={handlePointerUp}
          >
            <canvas
              ref={canvasRef}
              aria-label='Tin duck gallery. Click or tap to fire the cork gun. Arrow keys aim and space fires.'
              style={{ width: canvasSize?.width ?? '100%', height: canvasSize?.height ?? '100%' }}
            />
            <div ref={crossRef} className='td-cross' data-on='false' aria-hidden='true'>
              <div ref={ringRef} className='td-cross-ring' />
              <span className='td-cross-tick' data-s='t' />
              <span className='td-cross-tick' data-s='b' />
              <span className='td-cross-tick' data-s='l' />
              <span className='td-cross-tick' data-s='r' />
              <span className='td-cross-dot' />
            </div>
            {Array.from({ length: POPUPS }, (_, i) => (
              <div
                key={i}
                ref={(el) => {
                  popRefs.current[i] = el;
                }}
                className='arc-floater td-pop'
                data-tone='score'
                data-numeric
                data-run='false'
                aria-hidden='true'
              >
                <span className='arc-floater-label' />
              </div>
            ))}
            <p className='sr-only' aria-live='polite' aria-atomic='true'>
              {announcement}
            </p>
          </div>
        )}
      </GameStage>

      <GameLeaderboardModal
        open={showLeaderboard}
        onOpenChange={setShowLeaderboard}
        title='Tin duck board'
        description='Highest gallery scores, and your rank.'
      >
        <GameLeaderboard
          gameType='tin-duck'
          maxEntries={5}
          enableFullLeaderboardModal
          fullLeaderboardDisplay='inline'
          refreshKey={leaderboardRefreshKey}
        />
      </GameLeaderboardModal>
    </GameShell>
  );
}
