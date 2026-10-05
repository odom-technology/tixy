'use client';

import { useEffect, useSyncExternalStore } from 'react';

/* The fairness proof moves onto the receipt under tixy (PLAN.md, "Ticket
   machines": one line on the receipt, the badge goes). Wager clients render
   ArcadeProvablyFair beside the result, not inside it, so the two meet here:
   the badge publishes its seed, a mounted receipt prints it, and once a
   receipt has shown on a page the badge stays hidden there, so the layout
   doesn't jump each round. A game can skip this and pass `fairness` to
   ArcadeWagerResultPlate directly. */

export type WagerFairness = {
  seedHash: string | null;
  revealedSeed: number | null;
};

type State = {
  fairness: WagerFairness | null;
  /** A receipt has shown since the badge mounted (this page). */
  receiptSeen: boolean;
};

let state: State = { fairness: null, receiptSeen: false };
const listeners = new Set<() => void>();
const SERVER_STATE: State = { fairness: null, receiptSeen: false };

function set(next: Partial<State>) {
  state = { ...state, ...next };
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function useStore() {
  return useSyncExternalStore(subscribe, () => state, () => SERVER_STATE);
}

/** Called by ArcadeProvablyFair with the round it is showing. */
export function usePublishWagerFairness(seedHash: string | null, revealedSeed: number | null) {
  useEffect(() => {
    set({ fairness: { seedHash, revealedSeed } });
    return () => set({ fairness: null });
  }, [seedHash, revealedSeed]);
  // Leaving the page (the badge unmounts) forgets the receipt.
  useEffect(() => () => set({ receiptSeen: false }), []);
}

/** Called by every mounted receipt. Returns the published proof. */
export function useReceiptFairness(): WagerFairness | null {
  useEffect(() => {
    if (!state.receiptSeen) set({ receiptSeen: true });
  }, []);
  return useStore().fairness;
}

/** True once a receipt has shown on this page. */
export function useReceiptCarriesFairness(): boolean {
  return useStore().receiptSeen;
}
