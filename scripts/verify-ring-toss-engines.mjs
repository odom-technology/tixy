#!/usr/bin/env node
/**
 * Ring toss: the engine is bit-for-bit the same in every JavaScript engine.
 *
 *   node scripts/verify-ring-toss-engines.mjs
 *
 * Bundles src/server/arcade/ring-toss-engine.ts with a fixed set of 24
 * rounds (240 rings, rings at rest included), runs it in Node (V8) and in
 * Playwright's Chromium (V8), Firefox (SpiderMonkey) and WebKit
 * (JavaScriptCore), and compares a hash of every ring's resting pose and
 * step count, written out to the last digit. Not in the invariants: it needs
 * `npx playwright install firefox webkit`. A browser that isn't installed is
 * skipped, and the script says so.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { build } from 'esbuild';
import { chromium, firefox, webkit } from 'playwright';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ring-toss-engines-'));
const harness = path.join(dir, 'harness.ts');
fs.writeFileSync(
  harness,
  `import { AIM_RANGE, BOTTLES, ringRoundFinish, ringRoundInitial, ringRoundStart, ringStep } from ${JSON.stringify(path.join(root, 'src/server/arcade/ring-toss-engine.ts'))};
export function run() {
  let s = 12345 >>> 0;
  const uni = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
  const r4 = (v: number) => Math.round(v * 10000) / 10000;
  const parts: string[] = [];
  const scores: number[] = [];
  for (let round = 0; round < 24; round += 1) {
    const st = ringRoundInitial((round * 2654435761) >>> 0);
    let t = 500;
    for (let k = 0; k < 10; k += 1) {
      const b = BOTTLES[Math.floor(uni() * 16)]!;
      const p = { h: r4(uni() * 2 - 1), p: r4([0.145, 0.35, 0.575, 0.79][b.row]! + (uni() - 0.5) * 0.12), a: r4(b.x / AIM_RANGE + (uni() - 0.5) * 0.3), c: r4((uni() - 0.5) * 0.8) };
      const ring = ringRoundStart(st, p);
      while (!ring.done) ringStep(ring);
      parts.push([ring.step, ring.x, ring.y, ring.z, ring.qw, ring.qx, ring.qy, ring.qz].map(String).join(','));
      ringRoundFinish(st, t, ring);
      t = st.readyAt + 300;
    }
    scores.push(st.score);
  }
  const str = parts.join('|');
  let h = 0x811c9dc5 >>> 0;
  for (let i = 0; i < str.length; i += 1) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return { hash: h.toString(16), length: str.length, scores };
}
(globalThis as any).ringTossEngines = run;
`,
);
const out = path.join(dir, 'bundle.js');
await build({ entryPoints: [harness], bundle: true, format: 'iife', outfile: out, logLevel: 'warning' });
const code = fs.readFileSync(out, 'utf8');

const context = {};
context.globalThis = context;
vm.createContext(context);
vm.runInContext(code, context);
const node = context.ringTossEngines();
console.log(`node      ${node.hash} (${node.length} chars, scores ${node.scores.join(' ')})`);

let failed = false;
for (const [name, type] of [['chromium', chromium], ['firefox', firefox], ['webkit', webkit]]) {
  let browser;
  try {
    browser = await type.launch(name === 'chromium' && process.env.PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH } : {});
  } catch (error) {
    console.log(`${name.padEnd(9)} skipped: ${String(error.message).split('\n')[0]}`);
    continue;
  }
  const page = await browser.newPage();
  await page.addScriptTag({ content: code });
  const result = await page.evaluate(() => globalThis.ringTossEngines());
  await browser.close();
  const same = result.hash === node.hash && result.length === node.length;
  if (!same) failed = true;
  console.log(`${name.padEnd(9)} ${result.hash} ${same ? 'same as node' : 'DIFFERENT'}`);
}
fs.rmSync(dir, { recursive: true, force: true });
if (failed) {
  console.error('ring toss engines: a browser disagrees with node');
  process.exit(1);
}
console.log('ring toss engines: every engine run agrees to the bit');
