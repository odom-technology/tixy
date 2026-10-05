import { query } from '@/server/db/client';

import { cached } from './cache';
import { ensureRollups } from './rollup';
import { revenueByCurrency } from './shared';
import type { CounterMetrics } from './types';
import {
  buildWindow,
  dayBoundsMs,
  densify,
  hasBaseline,
  kpi,
  num,
  parseWindow,
  windowDays,
} from './window';

/**
 * Counter definitions. Read only what the app recorded; Stripe is never called.
 *
 * purchases: distinct meta_json purchaseId over currency_ledger rows with
 *   source_type 'purchase' and store_credit_ledger rows with source_type
 *   'store_purchase' in the window (one purchase can write both when it is paid
 *   from bought and earned tickets). buyers: distinct players on those rows.
 *   ticketsSpent: the total price paid across both ledgers, positive.
 * items: per itemId (meta_json itemId), with name, kind (the first slot in
 *   slots_json, else game_type), price and active from store_items, purchases
 *   and tickets from the window, owners the count in user_owned_items. An item
 *   no longer in store_items shows its id, kind 'unknown', price 0, inactive.
 * packs: ticket_purchases created in the window with status 'fulfilled', by
 *   pack_id and currency: purchases, tickets granted, cents. refunds counts rows
 *   with reversed_at in the window (a reversed row leaves status 'fulfilled').
 * revenue, payers: fulfilled and not reversed purchases created in the window, by
 *   currency in cents; payers are distinct players with one.
 * conversion: activeAccounts is distinct non-guest players in admin_play_days in
 *   the window; itemBuyers and packBuyers are the ones among them who bought a
 *   counter item or a pack in the window; firstTimePackBuyers are payers whose
 *   first ever fulfilled purchase was in the window.
 * checkoutFunnel: ticket_purchases created in the window by status; started is
 *   all of them, reversed is rows with reversed_at set.
 * dailyRevenue: cents per day, all currencies summed (one, usd, in practice),
 *   fulfilled and not reversed, dense.
 */
async function load(daysInput: number): Promise<CounterMetrics> {
  await ensureRollups();
  const days = parseWindow(daysInput);
  const window = await buildWindow(days);
  const baseline = await hasBaseline(window, 'live');
  const list = windowDays(window);
  const cur = dayBoundsMs(window.from, window.to);
  const prev = dayBoundsMs(window.previousFrom, window.previousTo);

  const purchaseRows = `
    SELECT user_id, created_at, -amount AS price,
           COALESCE(meta_json::jsonb ->> 'purchaseId', id) AS pid,
           meta_json::jsonb ->> 'itemId' AS item_id
    FROM currency_ledger
    WHERE source_type = 'purchase' AND created_at >= $1 AND created_at < $2
    UNION ALL
    SELECT user_id, created_at, -amount,
           COALESCE(meta_json::jsonb ->> 'purchaseId', id),
           meta_json::jsonb ->> 'itemId'
    FROM store_credit_ledger
    WHERE source_type = 'store_purchase' AND created_at >= $1 AND created_at < $2`;

  const [totals, items, packs, refunds, revenue, payers, active, funnel, daily, firsts] = await Promise.all([
    query<{ purchases: string; buyers: string; spent: string; prev_purchases: string; prev_buyers: string; prev_spent: string }>(
      `SELECT COUNT(DISTINCT pid) FILTER (WHERE created_at >= $3) AS purchases,
              COUNT(DISTINCT user_id) FILTER (WHERE created_at >= $3) AS buyers,
              COALESCE(SUM(price) FILTER (WHERE created_at >= $3), 0) AS spent,
              COUNT(DISTINCT pid) FILTER (WHERE created_at < $3) AS prev_purchases,
              COUNT(DISTINCT user_id) FILTER (WHERE created_at < $3) AS prev_buyers,
              COALESCE(SUM(price) FILTER (WHERE created_at < $3), 0) AS prev_spent
       FROM (${purchaseRows}) p`,
      [prev.startMs, cur.endMs, cur.startMs],
    ),
    query<{
      item_id: string;
      purchases: string;
      tickets: string;
      name: string | null;
      kind: string | null;
      price: number | null;
      active: boolean | null;
      owners: string;
    }>(
      `WITH p AS (
         SELECT item_id, COUNT(DISTINCT pid) AS purchases, SUM(price) AS tickets
         FROM (${purchaseRows}) x WHERE item_id IS NOT NULL GROUP BY item_id
       )
       SELECT p.item_id, p.purchases, p.tickets, s.name,
              COALESCE(NULLIF(s.slots_json::jsonb ->> 0, ''), s.game_type) AS kind,
              s.price, s.active,
              (SELECT COUNT(*) FROM user_owned_items o WHERE o.item_id = p.item_id) AS owners
       FROM p LEFT JOIN store_items s ON s.id = p.item_id
       ORDER BY p.purchases DESC, p.item_id
       LIMIT 100`,
      [cur.startMs, cur.endMs],
    ),
    query<{ pack_id: string; currency: string; purchases: string; tickets: string; cents: string }>(
      `SELECT pack_id, currency, COUNT(*) AS purchases, SUM(tickets_granted) AS tickets, SUM(amount_total) AS cents
       FROM ticket_purchases
       WHERE status = 'fulfilled' AND created_at >= $1 AND created_at < $2
       GROUP BY pack_id, currency ORDER BY cents DESC, pack_id`,
      [cur.startMs, cur.endMs],
    ),
    query<{ pack_id: string; refunds: string }>(
      `SELECT pack_id, COUNT(*) AS refunds FROM ticket_purchases
       WHERE reversed_at >= $1 AND reversed_at < $2 GROUP BY pack_id`,
      [cur.startMs, cur.endMs],
    ),
    revenueByCurrency(cur.startMs, cur.endMs, prev.startMs),
    query<{ payers: string; prev_payers: string }>(
      `SELECT COUNT(DISTINCT user_id) FILTER (WHERE created_at >= $2) AS payers,
              COUNT(DISTINCT user_id) FILTER (WHERE created_at < $2) AS prev_payers
       FROM ticket_purchases
       WHERE status = 'fulfilled' AND reversed_at IS NULL AND created_at >= $1 AND created_at < $3`,
      [prev.startMs, cur.startMs, cur.endMs],
    ),
    query<{ n: string; item_buyers: string; pack_buyers: string }>(
      `WITH a AS (
         SELECT DISTINCT user_id FROM admin_play_days
         WHERE day >= $1::date AND day <= $2::date AND NOT is_guest
       )
       SELECT (SELECT COUNT(*) FROM a) AS n,
              (SELECT COUNT(DISTINCT b.user_id) FROM (${purchaseRows.replace(/\$1/g, '$3').replace(/\$2/g, '$4')}) b
                 WHERE b.user_id IN (SELECT user_id FROM a)) AS item_buyers,
              (SELECT COUNT(DISTINCT t.user_id) FROM ticket_purchases t
                 WHERE t.status = 'fulfilled' AND t.created_at >= $3 AND t.created_at < $4
                   AND t.user_id IN (SELECT user_id FROM a)) AS pack_buyers`,
      [window.from, window.to, cur.startMs, cur.endMs],
    ),
    query<{ status: string; n: string; reversed: string }>(
      `SELECT status, COUNT(*) AS n, COUNT(*) FILTER (WHERE reversed_at IS NOT NULL) AS reversed
       FROM ticket_purchases WHERE created_at >= $1 AND created_at < $2 GROUP BY status`,
      [cur.startMs, cur.endMs],
    ),
    query<{ day: string; cents: string }>(
      `SELECT (to_timestamp(created_at / 1000.0) AT TIME ZONE 'UTC')::date::text AS day, SUM(amount_total) AS cents
       FROM ticket_purchases
       WHERE status = 'fulfilled' AND reversed_at IS NULL AND created_at >= $1 AND created_at < $2
       GROUP BY 1`,
      [cur.startMs, cur.endMs],
    ),
    query<{ n: string }>(
      `SELECT COUNT(*) AS n FROM (
         SELECT user_id FROM ticket_purchases
         WHERE status = 'fulfilled' AND reversed_at IS NULL AND created_at >= $1 AND created_at < $2
         GROUP BY user_id
         HAVING NOT EXISTS (
           SELECT 1 FROM ticket_purchases e
           WHERE e.user_id = ticket_purchases.user_id AND e.fulfilled_at IS NOT NULL AND e.created_at < $1)
       ) f`,
      [cur.startMs, cur.endMs],
    ),
  ]);

  const t = totals.rows[0];
  const refundBy = new Map(refunds.rows.map((r) => [r.pack_id, num(r.refunds)]));
  const byStatus = new Map(funnel.rows.map((r) => [r.status, num(r.n)]));
  const started = [...byStatus.values()].reduce((a, b) => a + b, 0);
  const reversed = funnel.rows.reduce((a, r) => a + num(r.reversed), 0);
  const a = active.rows[0];

  return {
    window,
    purchases: kpi(num(t?.purchases), num(t?.prev_purchases), baseline),
    buyers: kpi(num(t?.buyers), num(t?.prev_buyers), baseline),
    ticketsSpent: kpi(num(t?.spent), num(t?.prev_spent), baseline),
    items: items.rows.map((row) => ({
      itemId: row.item_id,
      name: row.name ?? row.item_id,
      kind: row.kind ?? 'unknown',
      price: row.price ?? 0,
      active: row.active ?? false,
      purchases: num(row.purchases),
      tickets: num(row.tickets),
      owners: num(row.owners),
    })),
    packs: packs.rows.map((row) => ({
      packId: row.pack_id,
      purchases: num(row.purchases),
      tickets: num(row.tickets),
      cents: num(row.cents),
      currency: row.currency,
      refunds: refundBy.get(row.pack_id) ?? 0,
    })),
    revenue: revenue.map((row) => ({ currency: row.currency, cents: kpi(row.cents, row.previous, baseline) })),
    payers: kpi(num(payers.rows[0]?.payers), num(payers.rows[0]?.prev_payers), baseline),
    conversion: {
      activeAccounts: num(a?.n),
      itemBuyers: num(a?.item_buyers),
      packBuyers: num(a?.pack_buyers),
      firstTimePackBuyers: num(firsts.rows[0]?.n),
    },
    checkoutFunnel: {
      started,
      fulfilled: byStatus.get('fulfilled') ?? 0,
      failed: byStatus.get('failed') ?? 0,
      expired: byStatus.get('expired') ?? 0,
      reversed,
    },
    dailyRevenue: densify(list, new Map(daily.rows.map((row) => [row.day, num(row.cents)]))),
  };
}

export function getCounterMetrics(days: number): Promise<CounterMetrics> {
  const window = parseWindow(days);
  return cached('counter', window, () => load(window));
}

