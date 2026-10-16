import { getPatternLeaderboard } from '@/server/arcade/starter-match';
import { leaderboardServerError, noStoreJson } from '../../_shared/leaderboard-helpers';

export const dynamic = 'force-dynamic';

export async function GET() {
  try { return noStoreJson({ leaderboard: await getPatternLeaderboard() }); }
  catch (error) { return leaderboardServerError(error); }
}
