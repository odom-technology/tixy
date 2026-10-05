/* ──────────────────────────────────────────────────────────────────────────
   PRIZE CLAW — what is in the case.

   The case holds the prize counter's "new this week" prizes, at most four.
   This module is the pure half of that. It decides which counter item sits in which slot of a bed and which
   simple model draws it. It is presentation only: a slot's tier, grip and
   payout come from the bed and the engine, and a prize's name and shape never
   reach the server. Browser-safe: no I/O, no randomness but the bed's own.
   ────────────────────────────────────────────────────────────────────────── */

import {
  CLAW_TIER_IDS,
  CLAW_TIER_RANK,
  clawBedSubSeed,
  type ClawTierId,
  type PrizeBed,
} from './prize-claw-bed';

/** One prize on the counter, as the case needs it. */
export type ClawShelfItem = {
  id: string;
  /** Lowercase display name. */
  name: string;
  /** What it is, from the counter: "chess pieces", "avatar frame". */
  kind: string;
  price: number;
  gameType: string;
  slots: string[];
  rarity: string;
};

/** The simple models a counter item can take. */
export const CLAW_FORMS = [
  'medal',
  'frame',
  'blocks',
  'ball',
  'critter',
  'banner',
  'box',
] as const;
export type ClawForm = (typeof CLAW_FORMS)[number];

const FORM_BY_SLOT: Record<string, ClawForm> = {
  avatar: 'medal',
  nameColor: 'medal',
  title: 'medal',
  badge: 'medal',
  coin: 'medal',
  wheel: 'medal',
  clock: 'medal',
  dial: 'medal',
  accent: 'medal',
  discs: 'medal',
  board: 'frame',
  frame: 'frame',
  tiles: 'frame',
  grid: 'frame',
  keyboard: 'frame',
  paper: 'frame',
  cardback: 'frame',
  cards: 'frame',
  table: 'frame',
  tray: 'frame',
  blocks: 'blocks',
  bricks: 'blocks',
  pegs: 'blocks',
  pipe: 'blocks',
  paddle: 'blocks',
  pads: 'blocks',
  gems: 'blocks',
  segments: 'blocks',
  obstacle: 'blocks',
  balls: 'ball',
  ball: 'ball',
  bubbles: 'ball',
  trail: 'ball',
  cue: 'ball',
  spots: 'ball',
  fruit: 'ball',
  bird: 'critter',
  gopher: 'critter',
  duck: 'critter',
  ghost: 'critter',
  squad: 'critter',
  climber: 'critter',
  body: 'critter',
  background: 'banner',
  scene: 'banner',
  environment: 'banner',
  theme: 'banner',
  felt: 'banner',
  cloth: 'banner',
  turf: 'banner',
  track: 'banner',
  lane: 'banner',
  booth: 'banner',
};

/** Which model draws a counter item. Anything unlisted is a wrapped box. */
export function clawFormFor(item: Pick<ClawShelfItem, 'slots'>): ClawForm {
  const slot = item.slots[0] ?? '';
  return FORM_BY_SLOT[slot] ?? 'box';
}

/** A prize in the case: the bed's slot, plus the counter item standing in for it. */
export type ClawShelfPrize = {
  index: number;
  tier: ClawTierId;
  item: ClawShelfItem | null;
  form: ClawForm;
};

/** Which counter items sit in each tier's price band, cheapest tier first. */
export function clawShelfBands(
  items: readonly ClawShelfItem[],
): Record<ClawTierId, ClawShelfItem[]> {
  const sorted = [...items].sort(
    (a, b) => a.price - b.price || a.id.localeCompare(b.id),
  );
  const bands = {} as Record<ClawTierId, ClawShelfItem[]>;
  const n = CLAW_TIER_IDS.length;
  CLAW_TIER_IDS.forEach((id, rank) => {
    const from = Math.floor((sorted.length * rank) / n);
    const to = Math.floor((sorted.length * (rank + 1)) / n);
    bands[id] = sorted.slice(from, Math.max(to, from + 1)).filter(Boolean);
  });
  return bands;
}

/**
 * Put a counter item in every slot of a bed. A higher tier draws from a higher
 * price band, so the 120x prize is one of the dearest things on the counter.
 * Deterministic in (bed, items), so the same bed always shows the same case,
 * and two slots only share an item when a band has run out.
 */
export function assignClawShelf(
  bed: PrizeBed,
  items: readonly ClawShelfItem[],
): ClawShelfPrize[] {
  if (items.length === 0) {
    return bed.prizes.map((slot) => ({
      index: slot.index,
      tier: slot.tier,
      item: null,
      form: 'box' as const,
    }));
  }
  const bands = clawShelfBands(items);
  const used = new Set<string>();
  const order = [...bed.prizes].sort(
    (a, b) => CLAW_TIER_RANK[b.tier] - CLAW_TIER_RANK[a.tier] || a.index - b.index,
  );
  const picked = new Map<number, ClawShelfItem>();
  for (const slot of order) {
    const pool = bands[slot.tier];
    const fresh = pool.filter((entry) => !used.has(entry.id));
    const from = fresh.length > 0 ? fresh : pool;
    const roll = clawBedSubSeed(bed.bedSeed, 40 + slot.index) % from.length;
    const item = from[roll]!;
    used.add(item.id);
    picked.set(slot.index, item);
  }
  return bed.prizes.map((slot) => {
    const item = picked.get(slot.index) ?? null;
    return {
      index: slot.index,
      tier: slot.tier,
      item,
      form: item ? clawFormFor(item) : ('box' as const),
    };
  });
}
