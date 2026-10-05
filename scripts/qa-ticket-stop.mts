/**
 * Ticket stop browser QA: plays one run with real input and reports what the
 * player and the server saw.
 *
 *   npx tsx scripts/qa-ticket-stop.mts [--mobile] [--signed] [--reduced]
 *     [--theme=tixy|boardwalk] [--hz=120] [--aim=0,15,-10] [--strip]
 *     [--out=/tmp/ticket-stop-qa] [--base=http://127.0.0.1:3110]
 *
 * --aim is ms off the centre bulb's middle for each round (0 is a perfect).
 * --strip saves a frame strip of round 1. --hz=120 launches Chromium with
 * its frame-rate limit off and reports the rAF rate it reached.
 * Needs a dev or production server and Playwright's Chromium.
 */
import { mkdirSync } from 'node:fs';
import { performance } from 'node:perf_hooks';

import { chromium, type Page } from 'playwright';

import {
  TICKET_STOP_BULBS,
  ticketStopFirstCentreMs,
  ticketStopLayout,
  ticketStopRoundStart,
} from '../src/server/arcade/ticket-stop-engine';

const args = Object.fromEntries(
  process.argv.slice(2).map((arg) => {
    const match = arg.match(/^--([^=]+)(?:=(.*))?$/);
    return match ? [match[1], match[2] ?? 'true'] : [arg, 'true'];
  }),
) as Record<string, string>;

const base = args.base ?? 'http://127.0.0.1:3110';
const mobile = args.mobile === 'true';
const signed = args.signed === 'true';
const reduced = args.reduced === 'true';
const theme = args.theme ?? 'tixy';
const hz = args.hz ? Number(args.hz) : null;
const aims = (args.aim ?? '0,0,0').split(',').map(Number);
const out = args.out ?? '/tmp/ticket-stop-qa';
const tag = [mobile ? '390' : '1280', theme, signed ? 'signed' : 'guest', reduced ? 'reduced' : '', hz ? `${hz}hz` : '']
  .filter(Boolean)
  .join('-');
mkdirSync(out, { recursive: true });

// --hz: headless Chromium runs rAF at 60 Hz whatever the flags say, so the
// shell is driven frame by frame over CDP (HeadlessExperimental.beginFrame)
// at the asked rate instead.
const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH,
  // Without AutomationControlled off, the anti-cheat's webdriver check
  // rejects every QA run.
  args: [
    '--disable-blink-features=AutomationControlled',
    ...(hz ? ['--enable-begin-frame-control', '--run-all-compositor-stages-before-draw'] : []),
  ],
});
const context = await browser.newContext({
  viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 800 },
  deviceScaleFactor: mobile ? 3 : 1,
  hasTouch: mobile,
  isMobile: mobile,
  reducedMotion: reduced ? 'reduce' : 'no-preference',
});
const page = await context.newPage();
let framesRunning = Boolean(hz);
if (hz) {
  const cdp = await context.newCDPSession(page);
  const interval = 1000 / hz;
  void (async () => {
    let next = performance.now();
    while (framesRunning) {
      next += interval;
      await cdp.send('HeadlessExperimental.beginFrame', { interval }).catch(() => {});
      const wait = next - performance.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    }
  })();
}
const errors: string[] = [];
page.on('pageerror', (error) => errors.push(error.message));
page.on('console', (message) => {
  if (message.type() === 'error' && !/401|Unauthorized/.test(message.text())) errors.push(message.text().slice(0, 200));
});

if (signed) {
  const name = `stop${Date.now().toString(36)}`;
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
page.on('response', async (response) => {
  if (response.url().includes('/api/games/ticket-stop/score') && response.request().method() === 'POST') {
    scoreResponse = { status: response.status(), body: await response.json().catch(() => null) };
  }
});

await page.goto(`${base}/ticket-stop?arcadePerf=1`, { waitUntil: 'networkidle', timeout: 180_000 });
if (!signed) {
  // Guests get the default theme; force the one under test.
  await page.evaluate((t) => document.documentElement.setAttribute('data-arcade-theme', t), theme);
}
// ?arcadePerf=1 draws its overlay; keep it out of the screenshots.
await page.addStyleTag({ content: '.fixed.z-\\[200\\] { display: none !important; }' });
await page.waitForTimeout(1200);
await page.screenshot({ path: `${out}/ready-${tag}.jpg`, type: 'jpeg', quality: 80 });

// A string, not a function: tsx's name helper doesn't exist in the page.
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
const press = async (x = box.x + box.width / 2, y = box.y + box.height * 0.6) => {
  if (mobile) await page.touchscreen.tap(x, y);
  else await page.mouse.click(x, y);
};

/** page performance.now() minus node performance.now(). */
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

await press();
await page.waitForFunction(() => Boolean(window.__ticketStopRun), null, { timeout: 15_000 });
const run = (await page.evaluate(() => window.__ticketStopRun))!;
const layout = ticketStopLayout(run.seed);
const { offset, rtt } = await clockOffset(page);
const scrollYs: number[] = [];

const stops: number[] = [];
for (let i = 0; i < 3; i += 1) {
  const round = layout.rounds[i];
  const start = ticketStopRoundStart(stops, i);
  // Aim at the centre bulb's middle on the second pass.
  const target = start + ticketStopFirstCentreMs(round) + TICKET_STOP_BULBS * round.stepMs + round.stepMs / 2 + (aims[i] ?? 0);
  if (i === 0 && args.strip === 'true') {
    // A frame strip of round 1: eight frames across one lap.
    for (let f = 0; f < 8; f += 1) {
      const at = start + 120 + f * ((TICKET_STOP_BULBS * round.stepMs) / 8);
      const wait = run.runStart + at - offset - performance.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      await page.screenshot({ path: `${out}/strip-${tag}-${f + 1}.jpg`, type: 'jpeg', quality: 80 });
    }
  }
  // Send the input so it lands on the target, allowing for half the round trip.
  const wait = run.runStart + target - offset - performance.now() - rtt / 2;
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  await press();
  // The next round's clock starts from this stop (within a few ms of target).
  stops.push(Math.round(target));
  scrollYs.push(await page.evaluate(() => window.scrollY));
  await page.waitForTimeout(150);
  await page.screenshot({ path: `${out}/stop${i + 1}-${tag}.jpg`, type: 'jpeg', quality: 80 });
  // Wait for the next round to start before aiming again.
  const nextWait = run.runStart + target + 1100 - offset - performance.now();
  if (nextWait > 0) await new Promise((r) => setTimeout(r, Math.min(nextWait, 400)));
}

await page.waitForTimeout(4200);
await page.screenshot({ path: `${out}/result-${tag}.jpg`, type: 'jpeg', quality: 80 });
const hud = await page.$$eval('.ts-round b', (cells) => cells.map((cell) => cell.textContent?.trim()));
const latency = await page.evaluate(() => window.__ticketStopLatency ?? []);
const resultText = await page.locator('.arc-shell-end').innerText().catch(() => '');

// Rematch comes first and starts a new run.
const rematch = page.getByRole('button', { name: 'rematch' });
const rematchFirst = await page.$$eval('.arc-shell-end .arc-result-actions button', (buttons) => buttons[0]?.textContent?.trim() ?? '');
await rematch.click();
await page.waitForTimeout(600);
const phaseAfterRematch = await page.locator('.arc-shell-stage').getAttribute('data-phase');

console.log(
  JSON.stringify(
    {
      tag,
      rafRate: Math.round(rafRate),
      seed: run.seed,
      clockRttMs: Math.round(rtt * 10) / 10,
      hud,
      latency: latency.map((s) => ({ handlerMs: Math.round(s.handlerMs * 10) / 10, frameMs: Math.round(s.frameMs * 10) / 10 })),
      scrollYs,
      resultText: resultText.replace(/\s+/g, ' ').slice(0, 300),
      score: scoreResponse,
      rematchFirst,
      phaseAfterRematch,
      errors,
    },
    null,
    2,
  ),
);
framesRunning = false;
await browser.close();
