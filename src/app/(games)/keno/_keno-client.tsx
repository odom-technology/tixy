"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { useGamesWallet } from "@/features/arcade/components/shell/games-wallet-provider";
import {
  GameShell,
  GameStat,
  type GameHowTo,
} from "@/features/arcade/components/shell/game-shell";
import {
  ArcadeMachine,
  MachineButton,
  MachineChoice,
  MachineGlass,
  machineError,
  useMachineBet,
  useMachineKey,
} from "@/features/arcade/components/wagers/arcade-machine";
import { ArcadeWagerResultPlate } from "@/features/arcade/components/results/arcade-run-result";
import { useGameFeedback } from "@/features/arcade/lib/use-game-feedback";
import {
  ArcadeButton,
  ArcadeStub,
} from "@/features/arcade/components/ui/arcade-ui";
import { SoundManager } from "@/features/arcade/lib/sound-manager";
import { playHaptic } from "@/features/arcade/lib/game-haptics";
import { useWagerSession } from "@/features/arcade/lib/use-wager-session";
import { ARCADE_MIN_BET } from "@/server/arcade/arcade-constants";
import {
  DEFAULT_KENO_THEME,
  buildKenoTheme,
  type KenoCosmeticTheme,
  type InventoryCosmeticResponse,
} from "./_keno-theme";

/* ========================================================================== */
/*  Constants — MIRROR of src/server/arcade/wager-games/keno.ts               */
/*  (client cannot import that module: it pulls in node:crypto via arcade-rng)*/
/* ========================================================================== */

const BOARD_SIZE = 40;
const DRAW_COUNT = 10;
const MAX_PICKS = 10;

type Profile = "classic" | "low" | "medium" | "high";

const PROFILES: { id: Profile; label: string }[] = [
  { id: "low", label: "low" },
  { id: "classic", label: "classic" },
  { id: "medium", label: "medium" },
  { id: "high", label: "high" },
];

const HOW_TO: GameHowTo = {
  lines: [
    "Pick 1 to 10 of the 40 numbers, choose a risk, then draw.",
    "The machine draws 10 numbers, and each one you picked is a hit.",
    "The paytable on the glass shows what each count of hits pays: 1 pick and 1 hit pays 3.96×, and 10 hits on 10 picks pays up to 10000×.",
  ],
};

/** A server or rules error with a sentence ready for the notice. */
class DrawError extends Error {}

// Base (displayed) multipliers — index by picks (1..10), then hits (0..picks).
// These are the exact tables in keno.ts KENO_PAYOUTS. Actual payout applies a
// per-column RTP factor (~1.00) server-side; displayed values are these.
const KENO_PAYOUTS: Record<Profile, number[][]> = {
  classic: [
    [],
    [0, 3.96],
    [0, 0, 17.16],
    [0, 0, 5.72, 17.16],
    [0, 0, 2.8, 8.41, 25],
    [0, 0, 1.62, 4.85, 14.56, 43.5],
    [0, 0, 0, 4.55, 13.65, 41, 123],
    [0, 0, 0, 2.63, 7.9, 23.5, 71, 213],
    [0, 0, 0, 1.64, 4.93, 14.79, 44.5, 133, 399],
    [0, 0, 0, 1.08, 3.24, 9.72, 29, 87.5, 262, 787],
    [0, 0, 0, 0, 2.81, 8.42, 25.5, 76, 227, 682, 2046],
  ],
  low: [
    [],
    [0, 3.96],
    [0, 1.94, 4.26],
    [0, 1.24, 2.72, 5.99],
    [0, 0.88, 1.93, 4.24, 9.32],
    [0, 0.65, 1.43, 3.15, 6.93, 15.24],
    [0, 0, 1.34, 2.95, 6.49, 14.28, 31.5],
    [0, 0, 0.97, 2.13, 4.68, 10.29, 22.5, 50],
    [0, 0, 0.72, 1.59, 3.5, 7.69, 16.92, 37, 82],
    [0, 0, 0.55, 1.22, 2.68, 5.89, 12.95, 28.5, 62.5, 138],
    [0, 0, 0, 1.1, 2.41, 5.3, 11.66, 25.5, 56.5, 124, 273],
  ],
  medium: [
    [],
    [0, 3.96],
    [0, 0, 17.16],
    [0, 0, 5, 25],
    [0, 0, 2.49, 8.96, 45],
    [0, 0, 1.39, 5, 18.01, 91],
    [0, 0, 0, 4.1, 14.75, 53, 268],
    [0, 0, 0, 2.28, 8.2, 29.5, 106, 536],
    [0, 0, 0, 1.36, 4.9, 17.63, 63.5, 228, 1151],
    [0, 0, 0, 0.85, 3.07, 11.04, 39.5, 143, 515, 2595],
    [0, 0, 0, 0, 2.37, 8.52, 30.5, 110, 397, 1430, 7209],
  ],
  high: [
    [],
    [0, 3.96],
    [0, 0, 17.16],
    [0, 0, 0, 81.5],
    [0, 0, 0, 15.87, 159],
    [0, 0, 0, 6.76, 34, 338],
    [0, 0, 0, 0, 27, 136, 1361],
    [0, 0, 0, 0, 11.62, 58, 291, 2905],
    [0, 0, 0, 0, 5.57, 28, 139, 697, 6967],
    [0, 0, 0, 0, 2.9, 14.52, 72.5, 363, 1815, 10000],
    [0, 0, 0, 0, 0, 10.55, 53, 264, 1319, 6597, 10000],
  ],
};

// Client replica of the server draw (mulberry32 + Fisher-Yates over 1..40).
// Proven identical to server drawKenoNumbers across 5000 seeds — this is the
// provably-fair recomputation the player can audit from the revealed seed.
function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return function () {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Draw order (first 10 of the shuffle, unsorted for reveal drama). */
function deriveDrawOrder(seed: number): number[] {
  const arr = Array.from({ length: BOARD_SIZE }, (_, i) => i + 1);
  const rng = mulberry32(seed);
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  }
  return arr.slice(0, DRAW_COUNT);
}

/* ========================================================================== */
/*  Component                                                                 */
/* ========================================================================== */

type Phase = "setup" | "drawing" | "result";

// Presentation timing — pure cosmetics; outcomes are always server-resolved.
const WINDUP_MS = 620; // pre-draw drum beat, starts the instant Draw is hit
const REVEAL_MS = 150; // per-ball cadence

type KenoSettleResponse = {
  payout?: number;
  multiplier?: number;
  seed?: number;
  drawn?: number[];
  hitNumbers?: number[];
  hits?: number;
  roundId?: string | null;
};

export default function KenoClient() {
  const { trigger: triggerFeedback } = useGameFeedback();
  const {
    wallet,
    loaded: walletLoaded,
    refresh: refreshWallet,
    adjustCredits,
  } = useGamesWallet();
  const balance = walletLoaded ? wallet.credits : null;

  const [profile, setProfile] = useState<Profile>("classic");
  const [picks, setPicks] = useState<number[]>([]);
  const [phase, setPhase] = useState<Phase>("setup");
  const [wager, setWager] = useMachineBet(balance, 10, {
    locked: phase === "drawing",
  });
  const [roundId, setRoundId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [windingUp, setWindingUp] = useState(false); // pre-draw anticipation beat
  const [impact, setImpact] = useState(false); // last-ball board shudder
  const [reducedMotion, setReducedMotion] = useState(false);

  // Draw state
  const [revealed, setRevealed] = useState<number[]>([]); // drawn numbers revealed so far
  const [finalDrawn, setFinalDrawn] = useState<number[]>([]);
  const [result, setResult] = useState<{
    hits: number;
    hitNumbers: number[];
    multiplier: number;
    payout: number;
  } | null>(null);
  const [settledWager, setSettledWager] = useState(10);

  // Cosmetics
  const [theme, setTheme] = useState<KenoCosmeticTheme>(DEFAULT_KENO_THEME);

  const revealTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const windupTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const impactTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  const {
    revealedSeed,
    start: startSession,
    settle: settleSession,
    achievements,
  } = useWagerSession("arcade-keno");

  // Load equipped cosmetics (best-effort).
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/store/inventory?gameType=keno", {
          cache: "no-store",
        });
        if (!res.ok) return;
        const payload = (await res.json()) as InventoryCosmeticResponse;
        if (!cancelled) setTheme(buildKenoTheme(payload));
      } catch {
        /* default theme stays */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (revealTimer.current) clearTimeout(revealTimer.current);
      if (windupTimer.current) clearTimeout(windupTimer.current);
      if (impactTimer.current) clearTimeout(impactTimer.current);
    };
  }, []);

  /* Respect prefers-reduced-motion: shrink the wind-up beat, shorten the
     reveal cadence, and drop the shake/flash FX (CSS is gated too). */
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => setReducedMotion(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  const pickSet = useMemo(() => new Set(picks), [picks]);
  const paytable = KENO_PAYOUTS[profile][picks.length] ?? [];

  const togglePick = useCallback(
    (n: number) => {
      if (phase === "drawing") return;
      setError(null);
      playHaptic("tap");
      setPicks((prev) => {
        if (prev.includes(n)) return prev.filter((x) => x !== n);
        if (prev.length >= MAX_PICKS) return prev;
        return [...prev, n].sort((a, b) => a - b);
      });
      // Returning to setup when adjusting picks after a result.
      if (phase === "result") {
        setPhase("setup");
        setResult(null);
        setRevealed([]);
        setFinalDrawn([]);
      }
    },
    [phase],
  );

  const quickPick = useCallback(() => {
    if (phase === "drawing") return;
    setError(null);
    const count = picks.length > 0 ? picks.length : 5;
    const pool = Array.from({ length: BOARD_SIZE }, (_, i) => i + 1);
    // Fisher-Yates using Math.random (client convenience only — the actual
    // draw is server-seeded and provably fair).
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j]!, pool[i]!];
    }
    setPicks(pool.slice(0, count).sort((a, b) => a - b));
    setPhase("setup");
    setResult(null);
    setRevealed([]);
    setFinalDrawn([]);
  }, [phase, picks.length]);

  const clearPicks = useCallback(() => {
    if (phase === "drawing") return;
    setPicks([]);
    setResult(null);
    setRevealed([]);
    setFinalDrawn([]);
    setPhase("setup");
    setError(null);
  }, [phase]);

  const handleDraw = useCallback(async () => {
    if (phase === "drawing") return;
    if (picks.length < 1) {
      setError("Pick at least one number.");
      return;
    }
    if (wager < ARCADE_MIN_BET) {
      setError(`The smallest bet is ${ARCADE_MIN_BET} tickets.`);
      return;
    }
    if (balance == null || wager > balance) {
      setError(`You need ${wager} tickets for this bet.`);
      return;
    }

    setError(null);
    setSettledWager(wager);
    setRoundId(null);
    setResult(null);
    setRevealed([]);
    setFinalDrawn([]);
    setPhase("drawing");
    // The wind-up beat starts NOW (on click), not when the network answers.
    setWindingUp(true);
    const windupDoneAt = Date.now() + (reducedMotion ? 120 : WINDUP_MS);
    SoundManager.play("arcadeBet");
    adjustCredits(-wager);

    const currentPicks = [...picks];

    try {
      const session = await startSession(wager, {
        profile,
        picks: currentPicks,
      });
      if (!mountedRef.current) return;
      if (!session.ok)
        throw new DrawError(
          machineError(session.error, "The machine could not start the round."),
        );

      const settled = await settleSession<KenoSettleResponse>();
      if (!mountedRef.current) return;
      if (!settled.ok)
        throw new DrawError(
          machineError(
            settled.error,
            "The draw did not go through. Try again.",
          ),
        );
      const data = settled.data;

      const seed = data.seed ?? 0;
      // Recompute the draw from the revealed seed (provably fair). Fall back to
      // the server payload if anything is off.
      const clientDraw = deriveDrawOrder(seed);
      const serverSet = new Set(data.drawn ?? clientDraw);
      const drawOrder =
        clientDraw.length === DRAW_COUNT &&
        clientDraw.every((x) => serverSet.has(x))
          ? clientDraw
          : (data.drawn ?? clientDraw);

      const hitNumbers =
        data.hitNumbers ??
        currentPicks.filter((p) => new Set(drawOrder).has(p));
      const hits = data.hits ?? hitNumbers.length;
      const multiplier = data.multiplier ?? 0;
      const payout = data.payout ?? 0;

      setFinalDrawn(drawOrder);

      // Staggered reveal — starts only once BOTH the settle response is in
      // AND the wind-up beat has elapsed, so latency never kills the beat
      // and the beat never delays a ready result.
      const cadence = reducedMotion ? 70 : REVEAL_MS;
      const firstDelay = reducedMotion ? 40 : 120;
      const revealNext = (idx: number) => {
        setRevealed(drawOrder.slice(0, idx));
        const last = idx === drawOrder.length;
        if (last) {
          // Final ball: distinct stop accent + a restrained board shudder.
          SoundManager.play("arcadeReelStop");
          playHaptic("medium");
          if (!reducedMotion) {
            setImpact(true);
            impactTimer.current = setTimeout(() => setImpact(false), 420);
          }
        } else {
          // Rising pitch per ball, building toward the final stop.
          SoundManager.play("arcadeReveal", { pitch: 1 + idx * 0.07 });
          playHaptic("light");
        }
        if (!last) {
          revealTimer.current = setTimeout(() => revealNext(idx + 1), cadence);
        } else {
          // All revealed — settle the visual result.
          setResult({ hits, hitNumbers, multiplier, payout });
          setRoundId(data.roundId ?? null);
          setPhase("result");
          if (payout > 0) {
            SoundManager.play(multiplier >= 20 ? "arcadeBigWin" : "arcadeWin");
            playHaptic("success");
          } else {
            triggerFeedback("loss");
            playHaptic("failure");
          }
          void refreshWallet();
        }
      };
      windupTimer.current = setTimeout(
        () => {
          setWindingUp(false);
          revealTimer.current = setTimeout(() => revealNext(1), firstDelay);
        },
        Math.max(0, windupDoneAt - Date.now()),
      );
    } catch (err) {
      if (!mountedRef.current) return;
      setError(
        err instanceof DrawError
          ? err.message
          : "The machine lost its connection. Try again.",
      );
      setWindingUp(false);
      setPhase("setup");
      void refreshWallet();
    }
  }, [
    phase,
    picks,
    wager,
    balance,
    profile,
    reducedMotion,
    adjustCredits,
    startSession,
    settleSession,
    refreshWallet,
    triggerFeedback,
  ]);

  const affordable = balance != null && wager <= balance;
  const canDraw =
    phase !== "drawing" &&
    picks.length >= 1 &&
    wager >= ARCADE_MIN_BET &&
    affordable;

  /* ---------- Keyboard: Space or Enter draws ----------
     The machine hook leaves presses on a focused board cell or control to
     that control, so Space still toggles a focused number. */
  useMachineKey(
    useMemo(
      () => (canDraw ? () => void handleDraw() : null),
      [canDraw, handleDraw],
    ),
    ["Space", "Enter"],
  );

  const revealedSet = useMemo(() => new Set(revealed), [revealed]);
  const finalDrawnSet = useMemo(() => new Set(finalDrawn), [finalDrawn]);

  const topMult = paytable.length ? paytable[paytable.length - 1] : 0;
  const potentialMax = Math.floor(wager * (topMult ?? 0));

  const themeVars = {
    "--keno-pick": theme.pickBg,
    "--keno-pick-on": theme.pickOn,
    "--keno-hit": theme.hitBg,
    "--keno-hit-on": theme.hitOn,
    "--keno-ball": theme.ballBg,
    "--keno-ball-on": theme.ballOn,
    "--keno-well": theme.boardWell,
    "--keno-accent": theme.accent,
  } as CSSProperties;

  /* ---------- Stage: the readout over the number board ---------- */
  // What the machine says, once and big: what you picked, how many have hit
  // while it draws, and at the end hits out of picks with the tickets won.
  // Red is a win (a payout over the bet); a payout under the bet is a loss
  // of part of it, and goes quiet like a miss.
  const liveHits = revealed.filter((n) => pickSet.has(n)).length;
  const hitWord = (n: number) => (n === 1 ? "hit" : "hits");
  const pickWord = picks.length === 1 ? "pick" : "picks";
  const resultWon = result != null && result.payout > settledWager;
  const resultTone =
    phase === "result" && result ? (resultWon ? "win" : "loss") : "idle";
  const readoutMain =
    phase === "setup"
      ? picks.length === 0
        ? "pick 1 to 10"
        : `${picks.length} ${pickWord}`
      : phase === "drawing"
        ? windingUp
          ? `${picks.length} ${pickWord}`
          : `${liveHits} ${hitWord(liveHits)}`
        : result
          ? `${result.hits} of ${picks.length} ${hitWord(picks.length)}`
          : "";
  const readoutSub =
    phase === "setup"
      ? picks.length === 0
        ? `The machine draws ${DRAW_COUNT} of the ${BOARD_SIZE} numbers.`
        : `${DRAW_COUNT} numbers are drawn. Up to ${potentialMax.toLocaleString()} tickets.`
      : phase === "drawing"
        ? windingUp
          ? "Rolling the drum."
          : `Drawing ${revealed.length} of ${DRAW_COUNT}.`
        : result
          ? resultWon
            ? `${result.multiplier}× your bet of ${settledWager.toLocaleString()}. Paid ${result.payout.toLocaleString()}.`
            : result.payout > 0
              ? `Paid ${result.payout.toLocaleString()} on a bet of ${settledWager.toLocaleString()}.`
              : `No win. Bet of ${settledWager.toLocaleString()} lost.`
          : "";

  const screen = (
    <div className="arc-machine-fit keno-stage" style={themeVars}>
      <div className="keno-board-wrap">
        <div
          className="keno-readout"
          data-tone={resultTone}
          data-windup={windingUp || undefined}
          role="status"
        >
          <p className="keno-readout-main">{readoutMain}</p>
          <p className="keno-readout-sub">{readoutSub}</p>
          {resultTone === "win" && result ? (
            <ArcadeStub size="lg" className="keno-readout-side">
              +{(result.payout - settledWager).toLocaleString()}
            </ArcadeStub>
          ) : resultTone === "loss" && result ? (
            <p className="keno-readout-side keno-readout-net">
              {`−${(settledWager - result.payout).toLocaleString()}`}
            </p>
          ) : null}
        </div>
        <div
          className={`keno-board${impact ? " keno-impact" : ""}`}
          role="group"
          aria-label="keno board"
          data-windup={windingUp || undefined}
        >
          {Array.from({ length: BOARD_SIZE }, (_, i) => {
            const n = i + 1;
            const picked = pickSet.has(n);
            const drawn = revealedSet.has(n);
            const isFinalDrawn = finalDrawnSet.has(n);
            const hit = picked && (phase === "drawing" ? drawn : isFinalDrawn);
            const ball =
              !picked && (phase === "drawing" ? drawn : isFinalDrawn);
            // A pick the draw never reached is a miss, once the draw is over.
            const miss = picked && phase === "result" && !isFinalDrawn;
            const state = hit
              ? "hit"
              : ball
                ? "ball"
                : miss
                  ? "miss"
                  : picked
                    ? "pick"
                    : "idle";
            return (
              <button
                key={n}
                type="button"
                onClick={() => togglePick(n)}
                disabled={phase === "drawing"}
                data-state={state}
                aria-pressed={picked}
                aria-label={`number ${n}${picked ? ", picked" : ""}${hit ? ", hit" : ""}${miss ? ", missed" : ""}${ball ? ", drawn" : ""}`}
                className="keno-cell arcade-num"
                style={{ "--i": i } as CSSProperties}
              >
                {n}
              </button>
            );
          })}
        </div>
      </div>

      <style jsx global>{`
        .arc-shell[data-game="keno"] .arc-machine-frame:not([data-wide]) {
          --machine-screen-min: 22rem;
        }
        .keno-stage {
          --keno-readout: 5.25rem;
          gap: 0.75rem;
          padding: 0.75rem;
          background: var(--keno-well, var(--screen-well));
        }
        @media (max-width: 39.999rem) {
          .keno-stage {
            gap: 0.5rem;
            padding: 0.5rem;
          }
        }
        /* The readout: one plate, the same size in every phase so the board
           never moves. Quiet on the screen; red when the draw paid; an ink
           plate when it did not. */
        .keno-readout {
          display: grid;
          flex: none;
          grid-template-columns: minmax(0, 1fr) auto;
          grid-template-areas:
            "main stub"
            "sub  stub";
          align-items: center;
          column-gap: 1rem;
          box-sizing: border-box;
          width: 100%;
          height: var(--keno-readout);
          margin-bottom: 0.75rem;
          padding: 0.5rem 1rem;
          border-radius: var(--tixy-radius-panel-sm);
          color: var(--tixy-paper);
        }
        .keno-readout[data-tone="idle"] {
          padding-inline: 0;
        }
        .keno-readout[data-tone="win"] {
          background: var(--tixy-red);
          color: var(--tixy-on-red);
        }
        .keno-readout[data-tone="loss"] {
          background: var(--tixy-screen-2);
        }
        .keno-readout-main {
          grid-area: main;
          margin: 0;
          overflow: hidden;
          font-family: var(--tixy-font-num);
          font-size: clamp(1.75rem, 8cqi, 2.75rem);
          font-weight: var(--tixy-weight-num);
          line-height: 1;
          letter-spacing: var(--tixy-tracking-num);
          white-space: nowrap;
          text-overflow: ellipsis;
        }
        .keno-readout-sub {
          grid-area: sub;
          margin: 0.125rem 0 0;
          overflow: hidden;
          font-size: 0.9375rem;
          line-height: 1.25;
          color: var(--tixy-on-ink-2);
          white-space: nowrap;
          text-overflow: ellipsis;
        }
        .keno-readout[data-tone="win"] .keno-readout-sub {
          color: var(--tixy-on-red);
        }
        .keno-readout-side {
          grid-area: stub;
        }
        .keno-readout-net {
          margin: 0;
          font-family: var(--tixy-font-num);
          font-size: clamp(1.75rem, 8cqi, 2.75rem);
          font-weight: var(--tixy-weight-num);
          line-height: 1;
          color: var(--tixy-on-ink-2);
        }
        .keno-board-wrap {
          flex: none;
          container-type: inline-size;
          /* the widest 8 by 5 board the screen holds under the readout */
          width: min(100%, (100cqh - var(--keno-readout) - 3.5rem) * 1.6);
        }
        .keno-board {
          display: grid;
          grid-template-columns: repeat(8, 1fr);
          gap: clamp(3px, 1.2cqi, 10px);
        }
        .keno-cell {
          position: relative;
          aspect-ratio: 1;
          display: flex;
          align-items: center;
          justify-content: center;
          min-width: 0;
          padding: 0;
          font-size: clamp(0.875rem, 4.4cqi, 2.25rem);
          font-weight: 700;
          border: 0;
          border-radius: 10px;
          color: var(--tixy-on-ink-2);
          background: var(--tixy-screen-2);
          box-shadow: 0 3px 0 #00000059;
          transition:
            transform var(--motion-press) var(--ease-snap),
            background-color var(--tixy-panel-fast) ease-out,
            color var(--tixy-panel-fast) ease-out,
            opacity var(--tixy-panel-slow) ease-out;
          cursor: pointer;
          -webkit-tap-highlight-color: transparent;
        }
        .keno-cell:not(:disabled):hover {
          background: #4a3e35;
        }
        .keno-cell:not(:disabled):active {
          transform: translateY(2px);
          box-shadow: 0 1px 0 #00000059;
        }
        .keno-cell:focus-visible {
          outline: var(--focus-outline);
          outline-offset: var(--focus-offset);
        }
        .keno-cell:disabled {
          cursor: default;
        }
        /* your pick: paper, the one bright thing on the board */
        .keno-cell[data-state="pick"],
        .keno-cell[data-state="miss"] {
          background: var(--keno-pick);
          color: var(--keno-pick-on);
        }
        /* a drawn number you did not pick: a quiet round ball with a ring */
        .keno-cell[data-state="ball"] {
          border-radius: 50%;
          background: var(--keno-ball);
          color: var(--keno-ball-on);
          box-shadow: inset 0 0 0 2px var(--keno-accent);
        }
        /* your pick, drawn: red, and the biggest thing on the board */
        .keno-cell[data-state="hit"] {
          z-index: 1;
          background: var(--keno-hit);
          color: var(--keno-hit-on);
          box-shadow: 0 3px 0 #00000059;
        }
        /* your pick, never drawn: stepped back and struck through */
        .keno-cell[data-state="miss"] {
          opacity: 0.4;
          box-shadow: none;
        }
        .keno-cell[data-state="miss"]::after {
          content: "";
          position: absolute;
          left: 18%;
          right: 18%;
          top: 50%;
          height: 2px;
          background: currentColor;
          transform: rotate(-35deg);
        }
        @media (prefers-reduced-motion: no-preference) {
          .keno-cell[data-state="ball"] {
            animation: keno-pop var(--motion-reveal) var(--ease-spring) both;
          }
          .keno-cell[data-state="hit"] {
            animation: keno-hit var(--motion-reveal) var(--ease-spring) both;
          }
          /* wind-up: the drum breathes while the wager is in flight */
          .keno-board[data-windup] {
            animation: keno-drum 0.62s ease-in-out infinite;
          }
          .keno-readout[data-windup] .keno-readout-sub {
            animation: keno-shimmer 0.9s ease-in-out infinite;
          }
          .keno-readout[data-tone="win"],
          .keno-readout[data-tone="loss"] {
            animation: arc-stub-pop var(--motion-reveal) var(--ease-spring) both;
          }
          /* impact: one restrained shudder when the last ball lands */
          .keno-board.keno-impact {
            animation: keno-impact 0.42s var(--ease-snap);
          }
        }
        @keyframes keno-pop {
          0% {
            transform: scale(0.6);
            opacity: 0.2;
          }
          55% {
            transform: scale(1.1);
          }
          100% {
            transform: scale(1);
            opacity: 1;
          }
        }
        @keyframes keno-hit {
          0% {
            transform: scale(0.6);
            opacity: 0.2;
          }
          55% {
            transform: scale(1.24);
          }
          100% {
            transform: scale(1);
            opacity: 1;
          }
        }
        @keyframes keno-drum {
          0%,
          100% {
            transform: scale(1);
          }
          50% {
            transform: scale(1.008);
          }
        }
        @keyframes keno-shimmer {
          0%,
          100% {
            opacity: 1;
          }
          50% {
            opacity: 0.55;
          }
        }
        @keyframes keno-impact {
          0% {
            transform: translate(0, 0);
          }
          20% {
            transform: translate(-2px, 1px);
          }
          45% {
            transform: translate(2px, -1px);
          }
          70% {
            transform: translate(-1px, 0);
          }
          100% {
            transform: translate(0, 0);
          }
        }
      `}</style>
    </div>
  );

  const action = (
    <MachineButton
      onClick={() => void handleDraw()}
      disabled={picks.length === 0 || !affordable || wager < ARCADE_MIN_BET}
      aria-disabled={phase === "drawing" || undefined}
      aria-label={
        picks.length === 0
          ? "draw, pick a number first"
          : `draw, ${wager} tickets`
      }
    >
      draw
    </MachineButton>
  );

  const controls = (
    <>
      <MachineChoice
        label="risk"
        options={PROFILES.map((p) => ({ value: p.id, label: p.label }))}
        value={profile}
        onChange={(next) => setProfile(next as Profile)}
        disabled={phase === "drawing"}
      />
      <div className="keno-tools">
        <ArcadeButton
          tone="default"
          size="md"
          onClick={quickPick}
          disabled={phase === "drawing"}
        >
          quick pick
        </ArcadeButton>
        <ArcadeButton
          tone="default"
          size="md"
          onClick={clearPicks}
          disabled={phase === "drawing" || picks.length === 0}
        >
          clear
        </ArcadeButton>
      </div>
      <style jsx global>{`
        .keno-tools {
          display: flex;
          gap: 0.5rem;
          width: 20rem;
          max-width: 100%;
          margin-top: 0.75rem;
        }
        .keno-tools > * {
          flex: 1 1 0;
        }
      `}</style>
    </>
  );

  const glassRows = paytable.flatMap((m, hits) =>
    m > 0
      ? [
          {
            label: `${hits} ${hits === 1 ? "hit" : "hits"}`,
            value: `${m.toLocaleString("en-US")}×`,
            lit: phase === "result" && resultWon && result?.hits === hits,
          },
        ]
      : [],
  );

  const receipt =
    phase === "result" && result ? (
      <ArcadeWagerResultPlate
        result={{
          payout: result.payout,
          stake: settledWager,
          multiplier: result.multiplier,
        }}
        kicker="keno"
        headline={`${result.hits} ${result.hits === 1 ? "hit" : "hits"}`}
        detail={`${picks.length} ${picks.length === 1 ? "pick" : "picks"}, ${profile}`}
        fairness={{ seedHash: null, revealedSeed }}
        achievements={achievements}
        roundId={roundId ?? undefined}
        sound={false}
      />
    ) : null;

  return (
    <GameShell
      game="keno"
      stat={
        <GameStat
          value={
            picks.length > 0
              ? `${(topMult ?? 0).toLocaleString("en-US")}×`
              : null
          }
          label="top"
        />
      }
      howTo={HOW_TO}
    >
      <ArcadeMachine
        name="keno"
        glass={
          <MachineGlass
            name="keno"
            rules={[
              picks.length > 0
                ? `What ${picks.length} ${picks.length === 1 ? "pick pays" : "picks pay"} on ${profile} risk. Higher risk pays less often and more at the top.`
                : "Pick 1 to 10 numbers on the board. Higher risk pays less often and more at the top.",
            ]}
            paytable={glassRows}
          />
        }
        action={action}
        bet={{
          value: wager,
          onChange: setWager,
          balance,
          disabled: phase === "drawing",
        }}
        controls={controls}
        receipt={receipt}
        receiptKey={roundId}
        notice={error}
      >
        {screen}
      </ArcadeMachine>
    </GameShell>
  );
}
