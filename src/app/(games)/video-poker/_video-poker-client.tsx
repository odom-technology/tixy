"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { DealtCard, playCardFlip } from "@/features/arcade/components/wagers/machine-cards";
import {
  MachineCardBack,
  MachineCardFace,
} from "@/features/arcade/components/wagers/machine-card";
import { isDialogOpen } from "@/features/arcade/lib/use-first-input";
import { useWagerSession } from "@/features/arcade/lib/use-wager-session";
import { ARCADE_MIN_BET } from "@/server/arcade/arcade-constants";
import {
  VIDEO_POKER_PAYTABLE,
  VIDEO_POKER_RANK_LABELS,
  evaluateJacksOrBetter,
  type Card,
  type VideoPokerRank,
} from "@/server/arcade/wager-games/video-poker";

/* ---------- Types ---------- */

type GamePhase = "setup" | "dealt" | "won" | "lost";

type PeekResponse = { hand?: Card[] };

type DrawResponse = {
  finalHand?: Card[];
  rank?: VideoPokerRank;
  payoutMult?: number;
  multiplier?: number;
  payout?: number;
  seed?: number;
  roundId?: string | null;
};

/* The paytable rows, best → worst, for the prominent panel. `none` is the
   losing bucket so we don't list it. */
const PAYTABLE_ROWS: readonly VideoPokerRank[] = [
  "royalFlush",
  "straightFlush",
  "fourKind",
  "fullHouse",
  "flush",
  "straight",
  "threeKind",
  "twoPair",
  "jacksOrBetter",
];

const HAND_SIZE = 5;
const DEAL_STAGGER_MS = 90;
/* One card's turn (machine-cards.tsx). On the draw, the cards you let go
   turn to their backs first, then the new ones turn up. */
const DEAL_DURATION_MS = 320;

const HOW_TO: GameHowTo = {
  lines: [
    "Press deal, tap the cards you keep, then press draw.",
    "Your final five cards must make a pair of jacks or better to pay.",
    "A pair of jacks or better returns the bet, two pair pays 2× and a royal flush 250×.",
  ],
};

function rankLabel(rank: VideoPokerRank): string {
  return VIDEO_POKER_RANK_LABELS[rank].toLowerCase();
}

/** "three of a kind" as the start of a sentence. */
function sentence(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/* ---------- Component ---------- */

export default function VideoPokerClient() {
  const { trigger: triggerFeedback } = useGameFeedback();
  const {
    wallet,
    loaded: walletLoaded,
    refresh: refreshWallet,
    adjustCredits,
  } = useGamesWallet();
  const balance = walletLoaded ? wallet.credits : null;

  const [phase, setPhase] = useState<GamePhase>("setup");
  const [hand, setHand] = useState<Card[]>([]);
  const [holds, setHolds] = useState<boolean[]>([
    false,
    false,
    false,
    false,
    false,
  ]);
  const [drawn, setDrawn] = useState<boolean[]>([
    false,
    false,
    false,
    false,
    false,
  ]);
  /* Which cards show their face. A draw turns the replaced ones to their
     backs, then up again with the new card. */
  const [faceUp, setFaceUp] = useState<boolean[]>([
    true,
    true,
    true,
    true,
    true,
  ]);
  /* One-shot win flash over the stage once the reveal settles. */
  const [reducedMotion, setReducedMotion] = useState(false);
  const [rank, setRank] = useState<VideoPokerRank | null>(null);
  const [payout, setPayout] = useState(0);
  const [multiplier, setMultiplier] = useState(0);
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [wager, setWager] = useMachineBet(balance, 10, {
    locked: phase === "dealt" || isBusy,
  });
  /* The stake the open hand was bought with; the receipt prints it. */
  const [roundStake, setRoundStake] = useState(0);
  const [roundId, setRoundId] = useState<string | null>(null);
  /* Counts deals, so a new hand's cards are new elements that turn in. */
  const [deals, setDeals] = useState(0);

  const timeoutRefs = useRef<ReturnType<typeof setTimeout>[]>([]);
  const mountedRef = useRef(true);

  const {
    revealedSeed,
    setRevealedSeed,
    start: startSession,
    action: sessionAction,
    achievements,
  } = useWagerSession("arcade-video-poker");

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      timeoutRefs.current.forEach((t) => clearTimeout(t));
      timeoutRefs.current = [];
    };
  }, []);

  /* Track the reduced-motion preference so JS timing can skip the theatrics
     (wind-up beat, per-card stagger) — CSS gates the animations themselves. */
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
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

  /* ---------- Deal (start + peek) ---------- */
  const handleDeal = useCallback(async () => {
    triggerFeedback("press", { haptic: true });
    if (balance == null) return;
    setError(null);
    if (wager > balance) {
      setError(`You need ${wager} tickets for this bet.`);
      return;
    }
    if (isBusy) return;
    setIsBusy(true);
    try {
      const session = await startSession(wager, {});
      if (!mountedRef.current) return;
      if (!session.ok) {
        setError(machineError(session.error, "The machine could not deal. Try again."));
        setIsBusy(false);
        return;
      }

      const peek = await sessionAction<PeekResponse>("peek");
      if (!mountedRef.current) return;
      if (!peek.ok || !peek.data.hand) {
        setError(
          machineError(peek.ok ? null : peek.error, "The machine could not deal. Try again."),
        );
        setIsBusy(false);
        return;
      }

      clearQueuedTimeouts();
      setHand(peek.data.hand);
      setHolds([false, false, false, false, false]);
      setDrawn([false, false, false, false, false]);
      setFaceUp([true, true, true, true, true]);
      setDeals((d) => d + 1);
      setRank(null);
      setPayout(0);
      setMultiplier(0);
      setRoundStake(wager);
      setRoundId(null);
      setPhase("dealt");
      adjustCredits(-wager);
      // Each card sounds as it turns (the card's onFlip).
      setIsBusy(false);
    } catch {
      if (!mountedRef.current) return;
      setError("The machine lost its connection. Try again.");
      setIsBusy(false);
    }
  }, [
    wager,
    balance,
    isBusy,
    startSession,
    sessionAction,
    adjustCredits,
    clearQueuedTimeouts,
    triggerFeedback,
  ]);

  /* ---------- Toggle a hold ---------- */
  const toggleHold = useCallback(
    (index: number) => {
      if (phase !== "dealt" || isBusy) return;
      // The key clicks: higher when it lights, lower when it lets go.
      triggerFeedback("press", { haptic: true, pitch: holds[index] ? 0.84 : 1.26 });
      setHolds((prev) => {
        const next = [...prev];
        next[index] = !next[index];
        return next;
      });
    },
    [phase, isBusy, holds, triggerFeedback],
  );

  /* ---------- Draw (terminal) ---------- */
  const handleDraw = useCallback(async () => {
    triggerFeedback("press", { haptic: true });
    if (phase !== "dealt" || isBusy) return;
    setIsBusy(true);
    setError(null);
    const drawingThese = holds.map((h) => !h);
    const staggerMs = reducedMotion ? 0 : DEAL_STAGGER_MS;
    const flipMs = reducedMotion ? 0 : DEAL_DURATION_MS;
    /* The cards you let go turn to their backs first, left to right. The
       last one is down after this long, and the new cards turn up after it. */
    const lastDrawn = drawingThese.lastIndexOf(true);
    const windupMs = lastDrawn < 0 ? 0 : lastDrawn * staggerMs + flipMs;
    const pressedAt = Date.now();
    setFaceUp(holds.map((h) => h));
    try {
      const res = await sessionAction<DrawResponse>("draw", {
        data: { holds },
      });
      if (!mountedRef.current) return;
      if (!res.ok) {
        setFaceUp([true, true, true, true, true]);
        setError(machineError(res.error, "The draw did not go through. Try again."));
        setIsBusy(false);
        return;
      }
      const data = res.data;
      const finalHand = data.finalHand ?? hand;
      const finalRank = data.rank ?? "none";
      const won = (data.payout ?? 0) > 0 || (data.payoutMult ?? 0) > 0;

      // Turn the new cards up only once BOTH the server response and the
      // turn-down have finished.
      const reveal = () => {
        setDrawn(drawingThese);
        setHand(finalHand);
        setFaceUp([true, true, true, true, true]);

        // Settle the result after the new cards have turned.
        queueTimeout(() => {
          setRank(finalRank);
          setMultiplier(
            data.multiplier ??
              data.payoutMult ??
              VIDEO_POKER_PAYTABLE[finalRank],
          );
          setPayout(data.payout ?? 0);
          setRevealedSeed(data.seed ?? null);
          setRoundId(data.roundId ?? null);
          if (won) {
            const mult = data.payoutMult ?? VIDEO_POKER_PAYTABLE[finalRank];
            triggerFeedback(mult >= 25 ? "jackpot" : "round-win", {
              haptic: true,
            });
            setPhase("won");
          } else {
            triggerFeedback("loss", { haptic: true });
            setPhase("lost");
          }
          void refreshWallet();
          setIsBusy(false);
        }, lastDrawn < 0 ? 0 : lastDrawn * staggerMs + flipMs);
      };
      const beatLeft = windupMs - (Date.now() - pressedAt);
      if (beatLeft > 0) queueTimeout(reveal, beatLeft);
      else reveal();
    } catch {
      if (!mountedRef.current) return;
      setFaceUp([true, true, true, true, true]);
      setError("The machine lost its connection. Try the draw again.");
      setIsBusy(false);
    }
  }, [
    phase,
    isBusy,
    holds,
    hand,
    reducedMotion,
    sessionAction,
    setRevealedSeed,
    refreshWallet,
    queueTimeout,
    triggerFeedback,
  ]);

  /* ---------- Keyboard ---------- */
  /* Space runs the phase's primary action (deal or draw). */
  useMachineKey(
    useMemo(
      () =>
        phase === "dealt" ? () => void handleDraw() : () => void handleDeal(),
      [phase, handleDeal, handleDraw],
    ),
  );

  /* Number keys 1–5 toggle holds while choosing. */
  useEffect(() => {
    if (phase !== "dealt" || isBusy) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || isDialogOpen()) return;
      const active = document.activeElement;
      if (
        active &&
        (active.tagName === "INPUT" || active.tagName === "TEXTAREA")
      )
        return;
      const n = Number(e.key);
      if (Number.isInteger(n) && n >= 1 && n <= HAND_SIZE) toggleHold(n - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase, isBusy, toggleHold]);

  /* ---------- Computed ---------- */
  const heldCount = holds.filter(Boolean).length;
  const dealt = phase === "dealt";
  const showResultCards = phase === "won" || phase === "lost";

  /* What the dealt five already make, so the player sees what is in hand
     before choosing: its line lights on the glass and the status says what
     it pays. Scored with the server's own evaluator. */
  const dealtRank: VideoPokerRank | null =
    dealt && hand.length === HAND_SIZE ? evaluateJacksOrBetter(hand) : null;
  const dealtPays =
    dealtRank && dealtRank !== "none"
      ? Math.floor(roundStake * VIDEO_POKER_PAYTABLE[dealtRank])
      : 0;

  // The cards that make the paying hand: red at the end, the rest dim.
  const paying = showResultCards ? payingCards(hand, rank ?? "none") : [];

  /* Said only when it tells the player something: what the dealt hand
     already pays, how to hold on the first deal, and how the hand ended. */
  const statusLine = dealt
    ? dealtRank && dealtRank !== "none"
      ? `${sentence(rankLabel(dealtRank))} pays ${dealtPays.toLocaleString()}.`
      : heldCount === 0
        ? "Tap the cards you keep."
        : ""
    : phase === "won"
      ? `${sentence(rankLabel(rank ?? "none"))} pays ${payout.toLocaleString()}.`
      : phase === "lost"
        ? "No pair of jacks or better."
        : "";

  const glass = (
    <MachineGlass
      name="video poker"
      rules={["A pair of jacks or better pays."]}
      printed
      paytable={PAYTABLE_ROWS.map((r) => ({
        label: rankLabel(r),
        value: `${VIDEO_POKER_PAYTABLE[r]}×`,
        lit: showResultCards ? rank === r : dealtRank === r,
      }))}
    />
  );

  const screen = (
    <div className="arc-machine-fit vp-stage relative">
      <p className="arc-machine-status" role="status">
        {statusLine}
      </p>

      {phase === "setup" ? (
        <div className="vp-row">
          {Array.from({ length: HAND_SIZE }).map((_, i) => (
            <div key={i} className="vp-col">
              <div className="vp-slot">
                <MachineCardBack />
              </div>
              <span className="vp-card-tag" />
            </div>
          ))}
        </div>
      ) : (
        <div className="vp-row">
          {hand.map((card, i) => {
            const isHeld = holds[i];
            const pays = showResultCards && paying[i];
            const off = showResultCards && (rank ?? "none") !== "none" && !paying[i];
            return (
              <div key={`${deals}-${i}`} className="vp-col">
                <div
                  className="vp-slot relative"
                  data-held={(dealt && isHeld) || undefined}
                  data-pays={pays || undefined}
                  data-off={off || undefined}
                >
                  {/* The held tag sits above the card while choosing. */}
                  {dealt && isHeld ? <span className="vp-held-tag">held</span> : null}
                  <DealtCard
                    faceUp={faceUp[i]}
                    delayMs={i * DEAL_STAGGER_MS}
                    onFlip={playCardFlip}
                    front={<MachineCardFace rank={card.rank} suit={card.suit} />}
                    back={<MachineCardBack />}
                  />
                </div>

                {/* A hold key under each card: it clicks and its lamp lights. */}
                {dealt ? (
                  <button
                    type="button"
                    onClick={() => toggleHold(i)}
                    disabled={isBusy}
                    data-on={isHeld || undefined}
                    aria-pressed={isHeld}
                    aria-label={`hold card ${i + 1}`}
                    className="vp-hold-key"
                  >
                    <span className="vp-lamp" aria-hidden />
                    hold
                  </button>
                ) : (
                  <span
                    className="vp-card-tag"
                    data-kept={showResultCards && !drawn[i] ? "" : undefined}
                  >
                    {showResultCards ? (drawn[i] ? "drew" : "kept") : " "}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}

    </div>
  );

  const action = dealt ? (
    <MachineButton
      onClick={() => void handleDraw()}
      aria-disabled={isBusy || undefined}
      aria-label={
        heldCount === HAND_SIZE ? "draw, keeping all five" : `draw ${HAND_SIZE - heldCount}`
      }
    >
      {heldCount === HAND_SIZE ? "stand pat" : "draw"}
    </MachineButton>
  ) : (
    <MachineButton
      onClick={() => void handleDeal()}
      disabled={balance == null || wager > balance || wager < ARCADE_MIN_BET}
      aria-disabled={isBusy || undefined}
      aria-label={`deal, ${wager} tickets`}
    >
      deal
    </MachineButton>
  );

  const receipt = showResultCards ? (
    <ArcadeWagerResultPlate
      result={{
        payout: phase === "won" ? payout : 0,
        stake: roundStake,
        multiplier: phase === "won" ? multiplier : 0,
        jackpot: phase === "won" && multiplier >= 50,
      }}
      kicker="video poker"
      headline={`${phase === "won" ? multiplier : 0}×`}
      detail={rankLabel(rank ?? "none")}
      fairness={{ seedHash: null, revealedSeed }}
      achievements={achievements}
      roundId={roundId ?? undefined}
      sound={false}
    />
  ) : null;

  return (
    <GameShell
      game="video-poker"
      howTo={HOW_TO}
    >
      <ArcadeMachine
        name="video poker"
        glass={glass}
        action={action}
        bet={{
          value: wager,
          onChange: setWager,
          balance,
          disabled: dealt || isBusy,
        }}
        receipt={receipt}
        receiptKey={roundId}
        notice={error}
      >
        {screen}
      </ArcadeMachine>

      <style jsx global>{`
        /* One slot per card, sized to the machine's screen: five across
           the width, and short enough to leave room for the hold keys. */
        .vp-stage {
          --vp-card: min(9rem, 17.5cqw, (100cqh - 8.25rem) / 1.4);
        }
        .vp-stage .vp-row {
          display: flex;
          align-items: flex-start;
          justify-content: center;
          gap: 2.5%;
          width: 100%;
          /* room for the held tags and the lift above the cards */
          padding-top: 1.25rem;
        }
        .vp-stage .vp-col {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 0.5rem;
          width: var(--vp-card);
          max-width: var(--vp-card);
          min-width: 0;
          flex: 1 1 0;
        }
        .vp-stage .vp-slot {
          width: var(--vp-card);
          transition: transform 180ms var(--tixy-ease-spring);
        }
        /* A held card lifts. */
        .vp-stage .vp-slot[data-held] {
          transform: translateY(-0.5rem);
        }
        .vp-stage .vp-slot {
          --mc-w: var(--vp-card);
        }
        /* At the end the cards that paid lift with a red bar; the rest
           step back. */
        .vp-stage .vp-slot[data-pays] {
          transform: translateY(-0.5rem);
        }
        .vp-stage .vp-slot[data-pays]::after {
          content: "";
          position: absolute;
          right: 15%;
          bottom: -0.625rem;
          left: 15%;
          height: 4px;
          border-radius: 2px;
          background: var(--tixy-red);
        }
        .vp-stage .vp-slot[data-off] {
          filter: brightness(0.55);
        }
        /* The held tag: a ticket-amber plate above a kept card. */
        .vp-held-tag {
          position: absolute;
          top: -0.75rem;
          left: 50%;
          z-index: 2;
          transform: translateX(-50%);
          padding: 0.125rem 0.5rem;
          border-radius: 6px;
          font-size: 0.875rem;
          font-weight: 700;
          line-height: 1.2;
          color: var(--tixy-ink);
          background: var(--tixy-ticket);
        }
        /* The hold key: a dark key with a lamp. Pressed it sinks 1 px and
           shrinks to 96%; held, the lamp is lit and the key turns amber. */
        .vp-hold-key {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 0.5rem;
          width: 100%;
          min-height: 2.75rem;
          padding: 0 0.25rem;
          border: 0;
          border-radius: 10px;
          font-family: var(--tixy-font-text);
          font-weight: 700;
          font-size: 0.9375rem;
          color: var(--tixy-paper);
          background: var(--tixy-screen-2);
          cursor: pointer;
          transition:
            transform var(--tixy-press-out) ease-out,
            background-color var(--tixy-panel-fast) ease-out,
            color var(--tixy-panel-fast) ease-out;
        }
        .vp-hold-key:hover:not(:disabled):not([data-on]) {
          background: color-mix(in srgb, var(--tixy-screen-2) 80%, var(--tixy-paper));
        }
        .vp-hold-key:active:not(:disabled) {
          transform: translateY(1px) scale(var(--tixy-press-scale));
          transition-duration: var(--tixy-press-in);
        }
        .vp-hold-key:focus-visible {
          outline: 3px solid var(--tixy-ticket);
          outline-offset: 2px;
        }
        .vp-hold-key:disabled {
          cursor: default;
        }
        .vp-lamp {
          flex: none;
          width: 0.625rem;
          height: 0.625rem;
          border-radius: 50%;
          background: var(--tixy-ink-2);
          transition: background-color var(--tixy-panel-fast) ease-out;
        }
        .vp-hold-key[data-on] {
          color: var(--tixy-ink);
          background: var(--tixy-ticket);
        }
        .vp-hold-key[data-on] .vp-lamp {
          background: var(--tixy-ink);
        }
        /* Result-phase per-card tag (kept / drew). */
        .vp-card-tag {
          font-size: 0.9375rem;
          font-weight: 700;
          color: var(--tixy-on-ink-3);
          min-height: 2.75rem;
          line-height: 2.75rem;
        }
        .vp-card-tag[data-kept] {
          color: var(--tixy-ticket);
        }
        @media (prefers-reduced-motion: reduce) {
          .vp-stage .vp-slot,
          .vp-hold-key,
          .vp-lamp {
            transition: none;
          }
        }
      `}</style>
    </GameShell>
  );
}

/* ---------- The paying cards ---------- */

/** Which of the five make the hand that paid: all five for a straight, a
    flush or a full house; the matching ranks for the rest; for jacks or
    better, the pair of jacks or higher (an ace is 14). */
function payingCards(hand: Card[], rank: VideoPokerRank): boolean[] {
  if (rank === "none") return hand.map(() => false);
  if (
    rank === "royalFlush" ||
    rank === "straightFlush" ||
    rank === "flush" ||
    rank === "straight" ||
    rank === "fullHouse"
  ) {
    return hand.map(() => true);
  }
  const counts = new Map<number, number>();
  for (const card of hand) counts.set(card.rank, (counts.get(card.rank) ?? 0) + 1);
  return hand.map((card) => {
    const n = counts.get(card.rank) ?? 0;
    if (rank === "fourKind") return n === 4;
    if (rank === "threeKind") return n === 3;
    if (rank === "twoPair") return n === 2;
    return n === 2 && card.rank >= 11;
  });
}
