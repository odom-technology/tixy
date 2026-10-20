import { NextResponse } from 'next/server';
import { requireIdentity } from '@/server/auth';
import { getGameBanStatus } from '@/server/arcade/game-bans';
import { checkSessionStartLimit } from '@/server/arcade/game-rate-limit';
import { gameUnavailableResponse } from '@/server/arcade/game-availability';
import { startLightsRun, LIGHTS_GAME } from '@/server/arcade/lights-out';

export async function POST() {
  let identity;
  try { identity = await requireIdentity(); }
  catch { return NextResponse.json({ error: 'Sign in to play.' }, { status: 401 }); }
  try {
    if ((await getGameBanStatus(identity.userId)).isBanned) {
      return NextResponse.json({ error: 'Your account cannot play games right now.' }, { status: 403 });
    }
    const limit = await checkSessionStartLimit(identity.userId, LIGHTS_GAME);
    if (!limit.ok) {
      return NextResponse.json({ error: limit.reason }, { status: 429 });
    }
    return NextResponse.json(await startLightsRun(identity.userId), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const unavailable = gameUnavailableResponse(error);
    if (unavailable) return unavailable;
    console.error('Failed to start Lights Out:', error);
    return NextResponse.json({ error: 'Could not start a run. Try again.' }, { status: 500 });
  }
}
