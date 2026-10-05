import { NextResponse } from 'next/server';

import { withAdmin } from '@/server/admin/guard';
import { getAccountById, listAccounts } from '@/server/accounts';
import { isCurrencyType } from '@/features/arcade/lib/rewards';
import {
  adjustCurrencyByAdminForUsers,
  clearStoreCatalog,
  deleteStoreCatalogItems,
  retireStoreCatalogItems,
  StoreCatalogDeleteRefusedError,
  generateStoreDailyRotation,
  getArcadeEconomyStats,
  getStoreVisibilityConfig,
  getServerDateKey,
  getStoreCatalog,
  listSkinGroups,
  queryCurrencyLedger,
  setStoreVisibilityConfig,
  setStoreItemsActiveForSkinStudio,
  type LedgerSourceType,
} from '@/server/arcade/rewards';

export const dynamic = 'force-dynamic';

const allowedSourceTypes = new Set<LedgerSourceType>([
  'game_reward',
  'shift_reward',
  'monthly_reward',
  'weekly_board',
  'purchase',
  'admin_adjust',
  'admin_grant',
  'refund',
]);

const parseNumberParam = (value: string | null) => {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const getAllAccountUserIds = async () => {
  const users = await listAccounts({ status: 'all', limit: 200 });
  return Array.from(new Set(users.map((user) => user.id)));
};

export const GET = withAdmin(async (request) => {
  const { searchParams } = new URL(request.url);
  const userId = searchParams.get('userId')?.trim() || undefined;
  const currencyParam = searchParams.get('currencyType')?.trim() || undefined;
  const sourceParam = searchParams.get('sourceType')?.trim() || undefined;
  const fromTs = parseNumberParam(searchParams.get('fromTs'));
  const toTs = parseNumberParam(searchParams.get('toTs'));
  const limit = parseNumberParam(searchParams.get('limit'));
  const includeCatalog = searchParams.get('includeCatalog') === '1';
  const forceRefreshStore = searchParams.get('forceRefreshStore') === '1';
  const refreshTargetRaw = searchParams.get('refreshTarget')?.trim().toLowerCase();
  const refreshTarget =
    refreshTargetRaw === 'credits' || refreshTargetRaw === 'all'
      ? refreshTargetRaw
      : 'all';
  const format = searchParams.get('format')?.trim();

  if (currencyParam && !isCurrencyType(currencyParam)) {
    return NextResponse.json({ error: 'Invalid currencyType' }, { status: 400 });
  }
  const currencyType = currencyParam && isCurrencyType(currencyParam)
    ? currencyParam
    : undefined;
  if (sourceParam && !allowedSourceTypes.has(sourceParam as LedgerSourceType)) {
    return NextResponse.json({ error: 'Invalid sourceType' }, { status: 400 });
  }

  try {
    const entries = await queryCurrencyLedger({
      userId,
      currencyType,
      sourceType: sourceParam as LedgerSourceType | undefined,
      fromTs,
      toTs,
      limit,
    });
    type LedgerEntryWithName = (typeof entries)[number] & { userName: string | null };
    const entriesWithNames: LedgerEntryWithName[] = await (async () => {
      if (entries.length === 0) return [];
      try {
        const userIds = Array.from(
          new Set(entries.map((entry) => entry.userId).filter(Boolean)),
        );
        if (userIds.length === 0) {
          return entries.map((entry) => ({ ...entry, userName: null }));
        }
        const users = await Promise.all(userIds.map((userId) => getAccountById(userId)));
        const nameById = new Map(
          users
            .filter((user) => user !== null)
            .map((user) => [
              user.id,
              user.username || user.email || null,
            ] as const),
        );
        return entries.map((entry) => ({
          ...entry,
          userName: nameById.get(entry.userId) ?? null,
        }));
      } catch (error) {
        console.warn('Failed to enrich rewards ledger with user names:', error);
        return entries.map((entry) => ({ ...entry, userName: null }));
      }
    })();

    if (format === 'csv') {
      const header =
        'id,user_id,user_name,currency_type,amount,balance_after,source_type,source_id,reason,created_at,created_by,meta_json';
      const rows = entriesWithNames.map((entry) => {
        const csvSafe = (value: string) => `"${value.replace(/"/g, '""')}"`;
        return [
          csvSafe(entry.id),
          csvSafe(entry.userId),
          csvSafe(entry.userName ?? ''),
          csvSafe(entry.currencyType),
          csvSafe(String(entry.amount)),
          csvSafe(String(entry.balanceAfter)),
          csvSafe(entry.sourceType),
          csvSafe(entry.sourceId),
          csvSafe(entry.reason ?? ''),
          csvSafe(String(entry.createdAt)),
          csvSafe(entry.createdBy ?? ''),
          csvSafe(JSON.stringify(entry.meta ?? {})),
        ].join(',');
      });
      return new Response([header, ...rows].join('\n'), {
        status: 200,
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Cache-Control': 'no-store',
        },
      });
    }

    let storeCatalog;
    let storeGroups;
    let storeVisibility;
    let rotation: Array<{ item: { id: string } }> | undefined;
    let catalogWarning: string | undefined;
    if (includeCatalog) {
      storeCatalog = await getStoreCatalog();
      storeGroups = await listSkinGroups();
      storeVisibility = await getStoreVisibilityConfig();
      if (storeCatalog.length > 0) {
        const hasActiveCreditsItems = storeCatalog.some(
          (item) => item.active !== false && item.currencyType === 'credits',
        );
        if (!hasActiveCreditsItems) {
          rotation = [];
          catalogWarning =
            'Store rotation unavailable: no active Ticket items in catalog.';
        } else {
          try {
            const shouldRefreshCredits =
              forceRefreshStore &&
              (refreshTarget === 'all' || refreshTarget === 'credits');
            rotation = await generateStoreDailyRotation(
              getServerDateKey(),
              shouldRefreshCredits,
            );
          } catch (error) {
            console.warn(
              'Store rotation unavailable for admin rewards query:',
              error,
            );
            rotation = [];
            catalogWarning =
              'Store rotation could not be generated from current catalog state.';
          }
        }
      } else {
        rotation = [];
        catalogWarning = 'Store catalog is empty. Add items to generate rotation.';
      }
    }

    return NextResponse.json({
      entries: entriesWithNames,
      arcadeStats: await getArcadeEconomyStats(),
      storeCatalog: includeCatalog ? storeCatalog : undefined,
      storeGroups: includeCatalog ? storeGroups : undefined,
      storeVisibility: includeCatalog ? storeVisibility : undefined,
      storeRotationDateKey: includeCatalog ? getServerDateKey() : undefined,
      storeRotationItemIds: rotation?.map((entry) => entry.item.id) ?? undefined,
      forceRefreshedStore: includeCatalog ? forceRefreshStore : undefined,
      forceRefreshedStoreTarget: includeCatalog ? refreshTarget : undefined,
      catalogWarning,
    });
  } catch (error) {
    console.error('Failed to query rewards ledger:', error);
    return NextResponse.json({ error: 'Failed to query rewards ledger.' }, { status: 500 });
  }
});

export const DELETE = withAdmin(async (request) => {
  // DELETE retires by default: the items leave the store and every owner keeps
  // them. mode 'delete' and clearAll are true deletes, refused (409) unless
  // every item is retired, unowned and not an earned reward.
  try {
    const body = (await request.json().catch(() => ({}))) as {
      itemIds?: unknown;
      clearAll?: unknown;
      mode?: unknown;
    };
    const clearAll = body.clearAll === true;
    const itemIds = Array.isArray(body.itemIds)
      ? body.itemIds
          .filter((id): id is string => typeof id === 'string')
          .map((id) => id.trim())
          .filter(Boolean)
      : [];

    if (clearAll) {
      const result = await clearStoreCatalog();
      return NextResponse.json({ success: true, mode: 'delete', result });
    }
    if (itemIds.length === 0) {
      return NextResponse.json(
        { error: 'Select one or more item IDs.' },
        { status: 400 },
      );
    }
    if (body.mode === 'delete') {
      const result = await deleteStoreCatalogItems(itemIds);
      return NextResponse.json({ success: true, mode: 'delete', result });
    }
    const result = await retireStoreCatalogItems(itemIds);
    return NextResponse.json({ success: true, mode: 'retire', result });
  } catch (error) {
    if (error instanceof StoreCatalogDeleteRefusedError) {
      return NextResponse.json(
        { error: error.message, blockers: error.blockers.slice(0, 50) },
        { status: 409 },
      );
    }
    console.error('Failed to retire or delete store catalog items:', error);
    return NextResponse.json(
      { error: 'Failed to update the store catalog.' },
      { status: 500 },
    );
  }
}, {
  audit: ({ body }) => {
    const input = (body ?? {}) as { itemIds?: unknown; clearAll?: unknown; mode?: unknown };
    // DELETE retires by default; only mode 'delete' and clearAll are true deletes.
    if (input.clearAll === true) {
      return { action: 'catalog.clear', targetType: 'catalog', targetId: 'store', details: { clearAll: true } };
    }
    const ids = Array.isArray(input.itemIds) ? input.itemIds : [];
    return {
      action: input.mode === 'delete' ? 'catalog.delete' : 'catalog.retire',
      targetType: 'catalog',
      targetId: ids.length === 1 && typeof ids[0] === 'string' ? ids[0] : 'store',
      details: { itemIds: ids, mode: input.mode === 'delete' ? 'delete' : 'retire', count: ids.length },
    };
  },
});

export const POST = withAdmin(async (request, { identity }) => {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      action?: unknown;
      itemIds?: unknown;
      active?: unknown;
      creditsEnabled?: unknown;
      gameCreditsEnabled?: unknown;
      currencyType?: unknown;
      amount?: unknown;
      reason?: unknown;
    };
    const action = typeof body.action === 'string' ? body.action : '';

    if (action === 'bulk-adjust-currency') {
      const currencyType =
        typeof body.currencyType === 'string' && isCurrencyType(body.currencyType)
          ? body.currencyType
          : null;
      const amount =
        typeof body.amount === 'number'
          ? body.amount
          : typeof body.amount === 'string'
            ? Number(body.amount)
            : NaN;
      const reason = typeof body.reason === 'string' ? body.reason.trim() : '';

      if (!currencyType) {
        return NextResponse.json(
          { error: 'Only Tickets can be adjusted.' },
          { status: 400 },
        );
      }
      if (!Number.isInteger(amount) || amount === 0) {
        return NextResponse.json(
          { error: 'Amount must be a non-zero integer.' },
          { status: 400 },
        );
      }
      if (!reason) {
        return NextResponse.json(
          { error: 'Reason is required.' },
          { status: 400 },
        );
      }

      const userIds = await getAllAccountUserIds();
      const result = await adjustCurrencyByAdminForUsers({
        userIds,
        currencyType,
        amount,
        reason,
        actorUserId: identity.userId,
      });

      return NextResponse.json({
        success: true,
        result,
        arcadeStats: await getArcadeEconomyStats(),
      });
    }

    if (action === 'set-store-visibility') {
      const hasCreditsEnabled = typeof body.creditsEnabled === 'boolean';
      const hasGameCreditsEnabled = typeof body.gameCreditsEnabled === 'boolean';
      if (!hasCreditsEnabled && !hasGameCreditsEnabled) {
        return NextResponse.json(
          {
            error: 'Provide creditsEnabled and/or gameCreditsEnabled.',
          },
          { status: 400 },
        );
      }

      const storeVisibility = await setStoreVisibilityConfig({
        creditsEnabled: hasCreditsEnabled
          ? (body.creditsEnabled as boolean)
          : undefined,
        gameCreditsEnabled: hasGameCreditsEnabled
          ? (body.gameCreditsEnabled as boolean)
          : undefined,
        actorUserId: identity.userId,
      });
      return NextResponse.json({ success: true, storeVisibility });
    }

    if (action !== 'set-items-active') {
      return NextResponse.json({ error: 'Invalid action.' }, { status: 400 });
    }

    const itemIds = Array.isArray(body.itemIds)
      ? body.itemIds.filter((id): id is string => typeof id === 'string')
      : [];
    if (itemIds.length === 0) {
      return NextResponse.json(
        { error: 'Select one or more item IDs.' },
        { status: 400 },
      );
    }
    const active = body.active === true;
    const result = await setStoreItemsActiveForSkinStudio(itemIds, active);
    return NextResponse.json({ success: true, result });
  } catch (error) {
    console.error('Failed to bulk update store item active state:', error);
    return NextResponse.json(
      { error: (error as Error).message || 'Failed to update store items.' },
      { status: 500 },
    );
  }
}, {
  audit: ({ body }) => {
    const input = (body ?? {}) as {
      action?: unknown;
      itemIds?: unknown;
      active?: unknown;
      creditsEnabled?: unknown;
      gameCreditsEnabled?: unknown;
      currencyType?: unknown;
      amount?: unknown;
      reason?: unknown;
    };
    const reason = typeof input.reason === 'string' ? input.reason : null;
    if (input.action === 'bulk-adjust-currency') {
      return {
        action: 'tickets.bulk_adjust',
        targetType: 'site',
        targetId: 'all-accounts',
        reason,
        details: { currencyType: input.currencyType, amount: input.amount },
      };
    }
    if (input.action === 'set-store-visibility') {
      return {
        action: 'store.visibility',
        targetType: 'site',
        targetId: 'store',
        details: {
          creditsEnabled: input.creditsEnabled,
          gameCreditsEnabled: input.gameCreditsEnabled,
        },
      };
    }
    if (input.action === 'set-items-active') {
      const ids = Array.isArray(input.itemIds) ? input.itemIds : [];
      return {
        action: 'catalog.set_active',
        targetType: 'catalog',
        targetId: ids.length === 1 && typeof ids[0] === 'string' ? ids[0] : 'store',
        details: { itemIds: ids, active: input.active === true, count: ids.length },
      };
    }
    return { action: 'rewards.invalid_action', targetType: 'site', targetId: 'store' };
  },
});
