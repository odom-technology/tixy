// Minimal earned-flair milestones (not a full achievements engine). Evaluated
// fail-soft from the friend-accept and match-win hooks. Idempotent: grants are
// ON CONFLICT DO NOTHING, so re-evaluation is cheap and safe.
import { listAcceptedFriendIds } from '@/server/arcade/multiplayer';
import { grantEarnedFlair } from '@/server/arcade/rewards/flair-grants';
import { MILESTONE_FLAIR_ITEM_IDS } from '@/server/arcade/rewards/reward-only-items';
import { queryOne } from '@/server/db/client';

const FRIENDS_MILESTONE = 5;
const WINS_MILESTONE = 10;

async function getTotalRankedWins(userId: string): Promise<number> {
  const row = await queryOne<{ wins: string | number }>(
    `SELECT
       COALESCE((SELECT total_wins FROM chess_elo WHERE user_id = $1), 0)
       + COALESCE((SELECT total_wins FROM pool_elo WHERE user_id = $1), 0) AS wins`,
    [userId],
  );
  return Number(row?.wins ?? 0);
}

export async function evaluateProfileMilestones(userId: string): Promise<void> {
  if (!userId || userId.startsWith('bot:')) return;
  try {
    const friendIds = await listAcceptedFriendIds(userId);
    if (friendIds.length >= FRIENDS_MILESTONE) {
      await grantEarnedFlair(userId, MILESTONE_FLAIR_ITEM_IDS.friends);
    }
    if ((await getTotalRankedWins(userId)) >= WINS_MILESTONE) {
      await grantEarnedFlair(userId, MILESTONE_FLAIR_ITEM_IDS.rankedWins);
    }
  } catch (error) {
    console.error('evaluateProfileMilestones failed:', error);
  }
}
