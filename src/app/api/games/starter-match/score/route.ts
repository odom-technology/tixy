import { NextResponse } from 'next/server';
import { authenticateGamePlayer, isErrorResponse, parsePayload } from '../../_shared/score-helpers';
import { noStoreJson } from '../../_shared/leaderboard-helpers';
import { getPatternLeaderboard, submitPatternRun, StarterMatchError, STARTER_GAME } from '@/server/arcade/starter-match';

export async function POST(request: Request) {
  const auth = await authenticateGamePlayer(STARTER_GAME);
  if (isErrorResponse(auth)) return auth;
  const payload = await parsePayload<unknown>(request);
  if (payload instanceof NextResponse) return payload;
  try {
    const score = await submitPatternRun(auth.identity.userId, auth.identityName || 'Anonymous', payload);
    return noStoreJson({ score, ticketsAwarded: 0, leaderboard: await getPatternLeaderboard() });
  } catch (error) {
    if (error instanceof StarterMatchError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('Failed to save Pattern Match:', error);
    return NextResponse.json({ error: 'Could not save this run. Try again.' }, { status: 500 });
  }
}
