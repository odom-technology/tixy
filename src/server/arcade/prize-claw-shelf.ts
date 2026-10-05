import type { ClawShelfItem } from '@/features/arcade/lib/prize-claw-shelf';
import { getCounterItem, isNewThisWeek } from '@/features/arcade/lib/skins/counter-catalog';

import { COUNTER_NEW_LIMIT } from './rewards/counter';
import { getServerDateKey } from './rewards/helpers';
import { readCounter } from './tixy-home';

/**
 * What the prize claw's case holds: the prizes on the counter's "new this
 * week" shelf (PROGRESSION.md), newest first and at most four, read the way
 * the home page reads the counter (today's rotation, active, priced), with
 * nothing taken off for what you own, since the case is the counter and not
 * your inventory. Empty when the counter is closed, the read fails or nothing
 * is new this week; the case then shows its plain boxes.
 */
export async function getPrizeClawShelf(): Promise<ClawShelfItem[]> {
  try {
    const dateKey = getServerDateKey();
    const counter = await readCounter(null);
    return (counter?.unowned ?? [])
      .filter((prize) => isNewThisWeek(prize.id, dateKey))
      .sort((a, b) => (getCounterItem(b.id)?.newOn ?? '').localeCompare(getCounterItem(a.id)?.newOn ?? ''))
      .slice(0, COUNTER_NEW_LIMIT)
      .map((prize) => ({
        id: prize.id,
        name: prize.name,
        kind: prize.kind,
        price: prize.price,
        gameType: prize.gameType,
        slots: prize.slots,
        rarity: prize.rarity,
      }));
  } catch {
    return [];
  }
}
