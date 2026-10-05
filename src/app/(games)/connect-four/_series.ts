'use client';

// ---------------------------------------------------------------------------
// Best of three, kept entirely in the browser.
//
// A series is a run of ordinary Connect Four matches between the same two
// players. Nothing about it is stored: the ids of the games already played ride
// along in the page's query (`?series=<id>,<id>`), each page reads those
// matches through the normal match route, and the running score is counted
// from who won them. The first to two wins takes the series, and three games
// end it whatever the score, so a draw costs nobody a game. A match opened
// without the query is a plain match.
//
// Both players land on the next game with the same query: the player who
// presses rematch creates the match and carries the ids over, and the other
// player accepts it from their result, which carries the same ids. A player
// who reaches a game some other way (the open list, a link) has no query and
// sees no series: the score is shown only to a player who came through
// rematch. It is only a score; each game is rated on its own.
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useState } from 'react';
import type { ConnectFourMatch } from '@/features/arcade/lib/connect-four/types';

/** Games in a series, and wins that settle it early. */
export const SERIES_GAMES = 3;
export const SERIES_WINS = 2;

const MATCH_ID = /^[0-9a-f-]{8,64}$/i;

/** The ids in `?series=`, keeping only plausible ones and at most two. */
export function parseSeriesParam(value: string | null): string[] {
  if (!value) return [];
  const ids = value
    .split(',')
    .map((id) => id.trim())
    .filter((id) => MATCH_ID.test(id));
  return [...new Set(ids)].slice(0, SERIES_GAMES - 1);
}

/** Where the next game goes. `playedIds` is the series so far (empty for a
 *  plain match); `fromId` is the game it is a rematch of, which lets a waiting
 *  page find the opponent's offer if both players pressed rematch at once. */
export function seriesHref(matchId: string, playedIds: readonly string[], fromId?: string): string {
  const query: string[] = [];
  if (playedIds.length > 0) query.push(`series=${playedIds.join(',')}`);
  if (fromId) query.push(`from=${fromId}`);
  return query.length > 0 ? `/connect-four/${matchId}?${query.join('&')}` : `/connect-four/${matchId}`;
}

export function parseFromParam(value: string | null): string | null {
  return value && MATCH_ID.test(value.trim()) ? value.trim() : null;
}

/** A finished game in the series, as far as the score needs. */
export type SeriesGame = {
  id: string;
  winnerId: string | null;
  playerIds: readonly [string, string | null];
};

export function gameFromMatch(match: ConnectFourMatch): SeriesGame {
  return {
    id: match.id,
    winnerId: match.winnerId,
    playerIds: [match.player1Id, match.player2Id],
  };
}

export type SeriesScore = {
  /** Wins by the viewer, by the opponent, and games drawn. */
  me: number;
  them: number;
  draws: number;
  played: number;
  /** Someone has two wins, or three games are done. */
  over: boolean;
  /** The viewer won it, lost it, or it was level. Null while it is on. */
  result: 'won' | 'lost' | 'level' | null;
};

export function scoreSeries(
  games: readonly SeriesGame[],
  myId: string,
  opponentId: string,
): SeriesScore {
  let me = 0;
  let them = 0;
  let draws = 0;
  for (const game of games) {
    if (game.winnerId === myId) me++;
    else if (game.winnerId === opponentId) them++;
    else draws++;
  }
  const played = games.length;
  const over = me >= SERIES_WINS || them >= SERIES_WINS || played >= SERIES_GAMES;
  const result = !over ? null : me > them ? 'won' : them > me ? 'lost' : 'level';
  return { me, them, draws, played, over, result };
}

// Finished matches never change, so each is fetched once.
const finished = new Map<string, SeriesGame>();

/**
 * The earlier games of a series, read through the match route. A game that
 * can't be read, isn't finished, or was played by someone else is dropped, so
 * a doctored link shows no series rather than a wrong one.
 */
export function useSeriesGames(
  priorIds: readonly string[],
  playerIds: readonly [string, string | null] | null,
): SeriesGame[] {
  const key = priorIds.join(',');
  const [games, setGames] = useState<SeriesGame[]>(() =>
    priorIds.map((id) => finished.get(id)).filter((g): g is SeriesGame => Boolean(g)),
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const loaded: SeriesGame[] = [];
      for (const id of priorIds) {
        let game = finished.get(id);
        if (!game) {
          try {
            const res = await fetch(`/api/games/connect-four/match/${id}`, { cache: 'no-store' });
            if (!res.ok) continue;
            const payload = (await res.json()) as { match?: ConnectFourMatch };
            const m = payload.match;
            if (!m || (m.status !== 'completed' && m.status !== 'forfeited')) continue;
            game = gameFromMatch(m);
            finished.set(id, game);
          } catch {
            continue;
          }
        }
        loaded.push(game);
      }
      if (!cancelled) setGames(loaded);
    })();
    return () => {
      cancelled = true;
    };
    // `key` stands for priorIds.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return useMemo(() => {
    if (!playerIds) return [];
    const [a, b] = playerIds;
    if (!b) return [];
    const pair = new Set([a, b]);
    // The same two players, and no game counted twice.
    return games.filter(
      (g) =>
        g.playerIds[1] !== null &&
        pair.has(g.playerIds[0]) &&
        pair.has(g.playerIds[1]) &&
        g.playerIds[0] !== g.playerIds[1],
    );
  }, [games, playerIds]);
}
