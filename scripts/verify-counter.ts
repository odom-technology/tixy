/**
 * The prize counter's sums and the skin catalog, with no database.
 *
 *   npm run test:counter
 *
 * - Every counter skin is a valid skin set for its game, priced on a shelf.
 * - Every 2048 skin's numerals read on every tile (4:1 or better, as the house tiles).
 * - Every flappy bird skin's posts and flyer read on its sky (3:1).
 * - Every mini golf skin's ball reads on its felt (3:1).
 * - "How far to the next prize" follows PROGRESSION.md's formula: the pin
 *   first, else the cheapest prize above the balance (ties: the newest), and
 *   days only with a pace from 3 or more days.
 * - "New this week" is this week's Monday drop, at most four, and a prize
 *   with a later Monday isn't on the counter yet.
 */
import assert from 'node:assert/strict';

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import {
  COUNTER_CATALOG,
  COUNTER_SHELVES,
  COUNTER_SKINS,
  counterWeekStart,
  isNewThisWeek,
  isOnCounterBy,
} from '@/features/arcade/lib/skins/counter-catalog';
import { SKIN_GAMES, contrastRatio, readSkinSet, readableOn, type SkinSet } from '@/features/arcade/lib/skins/skin-set';
import { applyGame2048SkinSet } from '@/app/(games)/2048/_2048-theme';
import { chessSkinLook } from '@/app/(games)/chess/_chess-skin';
import { ChessPieceSvg } from '@/app/(games)/chess/_piece-svg';
import { ChipArt } from '@/app/(games)/connect-four/_chip-art';
import { applyConnectFourSkinSet } from '@/app/(games)/connect-four/_connect-four-theme';
import { applyWordGridSkinSet } from '@/app/(games)/word-grid/_word-grid-theme';
import { pickNextPrize } from '@/server/arcade/rewards/counter';
import type { StoreItem } from '@/server/arcade/rewards/types';

let checks = 0;
const ok = (label: string) => {
  checks += 1;
  console.log(`  ok  ${label}`);
};

// ── the catalog ──────────────────────────────────────────────────────────
const ids = new Set<string>();
for (const item of COUNTER_CATALOG) {
  assert.ok(!ids.has(item.id), `duplicate id ${item.id}`);
  ids.add(item.id);
  assert.ok((COUNTER_SHELVES as readonly number[]).includes(item.price), `${item.id} on a shelf`);
  assert.equal(item.name, item.name.toLowerCase(), `${item.id} name is lowercase`);
  if (item.newOn) assert.equal(counterWeekStart(item.newOn), item.newOn, `${item.id} joins on a Monday`);
}
ok(`${COUNTER_CATALOG.length} prizes, unique ids, lowercase names, every price on a shelf, drops on Mondays`);

const perGame = new Map<string, number>();
for (const item of COUNTER_SKINS) {
  const skin = readSkinSet(item.assetRef, item.gameType as keyof typeof SKIN_GAMES);
  assert.ok(skin, `${item.id} is a valid skin set`);
  perGame.set(item.gameType, (perGame.get(item.gameType) ?? 0) + 1);
  assert.equal(item.onSale, SKIN_GAMES[skin.game].renders, `${item.id} on sale only when its game draws skin sets`);
}
for (const game of Object.keys(SKIN_GAMES)) {
  const count = perGame.get(game) ?? 0;
  assert.ok(count >= 4 && count <= 6, `${game} has ${count} skins`);
}
ok(`${COUNTER_SKINS.length} skins, 4 to 6 for each of ${Object.keys(SKIN_GAMES).length} floor games, all valid skin sets`);

assert.equal(readSkinSet({ skin: { v: 2, game: 'snake', palette: {}, material: 'ink', shape: 'tube', sound: 'house' } }), null);
assert.equal(readSkinSet({ skin: { ...(COUNTER_SKINS[0]!.assetRef.skin as object), shape: 'not-a-shape' } }), null);
assert.equal(readSkinSet({ bodyPrimary: '#ffffff' }), null);
ok('a malformed or older asset_ref is not read as a skin set');

for (const item of COUNTER_SKINS.filter((entry) => entry.gameType === '2048')) {
  const theme = applyGame2048SkinSet(readSkinSet(item.assetRef, '2048') as SkinSet<'2048'>);
  for (const [tier, colour] of Object.entries(theme.tileColors)) {
    const ratio = contrastRatio(colour.bg, colour.fg);
    assert.ok(ratio >= 4, `${item.id} tile ${tier}: ${ratio.toFixed(2)}:1`);
  }
}
ok('every 2048 skin keeps its numerals at 4:1 or better on every tile, as the house tiles do');

// Stacker: the tower, the moving row and the prize marks each hold 3:1 on the
// ground, and the moving row is told from the tower by lightness as well as hue.
for (const item of COUNTER_SKINS.filter((entry) => entry.gameType === 'stack')) {
  const p = (readSkinSet(item.assetRef, 'stack') as SkinSet<'stack'>).palette;
  for (const role of ['block', 'blockAlt', 'prize'] as const) {
    const ratio = contrastRatio(p.ground, p[role]);
    assert.ok(ratio >= 3, `${item.id} ${role} on the ground: ${ratio.toFixed(2)}:1`);
  }
  const rows = contrastRatio(p.block, p.blockAlt);
  assert.ok(rows >= 1.5, `${item.id} moving row against the tower: ${rows.toFixed(2)}:1`);
}
ok('every stacker skin holds its tower, moving row and prize marks 3:1 on the ground, and the moving row 1.5:1 off the tower');

// Ricochet: the teeth read 3:1 on the field and on the wall, the bird reads
// 3:1 on the field, the score (the mark) reads 4.5:1 on the field, and the wall
// is told from the field by 1.5:1.
for (const item of COUNTER_SKINS.filter((entry) => entry.gameType === 'ricochet')) {
  const p = (readSkinSet(item.assetRef, 'ricochet') as SkinSet<'ricochet'>).palette;
  const checks: [string, string, string, number][] = [
    ['teeth on the field', p.spike, p.ground, 3],
    ['teeth on the wall', p.spike, p.wall, 3],
    ['bird on the field', p.bird, p.ground, 3],
    ['score on the field', p.mark, p.ground, 4.5],
    ['wall against the field', p.wall, p.ground, 1.5],
  ];
  for (const [label, a, b, min] of checks) {
    const ratio = contrastRatio(a, b);
    assert.ok(ratio >= min, `${item.id} ${label}: ${ratio.toFixed(2)}:1`);
  }
}
ok('every ricochet skin keeps its teeth 3:1 on the field and the wall, the bird 3:1 and the score 4.5:1 on the field');

// Word grid: right place, right letter and absent are told apart by lightness
// (2:1 or better between each pair), and every letter reads 4.5:1.
for (const item of COUNTER_SKINS.filter((entry) => entry.gameType === 'word-grid')) {
  const skin = readSkinSet(item.assetRef, 'word-grid') as SkinSet<'word-grid'>;
  const theme = applyWordGridSkinSet(skin);
  const results = { hit: theme.correctColor, near: theme.presentColor, miss: theme.absentColor };
  for (const [a, b] of [['hit', 'near'], ['near', 'miss'], ['hit', 'miss']] as const) {
    const ratio = contrastRatio(results[a], results[b]);
    assert.ok(ratio >= 2, `${item.id} ${a} against ${b}: ${ratio.toFixed(2)}:1`);
  }
  for (const [role, fill] of Object.entries(results)) {
    const ratio = contrastRatio(fill, readableOn(fill, '#1f1a16', '#f4ebdc'));
    assert.ok(ratio >= 4.5, `${item.id} ${role} letter: ${ratio.toFixed(2)}:1`);
  }
  const ink = contrastRatio(skin.palette.tile, skin.palette.tileInk);
  assert.ok(ink >= 4.5, `${item.id} letter on a plain tile: ${ink.toFixed(2)}:1`);
}
ok('every word grid skin tells its three results apart by lightness (2:1 between each pair) and keeps every letter at 4.5:1');

// Chess: the two sides and the two squares read apart, and every piece shape
// draws six different pieces at the size of a 390 wide board square.
const chessSkins = COUNTER_SKINS.filter((entry) => entry.gameType === 'chess');
for (const item of chessSkins) {
  const skin = readSkinSet(item.assetRef, 'chess') as SkinSet<'chess'>;
  const look = chessSkinLook(skin);
  const p = skin.palette;
  assert.ok(contrastRatio(p.white, p.black) >= 3, `${item.id} white against black: ${contrastRatio(p.white, p.black).toFixed(2)}:1`);
  assert.ok(contrastRatio(p.light, p.dark) >= 1.25, `${item.id} light against dark squares`);
  for (const [side, fill, stroke] of [['white', p.white, look.strokeWhite], ['black', p.black, look.strokeBlack]] as const) {
    for (const square of [p.light, p.dark]) {
      // a piece is told off its square by its body or by its outline
      const held = Math.max(contrastRatio(fill, square), contrastRatio(stroke, square));
      assert.ok(held >= 3, `${item.id} ${side} piece on ${square}: ${held.toFixed(2)}:1`);
    }
  }
  const drawn = new Set(
    (['wk', 'wq', 'wr', 'wb', 'wn', 'wp'] as const).map((piece) =>
      renderToStaticMarkup(createElement(ChessPieceSvg, { piece, fill: p.white, stroke: look.strokeWhite, shape: skin.shape })).replace(/cp-sheen-[\w-]+/g, ''),
    ),
  );
  assert.equal(drawn.size, 6, `${item.id} draws six different pieces`);
  const sides = new Set(
    (['wp', 'bp'] as const).map((piece) =>
      renderToStaticMarkup(createElement(ChessPieceSvg, { piece, fill: piece === 'wp' ? p.white : p.black, stroke: '#000000', shape: skin.shape })),
    ),
  );
  assert.equal(sides.size, 2);
}
ok('every chess skin keeps white against black at 3:1, each piece off its square at 3:1, and draws six different pieces');

// Connect four: the two chips differ in lightness, and in a mark that isn't
// colour (a pip shape, or two holes against four), and both hold on the hole.
const c4Skins = COUNTER_SKINS.filter((entry) => entry.gameType === 'connect-four');
for (const item of c4Skins) {
  const skin = readSkinSet(item.assetRef, 'connect-four') as SkinSet<'connect-four'>;
  const theme = applyConnectFourSkinSet(skin);
  const chips = theme.skin!;
  const p = skin.palette;
  assert.ok(contrastRatio(p.you, p.them) >= 1.8, `${item.id} you against them: ${contrastRatio(p.you, p.them).toFixed(2)}:1`);
  for (const side of ['you', 'them'] as const) {
    const held = Math.max(contrastRatio(chips[side].fill, p.hole), contrastRatio(chips[side].edge, p.hole));
    assert.ok(held >= 3, `${item.id} ${side} chip on the hole: ${held.toFixed(2)}:1`);
  }
  assert.ok(contrastRatio(chips.win, p.hole) >= 3, `${item.id} winning ring on the hole`);
  const youMarkup = renderToStaticMarkup(createElement(ChipArt, { shape: skin.shape, side: 'you' }));
  const themMarkup = renderToStaticMarkup(createElement(ChipArt, { shape: skin.shape, side: 'them' }));
  assert.notEqual(youMarkup, themMarkup, `${item.id} marks the two chips apart without colour`);
}
ok('every connect four skin tells its chips apart by lightness and by a mark, and keeps chips and the winning ring at 3:1 on the holes');

// Flappy bird: the posts and the flyer each hold 3:1 on the sky, and the
// flyer is told from a post it flies beside (1.4:1).
for (const item of COUNTER_SKINS.filter((entry) => entry.gameType === 'flappy-bird')) {
  const p = (readSkinSet(item.assetRef, 'flappy-bird') as SkinSet<'flappy-bird'>).palette;
  for (const role of ['pipe', 'bird'] as const) {
    const ratio = contrastRatio(p.sky, p[role]);
    assert.ok(ratio >= 3, `${item.id} ${role} on the sky: ${ratio.toFixed(2)}:1`);
  }
  const beside = contrastRatio(p.bird, p.pipe);
  assert.ok(beside >= 1.4, `${item.id} flyer against a post: ${beside.toFixed(2)}:1`);
}
ok('every flappy bird skin holds its posts and flyer 3:1 on the sky, and the flyer 1.4:1 off a post');

// Ring toss: the rings hold 3:1 on the crate they land in and 2:1 on the
// booth and the platform they fly past, the row values 4.5:1 on the platform, and the back rows' glass (where
// the gold bottle stands) is 1.5:1 off its amber, so the gold reads by
// lightness as well as by its halo and its "100".
for (const item of COUNTER_SKINS.filter((entry) => entry.gameType === 'ring-toss')) {
  const p = (readSkinSet(item.assetRef, 'ring-toss') as SkinSet<'ring-toss'>).palette;
  for (const [ground, min] of [['crate', 3], ['booth', 2], ['platform', 2]] as const) {
    const ratio = contrastRatio(p.ring, p[ground]);
    assert.ok(ratio >= min, `${item.id} ring on the ${ground}: ${ratio.toFixed(2)}:1`);
  }
  const mark = contrastRatio(p.mark, p.platform);
  assert.ok(mark >= 4.5, `${item.id} row values on the platform: ${mark.toFixed(2)}:1`);
  const off = contrastRatio(p.glassAlt, '#f2a33c');
  assert.ok(off >= 1.5, `${item.id} back rows against the gold bottle: ${off.toFixed(2)}:1`);
}
ok('every ring toss skin holds its rings 3:1 on the crate and 2:1 on the booth and platform, its values 4.5:1, and keeps its back rows off the gold');
// Mini golf: the ball reads on the felt (3:1), its markings on the ball
// (1.5:1, so the roll shows) and the rail caps off the felt (1.5:1).
for (const item of COUNTER_SKINS.filter((entry) => entry.gameType === 'mini-golf')) {
  const p = (readSkinSet(item.assetRef, 'mini-golf') as SkinSet<'mini-golf'>).palette;
  const ball = contrastRatio(p.ball, p.felt);
  assert.ok(ball >= 3, `${item.id} ball on the felt: ${ball.toFixed(2)}:1`);
  const mark = contrastRatio(p.ballMark, p.ball);
  assert.ok(mark >= 1.5, `${item.id} markings on the ball: ${mark.toFixed(2)}:1`);
  const cap = contrastRatio(p.railTop, p.felt);
  assert.ok(cap >= 1.5, `${item.id} rail caps on the felt: ${cap.toFixed(2)}:1`);
}
ok('every mini golf skin holds its ball 3:1 on the felt, the markings 1.5:1 on the ball and the rail caps 1.5:1 on the felt');
// Bumper cars: the seats' colours never change, so every one of the eight
// must hold 1.35:1 on the skin's floor by its own colour or by its ink rubber
// ring; the rail's two bands read apart (1.5:1).
{
  const seats = ['#B83627', '#F2A33C', '#3E7CB1', '#2E9E6B', '#F4EBDC', '#8C5BB0', '#E0709A', '#2BB3B1'];
  for (const item of COUNTER_SKINS.filter((entry) => entry.gameType === 'bumper-cars')) {
    const p = (readSkinSet(item.assetRef, 'bumper-cars') as SkinSet<'bumper-cars'>).palette;
    for (const car of seats) {
      const held = Math.max(contrastRatio(car, p.floor), contrastRatio('#1f1a16', p.floor));
      assert.ok(held >= 1.35, `${item.id} car ${car} on the floor: ${held.toFixed(2)}:1`);
    }
    const bands = contrastRatio(p.rail, p.railAlt);
    assert.ok(bands >= 1.5, `${item.id} rail bands: ${bands.toFixed(2)}:1`);
  }
  ok('every bumper cars skin holds all eight seats 1.35:1 on its floor and its rail bands 1.5:1');
}

// Derby: the water gun (`ball`) reads on the counter (3:1), the slot along
// each rail (1.25:1) and the trims off the rails (1.5:1).
for (const item of COUNTER_SKINS.filter((entry) => entry.gameType === 'derby')) {
  const p = (readSkinSet(item.assetRef, 'derby') as SkinSet<'derby'>).palette;
  const ball = contrastRatio(p.ball, p.board);
  assert.ok(ball >= 3, `${item.id} ball on the lane: ${ball.toFixed(2)}:1`);
  const lines = contrastRatio(p.bandLine, p.band);
  assert.ok(lines >= 1.25, `${item.id} lane lines on the track: ${lines.toFixed(2)}:1`);
  const rail = contrastRatio(p.rail, p.band);
  assert.ok(rail >= 1.5, `${item.id} rails on the track: ${rail.toFixed(2)}:1`);
}
ok('every derby skin holds its ball 3:1 on the lane, its lane lines 1.25:1 and its rails 1.5:1 on the track');

// ── the next prize ───────────────────────────────────────────────────────
const prize = (id: string, price: number, createdAt = 0): StoreItem => ({
  id,
  name: id,
  gameType: 'snake',
  rarity: 'common',
  currencyType: 'credits',
  price,
  slots: ['body'],
  active: true,
  seasonTag: null,
  assetRef: null,
  createdAt,
});
const entries = [
  { item: prize('a', 450), owned: false },
  { item: prize('b', 750, 1), owned: false },
  { item: prize('c', 750, 2), owned: false },
  { item: prize('d', 2000), owned: false },
  { item: prize('e', 1200), owned: true },
];
const noPace = { ticketsPerDay: null, daysCounted: 2 };
const pace = { ticketsPerDay: 293, daysCounted: 5 };

assert.deepEqual(pickNextPrize(entries, 500, null, noPace).next, { itemId: 'c', pinned: false, away: 250, days: null });
ok('the next prize is the cheapest above the balance, the newest on a tie, with no days under 3 days of pace');
assert.deepEqual(pickNextPrize(entries, 500, null, pace).next, { itemId: 'c', pinned: false, away: 250, days: 1 });
assert.deepEqual(pickNextPrize(entries, 0, 'd', pace).next, { itemId: 'd', pinned: true, away: 2000, days: 7 });
ok('days are ceil(away / pace); a pinned prize comes first');
assert.deepEqual(pickNextPrize(entries, 600, 'a', pace).next, { itemId: 'a', pinned: true, away: -150, days: null });
ok('a pinned prize you can afford says so');
assert.deepEqual(pickNextPrize(entries, 600, 'e', pace).next?.itemId, 'c');
ok('a pin on a prize you own falls back to the next prize');
assert.deepEqual(pickNextPrize(entries, 5000, null, pace), { next: null, canAffordEverything: true });
assert.deepEqual(pickNextPrize(entries.map((entry) => ({ ...entry, owned: true })), 0, null, pace), {
  next: null,
  canAffordEverything: false,
});
ok('with nothing above the balance: "You can afford every prize."; with everything owned, no next prize');

// ── the week ─────────────────────────────────────────────────────────────
assert.equal(counterWeekStart('2026-10-03'), '2026-09-28');
assert.equal(counterWeekStart('2026-09-28'), '2026-09-28');
assert.equal(counterWeekStart('2026-10-04'), '2026-09-28');
const drop = COUNTER_CATALOG.filter((item) => item.newOn === '2026-10-05');
assert.ok(drop.length > 0 && drop.length <= 4, 'a drop is at most four prizes');
for (const item of drop) {
  assert.equal(isOnCounterBy(item.id, '2026-10-04'), false);
  assert.equal(isOnCounterBy(item.id, '2026-10-05'), true);
  assert.equal(isNewThisWeek(item.id, '2026-10-05'), true);
  assert.equal(isNewThisWeek(item.id, '2026-10-11'), true);
  assert.equal(isNewThisWeek(item.id, '2026-10-12'), false);
}
const weeks = new Map<string, number>();
for (const item of COUNTER_CATALOG) if (item.newOn) weeks.set(item.newOn, (weeks.get(item.newOn) ?? 0) + 1);
for (const [week, count] of weeks) assert.ok(count <= 4, `${week} drops ${count} prizes`);
ok('a Monday drop is new from that Monday to Sunday, at most four, and not on the counter before');

console.log(`verify-counter: ${checks} checks passed.`);
