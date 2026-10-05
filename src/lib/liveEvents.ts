'use client';

// ---------------------------------------------------------------------------
// Client realtime subscription. All callers share ONE EventSource to
// /api/live, multiplexing every topic any component currently wants. The
// connection is reconnected (debounced) whenever the union of subscribed
// topics changes, and torn down when the last subscriber unsubscribes.
//
// `subscribeLive(topics, handler)` keeps its original signature, so existing
// chess/pool callers work unchanged — they now receive real server pushes
// instead of relying solely on their polling backstops.
// ---------------------------------------------------------------------------

export type LiveEventPayload = {
  topic?: string;
  [key: string]: unknown;
};

type LiveEventHandler = (payload: LiveEventPayload) => void;

type Subscription = {
  topics: Set<string>;
  handler: LiveEventHandler;
};

type WireFrame = {
  t?: string[];
  d?: LiveEventPayload;
};

const subscriptions = new Set<Subscription>();
let source: EventSource | null = null;
let currentTopicKey = '';
let syncTimer: ReturnType<typeof setTimeout> | null = null;
let errorCount = 0;
let backoffTimer: ReturnType<typeof setTimeout> | null = null;
const MAX_CONSECUTIVE_ERRORS = 5;
const ERROR_BACKOFF_MS = 30_000;

function unionTopicKey(): string {
  const all = new Set<string>();
  for (const sub of subscriptions) {
    for (const topic of sub.topics) all.add(topic);
  }
  return [...all].sort().join(',');
}

function handleMessage(event: MessageEvent) {
  errorCount = 0; // a delivered message means the stream is healthy
  let frame: WireFrame;
  try {
    frame = JSON.parse(event.data);
  } catch {
    return;
  }
  const topics = frame.t;
  const payload = frame.d;
  if (!Array.isArray(topics) || !payload || typeof payload !== 'object') return;

  const published = new Set(topics);
  for (const sub of subscriptions) {
    let matched: string | undefined;
    for (const topic of sub.topics) {
      if (published.has(topic)) {
        matched = topic;
        break;
      }
    }
    if (matched) {
      sub.handler({ ...payload, topic: payload.topic ?? matched });
    }
  }
}

function syncConnection() {
  syncTimer = null;
  if (typeof window === 'undefined' || typeof EventSource === 'undefined') return;

  const key = unionTopicKey();

  if (key === '') {
    if (source) {
      source.close();
      source = null;
      currentTopicKey = '';
    }
    return;
  }

  if (source && key === currentTopicKey) return; // nothing changed

  // A topic change (or manual resync) is a fresh start — cancel any backoff.
  if (backoffTimer != null) {
    clearTimeout(backoffTimer);
    backoffTimer = null;
  }
  errorCount = 0;

  if (source) {
    source.close();
    source = null;
  }
  currentTopicKey = key;

  const next = new EventSource(`/api/live?topics=${encodeURIComponent(key)}`, {
    withCredentials: true,
  });
  next.onopen = () => {
    errorCount = 0;
  };
  next.onmessage = handleMessage;
  // The browser auto-reconnects on transient errors. A persistent failure (e.g.
  // an expired-session 401) would otherwise retry-loop forever — after a few
  // consecutive errors, close and back off before trying again.
  next.onerror = () => {
    errorCount += 1;
    if (errorCount < MAX_CONSECUTIVE_ERRORS || next !== source) return;
    next.close();
    source = null;
    currentTopicKey = '';
    if (backoffTimer == null) {
      backoffTimer = setTimeout(() => {
        backoffTimer = null;
        errorCount = 0;
        syncConnection();
      }, ERROR_BACKOFF_MS);
    }
  };
  source = next;
}

function scheduleSync() {
  if (syncTimer != null) return;
  // Coalesce the burst of subscribe() calls that fire together on mount.
  syncTimer = setTimeout(syncConnection, 30);
}

export function subscribeLive(topics: string[], handler: LiveEventHandler) {
  if (typeof window === 'undefined') return () => {};

  const sub: Subscription = { topics: new Set(topics), handler };
  subscriptions.add(sub);
  scheduleSync();

  return () => {
    subscriptions.delete(sub);
    scheduleSync();
  };
}
