'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { ArcadeButton } from '@/features/arcade/components/ui/arcade-ui';
import { GameLeaderboardButton } from '@/features/arcade/components/game-leaderboard-button';
import { GameLeaderboard } from '@/features/arcade/components/game-leaderboard';
import { GameLeaderboardModal } from '@/features/arcade/components/game-leaderboard-modal';
import { ArcadeGameplayCallouts } from '@/features/arcade/components/gameplay/arcade-game-hud';
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
import { EnvMonitor } from '@/features/arcade/lib/game-anti-cheat';
import { SoundManager } from '@/features/arcade/lib/sound-manager';
import { playHaptic } from '@/features/arcade/lib/game-haptics';
import { useFeelReducedMotion, useGameFeedback, usePitchLadder } from '@/features/arcade/lib/use-game-feedback';
import { useGameplayCallouts, useNewBestMoment } from '@/features/arcade/lib/use-gameplay-callouts';
import { settleEase } from '@/features/arcade/lib/game-feel';
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
import {
  AIM_RANGE,
  BOTTLES,
  RING_COUNT,
  RING_MAX_THROWS,
  RING_ROUND_MS,
  RING_STEP_MS,
  ringAimDepth,
  ringCheckThrow,
  ringGoldBottle,
  ringRoundFinish,
  ringRoundInitial,
  ringRoundStart,
  type RingParams,
  type RingRoundState,
  type RingStepEvent,
  type RingThrow,
} from '@/server/arcade/ring-toss-engine';
import {
  FLICK_THROW_SPEED,
  createRingPlayback,
  flickCurl,
  flickPowerShare,
  flickToParams,
  flickVelocity,
  ringerDropStep,
  type FlickSample,
  type RingPlayback,
  type RingPose,
} from './_ring-flick';
import { RIG_RADIUS, RIG_TARGET, CAMERA_POS, createRingTossScene, type RingTossScene } from './_ring-toss-scene';
import { DEFAULT_RING_TOSS_THEME, buildRingTossTheme, type InventoryCosmeticResponse, type RingTossTheme } from './_ring-toss-theme';
import { fetchRunSession, getSubmitErrorMessage, stampRunStart, type PreparedFailed, type PreparedOk } from './_run-session';

import './_ring-toss.css';

/** The ring rises into the hand this long before the clock starts. */
const PREROLL_MS = 450;
/** A new ring rises into the hand over this long. */
const HAND_RISE_MS = 220;
/** Keep this many ms of pointer samples. */
const SAMPLE_KEEP_MS = 260;
const KEY_HAND_SPEED = 1.6;
/** Holding space sweeps the power up and down: 0 to 1 in this long. */
const KEY_SWEEP_MS = 700;

/** The power gauge's value `ms` after space went down: up, then down, then up. */
function keyPower(ms: number): number {
  const phase = (Math.max(0, ms) % (2 * KEY_SWEEP_MS)) / KEY_SWEEP_MS;
  return phase < 1 ? phase : 2 - phase;
}
const POPUPS = 4;
/** Paper, ticket, red: the power trail's colour by power share. */
const POWER_STOPS: Array<[number, [number, number, number]]> = [
  [0, [244, 235, 220]],
  [0.55, [242, 163, 60]],
  [1, [184, 54, 39]],
];

const HINT: GameHint = {
  touch: 'Flick up to toss a ring.',
  pointer: 'Drag up and let go to toss.',
};
const HOW_TO: GameHowTo = {
  lines: [
    'Flick up to toss. A faster flick throws farther.',
    'A ring on a neck scores its row, 10 to 50, and the gold bottle 100.',
    'Ten rings in 30 seconds. A round of 400 pays 23 tickets.',
  ],
};

type GameState = 'idle' | 'playing' | 'gameover' | 'error';

type Flight = {
  playback: RingPlayback;
  params: RingParams;
  /** Round ms it was thrown. */
  t: number;
  /** Effect ms since release (hit-stop excluded). */
  ms: number;
  index: number;
  dropStep: number | null;
  dropShown: boolean;
};

type Drag = {
  pointerId: number;
  samples: FlickSample[];
  /** The hand as of the last slow moment: where the flick started. */
  hand: number;
  /** The finger's x (CSS px on the field) at that moment. */
  sightPx: number;
};

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

function powerColor(share: number): [number, number, number] {
  for (let i = 1; i < POWER_STOPS.length; i += 1) {
    const [b, cb] = POWER_STOPS[i]!;
    const [a, ca] = POWER_STOPS[i - 1]!;
    if (share <= b) {
      const k = (share - a) / (b - a);
      return [ca[0] + (cb[0] - ca[0]) * k, ca[1] + (cb[1] - ca[1]) * k, ca[2] + (cb[2] - ca[2]) * k];
    }
  }
  return POWER_STOPS[POWER_STOPS.length - 1]![1];
}

export default function RingTossClient() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const trailRef = useRef<HTMLCanvasElement>(null);
  const fieldRef = useRef<HTMLDivElement>(null);
  const popRefs = useRef<(HTMLDivElement | null)[]>([]);
  const powerRef = useRef<HTMLDivElement>(null);

  const [gameState, setGameState] = useState<GameState>('idle');
  const [summary, setSummary] = useState({ score: 0, ringers: 0, golds: 0, bestStreak: 0 });
  const [bestScore, setBestScore] = useState<number | null>(null);
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  // Always a number: without one the shell mounts its own wallet provider,
  // and swapping it in when the balance loads would remount the canvas.
  const [walletBalances, setWalletBalances] = useState<{ credits: number }>({ credits: 0 });
  const [theme, setTheme] = useState<RingTossTheme>(DEFAULT_RING_TOSS_THEME);
  const themeRef = useRef<RingTossTheme>(DEFAULT_RING_TOSS_THEME);
  // A skin set's sound tint colours this game's cues while it is open.
  const skinSound = theme.sound;
  useEffect(() => {
    SoundManager.setTint(skinSound);
    return () => SoundManager.setTint('house');
  }, [skinSound]);
  const { result: runResult, capture: captureRunResult, reset: resetRunResult } = useArcadeRunResult();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isGuestRun, setIsGuestRun] = useState(false);
  const [isNewBest, setIsNewBest] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [isStartingSession, setIsStartingSession] = useState(false);
  const [banned, setBanned] = useState(false);
  const [webglError, setWebglError] = useState(false);
  const [sceneReady, setSceneReady] = useState(false);
  const [canvasSize, setCanvasSize] = useState<{ width: number; height: number } | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const [leaderboardRefreshKey, setLeaderboardRefreshKey] = useState(0);

  const reducedMotion = useFeelReducedMotion();
  const { trigger, hitStopClock, shakeOffset } = useGameFeedback();
  const ladder = usePitchLadder();
  const { items: callouts, push: pushCallout, clear: clearCallouts } = useGameplayCallouts();
  const { check: newBestCheck, reset: resetNewBest } = useNewBestMoment(pushCallout, { unit: 'points', y: 18 });

  const gameStateRef = useRef<GameState>('idle');
  const roundRef = useRef<RingRoundState | null>(null);
  const throwsRef = useRef<RingThrow[]>([]);
  const flightRef = useRef<Flight | null>(null);
  const dragRef = useRef<Drag | null>(null);
  // The ring is in the hand on the first frame, before the round starts.
  const handRef = useRef({ h: 0, target: 0, lift: 0, lean: 0, readyAt: 0, visible: true });
  const keysRef = useRef<Set<string>>(new Set());
  /** When space went down to charge a toss (event time), or null. */
  const keyChargeRef = useRef<number | null>(null);
  const trailFadeRef = useRef<{ points: Array<{ x: number; y: number }>; color: [number, number, number]; at: number } | null>(null);
  const trailDrawnRef = useRef(false);
  const startPerfRef = useRef(0);
  const sessionRef = useRef<PreparedOk | null>(null);
  const sessionStartRef = useRef(0);
  const envMonitorRef = useRef(new EnvMonitor());
  const bestRef = useRef(0);
  const bestAtStartRef = useRef(0);
  const shownScoreRef = useRef(0);
  const flashRef = useRef<{ word: string; until: number } | null>(null);
  const popIndexRef = useRef(0);
  const reducedRef = useRef(false);
  const lastSecondRef = useRef(-1);
  const isStartingRef = useRef(false);
  const projRef = useRef({ x: 0, y: 0 });
  const poseRef = useRef<RingPose>({ x: 0, y: 0, z: 0, qw: 1, qx: 0, qy: 0, qz: 0 });

  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const boothRef = useRef<RingTossScene | null>(null);
  const qualityRef = useRef<MidwayQualityController | null>(null);
  const rigRef = useRef<MidwayLightRig | null>(null);
  const rendererHandleRef = useRef<MidwayRendererHandle | null>(null);
  const deferredRef = useRef<MidwayDeferredTextures | null>(null);
  const deferredStartedRef = useRef(false);
  const frameLoopRef = useRef<GameFrameLoop | null>(null);
  const renderSceneRef = useRef<(now: number, dtMs: number, frozenMs: number) => void>(() => {});
  const builtSizeRef = useRef({ w: 0, h: 0 });
  const perfLoadStartedAtRef = useRef<number | undefined>(typeof window === 'undefined' ? undefined : performance.now());
  const perfReadyRef = useRef(false);
  const lastWallRef = useRef(0);

  // ── Wallet and best ──
  const loadWallet = useCallback(async () => {
    try {
      const response = await fetch('/api/store/inventory?gameType=ring-toss', { cache: 'no-store' });
      if (!response.ok) return;
      const payload = (await response.json()) as InventoryCosmeticResponse;
      if (typeof payload.wallet?.credits === 'number') setWalletBalances({ credits: payload.wallet.credits });
      const next = buildRingTossTheme(payload);
      themeRef.current = next;
      setTheme(next);
    } catch {
      /* best effort */
    }
  }, []);
  const loadBest = useCallback(async () => {
    try {
      const response = await fetch('/api/games/ring-toss/score', { cache: 'no-store' });
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

  // ── Saving: the flicks go to the server, which replays them ──
  const saveScore = useCallback(
    async (finalScore: number, throws: RingThrow[], durationMs: number) => {
      const session = sessionRef.current;
      if (!session || session.guest || !session.token) return;
      envMonitorRef.current.stop();
      setSubmitError(null);
      setIsSubmitting(true);
      try {
        const response = await fetch('/api/games/ring-toss/score', {
          method: 'POST',
          keepalive: true,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            score: finalScore,
            sessionToken: session.token,
            throws: throws.slice(0, RING_MAX_THROWS),
            clientDurationMs: Math.max(0, Math.round(durationMs)),
            env: envMonitorRef.current.getFingerprint(),
          }),
        });
        const raw = await response.text();
        let data: Record<string, unknown> | null = null;
        try {
          data = raw ? JSON.parse(raw) : null;
        } catch {
          data = null;
        }
        if (!response.ok) {
          setSubmitError(getSubmitErrorMessage(response.status, data as { error?: string } | null));
          return;
        }
        captureRunResult(data);
        const reward = data?.reward as { balanceAfter?: number } | undefined;
        const balanceAfter = Number(reward?.balanceAfter);
        if (Number.isFinite(balanceAfter)) setWalletBalances({ credits: Math.max(0, Math.floor(balanceAfter)) });
        setLeaderboardRefreshKey((k) => k + 1);
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

  // ── Popups: the shared callout plate, parked at a bottle ──
  const popup = useCallback((x: number, y: number, text: string, big: boolean) => {
    const el = popRefs.current[popIndexRef.current % POPUPS];
    popIndexRef.current += 1;
    if (!el) return;
    const label = el.firstElementChild;
    if (label) label.textContent = text;
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    el.dataset.tone = big ? 'combo' : 'score';
    el.dataset.run = 'false';
    void el.offsetWidth;
    el.dataset.run = 'true';
  }, []);

  // ── The end of a round ──
  const endRun = useCallback(() => {
    if (gameStateRef.current !== 'playing') return;
    const round = roundRef.current;
    const final = round?.score ?? 0;
    gameStateRef.current = 'gameover';
    shownScoreRef.current = final;
    handRef.current.visible = false;
    dragRef.current = null;
    setSummary({ score: final, ringers: round?.ringers ?? 0, golds: round?.golds ?? 0, bestStreak: round?.bestStreak ?? 0 });
    setAnnouncement(`${final} points, ${round?.ringers ?? 0} ringers.`);
    const best = final > 0 && final > bestAtStartRef.current;
    setIsNewBest(best);
    if (final > bestRef.current) {
      bestRef.current = final;
      setBestScore(final);
    }
    saveScoreRef.current(final, throwsRef.current.slice(), performance.now() - sessionStartRef.current);
    SoundManager.play(best ? 'arcadeWin' : 'arcadeCashout');
    if (best) playHaptic('win');
    keysRef.current.clear();
    setGameState('gameover');
  }, []);
  const endRunRef = useRef(endRun);
  endRunRef.current = endRun;

  // ── A ring's events, as the picture reaches them ──
  const onEvent = useCallback(
    (flight: Flight, e: RingStepEvent, now: number) => {
      const booth = boothRef.current;
      if (!booth) return;
      if (e.type === 'hit') {
        const loud = clamp(e.impulse / 0.9, 0.15, 1);
        if (e.impulse < 0.05) return;
        if (e.kind === 'neck') SoundManager.play('ringClink', { volume: loud, pitch: 0.92 + clamp((e.y - 0.15) * 3, 0, 0.16) });
        else if (e.kind === 'glass') SoundManager.play('ringGlass', { volume: loud, pitch: 0.9 + clamp(e.y * 0.8, 0, 0.2) });
        else if (e.kind === 'ring') SoundManager.play('ringTap', { volume: loud });
        else {
          SoundManager.play('ringWood', { volume: loud, pitch: e.collider === 200 ? 0.85 : 1 });
          booth.dust(e.x, e.y, e.z, loud);
        }
        return;
      }
      if (e.type === 'done' || e.type === 'over') return;
      void flight;
      void now;
    },
    [],
  );

  /** The ringer's moment: the ring lands on the shoulder it rings. */
  const showRinger = useCallback(
    (flight: Flight, now: number) => {
      const booth = boothRef.current;
      const outcome = flight.playback.outcome;
      if (!booth || !outcome || outcome.kind !== 'ringer') return;
      flight.dropShown = true;
      const bottle = BOTTLES[outcome.bottle]!;
      const pitch = ladder.next();
      SoundManager.play('ringDown', { volume: 0.9 });
      SoundManager.play('ringChime', { pitch });
      if (outcome.gold) SoundManager.play('ringGold');
      playHaptic(outcome.gold ? 'success' : 'tick');
      trigger('impact', { sound: false, motion: false, hitStop: true, shake: outcome.gold ? 1 : 0.45 });
      booth.flashBottle(outcome.bottle, now, outcome.gold);
      booth.burst(outcome.bottle, outcome.gold);
      booth.project(bottle.x, 0.27, bottle.z, projRef.current);
      popup(projRef.current.x, projRef.current.y, `+${outcome.points}`, outcome.gold);
      flashRef.current = { word: outcome.gold ? 'gold' : 'ringer', until: now + 900 };
      const round = roundRef.current;
      if (round) {
        shownScoreRef.current += outcome.points;
        newBestCheck(shownScoreRef.current, bestAtStartRef.current);
      }
      setAnnouncement(`Ringer, ${outcome.points} points.`);
    },
    [ladder, newBestCheck, popup, trigger],
  );

  /** A ring at rest: record it, put it down, ready the next. */
  const finishFlight = useCallback(
    (flight: Flight, now: number) => {
      const round = roundRef.current;
      const booth = boothRef.current;
      if (!round || !booth) return;
      const s = flight.playback.state;
      const outcome = s.outcome;
      if (outcome?.kind === 'ringer' && !flight.dropShown) showRinger(flight, now);
      ringRoundFinish(round, flight.t, s);
      if (!(outcome?.kind === 'miss' && outcome.lost)) {
        booth.setResting(flight.index, { x: s.x, y: s.y, z: s.z, qw: s.qw, qx: s.qx, qy: s.qy, qz: s.qz }, flight.index);
      }
      booth.setLive(null, flight.index);
      if (outcome?.kind === 'miss') {
        ladder.reset();
        setAnnouncement('Missed.');
      }
      flightRef.current = null;
      if (round.thrown >= RING_COUNT) {
        window.setTimeout(() => endRunRef.current(), 420);
        return;
      }
      booth.setGold(ringGoldBottle(round.seed, round.thrown));
      const roundT = now - startPerfRef.current;
      if (roundT < RING_ROUND_MS) {
        const hand = handRef.current;
        hand.visible = true;
        hand.readyAt = now + HAND_RISE_MS;
      }
    },
    [ladder, showRinger],
  );

  // ── Throwing ──
  const throwRing = useCallback(
    (params: RingParams, eventTime: number) => {
      const round = roundRef.current;
      const booth = boothRef.current;
      if (!round || !booth || flightRef.current || gameStateRef.current !== 'playing') return false;
      const t = Math.floor(eventTime - startPerfRef.current);
      const check = ringCheckThrow(round, t, params);
      if (check !== 'ok') return false;
      const state = ringRoundStart(round, params);
      const playback = createRingPlayback(state);
      // The first stretch of flight is stepped now, so the first frame has it.
      playback.lookahead(60);
      const index = round.thrown;
      flightRef.current = { playback, params, t, ms: 0, index, dropStep: null, dropShown: false };
      throwsRef.current.push({ ...params, t });
      handRef.current.visible = false;
      SoundManager.play('ringToss', { volume: 0.5 + 0.5 * params.p });
      playHaptic('tap');
      return true;
    },
    [],
  );

  // ── Scene ──
  const buildScene = useCallback((width: number, height: number) => {
    const canvas = canvasRef.current;
    if (!canvas || rendererRef.current) return;
    const quality = qualityRef.current ?? createMidwayQualityController({ game: 'ring-toss' });
    qualityRef.current = quality;
    const tier = quality.tier();
    const fallBack = () => {
      frameLoopRef.current?.stop();
      deferredRef.current?.dispose();
      deferredRef.current = null;
      rigRef.current?.dispose();
      rigRef.current = null;
      boothRef.current?.dispose();
      boothRef.current = null;
      if (sceneRef.current) disposeSceneDeep(sceneRef.current);
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
        frameLoopRef.current?.start();
      },
      onFallback: fallBack,
    });
    if (!handle) {
      setWebglError(true);
      return;
    }
    rendererHandleRef.current = handle;
    rendererRef.current = handle.renderer;
    // createMidwayRenderer sets the pixel ratio, not the size: size the
    // drawing buffer once here, so resize3D can skip a same-size reallocation.
    handle.renderer.setSize(width, height, false);
    builtSizeRef.current = { w: width, h: height };
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#15110e');
    sceneRef.current = scene;
    const booth = createRingTossScene(scene, tier, themeRef.current);
    booth.setTheme(themeRef.current);
    booth.setReduced(reducedRef.current);
    booth.setSize(width, height);
    boothRef.current = booth;
    const rig = createMidwayLightRig(handle.renderer, scene, {
      tier,
      target: RIG_TARGET,
      radius: RIG_RADIUS,
      camera: CAMERA_POS,
    });
    rigRef.current = rig;
    // One lamp over the crate.
    rig.addPractical([0, 0.9, -0.75], { intensity: 1.6, distance: 4 });
    quality.onChange((next) => {
      applyMidwayTier(handle.renderer, rig, next, { scene, camera: booth.camera });
    });
    const deferred = createMidwayDeferredTextures('ring-toss', { quality });
    deferredRef.current = deferred;
    deferred.add(
      () => {
        booth.warm(handle.renderer);
        return null;
      },
      () => undefined,
    );
  }, []);

  const resize3D = useCallback((w: number, h: number) => {
    const renderer = rendererRef.current;
    const booth = boothRef.current;
    if (!renderer || !booth) return;
    if (builtSizeRef.current.w !== w || builtSizeRef.current.h !== h) {
      renderer.setSize(w, h, false);
      builtSizeRef.current = { w, h };
    }
    booth.setSize(w, h);
    const trail = trailRef.current;
    if (trail) {
      const ratio = Math.min(2, window.devicePixelRatio || 1);
      trail.width = Math.round(w * ratio);
      trail.height = Math.round(h * ratio);
    }
  }, []);

  const renderScene = useCallback(
    (now: number, dtMs: number, frozenMs: number) => {
      const renderer = rendererRef.current;
      const booth = boothRef.current;
      const scene = sceneRef.current;
      if (!renderer || !booth || !scene) return;
      const playing = gameStateRef.current === 'playing';
      const effMs = Math.max(0, dtMs - frozenMs);

      // The flight.
      const flight = flightRef.current;
      if (flight) {
        flight.playback.lookahead(280);
        if (flight.playback.finished && flight.dropStep === null && flight.playback.outcome?.kind === 'ringer') {
          flight.dropStep = ringerDropStep(flight.playback.events, flight.playback.outcome.bottle);
        }
        const prev = flight.ms;
        // A stalled tab never runs more than a quarter second at once.
        flight.ms = prev + Math.min(250, effMs);
        const stepped = flight.playback.totalSteps * RING_STEP_MS;
        if (!flight.playback.finished && flight.ms > stepped) flight.ms = stepped;
        for (const e of flight.playback.eventsBetween(prev, flight.ms)) onEvent(flight, e, now);
        if (!flight.dropShown && flight.dropStep !== null && flight.ms >= flight.dropStep * RING_STEP_MS) {
          // Draw the ring on the shoulder, then freeze on it.
          flight.ms = flight.dropStep * RING_STEP_MS;
          showRinger(flight, now);
        }
        flight.playback.sample(flight.ms, poseRef.current);
        booth.setLive(poseRef.current, flight.index);
        if (flight.playback.finished && flight.ms >= stepped) finishFlight(flight, now);
      }

      // The ring in the hand.
      const hand = handRef.current;
      const dt = Math.min(0.05, dtMs / 1000);
      if (playing && keysRef.current.size > 0) {
        const k = keysRef.current;
        const dx = (k.has('ArrowRight') || k.has('KeyD') ? 1 : 0) - (k.has('ArrowLeft') || k.has('KeyA') ? 1 : 0);
        hand.target = clamp(hand.target + dx * KEY_HAND_SPEED * dt, -1, 1);
      }
      const follow = reducedRef.current ? 1 : 1 - Math.exp(-28 * dt);
      hand.h += (hand.target - hand.h) * follow;
      const liftTarget = dragRef.current ? 1 : 0;
      hand.lift += (liftTarget - hand.lift) * (reducedRef.current ? 1 : 1 - Math.exp(-22 * dt));
      hand.lean += (0 - hand.lean) * (1 - Math.exp(-10 * dt));
      const rise = hand.visible ? clamp(1 - (hand.readyAt - now) / HAND_RISE_MS, 0, 1) : 0;
      const risen = reducedRef.current ? 1 : settleEase(rise);
      booth.setHand(hand.h, hand.lift + (1 - risen) * -6, hand.lean, hand.visible && rise > 0, (roundRef.current?.thrown ?? 0));
      const powerEl = powerRef.current;
      if (powerEl) {
        const charging = keyChargeRef.current;
        powerEl.dataset.on = playing && charging !== null && hand.visible ? 'true' : 'false';
        if (charging !== null) powerEl.style.setProperty('--rt-power', keyPower(now - charging).toFixed(3));
      }

      // The clock is the server's: a hit-stop never holds it.
      const roundT = playing || gameStateRef.current === 'gameover' ? now - startPerfRef.current : -1;
      const seconds = roundT < 0 ? 30 : Math.ceil((RING_ROUND_MS - clamp(roundT, 0, RING_ROUND_MS)) / 1000);
      const round = roundRef.current;
      const flash = flashRef.current && flashRef.current.until > now ? flashRef.current.word : null;
      booth.paintSign({
        score: shownScoreRef.current,
        ringsLeft: round ? RING_COUNT - round.thrown - (flightRef.current ? 1 : 0) : RING_COUNT,
        seconds,
        warn: playing && seconds <= 5,
        flash,
      });

      booth.update(now, Math.min(0.05, effMs / 1000), shakeOffset(now));

      // The power trail over the stage.
      const trail = trailRef.current;
      const drag = dragRef.current;
      const tctx = trail && (drag || trailFadeRef.current || trailDrawnRef.current) ? trail.getContext('2d') : null;
      if (trail && tctx) {
        const rect = trail.getBoundingClientRect();
        const sx = trail.width / Math.max(1, rect.width);
        tctx.clearRect(0, 0, trail.width, trail.height);
        trailDrawnRef.current = false;
        let points: Array<{ x: number; y: number }> | null = null;
        let color = POWER_STOPS[0]![1];
        let alpha = 1;
        if (drag && drag.samples.length > 1) {
          const recent = drag.samples.filter((p) => p.t >= performance.now() - 150);
          points = recent.map((p) => ({ x: p.x - rect.left, y: p.y - rect.top }));
          const v = flickVelocity(drag.samples);
          color = powerColor(v ? flickPowerShare(v.forward) : 0);
        } else if (trailFadeRef.current) {
          const age = (now - trailFadeRef.current.at) / 260;
          if (age >= 1 || reducedRef.current) trailFadeRef.current = null;
          else {
            points = trailFadeRef.current.points;
            color = trailFadeRef.current.color;
            alpha = 1 - settleEase(age);
          }
        }
        if (points && points.length > 1) {
          trailDrawnRef.current = true;
          tctx.lineCap = 'round';
          tctx.lineJoin = 'round';
          const n = points.length;
          for (let i = 1; i < n; i += 1) {
            const f = i / (n - 1);
            tctx.strokeStyle = `rgba(${color[0] | 0}, ${color[1] | 0}, ${color[2] | 0}, ${(alpha * (0.25 + 0.75 * f)).toFixed(3)})`;
            tctx.lineWidth = (3 + 17 * f) * sx;
            tctx.beginPath();
            tctx.moveTo(points[i - 1]!.x * sx, points[i - 1]!.y * sx);
            tctx.lineTo(points[i]!.x * sx, points[i]!.y * sx);
            tctx.stroke();
          }
        }
      }

      renderer.render(scene, booth.camera);
    },
    [finishFlight, onEvent, shakeOffset, showRinger],
  );
  renderSceneRef.current = renderScene;

  // ── Starting a round ──
  const startGame = useCallback(async () => {
    resetRunResult();
    if (isStartingRef.current) return;
    if (!rendererRef.current || !boothRef.current) return;
    isStartingRef.current = true;
    setIsStartingSession(true);
    setStartError(null);
    setSubmitError(null);
    let failed: string | null = null;
    let prepared: PreparedOk | null = null;
    try {
      const run = await fetchRunSession();
      if (run.ok) {
        prepared = run;
        if (!run.guest) {
          const stamped = await stampRunStart(run.sessionId);
          if (!stamped) failed = 'Could not start your run. Try again.';
        }
      } else {
        failed = (run as PreparedFailed).error;
        setBanned((run as PreparedFailed).banned);
      }
    } finally {
      isStartingRef.current = false;
      setIsStartingSession(false);
    }
    if (failed || !prepared) {
      setStartError(failed ?? 'Could not reach the server. Try again.');
      gameStateRef.current = 'error';
      setGameState('error');
      return;
    }
    sessionRef.current = prepared;
    setIsGuestRun(prepared.guest);
    if (!prepared.guest) envMonitorRef.current.start();
    const booth = boothRef.current;
    if (!booth) return;
    const round = ringRoundInitial(prepared.seed);
    roundRef.current = round;
    throwsRef.current = [];
    flightRef.current = null;
    dragRef.current = null;
    shownScoreRef.current = 0;
    flashRef.current = null;
    lastSecondRef.current = -1;
    bestAtStartRef.current = bestRef.current;
    ladder.reset();
    resetNewBest();
    clearCallouts();
    booth.resetRound();
    booth.setGold(ringGoldBottle(round.seed, 0));
    const now = performance.now();
    sessionStartRef.current = now;
    startPerfRef.current = now + PREROLL_MS;
    const hand = handRef.current;
    hand.visible = true;
    hand.readyAt = now + PREROLL_MS;
    setSummary({ score: 0, ringers: 0, golds: 0, bestStreak: 0 });
    setAnnouncement('');
    setIsNewBest(false);
    gameStateRef.current = 'playing';
    setGameState('playing');
    SoundManager.unlock();
    SoundManager.play('arcadeReveal');
    frameLoopRef.current?.start();
  }, [clearCallouts, ladder, resetNewBest, resetRunResult]);

  // ── Input ──
  const canThrow = () => {
    const hand = handRef.current;
    return gameStateRef.current === 'playing' && !flightRef.current && hand.visible && performance.now() >= hand.readyAt;
  };

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      if (gameStateRef.current !== 'playing') return;
      e.preventDefault();
      // The press answers in this frame: a click, a tap, the ring lifts.
      trigger('press', { haptic: true });
      const booth = boothRef.current;
      const rect = fieldRef.current?.getBoundingClientRect();
      if (!booth || !rect) return;
      const t = e.nativeEvent.timeStamp > 0 ? e.nativeEvent.timeStamp : performance.now();
      const h = booth.handFromScreenX(e.clientX - rect.left);
      handRef.current.target = h;
      trailFadeRef.current = null;
      dragRef.current = { pointerId: e.pointerId, samples: [{ x: e.clientX, y: e.clientY, t }], hand: h, sightPx: e.clientX - rect.left };
      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    },
    [trigger],
  );

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    e.preventDefault();
    const native = e.nativeEvent;
    const coalesced = typeof native.getCoalescedEvents === 'function' ? native.getCoalescedEvents() : [];
    const points = coalesced.length > 0 ? coalesced : [native];
    const now = native.timeStamp > 0 ? native.timeStamp : performance.now();
    for (const p of points) {
      drag.samples.push({ x: p.clientX, y: p.clientY, t: typeof p.timeStamp === 'number' && p.timeStamp > 0 ? p.timeStamp : now });
    }
    while (drag.samples.length > 2 && drag.samples[0]!.t < now - SAMPLE_KEEP_MS) drag.samples.shift();
    const booth = boothRef.current;
    const rect = fieldRef.current?.getBoundingClientRect();
    if (!booth || !rect) return;
    // While the finger isn't flicking up, the ring follows it sideways.
    const v = flickVelocity(drag.samples);
    if (!v || v.forward < 0.25) {
      const h = booth.handFromScreenX(e.clientX - rect.left);
      drag.hand = h;
      drag.sightPx = e.clientX - rect.left;
      handRef.current.target = h;
    } else {
      handRef.current.lean = clamp(v.side / Math.max(0.4, v.forward), -1, 1);
    }
  }, []);

  const handlePointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== e.pointerId) return;
      e.preventDefault();
      const now = e.nativeEvent.timeStamp > 0 ? e.nativeEvent.timeStamp : performance.now();
      drag.samples.push({ x: e.clientX, y: e.clientY, t: now });
      dragRef.current = null;
      const rect = fieldRef.current?.getBoundingClientRect();
      const v = flickVelocity(drag.samples);
      if (rect) {
        trailFadeRef.current = {
          points: drag.samples.filter((p) => p.t >= now - 150).map((p) => ({ x: p.x - rect.left, y: p.y - rect.top })),
          color: powerColor(v ? flickPowerShare(v.forward) : 0),
          at: performance.now(),
        };
      }
      if (!v || v.forward < FLICK_THROW_SPEED || !canThrow()) return;
      const booth = boothRef.current;
      if (!booth) return;
      const sight = booth.sightX(drag.sightPx, ringAimDepth(flickPowerShare(v.forward)));
      const params = flickToParams(drag.hand, sight, v.forward, v.side, flickCurl(drag.samples));
      throwRing(params, Math.min(now, performance.now()));
    },
    [throwRing],
  );

  const handlePointerCancel = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (drag && drag.pointerId === e.pointerId) dragRef.current = null;
  }, []);

  useEffect(() => {
    const MOVE = new Set(['ArrowLeft', 'ArrowRight', 'KeyA', 'KeyD']);
    const onKeyDown = (e: KeyboardEvent) => {
      if (gameStateRef.current !== 'playing') return;
      if (MOVE.has(e.code)) {
        e.preventDefault();
        keysRef.current.add(e.code);
        return;
      }
      // Hold space (or enter) to charge: the gauge sweeps up and down, and
      // letting go tosses at the power it shows.
      if ((e.code === 'Space' || e.code === 'Enter') && !e.repeat) {
        e.preventDefault();
        trigger('press', { haptic: true });
        if (!canThrow()) return;
        keyChargeRef.current = e.timeStamp > 0 ? Math.min(e.timeStamp, performance.now()) : performance.now();
        frameLoopRef.current?.start();
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      keysRef.current.delete(e.code);
      if (e.code !== 'Space' && e.code !== 'Enter') return;
      const start = keyChargeRef.current;
      keyChargeRef.current = null;
      if (start === null || !canThrow()) return;
      const t = e.timeStamp > 0 ? Math.min(e.timeStamp, performance.now()) : performance.now();
      const booth = boothRef.current;
      if (!booth) return;
      const h = handRef.current.target;
      const p = Math.round(keyPower(t - start) * 10000) / 10000;
      const sight = booth.sightX(booth.handScreenX(h), ringAimDepth(p));
      throwRing({ h: Math.round(h * 10000) / 10000, p, a: Math.round(clamp(sight / AIM_RANGE, -1, 1) * 10000) / 10000, c: 0 }, t);
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [throwRing, trigger]);

  // ── Effects ──
  useEffect(() => {
    reducedRef.current = reducedMotion;
    boothRef.current?.setReduced(reducedMotion);
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
    renderSceneRef.current(performance.now(), 0, 0);
    if (rendererRef.current && !deferredStartedRef.current) {
      deferredStartedRef.current = true;
      markMidwayFirstFrame('ring-toss', qualityRef.current?.tier() ?? 'medium');
      setSceneReady(true);
      deferredRef.current?.start(() => {
        if (gameStateRef.current !== 'playing') renderSceneRef.current(performance.now(), 0, 0);
      });
    }
    if (perfReadyRef.current || !rendererRef.current) return;
    const frame = window.requestAnimationFrame(() => {
      if (perfReadyRef.current || !rendererRef.current) return;
      perfReadyRef.current = true;
      markArcadeGameReady('ring-toss', perfLoadStartedAtRef.current, { renderer: 'webgl' });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [buildScene, resize3D, canvasSize]);

  useEffect(() => {
    const loop = createGameFrameLoop({
      // The flight is stepped into a buffer and played by time: nothing to step here.
      simulate: () => {},
      render: (_alpha, frame) => {
        const playing = gameStateRef.current === 'playing';
        qualityRef.current?.hold(playing);
        qualityRef.current?.frame(frame.nowMs, frame.deltaMs);
        const now = frame.nowMs;
        const raw = frame.deltaMs;
        const frozen = raw > 0 ? hitStopClock.frozenWithin(now - raw, now) : 0;
        lastWallRef.current = now;
        if (playing) {
          const t = now - startPerfRef.current;
          const secondsLeft = Math.ceil((RING_ROUND_MS - Math.max(0, t)) / 1000);
          if (secondsLeft !== lastSecondRef.current) {
            lastSecondRef.current = secondsLeft;
            if (secondsLeft <= 5 && secondsLeft >= 1 && t > 0) SoundManager.play('arcadeTick', { volume: 0.5 });
          }
          if (t >= RING_ROUND_MS && handRef.current.visible) {
            // Time: the ring in the hand goes; a ring in the air still lands.
            handRef.current.visible = false;
            dragRef.current = null;
          }
          if (t >= RING_ROUND_MS && !flightRef.current) endRunRef.current();
        }
        renderSceneRef.current(now, raw, frozen);
        const flashing = flashRef.current && flashRef.current.until > now;
        if (gameStateRef.current !== 'playing' && !flashing && !trailFadeRef.current) loop.stop();
      },
    });
    frameLoopRef.current = loop;
    return () => {
      loop.destroy();
      if (frameLoopRef.current === loop) frameLoopRef.current = null;
    };
  }, [hitStopClock]);

  useEffect(() => {
    void loadBest();
    void loadWallet();
  }, [loadBest, loadWallet]);

  useEffect(() => {
    themeRef.current = theme;
    boothRef.current?.setTheme(theme);
    if (gameStateRef.current !== 'playing') renderSceneRef.current(performance.now(), 0, 0);
  }, [theme]);

  useEffect(() => {
    const handle = () => void loadWallet();
    window.addEventListener('store-inventory-updated', handle);
    return () => window.removeEventListener('store-inventory-updated', handle);
  }, [loadWallet]);

  // The QA bot reads the crate through this, with ?arcadePerf=1.
  useEffect(() => {
    if (typeof window === 'undefined' || !window.location.search.includes('arcadePerf=1')) return;
    const w = window as unknown as {
      __ringTossProbe?: () => unknown;
      __ringTossInfo?: () => unknown;
      __ringTossThrow?: (p: RingParams) => boolean;
    };
    w.__ringTossInfo = () => {
      const info = rendererRef.current?.info;
      return info
        ? { attached: rendererRef.current?.domElement.isConnected ?? false, calls: info.render.calls, triangles: info.render.triangles, programs: info.programs?.length ?? 0, textures: info.memory.textures, geometries: info.memory.geometries }
        : null;
    };
    w.__ringTossProbe = () => {
      const booth = boothRef.current;
      const rect = fieldRef.current?.getBoundingClientRect();
      if (!booth || !rect) return null;
      const p = { x: 0, y: 0 };
      const necks = BOTTLES.map((b) => {
        booth.project(b.x, 0.2, b.z, p);
        return { index: b.index, x: rect.left + p.x, y: rect.top + p.y, sight: booth.sightX(p.x, b.z) };
      });
      const round = roundRef.current;
      return {
        necks,
        state: gameStateRef.current,
        ready: canThrow(),
        thrown: round?.thrown ?? 0,
        score: round?.score ?? 0,
        gold: round ? ringGoldBottle(round.seed, round.thrown) : -1,
        flying: Boolean(flightRef.current),
      };
    };
    w.__ringTossThrow = (p: RingParams) => (canThrow() ? throwRing(p, performance.now()) : false);
    return () => {
      delete w.__ringTossProbe;
      delete w.__ringTossInfo;
      delete w.__ringTossThrow;
    };
  }, [throwRing]);

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
      boothRef.current?.dispose();
      boothRef.current = null;
      qualityRef.current?.dispose();
      qualityRef.current = null;
      if (sceneRef.current) disposeSceneDeep(sceneRef.current);
      rendererHandleRef.current?.dispose();
      rendererHandleRef.current = null;
      rendererRef.current = null;
      sceneRef.current = null;
    };
  }, []);

  const phase: GamePhase = gameState === 'idle' ? 'ready' : gameState === 'gameover' || gameState === 'error' ? 'over' : 'playing';

  const end =
    gameState === 'gameover' ? (
      <ArcadeRunResult
        title={isNewBest ? 'New best' : 'Round over'}
        tone={isNewBest ? 'best' : 'neutral'}
        stats={[
          { label: 'score', value: summary.score, highlight: isNewBest },
          { label: 'ringers', value: `${summary.ringers}/${RING_COUNT}` },
          { label: 'gold', value: summary.golds },
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
        title={banned ? 'Banned from games' : 'Connection lost'}
        action={
          <ArcadeButton tone='primary' onClick={() => void startGame()} disabled={isStartingSession}>
            retry
          </ArcadeButton>
        }
      >
        <p>{startError ?? 'Could not reach the server. Try again.'}</p>
      </GameStageNotice>
    ) : null;

  return (
    <GameShell
      game='ring-toss'
      className='ring-toss-midway'
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
        busy={isStartingSession ? 'Starting your run.' : !sceneReady && !webglError ? 'Loading the booth.' : null}
        onStart={() => void startGame()}
        onSize={fitCanvas}
        end={end}
      >
        {webglError ? (
          <MidwayStill
            game='ring-toss'
            alt='A crate of bottles and a ring in your hand.'
            style={canvasSize ? { width: canvasSize.width, height: canvasSize.height } : undefined}
          />
        ) : (
          <div
            ref={fieldRef}
            className='rt-field'
            style={{ width: canvasSize?.width ?? '100%', height: canvasSize?.height ?? '100%' }}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerCancel}
          >
            <canvas
              ref={canvasRef}
              aria-label='Ring toss. Flick up to toss a ring onto the bottles. Arrow keys move the ring, and holding space charges a toss.'
              style={{ width: canvasSize?.width ?? '100%', height: canvasSize?.height ?? '100%' }}
            />
            <canvas ref={trailRef} aria-hidden className='rt-trail' />
            <div ref={powerRef} className='rt-power' data-on='false' aria-hidden='true'>
              <span />
            </div>
            {Array.from({ length: POPUPS }, (_, i) => (
              <div
                key={i}
                ref={(el) => {
                  popRefs.current[i] = el;
                }}
                className='arc-floater rt-pop'
                data-tone='score'
                data-numeric
                data-run='false'
                aria-hidden='true'
              >
                <span className='arc-floater-label' />
              </div>
            ))}
            {gameState === 'playing' ? <ArcadeGameplayCallouts items={callouts} /> : null}
            <p className='sr-only' aria-live='polite' aria-atomic='true'>
              {announcement}
            </p>
          </div>
        )}
      </GameStage>

      <GameLeaderboardModal
        open={showLeaderboard}
        onOpenChange={setShowLeaderboard}
        title='Ring toss board'
        description='Highest round scores, and your rank.'
      >
        <GameLeaderboard
          gameType='ring-toss'
          maxEntries={5}
          enableFullLeaderboardModal
          fullLeaderboardDisplay='inline'
          refreshKey={leaderboardRefreshKey}
        />
      </GameLeaderboardModal>
    </GameShell>
  );
}
