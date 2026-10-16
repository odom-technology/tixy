import { getLightsLeaderboard } from '@/server/arcade/lights-out';
import { leaderboardServerError, noStoreJson } from '../../_shared/leaderboard-helpers';

export const dynamic = 'force-dynamic';

export async function GET() {
  try { return noStoreJson({ leaderboard: await getLightsLeaderboard() }); }
  catch (error) { return leaderboardServerError(error); }
}
