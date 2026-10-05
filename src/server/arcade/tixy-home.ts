import 'server-only';

/* The tixy home's data. The page reads it once, in one parallel pass; each
   part fails on its own and comes back null, so a slow or broken table never
   takes the page down. Only the live part (getTixyHomeLive: who is waiting,
   whose move it is, friends on now, tables open) is read again by
   /api/home/live, and it is kept cheap: indexed lookups for the player, plus
   public numbers cached in memory. Nothing here writes, except the store's
   daily rotation, which /api/store already creates on first read. */

import type {
  HomeCounter,
  HomeDaily,
  HomeFriend,
  HomeLive,
  HomeMatchGame,
  HomeOnNow,
  HomePrize,
  HomeRecord,
  HomeTables,
  HomeTileFact,
  HomeTurn,
  HomeWaiting,
  TixyHomeData,
} from '@/features/arcade/components/home/tixy-home-types';
import { getArcadeGameBySlug, getFloorGames } from '@/features/arcade/components/arcade-game-registry';
import { getPinnedPrize } from '@/server/arcade/rewards/counter';
import { currentWeeklyBoardGames } from '@/server/arcade/rewards/weekly-boards';
import { WEEKLY_BOARD_PRIZES } from '@/features/arcade/lib/weekly-boards';
import { getGameDisplayName } from '@/features/arcade/lib/game-renames';
import { GLOBAL_ITEM_OWNER_ID } from '@/features/arcade/lib/rewards';
import { FEATURED_CREDIT_MULTIPLIER, getFeaturedGameType } from '@/server/arcade/featured-game';
import { getMultiplayerActivitySnapshot } from '@/server/arcade/multiplayer-activity';
import { getDailyClaimStatus } from '@/server/arcade/rewards/daily-claim';
import { DAILY_WHEEL_MULTIPLIERS, DAILY_WHEEL_TOP, wheelMultiplier } from '@/features/arcade/lib/daily-wheel';
import { getServerDateKey } from '@/server/arcade/rewards/helpers';
import { generateStoreDailyRotation, getStoreVisibilityConfig } from '@/server/arcade/rewards/store';
import { getDayNumber, getUtcDateKey } from '@/server/arcade/word-grid';
import { getTrickShotTable } from '@/server/arcade/trick-shot';
import { mgDateKey } from '@/server/arcade/mini-golf-course';
import { mgCourseCached } from '@/server/arcade/mini-golf-round';
import { trickShotDateKey } from '@/features/arcade/lib/trick-shot/rules';
import { query } from '@/server/db/client';
import { getFriendsPresence } from '@/server/realtime/presence';
import { listFriendSummaries } from '@/server/social/friends';

const MATCH_GAMES: readonly HomeMatchGame[] = ['8-ball', 'chess', 'connect-four'];

const MATCH_TABLES: Record<HomeMatchGame, string> = {
  '8-ball': 'pool_matches',
  chess: 'chess_matches',
  'connect-four': 'connect_four_matches',
};

/* Only pool_matches has hardcore_mode. */
const HARDCORE_SQL: Record<HomeMatchGame, string> = {
  '8-ball': 'm.hardcore_mode',
  chess: 'false',
  'connect-four': 'false',
};

const ELO_TABLES: Record<HomeMatchGame, string> = {
  '8-ball': 'pool_elo',
  chess: 'chess_elo',
  'connect-four': 'connect_four_elo',
};

/* One row per player in each (unique on od_user_id). */
const BEST_TABLES: Record<string, string> = {
  'skee-ball': 'skee_ball_scores',
  'high-striker': '(SELECT * FROM high_striker_scores WHERE rules = 3) hs',
  'tin-duck': '(SELECT * FROM tin_duck_scores WHERE rules = 2) td',
  snake: 'snake_scores',
  '2048': 'game_2048_scores',
  stack: '(SELECT * FROM stack_scores WHERE rules = 2) sk',
  'flappy-bird': 'flappy_bird_scores',
  ricochet: 'ricochet_scores',
  // Ring toss
  'ring-toss': 'ring_toss_scores',
};

/* A public table counts while its owner was seen in the last 90 s, the same
   rule multiplayer-activity uses. */
const PRESENCE_FRESH_MS = 90_000;
const REMATCH_WINDOW_MS = 24 * 60 * 60 * 1000;
/* A turn older than this is a game nobody is coming back to. */
const TURN_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;
const RECORD_SIZE = 10;
const RECORD_MIN = 5;
const ACTIVITY_TTL_MS = 20_000;
const TOP_SCORES_TTL_MS = 30_000;

async function settle<T>(promise: Promise<T>, label: string): Promise<T | null> {
  try {
    return await promise;
  } catch (error) {
    console.error(`[tixy-home] ${label} failed:`, error);
    return null;
  }
}

const num = (value: unknown) => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

/* A value shared by every player, kept in memory for `ttl` ms. One read at a
   time: callers that arrive while it loads share the same promise. */
function memo<T>(ttl: number, load: () => Promise<T>) {
  let value: { at: number; data: T } | null = null;
  let pending: Promise<T> | null = null;
  return async (): Promise<T> => {
    if (value && Date.now() - value.at < ttl) return value.data;
    pending ??= load()
      .then((data) => {
        value = { at: Date.now(), data };
        return data;
      })
      .finally(() => {
        pending = null;
      });
    return pending;
  };
}

/* ── public numbers, cached ──────────────────────────────────────────── */

const readTables = memo(ACTIVITY_TTL_MS, async (): Promise<HomeTables> => {
  const snapshot = await getMultiplayerActivitySnapshot();
  const tables = {} as HomeTables;
  for (const game of MATCH_GAMES) {
    const entry = snapshot.games.find((row) => row.gameType === game);
    tables[game] = { open: entry?.openLobbies ?? 0, live: entry?.liveMatches ?? 0 };
  }
  return tables;
});

const readTopScores = memo(TOP_SCORES_TTL_MS, async () => {
  const result = await query<{ key: string; top: string | number | null }>(
    Object.entries(BEST_TABLES)
      .map(([slug, table]) => `SELECT '${slug}' AS key, (SELECT MAX(score) FROM ${table})::bigint AS top`)
      .join(' UNION ALL '),
  );
  return new Map(result.rows.map((row) => [row.key, row.top == null ? null : num(row.top)]));
});

/* ── friends, invites and turns ──────────────────────────────────────── */

type MatchRow = {
  game: HomeMatchGame;
  id: string;
  kind: 'invite' | 'table' | 'turn';
  player1Id: string;
  player1Name: string;
  opponentName: string | null;
  wager: string | number | null;
  hardcore: boolean | null;
  createdAt: string | number;
  rematch: boolean;
};

/* Three narrow selects per game, each on an indexed column: invited_user_id,
   player1_id (friends' tables), player1_id or player2_id (your turns, bounded
   by updated_at). $1 me, $2 presence cutoff, $3 rematch cutoff, $4 turn
   cutoff. */
function matchSql(game: HomeMatchGame) {
  const table = MATCH_TABLES[game];
  const hardcore = HARDCORE_SQL[game];
  const columns = (kind: string) => `
    '${game}' AS game, m.id, '${kind}' AS kind,
    m.player1_id AS "player1Id", m.player1_name AS "player1Name",
    CASE WHEN m.player1_id = $1 THEN m.player2_name ELSE m.player1_name END AS "opponentName",
    m.wager_amount AS wager, ${hardcore} AS hardcore, m.created_at AS "createdAt"`;
  const rematch = `EXISTS (
    SELECT 1 FROM ${table} p
    WHERE p.status IN ('completed', 'forfeited') AND p.updated_at >= $3
      AND ((p.player1_id = $1 AND p.player2_id = m.player1_id)
        OR (p.player2_id = $1 AND p.player1_id = m.player1_id)))`;
  return `
    SELECT ${columns('invite')}, ${rematch} AS rematch
    FROM ${table} m
    WHERE m.invited_user_id = $1 AND m.status = 'waiting' AND m.player2_id IS NULL AND m.player1_id <> $1
    UNION ALL
    SELECT ${columns('table')}, false AS rematch
    FROM ${table} m
    WHERE m.player1_id IN (
            SELECT CASE WHEN f.user_a_id = $1 THEN f.user_b_id ELSE f.user_a_id END
            FROM arcade_friendships f
            WHERE f.status = 'accepted' AND (f.user_a_id = $1 OR f.user_b_id = $1))
      AND m.status = 'waiting' AND m.invited_user_id IS NULL AND m.player2_id IS NULL
      AND EXISTS (
        SELECT 1 FROM arcade_user_presence pr
        WHERE pr.user_id = m.player1_id AND pr.status <> 'offline' AND pr.last_seen_at >= $2)
    UNION ALL
    SELECT ${columns('turn')}, false AS rematch
    FROM ${table} m
    WHERE (m.player1_id = $1 OR m.player2_id = $1)
      AND m.status = 'active' AND m.current_turn = $1 AND m.updated_at >= $4
      AND m.player2_id IS NOT NULL AND m.player2_id NOT LIKE 'bot:%'
  `;
}

async function readMatches(userId: string, now: number) {
  const sql = `
    SELECT * FROM (${MATCH_GAMES.map(matchSql).join(' UNION ALL ')}) rows
    ORDER BY "createdAt" DESC
    LIMIT 24
  `;
  const result = await query<MatchRow>(sql, [
    userId,
    now - PRESENCE_FRESH_MS,
    now - REMATCH_WINDOW_MS,
    now - TURN_WINDOW_MS,
  ]);
  const waiting: HomeWaiting[] = [];
  const turns: HomeTurn[] = [];
  for (const row of result.rows) {
    if (row.kind === 'turn') {
      turns.push({ game: row.game, matchId: row.id, opponent: row.opponentName ?? 'someone' });
      continue;
    }
    const wager = row.wager == null ? 0 : num(row.wager);
    waiting.push({
      kind: row.kind,
      game: row.game,
      matchId: row.id,
      userId: row.player1Id,
      name: row.player1Name,
      rematch: row.kind === 'invite' && Boolean(row.rematch),
      wager: wager > 0 ? wager : null,
      hardcore: Boolean(row.hardcore),
      createdAt: num(row.createdAt),
    });
  }
  // Invites first, then friends' open tables. One open table per friend.
  const seenTables = new Set<string>();
  const ordered = [
    ...waiting.filter((entry) => entry.kind === 'invite'),
    ...waiting.filter((entry) => {
      if (entry.kind !== 'table' || seenTables.has(entry.userId)) return false;
      seenTables.add(entry.userId);
      return true;
    }),
  ];
  return { waiting: ordered.slice(0, 4), turns: turns.slice(0, 4) };
}

async function readOnNow(userId: string, now: number): Promise<HomeOnNow> {
  const [relationships, presence, matches] = await Promise.all([
    listFriendSummaries(userId),
    getFriendsPresence(userId),
    readMatches(userId, now),
  ]);
  const byId = new Map(relationships.friends.map((friend) => [friend.userId, friend]));
  const rank = { in_game: 0, online: 1, away: 2 } as const;
  const friends: HomeFriend[] = presence
    .filter((entry) => entry.status !== 'offline' && byId.has(entry.userId))
    .map((entry) => {
      const friend = byId.get(entry.userId)!;
      return {
        userId: entry.userId,
        name: friend.name,
        imageUrl: friend.imageUrl,
        status: entry.status as HomeFriend['status'],
        gameSlug: entry.status === 'in_game' ? entry.gameSlug : null,
      };
    })
    .sort((a, b) => rank[a.status] - rank[b.status] || a.name.localeCompare(b.name));
  return {
    ...matches,
    friends: friends.slice(0, 6),
    onlineCount: friends.length,
    friendCount: relationships.friends.length,
  };
}

/* ── your ratings, bests and 8-ball record ───────────────────────────── */

type StatRow = { key: string; mine: string | number | null; extra: string | number | null };

/* Indexed lookups for one player: user_id and od_user_id are unique keys. */
async function readMyStats(userId: string) {
  const parts: string[] = [];
  for (const [game, table] of Object.entries(ELO_TABLES)) {
    parts.push(
      `SELECT '${game}' AS key, (SELECT elo_rating FROM ${table} WHERE user_id = $1 AND total_games > 0)::bigint AS mine, NULL::bigint AS extra`,
    );
  }
  for (const [slug, table] of Object.entries(BEST_TABLES)) {
    parts.push(
      `SELECT '${slug}' AS key, (SELECT MAX(score) FROM ${table} WHERE od_user_id = $1)::bigint AS mine, NULL::bigint AS extra`,
    );
  }
  parts.push(
    `SELECT 'word-grid' AS key,
            (SELECT guesses FROM word_grid_scores WHERE od_user_id = $1 AND puzzle_date = $2)::bigint AS mine,
            (SELECT CASE WHEN solved THEN 1 ELSE 0 END FROM word_grid_scores WHERE od_user_id = $1 AND puzzle_date = $2)::bigint AS extra`,
  );
  // Derby: races won.
  parts.push(
    `SELECT 'derby' AS key, (SELECT NULLIF(wins, 0) FROM derby_stats WHERE od_user_id = $1)::bigint AS mine, NULL::bigint AS extra`,
  );
  parts.push(
    `SELECT 'mini-golf' AS key,
            (SELECT strokes FROM mini_golf_rounds WHERE od_user_id = $1 AND round_date = $2 AND finished_at IS NOT NULL)::bigint AS mine,
            (SELECT holes_done FROM mini_golf_rounds WHERE od_user_id = $1 AND round_date = $2)::bigint AS extra`,
  );
  // Bumper cars: your best round's score, and the floor's best (the index on
  // finished scores answers it).
  parts.push(
    `SELECT 'bumper-cars' AS key,
            (SELECT MAX(score) FROM bumper_car_players WHERE user_id = $1 AND result IN ('finished', 'timeout'))::bigint AS mine,
            (SELECT score FROM bumper_car_players WHERE result = 'finished' ORDER BY score DESC LIMIT 1)::bigint AS extra`,
  );
  parts.push(
    `SELECT 'trick-shot' AS key,
            (SELECT pots FROM trick_shot_attempts WHERE od_user_id = $1 AND puzzle_date = $2 AND status = 'shot')::bigint AS mine,
            (SELECT CASE WHEN clear THEN 1 ELSE 0 END FROM trick_shot_attempts WHERE od_user_id = $1 AND puzzle_date = $2 AND status = 'shot')::bigint AS extra`,
  );
  const result = await query<StatRow>(parts.join(' UNION ALL '), [userId, getUtcDateKey()]);
  return new Map(result.rows.map((row) => [row.key, row]));
}

async function readPoolRecord(userId: string): Promise<HomeRecord | null> {
  const result = await query<{ won: boolean }>(
    `SELECT (winner_id = $1) AS won
     FROM pool_matches
     WHERE (player1_id = $1 OR player2_id = $1)
       AND status IN ('completed', 'forfeited')
       AND winner_id IS NOT NULL
     ORDER BY updated_at DESC
     LIMIT ${RECORD_SIZE}`,
    [userId],
  );
  if (result.rows.length < RECORD_MIN) return null;
  return { won: result.rows.filter((row) => row.won).length, played: result.rows.length };
}

/* ── the daily spin ──────────────────────────────────────────────────── */

const dayAt = (day: number) => ({ day, multiplier: wheelMultiplier(day) });

async function readDaily(userId: string | null): Promise<HomeDaily> {
  if (!userId) return { state: 'guest', top: DAILY_WHEEL_TOP * Math.max(...DAILY_WHEEL_MULTIPLIERS) };
  const status = await getDailyClaimStatus(userId);
  if (status.claimed) {
    const spin = status.wheel.spin;
    return {
      state: 'claimed',
      tickets: status.claimedReward?.tickets ?? 0,
      streak: status.streak,
      todayKey: status.todayKey,
      spin: spin ? { unit: spin.unit, value: spin.value, multiplier: spin.multiplier, held: spin.held } : null,
      next: dayAt(status.streak + 1),
    };
  }
  if (!status.available || !status.nextReward) return { state: 'closed', streak: status.streak };
  const today = status.streak + 1;
  return {
    state: 'ready',
    streak: status.streak,
    day: today,
    multiplier: status.wheel.multiplier,
    top: status.wheel.top,
    tickets: status.nextReward.tickets,
    hold: status.hold,
    todayKey: status.todayKey,
    next: dayAt(today + 1),
  };
}

/* ── the prize counter ───────────────────────────────────────────────── */

export async function readCounter(userId: string | null): Promise<HomeCounter | null> {
  const dateKey = getServerDateKey();
  const [visibility, rotation, owned] = await Promise.all([
    getStoreVisibilityConfig(),
    generateStoreDailyRotation(dateKey),
    userId
      ? query<{ item_id: string }>(
          `SELECT item_id FROM user_owned_items WHERE user_id = ANY($1::text[])`,
          [[userId, GLOBAL_ITEM_OWNER_ID]],
        )
      : Promise.resolve({ rows: [] as { item_id: string }[] }),
  ]);
  if (!visibility.creditsEnabled || rotation.length === 0) return null;
  const ownedIds = new Set(owned.rows.map((row) => row.item_id));
  const seen = new Set<string>();
  const unowned: HomePrize[] = rotation
    .map((entry) => entry.item)
    .filter((item) => {
      // A rotation row can outlive its item being taken off sale.
      if (!item.active || ownedIds.has(item.id) || seen.has(item.id) || item.price <= 0) return false;
      seen.add(item.id);
      return true;
    })
    // The counter comes cheapest first, ties newest first.
    .map((item) => ({
      id: item.id,
      name: item.name.toLowerCase(),
      kind: describeItem(item.gameType, item.slots as string[]),
      price: item.price,
      gameType: item.gameType,
      slots: item.slots as string[],
      assetRef: item.assetRef,
      rarity: item.rarity,
    }));
  const pinnedId = userId ? await getPinnedPrize(userId).catch(() => null) : null;
  return { unowned, pinnedId };
}

const PROFILE_SLOTS: Record<string, string> = {
  avatar: 'avatar',
  frame: 'avatar frame',
  title: 'profile title',
  background: 'profile background',
  nameColor: 'name colour',
};

/* "8-ball table", "chess pieces", "flappy bird skin", "avatar frame". */
function describeItem(gameType: string, slots: string[]) {
  const slot = slots[0] ?? '';
  if (gameType === 'profile') return PROFILE_SLOTS[slot] ?? 'profile';
  const entry = getArcadeGameBySlug(gameType);
  const game = gameType === '8-ball' ? '8-ball' : (entry ? getGameDisplayName(entry.slug, entry.title) : gameType).toLowerCase();
  const word = slot.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[-_]/g, ' ').toLowerCase();
  if (!word) return game;
  return game.split(/\s+/).includes(word) ? `${game} skin` : `${game} ${word}`;
}

/* ── cabinet numbers ─────────────────────────────────────────────────── */

/* Every cabinet but the friends games, whose number the page works out from
   the live part (see friendsGameFact). Ticket machines get no number: a top
   multiplier on the floor sells the long shot (ROADMAP.md, R1). */
function buildFacts(mine: Map<string, StatRow> | null, tops: Map<string, number | null> | null) {
  const facts: Record<string, HomeTileFact> = {};
  for (const slug of Object.keys(BEST_TABLES)) {
    const best = mine?.get(slug)?.mine;
    const top = tops?.get(slug);
    if (best != null) facts[slug] = { kind: 'best', value: num(best), label: 'your best' };
    else if (top != null && top > 0) facts[slug] = { kind: 'top', value: top, label: 'top score' };
  }
  const word = mine?.get('word-grid');
  facts['word-grid'] = {
    kind: 'daily',
    dayNumber: getDayNumber(getUtcDateKey()),
    guesses: word?.mine != null ? num(word.mine) : null,
    solved: word?.extra != null ? num(word.extra) === 1 : null,
  };
  // Mini golf: your strokes today and how they stand to par, how far along
  // an open round is, else the day's par.
  try {
    const golf = mine?.get('mini-golf');
    const par = mgCourseCached(mgDateKey(Date.now())).par;
    const toPar = golf?.mine != null ? num(golf.mine) - par : 0;
    facts['mini-golf'] =
      golf?.mine != null
        ? {
            kind: 'best',
            value: num(golf.mine),
            label: toPar < 0 ? `today, ${-toPar} under` : toPar > 0 ? `today, ${toPar} over` : 'today, level par',
          }
        : golf?.extra != null && num(golf.extra) > 0
          ? { kind: 'best', value: num(golf.extra), label: 'of 9 holes today' }
          : { kind: 'top', value: par, label: 'par today' };
  } catch {
    /* no course, no number */
  }
  // Trick shot: your shot today ("2 of 3 today"), else the day's table.
  try {
    const table = getTrickShotTable(trickShotDateKey());
    const shot = mine?.get('trick-shot');
    facts['trick-shot'] =
      shot?.mine != null
        ? {
            kind: 'best',
            value: num(shot.mine),
            label: num(shot.extra) === 1 ? `of ${table.ballCount}, cleared` : `of ${table.ballCount} today`,
          }
        : { kind: 'top', value: table.ballCount, label: 'balls today' };
  } catch {
    /* no table, no number */
  }
  // Bumper cars: your best round, else the best round on the floor.
  {
    const cars = mine?.get('bumper-cars');
    if (cars?.mine != null) facts['bumper-cars'] = { kind: 'best', value: num(cars.mine), label: 'your best' };
    else if (cars?.extra != null) facts['bumper-cars'] = { kind: 'top', value: num(cars.extra), label: 'top score' };
  }
  // Derby: your wins, if any. A friends game with no win shows nothing.
  const derby = mine?.get('derby');
  if (derby?.mine != null) facts.derby = { kind: 'best', value: num(derby.mine), label: num(derby.mine) === 1 ? 'win' : 'wins' };
  // This week's paid boards say what first place wins. The featured game's
  // double tickets, below, still take its tile.
  for (const slug of currentWeeklyBoardGames()) {
    facts[slug] = { kind: 'paid', tickets: WEEKLY_BOARD_PRIZES[0] };
  }
  // Today's featured cabinet pays double. Only a floor game can show it.
  const featured = getFeaturedGameType(getServerDateKey());
  if (getFloorGames().some((game) => game.slug === featured)) {
    facts[featured] = { kind: 'featured', multiplier: FEATURED_CREDIT_MULTIPLIER };
  }
  return facts;
}

/* ── entry points ────────────────────────────────────────────────────── */

/* What changes minute to minute. Polled, so: the player's rows by index, the
   public counts from memory. */
export async function getTixyHomeLive(userId: string | null): Promise<HomeLive> {
  const [tables, onNow] = await Promise.all([
    settle(readTables(), 'tables'),
    userId ? settle(readOnNow(userId, Date.now()), 'on now') : Promise.resolve(null),
  ]);
  return { tables, onNow };
}

export async function getTixyHomeData(input: { userId: string | null }): Promise<TixyHomeData> {
  const { userId } = input;
  const [live, mine, tops, record, daily, counter] = await Promise.all([
    getTixyHomeLive(userId),
    userId ? settle(readMyStats(userId), 'my stats') : Promise.resolve(null),
    settle(readTopScores(), 'top scores'),
    userId ? settle(readPoolRecord(userId), 'pool record') : Promise.resolve(null),
    settle(readDaily(userId), 'daily claim'),
    settle(readCounter(userId), 'prize counter'),
  ]);
  const ratings: TixyHomeData['ratings'] = {};
  for (const game of MATCH_GAMES) {
    const rating = mine?.get(game)?.mine;
    if (rating != null) ratings[game] = num(rating);
  }
  return {
    ...live,
    userId,
    facts: buildFacts(mine, tops),
    ratings,
    record,
    daily,
    counter,
    questsTurnAtMs: nextServerMidnight(),
  };
}

/* Dailies are dated with getServerDateKey, the server's local day, so they
   turn over at its next local midnight. */
function nextServerMidnight(now: Date = new Date()): number {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime();
}
