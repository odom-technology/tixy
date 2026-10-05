"use client";

import {
  useState,
  useCallback,
  useMemo,
  useRef,
  type CSSProperties,
} from "react";
import { Bomb, Diamond } from "lucide-react";
import "./_mines-machine.css";
import { useGamesWallet } from "@/features/arcade/components/shell/games-wallet-provider";
import {
  GameShell,
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
import { MachineLever } from "@/features/arcade/components/wagers/machine-lever";
import { ArcadeWagerResultPlate } from "@/features/arcade/components/results/arcade-run-result";
import {
  useFeelReducedMotion,
  useGameFeedback,
  usePitchLadder,
} from "@/features/arcade/lib/use-game-feedback";
import { useRollingNumber } from "@/features/arcade/lib/use-rolling-number";
import { SoundManager } from "@/features/arcade/lib/sound-manager";
import { playHaptic } from "@/features/arcade/lib/game-haptics";
import { useWagerSession } from "@/features/arcade/lib/use-wager-session";
import { ARCADE_MIN_BET } from "@/server/arcade/arcade-constants";
import { minesCashout } from "@/features/arcade/lib/mines-cashout";

/* ---------- Types ---------- */

type GamePhase = "setup" | "playing" | "won" | "lost";

type TileState = "hidden" | "safe" | "mine";

type RevealResponse = {
  safe?: boolean;
  currentMultiplier?: number;
  minePositions?: number[];
  seed?: number;
  roundId?: string | null;
};

type MinesSettleResponse = {
  payout?: number;
  multiplier?: number;
  seed?: number;
  minePositions?: number[];
  roundId?: string | null;
};

const MINE_COUNT_OPTIONS = [1, 3, 5, 10, 15] as const;
const GRID_SIZE = 25;
/** The gem counts printed on the glass for the chosen mine count. */
const GLASS_GEMS = [1, 2, 3, 5, 10] as const;

const HOW_TO: GameHowTo = {
  lines: [
    "Pick a bet and the mines, press play, then flip tiles.",
    "A mine takes the bet, so cash out before you hit one.",
    "Each gem raises the payout: with 3 mines, 1 gem pays 1.1× and 5 gems pay 1.95×.",
  ],
};

function fmtMult(m: number): string {
  return `${m.toLocaleString("en-US", { maximumFractionDigits: 2 })}×`;
}

/* ---------- Multiplier helpers ---------- */

/** The multiplier the server reports for N gems with M mines: its own
 *  function, through mines-cashout.ts. */
function computeMultiplier(reveals: number, mineCount: number): number {
  return minesCashout(1, reveals, mineCount).multiplier;
}

/* ---------- Component ---------- */

export default function MinesClient() {
  const boardRef = useRef<HTMLDivElement>(null);
  const { trigger: triggerFeedback } = useGameFeedback({ stage: boardRef });
  /* Each gem in a run is a semitone higher; a mine or a new round resets it. */
  const ladder = usePitchLadder();
  /* -- wallet -- */
  const {
    wallet,
    loaded: walletLoaded,
    refresh: refreshWallet,
    adjustCredits,
  } = useGamesWallet();
  const balance = walletLoaded ? wallet.credits : null;

  /* -- game state -- */
  const [phase, setPhase] = useState<GamePhase>("setup");

  /* -- setup -- */
  const [mineCount, setMineCount] = useState<number>(3);
  const [wager, setWager] = useMachineBet(balance, 10, {
    locked: phase === "playing",
  });
  /* The stake the open round was bought with; the receipt prints it. */
  const [roundStake, setRoundStake] = useState(0);
  const [roundId, setRoundId] = useState<string | null>(null);
  const [tiles, setTiles] = useState<TileState[]>(
    Array(GRID_SIZE).fill("hidden"),
  );
  const [revealedCount, setRevealedCount] = useState(0);
  const [currentMultiplier, setCurrentMultiplier] = useState(1);
  const [, setMinePositions] = useState<number[]>([]);
  const [payout, setPayout] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [isRevealing, setIsRevealing] = useState(false);
  /* The tile the player actually struck — gets the explosion blast; the rest
     of the minefield is revealed quietly so the hit reads clearly. */
  const [hitIndex, setHitIndex] = useState<number | null>(null);
  /* The picked tile awaiting the server's verdict — it "arms" so the click
     reads as registered during the reveal round-trip. */
  const [pendingIndex, setPendingIndex] = useState<number | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  /* The lever stays on the machine while its arm swings back, after a pull
     has already settled the round. */
  const [leverSwinging, setLeverSwinging] = useState(false);
  const reducedMotion = useFeelReducedMotion();

  /* -- in-flight guards (synchronous, unlike state) so a double-tap or a
     Space + click pair can never double-fire a wager action -- */
  const startInFlightRef = useRef(false);
  const cashoutInFlightRef = useRef(false);

  /* -- session / provably fair -- */
  const {
    revealedSeed,
    setRevealedSeed,
    start: startSession,
    action: sessionAction,
    settle: settleSession,
    achievements,
  } = useWagerSession("arcade-mines");

  /* ---------- Start game ---------- */
  const handleStartGame = useCallback(async () => {
    triggerFeedback("press", { haptic: true });
    if (startInFlightRef.current) return;
    if (balance == null) return;
    startInFlightRef.current = true;
    setError(null);

    if (wager > balance) {
      setError(`You need ${wager} tickets for this bet.`);
      startInFlightRef.current = false;
      return;
    }

    setIsStarting(true);
    try {
      const session = await startSession(wager, { mineCount });
      if (!session.ok) {
        setError(
          machineError(session.error, "The machine could not start the round. Try again."),
        );
        return;
      }

      ladder.reset();

      // Reset grid
      setTiles(Array(GRID_SIZE).fill("hidden"));
      setRevealedCount(0);
      setCurrentMultiplier(1);
      setMinePositions([]);
      setPayout(0);
      setHitIndex(null);
      setRoundStake(wager);
      setRoundId(null);
      setPhase("playing");

      // Optimistically debit wallet
      adjustCredits(-wager);
    } catch {
      setError("The machine lost its connection. Try again.");
    } finally {
      startInFlightRef.current = false;
      setIsStarting(false);
    }
  }, [
    wager,
    mineCount,
    balance,
    startSession,
    adjustCredits,
    triggerFeedback,
    ladder,
  ]);

  /* ---------- Reveal tile ---------- */
  const handleReveal = useCallback(
    async (index: number) => {
      if (phase !== "playing" || tiles[index] !== "hidden" || isRevealing)
        return;

      // Press-time feedback: the pick registers now, the outcome lands
      // with the server response below.
      triggerFeedback("press", { haptic: true });
      setIsRevealing(true);
      setPendingIndex(index);
      setError(null);

      try {
        const revealed = await sessionAction<RevealResponse>("reveal", {
          data: { tile: index },
        });
        if (!revealed.ok) {
          setError(
            machineError(revealed.error, "The tile did not flip. Try again."),
          );
          setIsRevealing(false);
          setPendingIndex(null);
          return;
        }
        const data = revealed.data;

        if (data.safe) {
          // Safe tile: each gem in the run rings a semitone higher.
          triggerFeedback("collect", { pitch: ladder.next(), haptic: true });
          setTiles((prev) => {
            const next = [...prev];
            next[index] = "safe";
            return next;
          });
          const newRevealed = revealedCount + 1;
          setRevealedCount(newRevealed);
          const mult =
            data.currentMultiplier ?? computeMultiplier(newRevealed, mineCount);
          setCurrentMultiplier(mult);
        } else {
          // Hit a mine: the board shakes on the blast, then the loss lands.
          ladder.reset();
          SoundManager.play("arcadeExplode");
          triggerFeedback("impact", { sound: false, shake: 1, haptic: true });
          setHitIndex(index);
          setTiles((prev) => {
            const next = [...prev];
            next[index] = "mine";
            // Reveal all mine positions
            if (data.minePositions) {
              (data.minePositions as number[]).forEach((mp) => {
                if (next[mp] === "hidden") next[mp] = "mine";
              });
            }
            return next;
          });
          setMinePositions(data.minePositions ?? []);
          setRevealedSeed(data.seed ?? null);
          setRoundId(data.roundId ?? null);
          setPayout(0);
          setPhase("lost");
          triggerFeedback("loss", { sound: false });
        }
      } catch {
        setError("The machine lost its connection. Try the tile again.");
      } finally {
        setIsRevealing(false);
        setPendingIndex(null);
      }
    },
    [
      phase,
      tiles,
      isRevealing,
      revealedCount,
      mineCount,
      sessionAction,
      setRevealedSeed,
      triggerFeedback,
      ladder,
    ],
  );

  /* ---------- Cash out ---------- */
  const handleCashout = useCallback(async () => {
    if (phase !== "playing" || cashoutInFlightRef.current) return;
    triggerFeedback("press", { haptic: true });
    cashoutInFlightRef.current = true;
    setError(null);

    try {
      const settled = await settleSession<MinesSettleResponse>();
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
      const finalMult = data.multiplier ?? currentMultiplier;
      setPayout(data.payout ?? Math.floor(roundStake * currentMultiplier));
      setCurrentMultiplier(finalMult);
      setRoundId(data.roundId ?? null);

      // Reveal all mine positions on cashout
      if (data.minePositions && Array.isArray(data.minePositions)) {
        setMinePositions(data.minePositions as number[]);
        setTiles((prev) => {
          const next = [...prev];
          for (const mp of data.minePositions as number[]) {
            if (next[mp] === "hidden") next[mp] = "mine";
          }
          return next;
        });
      }

      setPhase("won");
      ladder.reset();
      triggerFeedback("cashout", { haptic: true });
      triggerFeedback(finalMult >= 5 ? "jackpot" : "round-win");
      void refreshWallet();
    } catch {
      setError("The machine lost its connection. Try the cash out again.");
    } finally {
      cashoutInFlightRef.current = false;
    }
  }, [
    phase,
    roundStake,
    currentMultiplier,
    refreshWallet,
    settleSession,
    triggerFeedback,
    ladder,
  ]);

  /* ---------- Keyboard: Space starts a round, never cashes out ---------- */
  useMachineKey(
    useMemo(
      () => (phase === "playing" ? null : () => void handleStartGame()),
      [phase, handleStartGame],
    ),
  );

  /* ---------- Computed values ---------- */
  const playing = phase === "playing";
  /* What a cash-out pays now and after the next gem, with the server's own
     multiplier and rounding. A payout with a fraction (10 on 1.25× is 12.5)
     is rounded up or down by a roll of the round's secret seed, so before
     the cash-out the readout prints the lower whole number as "at least";
     the cash-out then shows exactly what was paid (mines-cashout.ts). */
  const nowCashout = minesCashout(roundStake, revealedCount, mineCount);
  const nextCashout = minesCashout(playing ? roundStake : wager, revealedCount + 1, mineCount);
  const potentialWin = nowCashout.low.toLocaleString();
  const nextMultiplier = nextCashout.multiplier;
  const safeTilesRemaining = GRID_SIZE - mineCount - revealedCount;
  const affordable = balance != null && wager <= balance;
  const minesLabel = `${mineCount} ${mineCount === 1 ? "mine" : "mines"}`;
  /* The next gem is the one thing the player decides on: it rolls up when
     a gem lands, and again if the bet or the mine count changes. */
  const shownNextMult = useRollingNumber(nextMultiplier, {
    duration: 320,
    decimals: 2,
  });
  const shownNextLow = useRollingNumber(nextCashout.low, { duration: 320 });
  const shownNowMult = useRollingNumber(currentMultiplier, {
    duration: 320,
    decimals: 2,
  });
  const shownNowLow = useRollingNumber(nowCashout.low, { duration: 320 });
  const safeLeft = safeTilesRemaining > 0;

  /* ---------- Render ---------- */
  const statusLine =
    phase === "setup"
      ? ""
      : playing
        ? revealedCount === 0
          ? "Flip a tile."
          : `${fmtMult(currentMultiplier)} now, ${nowCashout.high > nowCashout.low ? "at least " : ""}${nowCashout.low} tickets. Next gem pays ${fmtMult(nextMultiplier)}.`
        : phase === "won"
          ? `Cashed out at ${fmtMult(currentMultiplier)}. ${payout.toLocaleString()} tickets.`
          : `Mine after ${revealedCount} ${revealedCount === 1 ? "gem" : "gems"}. You lose ${roundStake.toLocaleString()} tickets.`;

  const glassRows = GLASS_GEMS.filter(
    (gems) => gems <= GRID_SIZE - mineCount,
  ).map((gems) => ({
    label: `${gems} ${gems === 1 ? "gem" : "gems"}`,
    value: fmtMult(computeMultiplier(gems, mineCount)),
    lit: (playing || phase === "won") && revealedCount === gems,
  }));

  const glass = (
    <MachineGlass
      name="mines"
      rules={["Cash out before you hit a mine."]}
      paytable={glassRows}
    />
  );

  /* One field for every phase: the cabinet playfield never disappears.
     Each covered square flips to an amber gem or a red mine. */
  const screen = (
    <div className="arc-machine-fit mines-stage">
      <p role="status" className="sr-only">
        {statusLine}
      </p>

      {/* What the next safe pick pays, every time, before the pick. */}
      <div className="mines-pays" aria-hidden>
        {playing && revealedCount > 0 && (
          <div className="mines-pay" data-kind="now">
            <span className="mines-pay-label">now</span>
            <span className="mines-pay-mult arcade-num">
              {fmtMult(shownNowMult)}
            </span>
            <CashoutWin low={shownNowLow} atLeast={nowCashout.high > nowCashout.low} />
          </div>
        )}
        {(phase === "setup" || (playing && safeLeft)) && (
          <div className="mines-pay" data-kind="next">
            <span className="mines-pay-label">
              {revealedCount === 0 ? "first gem" : "next gem"}
            </span>
            <span className="mines-pay-mult arcade-num">
              {fmtMult(shownNextMult)}
            </span>
            <CashoutWin low={shownNextLow} atLeast={nextCashout.high > nextCashout.low} />
          </div>
        )}
        {phase === "won" && (
          <div className="mines-pay" data-kind="won">
            <span className="mines-pay-label">cashed out</span>
            <span className="mines-pay-mult arcade-num">
              {fmtMult(currentMultiplier)}
            </span>
            <span className="mines-pay-stub arcade-num">
              +{payout.toLocaleString()}
            </span>
          </div>
        )}
        {phase === "lost" && (
          <div className="mines-pay" data-kind="lost">
            <span className="mines-pay-label">
              {revealedCount === 0
                ? "mine on the first tile"
                : `mine after ${revealedCount} ${revealedCount === 1 ? "gem" : "gems"}`}
            </span>
            <span className="mines-pay-mult arcade-num">
              {"\u2212"}
              {roundStake.toLocaleString()}
            </span>
          </div>
        )}
      </div>

      <div className="mines-board" ref={boardRef}>
        {tiles.map((tile, i) => {
          const isHit = tile === "mine" && hitIndex === i;
          const interactive = playing && tile === "hidden";
          const stagger = (i % 5) * 38 + Math.floor(i / 5) * 26;
          const flipDelay =
            tile === "mine" && !isHit ? stagger + (hitIndex != null ? 240 : 0) : 0;
          return (
            <button
              key={i}
              type="button"
              onClick={() => handleReveal(i)}
              disabled={!playing || tile !== "hidden"}
              aria-disabled={isRevealing || undefined}
              aria-label={
                tile === "safe"
                  ? "gem"
                  : tile === "mine"
                    ? "mine"
                    : pendingIndex === i
                      ? `tile ${i + 1}, flipping`
                      : `tile ${i + 1}`
              }
              className="mines-tile"
              data-state={tile}
              data-hit={isHit || undefined}
              data-pending={pendingIndex === i || undefined}
              data-idle={(!interactive && tile === "hidden") || undefined}
              style={{ "--flip-delay": `${flipDelay}ms` } as CSSProperties}
            >
              <span className="mines-flipper" aria-hidden>
                <span className="mines-cover" />
                <span className="mines-face">
                  {tile === "safe" && (
                    <Diamond size={26} fill="currentColor" strokeWidth={1.5} strokeLinecap="square" />
                  )}
                  {tile === "mine" && <Bomb size={26} strokeWidth={2} strokeLinecap="square" />}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );

  /* Cash out is a lever. It is still a button for keyboards and screen
     readers; Space never pulls it (useMachineKey above has no action while
     a round plays). */
  const action = playing || leverSwinging ? (
    <MachineLever
      onPull={() => {
        if (!reducedMotion) {
          setLeverSwinging(true);
          window.setTimeout(() => setLeverSwinging(false), 520);
        }
        void handleCashout();
      }}
      disabled={revealedCount === 0}
      aria-disabled={isRevealing || !playing || undefined}
      detail={
        revealedCount > 0 ? (
          <>
            {nowCashout.high > nowCashout.low && (
              <span className="mines-lever-least">at least </span>
            )}
            {nowCashout.low.toLocaleString()}
          </>
        ) : undefined
      }
      aria-label={
        revealedCount === 0
          ? "cash out, flip a tile first"
          : `cash out ${nowCashout.high > nowCashout.low ? "at least " : ""}${potentialWin} tickets, pull the lever`
      }
    >
      cash out
    </MachineLever>
  ) : (
    <MachineButton
      onClick={() => void handleStartGame()}
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
        }}
        kicker="mines"
        headline={phase === "won" ? fmtMult(currentMultiplier) : "mine"}
        detail={`${minesLabel}, ${revealedCount} ${revealedCount === 1 ? "gem" : "gems"}`}
        fairness={{ seedHash: null, revealedSeed }}
        achievements={achievements}
        roundId={roundId ?? undefined}
        sound={false}
      />
    ) : null;

  return (
    <GameShell
      game="mines"
      howTo={HOW_TO}
    >
      <ArcadeMachine
        name="mines"
        glass={glass}
        action={action}
        bet={{
          value: wager,
          onChange: setWager,
          balance,
          disabled: playing,
        }}
        controls={
          <MachineChoice
            label="mines"
            options={MINE_COUNT_OPTIONS.map((count) => ({
              value: count,
              label: <span className="arcade-num">{count}</span>,
            }))}
            value={mineCount}
            onChange={(count) => {
              setMineCount(count);
              playHaptic("light");
            }}
            disabled={playing}
          />
        }
        receipt={receipt}
        receiptKey={roundId}
        notice={error}
      >
        {screen}
      </ArcadeMachine>
    </GameShell>
  );
}

/** A cash-out in tickets for the readout: "14", or "at least 14" when the
 *  server's rounding can go either way. The number is Big Shoulders, the
 *  words are not. */
function CashoutWin({ low, atLeast }: { low: number; atLeast: boolean }) {
  return (
    <span className="mines-pay-win">
      {atLeast ? <span className="mines-pay-least">at least </span> : null}
      <span className="arcade-num">{low.toLocaleString()}</span>
    </span>
  );
}
