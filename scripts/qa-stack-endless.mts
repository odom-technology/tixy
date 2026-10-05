/**
 * Stacker endless browser QA: plays one run with real input, aiming every
 * drop with the shared rules, and reports what the player and the server saw,
 * plus how smoothly the moving block was drawn.
 *
 *   npx tsx scripts/qa-stack-endless.mts [--mobile] [--signed] [--reduced]
 *     [--rows=70] [--sigma=10] [--px=0] [--video] [--hz=120] [--frames=40-44]
 *     [--throttle=4] [--out=/tmp/stack-qa] [--base=http://127.0.0.1:3215]
 *
 * --rows is where the run ends: it aims at the tower until that many blocks
 * are placed, then drops clear of it. --sigma is the aim's timing error in ms
 * (normal), and --px an error in where the eye puts the block (normal, px,
 * the same model as the verifier), so some drops cut. --video records the page (Playwright, 25 fps).
 * --hz drives the headless shell frame by frame over CDP at that rate, with a
 * stall of 3 to 8 frames now and then; --frames=a-b (with --hz) also saves
 * every frame while the tower is between heights a and b, and builds a video
 * at that rate. --throttle slows the CPU through CDP.
 *
 * The page logs every frame's drawn block under ?arcadePerf=1; the report
 * says how far each frame moved against where the rules put the block at
 * that frame's time, so a step or a hitch shows as a number.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';

import { chromium, type Page } from 'playwright';

import {
  STACK_BAND,
  STACK_SWEEP_LEFT,
  createStackRun,
  stackAimElapsedMs,
  stackDropAt,
  stackMoverLeft,
  stackMoverWidth,
  stackRow,
  type StackRunState,
} from '../src/server/arcade/stack-replay';

const args = Object.fromEntries(
  process.argv.slice(2).map((arg) => {
    const match = arg.match(/^--([^=]+)(?:=(.*))?$/);
    return match ? [match[1], match[2] ?? 'true'] : [arg, 'true'];
  }),
) as Record<string, string>;

const base = args.base ?? 'http://127.0.0.1:3215';
const mobile = args.mobile === 'true';
const signed = args.signed === 'true';
const reduced = args.reduced === 'true';
const video = args.video === 'true';
const hz = args.hz ? Number(args.hz) : null;
const throttle = args.throttle ? Number(args.throttle) : 1;
const targetRows = Math.max(1, Number(args.rows ?? 40));
const sigma = Number(args.sigma ?? 8);
const eyePx = Number(args.px ?? 0);
const frameWindow = args.frames ? args.frames.split('-').map(Number) : null;
const out = args.out ?? '/tmp/stack-qa';
const tag = [
  mobile ? '390' : '1280',
  signed ? 'signed' : 'guest',
  reduced ? 'reduced' : '',
  hz ? `${hz}hz` : '',
  throttle > 1 ? `x${throttle}` : '',
  `h${targetRows}`,
]
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
const cdp = await context.newCDPSession(page);

// Frame driving: a steady rate, with a stall of 3 to 8 frames about every
// 1.5 s, so the run sees the hitches a busy phone has.
let framesRunning = Boolean(hz);
let captureHeight = -1;
const frameDir = `${out}/frames-${tag}`;
let savedFrames = 0;
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
      const stall = rand() < interval / 1500 ? 3 + Math.floor(rand() * 6) : 0;
      next += interval * (1 + stall);
      const capture =
        frameWindow !== null && captureHeight >= frameWindow[0] && captureHeight < frameWindow[1];
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
}

const scoreResponses: unknown[] = [];
let scoreBody: string | null = null;
page.on('response', async (response) => {
  if (response.url().includes('/api/games/stack/score') && response.request().method() === 'POST') {
    scoreBody = response.request().postData();
    scoreResponses.push({ status: response.status(), body: await response.json().catch(() => null) });
  }
});

await page.goto(`${base}/stack?mode=endless&arcadePerf=1`, { waitUntil: 'networkidle', timeout: 180_000 });
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
  const y = box.y + box.height * 0.55;
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

type TestHook = { sim: StackRunState; drops: number[]; startedAt: number; state: string; rules: number };
const hook = () => page.evaluate(() => (window as unknown as { __stackTest: TestHook }).__stackTest && {
  sim: (window as unknown as { __stackTest: TestHook }).__stackTest.sim,
  drops: (window as unknown as { __stackTest: TestHook }).__stackTest.drops,
  startedAt: (window as unknown as { __stackTest: TestHook }).__stackTest.startedAt,
  state: (window as unknown as { __stackTest: TestHook }).__stackTest.state,
  rules: (window as unknown as { __stackTest: TestHook }).__stackTest.rules,
});

let rngState = 12345;
const rng = () => {
  rngState = (rngState * 1103515245 + 12345) & 0x7fffffff;
  return rngState / 0x7fffffff;
};
const gauss = () => Math.sqrt(-2 * Math.log(Math.max(1e-9, rng()))) * Math.cos(2 * Math.PI * rng());

/** To end the run: the middle of the first stretch, at least `from` ms in,
 *  where the block clears the tower. A block too wide to clear it is dropped
 *  at the wall farthest from the tower instead, cutting it down. */
function missAt(state: StackRunState, from: number) {
  const row = stackRow(state.height);
  const width = stackMoverWidth(state);
  const clear = (e: number) => {
    const left = stackMoverLeft(row, width, e);
    return left + width < state.left + 2 || left > state.left + state.width - 2;
  };
  const span = STACK_BAND - width;
  const horizon = from + (4 * span) / row.speed;
  for (let e = from; e < horizon; e += 2) {
    if (!clear(e)) continue;
    let end = e;
    while (clear(end + 2) && end < horizon) end += 2;
    if (end - e >= 60) return (e + end) / 2;
    e = end;
  }
  // The block is at a wall every span / speed ms; pick the wall farther from the tower.
  const towerCentre = state.left + state.width / 2;
  let best = from;
  let bestGap = -1;
  for (let k = 0; k < 6; k += 1) {
    const e = (k * span) / row.speed;
    if (e < from) continue;
    const left = stackMoverLeft(row, width, e);
    const gap = Math.abs(left + width / 2 - towerCentre);
    if (gap > bestGap) {
      bestGap = gap;
      best = e;
    }
  }
  return best;
}

await press();
await page.waitForFunction(() => (window as unknown as { __stackTest?: { state: string } }).__stackTest?.state === 'playing', null, {
  timeout: 15_000,
});
const { offset, rtt } = await clockOffset(page);

let placed = 0;
let state = createStackRun();
let startedAt = 0;
for (let i = 0; i < targetRows + 40; i += 1) {
  const h = await hook();
  state = h.sim;
  startedAt = h.startedAt;
  captureHeight = state.height;
  if (h.state !== 'playing') break;
  const miss = state.height >= targetRows;
  // Leave room for the round trip to the page.
  const from = 260;
  const aim = miss
    ? missAt(state, from)
    : stackAimElapsedMs(state, from) + gauss() * sigma + (gauss() * eyePx) / stackRow(state.height).speed;
  const target = startedAt + state.rowStartMs + aim;
  const wait = target - offset - performance.now() - rtt / 2;
  if (process.env.QA_DEBUG) console.error(`row ${i} h ${state.height} rowStart ${state.rowStartMs} aim ${Math.round(aim)} wait ${Math.round(wait)}`);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  await press();
  await page.waitForFunction(
    (n) => ((window as unknown as { __stackTest: { drops: number[] } }).__stackTest.drops.length ?? 0) > n,
    i,
    { timeout: 5000 },
  );
  placed = (await hook()).sim.height;
}

await page.waitForTimeout(4500);
await page.screenshot({ path: `${out}/result-${tag}.jpg`, type: 'jpeg', quality: 80 });
const resultText = await page.locator('.arc-shell-end').innerText({ timeout: 3000 }).catch(() => '');
const final = await hook();

// Pays once: send the same run again; the route must refuse it and the
// balance must not move.
let resubmit: unknown = null;
if (signed && scoreBody) {
  const balance = async () =>
    ((await (await page.request.get(`${base}/api/store/inventory?gameType=stack`)).json()) as { wallet?: { credits?: number } }).wallet?.credits ?? null;
  const before = await balance();
  const again = await page.request.post(`${base}/api/games/stack/score`, { data: JSON.parse(scoreBody), headers: { 'Content-Type': 'application/json' } });
  resubmit = { status: again.status(), body: (await again.text()).slice(0, 160), balanceBefore: before, balanceAfter: await balance() };
}
const frames = (await page.evaluate(() => (window as unknown as { __stackFrames?: number[][] }).__stackFrames ?? [])) as number[][];

// ── Smoothness: every frame's drawn left edge against the rules at the
// frame's own run time. Within a row, a frame that didn't move while the
// rules moved the block more than 0.5 px is a step; a gap over 1.5 frame
// intervals is a hitch (a stalled frame, not the drawing).
const replay = createStackRun();
const dropsLeft = [...final.drops];
let maxError = 0;
let steps = 0;
let hitches = 0;
const intervals: number[] = [];
for (let k = 1; k < frames.length; k += 1) intervals.push(frames[k][0] - frames[k - 1][0]);
const sorted = [...intervals].sort((a, b) => a - b);
const median = sorted[Math.floor(sorted.length / 2)] ?? 16.7;
for (let k = 0; k < frames.length; k += 1) {
  const [, runMs, height, left] = frames[k];
  while (replay.height < height && dropsLeft.length > 0) {
    // Rebuild the rules' state at this height from the page's drops.
    stackDropAt(replay, dropsLeft.shift()!);
  }
  if (replay.height !== height) continue;
  const expected = stackMoverLeft(stackRow(height), stackMoverWidth(replay), Math.max(0, runMs - replay.rowStartMs));
  maxError = Math.max(maxError, Math.abs(expected - left));
  if (k > 0 && frames[k - 1][2] === height) {
    const moved = Math.abs(left - frames[k - 1][3]);
    const shouldMove = Math.abs(
      expected -
        stackMoverLeft(stackRow(height), stackMoverWidth(replay), Math.max(0, frames[k - 1][1] - replay.rowStartMs)),
    );
    if (moved < 0.01 && shouldMove > 0.5) steps += 1;
    if (frames[k][0] - frames[k - 1][0] > median * 1.5) hitches += 1;
  }
}
const pct = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] ?? 0;

console.log(
  JSON.stringify(
    {
      tag,
      rafRate: Math.round(rafRate),
      clockRttMs: Math.round(rtt * 10) / 10,
      placed,
      drops: final.drops.length,
      height: final.sim.height,
      band: [STACK_SWEEP_LEFT, STACK_SWEEP_LEFT + STACK_BAND],
      frames: {
        count: frames.length,
        medianMs: Math.round(median * 100) / 100,
        p95Ms: Math.round(pct(0.95) * 100) / 100,
        p99Ms: Math.round(pct(0.99) * 100) / 100,
        maxMs: Math.round((sorted[sorted.length - 1] ?? 0) * 100) / 100,
        over20ms: intervals.filter((x) => x > 20).length,
        hitches,
        steps,
        maxDrawErrorPx: Math.round(maxError * 1000) / 1000,
      },
      resultText: resultText.replace(/\s+/g, ' ').slice(0, 300),
      score: scoreResponses,
      resubmit,
      errors,
    },
    null,
    2,
  ),
);
framesRunning = false;
if (throttle > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 }).catch(() => {});
await context.close();
if (video && !hz) {
  const file = readdirSync(videoDir).find((name) => name.endsWith('.webm'));
  if (file) renameSync(`${videoDir}/${file}`, `${out}/run-${tag}.webm`);
}
if (hz && frameWindow && savedFrames > 0) {
  // Every frame, at the rate it was driven, and a 4x slow copy to watch.
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(hz), '-i', `${frameDir}/f%05d.jpg`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', `${out}/frames-${tag}.mp4`]);
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(hz / 4), '-i', `${frameDir}/f%05d.jpg`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-r', '30', `${out}/frames-${tag}-slow.mp4`]);
}
await browser.close();
