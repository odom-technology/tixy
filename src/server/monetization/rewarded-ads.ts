import crypto from 'node:crypto';

import {
  getCombinedWalletForTransaction,
  mutateEntitlementForTransaction,
  mutateStoreCreditsForTransaction,
  type EntitlementType,
} from '@/server/arcade/rewards';
import { query, withTransaction } from '@/server/db/client';

export type RewardedAdRewardType = 'store_tickets' | 'free_play' | 'continue';

export type RewardedAdIntent = {
  id: string;
  userId: string;
  rewardType: RewardedAdRewardType;
  gameType: string | null;
  amount: number;
  status: string;
  createdAt: number;
  expiresAt: number;
  claimedAt: number | null;
};

type RewardIntentRow = {
  id: string;
  user_id: string;
  reward_type: string;
  game_type: string | null;
  amount: number | string;
  status: string;
  created_at: number | string;
  expires_at: number | string;
  claimed_at: number | string | null;
};

const CONTINUE_GAME_TYPES = new Set(['snake', 'flappy-bird', '2048', 'tetris']);

const readPositiveIntEnv = (name: string, fallback: number) => {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

export const getRewardedAdConfig = () => ({
  adUnitPath: process.env.NEXT_PUBLIC_GAM_REWARDED_AD_UNIT_PATH?.trim() || '',
  storeTicketsAmount: readPositiveIntEnv('AD_REWARD_STORE_TICKETS', 25),
  dailyLimit: readPositiveIntEnv('AD_REWARD_DAILY_LIMIT', 10),
  cooldownMs: readPositiveIntEnv('AD_REWARD_COOLDOWN_MS', 60_000),
  intentTtlMs: readPositiveIntEnv('AD_REWARD_INTENT_TTL_MS', 10 * 60_000),
});

const parseRewardType = (value: unknown): RewardedAdRewardType | null =>
  value === 'store_tickets' || value === 'free_play' || value === 'continue'
    ? value
    : null;

const normalizeIntentRow = (row: RewardIntentRow): RewardedAdIntent => ({
  id: row.id,
  userId: row.user_id,
  rewardType: row.reward_type as RewardedAdRewardType,
  gameType: row.game_type,
  amount: Number(row.amount ?? 0),
  status: row.status,
  createdAt: Number(row.created_at ?? 0),
  expiresAt: Number(row.expires_at ?? 0),
  claimedAt: row.claimed_at == null ? null : Number(row.claimed_at),
});

async function recordRewardEvent(
  client: {
    query: <T extends Record<string, unknown> = Record<string, unknown>>(
      text: string,
      values?: unknown[],
    ) => Promise<{ rows: T[] }>;
  },
  {
    intentId,
    userId,
    eventType,
    meta,
  }: {
    intentId: string;
    userId: string;
    eventType: string;
    meta?: Record<string, unknown>;
  },
) {
  await client.query(
    `
      INSERT INTO ad_reward_events (id, intent_id, user_id, event_type, created_at, meta_json)
      VALUES ($1, $2, $3, $4, $5, $6)
    `,
    [
      crypto.randomUUID(),
      intentId,
      userId,
      eventType,
      Date.now(),
      meta ? JSON.stringify(meta) : null,
    ],
  );
}

export async function createRewardedAdIntent({
  userId,
  rewardType,
  gameType,
}: {
  userId: string;
  rewardType: unknown;
  gameType?: string | null;
}) {
  const normalizedRewardType = parseRewardType(rewardType);
  if (!normalizedRewardType) throw new Error('Invalid rewarded ad reward type.');

  const normalizedGameType = gameType?.trim() || null;
  if (
    normalizedRewardType === 'continue' &&
    (!normalizedGameType || !CONTINUE_GAME_TYPES.has(normalizedGameType))
  ) {
    throw new Error('Rewarded continues are not available for this game.');
  }

  const config = getRewardedAdConfig();
  if (!config.adUnitPath) {
    throw new Error('Rewarded ads are not configured.');
  }

  const now = Date.now();
  const dayAgo = now - 24 * 60 * 60 * 1000;
  const recentResult = await query<{ count: string | number }>(
    `
      SELECT COUNT(*) AS count
      FROM ad_reward_intents
      WHERE user_id = $1 AND created_at >= $2
    `,
    [userId, dayAgo],
  );
  if (Number(recentResult.rows[0]?.count ?? 0) >= config.dailyLimit) {
    throw new Error('Daily rewarded ad limit reached.');
  }

  const cooldownResult = await query<RewardIntentRow>(
    `
      SELECT id, user_id, reward_type, game_type, amount, status, created_at, expires_at, claimed_at
      FROM ad_reward_intents
      WHERE user_id = $1
      ORDER BY created_at DESC
      LIMIT 1
    `,
    [userId],
  );
  const latest = cooldownResult.rows[0];
  if (latest && now - Number(latest.created_at ?? 0) < config.cooldownMs) {
    throw new Error('Wait a moment before requesting another rewarded ad.');
  }

  const amount = normalizedRewardType === 'store_tickets'
    ? config.storeTicketsAmount
    : 1;
  const intentId = crypto.randomUUID();
  const expiresAt = now + config.intentTtlMs;

  await query(
    `
      INSERT INTO ad_reward_intents (
        id,
        user_id,
        reward_type,
        game_type,
        amount,
        status,
        created_at,
        expires_at,
        meta_json
      ) VALUES ($1, $2, $3, $4, $5, 'pending', $6, $7, $8)
    `,
    [
      intentId,
      userId,
      normalizedRewardType,
      normalizedGameType,
      amount,
      now,
      expiresAt,
      JSON.stringify({ adUnitPath: config.adUnitPath }),
    ],
  );

  await withTransaction((client) =>
    recordRewardEvent(client, {
      intentId,
      userId,
      eventType: 'created',
      meta: { rewardType: normalizedRewardType, gameType: normalizedGameType },
    }),
  );

  return {
    intent: {
      id: intentId,
      userId,
      rewardType: normalizedRewardType,
      gameType: normalizedGameType,
      amount,
      status: 'pending',
      createdAt: now,
      expiresAt,
      claimedAt: null,
    } satisfies RewardedAdIntent,
    adUnitPath: config.adUnitPath,
  };
}

export async function claimRewardedAdIntent({
  userId,
  intentId,
  clientGrantId,
}: {
  userId: string;
  intentId: string;
  clientGrantId: string;
}) {
  const normalizedClientGrantId = clientGrantId.trim();
  if (!normalizedClientGrantId) {
    throw new Error('Reward grant event is required.');
  }

  return withTransaction(async (client) => {
    const result = await client.query<RewardIntentRow>(
      `
        SELECT id, user_id, reward_type, game_type, amount, status, created_at, expires_at, claimed_at
        FROM ad_reward_intents
        WHERE id = $1 AND user_id = $2
        FOR UPDATE
      `,
      [intentId, userId],
    );
    const row = result.rows[0];
    if (!row) throw new Error('Reward intent not found.');

    const intent = normalizeIntentRow(row);
    const now = Date.now();
    if (intent.status === 'claimed') {
      return { intent, deduped: true };
    }
    if (intent.status !== 'pending') {
      throw new Error('Reward intent is no longer claimable.');
    }
    if (intent.expiresAt <= now) {
      await client.query(
        `UPDATE ad_reward_intents SET status = 'expired' WHERE id = $1`,
        [intent.id],
      );
      throw new Error('Reward intent expired.');
    }

    let grantResult:
      | { ledgerId?: string; balanceAfter?: number; entitlementBalanceAfter?: number }
      | null = null;

    if (intent.rewardType === 'store_tickets') {
      const ledger = await mutateStoreCreditsForTransaction(client, {
        userId,
        amount: intent.amount,
        sourceType: 'rewarded_ad',
        sourceId: `rewarded-ad:${intent.id}`,
        meta: {
          rewardType: intent.rewardType,
          gameType: intent.gameType,
          clientGrantId: normalizedClientGrantId,
        },
      });
      grantResult = {
        ledgerId: ledger.ledgerId,
        balanceAfter: ledger.balanceAfter,
      };
    } else {
      const entitlementType: EntitlementType =
        intent.rewardType === 'free_play' ? 'free_play' : 'continue';
      const ledger = await mutateEntitlementForTransaction(client, {
        userId,
        entitlementType,
        amount: intent.amount,
        sourceType: 'rewarded_ad',
        sourceId: `rewarded-ad:${intent.id}`,
        meta: {
          rewardType: intent.rewardType,
          gameType: intent.gameType,
          clientGrantId: normalizedClientGrantId,
        },
      });
      grantResult = {
        ledgerId: ledger.ledgerId,
        entitlementBalanceAfter: ledger.balanceAfter,
      };
    }

    await client.query(
      `
        UPDATE ad_reward_intents
        SET status = 'claimed',
            granted_at = $1,
            claimed_at = $1,
            client_grant_id = $2
        WHERE id = $3
      `,
      [now, normalizedClientGrantId, intent.id],
    );

    await recordRewardEvent(client, {
      intentId: intent.id,
      userId,
      eventType: 'claimed',
      meta: {
        rewardType: intent.rewardType,
        gameType: intent.gameType,
        amount: intent.amount,
        ...grantResult,
      },
    });

    const wallet = await getCombinedWalletForTransaction(client, userId);

    return {
      intent: {
        ...intent,
        status: 'claimed',
        claimedAt: now,
      },
      wallet,
      grant: grantResult,
      deduped: false,
    };
  });
}
