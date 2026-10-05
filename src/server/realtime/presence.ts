// ---------------------------------------------------------------------------
// Presence service. Tracks who is online and what they're playing, and fans
// status changes out to each of the user's friends over the SSE layer.
//
// Source of truth for "now" is the in-memory map below (pinned on globalThis),
// driven by live SSE connections + client heartbeats. The arcade_user_presence
// table persists last-seen for offline display and survives restarts.
// ---------------------------------------------------------------------------
import { listAcceptedFriendIds } from '@/server/arcade/multiplayer';
import { query } from '@/server/db/client';
import { isUserOnline, publish } from '@/server/realtime/pubsub';

export type PresenceStatus = 'online' | 'in_game' | 'away' | 'offline';

export type PresenceState = {
  status: PresenceStatus;
  gameSlug: string | null;
  lastSeenAt: number;
};

export type FriendPresence = PresenceState & { userId: string };

const VALID_STATUSES = new Set<PresenceStatus>(['online', 'in_game', 'away', 'offline']);
// A brief grace before flipping offline, so page navigation (which drops and
// re-opens the SSE connection) doesn't flap a user's status.
const OFFLINE_GRACE_MS = 12_000;

type PresenceStore = {
  map: Map<string, PresenceState>;
  offlineTimers: Map<string, ReturnType<typeof setTimeout>>;
};

const STORE_KEY = '__arcadePresenceStore__';

function getStore(): PresenceStore {
  const g = globalThis as unknown as Record<string, PresenceStore | undefined>;
  let store = g[STORE_KEY];
  if (!store) {
    store = { map: new Map(), offlineTimers: new Map() };
    g[STORE_KEY] = store;
  }
  return store;
}

export function isValidPresenceStatus(value: unknown): value is PresenceStatus {
  return typeof value === 'string' && VALID_STATUSES.has(value as PresenceStatus);
}

async function persist(userId: string, state: PresenceState): Promise<void> {
  await query(
    `
      INSERT INTO arcade_user_presence (user_id, status, game_slug, last_seen_at, updated_at)
      VALUES ($1, $2, $3, $4, $4)
      ON CONFLICT (user_id) DO UPDATE SET
        status = EXCLUDED.status,
        game_slug = EXCLUDED.game_slug,
        last_seen_at = EXCLUDED.last_seen_at,
        updated_at = EXCLUDED.updated_at
    `,
    [userId, state.status, state.gameSlug, state.lastSeenAt],
  );
}

async function fanOutToFriends(userId: string, state: PresenceState): Promise<void> {
  let friendIds: string[];
  try {
    friendIds = await listAcceptedFriendIds(userId);
  } catch {
    return;
  }
  if (friendIds.length === 0) return;
  publish(
    friendIds.map((id) => `user:${id}`),
    {
      type: 'presence',
      userId,
      status: state.status,
      gameSlug: state.gameSlug,
      lastSeenAt: state.lastSeenAt,
    },
  );
}

/** Set a user's presence, persist it, and fan out to friends if it changed. */
export async function setPresence(
  userId: string,
  status: PresenceStatus,
  gameSlug: string | null = null,
): Promise<PresenceState> {
  const store = getStore();
  const now = Date.now();
  const next: PresenceState = {
    status,
    gameSlug: status === 'in_game' ? gameSlug : null,
    lastSeenAt: now,
  };
  const prev = store.map.get(userId);

  if (status === 'offline') {
    store.map.delete(userId);
  } else {
    store.map.set(userId, next);
  }

  try {
    await persist(userId, next);
  } catch {
    // presence is best-effort; never throw into a caller
  }

  const changed = !prev || prev.status !== next.status || prev.gameSlug !== next.gameSlug;
  if (changed) await fanOutToFriends(userId, next);
  if (status === 'offline') {
    // Lazy import avoids coupling the core presence module to multiplayer at
    // startup. Once the SSE grace period confirms the player really left,
    // persisted friend alerts must stop claiming they are waiting.
    void import('@/server/arcade/multiplayer-waiting-notifications')
      .then(({ resolveWaitingNotificationsForOfflineOwner }) =>
        resolveWaitingNotificationsForOfflineOwner(userId),
      )
      .catch(() => {});
  }
  return next;
}

async function touch(userId: string): Promise<void> {
  const store = getStore();
  const prev = store.map.get(userId);
  if (!prev) return;
  prev.lastSeenAt = Date.now();
  try {
    await persist(userId, prev);
  } catch {
    // ignore
  }
}

/** Called by the SSE route when a user opens their FIRST connection. */
export async function markConnected(userId: string): Promise<void> {
  const store = getStore();
  const timer = store.offlineTimers.get(userId);
  if (timer) {
    clearTimeout(timer);
    store.offlineTimers.delete(userId);
  }
  if (store.map.has(userId)) {
    // Reconnecting within the grace window — keep status, just refresh last-seen.
    await touch(userId);
  } else {
    await setPresence(userId, 'online');
  }
}

/** Called by the SSE route when a user's LAST connection drops. */
export function markDisconnected(userId: string): void {
  const store = getStore();
  if (store.offlineTimers.has(userId)) return;
  const timer = setTimeout(() => {
    store.offlineTimers.delete(userId);
    // Only go offline if they didn't reconnect (e.g. another tab) in the meantime.
    if (!isUserOnline(userId)) void setPresence(userId, 'offline');
  }, OFFLINE_GRACE_MS);
  store.offlineTimers.set(userId, timer);
}

/** Apply a client-reported status (heartbeat / visibility / in-game). */
export async function applyClientPresence(
  userId: string,
  status: PresenceStatus,
  gameSlug?: string | null,
): Promise<PresenceState> {
  return setPresence(userId, status, gameSlug ?? null);
}

/** Current presence of a user's accepted friends (for initial page load). */
export async function getFriendsPresence(userId: string): Promise<FriendPresence[]> {
  const friendIds = await listAcceptedFriendIds(userId);
  if (friendIds.length === 0) return [];

  const store = getStore();
  const result: FriendPresence[] = [];
  const offlineIds: string[] = [];

  for (const id of friendIds) {
    const live = store.map.get(id);
    if (live) {
      result.push({ userId: id, ...live });
    } else {
      offlineIds.push(id);
    }
  }

  if (offlineIds.length > 0) {
    const rows = await query<{ user_id: string; last_seen_at: string | number }>(
      `SELECT user_id, last_seen_at FROM arcade_user_presence WHERE user_id = ANY($1::text[])`,
      [offlineIds],
    );
    const lastSeen = new Map(rows.rows.map((r) => [r.user_id, Number(r.last_seen_at)]));
    for (const id of offlineIds) {
      result.push({
        userId: id,
        status: 'offline',
        gameSlug: null,
        lastSeenAt: lastSeen.get(id) ?? 0,
      });
    }
  }

  return result;
}
