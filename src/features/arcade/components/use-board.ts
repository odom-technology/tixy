'use client';

import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

import type { BoardRowData, BoardViewer } from '@/features/arcade/components/leaderboard-board';
import { isWindowedBoardGame, ownRouteSeason } from '@/features/arcade/components/leaderboard-games';
import { getScoreDisplay } from '@/features/arcade/components/leaderboard-ui';
import { AccountIdentityContext } from '@/features/arcade/components/shell/use-account-summary';
import {
  useGameLeaderboard,
  type GameLeaderboardEntry,
} from '@/features/arcade/components/use-game-leaderboard';
import { formatMetricValue } from '@/features/arcade/lib/score-metric-format';
import { subscribeLive } from '@/lib/liveEvents';
import { usePlayerCards } from '@/features/users/use-player-cards';

/* One hook behind every board. Games with a rolling-window endpoint read
   today / week / all time (and last season where the game offers it); the
   rest read their own route. Both come out as the same rows, the viewer and
   the rows around them. */

export type BoardPeriod = 'today' | 'week' | 'all' | 'season';

const WINDOW_FOR: Record<Exclude<BoardPeriod, 'season'>, string> = {
  today: '1d',
  week: '7d',
  all: 'all',
};

/** Units a bare number needs on the board; the rest read as they are. */
const UNIT: Record<string, string> = { 'typing-test': 'wpm' };

type WindowRow = { odUserId: string; userName: string | null; score: number; rank: number };

type WindowResponse = {
  modes?: ReadonlyArray<{ key: string; label: string }> | null;
  direction: 'high' | 'low';
  leaderboard: WindowRow[];
  viewer: { odUserId: string; rank: number; score: number } | null;
  around?: WindowRow[];
};

export type BoardData = {
  loading: boolean;
  busy: boolean;
  rows: BoardRowData[];
  around: BoardRowData[];
  viewer: BoardViewer | null;
  signedIn: boolean | null;
  /** The mode key the window endpoint calls last season, when the game has one. */
  seasonMode: string | null;
};

const EMPTY: BoardData = {
  loading: true,
  busy: false,
  rows: [],
  around: [],
  viewer: null,
  signedIn: null,
  seasonMode: null,
};

/** Competition ranks: a tie shares the rank of the first of the tied rows. */
function withTieRanks(rows: WindowRow[]): WindowRow[] {
  const out: WindowRow[] = [];
  rows.forEach((row, index) => {
    const prev = out[index - 1];
    out.push({ ...row, rank: prev && prev.score === row.score ? prev.rank : index + 1 });
  });
  return out;
}

function unitFor(gameType: string, text: string) {
  const unit = UNIT[gameType];
  return unit ? `${text} ${unit}` : text;
}

function useWindowSource({
  enabled,
  gameType,
  mode,
  period,
  refreshKey,
}: {
  enabled: boolean;
  gameType: string;
  mode?: string | number;
  period: BoardPeriod;
  refreshKey?: number;
}) {
  const [data, setData] = useState<{
    key: string;
    response: WindowResponse;
  } | null>(null);
  const [seasonMode, setSeasonMode] = useState<string | null>(null);
  const [failedKey, setFailedKey] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const latestRef = useRef<(() => void) | null>(null);

  const modeKey = mode == null ? '' : String(mode);
  // Last season is the game's own mode on the all-time board.
  const sendMode = period === 'season' ? (seasonMode ?? '') : modeKey;
  const windowKey = period === 'season' ? 'all' : WINDOW_FOR[period];
  const key = `${gameType}|${windowKey}|${sendMode}`;

  const fetchBoard = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const params = new URLSearchParams({ game: gameType, window: windowKey, limit: '100' });
      if (sendMode) params.set('mode', sendMode);
      const response = await fetch(`/api/leaderboard/window?${params.toString()}`, {
        cache: 'no-store',
        signal: controller.signal,
      });
      if (!response.ok) {
        setFailedKey(key);
        return;
      }
      const body = (await response.json()) as WindowResponse;
      const season = body.modes?.find((m) => /season/i.test(m.label))?.key ?? null;
      setSeasonMode(season);
      setFailedKey(null);
      setData({ key, response: body });
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      console.error('Failed to fetch the board:', error);
      setFailedKey(key);
    }
  }, [gameType, key, sendMode, windowKey]);

  // Last season has no rows until a response names its mode, so a season
  // tab waits for that rather than asking for the default mode.
  const waiting = period === 'season' && !seasonMode;
  useEffect(() => {
    if (!enabled || waiting) return;
    latestRef.current = () => {
      if (!document.hidden) void fetchBoard();
    };
    void fetchBoard();
    const interval = window.setInterval(() => latestRef.current?.(), 30000);
    const onVisible = () => latestRef.current?.();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
      abortRef.current?.abort();
    };
  }, [enabled, fetchBoard, refreshKey, waiting]);

  useEffect(() => {
    if (!enabled) return;
    return subscribeLive(['gameLeaderboards'], () => latestRef.current?.());
  }, [enabled]);

  return { data, key, failed: failedKey === key, seasonMode };
}

export function useBoard({
  gameType,
  mode,
  period,
  refreshKey,
}: {
  gameType: string;
  mode?: string | number;
  period: BoardPeriod;
  refreshKey?: number;
}): BoardData {
  const signedIn = useContext(AccountIdentityContext);
  // Last season for a game whose own route serves it reads that route.
  const season = period === 'season' ? ownRouteSeason(gameType) : null;
  const windowed = isWindowedBoardGame(gameType, mode) && !season;

  const win = useWindowSource({ enabled: windowed, gameType, mode, period, refreshKey });
  const own = useGameLeaderboard({
    gameType,
    refreshKey,
    mode: season?.param === 'mode' ? season.value : mode,
    limit: 'all',
    season: season?.param === 'season' ? 'last' : undefined,
    enabled: !windowed,
  });

  const winRows = win.data?.response;
  const winIds = useMemo(
    () => [
      ...(winRows?.leaderboard ?? []).map((row) => row.odUserId),
      ...(winRows?.around ?? []).map((row) => row.odUserId),
    ],
    [winRows],
  );
  const cards = usePlayerCards(windowed ? winIds : []);

  return useMemo<BoardData>(() => {
    if (windowed) {
      if (!win.data || win.failed) {
        return { ...EMPTY, loading: !win.failed, signedIn, seasonMode: win.seasonMode };
      }
      const { response } = win.data;
      const toRow = (row: WindowRow): BoardRowData => {
        const card = cards[row.odUserId];
        return {
          key: `${row.odUserId}-${row.rank}`,
          userId: row.odUserId,
          // The board refreshes even when its set of player ids stays the same.
          // Cosmetic cards can be older, so use the board's current account name.
          name: row.userName || 'player',
          imageUrl: card?.avatarUrl ?? null,
          rank: row.rank,
          score: unitFor(gameType, formatMetricValue(gameType, row.score)),
        };
      };
      const rows = withTieRanks(response.leaderboard).map(toRow);
      const around = (response.around ?? []).map(toRow);
      const viewer: BoardViewer | null = response.viewer
        ? (() => {
            const above = (response.around ?? []).filter(
              (row) => row.rank < response.viewer!.rank,
            );
            const next = above[above.length - 1];
            return {
              id: response.viewer!.odUserId,
              rank: response.viewer!.rank,
              score: unitFor(gameType, formatMetricValue(gameType, response.viewer!.score)),
              gap: next
                ? formatMetricValue(gameType, Math.abs(next.score - response.viewer!.score))
                : null,
            };
          })()
        : null;
      return {
        loading: false,
        busy: win.data.key !== win.key && !win.failed,
        rows,
        around,
        viewer,
        signedIn,
        seasonMode: win.seasonMode,
      };
    }

    const toRow = (entry: GameLeaderboardEntry, rank: number): BoardRowData => {
      const shown = getScoreDisplay(entry, gameType, mode);
      const sub = [shown.scoreSub, shown.tier, shown.record]
        .filter((part) => part != null && part !== '')
        .map((part) => String(part).toLowerCase())
        .join(' · ');
      return {
        key: entry.id,
        userId: entry.userId,
        name: entry.userName || 'player',
        imageUrl: entry.imageUrl ?? null,
        rank,
        score:
          typeof shown.score === 'number' ? shown.score.toLocaleString() : String(shown.score ?? ''),
        sub: sub || undefined,
      };
    };
    const rows = own.leaderboard.map((entry, index) => toRow(entry, index + 1));
    const pinned = own.pinnedEntry;
    const pinnedRank = pinned?.rank ?? null;
    let viewer: BoardViewer | null = null;
    let around: BoardRowData[] = [];
    if (pinned && pinnedRank != null) {
      const index = rows.findIndex((row) => row.userId === pinned.userId);
      const mine = index >= 0 ? rows[index]! : toRow(pinned, pinnedRank);
      viewer = { id: pinned.userId, rank: pinnedRank, score: mine.score, gap: null };
      around =
        index >= 0
          ? rows.slice(Math.max(0, index - 2), index + 3)
          : [mine];
    }
    return {
      loading: own.isLoading,
      busy: false,
      rows,
      around,
      viewer,
      signedIn,
      seasonMode: null,
    };
  }, [cards, gameType, mode, own.isLoading, own.leaderboard, own.pinnedEntry, signedIn, win, windowed]);
}
