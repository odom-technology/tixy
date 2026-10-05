import type { MultiplayerActivitySnapshot } from '@/server/arcade/multiplayer-activity';

const DEFAULT_MAX_AGE_MS = 15_000;

let snapshot: MultiplayerActivitySnapshot | null = null;
let loadedAt = 0;
let inFlight: Promise<MultiplayerActivitySnapshot> | null = null;
const listeners = new Set<(next: MultiplayerActivitySnapshot) => void>();

function publish(next: MultiplayerActivitySnapshot) {
  snapshot = next;
  loadedAt = Date.now();
  for (const listener of listeners) listener(next);
}

/**
 * Browser-local request coalescing for dashboard consumers. The multiplayer
 * spotlight remains the poll owner; Today subscribes to the same snapshots.
 */
export function loadMultiplayerActivity(options?: {
  force?: boolean;
  maxAgeMs?: number;
}): Promise<MultiplayerActivitySnapshot> {
  if (inFlight) return inFlight;
  const maxAgeMs = options?.maxAgeMs ?? DEFAULT_MAX_AGE_MS;
  if (!options?.force && snapshot && Date.now() - loadedAt <= maxAgeMs) {
    return Promise.resolve(snapshot);
  }

  inFlight = fetch('/api/games/multiplayer/activity', { cache: 'no-store' })
    .then(async (response) => {
      if (!response.ok) throw new Error('Unable to load multiplayer activity.');
      const next = (await response.json()) as MultiplayerActivitySnapshot;
      if (!next?.featured?.gameType || !next.featured.lobbyPath) {
        throw new Error('Invalid multiplayer activity response.');
      }
      publish(next);
      return next;
    })
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

export function subscribeMultiplayerActivity(
  listener: (next: MultiplayerActivitySnapshot) => void,
) {
  listeners.add(listener);
  if (snapshot) listener(snapshot);
  return () => {
    listeners.delete(listener);
  };
}
