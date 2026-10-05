#!/usr/bin/env node

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tsxCli = path.join(root, 'node_modules', 'tsx', 'dist', 'cli.mjs');

const suites = [
  { script: 'verify-2048-replay.ts', patterns: [/(^|\/)2048/, /game-2048/, /rewards\/wallet/] },
  { script: 'verify-audio-cues.ts', patterns: [/sound-manager/, /use-game-feedback/, /\(games\)\//] },
  { script: 'verify-blitz-tactics-bank.ts', patterns: [/blitz-tactics/] },
  { script: 'verify-blitz-tactics-replay.ts', patterns: [/blitz-tactics/] },
  { script: 'verify-boardwalk-replay.ts', patterns: [/boardwalk-hop/] },
  { script: 'verify-coin-pusher-rtp.ts', patterns: [/coin-pusher/, /arcade-constants/] },
  { script: 'verify-crash-invariants.ts', patterns: [/(^|\/)crash/] },
  { script: 'verify-derby-rtp.ts', patterns: [/(^|\/)derby/] },
  { script: 'verify-derby-race.ts', patterns: [/(^|\/)derby/, /rewards\/wallet/] },
  { script: 'verify-feel-kit.ts', patterns: [/use-game-feedback/, /game-feel/, /callout-(motion|canvas)/, /gameplay-feedback\.css/, /use-rolling-number/, /game-haptics/, /sound-manager/, /verify-feel-kit/] },
  { script: 'verify-flappy-replay.ts', patterns: [/flappy/, /rewards\/wallet/, /game-frame-loop/] },
  { script: 'verify-floor-registry.ts', patterns: [/arcade-game-registry/, /game-renames/, /next\.config/, /verify-floor-registry/] },
  { script: 'verify-game-frame-loop.ts', patterns: [/game-frame-loop/, /use-game-loop/, /game-feel/, /\(games\)\//] },
  { script: 'verify-gopher-invariants.ts', patterns: [/(^|\/)gopher/] },
  { script: 'verify-gunrush-replay.ts', patterns: [/(^|\/)gunrush/] },
  { script: 'verify-high-striker-replay.ts', patterns: [/high-striker/, /rewards\/wallet/, /battlepass\/daily-quests/, /\(games\)\/high-striker\//, /achievements\/registry/, /stats\/deltas/] },
  { script: 'verify-high-striker-reset.ts', patterns: [/high-striker/, /high_striker/, /achievements\/registry/, /stats\/deltas/] },
  { script: 'verify-tin-duck-gallery.ts', patterns: [/tin-duck/, /rewards\/wallet/, /battlepass\/daily-quests/, /achievements\/registry/] },
  { script: 'verify-lucky-cage-client-parity.ts', patterns: [/lucky-cage/] },
  { script: 'verify-plinko-rtp.ts', patterns: [/plinko/, /arcade-constants/, /arcade-payout/] },
  { script: 'verify-mines-readout.ts', patterns: [/(^|\/)mines/, /mines-cashout/, /arcade-constants/, /arcade-payout/] },
  { script: 'verify-midway-quality.ts', patterns: [/midway-(quality|three)/] },
  { script: 'verify-midway-themes.ts', patterns: [/midway-three/, /_(skee-ball|high-striker|lucky-cage|prize-claw)-theme/] },
  { script: 'verify-lucky-cage-rtp.ts', patterns: [/lucky-cage/] },
  { script: 'verify-lucky-cage-tumble.ts', patterns: [/lucky-cage/] },
  { script: 'verify-prize-claw-recovery.ts', patterns: [/prize-claw/] },
  { script: 'verify-prize-claw-rtp.ts', patterns: [/prize-claw/] },
  { script: 'verify-reaction-time-invariants.ts', patterns: [/reaction-time/] },
  { script: 'verify-skeeball-replay.ts', patterns: [/skee-ball/] },
  { script: 'verify-snake-invariants.ts', patterns: [/(^|\/)snake/] },
  { script: 'verify-snake-replay.ts', patterns: [/(^|\/)snake/, /rewards\/wallet/] },
  { script: 'verify-stack-cabinet-replay.ts', patterns: [/stack-cabinet/, /rewards\/wallet/, /\(games\)\/stack\//] },
  { script: 'verify-stack-endless-replay.ts', patterns: [/stack-replay/, /api\/games\/stack\//, /rewards\/wallet/, /\(games\)\/stack\//] },
  { script: 'verify-tetris-invariants.ts', patterns: [/(^|\/)tetris/] },
  { script: 'verify-ticket-stop-replay.ts', patterns: [/ticket-stop/, /rewards\/wallet/] },
  { script: 'verify-trick-shot.ts', patterns: [/trick-shot/, /pool-physics/, /_pool-canvas/, /rewards\/wallet/] },
  { script: 'verify-ring-toss-replay.ts', patterns: [/ring-toss/, /rewards\/wallet/] },
  { script: 'verify-mini-golf-replay.ts', patterns: [/mini-golf/, /rewards\/wallet/] },
  { script: 'verify-bumper-cars.ts', patterns: [/bumper-cars/, /rewards\/wallet/] },
  { script: 'verify-word-puzzles.ts', patterns: [/connections/, /pangram/, /word-grid/, /word-puzzles/] },
];

const sharedGamePatterns = [
  /src\/server\/arcade\/(arcade-rng|game-session|rewards|score-events)/,
  /src\/features\/arcade\/lib\/(rewards|run-result)/,
  /src\/app\/api\/games\/_shared/,
  /package(?:-lock)?\.json$/,
  /tsconfig\.json$/,
];

function eventPayload() {
  const eventPath = process.env.GITHUB_EVENT_PATH ?? process.env.FORGEJO_EVENT_PATH;
  if (!eventPath || !existsSync(eventPath)) return {};
  try {
    return JSON.parse(readFileSync(eventPath, 'utf8'));
  } catch {
    return {};
  }
}

function changedFiles() {
  const eventName = process.env.GITHUB_EVENT_NAME ?? process.env.FORGEJO_EVENT_NAME ?? '';
  if (eventName === 'schedule' || eventName === 'workflow_dispatch') return null;

  const payload = eventPayload();
  const base = process.env.GAME_INVARIANT_BASE_SHA
    ?? (eventName === 'pull_request' ? payload.pull_request?.base?.sha : payload.before);
  let resolvedBase = base;
  if (!resolvedBase || /^0+$/.test(resolvedBase)) {
    try {
      resolvedBase = execFileSync('git', ['merge-base', 'main', 'HEAD'], {
        cwd: root,
        encoding: 'utf8',
      }).trim();
    } catch {
      return null;
    }
  }

  try {
    const gitLines = (args) => execFileSync('git', args, {
      cwd: root,
      encoding: 'utf8',
    }).split(/\r?\n/).filter(Boolean);
    return [...new Set([
      ...gitLines(['diff', '--name-only', `${resolvedBase}..HEAD`]),
      ...gitLines(['diff', 'HEAD', '--name-only']),
      ...gitLines(['ls-files', '--others', '--exclude-standard']),
    ])];
  } catch {
    return null;
  }
}

function selectedSuites(mode) {
  if (mode === '--all') return suites;
  const changed = changedFiles();
  if (changed === null) {
    console.log('Unable to resolve a safe diff; running every game invariant suite.');
    return suites;
  }
  if (changed.some((file) => sharedGamePatterns.some((pattern) => pattern.test(file)))) {
    console.log('Shared gameplay code changed; running every game invariant suite.');
    return suites;
  }
  const picked = suites.filter((suite) =>
    changed.some((file) => suite.patterns.some((pattern) => pattern.test(file))),
  );
  console.log(`Selected ${picked.length} game invariant suite(s) from ${changed.length} changed file(s).`);
  return picked;
}

if (!existsSync(tsxCli)) {
  console.error('tsx is not installed; run npm ci before game invariant checks.');
  process.exit(1);
}

const mode = process.argv[2] ?? '--changed';
if (!['--all', '--changed'].includes(mode)) {
  console.error('Usage: node scripts/run-game-invariants.mjs [--all|--changed]');
  process.exit(2);
}

const selected = selectedSuites(mode);
if (selected.length === 0) {
  console.log('No game-specific invariant suites are required for this change.');
  process.exit(0);
}

for (const suite of selected) {
  console.log(`\n▶ ${suite.script}`);
  const result = spawnSync(process.execPath, [tsxCli, path.join(root, 'scripts', suite.script)], {
    cwd: root,
    // The direct Crash command retains its presentation-only worktree guard.
    // This orchestrator deliberately runs alongside unrelated server work and
    // is responsible only for executing the deterministic game proof itself.
    env: suite.script === 'verify-crash-invariants.ts'
      ? { ...process.env, ARCADE_SKIP_CRASH_SCOPE_GUARD: '1' }
      : process.env,
    stdio: 'inherit',
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

console.log(`\nAll ${selected.length} selected game invariant suites passed.`);
