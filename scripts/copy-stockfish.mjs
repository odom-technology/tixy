#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Copy the `stockfish` package into the standalone build output.
//
// Why this exists: `next.config.ts` marks `stockfish` as a server-external
// package while `outputFileTracingExcludes` keeps the multi-megabyte engine
// binaries out of file tracing. The result is that `.next/standalone` ships
// without a usable stockfish install and the chess bot crashes on deploy. This
// script restores exactly the files the runtime needs.
//
// What the runtime needs (see src/server/arcade/chess-bot.ts):
//   - package metadata              -> package.json
//   - child-process engine          -> bin/stockfish-18-lite-single.js
//   - WASM located next to the .js  -> bin/stockfish-18-lite-single.wasm
//
// The full-strength binaries (~113 MB each) are intentionally not copied.
// Runs after `next build` via the package.json `build` script. Idempotent:
// re-running always produces a fresh, correct copy.
// ---------------------------------------------------------------------------

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceDir = path.join(projectRoot, 'node_modules', 'stockfish');
const standaloneDir = path.join(projectRoot, '.next', 'standalone');
const destDir = path.join(standaloneDir, 'node_modules', 'stockfish');

const REQUIRED_FILES = [
  'package.json',
  'index.js',
  'bin/stockfish-18-lite-single.js',
  'bin/stockfish-18-lite-single.wasm',
];

// License text for the GPL-licensed engine; copied when present.
const OPTIONAL_FILES = ['Copying.txt'];

function fail(message) {
  console.error(`copy-stockfish: ${message}`);
  process.exit(1);
}

if (!fs.existsSync(sourceDir)) {
  fail(`source package not found at ${sourceDir}. Run \`npm ci\` first.`);
}

const missing = REQUIRED_FILES.filter(
  (file) => !fs.existsSync(path.join(sourceDir, file)),
);
if (missing.length > 0) {
  fail(
    `required file(s) missing from ${sourceDir}: ${missing.join(', ')}. ` +
      'The stockfish package layout may have changed — update REQUIRED_FILES ' +
      'in scripts/copy-stockfish.mjs to match what chess-bot.ts loads.',
  );
}

if (!fs.existsSync(standaloneDir)) {
  fail(
    `standalone output not found at ${standaloneDir}. ` +
      'Run `next build` (with output: "standalone") before this script.',
  );
}

// Start from a clean destination so stale or partial copies never survive.
fs.rmSync(destDir, { recursive: true, force: true });

for (const file of [...REQUIRED_FILES, ...OPTIONAL_FILES]) {
  const from = path.join(sourceDir, file);
  if (!fs.existsSync(from)) continue; // optional file absent
  const to = path.join(destDir, file);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to); // follows symlinks, copies real contents
}

console.log(`copy-stockfish: copied stockfish (lite-single) into ${destDir}`);
