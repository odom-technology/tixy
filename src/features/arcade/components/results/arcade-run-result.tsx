'use client';

import {
  Children,
  Fragment,
  isValidElement,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
} from 'react';
import { Award, Crown, Sparkles, Ticket } from 'lucide-react';

import { trackGameCompletion } from '@/features/analytics/product-events';
import { AchievementIcon } from '@/features/arcade/components/achievements/achievement-icon';
import { flyTickets } from '@/features/arcade/components/feedback/ticket-gain';
import { XpGainBurst } from '@/features/arcade/components/xp-gain-burst';
import { ArcadeResultShare } from '@/features/arcade/components/results/arcade-result-share';
import {
  REVEAL_TIMING,
  ResultClockProvider,
  STRIP_TIMING,
  useParentResultClock,
  useReducedMotion,
  useResultClock,
  useSkipOnTap,
  type ResultClock,
} from '@/features/arcade/components/results/result-sequence';
import { TicketStrip, type TicketLine } from '@/features/arcade/components/results/ticket-strip';
import { WagerReceipt, type WagerReceiptRound } from '@/features/arcade/components/results/wager-receipt';
import { ArcadeButton, ArcadeLinkButton } from '@/features/arcade/components/ui/arcade-ui';
import { Num, formatNum, useNumLocale } from '@/features/arcade/components/ui/num';
import { SoundManager } from '@/features/arcade/lib/sound-manager';
import { usePayoutCount } from '@/features/arcade/lib/use-payout-count';
import { useIsTixyTheme } from '@/features/arcade/lib/use-arcade-theme';
import { useRollingNumber } from '@/features/arcade/lib/use-rolling-number';
import type { WagerFairness } from '@/features/arcade/lib/wager-fairness-store';
import {
  awardedRunTickets,
  wantedRunTickets,
  type ArcadeRunAchievement,
  type ArcadeRunReward,
} from '@/features/arcade/lib/run-result';
import {
  getWagerCelebrationTier,
  type WagerCelebrationTier,
} from '@/features/arcade/lib/wager-celebration';

export type { TicketLine } from '@/features/arcade/components/results/ticket-strip';
export type { WagerFairness } from '@/features/arcade/lib/wager-fairness-store';

export type TicketCelebrationTier = WagerCelebrationTier;
export const getTicketCelebrationTier = getWagerCelebrationTier;

const TICKET_PARTICLES = Array.from({ length: 12 }, (_, index) => index);

export function TicketPayoutBurst({
  amount,
  stake = 0,
  multiplier,
  net,
  jackpot = false,
  label = 'Tickets earned',
  note,
  sound = true,
  className,
}: {
  amount: number;
  stake?: number;
  multiplier?: number | null;
  /** Net change after stake. When present, the headline is a gross payout. */
  net?: number | null;
  jackpot?: boolean;
  label?: string;
  note?: string | null;
  sound?: boolean;
  className?: string;
}) {
  const safeAmount = Math.max(0, Math.floor(Number.isFinite(amount) ? amount : 0));
  const tier = getTicketCelebrationTier({
    amount: safeAmount,
    stake,
    multiplier,
    net,
    jackpot,
  });
  const duration = tier === 'jackpot' ? 1500 : tier === 'big' ? 1050 : 650;
  const display = usePayoutCount(safeAmount, duration);
  const particleCount = tier === 'jackpot' ? 12 : tier === 'big' ? 8 : 3;

  useEffect(() => {
    if (!sound || safeAmount <= 0) return;
    SoundManager.play(
      tier === 'jackpot'
        ? 'arcadeBigWin'
        : tier === 'big'
          ? 'arcadeCashout'
          : 'arcadeReveal',
    );
  }, [safeAmount, sound, tier]);

  if (safeAmount <= 0) return null;

  return (
    <div
      className={[
        'arc-ticket-payout relative isolate overflow-hidden rounded-panel border-2 border-ink bg-tickets px-4 py-3 text-tickets-on shadow-panel',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      data-tier={tier}
      role='status'
      aria-label={`${label}: ${safeAmount.toLocaleString()} tickets${net != null ? `, ${net >= 0 ? 'net win' : 'net loss'} ${Math.abs(net).toLocaleString()} tickets` : ''}`}
    >
      <div className='arc-ticket-particles pointer-events-none absolute inset-0' aria-hidden>
        {TICKET_PARTICLES.slice(0, particleCount).map((index) => (
          <span
            key={index}
            className='arc-ticket-particle'
            style={{ '--ticket-i': index } as CSSProperties}
          >
            <Ticket size={tier === 'jackpot' ? 18 : 14} strokeWidth={2.4} />
          </span>
        ))}
      </div>
      <div className='relative z-10 flex items-center justify-center gap-3'>
        <span className='arc-ticket-payout-icon grid size-10 shrink-0 place-items-center rounded-key border-2 border-ink bg-panel text-tickets-text shadow-chip'>
          {tier === 'jackpot' ? <Crown size={21} aria-hidden /> : <Ticket size={21} aria-hidden />}
        </span>
        <div className='min-w-0 text-left'>
          <p className='text-[10px] font-black tracking-[0.15em] uppercase opacity-80'>
            {tier === 'jackpot' ? 'Jackpot payout' : tier === 'big' ? 'Big payout' : label}
          </p>
          <p className='arcade-num arc-ticket-payout-number text-2xl leading-none font-black tabular-nums sm:text-3xl'>
            {net == null ? '+' : ''}{display.toLocaleString()}
            <span className='ml-1 text-xs font-bold tracking-wide uppercase'>tickets</span>
          </p>
          {note || net != null ? (
            <p className='mt-1 text-[11px] font-semibold opacity-85'>
              {note ?? `${net! >= 0 ? '+' : '−'}${Math.abs(net!).toLocaleString()} net`}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

const RARITY_CLASS: Record<string, string> = {
  common: 'border-soft bg-raised',
  rare: 'border-info-edge bg-info text-info-on',
  epic: 'border-primary-edge bg-primary text-primary-on',
  legendary: 'border-tickets-edge bg-tickets text-tickets-on',
};

export function RunAchievementReveal({
  achievements,
  sound = true,
  delay = 0,
  skipped = false,
  className,
}: {
  achievements: ArcadeRunAchievement[];
  sound?: boolean;
  /** Under tixy: ms after mount before the first one lands. */
  delay?: number;
  /** Under tixy: show them all now (a tap skipped the result). */
  skipped?: boolean;
  className?: string;
}) {
  const tixy = useIsTixyTheme();
  const reducedMotion = useReducedMotion();
  const inCard = useParentResultClock() != null;
  const listRef = useRef<HTMLElement>(null);
  const key = achievements.map((achievement) => achievement.id).join('|');
  const highestRarity = useMemo(() => {
    const order = ['common', 'rare', 'epic', 'legendary'];
    return achievements.reduce(
      (highest, achievement) =>
        order.indexOf(achievement.rarity) > order.indexOf(highest)
          ? achievement.rarity
          : highest,
      'common',
    );
  }, [achievements]);

  // One cue, when the first one lands (at once under reduced motion: sound
  // is unchanged there, only the motion goes).
  useEffect(() => {
    if (!sound || achievements.length === 0) return;
    const timer = window.setTimeout(
      () =>
        SoundManager.play('achievementUnlock', {
          pitch: highestRarity === 'legendary' ? 1.12 : highestRarity === 'epic' ? 1.06 : 1,
        }),
      tixy && !reducedMotion ? Math.max(0, delay) : 0,
    );
    return () => window.clearTimeout(timer);
    // Once per set of achievements.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [achievements.length, highestRarity, key, sound]);

  // Alone on a short screen the rewards scroll: bring the new line into
  // view. Inside the result card the outcome stays on top instead.
  useEffect(() => {
    if (!tixy || inCard || achievements.length === 0) return;
    listRef.current?.scrollIntoView({
      block: 'nearest',
      behavior: reducedMotion ? 'auto' : 'smooth',
    });
    // Once per set of achievements.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tixy, key]);

  if (achievements.length === 0) return null;

  if (tixy) {
    const still = reducedMotion || skipped;
    return (
      <section
        ref={listRef}
        className={['arc-run-ach', className].filter(Boolean).join(' ')}
        data-instant={still || undefined}
        aria-label='Achievements earned this run'
      >
        {achievements.map((achievement, index) => (
          <article
            key={achievement.id}
            className='arc-run-ach-row'
            style={{ '--at': `${Math.round(Math.max(0, delay) + index * REVEAL_TIMING.achievementGap)}ms` } as CSSProperties}
          >
            <span className='arc-run-ach-medal'>
              <AchievementIcon src={achievement.icon} alt='' size={52} className='size-full' />
            </span>
            <span className='arc-run-ach-text'>
              <b>
                <span className='sr-only'>Achievement earned: </span>
                {achievement.name}
              </b>
              <small>{achievement.description}</small>
            </span>
            <span className='arc-run-ach-xp'>
              <Num value={achievement.xp} signed />
              <small> xp</small>
            </span>
          </article>
        ))}
      </section>
    );
  }

  return (
    <section className={['arc-run-achievements', className].filter(Boolean).join(' ')} aria-label='Achievements earned this run'>
      <div className='mb-2 flex items-center justify-center gap-1.5 text-[10px] font-black tracking-[0.14em] text-tickets-text uppercase'>
        <Award size={14} aria-hidden />
        {achievements.length === 1 ? 'Achievement earned' : `${achievements.length} achievements earned`}
      </div>
      <div className='grid gap-2'>
        {achievements.map((achievement, index) => (
          <article
            key={achievement.id}
            className={`arc-achievement-reveal flex items-center gap-3 rounded-panel border-2 border-ink p-2.5 text-left shadow-chip ${RARITY_CLASS[achievement.rarity] ?? RARITY_CLASS.common}`}
            style={{ '--i': index } as CSSProperties}
          >
            <div className='size-12 shrink-0 overflow-hidden rounded-key border-2 border-ink bg-well'>
              <AchievementIcon src={achievement.icon} alt='' size={48} className='size-full object-cover' />
            </div>
            <div className='min-w-0 flex-1'>
              <p className='text-[9px] font-black tracking-[0.13em] uppercase opacity-75'>
                {achievement.rarity}{achievement.tierLabel ? ` · ${achievement.tierLabel}` : ''}
              </p>
              <p className='truncate text-sm font-black'>{achievement.name}</p>
              <p className='line-clamp-2 text-[11px] leading-snug opacity-85'>{achievement.description}</p>
            </div>
            <div className='flex shrink-0 items-center gap-1 text-[11px] font-black'>
              <Sparkles size={12} aria-hidden />
              +{achievement.xp.toLocaleString()} XP
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

type ArcadeRunRewardsProps = {
  reward?: ArcadeRunReward | null;
  achievements?: ArcadeRunAchievement[];
  saving?: boolean;
  error?: string | null;
  guest?: boolean;
  /** The payout chime under the Midway themes; the printer ticks and the
   *  tear under tixy. */
  ticketSound?: boolean;
  /**
   * Optional: what the tickets were for, one stub each, above the total
   * ("win" 30, "run of 3" 10). Leave it out and the strip prints the total,
   * plus a "daily cap" stub when the cap held tickets back.
   */
  ticketLines?: TicketLine[];
  className?: string;
};

/**
 * The tickets a run paid. Under tixy this prints the ticket strip; under the
 * Midway themes it is the payout plate. 38 games render it directly, the
 * rest through ArcadeRunResult.
 */
export function ArcadeRunRewards(props: ArcadeRunRewardsProps) {
  const tixy = useIsTixyTheme();
  const { guest = false, saving = false } = props;
  const guestCompletionTrackedRef = useRef(false);

  useEffect(() => {
    if (!guest) {
      guestCompletionTrackedRef.current = false;
      return;
    }
    if (saving || guestCompletionTrackedRef.current) return;
    guestCompletionTrackedRef.current = true;
    trackGameCompletion({ guest: true });
  }, [guest, saving]);

  return tixy ? <TixyRunRewards {...props} /> : <MidwayRunRewards {...props} />;
}

/**
 * The stubs above the total. A game's own lines come first; when the daily
 * cap held tickets back there is always a "daily cap" stub, so the strip
 * adds up to what was paid.
 */
function stripLinesFor(reward: ArcadeRunReward | null | undefined, lines?: TicketLine[]) {
  const awarded = awardedRunTickets(reward);
  const wanted = wantedRunTickets(reward);
  const capped = wanted > awarded;
  const base = lines ?? (capped ? [{ label: 'run', tickets: wanted }] : []);
  const all = capped ? [...base, { label: 'daily cap', tickets: awarded - wanted }] : base;
  if (process.env.NODE_ENV !== 'production' && all.length > 0) {
    const sum = all.reduce((acc, line) => acc + line.tickets, 0);
    if (sum !== awarded) {
      console.warn(
        `[ArcadeRunRewards] ticketLines add up to ${sum}, but the run paid ${awarded}` +
          (capped ? ` (wanted ${wanted}, daily cap ${awarded - wanted})` : '') +
          '. Lines should sum to wantedTickets.',
      );
    }
  }
  return all;
}

function TixyRunRewards({
  reward,
  achievements = [],
  saving = false,
  error,
  guest = false,
  ticketSound = true,
  ticketLines,
  className,
}: ArcadeRunRewardsProps) {
  const parent = useParentResultClock();
  const own = useResultClock();
  const clock: ResultClock = parent ?? own;
  const tap = useSkipOnTap(clock);
  const awarded = awardedRunTickets(reward);
  const wanted = wantedRunTickets(reward);
  const [doneKey, setDoneKey] = useState<string | null>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  const flownRef = useRef<string | null>(null);

  // Print once the save is back. A guest's run saves nothing, so it prints
  // a void strip at once.
  const ready = !saving && !error && (reward != null || guest);
  const total = guest ? 0 : awarded;
  const lines = useMemo(
    () => (guest ? [] : stripLinesFor(reward, ticketLines)),
    [guest, reward, ticketLines],
  );
  const sequenceKey = `${reward?.ledgerId ?? ''}:${total}:${wanted}:${guest}`;
  const stripDone = doneKey === sequenceKey;
  const jump = clock.instant || clock.skipped;
  // Inside the result card the level panel and the achievements are laid
  // out from the start and reveal on the card's clock, after the strip
  // starts. Alone they wait for the strip; with nothing to print (an
  // error, or a run that saved nothing) they show once saving ends.
  const showExtras = parent ? ready || !saving : ready ? stripDone : !saving;
  const locale = useNumLocale();

  // The tickets fly from the strip's total to the balance once it tears.
  // A skip lands on the end with no flight.
  useEffect(() => {
    if (!stripDone || total <= 0 || flownRef.current === sequenceKey) return;
    flownRef.current = sequenceKey;
    if (clock.skipped) return;
    const from = stripRef.current?.querySelector('[data-total]') ?? stripRef.current;
    if (!from) return;
    void flyTickets({ from, count: Math.min(5, Math.max(1, Math.ceil(total / 10))), sound: ticketSound });
  }, [stripDone, total, sequenceKey, clock.skipped, ticketSound]);

  return (
    <div
      className={['arc-run-rewards', className].filter(Boolean).join(' ')}
      data-in-card={parent ? '' : undefined}
      // Inside ArcadeRunResult the card takes the tap; alone, this does.
      {...(parent ? {} : tap)}
    >
      {/* Said once, when the strip has printed. */}
      <p className='sr-only' aria-live='polite'>
        {ready && stripDone ? `${formatNum(total, { signed: true, locale })} tickets.` : ''}
      </p>
      {saving ? <p className='arc-run-rewards-note'>Saving your run.</p> : null}
      {error ? <p className='arc-run-rewards-note' data-tone='danger'>{error}</p> : null}
      {ready ? (
        <div ref={stripRef} className='arc-run-rewards-strip'>
          <TicketStrip
            key={sequenceKey}
            lines={lines}
            total={total}
            clock={clock}
            startAt={parent ? STRIP_TIMING.stripAt : STRIP_TIMING.stripAloneAt}
            sequenceKey={sequenceKey}
            onDone={setDoneKey}
            sound={ticketSound}
          />
        </div>
      ) : null}
      {guest ? <p className='arc-run-rewards-note'>Sign in to earn tickets and xp.</p> : null}
      {!guest && wanted > 0 && awarded === 0 && ready ? (
        <p className='arc-run-rewards-note'>Daily ticket cap reached. Your score and achievements still count.</p>
      ) : null}
      {showExtras ? (
        <RewardExtras
          reward={reward}
          achievements={achievements}
          guest={guest}
          shareReady={!saving && !error}
          clock={clock}
          inCard={parent != null}
          skipped={jump}
        />
      ) : null}
    </div>
  );
}

/* The level panel, the achievements and share. In the result card they
   reveal on the card's clock: the level panel at REVEAL_TIMING.progressAt
   (or soon after it mounts, when the save came back late), the
   achievements after it. Alone they play as they mount. */
function RewardExtras({
  reward,
  achievements,
  guest,
  shareReady,
  clock,
  inCard,
  skipped,
}: {
  reward?: ArcadeRunReward | null;
  achievements: ArcadeRunAchievement[];
  guest: boolean;
  shareReady: boolean;
  clock: ResultClock;
  inCard: boolean;
  skipped: boolean;
}) {
  const [mountedAt] = useState(() => performance.now());
  const delay = inCard
    ? Math.max(STRIP_TIMING.stripAt + 300, REVEAL_TIMING.progressAt - (mountedAt - clock.startedAt))
    : 0;
  const hasXp = (reward?.account?.xpGained ?? 0) > 0;
  return (
    <div className='arc-run-rewards-extras'>
      {reward?.account ? <XpGainBurst account={reward.account} delay={delay} skipped={skipped} /> : null}
      <RunAchievementReveal
        achievements={achievements}
        delay={delay + (hasXp ? REVEAL_TIMING.achievementsAfter : 120)}
        skipped={skipped}
      />
      <ArcadeResultShare guest={guest} ready={shareReady} />
    </div>
  );
}

function MidwayRunRewards({
  reward,
  achievements = [],
  saving = false,
  error,
  guest = false,
  ticketSound = true,
  className,
}: ArcadeRunRewardsProps) {
  const awarded = awardedRunTickets(reward);
  const wanted = wantedRunTickets(reward);
  const capTrimmed = Math.max(0, wanted - awarded);

  return (
    <div className={['grid w-full gap-2.5', className].filter(Boolean).join(' ')}>
      {saving ? <p className='text-center text-xs font-semibold text-faint'>Saving your run.</p> : null}
      {guest ? (
        <p className='rounded-key border border-soft bg-raised px-3 py-2 text-center text-xs font-semibold text-body'>
          Sign in to save scores and earn tickets.
        </p>
      ) : null}
      {error ? <p className='text-center text-xs font-semibold text-danger-text'>{error}</p> : null}
      <TicketPayoutBurst
        amount={awarded}
        label='Tickets earned'
        note={capTrimmed > 0 ? `Daily cap held back ${capTrimmed.toLocaleString()} tickets.` : null}
        sound={ticketSound}
      />
      {wanted > 0 && awarded === 0 ? (
        <p className='rounded-key border border-tickets-edge bg-tickets px-3 py-2 text-center text-xs font-bold text-tickets-on'>
          Daily ticket cap reached. Your score and achievements still count.
        </p>
      ) : null}
      {reward?.account ? <XpGainBurst account={reward.account} /> : null}
      <RunAchievementReveal achievements={achievements} />
      <ArcadeResultShare guest={guest} ready={!saving && !error} />
    </div>
  );
}

export type ArcadeRunStat = {
  label: string;
  value: ReactNode;
  highlight?: boolean;
};

export type ArcadeWagerOutcome = 'loss' | 'partial' | 'push' | 'win';

export type ArcadeWagerPayout = {
  id?: string | number;
  payout: number;
  stake: number;
  multiplier?: number | null;
  jackpot?: boolean;
};

export function getArcadeWagerOutcome({ payout, stake }: ArcadeWagerPayout): ArcadeWagerOutcome {
  if (payout <= 0) return 'loss';
  const net = payout - stake;
  if (net < 0) return 'partial';
  if (net === 0) return 'push';
  return 'win';
}

type ArcadeWagerResultPlateProps = {
  result: ArcadeWagerPayout;
  kicker?: ReactNode;
  headline?: ReactNode;
  detail?: ReactNode;
  achievements?: ArcadeRunAchievement[];
  sound?: boolean;
  compact?: boolean;
  /**
   * Optional: the round's seed for the receipt's fairness line. Leave it out
   * and the receipt prints what the page's ArcadeProvablyFair shows.
   */
  fairness?: WagerFairness | null;
  /**
   * Optional, tixy only: several settled rounds on one receipt (plinko's
   * drop 10). `result` carries the totals; each round prints a line with
   * its multiplier, seed and payout, in place of the single seed line.
   */
  rounds?: readonly WagerReceiptRound[];
  /** With `rounds`: what a round is called in the list's name (`drops`). */
  roundNoun?: string;
  /**
   * Optional: the round this result belongs to. Under tixy the receipt keeps
   * the values it first showed for a round, so editing the bet afterwards
   * can't change it. Without `roundId` (or `result.id`) a new round is a new
   * payout or multiplier, or a fresh mount.
   */
  roundId?: string | number;
  className?: string;
};

/**
 * Wager-safe result primitive. Gross payout is the wallet credit; only positive
 * net profit receives ticket particles, hero sound, and big/jackpot language.
 *
 * Under tixy it prints a receipt instead: stake, paid and net on their own
 * lines, the kicker as its heading, the headline beside it, the detail under
 * it, and the round's seed as its last line. `sound` covers the printer
 * chatter and the payout cue. The Midway themes keep the plate: a paper
 * slip on dark lacquer reads as a sticker.
 */
export function ArcadeWagerResultPlate(props: ArcadeWagerResultPlateProps) {
  const tixy = useIsTixyTheme();
  return tixy ? <TixyWagerReceipt {...props} /> : <MidwayWagerResultPlate {...props} />;
}

type ReceiptSnapshot = {
  identity: string;
  payout: number;
  stake: number;
  multiplier?: number | null;
  jackpot?: boolean;
  kicker?: ReactNode;
  headline?: ReactNode;
  detail?: ReactNode;
  rounds?: readonly WagerReceiptRound[];
};

function TixyWagerReceipt({
  result,
  kicker,
  headline,
  detail,
  achievements = [],
  sound = true,
  compact = false,
  fairness,
  rounds,
  roundNoun,
  roundId,
  className,
}: ArcadeWagerResultPlateProps) {
  const identity = String(
    roundId ?? result.id ?? `${Math.floor(result.payout)}:${result.multiplier ?? ''}`,
  );
  const take = (): ReceiptSnapshot => ({
    identity,
    payout: Math.max(0, Math.floor(result.payout)),
    stake: Math.max(0, Math.floor(result.stake)),
    multiplier: result.multiplier,
    jackpot: result.jackpot,
    kicker,
    headline,
    detail,
    rounds,
  });
  // A printed receipt doesn't change: keep what this round first showed.
  const [snap, setSnap] = useState(take);
  if (snap.identity !== identity) setSnap(take());
  const sequenceKey = `${snap.identity}:${snap.payout}:${snap.stake}`;
  return (
    <WagerReceipt
      key={sequenceKey}
      sequenceKey={sequenceKey}
      stake={snap.stake}
      payout={snap.payout}
      multiplier={snap.multiplier}
      jackpot={snap.jackpot}
      heading={snap.kicker}
      headline={snap.headline}
      detail={snap.detail}
      fairness={fairness}
      rounds={snap.rounds}
      roundNoun={roundNoun}
      sound={sound}
      compact={compact}
      footer={achievements.length > 0 ? <RunAchievementReveal achievements={achievements} /> : null}
      className={className}
    />
  );
}

function MidwayWagerResultPlate({
  result,
  kicker,
  headline,
  detail,
  achievements = [],
  sound = true,
  compact = false,
  className,
}: ArcadeWagerResultPlateProps) {
  const payout = Math.max(0, Math.floor(result.payout));
  const stake = Math.max(0, Math.floor(result.stake));
  const net = payout - stake;
  const outcome = getArcadeWagerOutcome({ ...result, payout, stake });

  return (
    <div
      className={['grid gap-2.5', compact ? 'max-w-xs' : 'w-full', className]
        .filter(Boolean)
        .join(' ')}
      data-wager-outcome={outcome}
    >
      {headline || kicker ? (
        <div
          className={`arc-result-plate rounded-panel border-2 border-ink px-4 py-3 text-center shadow-panel ${
            outcome === 'win'
              ? 'bg-prize text-prize-on'
              : outcome === 'loss'
                ? 'bg-danger text-danger-on'
                : 'bg-raised text-strong'
          }`}
          data-win={outcome === 'win' || undefined}
        >
          {kicker ? <p className='text-[10px] font-black tracking-[0.14em] uppercase opacity-75'>{kicker}</p> : null}
          {headline ? <p className='arcade-num arc-num-pop mt-0.5 text-2xl font-black'>{headline}</p> : null}
          {detail ? <div className='mt-1 text-xs font-semibold opacity-90'>{detail}</div> : null}
        </div>
      ) : null}
      {outcome === 'win' ? (
        <TicketPayoutBurst
          key={result.id ?? `${payout}:${stake}:${result.multiplier ?? 0}`}
          amount={payout}
          stake={stake}
          multiplier={result.multiplier}
          net={net}
          jackpot={result.jackpot}
          label='Payout'
          sound={sound}
        />
      ) : payout > 0 ? (
        <div className='rounded-panel border-2 border-ink bg-raised px-4 py-3 text-center text-strong shadow-chip' role='status'>
          <p className='text-[10px] font-black tracking-[0.14em] text-faint uppercase'>
            {outcome === 'push' ? 'Stake returned' : 'Partial return'}
          </p>
          <p className='arcade-num mt-0.5 text-xl font-black'>{payout.toLocaleString()} tickets</p>
          {outcome === 'partial' ? (
            <p className='mt-1 text-[11px] font-semibold text-danger-text'>
              −{Math.abs(net).toLocaleString()} net
            </p>
          ) : null}
        </div>
      ) : null}
      <RunAchievementReveal achievements={achievements} />
    </div>
  );
}

type ArcadeRunResultProps = {
  /**
   * What the run came to, one phrase in sentence case: "New best", "Run over".
   * There is no label over it (an eyebrow, AGENTS.md); a value that needs a
   * label goes in `stats`, or in `children`, which sits under the title.
   * Tone `best` sets it in red, the colour of a new best.
   */
  title: ReactNode;
  tone?: 'neutral' | 'win' | 'loss' | 'best';
  stats: ArcadeRunStat[];
  reward?: ArcadeRunReward | null;
  achievements?: ArcadeRunAchievement[];
  saving?: boolean;
  error?: string | null;
  guest?: boolean;
  /**
   * The buttons under the result. Rematch comes first: pass
   * `<ArcadeRematchButton onClick={playAgain} />`, then the rest as
   * `<ArcadeButton>` (paper 3). Under tixy, rematch (or anything carrying
   * `data-result-action="rematch"`) renders first and is live from the
   * first frame; the other actions fade in when the strip finishes or on
   * the first tap, and are inert until then.
   */
  actions?: ReactNode;
  /**
   * The way out, beside rematch and live with it: the floor by default. A
   * game with a lobby passes `{ label: 'lobby', href }` or
   * `{ label: 'lobby', onClick }`; `null` leaves it out.
   */
  back?: ResultBack | null;
  children?: ReactNode;
  /** Optional stubs above the total; see ArcadeRunRewards. */
  ticketLines?: TicketLine[];
  className?: string;
};

/**
 * The shared end of a skill game. Under tixy the card reveals in order, in
 * under 2 s: the outcome stamps in, the ticket strip prints and the host
 * brings it over (the tickets fly to the balance), the XP counts into the
 * level badge's bar, a level up punches the badge, the season bar fills,
 * then each achievement lands. A tap skips to the end and goes no further;
 * reduced motion shows the end at once. On a wide stage the rewards fill a
 * second column; on a phone the outcome comes first, then the rewards, then
 * the stats. Rematch is live from the first frame and never scrolls away.
 */
/** A link back (`href`) or an in-page step back (`onClick`), e.g. a lobby on the same page. */
export type ResultBack = { label: string; href: string } | { label: string; onClick: () => void };

/** Where a result goes back to when the game doesn't say: the floor. */
export const FLOOR_BACK: ResultBack = { href: '/', label: 'floor' };

/** The way out of a result: a secondary button, live from the first frame. */
export function ArcadeResultBackButton({ back }: { back: ResultBack }) {
  if ('onClick' in back) {
    return (
      <ArcadeButton
        size='lg'
        data-result-action='back'
        onPointerDown={(event: PointerEvent<HTMLButtonElement>) => event.stopPropagation()}
        onClick={(event: MouseEvent<HTMLButtonElement>) => {
          event.stopPropagation();
          back.onClick();
        }}
      >
        {back.label}
      </ArcadeButton>
    );
  }
  return (
    <ArcadeLinkButton
      href={back.href}
      size='lg'
      data-result-action='back'
      // Like rematch: a stage's own tap-to-restart doesn't fire as well.
      onPointerDown={(event) => event.stopPropagation()}
    >
      {back.label}
    </ArcadeLinkButton>
  );
}

export function ArcadeRunResult(props: ArcadeRunResultProps) {
  const tixy = useIsTixyTheme();
  return tixy ? <TixyRunResult {...props} /> : <MidwayRunResult {...props} />;
}

/**
 * Rematch, as the first action of a result: primary (ink), "rematch" by
 * default. Its pointerdown, click and Space/Enter keydown stop at the
 * button, so a stage's own tap-to-restart or a window keydown listener
 * doesn't fire as well.
 */
export function ArcadeRematchButton({
  children = 'rematch',
  onPointerDown,
  onClick,
  onKeyDown,
  ...props
}: Omit<ComponentPropsWithoutRef<typeof ArcadeButton>, 'tone'>) {
  return (
    <ArcadeButton
      size='lg'
      {...props}
      tone='primary'
      data-result-action='rematch'
      onPointerDown={(event: PointerEvent<HTMLButtonElement>) => {
        event.stopPropagation();
        onPointerDown?.(event);
      }}
      onClick={(event: MouseEvent<HTMLButtonElement>) => {
        event.stopPropagation();
        onClick?.(event);
      }}
      onKeyDown={(event: KeyboardEvent<HTMLButtonElement>) => {
        if (event.key === ' ' || event.key === 'Enter') event.stopPropagation();
        onKeyDown?.(event);
      }}
    >
      {children}
    </ArcadeButton>
  );
}

/** Flatten fragments so each action is one element. */
function flattenActions(node: ReactNode): ReactNode[] {
  return Children.toArray(node).flatMap((child) =>
    isValidElement<{ children?: ReactNode }>(child) && child.type === Fragment
      ? flattenActions(child.props.children)
      : [child],
  );
}

function isRematch(node: ReactNode) {
  return (
    isValidElement<Record<string, unknown>>(node) &&
    (node.type === ArcadeRematchButton || node.props['data-result-action'] === 'rematch')
  );
}

/** Decimal places in a stat, so 12.5 counts as 12.5 and not 13. */
function decimalsOf(value: number) {
  if (!Number.isFinite(value) || Number.isInteger(value)) return 0;
  return Math.min(4, (String(value).split('.')[1] ?? '').length);
}

function CountingStat({ value, clock }: { value: number; clock: ResultClock }) {
  const [started, setStarted] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setStarted(true), STRIP_TIMING.statsAt);
    return () => window.clearTimeout(timer);
  }, []);
  const decimals = decimalsOf(value);
  const jump = clock.instant || clock.skipped;
  const shown = useRollingNumber(started || jump ? value : 0, {
    duration: jump ? 0 : STRIP_TIMING.statsMs,
    decimals,
  });
  return <Num value={shown} decimals={decimals} labelValue={value} />;
}

function TixyRunResult({
  title,
  tone = 'neutral',
  stats,
  reward,
  achievements = [],
  saving = false,
  error,
  guest = false,
  actions,
  back = FLOOR_BACK,
  children,
  ticketLines,
  className,
}: ArcadeRunResultProps) {
  // Nothing to print (a run that saved nothing): the actions come up once
  // the stats have counted.
  const prints = saving || reward != null || guest;
  const clock = useResultClock({
    settleAt: prints ? STRIP_TIMING.actionsAt : STRIP_TIMING.statsAt + STRIP_TIMING.statsMs,
  });
  const tap = useSkipOnTap(clock);
  // The rewards fill a second column on a wide stage. A guest or a run with
  // neither XP nor achievements stays one column.
  const wide = !guest && !error && (saving || reward?.account != null || achievements.length > 0);
  return (
    <ResultClockProvider value={clock}>
      <section
        className={['arc-result-card', className].filter(Boolean).join(' ')}
        data-tone={tone}
        data-wide={wide || undefined}
        role='region'
        aria-label='Game results'
        {...tap}
      >
        <div className='arc-result-body'>
          <div className='arc-result-outcome'>
            <h2 className='arc-result-title'>{title}</h2>
            {children ? <div className='arc-result-extra'>{children}</div> : null}
          </div>
          {stats.length > 0 ? (
            <div
              className='arc-result-stats'
              style={{ gridTemplateColumns: `repeat(${Math.min(3, stats.length)}, minmax(0, 1fr))` }}
            >
              {stats.map((stat) => (
                <div key={stat.label} data-highlight={stat.highlight || undefined}>
                  <b>
                    {typeof stat.value === 'number' ? (
                      <CountingStat value={stat.value} clock={clock} />
                    ) : (
                      stat.value
                    )}
                  </b>
                  <small>{stat.label}</small>
                </div>
              ))}
            </div>
          ) : null}
          <ArcadeRunRewards
            reward={reward}
            achievements={achievements}
            saving={saving}
            error={error}
            guest={guest}
            ticketLines={ticketLines}
          />
        </div>
        {actions || back ? <ResultActions actions={actions} back={back} shown={clock.settled} /> : null}
      </section>
    </ResultClockProvider>
  );
}

/* Rematch first in the DOM, so focus order matches the row, then the way
   back; both are live from the first frame. The rest wait for the strip,
   inert while hidden. */
function ResultActions({
  actions,
  back,
  shown,
}: {
  actions?: ReactNode;
  back: ResultBack | null;
  shown: boolean;
}) {
  const all = flattenActions(actions);
  const rematch = all.filter(isRematch);
  const rest = all.filter((node) => !isRematch(node));
  return (
    <div className='arc-result-actions'>
      {rematch}
      {back ? <ArcadeResultBackButton back={back} /> : null}
      {rest.length > 0 ? (
        <div className='arc-result-actions-rest' data-shown={shown || undefined} inert={!shown}>
          {rest}
        </div>
      ) : null}
    </div>
  );
}

function MidwayRunResult({
  title,
  tone = 'neutral',
  stats,
  reward,
  achievements = [],
  saving = false,
  error,
  guest = false,
  actions,
  children,
  className,
}: ArcadeRunResultProps) {
  return (
    <section
      className={[
        'arc-run-result w-full max-w-md rounded-panel border-2 border-ink bg-panel p-4 text-center shadow-panel sm:p-5',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      data-tone={tone}
      role='region'
      aria-label='Game results'
    >
      <h2 className='arcade-display text-xl text-strong sm:text-2xl'>{title}</h2>
      <div className='mt-3 grid grid-cols-2 gap-2' style={{ gridTemplateColumns: `repeat(${Math.min(3, Math.max(1, stats.length))}, minmax(0, 1fr))` }}>
        {stats.map((stat) => (
          <div
            key={stat.label}
            className={`rounded-key border-2 border-ink px-2 py-2 ${stat.highlight ? 'bg-tickets text-tickets-on' : 'bg-well text-strong'}`}
          >
            <p className='text-[9px] font-black tracking-[0.13em] uppercase opacity-70'>{stat.label}</p>
            <p className='arcade-num arc-num-pop mt-0.5 truncate text-xl font-black tabular-nums'>{stat.value}</p>
          </div>
        ))}
      </div>
      {children ? <div className='mt-3'>{children}</div> : null}
      <ArcadeRunRewards
        reward={reward}
        achievements={achievements}
        saving={saving}
        error={error}
        guest={guest}
        className='mt-3'
      />
      {actions ? <div className='mt-4 flex flex-wrap justify-center gap-2'>{actions}</div> : null}
    </section>
  );
}
