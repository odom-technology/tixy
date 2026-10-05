import { redirect } from 'next/navigation';

import { requireIdentity } from '@/server/auth';
import { getBattlepassState } from '@/server/arcade/battlepass';
import { seasonTitle } from '@/features/arcade/components/season/season-model';

import { BattlepassClient } from './_battlepass-client';

export const metadata = {
  title: 'Season card | tixy',
};

export const dynamic = 'force-dynamic';

export default async function BattlepassPage() {
  let identity;
  try {
    identity = await requireIdentity({ allowExternal: true });
  } catch {
    redirect('/signin?next=/battlepass');
  }

  const state = await getBattlepassState(identity.userId);
  const day = (ms: number) =>
    new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(ms));
  const nowMs = Date.now();
  const when =
    nowMs < state.startsAtMs
      ? `Starts ${day(state.startsAtMs)}.`
      : state.endsAtMs && nowMs < state.endsAtMs
        ? `Ends ${day(state.endsAtMs)}.`
        : null;

  return (
    <div className='arcade-page'>
      <section className='arcade-container space-y-6 sm:space-y-8'>
        <div className='flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1'>
          <h1 className='text-3xl font-black text-strong sm:text-4xl'>{seasonTitle(state.seasonName)}</h1>
          {when ? <p className='text-base text-[var(--tixy-ink-2)]'>{when}</p> : null}
        </div>
        <BattlepassClient initialState={state} />
      </section>
    </div>
  );
}
