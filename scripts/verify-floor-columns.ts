/**
 * The home floor's grid columns, with no database.
 *
 *   npm run test:floor-columns
 *
 * For every tile count a filter can show (1 to 30) and every grid the CSS
 * uses (4 columns from 640, 5 from 1216), the last row is never
 * a lone tile when any column count can avoid it, and the grid never holds
 * more than its max.
 * Then every real filter (each group, favorites up to the pin limit, and
 * all) is checked against the registry at widths 360 to 1920.
 */
import assert from 'node:assert/strict';

import { getFloorGroups } from '@/features/arcade/components/arcade-game-registry';
import { floorColumns } from '@/features/arcade/components/home/floor-columns';
import { MAX_FAVORITE_GAMES } from '@/features/users/account-profile-details';

/** The grid's max columns at a viewport width (tixy-home.css); null below
 *  640, where the floor is a list of rows. */
function gridMax(width: number): number | null {
  if (width < 640) return null;
  if (width < 1216) return 4;
  return 5;
}

function lastRow(count: number, cols: number) {
  return count - (Math.ceil(count / cols) - 1) * cols;
}

for (const max of [3, 4, 5]) {
  for (let count = 1; count <= 30; count++) {
    const cols = floorColumns(count, max);
    const last = lastRow(count, cols);
    // One column past max is allowed only when it avoids a lone tile.
    assert.ok(cols >= 1 && (cols <= max || (cols === max + 1 && last !== 1)), `${count} tiles at max ${max}: ${cols} columns`);
    if (count === 1) continue;
    // Whenever some column count up to max + 1 avoids a lone tile, the pick does.
    let possible = false;
    for (let c = 2; c <= Math.min(max + 1, count); c++) if (lastRow(count, c) !== 1) possible = true;
    if (possible) assert.notEqual(last, 1, `${count} tiles at max ${max}: ${cols} columns leave a lone tile`);
  }
}

const groups = getFloorGroups();
const counts = new Map<string, number>();
for (const { group, games } of groups) counts.set(group.id, games.length);
counts.set('all', groups.reduce((sum, entry) => sum + entry.games.length, 0));
for (let favorites = 1; favorites <= MAX_FAVORITE_GAMES; favorites++) counts.set(`favorites:${favorites}`, favorites);

let checked = 0;
for (const [filter, count] of counts) {
  for (let width = 360; width <= 1920; width += 4) {
    const max = gridMax(width);
    if (max == null || count <= 1) continue;
    const cols = floorColumns(count, max);
    assert.notEqual(lastRow(count, cols), 1, `${filter} (${count} tiles) at ${width}px: ${cols} columns leave a lone tile`);
    checked++;
  }
}
console.log(`floor columns ok: ${counts.size} filters, ${checked} width checks`);
for (const [filter, count] of counts) {
  console.log(`  ${filter.padEnd(16)} ${String(count).padStart(2)} tiles: ${[3, 4, 5].map((m) => `${floorColumns(count, m)} of ${m}`).join(', ')}`);
}
