"use client";

import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { Moon, Sparkles } from "lucide-react";
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
import { SoundManager } from "@/features/arcade/lib/sound-manager";
import { useWagerSession } from "@/features/arcade/lib/use-wager-session";
import { ARCADE_MIN_BET } from "@/server/arcade/arcade-constants";
import {
  FORTUNE_TIERS,
  FORTUNE_ICONS,
  FORTUNE_CARDS_PER_ROUND,
  getFortuneTable,
  getFortuneCardProb,
  getFortuneTopCard,
  getFortuneMaxProduct,
  type FortuneTier,
} from "@/server/arcade/wager-games/fortune-teller";
import {
  DEFAULT_FORTUNE_TELLER_THEME,
  buildFortuneTellerTheme,
  cardBand,
  type FortuneTellerTheme,
} from "./_fortune-teller-theme";

type InventoryEquipResponse = {
  equipped?: Array<{
    slot?: string;
    item?: { assetRef?: Record<string, unknown> | null } | null;
  }>;
};

type CardData = { mult: number; icon: number };

type SettleResponse = {
  seed: number;
  payout: number;
  multiplier: number;
  tier?: FortuneTier;
  cards?: CardData[];
  product?: number;
  won?: boolean;
  error?: string;
  roundId?: string | null;
};

const HOW_TO: GameHowTo = {
  lines: [
    "Pick a tier and press read to turn three cards.",
    "The three cards multiply together, and one bust card makes the reading 0×.",
    "Seer cards pay up to 5.3× each, so three top cards pay 149×; every tier returns 99%.",
  ],
};

// Reveal order is middle → left → right. cards[0]=middle, [1]=left, [2]=right.
// Visual left-to-right layout maps slots [left, middle, right] = [1, 0, 2].
const VISUAL_ORDER = [1, 0, 2] as const;
const FLIP_DELAYS = [300, 950, 1600] as const; // ms, indexed by card index (0=middle first)
const REVEAL_TAIL_MS = 700;

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

function fmtMult(m: number): string {
  if (m === 0) return "0×";
  if (m >= 1000) return `${Math.round(m).toLocaleString()}×`;
  if (Number.isInteger(m)) return `${m}×`;
  return `${m.toFixed(m < 10 ? 1 : 0)}×`;
}

function fmtProb(p: number): string {
  if (p <= 0) return "0%";
  return p >= 0.001
    ? `${(p * 100).toFixed(2)}%`
    : `1 in ${Math.round(1 / p).toLocaleString()}`;
}

/* ========================================================================== */
/*  Original tarot-style iconography (drawn inline; no external assets)         */
/* ========================================================================== */

function FortuneGlyph({ name, color }: { name: string; color: string }) {
  const common = {
    fill: "none",
    stroke: color,
    strokeWidth: 1.6,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  const paths: Record<string, React.ReactNode> = {
    sun: (
      <>
        <circle cx="12" cy="12" r="4.2" {...common} />
        {Array.from({ length: 8 }).map((_, i) => {
          const a = (i * Math.PI) / 4;
          return (
            <line
              key={i}
              x1={12 + Math.cos(a) * 6.6}
              y1={12 + Math.sin(a) * 6.6}
              x2={12 + Math.cos(a) * 9}
              y2={12 + Math.sin(a) * 9}
              {...common}
            />
          );
        })}
      </>
    ),
    moon: (
      <path d="M15.5 4 A8 8 0 1 0 20 14.5 A6 6 0 1 1 15.5 4 Z" {...common} />
    ),
    star: (
      <path
        d="M12 3 L14 9.5 L20.5 9.5 L15.2 13.5 L17.2 20 L12 16 L6.8 20 L8.8 13.5 L3.5 9.5 L10 9.5 Z"
        {...common}
      />
    ),
    comet: (
      <>
        <circle cx="15.5" cy="8.5" r="3" {...common} />
        <path d="M13.5 10.8 L4 20" {...common} />
        <path d="M16 12 L9 19" {...common} />
      </>
    ),
    eye: (
      <>
        <path d="M3 12 Q12 4 21 12 Q12 20 3 12 Z" {...common} />
        <circle cx="12" cy="12" r="2.6" {...common} />
      </>
    ),
    key: (
      <>
        <circle cx="8" cy="8" r="4" {...common} />
        <path
          d="M11 11 L20 20 M17 17 L19.5 14.5 M15 15 L17.5 12.5"
          {...common}
        />
      </>
    ),
    serpent: (
      <path
        d="M5 18 Q10 18 9 13 Q8 8 13 8 Q18 8 17 13 M15.5 11 L17 13 L18.5 11"
        {...common}
      />
    ),
    lantern: (
      <>
        <path
          d="M9 4 H15 M10 4 V6 H14 V4 M8.5 6 H15.5 L14.5 18 H9.5 Z"
          {...common}
        />
        <path d="M12 9 V15" {...common} />
      </>
    ),
  };
  return (
    <svg viewBox="0 0 24 24" width="100%" height="100%" aria-hidden>
      {paths[name] ?? paths.star}
    </svg>
  );
}

/* ========================================================================== */
/*  Card                                                                        */
/* ========================================================================== */

function FortuneCardView({
  card,
  isTop,
  flipped,
  theme,
  reduced,
}: {
  card: CardData | null;
  isTop: boolean;
  flipped: boolean;
  theme: FortuneTellerTheme;
  reduced: boolean;
}) {
  const band = card ? cardBand(theme, card.mult, isTop) : theme.bust;
  const bust = card != null && card.mult <= 0;
  const iconName = card ? (FORTUNE_ICONS[card.icon] ?? "star") : "star";

  return (
    <div
      className={`ft-card ${flipped ? "is-flipped" : ""} ${reduced ? "is-reduced" : ""}`}
    >
      <div className="ft-card-inner">
        {/* Back (face-down) */}
        <div
          className="ft-face ft-back"
          style={{
            background: theme.backFace,
            borderColor: theme.backEdge,
            color: theme.backInk,
          }}
        >
          <div className="ft-back-motif" style={{ borderColor: theme.backInk }}>
            <Moon size={22} aria-hidden />
          </div>
        </div>
        {/* Front (revealed) */}
        <div
          className={`ft-face ft-front ${bust ? "is-bust" : ""}`}
          style={{
            background: band.face,
            borderColor: band.edge,
            color: band.on,
          }}
        >
          <div className="ft-glyph">
            <FortuneGlyph name={iconName} color={band.on} />
          </div>
          <div className="ft-mult arcade-num">
            {card ? fmtMult(card.mult) : ""}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ========================================================================== */
/*  Component                                                                   */
/* ========================================================================== */

export default function FortuneTellerClient() {
  const { trigger: triggerFeedback } = useGameFeedback();
  const {
    wallet,
    loaded: walletLoaded,
    refresh: refreshWallet,
    adjustCredits,
  } = useGamesWallet();
  const balance = walletLoaded ? wallet.credits : null;
  const [tier, setTier] = useState<FortuneTier>("seer");
  const [error, setError] = useState<string | null>(null);
  const [isReading, setIsReading] = useState(false);
  const [wager, setWager] = useMachineBet(balance, 10, { locked: isReading });

  const [cards, setCards] = useState<CardData[] | null>(null);
  const [flipped, setFlipped] = useState<boolean[]>([false, false, false]);
  const [product, setProduct] = useState<number | null>(null);
  const [payout, setPayout] = useState<number | null>(null);
  const [settledWager, setSettledWager] = useState(10);
  const [settledTier, setSettledTier] = useState<FortuneTier>("seer");
  const [roundId, setRoundId] = useState<string | null>(null);
  const [won, setWon] = useState<boolean | null>(null);
  const [revealDone, setRevealDone] = useState(false);

  const timers = useRef<Array<ReturnType<typeof setTimeout>>>([]);

  const [theme, setTheme] = useState<FortuneTellerTheme>(
    DEFAULT_FORTUNE_TELLER_THEME,
  );

  const {
    revealedSeed,
    start: startSession,
    settle: settleSession,
    reset: resetSession,
    achievements,
  } = useWagerSession("arcade-fortune-teller");

  const table = useMemo(() => getFortuneTable(tier), [tier]);
  const topCard = useMemo(() => getFortuneTopCard(tier), [tier]);
  const maxProduct = useMemo(() => getFortuneMaxProduct(tier), [tier]);
  const bustProb = useMemo(() => getFortuneCardProb(tier, 0), [tier]);

  const clearTimers = useCallback(() => {
    timers.current.forEach((t) => clearTimeout(t));
    timers.current = [];
  }, []);

  useEffect(() => () => clearTimers(), [clearTimers]);

  // Load equipped cosmetics (best-effort); empty loadout keeps the Midway default.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(
          "/api/store/inventory?gameType=fortune-teller",
          { cache: "no-store" },
        );
        if (!res.ok) return;
        const payload = (await res.json()) as InventoryEquipResponse;
        if (!cancelled)
          setTheme(buildFortuneTellerTheme(payload.equipped ?? []));
      } catch {
        /* default theme stays */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const resetRound = useCallback(() => {
    clearTimers();
    setCards(null);
    setFlipped([false, false, false]);
    setProduct(null);
    setPayout(null);
    setWon(null);
    setRevealDone(false);
    setRoundId(null);
    setError(null);
    resetSession();
  }, [clearTimers, resetSession]);

  const handleRead = useCallback(async () => {
    if (isReading) return;
    if (balance == null) return;
    setError(null);
    if (wager < ARCADE_MIN_BET) {
      setError(`The smallest bet is ${ARCADE_MIN_BET} tickets.`);
      return;
    }
    if (wager > balance) {
      setError(`You need ${wager} tickets for this bet.`);
      return;
    }

    clearTimers();
    setIsReading(true);
    setSettledWager(wager);
    setSettledTier(tier);
    setRoundId(null);
    setCards(null);
    setFlipped([false, false, false]);
    setProduct(null);
    setPayout(null);
    setWon(null);
    setRevealDone(false);
    SoundManager.play("arcadeBet");
    adjustCredits(-wager);

    const reduced = prefersReducedMotion();
    const currentTier = tier;
    const fail = (message: string) => {
      setError(message);
      void refreshWallet();
      setIsReading(false);
    };

    try {
      const session = await startSession(wager, { tier: currentTier });
      if (!session.ok) {
        fail(
          machineError(session.error, "The machine could not start the reading."),
        );
        return;
      }

      const settled = await settleSession<SettleResponse>();
      if (!settled.ok) {
        fail(
          machineError(settled.error, "The reading did not go through. Try again."),
        );
        return;
      }
      const data = settled.data;
      const dealt = data.cards ?? [];
      if (dealt.length !== FORTUNE_CARDS_PER_ROUND) {
        fail("The reading came back incomplete.");
        return;
      }

      const prod = data.product ?? dealt.reduce((p, c) => p * c.mult, 1);
      // Trust the server's authoritative `won` (product > 0): a tiny winning
      // product can round its payout to 0, which is NOT a bust — the cards
      // visibly show positive multipliers in that case (review fix).
      const didWin = data.won ?? data.payout > 0;
      setCards(dealt);

      const finish = () => {
        setProduct(prod);
        setPayout(data.payout);
        setWon(didWin);
        setRoundId(data.roundId ?? null);
        setRevealDone(true);
        if (didWin) {
          SoundManager.play(
            prod >= 25
              ? "arcadeBigWin"
              : prod >= 2
                ? "arcadeWin"
                : "arcadeCashout",
          );
        } else {
          triggerFeedback("loss");
        }
        void refreshWallet();
        setIsReading(false);
      };

      if (reduced) {
        setFlipped([true, true, true]);
        finish();
        return;
      }

      // Flip middle (0) → left (1) → right (2) with a tick per reveal.
      for (let i = 0; i < FORTUNE_CARDS_PER_ROUND; i++) {
        timers.current.push(
          setTimeout(() => {
            setFlipped((prev) => {
              const next = [...prev];
              next[i] = true;
              return next;
            });
            const isBust = dealt[i]!.mult <= 0;
            SoundManager.play(isBust ? "arcadeLose" : "arcadeReveal");
          }, FLIP_DELAYS[i]),
        );
      }
      timers.current.push(setTimeout(finish, FLIP_DELAYS[2] + REVEAL_TAIL_MS));
    } catch {
      fail("The machine lost its connection. Try again.");
    }
  }, [
    isReading,
    wager,
    balance,
    tier,
    adjustCredits,
    clearTimers,
    startSession,
    settleSession,
    refreshWallet,
    triggerFeedback,
  ]);

  // Space reads the cards.
  useMachineKey(isReading ? null : () => void handleRead());

  const runningProduct = useMemo(() => {
    if (!cards) return null;
    let p = 1;
    let any = false;
    for (let i = 0; i < cards.length; i++) {
      if (flipped[i]) {
        p *= cards[i]!.mult;
        any = true;
      }
    }
    return any ? p : null;
  }, [cards, flipped]);

  const affordable = balance != null && wager <= balance;
  const tierBust = `${Math.round(bustProb * 100)}%`;

  /* ---------- Screen ---------- */
  const screen = (
    <div className="arc-machine-fit ft-well">
      {/* Crystal ball */}
      <div className={`ft-ball ${isReading ? "is-gazing" : ""}`} aria-hidden>
        <div
          className="ft-ball-orb"
          style={{
            background: `radial-gradient(circle at 38% 32%, #ffffffcc, ${theme.ballHalo} 34%, ${theme.ballCore} 66%, ${theme.ballRim} 100%)`,
          }}
        >
          <Sparkles
            size={18}
            style={{ color: theme.ballOn, opacity: 0.55 }}
            aria-hidden
          />
        </div>
        <div
          className="ft-ball-base"
          style={{ background: theme.ballRim, borderColor: theme.backEdge }}
        />
      </div>

      {/* Three cards, laid out left → middle → right */}
      <div className="ft-cards">
        {VISUAL_ORDER.map((cardIndex) => {
          const c = cards ? (cards[cardIndex] ?? null) : null;
          const isTop = c != null && c.mult === topCard;
          return (
            <FortuneCardView
              key={cardIndex}
              card={c}
              isTop={isTop}
              flipped={flipped[cardIndex] ?? false}
              theme={theme}
              reduced={prefersReducedMotion()}
            />
          );
        })}
      </div>

      {/* Running readout */}
      <div className="flex h-9 items-center justify-center" role="status">
        {runningProduct != null ? (
          <p
            className={`arcade-num text-2xl leading-none font-bold sm:text-3xl ${
              runningProduct <= 0
                ? "text-danger-text"
                : revealDone && won
                  ? "text-prize-text"
                  : "text-strong"
            }`}
          >
            {runningProduct <= 0 ? "0×" : fmtMult(runningProduct)}
            {revealDone ? (
              <span className="ml-2 align-middle text-xs font-semibold">
                {won ? `+${(payout ?? 0).toLocaleString()}` : "bust"}
              </span>
            ) : null}
          </p>
        ) : (
          <p className="arc-machine-status">Pick a tier and read the cards.</p>
        )}
      </div>

    <style jsx global>{`
      .ft-well {
        background:
          radial-gradient(
            120% 90% at 50% 0%,
            ${theme.clothTop},
            transparent 62%
          ),
          linear-gradient(180deg, ${theme.clothTop}, ${theme.clothBottom});
      }
      .ft-ball {
        position: relative;
        width: clamp(48px, 16cqmin, 104px);
        margin-bottom: clamp(0px, 2cqmin, 16px);
      }
      .ft-ball-orb {
        position: relative;
        width: 100%;
        aspect-ratio: 1;
        border-radius: 50%;
        display: grid;
        place-items: center;
        box-shadow:
          inset 0 -6px 14px #00000055,
          0 6px 16px #00000060;
      }
      .ft-ball-base {
        width: 62%;
        height: 12px;
        margin: -4px auto 0;
        border-radius: 0 0 40% 40% / 0 0 100% 100%;
        border: 1px solid;
      }
      .ft-ball.is-gazing .ft-ball-orb {
        animation: ft-glow 1.4s ease-in-out infinite;
      }
      @keyframes ft-glow {
        0%,
        100% {
          filter: brightness(1);
        }
        50% {
          filter: brightness(1.22);
        }
      }
      .ft-cards {
        display: flex;
        gap: clamp(8px, 3cqmin, 20px);
        justify-content: center;
        align-items: center;
        perspective: 900px;
      }
      .ft-card {
        width: clamp(64px, min(21cqw, 28cqh), 128px);
        aspect-ratio: 5 / 7.4;
      }
      .ft-card-inner {
        position: relative;
        width: 100%;
        height: 100%;
        transform-style: preserve-3d;
        transition: transform 620ms cubic-bezier(0.34, 1.32, 0.5, 1);
      }
      .ft-card.is-flipped .ft-card-inner {
        transform: rotateY(180deg);
      }
      .ft-card.is-reduced .ft-card-inner {
        transition: none;
      }
      .ft-card.is-flipped .ft-front.is-bust {
        animation: ft-crumble 620ms ease-out both;
      }
      .ft-face {
        position: absolute;
        inset: 0;
        border-radius: 12px;
        border: 2px solid;
        backface-visibility: hidden;
        -webkit-backface-visibility: hidden;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        box-shadow: 0 5px 14px #00000055;
        overflow: hidden;
      }
      .ft-back {
      }
      .ft-back-motif {
        width: 54%;
        aspect-ratio: 1;
        border: 2px solid;
        border-radius: 50%;
        display: grid;
        place-items: center;
        opacity: 0.65;
      }
      .ft-front {
        transform: rotateY(180deg);
        gap: 6%;
      }
      .ft-front.is-bust {
        opacity: 0.9;
      }
      .ft-glyph {
        width: 44%;
        aspect-ratio: 1;
        opacity: 0.92;
      }
      .ft-mult {
        font-size: clamp(13px, 4.4cqmin, 22px);
        font-weight: 700;
      }
      @keyframes ft-crumble {
        0% {
          filter: grayscale(0.2) brightness(1);
        }
        100% {
          filter: grayscale(0.85) brightness(0.8);
        }
      }
      @media (prefers-reduced-motion: reduce) {
        .ft-card-inner {
          transition: none;
        }
        .ft-ball.is-gazing .ft-ball-orb {
          animation: none;
        }
        .ft-card.is-flipped .ft-front.is-bust {
          animation: none;
          filter: grayscale(0.85) brightness(0.8);
        }
      }
    `}</style>
    </div>
  );

  const glass = (
    <MachineGlass
      name="fortune teller"
      rules={[
        `Three cards multiply together. At ${tier}, ${tierBust} of cards bust and a bust makes it 0×.`,
      ]}
      paytable={table
        .filter((b) => b.mult > 0)
        .map((b) => ({
          label: fmtMult(b.mult),
          value: fmtProb(getFortuneCardProb(tier, b.mult)),
          lit:
            revealDone &&
            settledTier === tier &&
            (cards?.some((c) => c.mult === b.mult) ?? false),
        }))}
    />
  );

  const action = (
    <MachineButton
      onClick={() => void handleRead()}
      disabled={!affordable || wager < ARCADE_MIN_BET}
      aria-disabled={isReading || undefined}
      aria-label={`read, ${wager} tickets`}
    >
      read
    </MachineButton>
  );

  const receipt =
    revealDone && payout != null ? (
      <ArcadeWagerResultPlate
        result={{
          payout: payout ?? 0,
          stake: settledWager,
          multiplier: product,
        }}
        kicker="fortune teller"
        headline={product != null && product > 0 ? fmtMult(product) : "bust"}
        detail={
          cards
            ? `${settledTier}, ${VISUAL_ORDER.map((i) => fmtMult(cards[i]?.mult ?? 0)).join(", ")}`
            : settledTier
        }
        fairness={{ seedHash: null, revealedSeed }}
        achievements={achievements}
        roundId={roundId ?? undefined}
        sound={false}
      />
    ) : null;

  return (
    <GameShell
      game="fortune-teller"
      stat={
        <GameStat
          value={`${Math.round(maxProduct).toLocaleString()}×`}
          label="top"
        />
      }
      howTo={HOW_TO}
    >
      <ArcadeMachine
        name="fortune teller"
        glass={glass}
        action={action}
        bet={{ value: wager, onChange: setWager, balance, disabled: isReading }}
        controls={
          <MachineChoice
            label="tier"
            options={FORTUNE_TIERS.map((t) => ({ value: t, label: t }))}
            value={tier}
            onChange={(t) => {
              setTier(t);
              if (revealDone) resetRound();
            }}
            disabled={isReading}
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
