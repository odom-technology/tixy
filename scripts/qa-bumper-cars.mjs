#!/usr/bin/env node
/**
 * Bumper cars QA: screenshots, a recorded practice round and frame times.
 *
 *   node scripts/qa-bumper-cars.mjs shots  <outdir>   1280 and 390, before and during a round
 *   node scripts/qa-bumper-cars.mjs video  <outdir>   390 x 844 touch, a player dragging, recorded
 *   node scripts/qa-bumper-cars.mjs perf   <outdir>   ?arcadePerf=1 at 390, CPU throttled 4x, 8 cars
 *   node scripts/qa-bumper-cars.mjs frames <outdir>   PNG frames every 50 ms around the first bumps
 *
 * QA_BASE_URL defaults to http://127.0.0.1:3246. QA_GL=swiftshader renders
 * with SwiftShader. QA_REDUCED=1 sets reduced motion. QA_SECONDS sets how
 * long the video runs (default 30; 100 plays a whole round).
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';

import { chromium } from 'playwright';

const [mode = 'shots', outdir = '/tmp/gbc-qa'] = process.argv.slice(2);
const base = process.env.QA_BASE_URL ?? 'http://127.0.0.1:3246';
mkdirSync(outdir, { recursive: true });

const browser = await chromium.launch({
  args:
    process.env.QA_GL === 'swiftshader'
      ? ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist']
      : ['--use-angle=gl-egl', '--ignore-gpu-blocklist'],
});

async function open(viewport, extra = {}) {
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: extra.dpr ?? 1,
    hasTouch: extra.touch ?? false,
    isMobile: extra.touch ?? false,
    reducedMotion: process.env.QA_REDUCED ? 'reduce' : 'no-preference',
    recordVideo: extra.video ? { dir: outdir, size: viewport } : undefined,
  });
  const page = await context.newPage();
  page.on('console', (msg) => {
    if (msg.type() === 'error' || msg.type() === 'warning') console.log(`[${msg.type()}]`, msg.text().slice(0, 300));
  });
  page.on('pageerror', (err) => console.log('[pageerror]', err.message));
  await page.goto(`${base}/bumper-cars${extra.query ?? ''}`, { waitUntil: 'domcontentloaded', timeout: 180000 });
  await page.waitForSelector('.bc-field canvas', { timeout: 120000 });
  await page.waitForFunction(() => !document.body.innerText.includes('Loading the rink.'), null, { timeout: 60000 });
  await page.waitForTimeout(1500);
  return { context, page };
}

async function field(page) {
  return page.locator('.bc-field').boundingBox();
}

/** Start a practice round with a tap in the middle. */
async function getIn(page, touch) {
  const box = await field(page);
  const x = box.x + box.width / 2;
  const y = box.y + box.height * 0.6;
  if (touch) await page.touchscreen.tap(x, y);
  else await page.mouse.click(x, y);
}

/** A player's drag: hold the stick in a direction that wanders. Mouse drags
 *  drive the same stick a finger does. */
async function drive(page, seconds, seed = 1) {
  const box = await field(page);
  const ox = box.x + box.width / 2;
  const oy = box.y + box.height * 0.72;
  let s = seed;
  const rand = () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
  await page.mouse.move(ox, oy);
  await page.mouse.down();
  const end = Date.now() + seconds * 1000;
  let angle = -Math.PI / 2;
  while (Date.now() < end) {
    angle += (rand() - 0.5) * 1.6;
    const r = 40 + rand() * 30;
    const steps = 4;
    for (let i = 1; i <= steps; i += 1) {
      await page.mouse.move(ox + Math.cos(angle) * r * (i / steps), oy + Math.sin(angle) * r * (i / steps));
      await page.waitForTimeout(40);
    }
    await page.waitForTimeout(500 + rand() * 900);
  }
  await page.mouse.up();
}

if (mode === 'shots') {
  for (const [name, viewport, touch] of [
    ['1280', { width: 1280, height: 800 }, false],
    ['390', { width: 390, height: 844 }, true],
  ]) {
    const { context, page } = await open(viewport, { touch, dpr: 2, query: '?bumperAutopilot=1&bumperSeed=7' });
    await page.screenshot({ path: path.join(outdir, `bumper-cars-${name}-ready.png`) });
    await getIn(page, touch);
    await page.waitForTimeout(1200);
    await page.screenshot({ path: path.join(outdir, `bumper-cars-${name}-countdown.png`) });
    await page.waitForTimeout(9000);
    await page.screenshot({ path: path.join(outdir, `bumper-cars-${name}-round.png`) });
    await context.close();
  }
}

if (mode === 'video') {
  const seconds = Number(process.env.QA_SECONDS ?? 30);
  const { context, page } = await open({ width: 390, height: 844 }, { touch: true, video: true, query: '?bumperSeed=11' });
  await getIn(page, true);
  await page.waitForTimeout(3200);
  await drive(page, seconds, 3);
  await page.waitForTimeout(seconds >= 95 ? 6000 : 500);
  await page.screenshot({ path: path.join(outdir, 'bumper-cars-video-end.png') });
  await context.close();
  console.log('video saved in', outdir);
}

if (mode === 'frames') {
  const { context, page } = await open({ width: 390, height: 844 }, { touch: true, query: '?bumperSeed=11&bumperAutopilot=1' });
  await getIn(page, true);
  await page.waitForTimeout(3600);
  for (let i = 0; i < 60; i += 1) {
    await page.screenshot({ path: path.join(outdir, `frame-${String(i).padStart(3, '0')}.png`) });
    await page.waitForTimeout(50);
  }
  await context.close();
}

if (mode === 'perf') {
  const { context, page } = await open({ width: 390, height: 844 }, { touch: true, query: `?arcadePerf=1&bumperAutopilot=1&bumperSeed=5${process.env.QA_TIER ? `&midwayTier=${process.env.QA_TIER}` : ''}` });
  const cdp = await context.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  const sample = async (label) => {
    await page.evaluate(() => {
      window.__bcFrames = [];
      let last = performance.now();
      const tick = (t) => {
        window.__bcFrames.push(t - last);
        last = t;
        if (window.__bcFrames.length < 900) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    await page.waitForTimeout(8000);
    const frames = await page.evaluate(() => window.__bcFrames.slice(5));
    frames.sort((a, b) => a - b);
    const q = (p) => frames[Math.min(frames.length - 1, Math.floor(frames.length * p))].toFixed(1);
    const info = await page.evaluate(() => window.__bumperInfo?.());
    console.log(`${label}: ${frames.length} frames, p50 ${q(0.5)} ms, p90 ${q(0.9)} ms, p99 ${q(0.99)} ms, ${JSON.stringify(info)}`);
  };
  await sample('idle rink');
  await getIn(page, true);
  await page.waitForTimeout(3500);
  await sample('8 cars driving');
  await sample('8 cars driving, later');
  const marks = await page.evaluate(() =>
    performance.getEntriesByType('measure').filter((m) => /bumper-cars|arcade:quality/.test(m.name)).map((m) => `${m.name} ${m.duration.toFixed(0)}ms ${JSON.stringify(m.detail ?? '')}`),
  );
  console.log(marks.join('\n'));
  await page.screenshot({ path: path.join(outdir, 'bumper-cars-perf.png') });
  await context.close();
}

await browser.close();
