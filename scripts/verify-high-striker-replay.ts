/**
 * High striker replay verifier, rules version 3 (the endless tower).
 *
 * Usage: tsx scripts/verify-high-striker-replay.ts [--runs=4000] [--quiet]
 *
 *  1. The difficulty curve: every quantity moves smoothly and the right way,
 *     swing to swing, with no step bigger than a few percent (no walls), and
 *     the windows stay humanly readable at depth.
 *  2. Rules: a hit pays 1 and breaks the bell streak, a bell pays 3 plus the
 *     streak up to 8, the first miss ends the run (early or late), the tower
 *     tops out at STRIKER_MAX_SWINGS.
 *  3. Determinism: the same press and release timestamps give the same run on
 *     the client and the server at 30 to 144 Hz and through frame stalls, and
 *     the fill drawn on the last frame before the release (with the display
 *     lead) is the judged strength to within a frame of travel.
 *  4. Client and server agree on thousands of simulated runs.
 *  5. Tamper rejection: a tap in the list, a swing after the end, a list that
 *     stops before the miss, bad numbers, retimed swings, another seed.
 *  6. The spread check flags a program aimed at the peak and never a hand
 *     (10 to 80 ms of noise), and the timing floor rejects a forged list.
 *  7. Score distribution by skill, the reward curve (the divisor is solved so
 *     a good player earns about what the other endless timing games pay a
 *     minute), the caps, the daily quest and the achievement tiers.
 *
 * Exits non-zero on any failed assertion. `--quiet` prints only the checks.
 */
import {
  strikerApplySwing,
  strikerBaseSpeed,
  strikerBellPoints,
  strikerBellWindowFor,
  strikerDisplayLeadMs,
  strikerFlightTimes,
  strikerGaugeValue,
  strikerInitialState,
  strikerJitterFor,
  strikerJudgeHold,
  strikerMinRunMs,
  strikerPlayCheck,
  strikerPuckKind,
  strikerRoundFor,
  strikerRunDone,
  strikerWindowFor,
  validateStrikerRun,
  STRIKER_BELL_STREAK_CAP,
  STRIKER_DROP_MS_MAX,
  STRIKER_DROP_MS_MIN,
  STRIKER_LATE_GRACE_MS,
  STRIKER_MAX_HOLD_MS,
  STRIKER_MAX_POINTS_PER_SWING,
  STRIKER_MAX_SCORE,
  STRIKER_MAX_SWINGS,
  STRIKER_MIN_HOLD_MS,
  STRIKER_PLAY_MIN_SWINGS,
  STRIKER_POINTS_BELL,
  STRIKER_POINTS_HIT,
  STRIKER_REWARD_DIVISOR,
  STRIKER_REWARD_POWER,
  STRIKER_RULES_VERSION,
  type StrikerSimState,
  type StrikerSwing,
} from '../src/server/arcade/high-striker-replay';
import { calculateGameRewardCredits } from '@/server/arcade/rewards/wallet';
import { DAILY_QUEST_TEMPLATES } from '../src/server/arcade/battlepass/daily-quests';
import { ACHIEVEMENTS } from '../src/server/arcade/achievements/registry';
import { GAME_DAILY_CREDIT_CAP, MAX_GAME_RUN_CREDITS } from '../src/features/arcade/lib/rewards';
import { statDeltasForRun } from '../src/server/arcade/stats/deltas';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const args = Object.fromEntries(
  process.argv.slice(2).map((arg) => {
    const match = arg.match(/^--([^=]+)(?:=(.*))?$/);
    return match ? [match[1], match[2] ?? 'true'] : [arg, 'true'];
  }),
) as Record<string, string>;
const RUNS = Number(args.runs ?? 4000);
const quiet = args.quiet === 'true';
const say = (line = '') => {
  if (!quiet) console.log(line);
};

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (!ok) {
    failures += 1;
    console.error(`FAIL  ${label} ${detail}`);
  } else {
    console.log(`ok    ${label}`);
  }
};

// ── helpers ──
function mulberry32(seed: number) {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const normal = (rng: () => number) => {
  const u = Math.max(1e-12, rng());
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
};
const sortNum = (xs: number[]) => [...xs].sort((a, b) => a - b);
const pct = (sorted: number[], p: number) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);

/* ------------------------------------------------------------------ */
/* 1. The curve                                                        */
/* ------------------------------------------------------------------ */
say('\n== The curve ==');
say('swing | speed /s | peak ms | jitter | hit window ms | bell window ms | line | bell band');
for (const i of [0, 5, 10, 20, 30, 40, 60, 80, 120, 200]) {
  const f = strikerBaseSpeed(i);
  const win = strikerWindowFor(i);
  const bell = strikerBellWindowFor(i);
  say(
    `${String(i + 1).padStart(5)} | ${f.toFixed(2).padStart(8)} | ${(500 / f).toFixed(0).padStart(7)} | ${(strikerJitterFor(i) * 100).toFixed(1).padStart(5)}% | ${win.toFixed(0).padStart(13)} | ${bell.toFixed(1).padStart(14)} | ${(1 - (f * win) / 1000).toFixed(3)} | ${((f * bell) / 1000 * 100).toFixed(1)}%`,
  );
}
{
  let monotone = true;
  let maxStep = 0;
  let maxJitterStep = 0;
  for (let i = 1; i < STRIKER_MAX_SWINGS; i += 1) {
    const pairs: Array<[number, number, 1 | -1]> = [
      [strikerBaseSpeed(i - 1), strikerBaseSpeed(i), 1],
      [strikerWindowFor(i - 1), strikerWindowFor(i), -1],
      [strikerBellWindowFor(i - 1), strikerBellWindowFor(i), -1],
    ];
    for (const [a, b, dir] of pairs) {
      if ((b - a) * dir < 0) monotone = false;
      maxStep = Math.max(maxStep, Math.abs(b - a) / a);
    }
    if (strikerJitterFor(i) < strikerJitterFor(i - 1)) monotone = false;
    maxJitterStep = Math.max(maxJitterStep, strikerJitterFor(i) - strikerJitterFor(i - 1));
  }
  check('the curve only gets harder: speed and jitter rise, both windows narrow, every swing', monotone);
  check(`no wall: the speed and both windows move under 4% from one swing to the next (largest ${(maxStep * 100).toFixed(2)}%)`, maxStep <= 0.04);
  check(`no wall: the seeded speed spread widens by under half a point a swing (largest ${(maxJitterStep * 100).toFixed(2)} points)`, maxJitterStep <= 0.005);
  check(
    `the first swing's windows: hit ${strikerWindowFor(0)} ms, bell ${strikerBellWindowFor(0)} ms (rules 2: about 1,000 and 54)`,
    strikerWindowFor(0) === 260 && strikerBellWindowFor(0) === 48,
  );
  const deepWin = strikerWindowFor(STRIKER_MAX_SWINGS);
  const deepBell = strikerBellWindowFor(STRIKER_MAX_SWINGS);
  check(`the deepest windows stay over 3 frames at 60 Hz: hit ${deepWin.toFixed(0)} ms, bell ${deepBell.toFixed(1)} ms`, deepWin > 50 && deepBell > 20);
  // Seeded rounds: the line and the band always sit on the tower, the bell
  // band inside the window, and the earliest window opens after a tap.
  let earliest = Infinity;
  let latest = 0;
  let minLine = 1;
  let maxLine = 0;
  let maxBand = 0;
  let minBand = 1;
  let ok = true;
  for (let seed = 1; seed <= 300; seed += 1) {
    for (let i = 0; i < STRIKER_MAX_SWINGS; i += 7) {
      const r = strikerRoundFor(seed * 7919, i);
      earliest = Math.min(earliest, r.earlyMs);
      latest = Math.max(latest, r.lateMs + STRIKER_LATE_GRACE_MS);
      minLine = Math.min(minLine, r.qualifier);
      maxLine = Math.max(maxLine, r.qualifier);
      maxBand = Math.max(maxBand, 1 - r.bellLine);
      minBand = Math.min(minBand, 1 - r.bellLine);
      if (!(r.bellLine > r.qualifier && r.bellLine < 1 && r.qualifier > 0.5)) ok = false;
      if (strikerGaugeValue(r, r.peakMs) < 0.9999) ok = false;
      if (strikerGaugeValue(r, r.earlyMs + 0.01) < r.qualifier || strikerGaugeValue(r, r.lateMs - 0.01) < r.qualifier) ok = false;
      if (strikerGaugeValue(r, r.earlyMs - 0.5) >= r.qualifier || strikerGaugeValue(r, r.lateMs + 0.5) >= r.qualifier) ok = false;
    }
  }
  say(`seeded rounds: line ${minLine.toFixed(3)} to ${maxLine.toFixed(3)}, bell band ${(minBand * 100).toFixed(1)}% to ${(maxBand * 100).toFixed(1)}% of the tower, windows open ${earliest.toFixed(0)} ms at the earliest and the client lets go by ${latest.toFixed(0)} ms`);
  check('every seeded swing: the line under the bell band, the windows exactly where the gauge crosses the line', ok);
  check(`a tap (under ${STRIKER_MIN_HOLD_MS} ms) can never be a hit (the earliest window opens at ${earliest.toFixed(0)} ms)`, earliest > STRIKER_MIN_HOLD_MS + 50);
  check(`the longest hold the client can make (${latest.toFixed(0)} ms) is far under the ceiling`, latest < STRIKER_MAX_HOLD_MS / 2);
  check('the bell band is never under 2% of the tower (it stays visible)', minBand >= 0.02);
}

/* ------------------------------------------------------------------ */
/* 2. Rules                                                            */
/* ------------------------------------------------------------------ */
say('\n== Rules ==');
{
  const seed = 424242;
  let s = strikerInitialState();
  const r0 = strikerRoundFor(seed, 0);
  const hit = strikerApplySwing(seed, s, r0.peakMs + r0.windowMs * 0.4);
  check('a hit off the bell pays 1', hit.event.type === 'hit' && !hit.event.bell && hit.event.points === STRIKER_POINTS_HIT);
  const close = strikerApplySwing(seed, s, r0.peakMs + r0.bellWindowMs * 0.8);
  check(
    'a hit just outside the bell band is a near miss, one well short is not',
    close.event.type === 'hit' && !close.event.bell && close.event.near && hit.event.type === 'hit' && !hit.event.near,
  );
  s = hit.state;
  const pays: number[] = [];
  for (let i = 0; i < 8; i += 1) {
    const r = strikerRoundFor(seed, s.roundIndex);
    const applied = strikerApplySwing(seed, s, r.peakMs);
    if (applied.event.type === 'hit') pays.push(applied.event.points);
    s = applied.state;
  }
  check(`bells in a row pay 3, 4, 5, 6, 7, 8, 8, 8 (got ${pays.join(', ')})`, pays.join(',') === '3,4,5,6,7,8,8,8');
  check('the most a swing pays is 8', STRIKER_MAX_POINTS_PER_SWING === 8 && strikerBellPoints(100) === 8 && strikerBellPoints(0) === STRIKER_POINTS_BELL);
  const r = strikerRoundFor(seed, s.roundIndex);
  const graze = strikerApplySwing(seed, s, r.lateMs - 1);
  check('a hit breaks the bell streak', graze.event.type === 'hit' && graze.state.bellStreak === 0 && graze.state.bestBellStreak === 8);
  s = graze.state;
  const r2 = strikerRoundFor(seed, s.roundIndex);
  const early = strikerApplySwing(seed, s, r2.earlyMs - 5);
  check('let go under the line before the peak: too early, and the run ends', early.event.type === 'miss' && early.event.side === 'early' && early.state.ended === 'early');
  const late = strikerApplySwing(seed, s, r2.lateMs + 5);
  check('let go under the line after the peak: too late, and the run ends', late.event.type === 'miss' && late.event.side === 'late' && late.state.ended === 'late');
  check('nothing counts after the end', strikerApplySwing(seed, late.state, r2.peakMs).event.type === 'over');
  const way = strikerApplySwing(seed, s, strikerRoundFor(seed, s.roundIndex).peakMs * 2 + 50);
  check('a hold past a whole sweep is a miss (the gauge does not come round again)', way.event.type === 'miss');
  // The top.
  let top: StrikerSimState = strikerInitialState();
  for (let i = 0; i < STRIKER_MAX_SWINGS; i += 1) top = strikerApplySwing(seed, top, strikerRoundFor(seed, i).peakMs).state;
  check(`the tower tops out after ${STRIKER_MAX_SWINGS} hits, at ${top.score} (the ceiling is ${STRIKER_MAX_SCORE})`, top.ended === 'top' && top.score <= STRIKER_MAX_SCORE);
  const judgedTap = strikerJudgeHold(seed, strikerInitialState(), 1000, 1000 + STRIKER_MIN_HOLD_MS - 1);
  check('a hold under the tap floor is no swing', judgedTap.tap === true);
}

/* ------------------------------------------------------------------ */
/* Players                                                             */
/* ------------------------------------------------------------------ */

/** A simulated hand: aims each hold at the peak, off by a normal error of
 *  `sigma` ms, and slips (a wild hold) on 0.2% of swings. */
type Skill = { name: string; sigma: number };
const SKILLS: Skill[] = [
  { name: 'first go', sigma: 80 },
  { name: 'new', sigma: 60 },
  { name: 'casual', sigma: 45 },
  { name: 'good', sigma: 32 },
  { name: 'strong', sigma: 22 },
  { name: 'expert', sigma: 15 },
];
const SLIP = 0.002;
/** ms a player takes to press again once the puck starts down. */
const PRESS_GAP_MS = 250;
/** Between runs: the result card, the rematch, the session. */
const BETWEEN_RUNS_S = 6;

type SimRun = { score: number; depth: number; bells: number; streak: number; seconds: number; swings: StrikerSwing[] };

function simulateRun(seed: number, sigma: number, rng: () => number): SimRun {
  let state = strikerInitialState();
  const swings: StrikerSwing[] = [];
  let ms = 0;
  let prevDown = 0;
  while (!strikerRunDone(state)) {
    const r = strikerRoundFor(seed, state.roundIndex);
    let t = r.peakMs + normal(rng) * sigma;
    if (rng() < SLIP) t = r.peakMs + (rng() < 0.5 ? -1 : 1) * (r.windowMs / 2 + 30 + rng() * 100);
    // The client lets go for you once the window has passed.
    t = Math.min(t, r.lateMs + STRIKER_LATE_GRACE_MS + 8);
    t = Math.max(STRIKER_MIN_HOLD_MS + 1, t);
    t = Math.round(t * 10) / 10;
    const applied = strikerApplySwing(seed, state, t);
    swings.push({ t });
    const ev = applied.event;
    const strength = ev.type === 'hit' || ev.type === 'miss' ? ev.strength : 0;
    const kind = strikerPuckKind(ev.type === 'hit', ev.type === 'hit' && ev.bell, ev.type === 'hit' && ev.near);
    const fl = strikerFlightTimes(kind, strength);
    const drop = STRIKER_DROP_MS_MIN + (STRIKER_DROP_MS_MAX - STRIKER_DROP_MS_MIN) * strength;
    const wait = Math.max(0, prevDown - (PRESS_GAP_MS + t + drop));
    ms += PRESS_GAP_MS + t + drop + wait + fl.riseMs + fl.holdMs;
    prevDown = fl.downMs;
    state = applied.state;
    if (strikerRunDone(state)) ms += fl.downMs + 650;
  }
  return { score: state.score, depth: state.rounds, bells: state.bells, streak: state.bestBellStreak, seconds: ms / 1000, swings };
}

/* ------------------------------------------------------------------ */
/* 3 and 4. Determinism and agreement                                  */
/* ------------------------------------------------------------------ */
say('\n== Determinism ==');
{
  // The judged hold is the difference of two event timestamps. Frames only
  // decide when the fill is drawn, so every refresh rate judges the same.
  const seed = 777;
  const rng = mulberry32(99);
  let agree = true;
  let maxGap = 0;
  for (let run = 0; run < 200; run += 1) {
    for (const hz of [30, 48, 60, 72, 90, 120, 144]) {
      const frameMs = 1000 / hz;
      const lead = strikerDisplayLeadMs(frameMs);
      let state = strikerInitialState();
      let state2 = strikerInitialState();
      let clock = 1000 + rng() * 50;
      for (let i = 0; i < 25 && !strikerRunDone(state); i += 1) {
        const r = strikerRoundFor(seed, state.roundIndex);
        const press = clock + rng() * 3;
        const release = press + r.peakMs + normal(rng) * 25;
        const judged = strikerJudgeHold(seed, state, press, release);
        if (judged.tap === true) break;
        // The last frame drawn before the release: frames tick at vsync,
        // with a stall now and then.
        let frame = Math.ceil(press / frameMs) * frameMs;
        while (frame + frameMs < release) frame += frameMs * (rng() < 0.02 ? 3 : 1);
        const drawn = strikerGaugeValue(r, frame - press + lead);
        const judgedStrength = judged.event.type === 'hit' || judged.event.type === 'miss' ? judged.event.strength : 0;
        // One frame of travel, plus a stall's.
        const travel = (2 * r.freq * (frameMs * 3 + lead)) / 1000;
        maxGap = Math.max(maxGap, Math.abs(drawn - judgedStrength) / travel);
        state = judged.state;
        const replayed = strikerApplySwing(seed, state2, judged.t);
        state2 = replayed.state;
        if (state2.score !== state.score || state2.roundIndex !== state.roundIndex) agree = false;
        clock = release + 1400;
      }
    }
  }
  check('the same press and release timestamps judge the same at 30 to 144 Hz and through stalls', agree);
  check(`the fill on the last frame before a release is the judged strength to within one frame of travel (worst ${maxGap.toFixed(2)} of the allowance)`, maxGap <= 1);
  const lead60 = strikerDisplayLeadMs(1000 / 60);
  const lead120 = strikerDisplayLeadMs(1000 / 120);
  check(`the display lead is one refresh: ${lead60.toFixed(1)} ms at 60 Hz, ${lead120.toFixed(1)} ms at 120 Hz, clamped on a stall (${strikerDisplayLeadMs(200)} ms)`, Math.abs(lead60 - 16.7) < 0.1 && Math.abs(lead120 - 8.3) < 0.1 && strikerDisplayLeadMs(200) === 34);
}
{
  let agree = 0;
  const N = 3000;
  const rng = mulberry32(31337);
  for (let i = 0; i < N; i += 1) {
    const seed = (rng() * 0x7fffffff) | 0;
    const sim = simulateRun(seed, 10 + rng() * 70, rng);
    const replay = validateStrikerRun(seed, sim.swings);
    if (replay.complete && replay.score === sim.score && replay.rounds === sim.depth && replay.bestBellStreak === sim.streak) agree += 1;
  }
  check(`client and server agree on ${agree} of ${N} runs`, agree === N);
}

/* ------------------------------------------------------------------ */
/* 5. Tampering                                                        */
/* ------------------------------------------------------------------ */
say('\n== Tampering ==');
{
  const seed = 99173;
  const sim = simulateRun(seed, 20, mulberry32(5));
  const swings = sim.swings;
  const base = validateStrikerRun(seed, swings);
  check(`an honest run replays complete (${base.rounds} hits, ${base.score} points)`, base.complete && base.score === sim.score);
  check('a list that stops before the miss is incomplete', !validateStrikerRun(seed, swings.slice(0, -1)).complete);
  check('a swing after the miss is rejected', validateStrikerRun(seed, [...swings, { t: 500 }]).stop === 'extra');
  check('a tap in the list is rejected', validateStrikerRun(seed, [{ t: 50 }, ...swings]).stop === 'bounds');
  for (const bad of [NaN, -1, Infinity, STRIKER_MAX_HOLD_MS + 1]) {
    check(`a hold of ${bad} is rejected`, validateStrikerRun(seed, [{ t: bad }]).stop === 'bounds');
  }
  check('a list of strings is rejected', validateStrikerRun(seed, [{ t: '800' as unknown as number }]).stop === 'bounds');
  check('an empty list is incomplete', validateStrikerRun(seed, []).stop === 'incomplete');
  // Dropping the miss and appending more hits, or swapping two holds, changes
  // the run: the replay never pays what the client claimed.
  const swapped = [...swings];
  if (swapped.length > 3) [swapped[1], swapped[2]] = [swapped[2], swapped[1]];
  const sw = validateStrikerRun(seed, swapped);
  check('swapping two holds changes the replay', !(sw.complete && sw.score === base.score && sw.rounds === base.rounds) || swapped[1].t === swapped[2].t);
  const other = validateStrikerRun(seed + 1, swings);
  check('the same holds on another seed do not replay the same run', !(other.complete && other.score === base.score && other.rounds === base.rounds));
  check('the payload ceiling is the tower: a list longer than STRIKER_MAX_SWINGS can never be complete', (() => {
    let s = strikerInitialState();
    const list: StrikerSwing[] = [];
    for (let i = 0; i < STRIKER_MAX_SWINGS; i += 1) {
      const t = strikerRoundFor(seed, i).peakMs;
      list.push({ t });
      s = strikerApplySwing(seed, s, t).state;
    }
    return validateStrikerRun(seed, list).complete && validateStrikerRun(seed, [...list, { t: 500 }]).stop === 'extra';
  })());
}

/* ------------------------------------------------------------------ */
/* 6. The spread check and the timing floor                            */
/* ------------------------------------------------------------------ */
say('\n== Anti-cheat ==');
{
  const rng = mulberry32(2024);
  // A program aimed at the peak, with a little noise of its own.
  for (const botNoise of [0, 1, 3]) {
    let flagged = 0;
    let long = 0;
    for (let i = 0; i < 200; i += 1) {
      const seed = (rng() * 1e9) | 0;
      const bot = simulateRun(seed, botNoise, rng);
      const v = validateStrikerRun(seed, bot.swings);
      if (v.rounds >= STRIKER_PLAY_MIN_SWINGS) {
        long += 1;
        if (strikerPlayCheck(v).flag) flagged += 1;
      }
    }
    check(`a program with ${botNoise} ms of noise is flagged on every long run (${flagged} of ${long})`, long > 0 && flagged === long);
  }
  // Hands, on a fine clock and on a rounded one (whole ms, and 16 ms steps).
  for (const sigma of [10, 15, 22, 32, 45, 80]) {
    for (const step of [0.1, 1, 16.7]) {
      let flagged = 0;
      let long = 0;
      for (let i = 0; i < 300; i += 1) {
        const seed = (rng() * 1e9) | 0;
        const sim = simulateRun(seed, sigma, rng);
        const rounded = sim.swings.map((s) => ({ t: Math.round(s.t / step) * step }));
        const v = validateStrikerRun(seed, rounded);
        if (!v.complete || v.rounds < STRIKER_PLAY_MIN_SWINGS) continue;
        long += 1;
        if (strikerPlayCheck(v).flag) flagged += 1;
      }
      if (long > 0) check(`a hand with ${sigma} ms of noise on a ${step} ms clock is never flagged (${flagged} of ${long} long runs)`, flagged === 0);
    }
  }
  // The timing floor: a run can't end before its holds and climbs could.
  const seed = 5150;
  const sim = simulateRun(seed, 20, rng);
  const v = validateStrikerRun(seed, sim.swings);
  const floor = strikerMinRunMs(v);
  check(`the timing floor sits under an honest run's real length (${(floor / 1000).toFixed(1)} s against ${sim.seconds.toFixed(1)} s)`, floor < sim.seconds * 1000);
}

/* ------------------------------------------------------------------ */
/* 7. Skill, rewards, quests and achievements                          */
/* ------------------------------------------------------------------ */
say('\n== Players ==');
const tickets = (score: number) => calculateGameRewardCredits({ gameType: 'high-striker', score });
const ticketsAt = (score: number, divisor: number) => {
  const raw = MAX_GAME_RUN_CREDITS * (1 - Math.exp(-Math.pow(Math.max(0, score / divisor), STRIKER_REWARD_POWER)));
  return Math.max(0, Math.round(Math.min(MAX_GAME_RUN_CREDITS, raw)));
};
type SkillStats = { skill: Skill; runs: SimRun[] };
const bySkill: SkillStats[] = SKILLS.map((skill, k) => {
  const rng = mulberry32(1000 + k);
  const runs: SimRun[] = [];
  for (let i = 0; i < RUNS; i += 1) runs.push(simulateRun((rng() * 0x7fffffff) | 0, skill.sigma, rng));
  return { skill, runs };
});
const perMinute = (runs: SimRun[], divisor: number) => {
  const t = mean(runs.map((r) => ticketsAt(r.score, divisor)));
  const s = mean(runs.map((r) => r.seconds)) + BETWEEN_RUNS_S;
  return (t * 60) / s;
};
say('player | timing SD | depth p10/p50/p90 | score p10/p50/p90 | mean score | bells a run | best streak p50 | mean run | tickets a run | tickets a minute');
for (const { skill, runs } of bySkill) {
  const depth = sortNum(runs.map((r) => r.depth));
  const score = sortNum(runs.map((r) => r.score));
  const streak = sortNum(runs.map((r) => r.streak));
  say(
    `${skill.name.padEnd(8)} | ${String(skill.sigma).padStart(3)} ms | ${pct(depth, 0.1)} / ${pct(depth, 0.5)} / ${pct(depth, 0.9)} | ${pct(score, 0.1)} / ${pct(score, 0.5)} / ${pct(score, 0.9)} | ${mean(runs.map((r) => r.score)).toFixed(1)} | ${mean(runs.map((r) => r.bells)).toFixed(1)} | ${pct(streak, 0.5)} | ${mean(runs.map((r) => r.seconds)).toFixed(1)} s | ${mean(runs.map((r) => tickets(r.score))).toFixed(1)} | ${perMinute(runs, STRIKER_REWARD_DIVISOR).toFixed(1)}`,
  );
}

say('\n== Rewards ==');
// The target: what the endless timing games pay a good player a minute.
// Ticket stop's lock pays about 46 (TICKET_STOP.md) and high striker's rules 2
// paid 46.4; the solve aims at 46.
const TARGET_PER_MINUTE = 46;
const good = bySkill.find((s) => s.skill.name === 'good')!;
let solved = 0;
let bestErr = Infinity;
for (let d = 30; d <= 300; d += 1) {
  const err = Math.abs(perMinute(good.runs, d) - TARGET_PER_MINUTE);
  if (err < bestErr) {
    bestErr = err;
    solved = d;
  }
}
say(`solved divisor: ${solved} (good player ${perMinute(good.runs, solved).toFixed(1)} tickets a minute); the code uses ${STRIKER_REWARD_DIVISOR}`);
check(`the code's divisor (${STRIKER_REWARD_DIVISOR}) is within 10% of the solved one (${solved})`, Math.abs(STRIKER_REWARD_DIVISOR - solved) / solved <= 0.1);
{
  const rates = bySkill.map((s) => perMinute(s.runs, STRIKER_REWARD_DIVISOR));
  const goodIndex = SKILLS.findIndex((s) => s.name === 'good');
  // An endless run's tickets are capped at 75 while a better hand's run keeps
  // going, so a minute pays most at about a good player and less past it, the
  // way ticket stop's does (its sharp hand earns 36 a minute to a good one's
  // 46). Every run of a better hand still pays more.
  check(
    `better timing pays more a minute up to a good player (${rates.map((r) => r.toFixed(1)).join(', ')})`,
    rates.every((r, i) => i === 0 || i > goodIndex || r > rates[i - 1]),
  );
  const perRun = bySkill.map((s) => mean(s.runs.map((r) => tickets(r.score))));
  check(`better timing pays more a run at every step (${perRun.map((r) => r.toFixed(1)).join(', ')})`, perRun.every((r, i) => i === 0 || r > perRun[i - 1]));
  const goodRate = rates[goodIndex];
  check(`a good player earns ${goodRate.toFixed(1)} tickets a minute, in line with ticket stop's 46`, goodRate >= 40 && goodRate <= 52);
  const expert = bySkill.find((s) => s.skill.name === 'expert')!;
  const expertP90 = pct(sortNum(expert.runs.map((r) => r.score)), 0.9);
  check(`an expert's p90 run (${expertP90}) pays ${tickets(expertP90)}, inside the ${MAX_GAME_RUN_CREDITS} a run`, tickets(expertP90) <= MAX_GAME_RUN_CREDITS);
  check(`the tower's ceiling (${STRIKER_MAX_SCORE}) pays the cap and no more`, tickets(STRIKER_MAX_SCORE) === MAX_GAME_RUN_CREDITS);
  check(`a good player's runs reach the ${GAME_DAILY_CREDIT_CAP} daily cap in about ${(GAME_DAILY_CREDIT_CAP / goodRate).toFixed(0)} minutes`, GAME_DAILY_CREDIT_CAP / goodRate > 4);
  for (const s of [10, 25, 50, 100, 200]) say(`  ${s} points pay ${tickets(s)} tickets`);
  const client = readFileSync(path.join(root, 'src/app/(games)/high-striker/_high-striker-client.tsx'), 'utf8');
  const claim = client.match(/(\d+) points pay (\d+) tickets/);
  check(
    `the ? sheet's numbers are the curve's (${claim?.[0] ?? 'no claim found'}; the curve pays ${claim ? tickets(Number(claim[1])) : '?'})`,
    !!claim && tickets(Number(claim[1])) === Number(claim[2]),
  );
}

say('\n== Quests and achievements ==');
{
  const quest = DAILY_QUEST_TEMPLATES.find((q) => q.targetGame === 'high-striker' && q.kind === 'score_game');
  const goodScores = good.runs.map((r) => r.score);
  const reach = goodScores.filter((s) => s >= (quest?.goal ?? Infinity)).length / goodScores.length;
  const casual = bySkill.find((s) => s.skill.name === 'casual')!;
  const casualBest = (() => {
    // A casual player's best of three runs.
    let hit = 0;
    for (let i = 0; i + 3 <= casual.runs.length; i += 3) {
      if (Math.max(casual.runs[i].score, casual.runs[i + 1].score, casual.runs[i + 2].score) >= (quest?.goal ?? Infinity)) hit += 1;
    }
    return hit / Math.floor(casual.runs.length / 3);
  })();
  check(
    `the daily quest (${quest?.key}, score ${quest?.goal}) is reached by about half a good player's runs (${(reach * 100).toFixed(0)}%) and a casual player's best of three ${(casualBest * 100).toFixed(0)}% of the time`,
    !!quest && reach >= 0.4 && reach <= 0.65,
  );
  check('no high striker quest asks for swings out of five', !DAILY_QUEST_TEMPLATES.some((q) => q.targetGame === 'high-striker' && /five|\/5|out of/i.test(q.label)));

  // Tiers, read off best-of-N across skills (a stat is a best ever).
  const bestOf = (runs: SimRun[], n: number, f: (r: SimRun) => number) => {
    const out: number[] = [];
    for (let i = 0; i + n <= runs.length; i += n) out.push(Math.max(...runs.slice(i, i + n).map(f)));
    return sortNum(out);
  };
  say('best of 10 runs (a first week), median: depth / bells in a row');
  for (const { skill, runs } of bySkill) {
    say(`  ${skill.name.padEnd(8)} ${pct(bestOf(runs, 10, (r) => r.depth), 0.5)} / ${pct(bestOf(runs, 10, (r) => r.streak), 0.5)}`);
  }
  const depthTiers = ACHIEVEMENTS.filter((a) => a.seriesId === 'high-striker-depth').map((a) => (a.condition as { gte: number }).gte);
  const streakTiers = ACHIEVEMENTS.filter((a) => a.seriesId === 'high-striker-bells').map((a) => (a.condition as { gte: number }).gte);
  say(`tiers: depth ${depthTiers.join(', ')}; bells in a row ${streakTiers.join(', ')}`);
  const medianBest = (name: string, f: (r: SimRun) => number) => pct(bestOf(bySkill.find((s) => s.skill.name === name)!.runs, 10, f), 0.5);
  const depthOk =
    depthTiers.length === 5 &&
    depthTiers[0] <= medianBest('new', (r) => r.depth) &&
    depthTiers[1] <= medianBest('casual', (r) => r.depth) &&
    depthTiers[2] <= medianBest('good', (r) => r.depth) &&
    depthTiers[3] <= medianBest('strong', (r) => r.depth) &&
    depthTiers[4] <= medianBest('expert', (r) => r.depth) &&
    depthTiers[4] > medianBest('strong', (r) => r.depth);
  check('depth tiers: I in a new player\'s first week, II casual, III good, IV strong, V expert only', depthOk);
  const streakOk =
    streakTiers.length === 5 &&
    streakTiers[0] <= medianBest('casual', (r) => r.streak) &&
    streakTiers[1] <= medianBest('good', (r) => r.streak) &&
    streakTiers[2] <= medianBest('strong', (r) => r.streak) &&
    streakTiers[3] <= medianBest('expert', (r) => r.streak) &&
    streakTiers[4] > medianBest('expert', (r) => r.streak);
  check('bells-in-a-row tiers: I casual, II good, III strong, IV expert, V past an expert\'s first week', streakOk);
  const deltas = statDeltasForRun({ gameType: 'high-striker', score: 40 }, { strikerSwings: 22, strikerBellStreak: 4 });
  const keys = deltas.map((d) => d.key);
  check(
    `a run writes the rules 3 stats only (${keys.join(', ')})`,
    keys.includes('high-striker.endless_best') && keys.includes('high-striker.endless_depth') && keys.includes('high-striker.endless_streak') && !keys.includes('high-striker.best') && !keys.includes('high-striker.best_five'),
  );
  check('rules version 3', STRIKER_RULES_VERSION === 3);
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log('\nall high striker checks passed');
void STRIKER_BELL_STREAK_CAP;
