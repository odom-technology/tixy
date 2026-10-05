"use client";

import { useCallback, useMemo, useState } from "react";
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
import { ArcadeChip } from "@/features/arcade/components/ui/arcade-ui";
import { SoundManager } from "@/features/arcade/lib/sound-manager";
import { useWagerSession } from "@/features/arcade/lib/use-wager-session";
import { ARCADE_MIN_BET } from "@/server/arcade/arcade-constants";

/* ===========================================================================
 *  Types + difficulty model (mirrors src/server/arcade/wager-games/pump.ts)
 * ========================================================================= */

type GamePhase = "setup" | "playing" | "won" | "lost";
type Difficulty = "easy" | "medium" | "hard";

type PumpResponse = {
  alive?: boolean;
  pumpsCompleted?: number;
  currentMultiplier?: number;
  allPumpsCompleted?: boolean;
  completed?: boolean;
  payout?: number;
  seed?: number;
  roundId?: string | null;
};

const RTP = 0.97;
const MAX_MULT = 500;
const PUMP_MAX_PUMPS = 25;

type DifficultyDetail = {
  label: string;
  baseSurvival: number;
  ramp: number;
  floorSurvival: number;
};

const DIFFICULTY_DETAILS: Record<Difficulty, DifficultyDetail> = {
  easy: { label: "easy", baseSurvival: 0.99, ramp: 0.005, floorSurvival: 0.8 },
  medium: {
    label: "medium",
    baseSurvival: 0.92,
    ramp: 0.02,
    floorSurvival: 0.55,
  },
  hard: { label: "hard", baseSurvival: 0.8, ramp: 0.035, floorSurvival: 0.3 },
};

const DIFFICULTY_KEYS = Object.keys(DIFFICULTY_DETAILS) as Difficulty[];

/** The pump counts printed on the glass for the chosen difficulty. */
const GLASS_PUMPS = [1, 3, 6, 10, PUMP_MAX_PUMPS] as const;

const HOW_TO: GameHowTo = {
  lines: [
    "Pick a difficulty and a bet, press play, then pump the balloon up to 25 times.",
    "Any pump can pop it and take the bet; the risk starts at 1% on easy, 8% on medium or 20% on hard and grows with each pump.",
    "10 pumps pay 1.35× on easy, 6.4× on medium and 91.7× on hard, up to 500×.",
  ],
};

/** Survival probability for the pump at 0-based index `i`. */
function survivalProb(i: number, difficulty: Difficulty): number {
  const d = DIFFICULTY_DETAILS[difficulty];
  return Math.max(d.floorSurvival, Math.min(1, d.baseSurvival - d.ramp * i));
}

/** Pop probability for the pump at 0-based index `i`. */
function popProb(i: number, difficulty: Difficulty): number {
  return 1 - survivalProb(i, difficulty);
}

/** Cumulative DISPLAY multiplier after `pumps` successful pumps (RTP once). */
function computeMultiplier(pumps: number, difficulty: Difficulty): number {
  if (pumps <= 0) return 0;
  let product = 1;
  for (let i = 0; i < pumps; i++) {
    const s = survivalProb(i, difficulty);
    if (s <= 0) return 0;
    product *= 1 / s;
  }
  return Math.floor(Math.min(MAX_MULT, product * RTP) * 100) / 100;
}

function formatMult(m: number): string {
  if (m >= 100) return `${m.toFixed(0)}×`;
  return `${m.toFixed(2)}×`;
}

/* Balloon paints per difficulty — flat enamel bodies on dark ink, no glow. */
const BALLOON_PAINT: Record<
  Difficulty,
  { body: string; shade: string; stroke: string }
> = {
  easy: { body: "#2fb8a6", shade: "#1b7466", stroke: "#07211d" },
  medium: { body: "#f2a33c", shade: "#9a621a", stroke: "#2a1b06" },
  hard: { body: "#c73538", shade: "#7e2225", stroke: "#3a0f11" },
};

/* ===========================================================================
 *  Component
 * ========================================================================= */

export default function PumpClient() {
  const { trigger: triggerFeedback } = useGameFeedback();
  const {
    wallet,
    loaded: walletLoaded,
    refresh: refreshWallet,
    adjustCredits,
  } = useGamesWallet();
  const balance = walletLoaded ? wallet.credits : null;
  const [difficulty, setDifficulty] = useState<Difficulty>("medium");

  const [phase, setPhase] = useState<GamePhase>("setup");
  const [wager, setWager] = useMachineBet(balance, 10, {
    locked: phase === "playing",
  });
  /* The stake the open round was bought with; the receipt prints it. */
  const [roundStake, setRoundStake] = useState(0);
  const [roundId, setRoundId] = useState<string | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const [pumps, setPumps] = useState(0);
  const [currentMultiplier, setCurrentMultiplier] = useState(0);
  const [payout, setPayout] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [isPumping, setIsPumping] = useState(false);
  /** Bumps on every successful pump so the balloon plays its inflate tick. */
  const [pumpTick, setPumpTick] = useState(0);
  /** True while the pop burst is on screen (drives the shard animation). */
  const [popped, setPopped] = useState(false);

  const {
    revealedSeed,
    setRevealedSeed,
    start: startSession,
    action: sessionAction,
    settle: settleSession,
    achievements,
  } = useWagerSession("arcade-pump");

  /* ---------- Start ---------- */
  const handleStart = useCallback(async () => {
    if (isStarting || balance == null) return;
    setError(null);
    if (wager > balance) {
      setError(`You need ${wager} tickets for this bet.`);
      return;
    }
    setIsStarting(true);
    try {
      const session = await startSession(wager, { difficulty });
      if (!session.ok) {
        setError(
          machineError(session.error, "The machine could not start the round."),
        );
        return;
      }
      SoundManager.play("arcadeBet");
      setPumps(0);
      setCurrentMultiplier(0);
      setPayout(0);
      setPumpTick(0);
      setPopped(false);
      setRoundStake(wager);
      setRoundId(null);
      setPhase("playing");
      adjustCredits(-wager);
    } catch {
      setError("The machine lost its connection. Try again.");
    } finally {
      setIsStarting(false);
    }
  }, [isStarting, wager, balance, difficulty, startSession, adjustCredits]);

  /* ---------- Pump ---------- */
  const handlePump = useCallback(async () => {
    if (phase !== "playing" || isPumping) return;
    if (pumps >= PUMP_MAX_PUMPS) return;
    setIsPumping(true);
    setError(null);
    try {
      const res = await sessionAction<PumpResponse>("pump");
      if (!res.ok) {
        setError(
          machineError(res.error, "The pump did not go through. Try again."),
        );
        setIsPumping(false);
        return;
      }
      const data = res.data;

      if (!data.alive) {
        // POP — server already auto-settled this action; reveal the seed now.
        setPopped(true);
        SoundManager.play("arcadeExplode");
        setRevealedSeed(data.seed ?? null);
        setRoundId(data.roundId ?? null);
        setPayout(0);
        // Brief beat so the burst reads before the result plate replaces it.
        setTimeout(() => {
          setPhase("lost");
          setIsPumping(false);
        }, 520);
        return;
      }

      // Survived this pump.
      SoundManager.play("arcadeReveal");
      setPumps(data.pumpsCompleted ?? pumps + 1);
      setCurrentMultiplier(
        data.currentMultiplier ?? computeMultiplier(pumps + 1, difficulty),
      );
      setPumpTick((t) => t + 1);

      if (data.allPumpsCompleted || data.completed) {
        // Terminal win (reached PUMP_MAX) — server auto-settled.
        setPayout(data.payout ?? 0);
        setRevealedSeed(data.seed ?? null);
        setRoundId(data.roundId ?? null);
        setPhase("won");
        triggerFeedback("jackpot");
        void refreshWallet();
      }
      setIsPumping(false);
    } catch {
      setError("The machine lost its connection. Try the pump again.");
      setIsPumping(false);
    }
  }, [
    phase,
    isPumping,
    pumps,
    difficulty,
    sessionAction,
    setRevealedSeed,
    refreshWallet,
    triggerFeedback,
  ]);

  /* ---------- Cash out ---------- */
  const handleCashout = useCallback(async () => {
    if (phase !== "playing" || pumps === 0 || isPumping) return;
    setError(null);
    try {
      const settled = await settleSession<{
        payout?: number;
        multiplier?: number;
        roundId?: string | null;
      }>();
      if (!settled.ok) {
        setError(
          machineError(
            settled.error,
            "The cash out did not go through. Try again.",
          ),
        );
        return;
      }
      const data = settled.data;
      setPayout(data.payout ?? Math.floor(roundStake * currentMultiplier));
      setRoundId(data.roundId ?? null);
      setCurrentMultiplier(data.multiplier ?? currentMultiplier);
      setPhase("won");
      triggerFeedback("cashout");
      void refreshWallet();
    } catch {
      setError("The machine lost its connection. Try the cash out again.");
    }
  }, [
    phase,
    pumps,
    roundStake,
    currentMultiplier,
    isPumping,
    settleSession,
    refreshWallet,
    triggerFeedback,
  ]);

  /* ---------- Keyboard: Space plays, or pumps mid-round ---------- */
  useMachineKey(
    useMemo(
      () =>
        phase === "playing"
          ? () => void handlePump()
          : () => void handleStart(),
      [phase, handlePump, handleStart],
    ),
  );

  /* ---------- Computed ---------- */
  const potentialWin = Math.floor(roundStake * currentMultiplier);
  const playing = phase === "playing";
  const affordable = balance != null && wager <= balance;
  const atMax = pumps >= PUMP_MAX_PUMPS;
  const nextMultiplier = computeMultiplier(pumps + 1, difficulty);
  const nextPopRisk = popProb(pumps, difficulty); // risk of the NEXT pump (index = pumps)
  const details = DIFFICULTY_DETAILS[difficulty];
  const paint = BALLOON_PAINT[difficulty];

  // Inflate scale: balloon grows with pump count, easing toward a ceiling so it
  // fills the stage without overflowing. 0 pumps = small; PUMP_MAX ≈ full.
  const inflate = Math.min(1, pumps / 16);
  const balloonScale = 0.42 + inflate * 0.78;

  /* ---------- Stage ---------- */
  const statusLine =
    phase === "setup"
      ? `The first pump pops ${Math.round(popProb(0, difficulty) * 100)}% of the time on ${details.label}.`
      : playing
        ? atMax
          ? `${formatMult(currentMultiplier)} at full size.`
          : pumps === 0
            ? `Pump once for ${formatMult(nextMultiplier)}.`
            : `${formatMult(currentMultiplier)} now. The next pump pays ${formatMult(nextMultiplier)}.`
        : phase === "won"
          ? `Cashed out at ${formatMult(currentMultiplier)}.`
          : `It popped on pump ${pumps + 1}.`;

  const screen = (
    <div className="arc-machine-fit pump-stage">
      <p role="status" className="arc-machine-status">
        {statusLine}
      </p>
      <div
        className="pump-scene relative mx-auto flex w-full items-center justify-center"
        data-popped={popped || undefined}
        data-pumping={isPumping || undefined}
      >
        {/* HUD chips */}
        <ArcadeChip className="arcade-num pointer-events-none absolute left-2.5 top-2.5 z-20 text-strong">
          pump {Math.min(pumps, PUMP_MAX_PUMPS)} of {PUMP_MAX_PUMPS}
        </ArcadeChip>
        <ArcadeChip className="pointer-events-none absolute right-2.5 top-2.5 z-20 text-tickets-text">
          {details.label}
        </ArcadeChip>

        {/* Pop risk on the stage: the tension number players actually
            watch, heating from faint to danger as it climbs */}
        {playing && !popped && !atMax && (
          <ArcadeChip
            className={`arcade-num pointer-events-none absolute bottom-2.5 left-2.5 z-20 ${
              nextPopRisk >= 0.25
                ? "text-danger-text"
                : nextPopRisk >= 0.1
                  ? "text-tickets-text"
                  : "text-faint"
            }`}
          >
            pop risk {(nextPopRisk * 100).toFixed(0)}%
          </ArcadeChip>
        )}

          {/* The balloon + string, vertically centered in the well */}
          <div className="pump-balloon-area">
            <div
              key={pumpTick}
              className="pump-balloon"
              style={{
                ["--balloon-scale" as string]: String(balloonScale),
                ["--balloon-body" as string]: paint.body,
                ["--balloon-shade" as string]: paint.shade,
                ["--balloon-stroke" as string]: paint.stroke,
                /* strain drives the wobble amplitude/speed as pop risk climbs */
                ["--strain" as string]: String(
                  phase === "playing" && !popped
                    ? Math.min(nextPopRisk, 0.5)
                    : 0,
                ),
              }}
            >
              <div className="pump-balloon-skin">
                <span className="pump-balloon-gloss" />
                <span className="pump-balloon-mult arcade-num">
                  {pumps === 0 ? "1.00×" : formatMult(currentMultiplier)}
                </span>
              </div>
              <span className="pump-balloon-knot" />
              <span className="pump-balloon-string" />
            </div>

            {/* The pump itself — an enamel box pump under the string; the
                plunger slams down on every pump action */}
            <div className="pump-rig" aria-hidden>
              <span className="pump-rig-handle" />
              <span className="pump-rig-plunger" />
              <span className="pump-rig-body" />
            </div>

            {/* Pop burst — sharp non-glowy shards + a hard flash. */}
            <div className="pump-burst" aria-hidden>
              <span className="pump-flash" />
              {Array.from({ length: 12 }).map((_, i) => (
                <span
                  key={i}
                  className="pump-shard"
                  style={{
                    ["--shard-rot" as string]: `${(i / 12) * 360}deg`,
                    ["--shard-delay" as string]: `${(i % 4) * 8}ms`,
                  }}
                />
              ))}
            </div>
        </div>
      </div>
    </div>
  );

  const glass = (
    <MachineGlass
      name="pump"
      rules={[
        `Each pump raises the payout and the pop risk. On ${details.label} the first pump pops ${Math.round(popProb(0, difficulty) * 100)}% of the time.`,
      ]}
      paytable={GLASS_PUMPS.map((n) => ({
        label: `${n} ${n === 1 ? "pump" : "pumps"}`,
        value: formatMult(computeMultiplier(n, difficulty)),
        lit: (playing || phase === "won") && pumps === n,
      }))}
    />
  );

  const action = playing ? (
    <>
      <MachineButton
        onClick={() => void handlePump()}
        disabled={atMax}
        aria-disabled={isPumping || popped || undefined}
        aria-label={
          atMax ? "pump, full size" : `pump for ${formatMult(nextMultiplier)}`
        }
      >
        pump
      </MachineButton>
      <MachineButton
        second
        onClick={() => void handleCashout()}
        disabled={pumps === 0}
        aria-disabled={isPumping || popped || undefined}
        aria-label={
          pumps === 0 ? "cash out, pump once first" : `cash out ${potentialWin} tickets`
        }
      >
        cash out
      </MachineButton>
    </>
  ) : (
    <MachineButton
      onClick={() => void handleStart()}
      disabled={!affordable || wager < ARCADE_MIN_BET}
      aria-disabled={isStarting || undefined}
      aria-label={`play, ${wager} tickets`}
    >
      play
    </MachineButton>
  );

  const receipt =
    phase === "won" || phase === "lost" ? (
      <ArcadeWagerResultPlate
        result={{
          payout: phase === "won" ? payout : 0,
          stake: roundStake,
          multiplier: phase === "won" ? currentMultiplier : 0,
          jackpot: phase === "won" && atMax,
        }}
        kicker="pump"
        headline={phase === "won" ? formatMult(currentMultiplier) : "pop"}
        detail={`${details.label}, ${pumps} ${pumps === 1 ? "pump" : "pumps"}`}
        fairness={{ seedHash: null, revealedSeed }}
        achievements={achievements}
        roundId={roundId ?? undefined}
        sound={false}
      />
    ) : null;

  return (
    <GameShell
      game="pump"
      stat={
        <GameStat
          value={formatMult(computeMultiplier(PUMP_MAX_PUMPS, difficulty))}
          label="top"
        />
      }
      howTo={HOW_TO}
    >
      <ArcadeMachine
        name="pump"
        glass={glass}
        action={action}
        bet={{
          value: wager,
          onChange: setWager,
          balance,
          disabled: playing,
        }}
        controls={
          <MachineChoice<Difficulty>
            label="difficulty"
            options={DIFFICULTY_KEYS.map((key) => ({
              value: key,
              label: DIFFICULTY_DETAILS[key].label,
            }))}
            value={difficulty}
            onChange={setDifficulty}
            disabled={playing}
          />
        }
        receipt={receipt}
        receiptKey={roundId}
        notice={error}
      >
        {screen}
      </ArcadeMachine>

      <style jsx global>{`
        /* phones: room for the balloon */
        .arc-shell[data-game="pump"] .arc-machine-frame:not([data-wide]) {
          --machine-screen-min: 23rem;
        }
        .pump-stage .pump-scene {
          flex: none;
          aspect-ratio: 16 / 11;
          /* the balloon needs this much height to clear the pump */
          min-height: min(320px, 100cqh - 4.5rem);
          /* the largest scene the screen holds under the status line */
          width: min(100%, 540px, (100cqh - 4.5rem) * 16 / 11);
          /* recessed lacquered cabinet floor with a faint amber center wash */
          background:
            radial-gradient(
              120% 90% at 50% 18%,
              color-mix(in srgb, var(--enamel-tickets) 7%, transparent),
              transparent 60%
            ),
            var(--screen-well, #120c07);
          border-radius: 6px;
          box-shadow: inset 0 2px 12px rgba(0, 0, 0, 0.55);
        }

        .pump-stage .pump-balloon-area {
          position: relative;
          display: flex;
          align-items: flex-end;
          justify-content: center;
          width: 100%;
          height: 100%;
          /* the string ends at the pump's handle, so the balloon clears it */
          padding-bottom: max(6%, 56px);
          /* container so the balloon readout can size in cqw */
          container-type: inline-size;
        }

        /* Balloon root: scales as a whole with --balloon-scale. The key= bump
           replays the inflate keyframe each successful pump. */
        .pump-stage .pump-balloon {
          position: relative;
          width: 46%;
          max-width: 220px;
          display: flex;
          flex-direction: column;
          align-items: center;
          transform: scale(var(--balloon-scale, 0.5));
          transform-origin: 50% 100%;
          transition: transform 260ms cubic-bezier(0.34, 1.56, 0.64, 1);
          animation: pump-inflate 320ms cubic-bezier(0.34, 1.56, 0.64, 1);
          will-change: transform;
        }
        /* the burst hides the balloon the instant it pops */
        .pump-stage .pump-scene[data-popped] .pump-balloon {
          opacity: 0;
          transform: scale(var(--balloon-scale, 0.5)) scale(1.08);
          transition: opacity 60ms linear;
        }

        .pump-stage .pump-balloon-skin {
          position: relative;
          width: 100%;
          aspect-ratio: 0.86 / 1;
          /* teardrop balloon: rounder top, pinched bottom */
          border-radius: 50% 50% 48% 48% / 56% 56% 44% 44%;
          background: radial-gradient(
            68% 60% at 36% 30%,
            color-mix(in srgb, var(--balloon-body) 60%, #ffffff) 0%,
            var(--balloon-body) 40%,
            var(--balloon-shade) 100%
          );
          border: 2.5px solid var(--balloon-stroke);
          display: flex;
          align-items: center;
          justify-content: center;
          /* hard offset bevel — depth without glow */
          box-shadow:
            inset 6px -8px 14px
              color-mix(in srgb, var(--balloon-shade) 70%, transparent),
            inset -4px 4px 10px color-mix(in srgb, #ffffff 22%, transparent);
        }
        /* matte cream gloss patch (flat, not a glow) */
        .pump-stage .pump-balloon-gloss {
          position: absolute;
          top: 14%;
          left: 20%;
          width: 26%;
          height: 30%;
          border-radius: 50%;
          background: color-mix(in srgb, #fdf7ea 70%, transparent);
          opacity: 0.55;
        }
        .pump-stage .pump-balloon-mult {
          position: relative;
          z-index: 1;
          font-family: var(--font-mono-arcade), monospace;
          font-weight: 700;
          font-size: clamp(14px, 4.6cqw, 30px);
          color: var(--balloon-stroke);
          text-shadow: 0 1px 0 color-mix(in srgb, #ffffff 35%, transparent);
        }
        /* knot triangle at the balloon's neck */
        .pump-stage .pump-balloon-knot {
          width: 0;
          height: 0;
          margin-top: -2px;
          border-left: 7px solid transparent;
          border-right: 7px solid transparent;
          border-top: 10px solid var(--balloon-shade);
        }
        .pump-stage .pump-balloon-string {
          width: 2px;
          height: 26%;
          background: color-mix(in srgb, var(--text-strong) 55%, transparent);
        }

        /* Strain wobble — amplitude and tempo scale with --strain (next-pump
           pop risk), so a safe balloon barely moves and a 40%-risk balloon
           visibly trembles. Standalone rotate property so it composes with
           the root's transform-based inflate spring. */
        .pump-stage .pump-scene:not([data-popped]) .pump-balloon-skin {
          animation: pump-strain calc(0.95s - min(var(--strain, 0), 0.5) * 1.1s)
            ease-in-out infinite alternate;
        }
        @keyframes pump-strain {
          0% {
            rotate: calc(min(var(--strain, 0), 0.5) * -7deg);
          }
          100% {
            rotate: calc(min(var(--strain, 0), 0.5) * 7deg);
          }
        }

        /* ── The pump rig ───────────────────────────────────────────── */
        .pump-stage .pump-rig {
          position: absolute;
          bottom: 1%;
          left: 50%;
          transform: translateX(-50%);
          width: 72px;
          height: 64px;
          pointer-events: none;
        }
        .pump-stage .pump-rig-body {
          position: absolute;
          bottom: 0;
          left: 50%;
          transform: translateX(-50%);
          width: 64px;
          height: 30px;
          border-radius: 5px 5px 3px 3px;
          background: var(--enamel-prize);
          border: 2px solid var(--border-ink);
          box-shadow:
            inset 0 3px 0 #ffffff2e,
            inset 0 -4px 0 #00000045;
        }
        .pump-stage .pump-rig-plunger {
          position: absolute;
          bottom: 28px;
          left: 50%;
          transform: translateX(-50%);
          width: 7px;
          height: 26px;
          background: var(--border-ink);
          border-radius: 2px;
          transition: height 110ms cubic-bezier(0.4, 0, 1, 1);
        }
        .pump-stage .pump-rig-handle {
          position: absolute;
          bottom: 52px;
          left: 50%;
          transform: translateX(-50%);
          width: 44px;
          height: 9px;
          border-radius: 4px;
          background: var(--enamel-tickets);
          border: 2px solid var(--border-ink);
          box-shadow: inset 0 2px 0 #ffffff30;
          transition: bottom 110ms cubic-bezier(0.4, 0, 1, 1);
        }
        /* plunger slams down while a pump request is in flight */
        .pump-stage .pump-scene[data-pumping] .pump-rig-plunger {
          height: 8px;
        }
        .pump-stage .pump-scene[data-pumping] .pump-rig-handle {
          bottom: 34px;
        }

        /* ── Pop burst ──────────────────────────────────────────────── */
        .pump-stage .pump-burst {
          position: absolute;
          inset: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          pointer-events: none;
          opacity: 0;
        }
        .pump-stage .pump-scene[data-popped] .pump-burst {
          opacity: 1;
        }
        /* hard cream flash — opacity pop, no blur/glow */
        .pump-stage .pump-flash {
          position: absolute;
          width: 38%;
          aspect-ratio: 1;
          border-radius: 50%;
          background: color-mix(in srgb, #fdf7ea 80%, transparent);
          opacity: 0;
        }
        .pump-stage .pump-scene[data-popped] .pump-flash {
          animation: pump-flash 320ms ease-out forwards;
        }
        /* enamel shards fly straight out and fall — sharp, flat triangles */
        .pump-stage .pump-shard {
          position: absolute;
          width: 0;
          height: 0;
          border-left: 6px solid transparent;
          border-right: 6px solid transparent;
          border-bottom: 14px solid var(--enamel-tickets, #f2a33c);
          transform: rotate(var(--shard-rot)) translateY(0) scale(0.6);
          opacity: 0;
        }
        .pump-stage .pump-scene[data-popped] .pump-shard {
          animation: pump-shard 520ms cubic-bezier(0.2, 0.7, 0.4, 1) forwards;
          animation-delay: var(--shard-delay, 0ms);
        }

        @keyframes pump-inflate {
          0% {
            transform: scale(var(--balloon-scale, 0.5)) scaleX(1.08)
              scaleY(0.94);
          }
          60% {
            transform: scale(var(--balloon-scale, 0.5)) scaleX(0.97)
              scaleY(1.04);
          }
          100% {
            transform: scale(var(--balloon-scale, 0.5));
          }
        }
        @keyframes pump-flash {
          0% {
            opacity: 0.85;
            transform: scale(0.5);
          }
          100% {
            opacity: 0;
            transform: scale(1.5);
          }
        }
        @keyframes pump-shard {
          0% {
            opacity: 1;
            transform: rotate(var(--shard-rot)) translateY(0) scale(0.6);
          }
          70% {
            opacity: 1;
          }
          100% {
            opacity: 0;
            transform: rotate(var(--shard-rot)) translateY(-150px) scale(1)
              rotate(120deg);
          }
        }

        /* Reduced motion: no inflate spring, no burst animation — the balloon
           snaps to each discrete size and the pop is an instant state change. */
        @media (prefers-reduced-motion: reduce) {
          .pump-stage .pump-balloon {
            animation: none;
            transition: none;
          }
          .pump-stage .pump-scene[data-popped] .pump-balloon {
            transition: none;
          }
          .pump-stage .pump-flash,
          .pump-stage .pump-scene[data-popped] .pump-flash,
          .pump-stage .pump-shard,
          .pump-stage .pump-scene[data-popped] .pump-shard {
            animation: none;
          }
          /* show a static flat burst ring instead of moving shards */
          .pump-stage .pump-scene[data-popped] .pump-flash {
            opacity: 0.5;
          }
          .pump-stage .pump-scene:not([data-popped]) .pump-balloon-skin {
            animation: none;
          }
          .pump-stage .pump-rig-plunger,
          .pump-stage .pump-rig-handle {
            transition: none;
          }
        }
      `}</style>
    </GameShell>
  );
}
