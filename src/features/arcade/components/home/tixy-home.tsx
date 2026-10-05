'use client';

/* The tixy home (PLAN.md, "Layout"). 8-ball first, drawn as the game with
   live state on it, and today's quests under it; friends, daily tickets and
   the season card beside them; the floor; the prize counter at the end. No
   visible headline, no hero banner, no eyebrow.

   Only the live part (who is waiting, whose move it is, friends on now,
   tables open) refreshes, from /api/home/live: every 30 s while the tab is
   visible, when it comes back into view, and on a notification or a friend's
   presence change, at most once every 5 s. A challenge that arrives while the
   page is open slides in. */

import { useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { subscribeLive } from '@/lib/liveEvents';
import { SeasonProvider } from '@/features/arcade/components/season/use-season';
import { AccountIdentityContext } from '@/features/arcade/components/shell/use-account-summary';
import { SoundManager } from '@/features/arcade/lib/sound-manager';
import type { SiteAvailabilityConfig } from '@/lib/site-availability';

import { HomeCounterPanel } from './home-counter';
import { HomeFloor } from './home-floor';
import { HomeOnNowPanel } from './home-on-now';
import { HomeQuests } from './home-quests';
import { HomeSeason } from './home-season';
import { HomeTable } from './home-table';
import { HomeTickets } from './home-tickets';
import {
  HOME_MATCH_GAMES,
  friendsGameFact,
  type HomeLive,
  type HomeTileFact,
  type TixyHomeData,
} from './tixy-home-types';
import './tixy-home.css';

const REFRESH_MS = 30_000;
/* Events never refresh more often than this, plus up to a second of jitter so
   a burst of events across many tabs doesn't land at once. */
const EVENT_MIN_GAP_MS = 5_000;
const EVENT_JITTER_MS = 1_000;

function useHomeLive(initial: HomeLive, userId: string | null) {
  const [live, setLive] = useState<HomeLive>(initial);
  const [arrived, setArrived] = useState<ReadonlySet<string>>(() => new Set());
  const known = useRef(new Set(initial.onNow?.waiting.map((entry) => entry.matchId) ?? []));
  const inFlight = useRef(false);
  const lastAt = useRef(Date.now());
  const timer = useRef<number | null>(null);

  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    lastAt.current = Date.now();
    try {
      const res = await fetch('/api/home/live', { cache: 'no-store' });
      if (!res.ok) return;
      const next = (await res.json()) as HomeLive;
      const fresh = (next.onNow?.waiting ?? [])
        .filter((entry) => !known.current.has(entry.matchId))
        .map((entry) => entry.matchId);
      for (const id of fresh) known.current.add(id);
      if (fresh.length > 0) {
        setArrived((previous) => new Set([...previous, ...fresh]));
        if (!document.hidden) SoundManager.play('coinCorrect', { volume: 0.45 });
      }
      setLive(next);
    } catch {
      // keep what is on screen
    } finally {
      inFlight.current = false;
    }
  }, []);

  const soon = useCallback(() => {
    if (timer.current != null) return;
    const wait = Math.max(0, lastAt.current + EVENT_MIN_GAP_MS - Date.now()) + Math.random() * EVENT_JITTER_MS;
    timer.current = window.setTimeout(() => {
      timer.current = null;
      void refresh();
    }, wait);
  }, [refresh]);

  useEffect(() => {
    // Only this player's inbox: a challenge arrives as a notification, a
    // friend coming or going as presence. Lobby-wide topics are left to the
    // 30 s poll.
    const unsubscribe = userId
      ? subscribeLive([`user:${userId}`], (payload) => {
          const type = (payload as { type?: string } | null)?.type;
          if (type === 'notification' || type === 'presence') soon();
        })
      : () => {};
    const interval = window.setInterval(() => {
      if (!document.hidden) void refresh();
    }, REFRESH_MS);
    const onVisible = () => {
      if (!document.hidden && Date.now() - lastAt.current > EVENT_MIN_GAP_MS) void refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      unsubscribe();
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
      if (timer.current != null) window.clearTimeout(timer.current);
    };
  }, [refresh, soon, userId]);

  return { live, arrived, refresh };
}

const EMPTY: TixyHomeData = {
  userId: null,
  onNow: null,
  tables: null,
  facts: {},
  ratings: {},
  record: null,
  daily: null,
  counter: null,
};

export function TixyHome({
  data,
  signedIn,
  userId,
  initialSection,
  initialFavoriteGameSlugs,
  availability,
  stills,
}: {
  data: TixyHomeData | null;
  signedIn: boolean;
  userId: string | null;
  initialSection: string;
  initialFavoriteGameSlugs: string[];
  availability: SiteAvailabilityConfig;
  /** The floor games' resting frames, drawn on the server. */
  stills: Record<string, ReactNode>;
}) {
  const home = data ?? EMPTY;
  const { live, arrived, refresh } = useHomeLive(home, userId);
  const closed = !availability.sections.games || availability.disabledGames.includes('8-ball');
  const facts = useMemo(() => {
    const merged: Record<string, HomeTileFact> = { ...home.facts };
    for (const game of HOME_MATCH_GAMES) {
      const fact = friendsGameFact(game, live, home.ratings);
      if (fact) merged[game] = fact;
    }
    return merged;
  }, [home.facts, home.ratings, live]);
  const onStale = useCallback(() => void refresh(), [refresh]);
  const hasIdentity = useContext(AccountIdentityContext);
  const seasonOn = signedIn && hasIdentity !== false;

  return (
    <SeasonProvider enabled={seasonOn}>
    <div className='tx-home'>
      <h1 className='tx-sr'>tixy.lol</h1>
      {/* Two columns on a wide screen, each its own stack, so neither one's
          height sets the other's rows. On a phone the lead dissolves and the
          quests come after the rail. */}
      <div className='tx-lead'>
        <HomeTable
          tables={live.tables}
          record={home.record}
          onNow={live.onNow}
          signedIn={signedIn}
          closed={closed}
          onStale={onStale}
        />
        {seasonOn ? <HomeQuests stills={stills} turnAtMs={home.questsTurnAtMs ?? null} /> : null}
      </div>
      <div className='tx-rail'>
        <HomeOnNowPanel onNow={live.onNow} signedIn={signedIn} arrivedIds={arrived} onStale={onStale} />
        <HomeTickets daily={home.daily} signedIn={signedIn} nextAtMs={home.questsTurnAtMs ?? null} />
        {seasonOn ? <HomeSeason stills={stills} /> : null}
      </div>
      <HomeFloor
        facts={facts}
        signedIn={signedIn}
        initialSection={initialSection}
        initialFavoriteGameSlugs={initialFavoriteGameSlugs}
        availability={availability}
        stills={stills}
      />
      <HomeCounterPanel counter={home.counter} signedIn={signedIn} />
    </div>
    </SeasonProvider>
  );
}
