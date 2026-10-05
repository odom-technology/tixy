// ─────────────────────────────────────────────────────────────────────────────
// Daily-puzzle DB pools for Pangram + Word Grid.
//
// When the admin-editable `pangram_puzzles` / `word_grid_puzzles` tables have
// rows, the day's puzzle is chosen from them (cycled by the same date-seed the
// in-code defaults use); when empty the games fall back to their curated
// defaults. The route layer calls `applyDaily*Override(dateKey)` once per request
// before any grading so the puzzle/guess/score routes all agree on the day's set.
//
// A short TTL cache keeps the per-request DB read cheap (admin edits land within
// one TTL). SERVER-ONLY — imports the db client.
// ─────────────────────────────────────────────────────────────────────────────
import { asc } from 'drizzle-orm';
import { db } from '@/server/db/client';
import { pangramPuzzles, wordGridPuzzles } from '@/server/db/schema';
import {
  dateToSeed as pangramDateToSeed,
  registerDailySet,
  clearDailySet,
  validatePangramSet,
  type PangramSet,
} from './pangram';
import {
  dateToSeed as wordGridDateToSeed,
  registerDailyAnswer,
  clearDailyAnswer,
} from './word-grid';

const TTL_MS = 15_000;

type PoolCache<T> = { at: number; rows: T[] };
let pangramCache: PoolCache<PangramSet> | null = null;
let wordGridCache: PoolCache<string> | null = null;

async function loadPangramPool(): Promise<PangramSet[]> {
  if (pangramCache && Date.now() - pangramCache.at < TTL_MS) return pangramCache.rows;
  const rows = await db
    .select()
    .from(pangramPuzzles)
    .orderBy(asc(pangramPuzzles.sortOrder));
  const parsed: PangramSet[] = [];
  for (const r of rows) {
    try {
      const letters = JSON.parse(r.lettersJson) as string[];
      const validation = validatePangramSet({ letters, center: r.center });
      if (validation.ok) {
        parsed.push(validation.set);
      } else if ('error' in validation) {
        console.warn(`Skipping invalid Pangram puzzle ${r.id}: ${validation.error}`);
      }
    } catch (error) {
      console.warn(`Skipping malformed Pangram puzzle ${r.id}:`, error);
    }
  }
  pangramCache = { at: Date.now(), rows: parsed };
  return parsed;
}

async function loadWordGridPool(): Promise<string[]> {
  if (wordGridCache && Date.now() - wordGridCache.at < TTL_MS) return wordGridCache.rows;
  const rows = await db
    .select()
    .from(wordGridPuzzles)
    .orderBy(asc(wordGridPuzzles.sortOrder));
  const parsed = rows
    .map((r) => String(r.answer ?? '').trim().toLowerCase())
    .filter((a) => /^[a-z]{5}$/.test(a));
  wordGridCache = { at: Date.now(), rows: parsed };
  return parsed;
}

/** Reset the caches so the next read hits the DB (call after admin writes). */
export function invalidateDailyPuzzlePools(): void {
  pangramCache = null;
  wordGridCache = null;
}

/** Apply the DB pool's set for `dateKey` (or clear the override if empty). */
export async function applyDailyPangramOverride(dateKey: string): Promise<void> {
  const pool = await loadPangramPool();
  if (pool.length === 0) {
    clearDailySet(dateKey);
    return;
  }
  registerDailySet(dateKey, pool[pangramDateToSeed(dateKey) % pool.length]!);
}

/** Apply the DB pool's answer for `dateKey` (or clear the override if empty). */
export async function applyDailyWordGridOverride(dateKey: string): Promise<void> {
  const pool = await loadWordGridPool();
  if (pool.length === 0) {
    clearDailyAnswer(dateKey);
    return;
  }
  registerDailyAnswer(dateKey, pool[wordGridDateToSeed(dateKey) % pool.length]!);
}
