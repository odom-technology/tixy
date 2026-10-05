'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { ArcadeButton } from '@/features/arcade/components/ui/arcade-ui';
import { GameLeaderboard } from '@/features/arcade/components/game-leaderboard';
import { GameLeaderboardModal } from '@/features/arcade/components/game-leaderboard-modal';
import { GameLeaderboardButton } from '@/features/arcade/components/game-leaderboard-button';
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
import { ArcadeRematchButton, ArcadeRunResult } from '@/features/arcade/components/results/arcade-run-result';
import { EnvMonitor } from '@/features/arcade/lib/game-anti-cheat';
import { gameCanvasDpr, getGame2dContext } from '@/features/arcade/lib/game-frame-loop';
import { createPitchLadder } from '@/features/arcade/lib/game-feel';
import { playHaptic } from '@/features/arcade/lib/game-haptics';
import { SoundManager } from '@/features/arcade/lib/sound-manager';
import { isControlTarget } from '@/features/arcade/lib/use-first-input';
import { useFeelReducedMotion, useGameFeedback } from '@/features/arcade/lib/use-game-feedback';
import { useArcadeRunResult } from '@/features/arcade/lib/run-result';
import {
  LOCK_LEVEL_GAP_MS,
  lockDisplayLeadMs,
  lockInputMs,
  lockLayout,
  lockPress,
  lockReplay,
  lockView,
  type LockEnd,
  type LockLayout,
  type LockView,
} from '@/server/arcade/ticket-stop-lock-engine';

import {
  fetchRunSession,
  getSubmitErrorMessage,
  randomSeed,
  SESSION_MAX_AGE_MS,
  stampRunStart,
  type PreparedFailed,
  type PreparedOk,
  type PreparedRun,
} from './_run-session';
import { drawLock, lockGeometry, LOCK_COLORS, type LockEffects, type LockFonts, type LockGeometry } from './_lock-draw';
import './_lock.css';

/* Ticket stop, the lock (rules 2, prototype). A needle sweeps a dial; tap
   when it is on the amber dot. Each hit turns it round and puts the next dot
   further along. The rules, the clock and the replay live in
   src/server/arcade/ticket-stop-lock-engine.ts; this file draws and listens.

   Every tap is the input event's own timestamp, resolved by the engine in
   the same handler, so its sound, haptic and pop start in the same frame.
   The needle on screen is the engine's angle one frame ahead (the display
   lead), at whatever rate the display runs.

   The session hands out the seed and the server stamps the run's start
   (before the clock starts). When the run ends the client posts its taps and
   the server replays them from the seed to get the score; the score it shows
   is the same replay. Signed out, a run uses a local seed and saves nothing. */

const HINT: GameHint = {
  touch: 'Tap when the needle hits the dot.',
  pointer: 'Click or press space on the dot.',
};
const HOW_TO: GameHowTo = {
  lines: [
    'Tap when the needle is on the amber dot.',
    'Each level is faster, and a tap off the dot, or a dot the needle passes, ends the run.',
    '20 hits pay 18 tickets, and 60 pay 47.',
  ],
  picture: <HowToPicture />,
};

/** After the needle passes a dot, wait this long for an input event stamped
 *  before the pass before calling the miss. Inputs reach the page before the
 *  frame that follows them, so this is a safety margin. */
const PASS_GRACE_MS = 8;
/** From the miss to the result card, ms. */
const END_HOLD_MS = 950;
/** The shackle drops this long before the next level's needle moves, ms. */
const SHACKLE_CLOSE_BEFORE_MS = 280;
const HIT_STOP_MS = 50;

type GameState = 'idle' | 'playing' | 'over' | 'error';

/** Pointer and key events carry epoch or timeOrigin stamps depending on the
 *  browser; put them on the performance.now() clock. */
const eventTime = (timeStamp: number) => {
  if (!Number.isFinite(timeStamp) || timeStamp <= 0) return performance.now();
  return timeStamp > 1e12 ? timeStamp - performance.timeOrigin : timeStamp;
};

declare global {
  interface Window {
    /** ?arcadePerf=1 only: the run's clock, seed and taps, for QA. */
    __ticketStopLockRun?: { runStart: number; seed: number; taps: number[] };
    __ticketStopFrames?: number[];
  }
}

const freshEffects = (count: number): LockEffects => ({
  now: 0,
  reducedMotion: false,
  hit: null,
  dotAt: -1e6,
  miss: null,
  open: null,
  count: { from: count, to: count, at: -1e6 },
  level: { value: 1, at: -1e6 },
});

export default function TicketStopLockClient() {
  const reducedMotion = useFeelReducedMotion();
  const shakeRef = useRef<HTMLDivElement>(null);
  const { trigger, hitStopClock } = useGameFeedback({ stage: shakeRef });

  const [gameState, setGameState] = useState<GameState>('idle');
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0, dpr: 1 });
  const [result, setResult] = useState<{ score: number; level: number } | null>(null);
  const [best, setBest] = useState<number | null>(null);
  const [previousBest, setPreviousBest] = useState<number | null>(null);
  const [announce, setAnnounce] = useState('');
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const [banned, setBanned] = useState(false);
  const [guestRun, setGuestRun] = useState(false);
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const [leaderboardRefreshKey, setLeaderboardRefreshKey] = useState(0);
  const { result: runResult, capture: captureRunResult, reset: resetRunResult } = useArcadeRunResult();

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const geometryRef = useRef<LockGeometry | null>(null);
  const fontsRef = useRef<LockFonts>({ num: 'sans-serif', text: 'sans-serif' });
  const layoutRef = useRef<LockLayout | null>(null);
  const seedRef = useRef(0);
  const tapsRef = useRef<number[]>([]);
  const runStartRef = useRef(0);
  const liveRef = useRef(false);
  const endRef = useRef<LockEnd | null>(null);
  const gameStateRef = useRef<GameState>('idle');
  const reducedRef = useRef(reducedMotion);
  const effectsRef = useRef<LockEffects>(freshEffects(0));
  const ladderRef = useRef(createPitchLadder({ maxSteps: 12 }));
  const frameRef = useRef(0);
  const lastFrameRef = useRef(0);
  const frameIntervalRef = useRef(1000 / 60);
  const endTimerRef = useRef<number | null>(null);
  const perfRef = useRef(false);
  const runRef = useRef<PreparedOk | null>(null);
  const preparingRef = useRef<Promise<PreparedRun> | null>(null);
  const startingRef = useRef(false);
  const envMonitorRef = useRef<EnvMonitor | null>(null);

  useEffect(() => {
    reducedRef.current = reducedMotion;
  }, [reducedMotion]);

  const setState = useCallback((next: GameState) => {
    gameStateRef.current = next;
    setGameState(next);
  }, []);

  /** A new seed and its layout, shown on the ready screen before a run. */
  const prepare = useCallback((given?: number) => {
    const param = new URLSearchParams(window.location.search).get('seed');
    const seed = given ?? (param && /^\d+$/.test(param) ? Number(param) : randomSeed());
    seedRef.current = seed;
    const layout = lockLayout(seed);
    layoutRef.current = layout;
    tapsRef.current = [];
    endRef.current = null;
    const first = lockView(layout, [], 0);
    effectsRef.current = freshEffects(first.hitsLeft);
  }, []);

  useEffect(() => {
    perfRef.current = new URLSearchParams(window.location.search).get('arcadePerf') === '1';
    if (perfRef.current) window.__ticketStopFrames = [];
    const root = getComputedStyle(document.documentElement);
    const num = root.getPropertyValue('--tixy-font-num').trim();
    const text = root.getPropertyValue('--tixy-font-text').trim();
    fontsRef.current = { num: num || "'Big Shoulders', sans-serif", text: text || "'Gabarito', sans-serif" };
    prepare();
  }, [prepare]);

  // ── Session: fetched ahead, so the first press starts at once ───────────

  const prepareRun = useCallback((): Promise<PreparedRun> => {
    if (preparingRef.current) return preparingRef.current;
    const promise = fetchRunSession();
    preparingRef.current = promise;
    void promise.then((prepared) => {
      if (preparingRef.current !== promise) return;
      if (!prepared.ok) {
        // Let the next press try again.
        preparingRef.current = null;
        return;
      }
      // Show the session's own first dot before the first press.
      if (!liveRef.current && gameStateRef.current === 'idle' && !prepared.guest) prepare(prepared.seed);
    });
    return promise;
  }, [prepare]);

  const fetchBest = useCallback(async () => {
    try {
      const response = await fetch('/api/games/ticket-stop/score', { cache: 'no-store' });
      if (!response.ok) return;
      const data = (await response.json()) as { bestScore?: number };
      if (typeof data.bestScore === 'number') setBest(data.bestScore);
    } catch {
      /* the strip just shows nothing */
    }
  }, []);

  useEffect(() => {
    void prepareRun();
    void fetchBest();
    envMonitorRef.current = new EnvMonitor();
  }, [fetchBest, prepareRun]);

  // ── Drawing ─────────────────────────────────────────────────────────────

  /** The engine time a frame at `now` draws: one frame ahead while live. */
  const drawTime = useCallback((now: number) => {
    if (liveRef.current) return now - runStartRef.current + lockDisplayLeadMs(frameIntervalRef.current);
    if (endRef.current) return endRef.current.atMs + 1;
    return 0;
  }, []);

  /** Keep the middle number and the level label in step with the view. */
  const syncDisplay = useCallback((view: LockView) => {
    const e = effectsRef.current;
    let count = view.hitsLeft;
    let level = view.level;
    if (view.phase === 'clear' && (!e.open || e.now < e.open.closeAt)) {
      // The lock is open: the count sits at 0 and the old level stays up
      // until the shackle drops.
      count = 0;
      level = view.level - 1;
    }
    if (count !== e.count.to) e.count = { from: e.count.to, to: count, at: e.now };
    if (level !== e.level.value) e.level = { value: level, at: e.now };
  }, []);

  const paint = useCallback(
    (now: number) => {
      const canvas = canvasRef.current;
      const g = geometryRef.current;
      const layout = layoutRef.current;
      if (!canvas || !g || !layout) return;
      const ctx = getGame2dContext(canvas, { alpha: false });
      if (!ctx) return;
      const e = effectsRef.current;
      // Effects run on their own clock, which a hit-stop holds still.
      const last = lastFrameRef.current || now;
      e.now += Math.max(0, now - last - hitStopClock.frozenWithin(last, now));
      lastFrameRef.current = now;
      e.reducedMotion = reducedRef.current;
      const view = lockView(layout, tapsRef.current, drawTime(now));
      syncDisplay(view);
      const dpr = canvas.width / Math.max(1, g.width);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawLock(ctx, g, view, e, fontsRef.current);
    },
    [drawTime, hitStopClock, syncDisplay],
  );

  /** Post the run's taps. The server replays them and pays; the client's
   *  score is only a claim that must match. */
  const saveRun = useCallback(
    async (prepared: PreparedOk, taps: number[], score: number) => {
      if (prepared.guest || !prepared.token) return;
      envMonitorRef.current?.stop();
      setSaving(true);
      setSubmitError(null);
      try {
        const response = await fetch('/api/games/ticket-stop/score', {
          method: 'POST',
          keepalive: true,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            score,
            sessionToken: prepared.token,
            taps,
            env: envMonitorRef.current?.getFingerprint(),
          }),
        });
        const data = (await response.json().catch(() => null)) as Record<string, unknown> | null;
        if (!response.ok) {
          const err = data as { error?: string; details?: string; retryAfterSec?: number } | null;
          console.error(`[ticket-stop] score rejected (${response.status}): ${err?.details ?? err?.error ?? ''}`);
          setSubmitError(getSubmitErrorMessage(response.status, err));
          return;
        }
        captureRunResult(data);
        setLeaderboardRefreshKey((k) => k + 1);
        // The strip's balance reloads and rolls.
        window.dispatchEvent(new Event('store-inventory-updated'));
      } catch {
        setSubmitError('Could not save your run. Try again.');
      } finally {
        setSaving(false);
      }
    },
    [captureRunResult],
  );

  const finishRun = useCallback(
    (end: LockEnd) => {
      if (!liveRef.current) return;
      liveRef.current = false;
      endRef.current = end;
      const e = effectsRef.current;
      e.miss = { at: e.now };
      ladderRef.current.reset();
      // The needle jams on the stop: the one impact that shakes.
      trigger('impact', { sound: false, motion: false, shake: 1 });
      SoundManager.play('lockJam');
      playHaptic('failure');
      const layout = layoutRef.current;
      const replay = layout ? lockReplay(layout, tapsRef.current) : null;
      const score = replay?.hits.length ?? 0;
      const level = replay?.segment.dot.level ?? 1;
      setAnnounce(`Missed. ${score} ${score === 1 ? 'hit' : 'hits'}, level ${level}.`);
      const prepared = runRef.current;
      runRef.current = null;
      if (prepared) void saveRun(prepared, tapsRef.current.slice(), score);
      endTimerRef.current = window.setTimeout(() => {
        endTimerRef.current = null;
        setResult({ score, level });
        setBest((prev) => Math.max(prev ?? 0, score));
        setState('over');
        // The next run's session, so rematch starts at once.
        void prepareRun();
      }, END_HOLD_MS);
    },
    [prepareRun, saveRun, setState, trigger],
  );

  const loop = useCallback(
    (now: number) => {
      const previous = lastFrameRef.current;
      if (previous > 0 && now - previous > 0 && now - previous < 100) {
        frameIntervalRef.current = frameIntervalRef.current * 0.8 + (now - previous) * 0.2;
        if (perfRef.current) window.__ticketStopFrames?.push(now - previous);
      }
      // A pass: the needle went by the dot untouched.
      const layout = layoutRef.current;
      if (liveRef.current && layout) {
        const t = now - runStartRef.current - PASS_GRACE_MS;
        const replay = lockReplay(layout, tapsRef.current, t);
        if (replay.end) finishRun(replay.end);
      }
      paint(now);
      const e = effectsRef.current;
      const settling = e.miss != null && e.now - e.miss.at < 700;
      if (liveRef.current || settling) {
        frameRef.current = requestAnimationFrame(loop);
      } else {
        frameRef.current = 0;
      }
    },
    [finishRun, paint],
  );

  const ensureLoop = useCallback(() => {
    if (frameRef.current) return;
    lastFrameRef.current = 0;
    frameRef.current = requestAnimationFrame(loop);
  }, [loop]);

  useEffect(
    () => () => {
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
      if (endTimerRef.current) window.clearTimeout(endTimerRef.current);
    },
    [],
  );

  const fitCanvas = useCallback(({ width, height }: GameStageSize) => {
    geometryRef.current = lockGeometry(width, height);
    setCanvasSize({ width, height, dpr: gameCanvasDpr(width, height) });
  }, []);

  // Repaint a still frame when its inputs change, and once the fonts load.
  useEffect(() => {
    if (gameStateRef.current === 'playing') return;
    lastFrameRef.current = 0;
    paint(performance.now());
  }, [canvasSize, reducedMotion, paint, gameState]);
  useEffect(() => {
    void document.fonts?.ready.then(() => {
      if (gameStateRef.current !== 'playing') {
        lastFrameRef.current = 0;
        paint(performance.now());
      }
    });
  }, [paint]);

  // ── A tap ───────────────────────────────────────────────────────────────

  const handleTap = useCallback(
    (timeStamp: number) => {
      const layout = layoutRef.current;
      if (!liveRef.current || !layout) return;
      const at = lockInputMs(eventTime(timeStamp), runStartRef.current);
      const press = lockPress(layout, tapsRef.current, at);
      if (press.kind === 'ignored') {
        // The needle is waiting: the tap still answers, quietly.
        if (press.reason === 'waiting') trigger('press', { haptic: true });
        return;
      }
      tapsRef.current = [...tapsRef.current, at];
      if (perfRef.current && window.__ticketStopLockRun) window.__ticketStopLockRun.taps = tapsRef.current;
      if (press.kind === 'early') {
        finishRun(press.end);
        return;
      }
      const hit = press.hit;
      const e = effectsRef.current;
      const dot = layout.dot(hit.index);
      e.hit = { at: e.now, deg: dot.centreDeg, clears: hit.clears, index: hit.index };
      if (hit.clears) {
        // The lock opens: the biggest moment, and the only hit-stop.
        const openAt = e.now + (reducedRef.current ? 0 : HIT_STOP_MS);
        e.open = { at: openAt, closeAt: e.now + LOCK_LEVEL_GAP_MS - SHACKLE_CLOSE_BEFORE_MS };
        e.dotAt = e.open.closeAt;
        SoundManager.play('lockClick', { pitch: ladderRef.current.next() });
        SoundManager.play('lockOpen');
        trigger('round-win', { sound: false, motion: false, haptic: true, hitStop: HIT_STOP_MS });
        ladderRef.current.reset();
        setAnnounce(`Level ${hit.level} open.`);
      } else {
        e.dotAt = e.now;
        SoundManager.play('lockClick', { pitch: ladderRef.current.next() });
        trigger('collect', { sound: false, motion: false, haptic: true });
      }
      // Show the pop with this frame.
      paint(performance.now());
    },
    [finishRun, paint, trigger],
  );

  // ── Starting a run ──────────────────────────────────────────────────────

  const startRun = useCallback(async () => {
    if (liveRef.current || startingRef.current) return;
    startingRef.current = true;
    if (endTimerRef.current) window.clearTimeout(endTimerRef.current);
    trigger('press', { haptic: true });
    resetRunResult();
    setSubmitError(null);
    setStartError(null);

    let prepared = runRef.current ?? (await prepareRun());
    if (prepared.ok && !prepared.guest && Date.now() - prepared.fetchedAt > SESSION_MAX_AGE_MS) {
      preparingRef.current = null;
      setBusy(true);
      prepared = await prepareRun();
    }
    if (!prepared.ok) {
      // One fresh try before giving up.
      preparingRef.current = null;
      setBusy(true);
      prepared = await prepareRun();
    }
    preparingRef.current = null;

    // The server stamps the start before the clock starts, so it can bound
    // the run from both ends. The stage stays busy while it does. If the
    // stamp fails or times out, the session may or may not be stamped, so it
    // is never stamped again: a fresh session is fetched and stamped instead.
    if (prepared.ok && !prepared.guest) {
      setBusy(true);
      let stamped = await stampRunStart(prepared.sessionId);
      if (!stamped) {
        preparingRef.current = null;
        const fresh = await prepareRun();
        preparingRef.current = null;
        prepared = fresh;
        stamped = fresh.ok && !fresh.guest ? await stampRunStart(fresh.sessionId) : fresh.ok;
      }
      if (prepared.ok && !stamped) {
        prepared = { ok: false, status: 0, error: 'Could not start your run. Try again.', banned: false, retryAfterSec: null };
      }
    }
    setBusy(false);
    startingRef.current = false;

    if (prepared.ok === false) {
      const failed = prepared as PreparedFailed;
      setStartError(failed.error);
      setBanned(failed.banned);
      setState('error');
      return;
    }

    runRef.current = prepared;
    setGuestRun(prepared.guest);
    // A guest keeps the local seed already on the ready screen after a first
    // run; a session's seed is the one the server will replay.
    if (!prepared.guest || gameStateRef.current === 'over') prepare(prepared.seed);
    const layout = layoutRef.current;
    if (!layout) return;
    tapsRef.current = [];
    endRef.current = null;
    const first = lockView(layout, [], 0);
    const e = effectsRef.current;
    effectsRef.current = { ...freshEffects(first.hitsLeft), now: e.now, dotAt: e.now };
    ladderRef.current.reset();
    setResult(null);
    setPreviousBest(best);
    if (!prepared.guest) envMonitorRef.current?.start();
    runStartRef.current = performance.now();
    if (perfRef.current) {
      window.__ticketStopLockRun = { runStart: runStartRef.current, seed: seedRef.current, taps: [] };
    }
    liveRef.current = true;
    setState('playing');
    ensureLoop();
  }, [best, ensureLoop, prepare, prepareRun, resetRunResult, setState, trigger]);

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (gameStateRef.current !== 'playing') return;
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      event.preventDefault();
      handleTap(event.timeStamp);
    },
    [handleTap],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (gameStateRef.current !== 'playing') return;
      if (event.code !== 'Space' && event.code !== 'Enter' && event.code !== 'ArrowUp') return;
      if (isControlTarget(event.target)) return;
      event.preventDefault();
      if (event.repeat) return;
      handleTap(event.timeStamp);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleTap]);

  // ── The result ──────────────────────────────────────────────────────────

  const phase: GamePhase = gameState === 'idle' ? 'ready' : gameState === 'playing' ? 'playing' : 'over';
  const score = result?.score ?? 0;
  const isBest = gameState === 'over' && score > 0 && score > (previousBest ?? 0);

  const end =
    gameState === 'error' ? (
      <GameStageNotice
        title={banned ? 'Banned from games' : 'Connection lost'}
        action={
          banned ? undefined : (
            <ArcadeButton tone='primary' onClick={() => void startRun()} disabled={busy}>
              retry
            </ArcadeButton>
          )
        }
      >
        <p>{startError ?? 'Could not reach the server. Try again.'}</p>
      </GameStageNotice>
    ) : gameState === 'over' && result ? (
      <ArcadeRunResult
        title={isBest ? 'New best' : 'Run over'}
        tone={isBest ? 'best' : 'neutral'}
        stats={[
          { label: 'hits', value: score, highlight: isBest },
          { label: 'level', value: result.level },
          { label: 'best', value: Math.max(best ?? 0, score) },
        ]}
        reward={runResult.reward}
        achievements={runResult.achievements}
        saving={saving}
        error={submitError}
        guest={guestRun}
        actions={<ArcadeRematchButton onClick={() => void startRun()} />}
      />
    ) : null;

  return (
    <GameShell
      game='ticket-stop'
      stat={<GameStat value={best} label='best' />}
      howTo={HOW_TO}
      below={
        <div className='flex flex-wrap items-center justify-center gap-2'>
          <GameLeaderboardButton onClick={() => setShowLeaderboard(true)} />
        </div>
      }
    >
      <GameStage
        phase={phase}
        hint={HINT}
        busy={busy ? 'Starting your run.' : null}
        onStart={() => void startRun()}
        onSize={fitCanvas}
        end={end}
      >
        <div
          ref={shakeRef}
          className='tsl-stage'
          onPointerDown={onPointerDown}
          role={gameState === 'playing' ? 'group' : undefined}
          aria-label={gameState === 'playing' ? 'Press space or tap when the needle meets the dot.' : undefined}
        >
          <canvas
            ref={canvasRef}
            width={Math.max(1, Math.floor(canvasSize.width * canvasSize.dpr))}
            height={Math.max(1, Math.floor(canvasSize.height * canvasSize.dpr))}
            style={{ width: canvasSize.width, height: canvasSize.height }}
            aria-hidden
          />
          <p className='sr-only' aria-live='polite'>
            {announce}
          </p>
        </div>
      </GameStage>

      <GameLeaderboardModal
        open={showLeaderboard}
        onOpenChange={setShowLeaderboard}
        title='ticket stop board'
      >
        <GameLeaderboard
          gameType='ticket-stop'
          maxEntries={5}
          enableFullLeaderboardModal
          fullLeaderboardDisplay='inline'
          refreshKey={leaderboardRefreshKey}
        />
      </GameLeaderboardModal>
    </GameShell>
  );
}

/** The ? sheet's picture: the lock, the needle on the dot. */
function HowToPicture() {
  const C = LOCK_COLORS;
  const dot = (a: number) => ({ x: 80 + Math.sin(a) * 29, y: 62 - Math.cos(a) * 29 });
  const d = dot(0.9);
  return (
    <svg viewBox='0 0 160 110' width={320} height={220} role='img' aria-label='A lock dial with the needle on the amber dot.'>
      <rect width='160' height='110' fill={C.ink} />
      <path d='M60 50 V28 A20 20 0 0 1 100 28 V50' fill='none' stroke={C.brassDark} strokeWidth='8' />
      <circle cx='80' cy='62' r='40' fill={C.brass} />
      <circle cx='80' cy='62' r='37' fill={C.face} />
      <circle cx='80' cy='62' r='29' fill='none' stroke={C.track} strokeWidth='10' />
      <circle cx={d.x.toFixed(1)} cy={d.y.toFixed(1)} r='4.8' fill={C.amber} />
      <line
        x1={(80 + Math.sin(0.86) * 24.5).toFixed(1)}
        y1={(62 - Math.cos(0.86) * 24.5).toFixed(1)}
        x2={(80 + Math.sin(0.86) * 33.5).toFixed(1)}
        y2={(62 - Math.cos(0.86) * 33.5).toFixed(1)}
        stroke={C.cream}
        strokeWidth='2.4'
        strokeLinecap='round'
      />
      <text x='80' y='68' fontFamily='Big Shoulders, sans-serif' fontWeight='800' fontSize='18' fill={C.cream} textAnchor='middle'>
        4
      </text>
    </svg>
  );
}
