import { NextResponse } from 'next/server';

import { requireIdentity } from '@/server/auth';
import { SECRET_TRIGGER_KEYS } from '@/server/arcade/achievements';
import { recordStats } from '@/server/arcade/stats';
import { add, secretStat } from '@/server/arcade/stats/stat-keys';

export const dynamic = 'force-dynamic';

// Per-process throttle: one accepted trigger per (user, key) per window. Keeps a
// spammer from inflating count-based secrets (window-shopper, fashionista). The
// achievements themselves are idempotent, so this is just abuse-dampening.
const THROTTLE_MS = 1500;
const lastSeen = new Map<string, number>();

/** Record a client-detected easter-egg trigger and return any unlocks. */
export async function POST(request: Request) {
  let identity;
  try {
    identity = await requireIdentity({ allowExternal: true });
  } catch {
    return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 });
  }

  const key = String((body as { key?: unknown })?.key ?? '').trim();
  if (!key || !SECRET_TRIGGER_KEYS.has(key)) {
    return NextResponse.json({ error: 'Unknown trigger.' }, { status: 400 });
  }

  const throttleKey = `${identity.userId}:${key}`;
  const now = Date.now();
  const prev = lastSeen.get(throttleKey) ?? 0;
  if (now - prev < THROTTLE_MS) {
    return NextResponse.json({ achievements: [] });
  }
  // Evict stale entries so the map can't grow unbounded across many users.
  if (lastSeen.size > 5000) {
    for (const [k, t] of lastSeen) {
      if (now - t > THROTTLE_MS) lastSeen.delete(k);
    }
  }
  lastSeen.set(throttleKey, now);

  const achievements = await recordStats(identity.userId, [add(secretStat(key), 1)]);
  return NextResponse.json({ achievements });
}
