import assert from 'node:assert/strict';
import { AsyncLocalStorage } from 'node:async_hooks';
import { readFile } from 'node:fs/promises';
import { Pool } from 'pg';
import type Stripe from 'stripe';

// Next request APIs need the same async context available in the server runtime.
globalThis.AsyncLocalStorage = AsyncLocalStorage;

// Run only against the disposable PostgreSQL database, never an application .env.
const databaseUrl = process.env.PAYMENT_TEST_DATABASE_URL;
if (
  !databaseUrl ||
  new URL(databaseUrl).pathname !== '/arcade_payment_regression'
) {
  throw new Error(
    'PAYMENT_TEST_DATABASE_URL must target the disposable arcade_payment_regression database.',
  );
}
process.env.DATABASE_URL = databaseUrl;
process.env.STRIPE_SECRET_KEY = 'sk_test_isolated_regression';
const pool = new Pool({ connectionString: databaseUrl });
globalThis.__arcadePgPool = pool;
for (const migration of [
  '0001_accounts.sql',
  '0004_core_economy_time.sql',
  '0018_monetization.sql',
]) {
  await pool.query(
    await readFile(
      new URL(`../src/server/db/migrations/${migration}`, import.meta.url),
      'utf8',
    ),
  );
}
type Purchase = {
  id: string;
  user_id: string;
  pack_id: string;
  tickets_granted: number;
  amount_total: number;
  currency: string;
  status: string;
  stripe_session_id: string;
  stripe_payment_intent_id: string | null;
  stripe_charge_id: string | null;
  meta_json: string;
  fulfilled_at: number | null;
  reversal_status?: string;
};
let purchase: Purchase;
let balance = 0;
let flagged = false;
let ledger: unknown[] = [];
async function refresh() {
  purchase = (
    await pool.query('SELECT * FROM ticket_purchases WHERE id = $1', [
      'purchase_test',
    ])
  ).rows[0];
  balance = Number(
    (
      await pool.query('SELECT store_credits FROM wallets WHERE user_id = $1', [
        'player_test',
      ])
    ).rows[0]?.store_credits ?? 0,
  );
  flagged = Boolean(
    (
      await pool.query(
        'SELECT 1 FROM monetization_account_flags WHERE resolved_at IS NULL',
      )
    ).rowCount,
  );
  ledger = (await pool.query('SELECT * FROM store_credit_ledger')).rows;
}
async function setBalance(value: number) {
  await pool.query('UPDATE wallets SET store_credits = $1 WHERE user_id = $2', [
    value,
    'player_test',
  ]);
  await refresh();
}

const {
  getStripeClient,
  fulfillCheckoutSession,
  reverseTicketPurchaseByProviderId,
  flagTicketPurchaseByProviderId,
} = await import('../src/server/monetization/stripe-checkout');
let intent: Stripe.PaymentIntent;
let charge: Stripe.Charge;
let session: Stripe.Checkout.Session;
const stripe = getStripeClient();
stripe.paymentIntents.retrieve = (async (id: string) => {
  assert.equal(id, 'pi_test');
  return { ...intent, latest_charge: { ...charge } };
}) as typeof stripe.paymentIntents.retrieve;
stripe.charges.retrieve = (async (id: string) => {
  assert.equal(id, 'ch_test');
  return { ...charge };
}) as typeof stripe.charges.retrieve;

async function reset(initialBalance = 0) {
  purchase = {
    id: 'purchase_test',
    user_id: 'player_test',
    pack_id: 'starter',
    tickets_granted: 1000,
    amount_total: 199,
    currency: 'usd',
    status: 'pending',
    stripe_session_id: 'cs_test',
    stripe_payment_intent_id: null,
    stripe_charge_id: null,
    meta_json: '{"creditTarget":"store_credits"}',
    fulfilled_at: null,
  };
  await pool.query(
    'TRUNCATE arcade_accounts, wallets, currency_ledger, store_credit_ledger CASCADE',
  );
  await pool.query(`INSERT INTO arcade_accounts (id,email,email_normalized,display_name,created_at,updated_at)
    VALUES ('player_test','player@example.invalid','player@example.invalid','Test',0,0)`);
  await pool.query(
    `INSERT INTO wallets (user_id,credits,store_credits,updated_at) VALUES ('player_test',0,$1,0)`,
    [initialBalance],
  );
  await pool.query(`INSERT INTO ticket_purchases (id,user_id,pack_id,tickets_granted,amount_total,currency,status,
    stripe_session_id,meta_json,created_at,updated_at) VALUES ('purchase_test','player_test','starter',1000,199,
    'usd','pending','cs_test','{"creditTarget":"store_credits"}',0,0)`);
  await refresh();
  const metadata = {
    purchaseId: purchase.id,
    userId: purchase.user_id,
    packId: purchase.pack_id,
  };
  intent = {
    id: 'pi_test',
    amount: 199,
    currency: 'usd',
    status: 'succeeded',
    metadata,
  } as unknown as Stripe.PaymentIntent;
  charge = {
    id: 'ch_test',
    payment_intent: 'pi_test',
    amount: 199,
    currency: 'usd',
    paid: true,
    refunded: false,
    disputed: false,
    amount_refunded: 0,
  } as Stripe.Charge;
  session = {
    id: 'cs_test',
    mode: 'payment',
    client_reference_id: purchase.user_id,
    amount_total: 199,
    currency: 'usd',
    payment_status: 'paid',
    payment_intent: 'pi_test',
    metadata,
  } as unknown as Stripe.Checkout.Session;
}
const complete = async (event = 'evt_complete') => {
  try {
    return await fulfillCheckoutSession(session, event);
  } finally {
    await refresh();
  }
};
const reverse = async (
  event = 'evt_refund',
  reason: 'refunded' | 'disputed' = 'refunded',
) => {
  try {
    return await reverseTicketPurchaseByProviderId({
      chargeId: 'ch_test',
      stripeEventId: event,
      reason,
    });
  } finally {
    await refresh();
  }
};
let checks = 0;
async function test(name: string, run: () => Promise<void>) {
  await reset();
  await run();
  checks++;
  console.log(`PASS ${name}`);
}
await test('paid completion and duplicate events grant once', async () => {
  assert.equal((await complete()).fulfilled, true);
  await complete();
  await complete('evt_async_success');
  assert.equal(balance, 1000);
  assert.equal(ledger.length, 1);
});
await test('concurrent completion deliveries grant once under row locks', async () => {
  await Promise.all([
    complete('evt_one'),
    complete('evt_two'),
    complete('evt_three'),
  ]);
  assert.equal(balance, 1000);
  assert.equal(ledger.length, 1);
});
await test('unpaid session grants nothing', async () => {
  session.payment_status = 'unpaid';
  assert.equal((await complete()).fulfilled, false);
  assert.equal(balance, 0);
  assert.equal(purchase.status, 'pending');
});
await test('current unpaid intent or charge grants nothing', async () => {
  intent.status = 'processing';
  assert.equal((await complete()).fulfilled, false);
  intent.status = 'succeeded';
  charge.paid = false;
  assert.equal((await complete()).fulfilled, false);
  assert.equal(balance, 0);
});
for (const mismatch of [
  'session amount',
  'session currency',
  'session identity',
  'session pack',
  'intent amount',
  'intent currency',
  'intent identity',
  'charge amount',
  'provider binding',
]) {
  await test(`reject ${mismatch}`, async () => {
    if (mismatch === 'session amount') session.amount_total = 1;
    if (mismatch === 'session currency') session.currency = 'eur';
    if (mismatch === 'session identity') session.client_reference_id = 'other';
    if (mismatch === 'session pack') session.metadata!.packId = 'vault';
    if (mismatch === 'intent amount') intent.amount = 1;
    if (mismatch === 'intent currency') intent.currency = 'eur';
    if (mismatch === 'intent identity') intent.metadata.userId = 'other';
    if (mismatch === 'charge amount') charge.amount = 1;
    if (mismatch === 'provider binding')
      await pool.query(
        "UPDATE ticket_purchases SET stripe_payment_intent_id = 'pi_other'",
      );
    await assert.rejects(complete());
    assert.equal(balance, 0);
    assert.equal(purchase.status, 'pending');
  });
}
await test('failed payment can later succeed', async () => {
  await pool.query("UPDATE ticket_purchases SET status = 'failed'");
  await complete();
  assert.equal(balance, 1000);
});
await test('full refund reverses once and delayed completion preserves it', async () => {
  await complete();
  charge.refunded = true;
  charge.amount_refunded = 199;
  await reverse();
  await reverse('evt_second_refund');
  await complete('evt_delayed');
  assert.equal(balance, 0);
  assert.equal(purchase.status, 'refunded');
  assert.equal(ledger.length, 2);
});
await test('refund before completion never debits unrelated tickets', async () => {
  await setBalance(5000);
  charge.refunded = true;
  charge.amount_refunded = 199;
  await reverse();
  await complete();
  assert.equal(balance, 5000);
  assert.equal(purchase.reversal_status, 'not_granted');
  assert.equal(ledger.length, 0);
});
await test('completion sees current refund without its webhook', async () => {
  charge.refunded = true;
  charge.amount_refunded = 199;
  assert.equal((await complete()).fulfilled, false);
  assert.equal(balance, 0);
  assert.equal(purchase.status, 'refunded');
});
await test('dispute before completion resolves charge metadata and blocks grant', async () => {
  charge.disputed = true;
  await reverse('evt_dispute', 'disputed');
  await complete();
  assert.equal(balance, 0);
  assert.equal(purchase.status, 'disputed');
});
await test('partial refund flags review and cannot be overwritten', async () => {
  await complete();
  charge.amount_refunded = 10;
  await flagTicketPurchaseByProviderId({
    paymentIntentId: 'pi_test',
    chargeId: 'ch_test',
    stripeEventId: 'evt_partial',
    reason: 'Partial refund',
  });
  await refresh();
  await complete();
  assert.equal(balance, 1000);
  assert.equal(flagged, true);
  assert.equal(purchase.status, 'refund_pending_review');
  charge.refunded = true;
  charge.amount_refunded = 199;
  await reverse();
  assert.equal(balance, 0);
  assert.equal(purchase.status, 'refunded');
});
await test('partial refund seen by completion grants nothing', async () => {
  charge.amount_refunded = 10;
  await complete();
  assert.equal(balance, 0);
  assert.equal(flagged, true);
  assert.equal(purchase.status, 'refund_pending_review');
});
await test('spent tickets flag account; retries never debit other balance', async () => {
  await complete();
  await setBalance(100);
  charge.refunded = true;
  await reverse();
  await reverse('evt_retry');
  await complete();
  assert.equal(balance, 100);
  assert.equal(flagged, true);
  assert.equal(purchase.reversal_status, 'flagged_insufficient_balance');
});
await test('unknown provider purchase is ignored', async () => {
  intent.metadata.purchaseId = 'unrelated';
  assert.equal((await reverse()).reversed, false);
  assert.equal(balance, 0);
});
// Exercise auth with real request cookies/headers before checkout. Neither
// browser guests nor trusted proxy identities may start a paid purchase.
const { POST: checkoutPost } =
  await import('../src/app/api/store/ticket-packs/checkout/route');
const { createRequestStoreForAPI } =
  await import('next/dist/server/async-storage/request-store');
const { workAsyncStorage } =
  await import('next/dist/server/app-render/work-async-storage.external');
const { workUnitAsyncStorage } =
  await import('next/dist/server/app-render/work-unit-async-storage.external');
const { NextRequest } = await import('next/server');
const { serializeGuestToken } = await import('../src/server/auth/guest');
process.env.GAME_SESSION_SECRET = 'isolated_guest_cookie_test';
process.env.ARCADE_TRUST_PROXY_AUTH = 'true';
stripe.checkout.sessions.create = (async () => {
  throw new Error('Unauthenticated checkout must never contact Stripe.');
}) as typeof stripe.checkout.sessions.create;
const guestCookie = serializeGuestToken(
  'guest:00000000-0000-4000-8000-000000000000',
);
for (const [name, headers] of [
  ['anonymous', {}],
  ['guest', { cookie: `arcade_guest=${guestCookie}` }],
  [
    'external',
    { 'x-arcade-user-id': 'external_nonlocal', 'x-arcade-roles': 'player' },
  ],
] as const) {
  await test(`${name} checkout requires local sign-in before Stripe`, async () => {
    const request = new NextRequest(
      'http://localhost/api/store/ticket-packs/checkout',
      {
        method: 'POST',
        headers,
        body: JSON.stringify({ packId: 'starter' }),
      },
    );
    const requestStore = createRequestStoreForAPI(
      request,
      { pathname: request.nextUrl.pathname },
      { tags: [], expirationsByCacheKind: new Map() },
      undefined,
      undefined,
      undefined,
    );
    const response = await workAsyncStorage.run(
      { route: request.nextUrl.pathname, isStaticGeneration: false } as never,
      () => workUnitAsyncStorage.run(requestStore, () => checkoutPost(request)),
    );
    assert.equal(response.status, 401);
    assert.match((await response.json()).error, /Sign in/);
    assert.equal(response.headers.get('set-cookie'), null);
    assert.equal(
      (await pool.query('SELECT COUNT(*) FROM ticket_purchases')).rows[0].count,
      '1',
    );
  });
}
await test('signed-in checkout stays closed without payment fulfillment configuration', async () => {
  const { createAccountSession, ACCOUNT_SESSION_COOKIE } =
    await import('../src/server/accounts');
  const { token } = await createAccountSession({ userId: 'player_test' });
  const previousKey = process.env.STRIPE_SECRET_KEY;
  const previousWebhook = process.env.STRIPE_WEBHOOK_SECRET;
  try {
    for (const missing of ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET']) {
      process.env.STRIPE_SECRET_KEY = 'sk_test_isolated_regression';
      process.env.STRIPE_WEBHOOK_SECRET = 'whsec_isolated_regression';
      delete process.env[missing];
      const request = new NextRequest(
        'http://localhost/api/store/ticket-packs/checkout',
        {
          method: 'POST',
          headers: { cookie: `${ACCOUNT_SESSION_COOKIE}=${token}` },
          body: JSON.stringify({ packId: 'starter' }),
        },
      );
      const requestStore = createRequestStoreForAPI(
        request,
        { pathname: request.nextUrl.pathname },
        { tags: [], expirationsByCacheKind: new Map() },
        undefined,
        undefined,
        undefined,
      );
      const response = await workAsyncStorage.run(
        { route: request.nextUrl.pathname, isStaticGeneration: false } as never,
        () =>
          workUnitAsyncStorage.run(requestStore, () => checkoutPost(request)),
      );
      assert.equal(response.status, 503);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.match((await response.json()).error, /temporarily unavailable/);
      assert.equal(
        (await pool.query('SELECT COUNT(*) FROM ticket_purchases')).rows[0]
          .count,
        '1',
      );
    }
  } finally {
    if (previousKey === undefined) delete process.env.STRIPE_SECRET_KEY;
    else process.env.STRIPE_SECRET_KEY = previousKey;
    if (previousWebhook === undefined) delete process.env.STRIPE_WEBHOOK_SECRET;
    else process.env.STRIPE_WEBHOOK_SECRET = previousWebhook;
  }
});
console.log(
  `Verified ${checks} isolated Stripe payment regressions against PostgreSQL.`,
);
await pool.end();
