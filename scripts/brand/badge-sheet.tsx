/* Draws every achievement's badge on one sheet, at 96 px and 32 px, and checks
   the art against the kit's rules.

     npx tsx scripts/brand/badge-sheet.tsx [out.png]

   The sheet has one row per series (tiers 1 to 5), a row of feats and a row of
   secrets, each at 96 and 32 px, then the locked version of one tier. It reads
   the registry, so a badge that is missing or mapped to nothing fails here.
   Exits non-zero when a badge uses a colour outside palette.ts or carries
   words. The page text on the sheet is Gabarito; the numbers on the badges are
   Big Shoulders, as in the app. */

import { writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { chromium } from 'playwright';

import {
  ART_HEXES,
  Badge,
  BadgeArt,
  BADGE_GLYPH_IDS,
  parseBadgeRef,
  type BadgeGlyphId,
} from '../../src/features/brand/avatars';
import { ACHIEVEMENTS, isRetiredAchievement } from '../../src/server/arcade/achievements/registry';

const root = path.resolve(import.meta.dirname, '../..');
const out = process.argv[2] ?? '/tmp/badge-sheet.png';
const FONTS = path.join(root, 'public/fonts/brand');

const failures: string[] = [];

/* The art, without the number pill, must be palette tokens and no words. */
function lint(id: string, markup: string) {
  const forbidden = markup.match(/<(linearGradient|radialGradient|filter|text|image|style|script|foreignObject)\b|url\(|\b(fill-opacity|stroke-opacity|style|filter)=/);
  if (forbidden) failures.push(`${id}: uses ${forbidden[0]}`);
  for (const hex of markup.matchAll(/#[0-9a-fA-F]{3,8}\b/g)) {
    if (!ART_HEXES.has(hex[0].toLowerCase())) failures.push(`${id}: ${hex[0]} is not a palette token`);
  }
  const bytes = Buffer.byteLength(markup);
  if (bytes > 3600) failures.push(`${id}: ${bytes} bytes`);
}
for (const glyph of BADGE_GLYPH_IDS) {
  for (const tier of [0, 3, 5]) {
    lint(`${glyph}:${tier}`, renderToStaticMarkup(createElement('svg', null, createElement(BadgeArt, { glyph, tier, chip: false }))));
  }
}

const listed = ACHIEVEMENTS.filter((a) => !isRetiredAchievement(a));
const rows: Array<{ label: string; glyph: BadgeGlyphId; tiers: number[] }> = [];
const seenSeries = new Set<string>();
for (const a of listed) {
  const ref = parseBadgeRef(a.icon);
  if (!ref) {
    failures.push(`${a.id}: icon ${a.icon} is not a badge`);
    continue;
  }
  if (a.seriesId) {
    if (seenSeries.has(a.seriesId)) continue;
    seenSeries.add(a.seriesId);
    rows.push({ label: a.seriesId, glyph: ref.glyph, tiers: [1, 2, 3, 4, 5] });
  } else {
    rows.push({ label: a.id, glyph: ref.glyph, tiers: [0] });
  }
}
const used = new Set(rows.map((r) => r.glyph));
const unused = BADGE_GLYPH_IDS.filter((g) => !used.has(g));

const svg = (glyph: BadgeGlyphId, tier: number, size: number, locked = false) =>
  renderToStaticMarkup(createElement(Badge, { glyph, tier, size, locked }));

const group = (title: string, items: typeof rows) => `
  <h2>${title}</h2>
  <div class='grid'>${items
    .map(
      (r) => `<div class='row'><div class='label'>${r.label}</div>
        <div class='big'>${r.tiers.map((t) => svg(r.glyph, t, 96)).join('')}</div>
        <div class='small'>${r.tiers.map((t) => svg(r.glyph, t, 32)).join('')}</div></div>`,
    )
    .join('')}</div>`;

const series = rows.filter((r) => r.tiers.length > 1);
const feats = rows.filter((r) => r.tiers.length === 1 && !r.label.startsWith('secret-'));
const secrets = rows.filter((r) => r.label.startsWith('secret-'));

const locked = `<h2>locked, and the secret before it is earned</h2><div class='grid'>
  <div class='row'><div class='label'>locked, tiers 1 to 5</div><div class='big'>${[1, 2, 3, 4, 5].map((t) => svg('snake', t, 96, true)).join('')}</div><div class='small'>${[1, 2, 3, 4, 5].map((t) => svg('snake', t, 32, true)).join('')}</div></div>
  <div class='row'><div class='label'>unknown secret</div><div class='big'>${svg('unknown', 0, 96)}</div><div class='small'>${svg('unknown', 0, 32)}</div></div>
  <div class='row'><div class='label'>retired fallback</div><div class='big'>${[1, 3, 5].map((t) => svg('cabinet', t, 96)).join('')}</div><div class='small'>${[1, 3, 5].map((t) => svg('cabinet', t, 32)).join('')}</div></div>
</div>`;

const html = `<!doctype html><meta charset='utf-8'><style>
@font-face { font-family: 'Gabarito'; src: url('file://${FONTS}/gabarito-latin-variable.woff2'); font-weight: 400 900; }
@font-face { font-family: 'Big Shoulders'; src: url('file://${FONTS}/big-shoulders-latin-variable.woff2'); font-weight: 100 900; }
:root { --tixy-font-num: 'Big Shoulders'; }
body { margin: 0; padding: 28px 32px; background: #F4EBDC; color: #1F1A16; font-family: 'Gabarito'; width: 1500px; }
h1 { font-size: 28px; font-weight: 800; margin: 0 0 4px; letter-spacing: -0.02em; }
p { margin: 0 0 18px; color: #54483D; font-size: 14px; }
h2 { font-size: 18px; font-weight: 800; margin: 26px 0 10px; letter-spacing: -0.02em; }
.grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
.row { background: #EADFCB; border-radius: 14px; padding: 12px 14px; display: grid; gap: 8px; }
.label { font-size: 13px; font-weight: 700; color: #54483D; }
.big, .small { display: flex; gap: 6px; align-items: center; }
.small { gap: 8px; }
</style>
<h1>achievement badges</h1>
<p>${rows.length} badges on the floor: ${series.length} series with five tiers, ${feats.length} feats and ${secrets.length} secrets. Each is shown at 96 px and at 32 px.</p>
${group('series', series)}${group('feats', feats)}${group('secrets', secrets)}${locked}`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1564, height: 900 }, deviceScaleFactor: Number(process.env.SCALE ?? 1) });
const file = path.join(os.tmpdir(), 'badge-sheet.html');
await writeFile(file, html);
await page.goto(`file://${file}`);
await page.evaluate(() => document.fonts.ready);
await page.screenshot({ path: out, fullPage: true });
await browser.close();

if (unused.length) console.log(`glyphs not on a listed achievement (retired shelf or spare): ${unused.join(', ')}`);
if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log(`badge sheet ok: ${rows.length} badges, ${BADGE_GLYPH_IDS.length} glyphs, every fill a token, wrote ${out}`);
