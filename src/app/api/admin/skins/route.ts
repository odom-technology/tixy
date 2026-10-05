import { NextResponse } from 'next/server';

import {
  GAME_SLOTS,
  isCurrencyType,
  isRewardGameType,
  isStoreRarity,
  STORE_RARITY_ORDER,
  type CurrencyType,
  type RewardGameType,
  type StoreRarity,
} from '@/features/arcade/lib/rewards';
import { withAdmin } from '@/server/admin/guard';
import {
  deleteSkinGroup,
  listSkinGroups,
  listStoreItemsForSkinStudio,
  setStoreItemActiveForSkinStudio,
  upsertSkinGroup,
  upsertStoreItemForSkinStudio,
} from '@/server/arcade/rewards';

export const dynamic = 'force-dynamic';

const buildSkinStudioState = async () => ({
  items: await listStoreItemsForSkinStudio(),
  groups: await listSkinGroups(),
  metadata: {
    gameTypes: Object.keys(GAME_SLOTS),
    slots: GAME_SLOTS,
    rarities: STORE_RARITY_ORDER,
  },
});

const parseJsonObject = (raw: unknown): Record<string, unknown> | null => {
  if (raw == null) return null;
  if (typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  if (typeof raw !== 'string') return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
};

const parseImportedItem = (
  raw: unknown,
): {
  id: string;
  name: string;
  gameType: RewardGameType;
  rarity: StoreRarity;
  currencyType: CurrencyType;
  price: number;
  slots: string[];
  assetRef?: Record<string, unknown> | null;
  active?: boolean;
} => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Invalid imported item payload.');
  }
  const value = raw as Record<string, unknown>;
  const id = typeof value.id === 'string' ? value.id.trim() : '';
  const name = typeof value.name === 'string' ? value.name.trim() : '';
  const gameTypeRaw = typeof value.gameType === 'string' ? value.gameType : '';
  const rarityRaw = typeof value.rarity === 'string' ? value.rarity : '';
  const priceRaw = Number(value.price);
  const slots = Array.isArray(value.slots)
    ? value.slots.filter((slot): slot is string => typeof slot === 'string')
    : [];

  if (!id || !name) throw new Error('Imported item must include id and name.');
  if (!isRewardGameType(gameTypeRaw)) throw new Error(`Invalid gameType for item ${id}.`);
  if (!isStoreRarity(rarityRaw)) throw new Error(`Invalid rarity for item ${id}.`);
  const normalizedPrice = Number.isFinite(priceRaw)
    ? Math.floor(Math.abs(priceRaw))
    : 0;
  return {
    id,
    name,
    gameType: gameTypeRaw,
    rarity: rarityRaw,
    currencyType: 'credits',
    price: normalizedPrice,
    slots,
    assetRef: parseJsonObject(value.assetRef),
    active: value.active !== false,
  };
};

const parseImportedGroup = (
  raw: unknown,
): {
  id?: string;
  name: string;
  slug: string;
  description?: string | null;
  gameType?: RewardGameType | null;
  active?: boolean;
  itemIds?: string[];
} => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Invalid imported group payload.');
  }
  const value = raw as Record<string, unknown>;
  const id = typeof value.id === 'string' ? value.id.trim() : '';
  const name = typeof value.name === 'string' ? value.name.trim() : '';
  const slug = typeof value.slug === 'string' ? value.slug.trim() : '';
  if (!name || !slug) throw new Error('Imported group must include name and slug.');

  const gameTypeRaw =
    typeof value.gameType === 'string' ? value.gameType.trim() : '';
  if (gameTypeRaw && !isRewardGameType(gameTypeRaw)) {
    throw new Error(`Invalid gameType for group ${slug}.`);
  }
  const gameType: RewardGameType | null =
    gameTypeRaw && isRewardGameType(gameTypeRaw) ? gameTypeRaw : null;

  return {
    id: id || undefined,
    name,
    slug,
    description: typeof value.description === 'string' ? value.description : null,
    gameType,
    active: value.active !== false,
    itemIds: Array.isArray(value.itemIds)
      ? value.itemIds.filter((itemId): itemId is string => typeof itemId === 'string')
      : [],
  };
};

export const GET = withAdmin(async () => {
  try {
    return NextResponse.json(await buildSkinStudioState());
  } catch (error) {
    console.error('Failed to load skin studio state:', error);
    return NextResponse.json(
      { error: 'Failed to load skin studio state.' },
      { status: 500 },
    );
  }
});

export const POST = withAdmin(async (request, { identity }) => {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const action = typeof body.action === 'string' ? body.action : '';

    if (action === 'upsert-item') {
      const id = typeof body.id === 'string' ? body.id : '';
      const previousId = typeof body.previousId === 'string' ? body.previousId : undefined;
      const name = typeof body.name === 'string' ? body.name : '';
      const gameTypeRaw =
        typeof body.gameType === 'string' ? body.gameType : 'snake';
      const rarityRaw = typeof body.rarity === 'string' ? body.rarity : 'common';
      const currencyTypeRaw = 'credits';
      const price = Number(body.price);
      const slots = Array.isArray(body.slots)
        ? body.slots.filter((slot): slot is string => typeof slot === 'string').slice(0, 1)
        : [];
      const active = body.active !== false;
      const assetRef = parseJsonObject(body.assetRef);

      if (!isRewardGameType(gameTypeRaw)) {
        return NextResponse.json({ error: 'Invalid game type.' }, { status: 400 });
      }
      if (!isStoreRarity(rarityRaw)) {
        return NextResponse.json({ error: 'Invalid rarity.' }, { status: 400 });
      }
      if (!isCurrencyType(currencyTypeRaw)) {
        return NextResponse.json(
          { error: 'Invalid currency type.' },
          { status: 400 },
        );
      }
      if (!Number.isFinite(price) || price <= 0) {
        return NextResponse.json({ error: 'Invalid price.' }, { status: 400 });
      }

      const item = await upsertStoreItemForSkinStudio({
        id,
        previousId,
        name,
        gameType: gameTypeRaw as RewardGameType,
        rarity: rarityRaw as StoreRarity,
        currencyType: currencyTypeRaw as CurrencyType,
        price: Math.floor(price),
        slots,
        assetRef,
        active,
      });

      return NextResponse.json({
        ok: true,
        item,
        ...(await buildSkinStudioState()),
      });
    }

    if (action === 'set-item-active') {
      const itemId = typeof body.itemId === 'string' ? body.itemId : '';
      const active = body.active === true;
      const item = await setStoreItemActiveForSkinStudio(itemId, active);
      return NextResponse.json({ ok: true, item, ...(await buildSkinStudioState()) });
    }

    if (action === 'upsert-group') {
      const group = await upsertSkinGroup({
        id: typeof body.id === 'string' ? body.id : undefined,
        name: typeof body.name === 'string' ? body.name : '',
        slug: typeof body.slug === 'string' ? body.slug : '',
        description:
          typeof body.description === 'string' ? body.description : undefined,
        gameType:
          typeof body.gameType === 'string' && isRewardGameType(body.gameType)
            ? body.gameType
            : null,
        active: body.active !== false,
        itemIds: Array.isArray(body.itemIds)
          ? body.itemIds.filter((itemId): itemId is string => typeof itemId === 'string')
          : [],
        actorUserId: identity.userId,
      });
      return NextResponse.json({ ok: true, group, ...(await buildSkinStudioState()) });
    }

    if (action === 'delete-group') {
      const groupId = typeof body.groupId === 'string' ? body.groupId : '';
      const result = await deleteSkinGroup(groupId);
      return NextResponse.json({ ok: true, result, ...(await buildSkinStudioState()) });
    }

    if (action === 'import-bundle') {
      const itemsRaw = Array.isArray(body.items) ? body.items : [];
      const groupsRaw = Array.isArray(body.groups) ? body.groups : [];
      if (itemsRaw.length === 0 && groupsRaw.length === 0) {
        return NextResponse.json(
          { error: 'Import payload is empty.' },
          { status: 400 },
        );
      }

      const importedItems = itemsRaw.map(parseImportedItem);
      const importedGroups = groupsRaw.map(parseImportedGroup);

      for (const item of importedItems) {
        await upsertStoreItemForSkinStudio(item);
      }
      for (const group of importedGroups) {
        await upsertSkinGroup({
          ...group,
          actorUserId: identity.userId,
        });
      }

      return NextResponse.json({
        ok: true,
        imported: {
          items: importedItems.length,
          groups: importedGroups.length,
        },
        ...(await buildSkinStudioState()),
      });
    }

    return NextResponse.json({ error: 'Invalid action.' }, { status: 400 });
  } catch (error) {
    console.error('Failed to update skin studio:', error);
    return NextResponse.json(
      { error: (error as Error).message || 'Failed to update skin studio.' },
      { status: 500 },
    );
  }
}, {
  audit: ({ body }) => {
    const input = (body ?? {}) as Record<string, unknown>;
    const str = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : null);
    switch (input.action) {
      case 'upsert-item':
        return {
          action: 'catalog.item.save',
          targetType: 'item',
          targetId: str(input.id),
          details: { id: input.id, game: input.gameType, active: input.active !== false },
        };
      case 'set-item-active':
        return {
          action: 'catalog.item.set_active',
          targetType: 'item',
          targetId: str(input.itemId),
          details: { itemId: input.itemId, active: input.active === true },
        };
      case 'upsert-group':
        return {
          action: 'catalog.group.save',
          targetType: 'catalog',
          targetId: str(input.id) ?? str(input.slug),
          details: {
            id: input.id,
            slug: input.slug,
            game: input.gameType,
            active: input.active !== false,
            itemIds: input.itemIds,
          },
        };
      case 'delete-group':
        return {
          action: 'catalog.group.delete',
          targetType: 'catalog',
          targetId: str(input.groupId),
          details: { id: input.groupId },
        };
      case 'import-bundle':
        return {
          action: 'catalog.import',
          targetType: 'catalog',
          targetId: 'store',
          details: {
            count:
              (Array.isArray(input.items) ? input.items.length : 0) +
              (Array.isArray(input.groups) ? input.groups.length : 0),
          },
        };
      default:
        return { action: 'catalog.invalid_action', targetType: 'catalog', targetId: 'store' };
    }
  },
});
