import { NextResponse } from 'next/server';

import { requireIdentity } from '@/server/auth';
import { checkRole } from '@/server/auth/check-role';
import { FeedbackError, getFeedbackConversation } from '@/server/feedback';

export const dynamic = 'force-dynamic';

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  let identity;
  try {
    identity = await requireIdentity({ allowExternal: true });
  } catch {
    return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  }
  try {
    const { id } = await context.params;
    const conversation = await getFeedbackConversation(id, {
      userId: identity.userId,
      isAdmin: await checkRole('admin', identity),
    });
    return NextResponse.json(conversation, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    if (error instanceof FeedbackError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('[feedback] conversation read failed');
    return NextResponse.json({ error: 'Unable to load this conversation.' }, { status: 500 });
  }
}
