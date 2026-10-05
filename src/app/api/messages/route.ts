import { NextResponse } from 'next/server';

import { requireIdentity } from '@/server/auth';
import { areArcadeFriends } from '@/server/arcade/multiplayer';
import { isBlocked } from '@/server/social/blocks';
import { getOrCreateDmConversation, listConversationsForUser } from '@/server/social/messaging';

export const dynamic = 'force-dynamic';

// GET — the caller's DM conversations (with unread + last message + other member).
export async function GET() {
  let identity;
  try {
    identity = await requireIdentity({ allowExternal: true });
  } catch {
    return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  }

  try {
    const conversations = await listConversationsForUser(identity.userId);
    return NextResponse.json({ conversations });
  } catch (error) {
    console.error('Failed to list conversations:', error);
    return NextResponse.json({ error: 'Unable to load messages.' }, { status: 500 });
  }
}

// POST — open (or reuse) a DM with a friend. Body: { targetUserId }.
export async function POST(request: Request) {
  let identity;
  try {
    identity = await requireIdentity({ allowExternal: true });
  } catch {
    return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  }

  let body: { targetUserId?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 });
  }

  const targetUserId = typeof body.targetUserId === 'string' ? body.targetUserId.trim() : '';
  if (!targetUserId) {
    return NextResponse.json({ error: 'targetUserId is required.' }, { status: 400 });
  }
  if (targetUserId === identity.userId) {
    return NextResponse.json({ error: 'You cannot message yourself.' }, { status: 400 });
  }

  try {
    if (!(await areArcadeFriends(identity.userId, targetUserId))) {
      return NextResponse.json({ error: 'You can only message friends.' }, { status: 403 });
    }
    if (await isBlocked(identity.userId, targetUserId)) {
      return NextResponse.json({ error: 'You cannot message this user.' }, { status: 403 });
    }
    const conversation = await getOrCreateDmConversation(identity.userId, targetUserId);
    return NextResponse.json({ conversationId: conversation.id });
  } catch (error) {
    console.error('Failed to start conversation:', error);
    return NextResponse.json({ error: 'Unable to start conversation.' }, { status: 500 });
  }
}
