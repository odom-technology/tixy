import { NextResponse } from 'next/server';

import { getAccountById } from '@/server/accounts';
import { requireIdentity } from '@/server/auth';
import { getClientIp } from '@/server/auth/auth-rate-limit';
import { createFeedback, FeedbackError, listFeedbackForUser, toFeedbackTicketEntry } from '@/server/feedback';

export const dynamic = 'force-dynamic';

const FEEDBACK_LIMIT = 5;
const FEEDBACK_WINDOW_MS = 60 * 60 * 1000;
const feedbackSubmissions = new Map<string, number[]>();

function feedbackLimit(key: string) {
  const now = Date.now();
  const previous = feedbackSubmissions.get(key) ?? [];
  const recent = previous.filter((time) => time > now - FEEDBACK_WINDOW_MS);
  if (recent.length === 0) feedbackSubmissions.delete(key);
  else feedbackSubmissions.set(key, recent);
  if (recent.length >= FEEDBACK_LIMIT) {
    return Math.max(1, Math.ceil((recent[0] + FEEDBACK_WINDOW_MS - now) / 1000));
  }
  return 0;
}

function recordFeedbackSubmission(key: string) {
  feedbackSubmissions.set(key, [...(feedbackSubmissions.get(key) ?? []), Date.now()]);
}

async function getOptionalIdentity() {
  try {
    return await requireIdentity({ allowExternal: true });
  } catch {
    return null;
  }
}

export async function GET() {
  const identity = await getOptionalIdentity();
  if (!identity) {
    return NextResponse.json({ entries: [] });
  }

  return NextResponse.json({
    entries: (await listFeedbackForUser(identity.userId, 50)).map(toFeedbackTicketEntry),
  });
}

export async function POST(request: Request) {
  const identity = await getOptionalIdentity();
  const account = identity ? await getAccountById(identity.userId) : null;
  const limitKey = identity ? `account:${identity.userId}` : `ip:${getClientIp(request)}`;
  const retryAfter = feedbackLimit(limitKey);
  if (retryAfter) {
    return NextResponse.json(
      { error: 'Too many messages. Please try again later.' },
      { status: 429, headers: { 'Retry-After': String(retryAfter) } },
    );
  }

  if (Number(request.headers.get('content-length')) > 16_384) {
    return NextResponse.json({ error: 'Message is too long.' }, { status: 413 });
  }

  let body: {
    category?: unknown;
    rating?: unknown;
    message?: string | null;
    pagePath?: string | null;
    contactEmail?: string | null;
    website?: string | null;
  };

  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 });
  }

  if (!body || typeof body !== 'object' || Array.isArray(body) || body.website) {
    return NextResponse.json({ error: 'Unable to submit message.' }, { status: 400 });
  }

  const allowedFields = new Set(['category', 'rating', 'message', 'pagePath', 'contactEmail', 'website']);
  if (Object.keys(body).some((key) => !allowedFields.has(key)) ||
      typeof body.message !== 'string' ||
      (body.category !== undefined && typeof body.category !== 'string') ||
      (body.pagePath !== undefined && body.pagePath !== null && typeof body.pagePath !== 'string') ||
      (body.contactEmail !== undefined && body.contactEmail !== null && typeof body.contactEmail !== 'string') ||
      (body.website !== undefined && body.website !== null && typeof body.website !== 'string') ||
      (body.rating !== undefined && body.rating !== null &&
        (typeof body.rating !== 'number' || !Number.isInteger(body.rating) || body.rating < 1 || body.rating > 5))) {
    return NextResponse.json({ error: 'Invalid feedback fields.' }, { status: 400 });
  }
  if ((body.pagePath?.length ?? 0) > 300 || (body.contactEmail?.length ?? 0) > 254) {
    return NextResponse.json({ error: 'Page or contact email is too long.' }, { status: 400 });
  }

  try {
    const entry = await createFeedback({
      userId: identity?.userId ?? null,
      userName: identity?.name ?? account?.username ?? null,
      email: account?.email ?? body.contactEmail ?? null,
      category: body.category,
      rating: body.rating,
      message: body.message,
      pagePath: body.pagePath,
      userAgent: request.headers.get('user-agent'),
    });
    recordFeedbackSubmission(limitKey);
    return NextResponse.json({ entry: toFeedbackTicketEntry(entry) }, { status: 201 });
  } catch (error) {
    if (error instanceof FeedbackError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('[feedback] submission failed');
    return NextResponse.json({ error: 'Unable to submit feedback.' }, { status: 500 });
  }
}
