import { NextResponse } from 'next/server';

import { requireIdentity } from '@/server/auth';
import {
  applyClientPresence,
  getFriendsPresence,
  isValidPresenceStatus,
} from '@/server/realtime/presence';

export const dynamic = 'force-dynamic';

// GET: seed the caller's friends' current presence on page load (the SSE stream
// only carries deltas afterwards).
export async function GET() {
  let identity;
  try {
    identity = await requireIdentity({ allowExternal: true });
  } catch {
    return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  }

  try {
    const friends = await getFriendsPresence(identity.userId);
    return NextResponse.json({ friends });
  } catch (error) {
    console.error('Failed to load presence:', error);
    return NextResponse.json({ error: 'Unable to load presence.' }, { status: 500 });
  }
}

// POST: client heartbeat / status update (online | away | in_game | offline).
export async function POST(request: Request) {
  let identity;
  try {
    identity = await requireIdentity({ allowExternal: true });
  } catch {
    return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  }

  let body: { status?: unknown; gameSlug?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 });
  }

  const status = body.status;
  if (!isValidPresenceStatus(status)) {
    return NextResponse.json({ error: 'Invalid status.' }, { status: 400 });
  }
  // Offline is derived from the SSE connection lifecycle, not self-reported —
  // otherwise a connected user could spoof themselves offline to friends.
  if (status === 'offline') {
    return NextResponse.json({ error: 'Cannot self-report offline.' }, { status: 400 });
  }

  let gameSlug: string | null = null;
  if (status === 'in_game') {
    if (typeof body.gameSlug !== 'string' || !body.gameSlug.trim()) {
      return NextResponse.json({ error: 'gameSlug is required for in_game.' }, { status: 400 });
    }
    gameSlug = body.gameSlug.trim().slice(0, 64);
  }

  try {
    const presence = await applyClientPresence(identity.userId, status, gameSlug);
    return NextResponse.json({ ok: true, presence });
  } catch (error) {
    console.error('Failed to update presence:', error);
    return NextResponse.json({ error: 'Unable to update presence.' }, { status: 500 });
  }
}
