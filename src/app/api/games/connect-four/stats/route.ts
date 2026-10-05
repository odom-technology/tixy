import { NextResponse } from 'next/server';
import { requireIdentity } from '@/server/auth';
import { query, queryOne } from '@/server/db/client';

export const dynamic = 'force-dynamic';

const toNum = (value: unknown): number => (value == null ? 0 : Number(value));
const toNumOrNull = (value: unknown): number | null =>
  value == null ? null : Number(value);

type ConnectFourStatsRow = {
  userName: string;
  wins: string | number;
  losses: string | number;
  draws: string | number;
  forfeits: string | number;
  currentStreak: string | number;
  bestStreak: string | number;
  foursGiven: string | number;
};

const STATS_SELECT = `
  user_name AS "userName",
  wins,
  losses,
  draws,
  forfeits,
  current_streak AS "currentStreak",
  best_streak AS "bestStreak",
  fours_given AS "foursGiven"
`;

export async function GET() {
  let identity;
  try {
    identity = await requireIdentity({ allowExternal: true });
  } catch {
    return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  }

  const stats = await queryOne<ConnectFourStatsRow>(
    `SELECT ${STATS_SELECT} FROM connect_four_stats WHERE user_id = $1`,
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
    result: string | null;
    ply: string | number;
    completedAt: string | number | null;
  }>(
    `SELECT id,
            player1_name AS "player1Name",
            player2_name AS "player2Name",
            player1_id AS "player1Id",
            winner_id AS "winnerId",
            win_reason AS "winReason",
            status,
            result,
            ply,
            completed_at AS "completedAt"
     FROM connect_four_matches
     WHERE player1_id = $1 OR player2_id = $1
     ORDER BY updated_at DESC
     LIMIT 20`,
    [identity.userId],
  );

  const topPlayers = await query<ConnectFourStatsRow>(
    `SELECT ${STATS_SELECT} FROM connect_four_stats ORDER BY wins DESC LIMIT 5`,
  );

  return NextResponse.json({
    stats: stats
      ? {
          wins: toNum(stats.wins),
          losses: toNum(stats.losses),
          draws: toNum(stats.draws),
          forfeits: toNum(stats.forfeits),
          winRate:
            toNum(stats.wins) + toNum(stats.losses) + toNum(stats.draws) > 0
              ? Math.round((toNum(stats.wins) / (toNum(stats.wins) + toNum(stats.losses) + toNum(stats.draws))) * 100)
              : 0,
          currentStreak: toNum(stats.currentStreak),
          bestStreak: toNum(stats.bestStreak),
          foursGiven: toNum(stats.foursGiven),
        }
      : null,
    recentMatches: recentMatches.rows.map((m) => ({
      id: m.id,
      opponent: m.player1Id === identity.userId ? m.player2Name : m.player1Name,
      won: m.winnerId === identity.userId,
      result: m.status,
      resultString: m.result,
      winReason: m.winReason,
      ply: toNum(m.ply),
      completedAt: toNumOrNull(m.completedAt),
    })),
    topPlayers: topPlayers.rows.map((p) => ({
      userName: p.userName,
      wins: toNum(p.wins),
      losses: toNum(p.losses),
      draws: toNum(p.draws),
      winRate:
        toNum(p.wins) + toNum(p.losses) + toNum(p.draws) > 0
          ? Math.round((toNum(p.wins) / (toNum(p.wins) + toNum(p.losses) + toNum(p.draws))) * 100)
          : 0,
      bestStreak: toNum(p.bestStreak),
    })),
  });
}
