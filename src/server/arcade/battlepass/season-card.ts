// ───────────────────────────────────────────────────────────────────────────
// The live season, shown to players as "Season 0" (PROGRESSION.md "The season
// card"). One track for everyone: 30 tiers at 800 XP over 8 weeks. 25 tiers pay
// tickets and 6 pay a prize from the art kit (tier 30 pays both): 9,050 tickets
// in all, the same as the old season 0's two tracks together.
//
// This is the card that was built as "season 1". Season 0 was restarted
// with it instead of closing the old one, so it carries a fresh stored key,
// `season-0-r2`, and the old `season-0` rows are never read for it. Stored
// keys never change, so the prize ids keep their `s1-` prefix.
//
// A tier can pay two things. The first is `free`, the second `premium`, the
// column names the old season stored its claims under. There is no paid track:
// `premium` only holds tier 30's prize. Prizes are never sold.
// ───────────────────────────────────────────────────────────────────────────

import { artPath, type ArtItem } from '@/features/brand/avatars/catalog';
import { ART } from '@/features/brand/avatars/palette';

import type { SeasonItem, SeasonReward } from './season-0';
import { WEEK_MS } from './weekly-card';

/** The stored key of the live season's progress, claims and weekly cards. */
export const SEASON_CARD_KEY = 'season-0-r2';
export const SEASON_CARD_NAME = 'Season 0';
export const SEASON_CARD_XP_PER_TIER = 800;
export const SEASON_CARD_MAX_TIER = 30;
export const SEASON_CARD_WEEKS = 8;
/**
 * When the live season starts: Monday 5 October 2026 at 00:00 UTC, the deploy
 * day. Odom can move it. Keep it a Monday at 00:00 UTC: card weeks count from
 * it in 7-day blocks, and the floor changes on Mondays at 00:00 UTC.
 */
export const SEASON_START = new Date('2026-10-05T00:00:00.000Z');
export const SEASON_START_MS = SEASON_START.getTime();
export const SEASON_END_MS = SEASON_START_MS + SEASON_CARD_WEEKS * WEEK_MS;

/** A kit item as the profile reads it: the file under public/ is the art. */
const kitPath = (item: Pick<ArtItem, 'id' | 'kind'>) => artPath(item, 'svg');

export type SeasonPrize = SeasonItem & {
  /** The art kit file the prize is drawn from, shown at 32 px on the card. */
  art: string | null;
};

const prize = (
  id: string,
  name: string,
  slot: string,
  kit: Pick<ArtItem, 'id' | 'kind'>,
  assetRef: Record<string, unknown>,
): SeasonPrize => ({
  id,
  name,
  gameType: 'profile',
  slot,
  rarity: 'rare',
  assetRef: { imageUrl: kitPath(kit), ...assetRef },
  art: kitPath(kit),
});

export const SEASON_CARD_ITEMS: SeasonPrize[] = [
  prize('s1-frame-ticket', 'ticket ring', 'frame', { id: 'frame-ticket', kind: 'frame' }, { color: ART.amber }),
  prize('s1-namecard-lights', 'string lights', 'background', { id: 'namecard-lights', kind: 'namecard' }, {}),
  {
    id: 's1-snake-ticket',
    name: 'ticket snake',
    gameType: 'snake',
    slot: 'body',
    rarity: 'rare',
    assetRef: { bodyPrimary: ART.amber, bodySecondary: ART.amberDark },
    art: null,
  },
  prize('s1-stub-ticket-cap', 'ticket cap', 'avatar', { id: 'stub-season-1', kind: 'avatar' }, {}),
  prize('s1-medal-season-1', 'season 0 medal', 'badge', { id: 'medal-season-1', kind: 'medal' }, {}),
  prize('s1-stub-crown', 'strip crown', 'avatar', { id: 'stub-crown', kind: 'avatar' }, {}),
];

const tix = (amount: number): SeasonReward => ({ kind: 'tickets', amount });
const item = (itemId: string): SeasonReward => ({ kind: 'item', itemId });

export type SeasonCardTier = { tier: number; free: SeasonReward; premium: SeasonReward | null };

/* Tiers 1 to 4 pay 175, 6 to 9 pay 225, 11 to 14 pay 300, 16 to 19 pay 375,
   21 to 24 pay 450, 26 to 29 pay 550. Tiers 5, 10, 15, 20 and 25 pay a prize,
   and tier 30 pays 750 and the crown. */
const BANDS: { from: number; amount: number }[] = [
  { from: 1, amount: 175 },
  { from: 6, amount: 225 },
  { from: 11, amount: 300 },
  { from: 16, amount: 375 },
  { from: 21, amount: 450 },
  { from: 26, amount: 550 },
];
const PRIZES: Record<number, string> = {
  5: 's1-frame-ticket',
  10: 's1-namecard-lights',
  15: 's1-snake-ticket',
  20: 's1-stub-ticket-cap',
  25: 's1-medal-season-1',
};

export const SEASON_CARD_TIERS: SeasonCardTier[] = Array.from({ length: SEASON_CARD_MAX_TIER }, (_, index) => {
  const tier = index + 1;
  if (tier === SEASON_CARD_MAX_TIER) return { tier, free: tix(750), premium: item('s1-stub-crown') };
  const prizeId = PRIZES[tier];
  if (prizeId) return { tier, free: item(prizeId), premium: null };
  const band = [...BANDS].reverse().find((b) => tier >= b.from)!;
  return { tier, free: tix(band.amount), premium: null };
});

export const seasonTicketTotal = (tiers: readonly { free: SeasonReward; premium: SeasonReward | null }[]) =>
  tiers.reduce(
    (sum, t) =>
      sum +
      [t.free, t.premium].reduce((s, r) => s + (r && r.kind === 'tickets' ? r.amount : 0), 0),
    0,
  );
