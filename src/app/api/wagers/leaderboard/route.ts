import { getGameTitle } from '@/features/arcade/lib/game-renames';
import { NextResponse } from 'next/server';

import { listAcceptedFriendIds } from '@/server/arcade/multiplayer';
import { withCurrentLeaderboardNames } from '@/server/arcade/leaderboard-identities';
import { requireIdentity } from '@/server/auth';
import { query } from '@/server/db/client';

export const dynamic = 'force-dynamic';

type BiggestWinRow = {
  user_id: string;
  user_name: string;
  game_type: string;
  wager_amount: string | number;
  payout_amount: string | number;
  multiplier: string | number;
  created_at: string | number;
};

type TotalWageredRow = {
  user_id: string;
  user_name: string;
  total_wagered: string | number;
  total_rounds: string | number;
  total_payout: string | number;
  distinct_games: string | number;
};

const NOT_REFUND = `(outcome_json IS NULL OR outcome_json NOT LIKE '%"refunded":true%')`;

const GAME_TYPE_LABELS: Record<string, string> = {
  'arcade-mines': 'Mines',
  'arcade-slots': 'Slots',
  'arcade-crash': 'Crash',
  'arcade-stoplight': 'Lucky Wheel',
  'arcade-plinko': getGameTitle('plinko', 'Plinko'),
  'arcade-dice': 'Dice',
  'arcade-chicken': 'Crossy Chicken',
  'arcade-hilo': 'Hi-Lo',
  'arcade-cases': 'Cases',
  'arcade-packs': 'Packs',
  'arcade-darts': 'Darts',
  'arcade-lightspeed': 'Lightspeed',
  'arcade-blackjack': '21',
  'arcade-limbo': 'Limbo',
  'arcade-dragon': 'Dragon Tower',
  'arcade-video-poker': 'Video Poker',
  'arcade-roulette': 'Roulette',
  'arcade-scratch': 'Scratch Cards',
  'arcade-pump': 'Pump',
  'arcade-keno': 'Keno',
  'arcade-prize-wheel': 'Prize Wheel',
  'arcade-baccarat': 'Baccarat',
  'arcade-fortune-teller': 'Fortune Teller',
  'arcade-gem-roll': 'Gem Roll',
  'arcade-lucky-cage': 'Lucky Cage',
  'arcade-prize-claw': 'Prize Claw',
  'arcade-derby': 'Derby Royale',
};

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const mode = searchParams.get('mode') ?? 'biggest-wins';
  const limit = Math.min(Number(searchParams.get('limit')) || 20, 50);
  const scope = searchParams.get('scope');

  // scope=friends restricts the board to the viewer + their accepted friends.
  let friendScopeIds: string[] | null = null;
  if (scope === 'friends') {
    try {
      const identity = await requireIdentity({ allowExternal: true, allowGuest: true });
      const ids = await listAcceptedFriendIds(identity.userId);
      friendScopeIds = [...new Set([...ids, identity.userId])];
    } catch {
      return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
    }
  }
  const friendFilterH = friendScopeIds ? ' AND h.user_id = ANY($2::text[])' : '';
  const friendFilterR = friendScopeIds ? ' AND r.user_id = ANY($2::text[])' : '';
  const leaderboardParams: unknown[] = friendScopeIds ? [limit, friendScopeIds] : [limit];

  try {
    if (mode === 'total-wagered') {
      const result = await query<TotalWageredRow>(
        `
          WITH latest_names AS (
            SELECT DISTINCT ON (user_id)
              user_id,
              user_name
            FROM arcade_round_history
            WHERE user_name != 'Anonymous'
            ORDER BY user_id, created_at DESC
          )
          SELECT
            h.user_id,
            COALESCE(NULLIF(latest_names.user_name, ''), MAX(h.user_name)) AS user_name,
            SUM(h.wager_amount) AS total_wagered,
            COUNT(*) AS total_rounds,
            SUM(h.payout_amount) AS total_payout,
            COUNT(DISTINCT h.game_type) AS distinct_games
          FROM arcade_round_history h
          LEFT JOIN latest_names ON latest_names.user_id = h.user_id
          WHERE ${NOT_REFUND}${friendFilterH}
          GROUP BY h.user_id, latest_names.user_name
          ORDER BY total_wagered DESC
          LIMIT $1
        `,
        leaderboardParams,
      );
      return NextResponse.json({
        mode,
        leaderboard: await withCurrentLeaderboardNames(result.rows.map((row) => {
          const totalWagered = Number(row.total_wagered ?? 0);
          const totalPayout = Number(row.total_payout ?? 0);
          return {
            userId: row.user_id,
            userName: row.user_name || 'Anonymous',
            totalWagered,
            totalRounds: Number(row.total_rounds ?? 0),
            totalPayout,
            netResult: totalPayout - totalWagered,
            distinctGames: Number(row.distinct_games ?? 0),
          };
        })),
      }, { headers: { 'Cache-Control': 'no-store' } });
    }

    const result = await query<BiggestWinRow>(
      `
        WITH latest_names AS (
          SELECT DISTINCT ON (user_id)
            user_id,
            user_name
          FROM arcade_round_history
          WHERE user_name != 'Anonymous'
          ORDER BY user_id, created_at DESC
        ),
        ranked_wins AS (
          SELECT
            r.*,
            ROW_NUMBER() OVER (
              PARTITION BY r.user_id
              ORDER BY r.payout_amount DESC, r.created_at DESC
            ) AS rank
          FROM arcade_round_history r
          WHERE r.payout_amount > 0
            AND ${NOT_REFUND}${friendFilterR}
        )
        SELECT
          ranked_wins.user_id,
          COALESCE(NULLIF(latest_names.user_name, ''), ranked_wins.user_name) AS user_name,
          ranked_wins.game_type,
          ranked_wins.wager_amount,
          ranked_wins.payout_amount,
          ranked_wins.multiplier,
          ranked_wins.created_at
        FROM ranked_wins
        LEFT JOIN latest_names ON latest_names.user_id = ranked_wins.user_id
        WHERE ranked_wins.rank = 1
        ORDER BY ranked_wins.payout_amount DESC
        LIMIT $1
      `,
      leaderboardParams,
    );

    return NextResponse.json({
      mode,
      leaderboard: await withCurrentLeaderboardNames(result.rows.map((row) => {
        const wagerAmount = Number(row.wager_amount ?? 0);
        const payoutAmount = Number(row.payout_amount ?? 0);
        return {
          userId: row.user_id,
          userName: row.user_name || 'Anonymous',
          gameType: row.game_type,
          gameLabel: GAME_TYPE_LABELS[row.game_type] ?? row.game_type,
          wagerAmount,
          payoutAmount,
          multiplier: Number(row.multiplier ?? 0),
          profit: payoutAmount - wagerAmount,
          createdAt: Number(row.created_at ?? 0),
        };
      })),
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('Arcade leaderboard error:', error);
    return NextResponse.json({ error: 'Failed to load leaderboard.' }, { status: 500 });
  }
}
