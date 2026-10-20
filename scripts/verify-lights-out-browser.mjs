#!/usr/bin/env node
/**
 * Contributor pilot for Lights Out against a disposable local application DB.
 * Creates one synthetic account. Never point this at a shared database.
 *
 * QA_BASE_URL=http://127.0.0.1:3000 npm run test:lights-out-browser
 * QA_SCREENSHOTS=1 captures output/playwright/lights-out-*.png.
 */
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { chromium, devices } from 'playwright';

const rawBase = process.env.QA_BASE_URL;
assert(rawBase, 'QA_BASE_URL is required and must point to an explicit local loopback server.');
const base = new URL(rawBase);
assert(
  ['http:', 'https:'].includes(base.protocol)
    && ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname)
    && !base.username && !base.password && !base.search && !base.hash
    && base.pathname === '/',
  'QA_BASE_URL must be a loopback HTTP(S) origin, without credentials, path, query, or fragment.',
);

const username = `qa_lo_${randomBytes(7).toString('hex')}`;
const screenshots = process.env.QA_SCREENSHOTS === '1';
const pageFailures = [];
const browser = await chromium.launch();
const endpoint = (name) => `/api/games/lights-out/${name}`;

function observe(page, label) {
  page.setDefaultTimeout(10_000);
  page.setDefaultNavigationTimeout(30_000);
  page.on('pageerror', () => pageFailures.push(`${label}: uncaught browser error`));
  page.on('console', (message) => {
    if (/hydrat\w*.*(didn't match|did not match|mismatch|failed|error while)/is.test(message.text())) {
      pageFailures.push(`${label}: hydration mismatch`);
    }
  });
}

async function visible(locator, message) {
  await locator.waitFor({ state: 'visible' });
  assert(await locator.isVisible(), message);
}

function apiResponse(page, name) {
  return page.waitForResponse((response) => new URL(response.url()).pathname === endpoint(name)
    && response.request().method() === 'POST');
}

function cellButton(page, cell) {
  const row = Math.floor(cell / 3) + 1;
  const column = cell % 3 + 1;
  return page.getByRole('button', { name: new RegExp(`^Row ${row} column ${column}: (on|off)$`) });
}

async function boardMask(page) {
  let mask = 0;
  for (let cell = 0; cell < 9; cell += 1) {
    const button = cellButton(page, cell);
    assert.equal(await button.count(), 1, `Cell ${cell} must have a unique accessible label.`);
    assert(await button.isEnabled(), 'Every cell must accept input during a run.');
    if ((await button.getAttribute('aria-label'))?.endsWith(': on')) mask |= 1 << cell;
  }
  assert.notEqual(mask, 0, 'A new puzzle must contain a lit cell.');
  return mask;
}

// Independent oracle: read the visible board and search its 512 possible states.
// Do not import the game's engine; that could reproduce the same implementation bug.
function toggle(mask, cell) {
  const row = Math.floor(cell / 3);
  const column = cell % 3;
  for (const [dr, dc] of [[0, 0], [-1, 0], [1, 0], [0, -1], [0, 1]]) {
    const r = row + dr;
    const c = column + dc;
    if (r >= 0 && r < 3 && c >= 0 && c < 3) mask ^= 1 << (r * 3 + c);
  }
  return mask;
}

function solution(initial) {
  const queue = [{ mask: initial, moves: [] }];
  const seen = new Set([initial]);
  for (let head = 0; head < queue.length; head += 1) {
    const state = queue[head];
    if (state.mask === 0) return state.moves;
    for (let cell = 0; cell < 9; cell += 1) {
      const mask = toggle(state.mask, cell);
      if (seen.has(mask)) continue;
      seen.add(mask);
      queue.push({ mask, moves: [...state.moves, cell] });
    }
  }
  assert.fail('The visible puzzle has no solution.');
}

async function activate(button, keyboard, touch = false) {
  if (keyboard) {
    await button.focus();
    await button.press('Space');
  } else if (touch) {
    await button.tap();
  } else {
    await button.click();
  }
}

async function startRun(page, name = 'Start puzzle', keyboard = false, touch = false) {
  const response = apiResponse(page, 'session');
  await activate(page.getByRole('button', { name, exact: true }), keyboard, touch);
  const sessionResponse = await response;
  assert.equal(sessionResponse.status(), 200, 'A signed-in puzzle must start successfully.');
  const session = await sessionResponse.json();
  assert.equal(session.rulesVersion, 1, 'The browser pilot expects rules version one.');
  assert.equal(typeof session.sessionToken, 'string');
  await visible(page.getByRole('heading', { name: 'Switch every light off', exact: true }), 'The puzzle instructions are missing.');
  await visible(page.getByText('Moves 0 / 24', { exact: true }), 'A fresh run must start with zero moves.');
  return { session, mask: await boardMask(page) };
}

async function completeRun(page, moves, keyboard = false) {
  assert(moves.length > 0 && moves.length <= 9, 'A minimal 3x3 solution must use between one and nine moves.');
  for (let step = 0; step < moves.length; step += 1) {
    await visible(page.getByText(`Moves ${step} / 24`, { exact: true }), 'The move counter must track the submitted transcript.');
    await activate(cellButton(page, moves[step]), keyboard, !keyboard);
  }
}

async function screenshot(page, label) {
  if (!screenshots) return;
  await mkdir('output/playwright', { recursive: true });
  await page.evaluate(async () => {
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  await page.screenshot({ path: `output/playwright/lights-out-${label}.png`, fullPage: true });
}

async function cooldown(page) {
  // Score retries and rejected requests preserve the normal one-second cooldown.
  await page.waitForTimeout(1_100);
}

try {
  const desktop = await browser.newContext({
    baseURL: base.origin,
    viewport: { width: 1280, height: 900 },
    reducedMotion: 'reduce',
  });
  const page = await desktop.newPage();
  observe(page, 'desktop');

  // Keep the outage active until retry: development StrictMode can mount twice.
  const boardOutage = (route) => route.fulfill({ status: 503, json: { error: 'Synthetic leaderboard outage.' } });
  await page.route(`**${endpoint('leaderboard')}`, boardOutage);
  const documentResponse = await page.goto('/lights-out');
  assert.equal(documentResponse?.status(), 200, 'The public Lights Out page must load.');
  await visible(page.getByText('Scores could not load:', { exact: false }), 'Leaderboard failures must be visible.');
  await page.unroute(`**${endpoint('leaderboard')}`, boardOutage);
  await page.getByRole('button', { name: 'Retry leaderboard', exact: true }).click();
  await page.getByRole('button', { name: 'Retry leaderboard', exact: true }).waitFor({ state: 'hidden' });

  const guestStart = apiResponse(page, 'session');
  await page.getByRole('button', { name: 'Start puzzle', exact: true }).click();
  assert.equal((await guestStart).status(), 401, 'Official runs must require sign-in.');
  const signIn = page.getByRole('link', { name: 'Sign in to play', exact: true });
  await visible(signIn, 'Guest players need a usable sign-in action.');
  assert.equal(await signIn.getAttribute('href'), '/signin?next=%2Flights-out');
  assert.equal(await page.getByText('Moves 0 / 24', { exact: true }).count(), 0, 'A guest must not enter an official run.');

  // Registration stores the real HttpOnly session cookie in this context.
  const registration = await desktop.request.post('/api/account/register', {
    data: {
      email: `${username}@example.invalid`,
      username,
      password: `Qa1!${randomBytes(18).toString('base64url')}`,
    },
  });
  assert.equal(registration.status(), 200, 'Synthetic registration failed; use a migrated disposable local database.');
  await page.reload();

  const transcripts = [];
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === endpoint('score') && request.method() === 'POST') {
      transcripts.push(request.postDataJSON());
    }
  });
  const { session, mask } = await startRun(page, 'Start puzzle', true);
  const moves = solution(mask);
  const expectedScore = 1000 - 25 * (moves.length - 1);
  await screenshot(page, 'desktop-stage');

  for (const invalidMoves of [[9], []]) {
    const rejected = await desktop.request.post(endpoint('score'), {
      data: { sessionToken: session.sessionToken, rulesVersion: session.rulesVersion, moves: invalidMoves },
    });
    assert.equal(rejected.status(), 400, 'Malformed or incomplete transcripts must be rejected without consuming the run.');
    await cooldown(page);
  }

  // Add forged result fields to a real HTTP request. The server must ignore them,
  // replay the moves, and commit its own result before we hide that response.
  let committedScore;
  await page.route(`**${endpoint('score')}`, async (route) => {
    const payload = route.request().postDataJSON();
    const response = await route.fetch({ postData: JSON.stringify({ ...payload, score: 999999, seed: 0 }) });
    assert.equal(response.status(), 200, 'A complete replay must commit before the synthetic response loss.');
    committedScore = await response.json();
    await route.fulfill({ status: 503, json: { error: 'Synthetic lost score response. Retry saving.' } });
  }, { times: 1 });
  await completeRun(page, moves, true);
  await visible(page.getByRole('heading', { name: 'Score not saved', exact: true }), 'A lost response must expose score retry.');
  assert.equal(committedScore?.score, expectedScore, 'The server must recompute the score and ignore forged result fields.');
  assert.equal(committedScore?.solved, true);
  assert.equal(committedScore?.moves, moves.length);
  assert.equal(committedScore?.ticketsAwarded, 0, 'The pilot must award no tickets.');
  await cooldown(page);
  const retryResponse = apiResponse(page, 'score');
  await page.getByRole('button', { name: 'Retry saving score', exact: true }).press('Enter');
  const retry = await retryResponse;
  assert.equal(retry.status(), 200, 'Retry must recover an already committed result.');
  const retryResult = await retry.json();
  assert.equal(retryResult.score, expectedScore);
  assert.equal(retryResult.solved, true);
  assert.equal(retryResult.moves, moves.length);
  await visible(page.getByRole('heading', { name: `${expectedScore} points`, exact: true }), 'The UI must display the server-verified score.');
  assert.equal(transcripts.length, 2, 'Saving then retrying must submit exactly twice.');
  assert.deepEqual(transcripts[0], transcripts[1], 'Retry must preserve the token, rules version, and complete moves.');
  assert.deepEqual(transcripts[0].moves, moves, 'The submitted moves must match the actual keyboard play.');
  if (retryResult.leaderboard.some((entry) => entry.userName === username)) {
    await visible(page.getByRole('listitem').filter({ hasText: username }), 'The board must display current account names for included players.');
  } else {
    assert.equal(retryResult.leaderboard.length, 10, 'A score can be omitted only from a full top-ten board.');
    assert(retryResult.leaderboard.every((entry) => entry.score >= expectedScore), 'Only better or older tied scores may exclude this run.');
  }
  await screenshot(page, 'desktop');

  const abandoned = await startRun(page, 'Play again', true);
  // Choose a move that does not solve this board, so restart really abandons it.
  const partialCell = Array.from({ length: 9 }, (_, cell) => cell).find((cell) => toggle(abandoned.mask, cell) !== 0);
  assert.notEqual(partialCell, undefined);
  await activate(cellButton(page, partialCell), true);
  await visible(page.getByText('Moves 1 / 24', { exact: true }), 'A partial run must record its move.');
  const restarted = await startRun(page, 'Restart puzzle', true);
  assert.notEqual(restarted.session.sessionToken, abandoned.session.sessionToken, 'Restart must create a fresh signed run.');
  assert.equal(transcripts.length, 2, 'Abandoned runs must never submit scores.');

  // Repeating a non-solving move twice restores the board. Twenty-four moves
  // form a valid terminal loss and must not persist a forged high score.
  const repeatedCell = Array.from({ length: 9 }, (_, cell) => cell).find((cell) => toggle(restarted.mask, cell) !== 0);
  await cooldown(page);
  const lossResponse = await desktop.request.post(endpoint('score'), {
    data: {
      sessionToken: restarted.session.sessionToken,
      rulesVersion: restarted.session.rulesVersion,
      moves: Array(24).fill(repeatedCell),
      score: 999999,
    },
  });
  assert.equal(lossResponse.status(), 200, 'A valid move-limit loss must save.');
  const loss = await lossResponse.json();
  assert.equal(loss.score, 0);
  assert.equal(loss.solved, false);
  assert.equal(loss.moves, 24);
  assert.equal(loss.ticketsAwarded, 0);
  await cooldown(page);

  const mobile = await browser.newContext({
    ...devices['iPhone 13'],
    baseURL: base.origin,
    viewport: { width: 320, height: 720 },
    reducedMotion: 'reduce',
    storageState: await desktop.storageState(),
  });
  const narrowPage = await mobile.newPage();
  observe(narrowPage, 'mobile');
  await narrowPage.goto('/lights-out');
  assert(await narrowPage.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches), 'The mobile pilot must exercise reduced motion.');
  const touchRun = await startRun(narrowPage, 'Start puzzle', false, true);
  const touchMoves = solution(touchRun.mask);
  const touchScore = 1000 - 25 * (touchMoves.length - 1);
  await screenshot(narrowPage, 'mobile-stage');
  const mobileScoreResponse = apiResponse(narrowPage, 'score');
  await completeRun(narrowPage, touchMoves);
  const mobileScore = await mobileScoreResponse;
  assert.equal(mobileScore.status(), 200, 'A touch run must save successfully.');
  const mobileResult = await mobileScore.json();
  assert.equal(mobileResult.score, touchScore);
  assert.equal(mobileResult.moves, touchMoves.length);
  assert.equal(mobileResult.solved, true);
  await visible(narrowPage.getByRole('heading', { name: `${touchScore} points`, exact: true }), 'Mobile results must remain usable.');
  assert(await narrowPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'The narrow viewport must not overflow horizontally.');
  await screenshot(narrowPage, 'mobile');
  assert.equal(pageFailures.length, 0, pageFailures.join('; '));
  console.log('Lights Out browser pilot passed: guest auth, leaderboard recovery, independent keyboard/touch solutions, malformed/incomplete and forged inputs, move-limit loss, committed-score retry, restart, and reduced motion.');
} finally {
  await browser.close();
}
