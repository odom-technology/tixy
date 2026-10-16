import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Pool } from 'pg';

// Invoke directly with tsx, without run-with-env or an application .env. Only a
// fresh, disposable database is accepted; no ad SDK or provider is contacted.
const databaseUrl = process.env.REWARDED_AD_TEST_DATABASE_URL;
const target = databaseUrl ? new URL(databaseUrl) : null;
if (
  !target ||
  !['postgres:', 'postgresql:'].includes(target.protocol) ||
  !['localhost', '127.0.0.1', '[::1]'].includes(target.hostname) ||
  target.pathname !== '/arcade_rewarded_ad_regression' ||
  target.search
) {
  throw new Error(
    'REWARDED_AD_TEST_DATABASE_URL must target a fresh local disposable arcade_rewarded_ad_regression database.',
  );
}
process.env.DATABASE_URL = databaseUrl;
process.env.NEXT_PUBLIC_GAM_REWARDED_AD_UNIT_PATH = '/isolated-regression/rewarded';
process.env.AD_REWARD_STORE_TICKETS = '25';
process.env.AD_REWARD_DAILY_LIMIT = '2';
process.env.AD_REWARD_COOLDOWN_MS = '60000';
process.env.AD_REWARD_INTENT_TTL_MS = '600000';

const pool = new Pool({ connectionString: databaseUrl, max: 10 });
globalThis.__arcadePgPool = pool;
const userId = 'rewarded_player_test';
const otherUserId = 'rewarded_other_test';
const day = 24 * 60 * 60 * 1000;
let checks = 0;

try {
  const tables = await pool.query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' LIMIT 1`,
  );
  assert.equal(tables.rowCount, 0, 'Refusing to modify a nonempty database.');
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

  const { createRewardedAdIntent, claimRewardedAdIntent } =
    await import('../src/server/monetization/rewarded-ads');
  const start = (rewardType: string = 'store_tickets', gameType?: string) =>
    createRewardedAdIntent({ userId, rewardType, gameType });
  const claim = (intentId: string, claimant = userId, grant = 'test-grant') =>
    claimRewardedAdIntent({ userId: claimant, intentId, clientGrantId: grant });
  const count = async (table: string, where = 'TRUE') => {
    // Table names and predicates are fixed test code, never external input.
    const result = await pool.query(`SELECT COUNT(*) AS count FROM ${table} WHERE ${where}`);
    return Number(result.rows[0].count);
  };
  const balance = async () => {
    const result = await pool.query('SELECT credits, store_credits FROM wallets WHERE user_id = $1', [userId]);
    return {
      credits: Number(result.rows[0]?.credits ?? 0),
      storeCredits: Number(result.rows[0]?.store_credits ?? 0),
    };
  };
  const ageAttempts = () => pool.query(
    'UPDATE ad_reward_intents SET created_at = $1 WHERE user_id = $2',
    [Date.now() - 61_000, userId],
  );
  async function reset() {
    process.env.AD_REWARD_DAILY_LIMIT = '2';
    process.env.AD_REWARD_STORE_TICKETS = '25';
    await pool.query('TRUNCATE arcade_accounts, wallets, store_credit_ledger CASCADE');
    for (const id of [userId, otherUserId]) {
      await pool.query(
        `INSERT INTO arcade_accounts (id,email,email_normalized,display_name,created_at,updated_at)
         VALUES ($1,$2,$2,'Isolated regression',0,0)`,
        [id, `${id}@example.invalid`],
      );
    }
    await pool.query('INSERT INTO wallets (user_id,credits,store_credits,updated_at) VALUES ($1,100,0,0)', [userId]);
  }
  async function test(name: string, run: () => Promise<void>) {
    await reset();
    await run();
    checks++;
    console.log(`PASS ${name}`);
  }
  const rejected = (results: PromiseSettledResult<unknown>[], pattern: RegExp) => {
    for (const result of results) {
      if (result.status === 'rejected') assert.match(String(result.reason), pattern);
    }
  };

  await test('concurrent starts admit one attempt and preserve the 60-second cooldown', async () => {
    const results = await Promise.allSettled(Array.from({ length: 8 }, () => start()));
    assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
    rejected(results, /Wait a moment/);
    assert.equal(await count('ad_reward_intents'), 1);
    assert.equal(await count('ad_reward_events', "event_type = 'created'"), 1);
    await assert.rejects(start(), /Wait a moment/);
    await ageAttempts();
    await start();
    assert.equal(await count('ad_reward_intents'), 2);
    assert.deepEqual(await balance(), { credits: 100, storeCredits: 0 });
  });

  await test('no-fill, abandoned and expired attempts do not consume the reward cap', async () => {
    for (let index = 0; index < 5; index++) {
      const { intent } = await start();
      if (index % 2 === 0) {
        await pool.query("UPDATE ad_reward_intents SET status = 'expired', expires_at = $1 WHERE id = $2", [Date.now() - 1, intent.id]);
      }
      await ageAttempts();
    }
    const { intent } = await start();
    await claim(intent.id);
    assert.equal(await count('ad_reward_intents'), 6);
    assert.equal(await count('ad_reward_intents', "status = 'claimed'"), 1);
    assert.equal(await count('store_credit_ledger'), 1);
    assert.deepEqual(await balance(), { credits: 100, storeCredits: 25 });
  });

  await test('concurrent distinct claims cannot exceed the daily cap', async () => {
    const ids: string[] = [];
    for (let index = 0; index < 5; index++) {
      ids.push((await start()).intent.id);
      await ageAttempts();
    }
    const results = await Promise.allSettled(ids.map((id) => claim(id)));
    assert.equal(results.filter((result) => result.status === 'fulfilled').length, 2);
    rejected(results, /Daily rewarded ad limit/);
    assert.equal(await count('ad_reward_intents', "status = 'claimed'"), 2);
    assert.equal(await count('ad_reward_events', "event_type = 'claimed'"), 2);
    assert.equal(await count('store_credit_ledger'), 2);
    assert.deepEqual(await balance(), { credits: 100, storeCredits: 50 });
    await assert.rejects(start(), /Daily rewarded ad limit/);
  });

  await test('concurrent duplicate claims grant once, including retry at the cap', async () => {
    process.env.AD_REWARD_DAILY_LIMIT = '1';
    const { intent } = await start();
    const results = await Promise.all(Array.from({ length: 8 }, (_, index) => claim(intent.id, userId, `grant-${index}`)));
    assert.equal(results.filter((result) => !result.deduped).length, 1);
    assert.equal(results.filter((result) => result.deduped).length, 7);
    assert.equal((await claim(intent.id)).deduped, true);
    assert.equal(await count('store_credit_ledger'), 1);
    assert.equal(await count('ad_reward_events', "event_type = 'claimed'"), 1);
    assert.deepEqual(await balance(), { credits: 100, storeCredits: 25 });
  });

  await test('cap uses the claim time even when the attempt was created over a day ago', async () => {
    process.env.AD_REWARD_DAILY_LIMIT = '1';
    const { intent } = await start();
    await pool.query('UPDATE ad_reward_intents SET created_at = $1, expires_at = $2 WHERE id = $3', [Date.now() - 2 * day, Date.now() + 60_000, intent.id]);
    await claim(intent.id);
    await assert.rejects(start(), /Daily rewarded ad limit/);
  });

  await test('claims older than the rolling day release capacity', async () => {
    process.env.AD_REWARD_DAILY_LIMIT = '1';
    const first = await start();
    await claim(first.intent.id);
    await pool.query('UPDATE ad_reward_intents SET created_at = $1, claimed_at = $1 WHERE id = $2', [Date.now() - day - 60_000, first.intent.id]);
    await claim((await start()).intent.id);
    assert.equal(await count('store_credit_ledger'), 2);
    assert.deepEqual(await balance(), { credits: 100, storeCredits: 50 });
  });

  await test('another account cannot claim or deduplicate an owned intent', async () => {
    const { intent } = await start();
    await assert.rejects(claim(intent.id, otherUserId), /Reward intent not found/);
    assert.equal(await count('store_credit_ledger'), 0);
    await claim(intent.id);
    await assert.rejects(claim(intent.id, otherUserId), /Reward intent not found/);
    assert.equal(await count('store_credit_ledger'), 1);
  });

  await test('expired and nonpending intents never grant rewards', async () => {
    const { intent } = await start();
    await pool.query('UPDATE ad_reward_intents SET expires_at = $1 WHERE id = $2', [Date.now() - 1, intent.id]);
    await assert.rejects(claim(intent.id), /Reward intent expired/);
    await assert.rejects(claim(intent.id), /Reward intent expired/);
    await pool.query("UPDATE ad_reward_intents SET status = 'cancelled' WHERE id = $1", [intent.id]);
    await assert.rejects(claim(intent.id), /no longer claimable/);
    assert.equal(await count('store_credit_ledger'), 0);
    assert.equal(await count('ad_reward_events', "event_type = 'claimed'"), 0);
    assert.deepEqual(await balance(), { credits: 100, storeCredits: 0 });
  });

  await test('ticket grant uses the amount saved by the server at creation', async () => {
    const { intent } = await start();
    assert.equal(intent.amount, 25);
    process.env.AD_REWARD_STORE_TICKETS = '9000';
    const result = await claim(intent.id);
    assert.equal(result.intent.amount, 25);
    const ledger = (await pool.query('SELECT amount, source_type, source_id FROM store_credit_ledger')).rows;
    assert.deepEqual(ledger, [{ amount: 25, source_type: 'rewarded_ad', source_id: `rewarded-ad:${intent.id}` }]);
    assert.deepEqual(await balance(), { credits: 100, storeCredits: 25 });
  });

  for (const rewardType of ['free_play', 'continue'] as const) {
    await test(`${rewardType} grants exactly one entitlement and no tickets`, async () => {
      const { intent } = await start(rewardType, rewardType === 'continue' ? 'snake' : undefined);
      assert.equal(intent.amount, 1);
      await claim(intent.id);
      await claim(intent.id);
      const entitlements = (await pool.query('SELECT entitlement_type, quantity FROM user_entitlements WHERE user_id = $1', [userId])).rows;
      assert.deepEqual(entitlements, [{ entitlement_type: rewardType, quantity: 1 }]);
      assert.equal(await count('user_entitlement_ledger'), 1);
      assert.equal(await count('store_credit_ledger'), 0);
      assert.deepEqual(await balance(), { credits: 100, storeCredits: 0 });
    });
  }

  await test('invalid reward, unsupported continue, and missing grant do not issue rewards', async () => {
    await assert.rejects(start('invented'), /Invalid rewarded ad reward type/);
    await assert.rejects(start('continue', 'chess'), /not available/);
    await assert.rejects(start('continue'), /not available/);
    assert.equal(await count('ad_reward_intents'), 0);
    const { intent } = await start();
    await assert.rejects(claim(intent.id, userId, '   '), /Reward grant event is required/);
    assert.equal(await count('store_credit_ledger'), 0);
  });

  console.log(`Verified ${checks} isolated rewarded-ad regressions against PostgreSQL.`);
} finally {
  await pool.end();
}
