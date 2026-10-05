import { spawnSync } from 'node:child_process';

import type { SfxShape } from './types';

/* Trim and level one take. ElevenLabs returns stereo at a low, uneven level
   with lead-in and sometimes several hits; the game wants one mono event
   that starts on its first sample and sits at a known level. Decode and
   encode go through ffmpeg; the cutting and levelling are plain math here,
   so verify-sfx.ts can test them on synthetic buffers. */

export const RATE = 44100;
const HOP = Math.round(RATE * 0.005); // 5 ms envelope steps

export const SHAPE_DEFAULTS: Required<Omit<SfxShape, 'lowpass'>> = {
  slice: false,
  maxMs: 4000,
  fadeMs: 60,
  tailDb: -50,
  gateDb: -45,
  attackDb: -20,
  levelDb: -16,
  highpass: 40,
};

const db = (x: number) => 20 * Math.log10(Math.max(x, 1e-9));
const undb = (d: number) => Math.pow(10, d / 20);

/** RMS per 5 ms hop. */
export function envelope(samples: Float32Array): Float32Array {
  const n = Math.ceil(samples.length / HOP);
  const env = new Float32Array(n);
  for (let h = 0; h < n; h += 1) {
    let sum = 0;
    const end = Math.min(samples.length, (h + 1) * HOP);
    for (let i = h * HOP; i < end; i += 1) sum += samples[i]! * samples[i]!;
    env[h] = Math.sqrt(sum / Math.max(1, end - h * HOP));
  }
  return env;
}

/** Loudest RMS over any 50 ms window, the level a short cue is heard at. */
export function punch(samples: Float32Array): number {
  const win = Math.round(RATE * 0.05);
  if (samples.length <= win) {
    let sum = 0;
    for (const s of samples) sum += s * s;
    return Math.sqrt(sum / Math.max(1, samples.length));
  }
  let sum = 0;
  for (let i = 0; i < win; i += 1) sum += samples[i]! * samples[i]!;
  let best = sum;
  for (let i = win; i < samples.length; i += 1) {
    sum += samples[i]! * samples[i]! - samples[i - win]! * samples[i - win]!;
    if (sum > best) best = sum;
  }
  return Math.sqrt(Math.max(0, best) / win);
}

export function peak(samples: Float32Array): number {
  let p = 0;
  for (const s of samples) p = Math.max(p, Math.abs(s));
  return p;
}

/**
 * The [start, end) sample range worth keeping. Without `slice`, from the
 * first hop 36 dB under the loudest to the last hop above `tailDb`. With
 * `slice`, only the event that holds the loudest hop: from the foot of its
 * attack to where it falls under `tailDb` for 60 ms.
 */
export function findRange(samples: Float32Array, shape: SfxShape = {}): [number, number] {
  const { slice, tailDb, attackDb } = { ...SHAPE_DEFAULTS, ...shape };
  const env = envelope(samples);
  let top = 0;
  for (let h = 1; h < env.length; h += 1) if (env[h]! > env[top]!) top = h;
  const loud = env[top]!;
  if (loud <= 0) return [0, 0];
  const onset = loud * undb(-36);
  // The tail ends at tailDb, or 6 dB over the take's hiss floor (its
  // quietest tenth) if that is higher, so a noisy take does not run on.
  const sorted = Array.from(env).sort((x, y) => x - y);
  const floor = sorted[Math.floor(sorted.length * 0.1)] ?? 0;
  const tail = Math.max(loud * undb(tailDb), floor * undb(6));
  let first: number;
  let last: number;
  if (slice) {
    // The hit itself: back from the loudest hop while it stays within
    // `attackDb`, then down its attack to the floor, so the cue starts on
    // the hit and not on the noise before it.
    first = top;
    while (first > 0 && env[first - 1]! >= loud * undb(attackDb)) first -= 1;
    while (first > 0 && env[first - 1]! >= onset && env[first - 1]! < env[first]!) first -= 1;
    let quiet = 0;
    last = top;
    for (let h = top; h < env.length; h += 1) {
      if (env[h]! < tail) quiet += 1;
      else { quiet = 0; last = h; }
      if (quiet >= 12) break;
    }
  } else {
    first = 0;
    while (first < top && env[first]! < onset) first += 1;
    last = env.length - 1;
    while (last > top && env[last]! < tail) last -= 1;
  }
  const preroll = Math.round(RATE * 0.003);
  return [Math.max(0, first * HOP - preroll), Math.min(samples.length, (last + 1) * HOP + Math.round(RATE * 0.02))];
}

/**
 * A downward expander under `gateDb` (from the peak hop), 1:3, so the hiss
 * a generated take carries between and after hits drops away while a
 * ringing tail fades naturally. Gain moves smoothly across each hop.
 */
export function gate(samples: Float32Array, gateDb: number): Float32Array {
  const env = envelope(samples);
  let loud = 0;
  for (const e of env) loud = Math.max(loud, e);
  const thr = loud * undb(gateDb);
  const gains = Array.from(env, (e) => (e >= thr || thr <= 0 ? 1 : Math.pow(e / thr, 2)));
  const out = samples.slice();
  for (let i = 0; i < out.length; i += 1) {
    const h = i / HOP;
    const a = Math.min(gains.length - 1, Math.floor(h));
    const b = Math.min(gains.length - 1, a + 1);
    out[i] = out[i]! * (gains[a]! + (gains[b]! - gains[a]!) * (h - a));
  }
  return out;
}

/** Cut, fade and level one take. Loops keep their length and get no fades. */
export function shapeTake(input: Float32Array, shape: SfxShape = {}, loop = false): Float32Array {
  const s = { ...SHAPE_DEFAULTS, ...shape };
  let out: Float32Array;
  if (loop) {
    out = input.slice();
  } else {
    const [a, b] = findRange(input, s);
    const max = Math.round((RATE * s.maxMs) / 1000);
    out = gate(input.slice(a, Math.min(b, a + max)), s.gateDb);
    // 2 ms in so the cut never clicks; the tail fade is equal-power.
    const fadeIn = Math.min(out.length, Math.round(RATE * 0.002));
    for (let i = 0; i < fadeIn; i += 1) out[i] = out[i]! * (i / fadeIn);
    const fade = Math.min(Math.round((RATE * s.fadeMs) / 1000), Math.floor(out.length * 0.4));
    for (let i = 0; i < fade; i += 1) {
      const k = out.length - fade + i;
      out[k] = out[k]! * Math.cos(((i + 1) / fade) * (Math.PI / 2));
    }
  }
  const level = punch(out);
  const top = peak(out);
  if (level <= 0 || top <= 0) return out;
  const gain = Math.min(undb(s.levelDb) / level, undb(-1) / top);
  for (let i = 0; i < out.length; i += 1) out[i] = out[i]! * gain;
  return out;
}

/** Decode any file to mono float at RATE, with the shape's filters. */
export function decode(file: string, shape: SfxShape = {}): Float32Array {
  const s = { ...SHAPE_DEFAULTS, ...shape };
  const filters = [`highpass=f=${s.highpass}`];
  if (shape.lowpass) filters.push(`lowpass=f=${shape.lowpass}`);
  const run = spawnSync(
    'ffmpeg',
    ['-v', 'error', '-i', file, '-af', filters.join(','), '-ac', '1', '-ar', String(RATE), '-f', 'f32le', 'pipe:1'],
    { maxBuffer: 1 << 28 },
  );
  if (run.status !== 0) throw new Error(`ffmpeg decode ${file}: ${run.stderr.toString()}`);
  const buf = run.stdout as Buffer;
  return new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
}

/** Mono MP3. 80 kbps holds short effects; loops get 96 for the long noise.
 *  A file under a quarter second is padded with silence: decoders that sniff
 *  the format (ffmpeg, so Chrome) reject an MP3 of only a few frames. */
export function encode(input: Float32Array, file: string, loop = false): void {
  const min = Math.round(RATE * 0.25);
  const samples = input.length >= min || loop ? input : new Float32Array(min);
  if (samples !== input) samples.set(input);
  const run = spawnSync(
    'ffmpeg',
    ['-v', 'error', '-y', '-f', 'f32le', '-ar', String(RATE), '-ac', '1', '-i', 'pipe:0',
      '-c:a', 'libmp3lame', '-b:a', loop ? '96k' : '80k', file],
    { input: Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength) },
  );
  if (run.status !== 0) throw new Error(`ffmpeg encode ${file}: ${run.stderr.toString()}`);
}

export function describe(samples: Float32Array): { ms: number; peakDb: number; punchDb: number } {
  return {
    ms: Math.round((samples.length / RATE) * 1000),
    peakDb: Math.round(db(peak(samples)) * 10) / 10,
    punchDb: Math.round(db(punch(samples)) * 10) / 10,
  };
}
