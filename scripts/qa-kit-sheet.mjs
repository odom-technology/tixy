#!/usr/bin/env node
/**
 * Screenshots of the kit sheet (/kit): every shared piece in its states, at
 * 1280 and 390 wide, plus the modal, the dialog and a toast open.
 *
 *   QA_BASE_URL=http://127.0.0.1:3208 node scripts/qa-kit-sheet.mjs <outdir> [prefix] [--reduced]
 *
 * Files: <prefix>-kit-<width>-<shot>.jpg. The sheet needs a development
 * server, or a production build with TIXY_KIT_SHEET=1.
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { chromium } from 'playwright';

const [outdir, prefix = 'after', ...flags] = process.argv.slice(2);
if (!outdir) {
  console.error('usage: qa-kit-sheet.mjs <outdir> [prefix] [--reduced]');
  process.exit(1);
}
const reduced = flags.includes('--reduced');
const base = process.env.QA_BASE_URL ?? 'http://127.0.0.1:3000';
mkdirSync(outdir, { recursive: true });

const browser = await chromium.launch();
for (const width of [1280, 390]) {
  const phone = width === 390;
  const context = await browser.newContext({
    viewport: { width, height: phone ? 844 : 900 },
    deviceScaleFactor: phone ? 2 : 1,
    hasTouch: phone,
    isMobile: phone,
    reducedMotion: reduced ? 'reduce' : 'no-preference',
  });
  const page = await context.newPage();
  const name = (shot) => join(outdir, `${prefix}-kit-${width}${reduced ? '-reduced' : ''}-${shot}.jpg`);
  const shoot = async (shot, options = {}) => {
    await page.screenshot({ path: name(shot), type: 'jpeg', quality: 80, ...options });
    console.log('saved', name(shot));
  };

  await page.goto(`${base}/kit`, { waitUntil: 'networkidle', timeout: 120000 });
  await page.waitForTimeout(1500);
  await shoot('sheet', { fullPage: true });

  for (const open of ['modal', 'dialog']) {
    await page.goto(`${base}/kit?open=${open}`, { waitUntil: 'networkidle', timeout: 120000 });
    await page.waitForTimeout(900);
    await shoot(open);
  }

  await page.goto(`${base}/kit?open=toast`, { waitUntil: 'networkidle', timeout: 120000 });
  await page.waitForTimeout(900);
  await shoot('toast');
  await context.close();
}
await browser.close();
