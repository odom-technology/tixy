import { NextResponse } from 'next/server';

import { requireIdentity } from '@/server/auth';
import { getUnreadConversationCount } from '@/server/social/messaging';

export const dynamic = 'force-dynamic';

// GET — count of DM conversations with unread messages (drives the nav badge).
// Fail-soft: returns 0 rather than erroring so the badge fetch never throws.
export async function GET() {
  let identity;
  try {
    identity = await requireIdentity({ allowExternal: true });
  } catch {
    return NextResponse.json({ unreadCount: 0 });
  }

  try {
    const unreadCount = await getUnreadConversationCount(identity.userId);
    return NextResponse.json({ unreadCount });
  } catch {
    return NextResponse.json({ unreadCount: 0 });
  }
}
