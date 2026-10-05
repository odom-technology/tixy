"use client";

import {
  useState,
  useCallback,
  useEffect,
  useMemo,
  useRef,
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
  MachineGlass,
  machineError,
  useMachineBet,
  useMachineKey,
} from "@/features/arcade/components/wagers/arcade-machine";
import { ArcadeWagerResultPlate } from "@/features/arcade/components/results/arcade-run-result";
import { ArcadeStub } from "@/features/arcade/components/ui/arcade-ui";
import { useGameFeedback } from "@/features/arcade/lib/use-game-feedback";
import { SoundManager } from "@/features/arcade/lib/sound-manager";
import { playHaptic } from "@/features/arcade/lib/game-haptics";
import { useWagerSession } from "@/features/arcade/lib/use-wager-session";
import { ARCADE_MIN_BET } from "@/server/arcade/arcade-constants";
import {
  GEM_COLORS,
  GEM_ROLL_COUNT,
  GEM_PATTERNS,
  GEM_PATTERN_LABELS,
  GEM_ROLL_PAYOUTS,
  type GemColor,
  type GemPattern,
} from "@/server/arcade/wager-games/gem-roll";
import {
  DEFAULT_GEM_ROLL_THEME,
  buildGemRollTheme,
  type GemRollTheme,
} from "./_gem-roll-theme";

type InventoryEquipResponse = {
  equipped?: Array<{
    slot?: string;
    item?: { assetRef?: Record<string, unknown> | null } | null;
  }>;
};

/* ========================================================================== */
/*  Helpers                                                                    */
/* ========================================================================== */

// Each gem is a reel: a strip of gems that scrolls past a window, speeds up,
// runs at full speed, then brakes onto the rolled gem, left to right. The
// position is a number sampled every frame, so the motion is continuous at
// any refresh rate. Presentation only; the roll is settled by the server.
const REEL_CELLS = 12; // gems printed on each reel's strip
const SPIN_SPEED = 10; // gems per second at full speed
const SPIN_UP_MS = 260; // from standing to full speed
const MIN_SPIN_MS = 640; // every reel runs at least this long before one brakes
const STOP_GAP_MS = 330; // between one reel braking and the next
const BRAKE_MS = 460; // a reel brakes over about this long
const SETTLE_MS = 150; // the dip past the gem and back
const SETTLE_DIP = 0.1; // how far past the gem, in gems

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

function fmtMult(m: number): string {
  return Number.isInteger(m)
    ? String(m)
    : m.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

/** What a reel does: rest on a gem, run, brake onto the rolled gem, or dip
 *  past it and come back. `p0` is where the move began, in gems along the
 *  strip, and `t0` is when. */
type ReelRun = {
  mode: "rest" | "spin" | "brake" | "settle";
  t0: number;
  p0: number;
  /** Brake and settle: the strip position the reel lands on. */
  land: number;
  /** Brake: how long the brake takes. */
  brakeMs: number;
};

/** The gems printed on a reel's strip. Fixed, so the server and the client
 *  paint the same page; neighbours always differ, and so do the strips of
 *  neighbouring reels. */
function initialStrip(reel: number): GemColor[] {
  return Array.from(
    { length: REEL_CELLS },
    (_, k) => GEM_COLORS[(k * 5 + reel * 3) % GEM_COLORS.length]!,
  );
}

/** Where a reel is, in gems along its strip, at time `now`. */
function reelPosition(run: ReelRun, now: number): number {
  const t = Math.max(0, now - run.t0) / 1000;
  switch (run.mode) {
    case "rest":
      return run.p0;
    case "spin": {
      const up = SPIN_UP_MS / 1000;
      return (
        run.p0 +
        (t < up ? (SPIN_SPEED * t * t) / (2 * up) : SPIN_SPEED * (t - up / 2))
      );
    }
    case "brake": {
      // Constant braking from full speed to a stop exactly on `land`.
      const total = run.brakeMs / 1000;
      const u = Math.min(t, total);
      return run.p0 + SPIN_SPEED * u - (SPIN_SPEED * u * u) / (2 * total);
    }
    case "settle": {
      const u = Math.min(1, t / (SETTLE_MS / 1000));
      return run.land + SETTLE_DIP * Math.sin(Math.PI * u);
    }
  }
}

const HOW_TO: GameHowTo = {
  lines: [
    "Press roll to drop five gems in seven colours.",
    "Matching colours make a pattern like a poker hand, and five different colours pay nothing.",
    "One pair pays 0.5×, half your bet back. Three of a kind pays 2.5× and five of a kind 49.89×.",
  ],
};

/** A pattern's name for the machine: lowercase. */
function patternName(pattern: GemPattern): string {
  return GEM_PATTERN_LABELS[pattern].toLowerCase();
}

/* ========================================================================== */
/*  Component                                                                   */
/* ========================================================================== */

export default function GemRollClient() {
  const { trigger: triggerFeedback } = useGameFeedback();
  const {
    wallet,
    loaded: walletLoaded,
    refresh: refreshWallet,
    adjustCredits,
  } = useGamesWallet();
  const balance = walletLoaded ? wallet.credits : null;
  const [error, setError] = useState<string | null>(null);
  const [isRolling, setIsRolling] = useState(false);
  const [wager, setWager] = useMachineBet(balance, 10, { locked: isRolling });
  const [roundId, setRoundId] = useState<string | null>(null);

  // The five reels. Each strip is state because the rolled gem is printed on
  // it just before the reel brakes; the position is sampled by the frame loop
  // and written straight to the DOM.
  const [strips, setStrips] = useState<GemColor[][]>(() =>
    Array.from({ length: GEM_ROLL_COUNT }, (_, i) => initialStrip(i)),
  );
  const [started, setStarted] = useState(false); // false until the first roll
  const [landed, setLanded] = useState(0); // reels that have stopped this roll

  // Settled result.
  const [resultGems, setResultGems] = useState<GemColor[] | null>(null);
  const [resultPattern, setResultPattern] = useState<GemPattern | null>(null);
  const [resultMult, setResultMult] = useState<number | null>(null);
  const [matchedColors, setMatchedColors] = useState<GemColor[]>([]);
  const [lastPayout, setLastPayout] = useState<number | null>(null);
  const [lastWager, setLastWager] = useState<number | null>(null);

  const stripEls = useRef<(HTMLDivElement | null)[]>([]);
  const runs = useRef<ReelRun[]>(
    Array.from({ length: GEM_ROLL_COUNT }, () => ({
      mode: "rest",
      t0: 0,
      p0: 0,
      land: 0,
      brakeMs: BRAKE_MS,
    })),
  );
  // When each reel starts braking, and onto which gem; null while the server
  // has not answered.
  const stopPlan = useRef<{ at: number; gem: GemColor }[] | null>(null);
  const frame = useRef<number | null>(null);
  const spinStart = useRef(0);
  const onSettled = useRef<(() => void) | null>(null);

  const [theme, setTheme] = useState<GemRollTheme>(DEFAULT_GEM_ROLL_THEME);

  const {
    revealedSeed,
    start: startSession,
    settle: settleSession,
    achievements,
  } = useWagerSession("arcade-gem-roll");

  const stopFrames = useCallback(() => {
    if (frame.current != null) cancelAnimationFrame(frame.current);
    frame.current = null;
    stopPlan.current = null;
  }, []);

  useEffect(() => stopFrames, [stopFrames]);

  // Load equipped cosmetics (best-effort); empty loadout keeps the default.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/store/inventory?gameType=gem-roll", {
          cache: "no-store",
        });
        if (!res.ok) return;
        const payload = (await res.json()) as InventoryEquipResponse;
        if (!cancelled) setTheme(buildGemRollTheme(payload.equipped ?? []));
      } catch {
        /* default theme stays */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const paintReel = useCallback((i: number, position: number) => {
    const el = stripEls.current[i];
    if (!el) return;
    const wrapped = ((position % REEL_CELLS) + REEL_CELLS) % REEL_CELLS;
    el.style.transform = `translate3d(0, ${(wrapped * 100).toFixed(3)}%, 0)`;
  }, []);

  /** Put `gem` on reel `i`'s strip at the gem that `land` points to. */
  const printGem = useCallback((i: number, land: number, gem: GemColor) => {
    setStrips((prev) =>
      prev.map((strip, r) =>
        r === i
          ? strip.map((g, k) => (k === land % REEL_CELLS ? gem : g))
          : strip,
      ),
    );
  }, []);

  // ─── The frame loop: every reel's position, every frame ────────────────
  const runFrames = useCallback(() => {
    const tick = (now: number) => {
      const plan = stopPlan.current;
      let allRest = true;
      for (let i = 0; i < GEM_ROLL_COUNT; i++) {
        const run = runs.current[i]!;
        if (run.mode === "spin" && plan && now >= plan[i]!.at) {
          // Brake onto the next whole gem far enough ahead to take BRAKE_MS.
          const p = reelPosition(run, now);
          const land = Math.ceil(p + (SPIN_SPEED * BRAKE_MS) / 2000);
          printGem(i, land, plan[i]!.gem);
          runs.current[i] = {
            mode: "brake",
            t0: now,
            p0: p,
            land,
            brakeMs: ((2 * (land - p)) / SPIN_SPEED) * 1000,
          };
        } else if (run.mode === "brake" && now - run.t0 >= run.brakeMs) {
          runs.current[i] = {
            ...run,
            mode: "settle",
            t0: run.t0 + run.brakeMs,
            p0: run.land,
          };
          setLanded((n) => n + 1);
          SoundManager.play("arcadeReelStop", { pitch: 1 + i * 0.06 });
          playHaptic("light");
        } else if (run.mode === "settle" && now - run.t0 >= SETTLE_MS) {
          runs.current[i] = { ...run, mode: "rest", p0: run.land };
        }
        const current = runs.current[i]!;
        paintReel(i, reelPosition(current, now));
        if (current.mode !== "rest") allRest = false;
      }
      if (allRest && plan) {
        frame.current = null;
        stopPlan.current = null;
        onSettled.current?.();
        return;
      }
      frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
  }, [paintReel, printGem]);

  // ─── Roll ──────────────────────────────────────────────────────────────
  const handleRoll = useCallback(async () => {
    if (isRolling) return;
    if (balance == null) return;
    if (wager < ARCADE_MIN_BET) {
      setError(`The smallest bet is ${ARCADE_MIN_BET} tickets.`);
      return;
    }
    if (wager > balance) {
      setError(`You need ${wager} tickets for this bet.`);
      return;
    }

    setError(null);
    setIsRolling(true);
    stopFrames();
    setStarted(true);
    setLanded(0);
    setResultGems(null);
    setResultPattern(null);
    setResultMult(null);
    setMatchedColors([]);
    setLastPayout(null);
    setRoundId(null);
    SoundManager.play("arcadeRoll");
    playHaptic("tap");

    // Optimistic debit.
    adjustCredits(-wager);

    const currentWager = wager;
    const reduced = prefersReducedMotion();

    // The reels start at once, on the click, and run until the server answers.
    const now = performance.now();
    spinStart.current = now;
    if (!reduced) {
      for (let i = 0; i < GEM_ROLL_COUNT; i++) {
        const run = runs.current[i]!;
        runs.current[i] = {
          mode: "spin",
          t0: now,
          p0: reelPosition(run, now),
          land: 0,
          brakeMs: BRAKE_MS,
        };
      }
      runFrames();
    }

    const fail = (message: string) => {
      stopFrames();
      const t = performance.now();
      for (let i = 0; i < GEM_ROLL_COUNT; i++) {
        const run = runs.current[i]!;
        const p = Math.round(reelPosition(run, t));
        runs.current[i] = { ...run, mode: "rest", p0: p, land: p };
        paintReel(i, p);
      }
      setError(message);
      void refreshWallet();
      setIsRolling(false);
    };

    try {
      const session = await startSession(currentWager);
      if (!session.ok) {
        fail(
          machineError(session.error, "The machine could not start the roll."),
        );
        return;
      }

      const settled = await settleSession<{
        seed: number;
        payout: number;
        multiplier: number;
        gems?: GemColor[];
        pattern?: GemPattern;
        matchedColors?: GemColor[];
        won?: boolean;
        roundId?: string | null;
      }>();
      if (!settled.ok) {
        fail(
          machineError(
            settled.error,
            "The roll did not go through. Try again.",
          ),
        );
        return;
      }
      const data = settled.data;

      const gems =
        Array.isArray(data.gems) && data.gems.length === GEM_ROLL_COUNT
          ? data.gems
          : Array.from(
              { length: GEM_ROLL_COUNT },
              () => GEM_COLORS[Math.floor(Math.random() * GEM_COLORS.length)]!,
            );
      const pattern = data.pattern ?? "bust";
      const mult = data.multiplier ?? GEM_ROLL_PAYOUTS[pattern];
      const matched = data.matchedColors ?? [];

      const finish = () => {
        setResultGems(gems);
        setResultPattern(pattern);
        setResultMult(mult);
        setMatchedColors(matched);
        setLastPayout(data.payout);
        setLastWager(currentWager);
        setRoundId(data.roundId ?? null);
        // Only a payout over the bet is a win; anything under it is part of
        // the stake gone.
        if (data.payout > currentWager) {
          SoundManager.play(mult >= 7 ? "arcadeBigWin" : "arcadeWin");
          playHaptic("success");
        } else {
          triggerFeedback("loss");
          playHaptic("failure");
        }
        void refreshWallet();
        setIsRolling(false);
      };

      if (reduced) {
        for (let i = 0; i < GEM_ROLL_COUNT; i++) {
          const land = Math.round(reelPosition(runs.current[i]!, now));
          printGem(i, land, gems[i]!);
          runs.current[i] = {
            mode: "rest",
            t0: now,
            p0: land,
            land,
            brakeMs: 0,
          };
          paintReel(i, land);
        }
        setLanded(GEM_ROLL_COUNT);
        finish();
        return;
      }

      // Reel one brakes once everything has run for MIN_SPIN_MS, then each
      // next reel a beat later.
      const first = Math.max(
        performance.now(),
        spinStart.current + MIN_SPIN_MS,
      );
      onSettled.current = finish;
      stopPlan.current = gems.map((gem, i) => ({
        at: first + i * STOP_GAP_MS,
        gem,
      }));
    } catch {
      fail("The machine lost its connection. Try again.");
    }
  }, [
    isRolling,
    wager,
    balance,
    adjustCredits,
    startSession,
    settleSession,
    refreshWallet,
    stopFrames,
    runFrames,
    paintReel,
    printGem,
    triggerFeedback,
  ]);

  // Space rolls.
  useMachineKey(isRolling ? null : () => void handleRoll());

  // ─── Computed ──────────────────────────────────────────────────────────
  const matchedSet = useMemo(() => new Set(matchedColors), [matchedColors]);
  const affordable = balance != null && wager <= balance;
  const settledStake = lastWager ?? wager;
  const payout = lastPayout ?? 0;
  const net = payout - settledStake;
  // Over the bet is the win, red with amber tickets. Under it is part of the
  // stake gone, and goes quiet like a bust.
  const tone =
    resultPattern == null || isRolling ? "idle" : net > 0 ? "win" : "loss";
  const dimMisses = tone !== "idle" && matchedColors.length > 0;

  const readoutMain = isRolling
    ? "rolling"
    : resultPattern != null
      ? patternName(resultPattern)
      : "roll five gems";
  const readoutSub = isRolling
    ? `${landed} of ${GEM_ROLL_COUNT} gems landed.`
    : resultPattern != null && resultMult != null
      ? net > 0
        ? `${fmtMult(resultMult)}× your bet of ${settledStake.toLocaleString()}. Paid ${payout.toLocaleString()}.`
        : payout > 0
          ? `${fmtMult(resultMult)}× pays ${payout.toLocaleString()}, ${(-net).toLocaleString()} less than your bet.`
          : `Five different colours. Bet of ${settledStake.toLocaleString()} lost.`
      : "Matching colours pay. Five different colours pay nothing.";

  const screen = (
    <div className="arc-machine-fit gr-well">
      <div className="gr-reels">
        {strips.map((strip, i) => {
          const gem = resultGems?.[i];
          const matched = gem != null && matchedSet.has(gem) && tone !== "idle";
          return (
            <div
              key={i}
              className="gr-reel"
              data-idle={!started || undefined}
              data-match={matched || undefined}
              data-dim={(dimMisses && !matched) || undefined}
              style={
                {
                  "--gr-socket": theme.socket,
                  "--gr-flare": theme.flare,
                } as CSSProperties
              }
            >
              <div className="gr-blank" aria-hidden>
                <GemJewel facet={null} />
              </div>
              <div
                className="gr-strip"
                ref={(el) => {
                  stripEls.current[i] = el;
                }}
                aria-hidden
              >
                {Array.from({ length: REEL_CELLS + 2 }, (_, n) => {
                  const e = n - 1; // -1 .. REEL_CELLS: the strip wraps
                  const color = strip[(e + REEL_CELLS) % REEL_CELLS]!;
                  return (
                    <div
                      key={e}
                      className="gr-cell"
                      style={{ top: `${-e * 100}%` }}
                    >
                      <div className="gr-gem">
                        <GemJewel facet={theme.gems[color]} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      <div className="gr-readout" data-tone={tone} role="status">
        <p className="gr-readout-main">{readoutMain}</p>
        <p className="gr-readout-sub">{readoutSub}</p>
        {tone === "win" ? (
          <ArcadeStub size="lg" className="gr-readout-side">
            +{net.toLocaleString()}
          </ArcadeStub>
        ) : tone === "loss" ? (
          <p className="gr-readout-side gr-readout-net">
            {`−${(-net).toLocaleString()}`}
          </p>
        ) : null}
      </div>

      <style jsx global>{`
        .arc-shell[data-game="gem-roll"] .arc-machine-frame:not([data-wide]) {
          --machine-screen-min: 20rem;
        }
        .gr-well {
          --gr-readout: 5.25rem;
          --gr-gap: clamp(6px, 1.6cqi, 16px);
          gap: 1rem;
          padding: 0.75rem;
          background: var(--screen-well);
        }
        @media (max-width: 39.999rem) {
          .gr-well {
            gap: 0.75rem;
            padding: 0.5rem;
          }
        }
        /* five reels across, as wide as the screen and its height allow */
        .gr-reels {
          display: grid;
          flex: none;
          grid-template-columns: repeat(5, minmax(0, 1fr));
          gap: var(--gr-gap);
          width: min(100%, (100cqh - var(--gr-readout) - 3rem) * 4.1);
        }
        .gr-reel {
          position: relative;
          aspect-ratio: 5 / 6;
          overflow: hidden;
          border-radius: clamp(8px, 2cqi, 16px);
          background: var(--gr-socket);
          transition: box-shadow var(--tixy-panel-fast) ease-out;
        }
        .gr-strip {
          position: absolute;
          inset: 0;
          will-change: transform;
        }
        .gr-cell {
          position: absolute;
          left: 0;
          width: 100%;
          height: 100%;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .gr-gem {
          width: 74%;
          transition:
            opacity var(--tixy-panel-slow) ease-out,
            transform var(--tixy-panel-slow) var(--tixy-ease-spring);
        }
        /* before the first roll: five empty sockets, no gems and no colours */
        .gr-blank {
          position: absolute;
          inset: 0;
          display: none;
          align-items: center;
          justify-content: center;
        }
        .gr-blank > svg {
          width: 74%;
          height: auto;
        }
        .gr-reel[data-idle] .gr-strip {
          visibility: hidden;
        }
        .gr-reel[data-idle] .gr-blank {
          display: flex;
        }
        /* the gems that match: ringed, and a little larger; the rest step back */
        .gr-reel[data-match] {
          box-shadow: inset 0 0 0 3px var(--gr-flare);
        }
        .gr-reel[data-match] .gr-gem {
          transform: scale(1.08);
        }
        .gr-reel[data-dim] .gr-gem {
          opacity: 0.35;
        }
        /* the readout: one plate, the same size in every state so the reels
           never move. Quiet on the screen; red when the roll paid more than
           the bet; an ink plate when it did not. */
        .gr-readout {
          display: grid;
          flex: none;
          grid-template-columns: minmax(0, 1fr) auto;
          grid-template-areas:
            "main side"
            "sub  side";
          align-items: center;
          column-gap: 1rem;
          box-sizing: border-box;
          width: min(100%, (100cqh - var(--gr-readout) - 3rem) * 4.1);
          height: var(--gr-readout);
          padding: 0.5rem 1rem;
          border-radius: var(--tixy-radius-panel-sm);
          color: var(--tixy-paper);
        }
        .gr-readout[data-tone="idle"] {
          padding-inline: 0;
        }
        .gr-readout[data-tone="win"] {
          background: var(--tixy-red);
          color: var(--tixy-on-red);
        }
        .gr-readout[data-tone="loss"] {
          background: var(--tixy-screen-2);
        }
        .gr-readout-main {
          grid-area: main;
          margin: 0;
          overflow: hidden;
          font-family: var(--tixy-font-num);
          font-size: clamp(1.75rem, 6cqi, 2.75rem);
          font-weight: var(--tixy-weight-num);
          line-height: 1;
          letter-spacing: var(--tixy-tracking-num);
          white-space: nowrap;
          text-overflow: ellipsis;
        }
        .gr-readout-sub {
          grid-area: sub;
          margin: 0.125rem 0 0;
          overflow: hidden;
          font-size: 0.9375rem;
          line-height: 1.25;
          color: var(--tixy-on-ink-2);
          white-space: nowrap;
          text-overflow: ellipsis;
        }
        .gr-readout[data-tone="win"] .gr-readout-sub {
          color: var(--tixy-on-red);
        }
        .gr-readout-side {
          grid-area: side;
        }
        .gr-readout-net {
          margin: 0;
          font-family: var(--tixy-font-num);
          font-size: clamp(1.75rem, 6cqi, 2.75rem);
          font-weight: var(--tixy-weight-num);
          line-height: 1;
          color: var(--tixy-on-ink-2);
        }
        /* a phone: three gems over two, each a third of the width, since five
           across would leave them small in a tall screen */
        @container (max-width: 34rem) {
          .gr-reels {
            display: flex;
            flex-wrap: wrap;
            justify-content: center;
            width: min(
              100%,
              26rem,
              (100cqh - var(--gr-readout) - 2.5rem) * 1.3
            );
          }
          .gr-reel {
            width: calc((100% - 2 * var(--gr-gap)) / 3);
            aspect-ratio: 1 / 1.1;
          }
          .gr-readout {
            width: min(
              100%,
              26rem,
              (100cqh - var(--gr-readout) - 2.5rem) * 1.3
            );
          }
        }
        @media (prefers-reduced-motion: no-preference) {
          .gr-readout[data-tone="win"],
          .gr-readout[data-tone="loss"] {
            animation: arc-stub-pop var(--motion-reveal) var(--ease-spring) both;
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .gr-gem,
          .gr-reel {
            transition: none;
          }
        }
      `}</style>
    </div>
  );

  const glass = (
    <MachineGlass
      name="gem roll"
      rules={[
        "Five gems in seven colours. Matching colours pay the pattern they form.",
      ]}
      paytable={GEM_PATTERNS.filter((pattern) => pattern !== "bust").map(
        (pattern) => ({
          label: patternName(pattern),
          value: `${fmtMult(GEM_ROLL_PAYOUTS[pattern])}×`,
          // Lit only for a roll that paid more than the bet.
          lit: tone === "win" && resultPattern === pattern,
        }),
      )}
    />
  );

  const action = (
    <MachineButton
      onClick={() => void handleRoll()}
      disabled={!affordable || wager < ARCADE_MIN_BET}
      aria-disabled={isRolling || undefined}
      aria-label={`roll, ${wager} tickets`}
    >
      roll
    </MachineButton>
  );

  const receipt =
    resultPattern != null && lastPayout != null && !isRolling ? (
      <ArcadeWagerResultPlate
        result={{
          payout: lastPayout,
          stake: settledStake,
          multiplier: resultMult,
        }}
        kicker="gem roll"
        headline={lastPayout > 0 ? `${fmtMult(resultMult ?? 0)}×` : "no match"}
        detail={
          lastPayout > 0
            ? matchedColors.length > 0
              ? `${patternName(resultPattern)}, ${matchedColors.join(" and ")}`
              : patternName(resultPattern)
            : "Five different gems."
        }
        fairness={{ seedHash: null, revealedSeed }}
        achievements={achievements}
        roundId={roundId ?? undefined}
        sound={false}
      />
    ) : null;

  return (
    <GameShell
      game="gem-roll"
      stat={
        <GameStat value={`${fmtMult(GEM_ROLL_PAYOUTS.five)}×`} label="top" />
      }
      howTo={HOW_TO}
    >
      <ArcadeMachine
        name="gem roll"
        glass={glass}
        action={action}
        bet={{ value: wager, onChange: setWager, balance, disabled: isRolling }}
        receipt={receipt}
        receiptKey={roundId}
        notice={error}
      >
        {screen}
      </ArcadeMachine>
    </GameShell>
  );
}

/* ========================================================================== */
/*  Jewel (SVG)                                                                 */
/* ========================================================================== */

/** A faceted gem. With no facet it is the empty socket's outline: the same
 *  shape in the screen's own tone, so the idle reels show where gems land
 *  without showing a colour. */
function GemJewel({ facet }: { facet: GemRollTheme["gems"][GemColor] | null }) {
  if (!facet) {
    return (
      <svg viewBox="0 0 100 100" width="100%" height="100%" aria-hidden>
        <polygon
          points="20,22 80,22 92,44 50,92 8,44"
          fill="none"
          stroke="var(--tixy-on-ink-3)"
          strokeWidth={4}
          strokeLinejoin="round"
          strokeDasharray="2 9"
          strokeLinecap="round"
          opacity={0.6}
        />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 100 100" width="100%" height="100%" aria-hidden>
      <polygon
        points="20,22 80,22 92,44 50,92 8,44"
        fill={facet.face}
        stroke={facet.edge}
        strokeWidth={5}
        strokeLinejoin="round"
      />
      {/* Table (crown) facet, brighter */}
      <polygon points="27,27 73,27 66,43 34,43" fill={facet.hi} />
      {/* Pavilion seams */}
      <path
        d="M8,44 L92,44 M34,43 L50,92 M66,43 L50,92"
        fill="none"
        stroke={facet.edge}
        strokeWidth={1.6}
        opacity={0.45}
      />
      {/* Spec highlight */}
      <polygon points="31,30 44,30 40,40 33,40" fill="#ffffff" opacity={0.25} />
    </svg>
  );
}
