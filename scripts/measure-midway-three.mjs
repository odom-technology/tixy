#!/usr/bin/env node
/**
 * Frame budget measurement for the 3D boardwalk games (docs/design/tixy-rebrand/THREE.md).
 *
 *   node scripts/measure-midway-three.mjs --base=http://127.0.0.1:3106 \
 *     --games=skee-ball,high-striker --label=after --out=/tmp/three-qa \
 *     [--cookie=<arcade_session> | --cookie-file=<curl jar>] [--hints=phone|host]
 *     [--seconds=14] [--runs=3] [--screens | --screens-only] [--clear] [--no-webgl]
 *     [--desktop] [--throttle=4]
 *
 * What it does, per game:
 * - Headless Chromium on SwiftShader (`--enable-unsafe-swiftshader
 *   --use-angle=swiftshader`), a 390 x 844 touch viewport at DPR 3, the CPU
 *   throttled 4x through CDP, and `?arcadePerf=1`.
 * - First frame: milliseconds from navigation start to the animation frame
 *   after the first draw into the canvas. Measured from outside the game by
 *   wrapping the draw calls, so it reads the same before and after a change
 *   to the kit. It is performance.now() at that frame, not the rAF
 *   timestamp: under load the timestamp is when the frame began, seconds
 *   before the scene build finished.
 *   It also records when the page first asks for a WebGL context, so the
 *   scene build (first frame minus that) can be told apart from page boot.
 * - Frame times: the length of every animation frame that drew, while the
 *   script plays the game (median and p90).
 * - Tier: the last `arcade:quality` measure the kit published, if any.
 *
 * `--hints=phone` reports navigator.deviceMemory 4 and hardwareConcurrency 8,
 * a mid-range phone. `--hints=host` leaves the machine's own values.
 * `--screens` also saves screenshots at 1280 and 390 wide, unthrottled;
 * `--screens-only` skips the measuring. `--clear` hides the start cards.
 * `--no-webgl` launches with WebGL off and only takes screenshots.
 *
 * How to use it:
 * - Measure a production build (`npm run build && npm start`). The dev server
 *   compiles on first load and its first frame means nothing.
 * - Run the base branch and your branch with the same script and compare.
 * - Add a driver for a new game to DRIVERS, so the run keeps its render loop
 *   busy; an idle game draws no frames to time.
 * - The cookie is a throwaway account from /api/account/register, funded in
 *   your own database when the game is a wager machine.
 *
 * SwiftShader renders on the CPU, and the 4x throttle doesn't reach the GPU
 * process, so every number here is pessimistic next to a real phone GPU.
 * Compare runs against each other, not against the budget alone.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    return m ? [m[1], m[2] ?? true] : [a, true];
  }),
);

const BASE = String(args.base ?? 'http://127.0.0.1:3106').replace(/\/$/, '');
const GAMES = String(args.games ?? 'skee-ball,high-striker,lucky-cage,prize-claw').split(',');
const LABEL = String(args.label ?? 'run');
const OUT = String(args.out ?? '/tmp/three-qa');
const SECONDS = Number(args.seconds ?? 14);
const HINTS = String(args.hints ?? 'phone');
const NO_WEBGL = Boolean(args['no-webgl']);
// --desktop measures at 1280 x 900 instead of the 390 phone; --throttle=1 turns the CPU throttle off.
const DESKTOP = Boolean(args.desktop);
const THROTTLE = Number(args.throttle ?? 4);
const CHROME = process.env.PLAYWRIGHT_EXECUTABLE_PATH;

const launchArgs = NO_WEBGL
  ? ['--disable-webgl', '--disable-3d-apis']
  : ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist'];

/* Runs in the page before any game code. */
function instrument(hints) {
  const state = {
    contextAt: null,
    firstDraw: null,
    firstFrame: null,
    draws: 0,
    samples: [],
    recording: false,
  };
  window.__midwayMeasure = state;
  if (hints === 'phone') {
    Object.defineProperty(Navigator.prototype, 'deviceMemory', { get: () => 4 });
    Object.defineProperty(Navigator.prototype, 'hardwareConcurrency', { get: () => 8 });
  }
  // When the page first asks for a WebGL context: scene build starts here, so
  // first frame minus this is the kit's share and the rest is page boot.
  const getContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function context(type, ...rest) {
    if (state.contextAt === null && (type === 'webgl2' || type === 'webgl')) {
      state.contextAt = performance.now();
    }
    return getContext.call(this, type, ...rest);
  };
  // Only draws into the canvas itself count. Shadow maps and PMREM draw into
  // framebuffers first, and those are not a frame the player sees.
  const wrap = (proto) => {
    if (!proto) return;
    const bind = proto.bindFramebuffer;
    proto.bindFramebuffer = function bound(target, framebuffer) {
      this.__measureOffscreen = framebuffer !== null;
      return bind.call(this, target, framebuffer);
    };
    for (const name of ['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced']) {
      const original = proto[name];
      if (typeof original !== 'function') continue;
      proto[name] = function wrapped(...rest) {
        if (!this.__measureOffscreen) {
          if (state.firstDraw === null) state.firstDraw = performance.now();
          state.draws += 1;
        }
        return original.apply(this, rest);
      };
    }
  };
  wrap(window.WebGLRenderingContext?.prototype);
  wrap(window.WebGL2RenderingContext?.prototype);
  let lastTick = null;
  let lastDraws = 0;
  const tick = (now) => {
    if (state.draws !== lastDraws) {
      // performance.now(), not the rAF timestamp: under load the timestamp is
      // when the frame began, well before the frame's work finished.
      if (state.firstFrame === null) state.firstFrame = performance.now();
      if (state.recording && lastTick !== null) state.samples.push(now - lastTick);
    }
    lastDraws = state.draws;
    lastTick = now;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function quantile(values, q) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * q) - 1));
  return sorted[idx];
}

async function press(page, key = 'Space') {
  await page.keyboard.press(key);
}

/** Play enough of each game to keep its render loop busy. */
const DRIVERS = {
  // Derby: a practice race with seven bots; space held squirts, the arrows
  // sweep the aim back and forth across the target's path.
  async derby(page, ms) {
    await page.locator('canvas').first().scrollIntoViewIfNeeded();
    await press(page); // the gate
    await sleep(3200);
    await page.keyboard.down('Space');
    const end = Date.now() + ms;
    let right = true;
    while (Date.now() < end) {
      const key = right ? 'ArrowRight' : 'ArrowLeft';
      await page.keyboard.down(key);
      await sleep(450);
      await page.keyboard.up(key);
      right = !right;
    }
    await page.keyboard.up('Space');
  },

  async 'coin-pusher'(page, ms) {
    // Coins every 400 ms across the width: the machine moves the whole time.
    const stage = page.locator('.cp-stage').first();
    await stage.scrollIntoViewIfNeeded().catch(() => undefined);
    const box = await stage.boundingBox();
    const end = Date.now() + ms;
    let i = 0;
    while (Date.now() < end && box) {
      await page.mouse.click(box.x + box.width * (0.3 + ((i++ * 0.17) % 0.4)), box.y + box.height * 0.45);
      await sleep(400);
    }
  },
  async 'skee-ball'(page, ms) {
    await page.locator('canvas').first().scrollIntoViewIfNeeded();
    await press(page); // start
    await sleep(1500);
    const end = Date.now() + ms;
    while (Date.now() < end) {
      await press(page); // keyboard throw
      await sleep(3200);
    }
  },
  async 'high-striker'(page, ms) {
    await page.locator('canvas').first().scrollIntoViewIfNeeded();
    await press(page); // start
    await sleep(1200);
    const end = Date.now() + ms;
    while (Date.now() < end) {
      await press(page); // swing
      await sleep(2600);
    }
  },
  async 'ring-toss'(page, ms) {
    await page.locator('canvas').first().scrollIntoViewIfNeeded();
    await press(page); // start
    await sleep(1200);
    const end = Date.now() + ms;
    let i = 0;
    while (Date.now() < end) {
      // Move the hand a little and set the power, then toss with space.
      const key = i % 2 === 0 ? 'ArrowLeft' : 'ArrowRight';
      await page.keyboard.down(key);
      await sleep(180);
      await page.keyboard.up(key);
      await press(page);
      i += 1;
      await sleep(2400);
    }
  },
  async 'lucky-cage'(page, ms) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      // The stage itself turns the crank, and tapping it keeps it in view.
      const stage = page.locator('[aria-label="turn the crank and draw five balls"]').first();
      if ((await stage.getAttribute('aria-disabled').catch(() => 'true')) === 'false') {
        await stage.click({ timeout: 5000 }).catch(() => undefined);
      }
      await sleep(1000);
    }
  },
  async 'prize-claw'(page, ms) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      const buy = page.getByRole('button', { name: /^play/i });
      if (await buy.isEnabled().catch(() => false)) {
        await buy.click({ timeout: 5000 }).catch(() => undefined);
        await page.locator('canvas').first().scrollIntoViewIfNeeded().catch(() => undefined);
        // Move the claw a little so the gantry renders, then drop.
        const stage = page.locator('[aria-label^="prize claw cabinet"]').first();
        await stage.focus().catch(() => undefined);
        for (let i = 0; i < 4; i += 1) {
          await page.keyboard.down('ArrowLeft');
          await sleep(250);
          await page.keyboard.up('ArrowLeft');
        }
        await press(page);
      }
      await sleep(1000);
    }
  },
};

async function newContext(browser, { mobile, cookie }) {
  const context = await browser.newContext(
    mobile
      ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true }
      : { viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 },
  );
  if (cookie) {
    await context.addCookies([
      { name: 'arcade_session', value: cookie, url: BASE, httpOnly: true, sameSite: 'Lax' },
    ]);
  }
  return context;
}

async function measure(browser, game, cookie) {
  const context = await newContext(browser, { mobile: !DESKTOP, cookie });
  await context.addInitScript(instrument, HINTS);
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: THROTTLE });
  await page.goto(`${BASE}/${game}?arcadePerf=1`, { waitUntil: 'commit', timeout: 120000 });
  const deadline = Date.now() + 60000;
  let firstFrame = null;
  while (Date.now() < deadline) {
    firstFrame = await page.evaluate(() => window.__midwayMeasure?.firstFrame ?? null).catch(() => null);
    if (firstFrame !== null) break;
    await sleep(100);
  }
  await page.waitForLoadState('load').catch(() => undefined);
  await sleep(1500);
  await page.evaluate(() => {
    window.__midwayMeasure.recording = true;
  });
  const driver = DRIVERS[game];
  if (driver) await driver(page, SECONDS * 1000);
  const result = await page.evaluate(() => {
    const m = window.__midwayMeasure;
    m.recording = false;
    const quality = performance.getEntriesByName('arcade:quality').at(-1);
    const ready = performance.getEntriesByName('arcade:game-ready').at(-1);
    return {
      contextAt: m.contextAt,
      firstFrame: m.firstFrame,
      firstDraw: m.firstDraw,
      samples: m.samples,
      quality: quality ? quality.detail : null,
      ready: ready ? { duration: ready.duration, detail: ready.detail } : null,
    };
  });
  await context.close();
  return {
    game,
    firstFrameMs: result.firstFrame === null ? null : Math.round(result.firstFrame),
    contextMs: result.contextAt === null ? null : Math.round(result.contextAt),
    frames: result.samples.length,
    medianMs: quantile(result.samples, 0.5),
    p90Ms: quantile(result.samples, 0.9),
    tier: result.quality?.tier ?? null,
    quality: result.quality,
    ready: result.ready,
  };
}

async function screens(browser, game, cookie) {
  const files = [];
  for (const mobile of [false, true]) {
    const context = await newContext(browser, { mobile, cookie });
    const page = await context.newPage();
    await page.goto(`${BASE}/${game}`, { waitUntil: 'load', timeout: 120000 });
    if (args.clear) {
      // Hide the start cards so the cabinet itself is in the shot.
      await page.addStyleTag({
        content: '.sb-overlay, .hs-overlay { display: none !important; }',
      });
    }
    await sleep(NO_WEBGL ? 1500 : 4000);
    const file = path.join(
      OUT,
      `${game}-${LABEL}${NO_WEBGL ? '-no-webgl' : ''}${args.clear ? '-clear' : ''}-${mobile ? 390 : 1280}.jpg`,
    );
    await page.screenshot({ path: file, type: 'jpeg', quality: 80 });
    files.push(file);
    await context.close();
  }
  return files;
}

await fs.mkdir(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: CHROME, args: launchArgs });
async function readCookie() {
  if (args.cookie) return String(args.cookie);
  if (args['cookie-file']) {
    // A curl cookie jar: the session value is the last field of its line.
    const jar = await fs.readFile(String(args['cookie-file']), 'utf8');
    const line = jar.split('\n').find((l) => l.includes('\tarcade_session\t'));
    return line ? line.trim().split('\t').at(-1) : undefined;
  }
  return process.env.ARCADE_SESSION;
}
const cookie = await readCookie();
const rows = [];
const RUNS = Math.max(1, Number(args.runs ?? 1));
const middle = (values) => quantile(values.filter((v) => v !== null), 0.5);
for (const game of GAMES) {
  if (!NO_WEBGL && !args['screens-only']) {
    const runs = [];
    for (let i = 0; i < RUNS; i += 1) runs.push(await measure(browser, game, cookie));
    // Each figure is the median across runs; the tier is the last run's.
    const row = {
      game,
      runs: RUNS,
      firstFrameMs: middle(runs.map((r) => r.firstFrameMs)),
      contextMs: middle(runs.map((r) => r.contextMs)),
      buildMs: middle(
        runs.map((r) =>
          r.firstFrameMs === null || r.contextMs === null ? null : r.firstFrameMs - r.contextMs,
        ),
      ),
      medianMs: middle(runs.map((r) => r.medianMs)),
      p90Ms: middle(runs.map((r) => r.p90Ms)),
      frames: middle(runs.map((r) => r.frames)),
      tier: runs.at(-1).tier,
      tiers: runs.map((r) => r.tier),
      perRun: runs,
    };
    rows.push(row);
    console.log(
      `${LABEL} ${game}: first frame ${row.firstFrameMs} ms ` +
        `(context at ${row.contextMs} ms, build ${row.buildMs} ms), ` +
        `median ${row.medianMs?.toFixed(1)} ms, p90 ${row.p90Ms?.toFixed(1)} ms ` +
        `over ${row.frames} frames, tier ${row.tiers.map((t) => t ?? 'none').join('/')}` +
        ` (${RUNS} runs; first frames ${runs.map((r) => r.firstFrameMs).join(', ')})`,
    );
  }
  if (args.screens || args['screens-only'] || NO_WEBGL) {
    const files = await screens(browser, game, cookie);
    console.log(`${LABEL} ${game}: ${files.map((f) => path.basename(f)).join(', ')}`);
  }
}
await browser.close();
if (rows.length) {
  await fs.writeFile(
    path.join(OUT, `measure-${LABEL}-${HINTS}.json`),
    JSON.stringify(rows, null, 2),
  );
}
