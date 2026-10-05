'use client';

import { useEffect, useRef, useState, type CSSProperties } from 'react';

import { flyTickets } from '@/features/arcade/components/feedback/ticket-gain';
import { REVEAL_TIMING as R } from '@/features/arcade/components/results/result-sequence';
import { SeasonBar } from '@/features/arcade/components/results/season-bar';
import { ArcadeStub } from '@/features/arcade/components/ui/arcade-ui';
import { Num } from '@/features/arcade/components/ui/num';
import { LevelBadge } from '@/features/brand/avatars/level-badge';
import { rollingValueAt } from '@/features/arcade/lib/game-feel';
import { SoundManager } from '@/features/arcade/lib/sound-manager';
import { useIsTixyTheme } from '@/features/arcade/lib/use-arcade-theme';
import { useFeelReducedMotion } from '@/features/arcade/lib/use-game-feedback';
import type { AccountXpReward } from '@/server/arcade/rewards/types';

/**
 * End-of-game account XP. Under tixy it is `XpLine`, the level panel: the
 * level badge, the xp counting up, the bar, a level up punching the badge,
 * the season bar. Under the Midway themes it is the old burst. Renders
 * nothing when there's no XP to show.
 *
 * Drop it next to wherever a game already surfaces its run reward. It owns
 * its own animation, keyed on the reward, so a new run just passes the new
 * `account`.
 */
export function XpGainBurst({
  account,
  className,
  sound = true,
  delay,
  skipped,
}: {
  account?: AccountXpReward | null;
  className?: string;
  /** The level-up cue under tixy. */
  sound?: boolean;
  /** Under tixy: ms after mount before the panel plays. */
  delay?: number;
  /** Under tixy: jump to the end now. */
  skipped?: boolean;
}) {
  const tixy = useIsTixyTheme();
  if (!account || account.xpGained <= 0) return null;
  if (!tixy) return <MidwayXpGainBurst account={account} className={className} />;
  return (
    <XpLine
      key={`${account.xp}:${account.xpGained}`}
      xpGained={account.xpGained}
      level={account.level}
      into={account.into}
      need={account.need}
      leveledUp={account.leveledUp}
      bonusTickets={account.bonusTickets}
      levelBefore={account.levelBefore}
      intoBefore={account.intoBefore}
      needBefore={account.needBefore}
      milestones={account.milestones}
      season={account.season}
      delay={delay}
      skipped={skipped}
      sound={sound}
      className={className}
    />
  );
}

export type XpLineProps = {
  /** XP this run gave. */
  xpGained: number;
  /** The level after the run. */
  level: number;
  /** XP into that level, and what the level needs. */
  into: number;
  need: number;
  /** The run crossed at least one level. */
  leveledUp?: boolean;
  /** Tickets the new level paid. */
  bonusTickets?: number;
  /** The level the run started in. A run across several levels steps
   *  through each one; without it the badge starts one level back. */
  levelBefore?: number;
  /** Where the bar stood in that level. */
  intoBefore?: number;
  needBefore?: number;
  /** Each milestone the run paid. Without it `bonusTickets` is one milestone
   *  at `level`. */
  milestones?: Array<{ level: number; tickets: number }>;
  /** Accepted for older callers; the band's name is never shown. The badge's
   *  rim and colour carry it. */
  tierName?: string;
  /** The season row the run moved, for the season bar. */
  season?: AccountXpReward['season'];
  /** ms after mount before it plays (the result card lines it up after the
   *  strip). */
  delay?: number;
  /** False holds the panel still and shows the end, for a parent that runs
   *  its own sequence; turning it true plays. */
  play?: boolean;
  /** Jump to the end now: a tap skipped the result. */
  skipped?: boolean;
  /** Plays the level-up cue when the new level lands. */
  sound?: boolean;
  /** Milestone tickets fly to the ticket balance when they show. */
  flyBonus?: boolean;
  className?: string;
};

type Phase = 'wait' | 'count' | 'up' | 'done';

/**
 * The level panel: the level badge with the number on it, "+53 xp" counting
 * up, the bar filling from where the run found it, and the season bar under
 * it. A level up runs the bar to the end, punches the badge from the old
 * number to the new one with one sound, says "Level up" beside it, and
 * shows any milestone tickets on a stub. Reduced motion shows the end at
 * once (the level-up sound still plays).
 */
export function XpLine({
  xpGained,
  level,
  into,
  need,
  leveledUp = false,
  bonusTickets = 0,
  levelBefore,
  intoBefore,
  needBefore,
  milestones,
  season,
  delay = 0,
  play = true,
  skipped = false,
  sound = true,
  flyBonus = true,
  className,
}: XpLineProps) {
  const reduced = useFeelReducedMotion();
  const safeNeed = Math.max(1, need);
  const endPct = (Math.max(0, Math.min(safeNeed, into)) / safeNeed) * 100;
  const from = Math.max(1, Math.min(level - 1, levelBefore ?? level - 1));
  const crossed = leveledUp ? Math.max(1, level - from) : 0;
  // Where the bar stood before the run. With the starting level's numbers it
  // is exact; without them it starts where the leftover XP puts it.
  const startPct =
    leveledUp && intoBefore != null && needBefore != null
      ? (Math.max(0, Math.min(needBefore, intoBefore)) / Math.max(1, needBefore)) * 100
      : leveledUp
        ? Math.max(0, 100 - (Math.max(0, xpGained - into) / safeNeed) * 100)
        : Math.max(0, endPct - (xpGained / safeNeed) * 100);
  const still = reduced || !play || skipped;
  // A few levels step one by one; past that the badge jumps to the last.
  const stepping = crossed > 1 && crossed <= R.stepsMax;
  const stepMs = stepping
    ? Math.max(R.stepMinMs, Math.min(R.stepMaxMs, Math.floor(R.stepsBudgetMs / (crossed - 1))))
    : R.levelAfter;

  // The milestones this run paid, as one entry per level, or the lump sum.
  const paid: Bonus[] = (() => {
    if (!leveledUp) return [];
    const list = (milestones ?? []).filter((m) => m.tickets > 0);
    if (list.length > 0) return list.map((m) => ({ level: m.level, tickets: m.tickets, count: 1 }));
    return bonusTickets > 0 ? [{ level, tickets: bonusTickets, count: 1 }] : [];
  })();
  const total: Bonus | null =
    paid.length === 0
      ? null
      : {
          level: paid[paid.length - 1]!.level,
          tickets: paid.reduce((sum, m) => sum + m.tickets, 0),
          count: paid.length,
        };

  const [phase, setPhase] = useState<Phase>(still ? 'done' : 'wait');
  const [shownXp, setShownXp] = useState(still ? xpGained : 0);
  const [shownLevel, setShownLevel] = useState(still || !leveledUp ? level : from);
  const [bonus, setBonus] = useState<Bonus | null>(still ? total : null);
  // `jump` sets the bar with no transition (the wrap back to empty).
  const [bar, setBar] = useState<{ pct: number; jump: boolean; ms?: number }>({
    pct: still ? endPct : startPct,
    jump: true,
  });
  const levelSoundRef = useRef(false);
  const flownRef = useRef(new Set<string>());
  const bonusRef = useRef<HTMLSpanElement>(null);

  const levelCue = () => {
    if (!leveledUp || !sound || levelSoundRef.current) return;
    levelSoundRef.current = true;
    SoundManager.play('accountLevelUp');
  };

  useEffect(() => {
    if (!play) return;
    if (still) {
      setShownXp(xpGained);
      setShownLevel(level);
      setBonus(total);
      setBar({ pct: endPct, jump: true });
      setPhase('done');
      levelCue();
      return;
    }
    const timers: number[] = [];
    let frame = 0;
    const at = (ms: number, run: () => void) => timers.push(window.setTimeout(run, Math.max(0, delay + ms)));
    at(0, () => {
      setPhase('count');
      const started = performance.now();
      const tick = (now: number) => {
        const shown = rollingValueAt(0, xpGained, now - started, R.xpCountMs);
        setShownXp(shown);
        if (shown !== xpGained) frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);
    });
    if (leveledUp && stepping) {
      // Each level crossed: the badge punches to it, the bar wipes through,
      // and a milestone on that level shows its tickets.
      at(R.barDelay, () => setBar({ pct: 100, jump: false, ms: R.fillToLevelMs }));
      for (let k = 1; k <= crossed; k += 1) {
        const t = R.levelAfter + (k - 1) * stepMs;
        const reached = from + k;
        const last = k === crossed;
        at(t, () => {
          setPhase('up');
          setShownLevel(reached);
          setBar({ pct: 0, jump: true });
          // The first step also takes a milestone the run found already behind it.
          const lo = k === 1 ? 0 : reached - 1;
          const hit = paid.filter((m) => m.level > lo && m.level <= reached);
          if (hit.length > 0) {
            setBonus({
              level: hit[hit.length - 1]!.level,
              tickets: hit.reduce((sum, m) => sum + m.tickets, 0),
              count: hit.length,
            });
          }
          if (last) levelCue();
        });
        at(t + 30, () =>
          setBar(last ? { pct: endPct, jump: false } : { pct: 100, jump: false, ms: Math.max(80, stepMs - 40) }),
        );
      }
      at(R.levelAfter + (crossed - 1) * stepMs + R.punchMs, () => setPhase('done'));
    } else if (leveledUp) {
      at(R.barDelay, () => setBar({ pct: 100, jump: false, ms: R.fillToLevelMs }));
      at(R.levelAfter, () => {
        setPhase('up');
        setShownLevel(level);
        setBonus(total);
        setBar({ pct: 0, jump: true });
        levelCue();
      });
      at(R.levelAfter + 40, () => setBar({ pct: endPct, jump: false }));
      at(R.levelAfter + R.punchMs, () => setPhase('done'));
    } else {
      at(R.barDelay, () => setBar({ pct: endPct, jump: false }));
      at(R.barDelay + 600, () => setPhase('done'));
    }
    return () => {
      cancelAnimationFrame(frame);
      for (const timer of timers) window.clearTimeout(timer);
    };
    // One sequence per mount and per play; a new run is a new key. A skip
    // lands on the end through `still`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [play, still]);

  const leveled = leveledUp && (phase === 'up' || phase === 'done');
  const showBonus = leveled && bonus != null;
  const bonusKey = bonus ? `${bonus.count}:${bonus.level}:${bonus.tickets}` : '';
  // Past a handful of levels the badge jumps, so the count is said at once.
  const counted = crossed > 1 && (phase === 'done' || crossed > R.stepsMax);

  // Milestone tickets fly to the balance once each time they show, then the
  // balance reloads (a milestone is paid after the run's own payout).
  useEffect(() => {
    if (!showBonus || !flyBonus || flownRef.current.has(bonusKey)) return;
    flownRef.current.add(bonusKey);
    // A skip lands on the end: no flight, just the true balance.
    if (skipped) {
      window.dispatchEvent(new Event('store-inventory-updated'));
      return;
    }
    const origin = bonusRef.current;
    // A later step must not cancel this flight, so it keeps its own timer.
    window.setTimeout(() => {
      void flyTickets({ from: origin ?? { x: 0, y: 0 }, count: 3, sound }).then(() => {
        window.dispatchEvent(new Event('store-inventory-updated'));
      });
    }, still ? 0 : 180);
  }, [showBonus, bonusKey, flyBonus, still, skipped, sound]);

  return (
    <section
      className={['arc-prog', className].filter(Boolean).join(' ')}
      data-phase={phase}
      data-up={leveled || undefined}
      data-instant={still || undefined}
      data-levels-crossed={crossed > 1 ? crossed : undefined}
      style={{ '--season-delay': `${R.seasonAfter}ms` } as CSSProperties}
      aria-label={`Gained ${xpGained.toLocaleString('en-US')} xp. ${
        crossed > 1 ? `Up ${crossed} levels to` : leveledUp ? 'Level up to' : 'Level'
      } ${level}.`}
    >
      <div className='arc-prog-row'>
        <span className='arc-prog-badge' data-punch={(leveled && !still) || undefined} aria-hidden>
          <LevelBadge key={shownLevel} level={shownLevel} size={68} />
        </span>
        <div className='arc-prog-main' aria-hidden>
          <div className='arc-prog-head'>
            <b className='arc-prog-title'>
              {leveled ? (
                <span className='arc-prog-up'>
                  {counted ? (
                    <>
                      <Num value={crossed} /> levels up
                    </>
                  ) : (
                    'Level up'
                  )}
                </span>
              ) : (
                <>
                  Level <Num value={shownLevel} />
                </>
              )}
            </b>
            <span className='arc-prog-xp'>
              <Num value={shownXp} signed labelValue={xpGained} />
              <small> xp</small>
            </span>
          </div>
          <div className='arc-xp-bar'>
            <div
              style={{
                width: `${Math.max(0, Math.min(100, bar.pct))}%`,
                ...(bar.jump ? { transition: 'none' } : null),
                ...(bar.ms ? { transitionDuration: `${bar.ms}ms` } : null),
              }}
            />
          </div>
          <small className='arc-prog-next'>
            <Num value={Math.max(0, need - into)} /> xp to Level <Num value={level + 1} />
          </small>
        </div>
      </div>
      {total ? (
        // Laid out from the start so the panel doesn't grow when it lands.
        <p
          key={bonusKey}
          className='arc-prog-bonus'
          data-shown={showBonus || undefined}
          aria-hidden={!showBonus || undefined}
        >
          <span ref={bonusRef}>
            <ArcadeStub size='sm'>
              <Num value={(bonus ?? total).tickets} signed labelSuffix='tickets' />
            </ArcadeStub>
          </span>
          <span>
            {(bonus ?? total).count > 1 ? (
              <>
                <Num value={(bonus ?? total).count} /> levels paid <Num value={(bonus ?? total).tickets} /> tickets.
              </>
            ) : (
              <>
                Level <Num value={(bonus ?? total).level} /> paid <Num value={(bonus ?? total).tickets} /> tickets.
              </>
            )}
          </span>
        </p>
      ) : null}
      <SeasonBar
        season={season}
        xpGained={xpGained}
        fill={phase !== 'wait'}
        instant={still}
        className='arc-prog-season'
      />
    </section>
  );
}

type Bonus = { level: number; tickets: number; count: number };

/**
 * "Level up" beside the badge with the new level on it: a level reached.
 * The result panel draws its own; a profile or a toast can use this.
 */
export function LevelUpMark({
  level,
  play = true,
  className,
}: {
  level: number;
  play?: boolean;
  /** Accepted for older callers; nothing is said after the level. */
  suffix?: string;
  className?: string;
}) {
  return (
    <span data-up='' data-play={play || undefined} className={['arc-levelup', className].filter(Boolean).join(' ')}>
      <LevelBadge level={level} size={28} title={`Level ${level}`} />
      Level up
    </span>
  );
}

function MidwayXpGainBurst({
  account,
  className,
}: {
  account?: AccountXpReward | null;
  className?: string;
}) {
  const prefersReducedMotion = usePrefersReducedMotion();
  const xpGained = account?.xpGained ?? 0;
  const need = Math.max(1, account?.need ?? 1);
  const into = Math.max(0, Math.min(need, account?.into ?? 0));
  // Where the bar started before this run (clamped to 0 on a level-up).
  const startInto = account?.leveledUp
    ? 0
    : Math.max(0, Math.min(need, into - xpGained));

  const [displayXp, setDisplayXp] = useState(prefersReducedMotion ? xpGained : 0);
  const [barPct, setBarPct] = useState(
    prefersReducedMotion ? (into / need) * 100 : (startInto / need) * 100,
  );

  const animKey = account ? `${account.xp}:${account.xpGained}` : 'none';
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (!account || xpGained <= 0) return;
    if (prefersReducedMotion) {
      setDisplayXp(xpGained);
      setBarPct((into / need) * 100);
      return;
    }

    setDisplayXp(0);
    setBarPct((startInto / need) * 100);

    const duration = 900;
    const start = performance.now();
    // Fill the bar a beat after the number starts climbing.
    const barTimer = window.setTimeout(() => {
      setBarPct((into / need) * 100);
    }, 120);

    const tick = (nowTs: number) => {
      const t = Math.min(1, (nowTs - start) / duration);
      // easeOutCubic for a snappy-then-settle count.
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplayXp(Math.round(eased * xpGained));
      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick);
      }
    };
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      window.clearTimeout(barTimer);
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
    // animKey changes whenever a new run's reward arrives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [animKey, prefersReducedMotion]);

  if (!account || xpGained <= 0) return null;

  const { level, leveledUp } = account;

  return (
    <div
      className={cx(
        'flex flex-col gap-1.5 rounded-panel border-2 border-ink bg-raised px-3 py-2 shadow-panel',
        !prefersReducedMotion && 'arc-stub-delta',
        className,
      )}
      role='status'
      aria-label={`Gained ${xpGained} account XP${leveledUp ? `, reached level ${level}` : ''}`}
    >
      <div className='flex items-center justify-between gap-2'>
        <span className='flex items-center gap-1.5 text-sm font-semibold text-strong'>
          <LevelBadge level={level} size={22} />
          <span className='arcade-num tabular-nums'>+{displayXp.toLocaleString()} XP</span>
        </span>
        <span className='arcade-kicker text-[10px] text-tickets-text'>
          {leveledUp ? `Level up, ${level}` : `Level ${level}`}
        </span>
      </div>
      {leveledUp && (account.bonusTickets ?? 0) > 0 ? (
        <div className='text-[11px] font-semibold text-tickets-text'>
          Level reward:{' '}
          <span className='arcade-num'>+{(account.bonusTickets ?? 0).toLocaleString()}</span>
          {' '}tickets
        </div>
      ) : null}
      <div className='h-1.5 w-full overflow-hidden rounded-full border border-ink bg-well'>
        <div
          className={cx(
            'h-full rounded-full bg-tickets',
            !prefersReducedMotion && 'transition-[width] duration-[600ms] ease-out',
          )}
          style={{
            width: `${Math.max(0, Math.min(100, barPct))}%`,
          }}
        />
      </div>
    </div>
  );
}

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mql = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(mql.matches);
    const onChange = (e: MediaQueryListEvent) => setReduced(e.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);
  return reduced;
}

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(' ');
}
