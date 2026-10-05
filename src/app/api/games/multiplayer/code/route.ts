import { NextResponse } from 'next/server';

import { requireIdentity } from '@/server/auth';
import {
  getGameCodeJoinHref,
  getGameInviteCode,
  getMultiplayerTargetJoinHref,
  isMultiplayerGameType,
  normalizeGameCode,
  withAbsoluteUrl,
} from '@/server/arcade/multiplayer';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    await requireIdentity({ allowExternal: true });
  } catch {
    return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  }

  const url = new URL(request.url);
  const code = normalizeGameCode(url.searchParams.get('code') ?? '');
  const expectedGameType = url.searchParams.get('gameType')?.trim();
  if (!code) {
    return NextResponse.json({ error: 'code is required.' }, { status: 400 });
  }

  const invite = await getGameInviteCode(code);
  if (!invite) {
    return NextResponse.json({ error: 'Game code not found or expired.' }, { status: 404 });
  }

  if (expectedGameType && (!isMultiplayerGameType(expectedGameType) || expectedGameType !== invite.gameType)) {
    return NextResponse.json({ error: 'This code belongs to another game.' }, { status: 409 });
  }

  const href = getGameCodeJoinHref(invite.gameType, invite.code);
  const targetHref = getMultiplayerTargetJoinHref({
    gameType: invite.gameType,
    targetKind: invite.targetKind,
    targetId: invite.targetId,
  });
  return NextResponse.json({
    invite: {
      ...invite,
      href,
      url: withAbsoluteUrl(href, request),
      targetHref,
      targetUrl: withAbsoluteUrl(targetHref, request),
      tableId: invite.targetKind === 'table' ? invite.targetId : undefined,
      matchId: invite.targetKind === 'match' ? invite.targetId : undefined,
    },
  });
}
