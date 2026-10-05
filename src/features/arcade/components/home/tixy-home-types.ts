/* Data the tixy home reads. Built on the server by
   src/server/arcade/tixy-home.ts. Only the live part (who is waiting, whose
   move it is, friends on now, tables open) refreshes through /api/home/live;
   ratings, bests and the rest render once. Every number comes from a real
   table; a section that can't load is null and the page leaves it out. */

import type { ArcadeFloorGroupId } from '@/features/arcade/components/arcade-game-registry';

/* The three friends games that take an invite on home. */
export type HomeMatchGame = '8-ball' | 'chess' | 'connect-four';

/* Someone waiting for you: a challenge (accept) or a friend's open table (join). */
export type HomeWaiting = {
  kind: 'invite' | 'table';
  game: HomeMatchGame;
  matchId: string;
  userId: string;
  name: string;
  /* A challenge from the player you last finished a match with in this game. */
  rematch: boolean;
  /* Tickets each player stakes. Joining holds them. */
  wager: number | null;
  /* 8-ball only: no aim guides. */
  hardcore: boolean;
  createdAt: number;
};

/* A match where it is your move. */
export type HomeTurn = {
  game: HomeMatchGame;
  matchId: string;
  opponent: string;
};

export type HomeFriend = {
  userId: string;
  name: string;
  imageUrl: string | null;
  status: 'online' | 'in_game' | 'away';
  gameSlug: string | null;
};

export type HomeOnNow = {
  waiting: HomeWaiting[];
  turns: HomeTurn[];
  /* Friends who are on, most active first, the first six. */
  friends: HomeFriend[];
  /* Counted before the six are cut. */
  onlineCount: number;
  friendCount: number;
};

/* Per friends game: public tables waiting for a second player whose owner is
   still here, and matches between two people updated in the last 5 minutes. */
export type HomeTables = Record<HomeMatchGame, { open: number; live: number }>;

/* Your last finished 8-ball matches. Only shown from 5 games on. */
export type HomeRecord = { won: number; played: number };

/* One real number per cabinet. */
export type HomeTileFact =
  | { kind: 'best'; value: number; label: string }
  | { kind: 'top'; value: number; label: string }
  | { kind: 'rating'; value: number }
  | { kind: 'tables'; value: number }
  | { kind: 'turn'; opponent: string; matchId: string }
  | { kind: 'featured'; multiplier: number }
  /* One of this week's paid boards: what first place wins. */
  | { kind: 'paid'; tickets: number }
  | { kind: 'daily'; dayNumber: number; guesses: number | null; solved: boolean | null };

/* The daily spin (DAILY_WHEEL.md). Streak days are 1-based; `streak` is the
   days in a row before today's spin. */
export type HomeDailySpin = { unit: number; value: number; multiplier: number; held: boolean };

export type HomeDaily =
  | {
      state: 'ready';
      /* Days in a row so far, before today's spin. */
      streak: number;
      /* Today's streak day and its multiplier. */
      day: number;
      multiplier: number;
      /* The top slot at today's multiplier. */
      top: number;
      /* What today is expected to pay (the old ladder), with any legacy hold. */
      tickets: number;
      hold: number;
      todayKey: string;
      /* Tomorrow's day and multiplier, if the streak holds. */
      next: { day: number; multiplier: number };
    }
  | {
      state: 'claimed';
      tickets: number;
      streak: number;
      todayKey: string;
      /* Null for a flat claim from before the wheel. */
      spin: HomeDailySpin | null;
      next: { day: number; multiplier: number };
    }
  | { state: 'closed'; streak: number }
  | { state: 'guest'; top: number };

export type HomePrize = {
  id: string;
  name: string;
  kind: string;
  price: number;
  gameType: string;
  slots: string[];
  assetRef: Record<string, unknown> | null;
  rarity: string;
};

/* The counter minus what you own, cheapest first (ties: the newest), and
   the prize you pinned on the counter, if any. */
export type HomeCounter = {
  unowned: HomePrize[];
  pinnedId?: string | null;
};

export type CounterView = {
  /* Four prizes around your balance: one you can afford, then the next ones. */
  prizes: HomePrize[];
  /* Your pinned prize while you can't afford it yet, else the cheapest prize
     above your balance. Null when you can afford them all. */
  next: HomePrize | null;
  affordable: number;
};

/* The server picks the next prize with this, and the page picks again when
   the balance changes (a claim). */
export function pickCounter(unowned: readonly HomePrize[], balance: number, pinnedId?: string | null): CounterView {
  const pinnedIndex = pinnedId ? unowned.findIndex((item) => item.id === pinnedId && item.price > balance) : -1;
  const nextIndex = pinnedIndex >= 0 ? pinnedIndex : unowned.findIndex((item) => item.price > balance);
  const anchor = nextIndex >= 0 ? nextIndex : unowned.length;
  const start = Math.max(0, Math.min(anchor - 1, unowned.length - 4));
  return {
    prizes: unowned.slice(start, start + 4),
    next: nextIndex >= 0 ? unowned[nextIndex]! : null,
    affordable: unowned.filter((item) => item.price <= balance).length,
  };
}

export type HomeLive = {
  onNow: HomeOnNow | null;
  tables: HomeTables | null;
};

export type TixyHomeData = HomeLive & {
  userId: string | null;
  /* Cabinet numbers for every game but the friends games, which the page
     works out from the live part and `ratings`. */
  facts: Record<string, HomeTileFact>;
  ratings: Partial<Record<HomeMatchGame, number>>;
  record: HomeRecord | null;
  daily: HomeDaily | null;
  counter: HomeCounter | null;
  /* When today's quests turn over: the server's next midnight, the same clock
     that dates them. */
  questsTurnAtMs?: number | null;
};

export const HOME_MATCH_GAMES: readonly HomeMatchGame[] = ['8-ball', 'chess', 'connect-four'];

/* A friends cabinet's number: your move, else your rating, else open tables.
   Nothing when there is none of those. */
export function friendsGameFact(
  game: HomeMatchGame,
  live: HomeLive,
  ratings: TixyHomeData['ratings'],
): HomeTileFact | undefined {
  const turn = live.onNow?.turns.find((entry) => entry.game === game);
  if (turn) return { kind: 'turn', opponent: turn.opponent, matchId: turn.matchId };
  const rating = ratings[game];
  if (rating != null) return { kind: 'rating', value: rating };
  const open = live.tables?.[game]?.open ?? 0;
  if (open > 0) return { kind: 'tables', value: open };
  return undefined;
}

export type HomeFloorFilter = 'all' | 'favorites' | ArcadeFloorGroupId;
