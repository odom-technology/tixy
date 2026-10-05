"use client";

import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
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
import { useGameFeedback } from "@/features/arcade/lib/use-game-feedback";
import {
  PlayingCardFace,
  PlayingCardDeck,
} from "@/features/arcade/components/ui/playing-card";
import { SoundManager } from "@/features/arcade/lib/sound-manager";
import { useWagerSession } from "@/features/arcade/lib/use-wager-session";
import { ARCADE_MIN_BET } from "@/server/arcade/arcade-constants";

/* ---------- Constants (mirror server) ---------- */

const MIN_RANK = 2;
const MAX_RANK = 14;
const RANK_COUNT = MAX_RANK - MIN_RANK + 1; // 13
const RTP = 0.97;
/** The server caps the cumulative payout (HILO_MAX_MULTIPLIER). */
const TOP_MULTIPLIER = 500;

const HOW_TO: GameHowTo = {
  lines: [
    "Pick a bet, deal a card, then call the next card higher or lower.",
    "A tie counts as a win; a wrong call takes the bet, so cash out any time after a win.",
    "A call pays 0.97 over its chance (7 in 13 pays 1.8×), and up to 20 calls multiply, to at most 500×.",
  ],
};

/** The call chances printed on the glass, out of 13 ranks. */
const GLASS_ODDS = [12, 7, 4, 1] as const;

function fmtMult(m: number): string {
  return `${m.toFixed(2)}×`;
}

/** A rank in a sentence: "the 3", "the queen". */
function rankName(rank: number): string {
  const named: Record<number, string> = {
    11: "jack",
    12: "queen",
    13: "king",
    14: "ace",
  };
  return `the ${named[rank] ?? rank}`;
}

/** Animation tuning (ms). */
const FLIP_DURATION = 520;
const REVEAL_HOLD = 650;
const BUST_HOLD = 900;

/* ---------- Types ---------- */

type Suit = 0 | 1 | 2 | 3;
type Card = { rank: number; suit: Suit };
type GamePhase = "setup" | "playing" | "won" | "lost";
type Guess = "higher" | "lower";

type HiLoChoice = {
  guess: Guess;
  result: "win" | "lose";
};

type GuessResponse = {
  drawnCard: Card;
  result: HiLoChoice["result"];
  alive?: boolean;
  cumulativeMultiplier?: number;
  chainComplete?: boolean;
  payout?: number;
  seed?: number;
  roundId?: string | null;
};

type PendingReveal = {
  card: Card;
  guess: Guess;
  /** 'dealing' = card is flipping in face-down → face-up */
  /** 'revealed' = card is face-up, showing glow, waiting to commit */
  stage: "dealing" | "revealed";
  outcome: "win" | "lose";
  wasTie: boolean;
};

/* ---------- Card helpers ---------- */

function winChanceHigher(currentRank: number): number {
  return (MAX_RANK - currentRank + 1) / RANK_COUNT;
}

function winChanceLower(currentRank: number): number {
  return (currentRank - MIN_RANK + 1) / RANK_COUNT;
}

function stepMultiplier(currentRank: number, guess: Guess): number {
  const p =
    guess === "higher"
      ? winChanceHigher(currentRank)
      : winChanceLower(currentRank);
  if (p <= 0) return 0;
  return Math.floor((RTP / p) * 100) / 100;
}

/* ---------- Animated multiplier ---------- */

function useCountUp(target: number, durationMs = 350): number {
  const [display, setDisplay] = useState(target);
  const fromRef = useRef(target);
  const startRef = useRef<number>(0);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    fromRef.current = display;
    startRef.current = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - startRef.current) / durationMs);
      const eased = 1 - Math.pow(1 - t, 3); // easeOutCubic
      const val = fromRef.current + (target - fromRef.current) * eased;
      setDisplay(val);
      if (t < 1) rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafRef.current);
    // `display` is the tween's start snapshot (read into fromRef above);
    // depending on it would restart the count-up on every frame it advances.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, durationMs]);

  return display;
}

/* ---------- Component ---------- */

export default function HiLoClient() {
  const { trigger: triggerFeedback } = useGameFeedback();
  const {
    wallet,
    loaded: walletLoaded,
    refresh: refreshWallet,
    adjustCredits,
  } = useGamesWallet();
  const balance = walletLoaded ? wallet.credits : null;

  const [phase, setPhase] = useState<GamePhase>("setup");
  const [wager, setWager] = useMachineBet(balance, 10, {
    locked: phase === "playing",
  });
  /* The stake the open chain was bought with; the receipt prints it. */
  const [roundStake, setRoundStake] = useState(0);
  const [roundId, setRoundId] = useState<string | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const startInFlightRef = useRef(false);
  const [currentCard, setCurrentCard] = useState<Card | null>(null);
  const [dealInAnim, setDealInAnim] = useState(false);
  const [pending, setPending] = useState<PendingReveal | null>(null);
  const [chain, setChain] = useState<HiLoChoice[]>([]);
  const [currentMultiplier, setCurrentMultiplier] = useState(0);
  const [mostRecentlyDrawn, setMostRecentlyDrawn] = useState<Card | null>(null);
  const [payout, setPayout] = useState(0);
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tableShake, setTableShake] = useState(false);

  const timeoutRefs = useRef<ReturnType<typeof setTimeout>[]>([]);
  const {
    revealedSeed,
    setRevealedSeed,
    start: startSession,
    action: sessionAction,
    settle: settleSession,
    achievements,
  } = useWagerSession("arcade-hilo");

  /* Counts up from 1×, the bet back, so a first call never reads 0.00×. */
  const displayMultiplier = useCountUp(currentMultiplier > 0 ? currentMultiplier : 1);

  /* Clear any pending timers when unmounting. */
  useEffect(() => {
    const ref = timeoutRefs.current;
    return () => {
      ref.forEach((t) => clearTimeout(t));
    };
  }, []);

  const queueTimeout = useCallback((fn: () => void, ms: number) => {
    const t = setTimeout(() => {
      timeoutRefs.current = timeoutRefs.current.filter((x) => x !== t);
      fn();
    }, ms);
    timeoutRefs.current.push(t);
  }, []);

  const clearQueuedTimeouts = useCallback(() => {
    timeoutRefs.current.forEach((t) => clearTimeout(t));
    timeoutRefs.current = [];
  }, []);

  /* ---------- Start ---------- */
  const handleStart = useCallback(async () => {
    if (startInFlightRef.current || balance == null) return;
    setError(null);
    if (wager > balance) {
      setError(`You need ${wager} tickets for this bet.`);
      return;
    }
    startInFlightRef.current = true;
    setIsStarting(true);
    try {
      const session = await startSession(wager, {});
      if (!session.ok) {
        setError(
          machineError(session.error, "The machine could not start the round."),
        );
        return;
      }

      const peek = await sessionAction<{ startingCard?: Card }>("peek");
      if (!peek.ok) {
        setError(
          machineError(peek.error, "The first card did not deal. Try again."),
        );
        return;
      }

      SoundManager.play("arcadeBet");
      clearQueuedTimeouts();
      setCurrentCard(peek.data.startingCard ?? null);
      setDealInAnim(true);
      queueTimeout(() => setDealInAnim(false), FLIP_DURATION + 60);
      setPending(null);
      setMostRecentlyDrawn(null);
      setChain([]);
      setCurrentMultiplier(0);
      setPayout(0);
      setTableShake(false);
      setIsBusy(false);
      setRoundStake(wager);
      setRoundId(null);
      setPhase("playing");

      adjustCredits(-wager);
    } catch {
      setError("The machine lost its connection. Try again.");
    } finally {
      startInFlightRef.current = false;
      setIsStarting(false);
    }
  }, [
    wager,
    balance,
    queueTimeout,
    clearQueuedTimeouts,
    startSession,
    sessionAction,
    adjustCredits,
  ]);

  /* ---------- Guess (animated) ---------- */
  const handleGuess = useCallback(
    async (guess: Guess) => {
      if (phase !== "playing" || isBusy || !currentCard || pending) return;
      setIsBusy(true);
      setError(null);
      try {
        const guessed = await sessionAction<GuessResponse>("guess", {
          data: { guess },
        });
        if (!guessed.ok) {
          setError(
            machineError(guessed.error, "The call did not go through. Try again."),
          );
          setIsBusy(false);
          return;
        }
        const data = guessed.data;

        const drawn = data.drawnCard;
        const result = data.result;
        const wasTie = drawn.rank === currentCard.rank;
        const outcome: "win" | "lose" = data.alive ? "win" : "lose";
        const serverMult =
          typeof data.cumulativeMultiplier === "number"
            ? data.cumulativeMultiplier
            : 0;

        // Stage 1: card is flipping in face-down → face-up.
        setPending({ card: drawn, guess, stage: "dealing", outcome, wasTie });
        SoundManager.play("arcadeReveal");

        // Stage 2: card is face-up, result glow shows.
        queueTimeout(() => {
          setPending((prev) => (prev ? { ...prev, stage: "revealed" } : prev));
          if (outcome === "win") {
            SoundManager.play(serverMult >= 5 ? "arcadeBigWin" : "arcadeWin");
          } else {
            triggerFeedback("loss");
            setTableShake(true);
            queueTimeout(() => setTableShake(false), 500);
          }
        }, FLIP_DURATION);

        // Stage 3: commit the outcome.
        queueTimeout(
          () => {
            setChain((prev) => [...prev, { guess, result }]);
            setMostRecentlyDrawn(drawn);

            if (outcome === "win") {
              setCurrentCard(drawn);
              setCurrentMultiplier(serverMult);
              setPending(null);
              setIsBusy(false);
              if (data.chainComplete) {
                setPayout(data.payout ?? 0);
                setRevealedSeed(data.seed ?? null);
                setRoundId(data.roundId ?? null);
                setPhase("won");
                void refreshWallet();
              }
            } else {
              // The card you called from stays on the left; the draw that
              // beat it sits on the right (mostRecentlyDrawn, set above).
              setCurrentMultiplier(0);
              setPayout(0);
              setRevealedSeed(data.seed ?? null);
              setRoundId(data.roundId ?? null);
              setPending(null);
              setPhase("lost");
              setIsBusy(false);
            }
          },
          outcome === "win"
            ? FLIP_DURATION + REVEAL_HOLD
            : FLIP_DURATION + BUST_HOLD,
        );
      } catch {
        setError("The machine lost its connection. Try the call again.");
        setIsBusy(false);
      }
    },
    [
      phase,
      isBusy,
      currentCard,
      pending,
      queueTimeout,
      refreshWallet,
      sessionAction,
      setRevealedSeed,
      triggerFeedback,
    ],
  );

  /* ---------- Cashout ---------- */
  const handleCashout = useCallback(async () => {
    if (
      phase !== "playing" ||
      chain.length === 0 ||
      currentMultiplier <= 0 ||
      pending
    )
      return;
    setError(null);
    try {
      const settled = await settleSession<{
        payout?: number;
        multiplier?: number;
        seed?: number;
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
      setCurrentMultiplier(data.multiplier ?? currentMultiplier);
      setRoundId(data.roundId ?? null);
      setPhase("won");
      triggerFeedback("cashout");
      void refreshWallet();
    } catch {
      setError("The machine lost its connection. Try the cash out again.");
    }
  }, [
    phase,
    chain.length,
    roundStake,
    currentMultiplier,
    pending,
    refreshWallet,
    settleSession,
    triggerFeedback,
  ]);

  /* ---------- Computed ---------- */
  const higherMult = currentCard
    ? stepMultiplier(currentCard.rank, "higher")
    : 0;
  const lowerMult = currentCard ? stepMultiplier(currentCard.rank, "lower") : 0;
  const higherChance = currentCard ? winChanceHigher(currentCard.rank) : 0;
  const lowerChance = currentCard ? winChanceLower(currentCard.rank) : 0;
  const potentialWin = Math.floor(roundStake * currentMultiplier);

  const guessDisabled = isBusy || pending !== null;
  const playing = phase === "playing";
  const canCashOut = playing && chain.length > 0 && currentMultiplier > 0;
  const affordable = balance != null && wager <= balance;

  const wins = chain.filter((c) => c.result === "win").length;

  /* ---------- Keyboard: Space deals, never cashes out ---------- */
  useMachineKey(
    useMemo(
      () => (playing ? null : () => void handleStart()),
      [playing, handleStart],
    ),
  );

  /* What the table shows: the card you called from on the left, the call
     between, the card that came on the right. A loss keeps all three. */
  const lastGuess = chain.length > 0 ? chain[chain.length - 1].guess : null;
  const callShown = pending?.guess ?? (phase === "lost" ? lastGuess : null);
  const rightCard =
    pending?.card ?? (phase === "lost" ? mostRecentlyDrawn : null);
  const rightGlow: "win" | "lose" | undefined = pending
    ? pending.stage === "revealed"
      ? pending.outcome
      : undefined
    : phase === "lost"
      ? "lose"
      : undefined;
  const leftCard = phase === "setup" ? null : currentCard;

  /* One sentence under the table, only when something needs saying. While
     you are calling, the odds are on the buttons (and in their labels). */
  const statusLine =
    phase === "setup"
      ? "Deal a card, then call the next one higher or lower."
      : pending?.stage === "revealed" &&
          pending.outcome === "win" &&
          pending.wasTie
        ? "A tie, which counts as a win."
        : phase === "lost" && currentCard && mostRecentlyDrawn && lastGuess
          ? `Called ${lastGuess} on ${rankName(currentCard.rank)}. The next card was ${rankName(mostRecentlyDrawn.rank)}.`
          : "";
  const srLine =
    statusLine ||
    (playing && currentCard
      ? `Higher pays ${fmtMult(higherMult)} at ${(higherChance * 100).toFixed(0)}%. Lower pays ${fmtMult(lowerMult)} at ${(lowerChance * 100).toFixed(0)}%.`
      : phase === "won"
        ? `Cashed out at ${fmtMult(currentMultiplier)} after ${wins} ${wins === 1 ? "win" : "wins"}.`
        : "");

  const screen = (
    <div
      className={`arc-machine-fit hilo-screen ${
        tableShake ? "animate-[hiloShake_0.5s_ease-in-out]" : ""
      }`}
    >
      <div className="hilo-status">
        <p
          role="status"
          className={statusLine ? "arc-machine-status" : "sr-only"}
        >
          {srLine}
        </p>
      </div>

      {/* What you have riding: your bet until a call wins, then the
          multiplier and the tickets it pays. */}
      {phase !== "setup" && (
        <div className="hilo-readout" data-kind={phase} aria-hidden>
          <span className="hilo-readout-label">
            {phase === "won"
              ? "cashed out"
              : phase === "lost"
                ? "wrong call"
                : wins === 0
                  ? "your bet"
                  : `${wins} ${wins === 1 ? "win" : "wins"} in a row`}
          </span>
          {phase === "playing" && wins === 0 ? (
            <span className="hilo-readout-num hilo-tix arcade-num">
              {roundStake.toLocaleString()}
            </span>
          ) : phase === "lost" ? (
            <span className="hilo-readout-num arcade-num">0×</span>
          ) : (
            <>
              <span className="hilo-readout-num arcade-num">
                {fmtMult(phase === "won" ? currentMultiplier : displayMultiplier)}
              </span>
              <span className="hilo-readout-win hilo-tix arcade-num">
                {(phase === "won" ? payout : potentialWin).toLocaleString()}
              </span>
            </>
          )}
        </div>
      )}

      {/* The table: the card you call from, your call, the next card. */}
      <div className="hilo-table" data-setup={phase === "setup" || undefined}>
        {phase === "setup" || !leftCard ? (
          <Deck />
        ) : (
          <>
            <div
              key={wins}
              className={wins > 0 && phase === "playing" ? "hilo-shift" : ""}
            >
              <CardFace
                card={leftCard}
                dealIn={dealInAnim && !pending}
                glow={phase === "won" ? "win" : undefined}
              />
            </div>

            <div className="hilo-call" data-on={callShown ? "" : undefined}>
              {callShown === "higher" && <ArrowUp size={22} strokeWidth={3} />}
              {callShown === "lower" && <ArrowDown size={22} strokeWidth={3} />}
              <span>{callShown ?? ""}</span>
            </div>

            {rightCard ? (
              <CardFace card={rightCard} dealIn={!!pending} glow={rightGlow} />
            ) : (
              <div className="hilo-next" data-spent={phase === "won" || undefined}>
                <Deck />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );

  const glass = (
    <MachineGlass
      name="hi-lo"
      rules={[
        "Call the next card higher or lower. A tie wins; a wrong call takes the bet.",
      ]}
      paytable={[
        ...GLASS_ODDS.map((k) => ({
          label: `${k} in ${RANK_COUNT}`,
          value: fmtMult(Math.floor((RTP / (k / RANK_COUNT)) * 100) / 100),
        })),
        { label: "top", value: `${TOP_MULTIPLIER}×` },
      ]}
    />
  );

  const action = playing ? (
    <>
      <MachineButton
        onClick={() => void handleGuess("higher")}
        aria-disabled={guessDisabled || undefined}
        aria-label={`higher, pays ${fmtMult(higherMult)} at ${(higherChance * 100).toFixed(0)} percent`}
      >
        <span className="hilo-btn">
          higher
          <span className="hilo-btn-odds arcade-num">
            {fmtMult(higherMult)} · {(higherChance * 100).toFixed(0)}%
          </span>
        </span>
      </MachineButton>
      <MachineButton
        onClick={() => void handleGuess("lower")}
        aria-disabled={guessDisabled || undefined}
        aria-label={`lower, pays ${fmtMult(lowerMult)} at ${(lowerChance * 100).toFixed(0)} percent`}
      >
        <span className="hilo-btn">
          lower
          <span className="hilo-btn-odds arcade-num">
            {fmtMult(lowerMult)} · {(lowerChance * 100).toFixed(0)}%
          </span>
        </span>
      </MachineButton>
      <MachineButton
        second
        onClick={() => void handleCashout()}
        disabled={!canCashOut}
        aria-disabled={guessDisabled || undefined}
        aria-label={
          canCashOut
            ? `cash out ${potentialWin} tickets`
            : "cash out, win a call first"
        }
      >
        <span className="hilo-btn">
          cash out
          {canCashOut && (
            <span className="hilo-btn-odds hilo-tix arcade-num">
              {potentialWin.toLocaleString()}
            </span>
          )}
        </span>
      </MachineButton>
    </>
  ) : (
    <MachineButton
      onClick={() => void handleStart()}
      disabled={!affordable || wager < ARCADE_MIN_BET}
      aria-disabled={isStarting || undefined}
      aria-label={`deal, ${wager} tickets`}
    >
      deal
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
        kicker="hi-lo"
        headline={phase === "won" ? fmtMult(currentMultiplier) : "wrong call"}
        detail={`${wins} ${wins === 1 ? "win" : "wins"} in a row`}
        fairness={{ seedHash: null, revealedSeed }}
        achievements={achievements}
        roundId={roundId ?? undefined}
        sound={false}
      />
    ) : null;

  return (
    <GameShell
      game="hilo"
      stat={<GameStat value={`${TOP_MULTIPLIER}×`} label="top" />}
      howTo={HOW_TO}
    >
      <ArcadeMachine
        name="hi-lo"
        glass={glass}
        action={action}
        bet={{
          value: wager,
          onChange: setWager,
          balance,
          disabled: playing,
        }}
        receipt={receipt}
        receiptKey={roundId}
        notice={error}
      >
        {screen}
      </ArcadeMachine>

      {/* ─── Keyframes ─── */}
      <style jsx global>{`
        /* phones: room for the multiplier and two cards */
        .arc-shell[data-game="hilo"] .arc-machine-frame:not([data-wide]) {
          --machine-screen-min: 22rem;
        }
        @keyframes hiloShake {
          0%,
          100% {
            transform: translateX(0);
          }
          15% {
            transform: translateX(-6px);
          }
          30% {
            transform: translateX(6px);
          }
          45% {
            transform: translateX(-4px);
          }
          60% {
            transform: translateX(4px);
          }
          75% {
            transform: translateX(-2px);
          }
          90% {
            transform: translateX(2px);
          }
        }
        /* Reveal = a hard enamel STAMP. A solid-colored beveled ring snaps
           onto the card and settles — depth, not glow. */
        .hilo-stamp {
          position: relative;
          border-radius: 1rem;
        }
        .hilo-stamp::after {
          content: "";
          position: absolute;
          inset: -4px;
          border-radius: 1.1rem;
          pointer-events: none;
          border: 3px solid var(--_stamp);
          box-shadow:
            inset 0 1px 0 #ffffff35,
            0 3px 0 var(--border-ink),
            0 5px 10px #00000055;
          animation: hiloStamp 0.42s
            var(--ease-spring, cubic-bezier(0.34, 1.56, 0.64, 1)) both;
        }
        .hilo-stamp-win {
          --_stamp: var(--tixy-red);
        }
        /* A loss goes quiet: a grey ring and a dimmed card, never red. */
        .hilo-stamp-lose {
          --_stamp: var(--tixy-on-ink-3);
          filter: brightness(0.72);
        }
        @keyframes hiloStamp {
          0% {
            transform: scale(1.18);
            opacity: 0;
          }
          60% {
            transform: scale(0.97);
            opacity: 1;
          }
          100% {
            transform: scale(1);
            opacity: 1;
          }
        }
        /* The card width comes from the screen, so two cards and the call
           between them fit a phone and fill a wide screen. */
        .hilo-screen {
          --hilo-card: min(
            12rem,
            calc((100cqw - 8rem) / 2),
            36cqh
          );
        }
        .hilo-screen [style*="--pcw"] {
          --pcw: var(--hilo-card) !important;
        }
        .hilo-status {
          min-height: 1.5rem;
          flex: none;
        }
        .hilo-readout {
          display: grid;
          grid-template-columns: auto auto;
          grid-template-areas:
            "label label"
            "num   win";
          align-items: baseline;
          justify-content: center;
          column-gap: 0.75rem;
          flex: none;
          padding: 0.375rem 1rem 0.5rem;
          border-radius: var(--tixy-radius-panel-sm);
          background: var(--tixy-screen-2);
          color: var(--tixy-paper);
        }
        .hilo-readout-label {
          grid-area: label;
          text-align: center;
          font-size: 0.9375rem;
          line-height: 1.2;
          color: var(--tixy-on-ink-2);
        }
        .hilo-readout-num {
          grid-area: num;
          font-size: 2rem;
          line-height: 1.05;
          font-variant-numeric: tabular-nums;
        }
        .hilo-readout[data-kind="lost"] .hilo-readout-num {
          color: var(--tixy-on-ink-2);
        }
        .hilo-readout-win {
          grid-area: win;
          font-size: 1.375rem;
          line-height: 1.05;
        }
        /* Tickets are amber, wherever they are counted. */
        .hilo-tix {
          color: var(--tixy-ticket);
        }
        .hilo-readout > .hilo-readout-num.hilo-tix {
          grid-column: 1 / -1;
          text-align: center;
        }
        .hilo-table {
          display: grid;
          grid-template-columns: auto 4.25rem auto;
          align-items: center;
          justify-content: center;
          column-gap: 0.25rem;
          flex: none;
        }
        .hilo-table[data-setup] {
          display: flex;
          justify-content: center;
        }
        /* The call you made: an arrow and the word, on the table between
           the two cards. */
        .hilo-call {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 2px;
          font-size: 0.875rem;
          font-weight: 700;
          line-height: 1.1;
          color: var(--tixy-paper);
          opacity: 0;
        }
        .hilo-call[data-on] {
          opacity: 1;
        }
        .hilo-next[data-spent] {
          opacity: 0.35;
        }
        .hilo-shift {
          animation: hiloShift 0.34s var(--tixy-ease-settle, ease-out) both;
        }
        @keyframes hiloShift {
          from {
            transform: translateX(calc(var(--hilo-card) * 0.9));
          }
          to {
            transform: translateX(0);
          }
        }
        /* Higher and lower print their own odds; cash out prints its tickets. */
        .hilo-btn {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 1px;
          line-height: 1.1;
        }
        .hilo-btn-odds {
          font-size: 0.8125rem;
          font-weight: 600;
          opacity: 0.75;
          font-variant-numeric: tabular-nums;
        }
        .hilo-btn-odds.hilo-tix {
          opacity: 1;
        }
        @media (prefers-reduced-motion: reduce) {
          .hilo-stamp::after {
            animation: none;
            opacity: 1;
            transform: none;
          }
          .hilo-shift {
            animation: none;
          }
        }
      `}</style>
    </GameShell>
  );
}

/* ---------- Card face (face-up only; deal-in does a flip) ---------- */

function CardFace({
  card,
  dealIn,
  glow,
}: {
  card: Card;
  dealIn?: boolean;
  glow?: "win" | "lose";
}) {
  const stampClass =
    glow === "win"
      ? "hilo-stamp hilo-stamp-win"
      : glow === "lose"
        ? "hilo-stamp hilo-stamp-lose"
        : "";
  return (
    <PlayingCardFace
      rank={card.rank}
      suit={card.suit}
      size="lg"
      dealIn={dealIn}
      dealInMs={FLIP_DURATION}
      className={stampClass}
    />
  );
}

/* ---------- Deck (stack of card backs) ---------- */

function Deck() {
  return <PlayingCardDeck theme="fuchsia" size="lg" />;
}
