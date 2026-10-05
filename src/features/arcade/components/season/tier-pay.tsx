'use client';

/* What a tier pays: tickets as a stub, a prize as its art at 32 px and its
   name. The season's prizes come from the art kit (an SVG file); the old season 0's
   keep their store preview. */

import { StoreItemPreview } from '@/features/arcade/components/store-item-preview';
import type { RewardGameType } from '@/features/arcade/lib/rewards';
import { ArcadeStub, Num } from '@/features/arcade/components/ui/arcade-ui';
import type { RewardView } from '@/server/arcade/battlepass';

import './season.css';

export function TierPay({ reward, muted = false }: { reward: RewardView; muted?: boolean }) {
  if (reward.kind === 'tickets') {
    return (
      <span className='sq-tierpay'>
        <ArcadeStub size='sm' muted={muted}>
          <Num value={reward.amount ?? 0} labelSuffix='tickets' />
        </ArcadeStub>
      </span>
    );
  }
  return (
    <span className='sq-tierpay'>
      <span className='sq-prize-art' aria-hidden='true'>
        {reward.art ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={reward.art} alt='' height={32} />
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
      <span className='sq-prize-name'>{(reward.name ?? '').toLowerCase()}</span>
    </span>
  );
}
