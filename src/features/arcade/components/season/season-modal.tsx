'use client';

/* The season card in a dialog (a sheet on phones), opened from the home. The
   head says the tier and what the next tier pays. Below it the same track as
   the season page: every tier on one rail, claimed in place. */

import Link from 'next/link';

import { ArcadeButton, Num } from '@/features/arcade/components/ui/arcade-ui';
import { ArcadeDialog } from '@/features/arcade/components/ui/arcade-sheet';

import { nextTier, seasonTitle, xpToTier } from './season-model';
import { SeasonTrack } from './season-track';
import { TierPay } from './tier-pay';
import { claimableTracks, type SeasonController } from './use-season';

import './season.css';

export function SeasonModal({
  open,
  onClose,
  season,
}: {
  open: boolean;
  onClose: () => void;
  season: SeasonController;
}) {
  const { state } = season;

  const next = state ? nextTier(state) : null;
  const readyCount = state ? state.tiers.filter((tier) => claimableTracks(tier).length > 0).length : 0;

  return (
    <ArcadeDialog open={open} onClose={onClose} title={state ? seasonTitle(state.seasonName) : 'Season'} tone='cream' maxWidth={640}>
      {!state ? (
        <p className='sm-quiet'>{season.failed ? 'The season card is not loading right now.' : 'Loading the card.'}</p>
      ) : (
        <div className='sm'>
          <div className='sm-head'>
            <p className='sm-tier-now'>
              <span className='sm-big'>
                <Num value={state.tier} label={`tier ${state.tier}`} />
              </span>
              <span>
                of <Num value={state.maxTier} /> tiers
              </span>
            </p>
            {next ? (
              <div className='sm-next' aria-live='polite'>
                <span>
                  Tier <Num value={next.tier} /> pays
                </span>
                <TierPay reward={next.free} />
                {next.premium ? (
                  <>
                    <span>and</span>
                    <TierPay reward={next.premium} />
                  </>
                ) : null}
                <span>
                  in <Num value={xpToTier(state, next.tier)} /> xp.
                </span>
              </div>
            ) : (
              <p className='sm-quiet'>Every tier is open. More xp still counts toward your level.</p>
            )}
            {readyCount > 1 ? (
              <ArcadeButton size='md' tone='primary' onClick={() => void season.claimAll()} disabled={season.busy}>
                {season.busy ? 'claiming' : `claim ${readyCount}`}
              </ArcadeButton>
            ) : null}
            <p className='sm-status' role='status'>
              {season.error ?? season.message ?? ''}
            </p>
          </div>
          <div className='sm-track'>
            <SeasonTrack state={state} season={season} />
          </div>
          <Link href='/battlepass' className='sm-link' onClick={onClose}>
            season page
          </Link>
        </div>
      )}
    </ArcadeDialog>
  );
}
