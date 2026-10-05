import { NextResponse } from 'next/server';

import { getDerbySnapshot, joinDerbyRace } from '@/server/arcade/derby-race/service';
import { getGameInviteCode, markGameInviteCodeClaimed } from '@/server/arcade/multiplayer';

import { derbyUser, noStore, readJson } from '../_derby-route';

export const dynamic = 'force-dynamic';

/** POST { code }: join a friend's race from an invite code or link. */
export async function POST(request: Request) {
  const who = await derbyUser('join-code', { count: 20, windowMs: 60_000 });
  if ('response' in who) return who.response;
  const body = await readJson<{ code: string }>(request);
  const invite = typeof body.code === 'string' ? await getGameInviteCode(body.code) : null;
  if (!invite || invite.gameType !== 'derby') {
    return NextResponse.json({ error: 'That code has expired.' }, { status: 404, headers: noStore });
  }
  const raceId = invite.targetId;
  const joined = await joinDerbyRace(raceId, who.user);
  if (joined.ok === false) return NextResponse.json({ error: joined.error }, { status: joined.status, headers: noStore });
  if (invite.createdByUserId !== who.user.userId) {
    await markGameInviteCodeClaimed({
      code: invite.code,
      gameType: 'derby',
      matchId: raceId,
      targetKind: 'table',
      targetId: raceId,
      claimedByUserId: who.user.userId,
    });
  }
  return NextResponse.json({ raceId, snapshot: await getDerbySnapshot(raceId, who.user.userId) }, { headers: noStore });
}
