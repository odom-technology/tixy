import { NextResponse } from 'next/server';
import { authenticateGamePlayer, isErrorResponse, parsePayload } from '../../_shared/score-helpers';
import { noStoreJson } from '../../_shared/leaderboard-helpers';
import { getLightsLeaderboard, submitLightsRun, LightsOutError, LIGHTS_GAME } from '@/server/arcade/lights-out';

export async function POST(request: Request) {
  const auth = await authenticateGamePlayer(LIGHTS_GAME);
  if (isErrorResponse(auth)) return auth;
  const payload = await parsePayload<unknown>(request);
  if (payload instanceof NextResponse) return payload;
  try {
    const result = await submitLightsRun(auth.identity.userId, auth.identityName || 'Anonymous', payload);
    return noStoreJson({ ...result, ticketsAwarded: 0, leaderboard: await getLightsLeaderboard() });
  } catch (error) {
    if (error instanceof LightsOutError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('Failed to save Lights Out:', error);
    return NextResponse.json({ error: 'Could not save this run. Try again.' }, { status: 500 });
  }
}
