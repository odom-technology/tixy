import { NextResponse } from 'next/server';
import {
  withCurrentLeaderboardNames,
  type NamedLeaderboardEntry,
} from '@/server/arcade/leaderboard-identities';
import {
  LEADERBOARD_QUERY_LIMIT,
  MAX_LEADERBOARD_QUERY_LIMIT,
} from './constants';

export async function requireLeaderboardAccess() {
  return null;
}

function isNamedEntry(value: unknown): value is NamedLeaderboardEntry {
  if (!value || typeof value !== 'object') return false;
  const entry = value as NamedLeaderboardEntry;
  return (typeof entry.userId === 'string' || typeof entry.odUserId === 'string')
    && (typeof entry.userName === 'string' || entry.userName === null);
}

/** Shared response boundary for every game board, including pinned rows and
 * Elo player details. Stored result snapshots never control account names. */
export async function noStoreJson(data: unknown, status = 200) {
  try {
    let currentData = data;
    if (data && typeof data === 'object') {
      const payload = data as Record<string, unknown>;
      const board = Array.isArray(payload.leaderboard) ? payload.leaderboard : [];
      const singles = ['currentUserEntry', 'player'] as const;
      const entries = [...board, ...singles.map((key) => payload[key])].filter(isNamedEntry);
      if (entries.length > 0) {
        const currentEntries = await withCurrentLeaderboardNames(entries);
        const replacements = new Map(entries.map((entry, index) => [entry, currentEntries[index]]));
        const replace = (entry: unknown) => isNamedEntry(entry) ? replacements.get(entry) ?? entry : entry;
        currentData = {
          ...payload,
          ...(Array.isArray(payload.leaderboard) ? { leaderboard: board.map(replace) } : {}),
          ...Object.fromEntries(singles.filter((key) => key in payload).map((key) => [key, replace(payload[key])])),
        };
      }
    }
    return NextResponse.json(currentData, {
      status,
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    return leaderboardServerError(error);
  }
}

export function leaderboardServerError(error: unknown) {
  console.error('Failed to fetch leaderboard:', error);
  return NextResponse.json(
    { error: 'Failed to fetch leaderboard' },
    { status: 500 },
  );
}

export function resolveLeaderboardLimit(
  searchParams: URLSearchParams,
): number {
  const rawLimit = searchParams.get('limit')?.trim().toLowerCase();
  if (!rawLimit) return LEADERBOARD_QUERY_LIMIT;
  if (rawLimit === 'all') return MAX_LEADERBOARD_QUERY_LIMIT;
  const parsed = Number.parseInt(rawLimit, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return LEADERBOARD_QUERY_LIMIT;
  return Math.min(parsed, MAX_LEADERBOARD_QUERY_LIMIT);
}
