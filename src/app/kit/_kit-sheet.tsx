'use client';

import { Search } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';

import { AchievementIcon } from '@/features/arcade/components/achievements/achievement-icon';
import { notifyAchievements } from '@/features/arcade/components/achievements/achievement-toaster';
import { DailyCapNotice } from '@/features/arcade/components/feedback/daily-cap-notice';
import {
  TICKET_BALANCE_ATTR,
  TicketCountUp,
  flyTickets,
} from '@/features/arcade/components/feedback/ticket-gain';
import {
  ArcadeCountdown,
  ArcadeGameHud,
  ArcadeGameplayCallouts,
  type ArcadeGameplayCallout,
} from '@/features/arcade/components/gameplay/arcade-game-hud';
import { ArcadeEmpty, ArcadeLoading, ArcadeLoadingDots } from '@/features/arcade/components/ui/arcade-states';
import { ArcadeToast } from '@/features/arcade/components/ui/arcade-toast';
import { Num } from '@/features/arcade/components/ui/num';
import { useGameplayCallouts, useNewBestMoment } from '@/features/arcade/lib/use-gameplay-callouts';
import { GameStageNotice } from '@/features/arcade/components/shell/game-shell';
import { ArcadeModal, ArcadeSwitch } from '@/features/arcade/components/ui/arcade-interactive';
import { ArcadeDialog } from '@/features/arcade/components/ui/arcade-sheet';
import {
  ArcadeButton,
  ArcadeChip,
  ArcadeField,
  ArcadeInput,
  ArcadeMarquee,
  ArcadeNotice,
  ArcadePanel,
  ArcadeProgress,
  ArcadeSegmented,
  ArcadeStat,
  ArcadeStub,
} from '@/features/arcade/components/ui/arcade-ui';
import { LevelUpMark, XpGainBurst, XpLine } from '@/features/arcade/components/xp-gain-burst';
import { LevelBadge } from '@/features/brand/avatars/level-badge';
import type { AccountXpReward } from '@/server/arcade/rewards/types';

import '@/features/arcade/components/shell/game-shell.css';
import './kit.css';

const TIER = { name: 'bronze', color: '#f2a33c', icon: '' };
const XP_GAIN: AccountXpReward = { xpGained: 120, xp: 4320, level: 12, into: 320, need: 900, leveledUp: false, tier: TIER };
const XP_LEVEL: AccountXpReward = { xpGained: 260, xp: 5000, level: 13, into: 80, need: 950, leveledUp: true, bonusTickets: 50, tier: TIER };

const CALLOUTS: ArcadeGameplayCallout[] = [
  { id: 1, label: '+40', tone: 'score', x: 18, y: 56 },
  { id: 2, label: 'combo', value: 4, tone: 'combo', x: 50, y: 56 },
  { id: 3, label: 'streak 5', tone: 'success', x: 82, y: 56 },
  { id: 4, label: 'level 3', detail: 'faster', tone: 'neutral', x: 18, y: 78 },
  { id: 5, label: 'last life', tone: 'danger', x: 50, y: 78 },
  { id: 6, label: 'time short', detail: '10 seconds', tone: 'warning', x: 82, y: 78 },
];
const BEST: ArcadeGameplayCallout[] = [{ id: 7, label: 'new best', value: 1280, tone: 'best', x: 50, y: 16 }];
const still = (items: ArcadeGameplayCallout[]) => items.map((item) => ({ ...item, duration: 1200 }));

function Section({ id, title, note, children }: { id: string; title: string; note?: string; children: ReactNode }) {
  return (
    <section id={id} className='kit-section'>
      <h2>{title}</h2>
      {note ? <p className='kit-note'>{note}</p> : null}
      <div className='kit-body'>{children}</div>
    </section>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className='kit-row'>
      <span className='kit-row-label'>{label}</span>
      <div className='kit-row-items'>{children}</div>
    </div>
  );
}

function Stage({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={['kit-stage', className].filter(Boolean).join(' ')} data-surface='ink'>
      {children}
    </div>
  );
}

export function KitSheet() {
  const [open, setOpen] = useState<null | 'modal' | 'dialog'>(null);
  const [tab, setTab] = useState('today');
  const [on, setOn] = useState(true);
  const [replay, setReplay] = useState(0);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const want = params.get('open');
    if (want === 'modal' || want === 'dialog') setOpen(want);
    // The toaster mounts with the app shell; give it a beat to listen.
    if (want === 'toast') window.setTimeout(fireToast, 400);
  }, []);

  return (
    <main className='kit-sheet'>
      <header className='kit-head'>
        <h1>the kit</h1>
        <p>Every piece the games and pages share, in its states.</p>
      </header>

      <Section id='callouts' title='in-game callouts' note='Frozen part way in. Replay runs them live.'>
        <Stage className='kit-still kit-stage-tall'>
          <ArcadeGameplayCallouts items={still([...CALLOUTS, ...BEST])} />
        </Stage>
        <Stage key={replay}>
          <ArcadeGameplayCallouts items={CALLOUTS} />
        </Stage>
        <ArcadeButton size='sm' onClick={() => setReplay((n) => n + 1)}>replay</ArcadeButton>
      </Section>

      <Section id='new-best' title='a new best' note='Once a run, with one sound. In the game shell it lands in the strip above the stage.'>
        <NewBestDemo />
      </Section>

      <Section id='countdown' title='countdown'>
        <div className='kit-grid'>
          {([3, 2, 1, 'go'] as const).map((value) => (
            <Stage key={value} className='kit-stage-count kit-still-count'>
              <ArcadeCountdown value={value} />
            </Stage>
          ))}
        </div>
      </Section>

      <Section id='hud' title='hud'>
        <Stage className='kit-stage-short'>
          <ArcadeGameHud
            metrics={[
              { label: 'score', value: '1,280' },
              { label: 'lives', value: 1, tone: 'danger' },
              { label: 'tickets', value: 40, tone: 'tickets' },
            ]}
            status={{ label: 'your turn', tone: 'danger' }}
          />
        </Stage>
        <ArcadeGameHud
          metrics={[
            { label: 'score', value: '1,280', emphasis: true },
            { label: 'level', value: 3 },
          ]}
          status={{ label: 'waiting' }}
        />
      </Section>

      <Section id='xp' title='xp and level up'>
        <div className='kit-grid'>
          <XpGainBurst key={`a${replay}`} account={XP_GAIN} />
          <XpGainBurst key={`b${replay}`} account={XP_LEVEL} />
          <Stage className='kit-stage-pad'>
            <XpLine key={`c${replay}`} xpGained={60} level={4} into={240} need={600} />
          </Stage>
        </div>
        <Row label='level mark'>
          <LevelUpMark level={13} play={false} />
        </Row>
        <Row label='level badges'>
          {[6, 24, 45, 63, 88, 112].map((level) => (
            <LevelBadge key={level} level={level} size={64} title={`Level ${level}`} />
          ))}
        </Row>
        <ArcadeButton size='sm' onClick={() => setReplay((n) => n + 1)}>replay</ArcadeButton>
      </Section>

      <Section id='tickets' title='tickets arriving'>
        <TicketDemo />
      </Section>

      <Section id='cap' title='the daily cap'>
        <div className='kit-stack'>
          <DailyCapNotice wanted={50} awarded={20} cap={300} />
          <DailyCapNotice wanted={40} awarded={0} />
        </div>
      </Section>

      <Section id='toast' title='toasts'>
        <div className='kit-grid'>
          <ArcadeToast
            icon={<AchievementIcon src='badge:snake:2' alt='' size={52} />}
            title='long snake'
            meta={<><Num value={150} signed /> xp</>}
            onDismiss={() => undefined}
          >
            Reach a length of 40 in one run.
          </ArcadeToast>
          <ArcadeToast title='maple wants a rematch' onDismiss={() => undefined}>
            Chess, 5 minutes a side.
          </ArcadeToast>
        </div>
        <ArcadeButton size='sm' onClick={fireToast}>show a toast</ArcadeButton>
      </Section>

      <Section id='notices' title='notices and errors'>
        <div className='kit-stack'>
          <ArcadeNotice>Your run saves when you sign in.</ArcadeNotice>
          <ArcadeNotice tone='tickets'>You have 40 tickets to spend.</ArcadeNotice>
          <ArcadeNotice tone='success'>Saved.</ArcadeNotice>
          <ArcadeNotice tone='danger'>The game could not reach the server.</ArcadeNotice>
        </div>
        <Stage className='kit-stage-notice'>
          <GameStageNotice
            title='Connection lost'
            action={<ArcadeButton tone='primary'>retry</ArcadeButton>}
          >
            <p>The game could not reach the server.</p>
          </GameStageNotice>
        </Stage>
      </Section>

      <Section id='loading' title='loading and starting'>
        <Stage className='kit-stage-short'>
          <p className='arc-shell-hint' data-surface='ink' data-busy=''>
            <span className='arc-shell-busy'>
              <ArcadeLoadingDots />
              Starting your run.
            </span>
          </p>
        </Stage>
        <Row label='on paper'>
          <ArcadeLoading label='Loading the table.' />
          <ArcadeLoading size='sm' />
        </Row>
      </Section>

      <Section id='empty' title='empty'>
        <div className='kit-grid'>
          <ArcadeEmpty title='no friends yet' action={<ArcadeButton tone='primary' size='sm'>find players</ArcadeButton>}>
            Add a player and their games show up here.
          </ArcadeEmpty>
          <ArcadeEmpty host={false}>No games this week.</ArcadeEmpty>
        </div>
      </Section>

      <Section id='buttons' title='buttons'>
        {(['primary', 'default', 'tickets', 'danger', 'ghost'] as const).map((tone) => (
          <Row key={tone} label={tone}>
            <ArcadeButton tone={tone} size='lg'>rematch</ArcadeButton>
            <ArcadeButton tone={tone}>play</ArcadeButton>
            <ArcadeButton tone={tone} size='sm'>claim</ArcadeButton>
            <ArcadeButton tone={tone} size='xs'>join</ArcadeButton>
            <ArcadeButton tone={tone} disabled>play</ArcadeButton>
          </Row>
        ))}
        <Stage className='kit-stage-row'>
          <ArcadeButton tone='primary'>rematch</ArcadeButton>
          <ArcadeButton>lobby</ArcadeButton>
          <ArcadeButton tone='tickets'>claim</ArcadeButton>
        </Stage>
      </Section>

      <Section id='toggles' title='toggles and tabs'>
        <Row label='switch'>
          <ArcadeSwitch checked={on} onChange={setOn} label='sound' />
          <ArcadeSwitch checked={false} label='off' />
          <ArcadeSwitch checked disabled label='disabled' />
        </Row>
        <Row label='tabs'>
          <ArcadeSegmented
            ariaLabel='range'
            value={tab}
            onChange={setTab}
            items={[
              { value: 'today', label: 'today' },
              { value: 'week', label: 'week' },
              { value: 'all', label: 'all time' },
            ]}
          />
        </Row>
        <Row label='tags'>
          <ArcadeChip>chess</ArcadeChip>
          <ArcadeChip tone='primary'>live</ArcadeChip>
          <ArcadeChip tone='tickets'>40</ArcadeChip>
          <ArcadeChip tone='danger'>banned</ArcadeChip>
        </Row>
      </Section>

      <Section id='inputs' title='inputs'>
        <div className='kit-grid'>
          <ArcadeField label='name' hint='What other players see.'>
            <ArcadeInput placeholder='your name' defaultValue='maple' />
          </ArcadeField>
          <ArcadeField label='search'>
            <ArcadeInput icon={<Search size={16} aria-hidden />} placeholder='find a player' />
          </ArcadeField>
          <ArcadeField label='code' error='That code is not a table.'>
            <ArcadeInput invalid defaultValue='ABC12' mono />
          </ArcadeField>
          <ArcadeField label='disabled'>
            <ArcadeInput disabled defaultValue='locked' />
          </ArcadeField>
        </div>
      </Section>

      <Section id='panels' title='panels, stats and progress'>
        <div className='kit-grid'>
          <ArcadePanel className='p-4'>
            <ArcadeProgress label='daily tickets' current={180} max={300} />
          </ArcadePanel>
          <ArcadePanel variant='raised' className='p-4'>
            <ArcadeStat label='best' value='1,280' />
          </ArcadePanel>
          <ArcadePanel variant='cabinet' className='overflow-hidden p-0'>
            <ArcadeMarquee>your games</ArcadeMarquee>
            <div className='p-4 text-sm'>A panel with a heading.</div>
          </ArcadePanel>
        </div>
      </Section>

      <Section id='dialogs' title='sheets and dialogs'>
        <Row label='open'>
          <ArcadeButton onClick={() => setOpen('modal')}>modal</ArcadeButton>
          <ArcadeButton onClick={() => setOpen('dialog')}>dialog</ArcadeButton>
        </Row>
      </Section>

      <ArcadeModal
        open={open === 'modal'}
        onClose={() => setOpen(null)}
        title='leave the table'
        actions={
          <>
            <ArcadeButton onClick={() => setOpen(null)}>stay</ArcadeButton>
            <ArcadeButton tone='danger' onClick={() => setOpen(null)}>leave</ArcadeButton>
          </>
        }
      >
        <p>You lose this game if you leave now.</p>
      </ArcadeModal>
      <ArcadeDialog open={open === 'dialog'} onClose={() => setOpen(null)} title='how to play snake'>
        <p>Turn with the arrow keys or a swipe.</p>
        <p>Eat to grow. Hit a wall or yourself and the run ends.</p>
        <p>A score of 100 pays 1 ticket.</p>
      </ArcadeDialog>
    </main>
  );
}

function NewBestDemo() {
  const { items, push, clear } = useGameplayCallouts();
  const { check, reset } = useNewBestMoment(push, { unit: 'points' });
  const [score, setScore] = useState(1240);
  const best = 1260;
  return (
    <>
      <Stage className='kit-stage-best'>
        <div className='kit-fake-play'>
          <Num value={score} />
          <span>best <Num value={best} /></span>
        </div>
        <ArcadeGameplayCallouts items={items} />
      </Stage>
      <div className='kit-row-items'>
        <ArcadeButton
          size='sm'
          tone='primary'
          onClick={() => {
            const next = score + 20;
            setScore(next);
            check(next, best);
          }}
        >
          +20
        </ArcadeButton>
        <ArcadeButton
          size='sm'
          onClick={() => {
            reset();
            clear();
            setScore(1240);
          }}
        >
          again
        </ArcadeButton>
      </div>
    </>
  );
}

function TicketDemo() {
  const [run, setRun] = useState(0);
  const [balance, setBalance] = useState(280);
  const fromRef = useRef<HTMLDivElement>(null);
  return (
    <>
      <div className='kit-tickets'>
        <div ref={fromRef} className='kit-tickets-from'>
          <TicketCountUp key={run} value={50} size='lg' play={run > 0} />
        </div>
        <span className='kit-tickets-balance' {...{ [TICKET_BALANCE_ATTR]: '' }}>
          <ArcadeStub>
            <Num value={balance} />
          </ArcadeStub>
        </span>
      </div>
      <ArcadeButton
        size='sm'
        tone='tickets'
        onClick={() => {
          setRun((n) => n + 1);
          if (fromRef.current) {
            void flyTickets({ from: fromRef.current }).then(() => setBalance((b) => b + 50));
          }
        }}
      >
        claim
      </ArcadeButton>
    </>
  );
}

function fireToast() {
  notifyAchievements([
    {
      id: `kit-${Date.now()}`,
      name: 'long snake',
      description: 'Reach a length of 40 in one run.',
      icon: 'badge:snake:2',
      rarity: 'rare',
      tierLabel: 'tier 2',
      xp: 150,
    },
  ]);
}
