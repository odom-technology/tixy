import type { LedgerBucket } from './types';

/* How currency_ledger rows (currency_type 'credits') and store_credit_ledger
   rows fall into the buckets the economy page shows. One table drives both the
   rollup's SQL and the TypeScript function, so they cannot drift apart. */

export type LedgerSourceTypeName =
  | 'game_reward'
  | 'shift_reward'
  | 'monthly_reward'
  | 'weekly_board'
  | 'purchase'
  | 'stripe_purchase'
  | 'stripe_reversal'
  | 'admin_adjust'
  | 'admin_grant'
  | 'refund'
  | 'wager_hold'
  | 'wager_payout'
  | 'wager_refund'
  | 'daily_claim'
  | 'battlepass'
  | 'level_reward'
  | 'achievement'
  | 'game_continue';

/** battlepass rows whose source_id starts with one of these are quests; the
    rest are season tiers. */
export const QUEST_SOURCE_PREFIXES = ['quest:', 'weekly-quest:', 'season-quest:', 'weekly-card:'] as const;

const DIRECT: Record<string, LedgerBucket> = {
  game_reward: 'game_rewards',
  daily_claim: 'daily_claim',
  level_reward: 'levels',
  achievement: 'achievements',
  monthly_reward: 'monthly_boards',
  weekly_board: 'weekly_boards',
  wager_payout: 'wager_payouts',
  wager_hold: 'wager_stakes',
  wager_refund: 'wager_stakes',
  purchase: 'counter',
  game_continue: 'continues',
  admin_adjust: 'admin',
  admin_grant: 'admin',
  refund: 'refunds',
};

/** Buckets that create tickets, and buckets that take them away. 'admin' is
    net per day and counts on the side its sign falls on. */
export const FAUCET_BUCKETS: readonly LedgerBucket[] = [
  'game_rewards',
  'daily_claim',
  'quests',
  'season',
  'levels',
  'achievements',
  'monthly_boards',
  'weekly_boards',
  'wager_payouts',
  'admin',
  'refunds',
  'other_in',
];
export const SINK_BUCKETS: readonly LedgerBucket[] = [
  'counter',
  'wager_stakes',
  'continues',
  'admin',
  'other_out',
];

/** The bucket for one currency_ledger row. */
export function earnedBucket(sourceType: string, sourceId: string, amount: number): LedgerBucket {
  if (sourceType === 'battlepass') {
    return QUEST_SOURCE_PREFIXES.some((prefix) => sourceId.startsWith(prefix)) ? 'quests' : 'season';
  }
  return DIRECT[sourceType] ?? (amount > 0 ? 'other_in' : 'other_out');
}

const BOUGHT: Record<string, string> = {
  stripe_purchase: 'packs',
  rewarded_ad: 'ads',
  store_purchase: 'counter',
  stripe_reversal: 'reversals',
};

/** The bucket for one store_credit_ledger row. */
export function boughtBucket(sourceType: string): string {
  return BOUGHT[sourceType] ?? 'other';
}

const q = (value: string) => `'${value.replace(/'/g, "''")}'`;

/** SQL CASE for the earned bucket over columns source_type, source_id, amount. */
export function earnedBucketSql(): string {
  const direct = Object.entries(DIRECT)
    .map(([source, bucket]) => `WHEN ${q(source)} THEN ${q(bucket)}`)
    .join(' ');
  const quest = QUEST_SOURCE_PREFIXES.map((prefix) => `source_id LIKE ${q(`${prefix}%`)}`).join(' OR ');
  return `(CASE source_type
    WHEN 'battlepass' THEN (CASE WHEN ${quest} THEN 'quests' ELSE 'season' END)
    ${direct}
    ELSE (CASE WHEN amount > 0 THEN 'other_in' ELSE 'other_out' END) END)`;
}

/** SQL CASE for the bought bucket over column source_type. */
export function boughtBucketSql(): string {
  const cases = Object.entries(BOUGHT)
    .map(([source, bucket]) => `WHEN ${q(source)} THEN ${q(bucket)}`)
    .join(' ');
  return `(CASE source_type ${cases} ELSE 'other' END)`;
}

/** The faucet side of admin_ledger_days rows: tickets minted in the window.
    A row counts when its bucket is a faucet and its amount is positive. */
export function mintedSql(bucket = 'bucket', amount = 'amount'): string {
  const list = FAUCET_BUCKETS.map(q).join(', ');
  return `CASE WHEN ${bucket} IN (${list}) AND ${amount} > 0 THEN ${amount} ELSE 0 END`;
}

/** The sink side, positive: sink buckets give back their negated amount, and
    admin counts only when negative. Other buckets are zero. */
export function spentSql(bucket = 'bucket', amount = 'amount'): string {
  const list = SINK_BUCKETS.filter((b) => b !== 'admin').map(q).join(', ');
  return `CASE WHEN ${bucket} IN (${list}) THEN -${amount}
               WHEN ${bucket} = 'admin' AND ${amount} < 0 THEN -${amount}
               ELSE 0 END`;
}
