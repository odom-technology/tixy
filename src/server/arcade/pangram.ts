// ─────────────────────────────────────────────────────────────────────────────
// Pangram — server puzzle logic. Date-seeded daily letter set + scoring + the
// authoritative solution set. SERVER-ONLY (imports the full dictionary).
//
// Date model: UTC date keys ('YYYY-MM-DD' via getUTC*) on both client + server.
// The day's set is deterministic: PANGRAM_SETS[dateToSeed(dateKey) % len].
// ─────────────────────────────────────────────────────────────────────────────

import {
  PANGRAM_SETS,
  solutionsFor as solutionsForSet,
  scorePangramWord,
  type PangramSet,
  type PangramSolutions,
} from './data/pangram/pangram-data';

export type { PangramSet, PangramSolutions };
export { PANGRAM_SETS, solutionsForSet as solutionsFor, scorePangramWord };

/** A daily hive should be rich enough to play, not merely technically solvable. */
export const PANGRAM_MIN_WORDS = 20;

export type PangramSetValidation =
  | { ok: true; set: PangramSet; solutions: PangramSolutions }
  | { ok: false; error: string };

/**
 * Normalize and validate an admin/database letter set before it can enter the
 * daily rotation. This is deliberately shared by the editor and the DB loader:
 * old or manually-edited rows must meet the same rules as new rows.
 */
export function validatePangramSet(raw: unknown): PangramSetValidation {
  const value = raw as Record<string, unknown> | null;
  if (!value || typeof value !== 'object') {
    return { ok: false, error: 'Missing puzzle.' };
  }

  const letters = Array.isArray(value.letters)
    ? value.letters.map((letter) => String(letter ?? '').trim().toLowerCase())
    : [];
  const center = String(value.center ?? '').trim().toLowerCase();

  if (letters.length !== 7) {
    return { ok: false, error: 'Need exactly 7 letters.' };
  }
  if (!letters.every((letter) => /^[a-z]$/.test(letter))) {
    return { ok: false, error: 'Letters must be single a–z characters.' };
  }
  if (new Set(letters).size !== 7) {
    return { ok: false, error: 'Letters must be unique.' };
  }
  if (!letters.includes(center)) {
    return { ok: false, error: 'Center must be one of the 7 letters.' };
  }

  const set: PangramSet = { letters, center };
  const solutions = solutionsForSet(set);
  if (solutions.pangrams.length < 1) {
    return { ok: false, error: 'This set has no pangram.' };
  }
  if (solutions.words.length < PANGRAM_MIN_WORDS) {
    return {
      ok: false,
      error: `This set has only ${solutions.words.length} accepted words; daily hives need at least ${PANGRAM_MIN_WORDS}.`,
    };
  }

  return { ok: true, set, solutions };
}

// ── Date helpers (UTC) ───────────────────────────────────────────────────────

const pad2 = (n: number) => n.toString().padStart(2, '0');

/** UTC date key 'YYYY-MM-DD'. Mirrors the client exactly. */
export function getUtcDateKey(date: Date = new Date()): string {
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;
}

/** Fixed UTC epoch for day numbering: 2025-01-01. */
const EPOCH_MS = Date.UTC(2025, 0, 1);
const DAY_MS = 86_400_000;

/** One-based UTC day number since the epoch (2025-01-01 is puzzle #1). */
export function getDayNumber(dateKey: string): number {
  const [y, m, d] = dateKey.split('-').map(Number);
  if (!y || !m || !d) return 0;
  const ms = Date.UTC(y, m - 1, d);
  return Math.max(1, Math.floor((ms - EPOCH_MS) / DAY_MS) + 1);
}

// ── Seed PRNG (same string-hash + mulberry32 proven in the connections page) ──

/** Stable non-negative hash of the date key. */
export function dateToSeed(dateKey: string): number {
  let h = 0;
  for (let i = 0; i < dateKey.length; i++) {
    h = ((h << 5) - h + dateKey.charCodeAt(i)) | 0;
  }
  return Math.abs(h) || 1;
}

/** Deterministic PRNG seeded from an integer. Returns a [0,1) generator. */
export function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── Daily set selection ──────────────────────────────────────────────────────

// Per-process override of the day's set, populated from the admin-editable DB
// pool by `applyDailyPangramOverride` (see daily-puzzle-pool.ts) before any
// grading. Keeps gradeGuess/finalizeScore/getDailySolutions consistent without
// threading the set through every call. Routes re-apply it each request, so
// admin edits take effect within one TTL.
const dailySetOverride = new Map<string, PangramSet>();

/** Set the day's letter set (DB pool). Called by the route layer. */
export function registerDailySet(dateKey: string, set: PangramSet): void {
  dailySetOverride.set(dateKey, set);
}

/** Drop any override for a day (DB pool emptied ⇒ fall back to the defaults). */
export function clearDailySet(dateKey: string): void {
  dailySetOverride.delete(dateKey);
}

/** The letter set for a given UTC date key — DB override if set, else curated. */
export function getDailySet(dateKey: string): PangramSet {
  const override = dailySetOverride.get(dateKey);
  if (override) return override;
  const idx = dateToSeed(dateKey) % PANGRAM_SETS.length;
  return PANGRAM_SETS[idx]!;
}

// ── Solutions cache (per process) ────────────────────────────────────────────
// solutionsFor scans ~5k words; cache by date key so repeated requests in a day
// are cheap. Keyed by the set's signature so it survives identical sets.

const solutionCache = new Map<string, PangramSolutions>();

function setKey(set: PangramSet): string {
  return `${[...set.letters].sort().join('')}|${set.center}`;
}

/** Cached solution set for the day's letter set. */
export function getDailySolutions(dateKey: string): PangramSolutions {
  const set = getDailySet(dateKey);
  const key = setKey(set);
  const cached = solutionCache.get(key);
  if (cached) return cached;
  const sol = solutionsForSet(set);
  solutionCache.set(key, sol);
  return sol;
}

// ── Word grading (server-authoritative) ──────────────────────────────────────

export type GuessReason = 'too-short' | 'missing-center' | 'bad-letter' | 'not-a-word';

export type GuessResult = {
  accepted: boolean;
  isPangram: boolean;
  points: number;
  reason?: GuessReason;
};

/**
 * Grade a single guess against the day's letter set + solution dictionary.
 * Order of checks mirrors the player-facing reasons. Never reveals the list.
 */
export function gradeGuess(dateKey: string, rawWord: string): GuessResult {
  const word = String(rawWord ?? '').trim().toLowerCase();
  const set = getDailySet(dateKey);
  const letterSet = new Set(set.letters);

  if (!/^[a-z]+$/.test(word) || word.length < 4) {
    return { accepted: false, isPangram: false, points: 0, reason: 'too-short' };
  }
  if (!word.includes(set.center)) {
    return { accepted: false, isPangram: false, points: 0, reason: 'missing-center' };
  }
  for (let i = 0; i < word.length; i++) {
    if (!letterSet.has(word[i]!)) {
      return { accepted: false, isPangram: false, points: 0, reason: 'bad-letter' };
    }
  }
  const solutions = getDailySolutions(dateKey);
  if (!solutions.words.includes(word)) {
    // Shape/letters are fine but it's not in the curated dictionary.
    return { accepted: false, isPangram: false, points: 0, reason: 'not-a-word' };
  }
  const isPangram = new Set(word).size === 7;
  return { accepted: true, isPangram, points: scorePangramWord(word) };
}

// ── Score finalization (re-validate a whole submitted word list) ──────────────

export type FinalScore = {
  score: number;
  wordsFound: number;
  pangrams: number;
  /** The de-duplicated, server-validated list of accepted words. */
  validWords: string[];
  /** Every solution word that was not submitted, for post-game reveal only. */
  missedWords: string[];
};

/**
 * Authoritatively re-grade an entire submitted word list. Ignores any
 * client-claimed score. De-dupes, validates each word, sums points.
 */
export function finalizeScore(dateKey: string, submittedWords: unknown): FinalScore {
  const solutions = getDailySolutions(dateKey);
  const valid = new Set(solutions.words);
  const seen = new Set<string>();
  const validWords: string[] = [];
  let score = 0;
  let pangrams = 0;

  const list = Array.isArray(submittedWords) ? submittedWords : [];
  for (const raw of list) {
    const word = String(raw ?? '').trim().toLowerCase();
    if (seen.has(word)) continue;
    if (!valid.has(word)) continue;
    seen.add(word);
    validWords.push(word);
    score += scorePangramWord(word);
    if (new Set(word).size === 7) pangrams++;
  }

  const missedWords = solutions.words.filter((word) => !seen.has(word));

  return { score, wordsFound: validWords.length, pangrams, validWords, missedWords };
}

// ── Rank tiers (as % of the day's maxScore) ──────────────────────────────────

export type RankTier = { name: string; pct: number };

/** Eight tiers, low→high, expressed as a fraction of maxScore. */
export const PANGRAM_RANK_TIERS: RankTier[] = [
  { name: 'Beginner', pct: 0 },
  { name: 'Good Start', pct: 0.02 },
  { name: 'Moving Up', pct: 0.05 },
  { name: 'Good', pct: 0.08 },
  { name: 'Great', pct: 0.15 },
  { name: 'Amazing', pct: 0.25 },
  { name: 'Genius', pct: 0.7 },
  { name: 'Queen Bee', pct: 1 },
];

/** The highest tier reached for a score given the day's maxScore. */
export function rankTierForScore(score: number, maxScore: number): RankTier {
  if (maxScore <= 0) return PANGRAM_RANK_TIERS[0]!;
  const ratio = score / maxScore;
  let tier = PANGRAM_RANK_TIERS[0]!;
  for (const t of PANGRAM_RANK_TIERS) {
    if (ratio >= t.pct) tier = t;
  }
  return tier;
}
