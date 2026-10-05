'use client';

/* The season as a track: every tier is a stop on one rail, and the rail is
   filled to the xp you have, with a dot where you are. Tickets show as their
   stub and prizes as their art, drawn large, so the prizes read as the
   goals. A tier you reached is claimed on its card. The track opens on the
   tier you are working on and does not move on its own after that. */

import { Check, ChevronLeft, ChevronRight } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { StoreItemPreview } from '@/features/arcade/components/store-item-preview';
import type { RewardGameType } from '@/features/arcade/lib/rewards';
import { ArcadeButton, ArcadeStub, Num } from '@/features/arcade/components/ui/arcade-ui';
import type { BattlepassState, RewardView, TierView } from '@/server/arcade/battlepass';

import { landFrom } from './quest-card';
import { nextTier, xpToTier } from './season-model';
import { claimableTracks, tierClaimed, type SeasonController } from './use-season';

import './season.css';
import './season-track.css';

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

/** How full each tier's half of the rail is. Tier t's node sits mid-column:
 *  its left half carries the end of the climb from t-1, its right half the
 *  start of the climb to t+1. Tier 1's left half is the whole climb from 0. */
function railFill(state: BattlepassState, tier: number) {
  const reached = state.tier;
  const into = state.bar.atMax ? 1 : clamp01(state.bar.into / state.bar.need);
  const gap = (k: number) => (k < reached ? 1 : k === reached ? into : 0);
  const left = tier === 1 ? gap(0) : clamp01(gap(tier - 1) * 2 - 1);
  const right = tier === state.maxTier ? (reached >= state.maxTier ? 1 : 0) : clamp01(gap(tier) * 2);
  return { left, right };
}

/** Where the dot goes: the column and half the fill ends in, and how far along. */
function railHead(state: BattlepassState): { tier: number; half: 'left' | 'right'; at: number } | null {
  if (state.tier >= state.maxTier) return null;
  const into = clamp01(state.bar.into / state.bar.need);
  if (state.tier === 0) return { tier: 1, half: 'left', at: into };
  if (into < 0.5) return { tier: state.tier, half: 'right', at: into * 2 };
  return { tier: state.tier + 1, half: 'left', at: into * 2 - 1 };
}

function Prize({ reward }: { reward: RewardView }) {
  return (
    <span className='st-prize'>
      <span className='st-prize-art' data-wide={reward.art?.includes('/namecards/') || undefined} aria-hidden='true'>
        {reward.art ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={reward.art} alt='' />
        ) : reward.preview ? (
          <StoreItemPreview
            item={{
              id: reward.preview.id,
              name: reward.preview.name,
              gameType: reward.preview.gameType as RewardGameType,
              slots: reward.preview.slots,
              assetRef: reward.preview.assetRef,
            }}
            compact
            forceSquare
          />
        ) : null}
      </span>
      <span className='st-prize-name'>{(reward.name ?? '').toLowerCase()}</span>
    </span>
  );
}

function Reward({ reward, muted, size }: { reward: RewardView; muted: boolean; size: 'sm' | 'lg' }) {
  if (reward.kind === 'tickets') {
    return (
      <ArcadeStub size={size} muted={muted}>
        <Num value={reward.amount ?? 0} labelSuffix='tickets' />
      </ArcadeStub>
    );
  }
  return <Prize reward={reward} />;
}

function Stop({
  tier,
  state,
  season,
  isNext,
  head,
}: {
  tier: TierView;
  state: BattlepassState;
  season: SeasonController;
  isNext: boolean;
  head: ReturnType<typeof railHead>;
}) {
  const claimed = tierClaimed(tier);
  const claimable = claimableTracks(tier).length > 0;
  const status = claimed ? 'claimed' : claimable ? 'open' : isNext ? 'next' : tier.unlocked ? 'open' : 'locked';
  const hasPrize = tier.free.kind === 'item' || tier.premium?.kind === 'item';
  const fill = railFill(state, tier.tier);
  const dot = head?.tier === tier.tier ? head : null;
  const paysRef = useRef<HTMLDivElement>(null);

  return (
    <li
      className='st-stop'
      data-state={status}
      data-prize={hasPrize || undefined}
      data-double={tier.premium ? true : undefined}
      data-fresh={season.fresh === `tier:${tier.tier}` || undefined}
      data-tier={tier.tier}
    >
      <div className='st-card'>
        <div className='st-pays' ref={paysRef}>
          {hasPrize ? (
            <>
              {/* The prize first; a tier that also pays tickets shows them under it. */}
              {tier.premium?.kind === 'item' ? <Reward reward={tier.premium} muted={claimed} size='lg' /> : null}
              <Reward reward={tier.free} muted={claimed} size={tier.premium?.kind === 'item' ? 'sm' : 'lg'} />
            </>
          ) : (
            <>
              <Reward reward={tier.free} muted={claimed} size='lg' />
              {tier.premium ? <Reward reward={tier.premium} muted={claimed} size='sm' /> : null}
            </>
          )}
        </div>
        <div className='st-foot'>
          {claimed ? (
            <span className='st-note'>
              <Check size={14} strokeLinecap='square' aria-hidden /> claimed
            </span>
          ) : claimable ? (
            <ArcadeButton size='sm' tone='primary' onClick={() => void season.claimTier(tier, landFrom(paysRef.current))} disabled={season.busy}>
              claim
            </ArcadeButton>
          ) : isNext ? (
            <span className='st-note'>
              <Num value={xpToTier(state, tier.tier)} /> xp to go
            </span>
          ) : null}
        </div>
      </div>
      <div className='st-rail' aria-hidden='true'>
        <i className='st-fill' data-half='left' style={{ transform: `scaleX(${fill.left})` }} />
        <i className='st-fill' data-half='right' style={{ transform: `scaleX(${fill.right})` }} />
        {dot ? (
          <b className='st-head' style={{ left: dot.half === 'left' ? `${dot.at * 50}%` : `${50 + dot.at * 50}%` }} />
        ) : null}
        <span className='st-node' data-reached={tier.unlocked || undefined}>
          <Num value={tier.tier} label={`tier ${tier.tier}`} />
        </span>
      </div>
    </li>
  );
}

export function SeasonTrack({ state, season }: { state: BattlepassState; season: SeasonController }) {
  const scrollRef = useRef<HTMLOListElement>(null);
  const [ends, setEnds] = useState({ start: true, end: false });
  const next = nextTier(state);
  const head = railHead(state);

  const readEnds = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setEnds({ start: el.scrollLeft < 8, end: el.scrollLeft + el.clientWidth > el.scrollWidth - 8 });
  }, []);

  /* Open on the first tier to claim, else the next tier, about a third in.
     Once, on the track's first real layout: in a dialog it mounts before the
     dialog has a width. */
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const place = () => {
      const target = state.tiers.find((tier) => claimableTracks(tier).length > 0) ?? next ?? state.tiers.at(-1);
      const stop = target ? el.querySelector<HTMLElement>(`[data-tier='${target.tier}']`) : null;
      if (stop) el.scrollLeft = Math.max(0, stop.offsetLeft - el.offsetLeft - el.clientWidth * 0.3);
      readEnds();
    };
    const observer = new ResizeObserver(() => {
      if (el.clientWidth === 0) return;
      observer.disconnect();
      place();
    });
    observer.observe(el);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const page = (dir: -1 | 1) => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollBy({ left: dir * el.clientWidth * 0.75, behavior: 'smooth' });
  };

  return (
    <div className='st'>
      <ol className='st-scroll' ref={scrollRef} aria-label='tiers' onScroll={readEnds}>
        {state.tiers.map((tier) => (
          <Stop key={tier.tier} tier={tier} state={state} season={season} isNext={next?.tier === tier.tier} head={head} />
        ))}
      </ol>
      <button type='button' className='st-page' data-dir='back' onClick={() => page(-1)} disabled={ends.start} aria-label='earlier tiers'>
        <ChevronLeft size={20} strokeLinecap='square' aria-hidden />
      </button>
      <button type='button' className='st-page' data-dir='on' onClick={() => page(1)} disabled={ends.end} aria-label='later tiers'>
        <ChevronRight size={20} strokeLinecap='square' aria-hidden />
      </button>
    </div>
  );
}
