/**
 * Ticket stop (the lock) browser QA: a bot plays a run with real input,
 * records a video and reports frame times.
 *
 *   npx tsx scripts/qa-ticket-stop-lock.mts [--mobile] [--reduced]
 *     [--levels=4] [--noise=12] [--throttle=4] [--video] [--seed=123]
 *     [--out=/tmp/ticket-stop-lock-qa] [--base=http://127.0.0.1:3121]
 *     [--signed]
 *
 * --signed registers a throwaway account first, so the run saves and pays
 * (the score response is printed), then tries tampered runs and a replay of
 * the saved session against the score route and prints what each returned.
 *
 * The bot aims each tap at the moment the needle reaches the dot's centre,
 * off by a normal error of --noise ms, clears --levels levels, then lets the
 * needle pass the next dot. --throttle sets CDP CPU throttling and the frame
 * times come from the page's own rAF intervals (?arcadePerf=1).
 */
import { mkdirSync, renameSync } from 'node:fs';
import { performance } from 'node:perf_hooks';

import { chromium, type Page } from 'playwright';

import { LOCK_LEAD_IN_MS, lockHitsThrough, lockLayout, lockReplay } from '../src/server/arcade/ticket-stop-lock-engine';

const args = Object.fromEntries(
  process.argv.slice(2).map((arg) => {
    const match = arg.match(/^--([^=]+)(?:=(.*))?$/);
    return match ? [match[1], match[2] ?? 'true'] : [arg, 'true'];
  }),
) as Record<string, string>;

const base = args.base ?? 'http://127.0.0.1:3121';
const mobile = args.mobile === 'true';
const reduced = args.reduced === 'true';
const levels = Number(args.levels ?? 4);
const noise = Number(args.noise ?? 12);
const throttle = args.throttle ? Number(args.throttle) : null;
const video = args.video === 'true';
const out = args.out ?? '/tmp/ticket-stop-lock-qa';
const signed = args.signed === 'true';
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
const errors: string[] = [];
page.on('pageerror', (error) => errors.push(error.message));
page.on('console', (message) => {
  if (message.type() === 'error' && !/401|Unauthorized/.test(message.text())) errors.push(message.text().slice(0, 200));
});

let scoreResponse: { status: number; body: unknown } | null = null;
let savedPost: { sessionToken: string; taps: number[]; score: number } | null = null;
page.on('response', async (response) => {
  if (response.url().includes('/api/games/ticket-stop/score') && response.request().method() === 'POST') {
    scoreResponse = { status: response.status(), body: await response.json().catch(() => null) };
    savedPost = JSON.parse(response.request().postData() ?? 'null');
  }
});
if (signed) {
  const name = `lock${Date.now().toString(36)}`;
  const register = await page.request.post(`${base}/api/account/register`, {
    data: { email: `${name}@example.test`, password: `pw-${name}-Aa1!`, username: name },
  });
  if (!register.ok()) throw new Error(`register ${register.status()} ${await register.text()}`);
  console.log(`signed in as ${name}`);
}

const seedParam = args.seed ? `&seed=${args.seed}` : '';
await page.goto(`${base}/ticket-stop?arcadePerf=1${seedParam}`, { waitUntil: 'networkidle', timeout: 180_000 });
await page.addStyleTag({ content: '.fixed.z-\\[200\\] { display: none !important; }' });
await page.waitForTimeout(900);
await page.screenshot({ path: `${out}/ready-${tag}.jpg`, type: 'jpeg', quality: 80 });

if (throttle) {
  const cdp = await context.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle });
}

const screen = page.locator('.arc-shell-screen');
const box = (await screen.boundingBox())!;
const press = async () => {
  const x = box.x + box.width / 2;
  const y = box.y + box.height * 0.8;
  if (mobile) await page.touchscreen.tap(x, y);
  else await page.mouse.click(x, y);
};

/** page performance.now() minus node performance.now(). */
async function clockOffset(p: Page) {
  let best = { offset: 0, rtt: Infinity };
  for (let i = 0; i < 10; i += 1) {
    const before = performance.now();
    const pageNow = await p.evaluate(() => performance.now());
    const after = performance.now();
    if (after - before < best.rtt) best = { offset: pageNow - (before + after) / 2, rtt: after - before };
  }
  return best;
}

function normal() {
  const u = Math.max(1e-12, Math.random());
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * Math.random());
}

await press();
await page.waitForFunction(() => Boolean(window.__ticketStopLockRun), null, { timeout: 15_000 });
const run = (await page.evaluate(() => window.__ticketStopLockRun))!;
const layout = lockLayout(run.seed);
const { offset, rtt } = await clockOffset(page);
const target = lockHitsThrough(levels);
let shots = 0;

for (let guard = 0; guard < 400; guard += 1) {
  const taps = (await page.evaluate(() => window.__ticketStopLockRun?.taps ?? [])) as number[];
  const replay = lockReplay(layout, taps);
  if (replay.end || replay.hits.length >= target) break;
  const s = replay.segment;
  const centre = s.startMs + (s.toCentreDeg * 1000) / s.rule.speedDps;
  const aim = centre + normal() * noise;
  const wait = run.runStart + aim - offset - performance.now() - rtt / 2;
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  await press();
  // A few stills: mid-level and a level clear.
  if (shots < 3 && (replay.hits.length === 2 || s.dot.inLevel === s.rule.hits - 1)) {
    await page.waitForTimeout(s.dot.inLevel === s.rule.hits - 1 ? 260 : 70);
    await page.screenshot({ path: `${out}/play${++shots}-${tag}.jpg`, type: 'jpeg', quality: 80 });
  }
  await page.waitForTimeout(25);
}

// Let the needle pass the next dot: the miss.
await page.waitForTimeout(400);
await page.screenshot({ path: `${out}/miss-${tag}.jpg`, type: 'jpeg', quality: 80 });
await page.waitForFunction(() => document.querySelector('.arc-shell-end') != null, null, { timeout: 15_000 });
await page.waitForTimeout(1600);
await page.screenshot({ path: `${out}/result-${tag}.jpg`, type: 'jpeg', quality: 80 });

const taps = (await page.evaluate(() => window.__ticketStopLockRun?.taps ?? [])) as number[];
const final = lockReplay(layout, taps, Infinity);
const frames = ((await page.evaluate(() => window.__ticketStopFrames ?? [])) as number[]).filter((f) => f > 0);
const sorted = [...frames].sort((a, b) => a - b);
const q = (p: number) => Math.round(sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] * 10) / 10;
const report = {
  tag,
  seed: run.seed,
  clockRttMs: Math.round(rtt * 10) / 10,
  hits: final.hits.length,
  level: final.segment.dot.level,
  end: final.end?.kind,
  offsetsMs: final.hits.map((h) => Math.round(h.offsetMs)),
  frames: frames.length
    ? {
        count: frames.length,
        meanMs: Math.round((frames.reduce((a, b) => a + b, 0) / frames.length) * 10) / 10,
        p50: q(0.5),
        p95: q(0.95),
        p99: q(0.99),
        max: q(1),
        over20ms: frames.filter((f) => f > 20).length,
      }
    : null,
  errors,
};
console.log(JSON.stringify(report, null, 2));

if (signed) {
  await page.waitForTimeout(2500);
  console.log('score response:', JSON.stringify(scoreResponse));
  const saved = savedPost as { sessionToken: string; taps: number[]; score: number } | null;
  if (saved) {
    const post = async (body: unknown) => {
      // The route's one-second cooldown between score posts.
      await page.waitForTimeout(1200);
      const response = await page.request.post(`${base}/api/games/ticket-stop/score`, { data: body });
      return `${response.status()} ${(await response.text()).slice(0, 140)}`;
    };
    // The saved session again: a replayed post.
    console.log('replayed session   ->', await post({ ...saved }));
    // A fresh session, started, then tampered runs against it.
    const fresh = (await (await page.request.post(`${base}/api/games/session`, { data: { gameType: 'ticket-stop' } })).json()) as {
      token: string;
      sessionId: string;
      ticketStopSeed: number;
    };
    await page.request.patch(`${base}/api/games/session`, { data: { sessionId: fresh.sessionId, action: 'start' } });
    const freshLayout = lockLayout(fresh.ticketStopSeed);
    const exact: number[] = [];
    for (let i = 0; i < 8; i += 1) {
      const seg = lockReplay(freshLayout, exact).segment;
      exact.push(Math.round(seg.startMs + (seg.toCentreDeg * 1000) / seg.rule.speedDps));
    }
    const tampered: Array<[string, unknown]> = [
      // A one-tap miss fits inside the session's age, so this reaches the score check.
      ['claims 9 for a miss ', { score: 9, sessionToken: fresh.token, taps: [LOCK_LEAD_IN_MS + 1] }],
      ['tap while it waits  ', { score: 0, sessionToken: fresh.token, taps: [100] }],
      ['taps out of order   ', { score: 1, sessionToken: fresh.token, taps: [2000, 1000] }],
      ['fractional tap      ', { score: 1, sessionToken: fresh.token, taps: [exact[0] + 0.5] }],
      ['run longer than the session', { score: 8, sessionToken: fresh.token, taps: exact }],
      ['wrong session token ', { score: 8, sessionToken: saved.sessionToken, taps: exact }],
    ];
    for (const [label, body] of tampered) console.log(`tampered ${label} ->`, await post(body));
  }
}

const videoPath = video ? await page.video()?.path() : null;
await context.close();
await browser.close();
if (videoPath) {
  const named = `${out}/run-${tag}.webm`;
  renameSync(videoPath, named);
  console.log(`video: ${named}`);
}
