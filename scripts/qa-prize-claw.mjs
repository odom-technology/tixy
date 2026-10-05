#!/usr/bin/env node
/**
 * Plays prize claw rounds in headless Chromium and saves what it sees.
 *
 *   node scripts/qa-prize-claw.mjs --base=http://127.0.0.1:3263 --cookie=<arcade_session> \
 *     --mode=desktop|touch|reduced --rounds=2 --out=/tmp/pclaw-qa [--label=after] [--video]
 *     [--cabinet=plush|curio|top] [--until=won] [--force=slipped] [--shots=few]
 *
 * Per round: press play, nudge the claw, press drop, then screenshots through the
 * drop and the receipt. It prints one JSON line per round with the receipt's
 * text (stake, payout, seed) so the run can be matched against
 * arcade_round_history. `desktop` is 1280 x 900, `touch` is 390 x 844 with a
 * touch screen, `reduced` is desktop with prefers-reduced-motion. --video
 * records the whole run as WebM. --until=won keeps playing (up to --rounds)
 * until a prize reaches the chute. --force=slipped rewrites the drop response
 * in the browser so the slip animation can be filmed; that round is not real
 * and will not match the database. --shots=few skips the in-drop screenshots.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    return m ? [m[1], m[2] ?? true] : [a, true];
  }),
);
const BASE = String(args.base ?? 'http://127.0.0.1:3263').replace(/\/$/, '');
const MODE = String(args.mode ?? 'desktop');
const ROUNDS = Number(args.rounds ?? 1);
const OUT = String(args.out ?? '/tmp/pclaw-qa');
const LABEL = String(args.label ?? 'run');
const CHROME = process.env.PLAYWRIGHT_EXECUTABLE_PATH;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await fs.mkdir(OUT, { recursive: true });
const browser = await chromium.launch({
  executablePath: CHROME,
  args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist'],
});
const touch = MODE === 'touch';
const context = await browser.newContext({
  ...(touch
    ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
    : { viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 }),
  reducedMotion: MODE === 'reduced' ? 'reduce' : 'no-preference',
  ...(args.video ? { recordVideo: { dir: OUT, size: touch ? { width: 390, height: 844 } : { width: 1280, height: 900 } } } : {}),
});
if (args.cookie) {
  await context.addCookies([
    { name: 'arcade_session', value: String(args.cookie), url: BASE, httpOnly: true, sameSite: 'Lax' },
  ]);
}
const page = await context.newPage();
if (args.force === 'slipped') {
  await page.route('**/api/wagers/action', async (route) => {
    const res = await route.fetch();
    const body = await res.json();
    const patch = (o) => {
      if (!o || typeof o !== 'object') return false;
      if (o.script && o.outcome) {
        o.outcome = 'slipped';
        o.grabbed = true;
        o.held = false;
        o.multiplier = 0;
        o.payout = 0;
        if (!o.target) return true;
        o.script.outcome = 'slipped';
        o.script.slipAtT = 0.55;
        o.script.travelMs = 0;
        o.script.releaseMs = 0;
        o.script.chuteMs = 0;
        o.script.bounce = [0.14, 0.06, 0.025];
        return true;
      }
      return Object.values(o).some(patch);
    };
    patch(body);
    await route.fulfill({ response: res, json: body });
  });
}
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
await page.goto(`${BASE}/prize-claw`, { waitUntil: 'load', timeout: 120000 });
await page.locator('canvas').first().waitFor({ timeout: 60000 });
await sleep(4500);
const shot = (name) =>
  page.screenshot({ path: path.join(OUT, `${LABEL}-${MODE}-${name}.jpg`), type: 'jpeg', quality: 80 });
await shot('idle');

if (args.cabinet) {
  await page.getByRole('button', { name: new RegExp(`^${args.cabinet}`, 'i') }).first().click();
  await sleep(1500);
}
const few = args.shots === 'few';
const rounds = [];
for (let r = 1; r <= ROUNDS; r += 1) {
  await page.getByRole('button', { name: /^play/i }).click();
  await page.getByRole('button', { name: /^drop/i }).waitFor({ timeout: 30000 });
  await sleep(1400);
  if (!few) await shot(`r${r}-poured`);
  const stage = page.locator('[aria-label^="prize claw cabinet"]').first();
  if (touch) {
    const box = await stage.boundingBox();
    await page.touchscreen.tap(box.x + box.width * 0.4, box.y + box.height * 0.55);
  } else {
    await stage.focus();
    // Out and back: the claw sways, and ends over the prize it opened on.
    for (const key of ['ArrowLeft', 'ArrowRight']) {
      for (let i = 0; i < 4; i += 1) {
        await page.keyboard.press(key);
        await sleep(70);
      }
    }
  }
  await sleep(500);
  if (!few) await shot(`r${r}-swaying`);
  await sleep(1500);
  await shot(`r${r}-aimed`);
  const dropAt = Date.now();
  await page.getByRole('button', { name: /^drop/i }).click();
  let n = 0;
  while (Date.now() - dropAt < 7000) {
    await sleep(touch ? 700 : 600);
    n += 1;
    if (!few) await shot(`r${r}-drop${String(n).padStart(2, '0')}`);
    if (await page.locator('text=/tickets lost|reached the chute/i').first().isVisible().catch(() => false)) break;
  }
  await sleep(1200);
  await shot(`r${r}-receipt`);
  const wonNow = await page.locator('text=/reached the chute/i').first().isVisible().catch(() => false);
  const text = await page.evaluate(() => document.body.innerText);
  rounds.push({
    round: r,
    receipt: text
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => /seed|tickets|×|grab|grip|stake|payout|net/i.test(l))
      .slice(0, 14),
  });
  console.log(JSON.stringify(rounds.at(-1)));
  if (args.until === 'won' && wonNow) break;
  // Close the slip so the next round can start.
  await page.keyboard.press('Escape').catch(() => undefined);
  await sleep(800);
}
if (errors.length) console.log('page errors:', JSON.stringify(errors.slice(0, 5)));
await context.close();
await browser.close();
