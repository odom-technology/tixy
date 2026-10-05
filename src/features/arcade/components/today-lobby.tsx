'use client';

import {
  ArrowRight,
  Check,
  Flame,
  Gamepad2,
  Gift,
  Radio,
  Sparkles,
  Target,
  Ticket,
  Trophy,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

import { ARCADE_GAMES } from '@/features/arcade/components/arcade-game-registry';
import { AccountIdentityContext } from '@/features/arcade/components/shell/use-account-summary';
import {
  loadMultiplayerActivity,
  subscribeMultiplayerActivity,
} from '@/features/arcade/lib/multiplayer-activity-client';
import {
  ArcadeButton,
  ArcadeChip,
  ArcadeLinkButton,
  ArcadeMarquee,
  ArcadePanel,
  ArcadeProgress,
  cx,
} from '@/features/arcade/components/ui/arcade-ui';
import { useRecentlyPlayedGames } from '@/features/arcade/components/use-recent-games';
import {
  getQuestProgress,
  rankTodayRecommendations,
  selectTodayQuest,
  type TodayBattlepassState,
  type TodayClaimSignal,
  type TodayRecommendation,
} from '@/features/arcade/components/today-lobby-model';

type FeaturedView = {
  gameType: string;
  creditMultiplier: number;
};

type DailyClaimView = TodayClaimSignal & {
  nextReward: { tickets?: number; credits?: number } | null;
};

type MultiplayerActivityView = {
  friendsOnline: number | null;
  featured: {
    gameType: string;
    label: string;
    lobbyPath: string;
    playersInGame: number;
    openLobbies: number;
    liveMatches: number;
  };
};

type LoadState<T> =
  | { status: 'loading'; value: null }
  | { status: 'ready'; value: T }
  | { status: 'failed'; value: null };

const loadingState = <T,>(): LoadState<T> => ({ status: 'loading', value: null });
const failedState = <T,>(): LoadState<T> => ({ status: 'failed', value: null });
// Connections is off the floor; word grid is the daily on the rev. 2 floor.
const DAILY_PUZZLE = ARCADE_GAMES.find((game) => game.slug === 'word-grid')!;

function TodayLane({
  eyebrow,
  icon: Icon,
  children,
  className,
}: {
  eyebrow: string;
  icon: LucideIcon;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx('min-w-0 p-4 sm:p-5', className)}>
      <div className='flex items-center gap-2 text-faint'>
        <Icon size={15} aria-hidden />
        <p className='arcade-kicker'>{eyebrow}</p>
      </div>
      {children}
    </div>
  );
}

function LoadingLane({ label }: { label: string }) {
  return (
    <TodayLane eyebrow={label} icon={Sparkles}>
      <div className='mt-3 space-y-3' aria-hidden>
        <div className='h-5 w-2/3 animate-pulse rounded-tag bg-soft' />
        <div className='h-3 w-full animate-pulse rounded-tag bg-soft' />
        <div className='h-8 w-24 animate-pulse rounded-key bg-soft' />
      </div>
      <span className='sr-only'>Loading {label.toLowerCase()}</span>
    </TodayLane>
  );
}

function GameBadge({ icon: Icon }: { icon: LucideIcon }) {
  return (
    <span className='grid size-10 shrink-0 place-items-center rounded-key border-2 border-soft bg-raised text-primary-text shadow-chip'>
      <Icon size={19} aria-hidden />
    </span>
  );
}

function RecommendationChips({
  recommendation,
  multiplier,
  multiplayer,
}: {
  recommendation: TodayRecommendation;
  multiplier: number | null;
  multiplayer: MultiplayerActivityView['featured'] | null;
}) {
  return (
    <div className='mt-3 flex flex-wrap gap-1.5'>
      {recommendation.reasons.includes('featured-reward') && multiplier ? (
        <ArcadeChip tone='tickets'>
          <span className='arcade-num'>{multiplier}&times;</span>&nbsp;tickets
        </ArcadeChip>
      ) : null}
      {recommendation.reasons.includes('recent-play') ? (
        <ArcadeChip>Played recently</ArcadeChip>
      ) : null}
      {recommendation.reasons.includes('opponent-waiting') && multiplayer ? (
        <ArcadeChip tone='prize'>
          {multiplayer.openLobbies} {multiplayer.openLobbies === 1 ? 'opponent' : 'opponents'} waiting
        </ArcadeChip>
      ) : null}
      {recommendation.reasons.includes('friends-online') ? (
        <ArcadeChip tone='info'>Friends online</ArcadeChip>
      ) : null}
    </div>
  );
}

export type TodayLobbyProps = {
  className?: string;
};

/**
 * A deterministic, explainable recommendation surface assembled from existing
 * product APIs. Reward, quest, streak, and live-demand facts remain owned by
 * their server handlers; this component only ranks and presents next actions.
 */
export function TodayLobby({ className }: TodayLobbyProps) {
  const hasIdentity = useContext(AccountIdentityContext);
  const recentlyPlayed = useRecentlyPlayedGames(3);
  const [hydrated, setHydrated] = useState(false);
  const [featured, setFeatured] = useState<LoadState<FeaturedView>>(loadingState);
  const [battlepass, setBattlepass] = useState<LoadState<TodayBattlepassState>>(loadingState);
  const [claim, setClaim] = useState<LoadState<DailyClaimView>>(loadingState);
  const [activity, setActivity] = useState<LoadState<MultiplayerActivityView>>(loadingState);
  const [claimingDaily, setClaimingDaily] = useState(false);
  const [claimError, setClaimError] = useState<string | null>(null);

  useEffect(() => setHydrated(true), []);

  const loadFeatured = useCallback(async () => {
    try {
      const response = await fetch('/api/games/featured', { cache: 'no-store' });
      if (!response.ok) throw new Error();
      const data = (await response.json()) as {
        gameType?: string;
        creditMultiplier?: number;
      };
      if (!data.gameType) throw new Error();
      setFeatured({
        status: 'ready',
        value: {
          gameType: data.gameType,
          creditMultiplier: data.creditMultiplier ?? 2,
        },
      });
    } catch {
      setFeatured(failedState);
    }
  }, []);

  const loadActivity = useCallback(async () => {
    try {
      const data = await loadMultiplayerActivity();
      setActivity({ status: 'ready', value: data });
    } catch {
      setActivity(failedState);
    }
  }, []);

  const loadPersonalState = useCallback(async () => {
    if (hasIdentity === false) {
      setBattlepass(failedState);
      setClaim(failedState);
      return;
    }
    if (hasIdentity === null) return;

    const [battlepassResult, claimResult] = await Promise.allSettled([
      fetch('/api/battlepass', { cache: 'no-store' }),
      fetch('/api/games/daily-claim', { cache: 'no-store' }),
    ]);

    if (battlepassResult.status === 'fulfilled' && battlepassResult.value.ok) {
      try {
        const data = (await battlepassResult.value.json()) as TodayBattlepassState;
        if (!data || !Array.isArray(data.quests) || !data.bar) throw new Error();
        setBattlepass({ status: 'ready', value: data });
      } catch {
        setBattlepass(failedState);
      }
    } else {
      setBattlepass(failedState);
    }

    if (claimResult.status === 'fulfilled' && claimResult.value.ok) {
      try {
        const data = (await claimResult.value.json()) as DailyClaimView;
        if (typeof data?.available !== 'boolean' || typeof data.streak !== 'number') {
          throw new Error();
        }
        setClaim({ status: 'ready', value: data });
      } catch {
        setClaim(failedState);
      }
    } else {
      setClaim(failedState);
    }
  }, [hasIdentity]);

  useEffect(() => {
    void Promise.all([loadFeatured(), loadActivity(), loadPersonalState()]);
  }, [loadActivity, loadFeatured, loadPersonalState]);

  useEffect(() => subscribeMultiplayerActivity((next) => {
    setActivity({ status: 'ready', value: next });
  }), []);

  useEffect(() => {
    const refresh = () => {
      void Promise.all([loadFeatured(), loadPersonalState()]);
    };
    const onVisibilityChange = () => {
      if (!document.hidden) refresh();
    };
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [loadFeatured, loadPersonalState]);

  const featuredGame = featured.status === 'ready'
    ? ARCADE_GAMES.find((game) => game.slug === featured.value.gameType) ?? null
    : null;
  const nearestQuest = useMemo(
    () => battlepass.status === 'ready' ? selectTodayQuest(battlepass.value.quests) : null,
    [battlepass],
  );
  const questGame = nearestQuest?.targetGame
    ? ARCADE_GAMES.find((game) => game.slug === nearestQuest.targetGame) ?? null
    : null;

  const recommendations = useMemo(() => rankTodayRecommendations({
    recentGames: hydrated
      ? recentlyPlayed.map((game) => ({ id: game.slug, href: game.href }))
      : [],
    featured: featuredGame && featured.status === 'ready'
      ? {
          id: featuredGame.slug,
          href: featuredGame.href,
          multiplier: featured.value.creditMultiplier,
        }
      : null,
    quest: nearestQuest,
    questTarget: questGame ? { id: questGame.slug, href: questGame.href } : null,
    claim: claim.status === 'ready' ? claim.value : null,
    multiplayer: activity.status === 'ready'
      ? {
          id: activity.value.featured.gameType,
          href: activity.value.featured.lobbyPath,
          openLobbies: activity.value.featured.openLobbies,
          playersInGame: activity.value.featured.playersInGame,
          liveMatches: activity.value.featured.liveMatches,
          friendsOnline: activity.value.friendsOnline,
        }
      : null,
    dailyPuzzle: { id: DAILY_PUZZLE.slug, href: DAILY_PUZZLE.href },
  }).slice(0, 3), [
    activity,
    claim,
    featured,
    featuredGame,
    hydrated,
    nearestQuest,
    questGame,
    recentlyPlayed,
  ]);

  const rankingLoading = !hydrated
    || featured.status === 'loading'
    || activity.status === 'loading'
    || (hasIdentity !== false
      && (battlepass.status === 'loading' || claim.status === 'loading'));

  const claimDaily = useCallback(async () => {
    if (claimingDaily) return;
    setClaimingDaily(true);
    setClaimError(null);
    try {
      const response = await fetch('/api/games/daily-claim', { method: 'POST' });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(data.error ?? 'Unable to claim daily reward.');
      window.dispatchEvent(new Event('store-inventory-updated'));
      await loadPersonalState();
    } catch (error) {
      setClaimError(error instanceof Error ? error.message : 'Unable to claim daily reward.');
    } finally {
      setClaimingDaily(false);
    }
  }, [claimingDaily, loadPersonalState]);

  const gameForRecommendation = useCallback((recommendation: TodayRecommendation) =>
    ARCADE_GAMES.find((game) => game.href === recommendation.href)
    ?? ARCADE_GAMES.find((game) => game.slug === recommendation.gameId)
    ?? null,
  []);

  const laneGridClass = recommendations.length >= 3 ? 'lg:grid-cols-3' : 'lg:grid-cols-2';

  return (
    <ArcadePanel
      variant='cabinet'
      className={cx('overflow-hidden p-0', className)}
      aria-label='Your tixy today'
      aria-busy={rankingLoading}
    >
      <ArcadeMarquee
        tone='primary'
        size='md'
        trailing={<Sparkles size={16} aria-hidden />}
      >
        Your tixy today
      </ArcadeMarquee>

      <div
        className={cx(
          'grid divide-y-2 divide-soft lg:divide-x-2 lg:divide-y-0',
          rankingLoading ? 'lg:grid-cols-3' : laneGridClass,
        )}
        aria-live='polite'
      >
        {rankingLoading ? (
          <>
            <LoadingLane label='Best next move' />
            <LoadingLane label='Personalizing' />
            <LoadingLane label='Checking the floor' />
          </>
        ) : recommendations.map((recommendation, index) => {
          const game = gameForRecommendation(recommendation);
          const isQuest = recommendation.kind === 'quest-game'
            || recommendation.kind === 'claim-quest';
          const questProgress = nearestQuest ? getQuestProgress(nearestQuest) : null;
          const multiplayer = activity.status === 'ready'
            && recommendation.reasons.some((reason) =>
              reason === 'opponent-waiting'
              || reason === 'friends-online'
              || reason === 'players-active'
              || reason === 'matches-live')
            ? activity.value.featured
            : null;
          const featuredMultiplier = featured.status === 'ready'
            ? featured.value.creditMultiplier
            : null;
          const eyebrow = index === 0 ? 'Best next move' : 'Also for you';

          if (recommendation.kind === 'daily-claim') {
            const streak = claim.status === 'ready' ? claim.value.streak : 0;
            const amount = claim.status === 'ready'
              ? claim.value.nextReward?.tickets ?? claim.value.nextReward?.credits ?? 0
              : 0;
            return (
              <TodayLane key={recommendation.id} eyebrow={eyebrow} icon={Gift}>
                <h2 className='arcade-display mt-3 text-lg uppercase text-strong'>
                  {streak > 0 ? `Protect your ${streak}-day streak` : 'Claim today’s reward'}
                </h2>
                <p className='mt-1 text-xs text-faint'>
                  {streak > 0
                    ? 'Your daily reward is ready. Claim it before today closes.'
                    : 'Start a daily streak and add the reward to your wallet.'}
                </p>
                {amount > 0 ? (
                  <div className='mt-3'>
                    <ArcadeChip tone='tickets'>
                      <Ticket size={12} aria-hidden /> +{amount} tickets
                    </ArcadeChip>
                  </div>
                ) : null}
                <div className='mt-4'>
                  <ArcadeButton
                    tone='tickets'
                    size='sm'
                    disabled={claimingDaily}
                    onClick={() => void claimDaily()}
                  >
                    {claimingDaily ? 'Claiming…' : 'Claim daily reward'}
                    <ArrowRight size={14} aria-hidden />
                  </ArcadeButton>
                  {claimError ? (
                    <p className='mt-2 text-xs font-semibold text-danger-text'>{claimError}</p>
                  ) : null}
                </div>
              </TodayLane>
            );
          }

          if (recommendation.kind === 'claim-quest' && nearestQuest && questProgress) {
            return (
              <TodayLane key={recommendation.id} eyebrow={eyebrow} icon={Trophy}>
                <div className='mt-3 flex items-start justify-between gap-3'>
                  <h2 className='text-sm font-semibold text-strong'>{nearestQuest.label}</h2>
                  <ArcadeChip tone='prize'><Check size={12} aria-hidden /> Ready</ArcadeChip>
                </div>
                <ArcadeProgress
                  className='mt-3'
                  current={questProgress.current}
                  max={questProgress.max}
                  tone='prize'
                />
                <p className='mt-3 text-xs text-faint'>
                  +{nearestQuest.rewardXp} XP · +{nearestQuest.rewardTickets} tickets
                </p>
                <div className='mt-4'>
                  <ArcadeLinkButton href='/battlepass' tone='prize' size='sm'>
                    Claim quest reward <ArrowRight size={14} aria-hidden />
                  </ArcadeLinkButton>
                </div>
              </TodayLane>
            );
          }

          const Icon = game?.icon
            ?? (recommendation.kind === 'multiplayer' ? Users : Gamepad2);
          const title = game?.title
            ?? multiplayer?.label
            ?? (recommendation.kind === 'daily-puzzle' ? DAILY_PUZZLE.title : 'tixy pick');
          const description = recommendation.kind === 'quest-game' && nearestQuest
            ? nearestQuest.label
            : recommendation.kind === 'multiplayer' && multiplayer
              ? multiplayer.openLobbies > 0
                ? 'An opponent is waiting in a public lobby right now.'
                : multiplayer.playersInGame > 0
                  ? 'Players are active at this cabinet right now.'
                  : 'Live matches make this the busiest multiplayer cabinet.'
              : recommendation.kind === 'featured'
                ? 'Earn bonus tickets and play beyond the standard daily cap.'
                : recommendation.kind === 'recent'
                  ? 'Jump back into the cabinet you played most recently.'
                  : 'Take on today’s fresh puzzle and build a daily rhythm.';
          const ctaLabel = recommendation.kind === 'quest-game'
            ? 'Make progress'
            : recommendation.kind === 'multiplayer'
              ? 'Join the action'
              : recommendation.kind === 'featured'
                ? 'Play featured'
                : recommendation.kind === 'recent'
                  ? 'Continue'
                  : 'Play today’s puzzle';
          const laneIcon = recommendation.kind === 'quest-game'
            ? Trophy
            : recommendation.kind === 'multiplayer'
              ? Radio
              : recommendation.kind === 'featured'
                ? Flame
                : recommendation.kind === 'daily-puzzle'
                  ? Target
                  : Gamepad2;

          return (
            <TodayLane key={recommendation.id} eyebrow={eyebrow} icon={laneIcon}>
              <div className='mt-3 flex items-start gap-3'>
                <GameBadge icon={Icon} />
                <div className='min-w-0'>
                  <h2 className='arcade-display truncate text-lg uppercase text-strong'>
                    {title}
                  </h2>
                  <p className='mt-1 line-clamp-2 text-xs text-faint'>{description}</p>
                </div>
              </div>
              {isQuest && nearestQuest && questProgress ? (
                <ArcadeProgress
                  className='mt-3'
                  current={questProgress.current}
                  max={questProgress.max}
                  tone='info'
                />
              ) : null}
              <RecommendationChips
                recommendation={recommendation}
                multiplier={featuredMultiplier}
                multiplayer={multiplayer}
              />
              <div className='mt-4'>
                <ArcadeLinkButton
                  href={recommendation.href ?? '#arcade-floor'}
                  tone={recommendation.kind === 'multiplayer'
                    ? 'primary'
                    : recommendation.reasons.includes('featured-reward')
                      ? 'tickets'
                      : 'key'}
                  size='sm'
                >
                  {ctaLabel} <ArrowRight size={14} aria-hidden />
                </ArcadeLinkButton>
              </div>
            </TodayLane>
          );
        })}
      </div>

      {!rankingLoading ? (
        <div className='border-t-2 border-soft bg-well px-4 py-3 sm:px-5'>
          {hasIdentity === false ? (
            <div className='flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between'>
              <p className='text-xs text-faint'>
                Create an account to keep scores, daily goals, tickets, and season XP.
              </p>
              <ArcadeLinkButton href='/signup' tone='ghost' size='xs'>
                Save my progress <ArrowRight size={12} aria-hidden />
              </ArcadeLinkButton>
            </div>
          ) : battlepass.status === 'ready' ? (
            <div className='grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center'>
              <ArcadeProgress
                label={`Season · Tier ${battlepass.value.tier} / ${battlepass.value.maxTier}`}
                current={battlepass.value.bar.into}
                max={battlepass.value.bar.need}
                tone='tickets'
              />
              <ArcadeLinkButton href='/battlepass' tone='ghost' size='xs'>
                View pass <ArrowRight size={12} aria-hidden />
              </ArcadeLinkButton>
            </div>
          ) : (
            <p className='text-xs text-faint'>
              Personal progress is refreshing; the available picks above are still playable.
            </p>
          )}
        </div>
      ) : null}
    </ArcadePanel>
  );
}
