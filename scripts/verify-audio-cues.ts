import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import { existsSync } from 'node:fs';

import { SFX_BANK } from '../src/features/arcade/lib/sfx-bank';
import { SAMPLED_CUES } from '../src/features/arcade/lib/sfx-cues';
import { ARCADE_SOUND_CUES, hasProceduralCue } from '../src/features/arcade/lib/sound-manager';
import { GAME_FEEDBACK_SOUND_CUES } from '../src/features/arcade/lib/use-game-feedback';

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) return sourceFiles(fullPath);
      return /\.(?:ts|tsx)$/.test(entry.name) ? [fullPath] : [];
    }),
  );
  return nested.flat();
}

const known = new Set(ARCADE_SOUND_CUES);
const missing = new Map<string, string[]>();
const files = await sourceFiles(path.resolve('src'));

for (const file of files) {
  const source = await readFile(file, 'utf8');
  for (const match of source.matchAll(/SoundManager\.play\(\s*['"]([^'"]+)['"]/g)) {
    const cue = match[1]!;
    if (known.has(cue)) continue;
    const users = missing.get(cue) ?? [];
    users.push(path.relative(process.cwd(), file));
    missing.set(cue, users);
  }
}

for (const cue of Object.values(GAME_FEEDBACK_SOUND_CUES)) {
  if (known.has(cue)) continue;
  const users = missing.get(cue) ?? [];
  users.push('src/features/arcade/lib/use-game-feedback.ts');
  missing.set(cue, users);
}

// The feel kit's pitch ladder rides on these events. Their procedural cues
// must take the pitch argument, or the ladder is flat until samples load.
const LADDER_EVENTS = ['press', 'move', 'impact', 'collect', 'combo', 'capture', 'round-win'] as const;
const soundSource = await readFile(
  path.resolve('src/features/arcade/lib/sound-manager.ts'),
  'utf8',
);
const deaf: string[] = [];
for (const event of LADDER_EVENTS) {
  const cue = GAME_FEEDBACK_SOUND_CUES[event];
  const signature = new RegExp(`^\\s*${cue}: \\(ctx, [^)]*\\bpitch\\b`, 'm');
  if (!signature.test(soundSource)) deaf.push(`${event} (${cue})`);
}
if (deaf.length > 0) {
  console.error(`feedback cues ignore pitch: ${deaf.join(', ')}`);
  process.exitCode = 1;
}

// Every sampled cue points at a shipped file and has a sound to play while
// its bank loads: its own procedural one, or a named fallback.
const sampleErrors: string[] = [];
for (const [cue, sampled] of Object.entries(SAMPLED_CUES)) {
  const entry = SFX_BANK[sampled.sfx];
  if (!entry) {
    sampleErrors.push(`${cue}: no sample ${JSON.stringify(sampled.sfx)} in sfx-bank.ts`);
    continue;
  }
  for (const url of entry.files) {
    if (!existsSync(path.resolve('public', url.replace(/^\//, '')))) sampleErrors.push(`${cue}: missing file public${url}`);
  }
  if (sampled.fallback !== undefined && !hasProceduralCue(sampled.fallback)) {
    sampleErrors.push(`${cue}: fallback ${JSON.stringify(sampled.fallback)} is not a procedural cue`);
  }
  if (sampled.fallback === undefined && !hasProceduralCue(cue)) {
    sampleErrors.push(`${cue}: no procedural sound and no fallback, so its first play is silent`);
  }
}
if (sampleErrors.length > 0) {
  for (const error of sampleErrors) console.error(`sampled cue ${error}`);
  process.exitCode = 1;
}

if (missing.size > 0) {
  for (const [cue, users] of missing) {
    console.error(`unknown SoundManager cue ${JSON.stringify(cue)}: ${users.join(', ')}`);
  }
  process.exitCode = 1;
} else {
  console.log(`audio cue audit passed (${known.size} registered cues)`);
}
