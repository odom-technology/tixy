// ───────────────────────────────────────────────────────────────────────────
// Word Grid — server logic (SERVER-ONLY).
//
// Deterministic, date-seeded daily 5-letter word puzzle (Wordle-style). The
// day's answer is derived purely from the UTC date key, so it is identical for
// every player and stable across reloads without any DB rotation table.
//
// IMPORTANT: this module imports the answer dictionary. It must NEVER be
// imported from client code — doing so would leak the daily answer and bloat
// the bundle. Import only from server route handlers.
// ───────────────────────────────────────────────────────────────────────────

import {
  WORD_GRID_ANSWERS,
  WORD_GRID_VALID,
} from './data/word-grid/word-grid-words';

export { WORD_GRID_ANSWERS };

export const WORD_GRID_LENGTH = 5;
export const WORD_GRID_MAX_GUESSES = 6;

/** Letter grade after grading a guess against the answer. */
export type WordGridTileResult = 'correct' | 'present' | 'absent';

// Fixed UTC epoch for the public "day number" shown in the share header.
// 2025-01-01 is day 1.
const EPOCH_UTC_MS = Date.UTC(2025, 0, 1);
const DAY_MS = 86_400_000;

// ─── Date helpers (UTC, must match the client) ──────────────────────────────

const pad2 = (n: number): string => n.toString().padStart(2, '0');

/** UTC 'YYYY-MM-DD' for a Date (defaults to now). Mirrors the client. */
export const getUtcDateKey = (d: Date = new Date()): string =>
  `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;

/** True for strings shaped exactly 'YYYY-MM-DD'. */
export const isValidDateKey = (value: unknown): value is string =>
  typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);

/**
 * Public day number for the share header: whole UTC days since 2025-01-01,
 * +1 so 2025-01-01 reads as "#1". Derived from the date key (parsed as UTC).
 */
export const getDayNumber = (dateKey: string): number => {
  const [y, m, d] = dateKey.split('-').map(Number);
  if (!y || !m || !d) return 0;
  const ms = Date.UTC(y, m - 1, d);
  return Math.floor((ms - EPOCH_UTC_MS) / DAY_MS) + 1;
};

// ─── Seed PRNG (same string-hash + mulberry32 proven in Connections) ─────────

/** Hash a date key string into a positive 32-bit seed. */
export const dateToSeed = (dateKey: string): number => {
  let h = 0;
  for (let i = 0; i < dateKey.length; i++) {
    h = ((h << 5) - h + dateKey.charCodeAt(i)) | 0;
  }
  return Math.abs(h) || 1;
};

/** Deterministic PRNG factory (mulberry32). */
export const mulberry32 = (seed: number): (() => number) => () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

// ─── Answer + validation ─────────────────────────────────────────────────────

// Per-process override of the day's answer, populated from the admin-editable DB
// pool before any grading (see daily-puzzle-pool.ts). Keeps the guess + score
// routes consistent; routes re-apply each request so admin edits take effect.
const dailyAnswerOverride = new Map<string, string>();

/** Set the day's answer (DB pool). Called by the route layer. */
export const registerDailyAnswer = (dateKey: string, answer: string): void => {
  dailyAnswerOverride.set(dateKey, answer.trim().toLowerCase());
};

/** Drop any override (DB pool emptied ⇒ fall back to the curated answers). */
export const clearDailyAnswer = (dateKey: string): void => {
  dailyAnswerOverride.delete(dateKey);
};

/** The answer (lowercase) for a date key — DB override if set, else curated. */
export const getDailyAnswer = (dateKey: string): string => {
  const override = dailyAnswerOverride.get(dateKey);
  if (override) return override;
  const idx = dateToSeed(dateKey) % WORD_GRID_ANSWERS.length;
  return WORD_GRID_ANSWERS[idx]!;
};

/** True when `word` is a real dictionary word (case-insensitive, 5 letters). */
export const isValidGuess = (word: string): boolean => {
  if (typeof word !== 'string') return false;
  const w = word.trim().toLowerCase();
  if (!/^[a-z]{5}$/.test(w)) return false;
  return WORD_GRID_VALID.has(w);
};

// ─── Grading (the EXACT classic two-pass duplicate-letter algorithm) ─────────
//
// Pass 1: mark all exact-position matches green and consume those answer
//         letters from a multiset.
// Pass 2: for the rest, mark yellow only while the answer still has an
//         unconsumed instance of that letter; decrement on each use.
//
// Without the consume/decrement step, a guessed double letter against a
// single-letter answer wrongly shows two yellows (the #1 Wordle bug).
//   e.g. answer ALLEY / guess LLAMA →
//     L(0): answer[0]=A, not green; answer has 2 L → yellow, L→1 remaining
//     L(1): answer[1]=L → green, L→0 remaining (consumed first in pass 1)
//   net: exactly the two real L positions are honored, never doubled.

/**
 * Grade a 5-letter guess against the answer. Both are compared lowercased.
 * Returns a 5-element array of 'correct' | 'present' | 'absent'.
 */
export const gradeWordGrid = (
  guess: string,
  answer: string,
): WordGridTileResult[] => {
  const g = guess.toLowerCase();
  const a = answer.toLowerCase();
  const n = WORD_GRID_LENGTH;

  const res: WordGridTileResult[] = new Array(n).fill('absent');
  const counts: Record<string, number> = {};
  for (const ch of a) counts[ch] = (counts[ch] ?? 0) + 1;

  // Pass 1 — greens (consume the matched answer letter).
  for (let i = 0; i < n; i++) {
    if (g[i] === a[i]) {
      res[i] = 'correct';
      counts[g[i]!] = (counts[g[i]!] ?? 0) - 1;
    }
  }

  // Pass 2 — yellows from the remaining multiset.
  for (let i = 0; i < n; i++) {
    if (res[i] === 'correct') continue;
    const ch = g[i]!;
    if ((counts[ch] ?? 0) > 0) {
      res[i] = 'present';
      counts[ch] -= 1;
    }
  }

  return res;
};

/** Convenience: true when every tile is 'correct'. */
export const isWinningGrade = (result: WordGridTileResult[]): boolean =>
  result.length === WORD_GRID_LENGTH && result.every((r) => r === 'correct');
