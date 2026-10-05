'use client';

/* One place that reads and changes the season: /api/battlepass for the state,
   /api/battlepass/claim for tiers, /api/battlepass/quests for quests. The home
   (quests panel and the season modal) and the season page all use it, so a
   claim in one shows in the others. Claims answer with the new state; tickets
   land in the shell's wallet at once. */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { useOptionalGamesWallet } from '@/features/arcade/components/shell/games-wallet-provider';
import type { BattlepassState, RewardView, TierView } from '@/server/arcade/battlepass';

export type SeasonController = {
  state: BattlepassState | null;
  failed: boolean;
  busy: boolean;
  /** One plain line about the last claim, or null. */
  message: string | null;
  error: string | null;
  /** A key for the row or tier that was just claimed, for its settle. */
  fresh: string | null;
  claimTier: (tier: TierView, land?: Landing) => Promise<void>;
  claimQuest: (body: Record<string, unknown>, key: string, land?: Landing) => Promise<void>;
  reroll: (slotIndex: number) => Promise<void>;
  claimAll: () => Promise<void>;
  /** Every tier that is waiting, and no quests. */
  claimTiers: (land?: Landing) => Promise<void>;
};

/** Runs once a claim has paid and before the wallet moves: the home flies
 *  stubs to the balance here, so the number counts up as they land. */
export type Landing = (tickets: number) => Promise<void>;

const landThen = async (land: Landing | undefined, tickets: number) => {
  if (!land || tickets <= 0) return;
  try {
    await land(tickets);
  } catch {
    // The flight is decoration; the claim has already paid.
  }
};

type ClaimResponse = { error?: string; state?: BattlepassState; reward?: RewardView };

export const questKey = {
  daily: (slot: number) => `daily:${slot}`,
  card: (week: number, slot: number) => `card:${week}:${slot}`,
  weekly: (week: number, slot: number) => `weekly:${week}:${slot}`,
  season: (slot: number) => `season:${slot}`,
};

/** The body the quests route wants for a quest, by the key above. */
export const questClaimBody = (
  kind: 'daily' | 'card' | 'weekly' | 'season',
  slotIndex: number,
  week?: number,
): Record<string, unknown> => {
  if (kind === 'daily') return { action: 'claim', slotIndex };
  if (kind === 'card') return { action: 'claim-card', week, slotIndex };
  if (kind === 'weekly') return { action: 'claim-weekly', week, slotIndex };
  return { action: 'claim-season', slotIndex };
};

const post = async (url: string, body: Record<string, unknown>) => {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const payload = (await res.json().catch(() => ({}))) as ClaimResponse;
  if (!res.ok) throw new Error(payload.error || 'The claim did not go through.');
  return payload;
};

export type ReadyClaim = { body: Record<string, unknown>; key: string; tickets: number };

/** Every quest that is finished and not yet claimed, as the routes want them. */
export const readyQuestClaims = (state: BattlepassState): ReadyClaim[] => [
  ...state.quests
    .filter((q) => q.complete && !q.claimed)
    .map((q) => ({ body: questClaimBody('daily', q.slotIndex), key: questKey.daily(q.slotIndex), tickets: q.rewardTickets })),
  ...(state.weeklyCard
    ? [...state.weeklyCard.carryover, ...state.weeklyCard.quests]
        .filter((q) => q.complete && !q.claimed)
        .map((q) => ({
          body: questClaimBody('card', q.slotIndex, q.week),
          key: questKey.card(q.week, q.slotIndex),
          tickets: q.rewardTickets,
        }))
    : []),
  ...state.weeklyQuests
    .filter((q) => q.complete && !q.claimed)
    .map((q) => ({
      body: questClaimBody('weekly', q.slotIndex, q.week),
      key: questKey.weekly(q.week, q.slotIndex),
      tickets: q.rewardTickets,
    })),
  ...state.seasonQuests
    .filter((q) => q.progress >= q.goal && !q.claimed)
    .map((q) => ({ body: questClaimBody('season', q.slotIndex), key: questKey.season(q.slotIndex), tickets: q.rewardTickets })),
];

/** The tracks of a tier that can be claimed now. */
export const claimableTracks = (tier: TierView): Array<'free' | 'premium'> => {
  if (!tier.unlocked) return [];
  const tracks: Array<'free' | 'premium'> = [];
  if (!tier.freeClaimed) tracks.push('free');
  if (tier.premium && !tier.premiumClaimed) tracks.push('premium');
  return tracks;
};

export const tierClaimed = (tier: TierView) => tier.freeClaimed && (tier.premium == null || tier.premiumClaimed);

export function useSeasonController(initial: BattlepassState | null, load: boolean): SeasonController {
  const wallet = useOptionalGamesWallet();
  const adjustCredits = wallet?.adjustCredits;
  const [state, setState] = useState<BattlepassState | null>(initial);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fresh, setFresh] = useState<string | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    if (!load || initial) return;
    let cancelled = false;
    const run = async () => {
      try {
        const res = await fetch('/api/battlepass', { cache: 'no-store' });
        if (!res.ok) throw new Error();
        const data = (await res.json()) as BattlepassState;
        if (!cancelled) setState(data);
      } catch {
        if (!cancelled) setFailed(true);
      }
    };
    const idle = (window as Window & { requestIdleCallback?: (cb: () => void) => number }).requestIdleCallback;
    if (idle) idle(() => void run());
    else window.setTimeout(() => void run(), 600);
    return () => {
      cancelled = true;
    };
  }, [initial, load]);

  useEffect(() => {
    if (!fresh) return;
    const timer = window.setTimeout(() => setFresh(null), 700);
    return () => window.clearTimeout(timer);
  }, [fresh]);

  const run = useCallback(
    async (work: () => Promise<void>) => {
      if (busy) return;
      setBusy(true);
      setError(null);
      setMessage(null);
      try {
        await work();
      } catch (caught) {
        setError((caught as Error).message);
      } finally {
        setBusy(false);
      }
    },
    [busy],
  );

  const claimTier = useCallback(
    (tier: TierView, land?: Landing) =>
      run(async () => {
        let tickets = 0;
        const items: string[] = [];
        try {
          for (const track of claimableTracks(tier)) {
            const payload = await post('/api/battlepass/claim', { tier: tier.tier, track });
            if (payload.state) setState(payload.state);
            if (payload.reward?.kind === 'tickets') tickets += payload.reward.amount ?? 0;
            else if (payload.reward?.name) items.push(payload.reward.name);
          }
          await landThen(land, tickets);
        } finally {
          if (tickets > 0) adjustCredits?.(tickets);
          if (items.length > 0) window.dispatchEvent(new Event('store-inventory-updated'));
        }
        const parts = [tickets > 0 ? `${tickets.toLocaleString('en-US')} tickets` : null, ...items].filter(Boolean);
        setMessage(`Tier ${tier.tier} paid ${parts.join(' and ')}.`);
        setFresh(`tier:${tier.tier}`);
      }),
    [adjustCredits, run],
  );

  const claimQuest = useCallback(
    (body: Record<string, unknown>, key: string, land?: Landing) =>
      run(async () => {
        const current = stateRef.current;
        const before = current?.tier ?? 0;
        const tickets = current ? (readyQuestClaims(current).find((claim) => claim.key === key)?.tickets ?? 0) : 0;
        const payload = await post('/api/battlepass/quests', body);
        if (payload.state) setState(payload.state);
        await landThen(land, tickets);
        if (tickets > 0) adjustCredits?.(tickets);
        setFresh(key);
        const tier = payload.state?.tier ?? before;
        setMessage(tier > before ? `Tier ${tier}.` : null);
      }),
    [adjustCredits, run],
  );

  const reroll = useCallback(
    (slotIndex: number) =>
      run(async () => {
        const payload = await post('/api/battlepass/quests', { action: 'reroll', slotIndex });
        if (payload.state) setState(payload.state);
      }),
    [run],
  );

  const claimAll = useCallback(
    () =>
      run(async () => {
        let working = stateRef.current;
        if (!working) return;
        let tickets = 0;
        let count = 0;
        let itemClaimed = false;
        try {
          for (const claim of readyQuestClaims(working)) {
            const payload = await post('/api/battlepass/quests', claim.body);
            if (payload.state) {
              working = payload.state;
              setState(payload.state);
            }
            tickets += claim.tickets;
            count += 1;
          }
          // Quests go first: their XP can open more tiers.
          for (const tier of working.tiers) {
            for (const track of claimableTracks(tier)) {
              const payload = await post('/api/battlepass/claim', { tier: tier.tier, track });
              if (payload.state) {
                working = payload.state;
                setState(payload.state);
              }
              if (payload.reward?.kind === 'tickets') tickets += payload.reward.amount ?? 0;
              else itemClaimed = true;
              count += 1;
            }
          }
        } finally {
          if (tickets > 0) adjustCredits?.(tickets);
          if (itemClaimed) window.dispatchEvent(new Event('store-inventory-updated'));
        }
        setMessage(
          count === 0
            ? null
            : `Claimed ${count} ${count === 1 ? 'reward' : 'rewards'}${tickets > 0 ? `, ${tickets.toLocaleString('en-US')} tickets` : ''}.`,
        );
      }),
    [adjustCredits, run],
  );

  const claimTiers = useCallback(
    (land?: Landing) =>
      run(async () => {
        let working = stateRef.current;
        if (!working) return;
        let tickets = 0;
        const items: string[] = [];
        const paid: number[] = [];
        try {
          for (const tier of working.tiers) {
            for (const track of claimableTracks(tier)) {
              const payload = await post('/api/battlepass/claim', { tier: tier.tier, track });
              if (payload.state) {
                working = payload.state;
                setState(payload.state);
              }
              if (payload.reward?.kind === 'tickets') tickets += payload.reward.amount ?? 0;
              else if (payload.reward?.name) items.push(payload.reward.name.toLowerCase());
              if (paid.at(-1) !== tier.tier) paid.push(tier.tier);
            }
          }
          await landThen(land, tickets);
        } finally {
          if (tickets > 0) adjustCredits?.(tickets);
          if (items.length > 0) window.dispatchEvent(new Event('store-inventory-updated'));
        }
        if (paid.length === 0) return;
        const parts = [tickets > 0 ? `${tickets.toLocaleString('en-US')} tickets` : null, ...items].filter(Boolean);
        const which = paid.length === 1 ? `Tier ${paid[0]}` : `Tiers ${paid.slice(0, -1).join(', ')} and ${paid.at(-1)}`;
        setMessage(`${which} paid ${parts.join(' and ')}.`);
        setFresh(`tier:${paid.at(-1)}`);
      }),
    [adjustCredits, run],
  );

  return { state, failed, busy, message, error, fresh, claimTier, claimQuest, reroll, claimAll, claimTiers };
}

const SeasonContext = createContext<SeasonController | null>(null);

export function SeasonProvider({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  const controller = useSeasonController(null, enabled);
  return <SeasonContext.Provider value={controller}>{children}</SeasonContext.Provider>;
}

export function useSeason(): SeasonController | null {
  return useContext(SeasonContext);
}
