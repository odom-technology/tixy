/**
 * Ricochet browser QA: a bot flies a run with real pointer input, records a
 * video, takes stills and reports frame times.
 *
 *   npx tsx scripts/qa-ricochet.mts [--mobile] [--reduced] [--walls=12]
 *     [--skill=strong] [--throttle=4] [--video] [--seed=123] [--signed]
 *     [--out=/tmp/ricochet-qa] [--base=http://127.0.0.1:3217]
 *
 * --signed registers a throwaway account first, so the run saves and pays
 * (the score response is printed).
 *
 * The bot lives in the page (so its taps land on frame boundaries the way a
 * hand's do): it reads the run through ?arcadePerf=1's window.__ricochet,
 * aims at the gap it is flying toward with a per-wall error, flaps when it is
 * below that and not rising, and stops flapping after --walls walls so the
 * bird dies. Frame times are the page's own rAF intervals; --throttle sets CDP
 * CPU throttling.
 */
import { mkdirSync, renameSync } from 'node:fs';

import { chromium } from 'playwright';

const args = Object.fromEntries(
  process.argv.slice(2).map((arg) => {
    const match = arg.match(/^--([^=]+)(?:=(.*))?$/);
    return match ? [match[1], match[2] ?? 'true'] : [arg, 'true'];
  }),
) as Record<string, string>;

const base = args.base ?? 'http://127.0.0.1:3217';
const mobile = args.mobile === 'true';
const reduced = args.reduced === 'true';
const walls = Number(args.walls ?? 12);
const throttle = args.throttle ? Number(args.throttle) : null;
const video = args.video === 'true';
const signed = args.signed === 'true';
const out = args.out ?? '/tmp/ricochet-qa';
const skills = {
  casual: { aimSd: 40, lagMean: 5, lagSd: 2.2, lapse: 0.025 },
  good: { aimSd: 28, lagMean: 4, lagSd: 1.5, lapse: 0.01 },
  strong: { aimSd: 18, lagMean: 3.5, lagSd: 1, lapse: 0.004 },
  expert: { aimSd: 10, lagMean: 3, lagSd: 0.6, lapse: 0.001 },
} as const;
const skill = skills[(args.skill ?? 'strong') as keyof typeof skills];
const tag = [mobile ? '390' : '1280', reduced ? 'reduced' : '', throttle ? `cpu${throttle}x` : ''].filter(Boolean).join('-');
mkdirSync(out, { recursive: true });

const viewport = mobile ? { width: 390, height: 844 } : { width: 1280, height: 800 };
const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH,
  args: ['--disable-blink-features=AutomationControlled'],
});
const context = await browser.newContext({
  viewport,
  deviceScaleFactor: mobile ? 3 : 1,
  hasTouch: mobile,
  isMobile: mobile,
  reducedMotion: reduced ? 'reduce' : 'no-preference',
  ...(video ? { recordVideo: { dir: out, size: viewport } } : {}),
});
const page = await context.newPage();
const videoStart = Date.now();
const errors: string[] = [];
page.on('pageerror', (error) => errors.push(error.message));
page.on('console', (message) => {
  if (message.type() === 'error' && !/401|Unauthorized/.test(message.text())) errors.push(message.text().slice(0, 200));
});

let scoreResponse: { status: number; body: unknown } | null = null;
let postedBody: { score: number; taps: number[] } | null = null;
page.on('response', async (response) => {
  if (response.url().includes('/api/games/ricochet/score') && response.request().method() === 'POST') {
    scoreResponse = { status: response.status(), body: await response.json().catch(() => null) };
    postedBody = JSON.parse(response.request().postData() ?? 'null');
  }
});
if (signed) {
  const name = `ric${Date.now().toString(36)}`;
  const register = await page.request.post(`${base}/api/account/register`, {
    data: { email: `${name}@example.test`, password: `pw-${name}-Aa1!`, username: name },
  });
  if (!register.ok()) throw new Error(`register ${register.status()} ${await register.text()}`);
  console.log(`signed in as ${name}`);
}

// tsx wraps functions with a name helper the page doesn't have.
await page.addInitScript('window.__name = (f) => f;');

const seedParam = args.seed ? `&seed=${args.seed}` : '';
await page.goto(`${base}/ricochet?arcadePerf=1${seedParam}`, { waitUntil: 'networkidle', timeout: 180_000 });
await page.addStyleTag({ content: '.fixed.z-\\[200\\] { display: none !important; }' });
await page.waitForTimeout(900);
await page.screenshot({ path: `${out}/ready-${tag}.jpg`, type: 'jpeg', quality: 80 });

if (throttle) {
  const cdp = await context.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle });
}

const screen = page.locator('.arc-shell-screen');
const box = (await screen.boundingBox())!;
const x = box.x + box.width / 2;
const y = box.y + box.height * 0.8;
if (mobile) await page.touchscreen.tap(x, y);
else await page.mouse.click(x, y);
await page.waitForFunction(() => window.__ricochet?.phase() === 'playing', null, { timeout: 20_000 });

// The bot, in the page.
await page.evaluate(
  ({ skill, walls, touch }) => {
    const r = window.__ricochet!;
    const stage = document.querySelector('.ricochet-stage')!;
    const gauss = () => Math.sqrt(-2 * Math.log(1 - Math.random())) * Math.cos(2 * Math.PI * Math.random());
    let aimWall = 0;
    let seen = { now: 320, next: 320, half: 60 };
    let blockedUntil = 0;
    let pending = false;
    const tap = () => {
      stage.dispatchEvent(
        new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerType: touch ? 'touch' : 'mouse', button: 0, isPrimary: true }),
      );
    };
    const tick = () => {
      if (r.phase() !== 'playing') return;
      const s = r.state();
      if (s.score < walls) {
        if (s.wall !== aimWall) {
          aimWall = s.wall;
          const g = r.gapFor(aimWall);
          const n = r.gapFor(aimWall + 1);
          seen = {
            now: (g.start + g.end) / 2 + gauss() * skill.aimSd,
            next: (n.start + n.end) / 2 + gauss() * skill.aimSd,
            half: g.height / 2,
          };
        }
        const toWall = s.dir > 0 ? 446 - s.x : s.x - 34;
        const band = seen.half * 0.7;
        const aim = Math.min(590, Math.max(50, toWall > 70 ? Math.min(seen.now + band, Math.max(seen.now - band, seen.next)) : seen.now));
        const below = s.y - aim;
        const rising = below > 160 ? -5 : below > 80 ? -3 : -1.5;
        if (!pending && s.step >= blockedUntil && below > 21 && s.vy > rising) {
          if (Math.random() < skill.lapse) blockedUntil = s.step + 9;
          else {
            pending = true;
            const lag = Math.max(0, Math.round(skill.lagMean + gauss() * skill.lagSd));
            setTimeout(() => {
              pending = false;
              tap();
            }, (lag * 1000) / 60);
          }
        }
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  },
  { skill, walls, touch: mobile },
);

// Stills: the climb, a bounce and the death.
let shots = 0;
let lastScore = 0;
let died = false;
for (let guard = 0; guard < 4000 && !died; guard += 1) {
  const s = await page.evaluate(() => ({ phase: window.__ricochet?.phase(), score: window.__ricochet?.state().score ?? 0 }));
  if (s.phase !== 'playing') {
    died = true;
    break;
  }
  if (s.score !== lastScore) {
    lastScore = s.score;
    if (shots < 3 && (s.score === 2 || s.score === 5 || s.score === Math.max(3, walls - 2))) {
      await page.waitForTimeout(40);
      await page.screenshot({ path: `${out}/play${++shots}-${tag}.jpg`, type: 'jpeg', quality: 80 });
    }
  }
  await page.waitForTimeout(30);
}
await page.waitForTimeout(160);
await page.screenshot({ path: `${out}/death-${tag}.jpg`, type: 'jpeg', quality: 80 });
await page.waitForFunction(() => document.querySelector('.arc-shell-end') != null, null, { timeout: 15_000 });
await page.waitForTimeout(3200);
await page.screenshot({ path: `${out}/result-${tag}.jpg`, type: 'jpeg', quality: 80 });

const frames = ((await page.evaluate(() => window.__ricochetFrames ?? [])) as number[]).filter((f) => f > 0);
const sorted = [...frames].sort((a, b) => a - b);
const q = (p: number) => Math.round(sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]! * 10) / 10;
const taps = (await page.evaluate(() => window.__ricochet?.taps() ?? [])) as number[];
const events = (await page.evaluate(() => window.__ricochetEvents ?? [])) as Array<{ kind: string; at: number }>;
const paints = (await page.evaluate(() => window.__ricochetPaints ?? [])) as Array<[number, number, number]>;
// Between two paints the bird should move, and by about the same each time:
// a 60 Hz sample drawn twice on a 120 Hz screen would show as a repeat.
let repeats = 0;
let moves = 0;
for (let i = 1; i < paints.length; i += 1) {
  const dt = paints[i]![0] - paints[i - 1]![0];
  if (dt <= 0 || dt > 50) continue;
  moves += 1;
  if (Math.abs(paints[i]![1] - paints[i - 1]![1]) < 1e-6 && Math.abs(paints[i]![2] - paints[i - 1]![2]) < 1e-6) repeats += 1;
}
const report = {
  video: {
    // Seconds into the video (give or take the encoder's start).
    bounces: events.filter((e) => e.kind === 'bounce').map((e) => Math.round(((e.at - videoStart) / 1000) * 100) / 100),
    death: events.filter((e) => e.kind === 'death').map((e) => Math.round(((e.at - videoStart) / 1000) * 100) / 100),
  },
  paints: { count: paints.length, moves, repeatedPositions: repeats },
  tag,
  walls: lastScore,
  taps: taps.length,
  frames: frames.length
    ? {
        count: frames.length,
        meanMs: Math.round((frames.reduce((a, b) => a + b, 0) / frames.length) * 10) / 10,
        p50: q(0.5),
        p95: q(0.95),
        p99: q(0.99),
        max: q(1),
        over20ms: frames.filter((f) => f > 20).length,
        // Where in the run they fell, as a share of the frames.
        over20At: frames.flatMap((f, i) => (f > 20 ? [Math.round((i / frames.length) * 100) / 100] : [])),
      }
    : null,
  errors,
};
console.log(JSON.stringify(report, null, 2));

if (signed) {
  await page.waitForTimeout(1500);
  console.log('score response:', JSON.stringify(scoreResponse));
  console.log('posted:', JSON.stringify({ score: (postedBody as { score?: number } | null)?.score, taps: (postedBody as { taps?: number[] } | null)?.taps?.length }));
}

const videoPath = video ? await page.video()?.path() : null;
await context.close();
await browser.close();
if (videoPath) {
  const named = `${out}/run-${tag}.webm`;
  renameSync(videoPath, named);
  console.log(`video: ${named}`);
}
