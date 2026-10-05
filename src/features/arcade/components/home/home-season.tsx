'use client';

/* The season card in the rail, under daily tickets. The tier as a big
   number with the bar to the next one; what the next tier pays, drawn as the
   prize; the tiers waiting, claimed where they are (stubs fly up to the
   balance); this week's card as its games' cabinets. "all tiers" opens the
   season modal. It takes the rail's spare height, so the rail ends where
   the quests under the table end. */

import Link from 'next/link';
import { Check } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';

import { flyTickets } from '@/features/arcade/components/feedback/ticket-gain';
import { SeasonModal } from '@/features/arcade/components/season/season-modal';
import { nextTier, xpToTier } from '@/features/arcade/components/season/season-model';
import { claimableTracks, useSeason } from '@/features/arcade/components/season/use-season';
import { StoreItemPreview } from '@/features/arcade/components/store-item-preview';
import { ArcadeStub, Num } from '@/features/arcade/components/ui/arcade-ui';
import { hapticWin } from '@/features/arcade/lib/game-haptics';
import type { RewardGameType } from '@/features/arcade/lib/rewards';
import { playerItemName } from '@/features/arcade/lib/item-names';
import type { BattlepassState, QuestView, RewardView, TierView } from '@/server/arcade/battlepass';

import { QuestScreen, questWords } from './home-quests';

/** "Season 0 · Grand Opening" → "Season 0". */
const seasonShortName = (name: string) => name.split('·')[0]?.trim() || name;

/** A prize's name as players see it: lowercase, without season 0's "S0" tag. */
const prizeName = (name: string | undefined) => playerItemName(name ?? '').toLowerCase();

/** A prize drawn as itself: its art kit file or store preview, and its name. */
function Prize({ reward }: { reward: RewardView }) {
  if (reward.kind === 'tickets') {
    return (
      <ArcadeStub perf className='tx-sc-stub'>
        <Num value={reward.amount ?? 0} labelSuffix='tickets' />
      </ArcadeStub>
    );
  }
  return (
    <span className='tx-sc-item'>
      <span className='tx-sc-art' aria-hidden='true'>
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
      <span className='tx-sc-item-name'>{prizeName(reward.name)}</span>
    </span>
  );
}

const tierRewards = (tier: TierView) => [tier.free, ...(tier.premium ? [tier.premium] : [])];

/** What the waiting tiers pay between them. */
function waiting(state: BattlepassState) {
  let tickets = 0;
  let tiers = 0;
  const items: RewardView[] = [];
  for (const tier of state.tiers) {
    const tracks = claimableTracks(tier);
    if (tracks.length === 0) continue;
    tiers += 1;
    for (const track of tracks) {
      const reward = track === 'free' ? tier.free : tier.premium;
      if (!reward) continue;
      if (reward.kind === 'tickets') tickets += reward.amount ?? 0;
      else items.push(reward);
    }
  }
  return { tickets, tiers, items };
}

/** This week's quests: the season's card (its game quests), else a legacy season's week. */
function weekQuests(state: BattlepassState): { week: number; marks: QuestView[]; all: QuestView[] } | null {
  if (state.weeklyCard) {
    const all = state.weeklyCard.quests;
    const games = all.filter((quest) => quest.targetGame);
    return { week: state.weeklyCard.week, marks: (games.length > 0 ? games : all).slice(0, 3), all };
  }
  const all = state.weeklyQuests.filter((quest) => quest.week === state.currentWeek);
  if (all.length === 0) return null;
  return { week: state.currentWeek, marks: all.slice(0, 3), all };
}

function WeekMarks({ state, stills }: { state: BattlepassState; stills: Record<string, ReactNode> }) {
  const week = weekQuests(state);
  if (!week) return null;
  const done = week.all.filter((quest) => quest.complete).length;
  return (
    <Link href='/battlepass' className='tx-sc-week'>
      <ul className='tx-sc-marks'>
        {week.marks.map((quest) => {
          const shown = Math.min(quest.progress, quest.goal);
          return (
            <li key={quest.key} data-done={quest.complete || undefined} title={questWords(quest.label, quest.targetGame)}>
              <QuestScreen targetGame={quest.targetGame} kind={quest.kind} stills={stills} />
              {quest.complete ? (
                <span className='tx-sc-check' aria-hidden='true'>
                  <Check size={14} strokeWidth={3} strokeLinecap='square' />
                </span>
              ) : null}
              <span className='tx-sc-mark-bar' aria-hidden='true'>
                <i style={{ width: `${quest.goal > 0 ? Math.min(100, (shown / quest.goal) * 100) : 0}%` }} />
              </span>
              <span className='tx-sr'>
                {questWords(quest.label, quest.targetGame)}: {shown} of {quest.goal}.
              </span>
            </li>
          );
        })}
      </ul>
      <span className='tx-sc-week-line'>
        Week <Num value={week.week} />: <Num value={done} /> of <Num value={week.all.length} /> done.
      </span>
    </Link>
  );
}

export function HomeSeason({ stills }: { stills: Record<string, ReactNode> }) {
  const season = useSeason();
  const [open, setOpen] = useState(false);
  const [acted, setActed] = useState(false);
  // The controller is busy for any claim on the page; this card's button only
  // says so for its own.
  const [claiming, setClaiming] = useState(false);
  const stubRef = useRef<HTMLSpanElement>(null);
  const state = season?.state ?? null;

  // The big number punches when a tier is reached while the page is open.
  const tier = state?.tier ?? null;
  const lastTier = useRef<number | null>(null);
  const [punch, setPunch] = useState(0);
  useEffect(() => {
    if (tier == null) return;
    if (lastTier.current != null && tier > lastTier.current) setPunch((count) => count + 1);
    lastTier.current = tier;
  }, [tier]);

  if (!season) return null;
  if (!state) {
    return (
      <section className='tx-panel tx-sc' aria-labelledby='tx-sc' aria-busy={!season.failed}>
        <h2 id='tx-sc'>Season</h2>
        {season.failed ? <p className='tx-panel-note'>The season card is not loading right now.</p> : null}
      </section>
    );
  }

  const next = nextTier(state);
  const ready = waiting(state);
  const into = Math.min(state.bar.need, state.bar.into);
  const claim = () => {
    setActed(true);
    setClaiming(true);
    void season
      .claimTiers((tickets) => {
        hapticWin();
        return flyTickets({ from: stubRef.current ?? document.body, count: Math.min(5, Math.max(2, Math.round(tickets / 60))) });
      })
      .finally(() => setClaiming(false));
  };

  return (
    <section className='tx-panel tx-sc' aria-labelledby='tx-sc'>
      <h2>
        <span id='tx-sc'>{seasonShortName(state.seasonName)}</span>
        <button type='button' className='tx-sc-all' onClick={() => setOpen(true)} aria-haspopup='dialog'>
          all tiers
        </button>
      </h2>

      <div className='tx-sc-now'>
        <span key={punch} className='tx-sc-big' data-punch={punch > 0 || undefined}>
          <Num value={state.tier} label={`tier ${state.tier}`} />
        </span>
        <div className='tx-sc-meter'>
          <span className='tx-sc-of'>
            of <Num value={state.maxTier} /> tiers
          </span>
          <span
            className='tx-sc-bar'
            role='progressbar'
            aria-label={next ? `xp to tier ${next.tier}` : 'xp'}
            aria-valuemin={0}
            aria-valuemax={state.bar.need}
            aria-valuenow={into}
          >
            <i style={{ width: `${state.bar.need > 0 ? Math.min(100, (into / state.bar.need) * 100) : 100}%` }} />
          </span>
          {next ? (
            <span className='tx-sc-xp'>
              <Num value={xpToTier(state, next.tier)} /> xp to tier <Num value={next.tier} />.
            </span>
          ) : null}
        </div>
      </div>

      {ready.tiers > 0 ? (
        <div className='tx-sc-ready'>
          <span className='tx-sc-ready-pay'>
            {ready.tickets > 0 ? (
              <span ref={stubRef} className='tx-sc-ready-stub'>
                <ArcadeStub perf className='tx-sc-stub'>
                  <Num value={ready.tickets} labelSuffix='tickets' />
                </ArcadeStub>
              </span>
            ) : null}
            {/* A prize shows here only when no tickets are waiting: the strip is narrow. */}
            {(ready.tickets > 0 ? [] : ready.items.slice(0, 2)).map((item) => (
              <span key={item.itemId} className='tx-sc-art' title={prizeName(item.name)} aria-hidden='true'>
                {item.art ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={item.art} alt='' />
                ) : item.preview ? (
                  <StoreItemPreview
                    item={{
                      id: item.preview.id,
                      name: item.preview.name,
                      gameType: item.preview.gameType as RewardGameType,
                      slots: item.preview.slots,
                      assetRef: item.preview.assetRef,
                    }}
                    compact
                    forceSquare
                  />
                ) : null}
              </span>
            ))}
          </span>
          <span className='tx-sc-ready-line'>
            <Num value={ready.tiers} /> {ready.tiers === 1 ? 'tier' : 'tiers'} to claim.
          </span>
          <button type='button' className='tx-btn' data-size='sm' onClick={claim} disabled={season.busy}>
            {claiming ? 'claiming' : 'claim'}
          </button>
        </div>
      ) : null}

      {next ? (
        <div className='tx-sc-next'>
          <p>
            Tier <Num value={next.tier} /> pays
          </p>
          <div className='tx-sc-prizes'>
            {tierRewards(next).map((reward, index) => (
              <Prize key={index} reward={reward} />
            ))}
          </div>
        </div>
      ) : (
        <p className='tx-panel-note'>Every tier is open. More xp still counts toward your level.</p>
      )}

      <p className='tx-sc-status' role='status'>
        {acted ? (season.error ?? season.message ?? '') : ''}
      </p>

      <WeekMarks state={state} stills={stills} />

      <SeasonModal open={open} onClose={() => setOpen(false)} season={season} />
    </section>
  );
}
