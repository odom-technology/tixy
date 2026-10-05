"use client";

import { useState, useCallback, useMemo, useRef } from "react";
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
  useMachineWide,
} from "@/features/arcade/components/wagers/arcade-machine";
import { ArcadeWagerResultPlate } from "@/features/arcade/components/results/arcade-run-result";
import { useGameFeedback } from "@/features/arcade/lib/use-game-feedback";
import { ArcadeButton, ArcadeStub, cx } from "@/features/arcade/components/ui/arcade-ui";
import { SoundManager } from "@/features/arcade/lib/sound-manager";
import { useWagerSession } from "@/features/arcade/lib/use-wager-session";
import { ARCADE_MIN_BET, MAX_TICKET_BET } from "@/server/arcade/arcade-constants";
import {
  ROULETTE_MAX_BETS,
  ROULETTE_ODDS,
  type RouletteBet,
} from "@/server/arcade/wager-games/roulette";
import {
  feltColor,
  spotToBet,
  spotMultiple,
  numberAt,
  seamStyle,
  ChipDisc,
  COLUMN_SPOTS,
  DOZEN_SPOTS,
  OUTSIDE_EVEN_SPOTS,
  SEAM_SPOTS,
  FELT_COLUMNS,
  FELT_ROWS,
  type RouletteSpot,
  type SeamSpot,
} from "./_roulette-felt";
import { RouletteWheel, type WheelEngine } from "./_roulette-wheel";

/* ========================================================================== */
/*  Helpers                                                                    */
/* ========================================================================== */

const HOW_TO: GameHowTo = {
  lines: [
    "Pick a chip, place it on the felt as many times as you like, then spin.",
    "The ball lands in one of 37 pockets, 0 to 36, and every chip that covers it pays.",
    `A single number pays ${ROULETTE_ODDS.straight}× its chip, a dozen ${ROULETTE_ODDS.dozen}×, and red or black ${ROULETTE_ODDS.red}×.`,
  ],
};

/** What each spot returns, printed on the glass. */
const GLASS_ROWS = [
  { label: "number", value: `${ROULETTE_ODDS.straight}×` },
  { label: "split", value: `${ROULETTE_ODDS.split}×` },
  { label: "street", value: `${ROULETTE_ODDS.street}×` },
  { label: "corner", value: `${ROULETTE_ODDS.corner}×` },
  { label: "six line", value: `${ROULETTE_ODDS["six-line"]}×` },
  { label: "dozen, column", value: `${ROULETTE_ODDS.dozen}×` },
  { label: "red, odd, low", value: `${ROULETTE_ODDS.red}×` },
] as const;

function fmtMult(m: number): string {
  return `${m.toLocaleString("en-US", { maximumFractionDigits: 2 })}×`;
}

/** A server or rules error with a sentence ready for the notice. */
class SpinError extends Error {}

const POCKETS = 37;

/** First mulberry32 draw for a seed — mirrors the server resolver exactly so
 *  the client can reconstruct the winning pocket for the spin animation. */
function firstDraw(seed: number): number {
  let s = seed | 0;
  s = (s + 0x6d2b79f5) | 0;
  let t = Math.imul(s ^ (s >>> 15), 1 | s);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

function pocketFromSeed(seed: number): number {
  return Math.floor(firstDraw(seed) * POCKETS); // 0..36
}

type Placed = { spot: RouletteSpot; amount: number };

/* ========================================================================== */
/*  Component                                                                  */
/* ========================================================================== */

export default function RouletteClient() {
  const { trigger: triggerFeedback } = useGameFeedback();
  const {
    wallet,
    loaded: walletLoaded,
    refresh: refreshWallet,
    adjustCredits,
  } = useGamesWallet();
  const balance = walletLoaded ? wallet.credits : null;

  const [isSpinning, setIsSpinning] = useState(false);
  // The chip value is the machine's bet row, labelled "chip"; the stake is
  // the total of the chips on the felt.
  const [denom, setDenom] = useMachineBet(balance, 10, { locked: isSpinning });
  // Placed chips keyed by spot id. `order` is the per-chip placement log
  // (spot key + denom dropped) so Undo peels exactly the last chip.
  const [placed, setPlaced] = useState<Map<string, Placed>>(new Map());
  const [order, setOrder] = useState<Array<{ key: string; amount: number }>>(
    [],
  );

  const [error, setError] = useState<string | null>(null);

  // Result state
  const [resultPocket, setResultPocket] = useState<number | null>(null);
  const [lastPayout, setLastPayout] = useState<number | null>(null);
  const [lastMult, setLastMult] = useState<number | null>(null);
  const [settledStake, setSettledStake] = useState(0);
  const [settledSpots, setSettledSpots] = useState(0);
  const [roundId, setRoundId] = useState<string | null>(null);
  const [lastWinKeys, setLastWinKeys] = useState<Set<string>>(new Set());

  // The wheel and ball run in their own rAF loop; this is its handle.
  const wheelRef = useRef<WheelEngine | null>(null);

  const {
    revealedSeed,
    start: startSession,
    settle: settleSession,
    achievements,
  } = useWagerSession("arcade-roulette");

  // ─── Derived ────────────────────────────────────────────────────────────
  const totalStaked = useMemo(() => {
    let sum = 0;
    for (const p of placed.values()) sum += p.amount;
    return sum;
  }, [placed]);

  const betCount = placed.size;
  const canAfford = balance != null && totalStaked <= balance;
  const overMaxBets = betCount > ROULETTE_MAX_BETS;
  const overMaxStake = totalStaked > MAX_TICKET_BET;
  const ready =
    totalStaked >= ARCADE_MIN_BET && canAfford && !overMaxBets && !overMaxStake && betCount > 0;
  const canSpin = !isSpinning && ready;

  // ─── Chip placement ───────────────────────────────────────────────────────
  const place = useCallback(
    (spot: RouletteSpot) => {
      if (isSpinning) return;
      setError(null);
      // Clear the previous round's result once the player starts a new layout.
      setResultPocket(null);
      setLastWinKeys(new Set());
      const drop = denom;
      setPlaced((prev) => {
        const next = new Map(prev);
        const existing = next.get(spot.key);
        next.set(spot.key, {
          spot,
          amount: (existing?.amount ?? 0) + drop,
        });
        return next;
      });
      setOrder((prev) => [...prev, { key: spot.key, amount: drop }]);
      SoundManager.play("arcadeBet");
    },
    [denom, isSpinning],
  );

  const undo = useCallback(() => {
    if (isSpinning || order.length === 0) return;
    setError(null);
    const last = order[order.length - 1]!;
    setOrder((prev) => prev.slice(0, -1));
    setPlaced((prev) => {
      const next = new Map(prev);
      const existing = next.get(last.key);
      if (!existing) return next;
      // Peel exactly the chip that was last dropped on this spot.
      const amount = existing.amount - last.amount;
      if (amount > 0) {
        next.set(last.key, { spot: existing.spot, amount });
      } else {
        next.delete(last.key);
      }
      return next;
    });
    SoundManager.play("arcadeTick");
  }, [isSpinning, order]);

  const clearAll = useCallback(() => {
    if (isSpinning) return;
    setError(null);
    setPlaced(new Map());
    setOrder([]);
    setResultPocket(null);
    setLastWinKeys(new Set());
    SoundManager.play("arcadeTick");
  }, [isSpinning]);

  // ─── Spin ─────────────────────────────────────────────────────────────────
  const handleSpin = useCallback(async () => {
    if (!canSpin) return;
    if (totalStaked < ARCADE_MIN_BET) {
      setError(`The felt needs at least ${ARCADE_MIN_BET} tickets to spin.`);
      return;
    }
    if (balance == null || totalStaked > balance) {
      setError(`You need ${totalStaked} tickets for this bet.`);
      return;
    }

    setError(null);
    setIsSpinning(true);
    setResultPocket(null);
    setLastPayout(null);
    setLastMult(null);
    setLastWinKeys(new Set());
    setRoundId(null);
    SoundManager.play("arcadeSpin");

    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    // The ball leaves the pocket on the press; the answer lands it later.
    if (!reduced) wheelRef.current?.launch();

    // Snapshot the placed bets → wire format.
    const placedList = [...placed.values()];
    const bets: RouletteBet[] = placedList.map((p) =>
      spotToBet(p.spot, p.amount),
    );
    const stake = totalStaked;
    setSettledStake(stake);
    setSettledSpots(placedList.length);

    // Optimistic debit.
    adjustCredits(-stake);

    try {
      const session = await startSession(stake, { bets });
      if (!session.ok)
        throw new SpinError(
          machineError(session.error, "The machine could not start the round."),
        );

      const settled = await settleSession<{
        seed: number;
        payout: number;
        multiplier: number;
        pocket?: number;
        color?: string;
        winningBets?: number[];
        roundId?: string | null;
      }>();
      if (!settled.ok)
        throw new SpinError(
          machineError(settled.error, "The spin did not go through. Try again."),
        );
      const data = settled.data;

      const pocket =
        typeof data.pocket === "number"
          ? data.pocket
          : pocketFromSeed(data.seed);
      const won = data.payout > 0;

      // Which placed spots won (for highlight) — recompute locally from the
      // pocket so the felt can light up the exact chips that paid.
      const winKeys = new Set<string>();
      for (const p of placedList) {
        if (spotCovers(p.spot, pocket)) winKeys.add(p.spot.key);
      }

      const reveal = () => {
        setResultPocket(pocket);
        setLastPayout(data.payout);
        setLastMult(data.multiplier);
        setLastWinKeys(winKeys);
        setRoundId(data.roundId ?? null);
        if (won) {
          SoundManager.play(
            data.multiplier >= 10 ? "arcadeBigWin" : "arcadeWin",
          );
        } else {
          triggerFeedback("loss");
        }
        void refreshWallet();
        setIsSpinning(false);
      };

      if (reduced) {
        wheelRef.current?.snap(pocket);
        reveal();
      } else if (wheelRef.current) {
        // Drop the ball into the winning pocket; the result shows when it stops.
        wheelRef.current.land(pocket, reveal, (n) =>
          SoundManager.play("arcadeTick", { pitch: 1 + n * 0.12 }),
        );
      } else {
        reveal();
      }
    } catch (err) {
      wheelRef.current?.stop();
      setError(
        err instanceof SpinError
          ? err.message
          : "The machine lost its connection. Try again.",
      );
      void refreshWallet();
      setIsSpinning(false);
    }
  }, [
    canSpin,
    totalStaked,
    balance,
    placed,
    adjustCredits,
    startSession,
    settleSession,
    refreshWallet,
    triggerFeedback,
  ]);

  // ─── Render the felt ───────────────────────────────────────────────────────
  const statusLine =
    betCount === 0
      ? "Pick a chip, place it on the felt, then spin."
      : `${betCount} ${betCount === 1 ? "spot" : "spots"}, ${totalStaked.toLocaleString()} tickets on the felt.`;

  const wide = useMachineWide();
  const net = (lastPayout ?? 0) - settledStake;
  const settled = resultPocket != null && !isSpinning;

  const undoButton = (
    <ArcadeButton
      tone="default"
      size="md"
      onClick={undo}
      disabled={isSpinning || order.length === 0}
    >
      undo
    </ArcadeButton>
  );
  const clearButton = (
    <ArcadeButton
      tone="default"
      size="md"
      onClick={clearAll}
      disabled={isSpinning || betCount === 0}
    >
      clear
    </ArcadeButton>
  );
  // On a wide screen they sit on the deck; on a phone the deck has no room,
  // so they flank the line under the wheel.
  const controls = wide ? (
    <div className="rl-felt-tools">
      {undoButton}
      {clearButton}
    </div>
  ) : null;

  const screen = (
    <div className="arc-machine-fit roulette-stage rl-well">
      {/* The wheel, and what the round came to */}
      <div className="rl-top">
        <RouletteWheel engineRef={wheelRef} pocket={settled ? resultPocket : null} />
        <div className="rl-bar">
          {wide ? null : undoButton}
          <div role="status" className="rl-readout">
            {settled ? (
              <ResultPlate
                key={roundId ?? resultPocket}
                net={net}
                payout={lastPayout ?? 0}
                stake={settledStake}
                spots={settledSpots}
                won={lastWinKeys.size}
              />
            ) : (
              <p className="rl-line">{statusLine}</p>
            )}
          </div>
          {wide ? null : clearButton}
        </div>
      </div>

      {/* The felt board */}
      <RouletteFelt
        placed={placed}
        winKeys={lastWinKeys}
        resultPocket={settled ? resultPocket : null}
        onPlace={place}
      />
      <FeltStyles />
    </div>
  );

  const action = (
    <MachineButton
      onClick={() => void handleSpin()}
      disabled={!isSpinning && !ready}
      aria-disabled={isSpinning || undefined}
      aria-label={
        betCount === 0
          ? "spin, place a chip first"
          : `spin, ${totalStaked} tickets`
      }
    >
      spin
    </MachineButton>
  );

  const receipt =
    resultPocket != null && lastPayout != null && !isSpinning ? (
      <ArcadeWagerResultPlate
        result={{
          payout: lastPayout,
          stake: settledStake,
          multiplier: lastMult,
        }}
        kicker="roulette"
        headline={
          <span className="inline-flex items-center gap-2">
            <span
              className={cx(
                "rl-plate-pocket",
                `rl-pocket-${feltColor(resultPocket)}`,
              )}
            >
              {resultPocket}
            </span>
            {lastMult != null && lastMult > 0 ? fmtMult(lastMult) : null}
          </span>
        }
        detail={`${feltColor(resultPocket)} ${resultPocket}, ${settledSpots} ${settledSpots === 1 ? "spot" : "spots"}`}
        fairness={{ seedHash: null, revealedSeed }}
        achievements={achievements}
        roundId={roundId ?? undefined}
        sound={false}
      />
    ) : null;

  return (
    <GameShell
      game="roulette"
      stat={<GameStat value={`${ROULETTE_ODDS.straight}×`} label="top" />}
      howTo={HOW_TO}
    >
      <ArcadeMachine
        name="roulette"
        glass={
          <MachineGlass
            name="roulette"
            rules={["Every chip on a spot that covers the pocket pays its chip times:"]}
            paytable={GLASS_ROWS}
          />
        }
        action={action}
        bet={{
          value: denom,
          onChange: setDenom,
          balance,
          disabled: isSpinning,
          label: "chip",
        }}
        controls={controls}
        receipt={receipt}
        receiptKey={roundId}
        notice={
          error ??
          (overMaxBets
            ? `You can bet on ${ROULETTE_MAX_BETS} spots at most.`
            : overMaxStake
              ? `The felt takes ${MAX_TICKET_BET.toLocaleString("en-US")} tickets a spin at most.`
              : null)
        }
      >
        {screen}
      </ArcadeMachine>
    </GameShell>
  );
}

/* ========================================================================== */
/*  Felt board                                                                 */
/* ========================================================================== */

function RouletteFelt({
  placed,
  winKeys,
  resultPocket,
  onPlace,
}: {
  placed: Map<string, Placed>;
  winKeys: Set<string>;
  /** The pocket the ball stopped in, once it has; null while betting. */
  resultPocket: number | null;
  onPlace: (spot: RouletteSpot) => void;
}) {
  // Once the ball has stopped, every chip has a fate: it paid (stays, lifted)
  // or it didn't (swept off the felt).
  const settled = resultPocket != null;
  const chipOf = (key: string, small = false) => (
    <ChipBadge
      placed={placed.get(key)}
      small={small}
      fate={settled ? (winKeys.has(key) ? "win" : "lose") : undefined}
    />
  );
  return (
    <div className="rl-felt">
      <div className="rl-board">
        {/* Green 0, beside all three rows */}
        <button
          type="button"
          onClick={() => onPlace(ZERO_SPOT)}
          className={cx(
            "rl-zero rl-cell-num rl-num-green",
            resultPocket === 0 && "rl-hit",
            winKeys.has("zero") && "rl-win",
          )}
          aria-label="bet on 0"
        >
          <span className="rl-num-label">0</span>
          {chipOf("zero")}
        </button>

        {/* The 12×3 number grid + seam hit-zones, in a positioned wrapper */}
        <div className="rl-numbers-wrap">
          <div className="rl-numbers">
            {Array.from({ length: FELT_ROWS }).map((_, r) =>
              Array.from({ length: FELT_COLUMNS }).map((__, c) => {
                const n = numberAt(r, c);
                const spot = straightSpot(n);
                return (
                  <button
                    key={n}
                    type="button"
                    onClick={() => onPlace(spot)}
                    className={cx(
                      "rl-cell-num",
                      `rl-num-${feltColor(n)}`,
                      resultPocket === n && "rl-hit",
                      winKeys.has(spot.key) && "rl-win",
                    )}
                    data-chip={placed.has(spot.key) || undefined}
                    style={{ gridColumn: c + 1, gridRow: r + 1 }}
                    aria-label={`bet on ${n}`}
                  >
                    <span className="rl-num-label">{n}</span>
                    {chipOf(spot.key)}
                  </button>
                );
              }),
            )}
          </div>

          {/* Seam hit-zones (splits / streets / corners / six-lines) overlaid
              on the number block. Pointer events only on the small targets. */}
          <div className="rl-seams" aria-hidden={false}>
            {SEAM_SPOTS.map((seam) => (
              <SeamButton
                key={seam.key}
                seam={seam}
                placed={placed.get(seam.key)}
                won={winKeys.has(seam.key)}
                fate={settled ? (winKeys.has(seam.key) ? "win" : "lose") : undefined}
                onPlace={onPlace}
              />
            ))}
          </div>
        </div>

        {/* 2:1 column bets down the right edge */}
        <div className="rl-columns">
          {COLUMN_SPOTS.map((spot, i) => (
            <button
              key={spot.key}
              type="button"
              onClick={() => onPlace(spot)}
              className={cx(
                "rl-cell-out rl-col2to1",
                winKeys.has(spot.key) && "rl-win",
              )}
              data-chip={placed.has(spot.key) || undefined}
              style={{ gridRow: i + 1 }}
              aria-label="column, pays 2 to 1"
            >
              <span>2:1</span>
              {chipOf(spot.key, true)}
            </button>
          ))}
        </div>

        {/* Dozen bars, under the numbers */}
        <div className="rl-dozens">
          {DOZEN_SPOTS.map((spot) => (
            <button
              key={spot.key}
              type="button"
              onClick={() => onPlace(spot)}
              className={cx("rl-cell-out", winKeys.has(spot.key) && "rl-win")}
              data-chip={placed.has(spot.key) || undefined}
              aria-label={`${spot.label} dozen, pays 2 to 1`}
            >
              <span>{spot.label}</span>
              {chipOf(spot.key, true)}
            </button>
          ))}
        </div>

        {/* Even-money outside bets */}
        <div className="rl-outside">
          {OUTSIDE_EVEN_SPOTS.map((spot) => (
            <button
              key={spot.key}
              type="button"
              onClick={() => onPlace(spot)}
              className={cx(
                "rl-cell-out",
                spot.key === "red" && "rl-out-red",
                spot.key === "black" && "rl-out-black",
                winKeys.has(spot.key) && "rl-win",
              )}
              data-chip={placed.has(spot.key) || undefined}
              aria-label={`bet on ${spot.label.toLowerCase()}`}
            >
              <span>{spot.label}</span>
              {chipOf(spot.key, true)}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function SeamButton({
  seam,
  placed,
  won,
  fate,
  onPlace,
}: {
  seam: SeamSpot;
  placed?: Placed;
  won: boolean;
  fate?: ChipFate;
  onPlace: (spot: RouletteSpot) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onPlace(seam)}
      className={cx(
        "rl-seam",
        `rl-seam-${seam.orient}`,
        placed && "rl-seam-active",
        won && "rl-seam-won",
      )}
      style={seamStyle(seam)}
      aria-label={`${seam.type} on ${seam.pockets.join(", ")}, pays ${spotMultiple(seam.type) - 1} to 1`}
      title={`${seam.type} · ${seam.pockets.join("/")}`}
    >
      {placed ? <ChipBadge placed={placed} small fate={fate} /> : null}
    </button>
  );
}

/** What happened to a chip: it paid, or it didn't. */
type ChipFate = "win" | "lose";

/** A stacked chip badge sitting on a spot. */
function ChipBadge({
  placed,
  small = false,
  fate,
}: {
  placed?: Placed;
  small?: boolean;
  fate?: ChipFate;
}) {
  if (!placed || placed.amount <= 0) return null;
  return (
    <span className="rl-chip-badge" data-fate={fate}>
      <ChipDisc amount={placed.amount} size={small ? "sm" : "md"} />
    </span>
  );
}

/* ========================================================================== */
/*  Result                                                                      */
/* ========================================================================== */

/** The round in one plate: what you won or lost, then the numbers behind it.
 *  Red for a win, ink for the rest, as at the 21 table. The winning number is
 *  already lit on the wheel when this springs in. */
function ResultPlate({
  net,
  payout,
  stake,
  spots,
  won,
}: {
  net: number;
  payout: number;
  stake: number;
  spots: number;
  won: number;
}) {
  const label = net > 0 ? "you win" : net === 0 ? "even" : "you lose";
  const paid = `${won} of ${spots} ${spots === 1 ? "spot" : "spots"} paid${payout > 0 ? ` ${payout.toLocaleString()}` : ""}, ${stake.toLocaleString()} staked.`;
  return (
    <>
      <p className="rl-plate" data-win={net > 0 || undefined}>
        <span>{label}</span>
        {net > 0 ? (
          <ArcadeStub size="md" aria-label={`${net} tickets won`}>
            +{net.toLocaleString()}
          </ArcadeStub>
        ) : (
          <b className="arcade-num">
            {net < 0 ? `−${Math.abs(net).toLocaleString()}` : "0"}
          </b>
        )}
      </p>
      <p className="rl-line">{paid}</p>
    </>
  );
}

/* ========================================================================== */
/*  Spot helpers (kept local so the felt + client agree)                       */
/* ========================================================================== */

const ZERO_SPOT: RouletteSpot = { key: "zero", type: "straight", pockets: [0] };

function straightSpot(n: number): RouletteSpot {
  return { key: `straight:${n}`, type: "straight", pockets: [n] };
}

/** Does a placed spot cover the winning pocket? Mirrors the server's
 *  betCoversPocket so the felt can highlight winners locally. */
function spotCovers(spot: RouletteSpot, pocket: number): boolean {
  switch (spot.type) {
    case "red":
      return feltColor(pocket) === "red";
    case "black":
      return feltColor(pocket) === "black";
    case "even":
      return pocket !== 0 && pocket % 2 === 0;
    case "odd":
      return pocket !== 0 && pocket % 2 === 1;
    case "low":
      return pocket >= 1 && pocket <= 18;
    case "high":
      return pocket >= 19 && pocket <= 36;
    default:
      return spot.pockets.includes(pocket);
  }
}

/* ========================================================================== */
/*  Scoped styles                                                              */
/* ========================================================================== */

function FeltStyles() {
  return (
    <style jsx global>{`
      /* On a phone, undo and clear move into the screen, which frees the deck
         row for the wheel. */
      .roulette-stage {
        --rl-felt: #0b3d2e;
        --rl-row: 33px;
        --rl-chip: 16px;
        gap: 0.5rem;
        padding: 0.5rem;
      }
      .rl-well {
        background: var(--screen-well);
      }

      /* ── Wheel and result ───────────────────────────────────────── */
      .rl-top {
        flex: 1 1 0;
        /* a 10rem wheel, the line under it and the gap; below that the screen
           scrolls instead of the felt riding up over the buttons */
        min-height: 13.5rem;
        width: 100%;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 0.375rem;
      }
      /* the wheel is as big as its slot allows; a size container so it can
         fit itself with cqw and cqh */
      .rl-wheel-slot {
        flex: 1 1 0;
        min-height: 0;
        width: 100%;
        container-type: size;
        display: grid;
        place-items: center;
      }
      .rl-wheel {
        position: relative;
        width: min(100cqw, 100cqh);
        aspect-ratio: 1;
      }
      .rl-wheel svg {
        display: block;
        width: 100%;
        height: 100%;
      }
      .rl-wheel-num {
        font-family: var(--font-num);
        font-weight: 700;
        font-size: 9.5px;
      }
      .rl-lit {
        animation: rl-lit 200ms ease-out both;
      }
      /* the number the ball stopped on, in the hub */
      .rl-hub {
        position: absolute;
        left: 50%;
        top: 50%;
        width: 31%;
        aspect-ratio: 1;
        translate: -50% -50%;
        display: grid;
        place-items: center;
        border: 2px solid var(--tixy-paper);
        border-radius: 50%;
        font-size: calc(min(100cqw, 100cqh) * 0.155);
        font-weight: 800;
        line-height: 1;
        animation: rl-pop 320ms var(--tixy-ease-spring) both;
      }
      .rl-hub-red {
        background: var(--enamel-danger);
        color: var(--enamel-danger-on);
      }
      .rl-hub-black {
        background: #15100b;
        color: #f6eddc;
      }
      .rl-hub-green {
        background: var(--enamel-prize);
        color: var(--enamel-prize-on);
      }

      /* what you bet, then what happened: one fixed-height slot under the
         wheel, so nothing shifts when the result lands */
      .rl-bar {
        flex: none;
        width: 100%;
        display: flex;
        align-items: center;
        gap: 0.5rem;
      }
      .rl-bar > .arc-key {
        flex: none;
        min-width: 3.5rem;
      }
      .rl-readout {
        flex: 1 1 0;
        min-width: 0;
        min-height: 2.75rem;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 0.25rem;
        text-align: center;
      }
      .rl-line {
        margin: 0;
        font-size: 1rem;
        line-height: 1.375rem;
        text-wrap: balance;
        color: var(--tixy-paper);
      }
      .rl-plate {
        display: inline-flex;
        align-items: center;
        gap: 0.75rem;
        margin: 0;
        padding: 0.25rem 0.5rem 0.25rem 1rem;
        border-radius: var(--tixy-radius-panel-sm, 12px);
        background: var(--tixy-ink);
        color: var(--tixy-paper);
        box-shadow: 0 3px 0 rgb(0 0 0 / 0.3);
        white-space: nowrap;
        animation: rl-plate 320ms var(--tixy-ease-spring) 420ms both;
      }
      .rl-plate > span {
        font-size: 1.375rem;
        font-weight: var(--tixy-weight-heading);
        letter-spacing: var(--tixy-tracking-name);
      }
      .rl-plate > b {
        min-width: 2rem;
        padding-right: 0.5rem;
        font-size: 1.5rem;
        text-align: right;
        color: var(--tixy-on-ink-2, #cfc3b0);
      }
      .rl-plate[data-win] {
        background: var(--tixy-red);
      }
      /* a phone has no room for the second line; the receipt has the numbers */
      .rl-plate ~ .rl-line {
        display: none;
        animation: rl-fade 240ms ease-out 560ms both;
      }

      /* a wide screen puts the result beside the wheel */
      @container (min-width: 36rem) {
        .roulette-stage {
          --rl-row: 41px;
          --rl-chip: 20px;
          padding: 0.75rem;
        }
        .rl-top {
          flex-direction: row;
          justify-content: center;
          gap: 2.5rem;
        }
        .rl-wheel-slot {
          flex: 0 1 auto;
          width: auto;
          height: 100%;
          aspect-ratio: 1;
        }
        .rl-plate ~ .rl-line {
          display: block;
        }
        .rl-bar {
          width: 14rem;
        }
        .rl-readout {
          min-height: 0;
          align-items: flex-start;
          text-align: left;
          gap: 0.5rem;
        }
        .rl-plate > span {
          font-size: 1.75rem;
        }
        .rl-plate > b {
          font-size: 1.875rem;
        }
      }

      /* ── Felt board ─────────────────────────────────────────────── */
      .rl-felt {
        flex: none;
        width: 100%;
      }
      /* zero | numbers | 2:1 columns, with the dozens and the even-money
         bets under the numbers, so every bar lines up with the block */
      .rl-board {
        display: grid;
        grid-template-columns: minmax(26px, 5%) 1fr minmax(32px, 7%);
        gap: 4px;
        align-items: stretch;
      }

      /* number cells */
      .rl-cell-num {
        position: relative;
        display: flex;
        align-items: center;
        justify-content: center;
        min-height: 0;
        padding: 0;
        border: 2px solid var(--border-ink);
        border-radius: var(--radius-tag, 6px);
        font-family: var(--font-mono-arcade);
        font-weight: 700;
        font-size: clamp(11px, 2.6cqw, 17px);
        color: #fff;
        cursor: pointer;
        box-shadow: 0 2px 0 #00000060;
        transition: filter 0.12s ease;
        user-select: none;
      }
      .rl-cell-num:hover {
        filter: brightness(1.14);
      }
      .rl-cell-num:active {
        transform: translateY(1px);
        box-shadow: 0 1px 0 #00000060;
      }
      .rl-num-red {
        background: var(--enamel-danger);
        color: var(--enamel-danger-on);
      }
      .rl-num-black {
        background: #15100b;
        color: #f6eddc;
      }
      .rl-num-green {
        background: var(--enamel-prize);
        color: var(--enamel-prize-on);
      }
      .rl-num-label {
        position: relative;
        z-index: 1;
        line-height: 1;
      }

      .rl-zero {
        grid-column: 1;
        grid-row: 1;
      }

      .rl-numbers-wrap {
        position: relative;
        grid-column: 2;
        grid-row: 1;
      }
      .rl-numbers {
        display: grid;
        grid-template-columns: repeat(${FELT_COLUMNS}, 1fr);
        grid-template-rows: repeat(${FELT_ROWS}, var(--rl-row));
        gap: 4px;
      }

      /* A chip sits in the lower part of its cell and the label moves to the
         top, so the two never cover each other. */
      .rl-cell-num[data-chip],
      .rl-cell-out[data-chip] {
        align-items: flex-start;
        padding-top: 2px;
      }

      /* seam hit-zones overlay the number block */
      .rl-seams {
        position: absolute;
        inset: 0;
        pointer-events: none;
      }
      .rl-seam {
        position: absolute;
        transform: translate(-50%, -50%);
        pointer-events: auto;
        border: 0;
        background: transparent;
        padding: 0;
        cursor: pointer;
        z-index: 4;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 999px;
      }
      .rl-seam-h {
        /* horizontal seam between stacked cells */
        width: calc(100% / ${FELT_COLUMNS} - 8px);
        height: 12px;
      }
      .rl-seam-v {
        /* vertical seam between side-by-side cells */
        width: 12px;
        height: calc(100% / ${FELT_ROWS} - 8px);
      }
      .rl-seam-cross {
        width: 16px;
        height: 16px;
      }
      .rl-seam::after {
        content: "";
        position: absolute;
        inset: 0;
        border-radius: inherit;
        background: transparent;
        transition: background 0.12s ease;
      }
      .rl-seam:hover::after {
        background: #ffffff2e;
        box-shadow: 0 0 0 1px #ffffff44 inset;
      }
      .rl-seam-active::after {
        background: #ffffff14;
      }

      /* outside cells (columns, dozens, even-money) */
      .rl-cell-out {
        position: relative;
        display: flex;
        align-items: center;
        justify-content: center;
        height: var(--rl-row);
        padding: 0;
        border: 2px solid var(--border-ink);
        border-radius: var(--radius-tag, 6px);
        background: var(--rl-felt);
        color: var(--text-body);
        font-family: var(--font-display);
        font-size: clamp(9px, 2.1cqw, 14px);
        line-height: 1;
        letter-spacing: 0.02em;
        cursor: pointer;
        box-shadow: 0 2px 0 #00000060;
        transition: filter 0.12s ease;
        user-select: none;
      }
      .rl-cell-out:hover {
        filter: brightness(1.18);
      }
      .rl-cell-out:active {
        transform: translateY(1px);
      }
      .rl-out-red {
        background: var(--enamel-danger);
        color: var(--enamel-danger-on);
      }
      .rl-out-black {
        background: #15100b;
        color: #f6eddc;
      }

      .rl-columns {
        grid-column: 3;
        grid-row: 1;
        display: grid;
        grid-template-rows: repeat(${FELT_ROWS}, var(--rl-row));
        gap: 4px;
      }
      .rl-col2to1 {
        font-family: var(--font-mono-arcade);
        font-weight: 700;
      }

      .rl-dozens {
        grid-column: 2;
        grid-row: 2;
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 4px;
      }
      .rl-outside {
        grid-column: 2;
        grid-row: 3;
        display: grid;
        grid-template-columns: repeat(6, 1fr);
        gap: 4px;
      }

      /* ── Chips ──────────────────────────────────────────────────── */
      .rl-chip-badge {
        position: absolute;
        z-index: 5;
        left: 50%;
        bottom: 1px;
        translate: -50% 0;
        pointer-events: none;
      }
      .rl-zero .rl-chip-badge {
        bottom: 8px;
      }
      /* a chip on a seam sits on the line itself */
      .rl-seam .rl-chip-badge {
        top: 50%;
        bottom: auto;
        translate: -50% -50%;
      }
      .rl-chip {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: var(--rl-chip);
        height: var(--rl-chip);
        border-radius: 999px;
        background: var(--key-face-edge);
        border: 2px solid var(--border-ink);
        box-shadow: 0 2px 0 #000000a0;
        color: var(--key-face-on);
        font-family: var(--font-mono-arcade);
        font-size: calc(var(--rl-chip) * 0.42);
        font-weight: 700;
        line-height: 1;
        letter-spacing: -0.04em;
      }
      .rl-chip-face {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 100%;
        height: 100%;
        border-radius: 999px;
        background: var(--key-face);
        border: 1px dashed var(--key-face-edge);
      }

      /* ── The round's result on the felt ─────────────────────────── */
      /* the winning number */
      .rl-hit {
        outline: 3px solid var(--key-face);
        outline-offset: -1px;
        z-index: 3;
      }
      /* spots that paid */
      .rl-win {
        outline: 3px solid var(--enamel-tickets);
        outline-offset: -1px;
        z-index: 3;
      }
      .rl-seam-won::after {
        background: #ffffff2e;
        box-shadow: 0 0 0 2px var(--enamel-tickets) inset;
      }
      /* once the ball stops: a chip that paid stays and lifts, one that
         didn't is swept up the felt and gone */
      .rl-chip-badge[data-fate="win"] {
        z-index: 6;
        transform-origin: 50% 100%;
        animation: rl-chip-win 320ms var(--tixy-ease-spring) 420ms both;
      }
      .rl-chip-badge[data-fate="win"] .rl-chip {
        box-shadow:
          0 0 0 1.5px var(--enamel-tickets),
          0 3px 0 1px #000000a0;
      }
      .rl-chip-badge[data-fate="lose"] {
        animation: rl-chip-sweep 360ms ease-in 420ms both;
      }

      /* undo and clear, on the machine's deck */
      .rl-felt-tools {
        display: flex;
        gap: 0.5rem;
      }
      .rl-felt-tools > * {
        flex: 1 1 0;
        min-width: 5rem;
      }

      @keyframes rl-pop {
        from {
          transform: scale(0.6);
          opacity: 0;
        }
        to {
          transform: scale(1);
          opacity: 1;
        }
      }
      @keyframes rl-plate {
        from {
          transform: scale(0.6);
          opacity: 0;
        }
        to {
          transform: scale(1);
          opacity: 1;
        }
      }
      @keyframes rl-fade {
        from {
          opacity: 0;
        }
        to {
          opacity: 1;
        }
      }
      @keyframes rl-lit {
        from {
          opacity: 0;
        }
        to {
          opacity: 1;
        }
      }
      @keyframes rl-chip-win {
        to {
          transform: scale(1.1);
        }
      }
      @keyframes rl-chip-sweep {
        to {
          transform: translateY(-16px);
          opacity: 0;
        }
      }

      @media (prefers-reduced-motion: reduce) {
        .rl-hub,
        .rl-plate,
        .rl-plate ~ .rl-line,
        .rl-lit {
          animation: none;
        }
        .rl-chip-badge[data-fate="win"] {
          animation: none;
          transform: scale(1.1);
        }
        .rl-chip-badge[data-fate="lose"] {
          animation: none;
          opacity: 0;
        }
      }
    `}</style>
  );
}
