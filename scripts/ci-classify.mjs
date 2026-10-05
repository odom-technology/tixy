#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';

const docsOnly = [
  /^docs\//,
  /^(?:README|AGENTS|CONTRIBUTING|CHANGELOG)(?:\.[^/]+)?$/i,
  /^[^/]+\.md$/i,
  /^ops\/forgejo-(?:shared|long)-runner(?:\.service)?\.yml$/,
  /^ops\/forgejo-(?:shared|long)-runner\.service$/,
];

function readEvent() {
  const eventPath = process.env.GITHUB_EVENT_PATH ?? process.env.FORGEJO_EVENT_PATH;
  if (!eventPath) return {};
  try {
    return JSON.parse(readFileSync(eventPath, 'utf8'));
  } catch {
    return {};
  }
}

function baseSha(eventName, payload) {
  if (eventName === 'pull_request') return payload.pull_request?.base?.sha ?? null;
  if (eventName === 'push') return payload.before ?? null;
  return null;
}

function matches(file, patterns) {
  return patterns.some((pattern) => pattern.test(file));
}

const eventName = process.env.GITHUB_EVENT_NAME ?? process.env.FORGEJO_EVENT_NAME ?? '';
const payload = readEvent();
const base = baseSha(eventName, payload);
const head = process.env.GITHUB_SHA ?? process.env.FORGEJO_SHA ?? 'HEAD';
let changed = [];
let conservative = eventName === 'workflow_dispatch' || eventName === 'schedule';

if (!conservative && base && !/^0+$/.test(base)) {
  try {
    changed = execFileSync('git', ['diff', '--name-only', `${base}..${head}`], {
      encoding: 'utf8',
    })
      .split(/\r?\n/)
      .filter(Boolean);
  } catch {
    conservative = true;
  }
} else if (!conservative) {
  conservative = true;
}

const runChecks =
  conservative || changed.length === 0 || changed.some((file) => !matches(file, docsOnly));
const runDeepQa = runChecks && (eventName === 'workflow_dispatch' || eventName === 'schedule');

const outputs = {
  run_checks: runChecks,
  run_deep_qa: runDeepQa,
};
const outputFile = process.env.GITHUB_OUTPUT ?? process.env.FORGEJO_OUTPUT;
if (outputFile) {
  appendFileSync(
    outputFile,
    Object.entries(outputs)
      .map(([key, value]) => `${key}=${value}\n`)
      .join(''),
  );
}

const reason = conservative
  ? `${eventName || 'unknown event'} uses conservative checks`
  : `${changed.length} changed file(s): ${changed.join(', ') || '(none)'}`;
console.log(
  `CI classification: checks=${runChecks}, scheduled deep QA=${runDeepQa}; ${reason}.`,
);
