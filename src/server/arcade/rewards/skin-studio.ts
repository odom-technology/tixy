import crypto from 'node:crypto';

import {
  GAME_SLOTS,
  type StoreRarity,
  type CurrencyType,
  type GameSlot,
  type RewardGameType,
} from '@/features/arcade/lib/rewards';
import { computeCreditsItemPriceForSkinStudio } from '@/features/arcade/lib/skin-studio-pricing';
import { query, queryOne, withTransaction } from '@/server/db/client';

import type { SkinGroup, StoreItem } from './types';
import {
  ensureStoreItemPolicy,
  getServerDateKey,
  normalizeCurrencyType,
  parseStoreRarity,
} from './helpers';
import {
  generateStoreDailyRotation,
  clearDeprecatedCurrencyRotation,
} from './store';

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

type SkinGroupRow = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  game_type: string | null;
  active: boolean | number | string;
  created_at: number | string;
  updated_at: number | string;
  created_by: string | null;
  updated_by: string | null;
};

type SkinGroupMembershipRow = {
  group_id: string;
  item_id: string;
  game_type: RewardGameType | null;
};

const normalizeBoolean = (value: boolean | number | string) =>
  value === true || value === 1 || value === '1' || value === 'true';

const parseStoreItemRow = (row: StoreItemRow): StoreItem => {
  const rarity = parseStoreRarity(row.rarity);
  const currencyType = normalizeCurrencyType(row.currency_type);
  const parsedSlots = (() => {
    try {
      const raw = JSON.parse(row.slots_json) as unknown;
      if (!Array.isArray(raw)) return [];
      return raw.filter((slot): slot is GameSlot =>
        typeof slot === 'string' &&
        GAME_SLOTS[row.game_type as RewardGameType]?.includes(slot as GameSlot),
      );
    } catch {
      return [];
    }
  })();
  const parsedAsset = (() => {
    if (!row.asset_ref) return null;
    try {
      const raw = JSON.parse(row.asset_ref) as unknown;
      return raw && typeof raw === 'object' && !Array.isArray(raw)
        ? (raw as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  })();
  return {
    id: row.id,
    name: row.name,
    gameType: row.game_type as RewardGameType,
    rarity,
    currencyType,
    price: Number(row.price ?? 0),
    slots: parsedSlots,
    active: normalizeBoolean(row.active),
    seasonTag: row.season_tag,
    assetRef: parsedAsset,
    createdAt: Number(row.created_at ?? 0),
  };
};

const getStoreItemById = async (itemId: string): Promise<StoreItem | null> => {
  const row = await queryOne<StoreItemRow>(
    `SELECT id, name, game_type, rarity, currency_type, price, slots_json,
            active, season_tag, asset_ref, created_at
     FROM store_items
     WHERE id = $1
     LIMIT 1`,
    [itemId],
  );
  return row ? parseStoreItemRow(row) : null;
};

export const listStoreItemsForSkinStudio = async () => {
  const rows = (
    await query<StoreItemRow>(
      `SELECT id, name, game_type, rarity, currency_type, price, slots_json,
              active, season_tag, asset_ref, created_at
       FROM store_items
       ORDER BY game_type ASC, rarity ASC, price ASC, name ASC`,
    )
  ).rows;
  return rows.map(parseStoreItemRow);
};

export const upsertStoreItemForSkinStudio = async ({
  id,
  previousId,
  name,
  gameType,
  rarity,
  slots,
  assetRef,
  active,
}: {
  id: string;
  previousId?: string;
  name: string;
  gameType: RewardGameType;
  rarity: StoreRarity;
  currencyType: CurrencyType;
  price: number;
  slots: string[];
  assetRef?: Record<string, unknown> | null;
  active?: boolean;
}) => {
  const trimmedId = id.trim();
  const trimmedPreviousId = (previousId ?? '').trim();
  const trimmedName = name.trim();
  if (!trimmedId) throw new Error('Item id is required.');
  if (!trimmedName) throw new Error('Item name is required.');

  const isRename = trimmedPreviousId.length > 0 && trimmedPreviousId !== trimmedId;
  if (isRename) {
    const existingSource = await getStoreItemById(trimmedPreviousId);
    if (!existingSource) {
      throw new Error(`Original item not found: ${trimmedPreviousId}`);
    }
    const existingTarget = await getStoreItemById(trimmedId);
    if (existingTarget) {
      throw new Error(`Item id already exists: ${trimmedId}`);
    }
  }

  const validSlots = Array.from(
    new Set(
      slots.filter((slot): slot is GameSlot =>
        GAME_SLOTS[gameType].includes(slot as GameSlot),
      ),
    ),
  );
  const normalizedAsset =
    assetRef && Object.keys(assetRef).length > 0 ? assetRef : null;
  const primarySlot = validSlots[0] ?? null;
  const normalizedCurrencyType: CurrencyType = 'credits';
  const normalizedPrice = computeCreditsItemPriceForSkinStudio({
    rarity,
    slot: primarySlot,
    assetRef: normalizedAsset,
  });

  ensureStoreItemPolicy({
    id: trimmedId,
    rarity,
    currencyType: normalizedCurrencyType,
    price: normalizedPrice,
    slotCount: validSlots.length,
  });

  const now = Date.now();
  await withTransaction(async (client) => {
    await client.query(
      `INSERT INTO store_items (
         id, name, game_type, rarity, currency_type, price, slots_json,
         active, season_tag, asset_ref, created_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NULL, $9, $10)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         game_type = excluded.game_type,
         rarity = excluded.rarity,
         currency_type = excluded.currency_type,
         price = excluded.price,
         slots_json = excluded.slots_json,
         active = excluded.active,
         season_tag = excluded.season_tag,
         asset_ref = excluded.asset_ref`,
      [
        trimmedId,
        trimmedName,
        gameType,
        rarity,
        normalizedCurrencyType,
        normalizedPrice,
        JSON.stringify(validSlots),
        active === false ? false : true,
        normalizedAsset ? JSON.stringify(normalizedAsset) : null,
        now,
      ],
    );

    if (!isRename) return;

    await client.query(
      `INSERT INTO user_owned_items (user_id, item_id, acquired_at, acquired_source)
       SELECT user_id, $1, acquired_at, acquired_source
       FROM user_owned_items
       WHERE item_id = $2
       ON CONFLICT(user_id, item_id) DO NOTHING`,
      [trimmedId, trimmedPreviousId],
    );
    await client.query('DELETE FROM user_owned_items WHERE item_id = $1', [trimmedPreviousId]);

    await client.query(
      'UPDATE user_equipped_items SET item_id = $1 WHERE item_id = $2',
      [trimmedId, trimmedPreviousId],
    );
    await client.query(
      'UPDATE store_daily_rotation SET item_id = $1 WHERE item_id = $2',
      [trimmedId, trimmedPreviousId],
    );
    await client.query(
      'UPDATE store_daily_beskar SET item_id = $1 WHERE item_id = $2',
      [trimmedId, trimmedPreviousId],
    );

    await client.query(
      `INSERT INTO skin_group_items (group_id, item_id, sort_order, created_at)
       SELECT group_id, $1, sort_order, created_at
       FROM skin_group_items
       WHERE item_id = $2
       ON CONFLICT(group_id, item_id) DO NOTHING`,
      [trimmedId, trimmedPreviousId],
    );
    await client.query('DELETE FROM skin_group_items WHERE item_id = $1', [trimmedPreviousId]);
    await client.query('DELETE FROM store_items WHERE id = $1', [trimmedPreviousId]);
  });

  return getStoreItemById(trimmedId);
};

export const setStoreItemActiveForSkinStudio = async (itemId: string, active: boolean) => {
  const normalizedId = itemId.trim();
  if (!normalizedId) throw new Error('Item id is required.');
  const existing = await getStoreItemById(normalizedId);
  if (!existing) throw new Error('Store item not found.');

  await query('UPDATE store_items SET active = $1 WHERE id = $2', [active, normalizedId]);
  if (active) {
    await generateStoreDailyRotation(getServerDateKey(), true);
    await clearDeprecatedCurrencyRotation(getServerDateKey(), true);
  } else {
    await query('DELETE FROM store_daily_rotation WHERE item_id = $1', [normalizedId]);
    await query('DELETE FROM store_daily_beskar WHERE item_id = $1', [normalizedId]);
  }
  return getStoreItemById(normalizedId);
};

export const setStoreItemsActiveForSkinStudio = async (
  itemIds: string[],
  active: boolean,
) => {
  const normalizedIds = Array.from(
    new Set(itemIds.map((itemId) => itemId.trim()).filter(Boolean)),
  );
  if (normalizedIds.length === 0) {
    throw new Error('At least one item id is required.');
  }

  await withTransaction(async (client) => {
    for (const itemId of normalizedIds) {
      const existing = await client.query('SELECT 1 FROM store_items WHERE id = $1 LIMIT 1', [itemId]);
      if (!existing.rows[0]) {
        throw new Error(`Store item not found: ${itemId}`);
      }
      await client.query('UPDATE store_items SET active = $1 WHERE id = $2', [active, itemId]);
      if (!active) {
        await client.query('DELETE FROM store_daily_rotation WHERE item_id = $1', [itemId]);
        await client.query('DELETE FROM store_daily_beskar WHERE item_id = $1', [itemId]);
      }
    }
  });

  if (active) {
    await generateStoreDailyRotation(getServerDateKey(), true);
    await clearDeprecatedCurrencyRotation(getServerDateKey(), true);
  }

  return {
    updated: normalizedIds.length,
    itemIds: normalizedIds,
    active,
  };
};

export const listSkinGroups = async (): Promise<SkinGroup[]> => {
  const [groupsResult, membershipsResult] = await Promise.all([
    query<SkinGroupRow>(
      `SELECT id, name, slug, description, game_type, active, created_at,
              updated_at, created_by, updated_by
       FROM skin_groups
       ORDER BY name ASC`,
    ),
    query<SkinGroupMembershipRow>(
      `SELECT sgi.group_id, sgi.item_id, si.game_type
       FROM skin_group_items sgi
       LEFT JOIN store_items si ON si.id = sgi.item_id
       ORDER BY sgi.group_id ASC, sgi.sort_order ASC, sgi.item_id ASC`,
    ),
  ]);

  const itemIdsByGroup = new Map<string, string[]>();
  const gameTypesByGroup = new Map<string, Set<RewardGameType>>();
  for (const membership of membershipsResult.rows) {
    const bucket = itemIdsByGroup.get(membership.group_id) ?? [];
    bucket.push(membership.item_id);
    itemIdsByGroup.set(membership.group_id, bucket);
    if (!membership.game_type) continue;
    const gameTypes = gameTypesByGroup.get(membership.group_id) ?? new Set<RewardGameType>();
    gameTypes.add(membership.game_type);
    gameTypesByGroup.set(membership.group_id, gameTypes);
  }

  return groupsResult.rows.map((group) => {
    const linkedItemIds = itemIdsByGroup.get(group.id) ?? [];
    const scopedGameTypes = gameTypesByGroup.get(group.id);
    const inferredGameType =
      scopedGameTypes && scopedGameTypes.size === 1
        ? Array.from(scopedGameTypes)[0]
        : null;
    return {
      id: group.id,
      name: group.name,
      slug: group.slug,
      description: group.description,
      gameType:
        inferredGameType !== null
          ? inferredGameType
          : scopedGameTypes && scopedGameTypes.size > 1
            ? null
            : (group.game_type as RewardGameType | null),
      active: normalizeBoolean(group.active),
      createdAt: Number(group.created_at ?? 0),
      updatedAt: Number(group.updated_at ?? 0),
      createdBy: group.created_by,
      updatedBy: group.updated_by,
      itemIds: linkedItemIds,
    };
  });
};

const inferGroupGameTypeFromItemIds = async (itemIds: string[]) => {
  if (itemIds.length === 0) return null;
  const rows = (
    await query<{ game_type: RewardGameType }>(
      'SELECT DISTINCT game_type FROM store_items WHERE id = ANY($1::text[])',
      [itemIds],
    )
  ).rows;
  if (rows.length !== 1) return null;
  return rows[0]!.game_type;
};

export const upsertSkinGroup = async ({
  id,
  name,
  slug,
  description,
  gameType,
  active,
  itemIds,
  actorUserId,
}: {
  id?: string;
  name: string;
  slug: string;
  description?: string | null;
  gameType?: RewardGameType | null;
  active?: boolean;
  itemIds?: string[];
  actorUserId: string;
}) => {
  const normalizedId = id?.trim() || crypto.randomUUID();
  const normalizedName = name.trim();
  const normalizedSlug = slug.trim().toLowerCase();
  if (!normalizedName) throw new Error('Group name is required.');
  if (!normalizedSlug) throw new Error('Group slug is required.');

  const normalizedDescription = description?.trim() || null;
  const normalizedItemIds = Array.from(
    new Set((itemIds ?? []).map((itemId) => itemId.trim()).filter(Boolean)),
  );
  const existingItemRows = (
    await query<{ id: string }>(
      'SELECT id FROM store_items WHERE id = ANY($1::text[])',
      [normalizedItemIds],
    )
  ).rows;
  const existingItemIds = new Set(existingItemRows.map((row) => row.id));
  const validItemIds = normalizedItemIds.filter((itemId) => existingItemIds.has(itemId));
  const inferredGameType = await inferGroupGameTypeFromItemIds(validItemIds);
  if (gameType && inferredGameType && gameType !== inferredGameType) {
    throw new Error(
      `Group game scope (${gameType}) must match linked items (${inferredGameType}).`,
    );
  }
  const normalizedGameType = gameType ?? inferredGameType ?? null;

  if (gameType && !GAME_SLOTS[gameType]) {
    throw new Error('Invalid game type for group.');
  }

  const now = Date.now();
  await withTransaction(async (client) => {
    await client.query(
      `INSERT INTO skin_groups (
         id, name, slug, description, game_type, active,
         created_at, updated_at, created_by, updated_by
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $7, $8, $8)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         slug = excluded.slug,
         description = excluded.description,
         game_type = excluded.game_type,
         active = excluded.active,
         updated_at = excluded.updated_at,
         updated_by = excluded.updated_by`,
      [
        normalizedId,
        normalizedName,
        normalizedSlug,
        normalizedDescription,
        normalizedGameType,
        active === false ? false : true,
        now,
        actorUserId,
      ],
    );
    await client.query('DELETE FROM skin_group_items WHERE group_id = $1', [normalizedId]);
    for (const [index, itemId] of validItemIds.entries()) {
      await client.query(
        `INSERT INTO skin_group_items (group_id, item_id, sort_order, created_at)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT(group_id, item_id) DO UPDATE SET
           sort_order = excluded.sort_order`,
        [normalizedId, itemId, index, now],
      );
    }
  });

  return (await listSkinGroups()).find((group) => group.id === normalizedId) ?? null;
};

export const deleteSkinGroup = async (groupId: string) => {
  const normalizedId = groupId.trim();
  if (!normalizedId) throw new Error('Group id is required.');
  return withTransaction(async (client) => {
    const removedItems = await client.query(
      'DELETE FROM skin_group_items WHERE group_id = $1',
      [normalizedId],
    );
    const removedGroups = await client.query(
      'DELETE FROM skin_groups WHERE id = $1',
      [normalizedId],
    );
    return {
      removedGroups: removedGroups.rowCount ?? 0,
      removedItems: removedItems.rowCount ?? 0,
    };
  });
};
