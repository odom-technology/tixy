#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';

async function loadEnvFile(filePath) {
  let text;
  try {
    text = await fs.readFile(filePath, 'utf8');
  } catch (error) {
    if (error && error.code === 'ENOENT') return;
    throw error;
  }

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator === -1) continue;

    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if (!key || process.env[key] !== undefined) continue;

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

for (const envFile of ['env/.env.local', 'env/.env', '.env.local', '.env']) {
  await loadEnvFile(path.join(process.cwd(), envFile));
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function resolveCommand(command, args) {
  if (process.platform !== 'win32' || command.includes('/') || command.includes('\\')) {
    return { command, args };
  }
  const localCmd = path.join(process.cwd(), 'node_modules', '.bin', `${command}.cmd`);
  if (!(await fileExists(localCmd))) return { command, args };
  return {
    command: 'cmd.exe',
    args: ['/d', '/s', '/c', localCmd, ...args],
  };
}

const [rawCommand, ...args] = process.argv.slice(2);
if (!rawCommand) {
  console.error('Usage: node scripts/run-with-env.mjs <command> [...args]');
  process.exit(1);
}

const resolved = await resolveCommand(rawCommand, args);
const child = spawn(resolved.command, resolved.args, {
  env: process.env,
  shell: false,
  stdio: 'inherit',
});

child.on('exit', (code, signal) => {
  if (signal) {
    console.error(`${rawCommand} exited with signal ${signal}`);
    process.exit(1);
  }
  process.exit(code ?? 0);
});

child.on('error', (error) => {
  console.error(error);
  process.exit(1);
});
