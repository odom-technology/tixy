import { NextResponse } from 'next/server';
import { requireIdentity } from '@/server/auth';
import { query, queryOne } from '@/server/db/client';

export const dynamic = 'force-dynamic';

const toNum = (value: unknown): number => (value == null ? 0 : Number(value));
const toNumOrNull = (value: unknown): number | null =>
  value == null ? null : Number(value);

type PoolStatsRow = {
  userName: string;
  wins: string | number;
  losses: string | number;
  forfeits: string | number;
  currentStreak: string | number;
  bestStreak: string | number;
  totalShots: string | number;
  totalBallsPocketed: string | number;
};

const STATS_SELECT = `
  user_name AS "userName",
  wins,
  losses,
  forfeits,
  current_streak AS "currentStreak",
  best_streak AS "bestStreak",
  total_shots AS "totalShots",
  total_balls_pocketed AS "totalBallsPocketed"
`;

/** GET — Get the user's 8-ball stats + recent match history. */
export async function GET() {
  let identity;
  try {
    identity = await requireIdentity({ allowExternal: true });
  } catch {
    return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  }

  const stats = await queryOne<PoolStatsRow>(
    `SELECT ${STATS_SELECT} FROM pool_stats WHERE user_id = $1`,
    [identity.userId],
  );

  const recentMatches = await query<{
    id: string;
    player1Name: string;
    player2Name: string | null;
    player1Id: string;
    winnerId: string | null;
    winReason: string | null;
    status: string;
    moveCount: string | number;
    completedAt: string | number | null;
  }>(
    `SELECT id,
            player1_name AS "player1Name",
            player2_name AS "player2Name",
            player1_id AS "player1Id",
            winner_id AS "winnerId",
            win_reason AS "winReason",
            status,
            move_count AS "moveCount",
            completed_at AS "completedAt"
     FROM pool_matches
     WHERE player1_id = $1 OR player2_id = $1
     ORDER BY updated_at DESC
     LIMIT 20`,
    [identity.userId],
  );

  const topPlayers = await query<PoolStatsRow>(
    `SELECT ${STATS_SELECT} FROM pool_stats ORDER BY wins DESC LIMIT 5`,
  );

  return NextResponse.json({
    stats: stats
      ? {
          wins: toNum(stats.wins),
          losses: toNum(stats.losses),
          forfeits: toNum(stats.forfeits),
          winRate:
            toNum(stats.wins) + toNum(stats.losses) > 0
              ? Math.round((toNum(stats.wins) / (toNum(stats.wins) + toNum(stats.losses))) * 100)
              : 0,
          currentStreak: toNum(stats.currentStreak),
          bestStreak: toNum(stats.bestStreak),
          totalShots: toNum(stats.totalShots),
          totalBallsPocketed: toNum(stats.totalBallsPocketed),
          accuracy:
            toNum(stats.totalShots) > 0
              ? Math.round((toNum(stats.totalBallsPocketed) / toNum(stats.totalShots)) * 100)
              : 0,
        }
      : null,
    recentMatches: recentMatches.rows.map((m) => ({
      id: m.id,
      opponent:
        m.player1Id === identity.userId ? m.player2Name : m.player1Name,
      won: m.winnerId === identity.userId,
      result: m.status,
      winReason: m.winReason,
      moves: toNum(m.moveCount),
      completedAt: toNumOrNull(m.completedAt),
    })),
    topPlayers: topPlayers.rows.map((p) => ({
      userName: p.userName,
      wins: toNum(p.wins),
      losses: toNum(p.losses),
      winRate:
        toNum(p.wins) + toNum(p.losses) > 0
          ? Math.round((toNum(p.wins) / (toNum(p.wins) + toNum(p.losses))) * 100)
          : 0,
      bestStreak: toNum(p.bestStreak),
    })),
  });
}
