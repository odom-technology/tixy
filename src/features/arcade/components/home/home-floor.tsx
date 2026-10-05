'use client';

/* The floor: the five floor groups as a filter row with counts, then a grid
   of cabinets, each with its name and one real number; ticket machines show
   none. Pointing at a cabinet lifts it 4 px, flickers the screen on, and
   loads the game's hover preview (lazy: game-previews/index.tsx imports a
   module only on the first hover).
   At rest a floor game shows its still, a frame of the same screen drawn on
   the server (game-previews/stills.tsx); reserve games keep their poster.
   Phones get rows. "more games" opens the reserve. Favourites keep working
   through /api/account/favorite-games and show as their own filter. */

import Image from 'next/image';
import Link from 'next/link';
import { Star } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState, type ComponentType, type ReactNode } from 'react';

import {
  ARCADE_FLOOR_GROUPS,
  getArcadeGameBySlug,
  getFloorGroups,
  getReserveGames,
  RESERVE_ON_FLOOR,
  type ArcadeGameEntry,
} from '@/features/arcade/components/arcade-game-registry';
import { hasGamePreviewAnim, loadGamePreviewAnim } from '@/features/arcade/components/game-previews';
import { Num } from '@/features/arcade/components/ui/arcade-ui';
import { getGameDisplayName, getGameDisplayRoute, renamedPath } from '@/features/arcade/lib/game-renames';
import { feelReducedMotion } from '@/features/arcade/lib/game-feel';
import { MAX_FAVORITE_GAMES } from '@/features/users/account-profile-details';
import type { SiteAvailabilityConfig } from '@/lib/site-availability';

import { floorColumns } from './floor-columns';
import type { HomeFloorFilter, HomeTileFact } from './tixy-home-types';

const FLOOR_GROUPS = getFloorGroups();
const RESERVE = RESERVE_ON_FLOOR ? getReserveGames() : [];

/* Lowercase names, as players see them. 8-ball's registry title carries
   "pool"; the floor calls it 8-ball. */
export function floorName(game: ArcadeGameEntry) {
  if (game.slug === '8-ball') return '8-ball';
  return getGameDisplayName(game.slug, game.title).toLowerCase();
}

function Fact({ fact, closed }: { fact: HomeTileFact | undefined; closed: boolean }) {
  if (closed) return <span className='tx-fact'>closed for now</span>;
  if (!fact) return <span className='tx-fact'>&nbsp;</span>;
  switch (fact.kind) {
    case 'turn':
      return (
        <span className='tx-fact' data-you='true'>
          your move against {fact.opponent}
        </span>
      );
    case 'rating':
      return (
        <span className='tx-fact'>
          <Num className='tx-num' value={fact.value} /> your rating
        </span>
      );
    case 'tables':
      return (
        <span className='tx-fact'>
          <Num className='tx-num' value={fact.value} /> {fact.value === 1 ? 'table' : 'tables'} open
        </span>
      );
    case 'best':
    case 'top':
      return (
        <span className='tx-fact'>
          <Num className='tx-num' value={fact.value} /> {fact.label}
        </span>
      );
    case 'featured':
      return (
        <span className='tx-fact'>
          <Num className='tx-num' value={`${fact.multiplier}×`} /> tickets today
        </span>
      );
    case 'paid':
      return (
        <span className='tx-fact'>
          <Num className='tx-num' value={fact.tickets} /> for 1st this week
        </span>
      );
    case 'daily':
      if (fact.guesses != null && fact.solved) {
        return (
          <span className='tx-fact'>
            solved in <Num className='tx-num' value={fact.guesses} /> today
          </span>
        );
      }
      if (fact.solved === false) {
        return (
          <span className='tx-fact'>
            no. <Num className='tx-num' value={fact.dayNumber} /> played
          </span>
        );
      }
      return (
        <span className='tx-fact'>
          today no. <Num className='tx-num' value={fact.dayNumber} />
        </span>
      );
    default:
      return null;
  }
}

/* The cabinet's screen in an ink bezel: the game's still, or the poster for
   a reserve game. On a pointer or focus, the game's own screen is loaded the
   first time and plays its move once over the still. Reduced motion keeps the
   still and loads nothing. */
function Screen({
  slug,
  title,
  active,
  sizes,
  still,
}: {
  slug: string;
  title: string;
  active: boolean;
  sizes: string;
  still: ReactNode;
}) {
  const [Anim, setAnim] = useState<ComponentType | null>(null);
  const [posterMissing, setPosterMissing] = useState(false);
  useEffect(() => {
    if (!active || Anim || !hasGamePreviewAnim(slug) || feelReducedMotion()) return;
    let cancelled = false;
    void loadGamePreviewAnim(slug).then((Comp) => {
      if (!cancelled && Comp) setAnim(() => Comp);
    });
    return () => {
      cancelled = true;
    };
  }, [Anim, active, slug]);
  return (
    <span className='tx-screen'>
      {still ?? (posterMissing ? null : (
        <Image
          src={`/games/${slug}/poster.webp`}
          alt=''
          width={480}
          height={300}
          loading='lazy'
          quality={72}
          sizes={sizes}
          onError={() => setPosterMissing(true)}
        />
      ))}
      {active && Anim ? (
        <span className='arc-preview-anim' aria-hidden='true'>
          <Anim />
        </span>
      ) : null}
      <span className='tx-sr'>{title}</span>
    </span>
  );
}

type CabinetProps = {
  game: ArcadeGameEntry;
  fact: HomeTileFact | undefined;
  closed: boolean;
  layout: 'tile' | 'row';
  still: ReactNode;
  canFavorite: boolean;
  favorite: boolean;
  favoriteBusy: boolean;
  onToggleFavorite: (game: ArcadeGameEntry) => void;
};

function Cabinet({ game, fact, closed, layout, still, canFavorite, favorite, favoriteBusy, onToggleFavorite }: CabinetProps) {
  const [active, setActive] = useState(false);
  const name = floorName(game);
  const href = closed ? undefined : (fact?.kind === 'turn' ? renamedPath(`/${game.slug}/${fact.matchId}`) : getGameDisplayRoute(game.slug, game.href));
  const pointer = {
    onPointerEnter: (event: React.PointerEvent) => {
      if (event.pointerType === 'mouse') setActive(true);
    },
    onPointerLeave: () => setActive(false),
    onFocus: () => setActive(true),
    onBlur: () => setActive(false),
  };
  const body =
    layout === 'tile' ? (
      <>
        <Screen slug={game.slug} title='' active={active} sizes='(max-width: 768px) 45vw, 200px' still={still} />
        <span className='tx-tile-name'>{name}</span>
        <Fact fact={fact} closed={closed} />
      </>
    ) : (
      <>
        <Screen slug={game.slug} title='' active={false} sizes='84px' still={still} />
        <div>
          <strong>{name}</strong>
          <Fact fact={fact} closed={closed} />
        </div>
      </>
    );
  const className = layout === 'tile' ? 'tx-tile' : 'tx-row';
  return (
    <div className='tx-cab'>
      {href ? (
        <Link href={href} className={className} {...pointer}>
          {body}
        </Link>
      ) : (
        <div className={className} data-closed='true' aria-disabled='true'>
          {body}
        </div>
      )}
      {canFavorite ? (
        <button
          type='button'
          className='tx-fav'
          aria-pressed={favorite}
          aria-label={favorite ? `unpin ${name}` : `pin ${name}`}
          disabled={favoriteBusy}
          onClick={() => onToggleFavorite(game)}
        >
          <Star size={16} strokeWidth={2} strokeLinecap='square' fill={favorite ? 'currentColor' : 'none'} aria-hidden='true' />
        </button>
      ) : null}
    </div>
  );
}

/* Old ?section= links and saved default sections. Competitive has no floor
   games left, so it opens the whole floor. */
const LEGACY_SECTION_TO_GROUP: Record<string, HomeFloorFilter> = {
  multiplayer: 'with-friends',
  casual: 'quick-play',
  competitive: 'all',
  wager: 'ticket-machines',
  daily: 'daily',
};

function readFilter(value: string | null): HomeFloorFilter | null {
  if (!value) return null;
  if (value === 'all' || value === 'favorites') return value;
  if (ARCADE_FLOOR_GROUPS.some((group) => group.id === value)) return value as HomeFloorFilter;
  return LEGACY_SECTION_TO_GROUP[value] ?? null;
}

export function HomeFloor({
  facts,
  signedIn,
  initialSection,
  initialFavoriteGameSlugs,
  availability,
  stills,
}: {
  stills: Record<string, ReactNode>;
  facts: Record<string, HomeTileFact>;
  signedIn: boolean;
  initialSection: string;
  initialFavoriteGameSlugs: string[];
  availability: SiteAvailabilityConfig;
}) {
  const [filter, setFilter] = useState<HomeFloorFilter>(() => readFilter(initialSection) ?? 'all');
  const [favorites, setFavorites] = useState(initialFavoriteGameSlugs);
  const [favoriteBusy, setFavoriteBusy] = useState<string | null>(null);
  const [favoriteError, setFavoriteError] = useState<string | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);

  // ?group= (or an old ?section= link) picks the filter, after hydration.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const linked = readFilter(params.get('group') ?? params.get('section'));
    if (linked) setFilter(linked);
  }, []);

  const isClosed = useCallback(
    (game: ArcadeGameEntry) => !availability.sections.games || availability.disabledGames.includes(game.slug),
    [availability],
  );
  const hideClosed = availability.disabledGameDisplay === 'hidden';
  const visible = useCallback((game: ArcadeGameEntry) => !(hideClosed && isClosed(game)), [hideClosed, isClosed]);

  const groups = useMemo(
    () => FLOOR_GROUPS.map(({ group, games }) => ({ group, games: games.filter(visible) })),
    [visible],
  );
  const favoriteGames = useMemo(
    () =>
      favorites
        .map((slug) => getArcadeGameBySlug(slug))
        .filter((game): game is ArcadeGameEntry => game !== null && visible(game)),
    [favorites, visible],
  );
  const total = groups.reduce((sum, entry) => sum + entry.games.length, 0);
  const effective: HomeFloorFilter = filter === 'favorites' && favoriteGames.length === 0 ? 'all' : filter;
  const shown =
    effective === 'all'
      ? groups.flatMap((entry) => entry.games)
      : effective === 'favorites'
        ? favoriteGames
        : groups.find((entry) => entry.group.id === effective)?.games ?? [];
  const reserve = useMemo(() => RESERVE.filter(visible), [visible]);

  const choose = useCallback((next: HomeFloorFilter) => {
    setFilter(next);
    const url = new URL(window.location.href);
    url.searchParams.delete('section');
    if (next === 'all') url.searchParams.delete('group');
    else url.searchParams.set('group', next);
    window.history.replaceState(window.history.state, '', url);
  }, []);

  const toggleFavorite = useCallback(
    async (game: ArcadeGameEntry) => {
      if (!signedIn || favoriteBusy) return;
      const on = favorites.includes(game.slug);
      if (!on && favorites.length >= MAX_FAVORITE_GAMES) {
        setFavoriteError(`You can pin ${MAX_FAVORITE_GAMES}. Unpin one to pin ${floorName(game)}.`);
        return;
      }
      const previous = favorites;
      const next = on ? previous.filter((slug) => slug !== game.slug) : [...previous, game.slug];
      setFavoriteBusy(game.slug);
      setFavoriteError(null);
      setFavorites(next);
      try {
        const res = await fetch('/api/account/favorite-games', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ gameSlugs: next }),
        });
        const payload = (await res.json().catch(() => ({}))) as { error?: string; favoriteGameSlugs?: string[] };
        if (!res.ok) throw new Error(payload.error || 'Your pins did not save.');
        if (payload.favoriteGameSlugs) setFavorites(payload.favoriteGameSlugs);
      } catch (caught) {
        setFavorites(previous);
        setFavoriteError((caught as Error).message);
      } finally {
        setFavoriteBusy(null);
      }
    },
    [favoriteBusy, favorites, signedIn],
  );

  const cabinet = (game: ArcadeGameEntry, layout: 'tile' | 'row') => (
    <Cabinet
      key={game.slug}
      game={game}
      fact={facts[game.slug]}
      closed={isClosed(game)}
      layout={layout}
      still={stills[game.slug] ?? null}
      canFavorite={signedIn}
      favorite={favorites.includes(game.slug)}
      favoriteBusy={favoriteBusy === game.slug}
      onToggleFavorite={(entry) => void toggleFavorite(entry)}
    />
  );

  const filters: { id: HomeFloorFilter; label: string; count: number }[] = [
    { id: 'all', label: 'all', count: total },
    ...(favoriteGames.length > 0 ? [{ id: 'favorites' as const, label: 'pinned', count: favoriteGames.length }] : []),
    ...groups
      .filter((entry) => entry.games.length > 0)
      .map((entry) => ({ id: entry.group.id, label: entry.group.label, count: entry.games.length })),
  ];

  return (
    <section className='tx-floor' id='arcade-floor' aria-labelledby='tx-floor-name'>
      <div className='tx-floor-head'>
        <h2 id='tx-floor-name'>games</h2>
        <div className='tx-filters' role='group' aria-label='floor groups'>
          {filters.map((entry) => (
            <button
              key={entry.id}
              type='button'
              aria-pressed={effective === entry.id}
              onClick={() => choose(entry.id)}
            >
              {entry.label}
              <b>{entry.count}</b>
            </button>
          ))}
        </div>
      </div>
      {!availability.sections.games ? <p className='tx-empty'>{availability.message}</p> : null}
      {favoriteError ? (
        <p role='alert' className='tx-empty' style={{ color: 'var(--tixy-red-text)' }}>
          {favoriteError}
        </p>
      ) : null}
      <div
        className='tx-grid'
        data-rows-on-phone='true'
        style={
          {
            '--c4': floorColumns(shown.length, 4),
            '--c5': floorColumns(shown.length, 5),
          } as React.CSSProperties
        }
      >
        {shown.map((game) => cabinet(game, 'tile'))}
      </div>
      <div className='tx-rows'>{shown.map((game) => cabinet(game, 'row'))}</div>
      {reserve.length > 0 ? (
        <div className='tx-more'>
          <button
            type='button'
            className='tx-btn tx-more-toggle'
            data-tone='quiet'
            data-size='sm'
            aria-expanded={moreOpen}
            aria-controls='tx-reserve'
            onClick={() => setMoreOpen((open) => !open)}
          >
            more games <b>{reserve.length}</b>
          </button>
          {moreOpen ? (
            <div id='tx-reserve' className='tx-reserve'>
              {reserve.map((game) => cabinet(game, 'row'))}
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
