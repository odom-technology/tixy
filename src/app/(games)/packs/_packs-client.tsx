"use client";

import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { X, BookOpen, Sparkles } from "lucide-react";
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
  ArcadeButton,
  ArcadeProgress,
} from "@/features/arcade/components/ui/arcade-ui";
import { SoundManager } from "@/features/arcade/lib/sound-manager";
import {
  PACK_RARITY_STYLES,
  type PackRarity as Rarity,
} from "@/features/arcade/lib/loot-rarity";
import { useWagerSession } from "@/features/arcade/lib/use-wager-session";
import { ARCADE_MIN_BET } from "@/server/arcade/arcade-constants";
import { CardArt } from "./_card-art";
import { PACK_ENAMELS, packTierVars } from "./_packs-midway-theme";
import "./_packs-midway.css";

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/* ===========================================================================
 *  Types + constants
 * ========================================================================= */

type Phase = "idle" | "opening" | "revealing" | "result";

type PackCard = {
  mult: number;
  rarity: Rarity;
  theme: string;
  holo: boolean;
};

type SettleResponse = {
  payout: number;
  multiplier: number;
  seed: number;
  roundId?: string | null;
  cards?: PackCard[];
  totalMultiplier?: number;
  error?: string;
};

const HOW_TO: GameHowTo = {
  lines: [
    "Press open to rip a pack of five cards.",
    "Each card shows a multiple of your bet, and the pack pays the five added up.",
    "Cards run from 0× duds to 1,000× for a mythic, and packs return 97% over many opens.",
  ],
};

/** The most a card of each rarity pays (server PACKS_WIN_BUCKETS). */
const GLASS_ROWS: { rarity: Rarity; value: string }[] = [
  { rarity: "common", value: "0.1×" },
  { rarity: "uncommon", value: "0.5×" },
  { rarity: "rare", value: "2×" },
  { rarity: "epic", value: "25×" },
  { rarity: "legendary", value: "100×" },
  { rarity: "ultra", value: "200×" },
  { rarity: "mythic", value: "1,000×" },
];

/* ---- Theme metadata ---- */

const THEME_NAMES: Record<string, string> = {
  snake: "Snake",
  flappy: "Flappy Bird",
  eightball: "8-Ball",
  tetris: "Tetris",
  coinflip: "Coin Flip",
  typing: "Typing Test",
  reaction: "Reaction",
  connections: "Connections",
  mines: "Mines",
  slots: "Slots",
  crash: "Crash",
  wheel: "Lucky Wheel",
  plinko: "Plinko",
  dice: "Dice",
  chicken: "Chicken",
  hilo: "Hi-Lo",
  cases: "Cases",
  packs: "Packs",
  chrome: "Chrome",
  holocron: "Holocron",
};

const ALL_THEMES = Object.keys(THEME_NAMES);

/* ---- Rarity palette (shared module; packs-specific tiers) ---- */

const COLLECTIBLE_RARITIES: Rarity[] = [
  "common",
  "uncommon",
  "rare",
  "epic",
  "legendary",
  "ultra",
  "mythic",
];

/* ---- Collection helpers (localStorage) ---- */

const COLLECTION_KEY = "holocron-packs-collection";

type CollectionEntry = { firstPulled: number };
type CollectionData = Record<string, CollectionEntry>;

function cardCollectionId(
  theme: string,
  rarity: Rarity,
  holo: boolean,
): string {
  if (rarity === "dud") return ""; // duds not collected
  return `${theme}-${rarity}${holo ? "-holo" : ""}`;
}

function loadCollection(): CollectionData {
  try {
    const raw = localStorage.getItem(COLLECTION_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as CollectionData;
  } catch {
    return {};
  }
}

function saveCollection(data: CollectionData) {
  try {
    localStorage.setItem(COLLECTION_KEY, JSON.stringify(data));
  } catch {
    /* quota exceeded — ignore */
  }
}

function addToCollection(cards: PackCard[]): { newIds: Set<string> } {
  const data = loadCollection();
  const newIds = new Set<string>();
  const now = Date.now();
  for (const card of cards) {
    const id = cardCollectionId(card.theme, card.rarity, card.holo);
    if (!id) continue;
    if (!data[id]) {
      data[id] = { firstPulled: now };
      newIds.add(id);
    }
  }
  saveCollection(data);
  return { newIds };
}

function getTotalCollectionSize(): number {
  // 20 themes × 6 non-mythic tiers × 2 (reg/holo) + 1 mythic holo
  return ALL_THEMES.length * (COLLECTIBLE_RARITIES.length - 1) * 2 + 1;
}

/* ---- Rarity-based timing ---- */

/** The CSS flip transition duration (ms). Rare+ flip slower for drama. */
function cardFlipDuration(rarity: Rarity): number {
  switch (rarity) {
    case "mythic":
      return 900;
    case "ultra":
      return 800;
    case "legendary":
      return 700;
    case "epic":
      return 600;
    case "rare":
      return 500;
    default:
      return 350;
  }
}

/** Whether this rarity should show a pre-flip glow tease. */
function isHighRarity(rarity: Rarity): boolean {
  return (
    rarity === "rare" ||
    rarity === "epic" ||
    rarity === "legendary" ||
    rarity === "ultra" ||
    rarity === "mythic"
  );
}

/* ---- Format helpers ---- */

function formatMult(m: number): string {
  if (m === 0) return "0×";
  if (m >= 1000) return `${m.toLocaleString()}×`;
  if (m >= 100) return `${m.toFixed(0)}×`;
  if (m >= 1) return `${m.toFixed(1)}×`;
  return `${m.toFixed(2)}×`;
}

/* ---- Shared enamel card face ----
   One face, used by BOTH the reveal flip and the result row, so a card looks
   identical the instant it lands and after — no size jump between phases.
   Every metric is a container-query unit (cqi = 1% of the card's own width),
   so the art, text, badges, and padding scale WITH the card at any size. The
   parent card slot sets `container-type: inline-size`. */
function PackCardFace({
  card,
  isNew,
  showOverlays = true,
}: {
  card: PackCard;
  isNew: boolean;
  showOverlays?: boolean;
}) {
  const label = PACK_RARITY_STYLES[card.rarity].label.toLowerCase();
  const accent = PACK_ENAMELS[card.rarity].base;
  const themeName = THEME_NAMES[card.theme] ?? card.theme;

  return (
    <div
      className="pk-card-face"
      /* inline position beats the scoped `.packs-midway .pk-card-face`
         (relative) rule so the face actually fills the full card slot. */
      style={{ position: "absolute", inset: 0, backfaceVisibility: "hidden" }}
    >
      {card.holo && showOverlays && <div className="pk-holo" aria-hidden />}

      <div className="relative z-[1] flex h-full flex-col items-center justify-between p-[7cqi]">
        <div className="pk-card-mult self-end text-[11cqi] leading-none">
          {formatMult(card.mult)}
        </div>
        <div className="aspect-square w-[56cqi]">
          <CardArt
            theme={card.theme}
            size={100}
            accent={accent}
            className="h-full w-full"
          />
        </div>
        <div className="w-full text-center leading-tight">
          <div className="pk-card-name truncate text-[10.5cqi]">
            {themeName}
          </div>
          <div className="pk-card-tier text-[7.5cqi]">{label}</div>
        </div>
      </div>

      {card.holo && showOverlays && (
        <div className="absolute right-[5cqi] top-[5cqi] z-[1]">
          <Sparkles
            className="pk-holo-badge"
            style={{ width: "13cqi", height: "13cqi" }}
            aria-hidden
          />
        </div>
      )}
      {isNew && showOverlays && (
        <div className="pk-new absolute left-[5cqi] top-[5cqi] z-[1] rounded-[2cqi] px-[5cqi] py-[1.5cqi] text-[8cqi] leading-none">
          new
        </div>
      )}
    </div>
  );
}

/* ===========================================================================
 *  Component
 * ========================================================================= */

export default function PacksClient() {
  const { trigger: triggerFeedback } = useGameFeedback();
  const {
    wallet,
    loaded: walletLoaded,
    refresh: refreshWallet,
    adjustCredits,
  } = useGamesWallet();
  const balance = walletLoaded ? wallet.credits : null;

  const [phase, setPhase] = useState<Phase>("idle");
  const [isOpening, setIsOpening] = useState(false);
  const [wager, setWager] = useMachineBet(balance, 10, { locked: isOpening });
  /* The stake the pack was bought with; the receipt prints it. */
  const [roundStake, setRoundStake] = useState(0);
  const [roundId, setRoundId] = useState<string | null>(null);
  const [cards, setCards] = useState<PackCard[]>([]);
  const [revealedCount, setRevealedCount] = useState(0);
  const [teasingIndex, setTeasingIndex] = useState<number | null>(null);
  const [payout, setPayout] = useState(0);
  const [totalMult, setTotalMult] = useState(0);
  const [newCardIds, setNewCardIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const {
    revealedSeed,
    start: startSession,
    settle: settleSession,
    achievements,
  } = useWagerSession("arcade-packs");

  // Collection modal
  const [showCollection, setShowCollection] = useState(false);
  const [collection, setCollection] = useState<CollectionData>({});
  const [collectionFilter, setCollectionFilter] = useState<Rarity | "all">(
    "all",
  );

  /* ---------- Reveal timer ---------- */
  const revealTimerRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  const clearRevealTimers = useCallback(() => {
    for (const t of revealTimerRef.current) clearTimeout(t);
    revealTimerRef.current = [];
  }, []);

  useEffect(() => () => clearRevealTimers(), [clearRevealTimers]);

  /* ---------- Open pack ---------- */
  const handleOpen = useCallback(async () => {
    if (isOpening) return;
    if (balance == null) return;
    setError(null);
    if (wager > balance) {
      setError(`You need ${wager} tickets for this bet.`);
      return;
    }

    // The last pack's view goes: the new pack waits face down.
    clearRevealTimers();
    setPhase("idle");
    setCards([]);
    setRevealedCount(0);
    setTeasingIndex(null);
    setPayout(0);
    setTotalMult(0);
    setNewCardIds(new Set());
    setRoundId(null);
    setRoundStake(wager);
    setIsOpening(true);
    SoundManager.play("arcadeBet");
    adjustCredits(-wager);

    try {
      // 1. Create session
      const session = await startSession(wager, {});
      if (!session.ok) {
        setError(
          machineError(session.error, "The machine could not open the pack."),
        );
        setIsOpening(false);
        void refreshWallet();
        return;
      }

      // 2. Settle immediately (single-action game)
      const settled = await settleSession<SettleResponse>();
      if (!settled.ok) {
        setError(
          machineError(settled.error, "The pack did not open. Try again."),
        );
        setIsOpening(false);
        void refreshWallet();
        return;
      }
      const settleData = settled.data;

      const drawnCards = settleData.cards ?? [];
      const tm = settleData.totalMultiplier ?? settleData.multiplier;

      setCards(drawnCards);
      setTotalMult(tm);
      setPayout(settleData.payout);
      setRoundId(settleData.roundId ?? null);
      setRevealedCount(0);

      // Save to collection
      const { newIds } = addToCollection(drawnCards);
      setNewCardIds(newIds);

      // 3. Start reveal animation
      setPhase("opening");
      setTeasingIndex(null);

      const reduced = prefersReducedMotion();
      const timers: ReturnType<typeof setTimeout>[] = [];
      const baseDelay = reduced ? 0 : 350; // quick pack-open transition

      // After pack opens, transition to revealing
      timers.push(setTimeout(() => setPhase("revealing"), baseDelay));

      // Flip each card with rarity-dependent timing.
      // Rare+ cards get a "tease" bevel before flipping. Under reduced
      // motion, skip teases and reveal straight through with no flip delay.
      let cursor = baseDelay + (reduced ? 0 : 200);
      for (let i = 0; i < drawnCards.length; i++) {
        const card = drawnCards[i]!;
        const teaseMs = !reduced && isHighRarity(card.rarity) ? 500 : 0;

        // Tease: highlight the back of the card before flipping
        if (teaseMs > 0) {
          const teaseAt = cursor;
          timers.push(setTimeout(() => setTeasingIndex(i), teaseAt));
          cursor += teaseMs;
        }

        // Flip
        const flipAt = cursor;
        timers.push(
          setTimeout(() => {
            setTeasingIndex(null);
            setRevealedCount(i + 1);
            if (card.rarity === "mythic" || card.rarity === "ultra") {
              triggerFeedback("jackpot");
            } else if (card.rarity === "legendary" || card.rarity === "epic") {
              triggerFeedback("round-win");
            } else {
              SoundManager.play("arcadeReveal");
            }
          }, flipAt),
        );

        // Wait for the flip to visually complete + a brief hold before next card
        cursor += reduced ? 60 : cardFlipDuration(card.rarity) + 120;
      }

      // Show result after all cards revealed + a short beat
      timers.push(
        setTimeout(() => {
          setPhase("result");
          setIsOpening(false);
          if (settleData.payout === 0) {
            triggerFeedback("loss");
          } else if (tm >= 5) {
            SoundManager.play("arcadeBigWin");
          } else {
            triggerFeedback("cashout");
          }
          void refreshWallet();
        }, cursor + 400),
      );

      revealTimerRef.current = timers;
    } catch {
      setError("The machine lost its connection. Try again.");
      setIsOpening(false);
      void refreshWallet();
    }
  }, [
    isOpening,
    wager,
    balance,
    clearRevealTimers,
    refreshWallet,
    startSession,
    settleSession,
    adjustCredits,
    triggerFeedback,
  ]);

  /* ---------- Keyboard: Space opens a pack ---------- */
  useMachineKey(isOpening ? null : () => void handleOpen());

  /* ---------- Collection modal ---------- */
  const openCollection = useCallback(() => {
    setCollection(loadCollection());
    setShowCollection(true);
  }, []);

  const collectionTotal = useMemo(() => getTotalCollectionSize(), []);
  const collectionCount = useMemo(
    () => Object.keys(collection).length,
    [collection],
  );

  const collectionCards = useMemo(() => {
    const entries: {
      id: string;
      theme: string;
      rarity: Rarity;
      holo: boolean;
      owned: boolean;
    }[] = [];
    for (const rarity of COLLECTIBLE_RARITIES) {
      if (rarity === "mythic") {
        // Mythic is only holocron-holo
        const id = "holocron-mythic-holo";
        entries.push({
          id,
          theme: "holocron",
          rarity,
          holo: true,
          owned: !!collection[id],
        });
      } else {
        for (const theme of ALL_THEMES) {
          const regId = `${theme}-${rarity}`;
          const holoId = `${theme}-${rarity}-holo`;
          entries.push({
            id: regId,
            theme,
            rarity,
            holo: false,
            owned: !!collection[regId],
          });
          entries.push({
            id: holoId,
            theme,
            rarity,
            holo: true,
            owned: !!collection[holoId],
          });
        }
      }
    }
    if (collectionFilter === "all") return entries;
    return entries.filter((e) => e.rarity === collectionFilter);
  }, [collection, collectionFilter]);

  /* ---------- Render ---------- */
  const affordable = balance != null && wager <= balance;

  const screen = (
    <div className="arc-machine-fit packs-midway">
      <div className="flex w-full items-center justify-between gap-3">
        <ArcadeButton tone="ghost" size="xs" onClick={openCollection}>
          <BookOpen size={14} aria-hidden />
          collection
        </ArcadeButton>
        <p role="status" className="arc-machine-status">
          {phase === "idle"
            ? isOpening
              ? "Opening."
              : "Five cards a pack."
            : phase === "opening"
              ? "Opening."
              : phase === "revealing"
                ? `Card ${revealedCount} of 5.`
                : payout > 0
                  ? `${formatMult(totalMult)} in all.`
                  : "Empty pack."}
        </p>
      </div>

      {/* ─── IDLE: pack preview only ─── */}
      {phase === "idle" && (
        <div className="flex justify-center py-2">
          <div className="relative">
            <div className="pk-pack h-52 w-40 transition-transform hover:scale-[1.03] sm:h-64 sm:w-48">
              {/* Pack face */}
              <div className="flex h-full flex-col items-center justify-center gap-2">
                <CardArt
                  theme="packs"
                  size={64}
                  accent="var(--enamel-tickets)"
                />
                <div className="pk-pack-plate text-sm">tixy</div>
                <div className="pk-pack-sub text-[10px]">PACK</div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ─── OPENING / REVEALING ─── */}
      {(phase === "opening" || phase === "revealing") && (
        <div className="w-full">
          {/* 5-col grid so cards always fit AND grow to fill the wide stage;
              each slot is a query container so the face scales in cqi. */}
          <div className="mx-auto grid w-full max-w-[52rem] grid-cols-5 gap-2 sm:gap-3">
            {cards.map((card, i) => {
              const isRevealed = i < revealedCount;
              const isTeasing = teasingIndex === i;
              const collId = cardCollectionId(
                card.theme,
                card.rarity,
                card.holo,
              );
              const isNew = collId ? newCardIds.has(collId) : false;
              const flipMs = cardFlipDuration(card.rarity);

              return (
                <div
                  key={i}
                  className="pk-cell relative"
                  style={{
                    aspectRatio: "2.5 / 3.5",
                    containerType: "inline-size",
                    perspective: "900px",
                    ...packTierVars(card.rarity),
                  }}
                >
                  {/* Tease: hard bevel ring behind card for rare+ */}
                  {isTeasing && <div className="pk-tease" aria-hidden />}
                  <div
                    className="pk-flip absolute inset-0 z-10"
                    style={{
                      transformStyle: "preserve-3d",
                      transform: isRevealed
                        ? "rotateY(0deg)"
                        : isTeasing
                          ? "rotateY(180deg) scale(1.04)"
                          : "rotateY(180deg)",
                      transition: `transform ${flipMs}ms cubic-bezier(0.16, 1, 0.3, 1)`,
                    }}
                  >
                    {/* Front face — shared enamel chip (fills the full slot) */}
                    <PackCardFace
                      card={card}
                      isNew={isNew}
                      showOverlays={isRevealed}
                    />

                    {/* Back face — wood card stock */}
                    <div
                      className="pk-card-back absolute inset-0"
                      style={{
                        backfaceVisibility: "hidden",
                        transform: "rotateY(180deg)",
                      }}
                    >
                      <div className="flex h-full items-center justify-center">
                        <div className="pk-card-back-q text-[30cqi]">?</div>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Running tally */}
          {revealedCount > 0 && (
            <div className="mt-4 text-center">
              <div className="text-xs text-faint">total</div>
              <div className="text-xl font-bold tabular-nums">
                {formatMult(
                  cards.slice(0, revealedCount).reduce((s, c) => s + c.mult, 0),
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ─── RESULT ─── */}
      {phase === "result" && (
        <div className="w-full">
          {/* Final cards — same grid + shared face as the reveal, so the
                cards never shift when the round resolves. */}
          <div className="mx-auto grid w-full max-w-[52rem] grid-cols-5 gap-2 sm:gap-3">
            {cards.map((card, i) => {
              const collId = cardCollectionId(
                card.theme,
                card.rarity,
                card.holo,
              );
              const isNew = collId ? newCardIds.has(collId) : false;
              return (
                <div
                  key={i}
                  className="pk-cell pk-cell-final relative"
                  style={{
                    aspectRatio: "2.5 / 3.5",
                    containerType: "inline-size",
                    ...packTierVars(card.rarity),
                  }}
                >
                  <PackCardFace card={card} isNew={isNew} />
                </div>
              );
            })}
          </div>

        </div>
      )}
    </div>
  );

  const glass = (
    <MachineGlass
      name="packs"
      rules={[
        "Each card pays up to its rarity's multiple of the bet, and the pack pays all five added up.",
      ]}
      paytable={GLASS_ROWS.map((row) => ({
        label: row.rarity,
        value: row.value,
        lit:
          phase === "result" && cards.some((card) => card.rarity === row.rarity),
      }))}
    />
  );

  const action = (
    <MachineButton
      onClick={() => void handleOpen()}
      disabled={!affordable || wager < ARCADE_MIN_BET}
      aria-disabled={isOpening || undefined}
      aria-label={`open, ${wager} tickets`}
    >
      open
    </MachineButton>
  );

  const receipt =
    phase === "result" ? (
      <ArcadeWagerResultPlate
        result={{
          payout,
          stake: roundStake,
          multiplier: totalMult,
          jackpot: totalMult >= 25,
        }}
        kicker="packs"
        headline={formatMult(totalMult)}
        detail={cards.map((card) => formatMult(card.mult)).join(", ")}
        fairness={{ seedHash: null, revealedSeed }}
        achievements={achievements}
        roundId={roundId ?? undefined}
        sound={false}
      />
    ) : null;

  return (
    <GameShell
      game="packs"
      stat={<GameStat value="1,000×" label="card" />}
      howTo={HOW_TO}
    >
      <ArcadeMachine
        name="packs"
        glass={glass}
        action={action}
        bet={{ value: wager, onChange: setWager, balance, disabled: isOpening }}
        receipt={receipt}
        receiptKey={roundId}
        notice={error}
      >
        {screen}
      </ArcadeMachine>

      {/* ─── Collection Modal ─── */}
      {showCollection && (
        <div className="packs-midway fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4">
          <div
            className="arc-modal max-h-[80vh] max-w-2xl"
            role="dialog"
            aria-modal="true"
            aria-label="collection"
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b border-soft px-5 py-4">
              <div>
                <h2 className="text-lg font-bold">collection</h2>
                <p className="text-xs text-faint">
                  {collectionCount} / {collectionTotal} collected
                </p>
              </div>
              <ArcadeButton
                tone="ghost"
                size="icon-sm"
                onClick={() => setShowCollection(false)}
                aria-label="close"
              >
                <X size={18} />
              </ArcadeButton>
            </div>

            {/* Progress bar */}
            <div className="px-5 pt-3">
              <ArcadeProgress
                tone="tickets"
                current={collectionCount}
                max={collectionTotal}
              />
            </div>

            {/* Rarity filter */}
            <div className="flex flex-wrap gap-1.5 px-5 pt-3">
              {(["all", ...COLLECTIBLE_RARITIES] as const).map((r) => {
                const active = collectionFilter === r;
                return (
                  <ArcadeButton
                    key={r}
                    size="xs"
                    tone={active ? "info" : "ghost"}
                    pressed={active}
                    onClick={() => setCollectionFilter(r)}
                  >
                    {r === "all" ? "all" : r}
                  </ArcadeButton>
                );
              })}
            </div>

            {/* Card grid */}
            <div
              className="overflow-y-auto px-5 py-4"
              style={{ maxHeight: "calc(80vh - 180px)" }}
            >
              <div className="grid grid-cols-6 gap-2 sm:grid-cols-8">
                {collectionCards.map((entry) => {
                  const label =
                    PACK_RARITY_STYLES[entry.rarity].label.toLowerCase();
                  const accent = PACK_ENAMELS[entry.rarity].base;
                  const themeName = THEME_NAMES[entry.theme] ?? entry.theme;

                  return (
                    <div
                      key={entry.id}
                      className={`relative transition-transform hover:scale-105 ${
                        entry.owned
                          ? "pk-card-face"
                          : "pk-coll-locked grayscale opacity-40"
                      }`}
                      style={{
                        aspectRatio: "2.5/3.5",
                        ...(entry.owned
                          ? packTierVars(entry.rarity)
                          : undefined),
                      }}
                    >
                      <div className="relative z-[1] flex h-full flex-col items-center justify-center gap-0.5 p-1">
                        <CardArt
                          theme={entry.theme}
                          size={24}
                          accent={entry.owned ? accent : "#5a6772"}
                        />
                        {entry.owned ? (
                          <>
                            <div className="pk-card-name truncate text-[6px] leading-tight">
                              {themeName}
                            </div>
                            <div className="pk-card-tier text-[5px]">
                              {label}
                            </div>
                          </>
                        ) : (
                          <>
                            <div className="truncate text-[6px] font-bold leading-tight text-faint">
                              {themeName}
                            </div>
                            <div className="text-[5px] font-medium tracking-wider text-faint opacity-70">
                              {label}
                            </div>
                          </>
                        )}
                      </div>

                      {/* Holo indicator — static matte iridescence */}
                      {entry.holo && entry.owned && (
                        <>
                          <div className="pk-holo" aria-hidden />
                          <div className="absolute right-0.5 top-0.5 z-[1]">
                            <Sparkles size={7} className="pk-holo-badge" />
                          </div>
                        </>
                      )}

                      {entry.holo && !entry.owned && (
                        <div className="absolute right-0.5 top-0.5 z-[1]">
                          <Sparkles size={7} className="text-faint" />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}
    </GameShell>
  );
}
