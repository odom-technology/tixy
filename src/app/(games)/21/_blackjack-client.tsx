"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type RefObject,
} from "react";
import "./_blackjack-midway.css";
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
import { useRollingNumber } from "@/features/arcade/lib/use-rolling-number";
import { ArcadeStub } from "@/features/arcade/components/ui/arcade-ui";
import { DealtCard, playCardFlip } from "@/features/arcade/components/wagers/machine-cards";
import {
  MachineCardBack,
  MachineCardFace,
} from "@/features/arcade/components/wagers/machine-card";
import { feelReducedMotion, FEEL } from "@/features/arcade/lib/game-feel";
import { useWagerSession } from "@/features/arcade/lib/use-wager-session";
import { ARCADE_MIN_BET } from "@/server/arcade/arcade-constants";

/* ---------- Types (mirror server) ---------- */

type Suit = 0 | 1 | 2 | 3;
type Card = { rank: number; suit: Suit };

type HandOutcome =
  "win" | "lose" | "push" | "blackjack" | "bust" | "dealerBust" | null;

type HandView = {
  cards: Card[];
  bet: number;
  done: boolean;
  doubled: boolean;
  fromSplit: boolean;
  splitAce: boolean;
  outcome: HandOutcome;
  value: number;
  bust: boolean;
  blackjack: boolean;
};

type DealerView = {
  cards: Card[];
  hiddenCount: number;
  value: number;
};

type StateResponse = {
  phase: "awaiting-deal" | "playerTurn" | "dealerTurn" | "roundEnd";
  activeHandIndex: number;
  hands: HandView[];
  dealer: DealerView;
  totalWagered: number;
  legalActions: Array<"hit" | "stand" | "double" | "split">;
  payout?: number;
  multiplier?: number;
  seed?: number;
  roundId?: string;
};

type Phase = "setup" | "playing" | "resolved";

/** What the server pays per hand, as a multiple of that hand's bet
    (server/arcade/wager-games/blackjack.ts). */
const PAYS = { win: 2, natural: 2.5, push: 1 } as const;

const HOW_TO: GameHowTo = {
  lines: [
    "Press deal, then hit, stand, double or split.",
    "Closest to 21 wins, over 21 loses, and the dealer stands on all 17.",
    "A win pays 2×, a natural 21 pays 2.5× and a push returns your bet.",
  ],
};

/* ---------- Card helpers ---------- */

/** Best hand value ≤ 21 using 10-caps and soft aces — mirrors server logic. */
function getHandValue(cards: Card[]): number {
  let total = 0;
  let aces = 0;
  for (const c of cards) {
    if (c.rank === 1) {
      total += 1;
      aces += 1;
    } else if (c.rank >= 10) {
      total += 10;
    } else {
      total += c.rank;
    }
  }
  while (aces > 0 && total + 10 <= 21) {
    total += 10;
    aces -= 1;
  }
  return total;
}

function fmtMult(m: number): string {
  return `${Number(m.toFixed(2))}×`;
}

/* ---------- Component ---------- */

/** Cards in a hand overlap by this fraction of a card's width. */
const OVERLAP = 0.34;
/** Cards that move to a new place (a split, a hand re-centring) glide. */
const MOVE_MS = 280;
/** Gap between the cards of the opening deal: player, dealer, player, hole. */
const DEAL_STEP_MS = 150;
/** A card lands this long after its deal starts. The bust shakes then. */
const LAND_MS = 380;

export default function BlackjackClient() {
  const bustEl = useRef<HTMLElement | null>(null);
  const { trigger } = useGameFeedback({ stage: bustEl });
  const {
    wallet,
    loaded: walletLoaded,
    refresh: refreshWallet,
    adjustCredits,
  } = useGamesWallet();
  const balance = walletLoaded ? wallet.credits : null;

  const [phase, setPhase] = useState<Phase>("setup");
  const [state, setState] = useState<StateResponse | null>(null);
  const [payout, setPayout] = useState(0);
  const [finalMultiplier, setFinalMultiplier] = useState(0);
  const [roundId, setRoundId] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [wager, setWager] = useMachineBet(balance, 10, {
    locked: phase === "playing" || isBusy,
  });

  // Dealer animation: how many of state.dealer.cards are currently face-up on screen.
  const [dealerFacesShown, setDealerFacesShown] = useState(0);
  const pendingRoundEndRef = useRef<StateResponse | null>(null);
  // Counts deals, so a new round's cards are new elements that slide in.
  const [round, setRound] = useState(0);

  // Card slots that have already arrived this round, so re-renders don't
  // replay the slide for cards that are on the felt.
  const seenCardsRef = useRef<Set<string>>(new Set());
  const shoeRef = useRef<HTMLDivElement>(null);
  const handEls = useRef<(HTMLDivElement | null)[]>([]);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const prevBust = useRef<boolean[]>([]);

  const {
    tokenRef,
    revealedSeed,
    setRevealedSeed,
    start: startSession,
    action: sessionAction,
    achievements,
  } = useWagerSession("arcade-blackjack");

  useEffect(
    () => () => {
      timers.current.forEach((t) => clearTimeout(t));
      timers.current = [];
    },
    [],
  );

  const later = useCallback((fn: () => void, ms: number) => {
    const t = setTimeout(() => {
      timers.current = timers.current.filter((x) => x !== t);
      fn();
    }, ms);
    timers.current.push(t);
  }, []);

  /* A bust shakes the hand that went over, once its card has landed. */
  const shakeBustedHands = useCallback(
    (hands: HandView[], landMs: number) => {
      hands.forEach((hand, idx) => {
        if (!hand.bust || prevBust.current[idx]) return;
        later(() => {
          bustEl.current = handEls.current[idx] ?? null;
          trigger("impact", { shake: 1, haptic: true });
        }, landMs);
      });
      prevBust.current = hands.map((hand) => hand.bust);
    },
    [later, trigger],
  );

  /* ---------- Helpers ---------- */

  const callAction = useCallback(
    async (action: "deal" | "hit" | "stand" | "double" | "split") => {
      if (!tokenRef.current) return null;
      const result = await sessionAction<StateResponse>(action);
      if (!result.ok) {
        setError(machineError(result.error, "The dealer did not answer. Try again."));
        return null;
      }
      return result.data;
    },
    [tokenRef, sessionAction],
  );

  /* ---------- Start round ---------- */
  // Deal starts the next round from the setup table or from the last
  // round's result: the previous hands stay on the felt until the new deal
  // lands.
  const handleStart = useCallback(async () => {
    trigger("press", { haptic: true });
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
      if (!session.ok) {
        setError(machineError(session.error, "The table could not deal the hand. Try again."));
        setIsBusy(false);
        return;
      }
      setPayout(0);
      setFinalMultiplier(0);
      setRoundId(null);
      pendingRoundEndRef.current = null;

      // Immediately deal the initial two cards + dealer up-card.
      const deal = await sessionAction<StateResponse>("deal");
      if (!deal.ok) {
        setError(machineError(deal.error, "The deal did not go through. Try again."));
        setIsBusy(false);
        return;
      }
      const dealData = deal.data;

      seenCardsRef.current.clear();
      prevBust.current = [];
      setRound((r) => r + 1);
      setState(dealData);
      adjustCredits(-wager);
      // Always start with just the up-card shown so the reveal ramp plays
      // whether the round continues OR ends immediately on a dealer BJ peek.
      setDealerFacesShown(Math.min(1, dealData.dealer.cards.length));

      if (dealData.phase === "roundEnd") {
        // Natural blackjack off the deal — reveal hole card with a pause, then resolve.
        pendingRoundEndRef.current = dealData;
      }
      setPhase("playing");
      setIsBusy(false);
    } catch {
      setError("The table lost its connection. Try again.");
      setIsBusy(false);
    }
  }, [wager, balance, isBusy, startSession, sessionAction, adjustCredits, trigger]);

  /* ---------- Round-end plumbing ---------- */
  const handleRoundEnd = useCallback(
    (data: StateResponse) => {
      setPhase("resolved");
      const finalPayout = data.payout ?? 0;
      const committed = data.totalWagered || 1;
      const mult = data.multiplier ?? finalPayout / committed;
      setPayout(finalPayout);
      setFinalMultiplier(mult);
      setRevealedSeed(data.seed ?? null);
      setRoundId(data.roundId ?? null);

      // One cue for the round: a natural pays the big one, a win the small,
      // a push is neutral, a loss gets the loss cue. The bust already shook.
      if (finalPayout > committed) {
        trigger(mult >= 2.5 ? "jackpot" : "round-win", { haptic: true });
      } else if (finalPayout === committed) {
        trigger("collect");
      } else {
        trigger("loss", { haptic: true });
      }
      void refreshWallet();
    },
    [refreshWallet, setRevealedSeed, trigger],
  );

  /* ---------- Dealer reveal ramp ---------- */
  // Progressively reveal dealer cards one at a time (600ms apart); each card
  // makes its own sound as it turns. Then (if the round ended) the outcome.
  useEffect(() => {
    const target = state?.dealer.cards.length ?? 0;
    if (dealerFacesShown >= target) {
      if (pendingRoundEndRef.current && phase === "playing") {
        const finalState = pendingRoundEndRef.current;
        pendingRoundEndRef.current = null;
        const t = setTimeout(() => handleRoundEnd(finalState), 500);
        return () => clearTimeout(t);
      }
      return;
    }
    const t = setTimeout(() => {
      setDealerFacesShown((f) => Math.min(f + 1, target));
    }, 600);
    return () => clearTimeout(t);
  }, [state, dealerFacesShown, phase, handleRoundEnd]);

  // After each paint, mark every rendered card as seen so its slide only
  // plays the first time it appears.
  useEffect(() => {
    if (!state) return;
    state.dealer.cards.forEach((c, i) => {
      if (i < dealerFacesShown) seenCardsRef.current.add(`${round}-d-${i}-${c.rank}-${c.suit}`);
    });
    if (state.dealer.cards.length >= 2 || state.dealer.hiddenCount > 0) {
      seenCardsRef.current.add(`${round}-hole`);
    }
    state.hands.forEach((hand, idx) => {
      hand.cards.forEach((c, i) =>
        seenCardsRef.current.add(`${round}-h${idx}-${i}-${c.rank}-${c.suit}`),
      );
    });
  }, [state, dealerFacesShown, round]);

  /* ---------- Player actions ---------- */
  const doAction = useCallback(
    async (action: "hit" | "stand" | "double" | "split") => {
      trigger("press", { haptic: true });
      if (isBusy || phase !== "playing") return;
      setIsBusy(true);
      setError(null);
      const result = await callAction(action);
      setIsBusy(false);
      if (!result) return;
      setState(result);
      shakeBustedHands(result.hands, LAND_MS + 140);

      if (result.phase === "roundEnd") {
        // Defer the outcome banner / sounds until the dealer reveal finishes.
        pendingRoundEndRef.current = result;
      }
    },
    [callAction, isBusy, phase, trigger, shakeBustedHands],
  );

  /* ---------- Keyboard: Space deals from the setup or result table ---------- */
  useMachineKey(
    useMemo(
      () => (phase === "playing" ? null : () => void handleStart()),
      [phase, handleStart],
    ),
  );

  /* ---------- Computed ---------- */
  const activeHand = state?.hands[state.activeHandIndex];
  const legal = new Set(state?.legalActions ?? []);
  const handBet = activeHand?.bet ?? wager;
  const credits = balance ?? 0;
  const canDouble = legal.has("double") && credits >= handBet;
  const canSplit = legal.has("split") && credits >= handBet;
  const resolved = phase === "resolved" && state != null;
  const totalWagered = state?.totalWagered ?? 0;
  // The dealer's turn is still on screen: the round is decided but not shown.
  const dealing = phase === "playing" && pendingRoundEndRef.current != null;
  const yourTurn = phase === "playing" && !dealing && legal.size > 0;

  // Screen readers only. The felt shows the rest.
  const statusLine =
    phase === "setup"
      ? ""
      : phase === "playing"
        ? !yourTurn
          ? "Dealer's turn."
          : state && state.hands.length > 1
            ? `Your turn, hand ${(state.activeHandIndex ?? 0) + 1} of ${state.hands.length}.`
            : "Your turn."
        : payout > totalWagered
          ? `You win ${(payout - totalWagered).toLocaleString()} tickets.`
          : payout === totalWagered
            ? "Push. Your bet is returned."
            : `Dealer wins. You lose ${(totalWagered - payout).toLocaleString()} tickets.`;

  // The line that just paid, for the glass band and the pays sheet.
  const outcomes = resolved ? state.hands.map((hand) => hand.outcome) : [];
  const paytable = [
    {
      label: "win",
      value: fmtMult(PAYS.win),
      lit: outcomes.some((o) => o === "win" || o === "dealerBust"),
    },
    {
      label: "natural 21",
      value: fmtMult(PAYS.natural),
      lit: outcomes.includes("blackjack"),
    },
    { label: "push", value: fmtMult(PAYS.push), lit: outcomes.includes("push") },
  ];

  const glass = (
    <MachineGlass
      name="21"
      rules={["Double on any two cards. Split pairs up to four hands."]}
      paytable={paytable}
    />
  );

  /* How many card-widths the table has to fit across: the widest row. */
  const handCount = state?.hands.length ?? 1;
  const widest = Math.max(2, ...(state?.hands.map((h) => h.cards.length) ?? [2]));
  const handsAcross = handCount * (1 + (widest - 1) * (1 - OVERLAP)) + (handCount - 1) * 0.45;
  // The dealer's row, with room for its count on the left.
  const dealerAcross = 1 + Math.max(1, (state?.dealer.cards.length ?? 2) - 1) * (1 - OVERLAP) + 1.1;
  const across = Math.max(handsAcross, dealerAcross);

  /* The opening deal goes player, dealer, player, hole card. Every later
     card (a hit, a double, the dealer's draw) arrives straight away. */
  const opening = seenCardsRef.current.size === 0;
  const cardKey = (kind: string, c: Card, i: number) => `${round}-${kind}-${i}-${c.rank}-${c.suit}`;

  /* A card that was already on the felt keeps its identity when it moves
     (a split takes the second card to a new hand; a hand re-centres as it
     grows): rank and suit, counted in order. It glides from where it was
     instead of coming out of the shoe again. */
  const tableRef = useRef<HTMLDivElement>(null);
  const lastRects = useRef(new Map<string, { x: number; y: number }>());
  const lastRound = useRef(round);
  if (lastRound.current !== round) {
    lastRound.current = round;
    lastRects.current.clear();
  }
  const cardIds = (state?.hands ?? []).map(() => [] as string[]);
  {
    const counts = new Map<string, number>();
    state?.hands.forEach((hand, h) =>
      hand.cards.forEach((c) => {
        const base = `${c.rank}-${c.suit}`;
        const n = counts.get(base) ?? 0;
        counts.set(base, n + 1);
        cardIds[h]!.push(`${base}#${n}`);
      }),
    );
  }
  useLayoutEffect(() => {
    const table = tableRef.current;
    if (!table) return;
    const origin = table.getBoundingClientRect();
    const next = new Map<string, { x: number; y: number }>();
    const reduce = feelReducedMotion();
    table.querySelectorAll<HTMLElement>("[data-cid]").forEach((el) => {
      const box = el.getBoundingClientRect();
      const at = { x: box.left - origin.left, y: box.top - origin.top };
      const id = el.dataset.cid!;
      next.set(id, at);
      const was = lastRects.current.get(id);
      if (!was || reduce || typeof el.animate !== "function") return;
      const dx = was.x - at.x;
      const dy = was.y - at.y;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
      el.animate(
        [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }],
        { duration: MOVE_MS, easing: FEEL.settleEase },
      );
    });
    lastRects.current = next;
  }, [state]);
  // A resize moves every card; don't glide them on the next move.
  useEffect(() => {
    const forget = () => lastRects.current.clear();
    window.addEventListener("resize", forget);
    return () => window.removeEventListener("resize", forget);
  }, []);

  const dealerCards = state?.dealer.cards ?? [];
  const holeKnown = dealerCards.length >= 2;
  const holeRevealed = dealerFacesShown >= 2;
  const holePending = !holeRevealed && ((state?.dealer.hiddenCount ?? 0) > 0 || holeKnown);
  const dealerVisible = dealerCards.slice(0, dealerFacesShown);
  const dealerHasNatural =
    !holePending && dealerCards.length === 2 && getHandValue(dealerCards) === 21;
  const hole = holeKnown ? dealerCards[1]! : null;

  const net = payout - totalWagered;
  const resultPlate = resolved ? resultOf(state, net) : null;

  const screen = (
    <div
      ref={tableRef}
      className="arc-machine-fit bj-table"
      data-hands={handCount}
      data-phase={phase}
      style={{ "--bj-across": across } as CSSProperties}
    >
      {/* The shoe the cards slide out of. */}
      <Shoe shoeRef={shoeRef} />

      <p className="sr-only" role="status">
        {statusLine}
      </p>

      {/* The dealer, top of the felt. */}
      <section className="bj-seat" data-seat="dealer" aria-label="dealer">
        <div className="bj-cards" data-ghosts={!state || undefined}>
          {/* Before the deal the dealer's two card spots are printed. */}
          {!state ? (
            <>
              <span className="bj-ghost" aria-hidden />
              <span className="bj-ghost" aria-hidden />
            </>
          ) : null}
          {state && dealerVisible.length > 0 ? (
            <Count
              value={dealerHasNatural ? 21 : getHandValue(dealerVisible)}
              state={
                resolved && getHandValue(dealerCards) > 21
                  ? "bust"
                  : undefined
              }
              label="dealer"
            />
          ) : null}
          {dealerCards.map((c, i) => {
            if (i === 1) return null;
            if (i >= dealerFacesShown) return null;
            const key = cardKey("d", c, i);
            return (
              <div className="bj-card" key={key} style={{ order: i }}>
                <DealtCard
                  from={shoeRef}
                  animate={!seenCardsRef.current.has(key)}
                  delayMs={opening ? DEAL_STEP_MS : 0}
                  onFlip={playCardFlip}
                  front={<MachineCardFace rank={c.rank} suit={c.suit} />}
                  back={<MachineCardBack />}
                />
              </div>
            );
          })}
          {state && (holeKnown || state.dealer.hiddenCount > 0) && (
            <div className="bj-card" key={`${round}-hole`} style={{ order: 1 }}>
              <DealtCard
                from={shoeRef}
                faceUp={holeRevealed}
                animate={!seenCardsRef.current.has(`${round}-hole`)}
                delayMs={opening ? DEAL_STEP_MS * 3 : 0}
                onFlip={playCardFlip}
                front={hole ? <MachineCardFace rank={hole.rank} suit={hole.suit} /> : <MachineCardBack />}
                back={<MachineCardBack />}
              />
            </div>
          )}
        </div>
      </section>

      {/* The rules are printed on the felt until the deal; then the result lands here. */}
      <div className="bj-middle">
        {!state ? <FeltPrint /> : null}
        {resultPlate ? (
          <p className="bj-result" data-win={resultPlate.win || undefined} key={roundId ?? "result"}>
            <span>{resultPlate.label}</span>
            {resultPlate.win ? (
              <ArcadeStub size="md" aria-label={`${net} tickets won`}>
                +{net.toLocaleString()}
              </ArcadeStub>
            ) : (
              <b className="arcade-num">{net < 0 ? `−${Math.abs(net).toLocaleString()}` : "0"}</b>
            )}
          </p>
        ) : null}
      </div>

      {/* You, bottom of the felt. */}
      <section className="bj-hands" aria-label="your hands">
        {phase === "setup" || !state ? (
          <div className="bj-hand" data-empty>
            <div className="bj-spot" data-big>
              <ArcadeStub size="lg" perf aria-label={`${wager} tickets bet`} key={wager} className="bj-stub">
                {wager}
              </ArcadeStub>
            </div>
          </div>
        ) : (
          state.hands.map((hand, idx) => {
            const isActive = yourTurn && idx === state.activeHandIndex;
            const dim = yourTurn && state.hands.length > 1 && !isActive;
            const base = hand.doubled ? hand.bet / 2 : hand.bet;
            const won = resolved ? handPayout(hand) - hand.bet : 0;
            const lost = resolved && handPayout(hand) === 0;
            const soft = !resolved && !hand.done && isSoft(hand.cards);
            return (
              <div
                key={`${round}-h${idx}`}
                ref={(el) => {
                  handEls.current[idx] = el;
                }}
                className="bj-hand"
                data-active={isActive || undefined}
                data-dim={dim || undefined}
                data-blackjack={hand.blackjack || undefined}
                aria-label={state.hands.length > 1 ? `hand ${idx + 1}` : "your hand"}
                role="group"
              >
                <div className="bj-cards">
                  {hand.cards.map((c, i) => {
                    const key = cardKey(`h${idx}`, c, i);
                    const cid = cardIds[idx]![i]!;
                    const moved = lastRects.current.has(cid);
                    const order = i === 0 ? 0 : 2;
                    return (
                      <div className="bj-card" key={key} data-cid={cid}>
                        <DealtCard
                          from={shoeRef}
                          animate={!seenCardsRef.current.has(key) && !moved}
                          delayMs={opening && hand.cards.length <= 2 ? order * DEAL_STEP_MS : 0}
                          onFlip={playCardFlip}
                          front={<MachineCardFace rank={c.rank} suit={c.suit} />}
                          back={<MachineCardBack />}
                        />
                      </div>
                    );
                  })}
                </div>
                <span className="bj-turn" data-on={isActive || undefined} aria-hidden />
                <div className="bj-foot">
                  <Count
                    value={hand.blackjack ? 21 : hand.value}
                    soft={soft}
                    state={
                      hand.bust
                        ? "bust"
                        : resolved && won > 0
                          ? "win"
                          : resolved && hand.outcome === "push"
                            ? "push"
                            : resolved
                              ? "lose"
                              : undefined
                    }
                    label={state.hands.length > 1 ? `hand ${idx + 1}` : "you"}
                  />
                  <div className="bj-spot" data-lost={lost || undefined}>
                  <ArcadeStub size="sm" className="bj-stub" muted={lost} aria-label={`${base} tickets bet`}>
                    {base.toLocaleString()}
                  </ArcadeStub>
                  {hand.doubled ? (
                    <ArcadeStub
                      size="sm"
                      className="bj-stub"
                      data-second
                      muted={lost}
                      aria-label={`${base} more, doubled`}
                    >
                      {base.toLocaleString()}
                    </ArcadeStub>
                  ) : null}
                  {won > 0 && state.hands.length < 3 ? (
                    <ArcadeStub size="sm" className="bj-stub" data-paid aria-label={`${won} tickets won`}>
                      +{won.toLocaleString()}
                    </ArcadeStub>
                  ) : null}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </section>
    </div>
  );

  const busy = isBusy || dealing;
  const action =
    phase === "playing" ? (
      yourTurn ? (
        <>
          {legal.has("hit") ? (
            <MachineButton onClick={() => void doAction("hit")} aria-disabled={busy || undefined}>
              hit
            </MachineButton>
          ) : null}
          <MachineButton onClick={() => void doAction("stand")} aria-disabled={busy || undefined}>
            stand
          </MachineButton>
          {canDouble ? (
            <MachineButton
              second
              className="bj-cost-button"
              onClick={() => void doAction("double")}
              aria-disabled={busy || undefined}
              aria-label={`double, ${handBet} more tickets`}
            >
              double
              <small className="arcade-num">{handBet.toLocaleString()}</small>
            </MachineButton>
          ) : null}
          {canSplit ? (
            <MachineButton
              second
              className="bj-cost-button"
              onClick={() => void doAction("split")}
              aria-disabled={busy || undefined}
              aria-label={`split, ${handBet} more tickets`}
            >
              split
              <small className="arcade-num">{handBet.toLocaleString()}</small>
            </MachineButton>
          ) : null}
        </>
      ) : (
        <p className="bj-wait">dealer&apos;s turn</p>
      )
    ) : (
      <MachineButton
        onClick={() => void handleStart()}
        disabled={balance == null || wager > balance || wager < ARCADE_MIN_BET}
        aria-disabled={isBusy || undefined}
        aria-label={`deal, ${wager} tickets`}
      >
        deal
      </MachineButton>
    );

  const dealerNatural =
    resolved &&
    state.dealer.cards.length === 2 &&
    getHandValue(state.dealer.cards) === 21;

  const receipt = resolved ? (
    <ArcadeWagerResultPlate
      result={{
        payout,
        stake: totalWagered,
        multiplier: finalMultiplier,
      }}
      kicker="21"
      headline={fmtMult(finalMultiplier)}
      detail={
        <>
          {/* What happened, in numbers: each hand's total against the
              dealer's, since the felt is under the receipt on a phone. */}
          {state.hands.length > 1
            ? `${state.hands
                .map((hand, idx) => `hand ${idx + 1} ${getHandValue(hand.cards)}, ${outcomeLabel(hand.outcome)}`)
                .join("; ")}; dealer ${getHandValue(state.dealer.cards)}`
            : `${outcomeLabel(state.hands[0]!.outcome)}: you ${getHandValue(state.hands[0]!.cards)}, dealer ${getHandValue(state.dealer.cards)}`}
          {dealerNatural ? (
            <>
              <br />
              The dealer has a natural 21.
            </>
          ) : null}
        </>
      }
      fairness={{ seedHash: null, revealedSeed }}
      achievements={achievements}
      roundId={roundId ?? undefined}
      sound={false}
    />
  ) : null;

  return (
    <GameShell
      game="21"
      className="bj-midway"
      howTo={HOW_TO}
    >
      <ArcadeMachine
        name="21"
        glass={glass}
        action={action}
        bet={{
          value: wager,
          onChange: setWager,
          balance,
          disabled: phase === "playing" || isBusy,
        }}
        receipt={receipt}
        receiptKey={roundId}
        notice={error}
      >
        {screen}
      </ArcadeMachine>
    </GameShell>
  );
}

/* ---------- Sub-components ---------- */

/** Printed on the felt in an arc, like a real table. The rules it states are
    the server's: blackjack.ts pays a natural 3 to 2 and stands on all 17. */
function FeltPrint() {
  return (
    <svg className="bj-print" viewBox="0 0 400 84" aria-hidden>
      <path id="bj-arc-1" d="M 20 12 Q 200 68 380 12" fill="none" />
      <path id="bj-arc-2" d="M 76 44 Q 200 88 324 44" fill="none" />
      <text className="bj-print-big">
        <textPath href="#bj-arc-1" startOffset="50%" textAnchor="middle">
          blackjack pays 3 to 2
        </textPath>
      </text>
      <text className="bj-print-small">
        <textPath href="#bj-arc-2" startOffset="50%" textAnchor="middle">
          dealer stands on all 17
        </textPath>
      </text>
    </svg>
  );
}

/** The dealer's shoe, top right: a flat ink box with a stack of cards
    standing in its slot. Cards slide out of it. */
function Shoe({ shoeRef }: { shoeRef: RefObject<HTMLDivElement | null> }) {
  return (
    <div ref={shoeRef} className="bj-shoe" aria-hidden>
      <svg viewBox="0 0 72 56" width="100%" height="100%">
        <rect x="14" y="2" width="44" height="30" rx="3" fill="#F4EBDC" transform="rotate(-6 36 17)" />
        <rect x="18" y="5" width="44" height="30" rx="3" fill="#EADFCB" transform="rotate(-6 40 20)" />
        <path d="M 4 26 L 68 20 L 68 50 Q 68 54 64 54 L 8 54 Q 4 54 4 50 Z" fill="#1F1A16" />
        <rect x="10" y="36" width="52" height="3" rx="1.5" fill="#54483D" />
      </svg>
    </div>
  );
}

/** A hand's count: Big Shoulders on a paper bubble at the cards' corner.
    Red for a win, dark for a bust or a loss, paper 3 for a push. */
function Count({
  value,
  soft,
  state,
  label,
}: {
  value: number;
  soft?: boolean;
  state?: "win" | "bust" | "push" | "lose";
  label: string;
}) {
  const shown = useRollingNumber(value, { duration: 260 });
  return (
    <span
      className="bj-count"
      data-state={state}
      aria-label={`${label} ${soft ? "soft " : ""}${value}${state === "bust" ? ", bust" : ""}`}
    >
      <b className="arcade-num">{shown}</b>
      {soft ? <small>soft</small> : null}
      {state === "bust" ? <small>bust</small> : null}
    </span>
  );
}

/** A hand counts an ace as 11 and could still take a card without busting. */
function isSoft(cards: Card[]): boolean {
  let hard = 0;
  let aces = 0;
  for (const c of cards) {
    hard += c.rank === 1 ? 1 : Math.min(10, c.rank);
    if (c.rank === 1) aces += 1;
  }
  return aces > 0 && hard + 10 < 21;
}

/** What a settled hand paid, as the server pays it (blackjack.ts). */
function handPayout(hand: HandView): number {
  switch (hand.outcome) {
    case "blackjack":
      return Math.floor(hand.bet * PAYS.natural);
    case "win":
    case "dealerBust":
      return hand.bet * PAYS.win;
    case "push":
      return hand.bet * PAYS.push;
    default:
      return 0;
  }
}

/** The result plate's words: one hand says how it ended, several say the
    sum. A win is any round that came out ahead. */
function resultOf(state: StateResponse, net: number): { label: string; win: boolean } {
  if (state.hands.length === 1) {
    const outcome = state.hands[0]!.outcome;
    const label =
      outcome === "blackjack"
        ? "natural 21"
        : outcome === "dealerBust"
          ? "dealer busts"
          : outcome === "win"
            ? "you win"
            : outcome === "push"
              ? "push"
              : outcome === "bust"
                ? "bust"
                : "dealer wins";
    return { label, win: net > 0 };
  }
  if (net > 0) return { label: "you win", win: true };
  if (net === 0) return { label: "even", win: false };
  return { label: "dealer wins", win: false };
}

function outcomeLabel(outcome: HandOutcome): string {
  switch (outcome) {
    case "blackjack":
      return "natural 21";
    case "win":
      return "win";
    case "dealerBust":
      return "dealer bust, win";
    case "push":
      return "push";
    case "bust":
      return "bust";
    case "lose":
      return "dealer wins";
    default:
      return "";
  }
}
