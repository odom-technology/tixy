#!/usr/bin/env node
/**
 * Screenshots a game's floating score at the moment it shows.
 *
 *   QA_BASE_URL=http://127.0.0.1:3223 node scripts/qa-floaters.mjs <2048|snake|tin-duck> <outdir> [prefix] [--width=1280|390] [--reduced] [--at=40] [--phase=0.3]
 *
 * 2048: plays until a merge scores. Snake: a guest run; the bot reads the
 * board off the canvas and steers to the first apple, then the shot is taken
 * `--at` ms after it is eaten (the popup is on the canvas, so there is no
 * element to wait for). Tin duck: fires at random points until a cork lands.
 * The 390 shots are touch contexts (hasTouch, isMobile). `--reduced` runs
 * with reducedMotion: 'reduce'.
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { chromium } from 'playwright';

const [game, outdir, prefix = 'after', ...flags] = process.argv.slice(2);
if (!game || !outdir) {
  console.error('usage: qa-floaters.mjs <2048|snake|tin-duck> <outdir> [prefix] [--width=1280] [--reduced] [--at=40] [--phase=0.3]');
  process.exit(1);
}
const flag = (name, fallback) => {
  const hit = flags.find((f) => f === `--${name}` || f.startsWith(`--${name}=`));
  if (!hit) return fallback;
  const [, value] = hit.split('=');
  return value ?? true;
};
const width = Number(flag('width', 1280));
const reduced = Boolean(flag('reduced', false));
const at = Number(flag('at', 40));
// DOM floaters are paused at this fraction of their animation so before and
// after show the same phase.
const phase = Number(flag('phase', 0.3));
const base = process.env.QA_BASE_URL ?? 'http://127.0.0.1:3000';
mkdirSync(outdir, { recursive: true });

const phone = width === 390;
const size = { width, height: phone ? 844 : 800 };
const browser = await chromium.launch({
  args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist'],
});
const context = await browser.newContext({
  viewport: size,
  deviceScaleFactor: phone ? 2 : 1,
  hasTouch: phone,
  isMobile: phone,
  reducedMotion: reduced ? 'reduce' : 'no-preference',
});
await context.addInitScript(() => {
  Object.defineProperty(navigator, 'webdriver', { get: () => false });
});
const page = await context.newPage();
const name = `${prefix}-${game}-${width}${reduced ? '-reduced' : ''}-floater`;
const out = join(outdir, `${name}.jpg`);

await page.goto(`${base}/${game}`, { waitUntil: 'networkidle', timeout: 120000 });
await page.waitForTimeout(1500);

let caught = false;
if (game === 'snake') caught = await playSnake();
else if (game === '2048') caught = await play2048();
else caught = await playTinDuck();
console.log(caught ? `saved ${out}` : 'no floater this time');
await context.close();
await browser.close();
process.exit(caught ? 0 : 2);

async function shot({ pause = false } = {}) {
  if (pause) {
    await page.evaluate((fraction) => {
      for (const anim of document.getAnimations()) {
        const target = anim.effect?.target;
        if (!(target instanceof Element) || !target.matches('.tile2048-float, .arc-floater, .td-pop')) continue;
        const duration = Number(anim.effect.getComputedTiming().duration) || 0;
        anim.pause();
        anim.currentTime = duration * fraction;
      }
    }, phase);
  }
  await page.waitForTimeout(at);
  await page.screenshot({ path: out, type: 'jpeg', quality: 80 });
}

async function play2048() {
  await page.locator('.arc-shell-screen').focus();
  const keys = ['ArrowDown', 'ArrowLeft', 'ArrowDown', 'ArrowRight'];
  const floater = '.tile2048-float, .arc-floater';
  for (let move = 0; move < 400; move += 1) {
    await page.keyboard.press(keys[move % keys.length]);
    await page.waitForTimeout(60);
    if ((await page.locator(floater).count()) > 0) {
      await shot({ pause: true });
      return true;
    }
  }
  return false;
}

async function playTinDuck() {
  await page.locator('.arc-shell-screen').focus();
  await page.keyboard.press('Space');
  await page.waitForFunction(() => document.querySelector('.arc-shell-stage')?.dataset.phase === 'playing', null, {
    timeout: 20000,
  });
  const box = await page.locator('.td-cross').locator('xpath=..').boundingBox();
  if (!box) return false;
  for (let i = 0; i < 160; i += 1) {
    // The ducks run along three rows in the upper two thirds of the gallery.
    const x = box.x + box.width * (0.08 + 0.84 * Math.random());
    const y = box.y + box.height * (0.28 + 0.4 * Math.random());
    await page.mouse.click(x, y);
    await page.waitForTimeout(110);
    const popped = await page.evaluate(() =>
      [...document.querySelectorAll('.td-pop')].some((el) => el.dataset.run === 'true' && el.textContent),
    );
    if (popped) {
      await shot({ pause: true });
      return true;
    }
  }
  return false;
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
  const isAmber = (board, x, y) => board.amber.some((cell) => cell.x === x && cell.y === y);
  for (let attempt = 0; attempt < 10; attempt += 1) {
    await page.locator('.arc-shell-screen').focus();
    await page.keyboard.press('ArrowRight');
    await page.waitForFunction(() => document.querySelector('.arc-shell-stage')?.dataset.phase === 'playing');
    await page.waitForTimeout(160);
    let head = { x: 4, y: 9 };
    let dir = 'ArrowRight';
    const food = (await readSnakeBoard())?.food ?? null;
    const started = Date.now();
    while (food && Date.now() - started < 12000) {
      const board = await readSnakeBoard();
      if (!board) break;
      if (await page.locator('.arc-shell-end').count()) break;
      const step = DIRS[dir];
      if (isAmber(board, head.x + step.x, head.y + step.y)) head = { x: head.x + step.x, y: head.y + step.y };
      const eaten = !board.food || board.food.x !== food.x || board.food.y !== food.y;
      if (eaten) {
        // Steer toward the middle so the run outlives the shot.
        const safe = dir === 'ArrowRight' || dir === 'ArrowLeft'
          ? head.y < 9 ? 'ArrowDown' : 'ArrowUp'
          : head.x < 9 ? 'ArrowRight' : 'ArrowLeft';
        await page.keyboard.press(safe);
        await shot();
        return true;
      }
      let want = dir;
      if (dir === 'ArrowRight' || dir === 'ArrowLeft') {
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
    await page.locator('.arc-shell-end').waitFor({ timeout: 15000 }).catch(() => undefined);
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(1200);
  }
  return false;
}
