'use client';

/* ──────────────────────────────────────────────────────────────────────────
   COIN PUSHER — the machine on the frame.

   The browser runs the same engine as the server (engine.ts), stepped to
   the machine clock, and draws it. A press answers in its own handler: the
   press sound, the haptic, the carriage dip and the coin in the chute come
   with the next paint, before any request.

   Signed in, the server owns the machine (server/arcade/coin-pusher.ts):
   drops and collects go through PusherSync, which checks every answer's
   hash against the browser's own and reloads the machine on a mismatch.
   Guests play a practice machine kept in this browser, with free coins and
   no tickets.
   ────────────────────────────────────────────────────────────────────────── */

import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';

import { ArcadeWagerResultPlate } from '@/features/arcade/components/results/arcade-run-result';
import { useGamesWallet } from '@/features/arcade/components/shell/games-wallet-provider';
import { GameShell, type GameHowTo } from '@/features/arcade/components/shell/game-shell';
import {
  ArcadeMachine,
  MachineButton,
  MachineGlass,
  machineError,
  useMachineBet,
} from '@/features/arcade/components/wagers/arcade-machine';
import { parseArcadeRunResult, type ArcadeRunAchievement } from '@/features/arcade/lib/run-result';
import { MidwayStill } from '@/features/arcade/components/midway-still';
import { createGameFrameLoop, type GameFrameLoop } from '@/features/arcade/lib/game-frame-loop';
import { createPitchLadder } from '@/features/arcade/lib/game-feel';
import { playHaptic } from '@/features/arcade/lib/game-haptics';
import {
  createMidwayQualityController,
  markMidwayFirstFrame,
  applyMidwayTier,
  type MidwayQualityController,
} from '@/features/arcade/lib/midway-three';
import { SoundManager } from '@/features/arcade/lib/sound-manager';
import { isControlTarget, isDialogOpen } from '@/features/arcade/lib/use-first-input';
import { useFeelReducedMotion, useGameFeedback } from '@/features/arcade/lib/use-game-feedback';
import {
  CP_E2,
  CP_MAX_PENDING,
  CP_Y_P2,
  cpClampAim,
  cpParse,
  cpRebase,
  cpStepAt,
  type CpMachine,
} from '@/features/arcade/lib/coin-pusher/engine';
import { CP_COIN_PAY_HUNDREDTHS, CP_COIN_TICKETS, CP_MAX_BET, cpCoinsForBet } from '@/features/arcade/lib/coin-pusher/economy';
import { ARCADE_MIN_BET } from '@/server/arcade/arcade-constants';
import bedJson from '@/features/arcade/lib/coin-pusher/bed.json';

import { PusherRuntime } from './_coin-pusher-runtime';
import { fetchMachine, PusherSync, type PusherAnswer } from './_coin-pusher-sync';
import { buildPusherScene, type PusherScene } from './_coin-pusher-scene';
import './coin-pusher.css';

/** What a coin off the front pays, as it reads: 4.85. */
const COIN_PAY = (CP_COIN_PAY_HUNDREDTHS / 100).toFixed(2);

const HOW_TO: GameHowTo = {
  lines: [
    'Tap the machine where you want a coin to fall, or press drop. The ring shows where it lands.',
    `The shelves push coins forward. Every coin that falls off the front edge pays ${COIN_PAY} tickets.`,
    `A coin costs ${CP_COIN_TICKETS} tickets, a 97% return. Coins stay in the machine between visits.`,
  ],
};

/** The bet stubs: 1, 5, 10 and 50 coins. */
const BET_STUBS = [5, 25, 50, 250] as const;

const PRACTICE_KEY = 'tixy:coin-pusher:practice:v1';
/** Practice coins are free; the bet row still needs a balance to offer stubs. */
const PRACTICE_BALANCE = 250;
/** A spill this big in a second gets the shake and the ding. */
const BIG_SPILL = 6;
/** How long the front lip stays lit after a coin goes over it. */
const LIP_FLASH_MS = 450;
/** How long a spill's +N tag stays up after its last coin. */
const SPILL_TAG_MS = 1100;
/** The pitch ladder resets after this long without a coin in the tray. */
const LADDER_RESET_MS = 700;
/** After a coin reaches the tray, ask the server to pay this soon. */
const COLLECT_AFTER_MS = 450;
/** The receipt prints once nothing has reached the tray for this long and
    no coin is in the chute or the air. A packed machine can take 10 to 30 s
    to settle completely, too long to wait; a coin that falls later is paid
    on the next collect and joins the next receipt. */
const RECEIPT_QUIET_MS = 2500;

type Mode = 'loading' | 'server' | 'practice';

/** The drops from the first press after a quiet machine until it settles. */
type Run = {
  id: number;
  drops: number;
  coins: number;
  staked: number;
  paid: number;
  won: number;
  achievements: ArcadeRunAchievement[];
  /** A final collect has been asked for, after the machine settled. */
  closing: boolean;
};

type Receipt = Omit<Run, 'closing'>;

function freshMachine(): CpMachine {
  const bed = cpParse(bedJson);
  if (!bed) throw new Error('coin pusher: the bed is malformed');
  return cpRebase(bed, cpStepAt(Date.now()));
}

function loadPractice(): CpMachine {
  try {
    const raw = window.localStorage.getItem(PRACTICE_KEY);
    if (raw) {
      const parsed = cpParse(JSON.parse(raw));
      if (parsed) return parsed;
    }
  } catch {
    // A broken save starts a new machine.
  }
  return freshMachine();
}

function savePractice(m: CpMachine) {
  try {
    window.localStorage.setItem(PRACTICE_KEY, JSON.stringify(m));
  } catch {
    // Storage full or blocked: the machine just won't persist.
  }
}

export default function CoinPusherClient() {
  const reducedMotion = useFeelReducedMotion();
  const { trigger, shakeOffset } = useGameFeedback();

  const [webglError, setWebglError] = useState(false);
  // Coins this visit: dropped in, and pushed off the front.
  const [dropped, setDropped] = useState(0);
  const [won, setWon] = useState(0);
  const [mode, setMode] = useState<Mode>('loading');
  const [notice, setNotice] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const { wallet, loaded: walletLoaded, dailyCredits, setSnapshot, adjustCredits } = useGamesWallet();
  const balance = mode === 'practice' ? PRACTICE_BALANCE : walletLoaded ? wallet.credits : null;
  const [bet, setBet] = useMachineBet(balance, 5, {
    step: CP_COIN_TICKETS,
    max: CP_MAX_BET,
    stubs: BET_STUBS,
  });

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<PusherScene | null>(null);
  const runtimeRef = useRef<PusherRuntime | null>(null);
  const qualityRef = useRef<MidwayQualityController | null>(null);
  const loopRef = useRef<GameFrameLoop | null>(null);
  const aimRef = useRef(0);
  const carriageRef = useRef({ x: 0, v: 0, dipAt: -Infinity });
  const pointerInRef = useRef(false);
  const ladderRef = useRef(createPitchLadder({ maxSteps: 14 }));
  const lastSpillRef = useRef(-Infinity);
  const spillWindowRef = useRef<number[]>([]);
  const chaseUntilRef = useRef(0);
  const lastFrameRef = useRef(0);
  const reducedRef = useRef(reducedMotion);
  reducedRef.current = reducedMotion;
  const betRef = useRef(bet);
  betRef.current = bet;
  const wonRef = useRef(0);
  const droppedRef = useRef(0);
  /** The floating +N over the lip for the spill in progress. */
  const tagLayerRef = useRef<HTMLDivElement>(null);
  const spillTagRef = useRef<{ el: HTMLDivElement; count: number; xs: number[]; timer: number } | null>(null);
  const lastDropRef = useRef(-Infinity);
  const modeRef = useRef<Mode>('loading');
  modeRef.current = mode;
  const syncRef = useRef<PusherSync | null>(null);
  const collectTimerRef = useRef<number | null>(null);
  const runRef = useRef<Run | null>(null);
  const runIdRef = useRef(0);
  const balanceRef = useRef(balance);
  balanceRef.current = balance;
  const walletRef = useRef({ dailyCredits, setSnapshot, adjustCredits });
  walletRef.current = { dailyCredits, setSnapshot, adjustCredits };

  /* ── the spill tag: +N under the lip where the coins went, counting up
        while one spill runs on ── */

  const showSpill = useCallback((xs: number[]) => {
    const layer = tagLayerRef.current;
    const scene = sceneRef.current;
    if (!layer || xs.length === 0) return;
    let tag = spillTagRef.current;
    if (!tag) {
      const el = document.createElement('div');
      el.className = 'cp-spill';
      el.setAttribute('aria-hidden', 'true');
      layer.appendChild(el);
      tag = { el, count: 0, xs: [], timer: 0 };
      spillTagRef.current = tag;
    }
    tag.count += xs.length;
    tag.xs.push(...xs);
    const mean = tag.xs.reduce((sum, x) => sum + x, 0) / tag.xs.length;
    // Over the tray, just under the lip: dark there, so it reads.
    const at = scene?.screenAt(mean, CP_Y_P2 - 1.6, CP_E2 + 1.2) ?? { x: layer.clientWidth / 2, y: layer.clientHeight * 0.9 };
    tag.el.style.left = `${at.x.toFixed(1)}px`;
    tag.el.style.top = `${at.y.toFixed(1)}px`;
    tag.el.textContent = `+${tag.count}`;
    tag.el.toggleAttribute('data-big', tag.count >= BIG_SPILL);
    // Punch on every coin: restart the animation.
    tag.el.classList.remove('is-punch');
    void tag.el.offsetWidth;
    tag.el.classList.add('is-punch');
    window.clearTimeout(tag.timer);
    const done = tag;
    tag.timer = window.setTimeout(() => {
      if (spillTagRef.current === done) spillTagRef.current = null;
      done.el.classList.add('is-leaving');
      window.setTimeout(() => done.el.remove(), 400);
    }, SPILL_TAG_MS);
  }, []);

  /* ── the machine's events become sound, haptics and the counts ── */

  const onEvents = useCallback(
    (events: ReturnType<PusherRuntime['advance']>, frameMs: number) => {
      let trayed = 0;
      for (const e of events) {
        if (e.k === 'enter') {
          SoundManager.play('pusherDrop', { pitch: 0.96 + ((e.id * 37) % 9) / 100 });
        } else if (e.k === 'land') {
          if (e.speed < 1.5) continue;
          const loud = Math.min(1, e.speed / 60);
          // A shelf rings higher than a playfield; landing on coins higher again.
          const pitch = (e.s === 0 || e.s === 2 ? 1.12 : 0.94) * (e.l === 1 ? 1.06 : 1);
          SoundManager.play('pusherClink', { volume: 0.35 + loud * 0.65, pitch });
        } else if (e.k === 'tip') {
          if (e.from === 1) SoundManager.play('pusherClink', { volume: 0.45, pitch: 0.82 });
        } else if (e.k === 'tray') {
          trayed += 1;
        }
      }
      if (trayed === 0) return;
      if (frameMs - lastSpillRef.current > LADDER_RESET_MS) ladderRef.current.reset();
      lastSpillRef.current = frameMs;
      for (let i = 0; i < trayed; i++) {
        SoundManager.play('pusherSpill', { pitch: ladderRef.current.next() });
      }
      playHaptic('tick');
      wonRef.current += trayed;
      setWon(wonRef.current);
      showSpill(events.filter((e) => e.k === 'tray').map((e) => e.x));
      if (runRef.current) runRef.current.won += trayed;
      if (modeRef.current === 'server' && collectTimerRef.current == null) {
        collectTimerRef.current = window.setTimeout(() => {
          collectTimerRef.current = null;
          syncRef.current?.collect();
        }, COLLECT_AFTER_MS);
      }
      chaseUntilRef.current = frameMs + 1400;
      const recent = spillWindowRef.current.filter((t) => frameMs - t < 1000);
      for (let i = 0; i < trayed; i++) recent.push(frameMs);
      spillWindowRef.current = recent;
      if (recent.length >= BIG_SPILL && recent.length - trayed < BIG_SPILL) {
        trigger('impact', { shake: 0.6, sound: false });
        SoundManager.play('registerDing');
        playHaptic('win');
      }
    },
    [trigger, showSpill],
  );

  const onEventsRef = useRef(onEvents);
  onEventsRef.current = onEvents;

  /* ── one frame ── */

  const drawFrame = useCallback(
    (frameMs: number) => {
      const scene = sceneRef.current;
      const runtime = runtimeRef.current;
      if (!scene || !runtime) return;
      const elapsed = lastFrameRef.current ? Math.min(100, frameMs - lastFrameRef.current) : 16;
      lastFrameRef.current = frameMs;
      runtime.reducedMotion = reducedRef.current;
      const events = runtime.advance(frameMs, elapsed);
      if (events.length > 0) onEventsRef.current(events, frameMs);

      // The carriage follows the aim on a critically damped spring.
      const car = carriageRef.current;
      if (reducedRef.current) {
        car.x = aimRef.current;
        car.v = 0;
      } else {
        // Exact critically damped step: stable at any frame time.
        const w = 2 * Math.PI * 4.5;
        const dt = elapsed / 1000;
        const x0 = car.x - aimRef.current;
        const k = Math.exp(-w * dt);
        const c = car.v + w * x0;
        car.x = aimRef.current + (x0 + c * dt) * k;
        car.v = (c - w * (x0 + c * dt)) * k;
      }
      const sinceDip = (frameMs - car.dipAt) / 1000;
      const dip = reducedRef.current || sinceDip > 0.3 ? 0 : 0.35 * Math.exp(-sinceDip / 0.06) * Math.cos(sinceDip * 30);

      const shelves = runtime.shelves(frameMs);
      const coins = runtime.coinsToDraw(frameMs);
      const shake = shakeOffset(frameMs);
      scene.draw({
        shelfA: shelves.a,
        shelfB: shelves.b,
        carriageX: car.x,
        carriageDip: dip,
        showLine: pointerInRef.current,
        lipFlash: reducedRef.current ? 0 : 1 - (frameMs - lastSpillRef.current) / LIP_FLASH_MS,
        coins: coins.coins,
        count: coins.count,
        shakeX: shake.x * 0.004,
        shakeY: shake.y * 0.004,
        timeSec: frameMs / 1000,
        chase: frameMs < chaseUntilRef.current,
      });
      scene.render();
    },
    [shakeOffset],
  );

  /* ── scene lifecycle ── */

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || webglError) return;
    const quality = qualityRef.current ?? createMidwayQualityController({ game: 'coin-pusher' });
    qualityRef.current = quality;
    const rect = canvas.getBoundingClientRect();
    const scene = buildPusherScene({
      canvas,
      quality,
      width: Math.max(1, rect.width || 640),
      height: Math.max(1, rect.height || 480),
      onPause: () => loopRef.current?.stop(),
      onRestore: () => {
        sceneRef.current?.rig.refreshEnvironment();
        loopRef.current?.start();
      },
      onFallback: () => {
        loopRef.current?.destroy();
        loopRef.current = null;
        sceneRef.current?.dispose();
        sceneRef.current = null;
        setWebglError(true);
      },
    });
    if (!scene) {
      setWebglError(true);
      return;
    }
    sceneRef.current = scene;
    const stopTier = quality.onChange((tier) => {
      const s = sceneRef.current;
      if (!s) return;
      applyMidwayTier(s.renderer, s.rig, tier, { scene: s.scene, camera: s.camera });
    });
    let first = true;
    const loop = createGameFrameLoop({
      simulate: () => undefined,
      render: (_alpha, frame) => {
        drawFrame(frame.nowMs);
        // A tier change never lands while coins you just bought are falling.
        const rt = runtimeRef.current;
        quality.hold(!!rt && (rt.m.pending.length > 0 || rt.m.coins.some((c) => c.s === 4)));
        quality.frame(frame.nowMs, frame.deltaMs);
        if (first) {
          first = false;
          markMidwayFirstFrame('coin-pusher', quality.tier());
          scene.deferred.start();
        }
      },
    });
    loopRef.current = loop;
    loop.start();

    return () => {
      stopTier();
      loop.destroy();
      loopRef.current = null;
      scene.dispose();
      sceneRef.current = null;
    };
  }, [drawFrame, webglError]);

  /* ── the machine: the server's when signed in, a practice one otherwise ── */

  const onAnswer = useCallback((answer: PusherAnswer) => {
    const w = walletRef.current;
    w.setSnapshot({ credits: answer.balance, dailyCredits: w.dailyCredits });
    const run = runRef.current;
    if (run) {
      run.paid += answer.paid;
      run.achievements.push(...parseArcadeRunResult(answer).achievements);
    }
  }, []);

  useEffect(() => {
    let alive = true;
    const startPractice = () => {
      const machine = loadPractice();
      runtimeRef.current = new PusherRuntime(machine);
      setMode('practice');
    };
    void fetchMachine()
      .then((loaded) => {
        if (!alive) return;
        if (loaded.status === 200 && loaded.view) {
          runtimeRef.current = new PusherRuntime(loaded.view.machine, loaded.offset ?? 0);
          const w = walletRef.current;
          w.setSnapshot({ credits: loaded.view.balance, dailyCredits: w.dailyCredits });
          syncRef.current = new PusherSync(() => runtimeRef.current, {
            onAnswer,
            onRefused: (status, message) => {
              setNotice(
                status === 402
                  ? machineError(message, 'You need more tickets for this drop.')
                  : machineError(message, 'The machine refused that drop.'),
              );
            },
            onResync: (view) => {
              // Counted on the stage for QA: a healthy session never reloads.
              const stage = stageRef.current;
              if (stage) stage.dataset.resyncs = String(Number(stage.dataset.resyncs ?? 0) + 1);
              const ww = walletRef.current;
              ww.setSnapshot({ credits: view.balance, dailyCredits: ww.dailyCredits });
            },
            onOffline: () => setNotice('The machine lost its connection, but your tickets are safe.'),
          });
          setMode('server');
        } else {
          if (loaded.status !== 401) setNotice('The machine is offline, so this is practice only.');
          startPractice();
        }
      })
      .catch(() => {
        if (!alive) return;
        setNotice('The machine is offline, so this is practice only.');
        startPractice();
      });
    return () => {
      alive = false;
      syncRef.current?.dispose();
      syncRef.current = null;
      if (collectTimerRef.current != null) window.clearTimeout(collectTimerRef.current);
    };
  }, [onAnswer]);

  // Twice a second: the read-outs, the practice save, and the receipt once
  // the machine has settled after a run of drops.
  useEffect(() => {
    const save = () => {
      const rt = runtimeRef.current;
      if (rt && modeRef.current === 'practice') savePractice(rt.m);
    };
    const timer = window.setInterval(() => {
      const rt = runtimeRef.current;
      if (!rt) return;
      // Without WebGL nothing draws, so step the machine here.
      if (!sceneRef.current) {
        const events = rt.advance(performance.now(), 500);
        if (events.length > 0) onEventsRef.current(events, performance.now());
      }
      if (rt.m.settled) save();
      const run = runRef.current;
      if (!run) return;
      const now = performance.now();
      const quiet =
        rt.m.pending.length === 0 &&
        !rt.m.coins.some((c) => c.s === 4) &&
        now - lastSpillRef.current > RECEIPT_QUIET_MS &&
        now - lastDropRef.current > RECEIPT_QUIET_MS + 500;
      if (!quiet) return;
      const sync = syncRef.current;
      if (modeRef.current === 'server' && sync) {
        if (!run.closing) {
          run.closing = true;
          sync.collect();
          return;
        }
        if (!sync.idle()) return;
      }
      runRef.current = null;
      if (modeRef.current === 'server') {
        const { closing: _closing, ...printed } = run;
        setReceipt(printed);
      }
    }, 500);
    window.addEventListener('pagehide', save);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('pagehide', save);
      save();
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const observer = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect;
      if (!box || box.width < 2 || box.height < 2) return;
      sceneRef.current?.resize(box.width, box.height);
    });
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [webglError]);

  useEffect(
    () => () => {
      qualityRef.current?.dispose();
      qualityRef.current = null;
    },
    [],
  );

  /* ── drops ── */

  const drop = useCallback(
    (x: number) => {
      // Answer the press first: sound, haptic, the carriage dips.
      trigger('press', { haptic: true });
      carriageRef.current.dipAt = performance.now();
      const runtime = runtimeRef.current;
      if (!runtime) return;
      const stake = betRef.current;
      const coins = cpCoinsForBet(stake) ?? 1;
      if (runtime.m.pending.length + coins > CP_MAX_PENDING) {
        setNotice('The chute is full, so wait a moment.');
        return;
      }
      if (modeRef.current === 'server') {
        const have = balanceRef.current ?? 0;
        if (stake > have) {
          setNotice(have < ARCADE_MIN_BET ? `You need ${ARCADE_MIN_BET} tickets to play.` : `You need ${stake} tickets for this drop.`);
          return;
        }
        if (!syncRef.current?.drop(stake, cpClampAim(x), coins)) return;
        walletRef.current.adjustCredits(-stake);
      } else {
        runtime.pour(cpClampAim(x), coins);
      }
      lastDropRef.current = performance.now();
      setNotice(null);
      setReceipt(null);
      if (!runRef.current) {
        runRef.current = { id: ++runIdRef.current, drops: 0, coins: 0, staked: 0, paid: 0, won: 0, achievements: [], closing: false };
      }
      const run = runRef.current;
      run.drops += 1;
      run.coins += coins;
      run.staked += modeRef.current === 'server' ? stake : 0;
      run.closing = false;
      droppedRef.current += coins;
      setDropped(droppedRef.current);
    },
    [trigger],
  );

  const aimFromEvent = (event: ReactPointerEvent) => {
    const x = sceneRef.current?.aimAt(event.clientX, event.clientY);
    if (x != null) aimRef.current = x;
    return x;
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    pointerInRef.current = true;
    aimFromEvent(event);
  };
  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    pointerInRef.current = true;
    const x = aimFromEvent(event);
    if (x == null) return;
    // The carriage is already where the finger is: drop there.
    carriageRef.current.x = reducedRef.current ? x : carriageRef.current.x;
    drop(x);
  };
  const onPointerLeave = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'mouse') pointerInRef.current = false;
  };

  // Space drops at the carriage.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.repeat || event.metaKey || event.ctrlKey || event.altKey) return;
      if (isControlTarget(event.target) || isDialogOpen()) return;
      if (event.code === 'Space') {
        event.preventDefault();
        drop(carriageRef.current.x);
      } else if (event.code === 'ArrowLeft' || event.code === 'ArrowRight') {
        event.preventDefault();
        aimRef.current = cpClampAim(aimRef.current + (event.code === 'ArrowLeft' ? -1.5 : 1.5));
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [drop]);

  const coinsPerDrop = cpCoinsForBet(bet) ?? 1;

  const glass = useMemo(
    () => (
      <MachineGlass
        name='coin pusher'
        rules={[
          mode === 'practice'
            ? 'Practice coins are free. Sign in to win tickets.'
            : `Every coin pushed off the front edge pays ${COIN_PAY} tickets.`,
        ]}
        paytable={[
          { label: 'a coin dropped', value: `${CP_COIN_TICKETS} tickets` },
          { label: 'a coin off the front', value: `${COIN_PAY} tickets` },
          { label: 'return', value: '97%' },
        ]}
      />
    ),
    [mode],
  );

  const affordable = mode !== 'server' || (balance != null && bet <= balance);

  return (
    <GameShell game='coin-pusher' howTo={HOW_TO}>
      <ArcadeMachine
        name='coin pusher'
        glass={glass}
        action={
          <MachineButton
            onClick={() => drop(carriageRef.current.x)}
            disabled={!affordable || mode === 'loading'}
            aria-label={coinsPerDrop === 1 ? 'drop a coin' : `drop ${coinsPerDrop} coins`}
          >
            {coinsPerDrop === 1 ? 'drop' : `drop ${coinsPerDrop}`}
          </MachineButton>
        }
        bet={{
          value: bet,
          onChange: setBet,
          balance,
          stubs: BET_STUBS,
          step: CP_COIN_TICKETS,
          max: CP_MAX_BET,
        }}
        receipt={receipt ? <PusherReceipt receipt={receipt} /> : null}
        receiptKey={receipt ? String(receipt.id) : null}
        notice={notice}
      >
        <div className='cp-screen'>
          <div
            ref={stageRef}
            className='cp-stage'
            role='application'
            aria-label='coin pusher, tap where you want a coin to fall or press space'
            onPointerMove={onPointerMove}
            onPointerDown={onPointerDown}
            onPointerLeave={onPointerLeave}
          >
            {webglError ? (
              <MidwayStill
                game='coin-pusher'
                alt='The coin pusher: two paper shelves pushing amber coins toward a brass lip over the tray.'
                line="This browser can't draw the machine, but drops still play and pay."
                className='absolute inset-0'
              />
            ) : (
              <canvas ref={canvasRef} className='cp-canvas' />
            )}
            <div ref={tagLayerRef} className='cp-tags' />
            {/* Coins this visit: what went in, and what came off the front. */}
            <div className='cp-readout' aria-live='polite'>
              <span className='cp-readout-label'>dropped</span>
              <span className='cp-readout-value' data-quiet=''>
                {dropped}
              </span>
              <span className='cp-readout-label'>won</span>
              <span key={won} className='cp-readout-value' data-punch={won > 0 || undefined}>
                {won}
              </span>
            </div>
          </div>
        </div>
      </ArcadeMachine>
    </GameShell>
  );
}

function PusherReceipt({ receipt }: { receipt: Receipt }) {
  return (
    <ArcadeWagerResultPlate
      result={{ payout: receipt.paid, stake: receipt.staked, multiplier: null }}
      kicker='coin pusher'
      headline={`${receipt.won} ${receipt.won === 1 ? 'coin' : 'coins'} won`}
      detail={`${receipt.coins} ${receipt.coins === 1 ? 'coin' : 'coins'} dropped, ${receipt.won} pushed off the front`}
      fairness={null}
      achievements={receipt.achievements}
      roundId={`coin-pusher-${receipt.id}`}
    />
  );
}
