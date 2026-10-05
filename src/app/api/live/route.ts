// ---------------------------------------------------------------------------
// Server-Sent Events stream. One long-lived connection per browser tab carries
// every realtime topic the user is allowed to see (multiplexed). Clients connect
// via the shared EventSource in src/lib/liveEvents.ts (`subscribeLive`).
//
// Requires the custom server.ts (it forwards non-/ws requests to Next, which
// streams this ReadableStream). The anti-cheat WebSocket on /ws is unrelated.
// ---------------------------------------------------------------------------
import { randomUUID } from 'node:crypto';

import { requireIdentity } from '@/server/auth';
import { isGuestIdentity } from '@/server/auth/guest';
import {
  connectionCountForUser,
  registerConnection,
  unregisterConnection,
  type RealtimeConnection,
} from '@/server/realtime/pubsub';
import { markConnected, markDisconnected } from '@/server/realtime/presence';
import { computeAllowedTopics } from '@/server/realtime/topic-access';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const HEARTBEAT_MS = 25_000;
const MAX_REQUESTED_TOPICS = 100;
const PUBLIC_ANONYMOUS_TOPICS = new Set(['gameLeaderboards', 'derby']);

export async function GET(request: Request) {
  let identity: Awaited<ReturnType<typeof requireIdentity>> | null = null;
  try {
    identity = await requireIdentity({ allowExternal: true, allowGuest: true });
  } catch {
    identity = null;
  }
  const accountIdentity = identity && !isGuestIdentity(identity) ? identity : null;

  const url = new URL(request.url);
  const requested = (url.searchParams.get('topics') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, MAX_REQUESTED_TOPICS);
  const allowed = accountIdentity
    ? await computeAllowedTopics(accountIdentity.userId, requested)
    : requested.filter((topic) => PUBLIC_ANONYMOUS_TOPICS.has(topic));
  if (allowed.length === 0) {
    return new Response('Unauthorized', { status: 401 });
  }
  const connectionUserId = accountIdentity?.userId ?? `anonymous:${randomUUID()}`;

  const encoder = new TextEncoder();
  let closed = false;
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let controllerRef: ReadableStreamDefaultController<Uint8Array> | null = null;
  let conn: RealtimeConnection | null = null;

  function cleanup() {
    if (closed) return;
    closed = true;
    if (heartbeat) {
      clearInterval(heartbeat);
      heartbeat = null;
    }
    if (conn) {
      unregisterConnection(conn);
      // Last connection for this user → start the offline grace timer.
      if (accountIdentity && connectionCountForUser(accountIdentity.userId) === 0) {
        markDisconnected(accountIdentity.userId);
      }
      conn = null;
    }
    try {
      controllerRef?.close();
    } catch {
      // already closed
    }
    controllerRef = null;
  }

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controllerRef = controller;
      const send = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          // consumer went away (e.g. proxy dropped the socket) — tear down
          cleanup();
        }
      };

      conn = {
        id: randomUUID(),
        userId: connectionUserId,
        topics: new Set(allowed),
        send,
        close: cleanup,
      };
      registerConnection(conn);
      // First connection for this user → they just came online.
      if (accountIdentity && connectionCountForUser(accountIdentity.userId) === 1) {
        void markConnected(accountIdentity.userId);
      }

      // Initial comment flushes headers and confirms the stream is open.
      send(`: connected ${Date.now()}\n\n`);
      // Heartbeat keeps intermediaries from closing an idle connection AND
      // doubles as dead-connection detection (enqueue throws once closed).
      heartbeat = setInterval(() => send(`: ping ${Date.now()}\n\n`), HEARTBEAT_MS);
    },
    cancel() {
      cleanup();
    },
  });

  request.signal.addEventListener('abort', cleanup);

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // Disable proxy buffering (nginx) so events flush immediately.
      'X-Accel-Buffering': 'no',
    },
  });
}
