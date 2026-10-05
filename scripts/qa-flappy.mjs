#!/usr/bin/env node
/**
 * Flappy bird QA harness: plays the real page with a bot inside it and takes
 * screenshots, a video, and frame times.
 *
 *   node scripts/qa-flappy.mjs --out=/tmp/flappy [--width=390 --height=844 --touch]
 *     [--reduced] [--cookie=<arcade_session>] [--video] [--throttle=4]
 *     [--target=12] [--runs=1] [--base=http://127.0.0.1:3216]
 *
 * The bot reads the run through the page's read-only ?flappyQa hook and
 * presses space (or taps, with --touch) like a player who aims for the gap's
 * middle. With --target it stops flapping at that score, so the run ends in
 * a crash into the next pipe. --throttle slows the CPU through CDP and
 * reports paint intervals.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const opts = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    return m ? [m[1], m[2] ?? true] : [a, true];
  }),
);
const base = opts.base ?? 'http://127.0.0.1:3216';
const out = opts.out ?? '/tmp/flappy-qa';
const width = Number(opts.width ?? 1280);
const height = Number(opts.height ?? 800);
const touch = Boolean(opts.touch);
const target = Number(opts.target ?? 12);
const runs = Number(opts.runs ?? 1);
const tag = opts.tag ?? `${width}`;
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH,
  // The score route's anti-cheat rejects a webdriver browser.
  args: ['--disable-blink-features=AutomationControlled'],
});
const context = await browser.newContext({
  viewport: { width, height },
  deviceScaleFactor: touch ? 3 : 1,
  hasTouch: touch,
  isMobile: touch,
  reducedMotion: opts.reduced ? 'reduce' : 'no-preference',
  ...(opts.video ? { recordVideo: { dir: out, size: { width, height } } } : {}),
});
if (opts.cookie) {
  await context.addCookies([{ name: 'arcade_session', value: String(opts.cookie), url: base, httpOnly: true, sameSite: 'Lax' }]);
}
await context.addInitScript("Object.defineProperty(navigator, 'webdriver', { get: () => false });");
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});

await page.goto(`${base}/flappy-bird?flappyQa=1`, { waitUntil: 'networkidle', timeout: 120000 });
await page.waitForTimeout(1200);
const shot = async (name) => {
  await page.screenshot({ path: path.join(out, `${tag}-${name}.jpg`), type: 'jpeg', quality: 80 });
};
await shot('ready');

let cdp = null;
if (opts.throttle) {
  cdp = await context.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: Number(opts.throttle) });
}

const stage = page.locator('.flappy-stage');
const box = await stage.boundingBox();
const press = async () => {
  if (touch && box) await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
  else await page.keyboard.press('Space');
};

const results = [];
for (let run = 0; run < runs; run += 1) {
  // The first press starts the run (and is its first flap).
  await press();
  await page.waitForFunction(() => window.__flappyQa?.().state === 'playing', null, { timeout: 15000 });
  await page.evaluate(() => window.__flappyQaPaints?.());
  // The bot runs inside the page on rAF, so it sees every frame.
  await page.evaluate(
    ({ target, touch }) => {
      const stageEl = document.querySelector('.flappy-stage');
      const frames = [];
      let last = 0;
      let lastPaint = 0;
      const flap = () => {
        if (touch && stageEl) {
          stageEl.dispatchEvent(new PointerEvent('pointerdown', { pointerType: 'touch', bubbles: true, cancelable: true, button: 0 }));
        } else {
          window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', key: ' ', bubbles: true, cancelable: true }));
        }
      };
      window.__flappyBot = { frames, done: false };
      const loop = (now) => {
        if (lastPaint) frames.push(now - lastPaint);
        lastPaint = now;
        const s = window.__flappyQa?.();
        if (!s || s.state !== 'playing' || s.dead) {
          if (s && s.state !== 'playing') {
            window.__flappyBot.done = true;
            return;
          }
          requestAnimationFrame(loop);
          return;
        }
        const pipe = s.pipes.find((p) => p.x + 60 > 80 - 12);
        const centre = pipe ? pipe.top + 75 : 300;
        if (s.score < target && s.y > centre + 20 && s.velocity > -1 && now - last > 110) {
          last = now;
          flap();
        }
        requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
    },
    { target, touch },
  );
  // Screenshots along the way: a pass, then the crash and the result.
  await page.waitForFunction(() => (window.__flappyQa?.().score ?? 0) >= 2, null, { timeout: 60000 }).catch(() => {});
  await shot(`run${run}-play`);
  await page.waitForFunction(() => window.__flappyQa?.().dead === true, null, { timeout: 240000 });
  await page.waitForTimeout(60);
  await shot(`run${run}-crash`);
  await page.waitForFunction(() => window.__flappyBot?.done === true, null, { timeout: 15000 });
  await page.waitForTimeout(1600);
  await shot(`run${run}-result`);
  const frames = await page.evaluate(() => window.__flappyBot.frames);
  const paints = (await page.evaluate(() => window.__flappyQaPaints?.() ?? [])).sort((a, b) => a - b);
  const paintAt = (p) => paints[Math.min(paints.length - 1, Math.floor(p * paints.length))]?.toFixed(2);
  const score = await page.evaluate(() => window.__flappyQa().score ?? null);
  const sorted = [...frames].sort((a, b) => a - b);
  const pct = (p) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]?.toFixed(1);
  const mean = frames.reduce((a, b) => a + b, 0) / Math.max(1, frames.length);
  results.push({ run, score, frames: frames.length, meanMs: +mean.toFixed(2), p50: pct(0.5), p95: pct(0.95), p99: pct(0.99), over20: frames.filter((f) => f > 20).length, paintP50: paintAt(0.5), paintP95: paintAt(0.95), paintMax: paints.length ? paints[paints.length - 1].toFixed(2) : null });
  if (run + 1 < runs) {
    await page.getByRole('button', { name: /rematch/i }).click();
    await page.waitForTimeout(500);
  }
}

if (cdp) await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
writeFileSync(path.join(out, `${tag}-frames.json`), JSON.stringify({ width, height, touch, throttle: opts.throttle ?? 1, results, errors }, null, 2));
console.log(JSON.stringify({ results, errors }, null, 2));
const video = page.video();
await context.close();
if (video) console.log('video', await video.path());
await browser.close();
