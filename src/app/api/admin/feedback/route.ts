import { NextResponse } from 'next/server';

import { withAdmin } from '@/server/admin/guard';
import {
  getFeedbackById,
  listFeedback,
  updateFeedbackStatus,
  type FeedbackCategory,
  type FeedbackStatus,
} from '@/server/feedback';
import { createNotification } from '@/server/services/notifications';

export const dynamic = 'force-dynamic';

export const GET = withAdmin(async (request) => {
  const url = new URL(request.url);
  const status = url.searchParams.get('status') as FeedbackStatus | 'all' | null;
  const category = url.searchParams.get('category') as FeedbackCategory | 'all' | null;
  const query = url.searchParams.get('q');
  const limit = Number(url.searchParams.get('limit') ?? 100);

  try {
    const entries = await listFeedback({
      status: status ?? 'open',
      category: category ?? 'all',
      query,
      limit,
    });
    return NextResponse.json({ entries });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message || 'Unable to load feedback.' },
      { status: 400 },
    );
  }
});

export const PATCH = withAdmin(async (request, { identity }) => {
  let body: {
    id?: string;
    status?: FeedbackStatus;
    adminNote?: string | null;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 });
  }

  if (!body.id?.trim()) {
    return NextResponse.json({ error: 'id is required.' }, { status: 400 });
  }
  if (!body.status) {
    return NextResponse.json({ error: 'status is required.' }, { status: 400 });
  }

  try {
    const previous = await getFeedbackById(body.id);
    const entry = await updateFeedbackStatus({
      id: body.id,
      status: body.status,
      adminNote: body.adminNote,
      actorUserId: identity.userId,
    });
    const noteChanged = (previous?.adminNote ?? '') !== (entry.adminNote ?? '');
    const statusChanged = previous?.status !== entry.status;
    if (previous?.userId && (statusChanged || noteChanged)) {
      await createNotification({
        userId: previous.userId,
        type: 'feedback_status',
        title: getFeedbackNotificationTitle(entry.status, statusChanged),
        body: getFeedbackNotificationBody(entry.status, entry.adminNote, statusChanged),
        href: `/feedback/${encodeURIComponent(entry.id)}`,
        preferenceKey: 'feedback_notifications',
      });
    }
    return NextResponse.json({ entry });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message || 'Unable to update feedback.' },
      { status: 400 },
    );
  }
}, {
  audit: ({ body }) => {
    const input = (body ?? {}) as { id?: unknown; status?: unknown };
    return {
      action: 'feedback.update',
      targetType: 'feedback',
      targetId: typeof input.id === 'string' ? input.id.trim() : null,
      details: { id: input.id, status: input.status },
    };
  },
});

function getFeedbackNotificationTitle(status: FeedbackStatus, statusChanged: boolean) {
  if (!statusChanged) return 'Feedback note updated';
  if (status === 'resolved') return 'Feedback resolved';
  if (status === 'dismissed') return 'Feedback dismissed';
  return 'Feedback reopened';
}

function getFeedbackNotificationBody(
  status: FeedbackStatus,
  adminNote: string | null,
  statusChanged: boolean,
) {
  const note = adminNote ? ` Admin note: ${adminNote}` : '';
  if (!statusChanged) {
    return `An admin updated the note on one of your feedback reports.${note}`;
  }
  if (status === 'resolved') {
    return `An admin marked one of your feedback reports as resolved.${note}`;
  }
  if (status === 'dismissed') {
    return `An admin dismissed one of your feedback reports.${note}`;
  }
  return `An admin reopened one of your feedback reports for another look.${note}`;
}
