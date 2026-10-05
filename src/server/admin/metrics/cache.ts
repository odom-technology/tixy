/* A small in-process cache for the metric sections. Admins refresh; a burst of
   refreshes must not re-run every query. Entries live for `ttlMs` (30 s by
   default) and callers that arrive while a section loads share its promise. */

type Entry = { at: number; value: unknown };

const entries = new Map<string, Entry>();
const pending = new Map<string, Promise<unknown>>();

export const METRICS_CACHE_TTL_MS = 30_000;

export function cached<T>(
  section: string,
  days: number,
  load: () => Promise<T>,
  ttlMs: number = METRICS_CACHE_TTL_MS,
): Promise<T> {
  const key = `${section}:${days}`;
  const hit = entries.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return Promise.resolve(hit.value as T);
  const inflight = pending.get(key);
  if (inflight) return inflight as Promise<T>;
  const promise = load()
    .then((value) => {
      entries.set(key, { at: Date.now(), value });
      return value;
    })
    .finally(() => {
      pending.delete(key);
    });
  pending.set(key, promise);
  return promise;
}

/** For tests and the seed script. */
export function clearMetricsCache() {
  entries.clear();
  pending.clear();
}
