import { NextResponse } from 'next/server';

import { requireIdentity } from '@/server/auth';
import {
  captureProductEvent,
  isProductAnalyticsEvent,
} from '@/server/analytics/product-analytics';

export const dynamic = 'force-dynamic';

type EventBody = {
  id?: string;
  event?: string;
  sessionId?: string;
  path?: string;
  gameSlug?: string;
  source?: string;
};

export async function POST(request: Request) {
  const contentLength = Number(request.headers.get('content-length') ?? 0);
  if (Number.isFinite(contentLength) && contentLength > 2_048) {
    return NextResponse.json({ error: 'Payload too large.' }, { status: 413 });
  }

  let body: EventBody;
  try {
    body = (await request.json()) as EventBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 });
  }

  if (!body.event || !isProductAnalyticsEvent(body.event) || !body.sessionId) {
    return NextResponse.json({ error: 'Invalid event.' }, { status: 400 });
  }

  let isAuthenticated = false;
  let actorId: string | null = null;
  try {
    const identity = await requireIdentity({ allowExternal: true });
    isAuthenticated = !identity.isGuest;
    actorId = isAuthenticated ? identity.userId : null;
  } catch {
    // Anonymous funnel events are expected and remain unlinkable to an account.
  }

  try {
    const accepted = await captureProductEvent({
      id: body.id,
      event: body.event,
      sessionId: body.sessionId,
      isAuthenticated,
      actorId,
      path: body.path,
      gameSlug: body.gameSlug,
      source: body.source,
    });
    return NextResponse.json({ accepted }, { status: 202 });
  } catch (error) {
    console.error('Failed to capture product analytics event:', error);
    return NextResponse.json({ error: 'Event capture unavailable.' }, { status: 503 });
  }
}
