'use client';

// ---------------------------------------------------------------------------
// Client presence store + controller.
//
// - A module-level store of friends' presence, exposed via React hooks.
// - The controller opens the shared SSE connection (which is what marks the
//   user "online" server-side), seeds friends' presence, heartbeats, and
//   tracks tab visibility (online <-> away).
// - Match pages call useInGamePresence(slug) to broadcast "what they're playing".
// ---------------------------------------------------------------------------
import { useEffect, useSyncExternalStore } from 'react';

import { subscribeLive, type LiveEventPayload } from '@/lib/liveEvents';

export type PresenceStatus = 'online' | 'in_game' | 'away' | 'offline';

export type FriendPresence = {
  userId: string;
  status: PresenceStatus;
  gameSlug: string | null;
  lastSeenAt: number;
};

const store = new Map<string, FriendPresence>();
const listeners = new Set<() => void>();
let version = 0;

function emit() {
  version += 1;
  for (const listener of listeners) listener();
}

function subscribeStore(callback: () => void) {
  listeners.add(callback);
  return () => {
    listeners.delete(callback);
  };
}

function getVersion() {
  return version;
}

export function seedPresence(list: FriendPresence[]) {
  store.clear();
  for (const presence of list) store.set(presence.userId, presence);
  emit();
}

export function applyPresenceDelta(presence: FriendPresence) {
  store.set(presence.userId, presence);
  emit();
}

export function getFriendPresence(userId: string): FriendPresence | undefined {
  return store.get(userId);
}

// --- React hooks (re-render on any presence change; the set is tiny) ---

export function useFriendPresence(userId: string | null | undefined): FriendPresence | undefined {
  useSyncExternalStore(subscribeStore, getVersion, getVersion);
  return userId ? store.get(userId) : undefined;
}

export function useOnlineFriends(): FriendPresence[] {
  useSyncExternalStore(subscribeStore, getVersion, getVersion);
  return [...store.values()].filter((presence) => presence.status !== 'offline');
}

export function useOnlineFriendCount(): number {
  useSyncExternalStore(subscribeStore, getVersion, getVersion);
  let count = 0;
  for (const presence of store.values()) if (presence.status !== 'offline') count += 1;
  return count;
}

// --- Controller / heartbeat ---

type Intent = { status: 'online' | 'away' | 'in_game'; gameSlug: string | null };

const HEARTBEAT_MS = 50_000;

let started = false;
let intent: Intent = { status: 'online', gameSlug: null };
let unsubscribeLive: (() => void) | null = null;
let heartbeat: ReturnType<typeof setInterval> | null = null;

async function postPresence(body: { status: PresenceStatus; gameSlug?: string | null }) {
  try {
    await fetch('/api/social/presence', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      keepalive: true,
    });
  } catch {
    // best-effort
  }
}

function handleLiveEvent(payload: LiveEventPayload) {
  if (!payload || payload.type !== 'presence' || typeof payload.userId !== 'string') return;
  applyPresenceDelta({
    userId: payload.userId,
    status: (payload.status as PresenceStatus) ?? 'offline',
    gameSlug: (payload.gameSlug as string | null) ?? null,
    lastSeenAt: typeof payload.lastSeenAt === 'number' ? payload.lastSeenAt : Date.now(),
  });
}

function handleVisibility() {
  if (intent.status === 'in_game') return; // keep in_game across tab blur
  intent = {
    status: document.visibilityState === 'visible' ? 'online' : 'away',
    gameSlug: null,
  };
  void postPresence({ status: intent.status });
}

export function startPresence(userId: string) {
  if (started || typeof window === 'undefined' || !userId) return;
  started = true;

  // Opening the SSE connection is what registers this user as online and
  // delivers friends' presence deltas to this tab.
  unsubscribeLive = subscribeLive([`user:${userId}`], handleLiveEvent);

  void fetch('/api/social/presence', { cache: 'no-store' })
    .then((response) => (response.ok ? response.json() : null))
    .then((data) => {
      if (data?.friends) seedPresence(data.friends as FriendPresence[]);
    })
    .catch(() => {});

  heartbeat = setInterval(() => {
    void postPresence({ status: intent.status, gameSlug: intent.gameSlug });
  }, HEARTBEAT_MS);

  document.addEventListener('visibilitychange', handleVisibility);
}

export function stopPresence() {
  started = false;
  unsubscribeLive?.();
  unsubscribeLive = null;
  if (heartbeat) clearInterval(heartbeat);
  heartbeat = null;
  if (typeof document !== 'undefined') {
    document.removeEventListener('visibilitychange', handleVisibility);
  }
  intent = { status: 'online', gameSlug: null };
  if (store.size > 0) {
    store.clear();
    emit();
  }
}

export function setInGamePresence(gameSlug: string) {
  if (typeof window === 'undefined') return;
  intent = { status: 'in_game', gameSlug };
  void postPresence({ status: 'in_game', gameSlug });
}

export function clearInGamePresence() {
  if (typeof window === 'undefined') return;
  const visible = document.visibilityState !== 'hidden';
  intent = { status: visible ? 'online' : 'away', gameSlug: null };
  void postPresence({ status: intent.status });
}

/** Mark the current page as "playing {gameSlug}" while mounted. */
export function useInGamePresence(gameSlug: string | null | undefined) {
  useEffect(() => {
    if (!gameSlug) return;
    setInGamePresence(gameSlug);
    return () => clearInGamePresence();
  }, [gameSlug]);
}
