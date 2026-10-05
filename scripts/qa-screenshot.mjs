#!/usr/bin/env node
/**
 * QA screenshot helper for the Midway design review.
 *
 * Usage:
 *   node scripts/qa-screenshot.mjs <path> <outfile> [options]
 *
 * Options:
 *   --theme=<id>   force a theme from arcade-themes.ts (tixy, night-shift, boardwalk ...)
 *   --cookie=<arcade_session value>   sign in as that session
 *   --mobile                          390x844 viewport (default 1440x900)
 *   --full                            full-page screenshot
 *   --wait=<ms>                       extra settle time (default 800)
 *
 * Example:
 *   node scripts/qa-screenshot.mjs / /tmp/qa/dash-boardwalk.png --theme=boardwalk --cookie=$SESSION
 */
import { chromium } from 'playwright';

const [pagePath, outfile, ...rest] = process.argv.slice(2);
if (!pagePath || !outfile) {
  console.error('usage: qa-screenshot.mjs <path> <outfile> [--theme=x] [--cookie=x] [--mobile] [--full] [--wait=ms]');
  process.exit(1);
}
const opts = Object.fromEntries(
  rest.map((a) => {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    return m ? [m[1], m[2] ?? true] : [a, true];
  }),
);

const base = process.env.QA_BASE_URL ?? 'http://localhost:3000';
const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: opts.mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 },
  deviceScaleFactor: 2,
});
if (opts.cookie) {
  await context.addCookies([
    {
      name: 'arcade_session',
      value: String(opts.cookie),
      url: base,
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);
}
const page = await context.newPage();
await page.goto(base + pagePath, { waitUntil: 'networkidle', timeout: 60000 });
if (opts.theme) {
  await page.evaluate((t) => {
    // The system on data-arcade-theme, the colours on data-tixy-scheme.
    const root = document.documentElement;
    root.setAttribute('data-arcade-theme', t === 'boardwalk' ? 'boardwalk' : 'tixy');
    if (t === 'tixy') root.removeAttribute('data-tixy-scheme');
    else root.setAttribute('data-tixy-scheme', t);
  }, String(opts.theme));
}
await page.waitForTimeout(Number(opts.wait ?? 800));
await page.screenshot({ path: outfile, fullPage: Boolean(opts.full) });
await browser.close();
console.log('saved', outfile);
