"use client";

/* ──────────────────────────────────────────────────────────────────────────
   PRIZE CLAW — money, controls and the accessible DOM cabinet.

   The order of operations is the whole safety story:

     1. the player picks a cabinet and a bet;
     2. POST /api/wagers/session holds the wager, fixes the PRIVATE session
        seed, and returns the PUBLIC bedSeed — the outcome seed is never in
        that response;
     3. the client builds the prize bed locally from bedSeed with the SAME pure
        function the server uses, so it can print the exact grip chance before
        the commit;
     4. the player aims. The claw position is the only thing they control;
     5. POST /api/wagers/action { action: 'drop', data: { x, z } } sends TWO
        FLOATS AND NOTHING ELSE. The server clamps them, regenerates the bed,
        rolls u1 and u2 from the private seed, settles idempotently, and
        returns the outcome, both rolls and the animation script;
     6. only THEN does the 3.5-5.6s descend/close/lift choreography play, over
        a result that is already banked.

   Nothing in this file can change which prize comes out. The client never
   sends a prize index, a tier, a grip chance, a multiplier or a payout — and
   the server would not read them if it did.

   Rendering is split out on purpose:
     _prize-claw-scene.ts  the cabinet (geometry, materials, disposal)
     _prize-claw-drop.ts   the pure, time-parameterised choreography
     _prize-claw-theme.ts  cosmetic palette
   This file keeps the wager shell, the aim controls, the DOM read-out and the
   lifecycle.
   ────────────────────────────────────────────────────────────────────────── */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";

import { useGamesWallet } from "@/features/arcade/components/shell/games-wallet-provider";
import {
  GameShell,
  type GameHowTo,
} from "@/features/arcade/components/shell/game-shell";
import { Num } from "@/features/arcade/components/ui/num";
import {
  ArcadeMachine,
  MachineButton,
  MachineChoice,
  MachineGlass,
  machineError,
  useMachineBet,
} from "@/features/arcade/components/wagers/arcade-machine";
import { ArcadeWagerResultPlate } from "@/features/arcade/components/results/arcade-run-result";
import { useFeelReducedMotion, useGameFeedback } from "@/features/arcade/lib/use-game-feedback";
import { isControlTarget, isDialogOpen } from "@/features/arcade/lib/use-first-input";
import { SoundManager } from "@/features/arcade/lib/sound-manager";
import { playHaptic } from "@/features/arcade/lib/game-haptics";
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
import { usePreventGameGestures } from "@/features/arcade/lib/game-mobile-utils";
import { ARCADE_MIN_BET } from "@/server/arcade/arcade-constants";
import {
  CLAW_BED_X,
  CLAW_BED_Z0,
  CLAW_BED_Z1,
  CLAW_CABINETS,
  CLAW_CABINET_IDS,
  CLAW_COMMIT_MS,
  CLAW_EXPOSURE_LABELS,
  CLAW_HOME,
  CLAW_R_GRIP,
  CLAW_TIERS,
  CLAW_TIER_IDS,
  PRIZE_CLAW_RTP,
  clampToBed,
  clawAimAt,
  clawCabinetTiers,
  clawGripTable,
  formatClawPct,
  generatePrizeBed,
  type ClawCabinetId,
  type ClawTierId,
  type PrizeBed,
} from "@/features/arcade/lib/prize-claw-bed";
import {
  assignClawShelf,
  type ClawShelfItem,
  type ClawShelfPrize,
} from "@/features/arcade/lib/prize-claw-shelf";
import type { ClawScript } from "@/server/arcade/wager-games/prize-claw";

import {
  buildClawTimeline,
  clawFrameAt,
  clawStatusLine,
  type ClawFrame,
  type ClawTimeline,
} from "./_prize-claw-drop";
import {
  applyClawFrame,
  applyClawTier,
  buildPrizeClawScene,
  disposePrizeClawScene,
  emitClawDust,
  populatePrizeBed,
  repaintPlates,
  resetClawVisuals,
  resizePrizeClawScene,
  setNamePlate,
  type ClawScene,
} from "./_prize-claw-scene";
import {
  DEFAULT_PRIZE_CLAW_THEME,
  type PrizeClawTheme,
} from "./_prize-claw-theme";
import "./_prize-claw.css";

/* ── wire types ─────────────────────────────────────────────────────────── */

type ClawOutcome = ClawScript["outcome"];

type DropResponse = {
  cabinet: ClawCabinetId;
  bedSeed: number;
  point: { x: number; z: number };
  target: {
    index: number;
    tier: ClawTierId;
    tierName: string;
    exposure: "clear" | "leaning" | "buried";
    x: number;
    z: number;
  } | null;
  aimError: number;
  grip: number;
  grabRoll: number;
  grabbed: boolean;
  holdChance: number;
  holdRoll: number;
  held: boolean;
  outcome: ClawOutcome;
  multiplier: number;
  script: ClawScript;
  payout: number;
  seed: number;
  roundId: string | null;
  replayed?: true;
};

/** What the round committed to, held back from the plate until the reveal. */
type CommittedRound = DropResponse & { wager: number };

type Phase = "idle" | "arming" | "armed" | "dropping" | "result";
type ClawPoint = { x: number; z: number };

/* ── helpers ────────────────────────────────────────────────────────────── */

const BED_MID_Z = (CLAW_BED_Z0 + CLAW_BED_Z1) / 2;

/** Nudge steps: coarse for a tap, fine with Shift held. */
const NUDGE = 0.04;
const NUDGE_FINE = 0.012;

/** Touch drags the claw this far above the finger so the thumb never covers it. */
const TOUCH_LIFT = 0.55;

const CABINET_OPTIONS = CLAW_CABINET_IDS.map((id) => ({
  value: id,
  label: CLAW_CABINETS[id].name.toLowerCase(),
}));

const fmtTierMult = (id: ClawTierId): string => {
  const m = CLAW_TIERS[id].multiplier;
  return Number.isInteger(m) ? String(m) : m.toFixed(1);
};

const HOW_TO: GameHowTo = {
  lines: [
    `Drag the claw over a prize, or use the arrow keys, and press drop within ${CLAW_COMMIT_MS / 1000} seconds.`,
    "Dead centre on a prize with nothing beside it is the best chance, and dearer prizes slip more.",
    `Tags run from ${fmtTierMult(CLAW_TIER_IDS[0])}× to ${fmtTierMult(CLAW_TIER_IDS[CLAW_TIER_IDS.length - 1])}×, and every tag returns ${Math.round(PRIZE_CLAW_RTP * 100)}% over many centred drops.`,
  ],
};

/** How each drop ended, flat. A near miss is shown, never sold. */
const OUTCOME_LINE: Record<ClawOutcome, string> = {
  won: "Down the chute",
  slipped: "Slipped on the lift",
  brushed: "Knocked over",
  missed: "Missed",
  empty: "Bare felt",
};

/** "poker chips" to "Poker chips", for a prize name that starts a sentence. */
const capitalise = (text: string): string =>
  text.charAt(0).toUpperCase() + text.slice(1);

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

const fmtPct = formatClawPct;

function fmtMult(m: number): string {
  return Number.isInteger(m) ? String(m) : m.toFixed(1);
}

const blocksGameKeyboard = (target: EventTarget | null): boolean =>
  isControlTarget(target) || isDialogOpen();

/* ══════════════════════════════════════════════════════════════════════
   Component
   ══════════════════════════════════════════════════════════════════════ */

/** The case a visitor sees before pressing play. Not a real bed: its seed is a constant. */
const DISPLAY_BED_SEED: Record<ClawCabinetId, number> = {
  plush: 90_113,
  curio: 31_337,
  top: 70_421,
};

export default function PrizeClawClient({ shelf }: { shelf: ClawShelfItem[] }) {
  const { trigger: triggerFeedback } = useGameFeedback();
  const {
    wallet,
    loaded: walletLoaded,
    refresh: refreshWallet,
    adjustCredits,
  } = useGamesWallet();
  const balance = walletLoaded ? wallet.credits : null;

  /* ── round state ── */
  const [phase, setPhase] = useState<Phase>("idle");

  /* ── bet state ── */
  const [wager, setWager] = useMachineBet(balance, 10, {
    locked: phase !== "idle" && phase !== "result",
  });
  const stakeRef = useRef(wager);
  const [cabinet, setCabinet] = useState<ClawCabinetId>("curio");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  /* ── round state ── */
  const [bed, setBed] = useState<PrizeBed | null>(null);
  const [aim, setAim] = useState<ClawPoint>({ ...CLAW_HOME });
  const [secondsLeft, setSecondsLeft] = useState(CLAW_COMMIT_MS / 1000);
  const [round, setRound] = useState<CommittedRound | null>(null);
  /** The screen-reader account of the round. Never drawn. */
  const [srLine, setSrLine] = useState("");

  /* ── presentation ── */
  const [theme] = useState<PrizeClawTheme>(DEFAULT_PRIZE_CLAW_THEME);
  const [webglError, setWebglError] = useState(false);
  const reduced = useFeelReducedMotion();

  const {
    setRevealedSeed,
    start: startSession,
    action: sessionAction,
    settle: settleSession,
    reset: resetSession,
    achievements,
  } = useWagerSession("arcade-prize-claw");

  /* ── refs ── */
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<ClawScene | null>(null);
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
  const requestRenderRef = useRef<(ms?: number) => void>(() => undefined);
  const activeUntilRef = useRef(0);
  const visibleRef = useRef(true);
  const themeRef = useRef(theme);
  const bedRef = useRef<PrizeBed | null>(null);
  const aimRef = useRef<ClawPoint>({ ...CLAW_HOME });
  const smoothAimRef = useRef<ClawPoint>({ ...CLAW_HOME });
  const phaseRef = useRef<Phase>("idle");
  const timelineRef = useRef<ClawTimeline | null>(null);
  const startedAtRef = useRef(0);
  const committedRef = useRef<CommittedRound | null>(null);
  const finishTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cueTimersRef = useRef<Array<ReturnType<typeof setTimeout>>>([]);
  const commitDeadlineRef = useRef(0);
  const clockRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const statusRef = useRef("");
  const lastPhaseRef = useRef<ClawFrame["phase"]>("settled");
  const hapticAtRef = useRef(0);
  const draggingRef = useRef(false);
  const cabinetNameRef = useRef(CLAW_CABINETS.curio.name.toLowerCase());

  const clearCueTimers = useCallback(() => {
    for (const t of cueTimersRef.current) clearTimeout(t);
    cueTimersRef.current = [];
  }, []);

  usePreventGameGestures(phase === "armed" || phase === "dropping");

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  useEffect(() => {
    themeRef.current = theme;
  }, [theme]);

  /* ── derived: the live readout ── */

  const liveAim = useMemo(
    () => (bed ? clawAimAt(bed, aim.x, aim.z) : null),
    [bed, aim],
  );

  const hoverPrize = liveAim?.target?.prize ?? null;
  const hoverTier = hoverPrize ? CLAW_TIERS[hoverPrize.tier] : null;

  /* ── the case: a display bed before play, the real one after ── */

  const idleBed = useMemo(
    () => generatePrizeBed(DISPLAY_BED_SEED[cabinet], cabinet),
    [cabinet],
  );
  const shownBed = bed ?? idleBed;
  const shelfPrizes = useMemo(
    () => assignClawShelf(shownBed, shelf),
    [shownBed, shelf],
  );
  const shownRef = useRef<{ bed: PrizeBed; prizes: ClawShelfPrize[] }>({
    bed: shownBed,
    prizes: shelfPrizes,
  });
  /** The name a player reads for a prize: its counter item, else its tier. */
  const prizeName = useCallback(
    (index: number, tier: ClawTierId): string =>
      shownRef.current.prizes.find((p) => p.index === index)?.item?.name ??
      CLAW_TIERS[tier].name.toLowerCase(),
    [],
  );

  /* ══════════════════════════════════════════════════════════════════
     Render loop
     ══════════════════════════════════════════════════════════════════ */

  // Refill the case when the bed changes: the prizes pour in from the top.
  useEffect(() => {
    shownRef.current = { bed: shownBed, prizes: shelfPrizes };
    const claw = sceneRef.current;
    if (!claw) return;
    populatePrizeBed(claw, shownBed, themeRef.current, shelfPrizes, !reduced);
    resetClawVisuals(claw);
    lastFrameRef.current = performance.now();
    requestRenderRef.current(1600);
  }, [shownBed, shelfPrizes, reduced]);

  const drawFrame = useCallback(
    (now: number) => {
      const claw = sceneRef.current;
      if (!claw) return;

      const dt = Math.min(
        0.05,
        Math.max(0, (now - lastFrameRef.current) / 1000),
      );
      lastFrameRef.current = now;

      const currentBed = bedRef.current;
      const committed = committedRef.current;
      const timeline = timelineRef.current;
      const playing = phaseRef.current === "dropping" && timeline != null;

      // The claw eases toward the requested position while aiming; during the
      // drop it is pinned to the committed point so the animation cannot drift.
      const wanted = playing && committed ? committed.point : aimRef.current;
      const rate = playing ? 40 : 9;
      const k = 1 - Math.exp(-rate * dt);
      smoothAimRef.current.x += (wanted.x - smoothAimRef.current.x) * k;
      smoothAimRef.current.z += (wanted.z - smoothAimRef.current.z) * k;

      const targetIndex = committed?.target?.index ?? null;
      const targetTop =
        targetIndex != null
          ? (claw.prizes.find((p) => p.slot.index === targetIndex)?.topY ?? 0.26)
          : 0.26;

      const frame: ClawFrame = playing
        ? clawFrameAt(timeline!, now - startedAtRef.current, targetTop + 0.16)
        : {
            phase: "armed",
            t: 0,
            headY: 1.62,
            gripT: 0,
            carrying: false,
            travelT: 0,
            prizeLift: 0,
            prizeYaw: 0,
            prizeRoll: 0,
            released: false,
            chuteT: 0,
            sag: 0,
            dolly: 0,
          };

      applyClawFrame(claw, {
        frame,
        aim: smoothAimRef.current,
        targetIndex,
        hoverIndex:
          !playing && currentBed
            ? (clawAimAt(
                currentBed,
                smoothAimRef.current.x,
                smoothAimRef.current.z,
              ).target?.prize.index ?? null)
            : null,
        outcome: playing ? (committed?.outcome ?? null) : null,
        dt,
        reduced,
      });

      // Phase-entry beats, fired exactly once each.
      if (playing && frame.phase !== lastPhaseRef.current) {
        lastPhaseRef.current = frame.phase;
        const outcome = committed?.outcome ?? "missed";
        if (frame.phase === "closing") {
          SoundManager.play("clawClose");
          playHaptic("medium");
          if (!reduced) {
            emitClawDust(
              claw,
              { x: smoothAimRef.current.x, y: 0.06, z: smoothAimRef.current.z },
              committed?.script.dust ?? 0.5,
            );
          }
        } else if (frame.phase === "descending") {
          // The winch whines on the way down.
          SoundManager.play("clawWhine");
        } else if (frame.phase === "gripping") {
          if (outcome === "won" || outcome === "slipped") {
            SoundManager.play("clawGrip");
          }
        } else if (frame.phase === "lifting") {
          // Heavier tiers labour: a lower whine.
          const rank = committed?.target
            ? CLAW_TIER_IDS.indexOf(committed.target.tier)
            : 0;
          const carrying = outcome === "won" || outcome === "slipped";
          SoundManager.play("clawWhine", {
            pitch: carrying ? 0.92 - rank * 0.06 : 1.1,
            volume: carrying ? 1 : 0.7,
          });
        } else if (frame.phase === "travelling") {
          SoundManager.play("clawRailRun");
        } else if (frame.phase === "chuting") {
          SoundManager.play("clawChute");
        }
      }

      // Only re-render React when the spoken line actually changes: the frame
      // loop must never drive a state update 60 times a second.
      if (playing && committed) {
        const line = clawStatusLine(
          frame,
          committed.outcome,
          committed.target
            ? prizeName(committed.target.index, committed.target.tier)
            : null,
        );
        if (line != null && line !== statusRef.current) {
          statusRef.current = line;
          setSrLine(line);
        }
      }

      claw.renderer.render(claw.scene, claw.camera);
    },
    [reduced, prizeName],
  );

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
  useEffect(() => {
    requestRenderRef.current = requestRender;
  }, [requestRender]);

  /* ══════════════════════════════════════════════════════════════════
     Scene lifecycle
     ══════════════════════════════════════════════════════════════════ */

  const teardownScene = useCallback(() => {
    frameLoopRef.current?.destroy();
    frameLoopRef.current = null;
    disposePrizeClawScene(sceneRef.current);
    sceneRef.current = null;
  }, []);

  const handleContextLost = useCallback(() => {
    // Keep the round's money and the DOM read-out intact; only the picture is
    // gone. The textual cabinet below the stage becomes the whole game.
    frameLoopRef.current?.destroy();
    frameLoopRef.current = null;
    const claw = sceneRef.current;
    sceneRef.current = null;
    disposePrizeClawScene(claw);
    setWebglError(true);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || sceneRef.current || webglError) return;

    const quality =
      qualityRef.current ?? createMidwayQualityController({ game: "prize-claw" });
    qualityRef.current = quality;

    const claw = buildPrizeClawScene({
      canvas,
      theme: themeRef.current,
      quality,
      onPause: () => frameLoopRef.current?.stop(),
      onRestore: () => {
        sceneRef.current?.rig.refreshEnvironment();
        requestRender(500);
      },
      onContextLost: handleContextLost,
    });
    if (!claw) {
      setWebglError(true);
      return;
    }
    sceneRef.current = claw;
    const stopTierWatch = quality.onChange((tier) => {
      const current = sceneRef.current;
      if (!current) return;
      applyClawTier(current, tier);
      requestRender();
    });
    let firstFrame = true;
    frameLoopRef.current = createGameFrameLoop({
      // The server-banked outcome and pure timeline are wall-clock driven; the
      // runtime only owns wake/park scheduling and visibility lifecycle.
      simulate: () => undefined,
      render: (_alpha, frameInfo) => {
        drawFrame(frameInfo.nowMs);
        // A tier change waits while a drop is bought, aimed or falling.
        quality.hold(
          phaseRef.current === "arming" ||
            phaseRef.current === "armed" ||
            phaseRef.current === "dropping",
        );
        quality.frame(frameInfo.nowMs, frameInfo.deltaMs);
        if (firstFrame) {
          // The first frame is on screen: record it, then paint the grain.
          firstFrame = false;
          markMidwayFirstFrame("prize-claw", quality.tier());
          claw.deferred.start(() => requestRender());
        }
        const keepGoing =
          visibleRef.current &&
          !document.hidden &&
          (phaseRef.current === "armed" ||
            phaseRef.current === "dropping" ||
            claw.restless ||
            frameInfo.nowMs < activeUntilRef.current);
        if (!keepGoing) frameLoopRef.current?.stop();
      },
    });
    // The bed is built HERE, inside an effect, never during render — the
    // placement trigonometry can therefore never produce an SSR/CSR mismatch.
    populatePrizeBed(
      claw,
      shownRef.current.bed,
      themeRef.current,
      shownRef.current.prizes,
    );
    resetClawVisuals(claw);
    setNamePlate(claw, cabinetNameRef.current, themeRef.current);
    // The tags and the nameplate print in the site's faces; repaint them once
    // the faces have loaded.
    void document.fonts?.ready.then(() => {
      if (sceneRef.current !== claw) return;
      repaintPlates(claw, themeRef.current);
      setNamePlate(claw, cabinetNameRef.current, themeRef.current, true);
      requestRenderRef.current(300);
    });

    const rect = canvas.getBoundingClientRect();
    resizePrizeClawScene(claw, rect.width || 640, rect.height || 420);
    requestRender(500);

    return () => {
      stopTierWatch();
      teardownScene();
    };
  }, [drawFrame, handleContextLost, requestRender, teardownScene, webglError]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const observer = new ResizeObserver((entries) => {
      const claw = sceneRef.current;
      if (!claw) return;
      const box = entries[0]?.contentRect;
      if (!box) return;
      resizePrizeClawScene(claw, box.width, box.height);
      requestRender();
    });
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [requestRender]);

  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden) {
        frameLoopRef.current?.stop();
      } else {
        // The script is time-parameterised, so coming back just asks for the
        // frame at (now - startedAt). No catch-up, no drift.
        lastFrameRef.current = performance.now();
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
      if (clockRef.current) clearInterval(clockRef.current);
      for (const t of cueTimersRef.current) clearTimeout(t);
      cueTimersRef.current = [];
    },
    [],
  );

  /* ── the fascia nameplate prints the cabinet's name ── */
  useEffect(() => {
    const name = CLAW_CABINETS[cabinet].name.toLowerCase();
    cabinetNameRef.current = name;
    const claw = sceneRef.current;
    if (!claw) return;
    setNamePlate(claw, name, themeRef.current);
    requestRender();
  }, [cabinet, requestRender]);

  /* ══════════════════════════════════════════════════════════════════
     Aim
     ══════════════════════════════════════════════════════════════════ */

  const moveAim = useCallback(
    (x: number, z: number, cue = true) => {
      if (phaseRef.current !== "armed") return;
      const next = clampToBed(x, z);
      const prev = aimRef.current;
      if (next.x === prev.x && next.z === prev.z) return;
      aimRef.current = next;
      setAim(next);
      const now = performance.now();
      if (cue && now - hapticAtRef.current > 60) {
        hapticAtRef.current = now;
        playHaptic("tap");
      }
      requestRender(1800);
    },
    [requestRender],
  );

  const nudge = useCallback(
    (dx: number, dz: number) => {
      moveAim(aimRef.current.x + dx, aimRef.current.z + dz);
    },
    [moveAim],
  );

  /**
   * Screen space → bed space. The camera sits at -z looking +z, so
   * SCREEN-RIGHT IS WORLD -X; the negation happens here, once, and nowhere
   * else. Screen-down maps to the near edge of the bed.
   */
  const pointerToBed = useCallback(
    (clientX: number, clientY: number, lift: number) => {
      const stage = stageRef.current;
      if (!stage) return null;
      const rect = stage.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return null;
      const u = (clientX - rect.left) / rect.width; // 0 left → 1 right
      const v = (clientY - rect.top) / rect.height; // 0 top → 1 bottom
      // The bed occupies the middle band of the stage; the top strip is the
      // marquee and the bottom strip is the fascia. Screen-up is deeper into
      // the cabinet, so `lift` (world units) pushes the claw AWAY from the
      // finger, further up the screen.
      const vBed = (v - 0.24) / 0.62;
      return {
        x: -(u * 2 - 1) * CLAW_BED_X,
        z: CLAW_BED_Z1 - vBed * (CLAW_BED_Z1 - CLAW_BED_Z0) + lift,
      };
    },
    [],
  );

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (phaseRef.current !== "armed") return;
      draggingRef.current = true;
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // A stale pointer id can throw; dragging still works without capture.
      }
      const lift = event.pointerType === "touch" ? TOUCH_LIFT : 0;
      const p = pointerToBed(event.clientX, event.clientY, lift);
      if (p) moveAim(p.x, p.z);
    },
    [moveAim, pointerToBed],
  );

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (!draggingRef.current || phaseRef.current !== "armed") return;
      const fine = event.shiftKey ? 0.35 : 1;
      const lift = event.pointerType === "touch" ? TOUCH_LIFT : 0;
      const p = pointerToBed(event.clientX, event.clientY, lift);
      if (!p) return;
      if (fine === 1) {
        moveAim(p.x, p.z);
      } else {
        // Shift = fine mode: the claw follows a third of the way.
        moveAim(
          aimRef.current.x + (p.x - aimRef.current.x) * fine,
          aimRef.current.z + (p.z - aimRef.current.z) * fine,
        );
      }
    },
    [moveAim, pointerToBed],
  );

  const onPointerUp = useCallback(() => {
    // Lifting a finger NEVER commits — that would be a mis-tap tax on touch.
    draggingRef.current = false;
  }, []);

  /* ══════════════════════════════════════════════════════════════════
     Round finish
     ══════════════════════════════════════════════════════════════════ */

  const finishRound = useCallback(() => {
    const committed = committedRef.current;
    if (!committed) return;
    if (finishTimerRef.current) {
      clearTimeout(finishTimerRef.current);
      finishTimerRef.current = null;
    }
    clearCueTimers();
    phaseRef.current = "result";
    setPhase("result");
    setRound(committed);
    setRevealedSeed(committed.seed);

    const line =
      committed.outcome === "won"
        ? `${committed.target ? capitalise(prizeName(committed.target.index, committed.target.tier)) : "The prize"} down the chute. ${committed.payout.toLocaleString()} tickets.`
        : `${OUTCOME_LINE[committed.outcome]}. ${committed.wager.toLocaleString()} tickets lost.`;
    statusRef.current = line;
    setSrLine(line);

    if (committed.outcome === "won") {
      SoundManager.play("clawDoorFlap");
      triggerFeedback("cashout");
      playHaptic("success");
      const tier = committed.target?.tier;
      if (tier === "D" || tier === "E") {
        SoundManager.play("coinStreakMilestone");
      }
    } else {
      if (committed.outcome === "slipped") SoundManager.play("clawSlip");
      triggerFeedback("loss");
      playHaptic("failure");
    }

    void refreshWallet();
    requestRender(600);
  }, [
    clearCueTimers,
    prizeName,
    refreshWallet,
    requestRender,
    setRevealedSeed,
    triggerFeedback,
  ]);

  /* ══════════════════════════════════════════════════════════════════
     Commit the drop
     ══════════════════════════════════════════════════════════════════ */

  const commitDrop = useCallback(async () => {
    if (phaseRef.current !== "armed") return;
    const currentBed = bedRef.current;
    if (!currentBed) return;

    if (clockRef.current) {
      clearInterval(clockRef.current);
      clockRef.current = null;
    }
    phaseRef.current = "dropping";
    setPhase("dropping");
    setError(null);
    SoundManager.unlock();
    SoundManager.play("arcadeBet");
    playHaptic("medium");
    requestRender(900);

    // TWO FLOATS AND NOTHING ELSE.
    const point = clampToBed(aimRef.current.x, aimRef.current.z);
    const stake = stakeRef.current;

    let data: DropResponse | null = null;
    let definitiveRejection = false;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const res = await sessionAction<DropResponse>("drop", {
          data: { x: point.x, z: point.z },
        });
        if (res.ok) {
          data = res.data;
          break;
        }
        if (res.status >= 400 && res.status < 500) {
          definitiveRejection = true;
          break;
        }
        // A server failure can happen after the choice or settlement commits.
        // Retry the same immutable point so the recovery/replay branch answers.
        if (attempt < 2) {
          await new Promise((resolve) => setTimeout(resolve, 800));
        }
      } catch {
        // Network failure. The handler is idempotent (an already-settled drop
        // replays instead of erroring), so retrying the SAME point is safe.
        if (attempt < 2) {
          await new Promise((resolve) => setTimeout(resolve, 800));
        }
      }
    }

    if (!data) {
      let refunded = false;
      if (definitiveRejection) {
        try {
          const refund = await settleSession<{ refunded?: boolean }>();
          refunded = refund.ok && refund.data.refunded === true;
        } catch {
          // Wallet/history refresh below is the final reconciliation source.
        }
      }
      phaseRef.current = "result";
      setPhase("result");
      // The notice is an alert, so the screen-reader line stays quiet.
      setError(
        refunded
          ? "The drop did not go through, so your bet came back."
          : definitiveRejection
            ? "The drop did not go through, and your balance may take a minute to update."
            : "The result did not arrive, and your balance will update in a minute.",
      );
      statusRef.current = "";
      setSrLine("");
      void refreshWallet();
      return;
    }

    const committed: CommittedRound = { ...data, wager: stake };
    committedRef.current = committed;

    const useReduced = prefersReducedMotion();
    const timeline = buildClawTimeline(committed.script, useReduced);
    timelineRef.current = timeline;
    lastPhaseRef.current = "armed";
    startedAtRef.current = performance.now();
    lastFrameRef.current = startedAtRef.current;
    requestRender(timeline.totalMs + 500);

    // A slip is a scheduled beat, not a frame-loop guess, so it still lands if
    // frames are being throttled.
    if (timeline.slipAtMs != null) {
      cueTimersRef.current.push(
        setTimeout(() => {
          SoundManager.play("clawSlip");
          playHaptic("failure");
        }, timeline.slipAtMs),
      );
    }

    // Belt and braces: even with the tab hidden for the whole drop (so no
    // animation frames run at all), the round still resolves in the DOM on
    // time and the plate appears.
    if (finishTimerRef.current) clearTimeout(finishTimerRef.current);
    finishTimerRef.current = setTimeout(finishRound, timeline.totalMs + 40);
  }, [
    finishRound,
    refreshWallet,
    requestRender,
    sessionAction,
    settleSession,
  ]);

  const commitDropRef = useRef(commitDrop);
  useEffect(() => {
    commitDropRef.current = commitDrop;
  }, [commitDrop]);

  /* ══════════════════════════════════════════════════════════════════
     Buy a drop
     ══════════════════════════════════════════════════════════════════ */

  const buyDrop = useCallback(async () => {
    if (phaseRef.current === "arming" || phaseRef.current === "armed") return;
    if (phaseRef.current === "dropping") return;
    if (balance == null) return;
    if (!Number.isFinite(wager) || wager < ARCADE_MIN_BET) {
      setError(`The smallest bet is ${ARCADE_MIN_BET} tickets.`);
      return;
    }
    if (wager > balance) {
      setError(`You need ${wager} tickets for this bet.`);
      return;
    }

    setError(null);
    setNotice(null);
    setRound(null);
    committedRef.current = null;
    timelineRef.current = null;
    clearCueTimers();
    phaseRef.current = "arming";
    setPhase("arming");
    statusRef.current = "";
    setSrLine("");
    SoundManager.unlock();
    playHaptic("light");

    // The receipt's stake is the one this round was bought with.
    stakeRef.current = wager;

    // Optimistic debit so the wallet reads honestly while the bed loads.
    adjustCredits(-wager);

    try {
      const session = await startSession(wager, { cabinet });
      if (!session.ok)
        throw new Error(machineError(session.error, "The bet did not go through. Try again."));

      // The create response carries the PUBLIC bedSeed and NOTHING about the
      // outcome — the session seed stays on the server until settle.
      const config = session.data.config as {
        cabinet?: ClawCabinetId;
        bedSeed?: number;
      };
      const seedValue = Number(config?.bedSeed);
      const cab = config?.cabinet ?? cabinet;
      if (!Number.isFinite(seedValue)) {
        throw new Error("The prizes did not load. Try again.");
      }

      // Built with the SAME pure function the server resolves against, so the
      // grip percentage shown below is exactly the one that will be rolled.
      const nextBed = generatePrizeBed(seedValue, cab);
      bedRef.current = nextBed;
      setBed(nextBed);

      // Park the claw over the best clear prize so a player who does nothing
      // still gets a fair drop rather than bare felt.
      let opening =
        nextBed.prizes.find((p) => p.exposure === "clear") ?? nextBed.prizes[0];
      for (const prize of nextBed.prizes) {
        if (prize.exposure !== "clear" || !opening) continue;
        if (
          CLAW_TIERS[prize.tier].multiplier >
          CLAW_TIERS[opening.tier].multiplier
        ) {
          opening = prize;
        }
      }
      const start = opening
        ? { x: opening.x, z: opening.z }
        : { x: 0, z: BED_MID_Z };
      aimRef.current = start;
      smoothAimRef.current = { ...CLAW_HOME };
      setAim(start);

      phaseRef.current = "armed";
      setPhase("armed");
      setRevealedSeed(null);
      requestRender(900);

      // The 12-second clock is CLIENT-SIDE PACING ONLY. It is never sent, and
      // running out AUTO-COMMITS from the current position — a timeout that
      // voided the wager would be a dark pattern.
      commitDeadlineRef.current = performance.now() + CLAW_COMMIT_MS;
      setSecondsLeft(CLAW_COMMIT_MS / 1000);
      if (clockRef.current) clearInterval(clockRef.current);
      clockRef.current = setInterval(() => {
        const left = Math.max(
          0,
          (commitDeadlineRef.current - performance.now()) / 1000,
        );
        setSecondsLeft(left);
        if (left <= 3 && left > 0) playHaptic("tap");
        if (left <= 0) {
          if (clockRef.current) clearInterval(clockRef.current);
          clockRef.current = null;
          void commitDropRef.current();
        }
      }, 250);
    } catch (err) {
      phaseRef.current = "idle";
      setPhase("idle");
      setBed(null);
      bedRef.current = null;
      resetSession();
      setError(
        err instanceof Error && err.message !== "Failed to fetch"
          ? err.message
          : "The connection dropped. Try again.",
      );
      void refreshWallet();
    }
  }, [
    adjustCredits,
    cabinet,
    clearCueTimers,
    refreshWallet,
    requestRender,
    resetSession,
    setRevealedSeed,
    startSession,
    wager,
    balance,
  ]);

  /* ── back out before the drop (no choice recorded → full refund) ── */

  const backOut = useCallback(async () => {
    if (phaseRef.current !== "armed") return;
    if (clockRef.current) {
      clearInterval(clockRef.current);
      clockRef.current = null;
    }
    phaseRef.current = "idle";
    setPhase("idle");
    try {
      const res = await settleSession<{ refunded?: boolean }>();
      if (!res.ok) throw new Error("refund");
      setNotice(`Your ${stakeRef.current.toLocaleString()} tickets came back.`);
    } catch {
      setError("The refund did not go through, so check your balance in a minute.");
    } finally {
      setBed(null);
      bedRef.current = null;
      resetSession();
      void refreshWallet();
      requestRender();
    }
  }, [refreshWallet, requestRender, resetSession, settleSession]);

  /* ══════════════════════════════════════════════════════════════════
     Keyboard parity — every pointer path has one
     ══════════════════════════════════════════════════════════════════ */

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (blocksGameKeyboard(e.target)) return;
      const step = e.shiftKey ? NUDGE_FINE : NUDGE;

      if (phaseRef.current === "armed") {
        switch (e.key) {
          case "ArrowLeft":
            e.preventDefault();
            // Screen-left is world +x — the same single negation as the pointer.
            nudge(step, 0);
            return;
          case "ArrowRight":
            e.preventDefault();
            nudge(-step, 0);
            return;
          case "ArrowUp":
            e.preventDefault();
            nudge(0, step);
            return;
          case "ArrowDown":
            e.preventDefault();
            nudge(0, -step);
            return;
          case " ":
          case "Enter":
            e.preventDefault();
            void commitDropRef.current();
            return;
          default:
            return;
        }
      }

      if (
        (e.key === " " || e.key === "Enter") &&
        (phaseRef.current === "idle" || phaseRef.current === "result")
      ) {
        e.preventDefault();
        void buyDrop();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [buyDrop, nudge]);

  const onStageKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLDivElement>) => {
      // The window handler owns every game key; the stage only needs to stop
      // the browser from scrolling underneath it.
      if (
        e.key === " " ||
        e.key === "ArrowLeft" ||
        e.key === "ArrowRight" ||
        e.key === "ArrowUp" ||
        e.key === "ArrowDown"
      ) {
        e.preventDefault();
      }
    },
    [],
  );

  /* ══════════════════════════════════════════════════════════════════
     Derived view data
     ══════════════════════════════════════════════════════════════════ */

  const stockedTiers = useMemo(() => clawCabinetTiers(cabinet), [cabinet]);
  const settled = phase === "idle" || phase === "result";
  const canBuy =
    settled && balance != null && wager >= ARCADE_MIN_BET && wager <= balance;
  const urgent = phase === "armed" && secondsLeft <= 3;

  /* ── the glass: the rule, and each tag's best chance, best first ── */

  const payRows = clawGripTable(stockedTiers).reverse();
  const glass = (
    <MachineGlass
      name="prize claw"
      rules={["Drop the claw on a prize. It pays your bet times its tag."]}
      paytable={payRows.map((row) => ({
        label: `up to ${fmtPct(row.win)} chance`,
        value: `${fmtMult(row.multiplier)}×`,
        lit:
          phase === "result" &&
          round?.outcome === "won" &&
          round.target?.tier === row.id,
      }))}
    />
  );

  /* ── what is under the claw, while the player aims ── */

  const hoverName = hoverPrize ? prizeName(hoverPrize.index, hoverPrize.tier) : null;
  const hoverChance = liveAim?.target ? fmtPct(liveAim.winChance) : "0%";
  const aimLine =
    phase === "armed" && liveAim
      ? hoverName && hoverTier
        ? `${capitalise(hoverName)}, pays ${fmtMult(hoverTier.multiplier)} times, ${hoverChance} chance.`
        : "Bare felt, 0% chance."
      : "";

  /* ── the screen: the cabinet, then what is under the claw ── */

  const screen = (
    <div className="pc-screen">
      <div
        ref={stageRef}
        className="pc-stage pc-viewport"
        role="application"
        tabIndex={0}
        aria-label={
          phase === "armed"
            ? "prize claw cabinet. Drag or use the arrow keys to move the claw, and press space to drop."
            : "prize claw cabinet"
        }
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onKeyDown={onStageKeyDown}
      >
        {webglError ? null : <canvas ref={canvasRef} className="pc-canvas" />}

        {webglError ? (
          <MidwayStill
            game="prize-claw"
            alt="The prize claw cabinet: a glass case on a walnut base, with a brass gantry and a three-finger claw over green felt."
            line="This browser can't draw the claw, so the prizes are listed here."
            className="absolute inset-0"
          >
            <div className="w-full max-w-sm space-y-3 text-center">
              <FallbackBed
                bed={bed}
                aim={aim}
                targetIndex={round?.target?.index ?? null}
                nameOf={prizeName}
              />
            </div>
          </MidwayStill>
        ) : null}

        {phase === "armed" && liveAim ? (
          <div className="pc-readout" aria-hidden="true">
            <span className="pc-readout-name">{hoverName ?? "bare felt"}</span>
            {hoverTier ? (
              <span className="pc-readout-stat">
                <Num value={`${fmtMult(hoverTier.multiplier)}×`} />
                <span>pays</span>
              </span>
            ) : null}
            <span className="pc-readout-stat">
              <Num value={hoverChance} />
              <span>chance</span>
            </span>
            <span className="pc-readout-stat" data-urgent={urgent || undefined}>
              <Num value={String(Math.ceil(secondsLeft))} />
              <span>sec</span>
            </span>
          </div>
        ) : notice && phase === "idle" ? (
          <p className="pc-readout pc-readout-note">{notice}</p>
        ) : null}
      </div>

      <p aria-live="polite" aria-atomic="true" className="sr-only">
        {phase === "armed" ? aimLine : srLine}
      </p>
    </div>
  );

  const action =
    phase === "armed" ? (
      <>
        <MachineButton
          onClick={() => void commitDropRef.current()}
          aria-label={
            hoverName
              ? `drop on the ${hoverName}, ${hoverChance} chance`
              : "drop on bare felt"
          }
        >
          drop
        </MachineButton>
        <MachineButton
          second
          onClick={() => void backOut()}
          aria-label="back out and get your bet back"
        >
          back out
        </MachineButton>
      </>
    ) : (
      <MachineButton
        onClick={() => void buyDrop()}
        disabled={settled && !canBuy}
        aria-disabled={!settled || undefined}
        aria-label={`play, ${wager} tickets`}
      >
        play
      </MachineButton>
    );

  const receipt =
    round && phase === "result" ? (
      <ArcadeWagerResultPlate
        result={{
          payout: round.payout,
          stake: round.wager,
          multiplier: round.multiplier,
          jackpot: round.outcome === "won" && round.multiplier >= 25,
        }}
        kicker="prize claw"
        headline={`${round.outcome === "won" ? fmtMult(round.multiplier) : 0}×`}
        detail={
          round.target ? (
            <>
              {OUTCOME_LINE[round.outcome].toLowerCase()}
              <br />
              {`${prizeName(round.target.index, round.target.tier)}, ${fmtPct(round.grip * round.holdChance)} chance`}
            </>
          ) : (
            OUTCOME_LINE[round.outcome].toLowerCase()
          )
        }
        fairness={{ seedHash: null, revealedSeed: round.seed }}
        achievements={achievements}
        roundId={round.roundId ?? undefined}
        sound={false}
      />
    ) : null;

  return (
    <GameShell
      game="prize-claw"
      className="prize-claw-midway"
      howTo={HOW_TO}
    >
      <ArcadeMachine
        name="prize claw"
        glass={glass}
        action={action}
        bet={{
          value: wager,
          onChange: setWager,
          balance,
          disabled: !settled,
        }}
        controls={
          <MachineChoice
            label="cabinet"
            options={CABINET_OPTIONS}
            value={cabinet}
            onChange={(next) => {
              if (!settled) return;
              setNotice(null);
              setCabinet(next);
              SoundManager.play("arcadeTick");
            }}
            disabled={!settled}
          />
        }
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
   Textual bed — the WebGL fallback, and the accessible mirror
   ══════════════════════════════════════════════════════════════════════ */

function FallbackBed({
  bed,
  aim,
  targetIndex,
  nameOf,
}: {
  bed: PrizeBed | null;
  aim: { x: number; z: number };
  targetIndex: number | null;
  nameOf: (index: number, tier: ClawTierId) => string;
}) {
  if (!bed) {
    return (
      <div className="pc-fallback-item p-4">
        Press play to see the prizes.
      </div>
    );
  }
  return (
    <div className="p-1">
      <ul className="pc-fallback" aria-label="prizes on the bed">
        {bed.prizes.map((prize) => {
          const tier = CLAW_TIERS[prize.tier];
          const distance = Math.hypot(prize.x - aim.x, prize.z - aim.z);
          const under = distance <= CLAW_R_GRIP;
          return (
            <li
              key={prize.index}
              className="pc-fallback-item"
              data-under={under || undefined}
              data-target={prize.index === targetIndex || undefined}
            >
              <span className="font-bold" aria-hidden="true">{nameOf(prize.index, prize.tier)}</span>
              <span className="text-tixy-on-ink-2" aria-hidden="true">
                {CLAW_EXPOSURE_LABELS[prize.exposure].toLowerCase()},{" "}
                {fmtMult(tier.multiplier)}×
              </span>
              <span className="sr-only">
                {`${nameOf(prize.index, prize.tier)}, ${CLAW_EXPOSURE_LABELS[prize.exposure].toLowerCase()}, pays ${fmtMult(tier.multiplier)} times, ${distance.toFixed(2)} units from the claw.${under ? " The claw is over it." : ""}`}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
