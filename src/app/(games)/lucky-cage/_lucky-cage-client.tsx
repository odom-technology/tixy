"use client";

/* ──────────────────────────────────────────────────────────────────────────
   LUCKY CAGE — money, controls and the DOM cabinet.

   Everything that decides an outcome happens on the server, before a single
   frame renders:

     1. the player picks ONE of the 51 tickets and locks a bet;
     2. POST /api/wagers/session holds the wager and fixes the seed;
     3. POST /api/wagers/settle resolves the round, pays out idempotently and
        reveals the seed (~200 ms end to end);
     4. only THEN does the 9-11 s crank/tumble/chute/reveal choreography play,
        over a result that is already banked.

   Nothing in this file — or in the three.js cabinet — can change which balls
   come out. The client never sends a draw, a multiplier or a payout, and the
   seed never reaches it before settlement.

   Rendering is split out on purpose:
     _lucky-cage-scene.ts   the cabinet (geometry, materials, disposal)
     _lucky-cage-tumble.ts  the cosmetic fixed-timestep tumble solver
     _lucky-cage-draw.ts    the pure choreography timeline
     _lucky-cage-theme.ts   cosmetic palette + store loadout overlay
   This file keeps the wager shell, the ticket board, the accessible DOM
   read-out and the lifecycle.
   ────────────────────────────────────────────────────────────────────────── */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";

import { useGamesWallet } from "@/features/arcade/components/shell/games-wallet-provider";
import {
  GameShell,
  type GameHowTo,
} from "@/features/arcade/components/shell/game-shell";
import {
  ArcadeMachine,
  MachineButton,
  MachineGlass,
  machineError,
  useMachineBet,
  useMachineKey,
} from "@/features/arcade/components/wagers/arcade-machine";
import { ArcadeWagerResultPlate } from "@/features/arcade/components/results/arcade-run-result";
import { useGameFeedback } from "@/features/arcade/lib/use-game-feedback";
import { SoundManager } from "@/features/arcade/lib/sound-manager";
import { hapticTick, playHaptic } from "@/features/arcade/lib/game-haptics";
import { createPitchLadder } from "@/features/arcade/lib/game-feel";
import {
  createGameFrameLoop,
  type GameFrameLoop,
} from "@/features/arcade/lib/game-frame-loop";
import {
  createMidwayQualityController,
  markMidwayFirstFrame,
  type MidwayQualityController,
} from "@/features/arcade/lib/midway-three";
import { MidwayStill } from "@/features/arcade/components/midway-still";
import { useWagerSession } from "@/features/arcade/lib/use-wager-session";
import { drawLuckyCageClient } from "@/features/arcade/lib/lucky-cage-draw";
import { ARCADE_MIN_BET } from "@/server/arcade/arcade-constants";
import {
  LUCKY_CAGE_DEFAULT_TICKET,
  LUCKY_CAGE_DRAW_COUNT,
  LUCKY_CAGE_TICKETS,
  getLuckyCageTicket,
  type LuckyCageFamily,
  type LuckyCageTicket,
} from "@/server/arcade/wager-games/lucky-cage";

import { LuckyCageBoard, ticketName } from "./_lucky-cage-board";
import { CageSlip } from "./_lucky-cage-slip";
import {
  buildCageTimeline,
  cageFrame,
  cageStatusLine,
  type CageTimeline,
} from "./_lucky-cage-draw";
import {
  BALL_COUNT,
  BALL_RADIUS,
  DRUM_INTERIOR_HALF_LENGTH,
  DRUM_INTERIOR_RADIUS,
  applyCageFrame,
  applyCageTheme,
  applyCageTier,
  buildLuckyCageScene,
  disposeCageScene,
  emitCageDust,
  emitSeatBurst,
  resetCageVisuals,
  resizeCageScene,
  type CageScene,
} from "./_lucky-cage-scene";
import {
  agitateTumble,
  createTumbleState,
  resetTumbleState,
  stepTumble,
  type TumbleState,
} from "./_lucky-cage-tumble";
import {
  DEFAULT_LUCKY_CAGE_THEME,
  buildLuckyCageTheme,
  type LuckyCageEquipped,
  type LuckyCageTheme,
} from "./_lucky-cage-theme";
import "./_lucky-cage.css";

/* ── settle response ────────────────────────────────────────────────── */

type CageSettleResponse = {
  seed: number;
  payout: number;
  multiplier: number;
  ticket?: string;
  family?: LuckyCageFamily;
  draw?: number[];
  head?: number;
  highCount?: number;
  rackCounts?: number[];
  hitBalls?: number[];
  won?: boolean;
  roundId?: string | null;
};

/** What the round committed to, held back from the DOM until the reveal. */
type CommittedRound = {
  ticket: LuckyCageTicket;
  wager: number;
  draw: number[];
  hitBalls: number[];
  won: boolean;
  payout: number;
  multiplier: number;
  seed: number;
  roundId: string | null;
};

/* ── helpers ────────────────────────────────────────────────────────── */

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/** A name at the start of a sentence. */
function capital(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function fmtMult(m: number): string {
  if (m >= 100) return m.toFixed(1);
  return m.toFixed(2);
}

function fmtChance(p: number): string {
  const pctValue = p * 100;
  if (pctValue >= 10) return `${pctValue.toFixed(1)}%`;
  if (pctValue >= 1) return `${pctValue.toFixed(2)}%`;
  return `${pctValue.toFixed(3)}%`;
}

/** What each kind of ticket pays, printed on the glass. Tickets of one kind
    pay the same, and tier tickets pair up (0 and 5 high pay alike). */
const multiplierOf = (id: string) => getLuckyCageTicket(id)?.multiplier ?? 0;
const GLASS_ROWS: {
  label: string;
  multiplier: number;
  matches: (ticket: LuckyCageTicket) => boolean;
}[] = [
  { label: "ball in the draw", multiplier: multiplierOf("ball:1"), matches: (t) => t.family === "ball" },
  { label: "head ball", multiplier: multiplierOf("head:1"), matches: (t) => t.family === "head" },
  { label: "3 from a rack", multiplier: multiplierOf("rack:0"), matches: (t) => t.family === "rack" },
  { label: "0 or 5 high", multiplier: multiplierOf("tier:0"), matches: (t) => t.family === "tier" && (t.value === 0 || t.value === 5) },
  { label: "1 or 4 high", multiplier: multiplierOf("tier:1"), matches: (t) => t.family === "tier" && (t.value === 1 || t.value === 4) },
  { label: "2 or 3 high", multiplier: multiplierOf("tier:2"), matches: (t) => t.family === "tier" && (t.value === 2 || t.value === 3) },
];

const HOW_TO: GameHowTo = {
  lines: [
    "Pick a ticket and a bet, then turn the crank.",
    "Five of the 20 balls are drawn, and your ticket wins if it comes in.",
    `A ball ticket pays ${fmtMult(multiplierOf("ball:1"))}× and a head ball ${fmtMult(multiplierOf("head:1"))}×, and every ticket returns 99%.`,
  ],
};

const TICKETS_BY_FAMILY: Record<LuckyCageFamily, LuckyCageTicket[]> = {
  ball: LUCKY_CAGE_TICKETS.filter((t) => t.family === "ball"),
  head: LUCKY_CAGE_TICKETS.filter((t) => t.family === "head"),
  rack: LUCKY_CAGE_TICKETS.filter((t) => t.family === "rack"),
  tier: LUCKY_CAGE_TICKETS.filter((t) => t.family === "tier"),
};

/** The pose an untouched cabinet sits in — cage still, gate shut, camera wide. */
const IDLE_TIMELINE = buildCageTimeline(false);

/* ══════════════════════════════════════════════════════════════════════
   Component
   ══════════════════════════════════════════════════════════════════════ */

export default function LuckyCageClient() {
  const { trigger: triggerFeedback } = useGameFeedback();
  const {
    wallet,
    loaded: walletLoaded,
    refresh: refreshWallet,
    adjustCredits,
  } = useGamesWallet();
  const balance = walletLoaded ? wallet.credits : null;

  /* ── round state ── */
  const [isPlaying, setIsPlaying] = useState(false);

  /* ── bet state ── */
  const [wager, setWager] = useMachineBet(balance, 10, { locked: isPlaying });
  const [family, setFamily] = useState<LuckyCageFamily>("ball");
  const [ticketId, setTicketId] = useState<string>(LUCKY_CAGE_DEFAULT_TICKET);
  const [error, setError] = useState<string | null>(null);

  /* ── round state ── */
  const [phaseLabel, setPhaseLabel] = useState("");
  /** Balls revealed SO FAR — grows as each one seats. */
  const [revealed, setRevealed] = useState<number[]>([]);
  const [round, setRound] = useState<CommittedRound | null>(null);

  /* ── presentation state ── */
  const [theme, setTheme] = useState<LuckyCageTheme>(DEFAULT_LUCKY_CAGE_THEME);
  const [webglError, setWebglError] = useState(false);

  const ticket = useMemo(
    () =>
      getLuckyCageTicket(ticketId) ??
      getLuckyCageTicket(LUCKY_CAGE_DEFAULT_TICKET)!,
    [ticketId],
  );

  const {
    start: startSession,
    settle: settleSession,
    achievements,
  } = useWagerSession("arcade-lucky-cage");

  /* ── refs: scene + loop ── */
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<CageScene | null>(null);
  const tumbleRef = useRef<TumbleState | null>(null);
  const frameLoopRef = useRef<GameFrameLoop | null>(null);
  // The 3D kit's quality tier; it outlives a scene rebuild.
  const qualityRef = useRef<MidwayQualityController | null>(null);
  useEffect(
    () => () => {
      qualityRef.current?.dispose();
      qualityRef.current = null;
    },
    [],
  );
  const lastFrameRef = useRef(0);
  const startedAtRef = useRef(0);
  const timelineRef = useRef<CageTimeline | null>(null);
  const committedRef = useRef<CommittedRound | null>(null);
  const seatedRef = useRef(0);
  const playingRef = useRef(false);
  const activeUntilRef = useRef(0);
  const finishTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const themeRef = useRef(theme);
  const rattleAtRef = useRef(0);
  const visibleRef = useRef(true);
  const phaseLabelRef = useRef("");
  const cueTimersRef = useRef<Array<ReturnType<typeof setTimeout>>>([]);
  // One semitone higher for each ball that clacks into its cradle.
  const ladderRef = useRef(createPitchLadder({ maxSteps: 5 }));

  const clearCueTimers = useCallback(() => {
    for (const t of cueTimersRef.current) clearTimeout(t);
    cueTimersRef.current = [];
  }, []);

  /* ── equipped cosmetics (best effort) ── */
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/store/inventory?gameType=lucky-cage", {
          cache: "no-store",
        });
        if (!res.ok) return;
        const payload = (await res.json()) as { equipped?: LuckyCageEquipped };
        if (!cancelled) setTheme(buildLuckyCageTheme(payload.equipped ?? []));
      } catch {
        /* the default cabinet stays */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /* ══════════════════════════════════════════════════════════════════
     Render loop
     ══════════════════════════════════════════════════════════════════ */

  const drawFrame = useCallback((now: number) => {
    const cage = sceneRef.current;
    const tumble = tumbleRef.current;
    if (!cage || !tumble) return;

    const dt = Math.min(0.05, Math.max(0, (now - lastFrameRef.current) / 1000));
    lastFrameRef.current = now;

    const timeline = timelineRef.current;
    const committed = committedRef.current;
    const frame =
      timeline && playingRef.current
        ? cageFrame(timeline, now - startedAtRef.current)
        : cageFrame(timeline ?? IDLE_TIMELINE, timeline ? timeline.totalMs : 0);

    // The cosmetic tumble runs at a fixed timestep alongside the timeline.
    const loud = stepTumble(tumble, dt, frame.spin);
    if (
      playingRef.current &&
      loud >= 4 &&
      now - rattleAtRef.current > 190 &&
      frame.spin > 2
    ) {
      rattleAtRef.current = now;
      SoundManager.play("cageTumble", {
        volume: Math.min(1, 0.35 + loud / 24),
      });
    }

    applyCageFrame(cage, {
      frame,
      tumble,
      draw: committed?.draw ?? null,
      dt,
      idleTime: now / 1000,
    });

    // Fire the per-ball beats exactly once each.
    if (playingRef.current && committed && frame.seated > seatedRef.current) {
      for (let i = seatedRef.current; i < frame.seated; i += 1) {
        emitSeatBurst(cage, i);
        // A clack and a tick for every ball, each a step above the last.
        SoundManager.play("cageSeat", { pitch: ladderRef.current.next() });
        hapticTick();
      }
      seatedRef.current = frame.seated;
      setRevealed(committed.draw.slice(0, frame.seated));
    }

    // Only re-render React when the spoken line actually changes — the frame
    // loop must not drive a state update 60 times a second.
    if (playingRef.current) {
      const line = cageStatusLine(frame, committed?.draw ?? null);
      if (line !== phaseLabelRef.current) {
        phaseLabelRef.current = line;
        setPhaseLabel(line);
      }
    }

    if (frame.spin > 5 && Math.random() < 0.06) emitCageDust(cage);

    cage.renderer.render(cage.scene, cage.camera);
  }, []);

  /** Wake the loop. Idle wake-ups run for `ms` and then park themselves. */
  const requestRender = useCallback((ms = 260) => {
    if (typeof window === "undefined" || !sceneRef.current) return;
    activeUntilRef.current = Math.max(
      activeUntilRef.current,
      performance.now() + ms,
    );
    const frameLoop = frameLoopRef.current;
    if (
      frameLoop &&
      !frameLoop.isRunning() &&
      !document.hidden &&
      visibleRef.current
    ) {
      lastFrameRef.current = performance.now();
      frameLoop.start();
    }
  }, []);

  /* Cosmetic recolour without rebuilding the cabinet. */
  useEffect(() => {
    themeRef.current = theme;
    if (sceneRef.current) {
      applyCageTheme(sceneRef.current, theme);
      requestRender();
    }
  }, [theme, requestRender]);

  /* ══════════════════════════════════════════════════════════════════
     Scene lifecycle
     ══════════════════════════════════════════════════════════════════ */

  const teardownScene = useCallback(() => {
    frameLoopRef.current?.destroy();
    frameLoopRef.current = null;
    disposeCageScene(sceneRef.current);
    sceneRef.current = null;
    tumbleRef.current = null;
  }, []);

  const handleContextLost = useCallback(() => {
    // Keep the round's money and DOM read-out intact; only the picture is gone.
    frameLoopRef.current?.destroy();
    frameLoopRef.current = null;
    const cage = sceneRef.current;
    sceneRef.current = null;
    tumbleRef.current = null;
    // disposeCageScene is context-loss safe; it drops the CPU-side graph and
    // swallows the GPU disposals that can no longer succeed.
    disposeCageScene(cage);
    // The DOM chute read-out below the stage becomes the whole cabinet.
    setWebglError(true);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || sceneRef.current || webglError) return;

    const quality =
      qualityRef.current ?? createMidwayQualityController({ game: "lucky-cage" });
    qualityRef.current = quality;

    const cage = buildLuckyCageScene({
      canvas,
      theme: themeRef.current,
      quality,
      onPause: () => frameLoopRef.current?.stop(),
      onRestore: () => {
        sceneRef.current?.rig.refreshEnvironment();
        requestRender(400);
      },
      onContextLost: handleContextLost,
    });
    if (!cage) {
      setWebglError(true);
      return;
    }
    sceneRef.current = cage;
    const stopTierWatch = quality.onChange((tier) => {
      const current = sceneRef.current;
      if (!current) return;
      applyCageTier(current, tier);
      requestRender();
    });
    let firstFrame = true;
    tumbleRef.current = createTumbleState(
      BALL_COUNT,
      DRUM_INTERIOR_RADIUS,
      DRUM_INTERIOR_HALF_LENGTH,
      BALL_RADIUS,
    );
    frameLoopRef.current = createGameFrameLoop({
      // Outcome and choreography are wall-clock functions. The runtime owns
      // scheduling only; there is no authoritative integrated simulation.
      simulate: () => undefined,
      render: (_alpha, frameInfo) => {
        drawFrame(frameInfo.nowMs);
        // A tier change waits for the draw to finish.
        quality.hold(playingRef.current);
        quality.frame(frameInfo.nowMs, frameInfo.deltaMs);
        if (firstFrame) {
          // The first frame is on screen: record it, then paint the grain.
          firstFrame = false;
          markMidwayFirstFrame("lucky-cage", quality.tier());
          cage.deferred.start(() => requestRender());
        }
        const keepGoing =
          visibleRef.current &&
          !document.hidden &&
          (playingRef.current || frameInfo.nowMs < activeUntilRef.current);
        if (!keepGoing) frameLoopRef.current?.stop();
      },
    });

    const rect = canvas.getBoundingClientRect();
    resizeCageScene(cage, rect.width || 640, rect.height || 400);
    requestRender(400);

    return () => {
      stopTierWatch();
      teardownScene();
    };
  }, [drawFrame, handleContextLost, requestRender, teardownScene, webglError]);

  /* ── resize ── */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const observer = new ResizeObserver((entries) => {
      const cage = sceneRef.current;
      if (!cage) return;
      const box = entries[0]?.contentRect;
      if (!box) return;
      resizeCageScene(cage, box.width, box.height);
      requestRender();
    });
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [requestRender]);

  /* ── suspend when hidden or scrolled out of view ── */
  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden) {
        frameLoopRef.current?.stop();
      } else if (playingRef.current) {
        lastFrameRef.current = performance.now();
        requestRender();
      } else {
        requestRender();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [requestRender]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries[0]?.isIntersecting ?? true;
        visibleRef.current = visible;
        if (!visible) {
          frameLoopRef.current?.stop();
        } else {
          lastFrameRef.current = performance.now();
          requestRender();
        }
      },
      { threshold: 0.02 },
    );
    observer.observe(stage);
    return () => observer.disconnect();
  }, [requestRender]);

  useEffect(
    () => () => {
      if (finishTimerRef.current) clearTimeout(finishTimerRef.current);
      for (const t of cueTimersRef.current) clearTimeout(t);
      cueTimersRef.current = [];
    },
    [],
  );

  /* ══════════════════════════════════════════════════════════════════
     Round finish
     ══════════════════════════════════════════════════════════════════ */

  const finishRound = useCallback(() => {
    const committed = committedRef.current;
    if (!committed || !playingRef.current) return;
    playingRef.current = false;
    if (finishTimerRef.current) {
      clearTimeout(finishTimerRef.current);
      finishTimerRef.current = null;
    }
    clearCueTimers();

    setRevealed(committed.draw.slice());
    setRound(committed);
    setIsPlaying(false);
    const line = committed.won
      ? `Drew ${committed.draw.join(", ")}. ${capital(ticketName(committed.ticket))} pays ${fmtMult(
          committed.multiplier,
        )}×, ${committed.payout.toLocaleString()} tickets.`
      : `Drew ${committed.draw.join(", ")}. ${capital(ticketName(committed.ticket))} loses.`;
    phaseLabelRef.current = line;
    setPhaseLabel(line);

    if (committed.won) {
      SoundManager.play(
        committed.multiplier >= 20 ? "arcadeBigWin" : "arcadeWin",
      );
      playHaptic("success");
    } else {
      triggerFeedback("loss");
      playHaptic("failure");
    }
    void refreshWallet();
    // One last frame so the cabinet parks in its final pose, then the loop
    // suspends itself.
    requestRender(400);
  }, [clearCueTimers, refreshWallet, requestRender, triggerFeedback]);

  /* ══════════════════════════════════════════════════════════════════
     Crank — settle first, animate after
     ══════════════════════════════════════════════════════════════════ */

  const handleCrank = useCallback(async () => {
    if (playingRef.current || balance == null) return;
    if (!Number.isFinite(wager) || wager < ARCADE_MIN_BET) {
      setError(`The smallest bet is ${ARCADE_MIN_BET} tickets.`);
      return;
    }
    if (wager > balance) {
      setError(`You need ${wager} tickets for this bet.`);
      return;
    }
    const chosen = getLuckyCageTicket(ticketId);
    if (!chosen) {
      setError("Pick a ticket first.");
      return;
    }

    setError(null);
    setRound(null);
    setRevealed([]);
    setIsPlaying(true);
    playingRef.current = true;
    // The crank sits under the board on a phone. Scroll back up so the whole
    // draw is on screen, with the count and cradles under the cabinet.
    stageRef.current
      ?.closest(".arc-machine-frame")
      ?.scrollTo({ top: 0, behavior: prefersReducedMotion() ? "auto" : "smooth" });
    seatedRef.current = 0;
    ladderRef.current.reset();
    committedRef.current = null;
    timelineRef.current = null;
    clearCueTimers();
    phaseLabelRef.current = "";
    setPhaseLabel("");

    // Sound must be unlocked from inside the gesture stack.
    SoundManager.unlock();
    SoundManager.play("cageCrank");
    playHaptic("medium");
    if (tumbleRef.current) {
      resetTumbleState(tumbleRef.current);
      agitateTumble(tumbleRef.current, 1.6);
    }
    if (sceneRef.current) resetCageVisuals(sceneRef.current);
    // Keep frames flowing across the ~200 ms settle so the crank pull reads as
    // a physical action rather than a frozen picture.
    requestRender(900);

    // Optimistic debit so the wallet reads honestly during the draw.
    adjustCredits(-wager);
    const stake = wager;

    try {
      const session = await startSession(stake, { ticket: chosen.id });
      if (!session.ok)
        throw new Error(machineError(session.error, "The cage could not take the bet. Try again."));

      let settled: Awaited<
        ReturnType<typeof settleSession<CageSettleResponse>>
      > | null = null;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          const response = await settleSession<CageSettleResponse>();
          if (response.ok) {
            settled = response;
            break;
          }
          if (response.status >= 400 && response.status < 500) break;
        } catch {
          // The guarded server settle may have committed before the response
          // was lost. Retry this same token; never start or redraw a round.
        }
        if (attempt < 2) {
          await new Promise((resolve) => setTimeout(resolve, 800));
        }
      }
      if (!settled) {
        throw new Error(
          "The draw could not be confirmed. Check your history for the result.",
        );
      }

      const data = settled.data;
      const draw =
        Array.isArray(data.draw) && data.draw.length === LUCKY_CAGE_DRAW_COUNT
          ? data.draw.slice()
          : drawLuckyCageClient(data.seed);

      const committed: CommittedRound = {
        ticket: chosen,
        wager: stake,
        draw,
        hitBalls: Array.isArray(data.hitBalls) ? data.hitBalls.slice() : [],
        won: data.won ?? data.payout > 0,
        payout: data.payout ?? 0,
        multiplier: data.multiplier ?? 0,
        seed: data.seed,
        roundId: data.roundId ?? null,
      };
      committedRef.current = committed;

      const useReduced = prefersReducedMotion();
      const timeline = buildCageTimeline(useReduced);
      timelineRef.current = timeline;
      seatedRef.current = 0;
      startedAtRef.current = performance.now();
      lastFrameRef.current = startedAtRef.current;
      requestRender(timeline.totalMs + 400);

      SoundManager.play("cageTumble");

      // Mechanical cues are scheduled off the timeline, not the frame loop, so
      // they still land if frames are being throttled.
      cueTimersRef.current.push(
        setTimeout(() => {
          SoundManager.play("cageGate");
          playHaptic("light");
        }, timeline.tumbleEnd),
      );
      for (const at of timeline.releaseAt) {
        cueTimersRef.current.push(
          setTimeout(() => SoundManager.play("cageChute"), at),
        );
      }

      // Belt and braces: even if the tab is hidden for the whole draw (so no
      // animation frames run), the round still resolves in the DOM on time.
      if (finishTimerRef.current) clearTimeout(finishTimerRef.current);
      finishTimerRef.current = setTimeout(finishRound, timeline.totalMs + 40);
    } catch (err) {
      playingRef.current = false;
      committedRef.current = null;
      timelineRef.current = null;
      clearCueTimers();
      setIsPlaying(false);
      const message =
        err instanceof Error && err.message !== "Failed to fetch"
          ? err.message
          : "The cage lost its connection. Try again.";
      phaseLabelRef.current = "";
      setPhaseLabel("");
      setError(message);
      void refreshWallet();
    }
  }, [
    adjustCredits,
    clearCueTimers,
    finishRound,
    refreshWallet,
    requestRender,
    settleSession,
    startSession,
    ticketId,
    wager,
    balance,
  ]);

  /* On a phone the receipt prints over a screen taller than the viewport, and
     the player may have scrolled down to the board. Scroll the frame back to
     the top, where the receipt prints. */
  useEffect(() => {
    if (!round || isPlaying) return;
    const frame = requestAnimationFrame(() => {
      const overlay = document.querySelector(".arc-machine-overlay");
      overlay?.closest(".arc-machine-frame")?.scrollTo({ top: 0 });
    });
    return () => cancelAnimationFrame(frame);
  }, [round, isPlaying]);

  /* ══════════════════════════════════════════════════════════════════
     Keyboard + pointer parity
     ══════════════════════════════════════════════════════════════════ */

  useMachineKey(
    useMemo(() => () => void handleCrank(), [handleCrank]),
    ["Space", "Enter", "NumpadEnter"],
  );

  const onStageActivate = useCallback(() => {
    if (playingRef.current) {
      // Mid-draw taps just rattle the cage — they can never change the result.
      if (tumbleRef.current) agitateTumble(tumbleRef.current, 0.5);
      requestRender();
      return;
    }
    void handleCrank();
  }, [handleCrank, requestRender]);

  const onStageKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLDivElement>) => {
      if (e.key !== "Enter" && e.key !== " " && e.code !== "Space") return;
      e.preventDefault();
      onStageActivate();
    },
    [onStageActivate],
  );

  /* ══════════════════════════════════════════════════════════════════
     Derived view data
     ══════════════════════════════════════════════════════════════════ */

  const canPlay =
    !isPlaying &&
    balance != null &&
    wager >= ARCADE_MIN_BET &&
    wager <= balance;

  const hitSet = useMemo(() => new Set(round?.hitBalls ?? []), [round]);

  const familyTickets = TICKETS_BY_FAMILY[family];
  const drawnSet = useMemo(() => new Set(revealed), [revealed]);

  const pickTicket = useCallback((next: LuckyCageTicket) => {
    // The press answers in the same frame: a click and a tick on the thumb.
    triggerFeedback("press", { haptic: true });
    setTicketId(next.id);
  }, [triggerFeedback]);

  const pickFamily = useCallback(
    (next: LuckyCageFamily) => {
      triggerFeedback("press", { haptic: true });
      setFamily(next);
      // Ball and head tickets name the same numbers, so the number stays.
      const sameNumber = TICKETS_BY_FAMILY[next].find(
        (t) =>
          (next === "ball" || next === "head") &&
          (ticket.family === "ball" || ticket.family === "head") &&
          t.value === ticket.value,
      );
      const first = sameNumber ?? TICKETS_BY_FAMILY[next][0];
      if (first) setTicketId(first.id);
    },
    [ticket, triggerFeedback],
  );

  /* ── the glass: what each kind of ticket pays ── */

  const glass = (
    <MachineGlass
      name="lucky cage"
      rules={[ticket.detail]}
      paytable={GLASS_ROWS.map((row) => ({
        label: row.label,
        value: `${fmtMult(row.multiplier)}×`,
        lit: row.matches(ticket),
      }))}
    />
  );

  /* ── the screen: the cabinet with its draw count, and the board beside or under it ── */

  const screen = (
    <div className="lc-screen">
      <div className="lc-cabinet">
        <div
          ref={stageRef}
          className="lc-stage lc-viewport"
          role="button"
          tabIndex={0}
          aria-label={
            isPlaying ? "lucky cage is drawing" : "turn the crank and draw five balls"
          }
          aria-disabled={!canPlay && !isPlaying}
          onClick={onStageActivate}
          onKeyDown={onStageKeyDown}
        >
          {webglError ? null : <canvas ref={canvasRef} className="lc-canvas" />}

          {webglError ? (
            <MidwayStill
              game="lucky-cage"
              alt="The lucky cage cabinet: a brass drum of 20 numbered balls over a walnut base with five cradles."
              line="Without WebGL the cage can't turn in 3D, so the cradles below show the draw."
              className="absolute inset-0"
            />
          ) : null}
        </div>
        <div className="lc-chute-row">
          <ChuteReadout revealed={revealed} hitSet={hitSet} isPlaying={isPlaying} />
          <p aria-live="polite" aria-atomic="true" className="sr-only">
            {phaseLabel}
          </p>
        </div>
      </div>
      <LuckyCageBoard
        theme={theme}
        family={family}
        tickets={familyTickets}
        ticketId={ticketId}
        drawn={drawnSet}
        wonId={round?.won ? round.ticket.id : null}
        disabled={isPlaying}
        describe={(t) =>
          `${ticketName(t)}. ${t.detail} Pays ${fmtMult(t.multiplier)} times. Chance ${fmtChance(t.probability)}.`
        }
        onFamily={pickFamily}
        onPick={pickTicket}
      />
    </div>
  );

  const receipt =
    round && !isPlaying ? (
      <ArcadeWagerResultPlate
        result={{
          payout: round.payout,
          stake: round.wager,
          multiplier: round.multiplier,
        }}
        kicker="lucky cage"
        headline={`${round.won ? fmtMult(round.multiplier) : 0}×`}
        detail={<CageSlip ticket={round.ticket} draw={round.draw} won={round.won} />}
        fairness={{ seedHash: null, revealedSeed: round.seed }}
        achievements={achievements}
        roundId={round.roundId ?? undefined}
        sound={false}
      />
    ) : null;

  return (
    <GameShell
      game="lucky-cage"
      className="lucky-cage-midway"
      howTo={HOW_TO}
    >
      <ArcadeMachine
        name="lucky cage"
        glass={glass}
        action={
          <MachineButton
            onClick={() => void handleCrank()}
            disabled={!canPlay && !isPlaying}
            aria-disabled={isPlaying || undefined}
            aria-label={`crank, ${wager} tickets on ${ticket.label.toLowerCase()}`}
          >
            crank
          </MachineButton>
        }
        bet={{
          value: wager,
          onChange: setWager,
          balance,
          disabled: isPlaying,
        }}
        receipt={receipt}
        receiptKey={round?.roundId ?? null}
        notice={error}
      >
        {screen}
      </ArcadeMachine>
    </GameShell>
  );
}

/* ══════════════════════════════════════════════════════════════════════
   Chute read-out — the accessible mirror of the five cradles
   ══════════════════════════════════════════════════════════════════════ */

function ChuteReadout({
  revealed,
  hitSet,
  isPlaying,
}: {
  revealed: number[];
  hitSet: Set<number>;
  isPlaying: boolean;
}) {
  return (
    <div className="lc-tray">
      <p className="lc-count" aria-hidden="true">
        <b>{revealed.length}</b>
        <span>of {LUCKY_CAGE_DRAW_COUNT} drawn</span>
      </p>
      <ol className="lc-chute" aria-label="balls drawn, in chute order">
        {Array.from({ length: LUCKY_CAGE_DRAW_COUNT }, (_, i) => {
          const ball = revealed[i];
          const filled = typeof ball === "number";
          const classes = [
            "lc-ball",
            filled ? "" : "lc-ball-empty",
            filled && hitSet.has(ball) ? "lc-ball-hit" : "",
            filled && i === 0 && !hitSet.has(ball) ? "lc-ball-head" : "",
            filled ? "lc-ball-seat" : "",
          ]
            .filter(Boolean)
            .join(" ");
          return (
            <li key={i} className="lc-cradle">
              <span className="lc-cradle-index">{i === 0 ? "head" : i + 1}</span>
              <span className={classes} aria-hidden={!filled}>
                {filled ? ball : ""}
              </span>
              <span className="sr-only">
                {filled
                  ? `Cradle ${i + 1}: ball ${ball}${hitSet.has(ball) ? ", a hit" : ""}`
                  : isPlaying
                    ? `Cradle ${i + 1}: waiting`
                    : `Cradle ${i + 1}: empty`}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
