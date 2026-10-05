import { NextResponse } from 'next/server';

import {
  createDerbyRace,
  getDerbySnapshot,
  listOpenDerbyRaces,
  quickJoinDerby,
  type DerbyRaceKind,
} from '@/server/arcade/derby-race/service';
import { createGameInviteCode, getGameCodeJoinHref, withAbsoluteUrl } from '@/server/arcade/multiplayer';

import { derbyUser, noStore, readJson } from '../_derby-route';

export const dynamic = 'force-dynamic';

/** GET: public races filling now, for the lobby. */
export async function GET() {
  try {
    return NextResponse.json({ open: await listOpenDerbyRaces(), serverNow: Date.now() }, { headers: noStore });
  } catch (error) {
    console.error('derby: open races failed', error);
    return NextResponse.json({ error: 'Could not load races.' }, { status: 500 });
  }
}

/** POST { kind }: practice (you and seven bots, now), public (play now) or invite (a code for friends). */
export async function POST(request: Request) {
  const who = await derbyUser('create', { count: 20, windowMs: 60_000 }, { newRace: true });
  if ('response' in who) return who.response;
  const body = await readJson<{ kind: DerbyRaceKind }>(request);
  const kind = body.kind === 'practice' || body.kind === 'invite' ? body.kind : 'public';
  try {
    const raceId = kind === 'public' ? await quickJoinDerby(who.user) : await createDerbyRace(kind, who.user);
    let invite: { code: string; href: string; url: string } | null = null;
    if (kind === 'invite') {
      const code = await createGameInviteCode({
        gameType: 'derby',
        targetKind: 'table',
        targetId: raceId,
        createdByUserId: who.user.userId,
        maxClaims: 7,
      });
      const href = getGameCodeJoinHref('derby', code.code);
      invite = { code: code.code, href, url: withAbsoluteUrl(href, request) };
    }
    const snapshot = await getDerbySnapshot(raceId, who.user.userId);
    return NextResponse.json({ raceId, invite, snapshot }, { headers: noStore });
  } catch (error) {
    console.error('derby: create failed', error);
    return NextResponse.json({ error: 'Could not open a race.' }, { status: 500 });
  }
}
