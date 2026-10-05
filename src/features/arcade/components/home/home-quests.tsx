'use client';

/* Today's three quests, on the home: a card each, with the game's cabinet
   (its floor still), the task in plain words, the progress as numbers with a
   short bar, and what it pays. A finished quest is claimed where it stands:
   stubs fly from the card to the balance and the card settles. An open one
   can be rerolled, twice a day, from the small button in its corner. When
   all three are claimed the heading says when the next three come.

   Wide screens: three in a row under the table. Phones: a row you swipe.
   The numbers come from the same state as the season card and its modal, so
   a claim here moves the tier there. */

import Image from 'next/image';
import { Check, RefreshCw } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';

import { getArcadeGameBySlug } from '@/features/arcade/components/arcade-game-registry';
import { flyTickets } from '@/features/arcade/components/feedback/ticket-gain';
import { GameStill } from '@/features/arcade/components/game-previews/game-still';
import { hasGameStill } from '@/features/arcade/components/game-previews/still-slugs';
import { questKey, questClaimBody, useSeason } from '@/features/arcade/components/season/use-season';
import { ArcadeStub, Num } from '@/features/arcade/components/ui/arcade-ui';
import { getGameDisplayName } from '@/features/arcade/lib/game-renames';
import { hapticWin } from '@/features/arcade/lib/game-haptics';
import type { QuestView } from '@/server/arcade/battlepass';

/* ── a quest's cabinet ─────────────────────────────────────────────────── */

/** A game's name as the floor says it: lowercase. */
function floorWord(slug: string): string {
  if (slug === '8-ball') return '8-ball';
  const game = getArcadeGameBySlug(slug);
  return getGameDisplayName(slug, game?.title ?? slug).toLowerCase();
}

/** The task in plain words: no "Week 1 ·" prefix, game names lowercase. */
export function questWords(label: string, targetGame: string | null): string {
  let words = label.replace(/^(week \d+|season)\s*·\s*/i, '');
  if (targetGame) {
    const game = getArcadeGameBySlug(targetGame);
    const names = new Set(
      [game?.title, getGameDisplayName(targetGame, game?.title ?? targetGame), targetGame.replace(/-/g, ' ')].filter(
        Boolean,
      ) as string[],
    );
    // Longest first, so "Tin Duck Gallery" goes before "Tin Duck".
    for (const name of [...names].sort((a, b) => b.length - a.length)) {
      const at = words.toLowerCase().lastIndexOf(name.toLowerCase());
      if (at >= 0) {
        words = `${words.slice(0, at)}${floorWord(targetGame)}${words.slice(at + name.length)}`;
        break;
      }
    }
  }
  return words;
}

/* Quests on no one game get a screen of their own, drawn on the same 160 x
   100 kit grid as the stills: a play mark for "play", a stub for "earn". */
function GenericScreen({ kind }: { kind: string }) {
  const earn = kind === 'earn_tickets';
  return (
    <svg viewBox='0 0 160 100' preserveAspectRatio='xMidYMid slice' aria-hidden='true' data-game-screen=''>
      <rect width='160' height='100' style={{ fill: 'var(--tixy-screen, #2a231d)' }} />
      {earn ? (
        <g transform='translate(52 32)'>
          <path
            d='M6 0h44a6 6 0 0 0 6 6v8a6 6 0 0 1 0 12v8a6 6 0 0 0-6 6H6a6 6 0 0 0-6-6V26a6 6 0 0 1 0-12V6a6 6 0 0 0 6-6z'
            fill='#f2a33c'
          />
          <path d='M42 8v24' stroke='#1f1a16' strokeWidth='2' strokeDasharray='3 3' />
          <circle cx='17' cy='17' r='2.5' fill='#1f1a16' />
          <circle cx='29' cy='17' r='2.5' fill='#1f1a16' />
          <path d='M16 24q7 5 14 0' stroke='#1f1a16' strokeWidth='2.5' fill='none' strokeLinecap='round' />
        </g>
      ) : (
        <g>
          {[0, 1, 2].map((i) => (
            <rect key={i} x={46 + i * 26} y='34' width='18' height='32' rx='4' fill='rgb(244 235 220 / 0.14)' />
          ))}
          <path d='M70 36l22 14-22 14z' fill='#f4ebdc' />
        </g>
      )}
    </svg>
  );
}

/* A game with no kit screen (one that left the floor) shows its poster, the
   same as the reserve on the floor, and the plain play screen if it has none. */
function Poster({ slug, kind }: { slug: string; kind: string }) {
  const [missing, setMissing] = useState(false);
  if (missing) return <GenericScreen kind={kind} />;
  return (
    <Image
      src={`/games/${slug}/poster.webp`}
      alt=''
      width={160}
      height={100}
      loading='lazy'
      quality={72}
      sizes='80px'
      onError={() => setMissing(true)}
    />
  );
}

/** A small ink cabinet with a quest's game on its screen. */
export function QuestScreen({
  targetGame,
  kind,
  stills,
}: {
  targetGame: string | null;
  kind: string;
  stills: Record<string, ReactNode>;
}) {
  let screen: ReactNode;
  if (!targetGame) screen = <GenericScreen kind={kind} />;
  else if (stills[targetGame]) screen = stills[targetGame];
  else if (hasGameStill(targetGame)) screen = <GameStill slug={targetGame} />;
  else screen = <Poster slug={targetGame} kind={kind} />;
  return (
    <span className='tx-screen tx-q-screen' aria-hidden='true'>
      {screen}
    </span>
  );
}

/* ── one quest ─────────────────────────────────────────────────────────── */

type QuestCardProps = {
  quest: QuestView;
  /** A quest that arrived by reroll comes in on one axis. */
  arrived: boolean;
  stills: Record<string, ReactNode>;
  fresh: boolean;
  busy: boolean;
  canReroll: boolean;
  onClaim: (from: Element | null) => void;
  onReroll: () => void;
};

function QuestCard({ quest, arrived, stills, fresh, busy, canReroll, onClaim, onReroll }: QuestCardProps) {
  const stubRef = useRef<HTMLSpanElement>(null);
  // The game left the floor: the quest is already complete and says why.
  const offFloor = quest.offFloor && !quest.claimed;
  const shown = Math.min(quest.progress, quest.goal);
  const ready = quest.complete && !quest.claimed;
  const words = questWords(quest.label, quest.targetGame);
  const state = quest.claimed ? 'claimed' : ready ? 'ready' : 'open';

  return (
    <li className='tx-q' data-state={state} data-fresh={fresh || undefined} data-arrived={arrived || undefined}>
      <div className='tx-q-top'>
        <QuestScreen targetGame={quest.targetGame} kind={quest.kind} stills={stills} />
        <p className='tx-q-words'>{words}</p>
        {state === 'open' && canReroll ? (
          <button
            type='button'
            className='tx-q-reroll'
            onClick={onReroll}
            disabled={busy}
            aria-label={`reroll: ${words}`}
            title='reroll'
          >
            <RefreshCw size={16} strokeWidth={2} strokeLinecap='square' aria-hidden />
          </button>
        ) : null}
      </div>
      {offFloor ? (
        <p className='tx-q-note'>This game left the floor. Claim your reward.</p>
      ) : (
        <div className='tx-q-prog'>
          <span className='tx-q-count'>
            <Num value={shown} className='tx-num' />
            <span>
              {' '}
              of <Num value={quest.goal} />
            </span>
          </span>
          <span
            className='tx-q-bar'
            role='progressbar'
            aria-label={words}
            aria-valuemin={0}
            aria-valuemax={quest.goal}
            aria-valuenow={shown}
          >
            <i style={{ width: `${quest.goal > 0 ? Math.min(100, (shown / quest.goal) * 100) : 0}%` }} />
          </span>
        </div>
      )}
      <div className='tx-q-foot'>
        <span className='tx-q-pay'>
          {quest.rewardTickets > 0 ? (
            <span ref={stubRef} className='tx-q-stub'>
              <ArcadeStub size='sm' muted={quest.claimed}>
                <Num value={quest.rewardTickets} labelSuffix='tickets' />
              </ArcadeStub>
            </span>
          ) : null}
          <span className='tx-q-xp'>
            <Num value={quest.rewardXp} /> xp
          </span>
        </span>
        {quest.claimed ? (
          <span className='tx-q-done'>
            <Check size={16} strokeWidth={2.5} strokeLinecap='square' aria-hidden /> claimed
          </span>
        ) : ready ? (
          <button type='button' className='tx-btn' data-size='sm' onClick={() => onClaim(stubRef.current)} disabled={busy}>
            claim
          </button>
        ) : null}
      </div>
    </li>
  );
}

/* ── the three ─────────────────────────────────────────────────────────── */

/** "in 5 hours", "in 40 minutes", for when the next three come. */
function untilWords(ms: number): string {
  const minutes = Math.max(1, Math.round(ms / 60_000));
  if (minutes < 60) return `in ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`;
  const hours = Math.round(minutes / 60);
  return `in ${hours} ${hours === 1 ? 'hour' : 'hours'}`;
}

function NextThree({ at }: { at: number | null }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  if (at == null || now == null || at <= now) return <>Done for today. The next three come tomorrow.</>;
  const clock = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(at);
  return (
    <>
      Done for today. The next three come at {clock}, {untilWords(at - now)}.
    </>
  );
}

export function HomeQuests({
  stills,
  turnAtMs,
}: {
  stills: Record<string, ReactNode>;
  /** When today's quests turn over. */
  turnAtMs: number | null;
}) {
  const season = useSeason();
  const state = season?.state ?? null;
  // The season card shares this state; an error shows where it was caused.
  const [acted, setActed] = useState(false);
  // The quests the page opened with. Any other is a reroll.
  const seen = useRef<Set<string> | null>(null);
  if (state && !seen.current) seen.current = new Set(state.quests.map((quest) => `${quest.slotIndex}:${quest.key}`));

  if (!season || (!state && !season.failed)) {
    return (
      <section className='tx-quests' aria-labelledby='tx-quests' aria-busy='true'>
        <div className='tx-quests-head'>
          <h2 id='tx-quests'>today&rsquo;s quests</h2>
        </div>
        <ul className='tx-qs' aria-hidden='true'>
          {[0, 1, 2].map((slot) => (
            <li key={slot} className='tx-q' data-state='hold' />
          ))}
        </ul>
      </section>
    );
  }
  if (!state) {
    return (
      <section className='tx-quests' aria-labelledby='tx-quests'>
        <div className='tx-quests-head'>
          <h2 id='tx-quests'>today&rsquo;s quests</h2>
        </div>
        <p className='tx-quests-line'>Quests are not loading right now.</p>
      </section>
    );
  }

  const done = state.quests.length > 0 && state.quests.every((quest) => quest.claimed);
  const land = (from: Element | null) => (tickets: number) => {
    hapticWin();
    if (!from) return Promise.resolve();
    return flyTickets({ from, count: Math.min(5, Math.max(2, Math.round(tickets / 25))) });
  };

  return (
    <section className='tx-quests' aria-labelledby='tx-quests'>
      <div className='tx-quests-head'>
        <h2 id='tx-quests'>today&rsquo;s quests</h2>
        <p aria-live='polite'>
          {done ? (
            <NextThree at={turnAtMs} />
          ) : (
            <>
              <Num value={state.rerollsLeft} /> {state.rerollsLeft === 1 ? 'reroll' : 'rerolls'} left
            </>
          )}
        </p>
      </div>
      <ul className='tx-qs'>
        {state.quests.map((quest) => (
          <QuestCard
            // A reroll is a new quest in the slot: the card comes in fresh.
            key={`${quest.slotIndex}:${quest.key}`}
            quest={quest}
            arrived={!seen.current?.has(`${quest.slotIndex}:${quest.key}`)}
            stills={stills}
            fresh={season.fresh === questKey.daily(quest.slotIndex)}
            busy={season.busy}
            canReroll={state.rerollsLeft > 0}
            onClaim={(from) => {
              setActed(true);
              void season.claimQuest(questClaimBody('daily', quest.slotIndex), questKey.daily(quest.slotIndex), land(from));
            }}
            onReroll={() => {
              setActed(true);
              void season.reroll(quest.slotIndex);
            }}
          />
        ))}
      </ul>
      {acted && season.error ? (
        <p role='alert' className='tx-quests-line' data-error='true'>
          {season.error}
        </p>
      ) : null}
    </section>
  );
}
