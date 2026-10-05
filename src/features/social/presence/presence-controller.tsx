'use client';

import { useEffect } from 'react';

import { fetchCurrentUserId } from '@/features/users/current-user-client';
import { startPresence, stopPresence } from './presence-client';

/**
 * Mounted once in the app shell. Resolves the signed-in user and starts the
 * presence connection (which marks them online and streams friends' presence).
 * Renders nothing.
 */
export function PresenceController({ enabled = true }: { enabled?: boolean }) {
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    void fetchCurrentUserId()
      .then((userId) => {
        if (!cancelled && userId) startPresence(userId);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      stopPresence();
    };
  }, [enabled]);

  return null;
}
