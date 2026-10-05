/**
 * Store hiding and ownership regression test.
 *
 *   docker exec arcade-dev-postgres createdb -U arcade arcade_store_hide
 *   STORE_HIDING_DATABASE_URL=postgres://arcade:<password>@127.0.0.1:5433/arcade_store_hide \
 *     npm run test:store-hiding
 *
 * Needs an empty database whose name ends in `_hide`; it refuses anything else,
 * checked with current_database() after connecting. It runs the deploy
 * migration (SQL migrations and every catalog seed) three times and writes test
 * players, grants and admin edits, so drop the database afterwards.
 *
 * 0. The shop reset: every item seeded before the prize counter is off sale,
 *    the counter's catalog is on sale on its four shelves, and the reset
 *    migration keeps every owner and equip.
 * 1. Seeds keep admin choices: hide items and change prices the way the admin
 *    console does, re-run every seed, and check the hides and prices hold while
 *    names and art still refresh and deleted seed items come back.
 * 2. Retire keeps ownership: a player owns and equips items, the admin retires
 *    them, and the player still owns, equips and shows them, while the store and
 *    every rotation leave them out.
 * 3. True delete is refused while anyone owns an item, including a grant that
 *    is still being written when the delete starts.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { Pool } from 'pg';

import { diffOwnershipSnapshots, takeOwnershipSnapshot } from './verify-ownership-unchanged';

const databaseUrl = process.env.STORE_HIDING_DATABASE_URL;
if (!databaseUrl) {
  throw new Error(
    'STORE_HIDING_DATABASE_URL is required: an empty database whose name ends in _hide. See the header of scripts/verify-store-hiding.ts.',
  );
}
process.env.DATABASE_URL = databaseUrl;

const pool = new Pool({ connectionString: databaseUrl });
globalThis.__arcadePgPool = pool;

const database = (await pool.query<{ db: string }>('SELECT current_database() AS db')).rows[0]!.db;
if (!database.endsWith('_hide')) {
  await pool.end();
  throw new Error(`Refusing to run against "${database}": the database name must end in _hide.`);
}
const existingTables = Number(
  (
    await pool.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM information_schema.tables WHERE table_schema = 'public'`,
    )
  ).rows[0]!.count,
);
if (existingTables > 0) {
  await pool.end();
  throw new Error(
    `Refusing to run against "${database}": it already has ${existingTables} tables. Drop and recreate it so the test starts from a fresh database.`,
  );
}
console.log(`Running against the empty database ${database}.`);

let checks = 0;
/** Logs a passed check. Call it after the asserts it names. */
const ok = (label: string) => {
  checks += 1;
  console.log(`  ok  ${label}`);
};

const runDeployMigration = (label: string) => {
  const tsx = path.join(process.cwd(), 'node_modules', '.bin', 'tsx');
  const result = spawnSync(tsx, ['scripts/migrate.ts'], {
    env: { ...process.env, DATABASE_URL: databaseUrl },
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    console.error(result.stdout, result.stderr);
    throw new Error(`Deploy migration (${label}) failed with status ${result.status}.`);
  }
  const lines = `${result.stdout}`.split('\n').filter((line) => /Seeded store catalog|Refreshed store daily rotation|starter items|upserted/.test(line));
  console.log(`Deploy migration (${label}): ${lines.length} seed lines, ${lines.at(-1) ?? ''}`);
};

type ItemRow = { id: string; name: string; game_type: string; rarity: string; price: number; active: boolean; slots_json: string; asset_ref: string | null };
const getItem = async (id: string) =>
  (await pool.query<ItemRow>('SELECT id, name, game_type, rarity, price, active, slots_json, asset_ref FROM store_items WHERE id = $1', [id])).rows[0] ?? null;
const pickItems = async (where: string, count: number, params: unknown[] = []) => {
  const rows = (
    await pool.query<ItemRow>(
      `SELECT id, name, game_type, rarity, price, active, slots_json, asset_ref FROM store_items WHERE ${where} ORDER BY id LIMIT ${count}`,
      params,
    )
  ).rows;
  assert.equal(rows.length, count, `expected ${count} items for: ${where}`);
  return rows;
};
const catalogSnapshot = async () =>
  (
    await pool.query<{ row: string }>(
      `SELECT concat_ws('|', id, name, game_type, rarity, currency_type, price, slots_json, active, season_tag, md5(coalesce(asset_ref, ''))) AS row FROM store_items ORDER BY id`,
    )
  ).rows.map((r) => r.row);
const starterIds = (game: string) => {
  const source = fs.readFileSync(path.join(process.cwd(), 'src/server/arcade/rewards', `seed-${game}-items.ts`), 'utf8');
  return [...source.matchAll(/^\s+id: '([^']+)'/gm)].map((match) => match[1]!);
};

// ── 1. Seeds keep the admin's hides and prices ────────────────────────────
runDeployMigration('first deploy');

const {
  setStoreItemsActiveForSkinStudio,
  setStoreItemActiveForSkinStudio,
  upsertStoreItemForSkinStudio,
  retireStoreCatalogItems,
  deleteStoreCatalogItems,
  clearStoreCatalog,
  StoreCatalogDeleteRefusedError,
  generateStoreDailyRotation,
  getStoreStateForUser,
  getUserInventoryAndEquipped,
  equipStoreItemForUser,
  unequipStoreItemForUser,
  grantStoreItem,
  purchaseStoreItemForUser,
  getServerDateKey,
} = await import('@/server/arcade/rewards');
const { getFeaturedProfileItem } = await import('@/server/arcade/rewards/store');
const { getEquippedProfileFlair } = await import('@/server/arcade/rewards/profile-flair');
const { createAccount, updateAccountProfile, getAccountById } = await import('@/server/accounts');

const player = await createAccount({ email: 'hide-player@example.com', username: 'hideplayer', password: 'HidePass!2026' });
const buyer = await createAccount({ email: 'hide-buyer@example.com', username: 'hidebuyer', password: 'HidePass!2026' });
const admin = await createAccount({ email: 'hide-admin@example.com', username: 'hideadmin', password: 'HidePass!2026', roles: ['admin', 'player'] });

// Something owned before the reseed, so the ownership snapshot has rows to compare.
const [preOwned] = await pickItems(`game_type = 'snake' AND active`, 1);
await grantStoreItem({ itemId: preOwned!.id, userId: player.id, grantToAll: false, actorUserId: admin.id, acquiredSource: 'purchase' });
await equipStoreItemForUser({ userId: player.id, itemId: preOwned!.id, gameType: 'snake' });

// ── 0. The shop reset ────────────────────────────────────────────────────
// Every item seeded before the counter is off sale after a deploy, the
// counter's prizes are on sale, and the reset migration takes old items off
// sale without touching anything a player owns.
const COUNTER_IDS = `id ~ '^(counter|frame|namecard|medal|stub)-'`;
{
  const { COUNTER_CATALOG, COUNTER_SHELVES } = await import('@/features/arcade/lib/skins/counter-catalog');
  const legacyOnSale = Number(
    (await pool.query<{ n: string }>(`SELECT COUNT(*) AS n FROM store_items WHERE active AND NOT (${COUNTER_IDS})`)).rows[0]!.n,
  );
  assert.equal(legacyOnSale, 0, 'every item seeded before the counter is off sale');
  ok('every item seeded before the counter is off sale after a deploy');
  for (const item of COUNTER_CATALOG.filter((entry) => entry.onSale)) {
    const row = await getItem(item.id);
    assert.ok(row, `${item.id} seeded`);
    assert.equal(row.active, true, `${item.id} on sale`);
    assert.ok((COUNTER_SHELVES as readonly number[]).includes(row.price), `${item.id} priced on a shelf`);
  }
  for (const item of COUNTER_CATALOG.filter((entry) => !entry.onSale)) {
    assert.equal(await getItem(item.id), null, `${item.id} waits for its game to draw skin sets`);
  }
  ok('the counter catalog is seeded on sale, on the four shelves, and skins for games that do not draw them yet are not seeded');

  // Put some old items back on sale and give them owners, as production has
  // them today, then run the reset migration again.
  const old = (await pool.query<{ id: string; game_type: string; slots_json: string }>(
    `SELECT id, game_type, slots_json FROM store_items WHERE NOT (${COUNTER_IDS}) AND season_tag IS NULL ORDER BY id LIMIT 3`,
  )).rows;
  await pool.query('UPDATE store_items SET active = TRUE WHERE id = ANY($1::text[])', [old.map((row) => row.id)]);
  const owner = await (await import('@/server/accounts')).createAccount({
    email: 'hide-owner@example.com',
    username: 'hideowner',
    password: 'HidePass!2026',
  });
  for (const row of old) {
    await pool.query(
      `INSERT INTO user_owned_items (user_id, item_id, acquired_at, acquired_source) VALUES ($1, $2, 1, 'purchase')`,
      [owner.id, row.id],
    );
    const [slot] = JSON.parse(row.slots_json) as string[];
    await pool.query(
      `INSERT INTO user_equipped_items (user_id, game_type, slot, item_id, equipped_at) VALUES ($1, $2, $3, $4, 1)
       ON CONFLICT (user_id, game_type, slot) DO NOTHING`,
      [owner.id, row.game_type, slot, row.id],
    );
  }
  const beforeReset = await takeOwnershipSnapshot(pool);
  const counterBefore = (await pool.query<{ id: string }>(`SELECT id FROM store_items WHERE active AND ${COUNTER_IDS} ORDER BY id`)).rows;
  await pool.query(fs.readFileSync(path.join(process.cwd(), 'src/server/db/migrations/0059_counter_reset.sql'), 'utf8'));
  for (const row of old) assert.equal((await getItem(row.id))!.active, false, `${row.id} reset off sale`);
  assert.deepEqual(diffOwnershipSnapshots(beforeReset, await takeOwnershipSnapshot(pool)), []);
  assert.deepEqual(
    (await pool.query<{ id: string }>(`SELECT id FROM store_items WHERE active AND ${COUNTER_IDS} ORDER BY id`)).rows,
    counterBefore,
  );
  ok('the reset takes old items off sale, keeps every owner and equip, and leaves the counter alone');
}

// Seed-cosmetics items (all off sale since the reset): one hidden again with
// the bulk "Set inactive" and renamed by hand, one repriced.
const [cosHidden, cosPriced] = await pickItems(`game_type = 'gopher'`, 2);
await setStoreItemsActiveForSkinStudio([cosHidden!.id], false);
await pool.query(`UPDATE store_items SET name = 'renamed by hand', asset_ref = '{"broken":true}' WHERE id = $1`, [cosHidden!.id]);
await pool.query('UPDATE store_items SET price = 333 WHERE id = $1', [cosPriced!.id]);

// Legacy 8-ball and flappy-bird items: one hidden from the skins page ("Move To Catalog"), one repriced.
const [legacyHidden, legacyPriced] = await pickItems(`game_type IN ('8-ball', 'flappy-bird') AND NOT (${COUNTER_IDS})`, 2);
await setStoreItemActiveForSkinStudio(legacyHidden!.id, false);
await pool.query('UPDATE store_items SET price = 444 WHERE id = $1', [legacyPriced!.id]);

// Starter catalogs only re-run when their game is short of items, so delete two
// starter items each (retired first, nobody owns them) to make every starter seed run.
const starterSubjects: Record<string, { hidden: ItemRow; priced: ItemRow; deleted: string[] }> = {};
for (const game of ['chess', 'tetris', '2048', 'coin-flip']) {
  const ids = starterIds(game);
  assert.ok(ids.length >= 4, `found starter ids for ${game}`);
  const rows = await pickItems(`id = ANY($1::text[])`, 4, [ids]);
  const [hidden, priced, del1, del2] = rows as [ItemRow, ItemRow, ItemRow, ItemRow];
  await setStoreItemsActiveForSkinStudio([hidden.id], false);
  await pool.query('UPDATE store_items SET price = 555 WHERE id = $1', [priced.id]);
  await retireStoreCatalogItems([del1.id, del2.id]);
  const deleted = await deleteStoreCatalogItems([del1.id, del2.id]);
  assert.deepEqual(deleted.deletedItemIds.sort(), [del1.id, del2.id].sort());
  starterSubjects[game] = { hidden, priced, deleted: [del1.id, del2.id] };
}

// A battle pass item the admin tries to put on sale: seeds keep it off sale.
const [seasonItem] = await pickItems(`season_tag = 'season-0'`, 1);
await setStoreItemsActiveForSkinStudio([seasonItem!.id], true);

// The skin studio used to price every legendary at 0. A seeded legendary left
// free that way gets its seed price back; one saved in the skin studio now
// gets the seed's 2,000.
const [freeLegendary, studioLegendary] = await pickItems(`rarity = 'legendary' AND game_type = 'swerve'`, 2);
await pool.query('UPDATE store_items SET price = 0 WHERE id = $1', [freeLegendary!.id]);
const studioSaved = await upsertStoreItemForSkinStudio({
  id: studioLegendary!.id,
  name: studioLegendary!.name,
  gameType: 'swerve',
  rarity: 'legendary',
  currencyType: 'credits',
  price: 0,
  slots: JSON.parse(studioLegendary!.slots_json) as string[],
  assetRef: studioLegendary!.asset_ref ? (JSON.parse(studioLegendary!.asset_ref) as Record<string, unknown>) : null,
  active: true,
});
assert.equal(studioSaved!.price, 2000);
ok('the skin studio prices a legendary at 2,000, the seeded legendary price');

// Counter prizes: one hidden by the admin, one repriced.
const [counterHidden, counterPriced] = await pickItems(`id LIKE 'counter-%' AND active`, 2);
await setStoreItemsActiveForSkinStudio([counterHidden!.id], false);
await pool.query('UPDATE store_items SET price = 1999 WHERE id = $1', [counterPriced!.id]);

const ownershipBefore = await takeOwnershipSnapshot(pool);
runDeployMigration('second deploy');

console.log('Seeds after an admin hid and repriced items:');
assert.equal((await getItem(cosHidden!.id))!.active, false, 'seed-cosmetics hide held');
ok('a hidden seed-cosmetics item stays hidden');
{
  const row = (await getItem(cosHidden!.id))!;
  assert.equal(row.name, cosHidden!.name);
  assert.equal(row.asset_ref, cosHidden!.asset_ref);
}
ok('the hidden item still gets its name and art from the seed');
assert.equal((await getItem(cosPriced!.id))!.price, 333, 'seed-cosmetics price held');
ok('a repriced seed-cosmetics item keeps its price');
assert.equal((await getItem(counterHidden!.id))!.active, false, 'counter hide held');
assert.equal((await getItem(counterPriced!.id))!.price, 1999, 'counter price held');
assert.equal(
  Number((await pool.query<{ n: string }>(`SELECT COUNT(*) AS n FROM store_items WHERE active AND NOT (${COUNTER_IDS})`)).rows[0]!.n),
  0,
);
ok('a hidden counter prize stays hidden, a repriced one keeps its price, and no old item comes back on sale');
assert.equal((await getItem(legacyHidden!.id))!.active, false, 'legacy hide held');
assert.equal((await getItem(legacyPriced!.id))!.price, 444, 'legacy price held');
ok('legacy 8-ball and flappy-bird hide and price hold');
for (const [game, subject] of Object.entries(starterSubjects)) {
  assert.equal((await getItem(subject.hidden.id))!.active, false, `${game} starter hide held`);
  assert.equal((await getItem(subject.priced.id))!.price, 555, `${game} starter price held`);
  for (const id of subject.deleted) {
    const back = await getItem(id);
    assert.ok(back, `${game} starter seed ran and re-inserted ${id}`);
  }
}
ok('chess, tetris, 2048 and coin flip starter seeds ran, kept hides and prices, re-inserted deleted items');
assert.equal((await getItem(seasonItem!.id))!.active, false, 'season 0 item back off sale');
ok('a season 0 item pushed to the store goes back off sale');
assert.equal((await getItem(freeLegendary!.id))!.price, 2000, 'a free legendary got its seed price back');
assert.equal((await getItem(studioLegendary!.id))!.price, 2000, 'the studio-saved legendary kept 2,000');
ok('a legendary left at 0 tickets gets its 2,000 seed price back on deploy');
{
  // seed-cosmetics grants the admin-only profile items to admin accounts, so
  // the new admin account gains those 9. Nothing anyone owned may go away.
  const after = await takeOwnershipSnapshot(pool);
  const removed = diffOwnershipSnapshots(ownershipBefore, after).filter((line) => {
    const [from, to] = line.split(': ').at(-1)!.split(' -> ').map(Number);
    return to! < from! || line.startsWith('image_url') || line.startsWith('achievements');
  });
  assert.deepEqual(removed, [], `the reseed took ownership away: ${removed.join('; ')}`);
  const added = Object.keys(after.ownedByItem).filter((id) => !(id in ownershipBefore.ownedByItem));
  assert.ok(added.every((id) => id.startsWith('admin-')), `unexpected grants: ${added.join(', ')}`);
}
ok('the reseed removed no ownership, equip or avatar');

const catalogAfterSecond = await catalogSnapshot();
const ownershipAfterSecond = await takeOwnershipSnapshot(pool);
runDeployMigration('third deploy');
assert.deepEqual(await catalogSnapshot(), catalogAfterSecond, 'a third deploy changes nothing');
assert.deepEqual(diffOwnershipSnapshots(ownershipAfterSecond, await takeOwnershipSnapshot(pool)), []);
ok('a third deploy leaves the catalog and ownership exactly as they were');

// ── 2. Retire keeps every owner's item ─────────────────────────────────────
console.log('Retiring items a player owns:');
const today = getServerDateKey();
const rotationBefore = await generateStoreDailyRotation(today);
const inStore = rotationBefore.find((entry) => entry.item.gameType !== 'profile')!;
assert.ok(inStore, 'today has a rotation with a game skin in it');
const [title] = await pickItems(`game_type = 'profile' AND slots_json LIKE '%"title"%' AND active`, 1);
// Generated avatars are off sale since the reset; a player who bought one still has it.
const [avatar] = await pickItems(`game_type = 'profile' AND slots_json LIKE '%"avatar"%' AND asset_ref LIKE '%/cosmetics/avatars/%'`, 1);
const [reaction] = await pickItems(`game_type = 'reaction-time'`, 1);
const retireIds = [inStore.item.id, title!.id, avatar!.id];

for (const id of [...retireIds, reaction!.id]) {
  await grantStoreItem({ itemId: id, userId: player.id, grantToAll: false, actorUserId: admin.id, acquiredSource: 'purchase' });
}
await equipStoreItemForUser({ userId: player.id, itemId: inStore.item.id, gameType: inStore.item.gameType });
await equipStoreItemForUser({ userId: player.id, itemId: title!.id, gameType: 'profile' });
await equipStoreItemForUser({ userId: player.id, itemId: avatar!.id, gameType: 'profile' });
const avatarUrl = (JSON.parse(avatar!.asset_ref!) as { imageUrl: string }).imageUrl;
const flairBefore = await getEquippedProfileFlair(player.id);
assert.ok(flairBefore.title, 'title shows before retire');
assert.equal((await getAccountById(player.id))!.imageUrl, avatarUrl);

// The console's "Set inactive" retires the first two; the API's default DELETE retires the third.
await setStoreItemsActiveForSkinStudio(retireIds.slice(0, 2), false);
const retired = await retireStoreCatalogItems(retireIds.slice(2));
assert.deepEqual(retired.retiredItemIds, retireIds.slice(2));
assert.equal(retired.ownersKept, 1);
for (const id of retireIds) assert.equal((await getItem(id))!.active, false);
ok('"Set inactive" and the API retire take all 3 owned items off sale');

const inventory = await getUserInventoryAndEquipped(player.id);
for (const id of retireIds) {
  const owned = inventory.ownedItems.find((entry) => entry.item.id === id);
  assert.ok(owned, `player still owns ${id}`);
  assert.equal(owned.item.active, false);
  assert.ok(inventory.equipped.some((entry) => entry.item.id === id), `${id} still equipped`);
}
ok('the player still owns all 3 and they are still equipped');
assert.ok(inventory.ownedItems.some((entry) => entry.item.id === reaction!.id), 'reaction-time item listed');
ok('owned reaction time items show in the inventory');

for (const slot of inStore.item.slots) {
  await unequipStoreItemForUser({ userId: player.id, gameType: inStore.item.gameType, slot });
}
assert.ok(!(await getUserInventoryAndEquipped(player.id)).equipped.some((entry) => entry.item.id === inStore.item.id));
const reequipped = await equipStoreItemForUser({ userId: player.id, itemId: inStore.item.id, gameType: inStore.item.gameType });
assert.ok(reequipped.equipped.some((entry) => entry.item.id === inStore.item.id));
ok('a retired item can be unequipped and equipped again');

assert.deepEqual(await getEquippedProfileFlair(player.id), flairBefore);
assert.ok(await getFeaturedProfileItem(player.id, title!.id), 'featured item still resolves');
ok('profile flair and the featured item still render the retired title');

assert.equal((await getAccountById(player.id))!.imageUrl, avatarUrl);
await updateAccountProfile({ userId: player.id, imageUrl: null });
await updateAccountProfile({ userId: player.id, imageUrl: avatarUrl });
assert.equal((await getAccountById(player.id))!.imageUrl, avatarUrl);
ok('the retired avatar stays on the account and can be picked again');

const storeState = await getStoreStateForUser(buyer.id, today);
for (const id of retireIds) {
  assert.ok(!storeState.rotation.some((entry) => entry.item.id === id), `${id} left today's store`);
}
ok("retired items are gone from today's store");
const refreshed = await generateStoreDailyRotation(today, true);
assert.ok(!refreshed.some((entry) => retireIds.includes(entry.item.id)));
for (let day = 1; day <= 30; day++) {
  const date = new Date(Date.now() + day * 86_400_000);
  const rotation = await generateStoreDailyRotation(getServerDateKey(date));
  assert.ok(!rotation.some((entry) => retireIds.includes(entry.item.id)), `retired item in rotation for ${getServerDateKey(date)}`);
}
ok('a refreshed rotation and the next 30 days never pick a retired item');

// A rotation row left behind for an item hidden some other way is not listed.
const stale = refreshed[0]!.item.id;
await pool.query('UPDATE store_items SET active = FALSE WHERE id = $1', [stale]);
assert.ok(!(await generateStoreDailyRotation(today)).some((entry) => entry.item.id === stale));
await pool.query('UPDATE store_items SET active = TRUE WHERE id = $1', [stale]);
ok('the store never lists an inactive item, even from an old rotation row');

await assert.rejects(
  purchaseStoreItemForUser({ userId: buyer.id, itemId: inStore.item.id, dateKey: today }),
  /not available/,
);
ok('buying a retired item is refused');

// A free item in today's rotation is refused before the balance check.
const onSaleToday = (await generateStoreDailyRotation(today))[0]!.item;
await pool.query('UPDATE store_items SET price = 0 WHERE id = $1', [onSaleToday.id]);
await assert.rejects(
  purchaseStoreItemForUser({ userId: buyer.id, itemId: onSaleToday.id, dateKey: today }),
  /not available in store/,
);
await pool.query('UPDATE store_items SET price = $1 WHERE id = $2', [onSaleToday.price, onSaleToday.id]);
await assert.rejects(
  purchaseStoreItemForUser({ userId: buyer.id, itemId: onSaleToday.id, dateKey: today }),
  /Insufficient balance/,
);
ok('an item priced at 0 tickets cannot be bought');

// ── 3. True delete is refused while anyone owns an item ───────────────────
console.log('Deleting items:');
const ownershipBeforeDelete = await takeOwnershipSnapshot(pool);
const catalogBeforeDelete = await catalogSnapshot();
await assert.rejects(deleteStoreCatalogItems([inStore.item.id]), StoreCatalogDeleteRefusedError);
await assert.rejects(clearStoreCatalog(), StoreCatalogDeleteRefusedError);
assert.deepEqual(await catalogSnapshot(), catalogBeforeDelete);
assert.deepEqual(diffOwnershipSnapshots(ownershipBeforeDelete, await takeOwnershipSnapshot(pool)), []);
ok('deleting an owned item, or clearing the catalog, is refused and changes nothing');

const [unownedA, unownedB, unownedC] = await pickItems(
  `active AND season_tag IS NULL
   AND id NOT IN ('profile-badge-connector', 'profile-title-strategist')
   AND NOT EXISTS (SELECT 1 FROM user_owned_items o WHERE o.item_id = store_items.id)`,
  3,
);
await assert.rejects(deleteStoreCatalogItems([unownedA!.id]), /on sale/);
ok('deleting an item that is still on sale is refused');

// Earned rewards: code grants these by id, so deleting one would break future unlocks.
const [seasonReward] = await pickItems(`season_tag = 'season-0' AND NOT EXISTS (SELECT 1 FROM user_owned_items o WHERE o.item_id = store_items.id)`, 1);
const [achievementReward] = await pickItems(`season_tag = 'achievement' AND NOT EXISTS (SELECT 1 FROM user_owned_items o WHERE o.item_id = store_items.id)`, 1);
await setStoreItemsActiveForSkinStudio(['profile-badge-connector'], false);
for (const id of [seasonReward!.id, achievementReward!.id, 'profile-badge-connector']) {
  await assert.rejects(deleteStoreCatalogItems([id]), /earned reward/, `${id} must not be deletable`);
  assert.ok(await getItem(id));
}
await setStoreItemsActiveForSkinStudio(['profile-badge-connector'], true);
ok('battle pass, achievement and milestone rewards are never deleted, even unowned and inactive');

await retireStoreCatalogItems([unownedA!.id]);
await assert.rejects(deleteStoreCatalogItems([unownedA!.id, inStore.item.id]), StoreCatalogDeleteRefusedError);
assert.ok(await getItem(unownedA!.id), 'a mixed request deletes nothing');
ok('a request mixing owned and unowned items deletes nothing');

await grantStoreItem({ itemId: unownedA!.id, grantToAll: true, actorUserId: admin.id });
await assert.rejects(deleteStoreCatalogItems([unownedA!.id]), /owner/);
await pool.query(`DELETE FROM user_owned_items WHERE item_id = $1 AND user_id = '__all_users__'`, [unownedA!.id]);
ok('an item granted to all players counts as owned');

// A grant still being written when the delete starts: the delete waits for it, then refuses.
await retireStoreCatalogItems([unownedB!.id]);
const writer = await pool.connect();
try {
  await writer.query('BEGIN');
  await writer.query(
    `INSERT INTO user_owned_items (user_id, item_id, acquired_at, acquired_source) VALUES ($1, $2, $3, 'purchase')`,
    [buyer.id, unownedB!.id, Date.now()],
  );
  let settled = false;
  const pending = deleteStoreCatalogItems([unownedB!.id]).finally(() => {
    settled = true;
  });
  pending.catch(() => undefined);
  await new Promise((resolve) => setTimeout(resolve, 500));
  assert.equal(settled, false, 'delete waits for the open grant');
  await writer.query('COMMIT');
  await assert.rejects(pending, StoreCatalogDeleteRefusedError);
} finally {
  writer.release();
}
assert.ok(await getItem(unownedB!.id));
ok('a delete that races an uncommitted grant waits and then refuses');

// A grant that starts while the delete is running: the grant waits on the
// item row, the delete finishes, and the grant finds no item. No orphan row.
await retireStoreCatalogItems([unownedC!.id]);
const blocker = await pool.connect();
try {
  await blocker.query('BEGIN');
  // An unrelated open ownership write holds the delete inside its transaction.
  await blocker.query(
    `INSERT INTO user_owned_items (user_id, item_id, acquired_at, acquired_source) VALUES ($1, $2, $3, 'purchase')`,
    [buyer.id, preOwned!.id, Date.now()],
  );
  const settledDelete = { done: false };
  const pendingDelete = deleteStoreCatalogItems([unownedC!.id]).finally(() => {
    settledDelete.done = true;
  });
  pendingDelete.catch(() => undefined);
  await new Promise((resolve) => setTimeout(resolve, 300));
  const settledGrant = { done: false };
  const pendingGrant = grantStoreItem({ itemId: unownedC!.id, userId: player.id, grantToAll: false, actorUserId: admin.id }).finally(() => {
    settledGrant.done = true;
  });
  pendingGrant.catch(() => undefined);
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.equal(settledDelete.done, false, 'delete is mid-transaction');
  assert.equal(settledGrant.done, false, 'grant waits for the delete');
  await blocker.query('ROLLBACK');
  const result = await pendingDelete;
  assert.deepEqual(result.deletedItemIds, [unownedC!.id]);
  await assert.rejects(pendingGrant, /Store item not found/);
} finally {
  blocker.release();
}
assert.equal(
  Number((await pool.query('SELECT COUNT(*) AS n FROM user_owned_items WHERE item_id = $1', [unownedC!.id])).rows[0].n),
  0,
);
ok('a grant that starts during a delete waits, then finds no item and writes nothing');

await pool.query(
  `INSERT INTO skin_groups (id, name, slug, created_at, updated_at) VALUES ('hide-group', 'hide group', 'hide-group', 0, 0)`,
);
await pool.query(
  `INSERT INTO skin_group_items (group_id, item_id, created_at) VALUES ('hide-group', $1, 0)`,
  [unownedA!.id],
);
const deleted = await deleteStoreCatalogItems([unownedA!.id]);
assert.deepEqual(deleted.deletedItemIds, [unownedA!.id]);
assert.equal(deleted.groupLinksDeleted, 1);
assert.equal(await getItem(unownedA!.id), null);
ok('a retired item nobody owns can be deleted, with its skin group links');

assert.deepEqual(
  diffOwnershipSnapshots(ownershipBeforeDelete, await takeOwnershipSnapshot(pool)).filter(
    (line) => !line.includes(unownedB!.id) && !line.startsWith('owned items') && line !== 'owned pairs hash changed',
  ),
  [],
);
ok('no delete removed anything a player owns');

await pool.end();
console.log(`verify-store-hiding: ${checks} checks passed on ${database}.`);
process.exit(0);
