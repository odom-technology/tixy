import { NextResponse } from 'next/server';

import { requireIdentity } from '@/server/auth';
import { consumeReadRateLimit, tooManyAttemptsResponse } from '@/server/auth/auth-rate-limit';
import { appendFeedbackComment, FeedbackError, validateFeedbackCommentBody } from '@/server/feedback';

export const dynamic = 'force-dynamic';

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  let identity;
  try {
    identity = await requireIdentity({ allowExternal: true });
  } catch {
    return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  }
  const limit = consumeReadRateLimit(`feedback:reply:${identity.userId}`, 30, 60 * 60 * 1000);
  if (limit.limited) return tooManyAttemptsResponse(limit.retryAfterSeconds);
  if (Number(request.headers.get('content-length')) > 16_384) {
    return NextResponse.json({ error: 'Reply is too long.' }, { status: 413 });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 });
  }
  try {
    const { id } = await context.params;
    const result = await appendFeedbackComment({
      id, userId: identity.userId, userName: identity.name, isAdmin: false,
      message: validateFeedbackCommentBody(body),
    });
    return NextResponse.json({ entry: result.entry, comment: result.comment }, { status: 201 });
  } catch (error) {
    if (error instanceof FeedbackError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('[feedback] reply failed');
    return NextResponse.json({ error: 'Unable to send your reply.' }, { status: 500 });
  }
}
