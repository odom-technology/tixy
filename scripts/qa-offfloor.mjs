#!/usr/bin/env node
/**
 * Screenshots the off-floor games on the shared feedback pieces, as a guest.
 *
 *   QA_BASE_URL=http://127.0.0.1:3226 node scripts/qa-offfloor.mjs <outdir> [--width=390] [--reduced] [loading|math|breakout ...]
 *
 * loading: the reversi lobby with its API held back, so the loading line shows.
 * math: plays a 60 s run with no answers and shoots the end card.
 * breakout: sweeps the paddle until a brick breaks, then shoots the "+N" plate
 * a few frames in (a canvas hook notices the plate's text being drawn).
 * Touch contexts (hasTouch, isMobile) at 390.
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { chromium } from 'playwright';

const [outdir, ...rest] = process.argv.slice(2);
if (!outdir) {
  console.error('usage: qa-offfloor.mjs <outdir> [--width=390] [--reduced] [loading|math|breakout ...]');
  process.exit(1);
}
const flags = rest.filter((a) => a.startsWith('--'));
const which = rest.filter((a) => !a.startsWith('--'));
const flag = (name, fallback) => {
  const hit = flags.find((f) => f === `--${name}` || f.startsWith(`--${name}=`));
  if (!hit) return fallback;
  return hit.split('=')[1] ?? true;
};
const width = Number(flag('width', 390));
const reduced = Boolean(flag('reduced', false));
const base = process.env.QA_BASE_URL ?? 'http://127.0.0.1:3000';
const phone = width === 390;
mkdirSync(outdir, { recursive: true });

const browser = await chromium.launch({
  args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist'],
});

async function open(extra = async () => {}) {
  const context = await browser.newContext({
    viewport: { width, height: phone ? 844 : 800 },
    deviceScaleFactor: phone ? 2 : 1,
    hasTouch: phone,
    isMobile: phone,
    reducedMotion: reduced ? 'reduce' : 'no-preference',
  });
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
    window.__plates = 0;
    const fill = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function (text, ...args) {
      if (typeof text === 'string' && /^\+\d+$/.test(text)) window.__plates += 1;
      return fill.call(this, text, ...args);
    };
  });
  const page = await context.newPage();
  await extra(page);
  return { context, page };
}
const name = (game, what) => `after-${game}-${width}${reduced ? '-reduced' : ''}-${what}.jpg`;

async function loading() {
  const { context, page } = await open(async (p) => {
    await p.route('**/api/**', async (route) => {
      await new Promise((r) => setTimeout(r, 8000));
      await route.continue().catch(() => {});
    });
  });
  await page.goto(`${base}/reversi`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForSelector('.tx-loading', { timeout: 30000 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: join(outdir, name('reversi', 'loading')), type: 'jpeg', quality: 80 });
  await context.close();
}

async function math() {
  const { context, page } = await open();
  await page.goto(`${base}/math`, { waitUntil: 'networkidle', timeout: 120000 });
  await page.waitForTimeout(1000);
  await page.locator('.math-overlay').click({ position: { x: 150, y: 200 } });
  await page.waitForSelector('.arc-result-card', { timeout: 90000 });
  await page.waitForTimeout(3500);
  await page.getByRole('button', { name: 'Dismiss sign-up prompt' }).click({ timeout: 3000 }).catch(() => {});
  await page.evaluate(() => window.scrollBy(0, 150));
  await page.waitForTimeout(600);
  await page.screenshot({ path: join(outdir, name('math', 'end')), type: 'jpeg', quality: 80 });
  await context.close();
}

async function breakout() {
  const { context, page } = await open();
  await page.goto(`${base}/breakout`, { waitUntil: 'networkidle', timeout: 120000 });
  await page.waitForTimeout(1000);
  const canvas = page.locator('canvas').first();
  const box = await canvas.boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  let caught = false;
  for (let i = 0; i < 400 && !caught; i += 1) {
    const x = box.x + box.width * (0.15 + 0.7 * (0.5 + 0.5 * Math.sin(i / 6)));
    await page.mouse.move(x, box.y + box.height * 0.9);
    await page.mouse.click(x, box.y + box.height * 0.9);
    await page.waitForTimeout(40);
    if ((await page.evaluate(() => window.__plates)) > 0) {
      await page.waitForTimeout(110);
      await page.screenshot({ path: join(outdir, name('breakout', 'floater')), type: 'jpeg', quality: 80 });
      caught = true;
    }
  }
  console.log(caught ? 'breakout floater saved' : 'breakout: no floater');
  await context.close();
}

const todo = which.length ? which : ['loading', 'math', 'breakout'];
for (const t of todo) await { loading, math, breakout }[t]();
await browser.close();
