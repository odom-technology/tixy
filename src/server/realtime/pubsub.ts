// ---------------------------------------------------------------------------
// In-memory realtime pub/sub for SSE fan-out.
//
// This is the delivery layer behind `broadcast()` (src/server/events.ts) and
// the `/api/live` SSE endpoint. It is intentionally dependency-free and lives
// entirely in the single long-lived `server.ts` process. The registry is pinned
// on `globalThis` so it survives module reloads (tsx/HMR in dev), mirroring how
// the pg pool is cached.
//
// Multi-instance note: when the app scales past one process, swap the body of
// `publish()` for a Redis (or similar) fan-out and keep this same interface —
// callers only ever touch `publish()` / `registerConnection()` and never see
// the transport.
// ---------------------------------------------------------------------------

export type RealtimeConnection = {
  id: string;
  userId: string;
  topics: Set<string>;
  /** Write a pre-encoded SSE frame to this connection's stream. */
  send: (chunk: string) => void;
  /** Force the underlying stream to close (e.g. on auth revoke). */
  close: () => void;
};

type Registry = {
  topicSubs: Map<string, Set<RealtimeConnection>>;
  userConns: Map<string, Set<RealtimeConnection>>;
};

const REGISTRY_KEY = '__arcadeRealtimeRegistry__';

function getRegistry(): Registry {
  const g = globalThis as unknown as Record<string, Registry | undefined>;
  let reg = g[REGISTRY_KEY];
  if (!reg) {
    reg = { topicSubs: new Map(), userConns: new Map() };
    g[REGISTRY_KEY] = reg;
  }
  return reg;
}

export function registerConnection(conn: RealtimeConnection): void {
  const reg = getRegistry();

  let userSet = reg.userConns.get(conn.userId);
  if (!userSet) {
    userSet = new Set();
    reg.userConns.set(conn.userId, userSet);
  }
  userSet.add(conn);

  for (const topic of conn.topics) {
    let set = reg.topicSubs.get(topic);
    if (!set) {
      set = new Set();
      reg.topicSubs.set(topic, set);
    }
    set.add(conn);
  }
}

export function unregisterConnection(conn: RealtimeConnection): void {
  const reg = getRegistry();

  const userSet = reg.userConns.get(conn.userId);
  if (userSet) {
    userSet.delete(conn);
    if (userSet.size === 0) reg.userConns.delete(conn.userId);
  }

  for (const topic of conn.topics) {
    const set = reg.topicSubs.get(topic);
    if (set) {
      set.delete(conn);
      if (set.size === 0) reg.topicSubs.delete(topic);
    }
  }
  // Note: deliberately does NOT call conn.close() — the SSE route owns the
  // stream lifecycle and calls this from its own cleanup.
}

/**
 * Fan a payload out to every connection subscribed to any of `topic`.
 * A single publish to `['chess:42', 'chessMatch']` reaches a connection once,
 * carrying the full published-topic list so the client can route to the right
 * handler(s).
 */
export function publish(topic: string | string[], payload: unknown): void {
  const topics = Array.isArray(topic) ? topic : [topic];
  if (topics.length === 0) return;

  const reg = getRegistry();
  const targets = new Set<RealtimeConnection>();
  for (const t of topics) {
    const set = reg.topicSubs.get(t);
    if (set) for (const c of set) targets.add(c);
  }
  if (targets.size === 0) return;

  let frame: string;
  try {
    frame = `data: ${JSON.stringify({ t: topics, d: payload })}\n\n`;
  } catch {
    return; // non-serializable payload — drop rather than throw into a caller
  }
  for (const c of targets) {
    try {
      c.send(frame);
    } catch {
      // a dead connection; it will be cleaned up by its own abort handler
    }
  }
}

/** Forcibly disconnect every live connection for a user (e.g. on session revoke). */
export function closeUserConnections(userId: string): void {
  const set = getRegistry().userConns.get(userId);
  if (!set) return;
  for (const conn of [...set]) {
    try {
      conn.close();
    } catch {
      // ignore
    }
  }
}

export function isUserOnline(userId: string): boolean {
  const set = getRegistry().userConns.get(userId);
  return !!set && set.size > 0;
}

export function connectionCountForUser(userId: string): number {
  return getRegistry().userConns.get(userId)?.size ?? 0;
}

export function getOnlineUserIds(): string[] {
  return [...getRegistry().userConns.keys()];
}
