// ───────────────────────────────────────────────────────────────────────────
// The season registry. A season is a config: its key, its tier count and XP
// per tier, its tier ladder and its start. Everything that shows or grants
// tiers reads the current season from here, so a season with other numbers
// needs a new entry and no code change.
//
// The live season is the card (season-card.ts), shown as "Season 0" under the
// key `season-0-r2`. The old season 0 (`season-0`) is a legacy entry: its rows
// stay in the database and are never read for the live season.
// ───────────────────────────────────────────────────────────────────────────

import {
  MAX_TIER,
  SEASON_0_END,
  SEASON_0_START_MS,
  SEASON_0_TIERS,
  SEASON_0_TOTAL_WEEKS,
  SEASON_KEY,
  SEASON_NAME,
  XP_PER_TIER,
  type SeasonReward,
} from './season-0';
import {
  SEASON_CARD_KEY,
  SEASON_CARD_MAX_TIER,
  SEASON_CARD_NAME,
  SEASON_CARD_TIERS,
  SEASON_CARD_WEEKS,
  SEASON_CARD_XP_PER_TIER,
  SEASON_END_MS,
  SEASON_START_MS,
} from './season-card';

/** A tier's rewards. `premium` is null where a tier pays one thing. */
export type ConfigTier = { tier: number; free: SeasonReward; premium: SeasonReward | null };

export type SeasonConfig = {
  key: string;
  name: string;
  xpPerTier: number;
  maxTier: number;
  tiers: ConfigTier[];
  startMs: number;
  /** When the season's last week ends; null for a season that has no end here. */
  endMs: number | null;
  totalWeeks: number;
  /** True for the live season: weeks are a card on user_weekly_cards, not the old season's fixed ladder. */
  weeklyCard: boolean;
};

/** The live season, shown as "Season 0": the card, restarted from tier 0 under its own key. */
export const LIVE_SEASON: SeasonConfig = {
  key: SEASON_CARD_KEY,
  name: SEASON_CARD_NAME,
  xpPerTier: SEASON_CARD_XP_PER_TIER,
  maxTier: SEASON_CARD_MAX_TIER,
  tiers: SEASON_CARD_TIERS,
  startMs: SEASON_START_MS,
  endMs: SEASON_END_MS,
  totalWeeks: SEASON_CARD_WEEKS,
  weeklyCard: true,
};

/**
 * The old "Grand Opening" season 0 (key `season-0`, 32 tiers of 600 XP). It was
 * replaced by a restart and is no longer live: nothing reads its rows for a
 * player's season, and it is not in SEASONS. It stays here only so its stored
 * rows can still be read by name (seasonByKey), which the retired close job
 * and its check need.
 */
export const LEGACY_SEASON_0: SeasonConfig = {
  key: SEASON_KEY,
  name: SEASON_NAME,
  xpPerTier: XP_PER_TIER,
  maxTier: MAX_TIER,
  tiers: SEASON_0_TIERS,
  startMs: SEASON_0_START_MS,
  endMs: SEASON_0_END.getTime(),
  totalWeeks: SEASON_0_TOTAL_WEEKS,
  weeklyCard: false,
};

/** The seasons that can be live, oldest first. One today; the next season is future work. */
export const SEASONS: SeasonConfig[] = [LIVE_SEASON];

/** Seasons that have ended and are only readable by key. */
export const LEGACY_SEASONS: SeasonConfig[] = [LEGACY_SEASON_0];

/** The latest season that has started, or the first one before any has. */
export const currentSeason = (nowMs: number = Date.now()): SeasonConfig => {
  let found = SEASONS[0]!;
  for (const season of SEASONS) {
    if (season.startMs <= nowMs) found = season;
  }
  return found;
};

/** A season by its key, live or legacy. Throws for a key that is in neither. */
export const seasonByKey = (key: string): SeasonConfig => {
  const found = [...SEASONS, ...LEGACY_SEASONS].find((season) => season.key === key);
  if (!found) throw new Error(`Unknown season "${key}".`);
  return found;
};

export const seasonTierFromXp = (season: SeasonConfig, xp: number): number =>
  Math.max(0, Math.min(season.maxTier, Math.floor(Math.max(0, xp) / season.xpPerTier)));

/** XP into the current tier and what the next one needs, for the bar. */
export const seasonTierProgress = (season: SeasonConfig, xp: number) => {
  const tier = seasonTierFromXp(season, xp);
  const atMax = tier >= season.maxTier;
  return {
    tier,
    into: atMax ? season.xpPerTier : Math.max(0, xp) - tier * season.xpPerTier,
    need: season.xpPerTier,
    atMax,
  };
};
