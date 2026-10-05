import { NextResponse } from 'next/server';

import { getAccountById } from '@/server/accounts';
import { requireIdentity } from '@/server/auth';
import {
  ARCADE_LOBBY_CONVERSATION_ID,
  ensureArcadeLobbyMember,
  listArcadeLobbyMessages,
  postMessage,
} from '@/server/social/messaging';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  let identity;
  try {
    identity = await requireIdentity({ allowExternal: true });
  } catch {
    return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  }
  const limit = Number(new URL(request.url).searchParams.get('limit') ?? 100);
  try {
    return NextResponse.json({
      messages: await listArcadeLobbyMessages(
        identity.userId,
        Number.isFinite(limit) ? limit : 100,
      ),
    });
  } catch (error) {
    console.error('Failed to load Arcade Lobby:', error);
    return NextResponse.json({ error: 'Unable to load the Arcade Lobby.' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  let identity;
  try {
    identity = await requireIdentity({ allowExternal: true });
  } catch {
    return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  }
  let body: { content?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 });
  }

  const account = await getAccountById(identity.userId);
  await ensureArcadeLobbyMember(identity.userId);
  const result = await postMessage({
    conversationId: ARCADE_LOBBY_CONVERSATION_ID,
    senderUserId: identity.userId,
    senderName: account?.username || identity.name || 'Player',
    type: 'text',
    content: typeof body.content === 'string' ? body.content : '',
    notify: false,
  });
  if (!result.ok) {
    const response = NextResponse.json({ error: result.error }, { status: result.status });
    if (result.retryAfterMs) {
      response.headers.set('Retry-After', String(Math.max(1, Math.ceil(result.retryAfterMs / 1000))));
    }
    return response;
  }
  return NextResponse.json({ message: result.message });
}
