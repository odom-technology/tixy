/**
 * High striker browser QA: first frame, frame times, a few real swings, a video.
 *
 *   npx tsx scripts/qa-high-striker.mts [--mobile] [--throttle=4] [--video]
 *     [--swings=6] [--reduced] [--label=after] [--out=/tmp/hs-qa]
 *     [--cookie-file=<json>] [--base=http://127.0.0.1:3152] [--shots] [--tier=low] [--gl=llvmpipe]
 *     [--legacy] [--plan=0.75,0.93,0.99] [--signed] [--twice]
 *
 * Headless Chromium on SwiftShader (WebGL on the CPU), `?arcadePerf=1`.
 * --tier pins the kit's quality tier (`?midwayTier=`).
 * --mobile is 390 x 844 at DPR 3 with touch; otherwise 1280 x 800 at DPR 1.
 * --throttle sets CDP CPU throttling before navigation, so the first frame
 * is throttled too. The 4x throttle doesn't reach the GPU process, so
 * SwiftShader numbers are pessimistic next to a phone GPU and only compare
 * against each other.
 * --legacy drives the page before the rev. 2 shell (a start overlay and a
 * tap at the marker's peak), for the before numbers.
 *
 * First frame: ms from navigation start to the end of the animation frame
 * after the first WebGL draw (the same definition as
 * scripts/measure-midway-three.mjs). Frame times: every rAF interval while
 * the bot plays, p50 / p90 / p99 / max and the count over 20 ms.
 *
 * --signed registers a throwaway account first, so the run saves and pays: the
 * score POST, the tickets before and after, the best and the board are printed.
 *
 * --twice (with --signed) also writes a rules 2 row (last season) for the
 * account straight into the database (DATABASE_URL), then plays a second run
 * through the rematch button, to check last season's best stays and is read
 * back.
 *
 * Each swing is a real hold: pointer down on the stage, wait, pointer up.
 * Rules 3 (endless): the plan lists each release's offset from the swing's
 * peak in ms (0 rings the bell; the canvas's data-hs-next says when the next
 * swing peaks). --end makes the last swing a late miss, which ends the run.
 * The events carry explicit timestamps (CDP `timestamp`), so the judged hold
 * is exactly the planned one however slow this machine is.
 */
import { mkdirSync, readFileSync, renameSync } from 'node:fs';

import { chromium, type CDPSession } from 'playwright';

const args = Object.fromEntries(
  process.argv.slice(2).map((arg) => {
    const match = arg.match(/^--([^=]+)(?:=(.*))?$/);
    return match ? [match[1], match[2] ?? 'true'] : [arg, 'true'];
  }),
) as Record<string, string>;

const base = (args.base ?? 'http://127.0.0.1:3152').replace(/\/$/, '');
const mobile = args.mobile === 'true';
const reduced = args.reduced === 'true';
const legacy = args.legacy === 'true';
const signed = args.signed === 'true';
const throttle = args.throttle ? Number(args.throttle) : 1;
const video = args.video === 'true';
const shots = args.shots === 'true';
const swings = Number(args.swings ?? 8);
const label = args.label ?? 'run';
const out = args.out ?? '/tmp/hs-qa';
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
  window.__hsQa = state;
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

// Signed in: a throwaway account, and the save and the payout recorded.
const saved: { post: unknown } = { post: null };
if (signed) {
  const name = `hs${Date.now().toString(36)}`;
  const register = await page.request.post(`${base}/api/account/register`, {
    data: { email: `${name}@example.test`, password: `pw-${name}-Aa1!`, username: name },
  });
  if (!register.ok()) throw new Error(`register ${register.status()} ${await register.text()}`);
  page.on('response', async (response) => {
    if (response.url().includes('/api/games/high-striker/score') && response.request().method() === 'POST') {
      saved.post = { status: response.status(), body: await response.json().catch(() => null) };
    }
  });
}
const credits = async () => {
  const r = await page.request.get(`${base}/api/store/inventory?gameType=high-striker`);
  const j = (await r.json().catch(() => null)) as { wallet?: { credits?: number } } | null;
  return j?.wallet?.credits ?? null;
};
const creditsBefore = signed ? await credits() : null;

const cdp: CDPSession = await context.newCDPSession(page);
if (throttle > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle });

await page.goto(`${base}/high-striker?arcadePerf=1${args.tier ? `&midwayTier=${args.tier}` : ''}`, {
  waitUntil: 'commit',
  timeout: 180_000,
});
const deadline = Date.now() + 90_000;
let firstFrame: number | null = null;
while (Date.now() < deadline) {
  firstFrame = await page
    .evaluate(() => (window as unknown as { __hsQa?: { firstFrame: number | null } }).__hsQa?.firstFrame ?? null)
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

const stage = legacy ? page.locator('canvas').first() : page.locator('.arc-shell-screen').first();
const box = (await stage.boundingBox())!;
const cx = box.x + box.width / 2;
const cy = box.y + box.height * 0.6;

/** One press and release, `holdMs` apart, with explicit event timestamps. */
async function hold(holdMs: number) {
  const t0 = Date.now() / 1000;
  const send = async (type: 'down' | 'up', ts: number) => {
    if (mobile) {
      await cdp.send('Input.dispatchTouchEvent', {
        type: type === 'down' ? 'touchStart' : 'touchEnd',
        touchPoints: type === 'down' ? [{ x: cx, y: cy }] : [],
        timestamp: ts,
      });
    } else {
      await cdp.send('Input.dispatchMouseEvent', {
        type: type === 'down' ? 'mousePressed' : 'mouseReleased',
        x: cx,
        y: cy,
        button: 'left',
        buttons: type === 'down' ? 1 : 0,
        clickCount: 1,
        timestamp: ts,
      });
    }
  };
  await send('down', t0);
  await sleep(Math.max(0, holdMs - (Date.now() / 1000 - t0) * 1000));
  await send('up', t0 + holdMs / 1000);
}

async function tap() {
  if (mobile) await page.touchscreen.tap(cx, cy);
  else await page.mouse.click(cx, cy);
}

if (legacy) {
  // The old page: its overlay starts the run on a tap.
  await tap();
  await sleep(1200);
} else {
  // Start the run with a tap, as a player would.
  await tap();
  await page.waitForFunction(() => document.querySelector('.arc-shell-stage[data-phase="playing"]') != null, null, {
    timeout: 30_000,
  });
  await sleep(900);
}
await page.evaluate(() => {
  (window as unknown as { __hsQa: { recording: boolean } }).__hsQa.recording = true;
});

// Offsets from the peak to release at, ms. A real player misses by tens of
// ms either way; the bell needs about 24 either side at first, less later.
const plan = (args.plan ?? '0,-40,8,25,-5,60,0,-15').split(',').map(Number);
const nextOf = () =>
  page
    .evaluate(() => (document.querySelector('canvas') as HTMLCanvasElement | null)?.dataset.hsNext ?? '')
    .catch(() => '')
    .then((text) => {
      const [index, peakMs, windowMs] = text.split(':').map(Number);
      return { index, peakMs, windowMs };
    });
const phaseOf = () =>
  page.evaluate(() => (document.querySelector('canvas') as HTMLCanvasElement | null)?.dataset.hsPhase ?? '').catch(() => '');
const lastOf = () =>
  page.evaluate(() => (document.querySelector('canvas') as HTMLCanvasElement | null)?.dataset.hsLast ?? '').catch(() => '');

const results: string[] = [];
async function playSwings(planOffset = 0) {
for (let i = 0; i < swings; i += 1) {
  if (legacy) {
    await sleep(900);
    await tap();
    await sleep(1800);
    continue;
  }
  const until = Date.now() + 20_000;
  let phase = await phaseOf();
  while (phase !== 'aim' && phase !== 'resolve-down' && Date.now() < until) {
    if (phase === 'over') break;
    await sleep(60);
    phase = await phaseOf();
  }
  if (phase === 'over') break;
  const last = i === swings - 1 && args.end === 'true';
  const next = await nextOf();
  const offset = last ? next.windowMs / 2 + 40 : (plan[(i + planOffset) % plan.length] ?? 0);
  const holdMs = Math.round(next.peakMs + offset);
  await hold(holdMs);
  await sleep(120);
  results.push(`${i + 1}:${offset}->${await lastOf()}`);
  if (shots && i === 2 && planOffset === 0) {
    await sleep(Math.round(700 / throttle));
    await page.screenshot({ path: `${out}/${tag}-flight.jpg`, type: 'jpeg', quality: 80 });
  }
}
}
await playSwings();
if (shots) {
  await sleep(900);
  await page.screenshot({ path: `${out}/${tag}-play.jpg`, type: 'jpeg', quality: 80 });
}
await sleep(3200);
if (shots && !legacy) {
  await page.waitForSelector('.arc-shell-end', { timeout: 12_000 }).catch(() => undefined);
  await sleep(1800);
  await page.screenshot({ path: `${out}/${tag}-result.jpg`, type: 'jpeg', quality: 80 });
}

if (args.twice === 'true' && signed && !legacy) {
  const { default: pg } = await import('pg');
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  const name = (await db.query('SELECT user_name FROM high_striker_scores ORDER BY created_at DESC LIMIT 1')).rows[0]?.user_name;
  const seeded = await db.query(
    `INSERT INTO high_striker_scores (id, od_user_id, user_name, score, created_at, rules, best_strength)
     SELECT gen_random_uuid()::text, od_user_id, user_name, 21, 1, 2, NULL FROM high_striker_scores WHERE user_name = $1 AND rules = 3 LIMIT 1`,
    [name],
  );
  console.log(JSON.stringify({ legacyRowSeeded: seeded.rowCount }));
  await page.getByRole('button', { name: /rematch/i }).click();
  await page.waitForFunction(() => document.querySelector('.arc-shell-stage[data-phase="playing"]') != null, null, { timeout: 30_000 });
  await sleep(900);
  await playSwings(3);
  await sleep(3200);
  await page.waitForSelector('.arc-shell-end', { timeout: 12_000 }).catch(() => undefined);
  await sleep(1500);
  const rows = (await db.query('SELECT rules, score, best_strength FROM high_striker_scores WHERE user_name = $1 ORDER BY rules', [name])).rows;
  console.log(JSON.stringify({ rows }));
  await db.end();
}

const samples = (await page.evaluate(
  () => (window as unknown as { __hsQa: { samples: number[] } }).__hsQa.samples,
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
  swings: results,
  errors,
};
console.log(JSON.stringify(report));
if (signed) {
  await sleep(1500);
  const creditsAfter = await credits();
  const best = await (await page.request.get(`${base}/api/games/high-striker/score`)).json().catch(() => null);
  const board = await (await page.request.get(`${base}/api/games/high-striker/leaderboard`)).json().catch(() => null);
  console.log(JSON.stringify({ signed: { creditsBefore, creditsAfter, save: saved.post, best, board } }));
}

const videoPath = video ? await page.video()?.path() : null;
await context.close();
await browser.close();
if (videoPath) {
  const named = `${out}/${tag}.webm`;
  renameSync(videoPath, named);
  console.log(`video: ${named}`);
}
