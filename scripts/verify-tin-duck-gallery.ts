/**
 * Tin duck gallery verifier.
 *
 *
 *  1. The schedule is a pure function of the seed.
 *  2. A ray through a target at time t hits it, and a ray beside it misses.
 *  3. Rows score 1, 2 and 3; plates twice and the bullseye three times; the
 *     gold duck 10. A hit target is dead for its down time, then live again.
 *  4. Magazine, reload and cadence.
 *  5. validateGalleryRun recomputes what a client scorer accumulated.
 *  6. Tamper rejection: a claimed score the shots don't earn, shots after the
 *     round, under the pump's cadence, past the magazine, the wrong seed.
 *  7. Score by skill, rules 1 against rules 2, and the reward curve: the
 *     divisor is solved so a good player earns about what a good rules 1 player
 *     did per minute of play, and the code's divisor is checked against it.
 *     The achievement tiers and the daily quest come from the same runs.
 *
 *   npx tsx scripts/verify-tin-duck-gallery.ts [--runs=1500] [--quiet]
 *
 * Exits non-zero on any failed assertion.
 */
import {
  deriveTinDuckSchedule,
  createTinDuckScorer,
  tinDuckProject,
  tinPopCenterY,
  TIN_DUCK_ROUND_MS,
} from '../src/server/arcade/tin-duck-replay';
import { calculateGameRewardCredits } from '../src/server/arcade/rewards/wallet';
import { DAILY_QUEST_TEMPLATES } from '../src/server/arcade/battlepass/daily-quests';
import { ACHIEVEMENTS } from '../src/server/arcade/achievements/registry';
import { MAX_GAME_RUN_CREDITS } from '../src/features/arcade/lib/rewards';
import {
  GALLERY_BONUS,
  GALLERY_BONUS_VALUE,
  GALLERY_CAMERA,
  GALLERY_HIT_HALF_WIDTH,
  GALLERY_MAG_SIZE,
  GALLERY_MAX_RUN_SCORE,
  GALLERY_MAX_SHOTS,
  GALLERY_MIN_SHOT_INTERVAL_MS,
  GALLERY_REWARD_DIVISOR,
  GALLERY_RELOAD_MS,
  GALLERY_ROUND_MS,
  GALLERY_ROWS,
  GALLERY_TARGET_LIFT,
  createGalleryScorer,
  deriveGallerySchedule,
  galleryBonusX,
  galleryItemKind,
  galleryItemLap,
  galleryItemX,
  validateGalleryRun,
  type GalleryShot,
} from '../src/server/arcade/tin-duck-gallery';

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (!ok) {
    failures += 1;
    console.error(`FAIL  ${label} ${detail}`);
  } else {
    console.log(`ok    ${label}`);
  }
};

/** Slopes of the ray from the camera through a world point. */
const slopesTo = (x: number, y: number, z: number) => {
  const reach = GALLERY_CAMERA.z - z;
  return { x: (x - GALLERY_CAMERA.x) / reach, y: (y - GALLERY_CAMERA.y) / reach };
};

// ── 1. Determinism ──
const a = deriveGallerySchedule(1234);
const b = deriveGallerySchedule(1234);
const c = deriveGallerySchedule(1235);
check('same seed, same schedule', JSON.stringify(a) === JSON.stringify(b));
check('another seed differs', JSON.stringify(a) !== JSON.stringify(c));
check(
  'bonus starts between 8 s and 20 s',
  a.bonus.startMs >= 8_000 && a.bonus.startMs <= 20_000,
  String(a.bonus.startMs),
);

// ── 2 and 3. Geometry and values ──
/** The first visible item of a row at time t, or null. */
const visible = (schedule: ReturnType<typeof deriveGallerySchedule>, row: number, t: number, kind?: 'duck' | 'plate') => {
  for (let i = 0; i < GALLERY_ROWS[row]!.count; i += 1) {
    const x = galleryItemX(schedule, row, i, t);
    if (Math.abs(x) > GALLERY_HIT_HALF_WIDTH - 0.5) continue;
    if (kind && galleryItemKind(schedule, row, i) !== kind) continue;
    return { index: i, x };
  }
  return null;
};

for (let r = 0; r < GALLERY_ROWS.length; r += 1) {
  const row = GALLERY_ROWS[r]!;
  let t = 1_000;
  let duck = visible(a, r, t, 'duck');
  while (!duck && t < 20_000) {
    t += 250;
    duck = visible(a, r, t, 'duck');
  }
  check(`row ${r}: a duck is on the chain`, duck !== null);
  if (!duck) continue;
  const s = slopesTo(duck.x, row.y + GALLERY_TARGET_LIFT, row.z);
  const scorer = createGalleryScorer(a);
  const out = scorer.shoot(s.x, s.y, t);
  check(`row ${r}: a centred shot hits for ${row.value}`, out.type === 'hit' && out.kind === 'duck' && out.value === row.value);
  const again = scorer.shoot(s.x, s.y, t + GALLERY_MIN_SHOT_INTERVAL_MS + 1);
  check(`row ${r}: the same duck, still down, is a miss`, again.type === 'miss');
  const offset = slopesTo(duck.x + 0.9, row.y + GALLERY_TARGET_LIFT, row.z);
  const missScorer = createGalleryScorer(a);
  check(`row ${r}: a shot beside it misses`, missScorer.shoot(offset.x, offset.y, t).type === 'miss');
}

{
  // Plates and the bullseye, on row 1.
  const r = 1;
  const row = GALLERY_ROWS[r]!;
  let t = 1_000;
  let plate = visible(a, r, t, 'plate');
  while (!plate && t < 30_000) {
    t += 200;
    plate = visible(a, r, t, 'plate');
  }
  check('a plate is on row 1 at some time', plate !== null);
  if (plate) {
    const cy = row.y + GALLERY_TARGET_LIFT;
    const bull = slopesTo(plate.x, cy, row.z);
    const ring = slopesTo(plate.x + 0.4, cy, row.z);
    const s1 = createGalleryScorer(a).shoot(bull.x, bull.y, t);
    const s2 = createGalleryScorer(a).shoot(ring.x, ring.y, t);
    check('bullseye pays three times the row', s1.type === 'hit' && s1.kind === 'bullseye' && s1.value === row.value * 3);
    check('the plate pays twice the row', s2.type === 'hit' && s2.kind === 'plate' && s2.value === row.value * 2);
    const sc = createGalleryScorer(a);
    sc.shoot(bull.x, bull.y, t);
      const reHit = sc.shoot(slopesTo(galleryItemX(a, r, plate.index, t + 300), cy, row.z).x, bull.y, t + 300);
    check('a plate that has been hit is dead until it laps', reHit.type === 'miss');
    // ... and live again a lap later.
    const row1 = GALLERY_ROWS[r]!;
    const lapMs = ((row1.spacing * row1.count) / row1.speed) * 1000;
    let tt = t + 300;
    while (galleryItemLap(a, r, plate.index, tt) === galleryItemLap(a, r, plate.index, t) && tt < t + lapMs + 500) tt += 100;
    let xx = galleryItemX(a, r, plate.index, tt);
    while (Math.abs(xx) > GALLERY_HIT_HALF_WIDTH - 0.5 && tt < t + 2 * lapMs) {
      tt += 100;
      xx = galleryItemX(a, r, plate.index, tt);
    }
    const back = slopesTo(xx, cy, row1.z);
    const again = sc.shoot(back.x, back.y, tt);
    check('and live again once it has come round', again.type === 'hit' && again.kind === 'bullseye', JSON.stringify(again).slice(0, 80));
  }
}

{
  // The gold duck.
  const start = a.bonus.startMs;
  let t = start + 400;
  let x = galleryBonusX(a, t);
  while (x !== null && Math.abs(x) > GALLERY_HIT_HALF_WIDTH) {
    t += 100;
    x = galleryBonusX(a, t);
  }
  check('the gold duck crosses the rail', x !== null);
  if (x !== null) {
    const s = slopesTo(x, GALLERY_BONUS.y + GALLERY_TARGET_LIFT, GALLERY_BONUS.z);
    const sc = createGalleryScorer(a);
    const out = sc.shoot(s.x, s.y, t);
    check('the gold duck pays 10', out.type === 'hit' && out.kind === 'bonus' && out.value === GALLERY_BONUS_VALUE);
    check('the gold duck can be hit once', sc.shoot(s.x, s.y, t + 400).type === 'miss');
  }
  check('no gold duck before its start', galleryBonusX(a, start - 1_000) === null);
}

// ── 4. Magazine, reload, cadence ──
{
  const sc = createGalleryScorer(a);
  const sky = { x: 0, y: 1.9 };
  let t = 100;
  const outcomes: string[] = [];
  for (let i = 0; i < GALLERY_MAG_SIZE; i += 1) {
    outcomes.push(sc.shoot(sky.x, sky.y, t).type);
    t += GALLERY_MIN_SHOT_INTERVAL_MS + 5;
  }
  check('six corks fire', outcomes.every((o) => o === 'miss'));
  check('the seventh is dead while reloading', sc.shoot(sky.x, sky.y, t).type === 'reload-dead');
  check('reload is announced', sc.reloadFraction(t) > 0 && sc.displayAmmo(t) === 0);
  const afterReload = 100 + (GALLERY_MAG_SIZE - 1) * (GALLERY_MIN_SHOT_INTERVAL_MS + 5) + GALLERY_RELOAD_MS + 20;
  check('then it fires again', sc.shoot(sky.x, sky.y, afterReload).type === 'miss');
  const quick = createGalleryScorer(a);
  quick.shoot(0, 1.9, 500);
  check('under the cadence floor is ignored', quick.shoot(0, 1.9, 500 + GALLERY_MIN_SHOT_INTERVAL_MS - 1).type === 'ignored');
  check('after the round, nothing scores', quick.shoot(0, 1.9, GALLERY_ROUND_MS + 1).type === 'ignored');
}

// ── 5. The validator agrees with a client scorer ──
type Skill = { name: string; react: number; spread: number; every?: number };
/**
 * A player model, the same for both rules. `react` is how long a target has to
 * be in play before the player is on it (ms); `spread` is the aim error as a
 * fraction of a target's radius (a normal error on each axis). A player picks
 * the best target they can see, shoots, and takes 250 ms plus 0.9 reaction
 * times for the next one. The bot is a machine, for the upper bound.
 */
const SKILLS: Skill[] = [
  { name: 'casual', react: 450, spread: 1.0 },
  { name: 'ok', react: 340, spread: 0.8 },
  { name: 'good', react: 260, spread: 0.6 },
  { name: 'strong', react: 210, spread: 0.4 },
  { name: 'expert', react: 175, spread: 0.25 },
  { name: 'bot', react: 0, spread: 0.05 },
  // The ceiling: a machine firing at the pump's floor with no aim error.
  { name: 'machine', react: 0, spread: 0.02, every: 172 },
];
const GOOD = SKILLS.find((k) => k.name === 'good')!;

const mulberry32 = (seed: number) => {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};
const normal = (rng: () => number) => {
  const u = Math.max(1e-9, rng());
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
};
const pct = (sorted: number[], p: number) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]!;
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);

/** Rules 2: one run, event by event. */
function modernRun(seed: number, skill: Skill, rng: () => number) {
  const schedule = deriveGallerySchedule(seed);
  const scorer = createGalleryScorer(schedule);
  const shots: GalleryShot[] = [];
  const dMid = GALLERY_CAMERA.z - GALLERY_ROWS[1]!.z;
  let t = 500 + rng() * 300;
  while (t < GALLERY_ROUND_MS) {
    let best: { x: number; y: number; z: number; v: number; r: number } | null = null;
    GALLERY_ROWS.forEach((row, r) => {
      const half = 3.0 * ((GALLERY_CAMERA.z - row.z) / dMid);
      for (let i = 0; i < row.count; i += 1) {
        const x = galleryItemX(schedule, r, i, t);
        if (Math.abs(x) > half * 0.95) continue;
        // On screen long enough to be on it.
        if (Math.abs(galleryItemX(schedule, r, i, t - skill.react)) > half) continue;
        const last = scorer.lastHitAt(r, i);
        const kind = galleryItemKind(schedule, r, i);
        if (last !== null && kind === 'plate' && galleryItemLap(schedule, r, i, t) === galleryItemLap(schedule, r, i, last)) continue;
        if (last !== null && kind === 'duck' && t - last < 1350) continue;
        const v = row.value * (kind === 'plate' ? 2.4 : 1) + rng() * 0.8;
        if (!best || v > best.v) best = { x, y: row.y + GALLERY_TARGET_LIFT, z: row.z, v, r: kind === 'plate' ? 0.56 : 0.5 };
      }
    });
    const bx = galleryBonusX(schedule, t);
    const bonusDone = scorer.bonusHit;
    if (bx !== null && !bonusDone && Math.abs(bx) < 3.2 && (skill.react === 0 || Math.abs(galleryBonusX(schedule, t - skill.react) ?? 99) < 3.4)) {
      best = { x: bx, y: GALLERY_BONUS.y + GALLERY_TARGET_LIFT, z: GALLERY_BONUS.z, v: 99, r: GALLERY_BONUS.radius };
    }
    if (!best) {
      t += 40;
      continue;
    }
    // Aim where it will be when the cork lands, off by the player's timing and aim error.
    const row = best.z === GALLERY_BONUS.z ? null : GALLERY_ROWS.findIndex((rr) => rr.z === best!.z);
    const speed = row === null ? GALLERY_BONUS.speed * schedule.bonus.dir : GALLERY_ROWS[row]!.dir * GALLERY_ROWS[row]!.speed;
    const lagErr = normal(rng) * skill.react * 0.3;
    const ax = best.x + (speed * (60 + lagErr)) / 1000 + normal(rng) * skill.spread * best.r;
    const ay = best.y + normal(rng) * skill.spread * best.r;
    const reach = GALLERY_CAMERA.z - best.z;
    const sx = (ax - GALLERY_CAMERA.x) / reach;
    const sy = (ay - GALLERY_CAMERA.y) / reach;
    scorer.shoot(sx, sy, Math.floor(t));
    shots.push({ x: sx, y: sy, t: Math.floor(t) });
    t += skill.every ?? (250 + skill.react * 0.9) * (0.85 + rng() * 0.3);
  }
  return { score: scorer.score, hits: scorer.hits, bullseyes: scorer.bullseyes, bonus: scorer.bonusHit, shots, schedule };
}

{
  const run = modernRun(777, GOOD, mulberry32(5));
  const result = validateGalleryRun(777, run.shots, GALLERY_ROUND_MS);
  check('validateGalleryRun equals the client scorer', result.score === run.score && result.hits === run.hits, `${result.score} ${run.score}`);
  check('shot order in the payload does not matter', validateGalleryRun(777, [...run.shots].reverse(), GALLERY_ROUND_MS).score === run.score);
  check('a slope outside any camera is dropped', validateGalleryRun(777, [{ x: 9, y: 0, t: 1000 }], GALLERY_ROUND_MS).dropped === 1);

  // ── 6. Tamper rejection ──
  const honest = validateGalleryRun(777, run.shots, GALLERY_ROUND_MS).score;
  check('the honest run scores something', honest > 10, String(honest));
  // The route rejects a claim that differs from the replay: so the replay must
  // not move when the payload is tampered in ways that would raise it.
  const other = validateGalleryRun(778, run.shots, GALLERY_ROUND_MS).score;
  check('another seed scores differently (the seed binds the run)', other !== honest, `${other} against ${honest}`);
  const retimed = run.shots.map((s) => ({ ...s, t: s.t + 7_000 }));
  check('shifting every shot 7 s later changes the score', validateGalleryRun(777, retimed, GALLERY_ROUND_MS).score !== honest);
  const doubled = run.shots.flatMap((s) => [s, { ...s, t: s.t + 1 }]);
  check('a second shot a millisecond behind each one adds nothing', validateGalleryRun(777, doubled, GALLERY_ROUND_MS).score === honest);
  const late = [...run.shots, ...run.shots.slice(0, 20).map((s, i) => ({ ...s, t: GALLERY_ROUND_MS + 400 + i * 200 }))];
  check('shots after the round add nothing', validateGalleryRun(777, late, GALLERY_ROUND_MS).score === honest);
  const flood = Array.from({ length: 900 }, (_, i) => ({ x: 0, y: 0, t: 100 + i * 30 }));
  check('a flood of shots is cut at the inspection ceiling', validateGalleryRun(777, flood, GALLERY_ROUND_MS).shotsFired <= GALLERY_MAX_SHOTS);
  const sprayShots: GalleryShot[] = [];
  for (let t = 100; t < GALLERY_ROUND_MS; t += GALLERY_MIN_SHOT_INTERVAL_MS + 1) {
    for (const [x, y] of [[0.1, 0.0], [-0.1, 0.1], [0.2, -0.1], [0, -0.2]] as const) sprayShots.push({ x: x * ((t / 170) % 3), y, t });
  }
  const spray = validateGalleryRun(777, sprayShots, GALLERY_ROUND_MS);
  check('a spray at the pump floor stays under the plausible score', spray.score <= GALLERY_MAX_RUN_SCORE, String(spray.score));
  check('the magazine caps the shots a second can hold', spray.shotsFired <= 90, String(spray.shotsFired));
}

// ── 7. Score by skill, and the reward curve ──
const RUNS = Number((process.argv.find((a) => a.startsWith('--runs=')) ?? '--runs=1500').split('=')[1]);
const quiet = process.argv.includes('--quiet');
const say = (line: string) => {
  if (!quiet) console.log(line);
};
const OVERHEAD_S = 6;
const curve = (score: number, divisor: number) => {
  const raw = MAX_GAME_RUN_CREDITS * (1 - Math.exp(-Math.pow(Math.max(0, score / divisor), 1.15)));
  return Math.max(0, Math.floor(Math.min(MAX_GAME_RUN_CREDITS, raw)));
};

/** Rules 1: the popup range, one run, a player of the same model. */
function legacyRun(seed: number, skill: Skill, rng: () => number) {
  const schedule = deriveTinDuckSchedule(seed);
  const scorer = createTinDuckScorer(schedule);
  let t = 500 + rng() * 300;
  while (t < TIN_DUCK_ROUND_MS) {
    let best: (typeof schedule.pops)[number] | null = null;
    for (const p of schedule.pops) {
      if (t < p.upStart + skill.react || t > p.upEnd - 30) continue;
      if (scorer.isPopUsed(p.id)) continue;
      if (!best || p.value > best.value) best = p;
    }
    if (!best) {
      t += 40;
      continue;
    }
    const proj = tinDuckProject(best.x, tinPopCenterY(best, t), best.z, best.r);
    scorer.shoot(
      proj.sx + normal(rng) * skill.spread * proj.sr,
      proj.sy + normal(rng) * skill.spread * proj.sr,
      Math.floor(t),
    );
    t += skill.every ?? (140 + skill.react * 0.3) * (0.85 + rng() * 0.3);
  }
  return { score: scorer.score };
}

const legacyBySkill = new Map<string, number[]>();
for (const skill of SKILLS) {
  const rng = mulberry32(900 + skill.react);
  legacyBySkill.set(
    skill.name,
    Array.from({ length: Math.min(RUNS, 400) }, () => legacyRun(Math.floor(rng() * 0x7fffffff), skill, rng).score),
  );
}
const LEGACY_DIVISOR = 750;
const legacyGoodRuns = legacyBySkill.get('good')!;
const legacyTickets = mean(legacyGoodRuns.map((sc) => curve(sc, LEGACY_DIVISOR)));
const legacyMinutes = (TIN_DUCK_ROUND_MS / 1000 + OVERHEAD_S) / 60;
const legacyRate = legacyTickets / legacyMinutes;
say(`rules 1, a good player (reaction ${GOOD.react} ms, aim error ${GOOD.spread} of a target's radius): mean run ${mean(legacyGoodRuns).toFixed(0)} points`);
say(`   pays ${legacyTickets.toFixed(1)} tickets a run at divisor ${LEGACY_DIVISOR}, in ${(legacyMinutes * 60).toFixed(0)} s with ${OVERHEAD_S} s between runs: ${legacyRate.toFixed(1)} tickets a minute`);

const modernBySkill = new Map<string, ReturnType<typeof modernRun>[]>();
for (const skill of SKILLS) {
  const rng = mulberry32(50_000 + skill.react);
  modernBySkill.set(
    skill.name,
    Array.from({ length: RUNS }, () => modernRun(Math.floor(rng() * 0x7fffffff), skill, rng)),
  );
}
const modernMinutes = (GALLERY_ROUND_MS / 1000 + OVERHEAD_S) / 60;
const rateFor = (runs: { score: number }[], divisor: number) => mean(runs.map((r) => curve(r.score, divisor))) / modernMinutes;
const goodModern = modernBySkill.get('good')!;
let solved = 1;
{
  let bestGap = Infinity;
  for (let d = 5; d <= 400; d += 1) {
    const gap = Math.abs(rateFor(goodModern, d) - legacyRate);
    if (gap < bestGap) {
      bestGap = gap;
      solved = d;
    }
  }
}
say(`rules 2, the same good player: mean run ${mean(goodModern.map((r) => r.score)).toFixed(1)} points`);
say(`   the divisor whose rate is closest to ${legacyRate.toFixed(1)} a minute is ${solved}: ${rateFor(goodModern, solved).toFixed(1)} a minute, ${mean(goodModern.map((r) => curve(r.score, solved))).toFixed(1)} tickets a run, in ${(modernMinutes * 60).toFixed(0)} s`);
for (const overhead of [3, 10]) {
  const lm = (TIN_DUCK_ROUND_MS / 1000 + overhead) / 60;
  const mm = (GALLERY_ROUND_MS / 1000 + overhead) / 60;
  const target = legacyTickets / lm;
  let bestD = 1;
  let bestGap = Infinity;
  for (let d = 5; d <= 400; d += 1) {
    const gap = Math.abs(mean(goodModern.map((r) => curve(r.score, d))) / mm - target);
    if (gap < bestGap) {
      bestGap = gap;
      bestD = d;
    }
  }
  say(`   with ${overhead} s between runs instead of ${OVERHEAD_S}: rules 1 pays ${target.toFixed(1)} a minute and the divisor is ${bestD}`);
}

say(`\nscore by skill, rules 2 (${RUNS.toLocaleString()} runs each; tickets = 75 x (1 - exp(-(score / ${GALLERY_REWARD_DIVISOR})^1.15)))`);
say('skill     react aim   mean   p10  p50  p90  max  bullseyes  gold  tickets/run  tickets/min  ratio to rules-1 good');
for (const skill of SKILLS) {
  const runs = modernBySkill.get(skill.name)!;
  const scores = runs.map((r) => r.score).sort((a, b) => a - b);
  say(
    `${skill.name.padEnd(9)} ${String(skill.react).padStart(4)} ${skill.spread.toFixed(2)} ${mean(scores).toFixed(1).padStart(6)} ${String(pct(scores, 0.1)).padStart(4)} ${String(pct(scores, 0.5)).padStart(4)} ${String(pct(scores, 0.9)).padStart(4)} ${String(scores[scores.length - 1]).padStart(4)} ` +
      `${mean(runs.map((r) => r.bullseyes)).toFixed(2).padStart(9)}  ${(mean(runs.map((r) => (r.bonus ? 1 : 0))) * 100).toFixed(0).padStart(3)}%  ${mean(scores.map((sc) => curve(sc, GALLERY_REWARD_DIVISOR))).toFixed(1).padStart(10)}  ${rateFor(runs, GALLERY_REWARD_DIVISOR).toFixed(1).padStart(11)}   ${(rateFor(runs, GALLERY_REWARD_DIVISOR) / legacyRate).toFixed(2)}`,
  );
}
say('\nrules 1 for comparison (same players):');
for (const skill of SKILLS) {
  const scores = [...legacyBySkill.get(skill.name)!].sort((a, b) => a - b);
  const tickets = mean(scores.map((sc) => curve(sc, LEGACY_DIVISOR)));
  say(`${skill.name.padEnd(9)} ${String(skill.react).padStart(4)} ${skill.spread.toFixed(2)} mean ${mean(scores).toFixed(0).padStart(5)} p50 ${String(pct(scores, 0.5)).padStart(4)} p90 ${String(pct(scores, 0.9)).padStart(4)}  ${tickets.toFixed(1).padStart(5)} tickets/run  ${(tickets / legacyMinutes).toFixed(1).padStart(5)} tickets/min`);
}

check(`the code's divisor (${GALLERY_REWARD_DIVISOR}) is the solved one (${solved}) or next to it`, Math.abs(GALLERY_REWARD_DIVISOR - solved) <= 2);
const goodRate = rateFor(goodModern, GALLERY_REWARD_DIVISOR);
check(`a good run pays within 10% of rules 1 per minute (${goodRate.toFixed(1)} against ${legacyRate.toFixed(1)})`, Math.abs(goodRate / legacyRate - 1) <= 0.1);
check(
  'wallet.ts pays what the curve says',
  [0, 1, 10, 30, 50, 70, 90].every((score) => calculateGameRewardCredits({ gameType: 'tin-duck', score }) === curve(score, GALLERY_REWARD_DIVISOR)),
  [0, 30, 60, 90].map((sc) => `${sc} -> ${calculateGameRewardCredits({ gameType: 'tin-duck', score: sc })}`).join(', '),
);
check('the best simulated run is within the 75 cap', calculateGameRewardCredits({ gameType: 'tin-duck', score: 300 }) <= MAX_GAME_RUN_CREDITS);
check(
  'tickets never fall as the score rises',
  Array.from({ length: 301 }, (_, sc) => calculateGameRewardCredits({ gameType: 'tin-duck', score: sc })).every((v, i, all) => i === 0 || v >= all[i - 1]!),
);
{
  const rates = SKILLS.map((k) => rateFor(modernBySkill.get(k.name)!, GALLERY_REWARD_DIVISOR));
  check('better players earn more a minute', rates.every((v, i) => i === 0 || v >= rates[i - 1]! - 0.5), rates.map((v) => v.toFixed(1)).join(' < '));
  check('the bot does not outearn a good player by more than 2.5x', rates[rates.length - 1]! / goodRate < 2.5, `${(rates[rates.length - 1]! / goodRate).toFixed(2)}x`);
  const bestTop = Math.max(...modernBySkill.get('machine')!.map((r) => r.score));
  check(`no simulated run beats the route's plausible score (${GALLERY_MAX_RUN_SCORE})`, bestTop <= GALLERY_MAX_RUN_SCORE, String(bestTop));

  // The daily quest, from a good player's runs.
  const good = goodModern.map((r) => r.score).sort((a, b) => a - b);
  const quest = DAILY_QUEST_TEMPLATES.find((q) => q.key.startsWith('tin-duck-score'));
  const reach = good.filter((sc) => sc >= (quest?.goal ?? 0)).length / good.length;
  check(
    `the daily quest (score ${quest?.goal}) is reached by about 60% of a good player's runs (${(reach * 100).toFixed(0)}%)`,
    !!quest && reach >= 0.45 && reach <= 0.75,
  );

  // Sharpshooter's tiers are percentiles of the same runs: the casual 25th and
  // 75th, the good median, the strong 75th and the expert 75th (see registry.ts).
  const at = (name: string, p: number) => pct(modernBySkill.get(name)!.map((r) => r.score).sort((a, b) => a - b), p);
  const wanted = [at('casual', 0.25), at('casual', 0.75), at('good', 0.5), at('strong', 0.75), at('expert', 0.75)];
  say(`\nSharpshooter tiers from the runs: ${wanted.join(', ')}`);
  const series = ACHIEVEMENTS.filter((a) => a.seriesId === 'tin-duck-gallery-score' && !a.retired).sort((a, b) => a.tier - b.tier);
  const have = series.map((a) => ('gte' in a.condition ? a.condition.gte : NaN));
  check(`Sharpshooter's five tiers are the percentiles (${wanted.join(', ')})`, have.length === 5 && have.every((v, i) => Math.abs(v - wanted[i]!) <= 1), have.join(', '));
  const oldSeries = ACHIEVEMENTS.filter((a) => a.seriesId === 'tin-duck-score');
  check('Duck Hunter (100 to 625) is retired, ids unchanged', oldSeries.length === 5 && oldSeries.every((a) => a.retired === true));
  const ceiling = Math.max(...modernBySkill.get('machine')!.map((r) => r.score));
  check('Duck Hunter tiers III to V (375 to 625) cannot be reached by any rules 2 run', ceiling < 375, String(ceiling));
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log('\nall checks passed');
