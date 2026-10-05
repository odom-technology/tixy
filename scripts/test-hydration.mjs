#!/usr/bin/env node
/**
 * Hydration regression test for the touch/desktop instruction-copy mismatch.
 *
 * `isTouchDevice()` returns false on the server, so any render-time call used
 * to produce different markup on touch clients. Desktop smoke tests never saw
 * it (server false === desktop client false). This test loads representative
 * game routes in BOTH a desktop context and a touch-emulated mobile context
 * (hasTouch: true) and fails on any React hydration-mismatch console output,
 * pageerror, or unexpected console.error.
 *
 * Usage:
 *   npm run test:hydration
 *   QA_BASE_URL=http://localhost:3000 node scripts/test-hydration.mjs [route ...]
 */
import { chromium, devices } from 'playwright';

const base = process.env.QA_BASE_URL ?? 'http://localhost:3000';
const account = {
  emailOrUsername: process.env.QA_SMOKE_EMAIL ?? 'qa-cards@example.com',
  password: process.env.QA_SMOKE_PASSWORD ?? 'QaPass!2026',
};
const SETTLE_MS = Number(process.env.QA_SMOKE_SETTLE_MS ?? 1500);
const CONCURRENCY = Math.max(1, Number(process.env.QA_SMOKE_CONCURRENCY ?? 4));

// Representative routes that render touch-vs-desktop instruction copy.
const DEFAULT_ROUTES = [
  '/stack',
  '/flappy-bird',
  '/reaction-time',
  '/snake',
  '/breakout',
  '/2048',
  '/minesweeper',
  '/sudoku',
];

const ALLOWED_CONSOLE_ERRORS = [
  // Optional fetches that 401 for features the QA account has not unlocked.
  /the server responded with a status of 401/i,
];

const HYDRATION_MISMATCH =
  /hydrat\w*.*(didn't match|did not match|mismatch|failed|error while)/is;

async function checkRoute(context, route, label) {
  const failures = [];
  const page = await context.newPage();
  page.on('pageerror', (err) => {
    failures.push(`pageerror: ${err.message}`);
  });
  page.on('console', (msg) => {
    const text = msg.text();
    if (HYDRATION_MISMATCH.test(text)) {
      failures.push(`hydration mismatch (console.${msg.type()}): ${text.slice(0, 400)}`);
      return;
    }
    if (msg.type() === 'error' && !ALLOWED_CONSOLE_ERRORS.some((re) => re.test(text))) {
      failures.push(`console.error: ${text.slice(0, 400)}`);
    }
  });

  try {
    const response = await page.goto(base + route, { waitUntil: 'load', timeout: 30000 });
    if (!response) {
      failures.push('no response from page.goto');
    } else if (response.status() >= 400) {
      failures.push(`HTTP ${response.status()} on initial document`);
    }
    await page.waitForTimeout(SETTLE_MS);
  } catch (err) {
    failures.push(`navigation failed: ${err.message}`);
  } finally {
    await page.close();
  }
  return failures.map((f) => `[${label}] ${f}`);
}

const routes = process.argv.length > 2 ? process.argv.slice(2) : DEFAULT_ROUTES;

const browser = await chromium.launch();

// Desktop: no touch support. Mobile: touch emulation — this is the context
// that reproduced the hydration mismatch before the fix.
const desktop = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const mobile = await browser.newContext({
  ...devices['iPhone 13'],
  viewport: { width: 390, height: 844 },
  hasTouch: true,
});

for (const context of [desktop, mobile]) {
  const login = await context.request.post(`${base}/api/account/session`, {
    data: account,
  });
  if (!login.ok()) {
    console.error(`login failed for ${account.emailOrUsername}: HTTP ${login.status()} ${await login.text()}`);
    await browser.close();
    process.exit(1);
  }
}

const results = new Array(routes.length);
let nextRoute = 0;
const workers = Array.from(
  { length: Math.min(CONCURRENCY, routes.length) },
  async () => {
    while (nextRoute < routes.length) {
      const index = nextRoute;
      nextRoute += 1;
      const route = routes[index];
      const [desktopFailures, mobileFailures] = await Promise.all([
        checkRoute(desktop, route, 'desktop'),
        checkRoute(mobile, route, 'mobile/touch'),
      ]);
      results[index] = [...desktopFailures, ...mobileFailures];
    }
  },
);
await Promise.all(workers);

let failed = 0;
for (const [index, route] of routes.entries()) {
  const failures = results[index];
  if (failures.length === 0) {
    console.log(`✓ ${route} (desktop + mobile/touch)`);
  } else {
    failed += 1;
    console.log(`✗ ${route}`);
    for (const f of failures) console.log(`    ${f}`);
  }
}
await browser.close();

console.log(`\n${routes.length - failed}/${routes.length} routes passed on both desktop and mobile/touch`);
process.exit(failed === 0 ? 0 : 1);
