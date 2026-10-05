#!/usr/bin/env node
/**
 * Wager-free smoke test: visits every route under src/app/(games)/ as a
 * logged-in QA account and fails on pageerror, console.error, or React
 * hydration-mismatch output. It never places a wager.
 *
 * Why console assertions: SSR'd attributes computed from Math.sin/cos can
 * differ between Node and Chromium V8 in the last ULP, which breaks
 * hydration without throwing a pageerror (see the /darts regression).
 *
 * Usage:
 *   npm run test:smoke
 *   QA_BASE_URL=http://localhost:3000 node scripts/smoke.mjs [route ...]
 */
import { readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { chromium } from 'playwright';

const base = process.env.QA_BASE_URL ?? 'http://localhost:3000';
const account = {
  emailOrUsername: process.env.QA_SMOKE_EMAIL ?? 'qa-cards@example.com',
  password: process.env.QA_SMOKE_PASSWORD ?? 'QaPass!2026',
};
// How long to let each page settle after the document loads so hydration and
// first effects run. Third-party ad frames may keep the load event pending.
const SETTLE_MS = Number(process.env.QA_SMOKE_SETTLE_MS ?? 1500);
const CONCURRENCY = Math.max(1, Number(process.env.QA_SMOKE_CONCURRENCY ?? 4));

// console.error lines that are expected and harmless. Keep this list short and
// specific; every entry hides a class of real failures.
const ALLOWED_CONSOLE_ERRORS = [
  // Optional fetches that 401 for features the QA account has not unlocked.
  /the server responded with a status of 401/i,
];

const HYDRATION_MISMATCH =
  /hydrat\w*.*(didn't match|did not match|mismatch|failed|error while)/is;

function gameRoutes() {
  const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  const gamesDir = path.join(root, 'src', 'app', '(games)');
  return readdirSync(gamesDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(path.join(gamesDir, e.name, 'page.tsx')))
    .map((e) => `/${e.name}`)
    .sort();
}

async function checkRoute(context, route) {
  const failures = [];
  const page = await context.newPage();
  page.on('pageerror', (err) => {
    failures.push(`pageerror: ${(err.stack ?? err.message).slice(0, 1200)}`);
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
    const response = await page.goto(base + route, { waitUntil: 'domcontentloaded', timeout: 30000 });
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
  return failures;
}

const routes = process.argv.length > 2 ? process.argv.slice(2) : gameRoutes();

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });

// AdSense runs on every page, including QA routes. Its own intermittent
// exceptions should not decide whether first-party routes pass this smoke test.
await context.route(
  (url) => url.origin === 'https://pagead2.googlesyndication.com'
    && url.pathname === '/pagead/js/adsbygoogle.js',
  (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: '' }),
);

const login = await context.request.post(`${base}/api/account/session`, {
  data: account,
});
if (!login.ok()) {
  console.error(`login failed for ${account.emailOrUsername}: HTTP ${login.status()} ${await login.text()}`);
  await browser.close();
  process.exit(1);
}

const results = new Array(routes.length);
let nextRoute = 0;
const workers = Array.from(
  { length: Math.min(CONCURRENCY, routes.length) },
  async () => {
    while (nextRoute < routes.length) {
      const index = nextRoute;
      nextRoute += 1;
      results[index] = await checkRoute(context, routes[index]);
    }
  },
);
await Promise.all(workers);

let failed = 0;
for (const [index, route] of routes.entries()) {
  const failures = results[index];
  if (failures.length === 0) {
    console.log(`✓ ${route}`);
  } else {
    failed += 1;
    console.log(`✗ ${route}`);
    for (const f of failures) console.log(`    ${f}`);
  }
}
await browser.close();

console.log(`\n${routes.length - failed}/${routes.length} routes passed`);
process.exit(failed === 0 ? 0 : 1);
