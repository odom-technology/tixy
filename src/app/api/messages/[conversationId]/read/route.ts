import { NextResponse } from 'next/server';

import { requireIdentity } from '@/server/auth';
import { isDmMember, markRead } from '@/server/social/messaging';

export const dynamic = 'force-dynamic';

// POST — mark a conversation read up to now (membership required).
export async function POST(_request: Request, { params }: { params: Promise<{ conversationId: string }> }) {
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

  await markRead(conversationId, identity.userId);
  return NextResponse.json({ ok: true });
}
