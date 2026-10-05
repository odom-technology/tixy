'use client';

/* One quest on the season page, drawn like a stop on the track: a card on the
   panel with the game's cabinet, the task in plain words, the progress as
   numbers over a bar in the rail's style, and what it pays. A finished quest
   is claimed on its card and its stubs fly to the balance; a claimed one
   drops into the panel. A daily can be rerolled from its corner. */

import { Check, RefreshCw } from 'lucide-react';
import { useRef } from 'react';

import { flyTickets } from '@/features/arcade/components/feedback/ticket-gain';
import { QuestScreen, questWords } from '@/features/arcade/components/home/home-quests';
import { ArcadeButton, ArcadeStub, Num } from '@/features/arcade/components/ui/arcade-ui';
import { hapticWin } from '@/features/arcade/lib/game-haptics';

import type { Landing } from './use-season';

import './season.css';
import './quest-card.css';

/* No server stills on this page: a quest's cabinet shows the kit still or
   the game's poster. */
const NO_STILLS = {};

/** Stubs from an element to the balance, scaled to the pay. */
export const landFrom =
  (from: Element | null): Landing =>
  (tickets) => {
    hapticWin();
    if (!from) return Promise.resolve();
    return flyTickets({ from, count: Math.min(5, Math.max(2, Math.round(tickets / 25))) });
  };

export type QuestCardProps = {
  label: string;
  targetGame: string | null;
  kind: string;
  progress: number;
  goal: number;
  rewardXp: number;
  rewardTickets: number;
  claimed: boolean;
  complete: boolean;
  /** The game left the floor: the quest is complete and says why. */
  offFloor?: boolean;
  /** Set for a moment after this card is claimed. */
  fresh?: boolean;
  busy: boolean;
  onClaim: (land: Landing) => void;
  /** Dailies only. */
  onReroll?: () => void;
  rerollDisabled?: boolean;
};

export function QuestCard({
  label,
  targetGame,
  kind,
  progress,
  goal,
  rewardXp,
  rewardTickets,
  claimed,
  complete,
  offFloor = false,
  fresh = false,
  busy,
  onClaim,
  onReroll,
  rerollDisabled = false,
}: QuestCardProps) {
  const stubRef = useRef<HTMLSpanElement>(null);
  const shown = Math.min(progress, goal);
  const ready = complete && !claimed;
  const state = claimed ? 'claimed' : ready ? 'ready' : 'open';
  const words = questWords(label, targetGame);

  return (
    <li className='sk' data-state={state} data-fresh={fresh || undefined}>
      <div className='sk-top'>
        <QuestScreen targetGame={targetGame} kind={kind} stills={NO_STILLS} />
        <p className='sk-words'>{words}</p>
        {state === 'open' && onReroll && !rerollDisabled ? (
          <button
            type='button'
            className='sk-reroll'
            onClick={onReroll}
            disabled={busy}
            aria-label={`reroll: ${words}`}
            title='reroll'
          >
            <RefreshCw size={16} strokeWidth={2} strokeLinecap='square' aria-hidden />
          </button>
        ) : null}
      </div>

      {offFloor && !claimed ? (
        <p className='sk-note'>This game left the floor. Claim your reward.</p>
      ) : (
        <div className='sk-prog'>
          <span className='sk-count'>
            <Num value={shown} /> of <Num value={goal} />
          </span>
          <span
            className='sk-bar'
            role='progressbar'
            aria-label={words}
            aria-valuemin={0}
            aria-valuemax={goal}
            aria-valuenow={shown}
          >
            <i style={{ transform: `scaleX(${goal > 0 ? Math.min(1, shown / goal) : 0})` }} />
          </span>
        </div>
      )}

      <div className='sk-foot'>
        <span className='sk-pay'>
          {rewardTickets > 0 ? (
            <span ref={stubRef} className='sk-stub'>
              <ArcadeStub size='sm' muted={claimed}>
                <Num value={rewardTickets} labelSuffix='tickets' />
              </ArcadeStub>
            </span>
          ) : null}
          <span className='sk-xp'>
            <Num value={rewardXp} /> xp
          </span>
        </span>
        {claimed ? (
          <span className='sk-done'>
            <Check size={14} strokeLinecap='square' aria-hidden /> claimed
          </span>
        ) : ready ? (
          <ArcadeButton size='sm' tone='primary' onClick={() => onClaim(landFrom(stubRef.current))} disabled={busy}>
            claim
          </ArcadeButton>
        ) : null}
      </div>
    </li>
  );
}
