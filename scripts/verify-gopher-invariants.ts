/**
 * Offline RULE + REPLAY-DETERMINISM invariant proof for Gopher Pop.
 *
 *   npx tsx scripts/verify-gopher-invariants.ts
 *
 * Pins the contract the score route, leaderboard, replay channel, and
 * anti-cheat rely on, so cosmetic/game-feel work cannot silently change the
 * rules:
 *  1. Timing/scoring constants — 60s sprint, 9 holes, 90ms cadence floor,
 *     380ms QUICK window, 10/30/50 base points, counted caps.
 *  2. Schedule determinism — same seed → bit-identical pop stream; holes are
 *     never double-booked; pops stay inside the sprint window.
 *  3. Scoring formula — combo tiers (×1…×3), QUICK ×1.5 integer math,
 *     floor rounding — checked against an independent reference.
 *  4. Scorer state machine — whiff/escape reset the streak, armored takes
 *     two taps (first breaks armor, no points, combo preserved), cadence-floor
 *     taps are 'ignored' WITHOUT mutating combo state, a bomb ends the run.
 *  5. Replay parity — validateGopherRun re-derives exactly the live scorer's
 *     score for the same bonk log (the server hard-compares them), drops
 *     malformed/out-of-window entries, and truncates at a bomb.
 *
 * Exits non-zero on any failed assertion.
 */
import {
  deriveGopherSchedule,
  createGopherScorer,
  validateGopherRun,
  gopherComboMultiplierX2,
  gopherBasePoints,
  gopherBonkPoints,
  GOPHER_SPRINT_DURATION_SEC,
  GOPHER_SPRINT_DURATION_MS,
  GOPHER_HOLE_COUNT,
  GOPHER_MAX_BONK_T_MS,
  GOPHER_MIN_BONK_INTERVAL_MS,
  GOPHER_MAX_BONKS,
  GOPHER_QUICK_BONK_MS,
  GOPHER_POINTS_NORMAL,
  GOPHER_POINTS_ARMORED,
  GOPHER_POINTS_GOLDEN,
  GOPHER_MAX_RUN_SCORE,
  type GopherPop,
} from '@/server/arcade/gopher-replay';

let failures = 0;
const assert = (cond: boolean, msg: string) => {
  if (!cond) {
    console.error('  FAIL: ' + msg);
    failures += 1;
  }
};

// ── 1. Timing / scoring constants (exact parity lock) ──────────────────────
console.log('1. Timing / scoring constants…');
{
  assert(GOPHER_SPRINT_DURATION_SEC === 60, `sprint ${GOPHER_SPRINT_DURATION_SEC}`);
  assert(GOPHER_SPRINT_DURATION_MS === 60_000, `sprint ms ${GOPHER_SPRINT_DURATION_MS}`);
  assert(GOPHER_HOLE_COUNT === 9, `holes ${GOPHER_HOLE_COUNT}`);
  assert(GOPHER_MAX_BONK_T_MS === 62_000, `max bonk t ${GOPHER_MAX_BONK_T_MS}`);
  assert(GOPHER_MIN_BONK_INTERVAL_MS === 90, `cadence ${GOPHER_MIN_BONK_INTERVAL_MS}`);
  assert(GOPHER_MAX_BONKS === 600, `max bonks ${GOPHER_MAX_BONKS}`);
  assert(GOPHER_QUICK_BONK_MS === 380, `quick window ${GOPHER_QUICK_BONK_MS}`);
  assert(GOPHER_POINTS_NORMAL === 10, `normal pts ${GOPHER_POINTS_NORMAL}`);
  assert(GOPHER_POINTS_ARMORED === 30, `armored pts ${GOPHER_POINTS_ARMORED}`);
  assert(GOPHER_POINTS_GOLDEN === 50, `golden pts ${GOPHER_POINTS_GOLDEN}`);
  assert(GOPHER_MAX_RUN_SCORE === 15_000, `max run score ${GOPHER_MAX_RUN_SCORE}`);
}

// ── 2. Schedule determinism + geometry invariants ──────────────────────────
console.log('2. Schedule determinism…');
{
  const seeds = [0, 1, 42, 123456789, 0x7fffffff, 2718281828];
  for (const seed of seeds) {
    const a = deriveGopherSchedule(seed);
    const b = deriveGopherSchedule(seed);
    assert(a.length > 0, `empty schedule seed=${seed}`);
    assert(JSON.stringify(a) === JSON.stringify(b),
      `same-seed schedules diverge seed=${seed}`);
    // Sorted by upStart, first pop never before the 650ms warm-up, everything
    // inside the hard bonk window, holes in range, never double-booked.
    const busyUntil = new Array<number>(GOPHER_HOLE_COUNT).fill(-Infinity);
    let prevStart = -1;
    for (const pop of a) {
      assert(pop.upStart >= prevStart, `schedule not time-sorted seed=${seed}`);
      prevStart = pop.upStart;
      assert(pop.upStart >= 650, `pop before warm-up seed=${seed}`);
      assert(pop.upStart < GOPHER_SPRINT_DURATION_MS,
        `pop beyond sprint seed=${seed}`);
      assert(pop.upEnd <= GOPHER_MAX_BONK_T_MS, `upEnd beyond window seed=${seed}`);
      assert(pop.upEnd >= pop.upStart + 260, `up-window too short seed=${seed}`);
      assert(pop.hole >= 0 && pop.hole < GOPHER_HOLE_COUNT,
        `hole out of range seed=${seed}`);
      assert(busyUntil[pop.hole]! <= pop.upStart,
        `hole double-booked seed=${seed} hole=${pop.hole} pop=${pop.index}`);
      busyUntil[pop.hole] = pop.upEnd;
      assert(pop.isBomb === (pop.kind === 'bomb'), `isBomb/kind mismatch seed=${seed}`);
    }
    // A 60s schedule should hold a realistic number of pops (never degenerate).
    assert(a.length >= 40 && a.length <= 200,
      `implausible schedule length ${a.length} seed=${seed}`);
  }
  const s1 = JSON.stringify(deriveGopherSchedule(1));
  const s2 = JSON.stringify(deriveGopherSchedule(2));
  assert(s1 !== s2, 'different seeds produced identical schedules');
}

// ── 3. Scoring formula (independent reference) ─────────────────────────────
console.log('3. Scoring formula…');
{
  // Combo tiers: 1-4 → ×1 (2), 5-9 → ×1.5 (3), 10-14 → ×2 (4), 15-19 → ×2.5
  // (5), 20+ → ×3 (6).
  const tierExpect: Array<[number, number]> = [
    [0, 2], [1, 2], [4, 2], [5, 3], [9, 3], [10, 4], [14, 4],
    [15, 5], [19, 5], [20, 6], [100, 6],
  ];
  for (const [streak, x2] of tierExpect) {
    assert(gopherComboMultiplierX2(streak) === x2,
      `tier drift streak=${streak}: ${gopherComboMultiplierX2(streak)} vs ${x2}`);
  }
  assert(gopherBasePoints('normal') === 10, 'normal base drifted');
  assert(gopherBasePoints('armored') === 30, 'armored base drifted');
  assert(gopherBasePoints('golden') === 50, 'golden base drifted');
  assert(gopherBasePoints('bomb') === 10, 'bomb base drifted'); // bombs never score; falls through to normal base

  // Reference: base (+50% if quick, integer shift) × tier / 2, floored.
  const refPoints = (kind: 'normal' | 'armored' | 'golden', quick: boolean, streak: number) => {
    let base = kind === 'golden' ? 50 : kind === 'armored' ? 30 : 10;
    if (quick) base = base + (base >> 1);
    const x2 = streak >= 20 ? 6 : streak >= 15 ? 5 : streak >= 10 ? 4 : streak >= 5 ? 3 : 2;
    return Math.floor((base * x2) / 2);
  };
  for (const kind of ['normal', 'armored', 'golden'] as const) {
    for (const quick of [false, true]) {
      for (let streak = 1; streak <= 25; streak += 1) {
        const got = gopherBonkPoints(kind, quick, streak);
        const want = refPoints(kind, quick, streak);
        assert(got === want,
          `points drift kind=${kind} quick=${quick} streak=${streak}: ${got} vs ${want}`);
        assert(Number.isInteger(got) && got >= 0, `non-integer points ${got}`);
      }
    }
  }
  // Spot values a balance change would break.
  assert(gopherBonkPoints('normal', false, 1) === 10, 'plain bonk ≠ 10');
  assert(gopherBonkPoints('normal', true, 1) === 15, 'quick bonk ≠ 15');
  assert(gopherBonkPoints('golden', true, 20) === 225, 'quick golden ×3 ≠ 225');
  assert(gopherBonkPoints('armored', true, 5) === 67, 'quick armored ×1.5 ≠ 67');
}

// ── 4. Scorer state machine ────────────────────────────────────────────────
console.log('4. Scorer state machine…');
{
  const schedule = deriveGopherSchedule(42);
  const gophers = schedule.filter((p) => p.kind !== 'bomb');
  const first = gophers[0]!;

  // Quick bonk inside the window scores; streak builds.
  {
    const scorer = createGopherScorer(schedule);
    const t = first.upStart + 100; // ≤380ms after emerge → QUICK
    const out = scorer.bonk(first.hole, t);
    assert(out.type === 'score', `first bonk not a score: ${out.type}`);
    if (out.type === 'score') {
      assert(out.quick === true, 'quick window not detected');
      assert(out.streak === 1 && out.multX2 === 2, `first streak drift: ${out.streak}`);
      assert(scorer.score === out.points, 'scorer score mismatch');
    }
    // Tapping the SAME pop again is a whiff (already used) and resets streak.
    const again = scorer.bonk(first.hole, t + 200);
    assert(again.type === 'whiff', `re-tap not a whiff: ${again.type}`);
    if (again.type === 'whiff') {
      assert(again.brokeStreak === true && again.prevStreak === 1,
        're-tap whiff did not report the broken streak');
    }
    assert(scorer.streak === 0, 'streak not reset by whiff');
  }

  // Cadence floor: a tap <90ms after a counted tap is 'ignored' and must NOT
  // mutate combo state.
  {
    const scorer = createGopherScorer(schedule);
    const a = gophers[0]!;
    const b = gophers.find((p) => p.hole !== a.hole && p.upStart >= a.upEnd)!;
    scorer.bonk(a.hole, a.upStart + 100); // counted
    // Another live pop overlapping the cadence window: use any gopher live at
    // a.upStart+150 in a different hole; fall back to manual time probing.
    const overlap = gophers.find(
      (p) =>
        p.index !== a.index &&
        p.hole !== a.hole &&
        p.upStart <= a.upStart + 150 &&
        p.upEnd >= a.upStart + 150,
    );
    if (overlap) {
      const out = scorer.bonk(overlap.hole, a.upStart + 150); // 50ms later
      assert(out.type === 'ignored', `cadence tap not ignored: ${out.type}`);
      assert(scorer.streak === 1, 'ignored tap mutated the streak');
      assert(scorer.counted === 1, 'ignored tap was counted');
    }
    // A tap ≥90ms later on a live gopher is counted normally.
    const late = scorer.bonk(b.hole, Math.max(b.upStart + 100, a.upStart + 100 + 90));
    assert(late.type === 'score' || late.type === 'whiff',
      `unexpected outcome for spaced tap: ${late.type}`);
  }

  // Whiff on an empty hole resets the streak.
  {
    const scorer = createGopherScorer(schedule);
    scorer.bonk(first.hole, first.upStart + 100);
    assert(scorer.streak === 1, 'setup streak missing');
    // A moment when `first.hole` has nothing up (after its window, before any
    // later pop in that hole).
    const laterInHole = schedule
      .filter((p) => p.hole === first.hole && p.upStart > first.upEnd)
      .sort((x, y) => x.upStart - y.upStart)[0];
    const gapEnd = laterInHole ? laterInHole.upStart : GOPHER_SPRINT_DURATION_MS;
    const t = first.upEnd + Math.floor((gapEnd - first.upEnd) / 2);
    const out = scorer.bonk(first.hole, t);
    assert(out.type === 'whiff', `empty-hole tap not a whiff: ${out.type}`);
    assert(scorer.streak === 0, 'streak survived a whiff');
  }

  // Escape: an unbonked gopher expiring resets the streak (via advanceTo).
  {
    const scorer = createGopherScorer(schedule);
    scorer.bonk(first.hole, first.upStart + 100); // streak 1
    const escapee = gophers.find((p) => p.index !== first.index && p.hole !== first.hole)!;
    const escapes = scorer.advanceTo(escapee.upEnd + 1);
    const esc = escapes.find((e) => e.popIndex === escapee.index);
    assert(!!esc, 'escape not surfaced');
    if (esc) {
      assert(esc.brokeStreak === true && esc.prevStreak === 1,
        'escape did not report the broken streak');
    }
    assert(scorer.streak === 0, 'streak survived an escape');
  }

  // Armored: first tap breaks the helmet (no points, combo preserved), second
  // tap scores the armored base.
  {
    const armored = schedule.find((p) => p.kind === 'armored');
    if (armored) {
      const scorer = createGopherScorer(schedule);
      const t1 = armored.upStart + 100;
      const first1 = scorer.bonk(armored.hole, t1);
      assert(first1.type === 'armor-break', `armor first tap: ${first1.type}`);
      assert(scorer.score === 0, 'armor break awarded points');
      assert(scorer.streak === 0, 'armor break moved the streak');
      assert(scorer.isArmorBroken(armored.index), 'armor not marked broken');
      const second = scorer.bonk(armored.hole, t1 + 120); // ≥90ms cadence
      assert(second.type === 'score', `armor second tap: ${second.type}`);
      if (second.type === 'score') {
        assert(second.kind === 'armored', 'armored kind drifted');
        // quick = t2 - upStart ≤ 380 ⇒ 220 → QUICK ⇒ base 45, streak 1 ⇒ ×1
        assert(second.points === 45, `armored quick points drift: ${second.points}`);
      }
    } else {
      assert(false, 'seed 42 produced no armored pop — pick a seed that does');
    }
  }

  // Bomb: ends the run; nothing after it counts.
  {
    const bomb = schedule.find((p) => p.kind === 'bomb');
    if (bomb) {
      const scorer = createGopherScorer(schedule);
      const out = scorer.bonk(bomb.hole, bomb.upStart + 100);
      assert(out.type === 'bomb', `bomb tap: ${out.type}`);
      assert(scorer.bombHit === true, 'bombHit not latched');
      const after = scorer.bonk(first.hole, first.upStart + 100);
      assert(after.type === 'ignored', `post-bomb tap: ${after.type}`);
      assert(scorer.score === 0, 'score moved after a bomb');
    } else {
      assert(false, 'seed 42 produced no bomb — pick a seed that does');
    }
  }
}

// ── 5. Replay parity — validateGopherRun vs the live scorer ────────────────
console.log('5. Replay parity…');
{
  // Simulate a "live" run: step the scorer exactly like the client does
  // (per-tap advanceTo inside bonk), recording the {hole, t} log — then replay
  // the same log through validateGopherRun like the score route does. The two
  // scores must agree to the point (the route rejects on any mismatch).
  for (const seed of [7, 42, 1337, 987654321]) {
    const schedule = deriveGopherSchedule(seed);
    const live = createGopherScorer(schedule);
    const bonks: Array<{ hole: number; t: number }> = [];

    // Bonk every non-bomb pop at emerge+120ms (QUICK), skipping pops whose
    // holes overlap in time with a previously bonked one (client cadence).
    let lastT = -Infinity;
    let bombs = 0;
    for (const pop of schedule) {
      if (pop.isBomb) {
        bombs += 1;
        continue;
      }
      const t = pop.upStart + 120;
      if (t - lastT < GOPHER_MIN_BONK_INTERVAL_MS) continue;
      const out = live.bonk(pop.hole, t);
      bonks.push({ hole: pop.hole, t });
      if (out.type === 'score' || out.type === 'armor-break') lastT = t;
    }
    assert(bombs > 0, `seed ${seed} produced no bombs`);

    const replayed = validateGopherRun(seed, bonks, GOPHER_SPRINT_DURATION_MS);
    assert(replayed.score === live.score,
      `replay score drift seed=${seed}: ${replayed.score} vs ${live.score}`);
    assert(replayed.counted === live.counted,
      `replay counted drift seed=${seed}: ${replayed.counted} vs ${live.counted}`);
    assert(replayed.bestStreak === live.bestStreak,
      `replay bestStreak drift seed=${seed}`);
    assert(replayed.score > 0, `degenerate run seed=${seed}`);
    assert(replayed.score <= GOPHER_MAX_RUN_SCORE,
      `score beyond plausibility cap seed=${seed}`);
  }

  // Out-of-order delivery must not change the result (the validator sorts).
  {
    const seed = 42;
    const schedule = deriveGopherSchedule(seed);
    const bonks = schedule
      .filter((p) => !p.isBomb)
      .slice(0, 10)
      .map((p) => ({ hole: p.hole, t: p.upStart + 120 }));
    const forward = validateGopherRun(seed, bonks, GOPHER_SPRINT_DURATION_MS);
    const shuffled = validateGopherRun(seed, bonks.slice().reverse(), GOPHER_SPRINT_DURATION_MS);
    assert(forward.score === shuffled.score && forward.counted === shuffled.counted,
      'out-of-order bonks changed the replay');
  }

  // Malformed entries are dropped, never thrown on.
  {
    const seed = 42;
    const result = validateGopherRun(
      seed,
      [
        { hole: -1, t: 1000 },
        { hole: 9, t: 1000 },
        { hole: 1.5, t: 1000 },
        { hole: 0, t: Number.NaN },
        { hole: 0, t: 99_999 }, // beyond the 62s hard window
      ] as Array<{ hole: number; t: number }>,
      GOPHER_SPRINT_DURATION_MS,
    );
    assert(result.score === 0 && result.counted === 0, 'malformed bonks scored');
    assert(result.dropped === 5, `dropped count drift: ${result.dropped}`);
    const empty = validateGopherRun(seed, [], GOPHER_SPRINT_DURATION_MS);
    assert(empty.score === 0 && empty.dropped === 0, 'empty run drifted');
  }

  // Bomb truncation: bonks after the bomb are ignored by the replay too.
  {
    const seed = 42;
    const schedule = deriveGopherSchedule(seed);
    const bomb = schedule.find((p) => p.kind === 'bomb')!;
    const before = schedule
      .filter((p) => !p.isBomb && p.upEnd < bomb.upStart)
      .map((p) => ({ hole: p.hole, t: p.upStart + 120 }));
    const after = schedule
      .filter((p) => !p.isBomb && p.upStart > bomb.upEnd)
      .slice(0, 5)
      .map((p) => ({ hole: p.hole, t: p.upStart + 120 }));
    const withBomb = [...before, { hole: bomb.hole, t: bomb.upStart + 100 }, ...after];
    const bombOnly = [...before, { hole: bomb.hole, t: bomb.upStart + 100 }];
    const r1 = validateGopherRun(seed, withBomb, GOPHER_SPRINT_DURATION_MS);
    const r2 = validateGopherRun(seed, bombOnly, GOPHER_SPRINT_DURATION_MS);
    assert(r1.bombHit === true, 'bomb not detected by replay');
    assert(r1.score === r2.score && r1.counted === r2.counted,
      'post-bomb bonks counted by the replay');
  }

  // Live scorer type reference kept importable (client shares these types).
  const typeProbe: GopherPop = deriveGopherSchedule(1)[0]!;
  assert(typeof typeProbe.upStart === 'number', 'pop shape drifted');
}

// ── Summary ────────────────────────────────────────────────────────────────
if (failures > 0) {
  console.error(`\n${failures} invariant failure(s).`);
  process.exit(1);
}
console.log('\nAll Gopher Pop invariants hold.');
