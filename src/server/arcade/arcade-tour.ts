import { isOnFloor } from '@/features/arcade/components/arcade-game-registry';
import { getGameDisplayRoute, getGameTitle } from '@/features/arcade/lib/game-renames';
import crypto from 'node:crypto';

import { floorPoolsActive } from '@/server/arcade/floor-pools';
import { query } from '@/server/db/client';

export type ArcadeTourGame = {
  slug: string;
  title: string;
  href: string;
  metricLabel: string;
};

export type ArcadeTourGameResult = {
  slug: string;
  title: string;
  href: string;
  metricLabel: string;
  score: number;
  rank: number;
  points: number;
};

export type ArcadeTourStanding = {
  rank: number;
  userId: string;
  userName: string;
  points: number;
  badge: string;
  gamesCompleted: number;
  games: ArcadeTourGameResult[];
};

export type ArcadeTourState = {
  weekKey: string;
  startsAt: number;
  endsAt: number;
  games: ArcadeTourGame[];
  standings: ArcadeTourStanding[];
  viewer: ArcadeTourStanding | null;
  participantCount: number;
};

export type ArcadeTourScoreRow = {
  gameSlug: string;
  userId: string;
  userName: string;
  score: number;
};

const DAY_MS = 24 * 60 * 60 * 1000;
const TOUR_SIZE = 3;
const MAX_VISIBLE_STANDINGS = 50;

/* A tour is one game from each group. From FLOOR_POOLS_FROM the groups are
   these candidates filtered by isOnFloor() at pick time; before that Monday the
   legacy groups below still run, so a tour already under way doesn't change. */
const RAW_TOUR_GAME_GROUPS: readonly (readonly ArcadeTourGame[])[] = [
  [
    { slug: 'snake', title: 'Snake', href: '/snake', metricLabel: 'Score' },
    { slug: '2048', title: '2048', href: '/2048', metricLabel: 'Score' },
  ],
  [
    { slug: 'skee-ball', title: 'Skee-Ball', href: '/skee-ball', metricLabel: 'Score' },
    { slug: 'tin-duck', title: 'Tin Duck Gallery', href: '/tin-duck', metricLabel: 'Score' },
    { slug: 'high-striker', title: 'High Striker', href: '/high-striker', metricLabel: 'Score' },
  ],
  [
    { slug: 'stack', title: 'Stack', href: '/stack', metricLabel: 'Score' },
    { slug: 'ticket-stop', title: 'Ticket Stop', href: '/ticket-stop', metricLabel: 'Score' },
  ],
];

/** The tour before FLOOR_POOLS_FROM. Delete once that Monday has passed. */
const RAW_LEGACY_TOUR_GAME_GROUPS: readonly (readonly ArcadeTourGame[])[] = [
  [
    { slug: 'snake', title: 'Snake', href: '/snake', metricLabel: 'Score' },
    { slug: 'tetris', title: 'Tetris', href: '/tetris', metricLabel: 'Score' },
    { slug: '2048', title: '2048', href: '/2048', metricLabel: 'Score' },
    { slug: 'breakout', title: 'Breakout', href: '/breakout', metricLabel: 'Score' },
  ],
  [
    { slug: 'gopher', title: 'Gopher Pop', href: '/gopher', metricLabel: 'Score' },
    { slug: 'skee-ball', title: 'Skee-Ball', href: '/skee-ball', metricLabel: 'Score' },
    { slug: 'tin-duck', title: 'Tin Duck Gallery', href: '/tin-duck', metricLabel: 'Score' },
    { slug: 'melon-chop', title: 'Melon Chop', href: '/melon-chop', metricLabel: 'Score' },
    { slug: 'high-striker', title: 'High Striker', href: '/high-striker', metricLabel: 'Score' },
    { slug: 'boardwalk-hop', title: 'Boardwalk Hop', href: '/boardwalk-hop', metricLabel: 'Score' },
    { slug: 'gunrush', title: 'Gunrush', href: '/gunrush', metricLabel: 'Score' },
  ],
  [
    { slug: 'gem-swap', title: 'Gem Swap', href: '/gem-swap', metricLabel: 'Score' },
    { slug: 'sky-climber', title: 'Sky Climber', href: '/sky-climber', metricLabel: 'Height' },
    { slug: 'bubble-shooter', title: 'Bubble Shooter', href: '/bubble-shooter', metricLabel: 'Score' },
    { slug: 'swerve', title: 'Swerve', href: '/swerve', metricLabel: 'Score' },
    { slug: 'stack', title: 'Stack', href: '/stack', metricLabel: 'Score' },
    { slug: 'tumbler', title: 'Tumbler', href: '/tumbler', metricLabel: 'Score' },
    { slug: 'knife-booth', title: 'Knife Booth', href: '/knife-booth', metricLabel: 'Score' },
  ],
];

/* Display fields follow the rename map; the slug is the stored key. */
const withDisplayNames = (
  groups: readonly (readonly ArcadeTourGame[])[],
): readonly (readonly ArcadeTourGame[])[] =>
  groups.map((games) =>
    games.map((game) => ({
      ...game,
      title: getGameTitle(game.slug, game.title),
      href: getGameDisplayRoute(game.slug, game.href),
    })),
  );

const TOUR_GAME_GROUPS = withDisplayNames(RAW_TOUR_GAME_GROUPS);
const LEGACY_TOUR_GAME_GROUPS = withDisplayNames(RAW_LEGACY_TOUR_GAME_GROUPS);

/** The groups a week key picks from: floor games only from FLOOR_POOLS_FROM. */
export function getTourGroups(
  weekKey: string,
  onFloor: (slug: string) => boolean = isOnFloor,
): readonly (readonly ArcadeTourGame[])[] {
  if (!floorPoolsActive(weekKey)) return LEGACY_TOUR_GAME_GROUPS;
  return TOUR_GAME_GROUPS.map((games) => games.filter((game) => onFloor(game.slug))).filter(
    (games) => games.length > 0,
  );
}

function utcDateKey(timestamp: number) {
  return new Date(timestamp).toISOString().slice(0, 10);
}

export function getArcadeTourWeek(now = Date.now()) {
  const date = new Date(now);
  const day = date.getUTCDay();
  const daysSinceMonday = day === 0 ? 6 : day - 1;
  const startsAt = Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate() - daysSinceMonday,
  );
  return {
    weekKey: utcDateKey(startsAt),
    startsAt,
    endsAt: startsAt + 7 * DAY_MS,
  };
}

function deterministicIndex(weekKey: string, group: number, length: number) {
  const digest = crypto
    .createHash('sha256')
    .update(`arcade-tour:${weekKey}:${group}`)
    .digest();
  return digest.readUInt32BE(0) % length;
}

export function getArcadeTourGames(
  weekKey: string,
  onFloor: (slug: string) => boolean = isOnFloor,
): ArcadeTourGame[] {
  return getTourGroups(weekKey, onFloor)
    .map((games, group) => games[deterministicIndex(weekKey, group, games.length)]!)
    .slice(0, TOUR_SIZE);
}

function badgeForStanding(rank: number, gamesCompleted: number) {
  if (rank === 1) return 'Tour leader';
  if (rank <= 10) return 'Top 10';
  if (gamesCompleted === TOUR_SIZE) return 'Triple threat';
  return 'Tour contender';
}

export function scoreArcadeTourRows(
  games: ArcadeTourGame[],
  rows: ArcadeTourScoreRow[],
): ArcadeTourStanding[] {
  const byUser = new Map<string, Omit<ArcadeTourStanding, 'rank' | 'badge'>>();

  for (const game of games) {
    const ranked = rows
      .filter((row) => row.gameSlug === game.slug)
      .sort((a, b) => b.score - a.score || a.userId.localeCompare(b.userId));
    let rank = 0;
    let previousScore: number | null = null;

    ranked.forEach((row, index) => {
      if (previousScore === null || row.score !== previousScore) rank = index + 1;
      previousScore = row.score;
      const points = Math.max(1, 101 - rank);
      const standing = byUser.get(row.userId) ?? {
        userId: row.userId,
        userName: row.userName,
        points: 0,
        gamesCompleted: 0,
        games: [],
      };
      standing.userName = row.userName;
      standing.points += points;
      standing.gamesCompleted += 1;
      standing.games.push({ ...game, score: row.score, rank, points });
      byUser.set(row.userId, standing);
    });
  }

  return [...byUser.values()]
    .sort((a, b) =>
      b.points - a.points
      || b.gamesCompleted - a.gamesCompleted
      || a.userName.localeCompare(b.userName),
    )
    .map((standing, index) => ({
      ...standing,
      rank: index + 1,
      badge: badgeForStanding(index + 1, standing.gamesCompleted),
    }));
}

export async function getArcadeTourState(
  viewerId?: string | null,
  now = Date.now(),
): Promise<ArcadeTourState> {
  const week = getArcadeTourWeek(now);
  const games = getArcadeTourGames(week.weekKey);
  const slugs = games.map((game) => game.slug);
  const result = await query<{
    game_slug: string;
    od_user_id: string;
    user_name: string;
    score: number;
  }>(
    `
      SELECT DISTINCT ON (game_slug, od_user_id)
             game_slug, od_user_id, user_name, score
      FROM game_score_events
      WHERE created_at >= $1
        AND created_at < $2
        AND game_slug = ANY($3::text[])
      ORDER BY game_slug, od_user_id, score DESC, created_at ASC
    `,
    [week.startsAt, week.endsAt, slugs],
  );
  const standings = scoreArcadeTourRows(
    games,
    result.rows.map((row) => ({
      gameSlug: row.game_slug,
      userId: row.od_user_id,
      userName: row.user_name,
      score: Number(row.score),
    })),
  );

  return {
    ...week,
    games,
    standings: standings.slice(0, MAX_VISIBLE_STANDINGS),
    viewer: viewerId ? standings.find((standing) => standing.userId === viewerId) ?? null : null,
    participantCount: standings.length,
  };
}
