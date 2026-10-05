/* The sample pipeline. Prompts live in catalog.ts; this renders, auditions
   and ships them.

     npm run sfx -- gen [id ...] [--bank b] [--takes n]   render missing takes
     npm run sfx -- takes [id ...] [--bank b]             shape every take for /kit/sounds
     npm run sfx -- sheet [id ...]                         spectrograms of the takes, for review
     npm run sfx -- pick '{"id":[0,2]}'                   set picks (what /kit/sounds copies)
     npm run sfx -- build                                  ship the picks, write sfx-bank.ts
     npm run sfx -- list [--bank b]                        what is rendered, picked and shipped

   Raw takes are cached outside the repo (TIXY_SFX_CACHE, default
   ~/.cache/tixy-sfx), keyed by a hash of the prompt and its settings, so a
   take is only paid for once and an edited prompt starts fresh. The key is
   ELEVENLABS_API_KEY, from the environment or env/.env.local. */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

import { SFX_CATALOG } from './catalog';
import { decode, describe, encode, RATE, shapeTake } from './process';
import type { SfxSpec } from './types';

const ROOT = path.resolve(import.meta.dirname, '../..');
const CACHE = process.env.TIXY_SFX_CACHE ?? path.join(homedir(), '.cache/tixy-sfx');
const SHIP_DIR = path.join(ROOT, 'public/audio/sfx');
const TAKES_DIR = path.join(ROOT, 'public/audio/sfx-takes');
const BANK_FILE = path.join(ROOT, 'src/features/arcade/lib/sfx-bank.ts');
const MODEL = 'eleven_text_to_sound_v2';
const DEFAULT_TAKES = 3;

function apiKey(): string {
  if (process.env.ELEVENLABS_API_KEY) return process.env.ELEVENLABS_API_KEY;
  const local = path.join(ROOT, 'env/.env.local');
  if (existsSync(local)) {
    const line = readFileSync(local, 'utf8').split('\n').find((l) => l.startsWith('ELEVENLABS_API_KEY='));
    if (line) return line.slice('ELEVENLABS_API_KEY='.length).trim().replace(/^["']|["']$/g, '');
  }
  throw new Error('Set ELEVENLABS_API_KEY or add it to env/.env.local');
}

const seconds = (spec: SfxSpec) => Math.min(30, Math.max(0.5, spec.seconds ?? 1));

/** Same prompt and settings, same hash: the cache key for a spec's takes. */
function specHash(spec: SfxSpec): string {
  const key = JSON.stringify([MODEL, spec.prompt, seconds(spec), spec.influence ?? 0.5, Boolean(spec.loop)]);
  return createHash('sha256').update(key).digest('hex').slice(0, 8);
}

function takePath(spec: SfxSpec, n: number): string {
  return path.join(CACHE, 'raw', spec.id, `${specHash(spec)}-${n}.mp3`);
}

function cachedTakes(spec: SfxSpec): string[] {
  const out: string[] = [];
  for (let n = 0; existsSync(takePath(spec, n)); n += 1) out.push(takePath(spec, n));
  return out;
}

async function render(spec: SfxSpec, key: string): Promise<Buffer> {
  for (let attempt = 0; ; attempt += 1) {
    const res = await fetch(`https://api.elevenlabs.io/v1/sound-generation?output_format=mp3_44100_128`, {
      method: 'POST',
      headers: { 'xi-api-key': key, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: spec.prompt,
        duration_seconds: seconds(spec),
        prompt_influence: spec.influence ?? 0.5,
        loop: Boolean(spec.loop),
        model_id: MODEL,
      }),
    });
    if (res.ok) return Buffer.from(await res.arrayBuffer());
    const body = await res.text();
    if ((res.status === 429 || res.status >= 500) && attempt < 4) {
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
      continue;
    }
    throw new Error(`${spec.id}: ElevenLabs ${res.status} ${body.slice(0, 300)}`);
  }
}

/** Run jobs three at a time, the plan's concurrency. */
async function pool<T>(jobs: (() => Promise<T>)[], size = 3): Promise<T[]> {
  const results: T[] = [];
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, jobs.length) }, async () => {
      while (next < jobs.length) {
        const i = next++;
        results[i] = await jobs[i]!();
      }
    }),
  );
  return results;
}

function select(args: string[]): SfxSpec[] {
  const bankAt = args.indexOf('--bank');
  const bank = bankAt >= 0 ? args[bankAt + 1] : undefined;
  const ids = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--bank' && args[i - 1] !== '--takes');
  const picked = SFX_CATALOG.filter((s) => (!bank || s.bank === bank) && (ids.length === 0 || ids.includes(s.id)));
  const unknown = ids.filter((id) => !SFX_CATALOG.some((s) => s.id === id));
  if (unknown.length) throw new Error(`Not in the catalog: ${unknown.join(', ')}`);
  return picked;
}

async function gen(args: string[]): Promise<void> {
  const takesAt = args.indexOf('--takes');
  const override = takesAt >= 0 ? Number(args[takesAt + 1]) : undefined;
  const key = apiKey();
  const jobs: (() => Promise<void>)[] = [];
  let billed = 0;
  for (const spec of select(args)) {
    if (!spec.prompt) continue;
    const want = override ?? spec.takes ?? DEFAULT_TAKES;
    for (let n = cachedTakes(spec).length; n < want; n += 1) {
      billed += seconds(spec);
      jobs.push(async () => {
        const audio = await render(spec, key);
        mkdirSync(path.dirname(takePath(spec, n)), { recursive: true });
        writeFileSync(takePath(spec, n), audio);
        writeFileSync(path.join(CACHE, 'raw', spec.id, `${specHash(spec)}.json`), JSON.stringify(spec, null, 2));
        console.log(`  ${spec.id} take ${n}`);
      });
    }
  }
  if (jobs.length === 0) {
    console.log('Every take is cached.');
    return;
  }
  console.log(`Rendering ${jobs.length} takes, ${billed.toFixed(1)} s of audio.`);
  await pool(jobs);
}

function takes(args: string[]): void {
  type Index = Record<string, { bank: string; prompt: string; pick: number[]; takes: ({ url: string } & ReturnType<typeof describe>)[] }>;
  const indexFile = path.join(TAKES_DIR, 'index.json');
  const index: Index = existsSync(indexFile) ? JSON.parse(readFileSync(indexFile, 'utf8')) : {};
  for (const spec of select(args)) {
    if (!spec.prompt) continue;
    const raw = cachedTakes(spec);
    if (raw.length === 0) continue;
    const dir = path.join(TAKES_DIR, spec.id);
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    const hash = specHash(spec);
    index[spec.id] = {
      bank: spec.bank,
      prompt: spec.prompt,
      pick: spec.pick ?? [0],
      takes: raw.map((file, n) => {
        const shaped = shapeTake(decode(file, spec.shape), spec.shape, spec.loop);
        encode(shaped, path.join(dir, `${hash}-${n}.mp3`), spec.loop);
        return { url: `/audio/sfx-takes/${spec.id}/${hash}-${n}.mp3`, ...describe(shaped) };
      }),
    };
    console.log(`  ${spec.id}: ${raw.length} takes`);
  }
  // Drop entries the catalog no longer has.
  for (const id of Object.keys(index)) if (!SFX_CATALOG.some((s) => s.id === id)) delete index[id];
  mkdirSync(TAKES_DIR, { recursive: true });
  writeFileSync(indexFile, JSON.stringify(index, null, 2));
}

function build(): void {
  const ids = new Set<string>();
  for (const spec of SFX_CATALOG) {
    if (ids.has(spec.id)) throw new Error(`Duplicate id ${spec.id}`);
    ids.add(spec.id);
  }
  const keep = new Set<string>();
  const entries: string[] = [];
  const missing: string[] = [];
  for (const spec of SFX_CATALOG) {
    let files: string[];
    let ms: number;
    if (spec.file) {
      const abs = path.join(ROOT, 'public', spec.file);
      if (!existsSync(abs)) throw new Error(`${spec.id}: ${spec.file} is not in public/`);
      files = [spec.file.startsWith('/') ? spec.file : `/${spec.file}`];
      ms = Math.round((decode(abs).length / RATE) * 1000);
    } else {
      const raw = cachedTakes(spec);
      const picks = spec.pick ?? [0];
      if (picks.some((n) => !raw[n])) {
        missing.push(spec.id);
        // Ship what was built before, so a missing cache never drops a sound.
        const dir = path.join(SHIP_DIR, spec.bank);
        const old = existsSync(dir) ? readdirSync(dir).filter((f) => f.startsWith(`${spec.id}.`)).sort() : [];
        if (old.length === 0) continue;
        files = old.map((f) => `/audio/sfx/${spec.bank}/${f}`);
        for (const f of old) keep.add(path.join(dir, f));
        ms = Math.round((decode(path.join(dir, old[0]!)).length / RATE) * 1000);
      } else {
        files = [];
        ms = 0;
        picks.forEach((n, v) => {
          const shaped = shapeTake(decode(raw[n]!, spec.shape), spec.shape, spec.loop);
          ms = Math.max(ms, Math.round((shaped.length / RATE) * 1000));
          const dir = path.join(SHIP_DIR, spec.bank);
          mkdirSync(dir, { recursive: true });
          const tmp = path.join(dir, `.${spec.id}.tmp.mp3`);
          encode(shaped, tmp, spec.loop);
          const bytes = readFileSync(tmp);
          rmSync(tmp);
          const name = `${spec.id}.${v}.${createHash('sha256').update(bytes).digest('hex').slice(0, 8)}.mp3`;
          writeFileSync(path.join(dir, name), bytes);
          keep.add(path.join(dir, name));
          files.push(`/audio/sfx/${spec.bank}/${name}`);
        });
      }
    }
    const loop = spec.loop ? ', loop: true' : '';
    entries.push(`  '${spec.id}': { bank: '${spec.bank}', files: [${files.map((f) => `'${f}'`).join(', ')}], ms: ${ms}${loop} },`);
  }
  // Remove shipped files that no spec claims any more.
  if (existsSync(SHIP_DIR)) {
    for (const bank of readdirSync(SHIP_DIR)) {
      for (const f of readdirSync(path.join(SHIP_DIR, bank))) {
        const abs = path.join(SHIP_DIR, bank, f);
        if (!keep.has(abs)) rmSync(abs);
      }
    }
  }
  writeFileSync(
    BANK_FILE,
    `// Generated by \`npm run sfx -- build\` from scripts/sfx/catalog.ts. Edit the
// catalog and rebuild; cue volumes and pitch live in sfx-cues.ts.

export type SfxEntry = {
  /** 'core' loads on the first gesture; any other bank loads with its game. */
  bank: string;
  /** Variants, played in turn with no repeats. */
  files: readonly string[];
  /** Longest variant, in ms. */
  ms: number;
  loop?: true;
};

export const SFX_BANK = {
${entries.join('\n')}
} as const satisfies Record<string, SfxEntry>;

export type SfxId = keyof typeof SFX_BANK;
`,
  );
  console.log(`Wrote ${entries.length} sounds to sfx-bank.ts.`);
  if (missing.length) console.log(`No cached take for the pick, kept the shipped file: ${missing.join(', ')}`);
}

/** One PNG per sound, a waveform over a spectrogram per shaped take, so a
 *  reviewer can see clicks, double hits and long tails before listening.
 *  Run `takes` first. */
function sheet(args: string[]): void {
  const out = path.join(CACHE, 'sheets');
  mkdirSync(out, { recursive: true });
  for (const spec of select(args)) {
    const dir = path.join(TAKES_DIR, spec.id);
    if (!existsSync(dir)) continue;
    const files = readdirSync(dir).filter((f) => f.endsWith('.mp3')).sort();
    if (files.length === 0) continue;
    const inputs = files.flatMap((f) => ['-i', path.join(dir, f)]);
    const rows = files.map((f, i) =>
      `[${i}:a]asplit[a${i}][b${i}];[a${i}]showwavespic=s=640x70:colors=white[w${i}];` +
      `[b${i}]showspectrumpic=s=640x110:legend=0:scale=log[s${i}];` +
      `[w${i}][s${i}]vstack,drawtext=text='take ${f.replace(/^.*-(\d+)\.mp3$/, '$1')}':x=6:y=4:fontcolor=yellow:fontsize=16[r${i}]`,
    );
    const graph = `${rows.join(';')};${files.map((_, i) => `[r${i}]`).join('')}vstack=inputs=${files.length}`;
    const target = path.join(out, `${spec.id}.png`);
    const run = spawnSync('ffmpeg', ['-v', 'error', '-y', ...inputs, '-filter_complex', graph, '-frames:v', '1', target]);
    if (run.status !== 0) throw new Error(`sheet ${spec.id}: ${run.stderr.toString()}`);
    console.log(target);
  }
}

/** Write picks into catalog.ts: `pick '{"coin-clink":[0,2]}'`, the command
 *  /kit/sounds copies. Rebuild after. */
function pick(args: string[]): void {
  const picks = JSON.parse(args.join(' ')) as Record<string, number[]>;
  const file = path.join(import.meta.dirname, 'catalog.ts');
  let source = readFileSync(file, 'utf8');
  for (const [id, takes] of Object.entries(picks)) {
    if (!SFX_CATALOG.some((s) => s.id === id)) throw new Error(`Not in the catalog: ${id}`);
    if (!Array.isArray(takes) || takes.some((n) => !Number.isInteger(n) || n < 0)) throw new Error(`${id}: picks are take numbers`);
    const start = source.indexOf(`id: '${id}'`);
    const end = source.indexOf('\n  },', start);
    const spec = source.slice(start, end === -1 ? undefined : end);
    const value = `pick: [${takes.join(', ')}]`;
    const next = /pick: \[[^\]]*\]/.test(spec)
      ? spec.replace(/pick: \[[^\]]*\]/, value)
      : spec.replace(/(bank: '[^']+',)/, `$1 ${value},`);
    source = source.slice(0, start) + next + source.slice(start + spec.length);
    console.log(`  ${id}: ${value}`);
  }
  writeFileSync(file, source);
}

function list(args: string[]): void {
  for (const spec of select(args)) {
    if (spec.file) {
      console.log(`${spec.bank.padEnd(13)} ${spec.id.padEnd(22)} file ${spec.file}`);
      continue;
    }
    const raw = cachedTakes(spec).length;
    const want = spec.takes ?? DEFAULT_TAKES;
    console.log(`${spec.bank.padEnd(13)} ${spec.id.padEnd(22)} takes ${raw}/${want}  pick ${(spec.pick ?? [0]).join(',')}`);
  }
}

const [command, ...rest] = process.argv.slice(2);
switch (command) {
  case 'gen': await gen(rest); break;
  case 'takes': takes(rest); break;
  case 'build': build(); break;
  case 'sheet': sheet(rest); break;
  case 'pick': pick(rest); break;
  case 'list': list(rest); break;
  default:
    console.log('npm run sfx -- gen|takes|sheet|pick|build|list [id ...] [--bank b] [--takes n]');
    process.exitCode = command ? 1 : 0;
}
