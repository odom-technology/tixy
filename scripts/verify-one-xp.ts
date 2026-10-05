/**
 * Verifier for the one-XP pull request, run on a COPY of a database (it
 * refuses to run on `arcade` or anything named like production):
 *
 *   createdb arcade_onexp && pg_dump arcade | psql arcade_onexp
 *   DATABASE_URL=postgres://.../arcade_onexp npx tsx scripts/verify-one-xp.ts
 *
 * It rolls migration 0052 back on the copy, seeds accounts across levels as
 * the old curve and the old claim paid them, runs the migration, then checks:
 *  - no displayed level goes down, XP totals are untouched, and level_floor
 *    equals the old level;
 *  - every grant adds to the account row and the season row, by the formula;
 *  - skill-run XP stops at 2,500 a day, also under a burst, and starts again
 *    the next day, while quests and achievements are not capped;
 *  - a milestone is paid once, and a second pass pays nothing;
 *  - a player on an old streak never gets less on the next claim, a missed
 *    day resets the ladder, and a new player earns 525 in a week.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
for (const envFile of ['env/.env.local', 'env/.env']) {
  try {
    for (const raw of fs.readFileSync(path.join(root, envFile), 'utf8').split(/\r?\n/)) {
      const line = raw.trim();
      const eq = line.indexOf('=');
      if (!line || line.startsWith('#') || eq < 0) continue;
      const key = line.slice(0, eq).trim();
      if (process.env[key] === undefined) process.env[key] = line.slice(eq + 1).trim();
    }
  } catch {
    // no env file
  }
}

const databaseUrl = process.env.DATABASE_URL ?? '';
const dbName = databaseUrl.split('/').pop()?.split('?')[0] ?? '';
if (!dbName || dbName === 'arcade' || /prod/i.test(dbName)) {
  console.error(`Refusing to run on database "${dbName}". Use a copy.`);
  process.exit(2);
}

let failures = 0;
let checks = 0;
const check = (name: string, ok: boolean, detail = '') => {
  checks += 1;
  if (!ok) failures += 1;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? `  ${detail}` : ''}`);
};

// The old curve, as it was before this change.
const oldNeed = (l: number) => (l < 10 ? 300 + 120 * (l - 1) : Math.round(6.1 * Math.pow(l, 1.55)));
const oldLevel = (xp: number) => {
  let level = 1;
  let used = 0;
  while (used + oldNeed(level) <= xp) {
    used += oldNeed(level);
    level += 1;
  }
  return level;
};

const { query, queryOne, getPool } = await import('@/server/db/client');
const levels = await import('@/server/arcade/levels');
const { currentSeason } = await import('@/server/arcade/battlepass/seasons');
const daily = await import('@/server/arcade/rewards/daily-claim');
const { awardGameRunCredits } = await import('@/server/arcade/rewards/wallet');

const season = currentSeason();
const stamp = Date.now().toString(36);
const uid = (name: string) => `onexp-${stamp}-${name}`;

// ── 0. Roll the migration back on the copy and seed ─────────────────────────
await query(`ALTER TABLE user_account_xp DROP COLUMN IF EXISTS level_floor`);
await query(`ALTER TABLE user_season_xp_day DROP COLUMN IF EXISTS run_xp`);
await query(`ALTER TABLE daily_credit_claims DROP COLUMN IF EXISTS ladder`);
await query(`ALTER TABLE daily_credit_claims DROP COLUMN IF EXISTS hold_tickets`);
await query(`DELETE FROM arcade_schema_migrations WHERE id = '0052_one_xp'`);

const seedXps = [
  0, 150, 299, 300, 1_919, 1_920, 4_000, 7_019, 7_020, 7_235, 7_236, 8_464, 10_934,
  19_667, 34_466, 56_398, 86_407, 174_047, 303_601, 450_000,
];
const seeded = seedXps.map((xp, i) => ({ id: uid(`lvl${i}`), xp, level: oldLevel(xp) }));
for (const user of seeded) {
  await query(`INSERT INTO user_account_xp (user_id, xp, updated_at) VALUES ($1, $2, $3)`, [
    user.id, user.xp, Date.now(),
  ]);
  // The old system had paid every milestone up to the old level.
  for (let lvl = 5; lvl <= user.level; lvl += 5) {
    const tickets = levels.levelMilestoneReward(lvl);
    if (tickets > 0) {
      await query(
        `INSERT INTO user_level_reward_claims (user_id, level, tickets, claimed_at) VALUES ($1, $2, $3, $4)`,
        [user.id, lvl, tickets, Date.now()],
      );
    }
  }
}
const before = new Map(
  (await query<{ user_id: string; xp: string }>(`SELECT user_id, xp FROM user_account_xp`)).rows.map(
    (r) => [r.user_id, Number(r.xp)],
  ),
);

// A player on an old work-day streak: 4 days, last claim yesterday.
const dayKey = (offset: number, base = new Date()) => {
  const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const seedLegacyClaim = async (user: string, dateKey: string, streak: number, tickets: number) =>
  query(
    `INSERT INTO daily_credit_claims (user_id, date_key, streak, credits_awarded, beskar_awarded, is_milestone, claimed_at)
     VALUES ($1, $2, $3, $4, 0, FALSE, $5)`,
    [user, dateKey, streak, tickets, Date.now()],
  );
const holder = uid('holder');
const today = dayKey(0);
for (let i = 4; i >= 1; i -= 1) {
  await seedLegacyClaim(holder, dayKey(-i), 5 - i, daily.legacyClaimTickets(5 - i));
}
// Claims through Sunday 6 September, Labor Day on Monday the 7th, next claim
// on the Tuesday: the holiday was a day off under the old rules and bridges.
const friday = uid('friday');
await seedLegacyClaim(friday, '2026-09-05', 2, daily.legacyClaimTickets(2));
await seedLegacyClaim(friday, '2026-09-06', 3, daily.legacyClaimTickets(3));
// A streak that already broke: last claim 5 days ago.
const broken = uid('broken');
await seedLegacyClaim(broken, dayKey(-5), 6, daily.legacyClaimTickets(6));

// ── 1. Run the migration ────────────────────────────────────────────────────
execFileSync('npx', ['tsx', 'scripts/migrate.ts'], { stdio: 'pipe', env: process.env });
console.log('migration 0052 applied to the copy');

const after = (await query<{ user_id: string; xp: string; level_floor: number }>(
  `SELECT user_id, xp, level_floor FROM user_account_xp`,
)).rows;
for (const row of after) {
  const xp = Number(row.xp);
  const was = before.get(row.user_id);
  if (was === undefined) continue;
  if (xp !== was) check(`xp untouched for ${row.user_id}`, false, `${was} -> ${xp}`);
}
check('every XP total is untouched by the migration', after.every((r) => before.get(r.user_id) === undefined || before.get(r.user_id) === Number(r.xp)));
for (const user of seeded) {
  const row = after.find((r) => r.user_id === user.id)!;
  const shown = levels.levelFromXp(user.xp, row.level_floor);
  check(
    `level at ${String(user.xp).padStart(7)} xp: old ${String(user.level).padStart(3)} floor ${String(row.level_floor).padStart(3)} now ${String(shown).padStart(3)}`,
    row.level_floor === user.level && shown >= user.level,
  );
}
const floorMatchesOld = seeded.every(
  (u) => after.find((r) => r.user_id === u.id)!.level_floor === u.level,
);
check('level_floor equals the old displayed level for every seeded account', floorMatchesOld);
check('some floors are doing work (curve gives a lower level than the old one)', seeded.some((u) => levels.curveLevelFromXp(u.xp) < u.level));

// ── 2. The curve ────────────────────────────────────────────────────────────
let monotone = true;
for (let l = 1; l < 300; l += 1) if (levels.xpToNext(l + 1) < levels.xpToNext(l)) monotone = false;
check('xp to next level never falls as levels rise (no cliff)', monotone);
check('curve levels match cumulative thresholds', [2, 10, 30, 100].every((l) => levels.curveLevelFromXp(levels.cumulativeXpForLevel(l)) === l && levels.curveLevelFromXp(levels.cumulativeXpForLevel(l) - 1) === l - 1));
console.log(`     level 10 = ${levels.cumulativeXpForLevel(10)}, 20 = ${levels.cumulativeXpForLevel(20)}, 50 = ${levels.cumulativeXpForLevel(50)}, 100 = ${levels.cumulativeXpForLevel(100)} xp`);

// ── 3. One grant path: account row and season row, by the formula ───────────
const dateKey = today;
const seasonXp = async (user: string) =>
  Number((await queryOne<{ xp: number }>(
    `SELECT xp FROM user_season_progress WHERE user_id = $1 AND season_key = $2`, [user, season.key],
  ))?.xp ?? 0);
const accountXp = async (user: string) =>
  Number((await queryOne<{ xp: string }>(`SELECT xp FROM user_account_xp WHERE user_id = $1`, [user]))?.xp ?? 0);

let formulaOk = true;
let neverDown = true;
for (const user of seeded) {
  const lvlBefore = levels.levelFromXp(user.xp, after.find((r) => r.user_id === user.id)!.level_floor);
  await levels.grantXp(user.id, 500, 'run', dateKey);
  await levels.grantXp(user.id, 60, 'participation', dateKey);
  await levels.grantXp(user.id, 175, 'quest', dateKey);
  await levels.grantXp(user.id, 125, 'achievement', dateKey);
  const expected = user.xp + 500 + 60 + 175 + 125;
  if ((await accountXp(user.id)) !== expected || (await seasonXp(user.id)) !== 860) formulaOk = false;
  const state = await levels.getAccountLevelState(user.id);
  if (state.level < lvlBefore) neverDown = false;
}
check('each grant adds to the account row and the season row (860 xp from run, participation, quest, achievement)', formulaOk);
check('no displayed level went down after grants', neverDown);

// The grant returns where it left the season row, for the result's second bar.
const seasonUser = uid('season');
const sg1 = await levels.grantXp(seasonUser, 300, 'run', dateKey);
const sg2 = await levels.grantXp(seasonUser, 700, 'quest', dateKey);
const per = season.xpPerTier;
check(
  'a grant returns the season tier before and after, and XP into the tier',
  sg1.season?.seasonKey === season.key &&
    sg1.season.before.tier === 0 && sg1.season.before.into === 0 &&
    sg1.season.after.tier === Math.floor(300 / per) &&
    sg2.season?.before.tier === sg1.season.after.tier &&
    sg2.season.before.into === sg1.season.after.into &&
    sg2.season.after.tier === Math.floor(1000 / per) &&
    sg2.season.after.into === 1000 - Math.floor(1000 / per) * per &&
    sg2.season.after.need === per,
);
const merged = levels.mergeXpResults([sg1, sg2]);
check(
  'merged grants keep the first season start and the last end',
  merged?.season?.before.tier === 0 && merged.season.after.tier === Math.floor(1000 / per),
);

// A grant says which level it started in, and each milestone it paid.
const climber = uid('climber');
const small = await levels.grantXp(climber, 100, 'quest', dateKey);
check(
  'a grant that stays in a level returns the same level before and after, and no milestones',
  small.levelBefore === 1 && small.levelAfter === 1 && !small.leveledUp && small.milestones.length === 0 && small.grantedTickets === 0,
);
const toLevel13 = levels.cumulativeXpForLevel(13) - 100 + 40;
const big = await levels.grantXp(climber, toLevel13, 'quest', dateKey);
const climberState = await levels.getAccountLevelState(climber);
check(
  'a grant across 12 levels returns level 1 before and 13 after, matching the account row',
  big.levelBefore === 1 && big.levelAfter === 13 && big.levelAfter === climberState.level && big.before.level === 1 && big.after.level === 13 && big.leveledUp,
  `${big.levelBefore} -> ${big.levelAfter}`,
);
check(
  'that grant lists the milestones at levels 5 and 10 with their tickets, and the total matches',
  JSON.stringify(big.milestones) === JSON.stringify([
    { level: 5, tickets: levels.levelMilestoneReward(5) },
    { level: 10, tickets: levels.levelMilestoneReward(10) },
  ]) && big.grantedTickets === levels.levelMilestoneReward(5) + levels.levelMilestoneReward(10),
  JSON.stringify(big.milestones),
);
const after13 = await levels.grantXp(climber, 10, 'quest', dateKey);
check('the next grant starts at level 13 and lists no milestone', after13.levelBefore === 13 && after13.levelAfter === 13 && after13.milestones.length === 0);
const mergedClimb = levels.mergeXpResults([small, big, after13]);
check(
  'merged grants keep the first level before, the last level after, and every milestone',
  mergedClimb?.levelBefore === 1 && mergedClimb.levelAfter === 13 && mergedClimb.milestones.length === 2,
);
const quest13 = await levels.grantXp(uid('rewardclimb'), levels.cumulativeXpForLevel(13) + 5, 'quest', dateKey);
check('a first grant from zero reports the starting level as 1', quest13.levelBefore === 1 && quest13.levelAfter >= 13);

// ── 4. The 2,500 a day run cap ──────────────────────────────────────────────
const capper = uid('cap');
const g1 = await levels.grantXp(capper, 2_000, 'run', dateKey);
const g2 = await levels.grantXp(capper, 1_000, 'run', dateKey);
const g3 = await levels.grantXp(capper, 100, 'run', dateKey);
check('run XP: 2,000 then 1,000 pays 2,000 then 500', g1.xpGained === 2_000 && g2.xpGained === 500, `${g1.xpGained}, ${g2.xpGained}`);
check('run XP: past the cap pays 0', g3.xpGained === 0);
const q = await levels.grantXp(capper, 300, 'quest', dateKey);
const a = await levels.grantXp(capper, 400, 'achievement', dateKey);
const p = await levels.grantXp(capper, 60, 'participation', dateKey);
check('quests, achievements and participation are not held by the run cap', q.xpGained === 300 && a.xpGained === 400 && p.xpGained === 60);
check('account and season rows both stop at cap + others', (await accountXp(capper)) === 2_500 + 760 && (await seasonXp(capper)) === 2_500 + 760);
const next = await levels.grantXp(capper, 800, 'run', dayKey(1));
check('the cap resets on the next day key', next.xpGained === 800);

const burst = uid('burst');
await Promise.all(Array.from({ length: 12 }, () => levels.grantXp(burst, 400, 'run', dateKey)));
check('12 parallel runs of 400 stop at exactly 2,500', (await accountXp(burst)) === 2_500 && (await seasonXp(burst)) === 2_500, String(await accountXp(burst)));

// Through the real reward path: one run, one XP number.
const runner = uid('runner');
const rewardResult = await awardGameRunCredits({
  userId: runner,
  context: { gameType: 'snake', score: 300 },
  sourceId: `onexp:${stamp}:run1`,
});
const runnerXp = await accountXp(runner);
const runnerSeason = await seasonXp(runner);
check(
  'a run through awardGameRunCredits grants its pre-cap ticket value plus participation, once',
  rewardResult.account?.xpGained === runnerXp && runnerXp === rewardResult.wantedCredits + 60 && runnerSeason === runnerXp,
  `wanted ${rewardResult.wantedCredits}, account ${runnerXp}, season ${runnerSeason}, shown ${rewardResult.account?.xpGained}`,
);
const dup = await awardGameRunCredits({
  userId: runner,
  context: { gameType: 'snake', score: 300 },
  sourceId: `onexp:${stamp}:run1`,
});
check('the same run again grants no XP', (await accountXp(runner)) === runnerXp && !dup.account);

// ── 5. Milestones: paid once, nothing skipped ───────────────────────────────
const claimRows = (await query<{ user_id: string; level: number; n: string }>(
  `SELECT user_id, level, count(*) AS n FROM user_level_reward_claims WHERE user_id LIKE $1 GROUP BY 1, 2`,
  [`onexp-${stamp}-%`],
)).rows;
check('no milestone has more than one claim row', claimRows.every((r) => Number(r.n) === 1));
const ledger = (await query<{ user_id: string; source_id: string; n: string }>(
  `SELECT user_id, source_id, count(*) AS n FROM currency_ledger
    WHERE source_type = 'level_reward' AND user_id LIKE $1 GROUP BY 1, 2`,
  [`onexp-${stamp}-%`],
).catch(() => ({ rows: [] }))).rows;
check('no milestone has more than one ledger entry', ledger.every((r) => Number(r.n) === 1), `${ledger.length} ledger rows`);
let covered = true;
for (const user of seeded) {
  const state = await levels.getAccountLevelState(user.id);
  const have = new Set(claimRows.filter((r) => r.user_id === user.id).map((r) => Number(r.level)));
  for (let l = 5; l <= state.level; l += 5) if (levels.levelMilestoneReward(l) > 0 && !have.has(l)) covered = false;
}
check('every milestone up to each account level has a claim (none skipped, none repaid)', covered);
const again = await levels.grantXp(seeded[10]!.id, 1, 'quest', dateKey);
check('another grant pays no milestone twice', again.grantedTickets === 0);

// ── 6. The daily claim ──────────────────────────────────────────────────────
// The claim is a wheel now (DAILY_WHEEL.md). A 25 slot pays the ladder
// amount on every streak day, so these checks draw one.
const { DAILY_WHEEL_SEGMENTS } = await import('@/features/arcade/lib/daily-wheel');
const unit25 = DAILY_WHEEL_SEGMENTS.find((segment) => segment.value === 25)!.start;
const claim = (user: string, key: string) =>
  daily.claimDailyCreditsForDate(user, key, { drawUnit: () => unit25 });
const fresh = uid('fresh');
const week: number[] = [];
for (let i = 0; i < 8; i += 1) week.push((await claim(fresh, dayKey(i - 20))).ticketsAwarded);
check('a new player earns 25, 25, 50, 50, 75, 100, 200 and the ladder repeats', JSON.stringify(week) === JSON.stringify([25, 25, 50, 50, 75, 100, 200, 25]), week.join(', '));
check('a week on the ladder pays 525', week.slice(0, 7).reduce((x, y) => x + y, 0) === 525);
const weekend = await claim(uid('weekend'), '2026-10-03');
check('a Saturday claim pays', weekend.ticketsAwarded === 25);

const held = legacyHold(5);
function legacyHold(streak: number) { return daily.legacyClaimTickets(streak); }
const holderPay: number[] = [];
for (let i = 0; i < 9; i += 1) holderPay.push((await claim(holder, dayKey(i))).ticketsAwarded);
check(
  `a streak holder's next claim is not lower than their current amount (${held}); the hold stays through the streak`,
  holderPay.every((n) => n >= held) && holderPay[0] === held,
  holderPay.join(', '),
);
const bridged = await claim(friday, '2026-09-08');
check('a streak continues past a holiday at the held amount', bridged.streak === 4 && bridged.ticketsAwarded === daily.legacyClaimTickets(4), `${bridged.streak}, ${bridged.ticketsAwarded}`);
const afterBreak = await claim(broken, today);
check('a broken streak restarts the ladder at 25', afterBreak.streak === 1 && afterBreak.ticketsAwarded === 25, `${afterBreak.streak}, ${afterBreak.ticketsAwarded}`);
const skipped = uid('skipper');
await claim(skipped, dayKey(-12));
await claim(skipped, dayKey(-11));
const resume = await claim(skipped, dayKey(-9));
check('a missed day resets the streak', resume.streak === 1 && resume.ticketsAwarded === 25);
let dupClaim = false;
try { await claim(fresh, dayKey(-20)); } catch { dupClaim = true; }
check('a second claim on one day is refused', dupClaim);

console.log(`\n${checks - failures} of ${checks} checks passed`);
await getPool().end();
process.exit(failures === 0 ? 0 : 1);
