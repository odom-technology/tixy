/**
 * 2048 and snake's trusted scores, over HTTP, against a running server.
 *
 *   BASE_URL=http://127.0.0.1:3417 npx tsx scripts/verify-trusted-scores-http.ts
 *
 * Registers a throwaway account, then for each game:
 *  - the old one-POST exploit (a huge score, a session and nothing else) and
 *    the same with an empty move list are rejected, and no best is saved;
 *  - an honest bot run, played in real time, is accepted with the score the
 *    client claims and pays tickets; a tampered copy (inflated score) of the
 *    same run is rejected first and leaves the session usable;
 *  - the honest run posted twice pays once (the session is consumed);
 *  - a run posted from a session too young for it is rejected;
 *  - 2048 only: a fourth run with an undo in a day is rejected.
 *
 * The score route has a 2 s cooldown per game, so this takes a minute or two.
 * Exits non-zero on any failed assertion.
 */
import { playClient as play2048 } from './lib/2048-bot';
import { playClient as playSnake } from './lib/snake-bot';
import { SNAKE_DIRECTION_LETTER } from '@/app/(games)/snake/_snake-helpers';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:3417';

let failures = 0;
let checks = 0;
const assert = (cond: boolean, msg: string) => {
  checks += 1;
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${msg}`);
  if (!cond) failures += 1;
};
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function mulberry32(seed: number) {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(Date.now() % 100000);

let cookie = '';
type Json = Record<string, unknown> & {
  reward?: { awardedCredits?: number };
  bestScore?: number;
  error?: string;
  token?: string;
  game2048Seed?: number;
  snakeSeed?: number;
};
async function call(method: string, path: string, body?: unknown): Promise<{ status: number; json: Json }> {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let json: Json = {};
  try {
    json = JSON.parse(text) as Json;
  } catch {
    /* not json */
  }
  const setCookie = response.headers.get('set-cookie');
  if (setCookie) cookie = setCookie.split(';')[0]!;
  return { status: response.status, json };
}

/** A session, and the time it was stamped (this process's clock, a little
 *  after the server's). */
async function session(gameType: string) {
  const startedAt = Date.now();
  const { status, json } = await call('POST', '/api/games/session', { gameType });
  if (status !== 200) throw new Error(`session ${gameType}: ${status} ${JSON.stringify(json)}`);
  return { token: json.token as string, seed: (gameType === '2048' ? json.game2048Seed : json.snakeSeed) as number, startedAt };
}
/** Waits until the session is `ms` old, as a real run would have taken. */
const ageTo = (s: { startedAt: number }, ms: number) => sleep(Math.max(0, s.startedAt + ms - Date.now()));
const cooldown = () => sleep(2200);

async function best(game: string): Promise<number> {
  const { json } = await call('GET', `/api/games/${game}/score`);
  return json.bestScore ?? 0;
}

async function main() {
  const email = `trusted-${Date.now()}@example.com`;
  const reg = await call('POST', '/api/account/register', {
    email,
    password: 'trusted-scores-pass-1',
    username: `ts${Date.now() % 1e9}`,
  });
  if (reg.status !== 200) throw new Error(`register: ${reg.status} ${JSON.stringify(reg.json)}`);

  // ───────────────────────── 2048 ─────────────────────────
  console.log('2048');
  {
    const s = await session('2048');
    const exploit = await call('POST', '/api/games/2048/score', {
      score: 9_999_999,
      sessionToken: s.token,
      highestTile: 131072,
      moves: 50000,
      clientDurationMs: 600000,
    });
    assert(exploit.status >= 400 && exploit.status < 500, `the old one-POST exploit is rejected (${exploit.status}: ${exploit.json.error})`);
    await cooldown();
    const empty = await call('POST', '/api/games/2048/score', {
      score: 9_999_999,
      sessionToken: s.token,
      highestTile: 131072,
      moves: 50000,
      clientDurationMs: 600000,
      moveLog: [],
    });
    assert(empty.status === 403, `the same with an empty move list is rejected (${empty.status}: ${empty.json.error})`);
    assert((await best('2048')) === 0, 'no best was saved');
    await cooldown();
  }

  const pace = () => 60;
  const run2048 = async (undoAfter?: number) => {
    const s = await session('2048');
    const run = play2048(s.seed, 'corner', pace, { rng, maxMoves: 75, undoAfter });
    const body = {
      score: run.score,
      sessionToken: s.token,
      highestTile: run.highestTile,
      moves: run.moves,
      moveLog: run.log,
      clientDurationMs: run.durationMs,
    };
    await ageTo(s, run.durationMs + 300);
    return { s, run, body };
  };

  {
    const { run, body } = await run2048();
    const tampered = await call('POST', '/api/games/2048/score', { ...body, score: body.score + 4 });
    assert(tampered.status === 403, `an inflated score is rejected (${tampered.status})`);
    await cooldown();
    const honest = await call('POST', '/api/games/2048/score', body);
    const paid = honest.json.reward?.awardedCredits ?? 0;
    assert(honest.status === 200, `the honest run is accepted (${honest.status} ${honest.json.error ?? ''}) with score ${run.score}`);
    assert(paid > 0, `and pays tickets (${paid})`);
    assert((await best('2048')) === run.score, 'and saves the score the client showed');
    await cooldown();
    const again = await call('POST', '/api/games/2048/score', body);
    assert(again.status >= 400, `the same run posted twice is rejected the second time (${again.status})`);
    await cooldown();
  }
  {
    const s = await session('2048');
    const run = play2048(s.seed, 'corner', pace, { rng, maxMoves: 75 });
    const early = await call('POST', '/api/games/2048/score', {
      score: run.score,
      sessionToken: s.token,
      highestTile: run.highestTile,
      moves: run.moves,
      moveLog: run.log,
      clientDurationMs: run.durationMs,
    });
    assert(early.status === 403, `a run posted from a session too young for it is rejected (${early.status})`);
    await cooldown();
  }
  {
    // Three undo runs fit in a day; the fourth doesn't.
    const results: number[] = [];
    for (let i = 0; i < 4; i += 1) {
      const { body } = await run2048(10 + i);
      const response = await call('POST', '/api/games/2048/score', body);
      results.push(response.status);
      await cooldown();
    }
    assert(
      results.slice(0, 3).every((status) => status === 200) && results[3] === 403,
      `undo runs: three accepted, the fourth rejected (${results.join(', ')})`,
    );
  }

  // ───────────────────────── snake ─────────────────────────
  console.log('snake');
  {
    const s = await session('snake');
    const exploit = await call('POST', '/api/games/snake/score', {
      score: 5000,
      sessionToken: s.token,
      clientDurationMs: 600000,
    });
    assert(exploit.status >= 400 && exploit.status < 500, `a score with no turn list is rejected (${exploit.status}: ${exploit.json.error})`);
    await cooldown();
    const scripted = await call('POST', '/api/games/snake/score', {
      score: 5000,
      sessionToken: s.token,
      clientDurationMs: 600000,
      inputs: [],
    });
    assert(scripted.status === 403, `the same with an empty turn list is rejected (${scripted.status}: ${scripted.json.error})`);
    assert((await best('snake')) === 0, 'no best was saved');
    await cooldown();
  }

  const runSnake = async () => {
    const s = await session('snake');
    const run = playSnake(s.seed, { apples: 6, rng, humanDoubles: 0.05 });
    const body = {
      score: run.score,
      sessionToken: s.token,
      clientDurationMs: run.wallMs,
      inputs: run.inputs.map((input) => [input.k, SNAKE_DIRECTION_LETTER[input.dir]]),
    };
    await ageTo(s, run.minMs + 300);
    return { s, run, body };
  };

  {
    const { run, body } = await runSnake();
    const tampered = await call('POST', '/api/games/snake/score', { ...body, score: body.score + 10 });
    assert(tampered.status === 403, `an inflated score is rejected (${tampered.status})`);
    await cooldown();
    const honest = await call('POST', '/api/games/snake/score', body);
    const paid = honest.json.reward?.awardedCredits ?? 0;
    assert(honest.status === 200, `the honest run is accepted (${honest.status} ${honest.json.error ?? ''}) with score ${run.score}`);
    assert(paid > 0, `and pays tickets (${paid})`);
    assert((await best('snake')) === run.score, 'and saves the score the client showed');
    await cooldown();
    const again = await call('POST', '/api/games/snake/score', body);
    assert(again.status >= 400, `the same run posted twice is rejected the second time (${again.status})`);
    await cooldown();
  }
  {
    const s = await session('snake');
    const run = playSnake(s.seed, { apples: 6, rng });
    const early = await call('POST', '/api/games/snake/score', {
      score: run.score,
      sessionToken: s.token,
      clientDurationMs: run.wallMs,
      inputs: run.inputs.map((input) => [input.k, SNAKE_DIRECTION_LETTER[input.dir]]),
    });
    assert(early.status === 403, `a run posted from a session too young for it is rejected (${early.status})`);
  }

  console.log(`\n${checks - failures}/${checks} checks passed`);
  if (failures > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
