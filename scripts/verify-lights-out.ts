import assert from 'node:assert/strict';
import { CELLS, createBoard, MAX_MOVES, readMoves, replayLights, RULES_VERSION, SIZE, toggleCell } from '../src/features/arcade/lib/lights-out/engine';

assert.equal(RULES_VERSION, 1);
assert.equal(SIZE, 3);
assert.equal(CELLS, 9);
assert.equal(MAX_MOVES, 24);
// Exhaustive subset search is an independent oracle for this small linear puzzle.
function solve(board: boolean[]): number[] {
  let best: number[] | undefined;
  for (let mask = 1; mask < 1 << CELLS; mask++) {
    const moves = Array.from({ length: CELLS }, (_, index) => index).filter((index) => mask & (1 << index));
    if (best && moves.length >= best.length) continue;
    let candidate = [...board];
    for (const move of moves) candidate = toggleCell(candidate, move);
    if (!candidate.some(Boolean)) best = moves;
  }
  assert.ok(best, 'Every generated puzzle has a solution.');
  return best;
}
const dark = Array<boolean>(CELLS).fill(false);
const corner = toggleCell(dark, 0);
assert.deepEqual(corner, [true, true, false, true, false, false, false, false, false], 'Edges never wrap.');
assert.deepEqual(dark, Array(CELLS).fill(false), 'Moves preserve their input.');
assert.deepEqual(toggleCell(corner, 0), dark, 'A repeated move cancels.');
assert.deepEqual(toggleCell(dark, 4), [false, true, false, true, true, true, false, true, false]);
assert.deepEqual(createBoard(0), [true, true, false, true, true, true, false, false, true], 'Versioned fixture.');
for (const seed of [0, 1, 12345, 2 ** 31 - 1, ...Array.from({ length: 128 }, (_, index) => index * 8191)]) {
  const board = createBoard(seed);
  assert.ok(board.some(Boolean), 'Runs never begin solved.');
  assert.deepEqual(createBoard(seed), board, 'No ambient randomness.');
  const solution = solve(board);
  assert.deepEqual(replayLights(seed, solution), { score: 1000 - 25 * (solution.length - 1), solved: true, moves: solution.length, board: dark });
  assert.throws(() => replayLights(seed, []), /Finish/);
  assert.throws(() => replayLights(seed, solution.slice(0, -1)), /Finish/);
  assert.throws(() => replayLights(seed, [...solution, 0]), /extra/);
  const wrong = Array.from({ length: CELLS }, (_, index) => index).find((index) => toggleCell(board, index).some(Boolean))!;
  assert.deepEqual(replayLights(seed, Array(MAX_MOVES).fill(wrong)), { score: 0, solved: false, moves: MAX_MOVES, board });
}
for (const invalid of [null, {}, Array(1), Array(25).fill(0), ['0'], [9], [-1], [0.5], [NaN], [Infinity]]) assert.throws(() => readMoves(invalid));
for (const invalid of [-1, 2 ** 31, NaN, Infinity, 1.5]) assert.throws(() => createBoard(invalid));
for (const invalid of [[], Array(9), Array(9).fill(1)]) assert.throws(() => toggleCell(invalid, 0));
for (const invalid of [-1, 9, 1.5]) assert.throws(() => toggleCell(dark, invalid));
console.log('Lights Out: versioned fixtures, solvability, board boundaries, pure moves, terminal replay, limits, and malformed input passed.');
