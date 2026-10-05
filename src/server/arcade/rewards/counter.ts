/* The prize counter around the store's items: the pinned prize, "new this
   week", and how far the next prize is (PROGRESSION.md, "How far to the
   next prize"):

     balance = credits + store_credits
     prizes  = counter items the player doesn't own
     target  = the pinned prize, if it's still in prizes,
               else the cheapest prize priced above balance (ties: the newest)
     away    = target.price - balance
     rate    = mean tickets a day over the last 7 days, from ledger rows with
               source game_reward, daily_claim, battlepass, level_reward,
               achievement, monthly_reward or weekly_board, counting only days
               with any
     days    = ceil(away / rate), shown only when rate > 0 and 3 or more
               days count

   Wager payouts stay out of the rate: they are stakes coming back. The pin
   lives in the account's data (`counter.pin`), with no migration. */

import { getArcadeGameBySlug } from '@/features/arcade/components/arcade-game-registry';
import { getCounterItem, isNewThisWeek } from '@/features/arcade/lib/skins/counter-catalog';
import { query, queryOne } from '@/server/db/client';

import type { StoreItem } from './types';

export const COUNTER_PIN_KEY = 'counter.pin';
export const COUNTER_NEW_LIMIT = 4;
const PACE_SOURCES = ['game_reward', 'daily_claim', 'battlepass', 'level_reward', 'achievement', 'monthly_reward', 'weekly_board'];
const PACE_WINDOW_MS = 7 * 86_400_000;
const PACE_MIN_DAYS = 3;

const PROFILE_KINDS: Record<string, string> = {
  avatar: 'avatar',
  frame: 'avatar frame',
  title: 'title',
  background: 'namecard',
  badge: 'badge',
  nameColor: 'name colour',
};

/* "snake skin", "avatar", "8-ball table". The catalog says it for counter
   prizes; anything else is described from its game and slot. */
export function describeCounterItem(item: Pick<StoreItem, 'id' | 'gameType' | 'slots'>): string {
  const known = getCounterItem(item.id);
  if (known) return known.kind;
  const slot = item.slots[0] ?? '';
  if (item.gameType === 'profile') return PROFILE_KINDS[slot] ?? 'profile';
  const game = (getArcadeGameBySlug(item.gameType)?.title ?? item.gameType).toLowerCase();
  const word = slot.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[-_]/g, ' ').toLowerCase();
  return word ? `${game} ${word}` : game;
}

export type CounterPace = {
  /* Mean tickets a day, or null when fewer than 3 days count. */
  ticketsPerDay: number | null;
  daysCounted: number;
};

export type CounterNext = {
  itemId: string;
  pinned: boolean;
  /* Tickets still to earn; 0 or less means you can afford it now. */
  away: number;
  /* Days at your pace, when there is a pace. */
  days: number | null;
};

export type CounterSummary = {
  pinnedItemId: string | null;
  newThisWeek: string[];
  pace: CounterPace;
  next: CounterNext | null;
  /* True when nothing on the counter is priced above the balance and
     nothing is pinned. */
  canAffordEverything: boolean;
};

export async function getPinnedPrize(userId: string): Promise<string | null> {
  const row = await queryOne<{ value_json: string }>(
    `SELECT value_json FROM arcade_account_data WHERE user_id = $1 AND key = $2`,
    [userId, COUNTER_PIN_KEY],
  );
  if (!row) return null;
  try {
    const value = JSON.parse(row.value_json) as { itemId?: unknown };
    return typeof value.itemId === 'string' && value.itemId ? value.itemId : null;
  } catch {
    return null;
  }
}

/* Pin a prize, or clear the pin with null. Only an unowned prize that is on
   the counter today can be pinned. */
export async function setPinnedPrize(userId: string, itemId: string | null, onCounter: ReadonlySet<string>) {
  if (itemId !== null && !onCounter.has(itemId)) {
    throw new Error('That prize is not on the counter.');
  }
  await query(
    `INSERT INTO arcade_account_data (user_id, key, value_json, updated_at)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id, key) DO UPDATE SET
       value_json = EXCLUDED.value_json,
       updated_at = EXCLUDED.updated_at`,
    [userId, COUNTER_PIN_KEY, JSON.stringify({ itemId }), Date.now()],
  );
  return itemId;
}

export async function getCounterPace(userId: string, now = Date.now()): Promise<CounterPace> {
  const rows = (
    await query<{ day: string; total: string }>(
      `SELECT to_char(to_timestamp(created_at / 1000.0) AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day,
              SUM(amount) AS total
         FROM currency_ledger
        WHERE user_id = $1
          AND amount > 0
          AND source_type = ANY($2::text[])
          AND created_at >= $3
        GROUP BY 1`,
      [userId, PACE_SOURCES, now - PACE_WINDOW_MS],
    )
  ).rows;
  const days = rows.filter((row) => Number(row.total) > 0);
  if (days.length < PACE_MIN_DAYS) return { ticketsPerDay: null, daysCounted: days.length };
  const total = days.reduce((sum, row) => sum + Number(row.total), 0);
  return { ticketsPerDay: total / days.length, daysCounted: days.length };
}

type CounterEntry = { item: StoreItem; owned: boolean };

/* The next prize by the formula above. `entries` is today's counter. */
export function pickNextPrize(
  entries: readonly CounterEntry[],
  balance: number,
  pinnedItemId: string | null,
  pace: CounterPace,
): { next: CounterNext | null; canAffordEverything: boolean } {
  const prizes = entries.filter((entry) => !entry.owned).map((entry) => entry.item);
  const pinned = pinnedItemId ? prizes.find((item) => item.id === pinnedItemId) : undefined;
  const target =
    pinned ??
    [...prizes]
      .filter((item) => item.price > balance)
      .sort((a, b) => a.price - b.price || b.createdAt - a.createdAt || a.name.localeCompare(b.name))[0];
  if (!target) return { next: null, canAffordEverything: prizes.length > 0 };
  const away = target.price - balance;
  const rate = pace.ticketsPerDay;
  return {
    next: {
      itemId: target.id,
      pinned: Boolean(pinned),
      away,
      days: away > 0 && rate && rate > 0 ? Math.ceil(away / rate) : null,
    },
    canAffordEverything: false,
  };
}

/* This week's drop, newest first, at most four. */
export function pickNewThisWeek(entries: readonly CounterEntry[], dateKey: string): string[] {
  return entries
    .filter((entry) => isNewThisWeek(entry.item.id, dateKey))
    .sort((a, b) => (getCounterItem(b.item.id)?.newOn ?? '').localeCompare(getCounterItem(a.item.id)?.newOn ?? ''))
    .slice(0, COUNTER_NEW_LIMIT)
    .map((entry) => entry.item.id);
}
