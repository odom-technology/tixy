// ---------------------------------------------------------------------------
// Battleship — server-side bot.
//
// Exposes the surface the match module uses:
//   BotDifficulty, BOT_NAMES, isBotUser, getBotUserId, botDifficultyFromId,
//   randomFleet()                       -> a legal ShipPlacement[] (auto-place)
//   computeBotShot(ownShotHistory, diff)-> chosen 0-99 cell index
//
// IMPORTANT (fair play): the bot's targeting uses ONLY its own shot history —
// never the opponent's hidden board. The match module never passes the enemy
// fleet to `computeBotShot`, so the bot literally cannot cheat.
//
// Bot user ids are namespaced 'bot:battleship-<difficulty>' so they never
// collide with another game's bots.
// ---------------------------------------------------------------------------

import { renameGameNamesInText } from '@/features/arcade/lib/game-renames';
import {
  shipCellsFromStart,
  parseAndValidateFleet,
  type ShipPlacement,
  type Shot,
} from '@/features/arcade/lib/battleship';
import {
  BOARD_COLS,
  BOARD_ROWS,
  BOARD_CELLS,
  FLEET,
  SHIP_SIZES,
  cellIndex,
  colOf,
  inBounds,
  rowOf,
  type Orientation,
} from '@/features/arcade/lib/battleship/types';

export type BotDifficulty = 'easy' | 'medium' | 'hard';

const BOT_USER_ID_PREFIX = 'bot:';
const BOT_USER_ID_GAME = 'bot:battleship-';

export const BOT_NAMES: Record<BotDifficulty, string> = {
  easy: renameGameNamesInText('Battleship Recruit (Bot)'),
  medium: renameGameNamesInText('Battleship Gunner (Bot)'),
  hard: renameGameNamesInText('Battleship Admiral (Bot)'),
};

export function isBotUser(userId: string): boolean {
  return userId.startsWith(BOT_USER_ID_PREFIX);
}

export function getBotUserId(difficulty: BotDifficulty): string {
  return `${BOT_USER_ID_GAME}${difficulty}`;
}

/** Parse the difficulty out of a 'bot:battleship-<difficulty>' id, or null. */
export function botDifficultyFromId(userId: string): BotDifficulty | null {
  if (!userId.startsWith(BOT_USER_ID_GAME)) return null;
  const tier = userId.slice(BOT_USER_ID_GAME.length);
  return tier === 'easy' || tier === 'medium' || tier === 'hard' ? tier : null;
}

// ---------------------------------------------------------------------------
// Auto-placement — a random legal fleet
// ---------------------------------------------------------------------------

/** Generate a random, legal fleet placement. Retries until the engine validates. */
export function randomFleet(): ShipPlacement[] {
  for (let attempt = 0; attempt < 200; attempt++) {
    const occupied = new Set<number>();
    const ships: ShipPlacement[] = [];
    let ok = true;

    for (const ship of FLEET) {
      const size = SHIP_SIZES[ship.id];
      let placed: number[] | null = null;
      for (let tries = 0; tries < 100 && !placed; tries++) {
        const orientation: Orientation = Math.random() < 0.5 ? 'h' : 'v';
        const start = Math.floor(Math.random() * BOARD_CELLS);
        const cells = shipCellsFromStart(start, size, orientation);
        if (!cells) continue;
        if (cells.some((c) => occupied.has(c))) continue;
        placed = cells;
      }
      if (!placed) {
        ok = false;
        break;
      }
      for (const c of placed) occupied.add(c);
      ships.push({ id: ship.id, cells: placed });
    }

    if (!ok) continue;
    try {
      return parseAndValidateFleet(ships);
    } catch {
      // extraordinarily unlikely; retry from scratch
    }
  }
  throw new Error('Failed to generate a legal bot fleet.');
}

// ---------------------------------------------------------------------------
// Targeting
// ---------------------------------------------------------------------------

const ORTHO: ReadonlyArray<readonly [number, number]> = [
  [-1, 0], [1, 0], [0, -1], [0, 1],
];

function neighbors(cell: number): number[] {
  const r = rowOf(cell);
  const c = colOf(cell);
  const out: number[] = [];
  for (const [dr, dc] of ORTHO) {
    const nr = r + dr;
    const nc = c + dc;
    if (nr >= 0 && nr < BOARD_ROWS && nc >= 0 && nc < BOARD_COLS) {
      out.push(cellIndex(nr, nc));
    }
  }
  return out;
}

/** Reconstruct the cells of a sunk ship of `size` from a sunk cell, walking the
 *  hit set along whichever axis forms a contiguous run. */
function sunkShipCells(sunkCell: number, size: number, hitCells: Set<number>): number[] {
  for (const axis of ['h', 'v'] as const) {
    const step = axis === 'h' ? 1 : BOARD_COLS;
    const run: number[] = [sunkCell];
    // walk backward
    let cur = sunkCell;
    while (run.length < size) {
      const prev = axis === 'h'
        ? (colOf(cur) > 0 ? cur - step : -1)
        : (rowOf(cur) > 0 ? cur - step : -1);
      if (prev < 0 || !hitCells.has(prev)) break;
      run.unshift(prev);
      cur = prev;
    }
    // walk forward
    cur = sunkCell;
    while (run.length < size) {
      const next = axis === 'h'
        ? (colOf(cur) < BOARD_COLS - 1 ? cur + step : -1)
        : (rowOf(cur) < BOARD_ROWS - 1 ? cur + step : -1);
      if (next < 0 || !hitCells.has(next)) break;
      run.push(next);
      cur = next;
    }
    if (run.length === size) return run;
  }
  return [sunkCell];
}

/**
 * Choose the bot's next shot (0-99) from its own shot history. The opponent's
 * board is NEVER consulted.
 *  - easy: random un-fired cell.
 *  - medium: hunt randomly; once a ship is hit (and not yet sunk) target adjacent
 *    cells.
 *  - hard: same target logic, plus parity (checkerboard) hunting and line
 *    extension to finish ships faster.
 */
export function computeBotShot(ownShotHistory: Shot[], difficulty: BotDifficulty): number {
  const fired = new Set(ownShotHistory.map((s) => s.cell));
  const unfired = (cell: number) => inBounds(cell) && !fired.has(cell);

  const allUnfired: number[] = [];
  for (let i = 0; i < BOARD_CELLS; i++) if (!fired.has(i)) allUnfired.push(i);
  if (allUnfired.length === 0) {
    throw new Error('No cells left for the bot to fire at.');
  }

  const pickRandom = (arr: number[]) => arr[Math.floor(Math.random() * arr.length)];

  if (difficulty === 'easy') {
    return pickRandom(allUnfired);
  }

  // ---- Target mode (medium + hard) ----
  const hitCells = new Set(
    ownShotHistory.filter((s) => s.outcome === 'hit' || s.outcome === 'sunk').map((s) => s.cell),
  );
  // Remove cells belonging to fully-sunk ships so we don't chase finished ships.
  const sunkCells = new Set<number>();
  for (const s of ownShotHistory) {
    if (s.outcome === 'sunk' && s.shipId) {
      for (const c of sunkShipCells(s.cell, SHIP_SIZES[s.shipId], hitCells)) sunkCells.add(c);
    }
  }
  const activeHits = [...hitCells].filter((c) => !sunkCells.has(c));

  if (activeHits.length > 0) {
    // Prefer extending a line of >=2 collinear adjacent active hits.
    const activeSet = new Set(activeHits);
    const lineTargets: number[] = [];
    for (const a of activeHits) {
      for (const step of [1, BOARD_COLS]) {
        const partner = a + step;
        if (activeSet.has(partner)) {
          // Collinear pair → extend both ends.
          const axisOk = step === 1 ? colOf(a) < colOf(partner) : true;
          if (!axisOk) continue;
          const before = a - step;
          const after = partner + step;
          const beforeSameLine = step === 1 ? rowOf(before) === rowOf(a) && colOf(before) >= 0 : before >= 0;
          const afterSameLine = step === 1 ? rowOf(after) === rowOf(partner) : after < BOARD_CELLS;
          if (beforeSameLine && unfired(before)) lineTargets.push(before);
          if (afterSameLine && unfired(after)) lineTargets.push(after);
        }
      }
    }
    if (lineTargets.length > 0) return pickRandom(lineTargets);

    // Otherwise jab around single hits.
    const jabs: number[] = [];
    for (const a of activeHits) for (const n of neighbors(a)) if (unfired(n)) jabs.push(n);
    if (jabs.length > 0) return pickRandom(jabs);
  }

  // ---- Hunt mode ----
  if (difficulty === 'hard') {
    // Parity search: the smallest ship is length 2, so only checkerboard cells
    // need probing to find every ship.
    const parity = allUnfired.filter((c) => (rowOf(c) + colOf(c)) % 2 === 0);
    if (parity.length > 0) return pickRandom(parity);
  }
  return pickRandom(allUnfired);
}
