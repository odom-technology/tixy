'use client';

import { useEffect, useSyncExternalStore } from 'react';

/* Whether a GameShell is on the page. App-wide pieces that sit outside the
   game's tree (the post-run sign-in nudge) read it: on a shell page the
   result already says what signing in saves. */

let mounted = 0;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Called by GameShell. */
export function useMarkGameShell() {
  useEffect(() => {
    mounted += 1;
    emit();
    return () => {
      mounted -= 1;
      emit();
    };
  }, []);
}

export function useGameShellPresent(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => mounted > 0,
    () => false,
  );
}
