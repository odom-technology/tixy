'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { ArcadeButton } from '@/features/arcade/components/ui/arcade-ui';
import { Num } from '@/features/arcade/components/ui/num';
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
import {
  ArcadeRematchButton,
  ArcadeRunResult,
  type TicketLine,
} from '@/features/arcade/components/results/arcade-run-result';
import { EnvMonitor } from '@/features/arcade/lib/game-anti-cheat';
import { gameCanvasDpr, getGame2dContext } from '@/features/arcade/lib/game-frame-loop';
import { SoundManager } from '@/features/arcade/lib/sound-manager';
import { isControlTarget } from '@/features/arcade/lib/use-first-input';
import {
  useFeelReducedMotion,
  useGameFeedback,
  usePitchLadder,
} from '@/features/arcade/lib/use-game-feedback';
import { useArcadeRunResult, wantedRunTickets } from '@/features/arcade/lib/run-result';
import {
  TICKET_STOP_END_HOLD_MS,
  TICKET_STOP_ROUND_COUNT,
  TICKET_STOP_ROUNDS,
  ticketStopDisplayLeadMs,
  ticketStopInputMs,
  ticketStopLayout,
  ticketStopPress,
  ticketStopResults,
  ticketStopView,
  type TicketStopLayout,
  type TicketStopRoundResult,
} from '@/server/arcade/ticket-stop-engine';

import { drawTicketStop, ticketStopGeometry, type TicketStopGeometry } from './_ticket-stop-draw';
import './_ticket-stop.css';

/* Ticket stop. A light chases a ring of 28 bulbs; press to stop it in the
   amber window. Three rounds, each faster. The rules, the clock and the
   score all live in src/server/arcade/ticket-stop-engine.ts, which the score
   route replays. This file draws and listens.

   Input: a stop is the input event's own timestamp, never the frame or the
   handler's time, so a 60 Hz and a 120 Hz phone score the same press the
   same. Every press answers first (a click, a tap, the button sinks), then
   the engine decides whether it stopped anything. */

const HINT: GameHint = { touch: 'Tap to send the light.', pointer: 'Press space or click to send the light.' };
const HOW_TO: GameHowTo = {
  lines: [
    'Press stop while the light is in the amber window.',
    "The center bulb scores 100, the bulbs beside it 40, and round 1's outer bulbs 10.",
    'Three rounds, each faster than the last, and your score pays tickets.',
  ],
  picture: <HowToPicture />,
};

const SESSION_MAX_AGE_MS = 30 * 60 * 1000;

type GameState = 'idle' | 'playing' | 'over' | 'error';

type PreparedRun =
  | {
      ok: true;
      guest: boolean;
      token: string | null;
      sessionId: string | null;
      seed: number;
      fetchedAt: number;
    }
  | { ok: false; status: number; error: string; banned: boolean; retryAfterSec: number | null };

const getSubmitErrorMessage = (
  status: number,
  data: { error?: string; details?: string; retryAfterSec?: number } | null,
) => {
  if (status === 429) {
    const retry = typeof data?.retryAfterSec === 'number' ? ` Try again in ${data.retryAfterSec}s.` : '';
    return `${data?.error ?? 'Too many runs.'}${retry}`;
  }
  if (typeof data?.error === 'string' && data.error.trim()) return data.error;
  return 'Could not save the run. Try again.';
};

const randomSeed = () => {
  const buffer = new Uint32Array(1);
  crypto.getRandomValues(buffer);
  return buffer[0] % 2 ** 31;
};

/** Pointer and key events carry epoch or timeOrigin stamps depending on the
 *  browser; put them on the performance.now() clock. */
const eventTime = (timeStamp: number) => {
  if (!Number.isFinite(timeStamp) || timeStamp <= 0) return performance.now();
  return timeStamp > 1e12 ? timeStamp - performance.timeOrigin : timeStamp;
};

/** Ask the server to stamp the run's start on its session. */
const STAMP_TIMEOUT_MS = 5000;
const stampStart = async (sessionId: string | null) => {
  if (!sessionId) return false;
  try {
    const response = await fetch('/api/games/session', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, action: 'start' }),
      // A hung request must not strand the player on a busy stage.
      signal: AbortSignal.timeout(STAMP_TIMEOUT_MS),
    });
    return response.ok;
  } catch {
    return false;
  }
};

/** Split a run's tickets across its rounds by points, so the strip's lines
 *  add up to what the run paid (largest remainder). */
function roundTicketLines(results: TicketStopRoundResult[], wanted: number): TicketLine[] {
  const points = results.reduce((sum, r) => sum + r.points, 0);
  if (wanted <= 0 || points <= 0) return [];
  const raw = results.map((r) => (wanted * r.points) / points);
  const base = raw.map(Math.floor);
  let left = wanted - base.reduce((a, b) => a + b, 0);
  const order = raw
    .map((value, index) => ({ index, frac: value - Math.floor(value) }))
    .sort((a, b) => b.frac - a.frac || a.index - b.index);
  for (const { index } of order) {
    if (left <= 0) break;
    base[index] += 1;
    left -= 1;
  }
  return results.map((r, i) => ({ label: `round ${r.round + 1}`, tickets: base[i] }));
}

type LatencySample = { handlerMs: number; frameMs: number };
declare global {
  interface Window {
    __ticketStopLatency?: LatencySample[];
    /** ?arcadePerf=1 in development only: the run's clock and seed, for QA. */
    __ticketStopRun?: { runStart: number; seed: number };
  }
}

export default function TicketStopClient() {
  const reducedMotion = useFeelReducedMotion();
  const shakeRef = useRef<HTMLDivElement>(null);
  const { trigger, hitStopClock } = useGameFeedback({ stage: shakeRef });
  const ladder = usePitchLadder();
  const { result: runResult, capture: captureRunResult, reset: resetRunResult } = useArcadeRunResult();

  const [gameState, setGameState] = useState<GameState>('idle');
  const [geometry, setGeometry] = useState<TicketStopGeometry | null>(null);
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0, dpr: 1 });
  const [layout, setLayout] = useState<TicketStopLayout | null>(null);
  const [results, setResults] = useState<TicketStopRoundResult[]>([]);
  const [hudRound, setHudRound] = useState(0);
  const [best, setBest] = useState<number | null>(null);
  const [previousBest, setPreviousBest] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const [banned, setBanned] = useState(false);
  const [guestRun, setGuestRun] = useState(false);
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const [leaderboardRefreshKey, setLeaderboardRefreshKey] = useState(0);
  const [announce, setAnnounce] = useState('');

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const capRef = useRef<HTMLDivElement>(null);
  const geometryRef = useRef<TicketStopGeometry | null>(null);
  const layoutRef = useRef<TicketStopLayout | null>(null);
  const stopsRef = useRef<number[]>([]);
  const runStartRef = useRef(0);
  const liveRef = useRef(false);
  const gameStateRef = useRef<GameState>('idle');
  const runRef = useRef<Extract<PreparedRun, { ok: true }> | null>(null);
  const preparingRef = useRef<Promise<PreparedRun> | null>(null);
  const startingRef = useRef(false);
  const envMonitorRef = useRef<EnvMonitor | null>(null);
  const reducedRef = useRef(reducedMotion);
  const frameRef = useRef(0);
  const effectNowRef = useRef(0);
  const lastFrameRef = useRef(0);
  const rafAtRef = useRef(0);
  /** Measured rAF interval, ms (an average; starts at 60 Hz). */
  const frameIntervalRef = useRef(1000 / 60);
  const resultEffectAtRef = useRef<number | null>(null);
  const endTimerRef = useRef<number | null>(null);
  const pressTimerRef = useRef<number | null>(null);
  const perfRef = useRef(false);
  const pendingLatencyRef = useRef<{ eventAt: number; handlerMs: number } | null>(null);
  const hudRoundRef = useRef(0);

  useEffect(() => {
    reducedRef.current = reducedMotion;
  }, [reducedMotion]);

  useEffect(() => {
    perfRef.current = new URLSearchParams(window.location.search).get('arcadePerf') === '1';
    if (perfRef.current) window.__ticketStopLatency = [];
  }, []);

  const setState = useCallback((next: GameState) => {
    gameStateRef.current = next;
    setGameState(next);
  }, []);

  // ── Session: fetched ahead, so the first press starts at once ──────────
  const prepareRun = useCallback((): Promise<PreparedRun> => {
    if (preparingRef.current) return preparingRef.current;
    const promise = (async (): Promise<PreparedRun> => {
      try {
        const response = await fetch('/api/games/session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ gameType: 'ticket-stop' }),
        });
        if (response.ok) {
          const data = (await response.json()) as {
            token?: string;
            sessionId?: string;
            ticketStopSeed?: number;
          };
          if (
            typeof data.token !== 'string' ||
            typeof data.sessionId !== 'string' ||
            typeof data.ticketStopSeed !== 'number'
          ) {
            return { ok: false, status: 500, error: 'The game could not start a valid run.', banned: false, retryAfterSec: null };
          }
          return {
            ok: true,
            guest: false,
            token: data.token,
            sessionId: data.sessionId,
            seed: data.ticketStopSeed,
            fetchedAt: Date.now(),
          };
        }
        if (response.status === 401) {
          // Signed out: a local seed, nothing saved.
          return { ok: true, guest: true, token: null, sessionId: null, seed: randomSeed(), fetchedAt: Date.now() };
        }
        const data = (await response.json().catch(() => null)) as
          | { error?: string; retryAfterSec?: number; isIndefinite?: boolean }
          | null;
        return {
          ok: false,
          status: response.status,
          error: getSubmitErrorMessage(response.status, data),
          banned: response.status === 403,
          retryAfterSec: typeof data?.retryAfterSec === 'number' ? data.retryAfterSec : null,
        };
      } catch {
        return { ok: false, status: 0, error: 'Network error while starting the run. Try again.', banned: false, retryAfterSec: null };
      }
    })();
    preparingRef.current = promise;
    void promise.then((prepared) => {
      if (preparingRef.current !== promise) return;
      if (!prepared.ok) {
        // Let the next press try again.
        preparingRef.current = null;
        return;
      }
      // Show the real first round before the first press.
      if (!liveRef.current && gameStateRef.current === 'idle') {
        const next = ticketStopLayout(prepared.seed);
        layoutRef.current = next;
        setLayout(next);
      }
    });
    return promise;
  }, []);

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
  const paint = useCallback((now: number) => {
    const canvas = canvasRef.current;
    const g = geometryRef.current;
    if (!canvas || !g) return;
    const ctx = getGame2dContext(canvas, { alpha: false });
    if (!ctx) return;
    const dpr = canvas.width / Math.max(1, g.width);
    const current = layoutRef.current;
    const view = current
      ? ticketStopView(
          current,
          stopsRef.current,
          // Drawn for when this frame reaches the screen, about one frame
          // interval from now, so the light on screen matches the clock a
          // press is stamped with on every refresh rate.
          liveRef.current || stopsRef.current.length > 0
            ? now - runStartRef.current + ticketStopDisplayLeadMs(frameIntervalRef.current)
            : 0,
          { reducedMotion: reducedRef.current },
        )
      : null;
    // Effects run on their own clock, which stands still through a hit-stop.
    const last = lastFrameRef.current || now;
    effectNowRef.current += Math.max(0, now - last - hitStopClock.frozenWithin(last, now));
    lastFrameRef.current = now;
    const resultMs = resultEffectAtRef.current == null ? null : effectNowRef.current - resultEffectAtRef.current;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawTicketStop(ctx, g, view, { resultMs, reducedMotion: reducedRef.current });
    if (view && view.round !== hudRoundRef.current && (view.phase === 'lead-in' || view.phase === 'chase')) {
      hudRoundRef.current = view.round;
      setHudRound(view.round);
    }
  }, [hitStopClock]);

  const loop = useCallback(
    (now: number) => {
      const previous = rafAtRef.current;
      rafAtRef.current = now;
      if (previous > 0 && now - previous > 0 && now - previous < 100) {
        frameIntervalRef.current = frameIntervalRef.current * 0.8 + (now - previous) * 0.2;
      }
      paint(now);
      const pending = pendingLatencyRef.current;
      if (pending && perfRef.current) {
        window.__ticketStopLatency?.push({ handlerMs: pending.handlerMs, frameMs: now - pending.eventAt });
        pendingLatencyRef.current = null;
      }
      const effectsRunning = resultEffectAtRef.current != null && effectNowRef.current - resultEffectAtRef.current < 600;
      if (gameStateRef.current === 'playing' || effectsRunning) {
        frameRef.current = requestAnimationFrame(loop);
      } else {
        frameRef.current = 0;
      }
    },
    [paint],
  );

  const ensureLoop = useCallback(() => {
    if (frameRef.current) return;
    lastFrameRef.current = 0;
    rafAtRef.current = 0;
    frameRef.current = requestAnimationFrame(loop);
  }, [loop]);

  useEffect(() => () => {
    if (frameRef.current) cancelAnimationFrame(frameRef.current);
    if (endTimerRef.current) window.clearTimeout(endTimerRef.current);
    if (pressTimerRef.current) window.clearTimeout(pressTimerRef.current);
  }, []);

  const fitCanvas = useCallback(({ width, height }: GameStageSize) => {
    const g = ticketStopGeometry(width, height);
    geometryRef.current = g;
    setGeometry(g);
    setCanvasSize({ width, height, dpr: gameCanvasDpr(width, height) });
  }, []);

  // Repaint when anything a still frame shows changes.
  useEffect(() => {
    if (gameStateRef.current !== 'playing') paint(performance.now());
  }, [canvasSize, layout, reducedMotion, paint]);

  // ── The button ──────────────────────────────────────────────────────────
  /** Every press answers first: the click, a tap, the button sinks. A
   *  button sinks and never squashes (FEEL.md). */
  const pressFeedback = useCallback(() => {
    trigger('press', { sound: false, haptic: true });
    SoundManager.play('typingThock', { pitch: 0.55 });
    const cap = capRef.current;
    if (cap) {
      cap.dataset.pressed = '';
      if (pressTimerRef.current) window.clearTimeout(pressTimerRef.current);
      pressTimerRef.current = window.setTimeout(() => {
        delete cap.dataset.pressed;
        SoundManager.play('typingThockRelease', { pitch: 0.6 });
      }, 110);
    }
  }, [trigger]);

  const saveRun = useCallback(
    async (prepared: Extract<PreparedRun, { ok: true }>, stops: number[], score: number) => {
      if (prepared.guest || !prepared.token) {
        setBest((prev) => Math.max(prev ?? 0, score));
        return;
      }
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
            stops,
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
        setBest((prev) => Math.max(prev ?? 0, score));
        setLeaderboardRefreshKey((k) => k + 1);
        // The strip's balance reloads and rolls.
        window.dispatchEvent(new Event('store-inventory-updated'));
      } catch {
        setSubmitError('Network error while saving your run. Try again.');
      } finally {
        setSaving(false);
      }
    },
    [captureRunResult],
  );

  const finishRun = useCallback(
    (all: TicketStopRoundResult[]) => {
      liveRef.current = false;
      const prepared = runRef.current;
      runRef.current = null;
      const score = all.reduce((sum, r) => sum + r.points, 0);
      if (prepared) void saveRun(prepared, stopsRef.current.slice(), score);
      endTimerRef.current = window.setTimeout(() => {
        endTimerRef.current = null;
        setState('over');
        // The next run's session, so rematch starts at once.
        void prepareRun();
      }, TICKET_STOP_END_HOLD_MS);
    },
    [prepareRun, saveRun, setState],
  );

  /** A press during a run, at the event's own time. */
  const handleStop = useCallback(
    (timeStamp: number) => {
      const handlerAt = performance.now();
      pressFeedback();
      const current = layoutRef.current;
      if (!liveRef.current || !current) return;
      const eventAt = eventTime(timeStamp);
      const at = ticketStopInputMs(eventAt, runStartRef.current);
      const press = ticketStopPress(current, stopsRef.current, at);
      if (press.kind !== 'stop') return;

      stopsRef.current = [...stopsRef.current, at];
      const result = press.result;
      if (perfRef.current) pendingLatencyRef.current = { eventAt, handlerMs: handlerAt - eventAt };
      resultEffectAtRef.current = effectNowRef.current;
      if (result.perfect) {
        trigger('combo', { pitch: ladder.next(), haptic: true, hitStop: true });
      } else if (result.inWindow) {
        trigger('collect', { pitch: ladder.next(), haptic: true });
      } else {
        ladder.reset();
        SoundManager.play('stackMiss');
      }
      // Paint the stopped light now; the frame shows it with the press.
      paint(performance.now());
      setResults((prev) => [...prev, result]);
      setAnnounce(
        `Round ${result.round + 1}: ${result.points} ${result.points === 1 ? 'point' : 'points'}${result.perfect ? ', center bulb' : ''}.`,
      );
      if (stopsRef.current.length === TICKET_STOP_ROUND_COUNT) {
        finishRun(ticketStopResults(current, stopsRef.current));
      }
    },
    [finishRun, ladder, paint, pressFeedback, trigger],
  );

  // ── Starting a run ──────────────────────────────────────────────────────

  const startRun = useCallback(async () => {
    if (startingRef.current || liveRef.current) return;
    startingRef.current = true;
    pressFeedback();
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
      let stamped = await stampStart(prepared.sessionId);
      if (!stamped) {
        preparingRef.current = null;
        const fresh = await prepareRun();
        preparingRef.current = null;
        prepared = fresh;
        stamped = fresh.ok && !fresh.guest ? await stampStart(fresh.sessionId) : fresh.ok;
      }
      if (prepared.ok && !stamped) {
        prepared = { ok: false, status: 0, error: 'The game could not start your run. Try again.', banned: false, retryAfterSec: null };
      }
    }
    setBusy(false);
    startingRef.current = false;

    if (prepared.ok === false) {
      const failed = prepared as Extract<PreparedRun, { ok: false }>;
      setStartError(failed.error);
      setBanned(failed.banned);
      setState('error');
      return;
    }

    runRef.current = prepared;
    const next = ticketStopLayout(prepared.seed);
    layoutRef.current = next;
    setLayout(next);
    stopsRef.current = [];
    setResults([]);
    hudRoundRef.current = 0;
    setHudRound(0);
    setGuestRun(prepared.guest);
    setPreviousBest(best);
    ladder.reset();
    resultEffectAtRef.current = null;
    if (!prepared.guest) envMonitorRef.current?.start();
    runStartRef.current = performance.now();
    // QA only (scripts/qa-ticket-stop.mts); never in a production build.
    if (process.env.NODE_ENV !== 'production' && perfRef.current) {
      window.__ticketStopRun = { runStart: runStartRef.current, seed: prepared.seed };
    }
    liveRef.current = true;
    setState('playing');
    ensureLoop();
  }, [best, ensureLoop, ladder, prepareRun, pressFeedback, resetRunResult, setState]);

  // ── Input during a run ──────────────────────────────────────────────────
  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (gameStateRef.current !== 'playing') return;
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      event.preventDefault();
      handleStop(event.timeStamp);
    },
    [handleStop],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (gameStateRef.current !== 'playing') return;
      if (event.code !== 'Space' && event.code !== 'Enter' && event.code !== 'ArrowUp') return;
      if (isControlTarget(event.target)) return;
      event.preventDefault();
      if (event.repeat) return;
      handleStop(event.timeStamp);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleStop]);

  // ── The result ──────────────────────────────────────────────────────────
  const score = results.reduce((sum, r) => sum + r.points, 0);
  const perfects = results.filter((r) => r.perfect).length;
  const isBest = gameState === 'over' && score > 0 && score > (previousBest ?? 0);
  const ticketLines = useMemo(
    () => roundTicketLines(results, wantedRunTickets(runResult.reward)),
    [results, runResult.reward],
  );

  const phase: GamePhase =
    gameState === 'idle' ? 'ready' : gameState === 'playing' ? 'playing' : 'over';

  const end =
    gameState === 'over' ? (
      <ArcadeRunResult
        title={isBest ? 'New best' : 'Run over'}
        tone={isBest ? 'best' : 'neutral'}
        stats={[
          { label: 'score', value: score, highlight: isBest },
          { label: 'center hits', value: perfects },
          { label: 'best', value: Math.max(best ?? 0, score) },
        ]}
        reward={runResult.reward}
        achievements={runResult.achievements}
        saving={saving}
        error={submitError}
        guest={guestRun}
        ticketLines={ticketLines.length === TICKET_STOP_ROUND_COUNT ? ticketLines : undefined}
        actions={<ArcadeRematchButton onClick={() => void startRun()} />}
      />
    ) : gameState === 'error' ? (
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
        <p>{startError ?? 'The game could not reach the server.'}</p>
      </GameStageNotice>
    ) : null;

  const g = geometry;
  const shownRound = gameState === 'idle' ? -1 : hudRound;

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
          className='ts-stage'
          onPointerDown={onPointerDown}
          data-reduced={reducedMotion || undefined}
          role={gameState === 'playing' ? 'group' : undefined}
          aria-label={
            gameState === 'playing'
              ? `Round ${hudRound + 1} of ${TICKET_STOP_ROUND_COUNT}. Press space or tap to stop the light.`
              : undefined
          }
        >
          <canvas
            ref={canvasRef}
            width={Math.max(1, Math.floor(canvasSize.width * canvasSize.dpr))}
            height={Math.max(1, Math.floor(canvasSize.height * canvasSize.dpr))}
            style={{ width: canvasSize.width, height: canvasSize.height }}
            aria-hidden
          />
          {g ? (
            <>
              <div className='ts-rounds' style={{ top: g.hudTop, height: g.hudH }}>
                {TICKET_STOP_ROUNDS.map((round, i) => {
                  const result = results[i];
                  return (
                    <div
                      key={i}
                      className='ts-round'
                      data-current={i === shownRound && !result ? '' : undefined}
                      data-center={result?.perfect ? '' : undefined}
                    >
                      <small>round {i + 1}</small>
                      <b>{result ? <Num value={result.points} /> : <span aria-hidden>·</span>}</b>
                    </div>
                  );
                })}
              </div>
              <div
                className='ts-button'
                style={{
                  left: g.cx - g.buttonR,
                  top: g.cy - g.buttonR,
                  width: g.buttonR * 2,
                  height: g.buttonR * 2,
                  fontSize: Math.max(18, g.buttonR * 0.36),
                }}
                aria-hidden
              >
                <div ref={capRef} className='ts-button-cap'>
                  stop
                </div>
              </div>
            </>
          ) : null}
          <p className='sr-only' aria-live='polite'>
            {announce}
          </p>
        </div>
      </GameStage>

      <GameLeaderboardModal
        open={showLeaderboard}
        onOpenChange={setShowLeaderboard}
        title='ticket stop board'
        description='Top runs and your rank.'
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

/** The ? sheet's picture: the ring, the window and a stopped light. */
function HowToPicture() {
  const bulbs = Array.from({ length: 28 }, (_, i) => {
    const a = (i / 28) * Math.PI * 2 - Math.PI / 2;
    const fill = i === 3 ? '#B83627' : i >= 2 && i <= 4 ? '#F2A33C' : '#4A3D33';
    return (
      <circle key={i} cx={(80 + Math.cos(a) * 38).toFixed(1)} cy={(50 + Math.sin(a) * 38).toFixed(1)} r='3.6' fill={fill} />
    );
  });
  return (
    <svg viewBox='0 0 160 100' width={320} height={200} role='img' aria-label='A ring of bulbs with the light stopped in the amber window.'>
      <rect width='160' height='100' fill='#2A231D' />
      {bulbs}
      <circle cx={(80 + Math.cos((3 / 28) * Math.PI * 2 - Math.PI / 2) * 38).toFixed(1)} cy={(50 + Math.sin((3 / 28) * Math.PI * 2 - Math.PI / 2) * 38).toFixed(1)} r='6.4' fill='none' stroke='#B83627' strokeWidth='1.6' />
      <circle cx='80' cy='50' r='24' fill='#F7E7C6' />
      <text x='80' y='55.5' fontFamily='Gabarito, sans-serif' fontWeight='900' fontSize='15' fill='#1F1A16' textAnchor='middle'>
        stop
      </text>
    </svg>
  );
}
