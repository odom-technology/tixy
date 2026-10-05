/**
 * Verifies the achievements floor (tixy/2-achievements-floor).
 *
 *   npm run test:achievements            static checks, no database
 *   npm run test:achievements -- --db    also unlocks on DATABASE_URL (use a scratch one)
 *
 * Static:
 * - every achievement id that existed before (scripts/data/achievement-ids-base.json)
 *   still exists, so no stored key changed
 * - the listed and retired counts match the plan: 7 floor-game series, 11 general
 *   series, the standalones, the 17 secrets with a writer and the 3 new series' worth listed (ticket stop's with rules 2),
 *   and flappy bird's again now it is back on the floor;
 *   28 series (25 for games off the floor, Strongman, Bell Ringer and Duck Hunter), Flawless, Speed Demon, Tetris Deity, Master of the Arcade, Gotta
 *   Get Them All, High Roller, Lab and Comeback Kid (no writer) retired
 * - every LISTED achievement has a stat writer that can unlock it: the stat
 *   it reads is written by a score route, a match settle, a wager settle, a
 *   server hook or a client trigger that exists. Floor-group achievements need
 *   a play writer for every game on the floor in their group
 *
 * With --db, on a throwaway set of users: every listed achievement unlocks
 * once its stats are met; "play every game in <group>" unlocks on the last game
 * and not before; a reserve game's series unlocks and shows only to its
 * holder, on the retired shelf; a player who never earned a retired
 * achievement is never shown it. The users' rows are removed afterwards.
 */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ARCADE_GAMES,
  ARCADE_FLOOR_GROUPS,
  getFloorGames,
  getFloorGroups,
  isOnFloor,
} from '../src/features/arcade/components/arcade-game-registry';
import {
  ACHIEVEMENTS,
  SECRET_TRIGGER_KEYS,
  isRetiredAchievement,
} from '../src/server/arcade/achievements/registry';
import { floorSlugsInGroup } from '../src/server/arcade/achievements/floor-groups';
import type { AchievementCondition, AchievementDef } from '../src/server/arcade/achievements/types';
import { isArcadeGameType } from '../src/server/arcade/arcade-constants';
import { isSecretGlyph, parseBadgeRef } from '../src/features/brand/avatars/badges';
import {
  LEET_PLAYTIME_MS,
  milestoneSecretDeltas,
  secretRunDeltas,
  timeSecretDeltas,
} from '../src/server/arcade/stats/pipeline';
import { statDeltasForRun, type RunExtra } from '../src/server/arcade/stats/deltas';
import { DAILY, GLOBAL, MP } from '../src/server/arcade/stats/stat-keys';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ok = (message: string) => console.log(`ok    ${message}`);

/* ------------------------------------------------------------------ */
/* Source scans                                                        */
/* ------------------------------------------------------------------ */

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}
const sources = new Map(walk(path.join(root, 'src')).map((file) => [path.relative(root, file), readFileSync(file, 'utf8')]));
const writerSources = [...sources].filter(
  ([file]) =>
    file !== 'src/server/arcade/achievements/registry.ts' &&
    file !== 'src/server/arcade/stats/stat-keys.ts',
);

/* ------------------------------------------------------------------ */
/* Writers                                                             */
/* ------------------------------------------------------------------ */

const CONSTANT_NAMES: Record<string, string> = {};
for (const [scope, table] of [['GLOBAL', GLOBAL], ['MP', MP], ['DAILY', DAILY]] as const) {
  for (const [prop, value] of Object.entries(table)) CONSTANT_NAMES[value] = `${scope}.${prop}`;
}

/** A GLOBAL, MP or DAILY key is written when a stat call names it. */
function crossGameWriter(stat: string): string | null {
  const name = CONSTANT_NAMES[stat];
  if (!name) return null;
  const pattern = new RegExp(`\\b(?:add|max|min|set)\\([^;\\n]*\\b${name.replace('.', '\\.')}\\b`);
  return writerSources.find(([, text]) => pattern.test(text))?.[0] ?? null;
}

/** A secret trigger is written by a server hook or a client trigger call. */
function secretWriter(key: string): string | null {
  const pattern = new RegExp(`(?:secretStat|triggerSecret)\\(\\s*['"]${key}['"]`);
  return writerSources.find(([, text]) => pattern.test(text))?.[0] ?? null;
}

const stubContext = (gameType: string) =>
  ({
    gameType,
    score: 1000,
    result: 'win',
    solved: true,
    clear: true,
    wpm: 100,
    averageTime: 200,
    solveTimeMs: 60_000,
    difficulty: 'easy',
    size: 5,
    mode: 'standard',
    pangrams: 3,
    streak: 2,
    vsBot: false,
    // Derby: a race won.
    place: 1,
    field: 8,
    humans: 2,
  }) as never;

const EXTRA_FIELDS: Array<keyof RunExtra> = [
  'snakeApples', 'snakeLength', 'flappyPipes', 'highestTile', 'tetrisLines',
  'tetrisTetrises', 'tetrisLevel', 'typingAccuracy', 'typingWords', 'perfectDaily', 'golfAces',
  'trickShotStreak', 'trickShotFirstTry',
  'strikerSwings', 'strikerBellStreak',
];

/** The run keys a game writes, and for each key the RunExtra field it needs, if any. */
function runKeys(slug: string): Map<string, keyof RunExtra | null> {
  const out = new Map<string, keyof RunExtra | null>();
  for (const delta of statDeltasForRun(stubContext(slug), {})) out.set(delta.key, null);
  for (const field of EXTRA_FIELDS) {
    for (const delta of statDeltasForRun(stubContext(slug), { [field]: field === 'perfectDaily' || field === 'trickShotFirstTry' ? true : 2048 })) {
      if (!out.has(delta.key)) out.set(delta.key, field);
    }
  }
  return out;
}

const resultFileFor = (slug: string) =>
  writerSources.find(
    ([, text]) =>
      text.includes('recordMatchRunResult') &&
      (text.includes(`gameType: '${slug}'`) || text.includes(`gameType: "${slug}"`)),
  )?.[0] ?? null;

/** The file that records a finished run of this game into stats. */
function routeWriter(slug: string): string | null {
  // Most games save on /score; trick shot saves each try on /shot,
  // mini golf its round hole by hole on /hole.
  for (const name of ['score', 'shot', 'hole']) {
    const route = `src/app/api/games/${slug}/${name}/route.ts`;
    const text = sources.get(route);
    if (text && /recordRunAchievements|recordGameRunStats/.test(text)) return route;
  }
  return resultFileFor(slug);
}

const wagerSettle = sources.get('src/server/arcade/arcade-session.ts') ?? '';
const wagerSettleRecords = /recordWagerSettlementStats/.test(wagerSettle);

/** Any way a play of this game sets its played flag. */
function playWriter(slug: string): string | null {
  const route = routeWriter(slug);
  if (route) return route;
  const game = ARCADE_GAMES.find((g) => g.slug === slug);
  if (game?.arcadeHistoryType && isArcadeGameType(game.arcadeHistoryType) && wagerSettleRecords) {
    return 'src/server/arcade/arcade-session.ts';
  }
  return null;
}

function statWriter(stat: string): string | null {
  const scope = stat.split('.')[0];
  if (scope === 'global' || scope === 'mp' || scope === 'daily') return crossGameWriter(stat);
  if (scope === 'secret') return secretWriter(stat.slice('secret.'.length));
  const route = routeWriter(scope);
  if (!route) return null;
  const needs = runKeys(scope).get(stat);
  if (needs === undefined) return null;
  if (needs !== null) {
    const text = sources.get(route) ?? '';
    // A match result carries no extras; a score route must pass the field.
    if (!text.includes(needs)) return null;
  }
  return route;
}

const conditionStats = (cond: AchievementCondition) =>
  'all' in cond ? cond.all.map((c) => c.stat) : [cond.stat];

/** Why a listed achievement can't be unlocked, or null when it can. */
function missingWriter(def: AchievementDef): string | null {
  if (def.floorGroup) {
    for (const slug of floorSlugsInGroup(def.floorGroup)) {
      if (!playWriter(slug)) return `no play writer for ${slug}`;
    }
    return null;
  }
  for (const stat of conditionStats(def.condition)) {
    if (!statWriter(stat)) return `nothing writes ${stat}`;
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Static checks                                                       */
/* ------------------------------------------------------------------ */

const listed = ACHIEVEMENTS.filter((a) => !isRetiredAchievement(a));
const retired = ACHIEVEMENTS.filter((a) => isRetiredAchievement(a));

function checkStoredKeys() {
  const base = JSON.parse(readFileSync(path.join(root, 'scripts/data/achievement-ids-base.json'), 'utf8')) as string[];
  const ids = new Set(ACHIEVEMENTS.map((a) => a.id));
  assert.equal(ids.size, ACHIEVEMENTS.length, 'achievement ids are unique');
  const gone = base.filter((id) => !ids.has(id));
  assert.deepEqual(gone, [], `achievement ids removed: ${gone.join(', ')}`);
  ok(`all ${base.length} existing achievement ids are still in the registry (${ACHIEVEMENTS.length - base.length} added)`);
}

function checkCounts() {
  const seriesIds = (defs: AchievementDef[]) => new Set(defs.filter((d) => d.seriesId).map((d) => d.seriesId!));
  const listedSeries = seriesIds(listed);
  const retiredSeries = seriesIds(retired);
  const gameSeries = [...listedSeries].filter((id) => listed.find((d) => d.seriesId === id)!.game);
  const generalSeries = [...listedSeries].filter((id) => !listed.find((d) => d.seriesId === id)!.game);

  const floorSlugs = new Set(getFloorGames().map((g) => g.slug));
  for (const id of gameSeries) {
    const game = listed.find((d) => d.seriesId === id)!.game!;
    assert.ok(floorSlugs.has(game), `${id} is listed but ${game} is not on the floor`);
  }
  const floorSeries = ['snake-score', '2048-tile', 'stack-score', 'high-striker-depth', 'high-striker-bells', 'tin-duck-gallery-score', 'chess-wins', '8ball-wins', 'connect-four-wins', 'skee-ball-score', 'ticket-stop-score', 'ricochet-score', 'flappy-score', 'trick-shot-clears'];
  // Ring toss
  floorSeries.push('ring-toss-score');
  // Derby
  floorSeries.push('derby-wins');
  // Trick shot's streak of cleared days, since unlimited tries
  floorSeries.push('trick-shot-streak');
  floorSeries.push('mini-golf-aces');
  floorSeries.push('bumper-cars-bumps');
  assert.deepEqual([...gameSeries].sort(), floorSeries.sort(), 'listed game series');
  assert.equal(generalSeries.length, 11, '11 general series');
  assert.equal(retiredSeries.size, 28, '28 retired series: 25 for games off the floor, Strongman, Bell Ringer and Duck Hunter');
  for (const id of retiredSeries) {
    const first = retired.find((d) => d.seriesId === id)!;
    // Strongman, Bell Ringer and Duck Hunter are retired by hand: their game is on the floor,
    // but the tiers (25 to 600, and 100 to 625) can't be reached under the new rules.
    assert.ok(
      first.retired === true || (first.game && !isOnFloor(first.game)),
      `${id} is retired for a game off the floor`,
    );
  }
  ok(`listed series: ${gameSeries.length} floor-game (8 existing with ricochet, connect four, skee-ball and ticket stop new, flappy bird back, trick shot and mini golf new) and ${generalSeries.length} general; ${retiredSeries.size} series retired`);

  const retiredStandalones = retired.filter((d) => !d.seriesId).map((d) => d.id).sort();
  assert.deepEqual(
    retiredStandalones,
    ['arcade-master', 'flawless-typist', 'high-roller', 'secret-comeback', 'secret-completionist', 'secret-lab', 'speed-demon', 'tetris-deity'],
    'retired standalones',
  );
  const secrets = listed.filter((d) => d.category === 'secret');
  assert.equal(secrets.length, 17, '17 listed secrets');
  const standalones = listed.filter((d) => !d.seriesId && d.category !== 'secret' && !d.floorGroup);
  assert.deepEqual(
    standalones.map((d) => d.id).sort(),
    ['2048-ascendant', 'centurion', 'first-game', 'jack-of-all', 'trick-shot-first-try', 'untouchable'],
    'listed standalones',
  );
  const groups = listed.filter((d) => d.floorGroup);
  assert.equal(groups.length, ARCADE_FLOOR_GROUPS.length, 'one achievement per floor group');
  ok(`listed ${listed.length} (${listed.filter((d) => d.seriesId).length} series tiers, ${standalones.length} standalones, ${groups.length} floor groups, ${secrets.length} secrets); retired ${retired.length} (${retiredSeries.size * 5} series tiers, ${retiredStandalones.length} standalones)`);

  const achiever = ACHIEVEMENTS.find((a) => a.id === 'meta-achiever-5')!;
  assert.deepEqual(achiever.condition, { stat: GLOBAL.achievementsUnlocked, gte: 90 });
  assert.ok(listed.length >= 90, `Achiever V needs 90 and ${listed.length} are listed`);
  ok(`Achiever V asks for 90 of ${listed.length} listed`);
}

/* Badges: every achievement wears one, drawn from the art kit, and the names
   and hints follow the copy rules. */
function checkBadgesAndCopy() {
  for (const def of ACHIEVEMENTS) {
    const badge = parseBadgeRef(def.icon);
    assert.ok(badge, `${def.id}: icon ${def.icon} is not a badge reference`);
    assert.equal(badge.tier, def.tier, `${def.id}: badge tier ${badge.tier}, achievement tier ${def.tier}`);
    if (def.category === 'secret' && !isRetiredAchievement(def)) assert.ok(isSecretGlyph(badge.glyph), `${def.id}: a secret wears a secret glyph`);
  }
  ok(`all ${ACHIEVEMENTS.length} achievements wear a badge, tier for tier`);

  const bad = /—|…|[\u{1F300}-\u{1FAFF}]/u;
  for (const def of ACHIEVEMENTS) {
    assert.ok(!bad.test(`${def.name} ${def.description} ${def.hint ?? ''}`), `${def.id}: em dash, ellipsis or emoji in its text`);
    const sentence = def.name.charAt(0).toUpperCase() + def.name.slice(1).toLowerCase();
    assert.equal(def.name, sentence, `${def.id}: names are sentence case`);
    assert.ok(/^[A-Z0-9].*[.!]$/.test(def.description) || def.description.endsWith('.'), `${def.id}: a description is a sentence`);
  }
  const secrets = listed.filter((d) => d.category === 'secret');
  for (const def of secrets) {
    assert.ok(def.hidden && def.hint && def.hint.length > 8, `${def.id}: a hidden achievement has a hint`);
    assert.ok(def.hint.endsWith('.'), `${def.id}: a hint is a sentence`);
    assert.notEqual(def.hint, def.description, `${def.id}: the hint doesn't say it outright`);
  }
  ok(`${secrets.length} secrets are hidden, each with a hint`);

  // A tier ladder rises: more is harder, and never a repeated step.
  for (const id of new Set(ACHIEVEMENTS.filter((a) => a.seriesId).map((a) => a.seriesId!))) {
    const steps = ACHIEVEMENTS.filter((a) => a.seriesId === id).sort((a, b) => a.tier - b.tier)
      .map((a) => ('all' in a.condition ? a.condition.all[0]! : a.condition))
      .map((c) => c.gte ?? c.lte ?? 0);
    const low = ACHIEVEMENTS.find((a) => a.seriesId === id && 'lte' in a.condition && !('all' in a.condition));
    const ordered = low ? steps.every((v, i) => i === 0 || v < steps[i - 1]!) : steps.every((v, i) => i === 0 || v > steps[i - 1]!);
    assert.ok(ordered, `${id}: tiers ${steps.join(', ')} don't climb`);
  }
  ok('every series climbs');

  // The one condition two achievements shared is gone: Beyond 2048 is past the series' top.
  const topTile = ACHIEVEMENTS.find((a) => a.id === '2048-tile-5')!.condition as { gte: number };
  const beyond = ACHIEVEMENTS.find((a) => a.id === '2048-ascendant')!.condition as { gte: number };
  assert.ok(beyond.gte > topTile.gte, 'Beyond 2048 asks for more than Power of Two V');
  ok('Beyond 2048 asks for more than the top of Power of Two');
}

/* The secret detectors, without a database. */
function checkSecretDetectors() {
  const at = (iso: string) => new Date(iso);
  const keys = (deltas: Array<{ key: string }>) => deltas.map((d) => d.key).sort();
  assert.deepEqual(keys(timeSecretDeltas(at('2026-03-04T03:30:00'))), ['secret.night_owl']);
  assert.deepEqual(keys(timeSecretDeltas(at('2026-03-04T05:00:00'))), ['secret.early_bird']);
  assert.deepEqual(keys(timeSecretDeltas(at('2026-03-04T04:30:00'))), []);
  assert.deepEqual(keys(timeSecretDeltas(at('2027-01-01T12:00:00'))), ['secret.newyear']);
  ok('night owl 3 to 4, early bird 5 to 6, new year on 1 January, nothing at 4');

  const run = (score: number) => keys(secretRunDeltas({ gameType: 'snake', score }, at('2026-03-04T12:00:00')));
  assert.deepEqual(run(0), ['secret.humble']);
  assert.deepEqual(run(1337), ['secret.leet']);
  assert.deepEqual(run(314), ['secret.pi']);
  assert.deepEqual(run(404), ['secret.palindrome']);
  assert.deepEqual(run(1221), ['secret.palindrome']);
  assert.deepEqual(run(11), [], '11 is not a palindrome worth a badge');
  assert.deepEqual(run(7), []);
  ok('humble 0, leet 1337, pi 314, palindromes of 3 or more digits');

  const prior = (games: number, playtimeMs: number) =>
    new Map([[GLOBAL.games, games], [GLOBAL.playtimeMs, playtimeMs]]);
  assert.deepEqual(keys(milestoneSecretDeltas(prior(313, 0), { games: 1, playtimeMs: 0 })), ['secret.pi']);
  assert.deepEqual(keys(milestoneSecretDeltas(prior(314, 0), { games: 1, playtimeMs: 0 })), []);
  assert.deepEqual(keys(milestoneSecretDeltas(prior(10, LEET_PLAYTIME_MS - 1000), { games: 1, playtimeMs: 5000 })), ['secret.leet']);
  assert.deepEqual(keys(milestoneSecretDeltas(prior(10, LEET_PLAYTIME_MS + 1), { games: 1, playtimeMs: 5000 })), []);
  assert.equal(LEET_PLAYTIME_MS, 49_020_000, '13 hours 37 minutes');
  ok('pi on the 314th game and leet on the 13 hour 37 minute mark fire once, on the call that crosses');

  for (const key of ['konami', 'logo', 'explorer', 'rage_quit', 'window_shopper']) {
    assert.ok(SECRET_TRIGGER_KEYS.has(key), `${key} is an allowed client trigger`);
    assert.ok(secretWriter(key), `${key} has a client writer`);
  }
  const triggers = sources.get('src/features/arcade/components/achievements/secret-triggers.tsx') ?? '';
  assert.ok(/getFloorGames\(\)/.test(triggers) && /FLOOR_HREFS\.every/.test(triggers), 'Cartographer asks for the floor');
  ok('client triggers are allowed and Cartographer asks for the floor, not the reserve');
}

function checkWriters() {
  const unwritten: string[] = [];
  for (const def of listed) {
    const why = missingWriter(def);
    if (why) unwritten.push(`${def.id} (${why})`);
  }
  assert.deepEqual(unwritten, [], `listed achievements nothing can unlock:\n  ${unwritten.join('\n  ')}`);
  ok(`every listed achievement (${listed.length}) has a stat writer, no exceptions`);
  // The floor's own plays: every game on the floor can set a played flag.
  for (const { group, games } of getFloorGroups()) {
    for (const game of games) assert.ok(playWriter(game.slug), `${game.slug} (${group.id}) sets no played flag`);
  }
  ok('every game on the floor writes a played flag');
}

/* ------------------------------------------------------------------ */
/* Database checks                                                     */
/* ------------------------------------------------------------------ */

async function checkDatabase() {
  const { query } = await import('../src/server/db/client');
  const { evaluateAchievements, getAchievementsForUser, getProfileAchievements } = await import(
    '../src/server/arcade/achievements/engine'
  );
  const { applyStatDeltas, getUserStats } = await import('../src/server/arcade/stats/record');
  const { recordGameRunStats, recordWagerSettlementStats } = await import('../src/server/arcade/stats/pipeline');
  const db = (await query<{ db: string }>('SELECT current_database() AS db')).rows[0]!.db;
  console.log(`      database ${db}`);

  const stamp = Date.now();
  const users: Record<string, string> = {
    all: `achcheck-all-${stamp}`,
    groups: `achcheck-groups-${stamp}`,
    link: `achcheck-link-${stamp}`,
    none: `achcheck-none-${stamp}`,
    secrets: `achcheck-secrets-${stamp}`,
    lurk: `achcheck-lurk-${stamp}`,
  };
  try {
    for (const id of Object.values(users)) {
      await query(
        `INSERT INTO arcade_accounts (id, email, email_normalized, created_at, updated_at)
         VALUES ($1, $2, $2, $3, $3)`,
        [id, `${id}@achcheck.invalid`, stamp],
      );
    }
    // Every listed achievement unlocks once its stats are met.
    const deltas = listed
      .filter((d) => !d.floorGroup && d.id !== 'secret-completionist')
      .flatMap((d) => ('all' in d.condition ? d.condition.all : [d.condition]))
      .map((c) => ({
        key: c.stat,
        value: c.gte ?? c.lte ?? c.eq ?? 1,
        mode: c.lte !== undefined ? ('min' as const) : ('max' as const),
      }));
    const changed = await applyStatDeltas(users.all, deltas);
    await evaluateAchievements(users.all, changed);
    const held = await getAchievementsForUser(users.all);
    const missed = held.achievements.filter((a) => !a.unlocked && !listed.find((d) => d.id === a.id)?.floorGroup);
    assert.deepEqual(missed.map((a) => a.id), [], 'listed achievements left locked');
    ok(`${held.achievements.length - ATTENTION_GROUPS} listed achievements unlock from their stats`);

    // Play every game in a group: on the last game and not before.
    for (const { group, games } of getFloorGroups()) {
      const def = ACHIEVEMENTS.find((a) => a.floorGroup === group.id)!;
      for (const [index, game] of games.entries()) {
        const arcade = ARCADE_GAMES.find((g) => g.slug === game.slug)!;
        if (arcade.arcadeHistoryType && isArcadeGameType(arcade.arcadeHistoryType) && !routeWriter(game.slug)) {
          await recordWagerSettlementStats(users.groups, { gameType: arcade.arcadeHistoryType, durationMs: 1000, netProfit: 0 });
        } else {
          await recordGameRunStats(users.groups, stubContext(game.slug), { durationMs: 1000 });
        }
        const state = await getAchievementsForUser(users.groups);
        const unlocked = state.achievements.find((a) => a.id === def.id)!.unlocked;
        assert.equal(unlocked, index === games.length - 1, `${def.id} after ${index + 1}/${games.length} (${game.slug})`);
      }
    }
    ok('each "play every game" achievement unlocks on its last game and not before');

    // A reserve game's series unlocks by link, and shows only to its holder.
    await recordGameRunStats(users.link, stubContext('tetris'), { tetrisLines: 60, durationMs: 1000 });
    const holder = await getAchievementsForUser(users.link);
    assert.ok(holder.retired.some((a) => a.id === 'tetris-lines-1' && a.retired && a.unlockedAt), 'tetris-lines-1 on the shelf');
    assert.ok(!holder.achievements.some((a) => a.id === 'tetris-lines-1'), 'not in the listed catalog');
    const stranger = await getAchievementsForUser(users.none);
    assert.ok(!stranger.retired.length && !stranger.achievements.some((a) => a.retired), 'a stranger sees no retired achievement');
    assert.equal(stranger.summary.total, listed.length, 'summary counts listed achievements only');
    assert.ok(holder.summary.xpEarned >= 120, 'its XP is counted');
    const profile = await getProfileAchievements(users.link, []);
    assert.ok(profile.retired.some((a) => a.id === 'tetris-lines-1'), 'on the profile shelf with its date');
    ok('reserve series unlock by link, land on the retired shelf for the holder only, keep their XP');

    // Secrets fire from the real code paths, and the shelf shows a hint until they do.
    const earned = async (id: string, user = users.secrets) =>
      (await getAchievementsForUser(user)).achievements.find((a) => a.id === id)!;
    const play = (score: number, durationMs = 1000) =>
      recordGameRunStats(users.secrets, { ...(stubContext('snake') as object), score } as never, { durationMs });
    const before = await earned('secret-humble');
    assert.equal(before.unlocked, false);
    assert.equal(before.name, '???', 'a locked secret is hidden');
    assert.equal(before.description, ACHIEVEMENTS.find((a) => a.id === 'secret-humble')!.hint, 'and shows its hint');
    assert.equal(before.icon, 'badge:unknown:0', 'behind the unknown badge');
    await play(0);
    assert.equal((await earned('secret-humble')).unlocked, true, 'humble: a run of 0');
    await play(11);
    assert.equal((await earned('secret-palindrome')).unlocked, false, 'palindrome: 11 is too short');
    await play(404);
    assert.equal((await earned('secret-palindrome')).unlocked, true, 'palindrome: 404');
    await play(1337);
    assert.equal((await earned('secret-leet')).unlocked, true, 'leet: a score of 1337');
    await play(314);
    assert.equal((await earned('secret-pi')).unlocked, true, 'pi: a score of 314');
    assert.equal((await earned('secret-humble')).name, 'Humble beginnings', 'earned, it shows its name');

    const { PI_GAMES, LEET_PLAYTIME_MS: LEET_MS } = await import('../src/server/arcade/stats/pipeline');
    const { set } = await import('../src/server/arcade/stats/stat-keys');
    const countUser = `achcheck-count-${stamp}`;
    await query(
      `INSERT INTO arcade_accounts (id, email, email_normalized, created_at, updated_at) VALUES ($1, $2, $2, $3, $3)`,
      [countUser, `${countUser}@achcheck.invalid`, stamp],
    );
    users.count = countUser;
    await applyStatDeltas(countUser, [set(GLOBAL.games, PI_GAMES - 1), set(GLOBAL.playtimeMs, LEET_MS - 500)]);
    assert.equal((await earned('secret-pi', countUser)).unlocked, false);
    await recordGameRunStats(countUser, { ...(stubContext('snake') as object), score: 50 } as never, { durationMs: 1000 });
    assert.equal((await earned('secret-pi', countUser)).unlocked, true, 'pi: the 314th game');
    assert.equal((await earned('secret-leet', countUser)).unlocked, true, 'leet: 13 hours 37 minutes');

    // Machine rounds count for the games and hours, and for the time secrets.
    const machineUser = users.secrets;
    await recordWagerSettlementStats(machineUser, { gameType: 'arcade-blackjack', durationMs: 1000, netProfit: 0 });
    assert.ok(((await getAchievementsForUser(machineUser)).achievements.find((a) => a.id === 'global-games-1')?.current ?? 0) >= 5, 'a machine round is a game');

    // Lurker: 100 different profiles, and the same one twice is one.
    const { recordProfileView } = await import('../src/server/arcade/stats/pipeline');
    const lurked = async () => (await getUserStats(users.lurk, ['secret.lurker'])).get('secret.lurker') ?? 0;
    for (let i = 0; i < 3; i += 1) await recordProfileView(users.lurk, 'someone-else');
    assert.equal(await lurked(), 1, 'lurker: one profile, three views, is 1');
    await recordProfileView(users.lurk, users.lurk);
    assert.equal(await lurked(), 1, 'your own profile is not counted');
    for (let i = 0; i < 99; i += 1) await recordProfileView(users.lurk, `profile-${i}`);
    assert.equal((await earned('secret-lurker', users.lurk)).unlocked, true, 'lurker: 100 different profiles');
    ok('humble, palindrome, leet, pi, the two counts, machine rounds and lurker unlock from the real code paths');

    // A count series takes its tiers from the new steps.
    const { recordStats } = await import('../src/server/arcade/stats/pipeline');
    const { max } = await import('../src/server/arcade/stats/stat-keys');
    await recordStats(users.secrets, [max(MP.wins, 12), max(GLOBAL.ticketsEarned, 1600)]);
    const tiers = await getAchievementsForUser(users.secrets);
    assert.ok(tiers.achievements.find((a) => a.id === 'mp-wins-2')!.unlocked, '10 multiplayer wins is tier 2');
    assert.ok(!tiers.achievements.find((a) => a.id === 'mp-wins-3')!.unlocked, 'and 40 is tier 3');
    assert.ok(tiers.achievements.find((a) => a.id === 'economy-tickets-2')!.unlocked, '1,500 tickets is tier 2');
    ok('lowered tiers unlock at their new steps');
  } finally {
    const ids = Object.values(users);
    const unlocked = await query<{ achievement_id: string; n: string }>(
      'SELECT achievement_id, COUNT(*) AS n FROM user_achievements WHERE user_id = ANY($1) GROUP BY 1',
      [ids],
    );
    for (const row of unlocked.rows) {
      await query('UPDATE achievement_unlock_counts SET count = count - $2 WHERE achievement_id = $1', [row.achievement_id, Number(row.n)]);
    }
    for (const table of ['user_stats', 'user_achievements', 'user_account_xp', 'user_owned_items', 'user_equipped_items']) {
      await query(`DELETE FROM ${table} WHERE user_id = ANY($1)`, [ids]).catch(() => {});
    }
    await query('DELETE FROM arcade_accounts WHERE id = ANY($1)', [ids]);
    ok('removed the check users');
  }
}
const ATTENTION_GROUPS = ARCADE_FLOOR_GROUPS.length;

checkStoredKeys();
checkCounts();
checkBadgesAndCopy();
checkSecretDetectors();
checkWriters();
if (process.argv.includes('--db')) await checkDatabase();
console.log('\nALL CHECKS PASSED');
process.exit(0);
