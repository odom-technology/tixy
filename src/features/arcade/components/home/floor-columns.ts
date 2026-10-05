/* Columns for `count` tiles when a row holds at most `max`. Of the column
   counts that avoid a lone tile in the last row, take the fewest rows, then
   the fewest columns (20 at 5 is 5 by 4, 6 at 5 is 3 by 2, 7 at 5 is 4 and
   3, 3 at 3 is one row). When every count leaves a lone tile (7 at 3), the
   one that leaves the fullest last row wins, unless one more column than
   `max` avoids it (7 at 3 becomes 4 and 3). One tile alone is fine. */
export function floorColumns(count: number, max: number): number {
  if (count <= 1 || max <= 1) return 1;
  const cols = bestColumns(count, max);
  const rows = Math.ceil(count / cols);
  if (count - (rows - 1) * cols === 1 && rows > 1 && max + 1 <= count) {
    const wider = bestColumns(count, max + 1);
    const widerRows = Math.ceil(count / wider);
    if (count - (widerRows - 1) * wider !== 1) return wider;
  }
  return cols;
}

function bestColumns(count: number, max: number) {
  let best = 0;
  let bestKey: [number, number, number] | null = null;
  for (let cols = 2; cols <= Math.min(max, count); cols++) {
    const rows = Math.ceil(count / cols);
    const last = count - (rows - 1) * cols;
    // Lone tile first, then rows, then columns.
    const key: [number, number, number] = [last === 1 ? 1 : 0, rows, cols];
    if (
      !bestKey ||
      key[0] < bestKey[0] ||
      (key[0] === bestKey[0] && (key[1] < bestKey[1] || (key[1] === bestKey[1] && key[2] < bestKey[2])))
    ) {
      best = cols;
      bestKey = key;
    }
  }
  return best || 1;
}
