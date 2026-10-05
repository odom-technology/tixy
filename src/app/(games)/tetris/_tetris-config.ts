// ---------------------------------------------------------------------------
// Tetris — Game Configuration & Constants
// ---------------------------------------------------------------------------

export const COLS = 10;
export const ROWS = 20;
export const HIDDEN_ROWS = 2; // rows above visible area for piece spawning
export const TOTAL_ROWS = ROWS + HIDDEN_ROWS;

// ---------------------------------------------------------------------------
// Classic Nintendo NES timing baseline
// - Source baseline: NES timing table / mechanics documented from original ROM
//   behavior (NTSC 60.0988 fps).
// ---------------------------------------------------------------------------
const NES_NTSC_FPS = 60.0988;
const NES_FRAME_MS = 1000 / NES_NTSC_FPS;

// Timing
export const DAS_DELAY = Math.round(16 * NES_FRAME_MS); // 16f
export const ARR_SPEED = Math.round(6 * NES_FRAME_MS); // 6f between repeats
export const LINE_CLEAR_ANIMATION_MS = Math.round(18 * NES_FRAME_MS); // ~17-20f

export function getDropInterval(level: number): number {
  // Internal levels are 1-based in this game UI; NES gravity table is 0-based.
  const nesLevel = Math.max(0, Math.floor(level) - 1);

  let framesPerCell: number;
  if (nesLevel <= 0) framesPerCell = 48;
  else if (nesLevel === 1) framesPerCell = 43;
  else if (nesLevel === 2) framesPerCell = 38;
  else if (nesLevel === 3) framesPerCell = 33;
  else if (nesLevel === 4) framesPerCell = 28;
  else if (nesLevel === 5) framesPerCell = 23;
  else if (nesLevel === 6) framesPerCell = 18;
  else if (nesLevel === 7) framesPerCell = 13;
  else if (nesLevel === 8) framesPerCell = 8;
  else if (nesLevel === 9) framesPerCell = 6;
  else if (nesLevel <= 12) framesPerCell = 5;
  else if (nesLevel <= 15) framesPerCell = 4;
  else if (nesLevel <= 18) framesPerCell = 3;
  else if (nesLevel <= 28) framesPerCell = 2;
  else framesPerCell = 1;

  return framesPerCell / NES_NTSC_FPS;
}

// Lines per level
export const LINES_PER_LEVEL = 10;

// Scoring
export const SCORE_TABLE = {
  // Classic Nintendo line-clear values (multiplied by level in engine)
  single: 40,
  double: 100,
  triple: 300,
  tetris: 1200,
  // Keep modern move set/UI intact, but neutralize bonus scoring deltas.
  tSpinMini: 0,
  tSpin: 0,
  tSpinSingle: 40,
  tSpinDouble: 100,
  tSpinTriple: 300,
  softDrop: 1,
  hardDrop: 0,
  comboBonus: 0,
} as const;

export const BACK_TO_BACK_MULTIPLIER = 1;

// Piece types
export type PieceType = 'I' | 'O' | 'T' | 'S' | 'Z' | 'J' | 'L';
export const PIECE_TYPES: PieceType[] = ['I', 'O', 'T', 'S', 'Z', 'J', 'L'];

// Colors
export const PIECE_COLORS: Record<PieceType, string> = {
  I: '#00f0f0',
  O: '#f0f000',
  T: '#a000f0',
  S: '#00f000',
  Z: '#f00000',
  J: '#0000f0',
  L: '#f0a000',
};

// Piece shapes - each has 4 rotation states (0, R, 2, L)
// Using a 4x4 bounding box for I, 3x3 for all others, 2x2 for O
export const PIECE_SHAPES: Record<PieceType, number[][][]> = {
  I: [
    // State 0
    [[0,0,0,0],[1,1,1,1],[0,0,0,0],[0,0,0,0]],
    // State R
    [[0,0,1,0],[0,0,1,0],[0,0,1,0],[0,0,1,0]],
    // State 2
    [[0,0,0,0],[0,0,0,0],[1,1,1,1],[0,0,0,0]],
    // State L
    [[0,1,0,0],[0,1,0,0],[0,1,0,0],[0,1,0,0]],
  ],
  O: [
    [[1,1],[1,1]],
    [[1,1],[1,1]],
    [[1,1],[1,1]],
    [[1,1],[1,1]],
  ],
  T: [
    [[0,1,0],[1,1,1],[0,0,0]],
    [[0,1,0],[0,1,1],[0,1,0]],
    [[0,0,0],[1,1,1],[0,1,0]],
    [[0,1,0],[1,1,0],[0,1,0]],
  ],
  S: [
    [[0,1,1],[1,1,0],[0,0,0]],
    [[0,1,0],[0,1,1],[0,0,1]],
    [[0,0,0],[0,1,1],[1,1,0]],
    [[1,0,0],[1,1,0],[0,1,0]],
  ],
  Z: [
    [[1,1,0],[0,1,1],[0,0,0]],
    [[0,0,1],[0,1,1],[0,1,0]],
    [[0,0,0],[1,1,0],[0,1,1]],
    [[0,1,0],[1,1,0],[1,0,0]],
  ],
  J: [
    [[1,0,0],[1,1,1],[0,0,0]],
    [[0,1,1],[0,1,0],[0,1,0]],
    [[0,0,0],[1,1,1],[0,0,1]],
    [[0,1,0],[0,1,0],[1,1,0]],
  ],
  L: [
    [[0,0,1],[1,1,1],[0,0,0]],
    [[0,1,0],[0,1,0],[0,1,1]],
    [[0,0,0],[1,1,1],[1,0,0]],
    [[1,1,0],[0,1,0],[0,1,0]],
  ],
};

// SRS Wall Kick Data
// For J, L, S, T, Z pieces
export const WALL_KICKS: Record<string, [number, number][]> = {
  '0>R': [[0,0],[-1,0],[-1,1],[0,-2],[-1,-2]],
  'R>0': [[0,0],[1,0],[1,-1],[0,2],[1,2]],
  'R>2': [[0,0],[1,0],[1,-1],[0,2],[1,2]],
  '2>R': [[0,0],[-1,0],[-1,1],[0,-2],[-1,-2]],
  '2>L': [[0,0],[1,0],[1,1],[0,-2],[1,-2]],
  'L>2': [[0,0],[-1,0],[-1,-1],[0,2],[-1,2]],
  'L>0': [[0,0],[-1,0],[-1,-1],[0,2],[-1,2]],
  '0>L': [[0,0],[1,0],[1,1],[0,-2],[1,-2]],
};

// I-piece has its own wall kick table
export const I_WALL_KICKS: Record<string, [number, number][]> = {
  '0>R': [[0,0],[-2,0],[1,0],[-2,-1],[1,2]],
  'R>0': [[0,0],[2,0],[-1,0],[2,1],[-1,-2]],
  'R>2': [[0,0],[-1,0],[2,0],[-1,2],[2,-1]],
  '2>R': [[0,0],[1,0],[-2,0],[1,-2],[-2,1]],
  '2>L': [[0,0],[2,0],[-1,0],[2,1],[-1,-2]],
  'L>2': [[0,0],[-2,0],[1,0],[-2,-1],[1,2]],
  'L>0': [[0,0],[1,0],[-2,0],[1,-2],[-2,1]],
  '0>L': [[0,0],[-1,0],[2,0],[-1,2],[2,-1]],
};

export const ROTATION_NAMES = ['0', 'R', '2', 'L'] as const;
export type RotationState = 0 | 1 | 2 | 3;

// Next preview count
export const NEXT_PREVIEW_COUNT = 5;

// Anticheat
export const TETRIS_MAX_CLIENT_SCORE = 10_000_000;
const _TETRIS_MAX_PIECES_PER_MINUTE = 80;

// Max client score for leaderboard (lines mode)
const _TETRIS_MAX_CLIENT_LINES = 999;
