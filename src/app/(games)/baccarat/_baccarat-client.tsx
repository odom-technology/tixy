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
  type PlayingCardSuit,
} from "@/features/arcade/components/ui/playing-card";
import { SoundManager } from "@/features/arcade/lib/sound-manager";
import { useWagerSession } from "@/features/arcade/lib/use-wager-session";
import { ARCADE_MIN_BET } from "@/server/arcade/arcade-constants";
import {
  DEFAULT_BACCARAT_THEME,
  buildBaccaratTheme,
  type BaccaratCosmeticTheme,
  type InventoryCosmeticResponse,
} from "./_baccarat-theme";

/* ========================================================================== */
/*  Bet types + honest odds                                                    */
/* ========================================================================== */

type Bet = "player" | "banker" | "tie";
type Outcome = "player" | "banker" | "tie";

type Card = { rank: number; suit: PlayingCardSuit };

const BETS: {
  id: Bet;
  label: string;
  pays: string;
  tone: "player" | "banker" | "tie";
  /** Total return on the stake for a win (server baccaratReturnMultiplier). */
  returns: number;
}[] = [
  { id: "player", label: "player", pays: "pays 2×", tone: "player", returns: 2 },
  {
    id: "banker",
    label: "banker",
    pays: "pays 1.95×",
    tone: "banker",
    returns: 1.95,
  },
  { id: "tie", label: "tie", pays: "pays 9×", tone: "tie", returns: 9 },
];

const HOW_TO: GameHowTo = {
  lines: [
    "Pick player, banker or tie, then press deal.",
    "Each hand gets two or three cards by the tableau, and the one closer to 9 wins.",
    "Player pays 2×, banker 1.95× and tie 9×; a tie returns player and banker bets.",
  ],
};

function fmtMult(m: number): string {
  return `${m.toLocaleString("en-US", { maximumFractionDigits: 2 })}×`;
}

function cardValue(c: Card): number {
  return c.rank >= 10 ? 0 : c.rank;
}
function handTotal(cs: Card[]): number {
  return cs.reduce((s, c) => s + cardValue(c), 0) % 10;
}

/* ========================================================================== */
/*  Component                                                                  */
/* ========================================================================== */

type Phase = "setup" | "dealing" | "result";

type BaccaratSettleResponse = {
  payout?: number;
  multiplier?: number;
  seed?: number;
  bet?: Bet;
  outcome?: Outcome;
  playerCards?: Card[];
  bankerCards?: Card[];
  playerTotal?: number;
  bankerTotal?: number;
  natural?: boolean;
  roundId?: string | null;
};

export default function BaccaratClient() {
  const { trigger: triggerFeedback } = useGameFeedback();
  const {
    wallet,
    loaded: walletLoaded,
    refresh: refreshWallet,
    adjustCredits,
  } = useGamesWallet();
  const balance = walletLoaded ? wallet.credits : null;

  const [bet, setBet] = useState<Bet>("banker");
  const [phase, setPhase] = useState<Phase>("setup");
  const [wager, setWager] = useMachineBet(balance, 10, {
    locked: phase === "dealing",
  });
  /* The stake and pick the round was bought with; the receipt prints them. */
  const [roundStake, setRoundStake] = useState(0);
  const [roundBet, setRoundBet] = useState<Bet>("banker");
  const [roundId, setRoundId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Deal state
  const [playerCards, setPlayerCards] = useState<Card[]>([]);
  const [bankerCards, setBankerCards] = useState<Card[]>([]);
  const [revealPlayer, setRevealPlayer] = useState(0);
  const [revealBanker, setRevealBanker] = useState(0);
  const [caption, setCaption] = useState<string>("");
  const [result, setResult] = useState<{
    outcome: Outcome;
    playerTotal: number;
    bankerTotal: number;
    payout: number;
    multiplier: number;
    natural: boolean;
  } | null>(null);

  const [theme, setTheme] = useState<BaccaratCosmeticTheme>(
    DEFAULT_BACCARAT_THEME,
  );

  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const {
    revealedSeed,
    start: startSession,
    settle: settleSession,
    achievements,
  } = useWagerSession("arcade-baccarat");

  // Load equipped cosmetics (best-effort).
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/store/inventory?gameType=baccarat", {
          cache: "no-store",
        });
        if (!res.ok) return;
        const payload = (await res.json()) as InventoryCosmeticResponse;
        if (!cancelled) setTheme(buildBaccaratTheme(payload));
      } catch {
        /* default theme stays */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const clearTimers = useCallback(() => {
    for (const t of timers.current) clearTimeout(t);
    timers.current = [];
  }, []);
  useEffect(() => () => clearTimers(), [clearTimers]);

  const shownPlayer = useMemo(
    () => playerCards.slice(0, revealPlayer),
    [playerCards, revealPlayer],
  );
  const shownBanker = useMemo(
    () => bankerCards.slice(0, revealBanker),
    [bankerCards, revealBanker],
  );
  const shownPlayerTotal = handTotal(shownPlayer);
  const shownBankerTotal = handTotal(shownBanker);

  const runReveal = useCallback(
    (
      pCards: Card[],
      bCards: Card[],
      finalResult: NonNullable<typeof result>,
      betPlaced: Bet,
      settledRoundId: string | null,
    ) => {
      // Build the true deal order: P1, B1, P2, B2, [P3], [B3].
      type Step = { side: "p" | "b"; caption: string };
      const steps: Step[] = [
        { side: "p", caption: "Dealing." },
        { side: "b", caption: "Dealing." },
        { side: "p", caption: "Dealing." },
        {
          side: "b",
          caption: finalResult.natural
            ? `Natural ${Math.max(handTotal(pCards.slice(0, 2)), handTotal(bCards.slice(0, 2)))}, both stand.`
            : "Player draws on 0 to 5 and stands on 6 or 7.",
        },
      ];
      if (pCards.length === 3)
        steps.push({ side: "p", caption: "Player draws a third card." });
      if (bCards.length === 3)
        steps.push({ side: "b", caption: "Banker draws by the tableau." });

      let pShown = 0;
      let bShown = 0;
      steps.forEach((step, idx) => {
        const t = setTimeout(
          () => {
            if (step.side === "p") {
              pShown++;
              setRevealPlayer(pShown);
            } else {
              bShown++;
              setRevealBanker(bShown);
            }
            setCaption(step.caption);
            SoundManager.play("arcadeReveal");
            if (idx === steps.length - 1) {
              const endT = setTimeout(() => {
                setResult(finalResult);
                setRoundId(settledRoundId);
                setPhase("result");
                setCaption("");
                const won = finalResult.payout > 0;
                if (finalResult.outcome === "tie" && betPlaced !== "tie") {
                  SoundManager.play("arcadeReveal"); // push
                } else if (won) {
                  SoundManager.play(
                    finalResult.multiplier >= 8 ? "arcadeBigWin" : "arcadeWin",
                  );
                } else {
                  triggerFeedback("loss");
                }
                void refreshWallet();
              }, 520);
              timers.current.push(endT);
            }
          },
          260 + idx * 620,
        );
        timers.current.push(t);
      });
    },
    [refreshWallet, triggerFeedback],
  );

  const handleDeal = useCallback(async () => {
    if (phase === "dealing") return;
    if (balance == null) return;
    if (wager < ARCADE_MIN_BET) {
      setError(`The smallest bet is ${ARCADE_MIN_BET} tickets.`);
      return;
    }
    if (wager > balance) {
      setError(`You need ${wager} tickets for this bet.`);
      return;
    }

    clearTimers();
    setError(null);
    setResult(null);
    setRoundId(null);
    setPlayerCards([]);
    setBankerCards([]);
    setRevealPlayer(0);
    setRevealBanker(0);
    setCaption("Shuffling the shoe.");
    setPhase("dealing");
    setRoundStake(wager);
    setRoundBet(bet);
    SoundManager.play("arcadeBet");
    adjustCredits(-wager);

    const betPlaced = bet;
    const fail = (message: string) => {
      setError(message);
      setPhase("setup");
      setCaption("");
      void refreshWallet();
    };

    try {
      const session = await startSession(wager, { bet: betPlaced });
      if (!session.ok) {
        fail(machineError(session.error, "The machine could not deal the round."));
        return;
      }

      const settled = await settleSession<BaccaratSettleResponse>();
      if (!settled.ok) {
        fail(machineError(settled.error, "The deal did not go through. Try again."));
        return;
      }
      const data = settled.data;

      const serverPlayer = (data.playerCards ?? []) as Card[];
      const serverBanker = (data.bankerCards ?? []) as Card[];
      const outcome = (data.outcome ?? "tie") as Outcome;

      setPlayerCards(serverPlayer);
      setBankerCards(serverBanker);

      const finalResult = {
        outcome,
        playerTotal: data.playerTotal ?? handTotal(serverPlayer),
        bankerTotal: data.bankerTotal ?? handTotal(serverBanker),
        payout: data.payout ?? 0,
        multiplier: data.multiplier ?? 0,
        natural: data.natural ?? false,
      };

      runReveal(
        serverPlayer,
        serverBanker,
        finalResult,
        betPlaced,
        data.roundId ?? null,
      );
    } catch {
      fail("The machine lost its connection. Try again.");
    }
  }, [
    phase,
    wager,
    balance,
    bet,
    adjustCredits,
    startSession,
    settleSession,
    refreshWallet,
    runReveal,
    clearTimers,
  ]);

  const dealing = phase === "dealing";
  useMachineKey(dealing ? null : () => void handleDeal());

  const affordable = balance != null && wager <= balance;

  // A Player/Banker bet on a Tie PUSHES: the stake is returned (payout > 0) but
  // it is NOT a win. Detect the push from the settled result (multiplier === 1),
  // so `won` excludes it and the receipt says "push" rather than mislabeling
  // the returned stake as a "Tie wins" prize.
  const isPush =
    result != null && result.outcome === "tie" && result.multiplier === 1;
  const won = result != null && result.payout > 0 && !isPush;

  const themeVars = {
    "--bac-felt-top": theme.feltTop,
    "--bac-felt-bottom": theme.feltBottom,
    "--bac-rail": theme.rail,
    "--bac-player": theme.playerBg,
    "--bac-player-hi": theme.playerHi,
    "--bac-player-on": theme.playerOn,
    "--bac-banker": theme.bankerBg,
    "--bac-banker-hi": theme.bankerHi,
    "--bac-banker-on": theme.bankerOn,
    "--bac-tie": theme.tieBg,
    "--bac-tie-hi": theme.tieHi,
    "--bac-tie-on": theme.tieOn,
    /* The winning side's ring is red only when you won; a loss or a push
       marks it in quiet grey. */
    "--bac-accent": won ? theme.accent : "var(--tixy-on-ink-3)",
  } as CSSProperties;

  /* ---------- Screen: the felt table ---------- */
  const winSide = result?.outcome;
  const net = result ? result.payout - roundStake : 0;
  /* What happened, relative to the side you bet: your side, the side that
     won, and the totals. A tie outcome returns a player or banker bet. */
  const resultLine = result
    ? `You bet ${roundBet}. ${
        result.outcome === "tie"
          ? `Both hands total ${result.playerTotal}.`
          : `${result.outcome === "player" ? "Player" : "Banker"} wins ${Math.max(result.playerTotal, result.bankerTotal)} to ${Math.min(result.playerTotal, result.bankerTotal)}.`
      }${isPush ? " Your bet comes back." : ""}`
    : "";
  const resultTone = isPush ? "push" : won ? "win" : "loss";
  const screen = (
    <div className="arc-machine-fit bac-stage" style={themeVars}>
      {phase === "result" && result ? (
        <>
          <p role="status" className="sr-only">
            {`${resultTone === "win" ? "You win" : resultTone === "push" ? "Push" : "You lose"}. ${resultLine}`}
          </p>
          <div className="bac-plate" data-tone={resultTone} aria-hidden>
            <span className="bac-plate-head">
              {resultTone === "win"
                ? "you win"
                : resultTone === "push"
                  ? "push"
                  : "you lose"}
            </span>
            <span className="bac-plate-net arcade-num">
              {net > 0 ? "+" : net < 0 ? "\u2212" : ""}
              {Math.abs(net).toLocaleString()}
            </span>
            <span className="bac-plate-line">{resultLine}</span>
          </div>
        </>
      ) : (
        <p role="status" className="arc-machine-status">
          {phase === "setup"
            ? "Tap player, banker or tie, then deal."
            : caption}
        </p>
      )}

      <div className="bac-felt">
        {/* Player side */}
        <div
          className="bac-hand-col"
          data-win={winSide === "player" || undefined}
        >
          <div className="bac-hand-label bac-label-player">
            player{" "}
            <span className="bac-total">
              {phase === "setup" ? "" : shownPlayerTotal}
            </span>
          </div>
          <div className="bac-cards">
            {phase === "setup" || shownPlayer.length === 0 ? (
              <PlayingCardDeck theme={theme.backTheme} size="md" />
            ) : (
              shownPlayer.map((c, i) => (
                <PlayingCardFace
                  key={`p-${i}`}
                  rank={c.rank}
                  suit={c.suit}
                  size="md"
                  dealIn
                  className={
                    i === shownPlayer.length - 1 && dealing ? "bac-fresh" : ""
                  }
                />
              ))
            )}
          </div>
        </div>

        {/* Banker side */}
        <div
          className="bac-hand-col"
          data-win={winSide === "banker" || undefined}
        >
          <div className="bac-hand-label bac-label-banker">
            banker{" "}
            <span className="bac-total">
              {phase === "setup" ? "" : shownBankerTotal}
            </span>
          </div>
          <div className="bac-cards">
            {phase === "setup" || shownBanker.length === 0 ? (
              <PlayingCardDeck theme={theme.backTheme} size="md" />
            ) : (
              shownBanker.map((c, i) => (
                <PlayingCardFace
                  key={`b-${i}`}
                  rank={c.rank}
                  suit={c.suit}
                  size="md"
                  dealIn
                  className={
                    i === shownBanker.length - 1 && dealing ? "bac-fresh" : ""
                  }
                />
              ))
            )}
          </div>
        </div>
      </div>

      {/* The bet: tap a side. The chosen tile fills paper and carries your
          stake as a stub; the side that won wears a red ring. */}
      <div className="bac-zones" role="group" aria-label="bet on">
        {BETS.map((b) => (
          <button
            key={b.id}
            type="button"
            onClick={() => !dealing && setBet(b.id)}
            disabled={dealing}
            aria-pressed={bet === b.id}
            data-zone={b.tone}
            data-active={bet === b.id || undefined}
            data-win={winSide != null && winSide === b.id ? true : undefined}
            className="bac-zone"
          >
            <span className="bac-zone-label">{b.label}</span>
            <span className="bac-zone-pays arcade-num">{b.pays}</span>
            <span className="bac-zone-stub arcade-num" aria-hidden>
              {bet === b.id ? wager.toLocaleString() : ""}
            </span>
          </button>
        ))}
      </div>

    <style jsx global>{`
      .bac-stage {
        background: var(--bac-felt-top);
      }
      /* The result, once, in the middle of the felt: a red plate with an
         amber stub for a win; anything else is quiet ink. */
      .bac-plate {
        display: grid;
        grid-template-columns: 1fr auto;
        grid-template-areas:
          "head net"
          "line line";
        align-items: center;
        column-gap: 0.75rem;
        row-gap: 2px;
        flex: none;
        width: min(100%, 26rem);
        padding: 0.375rem 0.75rem 0.5rem;
        border-radius: var(--tixy-radius-panel-sm);
        background: var(--tixy-screen-2);
        color: var(--tixy-paper);
      }
      .bac-plate[data-tone="win"] {
        background: var(--tixy-red);
      }
      .bac-plate-head {
        grid-area: head;
        font-size: 1.25rem;
        font-weight: 800;
        line-height: 1.1;
      }
      .bac-plate-net {
        grid-area: net;
        font-size: 1.75rem;
        line-height: 1.05;
        font-variant-numeric: tabular-nums;
        color: var(--tixy-on-ink-2);
      }
      .bac-plate[data-tone="win"] .bac-plate-net {
        padding: 0.0625rem 0.5rem;
        border-radius: 6px;
        background: var(--tixy-ticket);
        color: var(--tixy-ink);
      }
      .bac-plate-line {
        grid-area: line;
        font-size: 0.9375rem;
        line-height: 1.25;
        color: var(--tixy-paper);
      }
      .bac-plate[data-tone="loss"] .bac-plate-line,
      .bac-plate[data-tone="push"] .bac-plate-line {
        color: var(--tixy-on-ink-2);
      }
      .bac-felt {
        /* the card width, from the screen: three cards fit a hand */
        --bac-card: min(7.5rem, 16cqw, 24cqh);
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: clamp(6px, 2cqw, 24px);
        width: 100%;
        max-width: 48rem;
        justify-items: center;
      }
      .bac-hand-col {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 8px;
        padding: 10px clamp(6px, 2cqw, 18px) 14px;
        border-radius: var(--radius-well);
        border: 1.5px solid #ffffff1f;
        background: #ffffff0a;
        transition: box-shadow var(--motion-reveal) var(--ease-snap);
        width: 100%;
      }
      .bac-hand-col[data-win] {
        box-shadow: 0 0 0 3px var(--bac-accent);
        background: #ffffff14;
      }
      .bac-hand-label {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        font-size: 0.72rem;
        font-weight: 800;
        letter-spacing: 0.02em;
        color: #eafff5;
      }
      .bac-total {
        font-variant-numeric: tabular-nums;
        font-size: 1.1rem;
        font-weight: 800;
        min-width: 1.1em;
        text-align: center;
        color: #ffffff;
      }
      .bac-cards {
        display: flex;
        min-height: calc(var(--bac-card) * 1.4);
        align-items: center;
      }
      /* the shared cards size themselves by the viewport; on the machine
         they size by the screen */
      .bac-cards [style*="--pcw"] {
        --pcw: var(--bac-card) !important;
      }
      .bac-cards > * {
        margin-left: calc(var(--bac-card) * -0.3);
      }
      .bac-cards > *:first-child {
        margin-left: 0;
      }
      .bac-zones {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        width: 100%;
        max-width: 30rem;
        gap: clamp(6px, 2vw, 12px);
        margin-top: clamp(4px, 1.5vw, 10px);
      }
      .bac-zone {
        position: relative;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 3px;
        padding: 10px 6px 8px;
        border-radius: var(--radius-tag);
        border: 0;
        /* a quiet tile with its side's colour as a hard lower edge */
        background: var(--tixy-screen-2);
        color: var(--tixy-paper);
        box-shadow: inset 0 -5px 0 var(--_edge);
        font-weight: 800;
        cursor: pointer;
        transition:
          transform var(--motion-press) var(--ease-snap),
          background-color var(--motion-press) var(--ease-snap),
          color var(--motion-press) var(--ease-snap);
      }
      .bac-zone[data-zone="player"] {
        --_edge: var(--bac-player);
      }
      .bac-zone[data-zone="banker"] {
        --_edge: var(--bac-banker);
      }
      .bac-zone[data-zone="tie"] {
        --_edge: var(--bac-tie);
      }
      .bac-zone:not(:disabled):active {
        transform: translateY(2px);
      }
      .bac-zone:focus-visible {
        outline: var(--focus-outline);
        outline-offset: var(--focus-offset);
      }
      /* Your side: paper with ink type, and your stake on a stub. */
      .bac-zone[data-active] {
        background: var(--tixy-paper);
        color: var(--tixy-ink);
      }
      .bac-zone:not([data-active]) {
        color: var(--tixy-on-ink-2);
      }
      .bac-zone:disabled {
        cursor: default;
      }
      .bac-zone[data-win] {
        outline: 3px solid var(--bac-accent);
        outline-offset: 2px;
      }
      .bac-zone-stub {
        min-height: 1.375rem;
        min-width: 2.5rem;
        padding: 0 0.5rem;
        border-radius: 5px;
        font-size: 1rem;
        line-height: 1.375rem;
        text-align: center;
        font-variant-numeric: tabular-nums;
      }
      .bac-zone[data-active] .bac-zone-stub {
        background: var(--tixy-ink);
        color: var(--tixy-ticket);
      }
      .bac-zone-label {
        font-size: 0.85rem;
        letter-spacing: 0.04em;
      }
      .bac-zone-pays {
        font-size: 0.8125rem;
        font-weight: 600;
        font-variant-numeric: tabular-nums;
      }
      @media (prefers-reduced-motion: no-preference) {
        .bac-fresh {
          animation: bac-card-pop var(--motion-reveal) var(--ease-spring) both;
        }
        .bac-zone[data-win] {
          animation: bac-zone-win var(--motion-reveal) var(--ease-spring);
        }
        .bac-plate {
          animation: bac-plate-in 320ms cubic-bezier(0.2, 1.5, 0.4, 1);
        }
      }
      @keyframes bac-card-pop {
        0% {
          transform: translateY(-6px) scale(0.94);
        }
        100% {
          transform: translateY(0) scale(1);
        }
      }
      @keyframes bac-plate-in {
        from {
          transform: scale(0.92);
        }
      }
      @keyframes bac-zone-win {
        0% {
          transform: scale(0.96);
        }
        55% {
          transform: scale(1.06);
        }
        100% {
          transform: scale(1);
        }
      }
    `}</style>
    </div>
  );

  const glass = (
    <MachineGlass
      name="baccarat"
      rules={[
        "The hand closer to 9 wins. A tie returns player and banker bets.",
      ]}
      paytable={BETS.map((b) => ({
        label: b.label,
        value: fmtMult(b.returns),
        lit: won && result?.outcome === b.id && roundBet === b.id,
      }))}
    />
  );

  const action = (
    <MachineButton
      onClick={() => void handleDeal()}
      disabled={!affordable || wager < ARCADE_MIN_BET}
      aria-disabled={dealing || undefined}
      aria-label={`deal, ${wager} tickets on ${bet}`}
    >
      deal
    </MachineButton>
  );

  const receipt =
    phase === "result" && result ? (
      <ArcadeWagerResultPlate
        result={{
          payout: result.payout,
          stake: roundStake,
          multiplier: result.multiplier,
        }}
        kicker="baccarat"
        headline={
          won
            ? fmtMult(result.multiplier)
            : isPush
              ? "push"
              : "you lose"
        }
        detail={`bet ${roundBet}, ${result.outcome === "tie" ? "tie" : `${result.outcome} won`}, player ${result.playerTotal}, banker ${result.bankerTotal}${result.natural ? ", natural" : ""}`}
        fairness={{ seedHash: null, revealedSeed }}
        achievements={achievements}
        roundId={roundId ?? undefined}
        sound={false}
      />
    ) : null;

  return (
    <GameShell
      game="baccarat"
      stat={<GameStat value={fmtMult(Math.max(...BETS.map((b) => b.returns)))} label="top" />}
      howTo={HOW_TO}
    >
      <ArcadeMachine
        name="baccarat"
        glass={glass}
        action={action}
        bet={{
          value: wager,
          onChange: setWager,
          balance,
          disabled: dealing,
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
