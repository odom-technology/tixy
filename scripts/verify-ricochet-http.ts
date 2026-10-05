/**
 * Ricochet's trusted score, over HTTP, against a running server.
 *
 *   BASE_URL=http://127.0.0.1:3217 npx tsx scripts/verify-ricochet-http.ts
 *
 * Registers a throwaway account, then:
 *  - the old post (wall events, no taps) is a 409 that says reload, and an
 *    empty tap list claiming 100 walls is rejected; no best is saved either way;
 *  - a session that was never started (no 'start' stamp) is rejected;
 *  - an honest bot run, flown in real time, is accepted with the score the
 *    client claims and pays tickets; a tampered copy (one wall more) is
 *    rejected first and leaves the session usable; a forged tap list for a
 *    longer flight than the session has existed is rejected;
 *  - the honest run posted twice pays once (the session is consumed);
 *  - a run posted from a session too young for it is rejected.
 *
 * The score route has a cooldown per game, so this takes about a minute.
 * Exits non-zero on any failed assertion.
 */
import { SKILLS, mulberry32, playClient } from './lib/ricochet-bot';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:3217';

let failures = 0;
let checks = 0;
const assert = (cond: boolean, msg: string) => {
  checks += 1;
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${msg}`);
  if (!cond) failures += 1;
};
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const rng = mulberry32(Date.now() % 100000);

let cookie = '';
type Json = Record<string, unknown> & {
  reward?: { awardedCredits?: number };
  verifiedRun?: { score?: number; steps?: number; end?: string };
  bestScore?: number;
  error?: string;
  token?: string;
  sessionId?: string;
  ricochetSeed?: number;
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

/** A session and, if asked, its start stamp, with the stamp's time on this
 *  process's clock (a little after the server's). */
async function session(stamp = true) {
  const { status, json } = await call('POST', '/api/games/session', { gameType: 'ricochet' });
  if (status !== 200) throw new Error(`session: ${status} ${JSON.stringify(json)}`);
  let stampedAt = 0;
  if (stamp) {
    const patch = await call('PATCH', '/api/games/session', { sessionId: json.sessionId, action: 'start' });
    if (patch.status !== 200) throw new Error(`stamp: ${patch.status} ${JSON.stringify(patch.json)}`);
    stampedAt = Date.now();
  }
  return { token: json.token as string, id: json.sessionId as string, seed: json.ricochetSeed as number, stampedAt };
}
/** Waits until the run is `ms` old, as a real run would have taken. */
const ageTo = (s: { stampedAt: number }, ms: number) => sleep(Math.max(0, s.stampedAt + ms - Date.now()));
const cooldown = () => sleep(1700);

async function best(): Promise<number> {
  const { json } = await call('GET', '/api/games/ricochet/score');
  return json.bestScore ?? 0;
}

async function main() {
  const email = `ricochet-${Date.now()}@example.com`;
  const reg = await call('POST', '/api/account/register', {
    email,
    password: 'ricochet-trusted-pass-1',
    username: `rc${Date.now() % 1e9}`,
  });
  if (reg.status !== 200) throw new Error(`register: ${reg.status} ${JSON.stringify(reg.json)}`);

  console.log('the old post and forged posts');
  {
    const s = await session();
    const old = await call('POST', '/api/games/ricochet/score', {
      score: 100,
      sessionToken: s.token,
      walls: Array.from({ length: 100 }, (_, i) => ({ wall: i + 1, t: 1000 + i * 1100, birdY: 320 })),
      clientDurationMs: 120_000,
    });
    assert(old.status === 409, `the old wall-event post is a 409 (${old.status}: ${old.json.error})`);
    await cooldown();
    const empty = await call('POST', '/api/games/ricochet/score', { score: 100, sessionToken: s.token, taps: [] });
    assert(empty.status === 403, `an empty tap list claiming 100 walls is rejected (${empty.status}: ${empty.json.error})`);
    assert((await best()) === 0, 'no best was saved');
    await cooldown();
  }
  {
    const s = await session(false);
    const run = playClient(s.seed, SKILLS[2]!, rng, { maxWalls: 3 });
    const unstamped = await call('POST', '/api/games/ricochet/score', { score: run.score, sessionToken: s.token, taps: run.taps });
    assert(unstamped.status === 403, `a session that was never started is rejected (${unstamped.status})`);
    await cooldown();
  }

  console.log('an honest run, flown in real time');
  const s = await session();
  const run = playClient(s.seed, SKILLS[3]!, rng, { maxWalls: 9 });
  const body = { score: run.score, sessionToken: s.token, taps: run.taps };
  console.log(`  (the bot clears ${run.score} walls in ${(run.durationMs / 1000).toFixed(1)} s with ${run.taps.length} taps)`);
  await ageTo(s, run.durationMs + 400);
  {
    const tampered = await call('POST', '/api/games/ricochet/score', { ...body, score: body.score + 1 });
    assert(tampered.status === 403, `a score one wall too high is rejected (${tampered.status})`);
    await cooldown();
    // A different flight: every tap moved one step. If it reaches the same wall
    // it is a legal flight and pays what it reaches; the point is the route
    // scores taps, so this never pays more than the replay says.
    const forged = await call('POST', '/api/games/ricochet/score', {
      score: body.score + 5,
      sessionToken: s.token,
      taps: run.taps.map((k) => k + 1),
    });
    assert(forged.status === 403, `a forged tap list claiming 5 walls more is rejected (${forged.status})`);
    await cooldown();
    const honest = await call('POST', '/api/games/ricochet/score', body);
    const paid = honest.json.reward?.awardedCredits ?? 0;
    assert(honest.status === 200, `the honest run is accepted after the tampered ones (${honest.status} ${honest.json.error ?? ''}) with score ${run.score}`);
    assert(paid > 0, `and pays tickets (${paid})`);
    assert(honest.json.verifiedRun?.score === run.score, `and the server's replay says ${honest.json.verifiedRun?.score} walls`);
    assert((await best()) === run.score, 'and saves the score the client showed');
    await cooldown();
    const again = await call('POST', '/api/games/ricochet/score', body);
    assert(again.status >= 400, `the same run posted twice is rejected the second time (${again.status})`);
    assert((await best()) === run.score, 'and the best is unchanged');
    await cooldown();
  }
  {
    // A flight that needs far longer than its session has existed.
    const young = await session();
    const longRun = playClient(young.seed, SKILLS[4]!, rng, { maxWalls: 30 });
    const early = await call('POST', '/api/games/ricochet/score', {
      score: longRun.score,
      sessionToken: young.token,
      taps: longRun.taps,
    });
    assert(early.status === 403, `a ${longRun.score}-wall run posted from a session seconds old is rejected (${early.status})`);
  }

  console.log(`\n${checks - failures}/${checks} checks passed`);
  if (failures > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
