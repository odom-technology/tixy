'use client';

/* The season page. The same card as the home's modal, laid out whole: the
   head with the tier, what the next one pays and the track of every tier,
   then the week's card and today's quests as cards in the track's style. A
   legacy season keeps its fixed weeks and season quests, drawn the same way;
   the live season has the card and none of them. */

import type { ReactNode } from 'react';

import { QuestCard } from '@/features/arcade/components/season/quest-card';
import { nextTier, xpToTier } from '@/features/arcade/components/season/season-model';
import { SeasonTrack } from '@/features/arcade/components/season/season-track';
import { TierPay } from '@/features/arcade/components/season/tier-pay';
import {
  claimableTracks,
  questClaimBody,
  questKey,
  readyQuestClaims,
  useSeasonController,
} from '@/features/arcade/components/season/use-season';
import { ArcadeButton, Num } from '@/features/arcade/components/ui/arcade-ui';
import type { BattlepassState, WeeklyQuestView } from '@/server/arcade/battlepass';

import '@/features/arcade/components/season/season.css';
import './_season-card.css';

const fmtDate = (ms: number) =>
  new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(ms)).toLowerCase();

function QuestPanel({
  title,
  meta,
  children,
}: {
  title: string;
  meta?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className='sq-panel' aria-label={title}>
      <h2>
        {title}
        {meta ? <small>{meta}</small> : null}
      </h2>
      <ul className='sk-grid'>{children}</ul>
    </section>
  );
}

export function BattlepassClient({ initialState }: { initialState: BattlepassState }) {
  const season = useSeasonController(initialState, false);
  const state = season.state ?? initialState;

  const next = nextTier(state);
  const readyCount = readyQuestClaims(state).length + state.tiers.filter((t) => claimableTracks(t).length > 0).length;
  const card = state.weeklyCard;

  const dailyRow = (quest: BattlepassState['quests'][number]) => (
    <QuestCard
      key={quest.slotIndex}
      label={quest.label}
      targetGame={quest.targetGame}
      kind={quest.kind}
      progress={quest.progress}
      goal={quest.goal}
      rewardXp={quest.rewardXp}
      rewardTickets={quest.rewardTickets}
      claimed={quest.claimed}
      offFloor={quest.offFloor}
      complete={quest.complete}
      fresh={season.fresh === questKey.daily(quest.slotIndex)}
      busy={season.busy}
      onClaim={(land) => void season.claimQuest(questClaimBody('daily', quest.slotIndex), questKey.daily(quest.slotIndex), land)}
      onReroll={() => void season.reroll(quest.slotIndex)}
      rerollDisabled={state.rerollsLeft <= 0}
    />
  );

  const cardRow = (quest: WeeklyQuestView) => (
    <QuestCard
      key={`${quest.week}:${quest.slotIndex}`}
      label={quest.label}
      targetGame={quest.targetGame}
      kind={quest.kind}
      progress={quest.progress}
      goal={quest.goal}
      rewardXp={quest.rewardXp}
      rewardTickets={quest.rewardTickets}
      claimed={quest.claimed}
      offFloor={quest.offFloor}
      complete={quest.complete}
      fresh={season.fresh === questKey.card(quest.week, quest.slotIndex)}
      busy={season.busy}
      onClaim={(land) =>
        void season.claimQuest(
          questClaimBody('card', quest.slotIndex, quest.week),
          questKey.card(quest.week, quest.slotIndex),
          land,
        )
      }
    />
  );

  const oldWeekRow = (quest: WeeklyQuestView) => (
    <QuestCard
      key={`${quest.week}:${quest.slotIndex}`}
      label={quest.label}
      targetGame={quest.targetGame}
      kind={quest.kind}
      progress={quest.progress}
      goal={quest.goal}
      rewardXp={quest.rewardXp}
      rewardTickets={quest.rewardTickets}
      claimed={quest.claimed}
      offFloor={quest.offFloor}
      complete={quest.complete}
      fresh={season.fresh === questKey.weekly(quest.week, quest.slotIndex)}
      busy={season.busy}
      onClaim={(land) =>
        void season.claimQuest(
          questClaimBody('weekly', quest.slotIndex, quest.week),
          questKey.weekly(quest.week, quest.slotIndex),
          land,
        )
      }
    />
  );

  // A legacy season's weeks, newest first, each as its own list.
  const weekNumbers = [...new Set(state.weeklyQuests.map((q) => q.week))].sort((a, b) => b - a);

  return (
    <div className='sc-page'>
      <section className='sc-head' aria-label='season progress'>
        <div className='sc-tier'>
          <span className='sc-tier-num'>
            <Num value={state.tier} label={`tier ${state.tier}`} />
          </span>
          <span className='sc-tier-of'>
            of <Num value={state.maxTier} /> tiers
          </span>
        </div>
        <div className='sc-xp'>
          {next ? (
            <div className='sc-next' aria-live='polite'>
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
            <p className='sc-sub'>
              Every tier is open at <Num value={state.xp} /> xp. More xp still counts toward your level.
            </p>
          )}
        </div>
        <div className='sc-collect'>
          {readyCount > 0 ? (
            <ArcadeButton size='md' tone='primary' onClick={() => void season.claimAll()} disabled={season.busy}>
              {season.busy ? 'claiming' : 'claim all'}
            </ArcadeButton>
          ) : null}
        </div>
        <p className='sc-status' role='status' data-error={season.error ? true : undefined}>
          {season.error ?? season.message ?? ''}
        </p>
        <div className='sc-track'>
          <SeasonTrack state={state} season={season} />
        </div>
      </section>

      {card ? (
        <QuestPanel
          title='this week'
          meta={
            <>
              week <Num value={card.week} /> of <Num value={card.totalWeeks} />, ends {fmtDate(card.endsAtMs)}
            </>
          }
        >
          {card.quests.map(cardRow)}
        </QuestPanel>
      ) : null}

      {card && card.carryover.length > 0 ? (
        <QuestPanel title='earlier weeks'>{card.carryover.map(cardRow)}</QuestPanel>
      ) : null}

      <QuestPanel
        title='today'
        meta={
          <>
            <Num value={state.rerollsLeft} /> {state.rerollsLeft === 1 ? 'reroll' : 'rerolls'} left
          </>
        }
      >
        {state.quests.map(dailyRow)}
      </QuestPanel>

      {weekNumbers.map((week) => (
        <QuestPanel key={week} title={`week ${week}`}>
          {state.weeklyQuests.filter((q) => q.week === week).map(oldWeekRow)}
        </QuestPanel>
      ))}

      {state.seasonQuests.length > 0 ? (
        <QuestPanel title='season quests'>
          {state.seasonQuests.map((quest) => (
            <QuestCard
              key={quest.slotIndex}
              label={quest.label}
              targetGame={quest.targetGame}
              kind={quest.kind}
              progress={quest.progress}
              goal={quest.goal}
              rewardXp={quest.rewardXp}
              rewardTickets={quest.rewardTickets}
              claimed={quest.claimed}
              offFloor={quest.offFloor}
              complete={quest.progress >= quest.goal}
              fresh={season.fresh === questKey.season(quest.slotIndex)}
              busy={season.busy}
              onClaim={(land) =>
                void season.claimQuest(questClaimBody('season', quest.slotIndex), questKey.season(quest.slotIndex), land)
              }
            />
          ))}
        </QuestPanel>
      ) : null}
    </div>
  );
}
