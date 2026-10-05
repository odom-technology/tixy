/**
 * Trick shot: table, replay, fairness, anti-cheat and payout proof.
 *
 *   npx tsx scripts/verify-trick-shot.ts            (the bank's first 120 days)
 *   npx tsx scripts/verify-trick-shot.ts --all      (every banked day)
 *
 *  1. Rules lock: the score and ticket tables the route, the client and the
 *     ? sheet quote.
 *  2. The bank: every banked day's solution clears when replayed, inside its
 *     weekday's ball count, with a power window a player can hit.
 *  3. Determinism: a sample of days regenerates byte for byte from the date.
 *  4. Client and server agree: the shot the client fires, sent as JSON and
 *     put on the grids by the server, replays to the same pots, the same
 *     scratch and the same resting balls, for random shots on random days.
 *  5. Frame rates: the canvas's clock at 30 to 144 Hz with stalls and a
 *     hit-stop shows the same final frame and fires each pot once, in order.
 *  6. Tampered input: what an honest client can't send is rejected.
 *  7. Every try is posted, replayed and counted, and only a new best pays.
 *  8. The board: most balls, then fewest tries, then the earliest; ties.
 *  9. Streaks: days in a row cleared, on the UTC day, a scratch no clear.
 * 10. Rewards: a day pays its best's value once, a new best the difference,
 *     with one ledger key per new best.
 * 11. Simulated players by skill: tries to clear, first-try clears, tickets
 *     a day, and the achievement tiers against that.
 * 12. The database (a development DATABASE_URL from env/.env.local, else
 *     skipped): tries numbered in order, one try per arm under ten racing
 *     posts, concurrent tries owing the best's value once, every stored try
 *     replaying to its result, and streaks read from the table. It writes
 *     rows for a made-up player and deletes them.
 *
 * Exits non-zero on any failed assertion.
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { simulateShot } from '../src/features/arcade/lib/pool-physics';
import {
  generateTrickShotPosition,
  TRICK_SHOT_TIERS,
} from '../src/features/arcade/lib/trick-shot/generator';
import {
  compareTrickShotStandings,
  gradeTrickShot,
  isBetterTrickShotTry,
  isClear,
  shiftTrickShotDateKey,
  trickShotBestStreak,
  trickShotDateKey,
  trickShotScore,
  trickShotStreak,
  trickShotTickets,
  trickShotTryTickets,
  trickShotWeekday,
  TRICK_SHOT_BOARD_ORDER,
  TRICK_SHOT_CLEAR_BONUS,
  TRICK_SHOT_REWARD_FLOOR,
  type TrickShotDayStanding,
} from '../src/features/arcade/lib/trick-shot/rules';
import {
  normalizeTrickShotInput,
  playTrickShot,
  snapTrickShot,
  toEngineBalls,
  toShotInput,
  TRICK_SHOT_ANGLE_STEP,
  type TrickShotInput,
} from '../src/features/arcade/lib/trick-shot/shot';
import {
  fromBankedDay,
  toBankedDay,
  trickShotRewardSourceId,
  type TrickShotBank,
} from '../src/server/arcade/trick-shot';
import { ACHIEVEMENTS } from '../src/server/arcade/achievements/registry';
import { calculateGameRewardCredits } from '../src/server/arcade/rewards/wallet';
import { GAME_DAILY_CREDIT_CAP, MAX_GAME_RUN_CREDITS } from '../src/features/arcade/lib/rewards';

let failures = 0;
let checks = 0;
const assert = (cond: boolean, msg: string) => {
  checks += 1;
  if (!cond) {
    console.error('  FAIL: ' + msg);
    failures += 1;
  }
};
const section = (title: string) => console.log(`\n${title}`);

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const gauss = (rng: () => number) => {
  const u = Math.max(1e-12, rng());
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
};

const root = path.join(path.dirname(new URL(import.meta.url).pathname), '..');
const bank = JSON.parse(readFileSync(path.join(root, 'src/server/arcade/trick-shot-bank.json'), 'utf8')) as TrickShotBank;
const allKeys = Object.keys(bank.days).sort();
const keys = process.argv.includes('--all') ? allKeys : allKeys.slice(0, 120);
const positions = keys.map((key) => fromBankedDay(key, bank.days[key]!, bank.version));

// ── 1. Rules lock ─────────────────────────────────────────────────────────
section('1. Rules lock');
const scoreTable: Array<[number, number, boolean, number]> = [
  [0, 3, false, 0],
  [1, 3, false, 23],
  [2, 3, false, 47],
  [3, 3, true, 70],
  [3, 3, false, 100],
  [1, 2, false, 35],
  [2, 2, false, 100],
  [2, 2, true, 70],
];
for (const [pots, ballCount, scratch, want] of scoreTable) {
  assert(trickShotScore({ pots, ballCount, scratch }) === want, `score ${pots}/${ballCount}${scratch ? ' scratch' : ''} = ${want}`);
}
const ticketTable: Array<[number, number]> = [
  [0, 12],
  [23, 26],
  [35, 39],
  [47, 49],
  [70, 62],
  [100, 71],
];
console.log('  score -> tickets: ' + ticketTable.map(([s]) => `${s} -> ${trickShotTickets(s)}`).join(', '));
for (const [s, want] of ticketTable) {
  assert(trickShotTickets(s) === want, `${s} points pay ${want} tickets (got ${trickShotTickets(s)})`);
  assert(
    calculateGameRewardCredits({ gameType: 'trick-shot', score: s, clear: s === 100 }) === want,
    `the wallet pays ${want} for ${s} points`,
  );
}
assert(trickShotTickets(100) <= MAX_GAME_RUN_CREDITS, 'a clear stays inside the 75 per-run cap');
assert(trickShotTickets(0) === TRICK_SHOT_REWARD_FLOOR, 'a miss pays the floor, as a word grid miss does');
assert(TRICK_SHOT_CLEAR_BONUS === 30, 'a clear is worth 30 points');
for (let s = 1; s <= 100; s += 1) assert(trickShotTickets(s) >= trickShotTickets(s - 1), `tickets never fall as the score rises (${s})`);
const howTo = readFileSync(path.join(root, 'src/app/(games)/trick-shot/_trick-shot-client.tsx'), 'utf8');
assert(howTo.includes('trickShotTickets(100)') && howTo.includes('trickShotTickets(0)'), 'the ? sheet quotes the ticket table');

// ── 2. The bank ───────────────────────────────────────────────────────────
section(`2. The bank: ${keys.length} of ${allKeys.length} days, ${allKeys[0]} to ${allKeys[allKeys.length - 1]}`);
const byWeekday: Array<{ windows: number[]; powers: number[]; grades: Record<string, number> }> = Array.from(
  { length: 7 },
  () => ({ windows: [], powers: [], grades: {} }),
);
for (let i = 1; i < allKeys.length; i += 1) {
  const gap = Date.parse(`${allKeys[i]}T00:00:00Z`) - Date.parse(`${allKeys[i - 1]}T00:00:00Z`);
  assert(gap === 86_400_000, `the bank has no gap before ${allKeys[i]}`);
}
for (const position of positions) {
  const play = playTrickShot(position.balls, position.solution);
  assert(play.clear, `${position.dateKey}: the banked solution clears`);
  const weekday = trickShotWeekday(position.dateKey);
  const tier = TRICK_SHOT_TIERS[weekday]!;
  assert(position.ballCount >= 2 && position.ballCount <= tier.balls, `${position.dateKey}: ${position.ballCount} balls on a ${tier.balls}-ball day`);
  assert(position.window.powerPct >= 4, `${position.dateKey}: power window ${position.window.powerPct}% is at least 4`);
  assert(position.window.angleDeg >= 0.03, `${position.dateKey}: aim window ${position.window.angleDeg} deg is at least 0.03`);
  assert(position.difficulty === gradeTrickShot(position.window.angleDeg), `${position.dateKey}: grade matches window`);
  // The solution sits on the shooting grids, so a player can fire it exactly.
  const snapped = snapTrickShot(position.solution);
  assert(snapped.angle === position.solution.angle && snapped.power === position.solution.power, `${position.dateKey}: solution on the grids`);
  const ids = new Set(position.balls.map((b) => b.id));
  assert(ids.size === position.balls.length && ids.has(0) && !ids.has(8), `${position.dateKey}: distinct balls, a cue ball, no 8`);
  const row = byWeekday[weekday]!;
  row.windows.push(position.window.angleDeg);
  row.powers.push(position.window.powerPct);
  row.grades[position.difficulty] = (row.grades[position.difficulty] ?? 0) + 1;
}
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)]! : 0;
};
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
console.log('  day  balls  aim window (median, min)  power window (median)  grades');
byWeekday.forEach((row, d) => {
  console.log(
    `  ${DAYS[d]}  ${TRICK_SHOT_TIERS[d]!.balls}      ${median(row.windows).toFixed(2)}, ${Math.min(...row.windows).toFixed(2)} deg         ${median(row.powers)}%                    ${Object.entries(row.grades).map(([g, n]) => `${g} ${n}`).join(', ')}`,
  );
});
assert(median(byWeekday[0]!.windows) > median(byWeekday[5]!.windows) * 3, 'Monday is much easier than Saturday');

// ── 3. Determinism ────────────────────────────────────────────────────────
section('3. Determinism: regenerate from the date');
const sample = allKeys.filter((_, i) => i % Math.max(1, Math.floor(allKeys.length / 10)) === 0).slice(0, 10);
for (const key of sample) {
  const fresh = JSON.stringify(toBankedDay(generateTrickShotPosition(key)));
  assert(fresh === JSON.stringify(bank.days[key]), `${key} regenerates exactly`);
}
console.log(`  ${sample.length} days regenerated: ${sample.join(', ')}`);
const twice = playTrickShot(positions[0]!.balls, positions[0]!.solution);
const again = playTrickShot(positions[0]!.balls, positions[0]!.solution);
assert(JSON.stringify(twice.result.finalBalls) === JSON.stringify(again.result.finalBalls), 'same table and shot, same resting balls');

// ── 4. Client and server agree ────────────────────────────────────────────
section('4. Client and server agree on random shots');
{
  const rng = mulberry32(4242);
  let agreed = 0;
  let pots = 0;
  const N = 400;
  for (let i = 0; i < N; i += 1) {
    const position = positions[Math.floor(rng() * positions.length)]!;
    // What the client holds: a raw angle from a pointer, power from a drag.
    // Half are aimed near the day's line, so the replays cover pots too.
    const near = rng() < 0.5;
    const raw = {
      angle: near ? position.solution.angle + gauss(rng) * 0.01 : (rng() * 2 - 1) * Math.PI * 1.7,
      power: 0.05 + rng() * 0.95,
      spinX: Math.round((rng() * 2 - 1) * 0.7 * 100) / 100,
      spinY: Math.round((rng() * 2 - 1) * 0.7 * 100) / 100,
    };
    const fired = snapTrickShot(raw);
    const client = playTrickShot(position.balls, fired);
    // The canvas animates simulateShot on engine balls with the same input.
    const canvas = simulateShot(toEngineBalls(position.balls), toShotInput(fired));
    const server = normalizeTrickShotInput(JSON.parse(JSON.stringify(fired)));
    assert(server !== null, 'the server accepts what the client fires');
    if (!server) continue;
    const replay = playTrickShot(position.balls, server);
    const same =
      replay.pots === client.pots &&
      replay.scratch === client.scratch &&
      replay.score === client.score &&
      JSON.stringify(replay.result.finalBalls) === JSON.stringify(client.result.finalBalls) &&
      JSON.stringify(canvas.finalBalls) === JSON.stringify(client.result.finalBalls);
    assert(same, `shot ${i} on ${position.dateKey} replays the same`);
    if (same) agreed += 1;
    pots += client.pots;
  }
  console.log(`  ${agreed} of ${N} random shots replay identically (${pots} pots between them)`);
}

// ── 5. Frame rates ────────────────────────────────────────────────────────
section('5. The canvas clock at 30 to 144 Hz, with stalls and a hit-stop');
{
  // PoolCanvas: the frame shown is floor((elapsed - 30 ms) / (1000 / 60)),
  // elapsed minus the time a hit-stop held; pots fire as the frame passes
  // their event. Replicated here, since the canvas is a React component.
  const LAUNCH_MS = 30;
  const FRAME_MS = 1000 / 60;
  const position = positions.find((p) => p.ballCount === 3)!;
  const result = simulateShot(toEngineBalls(position.balls), toShotInput(position.solution));
  const potEvents = result.events.filter((e) => e.type === 'pocketed').map((e) => e.ballIds[0]);
  for (const hz of [30, 60, 90, 120, 144]) {
    for (const stalls of [false, true]) {
      const rng = mulberry32(hz * 7 + (stalls ? 1 : 0));
      let now = 0;
      let frozenMs = 0;
      let frozenUntil = -1;
      let next = 0;
      const fired: number[] = [];
      let lastFrame = -1;
      for (let tick = 0; tick < 20000; tick += 1) {
        const step = 1000 / hz + (stalls && rng() < 0.05 ? 80 + rng() * 200 : 0);
        const prev = now;
        now += step;
        if (frozenUntil > prev) frozenMs += Math.min(now, frozenUntil) - prev;
        const elapsed = Math.max(0, now - frozenMs);
        const frame = Math.floor(Math.max(0, elapsed - LAUNCH_MS) / FRAME_MS);
        while (next < result.events.length && result.events[next]!.frame <= frame) {
          const e = result.events[next++]!;
          if (e.type === 'pocketed') {
            fired.push(e.ballIds[0]!);
            // The clearing pot holds the clock 50 ms.
            if (fired.filter((id) => id !== 0).length === position.ballCount) frozenUntil = now + 50;
          }
        }
        lastFrame = Math.min(frame, result.frames.length - 1);
        if (frame >= result.frames.length - 1) break;
      }
      assert(lastFrame === result.frames.length - 1, `${hz} Hz${stalls ? ' with stalls' : ''}: ends on the final frame`);
      assert(JSON.stringify(fired) === JSON.stringify(potEvents), `${hz} Hz${stalls ? ' with stalls' : ''}: each pot once, in order`);
    }
  }
  console.log(`  ${position.dateKey}: ${potEvents.length} pots, ${result.totalFrames} frames, the same at every rate`);
}

// ── 6. Tampered input ─────────────────────────────────────────────────────
section('6. Tampered input');
const bad: Array<[string, unknown]> = [
  ['nothing', null],
  ['a string', 'shot'],
  ['NaN angle', { angle: Number.NaN, power: 0.5 }],
  ['infinite angle', { angle: Number.POSITIVE_INFINITY, power: 0.5 }],
  ['huge angle', { angle: 1e9, power: 0.5 }],
  ['string angle', { angle: '1', power: 0.5 }],
  ['no power', { angle: 1 }],
  ['power over 1', { angle: 1, power: 1.01 }],
  ['power under the fire floor', { angle: 1, power: 0.02 }],
  ['negative power', { angle: 1, power: -0.5 }],
  ['spin over 1', { angle: 1, power: 0.5, spinX: 1.5 }],
  ['spin outside the ball', { angle: 1, power: 0.5, spinX: 0.9, spinY: 0.9 }],
  ['string spin', { angle: 1, power: 0.5, spinX: '0.2' }],
];
for (const [label, value] of bad) assert(normalizeTrickShotInput(value) === null, `rejects ${label}`);
const good = normalizeTrickShotInput({ angle: 7, power: 0.505, spinX: 0.123, spinY: 0 });
assert(good !== null && Math.abs(good.angle - (7 - Math.PI * 2)) < TRICK_SHOT_ANGLE_STEP && good.power === 0.51 && good.spinX === 0.12, 'puts a valid shot on the grids');
console.log(`  ${bad.length} tampered shots rejected; a valid one is wrapped and snapped`);
const route = readFileSync(path.join(root, 'src/app/api/games/trick-shot/shot/route.ts'), 'utf8');
assert(route.includes('recordTrickShotTry('), 'the shot route records every try through the locked arm');
assert(route.includes('playTrickShot(position.balls, input)'), 'the shot route replays the try on the day\'s table');
assert(route.includes('sourceId: trickShotRewardSourceId(dateKey, previousBest, play.score)'), 'tickets are keyed by the day and the new best');
assert(!route.includes('body.score') && !route.includes('clientScore'), 'the route never reads a client score');

// ── 7. Every try is posted, replayed and counted ──────────────────────────
section('7. Every try is posted, replayed and counted');
{
  const client = readFileSync(path.join(root, 'src/app/(games)/trick-shot/_trick-shot-client.tsx'), 'utf8');
  const posts = client.match(/\/api\/games\/trick-shot\/shot/g) ?? [];
  assert(posts.length === 1, 'the client posts a try in one place');
  assert(/if \(mode === 'player'\) void submit\(/.test(client), 'and posts every signed-in try');
  assert(!/This shot counts|Practice\./.test(client), 'no single-shot or practice wording is left');
  const server = readFileSync(path.join(root, 'src/server/arcade/trick-shot.ts'), 'utf8');
  assert(server.includes('FOR UPDATE'), 'a try is recorded with the day row locked');
  assert(server.includes("if (row.armed_at === null || row.armed_at === undefined) return { kind: 'unarmed' }"), 'a try is recorded only over an arm');
  assert(/SET status = 'shot', tries = \$3, armed_at = NULL/.test(server) && /SET tries = \$3, armed_at = NULL/.test(server), 'recording a try consumes its arm, best or not');
  const migration = readFileSync(path.join(root, 'src/server/db/migrations/0074_trick_shot_tries.sql'), 'utf8');
  assert(migration.includes('uniq_trick_shot_tries_user_day_try'), 'one row per try number, per player and day');
  assert(route.includes("if (recorded.kind !== 'recorded')") && route.includes('duplicate: true'), 'a post without an arm is answered as a duplicate');
  assert(/if \(!improved\) \{\s*return NextResponse\.json\(\{[^}]*reward: null/.test(route), 'a try that is not a new best pays nothing');
  console.log('  each try is armed, replayed, numbered and kept; only a new best reaches the wallet');
}

// ── 8. The board: ranking and ties ────────────────────────────────────────
section('8. The board: most balls, then fewest tries, then the earliest');
{
  type S = TrickShotDayStanding & { name: string };
  const rows: S[] = [
    { name: 'scratch-3 try 1', pots: 3, score: 70, bestTry: 1, reachedAt: 100 },
    { name: 'clear try 7', pots: 3, score: 100, bestTry: 7, reachedAt: 900 },
    { name: 'clear try 2 late', pots: 3, score: 100, bestTry: 2, reachedAt: 800 },
    { name: 'clear try 2 early', pots: 3, score: 100, bestTry: 2, reachedAt: 300 },
    { name: '2 balls try 1', pots: 2, score: 47, bestTry: 1, reachedAt: 50 },
    { name: '2 balls try 3', pots: 2, score: 47, bestTry: 3, reachedAt: 60 },
    { name: 'no pots try 1', pots: 0, score: 0, bestTry: 1, reachedAt: 10 },
    { name: '1 ball try 9', pots: 1, score: 23, bestTry: 9, reachedAt: 5 },
  ];
  const order = [...rows].sort(compareTrickShotStandings).map((r) => r.name);
  const want = [
    'clear try 2 early',
    'clear try 2 late',
    'clear try 7',
    'scratch-3 try 1',
    '2 balls try 1',
    '2 balls try 3',
    '1 ball try 9',
    'no pots try 1',
  ];
  assert(JSON.stringify(order) === JSON.stringify(want), `the board order (got ${order.join(' > ')})`);
  console.log(`  ${order.join(' > ')}`);
  assert(TRICK_SHOT_BOARD_ORDER === 'pots DESC, score DESC, COALESCE(best_try, 1) ASC, shot_at ASC', 'the SQL order is the same rule');
  const board = readFileSync(path.join(root, 'src/app/api/games/trick-shot/leaderboard/route.ts'), 'utf8');
  assert(board.includes('ORDER BY ${TRICK_SHOT_BOARD_ORDER}'), 'the daily board sorts by it, past days too');
  assert(board.includes('tries: row.best_try'), 'and sends the tries');
  const friendsRoute = readFileSync(path.join(root, 'src/app/api/games/trick-shot/friends/route.ts'), 'utf8');
  assert(friendsRoute.includes('compareTrickShotStandings('), 'the friends card sorts by it');
  // The best of a day: a repeat of the best keeps the earlier try.
  assert(isBetterTrickShotTry({ pots: 1, score: 23 }, null), 'the first try is the best');
  assert(isBetterTrickShotTry({ pots: 2, score: 47 }, { pots: 1, score: 23 }), 'more balls beat fewer');
  assert(isBetterTrickShotTry({ pots: 3, score: 100 }, { pots: 3, score: 70 }), 'a clean clear beats a scratch on the last ball');
  assert(!isBetterTrickShotTry({ pots: 3, score: 70 }, { pots: 3, score: 100 }), 'a scratch never replaces a clear');
  assert(!isBetterTrickShotTry({ pots: 2, score: 47 }, { pots: 2, score: 47 }), 'a repeat keeps the earlier try');
  assert(!isBetterTrickShotTry({ pots: 0, score: 0 }, { pots: 1, score: 23 }), 'a worse try changes nothing');
}

// ── 9. Streaks ────────────────────────────────────────────────────────────
section('9. Streaks: days in a row cleared, on the UTC day');
{
  const s = (days: string[], today: string) => trickShotStreak(days, today);
  assert(s([], '2026-10-04') === 0, 'no clears, no streak');
  assert(s(['2026-10-04'], '2026-10-04') === 1, 'a clear today is a streak of 1');
  assert(s(['2026-10-02', '2026-10-03'], '2026-10-04') === 2, 'today not cleared yet keeps the streak to yesterday');
  assert(s(['2026-10-02', '2026-10-03', '2026-10-04'], '2026-10-04') === 3, 'and clearing today extends it');
  assert(s(['2026-10-01', '2026-10-02'], '2026-10-04') === 0, 'a missed day ends it');
  assert(s(['2026-10-01', '2026-10-03', '2026-10-04'], '2026-10-04') === 2, 'a gap splits it');
  assert(s(['2026-09-29', '2026-09-30', '2026-10-01'], '2026-10-01') === 3, 'across a month end');
  assert(s(['2026-12-30', '2026-12-31', '2027-01-01'], '2027-01-01') === 3, 'across a year end');
  assert(s(['2028-02-28', '2028-02-29', '2028-03-01'], '2028-03-01') === 3, 'across a leap day');
  assert(s(['2026-03-28', '2026-03-29', '2026-03-30'], '2026-03-30') === 3, 'across a clock change (the day is UTC)');
  assert(s(['2026-10-03', '2026-10-03', '2026-10-04'], '2026-10-04') === 2, 'a day counts once');
  assert(trickShotBestStreak(['2026-10-01', '2026-10-02', '2026-10-04', '2026-10-05', '2026-10-06']) === 3, 'the best run');
  assert(trickShotBestStreak([]) === 0, 'no clears, no best run');
  // The day is the table's: UTC midnight, whatever the player's clock says.
  assert(trickShotDateKey(Date.UTC(2026, 9, 4, 23, 59, 59)) === '2026-10-04', '23:59:59 UTC is still the 4th');
  assert(trickShotDateKey(Date.UTC(2026, 9, 5, 0, 0, 0)) === '2026-10-05', '00:00:00 UTC is the 5th');
  assert(shiftTrickShotDateKey('2026-10-04', -1) === '2026-10-03' && shiftTrickShotDateKey('2026-12-31', 1) === '2027-01-01', 'day arithmetic');
  // A clear late on the 4th and one early on the 5th are two days in a row.
  const late = trickShotDateKey(Date.UTC(2026, 9, 4, 23, 58));
  const early = trickShotDateKey(Date.UTC(2026, 9, 5, 0, 3));
  assert(s([late, early], early) === 2, 'clears either side of midnight UTC make a streak of 2');
  // A scratch on the last ball isn't a clear, so it neither counts nor breaks
  // the rule "Scratch. No clear bonus.": the day's best has clear = false.
  assert(!isClear({ pots: 3, ballCount: 3, scratch: true }), 'a scratch on the last ball is not a clear');
  // A try armed before midnight and posted in the grace counts for its table's day.
  assert(route.includes('LATE_GRACE_MS') && route.includes('const dateKey = body.dateKey;'), 'a try is filed under its table\'s day, with 15 minutes of grace');
  console.log('  today pending keeps it, a missed day ends it, month, year and leap days carry it, a scratch is no clear');
}

// ── 10. Rewards: paid once a day, improvements pay the difference ─────────
section('10. Rewards: the best pays once; a new best pays the difference');
{
  const levels = (n: number) => {
    const out = new Set<number>();
    for (let pots = 0; pots <= n; pots += 1) {
      out.add(trickShotScore({ pots, ballCount: n, scratch: false }));
      out.add(trickShotScore({ pots, ballCount: n, scratch: true }));
    }
    return [...out].sort((a, b) => a - b);
  };
  for (const n of [2, 3]) {
    const scores = levels(n);
    console.log(`  ${n} balls: ${scores.map((s) => `${s} is worth ${trickShotTickets(s)}`).join(', ')}`);
  }
  // Worked example for the doc: a miss, then 2 of 3, then a 2 again, then a clear.
  const example = [0, 47, 47, 23, 100, 100];
  let previous: number | null = null;
  const paid: number[] = [];
  for (const score of example) {
    const pay = trickShotTryTickets(score, previous);
    paid.push(pay);
    if (previous === null || score > previous) previous = score;
  }
  console.log(`  tries scoring ${example.join(', ')} pay ${paid.join(' + ')} = ${paid.reduce((a, b) => a + b, 0)}`);
  assert(JSON.stringify(paid) === JSON.stringify([12, 37, 0, 0, 22, 0]), 'the worked example pays 12, 37, then 22');
  assert(paid.reduce((a, b) => a + b, 0) === trickShotTickets(100), 'and adds up to a clear');
  // Every sequence of tries pays the best's value, once.
  const rng = mulberry32(1010);
  let sequences = 0;
  for (let i = 0; i < 3000; i += 1) {
    const n = rng() < 0.5 ? 2 : 3;
    const scores = levels(n);
    const tries = 1 + Math.floor(rng() * 12);
    let prev: number | null = null;
    let total = 0;
    let bestScore = -1;
    const keys = new Set<string>();
    for (let t = 0; t < tries; t += 1) {
      const score = scores[Math.floor(rng() * scores.length)]!;
      const pay = trickShotTryTickets(score, prev);
      const wallet = calculateGameRewardCredits({ gameType: 'trick-shot', score, clear: score === 100, previousBest: prev });
      assert(wallet === pay, 'the wallet pays what the rules owe');
      if (prev === null || score > prev) {
        const key = trickShotRewardSourceId('2026-10-04', prev, score);
        assert(!keys.has(key), 'each new best has its own ledger key');
        keys.add(key);
        prev = score;
      } else {
        assert(pay === 0, 'a try that is not a new best pays nothing');
      }
      total += pay;
      bestScore = Math.max(bestScore, score);
    }
    assert(total === trickShotTickets(bestScore), `a day pays its best's value once (${total} vs ${trickShotTickets(bestScore)})`);
    sequences += 1;
  }
  assert(trickShotRewardSourceId('2026-10-04', null, 47) === 'trick-shot:2026-10-04', 'the first payment keeps the single shot\'s key');
  assert(trickShotTickets(100) <= GAME_DAILY_CREDIT_CAP / 4, 'a day of trick shot is a quarter of the daily cap at most');
  console.log(`  ${sequences} random days of tries: each pays exactly its best's value, with one ledger key per new best`);
}

// ── 11. Simulated players ─────────────────────────────────────────────────
section('11. Simulated players: tries to clear (aim and power error around the solution)');
// A player who has read the line and aims at it: Gaussian aim error in
// degrees and power error in percent, spin as the solution, each try
// independent. Generous for a first try (a real player has to find the line
// first) and harsh after it (a real player learns from the miss), so read
// the tries as an upper bound for someone who keeps the aim between tries.
type Skill = { name: string; aimDeg: number; powerPct: number };
const SKILLS: Skill[] = [
  { name: 'first go', aimDeg: 1.2, powerPct: 12 },
  { name: 'casual', aimDeg: 0.5, powerPct: 7 },
  { name: 'good', aimDeg: 0.2, powerPct: 4 },
  { name: 'sharp', aimDeg: 0.08, powerPct: 2 },
];
const MAX_TRIES = 20;
const simPositions = positions.slice(0, Math.min(positions.length, 84));
const clearRates: Record<string, number> = {};
const firstTryRates: Record<string, number> = {};
for (const skill of SKILLS) {
  const rng = mulberry32(skill.name.length * 97);
  let cleared = 0;
  let firstTry = 0;
  let tickets = 0;
  const triesToClear: number[] = [];
  const byDay = Array.from({ length: 7 }, () => ({ n: 0, clears: 0 }));
  for (const position of simPositions) {
    let bestScore = -1;
    let clearedOn = 0;
    for (let t = 1; t <= MAX_TRIES; t += 1) {
      const shot: TrickShotInput = snapTrickShot({
        angle: position.solution.angle + gauss(rng) * skill.aimDeg * (Math.PI / 180),
        power: Math.max(0.05, Math.min(1, position.solution.power + (gauss(rng) * skill.powerPct) / 100)),
        spinX: position.solution.spinX,
        spinY: position.solution.spinY,
      });
      const play = playTrickShot(position.balls, shot);
      bestScore = Math.max(bestScore, play.score);
      if (play.clear) {
        clearedOn = t;
        break;
      }
    }
    const d = byDay[trickShotWeekday(position.dateKey)]!;
    d.n += 1;
    if (clearedOn) {
      cleared += 1;
      d.clears += 1;
      triesToClear.push(clearedOn);
      if (clearedOn === 1) firstTry += 1;
    }
    tickets += trickShotTickets(bestScore);
  }
  const n = simPositions.length;
  clearRates[skill.name] = cleared / n;
  firstTryRates[skill.name] = firstTry / n;
  console.log(
    `  ${skill.name.padEnd(8)} aim ${skill.aimDeg} deg, power ${skill.powerPct}%: clears ${((100 * cleared) / n).toFixed(0)}% of days within ${MAX_TRIES} tries, median ${median(triesToClear)} tries, first try ${((100 * firstTry) / n).toFixed(0)}%, ${(tickets / n).toFixed(0)} tickets a day; by day ${byDay.map((d, i) => `${DAYS[i]} ${d.n ? ((100 * d.clears) / d.n).toFixed(0) : '-'}%`).join(' ')}`,
  );
}
assert(clearRates['sharp']! >= clearRates['casual']!, 'a sharper hand clears more days');
assert(firstTryRates['sharp']! > firstTryRates['first go']!, 'and more on the first try');

section('   Achievement tiers');
const series = ACHIEVEMENTS.filter((a) => a.seriesId === 'trick-shot-clears');
assert(series.length === 5, 'days cleared: one five-tier series');
const streakSeries = ACHIEVEMENTS.filter((a) => a.seriesId === 'trick-shot-streak');
assert(streakSeries.length === 5, 'streak: one five-tier series');
const firstTryFeat = ACHIEVEMENTS.find((a) => a.id === 'trick-shot-first-try');
assert(Boolean(firstTryFeat) && (firstTryFeat!.condition as { gte: number }).gte === 1, 'the first-try clear is a feat');
const thresholds = series.map((a) => (a.condition as { gte: number }).gte);
const streakThresholds = streakSeries.map((a) => (a.condition as { gte: number }).gte);
assert(JSON.stringify(streakThresholds) === JSON.stringify([3, 7, 14, 30, 60]), 'streak tiers are the daily puzzle streak\'s');
for (const skill of SKILLS) {
  const perYear = clearRates[skill.name]! * 365;
  // Playing every day, the expected longest run of clears in a year at a
  // daily clear rate p is about log(365 (1 - p)) / log(1 / p).
  const p = clearRates[skill.name]!;
  const run = p >= 0.99 ? 365 : p > 0 ? Math.max(1, Math.log(365 * (1 - p)) / Math.log(1 / p)) : 0;
  console.log(
    `  ${skill.name.padEnd(8)} about ${perYear.toFixed(0)} clears a year: tiers ${thresholds.map((t) => `${t} in ${perYear > 0 ? Math.ceil((t / perYear) * 12) : 'never'} mo`).join(', ')}; longest streak in a year about ${run.toFixed(0)}; a first-try clear about every ${firstTryRates[skill.name]! > 0 ? Math.round(1 / firstTryRates[skill.name]!) : 'never'} days`,
  );
}
assert(thresholds[0] === 1, 'the first clear is the first tier');

// ── 12. The database: tries, arms, concurrency, replays, streaks ──────────
section('12. The database: tries counted, one try per arm, every try replays');
await (async () => {
  for (const envFile of ['env/.env.local', 'env/.env']) {
    try {
      for (const raw of readFileSync(path.join(root, envFile), 'utf8').split(/\r?\n/)) {
        const line = raw.trim();
        const eq = line.indexOf('=');
        if (!line || line.startsWith('#') || eq < 0) continue;
        const key = line.slice(0, eq).trim();
        if (process.env[key] === undefined) process.env[key] = line.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
      }
    } catch {
      // no env file
    }
  }
  const url = process.env.DATABASE_URL ?? '';
  const dbName = url.split('/').pop()?.split('?')[0] ?? '';
  if (!url || /prod/i.test(dbName)) {
    console.log('  skipped: no development DATABASE_URL');
    return;
  }
  const db = await import('../src/server/db/client');
  const ts = await import('../src/server/arcade/trick-shot');
  try {
    await db.query('SELECT 1 FROM trick_shot_tries LIMIT 0');
  } catch (error) {
    console.log(`  skipped: the database is not reachable or not migrated (${(error as Error).message.slice(0, 80)})`);
    return;
  }

  const user = `verify-trick-shot-${randomUUID()}`;
  const fieldsFor = (dateKey: string, input: TrickShotInput) => {
    const play = playTrickShot(ts.getTrickShotPosition(dateKey).balls, input);
    return {
      angleSteps: Math.round(input.angle / TRICK_SHOT_ANGLE_STEP),
      powerPct: Math.round(input.power * 100),
      spinX: input.spinX,
      spinY: input.spinY,
      pots: play.pots,
      ballCount: play.ballCount,
      scratch: play.scratch,
      clear: play.clear,
      score: play.score,
      nearMisses: play.nearMisses.length,
      userName: 'verify',
    };
  };
  const cleanup = async () => {
    await db.query('DELETE FROM trick_shot_tries WHERE od_user_id = $1', [user]);
    await db.query('DELETE FROM trick_shot_attempts WHERE od_user_id = $1', [user]);
  };

  try {
    // A banked day, so the shots are real: its solution clears, a shot
    // aimed well away misses.
    // A day well ahead, off any board a player is looking at.
    const dateKey = positions[Math.min(60, positions.length - 5)]!.dateKey;
    const position = ts.getTrickShotPosition(dateKey);
    const solution = snapTrickShot(position.solution);
    const wide = snapTrickShot({ ...position.solution, angle: position.solution.angle + Math.PI / 2 });
    const t0 = Date.now();

    // Tries count in order, the best keeps its try, a repeat keeps the earlier.
    const row = await ts.armTrickShotTry(user, 'verify', dateKey, t0);
    const shots = [wide, solution, wide, solution];
    const recorded = [];
    for (const [i, shot] of shots.entries()) {
      if (i > 0) await ts.armTrickShotTry(user, 'verify', dateKey, t0 + i * 1000);
      recorded.push(await ts.recordTrickShotTry(row.id, user, fieldsFor(dateKey, shot), t0 + i * 1000 + 500));
    }
    const numbers = recorded.map((r) => (r.kind === 'recorded' ? r.tryNumber : -1));
    assert(JSON.stringify(numbers) === '[1,2,3,4]', `tries are numbered 1 to 4 (got ${numbers.join(',')})`);
    const improved = recorded.map((r) => (r.kind === 'recorded' ? r.improved : null));
    assert(JSON.stringify(improved) === '[true,true,false,false]', 'only the first try and the first clear set the best');
    const due = recorded.map((r) => (r.kind === 'recorded' ? r.ticketsDue : -1));
    const firstScore = fieldsFor(dateKey, wide).score;
    assert(due[0] === trickShotTickets(firstScore) && due[1] === trickShotTickets(100) - trickShotTickets(firstScore) && due[2] === 0 && due[3] === 0, `tickets owed ${due.join(', ')}`);
    let day = await ts.getTrickShotAttempt(user, dateKey);
    assert(day !== null && ts.triesOf(day) === 4 && day.best_try === 2 && Boolean(day.clear) && Number(day.shot_at) === t0 + 1500, 'the day row: 4 tries, best on try 2, its time kept');
    assert(day !== null && day.armed_at === null, 'no try is left armed');

    // A post without an arm is not a try.
    const unarmed = await ts.recordTrickShotTry(row.id, user, fieldsFor(dateKey, solution), t0 + 9000);
    assert(unarmed.kind === 'unarmed', 'a post without an arm is turned away');
    day = await ts.getTrickShotAttempt(user, dateKey);
    assert(day !== null && ts.triesOf(day) === 4, 'and is not counted');

    // Ten posts racing for one arm record one try.
    await ts.armTrickShotTry(user, 'verify', dateKey, t0 + 10_000);
    const race = await Promise.all(
      Array.from({ length: 10 }, (_, i) => ts.recordTrickShotTry(row.id, user, fieldsFor(dateKey, i % 2 ? wide : solution), t0 + 10_500 + i)),
    );
    assert(race.filter((r) => r.kind === 'recorded').length === 1, 'ten concurrent posts on one arm record one try');
    day = await ts.getTrickShotAttempt(user, dateKey);
    assert(day !== null && ts.triesOf(day) === 5, 'the count moves by one');

    // Many tries at once, each with its own arm: no try number twice, none
    // skipped, and the tickets owed add up to the best's value, once.
    const other = `${user}-b`;
    const dayB = shiftTrickShotDateKey(dateKey, 1);
    const posB = ts.getTrickShotPosition(dayB);
    const rngDb = mulberry32(77);
    const rowB = await ts.armTrickShotTry(other, 'verify', dayB, t0);
    const shotsB = Array.from({ length: 24 }, () =>
      snapTrickShot({
        angle: posB.solution.angle + gauss(rngDb) * 0.6 * (Math.PI / 180),
        power: Math.max(0.05, Math.min(1, posB.solution.power + gauss(rngDb) * 0.08)),
        spinX: posB.solution.spinX,
        spinY: posB.solution.spinY,
      }),
    );
    const results = await Promise.all(
      shotsB.map(async (shot, i) => {
        await ts.armTrickShotTry(other, 'verify', dayB, t0 + i);
        return ts.recordTrickShotTry(rowB.id, other, fieldsFor(dayB, shot), t0 + 100 + i);
      }),
    );
    const got = results.filter((r): r is Extract<typeof r, { kind: 'recorded' }> => r.kind === 'recorded');
    const nums = got.map((r) => r.tryNumber).sort((a, b) => a - b);
    assert(nums.every((n, i) => n === i + 1), `concurrent tries are numbered 1 to ${nums.length} with no gap or repeat`);
    const owed = got.reduce((sum, r) => sum + r.ticketsDue, 0);
    const bestB = (await ts.getTrickShotAttempt(other, dayB))!;
    assert(owed === trickShotTickets(Number(bestB.score)), `concurrent tries owe ${owed}, the best's value ${trickShotTickets(Number(bestB.score))}`);
    const improvedScores = (
      await db.query<{ score: number }>('SELECT score FROM trick_shot_tries WHERE od_user_id = $1 AND improved ORDER BY try_number', [other])
    ).rows.map((r) => Number(r.score));
    assert(improvedScores.every((s, i) => i === 0 || s > improvedScores[i - 1]!), 'each new best beats the one before, so each ledger key is new');
    assert(ts.triesOf(bestB) === got.length, 'the day row counts every recorded try');

    // Every stored try replays to what was recorded.
    const stored = (
      await db.query<{ puzzle_date: string; angle_steps: number; power_pct: number; spin_x: number; spin_y: number; pots: number; score: number; scratch: boolean }>(
        'SELECT puzzle_date, angle_steps, power_pct, spin_x, spin_y, pots, score, scratch FROM trick_shot_tries WHERE od_user_id = ANY($1::text[])',
        [[user, other]],
      )
    ).rows;
    let replayed = 0;
    for (const t of stored) {
      const input = normalizeTrickShotInput({ angle: t.angle_steps * TRICK_SHOT_ANGLE_STEP, power: t.power_pct / 100, spinX: t.spin_x / 100, spinY: t.spin_y / 100 });
      const again = input ? playTrickShot(ts.getTrickShotPosition(t.puzzle_date).balls, input) : null;
      if (again && again.pots === t.pots && again.score === t.score && again.scratch === t.scratch) replayed += 1;
    }
    assert(replayed === stored.length, `${replayed} of ${stored.length} stored tries replay to their result`);

    // Streaks from the table: cleared yesterday and today, a scratch-only day
    // before that doesn't count.
    const streakUser = `${user}-c`;
    const today = shiftTrickShotDateKey(dateKey, 3);
    const days = [shiftTrickShotDateKey(today, -2), shiftTrickShotDateKey(today, -1), today];
    for (const [i, d] of days.entries()) {
      const p = ts.getTrickShotPosition(d);
      const r = await ts.armTrickShotTry(streakUser, 'verify', d, t0 + i);
      const f = fieldsFor(d, snapTrickShot(p.solution));
      // The first of the three is recorded as a scratch on the last ball.
      const fields = i === 0 ? { ...f, scratch: true, clear: false, score: trickShotScore({ pots: f.ballCount, ballCount: f.ballCount, scratch: true }) } : f;
      await ts.recordTrickShotTry(r.id, streakUser, fields, t0 + i + 1);
    }
    assert((await ts.getTrickShotStreak(streakUser, today)) === 2, 'the streak from the table is 2: the scratch day is no clear');
    assert((await ts.getTrickShotStreak(streakUser, shiftTrickShotDateKey(today, 1))) === 2, 'tomorrow, before a try, it still stands');
    assert((await ts.getTrickShotStreak(streakUser, shiftTrickShotDateKey(today, 2))) === 0, 'a day missed ends it');
    await db.query('DELETE FROM trick_shot_tries WHERE od_user_id = ANY($1::text[])', [[other, streakUser]]);
    await db.query('DELETE FROM trick_shot_attempts WHERE od_user_id = ANY($1::text[])', [[other, streakUser]]);
    console.log(`  ${stored.length} tries recorded and replayed; 24 racing arm-and-post pairs recorded ${got.length} tries, numbered in order and owing ${owed} tickets in all`);
  } finally {
    await cleanup();
    await db.getPool().end();
  }
})();

console.log(`\n${checks - failures} of ${checks} checks passed.`);
if (failures > 0) {
  console.error(`${failures} failed.`);
  process.exit(1);
}
