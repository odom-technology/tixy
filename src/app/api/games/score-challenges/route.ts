import { NextResponse } from 'next/server';

import { requireIdentity } from '@/server/auth';
import {
  createScoreChallengeForUser,
  verifyScoreChallenge,
} from '@/server/arcade/score-challenges';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get('token') ?? '';
  try {
    const challenge = verifyScoreChallenge(token);
    if (!challenge) {
      return NextResponse.json(
        { error: 'This score challenge is invalid or expired.' },
        { status: 404 },
      );
    }
    return NextResponse.json({ challenge });
  } catch (error) {
    console.error('Failed to verify score challenge:', error);
    return NextResponse.json({ error: 'Unable to verify challenge.' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  let identity;
  try {
    identity = await requireIdentity({ allowExternal: true });
  } catch {
    return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  }

  let body: { gameSlug?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 });
  }
  const gameSlug = body.gameSlug?.trim() ?? '';
  if (!gameSlug || gameSlug.length > 48) {
    return NextResponse.json({ error: 'gameSlug is required.' }, { status: 400 });
  }

  try {
    const result = await createScoreChallengeForUser({
      userId: identity.userId,
      gameSlug,
    });
    if (!result?.challenge) {
      return NextResponse.json(
        { error: 'No recent verified score is available for this game.' },
        { status: 404 },
      );
    }
    return NextResponse.json({
      token: result.token,
      href: `${result.challenge.gameHref}?scoreChallenge=${encodeURIComponent(result.token)}`,
      challenge: result.challenge,
    });
  } catch (error) {
    console.error('Failed to create score challenge:', error);
    return NextResponse.json({ error: 'Unable to create score challenge.' }, { status: 500 });
  }
}
