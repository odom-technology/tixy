import { NextResponse } from 'next/server';

import { withAdmin } from '@/server/admin/guard';
import { appendFeedbackComment, FeedbackError, validateFeedbackCommentBody } from '@/server/feedback';
import { createNotification } from '@/server/services/notifications';

export const dynamic = 'force-dynamic';

export const POST = withAdmin<{ id: string }>(async (request, { identity, params }) => {
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
    const result = await appendFeedbackComment({
      id: params.id, userId: identity.userId, isAdmin: true,
      message: validateFeedbackCommentBody(body),
    });
    if (result.ownerUserId && result.ownerUserId !== identity.userId) {
      // A notification failure must not make a committed reply look unsent.
      try {
        await createNotification({
          userId: result.ownerUserId,
          type: 'feedback_reply',
          title: 'New reply to your feedback',
          body: 'The Tixy team replied to your feedback. Open the ticket to continue the conversation.',
          href: `/feedback/${encodeURIComponent(result.entry.id)}`,
          preferenceKey: 'feedback_notifications',
          dedupeKey: `feedback-reply:${result.comment.id}`,
        });
      } catch {
        console.error('[feedback] reply notification failed');
      }
    }
    return NextResponse.json({ entry: result.entry, comment: result.comment }, { status: 201 });
  } catch (error) {
    if (error instanceof FeedbackError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('[feedback] admin reply failed');
    return NextResponse.json({ error: 'Unable to send this reply.' }, { status: 500 });
  }
}, {
  audit: ({ params }) => ({
    action: 'feedback.reply', targetType: 'feedback', targetId: params.id,
    details: { id: params.id },
  }),
});
