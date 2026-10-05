/**
 * Mini golf: the replay verifier. Run with `npx tsx scripts/verify-mini-golf-replay.ts`
 * (quick: under a minute) or `--full` (the reward and par tables, a few
 * minutes on 16 cores' worth of one).
 *
 *  1. Determinism: the same putts give the same resting points, twice, and
 *     the client's live playback at 30, 60, 90, 120 and 144 Hz with frame
 *     stalls stops where the server's replay stops, to the bit.
 *  2. Tampering: a wrong stroke count, a putt before the ball could be
 *     struck, a putt after the ball is in, power out of range, a rewritten
 *     earlier putt and a hole posted short are all rejected.
 *  3. The course: the next 60 days build; every shared edge between two
 *     cells meets at one height; every cup and tee sits clear of the rails;
 *     every hole of the next 14 days is holed inside the stroke limit by a
 *     player with no error; no putt in the sims runs to the 25 s cap.
 *  4. --full: par against a good player, the reward by skill and the
 *     achievement tiers, from simulated rounds.
 */
import assert from 'node:assert/strict';

import {
  MG_BALL_R,
  MG_CELL,
  MG_CUP_R,
  MG_HOLES,
  MG_LEVEL_STEP,
  MG_MAX_PUTT_STEPS,
  MG_MAX_STROKES,
  MG_PICKUP_SCORE,
  mgCellAt,
  mgHeight,
  mgQuantizePutt,
  mgReplayHole,
  mgSimulatePutt,
  type MgHole,
  type MgPutt,
} from '../src/server/arcade/mini-golf-engine';
import { MG_TEMPLATES, mgBuildHole, mgCourseFor, type MgBuildOptions } from '../src/server/arcade/mini-golf-course';
import {
  MG_REWARD_BASE,
  MG_REWARD_DIVISOR,
  mgCheckHole,
  mgRoundPoints,
  mgRoundTickets,
  mgSamePutts,
} from '../src/server/arcade/mini-golf-round';
import { calculateGameRewardCredits } from '../src/server/arcade/rewards/wallet';
import { createMgPlayback, type MgSample } from '../src/app/(games)/mini-golf/_mini-golf-play';
import { SKILLS, choosePutt, distanceField, playHole, rngFrom } from './lib/mini-golf-bot';

const full = process.argv.includes('--full');
let checks = 0;
const ok = (cond: unknown, message: string) => {
  checks += 1;
  assert.ok(cond, message);
};

const dayKey = (offset: number) => new Date(Date.UTC(2026, 9, 4) + offset * 86_400_000).toISOString().slice(0, 10);

// ── A perfect player's putts for a hole (no error), for the checks below ──
function perfectHole(hole: MgHole): MgPutt[] {
  const field = distanceField(hole);
  const skill = { ...SKILLS[3], aimDeg: 0.001, pace: 0.001, timingMs: 1 };
  let from = { x: hole.tee.x, y: hole.tee.y };
  let readyAt = 1000;
  const putts: MgPutt[] = [];
  for (let i = 0; i < MG_MAX_STROKES; i += 1) {
    const c = choosePutt(hole, field, from, readyAt, skill);
    const putt = mgQuantizePutt({ t: c.t, dx: Math.cos(c.angle), dy: Math.sin(c.angle), power: c.power });
    putts.push(putt);
    const r = mgSimulatePutt(hole, from, putt.dx, putt.dy, putt.power, putt.t)!;
    if (r.holed) break;
    from = { x: r.x, y: r.y };
    readyAt = putt.t + Math.ceil(r.durationMs) + 300;
  }
  return putts;
}

// ── 1. Determinism ──
{
  const course = mgCourseFor(dayKey(0));
  for (const [i, ch] of course.holes.entries()) {
    const putts = perfectHole(ch.hole);
    const a = mgReplayHole(ch.hole, putts);
    const b = mgReplayHole(ch.hole, putts);
    ok(JSON.stringify(a) === JSON.stringify(b), `hole ${i + 1}: two replays differ`);
    ok(a.holed && a.score <= MG_MAX_STROKES, `hole ${i + 1} (${ch.templateId}): a perfect player didn't hole out`);

    // The live playback, at display rates with stalls, against the replay.
    let from = { x: ch.hole.tee.x, y: ch.hole.tee.y };
    for (const putt of putts) {
      const want = mgSimulatePutt(ch.hole, from, putt.dx, putt.dy, putt.power, putt.t)!;
      for (const hz of [30, 60, 90, 120, 144]) {
        const play = createMgPlayback(ch.hole, from, putt.dx, putt.dy, putt.power, putt.t)!;
        const rng = rngFrom(hz * 7 + i);
        let frames = 0;
        while (play.ball.mode === 'roll' || play.ball.mode === 'loop') {
          // A frame, sometimes a dropped one, now and then a long stall.
          const stall = rng() < 0.01 ? 180 : rng() < 0.08 ? 1000 / hz : 0;
          play.advance(1000 / hz + stall);
          frames += 1;
          assert.ok(frames < 100_000, 'playback never ended');
        }
        const s: MgSample = { x: 0, y: 0, vx: 0, vy: 0, mode: 'rest', s: 0, loop: -1 };
        play.sample(s);
        const holed = play.ball.mode === 'holed';
        ok(holed === want.holed, `hole ${i + 1} at ${hz} Hz: holed differs`);
        if (!holed) ok(play.ball.x === want.x && play.ball.y === want.y, `hole ${i + 1} at ${hz} Hz: rest differs`);
        ok(play.ball.steps === want.steps, `hole ${i + 1} at ${hz} Hz: step count differs`);
      }
      from = want.holed ? from : { x: want.x, y: want.y };
    }
  }
  console.log('determinism: 9 holes, every putt at 30, 60, 90, 120 and 144 Hz with stalls, same to the bit');
}

// ── 2. Tampering ──
{
  const course = mgCourseFor(dayKey(0));
  const hole = course.holes[0].hole;
  const putts = perfectHole(hole);
  const replay = mgReplayHole(hole, putts);
  const good = mgCheckHole(course, 0, putts, replay.score);
  ok(good.ok, 'an honest hole is accepted');
  ok(!mgCheckHole(course, 0, putts, replay.score - 1).ok, 'a lower stroke count is rejected');
  ok(!mgCheckHole(course, 0, putts, null).ok, 'a finished hole posted as unfinished is rejected');
  ok(!mgCheckHole(course, 0, [...putts, putts[putts.length - 1]], replay.score).ok, 'a putt after the ball is in is rejected');
  ok(!mgCheckHole(course, 0, [{ ...putts[0], power: 1.5 }, ...putts.slice(1)], replay.score).ok, 'power over 1 is rejected');
  if (putts.length > 1) {
    ok(!mgCheckHole(course, 0, [putts[0], { ...putts[1], t: putts[0].t + 5 }, ...putts.slice(2)], replay.score).ok, 'a putt while the ball still rolls is rejected');
  }
  ok(!mgCheckHole(course, 9, putts, replay.score).ok, 'a tenth hole is rejected');
  ok(!mgCheckHole(course, 0, [{ ...putts[0], dx: 0, dy: 0 }], MG_PICKUP_SCORE).ok, 'a putt with no direction is rejected');
  ok(!mgSamePutts([putts[0]], [{ ...putts[0], power: putts[0].power + 0.001 }]), 'a rewritten earlier putt is caught');
  ok(mgSamePutts(putts.slice(0, 1), putts), 'an honest continuation passes');
  // The best a forged putt list can claim is what it actually rolls: a
  // "hole in one" claim on putts that don't hole in one fails.
  const short = [mgQuantizePutt({ t: 1000, dx: 0, dy: 1, power: 0.05 })];
  ok(!mgCheckHole(course, 0, short, 1).ok, 'a claimed ace on a putt that stops short is rejected');
  console.log('tampering: 11 forged holes rejected, honest holes accepted');
}

// ── 3. The course ──
{
  const sides: Array<[number, number]> = [
    [1, 0],
    [0, 1],
  ];
  let holes = 0;
  for (let d = 0; d < 60; d += 1) {
    const course = mgCourseFor(dayKey(d));
    ok(course.holes.length === MG_HOLES, `${course.dateKey}: nine holes`);
    ok(new Set(course.holes.map((h) => h.templateId)).size === MG_HOLES, `${course.dateKey}: a hole twice`);
    ok(course.holes.some((h) => h.hole.windmills.length > 0), `${course.dateKey}: no windmill`);
    ok(course.holes.some((h) => h.hole.loops.length > 0), `${course.dateKey}: no loop`);
    for (const { hole, templateId } of course.holes) {
      holes += 1;
      // Shared edges meet at one height (sampled across each edge).
      for (const cell of hole.cells) {
        for (const [dc, dr] of sides) {
          const x0 = (cell.col + (dc ? 1 : 0)) * MG_CELL;
          const y0 = (cell.row + (dr ? 1 : 0)) * MG_CELL;
          const nx = (cell.col + dc + 0.5) * MG_CELL;
          const ny = (cell.row + dr + 0.5) * MG_CELL;
          if (!mgCellAt(hole, nx, ny)) continue;
          for (let k = 1; k < 10; k += 1) {
            const x = dc ? x0 : x0 + (k / 10) * MG_CELL;
            const y = dr ? y0 : y0 + (k / 10) * MG_CELL;
            const a = mgHeight(hole, x - dc * 1e-6, y - dr * 1e-6);
            const b = mgHeight(hole, x + dc * 1e-6, y + dr * 1e-6);
            ok(Math.abs(a - b) < MG_LEVEL_STEP * 0.02, `${course.dateKey} ${templateId}: step at an edge (${a} vs ${b})`);
          }
        }
      }
      // Cup and tee clear of every rail and post.
      const clear = (p: { x: number; y: number }, r: number) =>
        hole.walls.every((s) => {
          const ex = s.x2 - s.x1;
          const ey = s.y2 - s.y1;
          const l2 = ex * ex + ey * ey;
          const u = Math.max(0, Math.min(1, ((p.x - s.x1) * ex + (p.y - s.y1) * ey) / l2));
          return Math.hypot(p.x - (s.x1 + ex * u), p.y - (s.y1 + ey * u)) >= r;
        }) && hole.posts.every((q) => Math.hypot(p.x - q.x, p.y - q.y) >= q.r + r);
      ok(clear(hole.cup, MG_CUP_R + MG_BALL_R), `${course.dateKey} ${templateId}: the cup touches a rail`);
      ok(clear(hole.tee, MG_BALL_R * 1.5), `${course.dateKey} ${templateId}: the tee touches a rail`);
    }
  }
  console.log(`course: 60 days, ${holes} holes build, edges level, cups and tees clear`);

  // Every hole of the next 14 days holed by a player with no error.
  let finishable = 0;
  const worst: Record<string, number> = {};
  for (let d = 0; d < 14; d += 1) {
    const course = mgCourseFor(dayKey(d));
    for (const { hole, templateId } of course.holes) {
      const putts = perfectHole(hole);
      const r = mgReplayHole(hole, putts);
      ok(r.holed, `${course.dateKey} ${templateId}: not holed inside ${MG_MAX_STROKES}`);
      worst[templateId] = Math.max(worst[templateId] ?? 0, r.score);
      finishable += 1;
    }
  }
  console.log(`finishable: ${finishable} holes over 14 days, each holed by a player with no error in at most`, worst);
}

// ── 4. Par, rewards and tiers (--full) ──
if (full) {
  // Par: a good player per template, every variant.
  console.log('\npar (good player mean, 40 holes per template; par is that, rounded):');
  for (const t of MG_TEMPLATES) {
    const variants: MgBuildOptions[] = [];
    for (const mirror of [false, true]) for (const slot of t.slot ?? ['none']) variants.push({ mirror, slot, bowl: t.bowl === true, millPhase: 0.37, cupDx: 0, cupDy: 0, teeDx: 0 });
    const rng = rngFrom(31);
    let sum = 0;
    let n = 0;
    let capped = 0;
    for (let i = 0; i < 40; i += 1) {
      const hole = mgBuildHole(t, variants[i % variants.length]);
      const play = playHole(hole, SKILLS[2], rng);
      sum += play.score;
      n += 1;
      let from = { x: hole.tee.x, y: hole.tee.y };
      for (const p of play.putts) {
        const r = mgSimulatePutt(hole, from, p.dx, p.dy, p.power, p.t)!;
        if (r.steps >= MG_MAX_PUTT_STEPS) capped += 1;
        from = { x: r.x, y: r.y };
      }
    }
    const mean = sum / n;
    const fair = Math.round(mean);
    console.log(`  ${t.id.padEnd(10)} par ${t.par}  good ${mean.toFixed(2)}  ${fair === t.par ? 'ok' : `want ${fair}`}${capped ? `  capped putts ${capped}` : ''}`);
    ok(Math.abs(fair - t.par) <= 1, `${t.id}: par ${t.par} is off a good player's ${mean.toFixed(2)}`);
    ok(capped === 0, `${t.id}: a putt ran to the cap`);
  }

  // Rounds by skill: points, tickets, aces.
  console.log(`\nrounds by skill (tickets = 75 x (1 - exp(-(max(0, points - ${MG_REWARD_BASE}) / ${MG_REWARD_DIVISOR})^1.15))):`);
  const rows: string[] = [];
  for (const skill of SKILLS) {
    const rng = rngFrom(97 + skill.aimDeg * 10);
    const points: number[] = [];
    const tickets: number[] = [];
    const toPar: number[] = [];
    let aces = 0;
    const rounds = 10;
    for (let d = 0; d < rounds; d += 1) {
      const course = mgCourseFor(dayKey(d));
      const scores = course.holes.map(({ hole }) => playHole(hole, skill, rng).score);
      const p = mgRoundPoints(scores);
      points.push(p);
      tickets.push(calculateGameRewardCredits({ gameType: 'mini-golf', score: p }));
      ok(tickets[tickets.length - 1] === mgRoundTickets(p), 'the wallet and the round module agree');
      toPar.push(scores.reduce((a, b) => a + b, 0) - course.par);
      aces += scores.filter((s) => s === 1).length;
    }
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    rows.push(
      `  ${skill.name.padEnd(9)} to par ${mean(toPar).toFixed(1).padStart(5)}  points ${mean(points).toFixed(1)}  tickets ${mean(tickets).toFixed(1)} (min ${Math.min(...tickets)}, max ${Math.max(...tickets)})  aces a round ${(aces / rounds).toFixed(2)}`,
    );
  }
  console.log(rows.join('\n'));
  console.log('\nthe curve, points to tickets:');
  console.log('  ' + [27, 30, 33, 36, 39, 42, 45, 48, 51, 54].map((p) => `${p}: ${mgRoundTickets(p)}`).join('  '));
}

console.log(`\nok: ${checks} checks`);
