'use client';

import { useCallback, useContext, useEffect, useRef, useState, type CSSProperties } from 'react';
import { ArrowRight, Check, ChevronDown, Sparkles, Ticket } from 'lucide-react';

import {
  ArcadeButton,
  ArcadeChip,
  ArcadeLinkButton,
  ArcadePanel,
  ArcadeProgress,
} from '@/features/arcade/components/ui/arcade-ui';
import { AccountIdentityContext } from '@/features/arcade/components/shell/use-account-summary';

/* Lightweight local mirrors of the server `BattlepassState` shape so this
   client component never reaches into `@/server/**`. Only the fields the
   widget actually reads are modelled — the API returns a superset. */
type QuestView = {
  slotIndex: number;
  key: string;
  kind: string;
  label: string;
  targetGame: string | null;
  goal: number;
  progress: number;
  rewardXp: number;
  rewardTickets: number;
  claimed: boolean;
  complete: boolean;
};

type WeeklyQuestView = QuestView & { week: number };

// Season quests ship without a `complete` flag — completion is derived as
// progress >= goal (mirrors the server `SeasonQuestView` shape).
type SeasonQuestView = {
  slotIndex: number;
  key: string;
  kind: string;
  targetGame: string | null;
  label: string;
  goal: number;
  progress: number;
  rewardXp: number;
  rewardTickets: number;
  claimed: boolean;
};

type BattlepassStateLite = {
  seasonKey: string;
  seasonName: string;
  xp: number;
  tier: number;
  maxTier: number;
  bar: { into: number; need: number; atMax: boolean };
  quests: QuestView[];
  // Optional so an older API response (pre-weekly-quests) still parses.
  weeklyQuests?: WeeklyQuestView[];
  seasonQuests?: SeasonQuestView[];
};

const STORAGE_KEY = 'arcade:season-widget:open';

function readStoredOpen(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export function SeasonPassWidget() {
  const hasServerIdentity = useContext(AccountIdentityContext);
  const [state, setState] = useState<BattlepassStateLite | null>(null);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  // Tracks the slot currently being claimed, so only that row shows a busy state.
  const [claimingSlot, setClaimingSlot] = useState<number | null>(null);
  const mountedRef = useRef(true);
  const fetchInFlightRef = useRef<Promise<void> | null>(null);
  const lastFetchAtRef = useRef(0);
  const unauthorizedRef = useRef(false);

  // Restore the collapsed/expanded preference once on mount (client-only so it
  // never trips hydration — server render is always collapsed).
  useEffect(() => {
    setOpen(readStoredOpen());
  }, []);

  const fetchState = useCallback(() => {
    if (hasServerIdentity === false) return Promise.resolve();
    if (unauthorizedRef.current) return Promise.resolve();
    if (fetchInFlightRef.current) return fetchInFlightRef.current;
    if (performance.now() - lastFetchAtRef.current < 750) return Promise.resolve();

    const request = (async () => {
      lastFetchAtRef.current = performance.now();
      try {
        const res = await fetch('/api/battlepass', { cache: 'no-store' });
        if (!res.ok) {
          if (res.status === 401) unauthorizedRef.current = true;
          if (mountedRef.current && !state) setFailed(true);
          return;
        }
        const data = (await res.json()) as BattlepassStateLite | null;
        if (!mountedRef.current) return;
        if (!data || !Array.isArray(data.quests)) {
          if (!state) setFailed(true);
          return;
        }
        setState(data);
        setFailed(false);
      } catch {
        if (mountedRef.current && !state) setFailed(true);
      }
    })().finally(() => {
      fetchInFlightRef.current = null;
    });
    fetchInFlightRef.current = request;
    return request;
    // `state` is intentionally read to decide whether a failure should hide the
    // widget (only when we have nothing to show yet); identity is stable enough.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasServerIdentity]);

  useEffect(() => {
    mountedRef.current = true;
    void fetchState();
    return () => {
      mountedRef.current = false;
    };
  }, [fetchState]);

  // Refetch when the player returns to the tab (e.g. back from a game) so quest
  // progress + claim availability stay fresh.
  useEffect(() => {
    const onFocus = () => void fetchState();
    const onVisibilityChange = () => {
      if (!document.hidden) void fetchState();
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [fetchState]);

  const toggleOpen = useCallback(() => {
    setOpen((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(STORAGE_KEY, next ? '1' : '0');
      } catch {
        /* private mode / storage disabled — preference just won't persist */
      }
      return next;
    });
  }, []);

  // Claim a single daily quest by slot. Mirrors the battlepass client's POST shape.
  const claimSlot = useCallback(async (slotIndex: number) => {
    const res = await fetch('/api/battlepass/quests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'claim', slotIndex }),
    });
    return res.ok;
  }, []);

  // Claim a single weekly quest by (week, slot).
  const claimWeekly = useCallback(async (week: number, slotIndex: number) => {
    const res = await fetch('/api/battlepass/quests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'claim-weekly', week, slotIndex }),
    });
    return res.ok;
  }, []);

  const claimOne = useCallback(
    async (slotIndex: number) => {
      if (busy) return;
      setBusy(true);
      setClaimingSlot(slotIndex);
      try {
        await claimSlot(slotIndex);
      } finally {
        await fetchState();
        if (mountedRef.current) {
          setClaimingSlot(null);
          setBusy(false);
        }
      }
    },
    [busy, claimSlot, fetchState],
  );

  // Claim a single season quest by slot. No-op safe before the backend action lands.
  const claimSeason = useCallback(async (slotIndex: number) => {
    const res = await fetch('/api/battlepass/quests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'claim-season', slotIndex }),
    });
    return res.ok;
  }, []);

  const claimAll = useCallback(async () => {
    if (busy || !state) return;
    const readyDaily = state.quests.filter((q) => q.complete && !q.claimed);
    const readyWeekly = (state.weeklyQuests ?? []).filter((q) => q.complete && !q.claimed);
    const readySeason = (state.seasonQuests ?? []).filter((q) => q.progress >= q.goal && !q.claimed);
    if (readyDaily.length === 0 && readyWeekly.length === 0 && readySeason.length === 0) return;
    setBusy(true);
    try {
      // Sequential — the quest endpoint mutates shared season state per call.
      for (const quest of readyDaily) {
        await claimSlot(quest.slotIndex);
      }
      for (const quest of readyWeekly) {
        await claimWeekly(quest.week, quest.slotIndex);
      }
      for (const quest of readySeason) {
        await claimSeason(quest.slotIndex);
      }
    } finally {
      await fetchState();
      if (mountedRef.current) setBusy(false);
    }
  }, [busy, state, claimSlot, claimWeekly, claimSeason, fetchState]);

  // Hide entirely on hard failure with nothing to show — never break the dash.
  if (failed && !state) return null;
  if (!state) return null;

  const quests = state.quests ?? [];
  const weeklyQuests = state.weeklyQuests ?? [];
  const seasonQuests = state.seasonQuests ?? [];
  // Per-tier claimable / total for the three-tier summary line.
  const dailyReady = quests.filter((q) => q.complete && !q.claimed).length;
  const weeklyReady = weeklyQuests.filter((q) => q.complete && !q.claimed).length;
  const seasonReady = seasonQuests.filter((q) => q.progress >= q.goal && !q.claimed).length;
  // "Ready" spans all three tiers so Claim-all sweeps everything claimable.
  const readyCount = dailyReady + weeklyReady + seasonReady;
  const allClaimed = quests.length > 0 && quests.every((q) => q.claimed);

  const tierSummary: Array<{ label: string; ready: number; total: number }> = [
    { label: 'Dailies', ready: dailyReady, total: quests.length },
    { label: 'Weeklies', ready: weeklyReady, total: weeklyQuests.length },
    { label: 'Season', ready: seasonReady, total: seasonQuests.length },
  ];

  return (
    <ArcadePanel variant='raised' className='p-4 sm:p-5'>
      {/* Header row: season + tier + XP bar + ready badge */}
      <div className='flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between'>
        <div className='flex min-w-0 items-center gap-3'>
          <span className='grid size-10 shrink-0 place-items-center rounded-key border-2 border-ink bg-tickets text-tickets-on shadow-chip'>
            <Sparkles size={20} aria-hidden />
          </span>
          <div className='min-w-0'>
            <p className='arcade-kicker'>{state.seasonName}</p>
            <p className='mt-0.5 text-sm font-semibold text-strong'>
              Tier <span className='arcade-num'>{state.tier}</span>
              <span className='text-faint'> / {state.maxTier}</span>
            </p>
          </div>
        </div>

        <div className='flex min-w-0 flex-1 items-center gap-3 lg:max-w-md'>
          <div className='min-w-0 flex-1'>
            <ArcadeProgress
              current={state.bar.atMax ? state.bar.need : state.bar.into}
              max={Math.max(1, state.bar.need)}
              tone='tickets'
              className='arc-progress--railed'
            />
            <p className='mt-1 text-right text-[11px] text-faint'>
              {state.bar.atMax ? 'MAX TIER' : `${state.bar.into} / ${state.bar.need} XP`}
            </p>
          </div>
        </div>
      </div>

      {/* Three-tier summary — one compact line, claimable counts emphasised. */}
      <div className='mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-faint'>
        {tierSummary.map((t, i) => (
          <span key={t.label} className='inline-flex items-center gap-1'>
            {i > 0 ? <span aria-hidden className='text-faint'>·</span> : null}
            <span className='font-semibold text-body'>{t.label}</span>
            {t.ready > 0 ? (
              <span className='font-bold text-prize-text'>
                <span className='arcade-num'>{t.ready}</span>/
                <span className='arcade-num'>{t.total}</span> claimable
              </span>
            ) : (
              <span>
                <span className='arcade-num'>{t.total}</span>
              </span>
            )}
          </span>
        ))}
      </div>

      {/* Action row: ready badge + claim all + open pass + expand toggle */}
      <div className='mt-3 flex flex-wrap items-center gap-2'>
        {readyCount > 0 ? (
          <ArcadeChip tone='tickets'>
            <span className='arcade-num'>{readyCount}</span>
            &nbsp;{readyCount === 1 ? 'quest ready' : 'quests ready'}
          </ArcadeChip>
        ) : allClaimed ? (
          <span className='text-xs text-faint'>
            All quests claimed — see you tomorrow
          </span>
        ) : (
          <ArcadeChip>
            <span className='arcade-num'>{quests.length}</span>&nbsp;daily quests
          </ArcadeChip>
        )}

        <div className='ml-auto flex flex-wrap items-center gap-2'>
          {readyCount > 0 ? (
            <ArcadeButton
              type='button'
              tone='primary'
              size='sm'
              onClick={claimAll}
              disabled={busy}
            >
              {busy ? 'Claiming…' : 'Claim all'}
            </ArcadeButton>
          ) : null}
          <ArcadeLinkButton href='/battlepass' tone='ghost' size='sm'>
            Open Season Pass
            <ArrowRight size={14} />
          </ArcadeLinkButton>
          <ArcadeButton
            type='button'
            tone='ghost'
            size='sm'
            onClick={toggleOpen}
            aria-expanded={open}
            aria-controls='season-widget-quests'
          >
            {open ? 'Hide' : 'Quests'}
            <ChevronDown
              size={14}
              aria-hidden
              className={open ? 'rotate-180 transition-transform' : 'transition-transform'}
            />
          </ArcadeButton>
        </div>
      </div>

      {/* Expanded: inline daily quest list — height collapse for modern open/close */}
      <div
        id='season-widget-quests'
        className='arc-collapse'
        data-open={open ? '' : undefined}
      >
        <div className='arc-collapse-inner'>
          <div className='mt-4 space-y-2'>
            {quests.length === 0 ? (
              <p className='text-xs text-faint'>No quests available right now.</p>
            ) : (
              quests.map((q, i) => {
                const progress = Math.min(q.progress, q.goal);
                const canClaim = q.complete && !q.claimed;
                return (
                  <div
                    key={q.slotIndex}
                    className='arc-list-enter flex flex-col gap-2 rounded-key border-2 border-soft bg-raised p-3 sm:flex-row sm:items-center sm:gap-3'
                    style={{ '--i': Math.min(i, 6) } as CSSProperties}
                  >
                    <div className='min-w-0 flex-1'>
                      <p className='truncate text-sm font-semibold text-strong'>{q.label}</p>
                      <div className='mt-1.5 flex items-center gap-2'>
                        <div className='min-w-0 flex-1'>
                          <ArcadeProgress current={progress} max={Math.max(1, q.goal)} tone='tickets' className='arc-progress--railed' />
                        </div>
                        <span className='shrink-0 text-[11px] text-faint'>
                          <span className='arcade-num'>{progress}</span>/
                          <span className='arcade-num'>{q.goal}</span>
                        </span>
                      </div>
                    </div>

                    <div className='flex shrink-0 items-center gap-2'>
                      <ArcadeChip tone='tickets'>
                        <span className='arcade-num'>+{q.rewardXp}</span>&nbsp;XP
                      </ArcadeChip>
                      {q.rewardTickets > 0 ? (
                        <ArcadeChip tone='info'>
                          <Ticket size={10} aria-hidden />
                          &nbsp;
                          <span className='arcade-num'>{q.rewardTickets}</span>
                        </ArcadeChip>
                      ) : null}
                      {q.claimed ? (
                        <span className='inline-flex items-center gap-1 text-[11px] font-semibold text-prize-text'>
                          <Check size={12} className='arc-success-pop' aria-hidden /> Claimed
                        </span>
                      ) : (
                        <ArcadeButton
                          type='button'
                          tone='primary'
                          size='sm'
                          onClick={() => claimOne(q.slotIndex)}
                          disabled={!canClaim || busy}
                        >
                          {claimingSlot === q.slotIndex ? 'Claiming…' : 'Claim'}
                        </ArcadeButton>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </ArcadePanel>
  );
}
