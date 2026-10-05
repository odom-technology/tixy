'use client';

import { ArrowRight, Radio, Swords, Users } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import {
  ArcadeChip,
  ArcadeLinkButton,
  ArcadeMarquee,
  ArcadePanel,
  ArcadeStat,
  cx,
} from '@/features/arcade/components/ui/arcade-ui';
import type {
  MultiplayerActivitySnapshot,
  MultiplayerFeaturedReason,
} from '@/server/arcade/multiplayer-activity';
import {
  loadMultiplayerActivity,
  subscribeMultiplayerActivity,
} from '@/features/arcade/lib/multiplayer-activity-client';

const REFRESH_MS = 30_000;

const REASON_COPY: Record<MultiplayerFeaturedReason, string> = {
  'open-lobbies': 'A player is waiting now. Jump in and turn an open lobby into a live match.',
  'players-online': 'Players are already at this cabinet. Join the game with the strongest live signal.',
  'live-matches': 'This is the busiest live cabinet right now. Start a match or challenge a friend.',
  'daily-rotation': 'Today’s multiplayer pick. Start the queue or bring a friend into the challenge.',
};

export type MultiplayerLiveSpotlightProps = {
  initialSnapshot?: MultiplayerActivitySnapshot | null;
  className?: string;
};

/**
 * Drop-in dashboard slice for multiplayer liquidity. It polls only while the
 * page is visible and sends players into the existing lobby/queue/challenge UI.
 */
export function MultiplayerLiveSpotlight({
  initialSnapshot = null,
  className,
}: MultiplayerLiveSpotlightProps) {
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [failed, setFailed] = useState(false);
  const mountedRef = useRef(true);

  const refresh = useCallback(async (force = false) => {
    try {
      await loadMultiplayerActivity({ force });
      if (mountedRef.current) setFailed(false);
    } catch {
      if (mountedRef.current) setFailed(true);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    const unsubscribe = subscribeMultiplayerActivity((next) => {
      setSnapshot(next);
      setFailed(false);
    });
    void refresh();
    const interval = window.setInterval(() => {
      if (!document.hidden) void refresh(true);
    }, REFRESH_MS);
    const onVisibilityChange = () => {
      if (!document.hidden) void refresh(true);
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      mountedRef.current = false;
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      unsubscribe();
    };
  }, [refresh]);

  if (!snapshot) {
    return (
      <ArcadePanel
        variant='cabinet'
        aria-busy={!failed}
        className={cx('overflow-hidden p-0', className)}
      >
        <ArcadeMarquee tone='primary' size='md' trailing={<Swords size={16} aria-hidden />}>
          Live multiplayer
        </ArcadeMarquee>
        <div className='flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between'>
          <p className='text-sm text-body'>
            {failed
              ? 'Live counts are taking a breather. Every multiplayer lobby is still open.'
              : 'Checking the arcade floor for players and open matches…'}
          </p>
          <ArcadeLinkButton href='/?section=multiplayer' tone='key' size='sm'>
            Browse multiplayer
            <ArrowRight size={14} aria-hidden />
          </ArcadeLinkButton>
        </div>
      </ArcadePanel>
    );
  }

  const { featured } = snapshot;
  const ctaLabel = featured.openLobbies > 0 ? 'Join the action' : 'Play or challenge';

  return (
    <ArcadePanel variant='cabinet' className={cx('overflow-hidden p-0', className)}>
      <ArcadeMarquee
        tone='primary'
        size='md'
        trailing={
          <span className='inline-flex items-center gap-1.5 text-xs'>
            <span className='size-2 rounded-full bg-current' aria-hidden />
            Live
          </span>
        }
      >
        Multiplayer pick
      </ArcadeMarquee>
      <div className='grid gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_minmax(19rem,0.72fr)] lg:items-center lg:gap-6'>
        <div className='min-w-0'>
          <div className='flex flex-wrap items-center gap-2'>
            <ArcadeChip tone={featured.openLobbies > 0 ? 'prize' : 'primary'}>
              {featured.openLobbies > 0 ? 'Opponent waiting' : 'Featured live game'}
            </ArcadeChip>
            {snapshot.friendsOnline != null && snapshot.friendsOnline > 0 ? (
              <ArcadeChip tone='info'>
                {snapshot.friendsOnline} {snapshot.friendsOnline === 1 ? 'friend' : 'friends'} online
              </ArcadeChip>
            ) : null}
          </div>
          <h2 className='arcade-display mt-3 text-2xl text-strong uppercase sm:text-3xl'>
            {featured.label}
          </h2>
          <p className='mt-2 max-w-2xl text-sm text-body'>{REASON_COPY[featured.reason]}</p>
          <div className='mt-4 flex flex-wrap gap-2'>
            <ArcadeLinkButton href={featured.lobbyPath} tone='primary' size='lg'>
              {ctaLabel}
              <ArrowRight size={16} aria-hidden />
            </ArcadeLinkButton>
            <ArcadeLinkButton href='/?section=multiplayer' tone='key' size='lg'>
              All multiplayer
            </ArcadeLinkButton>
          </div>
        </div>

        <div
          className='grid grid-cols-3 gap-2'
          aria-label='Current multiplayer activity'
          aria-live='polite'
        >
          <ArcadeStat
            label='Connected'
            value={snapshot.connectedNow}
            sub='arcade-wide'
            tone='info'
            icon={Users}
          />
          <ArcadeStat
            label='Open'
            value={snapshot.openLobbies}
            sub='ready now'
            tone='prize'
            icon={Radio}
          />
          <ArcadeStat
            label='Live'
            value={snapshot.liveMatches}
            sub='fresh matches'
            tone='primary'
            icon={Swords}
          />
        </div>
      </div>
    </ArcadePanel>
  );
}
