/**
 * Tin duck gallery browser QA: first frame, frame times, a bot round, a video.
 *
 *   npx tsx scripts/qa-tin-duck.mts [--mobile] [--throttle=4] [--video]
 *     [--seconds=30] [--reduced] [--label=after] [--out=/tmp/td-qa]
 *     [--cookie-file=<json>] [--base=http://127.0.0.1:3161] [--shots] [--tier=low] [--gl=llvmpipe]
 *     [--legacy] [--skill=0.6]
 *
 * Headless Chromium on SwiftShader (WebGL on the CPU), `?arcadePerf=1`.
 * --mobile is 390 x 844 at DPR 3 with touch; otherwise 1280 x 800 at DPR 1.
 * --throttle sets CDP CPU throttling before navigation, so the first frame is
 * throttled too. The 4x throttle does not reach the GPU process, so SwiftShader
 * numbers are pessimistic next to a phone GPU and only compare against each
 * other.
 * --legacy drives the page before the rev. 2 rework: its overlay starts the
 * run on a tap, and the bot taps around the canvas at a steady rate.
 * --skill is the bot's aim error as a fraction of a duck (0 is perfect).
 *
 * First frame: ms from navigation start to the end of the animation frame
 * after the first WebGL draw (the same definition as
 * scripts/measure-midway-three.mjs). Frame times: every rAF interval while the
 * bot plays, p50 / p90 / p99 / max and the count over 20 ms.
 *
 * The bot reads `window.__tinDuckProbe()` (set when `?arcadePerf=1` is on): the
 * live targets as screen points with their velocity. It leads each target by
 * the lag it expects, moves the mouse there over about 120 ms (a touch screen
 * just taps), and fires with explicit event timestamps.
 */
import { mkdirSync, readFileSync, renameSync } from 'node:fs';

import { chromium, type CDPSession } from 'playwright';

const args = Object.fromEntries(
  process.argv.slice(2).map((arg) => {
    const match = arg.match(/^--([^=]+)(?:=(.*))?$/);
    return match ? [match[1], match[2] ?? 'true'] : [arg, 'true'];
  }),
) as Record<string, string>;

const base = (args.base ?? 'http://127.0.0.1:3161').replace(/\/$/, '');
const mobile = args.mobile === 'true';
const reduced = args.reduced === 'true';
const legacy = args.legacy === 'true';
const throttle = args.throttle ? Number(args.throttle) : 1;
const video = args.video === 'true';
const shots = args.shots === 'true';
const seconds = Number(args.seconds ?? 30);
const skill = Number(args.skill ?? 0.6);
const label = args.label ?? 'run';
const out = args.out ?? '/tmp/td-qa';
const tag = [label, args.gl === 'llvmpipe' ? 'llvmpipe' : '', mobile ? '390' : '1280', throttle > 1 ? `cpu${throttle}x` : '', reduced ? 'reduced' : '']
  .filter(Boolean)
  .join('-');
mkdirSync(out, { recursive: true });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const viewport = mobile ? { width: 390, height: 844 } : { width: 1280, height: 800 };

const browser = await chromium.launch({
  executablePath:
    process.env.PLAYWRIGHT_EXECUTABLE_PATH,
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

await context.addInitScript(`(() => {
  const state = { firstDraw: null, firstFrame: null, samples: [], recording: false };
  window.__tdQa = state;
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
  if (message.type() === 'error' && !/401|Unauthorized|favicon|Failed to load resource/.test(message.text())) {
    errors.push(message.text().slice(0, 200));
  }
});

let signedAs: string | null = null;
if (args.signin === 'true') {
  // A throwaway account: the run saves and pays under it.
  const name = `td${Date.now().toString(36)}`;
  const register = await page.request.post(`${base}/api/account/register`, {
    data: { email: `${name}@example.test`, password: `pw-${name}-Aa1!`, username: name },
  });
  if (!register.ok()) throw new Error(`register ${register.status()} ${await register.text()}`);
  signedAs = name;
}
let scoreResponse: unknown = null;
page.on('response', async (response) => {
  if (response.url().includes('/api/games/tin-duck/score') && response.request().method() === 'POST') {
    scoreResponse = { status: response.status(), body: await response.json().catch(() => null) };
  }
});

const cdp: CDPSession = await context.newCDPSession(page);
if (throttle > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle });

await page.goto(`${base}/tin-duck?arcadePerf=1${args.tier ? `&midwayTier=${args.tier}` : ''}`, {
  waitUntil: 'commit',
  timeout: 180_000,
});
const deadline = Date.now() + 90_000;
let firstFrame: number | null = null;
while (Date.now() < deadline) {
  firstFrame = await page
    .evaluate(() => (window as unknown as { __tdQa?: { firstFrame: number | null } }).__tdQa?.firstFrame ?? null)
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
await page.addStyleTag({ content: '.fixed.z-\\[200\\] { display: none !important; }' }).catch(() => undefined);
if (shots) await page.screenshot({ path: `${out}/${tag}-ready.jpg`, type: 'jpeg', quality: 80 });

const stage = legacy ? page.locator('canvas').first() : page.locator('.arc-shell-screen').first();
const box = (await stage.boundingBox())!;

async function tapAt(x: number, y: number, ts?: number) {
  const stamp = ts ?? Date.now() / 1000;
  if (mobile) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }], timestamp: stamp });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [], timestamp: stamp + 0.04 });
  } else {
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, timestamp: stamp });
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1, timestamp: stamp,
    });
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1, timestamp: stamp + 0.04,
    });
  }
}

// Start the run with a tap, as a player would.
await tapAt(box.x + box.width / 2, box.y + box.height * 0.45);
if (!legacy) {
  await page.waitForFunction(() => document.querySelector('.arc-shell-stage[data-phase="playing"]') != null, null, {
    timeout: 30_000,
  });
}
await sleep(legacy ? 1200 : 600);
await page.evaluate(() => {
  (window as unknown as { __tdQa: { recording: boolean } }).__tdQa.recording = true;
});

type Probe = { x: number; y: number; vx: number; r: number; kind: string; row: number }[];
let seed = 12345;
const rnd = () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 4294967296;
};

let mouse = { x: box.x + box.width / 2, y: box.y + box.height * 0.5 };
async function glide(toX: number, toY: number, ms: number) {
  if (mobile) return;
  const steps = Math.max(2, Math.round(ms / 16));
  const from = { ...mouse };
  for (let i = 1; i <= steps; i += 1) {
    const k = i / steps;
    const e = k * k * (3 - 2 * k);
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: from.x + (toX - from.x) * e,
      y: from.y + (toY - from.y) * e,
    });
    await sleep(ms / steps);
  }
  mouse = { x: toX, y: toY };
}

const end = Date.now() + seconds * 1000;
let fired = 0;

while (Date.now() < end) {
  if (legacy) {
    const x = box.x + box.width * (0.12 + rnd() * 0.76);
    const y = box.y + box.height * (0.3 + rnd() * 0.45);
    await glide(x, y, 140);
    await tapAt(x, y);
    fired += 1;
    await sleep(330);
    continue;
  }
  const over = await page.evaluate(() => document.querySelector('.arc-shell-end') != null).catch(() => false);
  if (over) break;
  const probe = (await page
    .evaluate(() => (window as unknown as { __tinDuckProbe?: () => Probe }).__tinDuckProbe?.() ?? [])
    .catch(() => [])) as Probe;
  const live = probe.filter(
    (p) =>
      p.x > box.x + 18 && p.x < box.x + box.width - 18 && p.y > box.y + 8 && p.y < box.y + box.height * 0.8,
  );
  if (live.length === 0) {
    await sleep(60);
    continue;
  }
  // Prefer the bonus duck, then bullseye plates, then a random target.
  const target =
    live.find((p) => p.kind === 'bonus') ??
    live.find((p) => p.kind === 'plate' && rnd() < 0.5) ??
    live[Math.floor(rnd() * live.length)]!;
  const lead = (mobile ? 0.12 : 0.2) * (1 + 0.1 * throttle);
  const aimX = target.x + target.vx * lead + (rnd() - 0.5) * 2 * skill * target.r;
  const aimY = target.y + (rnd() - 0.5) * 2 * skill * target.r;
  await glide(aimX, aimY, 150 + rnd() * 100);
  await tapAt(aimX, aimY);
  fired += 1;
  
  await sleep(160 + rnd() * 200);
}
if (shots) await page.screenshot({ path: `${out}/${tag}-play.jpg`, type: 'jpeg', quality: 80 });
await sleep(900);
if (shots && !legacy) {
  await page.waitForSelector('.arc-shell-end', { timeout: Math.max(5000, seconds * 1000) }).catch(() => undefined);
  await sleep(1600);
  await page.screenshot({ path: `${out}/${tag}-result.jpg`, type: 'jpeg', quality: 80 });
}

const samples = (await page.evaluate(
  () => (window as unknown as { __tdQa: { samples: number[] } }).__tdQa.samples,
)) as number[];
const tierAtEnd = await page.evaluate(() => {
  const q = performance.getEntriesByName('arcade:quality').at(-1) as PerformanceMeasure | undefined;
  return (q?.detail as { tier?: string } | undefined)?.tier ?? null;
});
const sorted = [...samples].sort((a, b) => a - b);
const q = (p: number) =>
  sorted.length ? Math.round(sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] * 10) / 10 : null;
const drawInfo = await page.evaluate(() => (window as unknown as { __tinDuckInfo?: () => unknown }).__tinDuckInfo?.() ?? null).catch(() => null);
const report = {
  tag,
  firstFrameMs: firstFrame === null ? null : Math.round(firstFrame),
  tier: { start: tierAtStart, end: tierAtEnd },
  frames: { count: samples.length, p50: q(0.5), p90: q(0.9), p99: q(0.99), max: q(1), over20ms: samples.filter((f) => f > 20).length },
  draw: drawInfo,
  signedAs,
  scoreResponse,
  fired,
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
