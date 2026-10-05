// ───────────────────────────────────────────────────────────────────────────
// The weekly card (PROGRESSION.md "The season card"). Pure: no database.
//
// A week is five quests: one for each of three floor games
// picked for the week, then "play 15" and "earn 600". Together they pay 330
// tickets and 950 XP, the same as a week of the old season 0. The picks are a hash of the
// season, the week and the game, filtered by isOnFloor() at pick time, so a
// game off the floor is never picked. A card's rows are written once, the first
// time a player's week is touched, so the games on it never change under them.
//
// The tour is gone. Its three games a week now come from here.
// ───────────────────────────────────────────────────────────────────────────

import crypto from 'node:crypto';

import { isOnFloor } from '@/features/arcade/components/arcade-game-registry';

import type { QuestTemplate } from './season-0';

export const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
export const WEEKLY_CARD_GAME_COUNT = 3;

/** The floor's solo skill games, the same pool as the featured game. */
export const WEEKLY_CARD_POOL: readonly { slug: string; title: string }[] = [
  { slug: 'snake', title: 'Snake' },
  { slug: '2048', title: '2048' },
  { slug: 'stack', title: 'Stack' },
  { slug: 'skee-ball', title: 'Skee-Ball' },
  { slug: 'high-striker', title: 'High Striker' },
  { slug: 'tin-duck', title: 'Tin Duck Gallery' },
  { slug: 'ticket-stop', title: 'Ticket Stop' },
  { slug: 'flappy-bird', title: 'Flappy Bird' },
  { slug: 'ricochet', title: 'Ricochet' },
  // Ring toss
  { slug: 'ring-toss', title: 'Ring Toss' },
];

const GAME_ROUNDS = 5;
const GAME_XP = 200;
const GAME_TICKETS = 70;

const gameQuest = (slug: string, title: string): QuestTemplate => ({
  key: `wc-play-${slug}`,
  kind: 'play_game',
  label: `Play ${GAME_ROUNDS} rounds of ${title}`,
  goal: GAME_ROUNDS,
  rewardXp: GAME_XP,
  rewardTickets: GAME_TICKETS,
  targetGame: slug,
});

const PLAY_15: QuestTemplate = {
  key: 'wc-play-15',
  kind: 'play_any',
  label: 'Play 15 games',
  goal: 15,
  rewardXp: 150,
  rewardTickets: 50,
};

const EARN_600: QuestTemplate = {
  key: 'wc-earn-600',
  kind: 'earn_tickets',
  label: 'Earn 600 tickets',
  goal: 600,
  rewardXp: 200,
  rewardTickets: 70,
};

const templates = new Map<string, QuestTemplate>(
  [...WEEKLY_CARD_POOL.map((g) => gameQuest(g.slug, g.title)), PLAY_15, EARN_600].map(
    (q) => [q.key, q] as const,
  ),
);

/** A card quest by its stored key, for labels. Null for an unknown key. */
export const getWeeklyCardTemplate = (key: string): QuestTemplate | null => templates.get(key) ?? null;

/** The three games for a week: floor games only, the same for every player. */
export const pickWeeklyCardGames = (
  seasonKey: string,
  week: number,
  onFloor: (slug: string) => boolean = isOnFloor,
): string[] =>
  WEEKLY_CARD_POOL.filter((g) => onFloor(g.slug))
    .map((g) => ({
      slug: g.slug,
      order: crypto.createHash('sha256').update(`weekly-card:${seasonKey}:${week}:${g.slug}`).digest().readUInt32BE(0),
    }))
    .sort((a, b) => a.order - b.order || a.slug.localeCompare(b.slug))
    .slice(0, WEEKLY_CARD_GAME_COUNT)
    .map((g) => g.slug);

/** The five quests of a week's card, in slot order. */
export const weeklyCardQuests = (
  seasonKey: string,
  week: number,
  onFloor: (slug: string) => boolean = isOnFloor,
): QuestTemplate[] => [
  ...pickWeeklyCardGames(seasonKey, week, onFloor).map((slug) => templates.get(`wc-play-${slug}`)!),
  PLAY_15,
  EARN_600,
];

export const weeklyCardTotals = (quests: readonly QuestTemplate[]) => ({
  tickets: quests.reduce((sum, q) => sum + q.rewardTickets, 0),
  xp: quests.reduce((sum, q) => sum + q.rewardXp, 0),
});

/**
 * The card week for a time: 1-based, counted from the season's start in 7-day
 * blocks, or null before the season starts, after its last week, or for a
 * season with no weekly card.
 */
export const weeklyCardWeek = (
  season: { weeklyCard: boolean; startMs: number; totalWeeks: number },
  nowMs: number = Date.now(),
): number | null => {
  if (!season.weeklyCard || nowMs < season.startMs) return null;
  const week = Math.floor((nowMs - season.startMs) / WEEK_MS) + 1;
  return week > season.totalWeeks ? null : week;
};
