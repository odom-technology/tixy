#!/usr/bin/env node
/* Renders the art kit's contact sheets with Playwright: every avatar, frame,
   namecard and medal at 32 px and at 128 px, on the paper ground.

     node scripts/brand/render-art-kit-sheet.mjs [outDir]    (default /tmp/art-kit)

   Writes sheet-32.png, sheet-128.png and sheet.html. Items are drawn from
   the exported files under public/art, so run build-art-kit.tsx first. */
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const root = path.resolve(import.meta.dirname, '../..');
const outDir = process.argv[2] ?? '/tmp/art-kit';
await mkdir(outDir, { recursive: true });

const art = path.join(root, 'public/art');
const list = async (dir) => (await readdir(path.join(art, dir))).filter((f) => f.endsWith('.svg')).map((f) => f.slice(0, -4)).sort();
const url = (dir, id) => pathToFileURL(path.join(art, dir, `${id}.svg`)).href;
const avatars = await list('avatars');
const frames = await list('frames');
const namecards = await list('namecards');
const medals = await list('medals');
const label = (id) => id.replace(/^(stub|frame|namecard|medal)-/, '');

function html(size) {
  const cell = (inner, id, w = size) => `<figure style="width:${Math.max(w, 56)}px">${inner}<figcaption>${label(id)}</figcaption></figure>`;
  const avatar = (id) => cell(`<div class="c" style="width:${size}px;height:${size}px"><img src="${url('avatars', id)}" width="${size}" height="${size}"></div>`, id);
  const framed = (id) => cell(`<div class="c framed" style="width:${size}px;height:${size}px"><img src="${url('avatars', 'stub-house')}" width="${size}" height="${size}"><img class="ov" src="${url('frames', id)}" width="${size}" height="${size}"></div>`, id);
  const medal = (id) => cell(`<img src="${url('medals', id)}" width="${size}" height="${size}">`, id);
  const card = (id) => cell(`<img class="card" src="${url('namecards', id)}" width="${size * 4}" height="${size}">`, id, size * 4);
  return `<!doctype html><meta charset="utf-8"><style>
*{box-sizing:border-box;margin:0}
body{background:#F4EBDC;color:#1F1A16;font:400 11px/1.3 sans-serif;padding:20px;width:${size === 32 ? 760 : 1180}px}
h2{font:700 13px sans-serif;margin:18px 0 8px}
.row{display:flex;flex-wrap:wrap;gap:${size === 32 ? 12 : 20}px}
figure{display:flex;flex-direction:column;gap:4px;align-items:flex-start}
figcaption{color:#54483D;font-size:${size === 32 ? 9 : 12}px}
.c{border-radius:50%;overflow:hidden;position:relative}
.c img{display:block}
.framed .ov{position:absolute;inset:0}
.card{display:block;border-radius:${size / 8}px}
</style>
<h2>avatars (${avatars.length})</h2><div class="row">${avatars.map(avatar).join('')}</div>
<h2>frames over the house stub</h2><div class="row">${frames.map(framed).join('')}</div>
<h2>medals</h2><div class="row">${medals.map(medal).join('')}</div>
<h2>namecards</h2><div class="row">${namecards.map(card).join('')}</div>`;
}

const browser = await chromium.launch();
for (const size of [32, 128]) {
  const file = path.join(outDir, 'sheet.html');
  await writeFile(file, html(size));
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  await page.goto(pathToFileURL(file).href);
  await page.screenshot({ path: path.join(outDir, `sheet-${size}.png`), fullPage: true });
  await page.close();
  if (size === 128) await writeFile(path.join(outDir, 'sheet.html'), html(128));
}
await browser.close();
console.log(`wrote ${outDir}/sheet-32.png and sheet-128.png`);
