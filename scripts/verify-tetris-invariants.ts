/**
 * Offline RULE + SCORING + TIMING invariant proof for Tetris.
 *
 *   npx tsx scripts/verify-tetris-invariants.ts
 *
 * Pins the contract the score route, leaderboard, and anti-cheat rely on, so
 * cosmetic/game-feel work cannot silently change the rules:
 *  1. Timing constants — NES-frame-derived DAS/ARR/line-clear values and the
 *     gravity table are exact.
 *  2. Scoring formula — classic 40/100/300/1200 × level, soft-drop +1/cell,
 *     hard-drop +0, back-to-back ×1, combo bonus 0, T-spin table neutralized.
 *  3. Rules — SRS rotation + wall-kick tables, 7-bag randomizer, hold, lock
 *     behavior (locks on failed gravity step), line-clear animation timing,
 *     input rejection during clears, game-over payload shape.
 *
 * Exits non-zero on any failed assertion.
 */
import {
  COLS,
  ROWS,
  HIDDEN_ROWS,
  TOTAL_ROWS,
  DAS_DELAY,
  ARR_SPEED,
  LINE_CLEAR_ANIMATION_MS,
  LINES_PER_LEVEL,
  SCORE_TABLE,
  BACK_TO_BACK_MULTIPLIER,
  NEXT_PREVIEW_COUNT,
  PIECE_TYPES,
  PIECE_SHAPES,
  WALL_KICKS,
  I_WALL_KICKS,
  getDropInterval,
  type PieceType,
} from '@/app/(games)/tetris/_tetris-config';
import { TetrisEngine, type LineClearEvent } from '@/app/(games)/tetris/_tetris-engine';

let failures = 0;
const assert = (cond: boolean, msg: string) => {
  if (!cond) {
    console.error('  FAIL: ' + msg);
    failures += 1;
  }
};

// ── 1. Timing + scoring constants (exact parity lock) ──────────────────────
console.log('1. Timing + scoring constants…');
{
  const NES_FRAME_MS = 1000 / 60.0988;
  assert(DAS_DELAY === Math.round(16 * NES_FRAME_MS), `DAS_DELAY ${DAS_DELAY}`);
  assert(ARR_SPEED === Math.round(6 * NES_FRAME_MS), `ARR_SPEED ${ARR_SPEED}`);
  assert(
    LINE_CLEAR_ANIMATION_MS === Math.round(18 * NES_FRAME_MS),
    `LINE_CLEAR_ANIMATION_MS ${LINE_CLEAR_ANIMATION_MS}`,
  );
  assert(COLS === 10 && ROWS === 20 && HIDDEN_ROWS === 2, 'board geometry changed');
  assert(LINES_PER_LEVEL === 10, 'LINES_PER_LEVEL changed');
  assert(BACK_TO_BACK_MULTIPLIER === 1, 'BACK_TO_BACK_MULTIPLIER changed');
  assert(NEXT_PREVIEW_COUNT === 5, 'NEXT_PREVIEW_COUNT changed');

  const expectedScoreTable = {
    single: 40, double: 100, triple: 300, tetris: 1200,
    tSpinMini: 0, tSpin: 0, tSpinSingle: 40, tSpinDouble: 100, tSpinTriple: 300,
    softDrop: 1, hardDrop: 0, comboBonus: 0,
  };
  assert(
    JSON.stringify(SCORE_TABLE) === JSON.stringify(expectedScoreTable),
    `SCORE_TABLE drifted: ${JSON.stringify(SCORE_TABLE)}`,
  );

  // Gravity table spot-checks (internal level is 1-based; NES table 0-based).
  const framesAt = (level: number) => getDropInterval(level) * 60.0988;
  const expectFrames: Array<[number, number]> = [
    [1, 48], [2, 43], [3, 38], [4, 33], [5, 28], [6, 23], [7, 18], [8, 13],
    [9, 8], [10, 6], [11, 5], [13, 5], [14, 4], [16, 4], [17, 3], [19, 3],
    [20, 2], [29, 2], [30, 1], [99, 1],
  ];
  for (const [level, frames] of expectFrames) {
    const actual = framesAt(level);
    assert(
      Math.abs(actual - frames) < 1e-9,
      `gravity level ${level}: expected ${frames} frames, got ${actual}`,
    );
  }
}

// ── Helpers to drive the engine into crafted states ─────────────────────────
const B = TOTAL_ROWS - 1; // bottom row index

function freshEngine(): TetrisEngine {
  const e = new TetrisEngine();
  e.start();
  return e;
}

function fillRow(e: TetrisEngine, row: number, exceptCols: number[] = []) {
  for (let c = 0; c < COLS; c++) {
    e.board[row][c] = exceptCols.includes(c) ? null : 'J';
  }
}

/** Drop a vertical I-piece into a right-edge well (col 9). */
function dropVerticalI(e: TetrisEngine, col = 9) {
  // I rotation 1 occupies shape col 2 → board col = x + 2.
  e.current = { type: 'I', x: col - 2, y: 0, rotation: 1 };
  e.lastActionWasRotation = false;
  e.hardDrop();
}

// ── 2. Line-clear scoring drives ────────────────────────────────────────────
console.log('2. Line-clear scoring…');
{
  // Single
  let e = freshEngine();
  let event: LineClearEvent | null = null;
  e.onLineClear = (ev) => { event = ev; };
  fillRow(e, B, [0]);
  e.current = { type: 'I', x: -2, y: 0, rotation: 1 }; // vertical I in col 0
  e.hardDrop();
  assert(event !== null, 'single: no line-clear event');
  assert(event!.linesCleared === 1, `single: linesCleared ${event!.linesCleared}`);
  assert(event!.points === 40, `single: points ${event!.points}`);
  assert(e.stats.score === 40 && e.stats.lines === 1 && e.stats.singles === 1,
    `single: stats ${JSON.stringify(e.stats)}`);

  // Double / Triple (right-edge well, vertical I spans the gap)
  for (const [depth, points, key] of [
    [2, 100, 'doubles'],
    [3, 300, 'triples'],
  ] as const) {
    e = freshEngine();
    event = null;
    e.onLineClear = (ev) => { event = ev; };
    for (let r = B; r > B - depth; r--) fillRow(e, r, [9]);
    dropVerticalI(e);
    assert(event !== null && event.linesCleared === depth,
      `${depth}-clear: event ${JSON.stringify(event)}`);
    assert(event!.points === points, `${depth}-clear: points ${event!.points}`);
    assert(e.stats[key] === 1, `${depth}-clear: stat bucket`);
  }

  // Tetris
  e = freshEngine();
  event = null;
  e.onLineClear = (ev) => { event = ev; };
  for (let r = B; r > B - 4; r--) fillRow(e, r, [9]);
  dropVerticalI(e);
  assert(event !== null && event.linesCleared === 4, 'tetris: no 4-clear');
  assert(event!.points === 1200, `tetris: points ${event!.points}`);
  assert(e.stats.tetrises === 1 && e.stats.lines === 4, 'tetris: stats');

  // Level multiplier — same single at level 2 pays 80.
  e = freshEngine();
  event = null;
  e.onLineClear = (ev) => { event = ev; };
  e.stats.level = 2;
  fillRow(e, B, [0]);
  e.current = { type: 'I', x: -2, y: 0, rotation: 1 };
  e.hardDrop();
  assert(event !== null && event.points === 80, `level-2 single: ${event?.points}`);

  // Back-to-back is neutralized (×1) and combo bonus is 0: two consecutive
  // tetrises score exactly 1200 each.
  e = freshEngine();
  const points: number[] = [];
  e.onLineClear = (ev) => { points.push(ev.points); };
  for (let i = 0; i < 2; i++) {
    for (let r = B; r > B - 4; r--) fillRow(e, r, [9]);
    dropVerticalI(e);
    // Flush the clear animation so the next piece can be placed.
    e.update(LINE_CLEAR_ANIMATION_MS + 1);
  }
  assert(points.length === 2 && points[0] === 1200 && points[1] === 1200,
    `back-to-back tetris scoring drifted: ${points}`);
  assert(e.stats.score === 2400, `back-to-back total ${e.stats.score}`);
}

// ── 3. T-spin scoring (neutralized table parity) ────────────────────────────
console.log('3. T-spin detection + scoring…');
{
  const e = freshEngine();
  let event: LineClearEvent | null = null;
  e.onLineClear = (ev) => { event = ev; };
  // T-spin single on the left wall. The T rests pointing left at the mouth
  // of the slot; the CW rotate wall-kicks it into place (the (0,0) kick is
  // blocked by the overhang at (B-2, 3), the (-1,0) kick by the corner at
  // (B-2, 0), so the (-1,-1) kick fires) — the exact 3-corner rule the
  // engine scores:
  //   row B-2: cols 0 and 3..9 filled (corner + overhang), notch at 1..2
  //   row B-1: open cols 0..2 for the T body
  //   row B  : corner cells at cols 0 and 2 (third + fourth T-spin corners)
  for (let c = 0; c < COLS; c++) e.board[B - 2][c] = c === 0 || c >= 3 ? 'J' : null;
  fillRow(e, B - 1, [0, 1, 2]);
  e.board[B][0] = 'J';
  e.board[B][2] = 'J';
  // T pointing left at the slot mouth; last action is the CW rotate that
  // kicks it in (no horizontal move afterwards, which would clear the flag).
  e.current = { type: 'T', x: 1, y: B - 3, rotation: 3 };
  assert(e.rotateCW() === true, 't-spin kick rotation failed');
  assert(
    e.current.rotation === 0 && e.current.x === 0 && e.current.y === B - 2,
    `t-spin kick landed wrong: ${JSON.stringify(e.current)}`,
  );
  e.hardDrop();
  assert(event !== null, 't-spin: no line-clear event');
  assert(event!.isTSpin === true, 't-spin: not detected');
  assert(event!.isTSpinMini === true, `t-spin: expected mini classification`);
  assert(event!.linesCleared === 1, `t-spin: linesCleared ${event!.linesCleared}`);
  assert(event!.points === SCORE_TABLE.tSpinSingle * 1,
    `t-spin single: points ${event!.points}`);
  assert(e.stats.tSpins === 1, 't-spin: tSpins stat');
}

// ── 4. Drop scoring + lock behavior ─────────────────────────────────────────
console.log('4. Drop scoring + lock behavior…');
{
  const e = freshEngine();
  e.current = { type: 'O', x: 4, y: 0, rotation: 0 };
  const before = e.stats.score;
  assert(e.softDrop() === true, 'soft drop rejected in open field');
  assert(e.stats.score === before + 1, `soft drop score ${e.stats.score - before}`);

  // Hard drop awards 0 per cell and locks immediately.
  const hdBefore = e.stats.score;
  const placedBefore = e.stats.piecesPlaced;
  assert(e.hardDrop() === true, 'hard drop rejected');
  assert(e.stats.score === hdBefore, `hard drop score drift ${e.stats.score - hdBefore}`);
  assert(e.stats.piecesPlaced === placedBefore + 1, 'hard drop did not lock');

  // NES-style lock: a piece resting on the floor locks when a gravity step
  // fails — no independent lock timer.
  const e2 = freshEngine();
  e2.current = { type: 'O', x: 4, y: 0, rotation: 0 };
  // Drop it to the floor via gravity with generous dt (fixed-step catch-up).
  // Level-1 gravity is ~799 ms/row, so simulate ~40 s to be safe.
  for (let i = 0; i < 200 && e2.stats.piecesPlaced === 0; i++) e2.update(200);
  assert(e2.stats.piecesPlaced === 1, 'gravity lock never happened');
  assert(e2.isGameOver === false && e2.current !== null, 'no piece spawned after lock');
}

// ── 5. Line-clear animation timing + input gating during clears ─────────────
console.log('5. Clear animation timing + input gating…');
{
  const e = freshEngine();
  fillRow(e, B, [9]);
  dropVerticalI(e);
  assert(e.clearingRows.length === 1, 'clearingRows not set after clear');
  assert(e.current === null, 'current should be null during clear animation');

  // Inputs are rejected during the animation WITHOUT counting as inputs.
  const inputsBefore = e.stats.totalInputs;
  assert(e.moveLeft() === false && e.rotateCW() === false && e.hold() === false,
    'inputs not rejected during clear');
  assert(e.stats.totalInputs === inputsBefore, 'rejected inputs still counted');

  // Rows are still on the board until the animation window elapses.
  e.update(LINE_CLEAR_ANIMATION_MS - 2);
  assert(e.clearingRows.length === 1, 'rows cleared before animation finished');
  assert(e.board[B].every((c) => c !== null), 'row vanished early');

  e.update(4);
  assert(e.clearingRows.length === 0, 'clear animation never completed');
  assert(e.board.length === TOTAL_ROWS, `board height ${e.board.length}`);
  // Only the full row is removed; the other 3 I-piece cells stay on the board.
  const filled = e.board.flat().filter((c) => c !== null).length;
  assert(filled === 3, `expected 3 leftover cells after clear, got ${filled}`);
  assert(e.current !== null, 'no piece spawned after clear');
}

// ── 6. SRS rotation + wall-kick tables (parity lock) ────────────────────────
console.log('6. SRS rotation + wall kicks…');
{
  // Every piece rotates in open space; O never rotates.
  const e = freshEngine();
  for (const type of PIECE_TYPES) {
    e.current = { type, x: 4, y: 2, rotation: 0 };
    e.isGameOver = false;
    e.isPaused = false;
    const rotated = e.rotateCW();
    if (type === 'O') {
      assert(rotated === false && e.current.rotation === 0, 'O piece rotated');
    } else {
      assert(rotated === true && e.current.rotation === 1, `${type} failed open CW rotate`);
      assert(e.rotateCCW() === true && e.current.rotation === 0, `${type} failed CCW rotate`);
    }
  }

  // Failed rotation still counts as an input (anti-cheat input accounting).
  e.current = { type: 'T', x: 4, y: 2, rotation: 0 };
  fillRow(e, 0); fillRow(e, 1); fillRow(e, 2); fillRow(e, 3); fillRow(e, 4);
  const inputsBefore = e.stats.totalInputs;
  assert(e.rotateCW() === false, 'rotation into solid rows should fail');
  assert(e.stats.totalInputs === inputsBefore + 1, 'failed rotation not counted');

  // Kick tables — exact contents pinned.
  const expectedKicks: Record<string, [number, number][]> = {
    '0>R': [[0,0],[-1,0],[-1,1],[0,-2],[-1,-2]],
    'R>0': [[0,0],[1,0],[1,-1],[0,2],[1,2]],
    'R>2': [[0,0],[1,0],[1,-1],[0,2],[1,2]],
    '2>R': [[0,0],[-1,0],[-1,1],[0,-2],[-1,-2]],
    '2>L': [[0,0],[1,0],[1,1],[0,-2],[1,-2]],
    'L>2': [[0,0],[-1,0],[-1,-1],[0,2],[-1,2]],
    'L>0': [[0,0],[-1,0],[-1,-1],[0,2],[-1,2]],
    '0>L': [[0,0],[1,0],[1,1],[0,-2],[1,-2]],
  };
  assert(JSON.stringify(WALL_KICKS) === JSON.stringify(expectedKicks), 'WALL_KICKS drifted');
  const expectedIKicks: Record<string, [number, number][]> = {
    '0>R': [[0,0],[-2,0],[1,0],[-2,-1],[1,2]],
    'R>0': [[0,0],[2,0],[-1,0],[2,1],[-1,-2]],
    'R>2': [[0,0],[-1,0],[2,0],[-1,2],[2,-1]],
    '2>R': [[0,0],[1,0],[-2,0],[1,-2],[-2,1]],
    '2>L': [[0,0],[2,0],[-1,0],[2,1],[-1,-2]],
    'L>2': [[0,0],[-2,0],[1,0],[-2,-1],[1,2]],
    'L>0': [[0,0],[1,0],[-2,0],[1,-2],[-2,1]],
    '0>L': [[0,0],[-1,0],[2,0],[-1,2],[2,-1]],
  };
  assert(JSON.stringify(I_WALL_KICKS) === JSON.stringify(expectedIKicks), 'I_WALL_KICKS drifted');

  // Every rotation state of every piece is a 4-cell shape inside its box.
  for (const type of PIECE_TYPES) {
    for (let rot = 0; rot < 4; rot++) {
      const shape = PIECE_SHAPES[type][rot];
      const cells = shape.flat().filter(Boolean).length;
      assert(cells === 4, `${type} rotation ${rot} has ${cells} cells`);
    }
  }
}

// ── 7. 7-bag randomizer + preview consistency ───────────────────────────────
console.log('7. 7-bag randomizer…');
{
  // Unstarted engine — start() consumes one piece, which would misalign the
  // 7-piece bag windows.
  const e = new TetrisEngine();
  for (let bag = 0; bag < 100; bag++) {
    const seen = new Set<PieceType>();
    for (let i = 0; i < 7; i++) seen.add(e.queue.next());
    assert(seen.size === 7, `bag ${bag} is not a permutation of all 7 pieces`);
  }
  // Preview matches what will actually be dealt.
  const e2 = freshEngine();
  const preview = e2.getNextPieces();
  assert(preview.length === NEXT_PREVIEW_COUNT, 'preview count drifted');
  for (let i = 0; i < NEXT_PREVIEW_COUNT; i++) {
    assert(e2.queue.next() === preview[i], `preview[${i}] mismatch with deal order`);
  }
}

// ── 8. Hold rules ───────────────────────────────────────────────────────────
console.log('8. Hold rules…');
{
  const e = freshEngine();
  const firstType = e.current!.type;
  assert(e.hold() === true, 'first hold rejected');
  assert(e.holdPiece === firstType, 'held piece mismatch');
  assert(e.holdUsed === true, 'holdUsed not set');
  assert(e.hold() === false, 'second hold before lock should be rejected');
  // Lock the piece (hard drop in open field) → hold re-arms and swaps back.
  e.hardDrop();
  assert(e.holdUsed === false, 'hold did not re-arm after lock');
  assert(e.hold() === true, 'hold after lock rejected');
  assert(e.current!.type === firstType, 'hold swap did not return held piece');
}

// ── 9. Game over contract ───────────────────────────────────────────────────
console.log('9. Game over contract…');
{
  const e = freshEngine();
  let payload: unknown = null;
  e.onGameOver = (data) => { payload = data; };
  // Block every spawn cell (cols 3..7 on both spawn rows) without filling a
  // complete row, then lock a piece to force the next spawn.
  for (const row of [0, 1]) {
    for (let c = 3; c <= 7; c++) e.board[row][c] = 'J';
  }
  e.current = { type: 'O', x: 0, y: TOTAL_ROWS - 2, rotation: 0 };
  e.hardDrop();
  assert(e.isGameOver === true, 'blocked spawn did not end the game');
  const p = payload as {
    score: number; level: number; lines: number;
    stats: { piecesPlaced: number; totalInputs: number }; durationMs: number;
  } | null;
  assert(p !== null, 'no game-over payload');
  assert(
    typeof p!.score === 'number' &&
      typeof p!.level === 'number' &&
      typeof p!.lines === 'number' &&
      typeof p!.durationMs === 'number' &&
      typeof p!.stats.piecesPlaced === 'number' &&
      typeof p!.stats.totalInputs === 'number',
    `game-over payload shape drifted: ${JSON.stringify(p)}`,
  );
  // Inputs are dead after game over.
  const inputsBefore = e.stats.totalInputs;
  assert(e.moveLeft() === false && e.hardDrop() === false, 'inputs live after game over');
  assert(e.stats.totalInputs === inputsBefore, 'post-game-over inputs counted');
}

// ── Summary ─────────────────────────────────────────────────────────────────
if (failures > 0) {
  console.error(`\n${failures} invariant failure(s).`);
  process.exit(1);
}
console.log('\nAll Tetris invariants hold.');
