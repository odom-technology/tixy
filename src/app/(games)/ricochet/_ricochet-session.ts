/* Ricochet's run session, client side: fetch a session ahead so the first
   press starts at once, ask the server to stamp the run's start, and read the
   server's errors. The server hands out the seed and holds the start time
   (src/app/api/games/ricochet/score/route.ts replays the run from them). */

export const SESSION_MAX_AGE_MS = 30 * 60 * 1000;
const STAMP_TIMEOUT_MS = 5000;

export type PreparedRun =
  | {
      ok: true;
      guest: boolean;
      token: string | null;
      sessionId: string | null;
      seed: number;
      fetchedAt: number;
    }
  | { ok: false; status: number; error: string; banned: boolean; retryAfterSec: number | null };

export type PreparedOk = Extract<PreparedRun, { ok: true }>;
export type PreparedFailed = Extract<PreparedRun, { ok: false }>;

export const getSubmitErrorMessage = (
  status: number,
  data: { error?: string; details?: string; retryAfterSec?: number } | null,
) => {
  if (status === 429) {
    const retry = typeof data?.retryAfterSec === 'number' ? ` Try again in ${data.retryAfterSec}s.` : '';
    return `${data?.error ?? 'Too many runs.'}${retry}`;
  }
  if (typeof data?.error === 'string' && data.error.trim()) return data.error;
  return 'Could not save your run. Try again.';
};

/** The session route's 403: banned. Plain, with the time left when there is one. */
export const banMessage = (data: { retryAfterSec?: number; isIndefinite?: boolean } | null) => {
  if (data?.isIndefinite) return 'You are banned until an admin lifts it.';
  const sec = data?.retryAfterSec;
  if (typeof sec !== 'number') return 'You are banned from games.';
  const total = Math.max(0, Math.floor(sec));
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `Ban ends in ${pad(Math.floor(total / 3600))}:${pad(Math.floor((total % 3600) / 60))}:${pad(total % 60)}.`;
};

export const randomSeed = () => {
  const buffer = new Uint32Array(1);
  crypto.getRandomValues(buffer);
  return buffer[0]! % 2 ** 31;
};

/** A new session: its seed and token. Signed out (401) is a guest run with a
 *  local seed that saves nothing. */
export async function fetchRunSession(): Promise<PreparedRun> {
  try {
    const response = await fetch('/api/games/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gameType: 'ricochet' }),
    });
    if (response.ok) {
      const data = (await response.json()) as { token?: string; sessionId?: string; ricochetSeed?: number };
      if (
        typeof data.token !== 'string' ||
        typeof data.sessionId !== 'string' ||
        typeof data.ricochetSeed !== 'number'
      ) {
        return { ok: false, status: 500, error: 'Could not start your run. Try again.', banned: false, retryAfterSec: null };
      }
      return {
        ok: true,
        guest: false,
        token: data.token,
        sessionId: data.sessionId,
        seed: data.ricochetSeed,
        fetchedAt: Date.now(),
      };
    }
    if (response.status === 401) {
      return { ok: true, guest: true, token: null, sessionId: null, seed: randomSeed(), fetchedAt: Date.now() };
    }
    const data = (await response.json().catch(() => null)) as
      | { error?: string; retryAfterSec?: number; isIndefinite?: boolean }
      | null;
    return {
      ok: false,
      status: response.status,
      error: response.status === 403 ? banMessage(data) : getSubmitErrorMessage(response.status, data),
      banned: response.status === 403,
      retryAfterSec: typeof data?.retryAfterSec === 'number' ? data.retryAfterSec : null,
    };
  } catch {
    return { ok: false, status: 0, error: 'Could not reach the server. Try again.', banned: false, retryAfterSec: null };
  }
}

/** Ask the server to stamp the run's start on its session. */
export async function stampRunStart(sessionId: string | null): Promise<boolean> {
  if (!sessionId) return false;
  try {
    const response = await fetch('/api/games/session', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, action: 'start' }),
      // A hung request must not strand the player on a busy stage.
      signal: AbortSignal.timeout(STAMP_TIMEOUT_MS),
    });
    return response.ok;
  } catch {
    return false;
  }
}
