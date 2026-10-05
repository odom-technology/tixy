// Centralized game constants used across score routes, leaderboards, and validation.

/** Number of entries returned in score submission responses. */
export const SCORE_RESPONSE_LEADERBOARD_LIMIT = 10;

/** Number of entries returned by dedicated leaderboard endpoints. */
export const LEADERBOARD_QUERY_LIMIT = 20;
export const MAX_LEADERBOARD_QUERY_LIMIT = 5000;

/** Valid typing test durations in seconds. */
export const TYPING_TEST_MODES = [15, 30, 60] as const;

// --- Score hard caps (reject anything above these) ---

/** Maximum allowed client-submitted score for Snake. */
export const SNAKE_MAX_CLIENT_SCORE = 100_000;

/** Maximum allowed client-submitted score for Flappy Bird. */
export const FLAPPY_MAX_CLIENT_SCORE = 10_000;

/** Maximum allowed client-submitted score for Stack (tower height). */
export const STACK_MAX_CLIENT_SCORE = 10_000;

/** Maximum allowed client-submitted score for Sequence Memory (longest sequence). */
export const SEQUENCE_MAX_CLIENT_SCORE = 100;

/** Maximum allowed client-submitted score for Breakout. */
export const BREAKOUT_MAX_CLIENT_SCORE = 100_000;

/** Maximum allowed client-submitted score for Gopher Pop (points — combo/quick
 *  scoring; a perfect run computes ≈5–5.5k, keep this a generous upper bound).
 *  Mirrors GOPHER_MAX_RUN_SCORE in server/arcade/gopher-replay.ts. */
export const GOPHER_MAX_CLIENT_SCORE = 15_000;

/** Maximum allowed client-submitted score for Ricochet. */
export const RICOCHET_MAX_CLIENT_SCORE = 1000;

/** Maximum allowed Sudoku solve time in ms (1 hour). */
export const SUDOKU_MAX_SOLVE_MS = 3_600_000;

/** Maximum allowed client-submitted score for Mental Math Sprint (correct answers). */
export const MATH_MAX_CLIENT_SCORE = 500;

/** Maximum allowed client-submitted score for Blitz Tactics (puzzles solved in a
 *  5-min rush). The seeded ladder caps solvable puzzles far below this; kept as a
 *  generous coarse guard (the authoritative check is blitz-tactics-replay.ts). */
export const BLITZ_TACTICS_MAX_CLIENT_SCORE = 200;

/** Maximum allowed server-computed WPM for Typing Test. */
export const TYPING_MAX_WPM = 300;

// --- Snake game grid ---

const SNAKE_GRID_SIZE = 18;
const SNAKE_STARTING_LENGTH = 3;
export const SNAKE_WIN_SCORE = (SNAKE_GRID_SIZE * SNAKE_GRID_SIZE - SNAKE_STARTING_LENGTH) * 10;

// --- Typing test keystroke rate limits ---

/** Max keystrokes per second (both average and 1s sliding window burst). */
export const TYPING_MAX_KEYS_PER_SEC = 20;

// --- 2048 ---

/** Maximum allowed client-submitted score for 2048. Ceiling is ~3.9M; give headroom. */
export const GAME_2048_MAX_CLIENT_SCORE = 10_000_000;

/** Max tile value ever reachable in 2048 (2^17). Used for highest-tile bounds check. */
export const GAME_2048_MAX_TILE = 131_072;
