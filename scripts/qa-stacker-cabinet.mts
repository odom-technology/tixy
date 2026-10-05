/**
 * Stacker cabinet browser QA: plays one run with real input to a chosen row
 * and reports what the player and the server saw.
 *
 *   npx tsx scripts/qa-stacker-cabinet.mts [--mobile] [--signed] [--reduced]
 *     [--rows=11] [--hz=120] [--video] [--strip] [--theme=tixy|boardwalk]
 *     [--out=/tmp/stacker-qa] [--base=http://127.0.0.1:3118]
 *
 * --rows is where the run ends: it aims every stop at the row below until
 * that many rows are placed, then misses on purpose (15 ends on the major).
 * --video records the page (Playwright's recorder, 25 fps). --strip saves a
 * frame after every stop. --hz drives the headless shell frame by frame
 * over CDP at that rate (no video then), with a stall of 3 to 8 frames now
 * and then, and reports the rate reached. --frames=a-b (with --hz) saves
 * every frame while rows a to b move and builds a video at that rate.
 * --throttle slows the CPU through CDP.
 *
 * The page logs every frame's drawn row under ?arcadePerf=1; the report
 * counts frames where the row didn't move while it should have (steps),
 * stalled frames (hitches), and the furthest the drawn row ever was from
 * the lamp a stop at that moment lights (at most half a lamp).
 * Needs a dev or production server and Playwright's Chromium.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';

import { chromium, type Page } from 'playwright';

import {
  STACKER_COLUMNS,
  STACKER_ROW_RULES,
  stackerLayout,
  stackerLeftAfter,
  stackerRowStart,
  stackerState,
  type StackerLayout,
} from '../src/server/arcade/stack-cabinet-engine';

const args = Object.fromEntries(
  process.argv.slice(2).map((arg) => {
    const match = arg.match(/^--([^=]+)(?:=(.*))?$/);
    return match ? [match[1], match[2] ?? 'true'] : [arg, 'true'];
  }),
) as Record<string, string>;

const base = args.base ?? 'http://127.0.0.1:3118';
const mobile = args.mobile === 'true';
const signed = args.signed === 'true';
const reduced = args.reduced === 'true';
const video = args.video === 'true';
const strip = args.strip === 'true';
const theme = args.theme ?? 'tixy';
const hz = args.hz ? Number(args.hz) : null;
const throttle = args.throttle ? Number(args.throttle) : 1;
const frameWindow = args.frames ? args.frames.split('-').map(Number) : null;
const targetRows = Math.max(1, Math.min(15, Number(args.rows ?? 11)));
const out = args.out ?? '/tmp/stacker-qa';
const tag = [mobile ? '390' : '1280', theme, signed ? 'signed' : 'guest', reduced ? 'reduced' : '', hz ? `${hz}hz` : '', throttle > 1 ? `x${throttle}` : '', `row${targetRows}`]
  .filter(Boolean)
  .join('-');
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH,
  // Without AutomationControlled off, the anti-cheat's webdriver check
  // rejects every QA run.
  args: [
    '--disable-blink-features=AutomationControlled',
    ...(hz ? ['--enable-begin-frame-control', '--run-all-compositor-stages-before-draw'] : []),
  ],
});
const viewport = mobile ? { width: 390, height: 844 } : { width: 1280, height: 800 };
const videoDir = `${out}/video-${tag}`;
const context = await browser.newContext({
  viewport,
  deviceScaleFactor: mobile ? 2 : 1,
  hasTouch: mobile,
  isMobile: mobile,
  reducedMotion: reduced ? 'reduce' : 'no-preference',
  ...(video && !hz ? { recordVideo: { dir: videoDir, size: viewport } } : {}),
});
const page = await context.newPage();
let framesRunning = Boolean(hz);
const cdp = await context.newCDPSession(page);
let captureRow = -1;
let savedFrames = 0;
const frameDir = `${out}/frames-${tag}`;
if (hz) {
  const interval = 1000 / hz;
  if (frameWindow) mkdirSync(frameDir, { recursive: true });
  let seed = 7;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  void (async () => {
    let next = performance.now();
    while (framesRunning) {
      // A stall of 3 to 8 frames about every 1.5 s, like a busy phone.
      const stall = rand() < interval / 1500 ? 3 + Math.floor(rand() * 6) : 0;
      next += interval * (1 + stall);
      const capture = frameWindow !== null && captureRow >= frameWindow[0] && captureRow <= frameWindow[1];
      const result = (await cdp
        .send('HeadlessExperimental.beginFrame', {
          interval,
          ...(capture ? { screenshot: { format: 'jpeg', quality: 80 } } : {}),
        })
        .catch(() => null)) as { screenshotData?: string } | null;
      if (capture && result?.screenshotData) {
        savedFrames += 1;
        writeFileSync(`${frameDir}/f${String(savedFrames).padStart(5, '0')}.jpg`, Buffer.from(result.screenshotData, 'base64'));
      }
      const wait = next - performance.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    }
  })();
}
if (throttle > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle });
const errors: string[] = [];
page.on('pageerror', (error) => errors.push(error.message));
page.on('console', (message) => {
  if (message.type() === 'error' && !/401|Unauthorized/.test(message.text())) errors.push(message.text().slice(0, 200));
});

if (signed) {
  const name = `stk${Date.now().toString(36)}`;
  const register = await page.request.post(`${base}/api/account/register`, {
    data: { email: `${name}@example.test`, password: `pw-${name}-Aa1!`, username: name },
  });
  if (!register.ok()) throw new Error(`register ${register.status()} ${await register.text()}`);
  const settings = await page.request.put(`${base}/api/account/data`, {
    data: { key: 'settings', value: { arcadeTheme: theme } },
  });
  if (!settings.ok()) throw new Error(`settings ${settings.status()}`);
}

let scoreResponse: unknown = null;
let scoreBody: string | null = null;
page.on('response', async (response) => {
  if (response.url().includes('/api/games/stack-cabinet/score') && response.request().method() === 'POST') {
    scoreBody = response.request().postData();
    scoreResponse = { status: response.status(), body: await response.json().catch(() => null) };
  }
});

await page.goto(`${base}/stack?arcadePerf=1`, { waitUntil: 'networkidle', timeout: 180_000 });
if (!signed) await page.evaluate((t) => document.documentElement.setAttribute('data-arcade-theme', t), theme);
await page.addStyleTag({ content: '.fixed.z-\\[200\\] { display: none !important; }' });
await page.waitForTimeout(1200);
await page.screenshot({ path: `${out}/ready-${tag}.jpg`, type: 'jpeg', quality: 80 });

const rafRate = (await page.evaluate(`new Promise((resolve) => {
  let frames = 0;
  const startAt = performance.now();
  const step = () => {
    frames += 1;
    if (performance.now() - startAt < 1000) requestAnimationFrame(step);
    else resolve(frames / ((performance.now() - startAt) / 1000));
  };
  requestAnimationFrame(step);
})`)) as number;

const screen = page.locator('.arc-shell-screen');
const box = (await screen.boundingBox())!;
const press = async () => {
  const x = box.x + box.width / 2;
  const y = box.y + box.height * 0.5;
  if (mobile) await page.touchscreen.tap(x, y);
  else await page.mouse.click(x, y);
};

async function clockOffset(p: Page) {
  let best = { offset: 0, rtt: Infinity };
  for (let i = 0; i < 8; i += 1) {
    const before = performance.now();
    const pageNow = await p.evaluate(() => performance.now());
    const after = performance.now();
    if (after - before < best.rtt) best = { offset: pageNow - (before + after) / 2, rtt: after - before };
  }
  return best;
}

/** When to stop row `index` so it lands where we want: on the row below, or
 *  (for the miss) clear of it. The first pass at least 400 ms in. */
function aimFor(layout: StackerLayout, stops: number[], index: number, miss: boolean): number {
  const state = stackerState(layout, stops);
  const rule = STACKER_ROW_RULES[index];
  const w = state.width;
  const below = state.tower[state.tower.length - 1] ?? { left: 0, width: STACKER_COLUMNS };
  const ok = (left: number) => {
    const overlap = Math.min(left + w, below.left + below.width) - Math.max(left, below.left);
    return miss ? overlap <= 0 : overlap === w;
  };
  let k = Math.ceil(400 / rule.stepMs);
  while (!ok(stackerLeftAfter(k, w, layout.dirs[index]))) k += 1;
  return stackerRowStart(stops, index) + k * rule.stepMs + rule.stepMs / 2;
}

await press();
await page.waitForFunction(() => Boolean(window.__stackerRun), null, { timeout: 15_000 });
const run = (await page.evaluate(() => ({ runStart: window.__stackerRun!.runStart, seed: window.__stackerRun!.seed })))!;
const layout = stackerLayout(run.seed);
const { offset, rtt } = await clockOffset(page);
const scrollYs: number[] = [];

const stops: number[] = [];
const lastRow = targetRows >= 15 ? 15 : targetRows + 1;
for (let i = 0; i < lastRow; i += 1) {
  const miss = i === targetRows;
  captureRow = i + 1;
  const target = aimFor(layout, stops, i, miss);
  const wait = run.runStart + target - offset - performance.now() - rtt / 2;
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  await press();
  // The client's own stop times decide when the next row starts.
  await page.waitForFunction((n) => (window.__stackerRun?.stops().length ?? 0) > n, i, { timeout: 5000 });
  const actual = await page.evaluate(() => window.__stackerRun!.stops());
  stops.splice(0, stops.length, ...actual);
  scrollYs.push(await page.evaluate(() => window.scrollY));
  if (strip) {
    await page.waitForTimeout(90);
    await page.screenshot({ path: `${out}/strip-${tag}-${String(i + 1).padStart(2, '0')}.jpg`, type: 'jpeg', quality: 80 });
  }
}

await page.waitForTimeout(4500);
await page.screenshot({ path: `${out}/result-${tag}.jpg`, type: 'jpeg', quality: 80 });
const resultText = await page.locator('.arc-shell-end').innerText().catch(() => '');
const rematchFirst = await page.$$eval('.arc-shell-end button', (buttons) => buttons[0]?.textContent?.trim() ?? '');
const state = stackerState(layout, stops);

// Pays once: send the same run again; the route must refuse it and the
// balance must not move.
let resubmit: unknown = null;
if (signed && scoreBody) {
  const balance = async () =>
    ((await (await page.request.get(`${base}/api/store/inventory?gameType=stack`)).json()) as { wallet?: { credits?: number } }).wallet?.credits ?? null;
  const before = await balance();
  const again = await page.request.post(`${base}/api/games/stack-cabinet/score`, { data: JSON.parse(scoreBody), headers: { 'Content-Type': 'application/json' } });
  resubmit = { status: again.status(), body: (await again.text()).slice(0, 160), balanceBefore: before, balanceAfter: await balance() };
}

// Smoothness, from the page's own frame log: [time, runMs, row, drawn, lamp].
const frames = (await page.evaluate(() => (window as unknown as { __stackerFrames?: number[][] }).__stackerFrames ?? [])) as number[][];
const intervals: number[] = [];
for (let k = 1; k < frames.length; k += 1) intervals.push(frames[k][0] - frames[k - 1][0]);
const sortedIntervals = [...intervals].sort((a, b) => a - b);
const medianInterval = sortedIntervals[Math.floor(sortedIntervals.length / 2)] ?? 16.7;
let steps = 0;
let hitches = 0;
let farthest = 0;
for (let k = 0; k < frames.length; k += 1) {
  farthest = Math.max(farthest, Math.abs(frames[k][3] - frames[k][4]));
  if (k === 0 || frames[k - 1][2] !== frames[k][2]) continue;
  // Run time moved on between these frames but the drawn row didn't (away
  // from the first half step at the wall, where it waits): a step.
  const waiting = frames[k][3] === frames[k - 1][3] && Number.isInteger(frames[k][3]);
  if (frames[k][1] - frames[k - 1][1] > 2 && Math.abs(frames[k][3] - frames[k - 1][3]) < 1e-6 && !waiting) steps += 1;
  if (frames[k][0] - frames[k - 1][0] > medianInterval * 1.5) hitches += 1;
}
const pctInterval = (p: number) => sortedIntervals[Math.min(sortedIntervals.length - 1, Math.floor(p * sortedIntervals.length))] ?? 0;
const smooth = {
  count: frames.length,
  medianMs: Math.round(medianInterval * 100) / 100,
  p95Ms: Math.round(pctInterval(0.95) * 100) / 100,
  p99Ms: Math.round(pctInterval(0.99) * 100) / 100,
  maxMs: Math.round((sortedIntervals[sortedIntervals.length - 1] ?? 0) * 100) / 100,
  over20ms: intervals.filter((x) => x > 20).length,
  hitches,
  steps,
  farthestFromLampLamps: Math.round(farthest * 1000) / 1000,
};

console.log(
  JSON.stringify(
    {
      tag,
      rafRate: Math.round(rafRate),
      seed: run.seed,
      clockRttMs: Math.round(rtt * 10) / 10,
      stops,
      rows: state.rows,
      perfects: state.perfects,
      frames: smooth,
      scrollYs: [...new Set(scrollYs)],
      resultText: resultText.replace(/\s+/g, ' ').slice(0, 300),
      score: scoreResponse,
      resubmit,
      rematchFirst,
      errors,
    },
    null,
    2,
  ),
);
framesRunning = false;
if (throttle > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 }).catch(() => {});
await context.close();
if (hz && frameWindow && savedFrames > 0) {
  // Every frame, at the rate it was driven, and a 4x slow copy to watch.
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(hz), '-i', `${frameDir}/f%05d.jpg`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', `${out}/frames-${tag}.mp4`]);
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(hz / 4), '-i', `${frameDir}/f%05d.jpg`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-r', '30', `${out}/frames-${tag}-slow.mp4`]);
}
if (video && !hz) {
  const file = readdirSync(videoDir).find((name) => name.endsWith('.webm'));
  if (file) renameSync(`${videoDir}/${file}`, `${out}/run-${tag}.webm`);
}
await browser.close();
