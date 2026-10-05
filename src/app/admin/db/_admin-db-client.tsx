'use client';

import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useState,
} from 'react';
import type { ReactNode } from 'react';
import {
  ConsoleMetric,
  ConsolePanel,
  ConsoleTabs,
} from '@/features/admin/components/admin-console';
import type { LucideIcon } from 'lucide-react';
import { Clock3, Download, RefreshCw, Trash2 } from 'lucide-react';

import { AdminCatalogPanel } from '@/features/admin/components/admin-catalog-panel';
import {
  ArcadeAnchorButton,
  ArcadeButton,
} from '@/features/arcade/components/ui/arcade-ui';
import {
  GAME_TIME_DISPLAY_GAMES,
  getGameTimeDisplayLabel,
  getGameTimeDuration,
  getNonZeroGameTimeRows,
  type GameTimeDisplayGameId,
} from '@/features/arcade/lib/game-time';
import { readJson } from '@/lib/read-json';

import type {
  ArcadeEconomyStats,
  AntiCheatLogResponse,
  CurrencyLedgerEntry,
  FeedbackLogResponse,
  StoreCatalogGroup,
  StoreCatalogItem,
  StoreVisibilityConfig,
  TimeCardRow,
} from './_types';
import { formatDurationMs } from './_helpers';

type AdminDbPage = 'game-time' | 'economy' | 'logs';
const ECONOMY_TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'ledger', label: 'Ledger' },
  { id: 'store', label: 'Store' },
  { id: 'catalog', label: 'Catalog' },
  { id: 'adjustments', label: 'Adjustments' },
];
type BannerTone = 'success' | 'error';
type BannerState = { tone: BannerTone; message: string } | null;
type RefreshTarget = 'credits' | 'all';
type TimeCardSortMode = 'name' | 'today' | 'mtd' | 'lastMonth' | 'allTime';
type TimeCardGameFilter = 'all' | GameTimeDisplayGameId;

type RewardsPayload = {
  entries: CurrencyLedgerEntry[];
  arcadeStats?: ArcadeEconomyStats;
  storeCatalog?: StoreCatalogItem[];
  storeGroups?: StoreCatalogGroup[];
  storeVisibility?: StoreVisibilityConfig;
  storeRotationDateKey?: string;
  storeRotationItemIds?: string[];
  catalogWarning?: string;
};

const panelClass = 'arcade-card';
const inputClass = 'arcade-input px-3 py-2 text-sm';
const selectClass = inputClass;
const tableWrapClass = 'arcade-card overflow-hidden';
const INITIAL_LOGS_VISIBLE_COUNT = 5;
const LOGS_SHOW_MORE_STEP = 10;

function formatDateTime(value?: number | null) {
  if (!value) return 'Never';
  return new Date(value).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: false,
  });
}

function formatCount(value: number) {
  return new Intl.NumberFormat('en-US').format(value);
}

function formatReasonValue(value: unknown): string {
  if (value === null || value === undefined) return 'n/a';
  if (typeof value === 'number')
    return Number.isFinite(value) ? `${value}` : 'n/a';
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function formatAntiCheatReason(reason?: string | null): string | null {
  if (!reason) return null;
  const pipeIndex = reason.indexOf('|');
  if (pipeIndex < 0) return reason;

  const summary = reason.slice(0, pipeIndex).trim();
  const rawDetails = reason.slice(pipeIndex + 1).trim();
  if (!rawDetails.startsWith('{') || !rawDetails.endsWith('}')) {
    return reason;
  }

  try {
    const parsed = JSON.parse(rawDetails) as Record<string, unknown>;
    const detailRows = Object.entries(parsed).map(
      ([key, value]) => `${key}: ${formatReasonValue(value)}`,
    );
    if (detailRows.length === 0) return summary || reason;
    return `${summary}\n${detailRows.join('\n')}`;
  } catch {
    return reason;
  }
}

function getTimeCardGameLabel(game: TimeCardGameFilter) {
  if (game !== 'all') return getGameTimeDisplayLabel(game);
  return 'All Games';
}

function getTimeCardMetricValue(
  bucket: TimeCardRow['today'],
  game: TimeCardGameFilter,
) {
  return getGameTimeDuration(bucket, game);
}

export default function AdminDBClient({
  page,
  economyTab: requestedTab,
}: {
  page: AdminDbPage;
  economyTab?: string;
}) {
  const [banner, setBanner] = useState<BannerState>(null);
  const economyTab = ECONOMY_TABS.some((tab) => tab.id === requestedTab)
    ? requestedTab
    : 'overview';
  const [economyLoadError, setEconomyLoadError] = useState<string | null>(null);

  const [ledgerRows, setLedgerRows] = useState<CurrencyLedgerEntry[]>([]);
  const [ledgerLoading, setLedgerLoading] = useState(false);
  const [ledgerCurrencyFilter, setLedgerCurrencyFilter] = useState('all');
  const [ledgerSourceFilter, setLedgerSourceFilter] = useState('all');
  const [ledgerLimit, setLedgerLimit] = useState(50);
  const [storeCatalogRows, setStoreCatalogRows] = useState<StoreCatalogItem[]>(
    [],
  );
  const [storeCatalogGroups, setStoreCatalogGroups] = useState<
    StoreCatalogGroup[]
  >([]);
  const [arcadeStats, setArcadeStats] = useState<ArcadeEconomyStats>({
    walletCount: 0,
    totalCreditsInWallets: 0,
    arcadeRoundsPlayed: 0,
    arcadeCreditsWagered: 0,
    arcadeCreditsPaidOut: 0,
    arcadeHouseProfit: 0,
    arcadeActualRtp: 0,
    perGame: [],
    storeCreditsSpent: 0,
  });
  const [storeVisibility, setStoreVisibility] = useState<StoreVisibilityConfig>(
    {
      creditsEnabled: true,
      gameCreditsEnabled: true,
    },
  );
  const [storeRotationDateKey, setStoreRotationDateKey] = useState<string>('—');
  const [storeRotationItemIds, setStoreRotationItemIds] = useState<string[]>(
    [],
  );
  const [catalogWarning, setCatalogWarning] = useState<string | null>(null);
  const [economyBusy, setEconomyBusy] = useState<string | null>(null);
  const [selectedCatalogItemIds, setSelectedCatalogItemIds] = useState<
    Set<string>
  >(new Set());
  const [economyLoaded, setEconomyLoaded] = useState(false);
  const [ledgerVisibleCount, setLedgerVisibleCount] = useState(20);
  const [globalCurrencyType] = useState<'credits'>('credits');
  const [globalCurrencyDirection, setGlobalCurrencyDirection] = useState<
    'add' | 'remove'
  >('add');
  const [globalCurrencyAmount, setGlobalCurrencyAmount] = useState('100');
  const [globalCurrencyReason, setGlobalCurrencyReason] = useState('');
  const economyMutationDisabled =
    ledgerLoading || Boolean(economyBusy) || Boolean(economyLoadError);

  const [timeCardRows, setTimeCardRows] = useState<TimeCardRow[]>([]);
  const [timeCardSearch, setTimeCardSearch] = useState('');
  const [timeCardSort, setTimeCardSort] = useState<TimeCardSortMode>('allTime');
  const [timeCardGameFilter, setTimeCardGameFilter] =
    useState<TimeCardGameFilter>('all');
  const [timeCardLoading, setTimeCardLoading] = useState(false);
  const [timeCardLoaded, setTimeCardLoaded] = useState(false);
  const deferredTimeCardSearch = useDeferredValue(timeCardSearch);

  const [antiCheatLogs, setAntiCheatLogs] =
    useState<AntiCheatLogResponse | null>(null);
  const [antiCheatDate, setAntiCheatDate] = useState('');
  const [antiCheatFilter, setAntiCheatFilter] = useState('all');
  const [antiCheatGameFilter, setAntiCheatGameFilter] = useState('all');
  const [feedbackLogs, setFeedbackLogs] = useState<FeedbackLogResponse | null>(
    null,
  );
  const [feedbackFilter, setFeedbackFilter] = useState('all');
  const [logsLoading, setLogsLoading] = useState(false);
  const [logsLoaded, setLogsLoaded] = useState(false);
  const [antiCheatVisibleCount, setAntiCheatVisibleCount] = useState(
    INITIAL_LOGS_VISIBLE_COUNT,
  );
  const [feedbackVisibleCount, setFeedbackVisibleCount] = useState(
    INITIAL_LOGS_VISIBLE_COUNT,
  );

  const showBanner = useCallback((tone: BannerTone, message: string) => {
    setBanner({ tone, message });
  }, []);

  const loadEconomy = useCallback(
    async (forceRefreshTarget?: RefreshTarget) => {
      setLedgerLoading(true);
      setEconomyLoadError(null);
      setBanner(null);
      setEconomyBusy(
        forceRefreshTarget ? `refresh-${forceRefreshTarget}` : null,
      );
      try {
        const params = new URLSearchParams();
        params.set('includeCatalog', '1');
        params.set('limit', String(ledgerLimit));
        if (ledgerCurrencyFilter !== 'all') {
          params.set('currencyType', ledgerCurrencyFilter);
        }
        if (ledgerSourceFilter !== 'all') {
          params.set('sourceType', ledgerSourceFilter);
        }
        if (forceRefreshTarget) {
          params.set('forceRefreshStore', '1');
          params.set('refreshTarget', forceRefreshTarget);
        }

        const data = await readJson<RewardsPayload>(
          `/api/admin/db/rewards?${params.toString()}`,
        );
        setLedgerRows(data.entries);
        setArcadeStats(
          data.arcadeStats ?? {
            walletCount: 0,
            totalCreditsInWallets: 0,
            arcadeRoundsPlayed: 0,
            arcadeCreditsWagered: 0,
            arcadeCreditsPaidOut: 0,
            arcadeHouseProfit: 0,
            arcadeActualRtp: 0,
            perGame: [],
            storeCreditsSpent: 0,
          },
        );
        setStoreCatalogRows(data.storeCatalog ?? []);
        setStoreCatalogGroups(data.storeGroups ?? []);
        setStoreVisibility(
          data.storeVisibility ?? {
            creditsEnabled: true,
            gameCreditsEnabled: true,
          },
        );
        setStoreRotationDateKey(data.storeRotationDateKey ?? '—');
        setStoreRotationItemIds(data.storeRotationItemIds ?? []);
        setCatalogWarning(data.catalogWarning ?? null);
        setEconomyLoaded(true);
        if (forceRefreshTarget && data.catalogWarning) {
          showBanner('error', data.catalogWarning);
          return false;
        }
        return true;
      } catch (error) {
        setEconomyLoadError((error as Error).message);
        showBanner('error', (error as Error).message);
        return false;
      } finally {
        setLedgerLoading(false);
        setEconomyBusy(null);
      }
    },
    [ledgerCurrencyFilter, ledgerLimit, ledgerSourceFilter, showBanner],
  );

  const updateStoreVisibility = useCallback(
    async (key: keyof StoreVisibilityConfig, value: boolean, label: string) => {
      setEconomyBusy(`visibility-${key}`);
      try {
        const data = await readJson<{ storeVisibility: StoreVisibilityConfig }>(
          '/api/admin/db/rewards',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'set-store-visibility',
              [key]: value,
            }),
          },
        );
        setStoreVisibility(data.storeVisibility);
        showBanner('success', `${label} updated.`);
      } catch (error) {
        showBanner('error', (error as Error).message);
      } finally {
        setEconomyBusy(null);
      }
    },
    [showBanner],
  );

  const applyCatalogActiveState = useCallback(
    async (itemIds: string[], active: boolean) => {
      if (itemIds.length === 0) {
        showBanner('error', 'Select one or more catalog items first.');
        return;
      }
      setEconomyBusy(active ? 'catalog-active' : 'catalog-inactive');
      try {
        await readJson('/api/admin/db/rewards', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'set-items-active',
            itemIds,
            active,
          }),
        });
        setSelectedCatalogItemIds(new Set());
        const refreshed = await loadEconomy();
        showBanner(
          refreshed ? 'success' : 'error',
          `${itemIds.length} catalog item${itemIds.length === 1 ? '' : 's'} updated.${refreshed ? '' : ' The update was saved, but refreshed data could not be loaded. Reload before another change.'}`,
        );
      } catch (error) {
        showBanner('error', (error as Error).message);
      } finally {
        setEconomyBusy(null);
      }
    },
    [loadEconomy, showBanner],
  );

  // "Set inactive" retires items: off sale, owners keep them. Deleting
  // (selected or the whole catalog) is refused by the server unless every item
  // is inactive, nobody owns it, and it isn't an earned reward.
  const deleteCatalogItems = useCallback(
    async (clearAll = false) => {
      const itemIds = clearAll ? [] : Array.from(selectedCatalogItemIds);
      if (!clearAll && itemIds.length === 0) {
        showBanner('error', 'Select catalog items first.');
        return;
      }
      const refusal =
        'It is refused if any item is on sale, owned by a player, or earned from an achievement, the battle pass, a milestone or an admin grant. Set items inactive to take them off sale and keep them for their owners.';
      const confirmText = clearAll
        ? `Delete the entire store catalog? ${refusal} This cannot be undone.`
        : `Delete ${itemIds.length} selected catalog item${itemIds.length === 1 ? '' : 's'} for good? ${refusal} A deleted catalog item can come back on sale at the next deploy.`;
      if (!window.confirm(confirmText)) return;

      setEconomyBusy(clearAll ? 'catalog-clear' : 'catalog-delete');
      try {
        const data = await readJson<{ result: { deletedItemIds?: string[] } }>(
          '/api/admin/db/rewards',
          {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(clearAll ? { clearAll: true } : { itemIds, mode: 'delete' }),
          },
        );
        setSelectedCatalogItemIds(new Set());
        const refreshed = await loadEconomy();
        const deleted = data.result.deletedItemIds?.length ?? 0;
        showBanner(
          refreshed ? 'success' : 'error',
          `${clearAll ? 'Store catalog cleared.' : `${deleted} catalog item${deleted === 1 ? '' : 's'} deleted.`}${refreshed ? '' : ' The deletion was saved, but refreshed data could not be loaded. Reload before another change.'}`,
        );
      } catch (error) {
        showBanner('error', (error as Error).message);
      } finally {
        setEconomyBusy(null);
      }
    },
    [loadEconomy, selectedCatalogItemIds, showBanner],
  );

  const refreshStoreRotation = useCallback(
    async (target: RefreshTarget) => {
      try {
        const refreshed = await loadEconomy(target);
        if (refreshed) {
          showBanner(
            'success',
            target === 'all'
              ? 'All store rotations refreshed.'
              : 'Ticket rotation refreshed.',
          );
        }
      } catch (error) {
        showBanner('error', (error as Error).message);
      }
    },
    [loadEconomy, showBanner],
  );

  const applyGlobalCurrencyAdjustment = useCallback(async () => {
    const amount = Number(globalCurrencyAmount);
    if (!Number.isInteger(amount) || amount <= 0) {
      showBanner('error', 'Enter a whole-number amount greater than zero.');
      return;
    }
    if (!globalCurrencyReason.trim()) {
      showBanner('error', 'Provide a reason for the global currency change.');
      return;
    }

    const signedAmount =
      globalCurrencyDirection === 'remove'
        ? -Math.abs(amount)
        : Math.abs(amount);
    const confirmMessage = `${
      globalCurrencyDirection === 'remove' ? 'Remove' : 'Add'
    } ${formatCount(amount)} Tickets ${
      globalCurrencyDirection === 'remove' ? 'from' : 'to'
    } up to 200 account wallets?`;
    if (!window.confirm(confirmMessage)) return;

    setEconomyBusy('bulk-currency');
    try {
      const data = await readJson<{
        result: { affectedUsers: number; totalDelta: number };
      }>('/api/admin/db/rewards', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'bulk-adjust-currency',
          currencyType: globalCurrencyType,
          amount: signedAmount,
          reason: globalCurrencyReason.trim(),
        }),
      });
      const refreshed = await loadEconomy();
      showBanner(
        refreshed ? 'success' : 'error',
        `${data.result.affectedUsers} accounts updated. Total Ticket delta: ${formatCount(data.result.totalDelta)}.${refreshed ? '' : ' The adjustment was applied, but refreshed data could not be loaded. Reload before another change.'}`,
      );
      setGlobalCurrencyReason('');
    } catch (error) {
      showBanner('error', (error as Error).message);
    } finally {
      setEconomyBusy(null);
    }
  }, [
    globalCurrencyAmount,
    globalCurrencyDirection,
    globalCurrencyReason,
    globalCurrencyType,
    loadEconomy,
    showBanner,
  ]);

  const loadTimeCards = useCallback(async () => {
    setTimeCardLoading(true);
    try {
      const data = await readJson<{ rows: TimeCardRow[] }>(
        '/api/admin/db/time-card',
      );
      setTimeCardRows(data.rows);
      setTimeCardLoaded(true);
    } catch (error) {
      showBanner('error', (error as Error).message);
    } finally {
      setTimeCardLoading(false);
    }
  }, [showBanner]);

  const loadLogs = useCallback(
    async (requestedDate?: string) => {
      setLogsLoading(true);
      try {
        const params = new URLSearchParams();
        if (requestedDate) params.set('date', requestedDate);
        const querySuffix = params.size ? `?${params.toString()}` : '';
        const antiCheatUrl = `/api/admin/db/anti-cheat-logs${querySuffix}`;
        const [antiCheat, feedback] = await Promise.all([
          readJson<AntiCheatLogResponse>(antiCheatUrl),
          readJson<FeedbackLogResponse>(`/api/admin/db/feedback-logs${querySuffix}`),
        ]);
        setAntiCheatLogs(antiCheat);
        setFeedbackLogs(feedback);
        setLogsLoaded(true);
        setAntiCheatVisibleCount(INITIAL_LOGS_VISIBLE_COUNT);
        setFeedbackVisibleCount(INITIAL_LOGS_VISIBLE_COUNT);
      } catch (error) {
        showBanner('error', (error as Error).message);
      } finally {
        setLogsLoading(false);
      }
    },
    [showBanner],
  );

  useEffect(() => {
    if (page === 'economy' && !economyLoaded) {
      void loadEconomy();
    }
  }, [economyLoaded, loadEconomy, page]);

  useEffect(() => {
    if (page === 'game-time' && !timeCardLoaded) {
      void loadTimeCards();
    }
  }, [loadTimeCards, page, timeCardLoaded]);

  useEffect(() => {
    if (page === 'logs' && !logsLoaded) {
      void loadLogs(antiCheatDate || undefined);
    }
  }, [antiCheatDate, loadLogs, logsLoaded, page]);

  const toggleCatalogItemSelection = useCallback((itemId: string) => {
    setSelectedCatalogItemIds((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  }, []);

  const toggleAllVisibleCatalogItems = useCallback((itemIds: string[]) => {
    setSelectedCatalogItemIds((prev) => {
      const next = new Set(prev);
      const allSelected = itemIds.every((itemId) => next.has(itemId));
      if (allSelected) {
        itemIds.forEach((itemId) => next.delete(itemId));
      } else {
        itemIds.forEach((itemId) => next.add(itemId));
      }
      return next;
    });
  }, []);

  const storeItemsInRotation = useMemo(
    () => new Set(storeRotationItemIds),
    [storeRotationItemIds],
  );
  const visibleLedgerRows = useMemo(
    () => ledgerRows.slice(0, Math.min(ledgerRows.length, ledgerVisibleCount)),
    [ledgerRows, ledgerVisibleCount],
  );

  useEffect(() => {
    setLedgerVisibleCount(20);
  }, [ledgerCurrencyFilter, ledgerLimit, ledgerRows, ledgerSourceFilter]);

  const filteredTimeCardRows = useMemo(() => {
    const query = deferredTimeCardSearch.trim().toLowerCase();
    const rows = query
      ? timeCardRows.filter((row) => {
          const haystack = `${row.username} ${row.userId}`.toLowerCase();
          return haystack.includes(query);
        })
      : timeCardRows;
    const sorted = [...rows];
    sorted.sort((a, b) => {
      if (timeCardSort === 'name') {
        return a.username.localeCompare(b.username, undefined, {
          sensitivity: 'base',
        });
      }
      if (timeCardSort === 'today') {
        return (
          getTimeCardMetricValue(b.today, timeCardGameFilter) -
          getTimeCardMetricValue(a.today, timeCardGameFilter)
        );
      }
      if (timeCardSort === 'mtd') {
        return (
          getTimeCardMetricValue(b.monthToDate, timeCardGameFilter) -
          getTimeCardMetricValue(a.monthToDate, timeCardGameFilter)
        );
      }
      if (timeCardSort === 'lastMonth') {
        return (
          getTimeCardMetricValue(b.lastMonth, timeCardGameFilter) -
          getTimeCardMetricValue(a.lastMonth, timeCardGameFilter)
        );
      }
      return (
        getTimeCardMetricValue(b.allTime, timeCardGameFilter) -
        getTimeCardMetricValue(a.allTime, timeCardGameFilter)
      );
    });
    return sorted;
  }, [deferredTimeCardSearch, timeCardGameFilter, timeCardRows, timeCardSort]);

  const antiCheatEntries = useMemo(() => {
    const entries = antiCheatLogs?.entries ?? [];
    return entries.filter((entry) => {
      if (antiCheatFilter !== 'all' && entry.result !== antiCheatFilter) {
        return false;
      }
      if (
        antiCheatGameFilter !== 'all' &&
        entry.gameType !== antiCheatGameFilter
      ) {
        return false;
      }
      return true;
    });
  }, [antiCheatFilter, antiCheatGameFilter, antiCheatLogs?.entries]);

  const filteredFeedbackLogs = useMemo(() => {
    const entries = feedbackLogs?.entries ?? [];
    if (feedbackFilter === 'all') return entries;
    return entries.filter((entry) => entry.type === feedbackFilter);
  }, [feedbackFilter, feedbackLogs?.entries]);

  const logAvailableDates = useMemo(() => {
    const merged = new Set<string>([
      ...(antiCheatLogs?.availableDates ?? []),
      ...(feedbackLogs?.availableDates ?? []),
    ]);
    if (antiCheatDate) {
      merged.add(antiCheatDate);
    }
    return Array.from(merged).sort((a, b) => b.localeCompare(a));
  }, [
    antiCheatDate,
    antiCheatLogs?.availableDates,
    feedbackLogs?.availableDates,
  ]);

  useEffect(() => {
    setFeedbackVisibleCount(INITIAL_LOGS_VISIBLE_COUNT);
  }, [feedbackFilter]);

  return (
    <div className='space-y-5'>
      {banner && page !== 'economy' ? (
        <Banner tone={banner.tone} onClose={() => setBanner(null)}>
          {banner.message}
        </Banner>
      ) : null}

      {page === 'economy' ? (
        <section className='space-y-5'>
          <ConsoleTabs
            label='Economy sections'
            active={economyTab ?? 'overview'}
            items={ECONOMY_TABS.map((tab) => ({
              ...tab,
              href: `/admin/db/economy?tab=${tab.id}`,
            }))}
          />
          {banner ? (
            <div
              role={banner.tone === 'error' ? 'alert' : 'status'}
              aria-live={banner.tone === 'error' ? 'assertive' : 'polite'}
            >
              <Banner tone={banner.tone} onClose={() => setBanner(null)}>
                {banner.message}
              </Banner>
            </div>
          ) : null}
          {economyLoaded && economyLoadError ? (
            <ConsolePanel
              title='Refresh needed'
              description='The last refresh failed. Displayed values may be out of date.'
            >
              <div className='p-4 sm:p-5'>
                <ArcadeButton
                  disabled={ledgerLoading || Boolean(economyBusy)}
                  onClick={() => void loadEconomy()}
                >
                  Reload economy data
                </ArcadeButton>
              </div>
            </ConsolePanel>
          ) : null}
          {!economyLoaded ? (
            <ConsolePanel
              title='Economy data'
              description={
                economyLoadError
                  ? 'Economy data could not be loaded. Controls stay unavailable until settings are loaded.'
                  : 'Loading wallets, store settings, and recent activity…'
              }
            >
              <div className='p-4 sm:p-5'>
                {economyLoadError ? (
                  <ArcadeButton
                    disabled={ledgerLoading}
                    onClick={() => void loadEconomy()}
                  >
                    Try again
                  </ArcadeButton>
                ) : (
                  <div className='grid gap-3 sm:grid-cols-3' aria-busy='true'>
                    <ConsoleMetric label='Wallets' value='—' loading />
                    <ConsoleMetric
                      label='Tickets in wallets'
                      value='—'
                      loading
                    />
                    <ConsoleMetric label='Store settings' value='—' loading />
                  </div>
                )}
              </div>
            </ConsolePanel>
          ) : (
            <div
              aria-busy={ledgerLoading || Boolean(economyBusy)}
              className='space-y-5'
            >
              {economyTab === 'overview' ? (
                <>
                  <ConsolePanel
                    title='Ticket economy'
                    description='All-time totals in Tickets. These figures describe wallet and game activity.'
                    actions={
                      <ArcadeButton
                        disabled={ledgerLoading || Boolean(economyBusy)}
                        onClick={() => void loadEconomy()}
                      >
                        <RefreshCw className='mr-2 h-4 w-4' />
                        Refresh data
                      </ArcadeButton>
                    }
                  >
                    <div className='p-4 sm:p-5'>
                      <div className='grid gap-3 sm:grid-cols-2 xl:grid-cols-4'>
                        <ConsoleMetric
                          label='Wallets'
                          value={formatCount(arcadeStats.walletCount)}
                        />
                        <ConsoleMetric
                          label='Tickets in wallets'
                          value={formatCount(arcadeStats.totalCreditsInWallets)}
                        />
                        <ConsoleMetric
                          label='Rounds played'
                          value={formatCount(arcadeStats.arcadeRoundsPlayed)}
                        />
                        <ConsoleMetric
                          label='Tickets wagered'
                          value={formatCount(arcadeStats.arcadeCreditsWagered)}
                        />
                        <ConsoleMetric
                          label='Tickets paid out'
                          value={formatCount(arcadeStats.arcadeCreditsPaidOut)}
                        />
                        <ConsoleMetric
                          label='House Ticket difference'
                          value={formatCount(arcadeStats.arcadeHouseProfit)}
                          detail='Wagered minus paid out'
                        />
                        <ConsoleMetric
                          label='Actual RTP'
                          value={`${arcadeStats.arcadeActualRtp.toFixed(2)}%`}
                          detail='Paid out ÷ wagered'
                        />
                        <ConsoleMetric
                          label='Store Tickets spent'
                          value={formatCount(arcadeStats.storeCreditsSpent)}
                        />
                      </div>
                    </div>
                  </ConsolePanel>
                  <ConsolePanel
                    title='Per-game activity'
                    description='All-time game totals. Target RTP: 97.00%.'
                  >
                    <div className='p-4 sm:p-5'>
                      <div className='min-w-0'>
                        {arcadeStats.perGame.length > 0 ? (
                          <div className='mt-3 overflow-x-auto'>
                            <table className='w-full min-w-160 text-left text-sm'>
                              <thead className='text-xs uppercase tracking-wide text-faint'>
                                <tr className='border-b border-soft'>
                                  <th className='py-2 pr-3 font-medium'>
                                    Game
                                  </th>
                                  <th className='py-2 pr-3 text-right font-medium'>
                                    Rounds
                                  </th>
                                  <th className='py-2 pr-3 text-right font-medium'>
                                    Wagered
                                  </th>
                                  <th className='py-2 pr-3 text-right font-medium'>
                                    Paid out
                                  </th>
                                  <th className='py-2 pr-3 text-right font-medium'>
                                    House Ticket difference
                                  </th>
                                  <th className='py-2 text-right font-medium'>
                                    Actual RTP
                                  </th>
                                </tr>
                              </thead>
                              <tbody>
                                {arcadeStats.perGame.map((row) => {
                                  const rtpOver = row.actualRtp > 99;
                                  const rtpUnder =
                                    row.rounds > 50 && row.actualRtp < 94;
                                  const rtpClass = rtpOver
                                    ? 'text-danger-text'
                                    : rtpUnder
                                      ? 'text-faint'
                                      : 'text-strong';
                                  return (
                                    <tr
                                      key={row.gameType}
                                      className='border-b border-soft last:border-b-0'
                                    >
                                      <td className='py-2 pr-3 font-medium capitalize'>
                                        {row.gameType.replace(/^arcade-/, '')}
                                      </td>
                                      <td className='py-2 pr-3 text-right tabular-nums'>
                                        {formatCount(row.rounds)}
                                      </td>
                                      <td className='py-2 pr-3 text-right tabular-nums'>
                                        {formatCount(row.wagered)}
                                      </td>
                                      <td className='py-2 pr-3 text-right tabular-nums'>
                                        {formatCount(row.paidOut)}
                                      </td>
                                      <td className='py-2 pr-3 text-right tabular-nums'>
                                        {formatCount(row.houseProfit)}
                                      </td>
                                      <td
                                        className={`py-2 text-right tabular-nums ${rtpClass}`}
                                      >
                                        {row.actualRtp.toFixed(2)}%
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        ) : (
                          <div className='mt-3 rounded-lg border border-dashed border-soft px-4 py-6 text-sm text-faint'>
                            No per-game tixy economy data is available yet.
                          </div>
                        )}
                      </div>
                    </div>
                  </ConsolePanel>
                </>
              ) : null}
              {economyTab === 'ledger' ? (
                <ConsolePanel
                  title='Rewards ledger'
                  description={`Latest ${ledgerRows.length} entries loaded. Filters and CSV export apply to this bounded result set.`}
                >
                  <div className='p-4 sm:p-5'>
                    <fieldset
                      disabled={ledgerLoading || Boolean(economyBusy)}
                      className='mt-5 grid gap-3 lg:grid-cols-2 2xl:grid-cols-[1fr_1fr_1fr_auto_auto]'
                    >
                      <label className='space-y-2 text-sm text-faint'>
                        Currency
                        <select
                          value={ledgerCurrencyFilter}
                          onChange={(event) =>
                            setLedgerCurrencyFilter(event.target.value)
                          }
                          className={selectClass}
                        >
                          <option value='all'>All</option>
                          <option value='credits'>Tickets</option>
                        </select>
                      </label>
                      <label className='space-y-2 text-sm text-faint'>
                        Source
                        <select
                          value={ledgerSourceFilter}
                          onChange={(event) =>
                            setLedgerSourceFilter(event.target.value)
                          }
                          className={selectClass}
                        >
                          <option value='all'>All</option>
                          <option value='game_reward'>Game reward</option>
                          <option value='shift_reward'>Shift reward</option>
                          <option value='monthly_reward'>Monthly reward</option>
                          <option value='weekly_board'>Weekly board prize</option>
                          <option value='purchase'>Purchase</option>
                          <option value='admin_adjust'>Admin adjust</option>
                          <option value='admin_grant'>Admin grant</option>
                          <option value='refund'>Refund</option>
                        </select>
                      </label>
                      <label className='space-y-2 text-sm text-faint'>
                        Limit
                        <input
                          type='number'
                          value={ledgerLimit}
                          min={1}
                          max={500}
                          onChange={(event) =>
                            setLedgerLimit(Number(event.target.value) || 50)
                          }
                          className={inputClass}
                        />
                      </label>
                      <div className='lg:flex lg:items-end'>
                        <ArcadeButton
                          type='button'
                          onClick={() => void loadEconomy()}
                          disabled={ledgerLoading || Boolean(economyBusy)}
                          tone='primary'
                          className='w-full lg:w-auto'
                        >
                          <RefreshCw className='mr-2 h-4 w-4' />
                          Refresh
                        </ArcadeButton>
                      </div>
                      <div className='lg:flex lg:items-end'>
                        <ArcadeAnchorButton
                          href={`/api/admin/db/rewards?${new URLSearchParams(
                            Object.fromEntries(
                              [
                                ['limit', String(ledgerLimit)],
                                ['format', 'csv'],
                                [
                                  'currencyType',
                                  ledgerCurrencyFilter !== 'all'
                                    ? ledgerCurrencyFilter
                                    : '',
                                ],
                                [
                                  'sourceType',
                                  ledgerSourceFilter !== 'all'
                                    ? ledgerSourceFilter
                                    : '',
                                ],
                              ].filter((entry) => entry[1]),
                            ),
                          ).toString()}`}
                          className='w-full lg:w-auto'
                        >
                          <Download className='mr-2 h-4 w-4' />
                          Export CSV
                        </ArcadeAnchorButton>
                      </div>
                    </fieldset>

                    <div className='mt-5'>
                      <SimpleTable
                        maxBodyHeightClass='max-h-[32rem]'
                        headers={[
                          'Date',
                          'User',
                          'Currency',
                          'Amount',
                          'Balance After',
                          'Source',
                          'Reason',
                        ]}
                        rows={visibleLedgerRows.map((entry) => [
                          formatDateTime(entry.createdAt),
                          entry.userName
                            ? `${entry.userName}\n${entry.userId}`
                            : entry.userId,
                          entry.currencyType,
                          `${entry.amount > 0 ? '+' : ''}${entry.amount}`,
                          String(entry.balanceAfter),
                          entry.sourceType,
                          entry.reason ?? '—',
                        ])}
                        emptyMessage={
                          ledgerLoading
                            ? 'Loading ledger entries...'
                            : 'No ledger entries matched the current filters.'
                        }
                      />
                    </div>

                    {ledgerRows.length > ledgerVisibleCount ? (
                      <div className='mt-4 flex flex-wrap items-center justify-between gap-3'>
                        <p className='text-xs text-faint'>
                          Showing {visibleLedgerRows.length} of{' '}
                          {ledgerRows.length} rows.
                        </p>
                        <div className='flex flex-wrap gap-2'>
                          <ArcadeButton
                            type='button'
                            onClick={() =>
                              setLedgerVisibleCount((count) =>
                                Math.min(ledgerRows.length, count + 20),
                              )
                            }
                          >
                            Show more
                          </ArcadeButton>
                          <ArcadeButton
                            type='button'
                            onClick={() =>
                              setLedgerVisibleCount(ledgerRows.length)
                            }
                          >
                            Show all
                          </ArcadeButton>
                        </div>
                      </div>
                    ) : null}
                  </div>
                </ConsolePanel>
              ) : null}
              {economyTab === 'store' ? (
                <>
                  <ConsolePanel
                    title='Store visibility and game rewards'
                    description='These switches control Ticket store access and game-run Ticket awards.'
                  >
                    <div className='p-4 sm:p-5'>
                      <div className='grid gap-3 md:grid-cols-2'>
                        <ToggleRow
                          label='Tickets store'
                          checked={storeVisibility.creditsEnabled}
                          busy={economyMutationDisabled}
                          onToggle={(value) =>
                            void updateStoreVisibility(
                              'creditsEnabled',
                              value,
                              'Tickets store',
                            )
                          }
                        />
                        <ToggleRow
                          label='Daily game Ticket rewards'
                          checked={storeVisibility.gameCreditsEnabled}
                          busy={economyMutationDisabled}
                          onToggle={(value) =>
                            void updateStoreVisibility(
                              'gameCreditsEnabled',
                              value,
                              'Daily game Ticket rewards',
                            )
                          }
                        />
                      </div>
                    </div>
                  </ConsolePanel>
                  <ConsolePanel
                    title='Store rotation'
                    description='Refresh the current rotation using the existing Ticket catalog.'
                  >
                    <div className='p-4 sm:p-5'>
                      <div className='grid gap-3 sm:grid-cols-3'>
                        <ConsoleMetric
                          label='Rotation date'
                          value={storeRotationDateKey}
                        />
                        <ConsoleMetric
                          label='Catalog items'
                          value={formatCount(storeCatalogRows.length)}
                        />
                        <ConsoleMetric
                          label='Items in Ticket rotation'
                          value={formatCount(storeRotationItemIds.length)}
                        />
                      </div>
                      <div className='mt-5 flex flex-wrap gap-3'>
                        <ArcadeButton
                          disabled={economyMutationDisabled}
                          onClick={() => void refreshStoreRotation('credits')}
                        >
                          {economyBusy === 'refresh-credits'
                            ? 'Refreshing…'
                            : 'Refresh Ticket rotation'}
                        </ArcadeButton>
                        <ArcadeButton
                          disabled={economyMutationDisabled}
                          onClick={() => void refreshStoreRotation('all')}
                        >
                          {economyBusy === 'refresh-all'
                            ? 'Refreshing…'
                            : 'Refresh all rotations'}
                        </ArcadeButton>
                      </div>
                      <p className='mt-3 text-xs text-faint'>
                        Tickets are currently the only rotation currency; both
                        actions refresh that catalog.
                      </p>
                      {catalogWarning ? (
                        <p
                          role='status'
                          className='mt-4 rounded-well border border-soft bg-well px-4 py-3 text-sm text-tickets-text'
                        >
                          {catalogWarning}
                        </p>
                      ) : null}
                    </div>
                  </ConsolePanel>
                </>
              ) : null}
              {economyTab === 'catalog' ? (
                <>
                  <AdminCatalogPanel
                    title='Catalog'
                    presentation='console'
                    busy={economyMutationDisabled}
                    loading={ledgerLoading && !economyLoaded}
                    items={storeCatalogRows}
                    groups={storeCatalogGroups}
                    inStoreItemIds={storeItemsInRotation}
                    selection={{
                      selectedIds: selectedCatalogItemIds,
                      onToggleItem: toggleCatalogItemSelection,
                      onToggleAllVisible: toggleAllVisibleCatalogItems,
                    }}
                    actions={
                      <div className='flex flex-wrap items-center gap-2'>
                        <span className='rounded-full border border-soft px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-faint'>
                          {selectedCatalogItemIds.size} selected
                        </span>
                        <ArcadeButton
                          type='button'
                          onClick={() =>
                            void applyCatalogActiveState(
                              Array.from(selectedCatalogItemIds),
                              true,
                            )
                          }
                          disabled={
                            selectedCatalogItemIds.size === 0 ||
                            economyMutationDisabled
                          }
                        >
                          Set active
                        </ArcadeButton>
                        <ArcadeButton
                          type='button'
                          onClick={() =>
                            void applyCatalogActiveState(
                              Array.from(selectedCatalogItemIds),
                              false,
                            )
                          }
                          disabled={
                            selectedCatalogItemIds.size === 0 ||
                            economyMutationDisabled
                          }
                        >
                          Set inactive
                        </ArcadeButton>
                        <ArcadeButton
                          type='button'
                          onClick={() => void deleteCatalogItems()}
                          disabled={
                            selectedCatalogItemIds.size === 0 ||
                            economyMutationDisabled
                          }
                          tone='danger'
                        >
                          Delete selected
                        </ArcadeButton>
                        <p className='basis-full text-xs text-faint'>
                          Set inactive retires items: off sale and out of
                          rotation, and owners keep them. Delete works only on
                          inactive items nobody owns or earns as a reward.
                        </p>
                      </div>
                    }
                    rowActions={(item) => (
                      <ArcadeButton
                        type='button'
                        disabled={economyMutationDisabled}
                        onClick={() =>
                          void applyCatalogActiveState(
                            [item.id],
                            item.active === false,
                          )
                        }
                      >
                        {item.active === false ? 'Activate' : 'Deactivate'}
                      </ArcadeButton>
                    )}
                  />

                  <ConsolePanel
                    title='Clear catalog'
                    description='Delete the entire store catalog. Refused while any item is on sale, owned by a player or earned as a reward. This action cannot be undone.'
                  >
                    <div className='p-4 sm:p-5'>
                      <ArcadeButton
                        tone='danger'
                        disabled={economyMutationDisabled}
                        onClick={() => void deleteCatalogItems(true)}
                      >
                        <Trash2 className='mr-2 h-4 w-4' />
                        {economyBusy === 'catalog-clear'
                          ? 'Clearing…'
                          : 'Clear entire catalog'}
                      </ArcadeButton>
                    </div>
                  </ConsolePanel>
                </>
              ) : null}
              {economyTab === 'adjustments' ? (
                <ConsolePanel
                  title='Global Ticket adjustment'
                  description='Adjust up to 200 account wallets selected by the current account list. A reason is required and recorded in the ledger.'
                >
                  <div className='p-4 sm:p-5'>
                    <form
                      onSubmit={(event) => {
                        event.preventDefault();
                        void applyGlobalCurrencyAdjustment();
                      }}
                      className='space-y-5'
                    >
                      <fieldset
                        disabled={economyMutationDisabled}
                        className='grid gap-4 md:grid-cols-2'
                      >
                        <label className='space-y-2 text-sm text-faint'>
                          Direction
                          <select
                            className={selectClass}
                            value={globalCurrencyDirection}
                            onChange={(event) =>
                              setGlobalCurrencyDirection(
                                event.target.value as 'add' | 'remove',
                              )
                            }
                          >
                            <option value='add'>Add Tickets</option>
                            <option value='remove'>Remove Tickets</option>
                          </select>
                        </label>
                        <label className='space-y-2 text-sm text-faint'>
                          Tickets per account
                          <input
                            className={inputClass}
                            type='number'
                            min={1}
                            step={1}
                            required
                            value={globalCurrencyAmount}
                            onChange={(event) =>
                              setGlobalCurrencyAmount(event.target.value)
                            }
                          />
                        </label>
                        <label className='space-y-2 text-sm text-faint md:col-span-2'>
                          Reason (required)
                          <textarea
                            className={inputClass}
                            required
                            rows={3}
                            value={globalCurrencyReason}
                            onChange={(event) =>
                              setGlobalCurrencyReason(event.target.value)
                            }
                            placeholder='Explain why these account balances need adjustment'
                          />
                        </label>
                      </fieldset>
                      <div className='arcade-card-inset p-4 text-sm text-faint'>
                        Review:{' '}
                        {globalCurrencyDirection === 'remove'
                          ? 'Remove'
                          : 'Add'}{' '}
                        {Number.isInteger(Number(globalCurrencyAmount)) &&
                        Number(globalCurrencyAmount) > 0
                          ? formatCount(Number(globalCurrencyAmount))
                          : '—'}{' '}
                        Tickets{' '}
                        {globalCurrencyDirection === 'remove' ? 'from' : 'to'}{' '}
                        each selected account wallet, up to 200 accounts. The
                        result reports the actual affected accounts and total
                        Ticket change.
                      </div>
                      <ArcadeButton
                        type='submit'
                        tone={
                          globalCurrencyDirection === 'remove'
                            ? 'danger'
                            : 'primary'
                        }
                        disabled={
                          economyMutationDisabled ||
                          !globalCurrencyReason.trim()
                        }
                      >
                        {economyBusy === 'bulk-currency'
                          ? 'Applying…'
                          : 'Review and confirm adjustment'}
                      </ArcadeButton>
                    </form>
                  </div>
                </ConsolePanel>
              ) : null}
            </div>
          )}
        </section>
      ) : null}

      {page === 'game-time' ? (
        <section className='space-y-5'>
          <SurfaceCard className='p-5'>
            <SectionHeader title='Game time table' />
            <div className='mt-5 grid gap-3 lg:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_200px_220px_auto]'>
              <input
                value={timeCardSearch}
                onChange={(event) => setTimeCardSearch(event.target.value)}
                className={inputClass}
                placeholder='Search by name or user ID'
              />
              <select
                value={timeCardGameFilter}
                onChange={(event) =>
                  setTimeCardGameFilter(
                    event.target.value as TimeCardGameFilter,
                  )
                }
                className={selectClass}
              >
                <option value='all'>All games</option>
                {GAME_TIME_DISPLAY_GAMES.map((game) => (
                  <option key={game.id} value={game.id}>
                    {game.label}
                  </option>
                ))}
              </select>
              <select
                value={timeCardSort}
                onChange={(event) =>
                  setTimeCardSort(event.target.value as TimeCardSortMode)
                }
                className={selectClass}
              >
                <option value='allTime'>
                  Sort by all-time{' '}
                  {timeCardGameFilter === 'all'
                    ? 'total'
                    : getTimeCardGameLabel(timeCardGameFilter).toLowerCase()}
                </option>
                <option value='today'>
                  Sort by today{' '}
                  {timeCardGameFilter === 'all'
                    ? 'total'
                    : getTimeCardGameLabel(timeCardGameFilter).toLowerCase()}
                </option>
                <option value='mtd'>
                  Sort by month-to-date{' '}
                  {timeCardGameFilter === 'all'
                    ? 'total'
                    : getTimeCardGameLabel(timeCardGameFilter).toLowerCase()}
                </option>
                <option value='lastMonth'>
                  Sort by last month{' '}
                  {timeCardGameFilter === 'all'
                    ? 'total'
                    : getTimeCardGameLabel(timeCardGameFilter).toLowerCase()}
                </option>
                <option value='name'>Sort alphabetically</option>
              </select>
              <ArcadeButton
                type='button'
                onClick={() => void loadTimeCards()}
                disabled={timeCardLoading}
                tone='primary'
                className='w-full lg:w-auto'
              >
                <RefreshCw className='mr-2 h-4 w-4' />
                Refresh
              </ArcadeButton>
            </div>

            <div className='mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4'>
              <MetricTile
                icon={Clock3}
                label='Users'
                value={formatCount(timeCardRows.length)}
              />
              <MetricTile
                icon={Clock3}
                label={
                  timeCardGameFilter === 'all'
                    ? 'Today'
                    : `Today · ${getTimeCardGameLabel(timeCardGameFilter)}`
                }
                value={formatDurationMs(
                  timeCardRows.reduce(
                    (sum, row) =>
                      sum +
                      getTimeCardMetricValue(row.today, timeCardGameFilter),
                    0,
                  ),
                )}
              />
              <MetricTile
                icon={Clock3}
                label={
                  timeCardGameFilter === 'all'
                    ? 'Month to date'
                    : `Month to date · ${getTimeCardGameLabel(timeCardGameFilter)}`
                }
                value={formatDurationMs(
                  timeCardRows.reduce(
                    (sum, row) =>
                      sum +
                      getTimeCardMetricValue(
                        row.monthToDate,
                        timeCardGameFilter,
                      ),
                    0,
                  ),
                )}
              />
              <MetricTile
                icon={Clock3}
                label={
                  timeCardGameFilter === 'all'
                    ? 'All time'
                    : `All time · ${getTimeCardGameLabel(timeCardGameFilter)}`
                }
                value={formatDurationMs(
                  timeCardRows.reduce(
                    (sum, row) =>
                      sum +
                      getTimeCardMetricValue(row.allTime, timeCardGameFilter),
                    0,
                  ),
                )}
              />
            </div>

            <div className='mt-5'>
              <GameTimeTable
                rows={filteredTimeCardRows}
                gameFilter={timeCardGameFilter}
                emptyMessage={
                  timeCardLoading
                    ? 'Loading time-card metrics...'
                    : 'No time-card rows matched the current search.'
                }
              />
            </div>
          </SurfaceCard>
        </section>
      ) : null}

      {page === 'logs' ? (
        <section className='space-y-5'>
          <SurfaceCard className='p-5'>
            <SectionHeader title='Game logs' />
            <div className='mt-5 grid gap-3 lg:grid-cols-2 2xl:grid-cols-[220px_200px_200px_auto_auto]'>
              <select
                value={antiCheatDate}
                onChange={(event) => setAntiCheatDate(event.target.value)}
                className={selectClass}
              >
                <option value=''>Latest available date</option>
                {logAvailableDates.map((dateKey) => (
                  <option key={dateKey} value={dateKey}>
                    {dateKey}
                  </option>
                ))}
              </select>
              <select
                value={antiCheatFilter}
                onChange={(event) => setAntiCheatFilter(event.target.value)}
                className={selectClass}
              >
                <option value='all'>All results</option>
                <option value='pass'>Pass</option>
                <option value='flag'>Flag</option>
                <option value='reject'>Reject</option>
              </select>
              <select
                value={antiCheatGameFilter}
                onChange={(event) => setAntiCheatGameFilter(event.target.value)}
                className={selectClass}
              >
                <option value='all'>All games</option>
                <option value='snake'>Snake</option>
                <option value='flappy-bird'>Flappy Bird</option>
                <option value='reaction-time'>Reaction Time</option>
                <option value='typing-test'>Typing Test</option>
                <option value='coin-flip'>Coin Flip</option>
                <option value='8-ball'>8-Ball</option>
                <option value='tetris'>Tetris</option>
                <option value='connections'>Connections</option>
                <option value='arcade'>tixy</option>
              </select>
              <ArcadeButton
                type='button'
                onClick={() => void loadLogs(antiCheatDate || undefined)}
                disabled={logsLoading}
                tone='primary'
                className='w-full lg:w-auto'
              >
                <RefreshCw className='mr-2 h-4 w-4' />
                Refresh
              </ArcadeButton>
              <ArcadeAnchorButton
                href={`/api/admin/db/anti-cheat-logs?format=txt${
                  antiCheatDate
                    ? `&date=${encodeURIComponent(antiCheatDate)}`
                    : ''
                }`}
                className='w-full lg:w-auto'
              >
                <Download className='mr-2 h-4 w-4' />
                Export TXT
              </ArcadeAnchorButton>
            </div>

            <div className='mt-5 space-y-3'>
              {antiCheatEntries.length === 0 ? (
                <EmptyState
                  title='No game log rows'
                  description='Change the filters or reload a different date.'
                />
              ) : (
                antiCheatEntries
                  .slice(0, antiCheatVisibleCount)
                  .map((entry) => (
                    <div
                      key={entry.id}
                      className='arcade-card-inset p-4'
                    >
                      <div className='flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between'>
                        <div className='space-y-1'>
                          <div className='flex flex-wrap items-center gap-2'>
                            <StatusDot
                              tone={
                                entry.result === 'pass'
                                  ? 'success'
                                  : entry.result === 'flag'
                                    ? 'warning'
                                    : 'danger'
                              }
                            >
                              {entry.result}
                            </StatusDot>
                            <InlinePill>{entry.gameType}</InlinePill>
                            {entry.stage ? (
                              <InlinePill>{entry.stage}</InlinePill>
                            ) : null}
                          </div>
                          <p className='text-sm font-semibold text-strong'>
                            {entry.userName || entry.userId || 'unknown user'} ·{' '}
                            {formatCount(entry.score)}
                          </p>
                          <p className='text-xs text-faint'>
                            {formatDateTime(entry.ts)}
                          </p>
                        </div>
                        {entry.reason ? (
                          <p className='max-w-lg whitespace-pre-wrap wrap-break-word text-sm text-faint'>
                            {formatAntiCheatReason(entry.reason)}
                          </p>
                        ) : null}
                      </div>
                    </div>
                  ))
              )}
            </div>

            {antiCheatEntries.length > antiCheatVisibleCount ? (
              <div className='mt-4 flex justify-center'>
                <ArcadeButton
                  type='button'
                  onClick={() =>
                    setAntiCheatVisibleCount(
                      (count) => count + LOGS_SHOW_MORE_STEP,
                    )
                  }
                >
                  Show more
                </ArcadeButton>
              </div>
            ) : null}
          </SurfaceCard>

          <div className='grid gap-5 xl:grid-cols-2 2xl:grid-cols-4'>
            <SurfaceCard className='p-5'>
              <SectionHeader title='Feedback logs' />
              <div className='mt-5 flex flex-wrap gap-3'>
                <select
                  value={feedbackFilter}
                  onChange={(event) => setFeedbackFilter(event.target.value)}
                  className={`${selectClass} w-full sm:w-auto`}
                >
                  <option value='all'>All actions</option>
                  <option value='report_created'>Report created</option>
                  <option value='report_resolved'>Report resolved</option>
                  <option value='report_dismissed'>Report dismissed</option>
                  <option value='thread_hidden'>Thread hidden</option>
                  <option value='thread_unhidden'>Thread unhidden</option>
                  <option value='thread_locked'>Thread locked</option>
                  <option value='thread_unlocked'>Thread unlocked</option>
                  <option value='thread_deleted'>Thread deleted</option>
                  <option value='comment_hidden'>Comment hidden</option>
                  <option value='comment_unhidden'>Comment unhidden</option>
                  <option value='comment_deleted'>Comment deleted</option>
                </select>
                <ArcadeAnchorButton
                  href={`/api/admin/db/feedback-logs?format=txt${
                    antiCheatDate
                      ? `&date=${encodeURIComponent(antiCheatDate)}`
                      : ''
                  }`}
                  className='w-full sm:w-auto'
                >
                  <Download className='mr-2 h-4 w-4' />
                  Export TXT
                </ArcadeAnchorButton>
              </div>
              <div className='mt-5 space-y-3'>
                {filteredFeedbackLogs.length === 0 ? (
                  <EmptyState
                    title='No feedback logs'
                    description='No entries matched the current filter.'
                  />
                ) : (
                  filteredFeedbackLogs
                    .slice(0, feedbackVisibleCount)
                    .map((entry) => (
                      <div
                        key={entry.id}
                        className='arcade-card-inset p-4'
                      >
                        <div className='flex flex-wrap items-center gap-2'>
                          <InlinePill>
                            {entry.type.replaceAll('_', ' ')}
                          </InlinePill>
                          <span className='text-xs text-faint'>
                            {formatDateTime(entry.ts)}
                          </span>
                        </div>
                        <p className='mt-2 text-sm font-semibold text-strong'>
                          {entry.action}
                        </p>
                        <p className='mt-1 text-xs text-faint'>
                          {entry.userName || entry.userId || 'system'}
                        </p>
                        {entry.details ? (
                          <p className='mt-1 text-sm text-faint'>
                            {entry.details}
                          </p>
                        ) : null}
                      </div>
                    ))
                )}
              </div>
              {filteredFeedbackLogs.length > feedbackVisibleCount ? (
                <div className='mt-4 flex justify-center'>
                  <ArcadeButton
                    type='button'
                    onClick={() =>
                      setFeedbackVisibleCount(
                        (count) => count + LOGS_SHOW_MORE_STEP,
                      )
                    }
                  >
                    Show more
                  </ArcadeButton>
                </div>
              ) : null}
            </SurfaceCard>
          </div>
        </section>
      ) : null}
    </div>
  );
}

function SurfaceCard({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}) {
  return <section className={`${panelClass} ${className}`}>{children}</section>;
}

function SectionHeader({ title }: { title: string }) {
  return <h2 className='text-lg font-semibold text-strong'>{title}</h2>;
}

function MetricTile({
  icon: Icon,
  label,
  value,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
}) {
  return (
    <div className='arcade-card-inset px-4 py-4'>
      <div className='flex items-start justify-between gap-3'>
        <div>
          <p className='text-[11px] font-semibold uppercase tracking-[0.16em] text-faint'>
            {label}
          </p>
          <p className='mt-2 text-lg font-semibold text-strong'>{value}</p>
        </div>
        <div className='rounded-lg bg-primary/10 p-2 text-primary-text'>
          <Icon className='h-4 w-4' />
        </div>
      </div>
    </div>
  );
}

function ToggleRow({
  label,
  checked,
  busy,
  onToggle,
}: {
  label: string;
  checked: boolean;
  busy: boolean;
  onToggle: (value: boolean) => void;
}) {
  return (
    <div className='arcade-card-inset px-4 py-4'>
      <div className='flex items-center justify-between gap-3'>
        <p className='text-sm font-semibold text-strong'>{label}</p>
        <ArcadeButton
          type='button'
          onClick={() => onToggle(!checked)}
          disabled={busy}
          tone={checked ? 'success' : 'default'}
          size='xs'
          className='min-w-23 uppercase tracking-[0.18em]'
        >
          {checked ? 'Enabled' : 'Disabled'}
        </ArcadeButton>
      </div>
    </div>
  );
}

function InlinePill({ children }: { children: ReactNode }) {
  return (
    <span className='inline-flex items-center rounded-full border border-soft bg-background px-2.5 py-1 text-[11px] font-medium text-faint'>
      {children}
    </span>
  );
}

function StatusDot({
  tone,
  children,
}: {
  tone: 'success' | 'warning' | 'danger';
  children: ReactNode;
}) {
  const toneClass =
    tone === 'success'
      ? 'border-ink bg-prize text-prize-on'
      : tone === 'warning'
        ? 'border-ink bg-tickets text-tickets-on'
        : 'border-danger/30 bg-danger/10 text-danger-text';
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] ${toneClass}`}
    >
      {children}
    </span>
  );
}

function EmptyState({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className='rounded-lg border border-dashed border-soft px-5 py-8 text-center'>
      <p className='text-sm font-semibold text-strong'>{title}</p>
      <p className='mt-2 text-sm text-faint'>{description}</p>
    </div>
  );
}

function Banner({
  tone,
  children,
  onClose,
}: {
  tone: BannerTone;
  children: ReactNode;
  onClose: () => void;
}) {
  const classes =
    tone === 'success'
      ? 'border-ink bg-prize text-prize-on'
      : 'border-danger/30 bg-danger/10 text-danger-text';
  return (
    <div
      className={`flex items-start justify-between gap-4 rounded-lg border px-4 py-3 text-sm ${classes}`}
    >
      <div>{children}</div>
      <ArcadeButton
        type='button'
        onClick={onClose}
        size='xs'
        className='shrink-0'
      >
        Close
      </ArcadeButton>
    </div>
  );
}

function GameTimeTable({
  rows,
  gameFilter,
  emptyMessage,
}: {
  rows: TimeCardRow[];
  gameFilter: TimeCardGameFilter;
  emptyMessage: string;
}) {
  return (
    <div className={tableWrapClass}>
      {rows.length === 0 ? (
        <div className='px-4 py-8 text-sm text-faint'>
          {emptyMessage}
        </div>
      ) : (
        <div className='overflow-x-auto overflow-y-auto'>
          <table className='min-w-max w-full text-sm'>
            <thead className='sticky top-0 bg-raised'>
              <tr>
                {['User', 'Today', 'Month to Date', 'Last Month', 'All Time'].map(
                  (header) => (
                    <th
                      key={header}
                      className='px-4 py-3 text-left text-xs font-semibold uppercase tracking-[0.18em] text-faint'
                    >
                      {header}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rowIndex) => (
                <tr
                  key={row.userId}
                  className={`border-t border-soft ${
                    rowIndex % 2 === 0 ? 'bg-background' : 'bg-raised'
                  }`}
                >
                  <td className='px-4 py-3 align-top text-strong'>
                    <div className='min-w-45'>
                      <p className='font-medium text-strong'>{row.username}</p>
                      <p className='mt-1 text-xs text-faint'>{row.userId}</p>
                    </div>
                  </td>
                  <td className='px-4 py-3 align-top'>
                    <GameTimeCell bucket={row.today} gameFilter={gameFilter} />
                  </td>
                  <td className='px-4 py-3 align-top'>
                    <GameTimeCell
                      bucket={row.monthToDate}
                      gameFilter={gameFilter}
                    />
                  </td>
                  <td className='px-4 py-3 align-top'>
                    <GameTimeCell
                      bucket={row.lastMonth}
                      gameFilter={gameFilter}
                    />
                  </td>
                  <td className='px-4 py-3 align-top'>
                    <GameTimeCell bucket={row.allTime} gameFilter={gameFilter} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function GameTimeCell({
  bucket,
  gameFilter,
}: {
  bucket: TimeCardRow['today'];
  gameFilter: TimeCardGameFilter;
}) {
  if (gameFilter !== 'all') {
    return (
      <div className='min-w-35'>
        <p className='font-medium text-strong'>
          {formatDurationMs(getTimeCardMetricValue(bucket, gameFilter))}
        </p>
        <p className='mt-1 text-xs text-faint'>
          Total {formatDurationMs(bucket.totalMs)}
        </p>
      </div>
    );
  }

  const rows = getNonZeroGameTimeRows(bucket);

  return (
    <div className='min-w-44'>
      <p className='font-medium text-strong'>
        {formatDurationMs(bucket.totalMs)}
      </p>
      {rows.length === 0 ? (
        <p className='mt-1 text-xs text-faint'>No tracked game time.</p>
      ) : (
        <div className='mt-2 grid gap-x-4 gap-y-1 text-xs text-faint md:grid-cols-2'>
          {rows.map((row) => (
            <span key={row.id}>
              {row.label} {formatDurationMs(row.durationMs)}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function SimpleTable({
  headers,
  rows,
  emptyMessage,
  maxBodyHeightClass,
}: {
  headers: string[];
  rows: string[][];
  emptyMessage: string;
  maxBodyHeightClass?: string;
}) {
  return (
    <div className={tableWrapClass}>
      {rows.length === 0 ? (
        <div className='px-4 py-8 text-sm text-faint'>
          {emptyMessage}
        </div>
      ) : (
        <div
          className={`${maxBodyHeightClass ?? ''} overflow-x-auto overflow-y-auto`}
        >
          <table className='min-w-max w-full text-sm'>
            <thead className='sticky top-0 bg-raised'>
              <tr>
                {headers.map((header) => (
                  <th
                    key={header}
                    className='px-4 py-3 text-left text-xs font-semibold uppercase tracking-[0.18em] text-faint'
                  >
                    {header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rowIndex) => (
                <tr
                  key={rowIndex}
                  className={`border-t border-soft ${
                    rowIndex % 2 === 0 ? 'bg-background' : 'bg-raised'
                  }`}
                >
                  {row.map((cell, cellIndex) => (
                    <td
                      key={`${rowIndex}-${cellIndex}`}
                      className='whitespace-pre-line wrap-break-word px-4 py-3 align-top text-strong'
                    >
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
