import { NextResponse } from 'next/server';

import { getAccountById } from '@/server/accounts';
import { requireIdentity } from '@/server/auth';
import { isDmMember, listMessages, postMessage } from '@/server/social/messaging';

export const dynamic = 'force-dynamic';

// GET — messages in a conversation (membership required).
export async function GET(request: Request, { params }: { params: Promise<{ conversationId: string }> }) {
  let identity;
  try {
    identity = await requireIdentity({ allowExternal: true });
  } catch {
    return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  }

  const { conversationId } = await params;
  if (!(await isDmMember(conversationId, identity.userId))) {
    return NextResponse.json({ error: 'Conversation not found.' }, { status: 404 });
  }

  const { searchParams } = new URL(request.url);
  const beforeRaw = Number(searchParams.get('before'));
  const limitRaw = Number(searchParams.get('limit'));

  const messages = await listMessages({
    conversationId,
    before: Number.isFinite(beforeRaw) && beforeRaw > 0 ? beforeRaw : undefined,
    limit: Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : undefined,
  });
  return NextResponse.json({ messages });
}

// POST — send a message (membership required). Body: { content, type? }.
export async function POST(request: Request, { params }: { params: Promise<{ conversationId: string }> }) {
  let identity;
  try {
    identity = await requireIdentity({ allowExternal: true });
  } catch {
    return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  }

  const { conversationId } = await params;
  if (!(await isDmMember(conversationId, identity.userId))) {
    return NextResponse.json({ error: 'Conversation not found.' }, { status: 404 });
  }

  let body: { content?: string; type?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 });
  }

  const account = await getAccountById(identity.userId);
  const senderName = account?.username || identity.name || 'Player';

  const result = await postMessage({
    conversationId,
    senderUserId: identity.userId,
    senderName,
    type: body.type === 'reaction' ? 'reaction' : 'text',
    content: typeof body.content === 'string' ? body.content : '',
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
