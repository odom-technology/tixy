#!/usr/bin/env node
/**
 * Plays snake or 2048 until the run passes your best, then screenshots the
 * new-best moment mid-game (and, with --video, records it).
 *
 *   QA_BASE_URL=http://127.0.0.1:3208 node scripts/qa-new-best.mjs <snake|2048> <outdir> [prefix] [--width=1280|390] [--video] [--best=N]
 *
 * Snake: a guest's best is 0, so the first apple is a new best. The bot reads
 * the board off the canvas (the apple is the brightest cell) and turns once
 * to meet it. 2048: --best=N answers the best-score request with N for this
 * browser only, so a short run passes it; the server is not touched.
 */
import { mkdirSync, renameSync } from 'node:fs';
import { join } from 'node:path';

import { chromium } from 'playwright';

const [game, outdir, prefix = 'after', ...flags] = process.argv.slice(2);
if (!game || !outdir) {
  console.error('usage: qa-new-best.mjs <snake|2048> <outdir> [prefix] [--width=1280] [--video] [--best=N]');
  process.exit(1);
}
const flag = (name, fallback) => {
  const hit = flags.find((f) => f.startsWith(`--${name}`));
  if (!hit) return fallback;
  const [, value] = hit.split('=');
  return value ?? true;
};
const width = Number(flag('width', 1280));
const video = Boolean(flag('video', false));
const fakeBest = flag('best', null);
const base = process.env.QA_BASE_URL ?? 'http://127.0.0.1:3000';
mkdirSync(outdir, { recursive: true });

const phone = width === 390;
const size = { width, height: phone ? 844 : 800 };
const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: size,
  deviceScaleFactor: phone ? 2 : 1,
  hasTouch: phone,
  isMobile: phone,
  ...(video ? { recordVideo: { dir: outdir, size } } : {}),
});
await context.addInitScript(() => {
  Object.defineProperty(navigator, 'webdriver', { get: () => false });
});
const page = await context.newPage();
const out = (shot) => join(outdir, `${prefix}-${game}-${width}-${shot}.jpg`);

if (fakeBest != null) {
  // Answer only the best-score read (GET); saves still go to the server.
  await page.route('**/api/games/2048/score', async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    await route.fulfill({ status: 200, json: { bestScore: Number(fakeBest) } });
  });
}

await page.goto(`${base}/${game}`, { waitUntil: 'networkidle', timeout: 120000 });
await page.waitForTimeout(1200);

let caught = false;
if (game === 'snake') caught = await playSnake();
else caught = await play2048();
console.log(caught ? 'new best caught' : 'no new best this time');

const videoPath = video ? await page.video()?.path() : null;
await context.close();
await browser.close();
if (videoPath) {
  const target = join(outdir, `${prefix}-${game}-${width}-new-best.webm`);
  renameSync(videoPath, target);
  console.log('saved', target);
}
process.exit(caught ? 0 : 2);

async function shotWhenCalloutShows(label) {
  const callout = page.locator('.arc-game-callout[data-tone="best"]');
  try {
    await callout.first().waitFor({ state: 'attached', timeout: 2500 });
  } catch {
    return false;
  }
  await page.waitForTimeout(Number(flag('at', 160)));
  await page.screenshot({ path: out(`${label}`), type: 'jpeg', quality: 80 });
  console.log('saved', out(label));
  await page.waitForTimeout(1600);
  return true;
}

async function readSnakeBoard() {
  return page.evaluate(() => {
    const canvas = document.querySelector('.arc-shell-screen canvas');
    if (!(canvas instanceof HTMLCanvasElement)) return null;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    const n = 18;
    const cw = canvas.width / n;
    const ch = canvas.height / n;
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let food = null;
    let foodScore = 0;
    const amber = [];
    for (let y = 0; y < n; y += 1) {
      for (let x = 0; x < n; x += 1) {
        const px = Math.floor((x + 0.5) * cw);
        const py = Math.floor((y + 0.5) * ch);
        const i = (py * canvas.width + px) * 4;
        const [r, g, b] = [data[i], data[i + 1], data[i + 2]];
        const bright = r + g + b;
        if (r > 200 && g > 190 && b > 170 && bright > foodScore) {
          foodScore = bright;
          food = { x, y };
        }
        if (r > 200 && g > 120 && g < 210 && b < 140) amber.push({ x, y });
      }
    }
    return { food, amber };
  });
}

async function playSnake() {
  const DIRS = {
    ArrowRight: { x: 1, y: 0 },
    ArrowLeft: { x: -1, y: 0 },
    ArrowUp: { x: 0, y: -1 },
    ArrowDown: { x: 0, y: 1 },
  };
  const horizontalDir = (d) => d === 'ArrowRight' || d === 'ArrowLeft';
  const isAmber = (board, x, y) => board.amber.some((cell) => cell.x === x && cell.y === y);
  for (let attempt = 0; attempt < 10; attempt += 1) {
    await page.locator('.arc-shell-screen').focus();
    await page.keyboard.press('ArrowRight');
    // The run deals its own apple once the session is up.
    await page.waitForFunction(() => document.querySelector('.arc-shell-stage')?.dataset.phase === 'playing');
    await page.waitForTimeout(160);
    let head = { x: 4, y: 9 };
    let dir = 'ArrowRight';
    let food = (await readSnakeBoard())?.food ?? null;
    const started = Date.now();
    while (food && Date.now() - started < 12000) {
      const board = await readSnakeBoard();
      if (!board) break;
      if (await page.locator('.arc-shell-end').count()) break;
      // Follow the head one cell at a time.
      const step = DIRS[dir];
      if (isAmber(board, head.x + step.x, head.y + step.y)) head = { x: head.x + step.x, y: head.y + step.y };
      const eaten = !board.food || board.food.x !== food.x || board.food.y !== food.y;
      if (eaten) {
        // Steer toward the middle so the run outlives the moment.
        const safe = horizontalDir(dir)
          ? head.y < 9 ? 'ArrowDown' : 'ArrowUp'
          : head.x < 9 ? 'ArrowRight' : 'ArrowLeft';
        await page.keyboard.press(safe);
        return shotWhenCalloutShows('new-best');
      }
      let want = dir;
      const horizontal = dir === 'ArrowRight' || dir === 'ArrowLeft';
      if (horizontal) {
        const ahead = (food.x - head.x) * DIRS[dir].x;
        if (food.x === head.x || ahead < 0) want = food.y < head.y ? 'ArrowUp' : 'ArrowDown';
        if (food.x === head.x && food.y === head.y) want = dir;
      } else {
        const ahead = (food.y - head.y) * DIRS[dir].y;
        if (food.y === head.y || ahead < 0) want = food.x < head.x ? 'ArrowLeft' : 'ArrowRight';
      }
      if (want !== dir) {
        await page.keyboard.press(want);
        dir = want;
      }
      await page.waitForTimeout(20);
    }
    // Missed: wait for the result and go again.
    await page.locator('.arc-shell-end').waitFor({ timeout: 15000 }).catch(() => undefined);
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(1200);
  }
  return false;
}

async function play2048() {
  await page.locator('.arc-shell-screen').focus();
  const keys = ['ArrowDown', 'ArrowLeft', 'ArrowDown', 'ArrowRight'];
  for (let move = 0; move < 400; move += 1) {
    await page.keyboard.press(keys[move % keys.length]);
    await page.waitForTimeout(130);
    if ((await page.locator('.arc-game-callout[data-tone="best"]').count()) > 0) {
      await page.waitForTimeout(Number(flag('at', 160)) - 130);
      await page.screenshot({ path: out('new-best'), type: 'jpeg', quality: 80 });
      console.log('saved', out('new-best'));
      await page.waitForTimeout(1600);
      return true;
    }
    if (move === 12) {
      await page.screenshot({ path: out('play'), type: 'jpeg', quality: 80 });
      console.log('saved', out('play'));
    }
  }
  return false;
}
