/**
 * 2048's trusted score: seeded-replay, pace and tamper proof.
 *
 *   npx tsx scripts/verify-2048-replay.ts
 *
 *  1. Rules lock: the pace floors and the move codes the route and the client
 *     share.
 *  2. Honest runs: a reference client built from the client's own helpers
 *     (createInitialState, moveTiles, spawnTile, hasLegalMove, the undo
 *     snapshot) plays to the end of the board at human pace, with and without
 *     its one undo. The server's replay of each move list must reach the same
 *     score, highest tile, move count and final board, so the score the player
 *     saw is the score saved and the tickets it pays don't change.
 *  3. Pace: where the floors sit against fast human play, two keys hit
 *     together included.
 *  4. Tampered runs: an inflated score or tile, the old one-POST exploit,
 *     forged, inserted, dropped and swapped moves, another session's seed,
 *     impossible speed, a run longer than the session, a second undo, an undo
 *     with nothing to take back, moves after the board is stuck, and bad
 *     shapes.
 *
 * Replayed sessions are the score route's job (the session row is consumed
 * once); scripts/verify-trusted-scores-http.ts covers that over HTTP.
 *
 * Exits non-zero on any failed assertion.
 */
import {
  GAME_2048_AVG_MIN_MS,
  GAME_2048_CLOCK_SLACK_MS,
  GAME_2048_MIN_GAP_MS,
  GAME_2048_WINDOW_MIN_MS,
  GAME_2048_WINDOW_MOVES,
  parseGame2048Moves,
  replayGame2048,
  slide2048,
  verifyGame2048Run,
  type Game2048Move,
  type Game2048MoveCode,
} from '@/server/arcade/game-2048-replay';
import { playClient, type ClientRun } from './lib/2048-bot';
import { calculateGameRewardCredits } from '@/server/arcade/rewards/wallet';

let failures = 0;
let checks = 0;
const assert = (cond: boolean, msg: string) => {
  checks += 1;
  if (!cond) {
    console.error('  FAIL: ' + msg);
    failures += 1;
  }
};

function mulberry32(seed: number) {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A person's pace: a median gap with a long tail, and the odd quick burst. */
const humanPace = (rng: () => number, medianMs: number) => () => {
  const u = Math.max(1e-6, rng());
  const v = rng();
  const normal = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  const gap = medianMs * Math.exp(0.45 * normal);
  return Math.max(GAME_2048_MIN_GAP_MS + 20, gap);
};

const verify = (
  run: ClientRun,
  log: readonly Game2048Move[] = run.log,
  claim = { score: run.score, highestTile: run.highestTile },
  elapsedMs: number | undefined = run.durationMs + 400,
  seed = run.seed,
) => verifyGame2048Run(seed, log, claim, { elapsedMs });

const failure = (run: ReturnType<typeof verifyGame2048Run>) =>
  run.ok === false ? (run as Extract<typeof run, { ok: false }>).reason : null;

// ── 1. Rules lock ──────────────────────────────────────────────────────────
console.log('1. Rules');
{
  assert(GAME_2048_MIN_GAP_MS === 15, 'gap floor');
  assert(GAME_2048_WINDOW_MOVES === 50 && GAME_2048_WINDOW_MIN_MS === 1960, 'window floor');
  assert(GAME_2048_AVG_MIN_MS === 80, 'average floor');
  assert(GAME_2048_CLOCK_SLACK_MS === 1000, 'clock slack');
  // The slide the server uses matches the client's moveTiles on every board
  // the bots reach (checked move by move below), and on the textbook cases.
  assert(JSON.stringify(slide2048([2, 2, 2, 2, 0, 0, 0, 0, 4, 0, 4, 8, 2, 4, 4, 0], 'L').cells)
    === JSON.stringify([4, 4, 0, 0, 0, 0, 0, 0, 8, 8, 0, 0, 2, 8, 0, 0]), 'slide left');
  assert(slide2048([2, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], 'D').gained === 0, 'no merge, no score');
  assert(slide2048([2, 4, 2, 4, 4, 2, 4, 2, 2, 4, 2, 4, 4, 2, 4, 2], 'L').changed === false, 'stuck board does not change');
  const parsed = parseGame2048Moves([[10, 'L'], [200, 'Z']]);
  assert(parsed !== null && parsed.length === 2, 'wire form parses');
  assert(parseGame2048Moves([[10, 'Q']]) === null, 'unknown code');
  assert(parseGame2048Moves([[-1, 'L']]) === null, 'negative time');
  assert(parseGame2048Moves([['10', 'L']]) === null, 'string time');
  assert(parseGame2048Moves([[Number.NaN, 'L']]) === null, 'NaN time');
  assert(parseGame2048Moves('L') === null && parseGame2048Moves(undefined) === null, 'not a list');
}

// ── 2. Honest runs ─────────────────────────────────────────────────────────
console.log('2. Honest runs');
const honest: ClientRun[] = [];
{
  const rng = mulberry32(20261003);
  let undoRuns = 0;
  let boardsMatch = 0;
  for (let i = 0; i < 400; i += 1) {
    const seed = Math.floor(rng() * 2 ** 31);
    const policy = i % 4 === 3 ? 'random' : 'corner';
    const withUndo = i % 3 === 0;
    const run = playClient(seed, policy, humanPace(rng, 150 + rng() * 250), {
      rng,
      undoAfter: withUndo ? 5 + Math.floor(rng() * 60) : undefined,
    });
    honest.push(run);
    if (run.undone) undoRuns += 1;
    const result = verify(run);
    if (result.ok === false) {
      assert(false, `honest run seed ${seed} (${policy}) rejected: ${failure(result)}`);
      continue;
    }
    assert(result.score === run.score, `seed ${seed}: score ${result.score} vs client ${run.score}`);
    assert(result.highestTile === run.highestTile, `seed ${seed}: tile ${result.highestTile} vs client ${run.highestTile}`);
    assert(result.moves === run.moves, `seed ${seed}: moves ${result.moves} vs client ${run.moves}`);
    assert(result.undos === (run.undone ? 1 : 0), `seed ${seed}: undo count`);
    assert(result.over === true, `seed ${seed}: the replay ends on a stuck board`);
    if (JSON.stringify(result.cells) === JSON.stringify(run.cells)) boardsMatch += 1;
    else assert(false, `seed ${seed}: final board differs`);
  }
  const scores = honest.map((r) => r.score).sort((a, b) => a - b);
  const q = (p: number) => scores[Math.floor(p * (scores.length - 1))];
  const tile = (n: number) => honest.filter((r) => r.highestTile >= n).length;
  console.log(
    `   ${honest.length} runs (${undoRuns} with an undo): accepted with the same score, tile, moves and board (${boardsMatch}); ` +
      `score p10/p50/p90/max ${q(0.1)}/${q(0.5)}/${q(0.9)}/${scores[scores.length - 1]}, ` +
      `tile >= 256: ${tile(256)}, >= 512: ${tile(512)}, >= 1024: ${tile(1024)}`,
  );
  // Tickets are a function of the score, and the score is unchanged.
  let same = 0;
  for (const run of honest) {
    const server = verify(run);
    if (
      server.ok &&
      calculateGameRewardCredits({ gameType: '2048', score: server.score }) ===
        calculateGameRewardCredits({ gameType: '2048', score: run.score })
    ) {
      same += 1;
    }
  }
  assert(same === honest.length, 'every honest run pays the tickets it showed');
  const tickets = [1000, 3000, 10000, 20000].map((s) => `${s} -> ${calculateGameRewardCredits({ gameType: '2048', score: s })}`);
  console.log(`   tickets by score: ${tickets.join(', ')}`);
  assert(undoRuns > 100, 'enough undo runs');
}

// ── 3. Pace ────────────────────────────────────────────────────────────────
console.log('3. Pace');
{
  const rng = mulberry32(7);
  const accepted = (medianMs: number, runs: number) => {
    let ok = 0;
    for (let i = 0; i < runs; i += 1) {
      const seed = Math.floor(rng() * 2 ** 31);
      const run = playClient(seed, 'corner', humanPace(rng, medianMs), { rng });
      if (verify(run).ok) ok += 1;
    }
    return ok;
  };
  // A fast human: 9 to 10 moves a second, held for a whole run.
  const fast = accepted(100, 60);
  console.log(`   median 100 ms a move (10 a second) accepted ${fast}/60`);
  assert(fast === 60, 'a fast human is never rejected');
  const calm = accepted(250, 60);
  assert(calm === 60, 'an ordinary pace is never rejected');
  // Held key: a burst of 40 moves 33 ms apart inside an ordinary run.
  const base = honest.find((r) => r.log.length > 200 && !r.undone)!;
  const burst: Array<[number, Game2048MoveCode]> = base.log.map((entry) => [entry[0], entry[1]]);
  // Moves are not changed, only their times: squeeze 40 of them to 33 ms and
  // move the rest earlier by the time saved, so the order and the board hold.
  const squeezeFrom = 100;
  const saved = burst[squeezeFrom + 40][0] - burst[squeezeFrom][0] - 40 * 33;
  for (let i = squeezeFrom + 1; i <= squeezeFrom + 40; i += 1) burst[i][0] = burst[squeezeFrom][0] + (i - squeezeFrom) * 33;
  for (let i = squeezeFrom + 41; i < burst.length; i += 1) burst[i][0] -= saved;
  assert(verify(base, burst, undefined, base.durationMs + 400).ok, 'a held key repeating at 33 ms for 40 moves is accepted');
  // Mashing: two keys hit together land a few ms apart. A real run turned
  // away on 2026-10-04 was 114 moves in 11 s with one pair 8 ms apart.
  // A masher at 10 a second with one press in eight landing on the one
  // before it (2 to 14 ms) is a person.
  {
    let chords = 0;
    let mashed = 0;
    for (let i = 0; i < 60; i += 1) {
      const seed = Math.floor(rng() * 2 ** 31);
      const steady = humanPace(rng, 100);
      let chordBefore = false;
      const run = playClient(seed, 'corner', () => {
        const chord = !chordBefore && rng() < 0.125;
        chordBefore = chord;
        if (chord) chords += 1;
        return chord ? 2 + rng() * 12 : steady();
      }, { rng });
      if (verify(run).ok) mashed += 1;
      else assert(false, `a masher with chords rejected: ${failure(verify(run))}`);
    }
    console.log(`   mashing at 10 a second with ${chords} two-key chords accepted ${mashed}/60`);
    assert(mashed === 60 && chords > 300, 'two keys hit together are accepted');
    const chord = base.log.map((m) => [m[0], m[1]] as Game2048Move);
    chord[50] = [chord[49][0] + 8, chord[50][1]];
    assert(verify(base, chord).ok, 'one pair of moves 8 ms apart is accepted');
    const triple = chord.map((m) => [m[0], m[1]] as Game2048Move);
    triple[51] = [triple[50][0] + 6, triple[51][1]];
    const tripleResult = verify(base, triple);
    assert(tripleResult.ok === false && /Three moves/.test(failure(tripleResult) ?? ''), 'three moves inside two gaps under 15 ms are rejected');
    // Every other gap a chord: the pairs pass the gap floor, the window
    // floor stops them.
    const pairs = base.log.map(([, code], i) => [Math.floor(i / 2) * 30 + (i % 2) * 2, code] as Game2048Move);
    assert(verify(base, pairs, undefined, 1_000_000).ok === false, 'chord after chord at 30 ms a pair is rejected');
  }
  // The same moves at a script's pace.
  for (const gap of [5, 10, 14]) {
    const quick = base.log.map(([, code], i) => [i * gap, code] as Game2048Move);
    const result = verify(base, quick, undefined, 1_000_000);
    assert(result.ok === false, `${gap} ms between moves is rejected`);
  }
  for (const gap of [20, 30, 39]) {
    const quick = base.log.map(([, code], i) => [i * gap, code] as Game2048Move);
    assert(verify(base, quick, undefined, 1_000_000).ok === false, `${gap} ms between every move is rejected`);
  }
  // Sustained 11 moves a second (91 ms) passes, 14 a second (71 ms) doesn't.
  const at = (gap: number) => base.log.map(([, code], i) => [Math.round(i * gap), code] as Game2048Move);
  assert(verify(base, at(91), undefined, 1_000_000).ok, '91 ms a move is accepted');
  assert(verify(base, at(71), undefined, 1_000_000).ok === false, '71 ms a move over a whole run is rejected');
  console.log(
    `   floors: no two gaps in a row under ${GAME_2048_MIN_GAP_MS} ms; ${GAME_2048_WINDOW_MOVES} moves in ${GAME_2048_WINDOW_MIN_MS} ms; ${GAME_2048_AVG_MIN_MS} ms a move over 100 or more`,
  );
}

// ── 4. Tampered runs ───────────────────────────────────────────────────────
console.log('4. Tampered runs');
{
  const base = honest.find((r) => r.log.length > 250 && !r.undone)!;
  const log = base.log as Game2048Move[];
  const rejected = (label: string, result: ReturnType<typeof verifyGame2048Run>) => {
    assert(result.ok === false, `${label} is rejected`);
    return failure(result);
  };
  console.log(`   base run: seed ${base.seed}, ${log.length} moves, score ${base.score}, tile ${base.highestTile}`);

  // The claim
  rejected('an inflated score', verify(base, log, { score: base.score + 4, highestTile: base.highestTile }));
  rejected('a 10M score', verify(base, log, { score: 9_999_999, highestTile: base.highestTile }));
  rejected('an inflated tile', verify(base, log, { score: base.score, highestTile: base.highestTile * 2 }));
  rejected('a deflated tile', verify(base, log, { score: base.score, highestTile: base.highestTile / 2 }));
  // The old exploit: one POST, no game behind it.
  rejected('the one-POST exploit (no moves, 10M)', verify(base, [], { score: 9_999_999, highestTile: 131072 }));
  assert(parseGame2048Moves(undefined) === null, 'the one-POST exploit with no move list does not parse');

  // Forged moves
  const rng = mulberry32(99);
  let forged = 0;
  let forgedCaught = 0;
  let forgedSameResult = 0;
  const forgeries: Array<[string, Game2048Move[]]> = [];
  for (let i = 0; i < 40; i += 1) {
    const at = 5 + Math.floor(rng() * (log.length - 10));
    const swap: Game2048Move[] = log.map((m) => [m[0], m[1]] as Game2048Move);
    swap[at] = [swap[at][0], (['U', 'D', 'L', 'R'] as const).filter((c) => c !== swap[at][1])[Math.floor(rng() * 3)]];
    forgeries.push(['a changed move', swap]);
    const dropped = log.filter((_, k) => k !== at);
    forgeries.push(['a dropped move', dropped as Game2048Move[]]);
    const extra: Game2048Move[] = [...log.slice(0, at), [log[at][0] - 1 - Math.floor(rng() * 5), 'L'], ...log.slice(at)].map(
      (m) => [m[0], m[1]] as Game2048Move,
    );
    forgeries.push(['an inserted move', extra]);
  }
  for (const [label, moves] of forgeries) {
    forged += 1;
    const result = verify(base, moves);
    if (result.ok === false) forgedCaught += 1;
    else {
      // A forged list that still reaches the claimed score and tile (a last
      // move swapped for another that merges nothing) is a legal run with that
      // result: the server saved what the replay reached, which is the claim.
      forgedSameResult += 1;
      assert(label === 'a changed move' && result.score === base.score && result.highestTile === base.highestTile, `${label} accepted with a different result`);
    }
  }
  assert(forgedCaught + forgedSameResult === forged && forgedSameResult <= 2, `forged move lists rejected ${forgedCaught}/${forged}`);
  console.log(`   forged, dropped and inserted moves: rejected ${forgedCaught}/${forged}; ${forgedSameResult} reached the same result and is a legal run`);
  // Moves played on another session's seed.
  let wrongSeed = 0;
  for (let k = 1; k <= 20; k += 1) if (verify(base, log, undefined, undefined, base.seed + k).ok === false) wrongSeed += 1;
  assert(wrongSeed === 20, `a move list replayed on another seed rejected ${wrongSeed}/20`);
  // Truncation is a legal run with the lower score, so the original claim fails.
  rejected('the full claim on a cut move list', verify(base, log.slice(0, 120)));
  assert(verify(base, log.slice(0, 120), { score: 0, highestTile: 0 }).ok === false, 'a wrong claim on a cut list');

  // Speed
  const compressed = log.map(([t, c]) => [Math.round(t * 0.2), c] as Game2048Move);
  rejected('moves at a fifth of the time', verify(base, compressed, undefined, 1_000_000));
  const bot = log.map(([, c], i) => [i * 3, c] as Game2048Move);
  rejected('a bot at 3 ms a move', verify(base, bot, undefined, 1_000_000));
  rejected('timestamps out of order', verify(base, [[500, log[0][1]], [300, log[1][1]], ...log.slice(2)] as Game2048Move[]));

  // Longer than the session
  rejected('a run longer than the session', verify(base, log, undefined, base.durationMs - 5000));
  assert(verify(base, log, undefined, base.durationMs - 500).ok, 'a run 500 ms past the session (clock rounding) is accepted');
  rejected('a run posted from a session that began just now', verify(base, log, undefined, 800));

  // Undo
  const undoRun = honest.find((r) => r.undone && r.log.length > 40)!;
  const zAt = undoRun.log.findIndex(([, c]) => c === 'Z');
  const withSecond = undoRun.log.map((m) => [m[0], m[1]] as Game2048Move);
  const twice: Game2048Move[] = [
    ...withSecond.slice(0, zAt + 2),
    [withSecond[zAt + 1][0] + 200, 'Z'],
    ...withSecond.slice(zAt + 2).map((m) => [m[0] + 400, m[1]] as Game2048Move),
  ];
  rejected('a second undo', verify(undoRun, twice, undefined, 1_000_000));
  const back: Game2048Move[] = [
    ...withSecond.slice(0, zAt + 1),
    [withSecond[zAt][0] + 200, 'Z'],
    ...withSecond.slice(zAt + 1).map((m) => [m[0] + 400, m[1]] as Game2048Move),
  ];
  rejected('an undo straight after an undo', verify(undoRun, back, undefined, 1_000_000));
  rejected('an undo before any move', verify(base, [[100, 'Z'], ...log.map((m) => [m[0] + 300, m[1]] as Game2048Move)], undefined, 1_000_000));
  // The honest undo run really is accepted, and its undo is what the server counts.
  const okUndo = verify(undoRun);
  assert(okUndo.ok && okUndo.undos === 1, 'an honest undo is accepted and counted');

  // The move that makes 2048 can't be undone (the client clears undo there);
  // the move after it can.
  {
    const start = [1024, 1024, 0, 0, 0, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0];
    const play = (moves: Game2048Move[]) =>
      replayGame2048(5, moves, { startCells: start });
    const winThenUndo = play([[300, 'L'], [700, 'Z']]);
    assert(winThenUndo.ok === false, 'an undo straight after the move that made 2048 is rejected');
    const afterWin = play([[300, 'L'], [700, 'U'], [1100, 'Z']]);
    assert(afterWin.ok && afterWin.undos === 1 && afterWin.highestTile >= 2048, 'the move after 2048 can be undone');
    assert(play([[300, 'L']]).ok && (play([[300, 'L']]) as { score: number }).score === 2048, 'merging two 1024s scores 2048');
  }

  // Moves after the board is stuck
  const stuck = honest.find((r) => r.log.length > 100 && !r.undone)!;
  const tail = stuck.log[stuck.log.length - 1][0];
  rejected(
    'a move after the board is stuck',
    verify(stuck, [...stuck.log, [tail + 300, 'L']] as Game2048Move[], undefined, tail + 2000),
  );
  rejected('an undo after the board is stuck', verify(stuck, [...stuck.log, [tail + 300, 'Z']] as Game2048Move[], undefined, tail + 2000));
  // A move that changes nothing: on a stuck-left board a second L.
  const noop = [[100, 'L'], [400, 'L'], [700, 'L'], [1000, 'L'], [1300, 'L'], [1600, 'L']] as Game2048Move[];
  assert(verify(base, noop, { score: 0, highestTile: 4 }, 100000).ok === false, 'repeated moves that change nothing are rejected');
}

console.log(`\n${checks - failures}/${checks} checks passed`);
if (failures > 0) process.exit(1);
