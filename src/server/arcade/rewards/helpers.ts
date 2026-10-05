import {
  CREDIT_INCREMENT,
  GAME_SLOTS,
  STORE_RARITY_ORDER,
  type StoreRarity,
  type CurrencyType,
  type GameSlot,
  type RewardGameType,
} from '@/features/arcade/lib/rewards';
import { playerItemName } from '@/features/arcade/lib/item-names';
import { query, queryOne, withTransaction } from '@/server/db/client';

import type {
  LedgerSourceType,
  WalletRow,
  StoreItem,
  StoreVisibilityConfig,
} from './types';
import { mutateWalletAndLedgerForTransaction } from './wallet';

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------

const pad2 = (value: number) => value.toString().padStart(2, '0');

/** Formats a Date to a `YYYY-MM-DD` string using local server time. */
export const getServerDateKey = (date: Date = new Date()) =>
  `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;

/** Formats a Date to a `YYYY-MM` string using local server time. */
export const getServerMonthKey = (date: Date = new Date()) =>
  `${date.getFullYear()}-${pad2(date.getMonth() + 1)}`;

export const parseDateKeyLocal = (dateKey: string) => {
  const [yearRaw, monthRaw, dayRaw] = dateKey.split('-');
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  const day = Number(dayRaw);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    return null;
  }
  return new Date(year, month - 1, day, 0, 0, 0, 0);
};

export const parseMonthKeyLocal = (monthKey: string) => {
  const [yearRaw, monthRaw] = monthKey.split('-');
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  if (!Number.isFinite(year) || !Number.isFinite(month)) return null;
  if (month < 1 || month > 12) return null;
  return { year, month };
};

export const startOfPreviousMonth = (baseDate: Date = new Date()) => {
  const start = new Date(baseDate.getFullYear(), baseDate.getMonth(), 1, 0, 0, 0, 0);
  start.setMonth(start.getMonth() - 1);
  return start;
};

// ---------------------------------------------------------------------------
// Normalization helpers
// ---------------------------------------------------------------------------

export const TicketsRaritySet = new Set<StoreRarity>([
  'common',
  'rare',
  'epic',
]);

export const parseStoreRarity = (value: string): StoreRarity => {
  const valueLower = value.toLowerCase();
  const normalized = (valueLower === 'mythic'
    ? 'legendary'
    : valueLower) as StoreRarity;
  if (!STORE_RARITY_ORDER.includes(normalized)) {
    throw new Error(`Unsupported store rarity: ${value}`);
  }
  return normalized;
};

export const normalizeCurrencyType = (value: string): CurrencyType =>
  value === 'credits' ? 'credits' : 'credits';

export const ensureStoreItemPolicy = ({
  id,
  rarity,
  currencyType,
  price,
  slotCount,
}: {
  id: string;
  rarity: StoreRarity;
  currencyType: CurrencyType;
  price: number;
  slotCount: number;
}) => {
  if (currencyType !== 'credits') {
    throw new Error(`Store item ${id} must use Tickets.`);
  }

  if (currencyType === 'credits' && price % CREDIT_INCREMENT !== 0) {
    throw new Error(`Tickets item ${id} must end in 0 or 5.`);
  }

  if (slotCount > 1 && (rarity === 'common' || rarity === 'rare')) {
    throw new Error(`Multi-slot item ${id} must be Epic or higher.`);
  }
};

export const ensureCreditsIncrement = (amount: number) => {
  if (amount % CREDIT_INCREMENT !== 0) {
    throw new Error(`Tickets must be in increments of ${CREDIT_INCREMENT}.`);
  }
};

export const shouldEnforceCreditsIncrement = (sourceType: LedgerSourceType) =>
  sourceType !== 'game_reward' &&
  sourceType !== 'admin_adjust' &&
  sourceType !== 'wager_payout' &&
  sourceType !== 'daily_claim';

// ---------------------------------------------------------------------------
// getLedgerRows
// ---------------------------------------------------------------------------

export const getLedgerRows = async ({
  userId,
  currencyType,
  sourceType,
  fromTs,
  toTs,
  limit,
}: {
  userId?: string;
  currencyType?: CurrencyType;
  sourceType?: LedgerSourceType;
  fromTs?: number;
  toTs?: number;
  limit: number;
}) => {
  const conditions: string[] = [];
  const params: Array<string | number> = [];

  const addCondition = (sql: string, value: string | number) => {
    params.push(value);
    conditions.push(sql.replace('?', `$${params.length}`));
  };

  if (userId) addCondition('user_id = ?', userId);
  if (currencyType) addCondition('currency_type = ?', currencyType);
  if (sourceType) addCondition('source_type = ?', sourceType);
  if (typeof fromTs === 'number') addCondition('created_at >= ?', fromTs);
  if (typeof toTs === 'number') addCondition('created_at <= ?', toTs);

  params.push(limit);
  const whereClause =
    conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const result = await query<{
    id: string;
    user_id: string;
    currency_type: CurrencyType;
    amount: string | number;
    balance_after: string | number;
    source_type: LedgerSourceType;
    source_id: string;
    meta_json: string | null;
    created_at: string | number;
    created_by: string | null;
  }>(
    `
      SELECT id, user_id, currency_type, amount, balance_after, source_type, source_id, meta_json, created_at, created_by
      FROM currency_ledger
      ${whereClause}
      ORDER BY created_at DESC
      LIMIT $${params.length}
    `,
    params,
  );

  return result.rows.map((row) => ({
    ...row,
    amount: Number(row.amount ?? 0),
    balance_after: Number(row.balance_after ?? 0),
    created_at: Number(row.created_at ?? 0),
  }));
};

// ---------------------------------------------------------------------------
// Store visibility config
// ---------------------------------------------------------------------------

export const STORE_VISIBILITY_SETTINGS_ID = 'games-store-visibility';
export const DEFAULT_STORE_VISIBILITY_CONFIG: StoreVisibilityConfig = {
  creditsEnabled: true,
  gameCreditsEnabled: true,
};

export const normalizeStoreVisibilityConfig = (
  value: unknown,
): StoreVisibilityConfig => {
  if (!value || typeof value !== 'object') {
    return { ...DEFAULT_STORE_VISIBILITY_CONFIG };
  }
  const record = value as Record<string, unknown>;
  return {
    creditsEnabled:
      'creditsEnabled' in record
        ? Boolean(record.creditsEnabled)
        : DEFAULT_STORE_VISIBILITY_CONFIG.creditsEnabled,
    gameCreditsEnabled:
      'gameCreditsEnabled' in record
        ? Boolean(record.gameCreditsEnabled)
        : DEFAULT_STORE_VISIBILITY_CONFIG.gameCreditsEnabled,
  };
};

export const getStoreVisibilityConfig = async (): Promise<StoreVisibilityConfig> => {
  const row = await queryOne<{ config_json: string }>(
    `
      SELECT config_json
      FROM site_settings
      WHERE id = $1
      LIMIT 1
    `,
    [STORE_VISIBILITY_SETTINGS_ID],
  );
  if (!row?.config_json) {
    return { ...DEFAULT_STORE_VISIBILITY_CONFIG };
  }
  try {
    const parsed = JSON.parse(row.config_json) as unknown;
    return normalizeStoreVisibilityConfig(parsed);
  } catch {
    return { ...DEFAULT_STORE_VISIBILITY_CONFIG };
  }
};

export const setStoreVisibilityConfig = async ({
  creditsEnabled,
  gameCreditsEnabled,
  actorUserId,
}: {
  creditsEnabled?: boolean;
  gameCreditsEnabled?: boolean;
  actorUserId?: string | null;
}): Promise<StoreVisibilityConfig> => {
  const previous = await getStoreVisibilityConfig();
  const next: StoreVisibilityConfig = {
    creditsEnabled:
      typeof creditsEnabled === 'boolean'
        ? creditsEnabled
        : previous.creditsEnabled,
    gameCreditsEnabled:
      typeof gameCreditsEnabled === 'boolean'
        ? gameCreditsEnabled
        : previous.gameCreditsEnabled,
  };
  await query(
    `
      INSERT INTO site_settings (id, config_json, updated_at, updated_by)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT(id) DO UPDATE SET
        config_json = excluded.config_json,
        updated_at = excluded.updated_at,
        updated_by = excluded.updated_by
    `,
    [
      STORE_VISIBILITY_SETTINGS_ID,
      JSON.stringify(next),
      Date.now(),
      actorUserId ?? null,
    ],
  );
  return next;
};

// ---------------------------------------------------------------------------
// parseStoreItemRow
// ---------------------------------------------------------------------------

export const parseStoreItemRow = (row: {
  id: string;
  name: string;
  game_type: string;
  rarity: string;
  currency_type: string;
  price: number;
  slots_json: string;
  active: number;
  season_tag: string | null;
  asset_ref: string | null;
  created_at: number;
}): StoreItem => {
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
      const value = JSON.parse(row.asset_ref) as unknown;
      return value && typeof value === 'object'
        ? (value as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  })();

  ensureStoreItemPolicy({
    id: row.id,
    rarity,
    currencyType,
    price: row.price,
    slotCount: parsedSlots.length,
  });

  return {
    id: row.id,
    name: playerItemName(row.name),
    gameType: row.game_type as RewardGameType,
    rarity,
    currencyType,
    price: row.price,
    slots: parsedSlots,
    active: row.active === 1,
    seasonTag: row.season_tag,
    assetRef: parsedAsset,
    createdAt: row.created_at,
  };
};

// ---------------------------------------------------------------------------
// getOrCreateWallet
// ---------------------------------------------------------------------------

export const getOrCreateWallet = async (
  userId: string,
  now = Date.now(),
): Promise<WalletRow> => {
  await query(
    `
      INSERT INTO wallets (user_id, credits, wupiupi, updated_at)
      VALUES ($1, 0, 0, $2)
      ON CONFLICT(user_id) DO NOTHING
    `,
    [userId, now],
  );
  const row = await queryOne<{
    user_id: string;
    credits: number | string;
    store_credits: number | string | null;
    updated_at: number | string;
  }>(
    'SELECT user_id, credits, store_credits, updated_at FROM wallets WHERE user_id = $1',
    [userId],
  );
  if (!row) {
    throw new Error('Failed to load wallet.');
  }
  return {
    userId: row.user_id,
    credits: Number(row.credits ?? 0),
    storeCredits: Number(row.store_credits ?? 0),
    spendableCredits: Number(row.credits ?? 0) + Number(row.store_credits ?? 0),
    updatedAt: Number(row.updated_at ?? 0),
  };
};

// ---------------------------------------------------------------------------
// Balance helpers
// ---------------------------------------------------------------------------

export const getBalanceForCurrency = (wallet: WalletRow, currencyType: CurrencyType) =>
  currencyType === 'credits' ? wallet.credits : wallet.credits;

export const setBalanceForCurrency = async (
  userId: string,
  _currencyType: CurrencyType,
  balance: number,
  now: number,
) => {
  await query(
    'UPDATE wallets SET credits = $1, updated_at = $2 WHERE user_id = $3',
    [balance, now, userId],
  );
};

// ---------------------------------------------------------------------------
// mutateWalletAndLedgerTx
// ---------------------------------------------------------------------------

/**
 * Atomically mutate a wallet balance and append a ledger entry.
 *
 * Runs in its own transaction: locks the wallet row `FOR UPDATE`, dedupes by
 * (user, currency, sourceType, sourceId), enforces integer amounts and a
 * non-negative resulting balance. For composing with other writes in a single
 * transaction, use `mutateWalletAndLedgerForTransaction` from `./wallet`.
 */
export const mutateWalletAndLedgerTx = async ({
  userId,
  currencyType,
  amount,
  sourceType,
  sourceId,
  meta,
  createdBy,
}: {
  userId: string;
  currencyType: CurrencyType;
  amount: number;
  sourceType: LedgerSourceType;
  sourceId: string;
  meta?: Record<string, unknown>;
  createdBy?: string | null;
}): Promise<{ deduped: boolean; ledgerId: string; balanceAfter: number }> => {
  if (!Number.isInteger(amount)) {
    throw new Error('Currency amount must be an integer.');
  }
  if (currencyType === 'credits' && shouldEnforceCreditsIncrement(sourceType)) {
    ensureCreditsIncrement(amount);
  }

  return withTransaction((client) =>
    mutateWalletAndLedgerForTransaction(client, {
      userId,
      currencyType,
      amount,
      sourceType,
      sourceId,
      meta,
      createdBy,
    }),
  );
};
