/* Checks the art kit's exported files:

   - every fill and stroke is a token from src/features/brand/avatars/palette.ts
   - no gradient, filter, opacity, text, image, style or script
   - felt only in the pool rail namecard
   - every SVG is under 2 KB, with a matching PNG
   - the files on disk are the ones the build writes (rerun
     scripts/brand/build-art-kit.tsx if this fails)

     npx tsx scripts/check-art-kit.ts */

import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

import { ART, ART_HEXES, ART_ITEMS, artPath } from '../src/features/brand/avatars';
import { toSvg } from './brand/build-art-kit';

const root = path.resolve(import.meta.dirname, '..');
const MAX_BYTES = 2048;
const FORBIDDEN = /<(linearGradient|radialGradient|filter|text|image|style|script|foreignObject)\b|url\(|\b(opacity|fill-opacity|stroke-opacity|style|filter)=/;

const failures: string[] = [];
const fail = (file: string, message: string) => failures.push(`${file}: ${message}`);

for (const item of ART_ITEMS) {
  const rel = artPath(item, 'svg');
  const disk = await readFile(path.join(root, 'public', rel), 'utf8').catch(() => null);
  if (disk === null) {
    fail(rel, 'missing, run scripts/brand/build-art-kit.tsx');
    continue;
  }
  if (disk !== toSvg(item)) fail(rel, 'out of date, run scripts/brand/build-art-kit.tsx');
  const bytes = Buffer.byteLength(disk);
  if (bytes >= MAX_BYTES) fail(rel, `${bytes} bytes, limit ${MAX_BYTES}`);
  if (FORBIDDEN.test(disk)) fail(rel, `uses ${disk.match(FORBIDDEN)?.[0]}`);
  for (const [, attr, value] of disk.matchAll(/\b(fill|stroke)="([^"]*)"/g)) {
    if (value === 'none') continue;
    if (!ART_HEXES.has(value.toLowerCase())) fail(rel, `${attr} ${value} is not a palette token`);
  }
  const hexes = [...disk.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map((m) => m[0].toLowerCase());
  for (const hex of hexes) if (!ART_HEXES.has(hex)) fail(rel, `${hex} is not a palette token`);
  if (disk.toLowerCase().includes(ART.felt.toLowerCase()) && item.id !== 'namecard-rail') {
    fail(rel, 'felt belongs to the pool rail namecard only');
  }
  const png = await readFile(path.join(root, 'public', artPath(item, 'png'))).catch(() => null);
  if (!png) fail(artPath(item, 'png'), 'missing');
}

/* Nothing else may sit in the kit's folder. */
const known = new Set(ART_ITEMS.flatMap((item) => [artPath(item, 'svg'), artPath(item, 'png')]));
for (const dir of ['avatars', 'frames', 'namecards', 'medals']) {
  for (const name of await readdir(path.join(root, 'public/art', dir))) {
    const rel = `/art/${dir}/${name}`;
    if (!known.has(rel)) fail(rel, 'not in the catalog');
  }
}
const ids = ART_ITEMS.map((item) => item.id);
if (new Set(ids).size !== ids.length) failures.push('catalog: duplicate ids');
const avatars = ART_ITEMS.filter((item) => item.kind === 'avatar').length;
if (avatars !== 24) failures.push(`catalog: ${avatars} avatars, want 24`);

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log(`art kit ok: ${ART_ITEMS.length} items, ${avatars} avatars, every fill a token, every SVG under ${MAX_BYTES} bytes`);
