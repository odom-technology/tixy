'use client';

import { canonicalGamePath } from '@/features/arcade/lib/game-renames';

export const GUEST_RUN_COMPLETED_EVENT = 'arcade:guest-run-completed';

export type ProductEventName =
  | 'landing_view'
  | 'game_started'
  | 'game_completed'
  | 'auth_nudge_shown'
  | 'auth_nudge_clicked'
  | 'auth_nudge_dismissed'
  | 'signup_success'
  | 'signin_success'
  | 'result_shared'
  | 'challenge_opened';

export type ProductEventContext = {
  gameSlug?: string | null;
  source?: string | null;
};

const SESSION_STORAGE_KEY = 'arcade:analytics-session-id';
const AUTH_SOURCE_STORAGE_KEY = 'arcade:auth-attribution-source';
let pageSessionId: string | null = null;
let lastCompletion: { gameSlug: string | null; at: number } | null = null;

function randomId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

function analyticsSessionId() {
  if (typeof window === 'undefined') return null;
  if (pageSessionId) return pageSessionId;
  try {
    const existing = window.sessionStorage.getItem(SESSION_STORAGE_KEY);
    if (existing) {
      pageSessionId = existing;
      return existing;
    }
    const created = randomId();
    window.sessionStorage.setItem(SESSION_STORAGE_KEY, created);
    pageSessionId = created;
    return created;
  } catch {
    // Storage-disabled sessions can still emit events, but receive a fresh,
    // short-lived identifier per page load rather than a durable browser ID.
    pageSessionId = randomId();
    return pageSessionId;
  }
}

export function gameSlugFromPath(pathname = window.location.pathname) {
  const [first] = canonicalGamePath(pathname).split('/').filter(Boolean);
  return first?.toLowerCase() || null;
}

/** Best-effort, first-party capture. Gameplay and navigation never wait on it. */
export async function trackProductEvent(
  event: ProductEventName,
  context: ProductEventContext = {},
) {
  if (typeof window === 'undefined') return false;
  const sessionId = analyticsSessionId();
  if (!sessionId) return false;

  try {
    const response = await fetch('/api/analytics/events', {
      method: 'POST',
      keepalive: true,
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: randomId(),
        event,
        sessionId,
        path: window.location.pathname,
        gameSlug: context.gameSlug ?? undefined,
        source: context.source ?? undefined,
      }),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export function setAuthAttributionSource(source: string) {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(AUTH_SOURCE_STORAGE_KEY, source);
  } catch {
    // Attribution is optional.
  }
}

export function consumeAuthAttributionSource() {
  if (typeof window === 'undefined') return null;
  try {
    const source = window.sessionStorage.getItem(AUTH_SOURCE_STORAGE_KEY);
    window.sessionStorage.removeItem(AUTH_SOURCE_STORAGE_KEY);
    return source;
  } catch {
    return null;
  }
}

export function trackGameCompletion({ guest = false }: { guest?: boolean } = {}) {
  const gameSlug = gameSlugFromPath();
  const now = Date.now();
  const duplicate = Boolean(
    lastCompletion
      && lastCompletion.gameSlug === gameSlug
      && now - lastCompletion.at < 500,
  );
  if (!duplicate) {
    lastCompletion = { gameSlug, at: now };
    void trackProductEvent('game_completed', {
      gameSlug,
      source: guest ? 'guest_result' : 'saved_result',
    });
  }
  if (guest && typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent(GUEST_RUN_COMPLETED_EVENT, { detail: { gameSlug } }),
    );
  }
}
