/**
 * Skee-ball browser QA: first frame, frame times, a few real flicks, a video.
 *
 *   npx tsx scripts/qa-skee-ball.mts [--mobile] [--throttle=4] [--video]
 *     [--rolls=4] [--reduced] [--label=after] [--out=/tmp/skee-qa]
 *     [--cookie-file=<json>] [--base=http://127.0.0.1:3141] [--shots] [--tier=low] [--gl=llvmpipe]
 *
 * Headless Chromium on SwiftShader (WebGL on the CPU), `?arcadePerf=1`.
 * --tier pins the kit's quality tier (`?midwayTier=`).
 * --mobile is 390 x 844 at DPR 3 with touch; otherwise 1280 x 800 at DPR 1.
 * --throttle sets CDP CPU throttling before navigation, so the first frame
 * is throttled too. The 4x throttle doesn't reach the GPU process, so
 * SwiftShader numbers are pessimistic next to a phone GPU and only compare
 * against each other.
 *
 * First frame: ms from navigation start to the end of the animation frame
 * after the first WebGL draw (the same definition as
 * scripts/measure-midway-three.mjs). Frame times: every rAF interval while
 * the bot plays, p50 / p90 / p99 / max and the count over 20 ms.
 *
 * Each roll is a real gesture: pointer down on the ball, pull back, then a
 * fast flick forward with a little sideways drift. Touch uses CDP touch
 * events, so the game sees real pointer events with coalesced samples.
 */
import { mkdirSync, readFileSync, renameSync } from 'node:fs';

import { chromium, type CDPSession } from 'playwright';

const args = Object.fromEntries(
  process.argv.slice(2).map((arg) => {
    const match = arg.match(/^--([^=]+)(?:=(.*))?$/);
    return match ? [match[1], match[2] ?? 'true'] : [arg, 'true'];
  }),
) as Record<string, string>;

const base = (args.base ?? 'http://127.0.0.1:3141').replace(/\/$/, '');
const mobile = args.mobile === 'true';
const reduced = args.reduced === 'true';
const throttle = args.throttle ? Number(args.throttle) : 1;
const video = args.video === 'true';
const shots = args.shots === 'true';
const rolls = Number(args.rolls ?? 4);
const label = args.label ?? 'run';
const out = args.out ?? '/tmp/skee-qa';
const tag = [label, args.gl === 'llvmpipe' ? 'llvmpipe' : '', mobile ? '390' : '1280', throttle > 1 ? `cpu${throttle}x` : '', reduced ? 'reduced' : '']
  .filter(Boolean)
  .join('-');
mkdirSync(out, { recursive: true });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const viewport = mobile ? { width: 390, height: 844 } : { width: 1280, height: 800 };

const browser = await chromium.launch({
  executablePath:
    process.env.PLAYWRIGHT_EXECUTABLE_PATH,
  // --gl=llvmpipe renders WebGL with Mesa's multithreaded CPU rasteriser:
  // closer to a real GPU's frame rate, for watchable videos. The budget
  // numbers use SwiftShader, as THREE.md asks.
  args: [
    ...(args.gl === 'llvmpipe' ? ['--use-angle=gl-egl'] : ['--enable-unsafe-swiftshader', '--use-angle=swiftshader']),
    '--ignore-gpu-blocklist',
    '--disable-blink-features=AutomationControlled',
  ],
});
const context = await browser.newContext({
  viewport,
  deviceScaleFactor: mobile ? 3 : 1,
  hasTouch: mobile,
  isMobile: mobile,
  reducedMotion: reduced ? 'reduce' : 'no-preference',
  ...(video ? { recordVideo: { dir: out, size: viewport } } : {}),
});

// --cookie-file=<json with { "cookies": ["name=value", ...] }> plays as that
// signed-in account, so a skin equipped on it shows.
if (args['cookie-file']) {
  const { cookies } = JSON.parse(readFileSync(args['cookie-file'], 'utf8')) as { cookies: string[] };
  await context.addCookies(
    cookies.map((pair) => {
      const [name, ...rest] = pair.split('=');
      return { name: name!, value: rest.join('='), url: base };
    }),
  );
}

// Runs before any page script: wrap WebGL draws to find the first frame,
// and keep every rAF interval while `recording` is on.
// A string, so the bundler's name helpers never reach the page.
await context.addInitScript(`(() => {
  const state = { firstDraw: null, firstFrame: null, samples: [], recording: false };
  window.__skeeQa = state;
  const proto = typeof WebGL2RenderingContext !== 'undefined' ? WebGL2RenderingContext.prototype : null;
  if (proto) {
    for (const name of ['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced']) {
      const original = proto[name];
      if (typeof original !== 'function') continue;
      proto[name] = function (...a) {
        if (state.firstDraw === null) {
          state.firstDraw = performance.now();
          requestAnimationFrame(() => { state.firstFrame = performance.now(); });
        }
        return original.apply(this, a);
      };
    }
  }
  let last = 0;
  const tick = (now) => {
    if (state.recording && last > 0) state.samples.push(now - last);
    last = now;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  Object.defineProperty(navigator, 'webdriver', { get: () => false });
})();`);

const page = await context.newPage();
const errors: string[] = [];
page.on('pageerror', (error) => errors.push(error.message));
page.on('console', (message) => {
  if (message.type() === 'error' && !/401|Unauthorized|favicon/.test(message.text())) {
    errors.push(message.text().slice(0, 200));
  }
});

let cdp: CDPSession | null = null;
cdp = await context.newCDPSession(page);
if (throttle > 1) await cdp!.send('Emulation.setCPUThrottlingRate', { rate: throttle });

await page.goto(`${base}/skee-ball?arcadePerf=1${args.tier ? `&midwayTier=${args.tier}` : ''}`, { waitUntil: 'commit', timeout: 180_000 });
const deadline = Date.now() + 90_000;
let firstFrame: number | null = null;
while (Date.now() < deadline) {
  firstFrame = await page
    .evaluate(() => (window as unknown as { __skeeQa?: { firstFrame: number | null } }).__skeeQa?.firstFrame ?? null)
    .catch(() => null);
  if (firstFrame !== null) break;
  await sleep(100);
}
await page.waitForLoadState('load').catch(() => undefined);
const tierAtStart = await page.evaluate(() => {
  const q = performance.getEntriesByName('arcade:quality').at(-1) as PerformanceMeasure | undefined;
  return (q?.detail as { tier?: string } | undefined)?.tier ?? null;
});
await sleep(1500);
// The arcade performance overlay and the dev badge sit over the stage corners.
await page.addStyleTag({ content: '.fixed.z-\\[200\\] { display: none !important; }' }).catch(() => undefined);
if (shots) await page.screenshot({ path: `${out}/${tag}-ready.jpg`, type: 'jpeg', quality: 80 });

const screen = page.locator('.arc-shell-screen').first();
const box = (await screen.boundingBox())!;

async function tap(x: number, y: number) {
  if (mobile) await page.touchscreen.tap(x, y);
  else await page.mouse.click(x, y);
}

/**
 * One gesture: points are [x, y, ms to wait before the point]. Sent through
 * CDP in real time, the way a finger would be: each dispatch waits for the
 * page to take it, so a flick sent in three steps lands in about 60 to
 * 120 ms on this machine.
 */
async function gesture(points: Array<[number, number, number]>) {
  const send = async (type: 'start' | 'move' | 'end', x: number, y: number) => {
    if (mobile) {
      await cdp!.send('Input.dispatchTouchEvent', {
        type: type === 'start' ? 'touchStart' : type === 'move' ? 'touchMove' : 'touchEnd',
        touchPoints: type === 'end' ? [] : [{ x, y }],
      });
    } else {
      await cdp!.send('Input.dispatchMouseEvent', {
        type: type === 'start' ? 'mousePressed' : type === 'move' ? 'mouseMoved' : 'mouseReleased',
        x,
        y,
        button: 'left',
        buttons: type === 'end' ? 0 : 1,
        clickCount: 1,
      });
    }
  };
  const [x0, y0] = points[0];
  await send('start', x0, y0);
  for (const [x, y, wait] of points.slice(1)) {
    if (wait) await sleep(wait);
    await send('move', x, y);
  }
  const [xl, yl] = points[points.length - 1];
  await send('end', xl, yl);
}

/** Pull back `pull` px, hold, then flick forward `flick` px in ~`ms`. */
async function roll(drift: number, flick: number, ms: number) {
  const x = box.x + box.width / 2;
  const y = box.y + box.height * 0.7;
  const points: Array<[number, number, number]> = [[x, y, 0]];
  for (let i = 1; i <= 6; i += 1) points.push([x, y + i * 18, 30]);
  const steps = 3;
  for (let i = 1; i <= steps; i += 1) {
    points.push([x + (drift * i) / steps, y + 108 - (flick * i) / steps, i === 1 ? 60 : Math.max(0, ms / steps - 30)]);
  }
  await gesture(points);
}

// Start the run with a tap, as a player would.
await tap(box.x + box.width / 2, box.y + box.height * 0.6);
await page.waitForFunction(() => document.querySelector('.arc-shell-stage[data-phase="playing"]') != null, null, {
  timeout: 30_000,
});
await sleep(900);
await page.evaluate(() => {
  (window as unknown as { __skeeQa: { recording: boolean } }).__skeeQa.recording = true;
});

// [sideways px, forward px, ms]: forward speed sets power (1.7 to 2.05
// px/ms is the 50), sideways over forward sets aim. Two go for a pocket
// (slant 0.45 at about 2.1 px/ms).
const plan: Array<[number, number, number]> = [
  [0, 170, 90],
  [-85, 189, 90],
  [12, 185, 100],
  [0, 215, 90],
  [-14, 150, 95],
  [85, 189, 90],
  [0, 175, 95],
  [8, 160, 90],
  [-6, 185, 96],
];
// CDP input waits for each event to land, so a planned flick arrives slower
// than planned; this scales it back to the planned speed on this machine.
const GAIN = Number(args.gain ?? 1.7);
const isAim = () =>
  page
    .evaluate(() => (document.querySelector('canvas') as HTMLCanvasElement | null)?.dataset.skeePhase === 'aim')
    .catch(() => false);
for (let i = 0; i < rolls && i < plan.length; i += 1) {
  const until = Date.now() + 20_000;
  while (!(await isAim()) && Date.now() < until) await sleep(80);
  const [drift, flick, ms] = plan[i];
  if (args.keys === 'true') await page.keyboard.press('Space');
  else await roll(drift * GAIN, flick * GAIN, ms);
  if (shots && i === 1) {
    await sleep(Math.round(900 / throttle));
    await page.screenshot({ path: `${out}/${tag}-flight.jpg`, type: 'jpeg', quality: 80 });
  }
  await sleep(400);
}
if (shots) {
  await sleep(1400);
  await page.screenshot({ path: `${out}/${tag}-play.jpg`, type: 'jpeg', quality: 80 });
}
await sleep(3500);
if (shots && rolls >= plan.length) {
  await page.waitForSelector('.arc-shell-end', { timeout: 20_000 }).catch(() => undefined);
  await sleep(1800);
  await page.screenshot({ path: `${out}/${tag}-result.jpg`, type: 'jpeg', quality: 80 });
}

const samples = (await page.evaluate(
  () => (window as unknown as { __skeeQa: { samples: number[] } }).__skeeQa.samples,
)) as number[];
const tierAtEnd = await page.evaluate(() => {
  const q = performance.getEntriesByName('arcade:quality').at(-1) as PerformanceMeasure | undefined;
  return (q?.detail as { tier?: string } | undefined)?.tier ?? null;
});
const sorted = [...samples].sort((a, b) => a - b);
const q = (p: number) =>
  sorted.length ? Math.round(sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] * 10) / 10 : null;
const report = {
  tag,
  firstFrameMs: firstFrame === null ? null : Math.round(firstFrame),
  tier: { start: tierAtStart, end: tierAtEnd },
  frames: {
    count: samples.length,
    p50: q(0.5),
    p90: q(0.9),
    p99: q(0.99),
    max: q(1),
    over20ms: samples.filter((f) => f > 20).length,
  },
  errors,
};
console.log(JSON.stringify(report));

const videoPath = video ? await page.video()?.path() : null;
await context.close();
await browser.close();
if (videoPath) {
  const named = `${out}/${tag}.webm`;
  renameSync(videoPath, named);
  console.log(`video: ${named}`);
}
