/**
 * In-game shots of every counter skin, for the prize counter.
 *
 *   npx tsx scripts/capture-skin-shots.mts --base=http://127.0.0.1:3024
 *     [--email=tester@tixy.local --password=...] [--only=ring-toss,derby]
 *     [--ids=counter-ring-toss-soda-crate] [--jobs=3]
 *
 * Writes public/art/skin-shots/<item id>.webp, one `house-<game>.webp` per
 * game (its look with no skin), and the manifest the counter reads
 * (src/features/arcade/components/counter/preview/skin-shots.json).
 *
 * Every shot is the game drawing itself with the skin on. Nothing is bought
 * or equipped: the browser answers the game's own inventory request with
 * the skin in the equipped list, so the game reads it as if it were on.
 *
 * - 3D games: the game's page at 1280 x 800, once its scene is up; the shot
 *   is the screen inside the cabinet's bezel.
 * - Games the counter draws live (counter/preview/live): the counter's own
 *   preview of the skin (`/store?prize=<id>`), at 2x. These shots are only
 *   for the hover on a card; the sheet draws them live. The counter's
 *   rotation is answered with the whole catalog, so a skin that isn't on
 *   the counter yet gets its shot too.
 *
 * Needs a running dev or prod server and a signed-in account (any). Run it
 * again after a game's look or a skin changes. Headless Chromium draws WebGL
 * on SwiftShader, so the 3D shots take a few seconds each.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import sharp from 'sharp';

import { COUNTER_SKINS } from '../src/features/arcade/lib/skins/counter-catalog';
import { SKIN_GAMES, type SkinGame } from '../src/features/arcade/lib/skins/skin-set';

const args = Object.fromEntries(
  process.argv.slice(2).map((arg) => {
    const match = arg.match(/^--([^=]+)(?:=(.*))?$/);
    return match ? [match[1], match[2] ?? 'true'] : [arg, 'true'];
  }),
) as Record<string, string>;

const base = (args.base ?? 'http://127.0.0.1:3024').replace(/\/$/, '');
const email = args.email ?? 'tester@tixy.local';
const password = args.password ?? 'tixy-test-2026';
const only = args.only ? new Set(args.only.split(',')) : null;
const onlyIds = args.ids ? new Set(args.ids.split(',')) : null;
const jobs = Math.max(1, Number(args.jobs ?? 3));

const ROOT = process.cwd();
const OUT = path.join(ROOT, 'public/art/skin-shots');
const MANIFEST = path.join(ROOT, 'src/features/arcade/components/counter/preview/skin-shots.json');
const MAX_WIDTH = 960;
const QUALITY = 76;

/* Games the counter draws live; must match LIVE in counter/preview/in-game-stage.tsx. */
const LIVE = new Set<SkinGame>(['chess', 'connect-four', '8-ball', 'ricochet', 'flappy-bird', 'stack', '2048', 'word-grid']);

/* Where each 3D (or not live) game lives. */
const GAME_PATH: Partial<Record<SkinGame, string>> = {
  snake: '/snake?skinShot=1',
  'skee-ball': '/skee-ball',
  'high-striker': '/high-striker',
  'tin-duck': '/tin-duck',
  'ring-toss': '/ring-toss',
  'mini-golf': '/mini-golf',
  'bumper-cars': '/bumper-cars',
  derby: '/derby',
};

type Job = { id: string; game: SkinGame; item: (typeof COUNTER_SKINS)[number] | null };

const BEZEL = 5;

async function signIn(context: BrowserContext) {
  const page = await context.newPage();
  await page.goto(`${base}/signin`, { waitUntil: 'domcontentloaded' });
  const ok = await page.evaluate(
    async ({ email, password }) =>
      (
        await fetch('/api/account/session', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ email, password }),
        })
      ).ok,
    { email, password },
  );
  await page.close();
  if (!ok) throw new Error(`Sign in failed for ${email}.`);
}

const asStoreItem = (item: (typeof COUNTER_SKINS)[number]) => ({
  id: item.id,
  name: item.name,
  gameType: item.gameType,
  price: item.price,
  slots: item.slots,
  assetRef: item.assetRef,
});

async function save(buffer: Buffer, id: string) {
  const image = sharp(buffer);
  const meta = await image.metadata();
  const width = Math.min(MAX_WIDTH, meta.width ?? MAX_WIDTH);
  const out = await image.resize({ width }).webp({ quality: QUALITY }).toBuffer({ resolveWithObject: true });
  writeFileSync(path.join(OUT, `${id}.webp`), out.data);
  return { width: out.info.width, height: out.info.height, bytes: out.data.length };
}

/* The screen inside the bezel, once the game has drawn. */
async function shootGame(page: Page, job: Job): Promise<Buffer> {
  await page.route('**/api/store/inventory**', async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as { equipped?: Array<{ item?: { gameType?: string } }> };
    const equipped = (body.equipped ?? []).filter((entry) => entry.item?.gameType !== job.game);
    if (job.item) {
      for (const slot of job.item.slots) {
        equipped.push({ slot, gameType: job.game, equippedAt: Date.now(), item: asStoreItem(job.item) } as never);
      }
    }
    await route.fulfill({ response, json: { ...body, equipped } });
  });
  await page.goto(`${base}${GAME_PATH[job.game]}`, { waitUntil: 'domcontentloaded', timeout: 180_000 });
  const screen = page.locator('.arc-shell-screen').first();
  await screen.waitFor({ state: 'visible', timeout: 180_000 });
  // The busy line ("Loading the cabinet.") goes when the scene is up.
  await page.waitForFunction(() => !document.querySelector('.arc-shell-hint[data-busy]'), null, { timeout: 180_000 });
  await page.waitForTimeout(3500);
  // Floating chrome (the social chip, the dev badge) can sit over the screen.
  await page.evaluate(() => {
    const screenEl = document.querySelector('.arc-shell-screen');
    for (const el of Array.from(document.querySelectorAll<HTMLElement>('body *'))) {
      const position = getComputedStyle(el).position;
      if ((position === 'fixed' || position === 'sticky') && screenEl && !el.contains(screenEl) && !screenEl.contains(el)) {
        el.style.visibility = 'hidden';
      }
    }
  });
  const box = await screen.boundingBox();
  if (!box) throw new Error('No screen.');
  return page.screenshot({
    clip: { x: box.x + BEZEL, y: box.y + BEZEL, width: box.width - BEZEL * 2, height: box.height - BEZEL * 2 },
  });
}

/* The counter's own live preview of the skin (or, for house, its "now"). */
async function shootLive(page: Page, job: Job): Promise<Buffer> {
  const firstOfGame = COUNTER_SKINS.find((item) => item.gameType === job.game)!;
  const target = job.item ?? firstOfGame;
  await page.route('**/api/store', async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as Record<string, unknown>;
    await route.fulfill({
      response,
      json: {
        ...body,
        equipped: [],
        rotation: COUNTER_SKINS.map((item, slotIndex) => ({ slotIndex, item: asStoreItem(item), owned: false, kind: item.kind })),
      },
    });
  });
  await page.goto(`${base}/store?prize=${encodeURIComponent(target.id)}`, { waitUntil: 'networkidle', timeout: 180_000 });
  const screen = page.locator('.pp-screen').first();
  await screen.waitFor({ state: 'visible', timeout: 60_000 });
  if (!job.item) {
    await page.getByRole('button', { name: 'now', exact: true }).click();
  }
  await page.waitForTimeout(1200);
  return screen.screenshot();
}

async function run() {
  mkdirSync(OUT, { recursive: true });
  const jobsList: Job[] = [];
  for (const game of Object.keys(SKIN_GAMES) as SkinGame[]) {
    if (only && !only.has(game)) continue;
    if (!onlyIds || onlyIds.has(`house-${game}`)) jobsList.push({ id: `house-${game}`, game, item: null });
    for (const item of COUNTER_SKINS.filter((entry) => entry.gameType === game)) {
      if (!onlyIds || onlyIds.has(item.id)) jobsList.push({ id: item.id, game, item });
    }
  }

  const browser: Browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
  const gameContext = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
  const liveContext = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2, reducedMotion: 'reduce' });
  await signIn(gameContext);
  await signIn(liveContext);

  const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8')) as { aspect: Record<string, number>; ids: string[] };
  const ids = new Set(manifest.ids);
  let total = 0;
  const queue = [...jobsList];
  const worker = async () => {
    for (let job = queue.shift(); job; job = queue.shift()) {
      const live = LIVE.has(job.game);
      const page = await (live ? liveContext : gameContext).newPage();
      try {
        const buffer = live ? await shootLive(page, job) : await shootGame(page, job);
        const saved = await save(buffer, job.id);
        manifest.aspect[job.game] = Math.round((saved.width / saved.height) * 1000) / 1000;
        ids.add(job.id);
        total += saved.bytes;
        console.log(`${job.id}  ${saved.width}x${saved.height}  ${Math.round(saved.bytes / 1024)} KB`);
      } catch (error) {
        console.error(`${job.id}  failed: ${(error as Error).message.split('\n')[0]}`);
      } finally {
        await page.close();
      }
    }
  };
  await Promise.all(Array.from({ length: jobs }, worker));
  await browser.close();

  manifest.ids = [...ids].sort();
  manifest.aspect = Object.fromEntries(Object.entries(manifest.aspect).sort(([a], [b]) => a.localeCompare(b)));
  writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`${jobsList.length} shots, ${Math.round(total / 1024)} KB written.`);
}

void run();
