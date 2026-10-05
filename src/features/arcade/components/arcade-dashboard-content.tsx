'use client';

import { getGameDisplayRoute } from '@/features/arcade/lib/game-renames';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  ArrowRight,
  Search,
  Star,
  X,
} from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';

import {
  ARCADE_DASHBOARD_SECTIONS,
  ARCADE_GAMES,
  ARCADE_SECTION_ENAMEL,
  ARCADE_SECTION_META,
  ARCADE_WAGER_SUBSECTION_META,
  getFloorGames,
  getReserveGames,
  RESERVE_ON_FLOOR,
  isGameListed,
  type ArcadeDashboardSectionId,
} from '@/features/arcade/components/arcade-game-registry';
import { GamesDashboardCard } from '@/features/arcade/components/games-dashboard-card';
import { MultiplayerLiveSpotlight } from '@/features/arcade/components/multiplayer-live-spotlight';
import { TodayLobby } from '@/features/arcade/components/today-lobby';
import { useHorizontalOverflow } from '@/features/arcade/components/use-horizontal-overflow';
import { GamesWalletCard } from '@/features/arcade/components/shell/page-header';
import { useGamesWallet } from '@/features/arcade/components/shell/games-wallet-provider';
import {
  ArcadeButton,
  ArcadeChip,
  ArcadeInput,
  ArcadeLinkButton,
  ArcadeNotice,
  ArcadeSegmented,
  type ArcadeEnamel,
  type ArcadeSegmentItem,
} from '@/features/arcade/components/ui/arcade-ui';
import { ArcReveal } from '@/features/arcade/components/use-arc-reveal';
import { MAX_FAVORITE_GAMES } from '@/features/users/account-profile-details';
import { DEFAULT_SITE_AVAILABILITY, type SiteAvailabilityConfig } from '@/lib/site-availability';

const isDashboardSection = (value: string | null): value is ArcadeDashboardSectionId =>
  value === 'all'
  || value === 'multiplayer'
  || value === 'casual'
  || value === 'competitive'
  || value === 'daily'
  || value === 'wager';

function getSectionHref(sectionId: ArcadeDashboardSectionId) {
  return sectionId === 'all' ? '/' : `/?section=${sectionId}`;
}

type DashboardGame = (typeof ARCADE_GAMES)[number];
const REGISTRY_RANK = new Map(ARCADE_GAMES.map((game, index) => [game.slug, index]));
// Rev. 2: the floor shows the floor games. The reserve sits behind "more
// games". Retired, merged and later games are in no list, but their routes,
// scores and purchases are untouched.
const FLOOR_GAMES = getFloorGames();
const RESERVE_GAMES = RESERVE_ON_FLOOR ? getReserveGames() : [];
// Sections that have at least one floor game. An aisle with none is not shown
// as a tab or an aisle; its reserve games stay under "more games".
const FLOOR_SECTION_IDS = new Set(FLOOR_GAMES.map((game) => game.sectionId));

function matchesSearch(game: DashboardGame, sectionLabel: string, term: string) {
  if (!term) return true;
  return [
    game.title,
    game.description,
    game.slug,
    game.routeLabel,
    game.mobileRouteLabel,
    sectionLabel,
  ]
    .join(' ')
    .toLowerCase()
    .includes(term);
}

function getSectionTone(sectionId: ArcadeDashboardSectionId): ArcadeEnamel {
  return sectionId === 'all' ? 'primary' : ARCADE_SECTION_ENAMEL[sectionId];
}

function getGameMetaLabel(game: DashboardGame) {
  return game.wagerSubsectionId
    ? ARCADE_WAGER_SUBSECTION_META[game.wagerSubsectionId].label
    : ARCADE_SECTION_META[game.sectionId].label;
}

type ArcadeDashboardContentProps = {
  initialSection?: ArcadeDashboardSectionId;
  initialFavoriteGameSlugs?: string[];
  canFavorite?: boolean;
  popularGameSlugs?: string[];
  availability?: SiteAvailabilityConfig;
};

export function ArcadeDashboardContent({
  initialSection = 'all',
  initialFavoriteGameSlugs = [],
  canFavorite = false,
  popularGameSlugs = [],
  availability = DEFAULT_SITE_AVAILABILITY,
}: ArcadeDashboardContentProps) {
  const { wallet } = useGamesWallet();
  const router = useRouter();
  const searchParams = useSearchParams();
  // Aisle tab strip scroller — edge-fade only while it actually clips.
  const { ref: tabStripRef, overflowing: tabStripOverflowing } =
    useHorizontalOverflow<HTMLDivElement>();
  const [gameSearch, setGameSearch] = useState('');
  const [favoriteGameSlugs, setFavoriteGameSlugs] = useState(
    initialFavoriteGameSlugs,
  );
  const [favoriteBusySlug, setFavoriteBusySlug] = useState<string | null>(null);
  const [favoriteError, setFavoriteError] = useState<string | null>(null);
  const [moreGamesOpen, setMoreGamesOpen] = useState(false);
  const sectionParam = searchParams.get('section');
  const requestedSection: ArcadeDashboardSectionId = isDashboardSection(sectionParam)
    ? sectionParam
    : initialSection;
  // A saved or linked aisle with no floor games falls back to the whole floor.
  const selectedSection: ArcadeDashboardSectionId =
    requestedSection === 'all' || FLOOR_SECTION_IDS.has(requestedSection)
      ? requestedSection
      : 'all';
  const normalizedGameSearch = gameSearch.trim().toLowerCase();
  const isGameUnavailable = useCallback(
    (game: DashboardGame) => !availability.sections.games || availability.disabledGames.includes(game.slug),
    [availability],
  );
  const shouldHideUnavailable = availability.disabledGameDisplay === 'hidden';
  const catalogGameCount = shouldHideUnavailable
    ? FLOOR_GAMES.filter((game) => !isGameUnavailable(game)).length
    : FLOOR_GAMES.length;
  const popularityRank = useMemo(
    () => new Map(popularGameSlugs.map((slug, index) => [slug, index])),
    [popularGameSlugs],
  );

  const visibleSections = useMemo(() => {
    const sections =
      normalizedGameSearch || selectedSection === 'all'
        ? ARCADE_DASHBOARD_SECTIONS.filter((section) => section.id !== 'all')
        : [ARCADE_SECTION_META[selectedSection]];

    return sections
      .map((section) => {
        const items = FLOOR_GAMES
          .filter((game) => {
            if (game.sectionId !== section.id) return false;
            if (shouldHideUnavailable && isGameUnavailable(game)) return false;
            return matchesSearch(game, section.label, normalizedGameSearch);
          })
          .sort((a, b) => {
            if (isGameUnavailable(a) !== isGameUnavailable(b)) {
              return isGameUnavailable(a) ? 1 : -1;
            }
            const aRank = popularityRank.get(a.slug) ?? Number.MAX_SAFE_INTEGER;
            const bRank = popularityRank.get(b.slug) ?? Number.MAX_SAFE_INTEGER;
            return aRank - bRank
              || (REGISTRY_RANK.get(a.slug) ?? 0) - (REGISTRY_RANK.get(b.slug) ?? 0);
          });

        return { section, items };
      })
      .filter(({ items }) => items.length > 0 || !normalizedGameSearch);
  }, [isGameUnavailable, normalizedGameSearch, popularityRank, selectedSection, shouldHideUnavailable]);

  const reserveItems = useMemo(
    () =>
      RESERVE_GAMES.filter((game) => {
        if (selectedSection !== 'all' && game.sectionId !== selectedSection) return false;
        if (shouldHideUnavailable && isGameUnavailable(game)) return false;
        return matchesSearch(
          game,
          ARCADE_SECTION_META[game.sectionId].label,
          normalizedGameSearch,
        );
      }),
    [isGameUnavailable, normalizedGameSearch, selectedSection, shouldHideUnavailable],
  );
  // A search that matches the reserve opens it; otherwise it stays folded.
  const reserveExpanded = moreGamesOpen || normalizedGameSearch.length > 0;

  const visibleGameCount = useMemo(
    () =>
      visibleSections.reduce((total, entry) => total + entry.items.length, 0)
      + reserveItems.length,
    [reserveItems, visibleSections],
  );
  const isFloorOverview = selectedSection === 'all' && !normalizedGameSearch;
  const sectionFilterItems = useMemo<ReadonlyArray<ArcadeSegmentItem<ArcadeDashboardSectionId>>>(
    () =>
      ARCADE_DASHBOARD_SECTIONS
        .filter((section) => section.id === 'all' || FLOOR_SECTION_IDS.has(section.id))
        .map((section) => ({
          value: section.id,
          label: section.label,
        })),
    [],
  );

  const onSectionChange = useCallback(
    (sectionId: ArcadeDashboardSectionId) => {
      router.push(getSectionHref(sectionId), { scroll: false });
    },
    [router],
  );

  const favoriteGames = useMemo(
    () => favoriteGameSlugs
      .map((slug) => ARCADE_GAMES.find((game) => game.slug === slug) ?? null)
      .filter((game): game is DashboardGame => game !== null && !(shouldHideUnavailable && isGameUnavailable(game))),
    [favoriteGameSlugs, isGameUnavailable, shouldHideUnavailable],
  );

  const toggleFavorite = useCallback(async (game: DashboardGame) => {
    if (!canFavorite || favoriteBusySlug) return;
    const alreadyFavorite = favoriteGameSlugs.includes(game.slug);
    if (!alreadyFavorite && favoriteGameSlugs.length >= MAX_FAVORITE_GAMES) {
      setFavoriteError(
        `You can pin up to ${MAX_FAVORITE_GAMES} favorites. Remove one before adding ${game.title}.`,
      );
      return;
    }

    const previous = favoriteGameSlugs;
    const next = alreadyFavorite
      ? previous.filter((slug) => slug !== game.slug)
      : [...previous, game.slug];

    setFavoriteBusySlug(game.slug);
    setFavoriteError(null);
    setFavoriteGameSlugs(next);
    try {
      const response = await fetch('/api/account/favorite-games', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gameSlugs: next }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
        favoriteGameSlugs?: string[];
      };
      if (!response.ok) throw new Error(payload.error || 'Unable to save favorites.');
      if (payload.favoriteGameSlugs) setFavoriteGameSlugs(payload.favoriteGameSlugs);
    } catch (caught) {
      setFavoriteGameSlugs(previous);
      setFavoriteError((caught as Error).message);
    } finally {
      setFavoriteBusySlug(null);
    }
  }, [canFavorite, favoriteBusySlug, favoriteGameSlugs]);

  // The landing overview keeps one highlighted row per aisle. Choosing an
  // aisle or searching expands to the full matching game list.
  const sectionRows = useMemo(
    () =>
      visibleSections
        .filter(({ items }) => items.length > 0)
        .map((entry) => ({
          ...entry,
          visibleItems: isFloorOverview ? entry.items.slice(0, 4) : entry.items,
        })),
    [isFloorOverview, visibleSections],
  );

  return (
    <div className='space-y-8'>
      {/* ── Full-bleed marquee hero ─────────────────────────────────────
          The AODOM cabinet sign anchors a wide wood-grain band; the lede and
          compact proof points sit left. This owns the page's single <h1>. */}
      <ArcReveal
        as='section'
        index={0}
        className='arc-hero -mx-4 px-6 sm:px-10'
      >
        <span className='arc-hero-bulbs' aria-hidden />
        <div className='relative grid items-center gap-4 py-7 sm:gap-6 sm:py-12 md:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] md:gap-8 md:py-0 md:min-h-[clamp(18rem,32vw,24rem)]'>
          <div className='order-1 min-w-0'>
            <p className='arcade-kicker'>Arcade</p>
            <h1 className='arcade-display mt-3 text-4xl text-strong uppercase sm:text-5xl xl:text-6xl'>
              Pick your cabinet
            </h1>
            <p className='mt-4 max-w-md text-sm text-body sm:text-base'>
              {availability.sections.games
                ? 'Elo-rated classics, ticket wagers, and daily streak rewards — all on one floor.'
                : availability.message}
            </p>
            <div className='mt-6 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs font-semibold uppercase tracking-wide text-faint'>
              <span><b className='arcade-num text-strong'>{catalogGameCount}</b> cabinets</span>
              <span aria-hidden className='text-tickets-text'>•</span>
              <span>No download</span>
              {availability.sections.games ? (
                <>
                  <span aria-hidden className='text-tickets-text'>•</span>
                  <span>Play as guest</span>
                </>
              ) : null}
            </div>
          </div>
          <div className='order-2 flex justify-center self-end md:justify-end'>
            <Image
              src='/brand/aodom-hero.webp'
              alt='Arcade cabinet'
              width={1280}
              height={853}
              priority
              fetchPriority='high'
              quality={78}
              sizes='(max-width: 640px) 16rem, (max-width: 768px) 28rem, 34rem'
              className='h-auto w-full max-w-[16rem] drop-shadow-[0_16px_34px_rgba(0,0,0,0.55)] sm:max-w-[28rem] md:max-w-[34rem]'
            />
          </div>
        </div>
        {/* soft fade into the floor below */}
        <div
          aria-hidden
          className='pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-gradient-to-b from-transparent to-[var(--bg)]'
        />
      </ArcReveal>

      {availability.sections.games ? (
        <ArcReveal as='section' index={1} aria-label='Your arcade today'>
          <TodayLobby />
        </ArcReveal>
      ) : null}

      {/* ── One floor row: aisle tabs + wallet + search ──────────────────
          The wallet rides this row instead of sitting alone on a page-wide
          rail below the tabs (which left the right half empty on desktop). ── */}
      <ArcReveal
        id='arcade-floor'
        index={2}
        className='flex flex-col gap-3 scroll-mt-24 lg:flex-row lg:flex-wrap lg:items-center lg:justify-between'
      >
        {/* Wrapper owns the horizontal scroll so the fade mask can key off a
            real overflow measurement (fading a strip that fits dims the
            first/last tabs for no reason on desktop). */}
        <div
          ref={tabStripRef}
          className={`min-w-0 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden${
            tabStripOverflowing ? ' arc-scroll-fade' : ''
          }`}
        >
          <ArcadeSegmented
            items={sectionFilterItems}
            value={selectedSection}
            onChange={onSectionChange}
            tone={getSectionTone(selectedSection)}
            ariaLabel='Filter games by aisle'
          />
        </div>
        <div className='flex flex-col gap-3 sm:flex-row sm:items-center lg:justify-end'>
          <GamesWalletCard wallet={wallet} compact layout='inline' />
          <div className='relative sm:w-72'>
            <ArcadeInput
              type='search'
              inputSize='md'
              icon={<Search size={16} aria-hidden />}
              value={gameSearch}
              onChange={(event) => setGameSearch(event.target.value)}
              placeholder='Search games'
              aria-label='Search games'
              className='pr-11'
              wrapClassName='w-full'
            />
            {gameSearch ? (
              <ArcadeButton
                type='button'
                onClick={() => setGameSearch('')}
                tone='ghost'
                size='icon-xs'
                className='absolute top-1/2 right-2 -translate-y-1/2'
                aria-label='Clear game search'
              >
                <X size={14} />
              </ArcadeButton>
            ) : null}
          </div>
        </div>
      </ArcReveal>

      <div className='space-y-6'>
        <div className='min-w-0 space-y-8'>
          {favoriteError ? (
            <ArcadeNotice tone='danger'>{favoriteError}</ArcadeNotice>
          ) : null}

          {canFavorite && !normalizedGameSearch ? (
            <section className='arc-aisle space-y-3' aria-labelledby='favorite-games-title'>
              <div className='flex items-end justify-between gap-4'>
                <div className='min-w-0'>
                  <p className='arcade-kicker flex items-center gap-1.5'>
                    <Star size={12} fill='currentColor' aria-hidden />
                    Player picks
                  </p>
                  <h2
                    id='favorite-games-title'
                    className='arcade-display mt-1 text-lg text-strong uppercase'
                  >
                    Your favorite games
                  </h2>
                  <p className='mt-1 text-sm text-faint'>
                    Pinned ahead of the popular aisles and featured with stats on your profile.
                  </p>
                </div>
                <ArcadeChip tone='tickets'>
                  <span className='arcade-num'>{favoriteGames.length}</span>
                  /{MAX_FAVORITE_GAMES}
                </ArcadeChip>
              </div>

              {favoriteGames.length > 0 ? (
                <div className='arc-game-grid grid grid-cols-1 gap-2.5 min-[360px]:grid-cols-2 sm:gap-3 lg:grid-cols-3 xl:grid-cols-4'>
                  {favoriteGames.map((game, index) => (
                    <ArcReveal key={game.slug} index={index}>
                      <GamesDashboardCard
                        id={game.slug}
                        title={game.title}
                        description={game.description}
                        icon={game.icon}
                        href={getGameDisplayRoute(game.slug, game.href)}
                        tone={ARCADE_SECTION_ENAMEL[game.sectionId]}
                        metaLabel={isGameListed(game.slug) ? getGameMetaLabel(game) : 'off the floor'}
                        compact
                        canFavorite
                        favorite
                        favoriteBusy={favoriteBusySlug === game.slug}
                        onToggleFavorite={() => void toggleFavorite(game)}
                        unavailable={isGameUnavailable(game)}
                        unavailableMessage={availability.message}
                      />
                    </ArcReveal>
                  ))}
                </div>
              ) : (
                <ArcadeNotice tone='info'>
                  Star any game below to build your four-cabinet favorite row.
                </ArcadeNotice>
              )}
            </section>
          ) : null}

          {visibleGameCount === 0 ? (
            <ArcadeNotice>
              {normalizedGameSearch
                ? <>No games match &ldquo;{gameSearch.trim()}&rdquo;.</>
                : availability.message}
            </ArcadeNotice>
          ) : null}

          {sectionRows.map(({ section, items, visibleItems }) => {
            const tone =
              section.id === 'all' ? 'primary' : ARCADE_SECTION_ENAMEL[section.id];
            return (
              <section
                key={section.id}
                id={`arcade-section-${section.id}`}
                className='arc-aisle space-y-3'
              >
                <div className='flex items-end justify-between gap-4'>
                  <div className='min-w-0'>
                    <p className='arcade-kicker'>Aisle</p>
                    <h2 className='arcade-display mt-1 text-lg text-strong uppercase'>
                      {section.label}
                    </h2>
                    <p className='mt-1 text-sm text-faint'>{section.description}</p>
                    {visibleItems.length < items.length ? (
                      <p className='mt-1 text-xs text-faint'>
                        Most played in the last 30 days
                      </p>
                    ) : null}
                  </div>
                  <div className='flex shrink-0 items-center gap-2'>
                    <ArcadeChip>
                      <span className='arcade-num'>{items.length}</span>
                      &nbsp;{items.length === 1 ? 'game' : 'games'}
                    </ArcadeChip>
                    {selectedSection === 'all' ? (
                      <div className='hidden sm:block'>
                        <ArcadeLinkButton
                          href={getSectionHref(section.id)}
                          scroll={false}
                          tone='ghost'
                          size='xs'
                        >
                          Browse all
                          <ArrowRight size={12} />
                        </ArcadeLinkButton>
                      </div>
                    ) : null}
                  </div>
                </div>

                <div className='arc-game-grid grid grid-cols-1 gap-2.5 min-[360px]:grid-cols-2 sm:gap-3 lg:grid-cols-3 xl:grid-cols-4'>
                  {visibleItems.map((game, index) => (
                    <ArcReveal key={game.slug} index={Math.min(index, 6)}>
                      <GamesDashboardCard
                        id={game.slug}
                        title={game.title}
                        description={game.description}
                        icon={game.icon}
                        href={getGameDisplayRoute(game.slug, game.href)}
                        tone={tone}
                        metaLabel={getGameMetaLabel(game)}
                        compact={isFloorOverview}
                        canFavorite={canFavorite}
                        favorite={favoriteGameSlugs.includes(game.slug)}
                        favoriteBusy={favoriteBusySlug === game.slug}
                        onToggleFavorite={() => void toggleFavorite(game)}
                        unavailable={isGameUnavailable(game)}
                        unavailableMessage={availability.message}
                      />
                    </ArcReveal>
                  ))}
                </div>
              </section>
            );
          })}

          {reserveItems.length > 0 ? (
            <section
              id='arcade-more-games'
              className='arc-aisle space-y-3'
              aria-labelledby='more-games-title'
            >
              <div className='flex items-end justify-between gap-4'>
                <div className='min-w-0'>
                  <h2
                    id='more-games-title'
                    className='arcade-display text-lg text-strong'
                  >
                    more games
                  </h2>
                  <p className='mt-1 text-sm text-faint'>
                    Off the floor. Scores stay.
                  </p>
                </div>
                <div className='flex shrink-0 items-center gap-2'>
                  <ArcadeChip>
                    <span className='arcade-num'>{reserveItems.length}</span>
                    &nbsp;{reserveItems.length === 1 ? 'game' : 'games'}
                  </ArcadeChip>
                  {normalizedGameSearch ? null : (
                    <ArcadeButton
                      type='button'
                      tone='ghost'
                      size='xs'
                      aria-expanded={reserveExpanded}
                      aria-controls='more-games-grid'
                      onClick={() => setMoreGamesOpen((open) => !open)}
                    >
                      {reserveExpanded ? 'hide' : 'show'}
                    </ArcadeButton>
                  )}
                </div>
              </div>

              {reserveExpanded ? (
                <div
                  id='more-games-grid'
                  className='arc-game-grid grid grid-cols-1 gap-2.5 min-[360px]:grid-cols-2 sm:gap-3 lg:grid-cols-3 xl:grid-cols-4'
                >
                  {reserveItems.map((game, index) => (
                    <ArcReveal key={game.slug} index={Math.min(index, 6)}>
                      <GamesDashboardCard
                        id={game.slug}
                        title={game.title}
                        description={game.description}
                        icon={game.icon}
                        href={getGameDisplayRoute(game.slug, game.href)}
                        tone={ARCADE_SECTION_ENAMEL[game.sectionId]}
                        metaLabel={getGameMetaLabel(game)}
                        compact
                        canFavorite={canFavorite}
                        favorite={favoriteGameSlugs.includes(game.slug)}
                        favoriteBusy={favoriteBusySlug === game.slug}
                        onToggleFavorite={() => void toggleFavorite(game)}
                        unavailable={isGameUnavailable(game)}
                        unavailableMessage={availability.message}
                      />
                    </ArcReveal>
                  ))}
                </div>
              ) : null}
            </section>
          ) : null}

          <ArcadeNotice>
            Missing a game you&rsquo;d like to see?{' '}
            <Link href='/feedback/new' className='arcade-link'>
              Request a game
            </Link>
            .
          </ArcadeNotice>

          <div className='grid gap-6 xl:grid-cols-2'>
            {availability.sections.games ? (
              <ArcReveal as='section' index={1} aria-label='Live multiplayer'>
                <MultiplayerLiveSpotlight />
              </ArcReveal>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
