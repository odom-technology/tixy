/**
 * Every avatar URL an account can hold still returns 200, and the old free
 * defaults draw as stubs.
 *
 *   BASE_URL=http://127.0.0.1:3205 npx tsx scripts/verify-avatar-urls.ts
 *
 * Checks, against a running server:
 *   - every file in public/cosmetics/avatars (PNG and WebP)
 *   - every path in the avatar registries
 *   - every distinct arcade_accounts.image_url in the database (DATABASE_URL)
 *   - every art kit avatar
 * and offline, that each of the 8 old free defaults maps to a stub that exists.
 */
import fs from 'node:fs';
import path from 'node:path';

import pg from 'pg';

import { AVATARS, artPath } from '../src/features/brand/avatars/catalog';
import { DEFAULT_AVATARS, STORE_AVATARS, displayAvatarUrl } from '../src/features/users/avatars';

for (const f of ['env/.env.local', 'env/.env']) {
  try {
    for (const raw of fs.readFileSync(path.join(process.cwd(), f), 'utf8').split(/\r?\n/)) {
      const line = raw.trim();
      const i = line.indexOf('=');
      if (!line || line.startsWith('#') || i === -1) continue;
      const k = line.slice(0, i).trim();
      const v = line.slice(i + 1).trim().replace(/^(["'])(.*)\1$/, '$2');
      if (process.env[k] === undefined) process.env[k] = v;
    }
  } catch {
    /* no file */
  }
}

const base = process.env.BASE_URL ?? 'http://127.0.0.1:3205';
const failures: string[] = [];
const paths = new Set<string>();

const dir = path.join(process.cwd(), 'public/cosmetics/avatars');
for (const file of fs.readdirSync(dir)) paths.add(`/cosmetics/avatars/${file}`);
for (const a of STORE_AVATARS) paths.add(a.src);
for (const a of AVATARS) paths.add(artPath(a, 'svg'));
for (const a of DEFAULT_AVATARS) paths.add(a.src);

const legacyDefaults = [
  'rookie-guy', 'rookie-gal', 'anime-hero', 'anime-heroine', 'pixel-bot', 'arcade-cat', 'astro', 'ghost',
].map((name) => `/cosmetics/avatars/default-${name}.png`);
for (const old of legacyDefaults) {
  paths.add(old);
  for (const form of [old, old.replace(/\.png$/, '.webp')]) {
    const stub = displayAvatarUrl(form);
    if (!stub.startsWith('/art/avatars/stub-')) failures.push(`${form} does not map to a stub (${stub})`);
    else if (!fs.existsSync(path.join(process.cwd(), 'public', stub))) failures.push(`${form} maps to missing ${stub}`);
  }
}

let rows = 0;
if (process.env.DATABASE_URL) {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const res = await pool.query<{ image_url: string }>(
    `SELECT DISTINCT image_url FROM arcade_accounts WHERE image_url IS NOT NULL AND image_url LIKE '/%'`,
  );
  await pool.end();
  rows = res.rows.length;
  for (const row of res.rows) paths.add(row.image_url);
}

for (const p of [...paths].sort()) {
  const res = await fetch(base + p);
  if (res.status !== 200) failures.push(`${p} returned ${res.status}`);
  await res.arrayBuffer();
}

console.log(`${paths.size} avatar URLs checked against ${base} (${rows} distinct image_url values from the database)`);
if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log('every avatar URL returns 200; every old free default maps to a stub');
