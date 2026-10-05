// ---------------------------------------------------------------------------
// Chess — Stockfish bot engine wrapper.
//
// Runs a single long-lived Stockfish engine in an ISOLATED Node child
// process (UCI over stdio) and serializes move requests. Difficulty is
// controlled via UCI options plus a depth cap. See the engine section below
// for why child-process isolation is required.
// ---------------------------------------------------------------------------

import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';

export type BotDifficulty = 'easy' | 'medium' | 'hard';

const BOT_USER_ID_PREFIX = 'bot:';
export const BOT_NAMES: Record<BotDifficulty, string> = {
  easy: 'Chess Novice (Bot)',
  medium: 'Chess Master (Bot)',
  hard: 'Chess Grandmaster (Bot)',
};

export function isBotUser(userId: string): boolean {
  return userId.startsWith(BOT_USER_ID_PREFIX);
}

export function getBotUserId(difficulty: BotDifficulty): string {
  return `${BOT_USER_ID_PREFIX}${difficulty}`;
}

type DifficultyProfile = {
  /** UCI Skill Level 0-20. */
  skillLevel: number;
  /** Search depth cap. */
  depth: number;
  /** Max time per move, in milliseconds. */
  movetime: number;
  /** UCI_Elo when UCI_LimitStrength is enabled. Use null to disable. */
  eloLimit: number | null;
};

const DIFFICULTY: Record<BotDifficulty, DifficultyProfile> = {
  // Easy: weakest config Stockfish will accept. Skill 0 + UCI_Elo floor (1320)
  // + depth 2 makes the search very shallow, so a motivated new player can
  // actually win. Still plays legal chess and avoids free captures.
  // Real-world strength sits well below the 1320 floor because depth=2 kills
  // lookahead — plays roughly like a ~800 chess.com rapid beginner.
  easy:   { skillLevel: 0,  depth: 2,  movetime:  150, eloLimit: 1320 },
  // Balanced: UCI_Elo 1800 with a 10-ply search and ~1s per move. Plays like
  // a solid club player — rough chess.com equivalent ~1700 rapid.
  medium: { skillLevel: 10, depth: 10, movetime:  900, eloLimit: 1800 },
  // Strong: skill 18 (near max) with no ELO cap. Depth 14 + 2s gives a
  // strong expert/master level game — rough chess.com equivalent ~2400.
  hard:   { skillLevel: 18, depth: 14, movetime: 2000, eloLimit: null },
};

/**
 * Approximate chess.com rapid rating each bot plays at. These are estimates
 * — real strength varies by position complexity and clock pressure — but
 * they're accurate enough to set player expectations in the lobby UI.
 */
const _BOT_CHESSCOM_ELO_ESTIMATE: Record<BotDifficulty, number> = {
  easy: 800,
  medium: 1700,
  hard: 2400,
};

// ---------------------------------------------------------------------------
// Engine singleton with a command queue — CHILD-PROCESS ISOLATION
//
// Stockfish is run in a SEPARATE Node child process that speaks UCI over
// stdio (the `stockfish` bin sets up a readline loop when run as `node
// <bin>`). This is deliberate: the WASM/emscripten glue installs its own
// `process.on('uncaughtException', e => { if (!(e instanceof ExitStatus))
// throw e })`, and a WASM instantiate failure (LinkError: shared-memory
// import, seen on Node 24 under the tsx dev server) rethrows from inside
// that listener — immediately fatal, bypassing every other handler. By
// hosting the engine out-of-process, ANY wasm/emscripten failure can only
// ever kill the CHILD; we detect it via 'error'/'exit', reject the pending
// move cleanly, and respawn on the next request. The parent (dev server)
// is untouchable.
//
// We pick the `stockfish-18-lite-single.js` variant: "single" = single
// threaded, so it needs no SharedArrayBuffer / pthread shared-memory import
// (the exact import that crashes the in-process load), and "lite" = the
// smaller NNUE net. Verified on Node 24 to answer uci/isready/go depth 10
// reliably and fast. The old in-process `process.on` swallow guards are
// therefore obsolete and have been removed — nothing stockfish runs in this
// process anymore, so there is no in-process throw to catch.
// ---------------------------------------------------------------------------

type EngineHandle = {
  sendCommand: (cmd: string) => void;
  listener: ((line: string) => void) | null;
  /**
   * Invoked once if the underlying child dies (crash/exit) while a request
   * is in flight, so the pending promise can be settled promptly instead of
   * waiting for the caller's timeout. Consumed (nulled) on first fire.
   */
  onError: ((err: Error) => void) | null;
};

let enginePromise: Promise<EngineHandle> | null = null;
let queue: Promise<unknown> = Promise.resolve();
let childProc: ChildProcess | null = null;

const STOCKFISH_VARIANT = 'stockfish-18-lite-single.js';
// All supported runtimes start tixy from the project root (`/app` in the
// production image). Keeping this path statically scoped also prevents Next's
// file tracer from following a dynamic package-resolution fallback and
// accidentally tracing the whole repository.
const STOCKFISH_BIN = path.join(
  /*turbopackIgnore: true*/ process.cwd(),
  'node_modules',
  'stockfish',
  'bin',
  STOCKFISH_VARIANT,
);

/**
 * Build the child env. CRITICAL: the dev server runs under `tsx`, which
 * injects `NODE_OPTIONS=--import tsx/esm ...` (plus tsx-specific vars) into
 * the environment. A plain `node <stockfish-bin>` child would inherit those
 * and try to bootstrap the tsx ESM loader, which fails with exit code 1
 * (the engine never even starts). Stripping the loader-injection vars gives
 * the child a clean, vanilla Node runtime.
 */
function childEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.NODE_OPTIONS;
  delete env.TSX_TSCONFIG_PATH;
  delete env.TS_NODE_PROJECT;
  return env;
}

/** Spawn a fresh UCI child and wire its stdout into `handle.listener`. */
function spawnEngineChild(): { child: ChildProcess; handle: EngineHandle } {
  // Pipes only, no shell — argv is passed as an array so paths never need
  // shell-quoting (Windows-safe even with spaces). `windowsHide` avoids a
  // console flash. Clean env (see childEnv) so no tsx/TS loader leaks in.
  const child = spawn(process.execPath, [STOCKFISH_BIN], {
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
    env: childEnv(),
  });
  // Don't let the engine keep the parent event loop alive on shutdown.
  child.unref();

  // Keep the tail of stderr so a spawn/startup failure is diagnosable.
  let stderrTail = '';

  const handle: EngineHandle = {
    sendCommand: (cmd: string) => {
      try {
        child.stdin?.write(cmd + '\n');
      } catch {
        // Write-after-end (child already dying) — the 'exit'/'error' path
        // handles rejection + respawn; swallow here so nothing bubbles.
      }
    },
    listener: null,
    onError: null,
  };

  // Line-buffer stdout and dispatch complete UCI lines to the listener.
  let buf = '';
  child.stdout?.setEncoding('utf8');
  child.stdout?.on('data', (chunk: string) => {
    buf += chunk;
    let nl: number;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).replace(/\r$/, '');
      buf = buf.slice(nl + 1);
      if (line && handle.listener) handle.listener(line);
    }
  });
  // Drain stderr so the pipe never fills; keep only a short tail for
  // diagnostics if the child dies unexpectedly.
  child.stderr?.setEncoding('utf8');
  child.stderr?.on('data', (chunk: string) => {
    stderrTail = (stderrTail + chunk).slice(-500);
  });

  // A dead child must NEVER reject unhandled or take the parent down. Both
  // 'error' (spawn failed) and 'exit' (crashed/killed) funnel here.
  const handleDeath = (why: string) => {
    if (childProc === child) {
      childProc = null;
      enginePromise = null; // force a respawn on the next request
    }
    const onError = handle.onError;
    handle.onError = null;
    handle.listener = null;
    try {
      child.kill();
    } catch {
      // already gone
    }
    const detail = stderrTail.trim() ? ` — stderr: ${stderrTail.trim()}` : '';
    if (onError) onError(new Error(`Stockfish child ${why}${detail}`));
  };
  child.on('error', (e: Error) => handleDeath(`error: ${e.message}`));
  child.on('exit', (code, sig) => handleDeath(`exited (code=${code}, signal=${sig})`));

  return { child, handle };
}

/** Kill the current child (best-effort). Used on shutdown and on timeout. */
function killEngineChild(): void {
  const child = childProc;
  childProc = null;
  enginePromise = null;
  if (child) {
    try {
      child.kill();
    } catch {
      // already gone
    }
  }
}

// Best-effort cleanup so we don't orphan a Stockfish process when the server
// exits. Only the passive 'exit' hook is registered (sync, safe) — we avoid
// hijacking SIGINT/SIGTERM so we don't interfere with the host's own
// graceful-shutdown handling. `child.unref()` above means a live engine
// never blocks the parent from exiting.
let shutdownHookInstalled = false;
function installShutdownHook(): void {
  if (shutdownHookInstalled) return;
  shutdownHookInstalled = true;
  process.once('exit', () => {
    const child = childProc;
    if (child) {
      try {
        child.kill();
      } catch {
        // best-effort
      }
    }
  });
}

function initEngineOnce(): Promise<EngineHandle> {
  if (enginePromise) return enginePromise;
  installShutdownHook();
  const p = (async () => {
    const { child, handle } = spawnEngineChild();
    childProc = child;
    // Handshake: confirm the engine is live before returning it to the
    // queue, so the first real request doesn't race a still-loading child.
    await new Promise<void>((resolve, reject) => {
      const to = setTimeout(() => {
        handle.listener = null;
        handle.onError = null;
        reject(new Error('Stockfish init timeout'));
      }, 10000);
      handle.onError = (err) => {
        clearTimeout(to);
        handle.listener = null;
        handle.onError = null;
        reject(err);
      };
      handle.listener = (line: string) => {
        if (line === 'readyok') {
          clearTimeout(to);
          handle.listener = null;
          handle.onError = null;
          resolve();
        }
      };
      handle.sendCommand('uci');
      handle.sendCommand('isready');
    });
    return handle;
  })();
  // Observe failures so Node never sees an unhandled rejection; clear the
  // cache so the next call retries from scratch with a fresh child.
  p.catch((err) => {
    console.error('Stockfish init failed; will retry on next call:', err);
    if (enginePromise === p) enginePromise = null;
    killEngineChild();
  });
  enginePromise = p;
  return p;
}

function runSerialized<T>(task: (engine: EngineHandle) => Promise<T>): Promise<T> {
  const next = queue.then(() => initEngineOnce().then(task));
  queue = next.catch(() => undefined);
  return next;
}

function ensureLegal(uci: string): boolean {
  return /^[a-h][1-8][a-h][1-8][qrbn]?$/.test(uci);
}

/**
 * Ask Stockfish for the best move in the given FEN.
 * Returns a UCI string (e.g., "e2e4" or "e7e8q").
 */
export async function computeBotMove(fen: string, difficulty: BotDifficulty): Promise<string> {
  const profile = DIFFICULTY[difficulty];

  return runSerialized(async (engine) => {
    return await new Promise<string>((resolve, reject) => {
      let done = false;
      const finish = () => {
        engine.listener = null;
        engine.onError = null;
      };
      const timeout = setTimeout(() => {
        if (done) return;
        done = true;
        finish();
        // A hung search means a wedged child — kill it so the next request
        // gets a clean respawn rather than reusing a stuck engine.
        killEngineChild();
        reject(new Error('Stockfish timeout'));
      }, Math.max(profile.movetime * 4, 5000));

      // If the child dies mid-search, settle promptly instead of waiting
      // for the timeout above. The engine layer has already scheduled a
      // respawn for the next request.
      engine.onError = (err) => {
        if (done) return;
        done = true;
        clearTimeout(timeout);
        finish();
        reject(err);
      };

      engine.listener = (line: string) => {
        if (typeof line !== 'string') return;
        if (!line.startsWith('bestmove')) return;
        if (done) return;
        done = true;
        clearTimeout(timeout);
        finish();
        const parts = line.split(/\s+/);
        const move = parts[1];
        if (!move || !ensureLegal(move)) {
          reject(new Error(`Stockfish returned invalid move: ${line}`));
          return;
        }
        resolve(move);
      };

      engine.sendCommand('ucinewgame');
      engine.sendCommand('setoption name Skill Level value ' + profile.skillLevel);
      if (profile.eloLimit !== null) {
        engine.sendCommand('setoption name UCI_LimitStrength value true');
        engine.sendCommand('setoption name UCI_Elo value ' + profile.eloLimit);
      } else {
        engine.sendCommand('setoption name UCI_LimitStrength value false');
      }
      engine.sendCommand('isready');
      engine.sendCommand(`position fen ${fen}`);
      engine.sendCommand(`go depth ${profile.depth} movetime ${profile.movetime}`);
    });
  });
}

// ---------------------------------------------------------------------------
// Analysis — evaluate an arbitrary FEN for post-game review.
// Returns a centipawn score from the side-to-move's perspective, plus the
// engine's best move. Reuses the same serialized engine queue as bot play.
// ---------------------------------------------------------------------------

export type AnalysisResult = {
  /** Centipawns from the side-to-move's perspective. Null if a mate is forced. */
  cp: number | null;
  /** Signed moves-to-mate (positive = side to move is mating). Null if no forced mate. */
  mate: number | null;
  /** Stockfish's best move in UCI, or null if none was returned. */
  bestMove: string | null;
};

/**
 * Cache for the eval of the standard chess starting position. Persisted to
 * `site_settings` so the value survives restarts / worker changes — without
 * persistence, every restart reset the first-move accuracy/quality path to
 * a 0 baseline even though individual move evals are stored in SQLite.
 *
 * Written by the analyze route once its baseline pass completes; read by
 * the moves endpoint. The in-memory cache is primed on first access from
 * the DB row (one-shot); subsequent reads are free.
 */
const STARTING_POS_EVAL_KEY = 'chess.analysis.starting_position_cp';
let startingPositionWhiteCp: number | null = null;
let startingPositionHydrated = false;

async function hydrateStartingPositionEvalFromDb(): Promise<void> {
  if (startingPositionHydrated) return;
  startingPositionHydrated = true;
  try {
    const { queryOne } = await import('@/server/db/client');
    const row = await queryOne<{ config_json: string }>(
      'SELECT config_json FROM site_settings WHERE id = $1',
      [STARTING_POS_EVAL_KEY],
    );
    if (!row) return;
    const parsed = JSON.parse(row.config_json) as { cp?: unknown };
    if (typeof parsed.cp === 'number' && Number.isFinite(parsed.cp)) {
      startingPositionWhiteCp = parsed.cp;
    }
  } catch (err) {
    console.error('Failed to hydrate chess starting-position eval:', err);
  }
}

async function persistStartingPositionEvalToDb(cp: number): Promise<void> {
  try {
    const { query } = await import('@/server/db/client');
    const now = Date.now();
    await query(
      `INSERT INTO site_settings (id, config_json, updated_at, updated_by)
       VALUES ($1, $2, $3, NULL)
       ON CONFLICT (id) DO UPDATE SET
         config_json = EXCLUDED.config_json,
         updated_at = EXCLUDED.updated_at`,
      [STARTING_POS_EVAL_KEY, JSON.stringify({ cp }), now],
    );
  } catch (err) {
    console.error('Failed to persist chess starting-position eval:', err);
  }
}

export function setStartingPositionEvalCp(cp: number | null) {
  startingPositionWhiteCp = cp;
  startingPositionHydrated = true;
  if (typeof cp === 'number' && Number.isFinite(cp)) {
    void persistStartingPositionEvalToDb(cp);
  }
}

export async function getStartingPositionEvalCp(): Promise<number | null> {
  await hydrateStartingPositionEvalFromDb();
  return startingPositionWhiteCp;
}

export async function analyzePosition(
  fen: string,
  opts: { depth?: number; movetime?: number } = {},
): Promise<AnalysisResult> {
  const depth = opts.depth ?? 12;
  const movetime = opts.movetime ?? 600;

  return runSerialized(async (engine) => {
    return await new Promise<AnalysisResult>((resolve) => {
      let lastCp: number | null = null;
      let lastMate: number | null = null;
      let done = false;
      const finish = () => {
        engine.listener = null;
        engine.onError = null;
      };
      const timeout = setTimeout(() => {
        if (done) return;
        done = true;
        finish();
        killEngineChild();
        resolve({ cp: lastCp, mate: lastMate, bestMove: null });
      }, Math.max(movetime * 5, 5000));

      // On child death, resolve with whatever eval we have (analysis never
      // rejects — its callers treat a null result as "no data"). Preserves
      // the original resolve-on-failure semantics.
      engine.onError = () => {
        if (done) return;
        done = true;
        clearTimeout(timeout);
        finish();
        resolve({ cp: lastCp, mate: lastMate, bestMove: null });
      };

      engine.listener = (line: string) => {
        if (typeof line !== 'string') return;
        // info lines carry running eval; bestmove line ends the search.
        const cpMatch = line.match(/\bscore cp (-?\d+)/);
        const mateMatch = line.match(/\bscore mate (-?\d+)/);
        if (cpMatch) { lastCp = parseInt(cpMatch[1], 10); lastMate = null; }
        if (mateMatch) { lastMate = parseInt(mateMatch[1], 10); lastCp = null; }
        if (line.startsWith('bestmove')) {
          if (done) return;
          done = true;
          clearTimeout(timeout);
          finish();
          const parts = line.split(/\s+/);
          const bestMove = parts[1] && /^[a-h][1-8][a-h][1-8][qrbn]?$/.test(parts[1]) ? parts[1] : null;
          resolve({ cp: lastCp, mate: lastMate, bestMove });
        }
      };

      engine.sendCommand('ucinewgame');
      engine.sendCommand('setoption name Skill Level value 20');
      engine.sendCommand('setoption name UCI_LimitStrength value false');
      engine.sendCommand('isready');
      engine.sendCommand(`position fen ${fen}`);
      engine.sendCommand(`go depth ${depth} movetime ${movetime}`);
    });
  });
}
