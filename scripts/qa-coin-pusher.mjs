#!/usr/bin/env node
/**
 * Coin pusher QA: screenshots, a play-through video and frame times.
 *
 *   node scripts/qa-coin-pusher.mjs shots  <outdir>     1280 and 390 screenshots after a few drops
 *   node scripts/qa-coin-pusher.mjs video  <outdir>     a 390 x 844 touch play-through, recorded
 *   node scripts/qa-coin-pusher.mjs perf   <outdir>     ?arcadePerf=1 at 390, CPU throttled 4x
 *
 * QA_GL=swiftshader renders with SwiftShader instead of llvmpipe.
 * QA_BASE_URL defaults to http://127.0.0.1:3243. QA_COOKIE signs in as that
 * arcade_session. QA_REDUCED=1 sets reduced motion.
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';

import { chromium } from 'playwright';

const [mode = 'shots', outdir = '/tmp/gcp-qa'] = process.argv.slice(2);
const base = process.env.QA_BASE_URL ?? 'http://127.0.0.1:3243';
mkdirSync(outdir, { recursive: true });

// llvmpipe (Mesa, multi-threaded) holds 60 fps here where SwiftShader gets
// about 20, so the video shows the real motion. QA_GL=swiftshader for the old path.
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
  if (process.env.QA_COOKIE) {
    await context.addCookies([{ name: 'arcade_session', value: process.env.QA_COOKIE, url: base, httpOnly: true, sameSite: 'Lax' }]);
  }
  const page = await context.newPage();
  page.on('console', (msg) => {
    if (msg.type() === 'error' || msg.type() === 'warning') console.log(`[${msg.type()}]`, msg.text().slice(0, 300));
  });
  page.on('pageerror', (err) => console.log('[pageerror]', err.message));
  await page.goto(`${base}/coin-pusher${extra.query ?? ''}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForSelector('.cp-canvas', { timeout: 60000 });
  await page.waitForTimeout(2500);
  return { context, page };
}

async function tapAt(page, fx, fy, touch) {
  const box = await page.locator('.cp-stage').boundingBox();
  const x = box.x + box.width * fx;
  const y = box.y + box.height * fy;
  if (touch) await page.touchscreen.tap(x, y);
  else {
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.up();
  }
}

if (mode === 'shots') {
  for (const [name, viewport, touch] of [
    ['1280', { width: 1280, height: 800 }, false],
    ['390', { width: 390, height: 844 }, true],
  ]) {
    const { context, page } = await open(viewport, { touch, dpr: 2 });
    await page.screenshot({ path: path.join(outdir, `coin-pusher-${name}-idle.png`) });
    for (let i = 0; i < 8; i++) {
      await tapAt(page, 0.2 + i * 0.08, 0.45, touch);
      await page.waitForTimeout(260);
    }
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(outdir, `coin-pusher-${name}-drops.png`) });
    await page.waitForTimeout(3000);
    await page.screenshot({ path: path.join(outdir, `coin-pusher-${name}-after.png`) });
    await context.close();
  }
}

if (mode === 'video') {
  const viewport = { width: 390, height: 844 };
  const { context, page } = await open(viewport, { touch: true, video: true });
  // A steady player: single coins, timed across the width.
  for (let i = 0; i < 14; i++) {
    await tapAt(page, 0.3 + ((i * 0.13) % 0.4), 0.42, true);
    await page.waitForTimeout(420);
  }
  await page.waitForTimeout(2500);
  await context.close();
  console.log('video saved in', outdir);
}

if (mode === 'perf') {
  const viewport = { width: 390, height: 844 };
  const { context, page } = await open(viewport, { touch: true, query: '?arcadePerf=1' });
  const cdp = await context.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  // Frame deltas from rAF over a window with coins falling.
  const sample = async (label, act) => {
    await page.evaluate(() => {
      window.__cpFrames = [];
      let last = performance.now();
      const tick = (t) => {
        window.__cpFrames.push(t - last);
        last = t;
        if (window.__cpFrames.length < 600) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    if (act) await act();
    await page.waitForTimeout(6000);
    const frames = await page.evaluate(() => window.__cpFrames.slice(5));
    frames.sort((a, b) => a - b);
    const q = (p) => frames[Math.min(frames.length - 1, Math.floor(frames.length * p))].toFixed(1);
    console.log(`${label}: ${frames.length} frames, p50 ${q(0.5)} ms, p90 ${q(0.9)} ms, p99 ${q(0.99)} ms`);
  };
  await sample('idle (shelves moving)');
  await sample('pouring', async () => {
    for (let i = 0; i < 10; i++) {
      await tapAt(page, 0.25 + i * 0.05, 0.42, true);
      await page.waitForTimeout(150);
    }
  });
  const marks = await page.evaluate(() =>
    performance.getEntriesByType('measure').filter((m) => /coin-pusher|arcade:quality/.test(m.name)).map((m) => `${m.name} ${m.duration.toFixed(0)}ms ${JSON.stringify(m.detail ?? '')}`),
  );
  console.log(marks.join('\n'));
  await page.screenshot({ path: path.join(outdir, 'coin-pusher-perf.png') });
  await context.close();
}

await browser.close();
