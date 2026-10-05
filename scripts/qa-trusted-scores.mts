/**
 * Browser pass for the trusted scores: a signed-in run of 2048 and of snake
 * with real key presses, each to a score that pays, against a production
 * server.
 *
 *   npx tsx scripts/qa-trusted-scores.mts [--base=http://127.0.0.1:3417]
 *     [--out=/tmp/trusted-qa]
 *
 * 2048 presses arrow keys at 120 ms until the board is stuck, which saves the
 * run. Snake can't be steered blind, so the script reads the session's seed
 * from the page's own session response, deals the first apple the way the
 * client does, and plays the runs whose first apple is in the snake's row, ahead of
 * it: the run eats it, crashes at the wall and is saved.
 * It lets the other runs crash and starts again. Both runs go through the real
 * client, the real score route and the real replay.
 */
import { mkdirSync } from 'node:fs';

import { chromium } from 'playwright';

import { createSnakeRng, generateFoodPosition } from '../src/app/(games)/snake/_snake-helpers';
import { createSpawnRng, initialBoard2048 } from '../src/server/arcade/game-2048-replay';

const args = Object.fromEntries(
  process.argv.slice(2).map((arg) => {
    const match = arg.match(/^--([^=]+)(?:=(.*))?$/);
    return match ? [match[1], match[2] ?? 'true'] : [arg, 'true'];
  }),
) as Record<string, string>;
const base = args.base ?? 'http://127.0.0.1:3417';
const out = args.out ?? '/tmp/trusted-qa';
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH,
  // The snake route's anti-cheat rejects a webdriver browser.
  args: ['--disable-blink-features=AutomationControlled'],
});
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
await context.addInitScript("Object.defineProperty(navigator, 'webdriver', { get: () => false });");
const page = await context.newPage();
const errors: string[] = [];
page.on('pageerror', (error) => errors.push(error.message));

const name = `trq${Date.now().toString(36)}`;
const register = await page.request.post(`${base}/api/account/register`, {
  data: { email: `${name}@example.test`, password: `pw-${name}-Aa1!`, username: name },
});
if (!register.ok()) throw new Error(`register ${register.status()} ${await register.text()}`);

type ScoreResult = { status: number; body: Record<string, unknown> | null };
const scoreResults: Record<string, ScoreResult[]> = { '2048': [], snake: [] };
let lastSnakeSeed: number | null = null;
const seeds2048: number[] = [];
let sessionSeen = 0;
page.on('response', async (response) => {
  const url = response.url();
  const method = response.request().method();
  if (method !== 'POST') return;
  if (url.endsWith('/api/games/session')) {
    const json = (await response.json().catch(() => null)) as { snakeSeed?: number; game2048Seed?: number } | null;
    if (typeof json?.game2048Seed === 'number') seeds2048.push(json.game2048Seed);
    if (typeof json?.snakeSeed === 'number') {
      lastSnakeSeed = json.snakeSeed;
      sessionSeen += 1;
    }
  }
  for (const game of ['2048', 'snake']) {
    if (url.endsWith(`/api/games/${game}/score`)) {
      scoreResults[game]!.push({ status: response.status(), body: await response.json().catch(() => null) });
    }
  }
});

const sleep = (ms: number) => page.waitForTimeout(ms);
let failed = false;
const check = (ok: boolean, message: string) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${message}`);
  if (!ok) failed = true;
};

// ───────── 2048 ─────────
await page.goto(`${base}/2048`, { waitUntil: 'networkidle', timeout: 180_000 });
await page.addStyleTag({ content: '.fixed.z-\\[200\\] { display: none !important; }' });
await sleep(800);
// The first frame is the seeded deal: the board on screen before any key is the
// board the session's seed deals, and the run that follows is replayed from it.
const readBoard = async () =>
  (await page.evaluate(`[...document.querySelectorAll('.tile2048-tile')].map((el) => {
    const n = (v) => Number(String(v).match(/\\* (\\d)\\)$/)[1]);
    return [n(el.style.top) * 4 + n(el.style.left), Number(el.textContent)];
  })`)) as Array<[number, number]>;
const shown = (await readBoard()).sort((a, b) => a[0] - b[0]);
const dealt = initialBoard2048(createSpawnRng(seeds2048[0]!));
const expected = dealt.map((v, i) => [i, v] as [number, number]).filter(([, v]) => v !== 0);
console.log(`2048 first frame: shown ${JSON.stringify(shown)}, seed deals ${JSON.stringify(expected)}`);
check(JSON.stringify(shown) === JSON.stringify(expected), '2048 first board is the seeded deal');
await page.screenshot({ path: `${out}/2048-first-frame.jpg`, type: 'jpeg', quality: 80 });
const keys = ['ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowUp'];
let seed = 7;
const rand = () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 2 ** 32;
};
await page.keyboard.press('ArrowLeft');
const startedAt = Date.now();
for (let i = 0; i < 900 && scoreResults['2048']!.length === 0; i += 1) {
  const r = rand();
  // Mostly down and left, so the board packs and merges the way a person's does.
  const key = r < 0.4 ? 'ArrowDown' : r < 0.8 ? 'ArrowLeft' : r < 0.93 ? 'ArrowRight' : keys[3]!;
  await page.keyboard.press(key);
  await sleep(120);
}
await sleep(1500);
const r2048 = scoreResults['2048']![0];
await page.screenshot({ path: `${out}/2048-result.jpg`, type: 'jpeg', quality: 80 });
const reward2048 = (r2048?.body?.reward ?? null) as { awardedCredits?: number } | null;
console.log(`2048: ${Math.round((Date.now() - startedAt) / 1000)} s of play, score response ${JSON.stringify(r2048)?.slice(0, 160)}`);
check(r2048?.status === 200, '2048 run accepted by the replay (200)');
check((reward2048?.awardedCredits ?? 0) > 0, `2048 run pays tickets (${reward2048?.awardedCredits ?? 0})`);

// A slow session answer: the shell says it is starting the run and shows no board.
{
  const slow = await context.newPage();
  await slow.route('**/api/games/session', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    await route.continue();
  });
  await slow.goto(`${base}/2048`, { waitUntil: 'domcontentloaded', timeout: 180_000 });
  await slow.waitForSelector('.tile2048-board', { timeout: 60_000 });
  const during = await slow.evaluate(`({ tiles: document.querySelectorAll('.tile2048-tile').length, text: document.body.innerText.includes('Starting your run') })`) as { tiles: number; text: boolean };
  check(during.tiles === 0 && during.text, `slow session: no board, "Starting your run." shown (${JSON.stringify(during)})`);
  await slow.locator('.tile2048-tile').nth(1).waitFor({ timeout: 15_000 });
  check(true, 'slow session: the seeded board appears when it answers');
  await slow.close();
}

// ───────── snake ─────────
await page.goto(`${base}/snake`, { waitUntil: 'networkidle', timeout: 180_000 });
await page.addStyleTag({ content: '.fixed.z-\\[200\\] { display: none !important; }' });
await sleep(800);
let attempts = 0;
let lucky = false;
await page.keyboard.press('ArrowRight');
while (attempts < 250 && scoreResults.snake!.length === 0) {
  attempts += 1;
  for (let t = 0; t < 100 && sessionSeen < attempts; t += 1) await sleep(50);
  if (lastSnakeSeed === null) break;
  // The client deals the first apple on its starting snake with the session's seed.
  const food = generateFoodPosition(
    [
      { x: 4, y: 9 },
      { x: 3, y: 9 },
      { x: 2, y: 9 },
    ],
    createSnakeRng(lastSnakeSeed),
  );
  // In the snake's row, ahead of it: it eats the apple going straight, hits
  // the wall and the run (one apple, about 2 s) is saved.
  lucky = food.y === 9 && food.x > 4;
  if (lucky) {
    for (let t = 0; t < 200 && scoreResults.snake!.length === 0; t += 1) await sleep(50);
    break;
  }
  // Another apple: let this one crash (a zero-score run is never submitted), then play again.
  await sleep(2700);
  await page.keyboard.press('Space');
}
await sleep(1500);
const rSnake = scoreResults.snake![0];
await page.screenshot({ path: `${out}/snake-result.jpg`, type: 'jpeg', quality: 80 });
const rewardSnake = (rSnake?.body?.reward ?? null) as { awardedCredits?: number } | null;
console.log(`snake: ${attempts} run(s) to one with its first apple in its row, score response ${JSON.stringify(rSnake)?.slice(0, 160)}`);
check(rSnake?.status === 200, 'snake run accepted by the replay (200)');
check((rewardSnake?.awardedCredits ?? 0) > 0, `snake run pays tickets (${rewardSnake?.awardedCredits ?? 0})`);

const best = async (game: string) =>
  ((await (await page.request.get(`${base}/api/games/${game}/score`)).json()) as { bestScore?: number }).bestScore;
console.log(`saved bests: 2048 ${await best('2048')}, snake ${await best('snake')}`);
check((await best('2048')) !== 0 && (await best('snake')) === 10, 'both bests saved (snake 10: one apple)');
console.log(`page errors: ${errors.length ? errors.join(' | ') : 'none'}`);
await browser.close();
if (failed) process.exit(1);
