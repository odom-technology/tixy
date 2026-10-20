#!/usr/bin/env node
/**
 * Browser pilot for the contributor starter against a disposable local DB.
 * Creates one synthetic account. Never point this at a shared database.
 *
 * QA_BASE_URL=http://127.0.0.1:3000 npm run test:starter-game-browser
 * Add QA_SCREENSHOTS=1 to capture output/playwright/starter-match-*.png.
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

const suffix = randomBytes(7).toString('hex');
const username = `qa_pm_${suffix}`;
const symbols = ['Circle', 'Square', 'Triangle', 'Star'];
const screenshots = process.env.QA_SCREENSHOTS === '1';
const pageFailures = [];
const browser = await chromium.launch();

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

function apiResponse(page, endpoint) {
  return page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname === `/api/games/starter-match/${endpoint}`
      && response.request().method() === 'POST';
  });
}

async function startRun(page, buttonName = 'Start matching', keyboard = false) {
  const button = page.getByRole('button', { name: buttonName, exact: true });
  const response = apiResponse(page, 'session');
  if (keyboard) {
    await button.focus();
    await button.press('Enter');
  } else {
    await button.click();
  }
  assert.equal((await response).status(), 200, 'A signed-in run must start successfully.');
  await visible(page.getByRole('heading', { name: /^Match (Circle|Square|Triangle|Star)$/ }), 'The first target is missing.');
  assert.equal(await page.getByText('Round 1 / 8', { exact: true }).count(), 1, 'A new run must start on round one.');
}

async function completeRun(page, keyboard = false) {
  for (let round = 1; round <= 8; round += 1) {
    await visible(page.getByText(`Round ${round} / 8`, { exact: true }), `Round ${round} was not reached.`);
    const target = await page.getByRole('heading', { name: /^Match (Circle|Square|Triangle|Star)$/ }).innerText();
    const symbol = target.replace(/^Match /, '');
    assert(symbols.includes(symbol), 'The UI must identify a supported shape.');
    const choice = page.getByRole('button', { name: symbol, exact: true });
    if (keyboard) {
      await choice.focus();
      await choice.press('Space');
    } else {
      await choice.tap();
    }
    if (round < 8) {
      const next = page.getByRole('button', { name: 'Next round', exact: true });
      await visible(next, 'Choosing a shape must expose a deliberate next-round action.');
      for (const name of symbols) {
        assert(await page.getByRole('button', { name, exact: true }).isDisabled(), 'A selected round must lock every shape button.');
      }
      if (keyboard) {
        await next.focus();
        await next.press('Enter');
      } else {
        await next.tap();
      }
    }
  }
}

async function screenshot(page, label) {
  if (!screenshots) return;
  await mkdir('output/playwright', { recursive: true });
  // Keyboard focus can scroll the document. Capture from a stable top edge so
  // sticky navigation does not appear midway through a full-page screenshot.
  await page.evaluate(async () => {
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  await page.screenshot({ path: `output/playwright/starter-match-${label}.png`, fullPage: true });
}

try {
  const desktop = await browser.newContext({
    baseURL: base.origin,
    viewport: { width: 1280, height: 900 },
    reducedMotion: 'reduce',
  });
  const page = await desktop.newPage();
  observe(page, 'desktop');

  // Prove a failed leaderboard is visible and can recover independently.
  // Development StrictMode may mount/abort/remount the initial board request.
  // Keep the outage active until the user retries, rather than counting requests.
  const boardOutage = (route) => route.fulfill({
    status: 503,
    json: { error: 'Synthetic leaderboard outage.' },
  });
  await page.route('**/api/games/starter-match/leaderboard', boardOutage);
  const documentResponse = await page.goto('/starter-match');
  assert.equal(documentResponse?.status(), 200, 'The public starter page must load.');
  await visible(page.getByText('Scores could not load:', { exact: false }), 'Leaderboard failures must be visible.');
  await page.unroute('**/api/games/starter-match/leaderboard', boardOutage);
  await page.getByRole('button', { name: 'Retry leaderboard', exact: true }).click();
  await page.getByRole('button', { name: 'Retry leaderboard', exact: true }).waitFor({ state: 'hidden' });

  const guestStart = apiResponse(page, 'session');
  await page.getByRole('button', { name: 'Start matching', exact: true }).click();
  assert.equal((await guestStart).status(), 401, 'Guest official runs must require sign-in.');
  const signIn = page.getByRole('link', { name: 'Sign in to play', exact: true });
  await visible(signIn, 'Guest players need a usable sign-in action.');
  assert.equal(await signIn.getAttribute('href'), '/signin?next=%2Fstarter-match');
  assert.equal(await page.getByRole('button', { name: 'Circle', exact: true }).count(), 0, 'A guest must not enter an official run.');

  // API registration stores the HttpOnly session cookie in this browser context.
  const registration = await desktop.request.post('/api/account/register', {
    data: {
      email: `${username}@example.invalid`,
      username,
      password: `Qa1!${randomBytes(18).toString('base64url')}`,
    },
  });
  assert.equal(registration.status(), 200, 'Synthetic account registration failed; use a migrated disposable local database.');
  await page.reload();

  // Simulate a lost HTTP response AFTER the score commits on the server.
  // Retrying must use the original transcript and recover that saved result.
  const transcripts = [];
  let committedScore;
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/games/starter-match/score' && request.method() === 'POST') {
      transcripts.push(request.postDataJSON());
    }
  });
  await page.route('**/api/games/starter-match/score', async (route) => {
    const response = await route.fetch();
    assert.equal(response.status(), 200, 'The server must accept the completed transcript before the synthetic response loss.');
    committedScore = await response.json();
    await route.fulfill({ status: 503, json: { error: 'Synthetic lost score response. Retry saving.' } });
  }, { times: 1 });

  await startRun(page, 'Start matching', true);
  await screenshot(page, 'desktop-stage');
  await completeRun(page, true);
  await visible(page.getByRole('heading', { name: 'Score not saved', exact: true }), 'A lost response must expose score retry.');
  assert.equal(committedScore?.score, 800, 'The server must recompute all eight correct choices as 800.');
  assert.equal(committedScore?.ticketsAwarded, 0, 'The starter must award no tickets.');
  // Receipt retries retain the normal one-second score-submit cooldown.
  // This deliberate rate-limit wait is not a retry for a failing UI action.
  await page.waitForTimeout(1_100);
  const retryResponse = apiResponse(page, 'score');
  await page.getByRole('button', { name: 'Retry saving score', exact: true }).press('Enter');
  assert.equal((await retryResponse).status(), 200, 'Retrying a committed run must recover its result.');
  await visible(page.getByRole('heading', { name: '800 points', exact: true }), 'The final UI must display the verified score.');
  assert.equal(transcripts.length, 2, 'Saving then retrying must make exactly two submissions.');
  assert.equal(JSON.stringify(transcripts[0]) === JSON.stringify(transcripts[1]), true, 'Retry must preserve the session token and choices.');
  if (committedScore.leaderboard.some((entry) => entry.userName === username)) {
    await visible(page.getByRole('listitem').filter({ hasText: username }), 'An included synthetic player must appear on the leaderboard.');
  } else {
    // Reusing a disposable DB can leave ten older perfect scores ahead of us.
    // Equal scores retain their original order rather than displacing a player.
    assert.equal(committedScore.leaderboard.length, 10, 'A perfect score may be omitted only from a full board.');
    assert(committedScore.leaderboard.every((entry) => entry.score === 800), 'Only older perfect scores may exclude this perfect run.');
    assert.equal(await page.locator('.starter-match-scores li').count(), 10, 'The UI must display all ten leaderboard entries.');
  }
  await screenshot(page, 'desktop');

  await startRun(page, 'Play again', true);
  const firstTarget = (await page.getByRole('heading', { name: /^Match (Circle|Square|Triangle|Star)$/ }).innerText()).replace(/^Match /, '');
  await page.getByRole('button', { name: symbols.find((symbol) => symbol !== firstTarget), exact: true }).click();
  await visible(page.getByRole('button', { name: 'Next round', exact: true }), 'A selected round should await advancement.');
  await startRun(page, 'Restart run');
  assert(await page.getByRole('button', { name: 'Circle', exact: true }).isEnabled(), 'Restart must clear the previous selection.');
  assert.equal(transcripts.length, 2, 'Abandoned partial runs must not submit scores.');

  const mobile = await browser.newContext({
    ...devices['iPhone 13'],
    baseURL: base.origin,
    viewport: { width: 320, height: 720 },
    reducedMotion: 'reduce',
    storageState: await desktop.storageState(),
  });
  const narrowPage = await mobile.newPage();
  observe(narrowPage, 'mobile');
  await narrowPage.goto('/starter-match');
  assert(await narrowPage.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches), 'The mobile pilot must exercise reduced motion.');
  await startRun(narrowPage);
  await screenshot(narrowPage, 'mobile-stage');
  const mobileScoreResponse = apiResponse(narrowPage, 'score');
  await completeRun(narrowPage);
  const mobileScore = await mobileScoreResponse;
  assert.equal(mobileScore.status(), 200, 'A touch run must save successfully.');
  assert.equal((await mobileScore.json()).score, 800, 'The touch run must have a verified perfect score.');
  await visible(narrowPage.getByRole('heading', { name: '800 points', exact: true }), 'Mobile results must remain usable.');
  assert(await narrowPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'The narrow viewport must not overflow horizontally.');
  await screenshot(narrowPage, 'mobile');
  assert.equal(pageFailures.length, 0, pageFailures.join('; '));
  console.log('Starter browser pilot passed: guest auth, leaderboard recovery, keyboard scoring, committed-score retry, restart, narrow touch, and reduced motion.');
} finally {
  await browser.close();
}
