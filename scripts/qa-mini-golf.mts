/**
 * Mini golf browser QA: first frame, frame times, a played round, a video.
 *
 *   npx tsx scripts/qa-mini-golf.mts [--mobile] [--throttle=4] [--video]
 *     [--holes=9] [--reduced] [--label=run] [--out=/tmp/gmg-qa]
 *     [--base=http://127.0.0.1:3241] [--shots] [--tier=low] [--gl=llvmpipe]
 *     [--skill=good] [--gestures=all|first]
 *
 * Headless Chromium on SwiftShader, `?arcadePerf=1&mgQa=1`. The first putt
 * of every hole (or every putt with --gestures=all) is a real drag on the
 * stage, pulled back from the ball's screen position; the others go through
 * the page's QA hook. The simulated player (scripts/lib/mini-golf-bot.ts)
 * picks each putt on the same day's course the page is playing.
 */
import { mkdirSync } from 'node:fs';

import { chromium, type CDPSession } from 'playwright';

import { mgBuildHole, mgCourseFor, mgTemplate } from '../src/server/arcade/mini-golf-course';
import { SKILLS, choosePutt, distanceField, gauss, rngFrom } from './lib/mini-golf-bot';

const args = Object.fromEntries(
  process.argv.slice(2).map((arg) => {
    const match = arg.match(/^--([^=]+)(?:=(.*))?$/);
    return match ? [match[1], match[2] ?? 'true'] : [arg, 'true'];
  }),
) as Record<string, string>;

const base = (args.base ?? 'http://127.0.0.1:3241').replace(/\/$/, '');
const mobile = args.mobile === 'true';
const reduced = args.reduced === 'true';
const throttle = args.throttle ? Number(args.throttle) : 1;
const video = args.video === 'true';
const shots = args.shots === 'true';
const holes = Number(args.holes ?? 9);
const label = args.label ?? 'run';
const out = args.out ?? '/tmp/gmg-qa';
const skill = SKILLS.find((s) => s.name === (args.skill ?? 'good')) ?? SKILLS[2];
const gesturesAll = args.gestures === 'all';
const tag = [label, mobile ? '390' : '1280', throttle > 1 ? `cpu${throttle}x` : '', reduced ? 'reduced' : '']
  .filter(Boolean)
  .join('-');
mkdirSync(out, { recursive: true });

type QaWindow = {
  __gmgQa: { firstFrame: number | null; samples: number[]; recording: boolean };
  __mgQa: { state: () => unknown; putt: (dx: number, dy: number, share: number) => void; next: () => void };
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const viewport = mobile ? { width: 390, height: 844 } : { width: 1280, height: 800 };

const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH,
  args: [
    ...(args.gl === 'llvmpipe' ? ['--use-angle=gl-egl'] : ['--enable-unsafe-swiftshader', '--use-angle=swiftshader']),
    '--ignore-gpu-blocklist',
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
await context.addInitScript(`(() => {
  const state = { firstDraw: null, firstFrame: null, samples: [], recording: false };
  window.__gmgQa = state;
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

// --signin registers a throwaway account first, so the round is the day's
// counted round and every putt posts to the server.
if (args.signin === 'true') {
  const id = Math.random().toString(36).slice(2, 10);
  const res = await context.request.post(`${base}/api/account/register`, {
    data: { email: `gmg-${id}@example.test`, password: `pw-${id}-Aa1!long`, username: `gmg${id}` },
  });
  console.log('register', res.status());
}
// --cookies=<curl cookie jar> plays as that account (a skin equipped on it shows).
if (args.cookies) {
  const { readFileSync } = await import('node:fs');
  const jar = readFileSync(args.cookies, 'utf8')
    .split('\n')
    .map((line) => line.replace(/^#HttpOnly_/, ''))
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => line.split('\t'))
    .filter((parts) => parts.length >= 7);
  await context.addCookies(jar.map((parts) => ({ name: parts[5]!, value: parts[6]!, url: base })));
}
const page = await context.newPage();
const posts: string[] = [];
page.on('response', async (response) => {
  const url = response.url();
  if (!url.includes('/api/games/mini-golf/')) return;
  const method = response.request().method();
  if (method === 'GET' && !url.includes('/round')) return;
  let body = '';
  try {
    body = (await response.text()).slice(0, 220);
  } catch {
    body = '';
  }
  posts.push(`${method} ${new URL(url).pathname} ${response.status()} ${body}`);
});
const errors: string[] = [];
page.on('pageerror', (error) => errors.push(error.message));
page.on('console', (message) => {
  if (message.type() === 'error' && !/401|Unauthorized|favicon/.test(message.text())) errors.push(message.text().slice(0, 200));
});
const cdp: CDPSession = await context.newCDPSession(page);
if (throttle > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle });

await page.goto(`${base}/mini-golf?arcadePerf=1&mgQa=1${args.tier ? `&midwayTier=${args.tier}` : ''}${args.templates ? `&mgTemplates=${args.templates}` : ''}`, {
  waitUntil: 'commit',
  timeout: 180_000,
});
let firstFrame: number | null = null;
const deadline = Date.now() + 120_000;
while (Date.now() < deadline) {
  firstFrame = await page.evaluate(() => (window as unknown as QaWindow).__gmgQa?.firstFrame ?? null).catch(() => null);
  if (firstFrame !== null) break;
  await sleep(100);
}
await page.waitForLoadState('load').catch(() => undefined);
await page.waitForFunction(() => Boolean((window as unknown as QaWindow).__mgQa), null, { timeout: 60_000 });
await sleep(1200);
await page.addStyleTag({ content: '.fixed.z-\\[200\\] { display: none !important; }' }).catch(() => undefined);
if (shots) await page.screenshot({ path: `${out}/${tag}-ready.jpg`, type: 'jpeg', quality: 80 });

const screen = page.locator('.arc-shell-screen').first();
const box = (await screen.boundingBox())!;
type QaState = {
  game: string;
  phase: string;
  hole: number;
  ball: { x: number; y: number };
  strokes: number;
  clock: number;
  scores: number[];
  dateKey: string;
};
const state = () => page.evaluate(() => (window as unknown as QaWindow).__mgQa.state()) as Promise<QaState>;

async function tap(x: number, y: number) {
  if (mobile) await page.touchscreen.tap(x, y);
  else await page.mouse.click(x, y);
}

/** A drag on the stage: down at (x, y), pulled to (x + px, y + py) over ms. */
async function drag(x: number, y: number, px: number, py: number, ms: number) {
  const send = async (type: 'start' | 'move' | 'end', cx: number, cy: number) => {
    if (mobile) {
      await cdp.send('Input.dispatchTouchEvent', {
        type: type === 'start' ? 'touchStart' : type === 'move' ? 'touchMove' : 'touchEnd',
        touchPoints: type === 'end' ? [] : [{ x: cx, y: cy }],
      });
    } else {
      await cdp.send('Input.dispatchMouseEvent', {
        type: type === 'start' ? 'mousePressed' : type === 'move' ? 'mouseMoved' : 'mouseReleased',
        x: cx,
        y: cy,
        button: 'left',
        buttons: type === 'end' ? 0 : 1,
        clickCount: 1,
      });
    }
  };
  await send('start', x, y);
  const steps = 10;
  for (let i = 1; i <= steps; i += 1) {
    await sleep(ms / steps);
    await send('move', x + (px * i) / steps, y + (py * i) / steps);
  }
  await sleep(350);
  await send('end', x + px, y + py);
}

await tap(box.x + box.width / 2, box.y + box.height / 2);
const startState = await state();
const course = mgCourseFor(startState.dateKey);
// The same override the page applies for ?mgTemplates=.
if (args.templates) {
  args.templates.split(',').forEach((id, i) => {
    const t = mgTemplate(id);
    if (!t || i >= course.holes.length) return;
    const options = { ...course.holes[i].options, slot: t.slot?.[0] ?? 'none' };
    course.holes[i] = { templateId: id, options, hole: mgBuildHole(t, options) };
  });
}
const rng = rngFrom(7);
await page.evaluate(() => {
  (window as unknown as QaWindow).__gmgQa.recording = true;
});

const log: string[] = [];
let shotIndex = 0;
for (let h = 0; h < holes; h += 1) {
  const hole = course.holes[h].hole;
  const field = distanceField(hole);
  for (;;) {
    const s = await state();
    if (s.game === 'gameover') break;
    if (s.game === 'card') {
      if (shots && shotIndex < 3) {
        await page.screenshot({ path: `${out}/${tag}-card-${h + 1}.jpg`, type: 'jpeg', quality: 80 });
      }
      await sleep(500);
      await tap(box.x + box.width / 2, box.y + box.height * 0.8);
      await sleep(400);
      break;
    }
    if (s.hole !== h) break;
    if (s.phase !== 'aim') {
      await sleep(60);
      continue;
    }
    const readyAt = s.clock + 500;
    const choice = choosePutt(hole, field, s.ball, readyAt, skill);
    const angle = choice.angle + gauss(rng) * ((skill.aimDeg * Math.PI) / 180);
    const power = Math.min(1, Math.max(0.02, choice.power * (1 + gauss(rng) * skill.pace)));
    const share = Math.pow(power, 1 / 1.2);
    // Wait for the windmill's moment.
    for (;;) {
      const now = await state();
      if (now.clock >= choice.t - 20) break;
      await sleep(10);
    }
    const useGesture = gesturesAll || s.strokes === 0;
    if (useGesture) {
      // Pull back opposite the aim, in screen terms: up the hole is up the
      // screen, so the pull is down and mirrored. The page reads the drag on
      // the course plane, so this is near, not exact; the page's own line
      // is what it putts.
      const powerPx = Math.max(150, box.height * 0.36);
      const len = 7 + share * powerPx;
      const px = -Math.cos(angle) * len;
      const py = Math.sin(angle) * len;
      await drag(box.x + box.width / 2, box.y + box.height * 0.55, px, py, 420);
    } else {
      await page.evaluate(
        ([dx, dy, sh]) => (window as unknown as QaWindow).__mgQa.putt(dx, dy, sh),
        [Math.cos(angle), Math.sin(angle), share] as [number, number, number],
      );
    }
    if (shots && shotIndex < 6) {
      await sleep(450);
      await page.screenshot({ path: `${out}/${tag}-roll-${shotIndex}.jpg`, type: 'jpeg', quality: 80 });
    }
    shotIndex += 1;
    await sleep(200);
  }
  const s = await state();
  log.push(`hole ${h + 1} (${hole.name}, par ${hole.par}): ${s.scores[h] ?? '?'}`);
}
await sleep(2500);
if (shots) await page.screenshot({ path: `${out}/${tag}-end.jpg`, type: 'jpeg', quality: 80 });
const samples: number[] = await page.evaluate(() => (window as unknown as QaWindow).__gmgQa.samples);
const builds = await page.evaluate(() =>
  performance.getEntriesByName('mini-golf hole build').map((e) => Math.round(e.duration)),
);
const longFrames = await page.evaluate(() => {
  const s = (window as unknown as QaWindow).__gmgQa.samples as number[];
  return s.map((v, i) => [i, Math.round(v)]).filter(([, v]) => v > 50).slice(0, 30);
});
console.log('hole builds ms', builds.join(' '), 'long frames [index, ms]', JSON.stringify(longFrames));
const sorted = [...samples].sort((a, b) => a - b);
const pct = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? 0;
const tier = await page.evaluate(() => {
  const q = performance.getEntriesByName('arcade:quality').at(-1) as PerformanceMeasure | undefined;
  return (q?.detail as { tier?: string } | undefined)?.tier ?? null;
});
console.log(log.join('\n'));
if (posts.length) console.log(posts.join('\n'));
console.log(
  JSON.stringify(
    {
      tag,
      firstFrameMs: firstFrame && Math.round(firstFrame),
      frames: samples.length,
      p50: +pct(0.5).toFixed(1),
      p90: +pct(0.9).toFixed(1),
      p99: +pct(0.99).toFixed(1),
      max: +(sorted.at(-1) ?? 0).toFixed(1),
      over20: samples.filter((v) => v > 20).length,
      tier,
      errors,
    },
    null,
    2,
  ),
);
await context.close();
await browser.close();
