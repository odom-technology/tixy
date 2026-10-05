import { NextResponse } from 'next/server';

import {
  createDerbyRace,
  derbyRaceKind,
  findDerbyRematchLobby,
  getDerbySnapshot,
  joinDerbyRace,
} from '@/server/arcade/derby-race/service';
import { createGameInviteCode, getGameCodeJoinHref, withAbsoluteUrl } from '@/server/arcade/multiplayer';
import { broadcast } from '@/server/events';

import { derbyUser, noStore } from '../../../_derby-route';

export const dynamic = 'force-dynamic';

/**
 * POST: race again. Practice and play now open a fresh race; an invite race
 * opens one rematch lobby for everyone who raced (the first to ask hosts it,
 * the rest join it).
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const who = await derbyUser('rematch', { count: 20, windowMs: 60_000 }, { newRace: true });
  if ('response' in who) return who.response;
  const race = await derbyRaceKind(id);
  if (!race) return NextResponse.json({ error: 'That race is gone.' }, { status: 404, headers: noStore });
  if (race.kind !== 'invite') {
    return NextResponse.json({ error: 'Use play now or practice.' }, { status: 400, headers: noStore });
  }
  let raceId = await findDerbyRematchLobby(id);
  if (raceId) {
    const joined = await joinDerbyRace(raceId, who.user);
    if (!joined.ok) raceId = null;
  }
  if (!raceId) {
    raceId = await createDerbyRace('invite', who.user, id);
    broadcast(`derbyRace:${id}`, { type: 'rematch', raceId: id, rematch: raceId });
  }
  const code = await createGameInviteCode({
    gameType: 'derby',
    targetKind: 'table',
    targetId: raceId,
    createdByUserId: who.user.userId,
    maxClaims: 7,
  });
  const href = getGameCodeJoinHref('derby', code.code);
  return NextResponse.json(
    {
      raceId,
      invite: { code: code.code, href, url: withAbsoluteUrl(href, request) },
      snapshot: await getDerbySnapshot(raceId, who.user.userId),
    },
    { headers: noStore },
  );
}
