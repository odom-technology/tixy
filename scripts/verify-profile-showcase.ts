/**
 * Profile showcase and player card checks (docs/design/tixy-rebrand/PROFILES.md).
 *
 *   npm run test:profile-showcase
 *   PROFILE_VERIFY_URL=http://127.0.0.1:3019 PROFILE_VERIFY_PUBLIC=maple \
 *     npm run test:profile-showcase
 *
 * Without a URL it checks the pure rules: the unlock ladder, reading saved
 * showcases (including the kinds saved before rev. 2), the auto layout and
 * how the profile blob tells "never arranged" from "arranged, then emptied".
 * With a URL it also asks a running server for a public player's card and
 * embed: a PNG with an ETag that answers 304, an embed any site may frame,
 * and a 404 for a name that does not exist.
 */
import assert from 'node:assert/strict';

import { readAccountProfileDetails } from '../src/features/users/account-profile-details';
import {
  MAX_SHOWCASE_SLOTS,
  SHOWCASE_LADDER,
  autoShowcases,
  maxShowcaseSlots,
  nextShowcaseUnlock,
  readShowcases,
  visibleShowcases,
} from '../src/features/users/profile-showcase';

const isGame = (slug: string) => ['snake', 'skee-ball', 'chess', '8-ball', 'stack'].includes(slug);

// ── the ladder ─────────────────────────────────────────────────────────────
assert.deepEqual(
  [1, 4, 5, 9, 10, 19, 20, 29, 30, 99, 0, -3, Number.NaN].map(maxShowcaseSlots),
  [2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 2, 2, 2],
  'slots by level',
);
assert.equal(MAX_SHOWCASE_SLOTS, 6);
for (let i = 1; i < SHOWCASE_LADDER.length; i += 1) {
  assert.ok(SHOWCASE_LADDER[i]!.level > SHOWCASE_LADDER[i - 1]!.level, 'ladder levels rise');
  assert.equal(SHOWCASE_LADDER[i]!.slots, SHOWCASE_LADDER[i - 1]!.slots + 1, 'one slot per rung');
}
assert.deepEqual(nextShowcaseUnlock(1), { level: 5, slots: 3 });
assert.deepEqual(nextShowcaseUnlock(23), { level: 30, slots: 6 });
assert.equal(nextShowcaseUnlock(30), null);

// ── reading saved showcases ────────────────────────────────────────────────
const legacy = readShowcases(
  [
    { type: 'game-stats', ref: 'snake' },
    { type: 'stat-highlight', ref: 'skee-ball' },
    { type: 'featured-item', ref: 'counter-chess-felt' },
    { type: 'featured-games', refs: ['chess', 'nope', 'chess', '8-ball'] },
    { type: 'level-badge' },
    { type: 'rarest-item' }, // a second prize slot: dropped as a duplicate
    { type: 'season' },
  ],
  isGame,
);
assert.deepEqual(legacy, [
  { type: 'favorite-game', ref: 'snake', refs: [] },
  { type: 'featured-score', ref: 'skee-ball', refs: [] },
  { type: 'items', ref: '', refs: ['counter-chess-felt'] },
  { type: 'bests', ref: '', refs: ['chess', '8-ball'] },
  { type: 'season', ref: '', refs: [] },
]);

const repeats = readShowcases(
  [
    { type: 'featured-score', ref: 'snake' },
    { type: 'featured-score', ref: 'snake' }, // same game twice: dropped
    { type: 'featured-score', ref: 'chess' }, // another game: kept
    { type: 'featured-score', ref: 'not-a-game' }, // unknown game: dropped
    { type: 'featured-score', ref: '../etc' }, // not a slug: dropped
    { type: 'items', refs: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'bad id!'] },
    { type: 'achievements' },
    { type: 'achievements' },
    { type: 'bogus' },
    null,
    'season',
  ],
  isGame,
);
assert.deepEqual(
  repeats.map((slot) => `${slot.type}:${slot.ref}`),
  ['featured-score:snake', 'featured-score:chess', 'items:', 'achievements:'],
);
assert.equal(repeats[2]!.refs.length, 6, 'at most six prizes');
assert.equal(
  readShowcases(Array.from({ length: 12 }, (_, i) => ({ type: 'featured-score', ref: ['snake', 'skee-ball', 'chess', '8-ball', 'stack'][i % 5] })), isGame).length,
  5,
  'distinct games only',
);
assert.deepEqual(readShowcases('nope', isGame), []);

// ── the auto layout ────────────────────────────────────────────────────────
assert.deepEqual(
  autoShowcases({ bestSlugs: [], playedSlugs: [], hasAchievements: false, hasItems: false }),
  [{ type: 'season', ref: '', refs: [] }],
  'a brand new player still gets a block',
);
const full = autoShowcases({
  bestSlugs: ['skee-ball', 'snake'],
  playedSlugs: ['skee-ball', 'snake', 'chess'],
  hasAchievements: true,
  hasItems: true,
});
assert.deepEqual(
  full.map((slot) => `${slot.type}:${slot.ref}`),
  ['featured-score:skee-ball', 'achievements:', 'items:', 'season:', 'favorite-game:snake', 'bests:'],
  'best first, and the favorite is not the featured game',
);
assert.equal(
  autoShowcases({ bestSlugs: ['snake'], playedSlugs: ['snake'], hasAchievements: false, hasItems: false }).find(
    (slot) => slot.type === 'favorite-game',
  )?.ref,
  'snake',
  'one game: it can be both',
);
const facts = { bestSlugs: ['snake'], playedSlugs: ['snake'], hasAchievements: true, hasItems: true };
assert.equal(visibleShowcases({ stored: null, level: 1, facts }).length, 2, 'auto, cut to level 1');
assert.equal(visibleShowcases({ stored: null, level: 30, facts }).length, 5);
assert.deepEqual(visibleShowcases({ stored: [], level: 30, facts }), [], 'an emptied showcase stays empty');
assert.equal(visibleShowcases({ stored: full, level: 10, facts }).length, 4, 'a saved list, cut to level 10');

// ── the profile blob ───────────────────────────────────────────────────────
assert.equal(readAccountProfileDetails({ bio: 'hi' }).showcases, null, 'never arranged: auto');
assert.equal(readAccountProfileDetails({ showcases: null }).showcases, null);
assert.deepEqual(readAccountProfileDetails({ showcases: [] }).showcases, []);
assert.deepEqual(readAccountProfileDetails({ showcases: [{ type: 'season' }] }).showcases, [
  { type: 'season', ref: '', refs: [] },
]);
assert.equal(readAccountProfileDetails(null).showcases, null);

console.log('profile showcase rules: ok');

// ── the card and the embed, against a running server ───────────────────────
const base = process.env.PROFILE_VERIFY_URL?.replace(/\/+$/, '');
if (base) {
  const name = process.env.PROFILE_VERIFY_PUBLIC ?? 'tester';
  const card = await fetch(`${base}/u/${name}/card.png`);
  assert.equal(card.status, 200, `card for ${name} (is the profile public?)`);
  assert.equal(card.headers.get('content-type'), 'image/png');
  assert.equal(card.headers.get('cache-control'), 'public, max-age=300');
  assert.equal(card.headers.get('access-control-allow-origin'), '*');
  const bytes = new Uint8Array(await card.arrayBuffer());
  assert.deepEqual([...bytes.slice(1, 4)].map((b) => String.fromCharCode(b)).join(''), 'PNG');
  assert.equal((bytes[16]! << 24) | (bytes[17]! << 16) | (bytes[18]! << 8) | bytes[19]!, 1200, 'width 1200');
  const etag = card.headers.get('etag');
  assert.ok(etag, 'an etag');
  const again = await fetch(`${base}/u/${name}/card.png?v=anything`, { headers: { 'if-none-match': etag } });
  assert.equal(again.status, 304, 'unchanged card answers 304 whatever ?v says');

  const big = await fetch(`${base}/u/${name}/card.png?size=2x`, { method: 'HEAD' });
  assert.equal(big.status, 200);
  assert.notEqual(big.headers.get('etag'), etag, '2x has its own etag');

  const embed = await fetch(`${base}/u/${name}/embed`);
  assert.equal(embed.status, 200);
  assert.equal(embed.headers.get('x-frame-options'), null, 'the embed is frameable');
  assert.match(embed.headers.get('content-security-policy') ?? '', /frame-ancestors \*/);
  const html = await embed.text();
  assert.match(html, new RegExp(`/u/${name}/card\\.png\\?v=`));
  assert.doesNotMatch(html, /<script/i, 'no scripts in the embed');

  const page = await fetch(`${base}/u/${name}`);
  assert.match(page.headers.get('x-frame-options') ?? '', /DENY/, 'the profile page itself is not frameable');
  assert.match(await page.text(), /og:image" content="[^"]*\/card\.png\?v=/, 'the card is the og:image');

  const missing = await fetch(`${base}/u/no-such-player-zz/card.png`);
  assert.equal(missing.status, 404);
  assert.equal((await fetch(`${base}/u/no-such-player-zz/embed`)).status, 404);
  console.log(`player card and embed for ${name}: ok`);
}
