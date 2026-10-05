import crypto from 'node:crypto';

import {
  GAME_SLOTS,
  GLOBAL_ITEM_OWNER_ID,
  type GameSlot,
  type RewardGameType,
  type StoreRarity,
} from '@/features/arcade/lib/rewards';
import { playerItemName } from '@/features/arcade/lib/item-names';
import { isOnCounterBy } from '@/features/arcade/lib/skins/counter-catalog';
import { readSkinSet } from '@/features/arcade/lib/skins/skin-set';
import { isAvatarAssetPath } from '@/features/users/avatars';
import { query, queryOne, withTransaction } from '@/server/db/client';
import { recordActivityEvent } from '@/server/services/activity-events';
import { assertNoActiveMonetizationAccountFlagForTransaction } from '@/server/monetization/account-flags';

import {
  describeCounterItem,
  getCounterPace,
  getPinnedPrize,
  pickNewThisWeek,
  pickNextPrize,
  type CounterSummary,
} from './counter';
import { isRewardOnlyItem } from './reward-only-items';

import type {
  EquippedStoreItem,
  OwnedStoreItem,
  RotationEntry,
  StoreItem,
  StoreVisibilityConfig,
} from './types';
import {
  getDailyGameCreditsProgress,
  getWalletForUser,
  mutateWalletAndLedgerForTransaction,
} from './wallet';
import {
  getCombinedWalletForTransaction,
  mutateStoreCreditsForTransaction,
} from './store-credits';

const STORE_VISIBILITY_SETTINGS_ID = 'games-store-visibility';
const DEFAULT_STORE_VISIBILITY_CONFIG: StoreVisibilityConfig = {
  creditsEnabled: true,
  gameCreditsEnabled: true,
};

type StoreItemRow = {
  id: string;
  name: string;
  game_type: string;
  rarity: string;
  currency_type: string;
  price: number | string;
  slots_json: string;
  active: boolean | number | string;
  season_tag: string | null;
  asset_ref: string | null;
  created_at: number | string;
};

type OwnedRow = StoreItemRow & {
  user_id: string;
  item_id: string;
  acquired_at: number | string;
  acquired_source: string;
};

type EquippedRow = StoreItemRow & {
  slot: string;
  equipped_at: number | string;
};

const pad2 = (value: number) => value.toString().padStart(2, '0');

const getServerDateKey = (date: Date = new Date()) =>
  `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;

const normalizeBoolean = (value: boolean | number | string) =>
  value === true || value === 1 || value === '1' || value === 'true';

const parseJsonObject = (raw: string | null): Record<string, unknown> | null => {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
};

const parseSlots = (row: StoreItemRow): GameSlot[] => {
  try {
    const parsed = JSON.parse(row.slots_json) as unknown;
    if (!Array.isArray(parsed)) return [];
    const gameSlots = GAME_SLOTS[row.game_type as RewardGameType] ?? [];
    return parsed.filter(
      (slot): slot is GameSlot =>
        typeof slot === 'string' && gameSlots.includes(slot as GameSlot),
    );
  } catch {
    return [];
  }
};

const parseStoreItemRow = (row: StoreItemRow): StoreItem => ({
  id: row.id,
  name: playerItemName(row.name),
  gameType: row.game_type as RewardGameType,
  rarity: row.rarity as StoreRarity,
  currencyType: 'credits',
  price: Number(row.price ?? 0),
  slots: parseSlots(row),
  active: normalizeBoolean(row.active),
  seasonTag: row.season_tag,
  assetRef: parseJsonObject(row.asset_ref),
  createdAt: Number(row.created_at ?? 0),
});

const activeStoreItemsSql = `
  SELECT id, name, game_type, rarity, currency_type, price, slots_json, active, season_tag, asset_ref, created_at
  FROM store_items
  WHERE active = TRUE
    AND game_type != 'reaction-time'
`;

export async function getStoreVisibilityConfig(): Promise<StoreVisibilityConfig> {
  const row = await queryOne<{ config_json: string }>(
    `SELECT config_json FROM site_settings WHERE id = $1 LIMIT 1`,
    [STORE_VISIBILITY_SETTINGS_ID],
  );
  if (!row?.config_json) return { ...DEFAULT_STORE_VISIBILITY_CONFIG };
  try {
    const parsed = JSON.parse(row.config_json) as Partial<StoreVisibilityConfig>;
    return {
      creditsEnabled:
        typeof parsed.creditsEnabled === 'boolean'
          ? parsed.creditsEnabled
          : DEFAULT_STORE_VISIBILITY_CONFIG.creditsEnabled,
      gameCreditsEnabled:
        typeof parsed.gameCreditsEnabled === 'boolean'
          ? parsed.gameCreditsEnabled
          : DEFAULT_STORE_VISIBILITY_CONFIG.gameCreditsEnabled,
    };
  } catch {
    return { ...DEFAULT_STORE_VISIBILITY_CONFIG };
  }
}

export async function setStoreVisibilityConfig({
  creditsEnabled,
  gameCreditsEnabled,
  actorUserId,
}: {
  creditsEnabled?: boolean;
  gameCreditsEnabled?: boolean;
  actorUserId?: string | null;
}) {
  const previous = await getStoreVisibilityConfig();
  const next: StoreVisibilityConfig = {
    creditsEnabled:
      typeof creditsEnabled === 'boolean' ? creditsEnabled : previous.creditsEnabled,
    gameCreditsEnabled:
      typeof gameCreditsEnabled === 'boolean'
        ? gameCreditsEnabled
        : previous.gameCreditsEnabled,
  };
  await query(
    `INSERT INTO site_settings (id, config_json, updated_at, updated_by)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT(id) DO UPDATE SET
       config_json = excluded.config_json,
       updated_at = excluded.updated_at,
       updated_by = excluded.updated_by`,
    [
      STORE_VISIBILITY_SETTINGS_ID,
      JSON.stringify(next),
      Date.now(),
      actorUserId ?? null,
    ],
  );
  return next;
}

export async function getStoreCatalog(): Promise<StoreItem[]> {
  const rows = (
    await query<StoreItemRow>(
      `SELECT id, name, game_type, rarity, currency_type, price, slots_json, active, season_tag, asset_ref, created_at
       FROM store_items
       WHERE currency_type = 'credits'
       ORDER BY active DESC, currency_type ASC, game_type ASC, price ASC, name ASC`,
    )
  ).rows;
  return rows.map(parseStoreItemRow);
}

/**
 * Fetch a single store item that `userId` actually owns — used to render the
 * "featured item" showcase on a profile. Returns null if the user doesn't own
 * it (covers global `__all_users__` grants too), so a stale or un-owned
 * featuredItemId simply renders nothing.
 */
export async function getFeaturedProfileItem(
  userId: string,
  itemId: string,
): Promise<StoreItem | null> {
  if (!itemId) return null;
  const row = await queryOne<StoreItemRow>(
    `SELECT i.id, i.name, i.game_type, i.rarity, i.currency_type, i.price,
            i.slots_json, i.active, i.season_tag, i.asset_ref, i.created_at
       FROM store_items i
       JOIN user_owned_items o ON o.item_id = i.id
      WHERE i.id = $1 AND o.user_id IN ($2, $3)
      LIMIT 1`,
    [itemId, userId, GLOBAL_ITEM_OWNER_ID],
  );
  return row ? parseStoreItemRow(row) : null;
}

const normalizeItemIds = (itemIds: string[]) => {
  const normalized = Array.from(new Set(itemIds.map((id) => id.trim()).filter(Boolean)));
  if (normalized.length === 0) throw new Error('At least one item id is required.');
  return normalized;
};

/**
 * Retire catalog items (the default for DELETE /api/admin/db/rewards; the same
 * as the console's "Set inactive"): off sale and out of every rotation. Nobody
 * loses anything. Owners keep the item, it stays equipped and equippable, and
 * profiles keep showing it. "Push To Store" or "Set active" brings it back,
 * and the deploy seeds never do (see scripts/migrate.ts).
 */
export async function retireStoreCatalogItems(itemIds: string[]) {
  const normalizedItemIds = normalizeItemIds(itemIds);

  return withTransaction(async (client) => {
    const retired = await client.query<{ id: string }>(
      'UPDATE store_items SET active = FALSE WHERE id = ANY($1::text[]) RETURNING id',
      [normalizedItemIds],
    );
    const retiredItemIds = retired.rows.map((row) => row.id);
    const retiredSet = new Set(retiredItemIds);
    let rotationDeleted = 0;
    if (retiredItemIds.length > 0) {
      rotationDeleted += (await client.query('DELETE FROM store_daily_rotation WHERE item_id = ANY($1::text[])', [retiredItemIds])).rowCount ?? 0;
      rotationDeleted += (await client.query('DELETE FROM store_daily_beskar WHERE item_id = ANY($1::text[])', [retiredItemIds])).rowCount ?? 0;
    }
    const owners = await client.query<{ count: string }>(
      'SELECT COUNT(*) AS count FROM user_owned_items WHERE item_id = ANY($1::text[])',
      [retiredItemIds],
    );

    return {
      requested: normalizedItemIds.length,
      retiredItemIds,
      missingItemIds: normalizedItemIds.filter((id) => !retiredSet.has(id)),
      rotationDeleted,
      ownersKept: Number(owners.rows[0]?.count ?? 0),
    };
  });
}

export type StoreCatalogDeleteBlocker = {
  itemId: string;
  name: string;
  owners: number;
  equipped: number;
  onSale: boolean;
  /** Earned from an achievement, the battle pass, a milestone or an admin grant. */
  reward: boolean;
};

/** Thrown when a true delete is refused. Nothing is deleted. */
export class StoreCatalogDeleteRefusedError extends Error {
  readonly blockers: StoreCatalogDeleteBlocker[];

  constructor(blockers: StoreCatalogDeleteBlocker[], message?: string) {
    const describe = (blocker: StoreCatalogDeleteBlocker) => {
      const reasons = [
        blocker.owners > 0 ? `${blocker.owners} owner${blocker.owners === 1 ? '' : 's'}` : null,
        blocker.equipped > 0 && blocker.owners === 0 ? `equipped ${blocker.equipped} time${blocker.equipped === 1 ? '' : 's'}` : null,
        blocker.onSale ? 'on sale' : null,
        blocker.reward ? 'earned reward' : null,
      ].filter(Boolean);
      return `${blocker.name} (${reasons.join(', ')})`;
    };
    const listed = blockers.slice(0, 5).map(describe).join('; ');
    const more = blockers.length > 5 ? `; and ${blockers.length - 5} more` : '';
    super(
      message ??
        `Nothing was deleted. Only inactive items that nobody owns and nobody earns can be deleted. Blocked: ${listed}${more}. Set them inactive instead; anyone who owns one keeps it.`,
    );
    this.name = 'StoreCatalogDeleteRefusedError';
    this.blockers = blockers;
  }
}

/**
 * Delete catalog items for good. Refuses the whole request, deleting nothing,
 * if any item is owned by anyone (including a grant to all players), is
 * equipped by anyone, is still on sale, or is an earned reward (achievement,
 * battle pass, milestone or admin item; code grants those by id, so deleting
 * one would make future unlocks grant nothing).
 *
 * Locks, in this order: FOR UPDATE on the item rows (purchase and
 * grantStoreItem take FOR SHARE on the row in the same transaction as their
 * insert, so they finish first or wait and then find no item), then a SHARE
 * lock on the ownership tables, which waits for any open transaction that has
 * already written ownership and blocks new writes until this commits. Any
 * wait longer than 3 seconds refuses the delete.
 *
 * `'all'` is the admin "Clear entire catalog" button, under the same guard.
 */
export async function deleteStoreCatalogItems(itemIds: string[] | 'all') {
  const requestedIds = itemIds === 'all' ? null : normalizeItemIds(itemIds);

  try {
    return await withTransaction(async (client) => {
      await client.query("SET LOCAL lock_timeout = '3s'");

      const found = await client.query<{ id: string; name: string; active: boolean; season_tag: string | null }>(
        requestedIds
          ? 'SELECT id, name, active, season_tag FROM store_items WHERE id = ANY($1::text[]) ORDER BY id FOR UPDATE'
          : 'SELECT id, name, active, season_tag FROM store_items ORDER BY id FOR UPDATE',
        requestedIds ? [requestedIds] : [],
      );
      await client.query('LOCK TABLE user_owned_items, user_equipped_items IN SHARE MODE');

      const foundIds = found.rows.map((row) => row.id);
      const foundSet = new Set(foundIds);
      const missingItemIds = (requestedIds ?? []).filter((id) => !foundSet.has(id));

      const countBy = async (table: 'user_owned_items' | 'user_equipped_items') => {
        const rows = await client.query<{ item_id: string; count: string }>(
          `SELECT item_id, COUNT(*) AS count FROM ${table} WHERE item_id = ANY($1::text[]) GROUP BY item_id`,
          [foundIds],
        );
        return new Map(rows.rows.map((row) => [row.item_id, Number(row.count)]));
      };
      const owners = await countBy('user_owned_items');
      const equipped = await countBy('user_equipped_items');

      const blockers: StoreCatalogDeleteBlocker[] = found.rows
        .map((row) => ({
          itemId: row.id,
          name: row.name,
          owners: owners.get(row.id) ?? 0,
          equipped: equipped.get(row.id) ?? 0,
          onSale: normalizeBoolean(row.active),
          reward: isRewardOnlyItem({ id: row.id, seasonTag: row.season_tag }),
        }))
        .filter((blocker) => blocker.owners > 0 || blocker.equipped > 0 || blocker.onSale || blocker.reward);
      if (blockers.length > 0) throw new StoreCatalogDeleteRefusedError(blockers);

      let rotationDeleted = 0;
      let catalogDeleted = 0;
      let groupLinksDeleted = 0;
      if (foundIds.length > 0) {
        rotationDeleted += (await client.query('DELETE FROM store_daily_rotation WHERE item_id = ANY($1::text[])', [foundIds])).rowCount ?? 0;
        rotationDeleted += (await client.query('DELETE FROM store_daily_beskar WHERE item_id = ANY($1::text[])', [foundIds])).rowCount ?? 0;
        groupLinksDeleted = (await client.query('DELETE FROM skin_group_items WHERE item_id = ANY($1::text[])', [foundIds])).rowCount ?? 0;
        catalogDeleted = (await client.query('DELETE FROM store_items WHERE id = ANY($1::text[])', [foundIds])).rowCount ?? 0;
      }

      return {
        requested: requestedIds?.length ?? foundIds.length,
        deletedItemIds: foundIds,
        missingItemIds,
        rotationDeleted,
        groupLinksDeleted,
        catalogDeleted,
      };
    });
  } catch (error) {
    if ((error as { code?: string }).code === '55P03') {
      throw new StoreCatalogDeleteRefusedError(
        [],
        'Nothing was deleted. A purchase or grant was in progress. Try again in a moment.',
      );
    }
    throw error;
  }
}

/** "Clear entire catalog": a true delete of every item, refused while anyone owns any item. */
export async function clearStoreCatalog() {
  return deleteStoreCatalogItems('all');
}

/**
 * The prize counter for a date: every prize on sale, every day, cheapest
 * first (ties: the newest). The daily rotation is gone (PROGRESSION.md, "The
 * prize counter"); the name stays because the cron, the admin console and
 * the home page call it. A prize whose catalog Monday is later than the date
 * isn't on the counter yet.
 *
 * The list is read live, so an admin's "Push To Store" shows at once. It is
 * also written to `store_daily_rotation` for the date whenever it changes,
 * so the admin's history of what was on sale keeps working.
 */
export async function generateStoreDailyRotation(
  dateKey: string = getServerDateKey(),
  forceRefresh = false,
): Promise<RotationEntry[]> {
  const counter = (
    await query<StoreItemRow>(
      `${activeStoreItemsSql}
       AND currency_type = 'credits'
       AND price > 0
       ORDER BY price ASC, created_at DESC, name ASC`,
    )
  ).rows.filter((row) => isOnCounterBy(row.id, dateKey));

  const stored = await query<{ item_id: string }>(
    'SELECT item_id FROM store_daily_rotation WHERE date_key = $1 ORDER BY slot_index ASC',
    [dateKey],
  );
  const storedIds = stored.rows.map((row) => row.item_id).join('|');
  if (forceRefresh || storedIds !== counter.map((row) => row.id).join('|')) {
    await withTransaction(async (client) => {
      await client.query('DELETE FROM store_daily_rotation WHERE date_key = $1', [dateKey]);
      for (let index = 0; index < counter.length; index++) {
        await client.query(
          `INSERT INTO store_daily_rotation (date_key, slot_index, item_id) VALUES ($1, $2, $3)`,
          [dateKey, index, counter[index]!.id],
        );
      }
    });
  }

  return counter.map((row, slotIndex) => ({ dateKey, slotIndex, item: parseStoreItemRow(row) }));
}

export async function clearDeprecatedCurrencyRotation(
  dateKey: string = getServerDateKey(),
  forceRefresh = false,
): Promise<RotationEntry[]> {
  void forceRefresh;
  await query('DELETE FROM store_daily_beskar WHERE date_key = $1', [dateKey]);
  return [];
}

export async function getUserOwnedStoreItems(
  userId: string,
  gameType?: RewardGameType,
): Promise<OwnedStoreItem[]> {
  const ownedRows = await query<OwnedRow>(
    `SELECT o.user_id, o.item_id, o.acquired_at, o.acquired_source,
            i.id, i.name, i.game_type, i.rarity, i.currency_type, i.price,
            i.slots_json, i.active, i.season_tag, i.asset_ref, i.created_at
     FROM user_owned_items o
     JOIN store_items i ON i.id = o.item_id
     WHERE i.currency_type = 'credits'
       AND o.user_id = ANY($1::text[])
     ORDER BY o.acquired_at DESC`,
    [[userId, GLOBAL_ITEM_OWNER_ID]],
  );
  return ownedRows.rows
    .map((row) => ({
      item: parseStoreItemRow(row),
      acquiredAt: Number(row.acquired_at ?? 0),
      acquiredSource: row.acquired_source,
      grantedToAll: row.user_id === GLOBAL_ITEM_OWNER_ID,
    }))
    .filter((entry) => !gameType || entry.item.gameType === gameType);
}

export async function getUserInventoryAndEquipped(
  userId: string,
  gameType?: RewardGameType,
) {
  const [wallet, dailyGameCredits, ownedItems, equippedRows] = await Promise.all([
    getWalletForUser(userId),
    getDailyGameCreditsProgress(userId),
    getUserOwnedStoreItems(userId, gameType),
    query<EquippedRow>(
      `SELECT e.slot, e.equipped_at,
              i.id, i.name, i.game_type, i.rarity, i.currency_type, i.price,
              i.slots_json, i.active, i.season_tag, i.asset_ref, i.created_at
       FROM user_equipped_items e
       JOIN store_items i ON i.id = e.item_id
       WHERE e.user_id = $1
         AND ($2::text IS NULL OR e.game_type = $2)
         AND i.currency_type = 'credits'
       ORDER BY e.game_type ASC, e.slot ASC`,
      [userId, gameType ?? null],
    ),
  ]);

  const equipped: EquippedStoreItem[] = equippedRows.rows.map((row) => ({
    slot: row.slot as GameSlot,
    item: parseStoreItemRow(row),
    equippedAt: Number(row.equipped_at ?? 0),
  }));

  return {
    wallet,
    dailyGameCredits,
    ownedItems,
    equipped,
  };
}

export async function getStoreStateForUser(
  userId: string,
  dateKey: string = getServerDateKey(),
) {
  const [visibility, rotation, inventory, pinnedItemId, pace] = await Promise.all([
    getStoreVisibilityConfig(),
    generateStoreDailyRotation(dateKey),
    getUserInventoryAndEquipped(userId),
    getPinnedPrize(userId),
    getCounterPace(userId),
  ]);
  const ownedSet = new Set(inventory.ownedItems.map((entry) => entry.item.id));
  const entries = (visibility.creditsEnabled ? rotation : []).map((entry) => ({
    slotIndex: entry.slotIndex,
    item: entry.item,
    owned: ownedSet.has(entry.item.id),
    kind: describeCounterItem(entry.item),
  }));
  const balance = inventory.wallet.credits + (inventory.wallet.storeCredits ?? 0);
  const { next, canAffordEverything } = pickNextPrize(entries, balance, pinnedItemId, pace);
  const counter: CounterSummary = {
    pinnedItemId: pinnedItemId && entries.some((entry) => entry.item.id === pinnedItemId && !entry.owned) ? pinnedItemId : null,
    newThisWeek: pickNewThisWeek(entries, dateKey),
    pace,
    next,
    canAffordEverything,
  };

  return {
    dateKey,
    wallet: inventory.wallet,
    dailyGameCredits: inventory.dailyGameCredits,
    rotation: entries,
    counter,
    ownedItems: inventory.ownedItems,
    equipped: inventory.equipped,
  };
}

export async function purchaseStoreItemForUser({
  userId,
  itemId,
  dateKey = getServerDateKey(),
}: {
  userId: string;
  itemId: string;
  dateKey?: string;
}) {
  const result = await withTransaction(async (client) => {
    const visibility = await getStoreVisibilityConfig();
    const itemResult = await client.query<StoreItemRow>(
      `SELECT id, name, game_type, rarity, currency_type, price, slots_json, active, season_tag, asset_ref, created_at
       FROM store_items
       WHERE id = $1 AND active = TRUE AND currency_type = 'credits'
       LIMIT 1
       FOR SHARE`,
      [itemId],
    );
    const itemRow = itemResult.rows[0];
    if (!itemRow) throw new Error('Item is not available in store.');

    const item = parseStoreItemRow(itemRow);
    // A free item is a mispriced item, never a giveaway.
    if (item.price <= 0) throw new Error('Item is not available in store.');
    if (item.currencyType === 'credits' && !visibility.creditsEnabled) {
      throw new Error('Tickets store section is currently disabled.');
    }

    // Every prize on sale is on the counter, except one whose catalog
    // Monday hasn't come yet.
    if (item.gameType === 'reaction-time' || !isOnCounterBy(item.id, dateKey)) {
      throw new Error('Item is not available in store.');
    }

    const ownership = await client.query(
      `SELECT 1 FROM user_owned_items
       WHERE item_id = $1 AND user_id = ANY($2::text[])
       LIMIT 1`,
      [itemId, [userId, GLOBAL_ITEM_OWNER_ID]],
    );
    if (ownership.rows[0]) throw new Error('Item already owned.');

    await assertNoActiveMonetizationAccountFlagForTransaction(client, userId);

    const wallet = await getCombinedWalletForTransaction(client, userId, true);
    if (wallet.spendableCredits < item.price) {
      throw new Error('Insufficient balance.');
    }

    const purchaseId = `purchase:${crypto.randomUUID()}`;
    const storeCreditDebit = Math.min(wallet.storeCredits, item.price);
    const earnedCreditDebit = item.price - storeCreditDebit;
    const ledgerIds: string[] = [];
    let balanceAfter = wallet.credits;
    let storeBalanceAfter = wallet.storeCredits;

    if (storeCreditDebit > 0) {
      const storeLedger = await mutateStoreCreditsForTransaction(client, {
        userId,
        amount: -storeCreditDebit,
        sourceType: 'store_purchase',
        sourceId: `${purchaseId}:store`,
        meta: {
          itemId,
          itemName: item.name,
          dateKey,
          displayCurrency: 'store_tickets',
          purchaseId,
        },
      });
      ledgerIds.push(storeLedger.ledgerId);
      storeBalanceAfter = storeLedger.balanceAfter;
    }

    if (earnedCreditDebit > 0) {
      const earnedLedger = await mutateWalletAndLedgerForTransaction(client, {
        userId,
        currencyType: item.currencyType,
        amount: -earnedCreditDebit,
        sourceType: 'purchase',
        sourceId: `${purchaseId}:earned`,
        meta: {
          itemId,
          itemName: item.name,
          dateKey,
          displayCurrency: 'tickets',
          purchaseId,
        },
        createdBy: null,
      });
      ledgerIds.push(earnedLedger.ledgerId);
      balanceAfter = earnedLedger.balanceAfter;
    }

    await client.query(
      `INSERT INTO user_owned_items (user_id, item_id, acquired_at, acquired_source)
       VALUES ($1, $2, $3, 'purchase')`,
      [userId, itemId, Date.now()],
    );

    return {
      item,
      ledgerId: ledgerIds[0] ?? null,
      ledgerIds,
      balanceAfter,
      storeBalanceAfter,
      spendableBalanceAfter: balanceAfter + storeBalanceAfter,
      purchaseId,
    };
  });

  // Feed event for notable (rare+) purchases — fail-soft, after commit.
  if (result.item.rarity !== 'common') {
    void recordActivityEvent({
      userId,
      type: 'purchase',
      payload: { itemName: result.item.name, rarity: result.item.rarity },
    });
  }

  // Cosmetics-owned counter drives the "Collector" achievement. Best-effort,
  // after commit (dynamic import avoids a stats <-> store import cycle).
  void import('@/server/arcade/stats')
    .then(({ recordStats, add, GLOBAL }) => recordStats(userId, [add(GLOBAL.cosmeticsOwned, 1)]))
    .catch(() => {});

  return result;
}

export async function grantStoreItem({
  itemId,
  userId,
  grantToAll,
  actorUserId,
  acquiredSource,
}: {
  itemId: string;
  userId?: string;
  grantToAll: boolean;
  actorUserId: string;
  /** Provenance recorded on user_owned_items (defaults to the admin-grant value). */
  acquiredSource?: string;
}) {
  const targetUserId = grantToAll ? GLOBAL_ITEM_OWNER_ID : userId?.trim();
  if (!targetUserId) throw new Error('User is required for single-user grants.');

  // FOR SHARE holds the item row until the insert commits, so a catalog
  // delete either finishes first (and this finds no item) or waits for it
  // (and sees the owner).
  const { itemRow, inserted } = await withTransaction(async (client) => {
    const row = (
      await client.query<StoreItemRow>(
        `SELECT id, name, game_type, rarity, currency_type, price, slots_json, active, season_tag, asset_ref, created_at
         FROM store_items
         WHERE id = $1
         LIMIT 1
         FOR SHARE`,
        [itemId],
      )
    ).rows[0];
    if (!row) throw new Error('Store item not found.');

    const result = await client.query(
      `INSERT INTO user_owned_items (user_id, item_id, acquired_at, acquired_source)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT(user_id, item_id) DO NOTHING
       RETURNING item_id`,
      [targetUserId, itemId, Date.now(), acquiredSource ?? (grantToAll ? 'admin_grant_all' : 'admin_grant')],
    );
    return { itemRow: row, inserted: (result.rowCount ?? 0) > 0 };
  });

  return {
    granted: inserted,
    targetUserId,
    item: parseStoreItemRow(itemRow),
    actorUserId,
  };
}

export async function removeStoreItemOwnership({
  itemId,
  userId,
  removeFromAll,
}: {
  itemId: string;
  userId?: string;
  removeFromAll: boolean;
}) {
  const itemRow = await queryOne<StoreItemRow>(
    `SELECT id, name, game_type, rarity, currency_type, price, slots_json, active, season_tag, asset_ref, created_at
     FROM store_items
     WHERE id = $1
     LIMIT 1`,
    [itemId],
  );
  if (!itemRow) throw new Error('Store item not found.');
  const item = parseStoreItemRow(itemRow);

  return withTransaction(async (client) => {
    const targetUserId = removeFromAll ? GLOBAL_ITEM_OWNER_ID : userId?.trim();
    if (!targetUserId) throw new Error('User is required for single-user removal.');

    const removedOwnership = await client.query(
      `DELETE FROM user_owned_items WHERE user_id = $1 AND item_id = $2`,
      [targetUserId, itemId],
    );
    if (!removedOwnership.rowCount) {
      throw new Error(removeFromAll ? 'Global ownership not found for this item.' : 'User does not own this item.');
    }

    const removedEquipped = removeFromAll
      ? await client.query(`DELETE FROM user_equipped_items WHERE item_id = $1`, [itemId])
      : await client.query(
          `DELETE FROM user_equipped_items WHERE user_id = $1 AND item_id = $2`,
          [targetUserId, itemId],
        );

    return {
      removed: true,
      scope: removeFromAll ? 'all' as const : 'single' as const,
      item,
      targetUserId: removeFromAll ? undefined : targetUserId,
      removedOwnership: removedOwnership.rowCount ?? 0,
      removedEquipped: removedEquipped.rowCount ?? 0,
    };
  });
}

export async function equipStoreItemForUser({
  userId,
  itemId,
  gameType,
}: {
  userId: string;
  itemId: string;
  gameType: RewardGameType;
}) {
  const itemRow = await queryOne<StoreItemRow>(
    `SELECT id, name, game_type, rarity, currency_type, price, slots_json, active, season_tag, asset_ref, created_at
     FROM store_items
     WHERE id = $1
     LIMIT 1`,
    [itemId],
  );
  if (!itemRow) throw new Error('Store item not found.');
  const item = parseStoreItemRow(itemRow);
  if (item.gameType !== gameType) throw new Error('Item does not belong to this game.');

  const ownsItem = await queryOne(
    `SELECT 1 FROM user_owned_items
     WHERE item_id = $1 AND user_id = ANY($2::text[])
     LIMIT 1`,
    [itemId, [userId, GLOBAL_ITEM_OWNER_ID]],
  );
  if (!ownsItem) throw new Error('You do not own this item.');

  const validSlots = item.slots.filter((slot) => GAME_SLOTS[gameType].includes(slot));
  if (validSlots.length === 0) {
    throw new Error('Item does not have valid slots for this game.');
  }

  await withTransaction(async (client) => {
    await client.query(
      `DELETE FROM user_equipped_items
       WHERE user_id = $1 AND game_type = $2 AND item_id = $3`,
      [userId, gameType, itemId],
    );
    // A skin set fills every slot of its game, so an older one-slot skin
    // equipped after it takes the whole set off: the two never mix.
    if (!readSkinSet(item.assetRef)) {
      const equippedSets = await client.query<{ item_id: string; asset_ref: string | null }>(
        `SELECT DISTINCT e.item_id, i.asset_ref
           FROM user_equipped_items e
           JOIN store_items i ON i.id = e.item_id
          WHERE e.user_id = $1 AND e.game_type = $2`,
        [userId, gameType],
      );
      const setIds = equippedSets.rows
        .filter((row) => readSkinSet(parseJsonObject(row.asset_ref)))
        .map((row) => row.item_id);
      if (setIds.length > 0) {
        await client.query(
          `DELETE FROM user_equipped_items WHERE user_id = $1 AND game_type = $2 AND item_id = ANY($3::text[])`,
          [userId, gameType, setIds],
        );
      }
    }
    for (const slot of validSlots) {
      await client.query(
        `INSERT INTO user_equipped_items (user_id, game_type, slot, item_id, equipped_at)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT(user_id, game_type, slot) DO UPDATE SET
           item_id = excluded.item_id,
           equipped_at = excluded.equipped_at`,
        [userId, gameType, slot, itemId, Date.now()],
      );
    }
    // Avatars aren't rendered as flair — equipping one updates the account's
    // image_url, which is the single source of truth for the avatar shown
    // everywhere. asset_ref.imageUrl is a curated in-repo path (see avatars.ts).
    if (gameType === 'profile' && validSlots.includes('avatar')) {
      const avatarSrc = item.assetRef.imageUrl;
      if (typeof avatarSrc === 'string' && isAvatarAssetPath(avatarSrc)) {
        await client.query(
          `UPDATE arcade_accounts SET image_url = $1, updated_at = $2 WHERE id = $3`,
          [avatarSrc, Date.now(), userId],
        );
      }
    }
  });

  return getUserInventoryAndEquipped(userId, gameType);
}

export async function unequipStoreItemForUser({
  userId,
  gameType,
  slot,
}: {
  userId: string;
  gameType: RewardGameType;
  slot: string;
}) {
  if (!GAME_SLOTS[gameType].includes(slot as GameSlot)) {
    throw new Error('Invalid slot for game.');
  }
  await query(
    `DELETE FROM user_equipped_items
     WHERE user_id = $1 AND game_type = $2 AND slot = $3`,
    [userId, gameType, slot],
  );
  // Unequipping an avatar clears the account image_url back to the initials
  // fallback (the avatar source of truth lives on the account, not the row).
  if (gameType === 'profile' && slot === 'avatar') {
    await query(`UPDATE arcade_accounts SET image_url = NULL, updated_at = $1 WHERE id = $2`, [
      Date.now(),
      userId,
    ]);
  }
  return getUserInventoryAndEquipped(userId, gameType);
}
