import { NextResponse } from 'next/server';

import { requireIdentity } from '@/server/auth';
import {
  ARCADE_LOBBY_CONVERSATION_ID,
  ensureArcadeLobbyMember,
  markRead,
} from '@/server/social/messaging';

export async function POST() {
  let identity;
  try {
    identity = await requireIdentity({ allowExternal: true });
  } catch {
    return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  }
  await ensureArcadeLobbyMember(identity.userId);
  await markRead(ARCADE_LOBBY_CONVERSATION_ID, identity.userId);
  return NextResponse.json({ ok: true });
}
