/**
 * Verifies the rev. 2 floor registry and redirects (tixy/2-registry).
 *
 *   npm run test:floor-registry
 *
 * - every slug in docs/game-catalog.json has a registry
 *   entry with the same decision and group, and the registry has no others
 * - the floor is the catalog's floor games (the ones that existed plus
 *   ticket stop), in group order; the reserve list is the catalog's reserve
 * - no stored key changed: registry slugs, hrefs, sections and history types,
 *   and the game-type declarations, compared with the base branch. A new
 *   game may append keys (ticket stop's GameType); none may change or go
 * - every game redirect starts at a page route that exists and ends at one
 *   that exists; nothing under /api redirects; floor and reserve games are
 *   never redirected; a merged game never redirects before its target exists
 * - no redirected game is named by a live system: the season-0 daily and
 *   weekly quest pools, the featured pool, the tour pool, achievements, the
 *   store catalog (what the daily rotation draws from) or the weekly paid
 *   boards (WEEKLY_BOARD_CANDIDATES in features/arcade/lib/weekly-boards.ts)
 * - the rename map is off unless NEXT_PUBLIC_GAME_RENAMES=1, and changes
 *   nothing while it is off; with it on every renamed game resolves both
 *   ways (old route redirects, new route serves the old page), names come
 *   from the map, and stored keys are untouched. Run the verifier with the
 *   variable set as well to check the registry and next.config.ts in that state:
 *     NEXT_PUBLIC_GAME_RENAMES=1 npm run test:floor-registry
 *
 * The base branch is origin/tixy/rev2, or FLOOR_REGISTRY_BASE_REF. If it is
 * not available locally the stored-key comparison is skipped with a warning,
 * unless FLOOR_REGISTRY_REQUIRE_BASE=1.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import nextConfig from '../next.config';
import { ACHIEVEMENTS, isRetiredAchievement } from '../src/server/arcade/achievements/registry';
import { DAILY_QUEST_TEMPLATES } from '../src/server/arcade/battlepass/daily-quests';
import { getTourGroups } from '../src/server/arcade/arcade-tour';
import { getFeaturedPool } from '../src/server/arcade/featured-game';
import { FLOOR_POOLS_FROM } from '../src/server/arcade/floor-pools';
import { WEEKLY_BOARD_CANDIDATES } from '../src/features/arcade/lib/weekly-boards';
import {
  ARCADE_FLOOR_GROUPS,
  ARCADE_GAMES,
  getFloorGames,
  getFloorGroups,
  getGamePlacement,
  getListedGames,
  getReserveGames,
  isGameListed,
  isInReserve,
  isOnFloor,
  type ArcadeGameEntry,
} from '../src/features/arcade/components/arcade-game-registry';
import {
  GAME_RENAMES,
  GAME_RENAMES_ENABLED,
  canonicalGamePath,
  gameRenameRoutes,
  getGameDisplayName,
  getGameDisplayRoute,
  getGameRename,
  getGameTitle,
  renameGameNamesInText,
  renamedPath,
} from '../src/features/arcade/lib/game-renames';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const appDir = path.join(root, 'src', 'app');
const BASE_REF = process.env.FLOOR_REGISTRY_BASE_REF ?? 'origin/tixy/rev2';

type CatalogGame = {
  slug: string;
  decision: 'floor' | 'reserve' | 'later' | 'merge' | 'scrap';
  group: string;
  work: string;
};
type Catalog = {
  floorAtRelaunch: string[];
  counts: Record<string, number>;
  games: CatalogGame[];
  newGames: { slug: string; decision: string; group: string }[];
};

const catalog = JSON.parse(
  readFileSync(path.join(root, 'docs/game-catalog.json'), 'utf8'),
) as Catalog;

const STATUS_FOR_DECISION: Record<CatalogGame['decision'], string> = {
  floor: 'floor',
  reserve: 'reserve',
  later: 'later',
  merge: 'merged',
  scrap: 'retired',
};

let passed = 0;
function ok(message: string) {
  passed += 1;
  console.log(`ok  ${message}`);
}

/* ------------------------------------------------------------------ */
/* Catalog and registry agree                                          */
/* ------------------------------------------------------------------ */

function checkCatalog() {
  const bySlug = new Map(ARCADE_GAMES.map((game) => [game.slug, game]));
  assert.equal(bySlug.size, ARCADE_GAMES.length, 'registry slugs must be unique');
  assert.equal(catalog.games.length, 69, 'the catalog covers 69 existing games');

  const groupLabels = new Map(ARCADE_FLOOR_GROUPS.map((group) => [group.label, group.id]));
  assert.equal(groupLabels.size, 5, 'five floor groups');
  assert.deepEqual(
    ARCADE_FLOOR_GROUPS.map((group) => group.label),
    ['with friends', 'boardwalk', 'quick play', 'ticket machines', 'daily'],
    'floor groups follow the PLAN.md table order',
  );
  assert.deepEqual(
    ARCADE_FLOOR_GROUPS.map((group) => group.order),
    [0, 1, 2, 3, 4],
    'group order is 0..4',
  );
  for (const group of ARCADE_FLOOR_GROUPS) {
    assert.equal(group.label, group.label.toLowerCase(), `${group.id} label is lowercase`);
  }

  for (const game of catalog.games) {
    const entry = bySlug.get(game.slug);
    assert.ok(entry, `catalog slug ${game.slug} has a registry entry`);
    const placement = entry.placement;
    assert.equal(
      placement.status,
      STATUS_FOR_DECISION[game.decision],
      `${game.slug}: catalog says ${game.decision}, registry says ${placement.status}`,
    );
    if (placement.status === 'floor' || placement.status === 'reserve' || placement.status === 'later') {
      assert.equal(
        groupLabels.get(game.group),
        placement.group,
        `${game.slug}: catalog group "${game.group}" does not match ${placement.group}`,
      );
    }
    if (placement.status === 'merged') {
      const into = game.work.match(/^into (.+)$/)?.[1]?.replace(/ /g, '-');
      assert.equal(placement.into, into, `${game.slug}: merged into ${into} per the catalog`);
    }
  }
  for (const entry of ARCADE_GAMES) {
    const isNew = catalog.newGames.find((game) => game.slug === entry.slug);
    assert.ok(
      catalog.games.some((game) => game.slug === entry.slug) || isNew,
      `registry slug ${entry.slug} is in the catalog`,
    );
    if (isNew) {
      assert.equal(entry.placement.status, STATUS_FOR_DECISION[isNew.decision as CatalogGame['decision']], `${entry.slug}: new game placement`);
      assert.equal(
        'group' in entry.placement ? entry.placement.group : null,
        groupLabels.get(isNew.group),
        `${entry.slug}: new game group`,
      );
    }
  }
  ok('every catalog slug has a registry entry with the same decision, group and merge target');

  const counts = { floor: 0, reserve: 0, later: 0, merge: 0, scrap: 0 };
  for (const game of catalog.games) counts[game.decision] += 1;
  assert.deepEqual(counts, {
    floor: catalog.counts.floor,
    reserve: catalog.counts.reserve,
    later: catalog.counts.later,
    merge: catalog.counts.merge,
    scrap: catalog.counts.scrap,
  });
  const registryCounts = { floor: 0, reserve: 0, later: 0, merged: 0, retired: 0 };
  for (const entry of ARCADE_GAMES) registryCounts[entry.placement.status] += 1;
  // The catalog is the plan: the registry has its games plus the new games it
  // lists, so a game moving on or off the floor changes one file, the catalog.
  const registered = new Set(ARCADE_GAMES.map((game) => game.slug));
  const planned = { floor: 0, reserve: 0, later: 0, merged: 0, retired: 0 };
  for (const game of catalog.games) planned[STATUS_FOR_DECISION[game.decision] as keyof typeof planned] += 1;
  for (const game of catalog.newGames) {
    if (registered.has(game.slug)) planned[STATUS_FOR_DECISION[game.decision as CatalogGame['decision']] as keyof typeof planned] += 1;
  }
  assert.deepEqual(registryCounts, planned);
  ok(
    `${planned.floor} floor, ${planned.reserve} reserve, ${planned.later} later, ${planned.merged} merged, ${planned.retired} retired, as the catalog plans`,
  );
}

/* ------------------------------------------------------------------ */
/* Floor and reserve helpers                                           */
/* ------------------------------------------------------------------ */

function checkFloor() {
  const floor = getFloorGames();
  const plannedFloor = catalog.floorAtRelaunch.filter((slug) => ARCADE_GAMES.some((entry) => entry.slug === slug));
  assert.equal(floor.length, plannedFloor.length, `the floor has ${plannedFloor.length} games, ticket stop included`);

  // Games the catalog puts on the floor at relaunch but that have no entry yet.
  const pending = catalog.newGames
    .filter((game) => game.decision === 'floor')
    .map((game) => game.slug)
    .filter((slug) => !ARCADE_GAMES.some((entry) => entry.slug === slug));
  assert.deepEqual(pending, [], 'every relaunch floor game has an entry');
  assert.deepEqual(
    [...floor.map((game) => game.slug)].sort(),
    catalog.floorAtRelaunch.filter((slug) => !pending.includes(slug)).sort(),
    'the floor is the catalog floor without the games still to come',
  );
  assert.deepEqual(
    [...floor.map((game) => game.slug)].sort(),
    ARCADE_GAMES.filter((game) => game.placement.status === 'floor').map((game) => game.slug).sort(),
    'every floor placement is on the floor list, and nothing else is',
  );
  assert.equal(new Set(floor.map((game) => game.slug)).size, floor.length, 'no game is on the floor twice');

  const groups = getFloorGroups();
  assert.deepEqual(groups.map(({ group }) => group.id), ARCADE_FLOOR_GROUPS.map((group) => group.id));
  for (const { group, games } of groups) {
    for (const game of games) {
      assert.deepEqual(
        game.placement,
        { status: 'floor', group: group.id },
        `${game.slug} is listed in ${group.id} but placed elsewhere`,
      );
    }
    assert.ok(games.length > 0, `${group.id} has at least one game`);
  }
  const floorLabels = new Map(ARCADE_FLOOR_GROUPS.map((group) => [group.label, group.id]));
  const groupOf = new Map<string, string>([
    ...catalog.games.map((game) => [game.slug, floorLabels.get(game.group)!] as [string, string]),
    ...catalog.newGames.map((game) => [game.slug, floorLabels.get(game.group)!] as [string, string]),
  ]);
  assert.deepEqual(
    groups.map(({ games }) => games.length),
    ARCADE_FLOOR_GROUPS.map((group) => plannedFloor.filter((slug) => groupOf.get(slug) === group.id).length),
    'group sizes follow the catalog',
  );
  ok(`the floor has ${floor.length} games in group order (${groups.map(({ games }) => games.length).join(', ')})`);

  const reserve = getReserveGames();
  const plannedReserve = catalog.games.filter((game) => game.decision === 'reserve');
  assert.equal(reserve.length, plannedReserve.length, `the reserve has ${plannedReserve.length} games`);
  assert.deepEqual(
    [...reserve.map((game) => game.slug)].sort(),
    catalog.games.filter((game) => game.decision === 'reserve').map((game) => game.slug).sort(),
  );
  assert.equal(new Set(reserve.map((game) => game.slug)).size, reserve.length);
  ok(`the reserve list is the ${reserve.length} reserve games`);

  for (const entry of ARCADE_GAMES) {
    const status = entry.placement.status;
    assert.equal(isOnFloor(entry.slug), status === 'floor', `${entry.slug} isOnFloor`);
    assert.equal(isInReserve(entry.slug), status === 'reserve', `${entry.slug} isInReserve`);
    assert.equal(isGameListed(entry.slug), status === 'floor' || status === 'reserve');
    assert.deepEqual(getGamePlacement(entry.slug), entry.placement);
  }
  assert.equal(isOnFloor('no-such-game'), false);
  assert.equal(isGameListed('no-such-game'), false);
  assert.equal(getListedGames().length, floor.length + reserve.length, 'floor and reserve together list their games');
  ok('isOnFloor, isInReserve and isGameListed match every placement');
}

/* ------------------------------------------------------------------ */
/* Stored keys                                                         */
/* ------------------------------------------------------------------ */

function gitShow(file: string): string | null {
  try {
    return execFileSync('git', ['show', `${BASE_REF}:${file}`], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      maxBuffer: 32 * 1024 * 1024,
    });
  } catch {
    return null;
  }
}

function strings(text: string): string[] {
  return [...text.matchAll(/'([^'\n]*)'/g)].map((match) => match[1]!);
}

/* The text of one declaration, from its keyword to the first semicolon. */
function declaration(source: string, pattern: RegExp, label: string): string {
  const match = pattern.exec(source);
  assert.ok(match, `declaration ${label} not found`);
  const start = match.index;
  const end = source.indexOf(';', start);
  assert.ok(end > start, `declaration ${label} has no end`);
  return source.slice(start, end);
}

function functionBody(source: string, name: string): string {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `function ${name} not found`);
  const open = source.indexOf('{', start);
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  throw new Error(`function ${name} is not closed`);
}

type StoredKeyCheck = {
  file: string;
  label: string;
  pick: (source: string) => string[];
};

/** Stored keys a floor game adds for its own mode, not a new catalog game.
 *  stack-cabinet is stacker's 15-row cabinet mode: its own game type, session
 *  and personal-best table, so endless stack's keys stay as they are. */
const MODE_KEYS = new Set(['stack-cabinet', 'stack_cabinet_scores', 'stack_cabinet_runs']);

const STORED_KEY_CHECKS: StoredKeyCheck[] = [
  {
    file: 'src/server/arcade/arcade-constants.ts',
    label: 'ArcadeGameType',
    pick: (source) => strings(declaration(source, /export type ArcadeGameType\b/, 'ArcadeGameType')),
  },
  {
    file: 'src/server/arcade/arcade-constants.ts',
    label: 'ARCADE_GAME_TYPES',
    pick: (source) => strings(declaration(source, /const ARCADE_GAME_TYPES\b/, 'ARCADE_GAME_TYPES')),
  },
  {
    file: 'src/server/arcade/game-session.ts',
    label: 'GameType',
    pick: (source) => strings(declaration(source, /export type GameType\b/, 'GameType')),
  },
  {
    file: 'src/features/arcade/lib/rewards.ts',
    label: 'STORE_GAME_TYPES',
    pick: (source) => strings(declaration(source, /export const STORE_GAME_TYPES\b/, 'STORE_GAME_TYPES')),
  },
  {
    file: 'src/server/arcade/multiplayer.ts',
    label: 'MultiplayerGameType',
    pick: (source) => strings(declaration(source, /export type MultiplayerGameType\b/, 'MultiplayerGameType')),
  },
  {
    file: 'src/lib/site-availability.ts',
    label: 'gameSlugFromType',
    pick: (source) => [functionBody(source, 'gameSlugFromType').replace(/\s+/g, ' ')],
  },
  {
    file: 'src/server/db/schema.ts',
    label: 'game_type columns',
    pick: (source) =>
      source
        .split('\n')
        .filter((line) => /game_type|gameType/.test(line))
        .map((line) => line.trim()),
  },
];

function parseRegistryKeys(source: string) {
  const entries = new Map<string, { href: string | null; sectionId: string | null; history: string | null }>();
  const slugPattern = /^ {4}slug: '([^']+)',/gm;
  const starts = [...source.matchAll(slugPattern)].map((match) => ({ slug: match[1]!, index: match.index! }));
  starts.forEach((start) => {
    const end = source.indexOf('\n  },', start.index);
    const slice = source.slice(start.index, end > 0 ? end : undefined);
    entries.set(start.slug, {
      href: slice.match(/^ {4}href: '([^']+)',/m)?.[1] ?? null,
      sectionId: slice.match(/^ {4}sectionId: '([^']+)',/m)?.[1] ?? null,
      history: slice.match(/^ {4}arcadeHistoryType: '([^']+)',/m)?.[1] ?? null,
    });
  });
  return entries;
}

const newGameSlugs = new Set([
  ...catalog.newGames.map((game) => game.slug),
  // A game reworked into a new one (derby royale into derby) keeps its slug
  // and may gain keys the way a new game does.
  ...catalog.games.filter((game) => game.work.includes('rework')).map((game) => game.slug),
]);

function checkStoredKeys() {
  const registryFile = 'src/features/arcade/components/arcade-game-registry.ts';
  const baseRegistry = gitShow(registryFile);
  if (baseRegistry === null) {
    const message = `base ref ${BASE_REF} is not available; stored-key comparison skipped`;
    if (process.env.FLOOR_REGISTRY_REQUIRE_BASE === '1') assert.fail(message);
    console.warn(`warn ${message}`);
    return;
  }

  const baseEntries = parseRegistryKeys(baseRegistry);
  assert.ok(baseEntries.size >= 69, 'the base registry has at least 69 entries');
  const current = new Map(ARCADE_GAMES.map((game) => [game.slug, game]));
  for (const [slug, base] of baseEntries) {
    const now: ArcadeGameEntry | undefined = current.get(slug);
    assert.ok(now, `registry slug ${slug} was removed`);
    assert.equal(now.href, base.href, `${slug}: href changed`);
    assert.equal(now.sectionId, base.sectionId, `${slug}: sectionId changed`);
    assert.equal(now.arcadeHistoryType ?? null, base.history, `${slug}: arcadeHistoryType changed`);
  }
  ok(`registry slugs, hrefs, sections and history types unchanged against ${BASE_REF} (${baseEntries.size} entries)`);

  for (const check of STORED_KEY_CHECKS) {
    const baseSource = gitShow(check.file);
    assert.ok(baseSource !== null, `${check.file} exists on ${BASE_REF}`);
    const nowSource = readFileSync(path.join(root, check.file), 'utf8');
    const base = check.pick(baseSource);
    const now = check.pick(nowSource);
    // Additive only: every base key is still there, in order, and anything
    // after them is a new game's slug from catalog-rev2.json's newGames.
    assert.deepEqual(now.slice(0, base.length), base, `${check.label} in ${check.file} changed`);
    for (const added of now.slice(base.length)) {
      assert.ok(
        // A new ticket machine's wager type is its slug with the arcade- prefix.
        newGameSlugs.has(added) || newGameSlugs.has(added.replace(/^arcade-/, '')) || MODE_KEYS.has(added),
        `${check.label} in ${check.file} gained "${added}", which is not a new game in the catalog`,
      );
    }
  }
  ok(`${STORED_KEY_CHECKS.length} stored-key declarations unchanged (game types, store types, multiplayer types, db columns)`);
}

/* ------------------------------------------------------------------ */
/* Redirects                                                           */
/* ------------------------------------------------------------------ */

const PAGE_FILES = ['page.tsx', 'page.ts', 'page.jsx', 'page.js'];

function hasPage(dir: string): boolean {
  return PAGE_FILES.some((file) => existsSync(path.join(dir, file)));
}

/* Does a page route exist? Route groups like (games) are transparent and
   dynamic [segments] match anything. */
function pageExists(routePath: string, dir = appDir, segments?: string[]): boolean {
  const parts = segments ?? routePath.split('/').filter(Boolean);
  const children = readdirSync(dir).filter((name) => statSync(path.join(dir, name)).isDirectory());
  if (parts.length === 0) {
    if (hasPage(dir)) return true;
    return children
      .filter((name) => /^\(.+\)$/.test(name))
      .some((name) => pageExists(routePath, path.join(dir, name), []));
  }
  const [head, ...rest] = parts;
  for (const name of children) {
    if (/^\(.+\)$/.test(name)) {
      if (pageExists(routePath, path.join(dir, name), parts)) return true;
    } else if (name === head) {
      if (pageExists(routePath, path.join(dir, name), rest)) return true;
    } else if (/^\[[^\]]+\]$/.test(name)) {
      if (pageExists(routePath, path.join(dir, name), rest)) return true;
    }
  }
  return false;
}

const pathOnly = (url: string) => url.split(/[?#]/)[0]!;

async function checkRedirects() {
  assert.ok(nextConfig.redirects, 'next.config.ts defines redirects()');
  const redirects = await nextConfig.redirects();
  const bySource = new Map(redirects.map((redirect) => [redirect.source, redirect]));
  assert.equal(bySource.size, redirects.length, 'no redirect source is listed twice');

  // Rename redirects are permanent and end at a route served by a rewrite, so
  // checkRenames covers them. Every other redirect keeps the rules below.
  const renameSources = new Set(gameRenameRoutes(true).redirects.map((redirect) => redirect.source));
  const plainRedirects = redirects.filter((redirect) => !renameSources.has(redirect.source));
  for (const redirect of redirects) {
    assert.ok(!redirect.source.startsWith('/api'), `${redirect.source}: redirects never start under /api`);
    assert.ok(!redirect.destination.startsWith('/api'), `${redirect.source}: destination is not under /api`);
  }
  for (const redirect of plainRedirects) {
    assert.equal(redirect.permanent, false, `${redirect.source}: redirects are 307, not permanent`);
    assert.ok(pageExists(pathOnly(redirect.destination)), `${redirect.source}: target ${redirect.destination} is a page route that exists`);
    assert.ok(!bySource.has(pathOnly(redirect.destination)), `${redirect.source}: target ${redirect.destination} does not redirect again`);
    assert.notEqual(pathOnly(redirect.destination), redirect.source, `${redirect.source}: does not redirect to itself`);
  }
  ok(`${plainRedirects.length} redirects: none under /api, all 307, every target is a page that exists`);

  // Game routes: every registry href must still be a page, and the redirects
  // follow the placements exactly.
  const hrefs = new Map(ARCADE_GAMES.map((game) => [game.href, game]));
  for (const game of ARCADE_GAMES) {
    assert.ok(pageExists(game.href), `${game.slug}: ${game.href} still has its page, so retired games keep their code`);
  }

  const gameRedirects = redirects.filter((redirect) => hrefs.has(redirect.source));
  for (const redirect of gameRedirects) {
    const game = hrefs.get(redirect.source)!;
    assert.ok(
      game.placement.status === 'retired' || game.placement.status === 'merged',
      `${game.slug} is ${game.placement.status} and must not redirect`,
    );
    assert.ok(!redirect.source.includes(':') && !redirect.source.includes('*'), `${redirect.source}: exact source`);
  }
  // Gunrush, swerve, connections, packs and stoplight are off the floor but
  // wait for their redirects (see the comments in next.config.ts). Adding one
  // here means updating this list and clearing the live-system check below.
  assert.deepEqual(
    gameRedirects.map((redirect) => redirect.source).sort(),
    ['/cases'],
    'only /cases redirects today',
  );

  // A merged game redirects only to a page that exists, and may wait.
  for (const game of ARCADE_GAMES) {
    if (game.placement.status !== 'merged') continue;
    const redirect = bySource.get(game.href);
    if (!redirect) continue;
    assert.ok(
      pageExists(`/${game.placement.into}`),
      `${game.slug} must not redirect until /${game.placement.into} exists`,
    );
    assert.equal(redirect.destination, `/${game.placement.into}`);
  }
  ok('merged games redirect only to a page that exists (reaction time and tumbler wait on live systems, see next.config.ts)');

  for (const game of getFloorGames().concat(getReserveGames())) {
    assert.ok(!bySource.has(game.href), `${game.slug} is listed and keeps its route`);
  }
  ok('floor and reserve routes are never redirected');
}

/* ------------------------------------------------------------------ */
/* Live systems that name a game                                       */
/* ------------------------------------------------------------------ */

const readSource = (file: string) => readFileSync(path.join(root, file), 'utf8');
const slugOf = (name: string) => name.replace(/^arcade-/, '');
const matches = (text: string, pattern: RegExp) =>
  new Set([...text.matchAll(pattern)].map((match) => slugOf(match[1]!)));

/* Where each live system names its games. A game one of these still points
   at must stay playable at its own route, so it cannot redirect. */
function liveSystems(): Record<string, Set<string>> {
  // The featured and tour pools switch to the floor's on FLOOR_POOLS_FROM, so
  // what is live is the pool today plus the pool from that Monday on.
  const today = new Date().toISOString().slice(0, 10);
  const featured = new Set<string>();
  const tour = new Set<string>();
  for (const key of [today, FLOOR_POOLS_FROM]) {
    for (const slug of getFeaturedPool(key)) featured.add(slugOf(slug));
    for (const games of getTourGroups(key)) for (const game of games) tour.add(slugOf(game.slug));
  }
  const dailyQuests = DAILY_QUEST_TEMPLATES.flatMap((quest) => (quest.targetGame ? [slugOf(quest.targetGame)] : []));
  return {
    // Daily pool, plus the weekly and season ladders still in season-0.ts.
    'season 0 quests': new Set([
      ...matches(readSource('src/server/arcade/battlepass/season-0.ts'), /targetGame: '([^']+)'/g),
      ...dailyQuests,
    ]),
    'featured pool': featured,
    'tour pool': tour,
    // Retired achievements are not live: only holders see them, and a game
    // that redirects has nothing left to unlock. Listed ones are.
    achievements: new Set(
      ACHIEVEMENTS.filter((a) => !isRetiredAchievement(a) && a.game).map((a) => a.game!),
    ),
    'store catalog': matches(readSource('scripts/seed-cosmetics.ts'), /^add\('([^']+)'/gm),
    // The weekly paid boards' candidates. The monthly award is retired from
    // 2026-10, and its season 0 list only pays months before that.
    'weekly boards': new Set<string>(WEEKLY_BOARD_CANDIDATES),
  };
}

/* From FLOOR_POOLS_FROM the daily quest, featured and tour pools are built from
   the floor. Their source lists (before the isOnFloor filter) must name floor
   games only, so a game leaving the floor is the only way one drops out.
   The weekly and season ladders are not pools; they change with the weekly
   card and the season. */
function checkFloorBuiltPools() {
  const offFloor = (slugs: Iterable<string>) => [...new Set(slugs)].filter((slug) => !isOnFloor(slug));
  const dailySlugs = DAILY_QUEST_TEMPLATES.flatMap((quest) => (quest.targetGame ? [quest.targetGame] : []));
  assert.deepEqual(offFloor(dailySlugs), [], 'daily quest pool names only floor games');
  assert.ok(new Set(dailySlugs).size >= 7, 'daily quest pool covers the floor skill games');
  assert.ok(
    DAILY_QUEST_TEMPLATES.some((quest) => quest.key === 'earn-250') &&
      !DAILY_QUEST_TEMPLATES.some((quest) => quest.key === 'earn-300'),
    'earn 250 replaces earn 300 in the daily pool',
  );

  const featuredSource = getFeaturedPool(FLOOR_POOLS_FROM, () => true);
  assert.deepEqual(offFloor(featuredSource), [], 'featured pool names only floor games');
  assert.ok(featuredSource.length >= 7, 'featured pool has the 7 solo skill games');

  const tourSource = getTourGroups(FLOOR_POOLS_FROM, () => true).flatMap((games) => games.map((game) => game.slug));
  assert.deepEqual(offFloor(tourSource), [], 'tour pool names only floor games');
  assert.equal(getTourGroups(FLOOR_POOLS_FROM).length, 3, 'tour has its 3 groups');
  ok('daily quest, featured and tour pools name only floor games (from ' + FLOOR_POOLS_FROM + ')');
}

function checkLiveSystems() {
  const systems = liveSystems();
  for (const [name, games] of Object.entries(systems)) {
    assert.ok(games.size >= 5, `${name}: found its games (${games.size})`);
  }
  // The extractors must see the games that block the deferred redirects.
  assert.ok(systems['season 0 quests']!.has('swerve'), 'quest ladders name swerve (weekly w4-swerve-6)');
  assert.ok(systems.achievements!.has('snake'), 'listed achievements name snake');
  assert.ok(!systems.achievements!.has('swerve'), 'swerve achievements are retired, not listed');
  assert.ok(systems['store catalog']!.has('connections'), 'store catalog names connections');

  return systems;
}

async function checkRedirectsAgainstLiveSystems() {
  const systems = checkLiveSystems();
  const redirects = await nextConfig.redirects!();
  const redirected = ARCADE_GAMES.filter((game) =>
    redirects.some((redirect) => redirect.source === game.href),
  );
  for (const game of redirected) {
    for (const [name, games] of Object.entries(systems)) {
      assert.ok(
        !games.has(game.slug),
        `${game.href} redirects but ${name} still names ${game.slug}; report it and keep the page`,
      );
    }
  }
  ok(`no redirected game (${redirected.map((game) => game.slug).join(', ')}) is named by the quest, featured, tour, achievement, store or award systems`);

  // For the record: which off-floor games are held back, and by what.
  for (const game of ARCADE_GAMES) {
    if (game.placement.status === 'floor' || game.placement.status === 'reserve') continue;
    if (redirected.includes(game)) continue;
    const by = Object.entries(systems).filter(([, games]) => games.has(game.slug)).map(([name]) => name);
    if (by.length > 0) console.log(`    ${game.slug} keeps its page: ${by.join(', ')}`);
  }
}

/* ------------------------------------------------------------------ */
/* Rename map                                                          */
/* ------------------------------------------------------------------ */

const RENAMES: [slug: string, name: string, title: string, from: string, route: string, original: string][] = [
  ['skee-ball', 'ring roll', 'Ring Roll', '/skee-ball', '/ring-roll', 'Skee-Ball'],
  ['plinko', 'peg drop', 'Peg Drop', '/plinko', '/peg-drop', 'Plinko'],
  ['connect-four', 'four up', 'Four Up', '/connect-four', '/four-up', 'Connect Four'],
  ['battleship', 'fleet', 'Fleet', '/battleship', '/fleet', 'Battleship'],
  ['tetris', 'blockfall', 'Blockfall', '/tetris', '/blockfall', 'Tetris'],
  ['breakout', 'brick bash', 'Brick Bash', '/breakout', '/brick-bash', 'Breakout'],
  ['flappy-bird', 'flap', 'Flap', '/flappy-bird', '/flap', 'Flappy Bird'],
];

/* Every helper takes the flag as an argument, so both states run here whatever
   the environment says. */
function checkRenameStates() {
  assert.equal(Object.keys(GAME_RENAMES).length, RENAMES.length, 'seven renames');
  const routes = new Set<string>();
  const existingRedirectSources = new Set(
    ((nextConfigRedirects ?? []) as { source: string }[]).map((redirect) => redirect.source),
  );

  const off = gameRenameRoutes(false);
  assert.deepEqual(off, { redirects: [], rewrites: [] }, 'flag off: no redirects and no rewrites');
  const on = gameRenameRoutes(true);
  assert.equal(on.redirects.length, RENAMES.length);
  assert.equal(on.rewrites.length, RENAMES.length);

  for (const [slug, name, title, from, route, original] of RENAMES) {
    const game = ARCADE_GAMES.find((entry) => entry.slug === slug);
    assert.ok(game, `rename for ${slug}: slug is in the registry`);
    const rename = GAME_RENAMES[slug];
    assert.ok(rename, `${slug}: has a rename`);
    assert.equal(rename.name, name, `${slug}: new name`);
    assert.equal(rename.route, route, `${slug}: new route`);
    assert.equal(rename.from, from, `${slug}: old route`);
    assert.equal(rename.name, rename.name.toLowerCase(), `${slug}: renamed name is lowercase`);
    assert.ok(!routes.has(route), `${slug}: route is unique`);
    routes.add(route);

    // Stored keys: the old route is the registry href and the page's real path.
    assert.equal(game.href, from, `${slug}: registry href stays the old route`);
    assert.equal(`/${slug}`, from, `${slug}: slug is the old route`);
    assert.ok(pageExists(from), `${slug}: ${from} is the page that serves the game`);
    assert.ok(!pageExists(route), `${slug}: ${route} is not a page of its own`);
    assert.ok(!existingRedirectSources.has(route), `${slug}: ${route} is not an existing redirect`);

    // Flag off: nothing changes.
    assert.equal(getGameRename(slug, false), null);
    assert.equal(getGameDisplayName(slug, original, false), original);
    assert.equal(getGameTitle(slug, original, false), original);
    assert.equal(getGameDisplayRoute(slug, from, false), from);
    assert.equal(renamedPath(`${from}/12?x=1`, false), `${from}/12?x=1`);
    assert.equal(canonicalGamePath(`${route}/12`, false), `${route}/12`);
    assert.equal(renameGameNamesInText(`Play ${original} now.`, false), `Play ${original} now.`);

    // Flag on: names, routes and both directions.
    assert.equal(getGameRename(slug, true)?.name, name);
    assert.equal(getGameDisplayName(slug, original, true), name);
    assert.equal(getGameTitle(slug, original, true), title);
    assert.equal(getGameDisplayRoute(slug, from, true), route);
    assert.equal(renamedPath(from, true), route, `${slug}: old route maps to new`);
    assert.equal(renamedPath(`${from}/12?x=1`, true), `${route}/12?x=1`, `${slug}: nested route and query kept`);
    assert.equal(renamedPath(`${from}?join=7`, true), `${route}?join=7`, `${slug}: query kept`);
    assert.equal(renamedPath(`${from}-extra`, true), `${from}-extra`, `${slug}: a longer route is not touched`);
    assert.equal(canonicalGamePath(route, true), from, `${slug}: new route maps back`);
    assert.equal(canonicalGamePath(`${route}/12`, true), `${from}/12`, `${slug}: nested new route maps back`);
    assert.equal(canonicalGamePath(`${route}-extra`, true), `${route}-extra`);
    assert.equal(renameGameNamesInText(`Play ${original} now.`, true), `Play ${title} now.`, `${slug}: text rename`);
    assert.equal(renameGameNamesInText(original.toUpperCase(), true), name.toUpperCase(), `${slug}: uppercase text rename`);
    assert.equal(
      renameGameNamesInText(`play ${original.toLowerCase()}`, true),
      `play ${name}`,
      `${slug}: lowercase text rename`,
    );

    const redirect = on.redirects.find((rule) => rule.source.startsWith(`${from}/`));
    assert.deepEqual(
      redirect,
      { source: `${from}/:path*`, destination: `${route}/:path*`, permanent: true },
      `${slug}: old route and everything under it redirects permanently to the new route`,
    );
    const rewrite = on.rewrites.find((rule) => rule.source.startsWith(`${route}/`));
    assert.deepEqual(
      rewrite,
      { source: `${route}/:path*`, destination: `${from}/:path*` },
      `${slug}: the new route and everything under it serves the old page`,
    );
    for (const rule of [...on.redirects, ...on.rewrites]) {
      assert.ok(!rule.source.startsWith('/api') && !rule.destination.startsWith('/api'), `${slug}: rules stay off /api`);
    }
  }
  // Nested routes the redirect has to carry.
  for (const nested of ['/connect-four/[id]', '/battleship/[id]']) {
    assert.ok(pageExists(nested.replace('[id]', '123')), `${nested} exists`);
  }
  ok('7 renames: flag off changes nothing; flag on resolves both ways with the query kept, names and keys as planned');
}

let nextConfigRedirects: unknown[] | undefined;

async function checkRenames() {
  nextConfigRedirects = await nextConfig.redirects!();
  const env = process.env.NEXT_PUBLIC_GAME_RENAMES === '1';
  assert.equal(GAME_RENAMES_ENABLED, env, 'the flag is NEXT_PUBLIC_GAME_RENAMES=1 and nothing else');
  assert.ok(
    /NEXT_PUBLIC_GAME_RENAMES === '1'/.test(readFileSync(path.join(root, 'src/features/arcade/lib/game-renames.ts'), 'utf8')),
    'the flag reads the environment, with no hard-coded true',
  );

  // Rename rules are filtered out of the redirects above, so compare the whole
  // set against the flag.
  const renameRedirects = (nextConfigRedirects as { source: string; permanent: boolean }[]).filter(
    (redirect) => RENAMES.some(([, , , from]) => redirect.source === `${from}/:path*`),
  );
  const rewrites = (await nextConfig.rewrites!()) as { source: string }[];
  assert.equal(renameRedirects.length, env ? RENAMES.length : 0, 'next.config.ts redirects follow the flag');
  assert.equal(rewrites.length, env ? RENAMES.length : 0, 'next.config.ts rewrites follow the flag');
  for (const redirect of renameRedirects) assert.equal(redirect.permanent, true, `${redirect.source}: permanent`);

  checkRenameStates();

  for (const [slug, , title, from, route, original] of RENAMES) {
    const game = ARCADE_GAMES.find((entry) => entry.slug === slug)!;
    assert.equal(game.href, from, `${slug}: registry href never changes`);
    assert.equal(game.title, env ? title : original, `${slug}: registry title follows the flag`);
    if (env) assert.equal(game.routeLabel, title, `${slug}: nav label follows the flag`);
    assert.equal(getGameDisplayRoute(slug, game.href), env ? route : from);
  }
  ok(env ? 'flag ON: registry titles, redirects and rewrites carry the new names' : 'flag OFF: registry titles, redirects and rewrites are untouched');
}

checkCatalog();
checkFloor();
checkStoredKeys();
await checkRedirects();
checkFloorBuiltPools();
await checkRedirectsAgainstLiveSystems();
await checkRenames();
console.log(`\nfloor registry: ${passed} checks passed`);
