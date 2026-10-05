'use client';

import { useEffect, useId, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { Check, Copy } from 'lucide-react';

import { ArcadeButton } from '@/features/arcade/components/ui/arcade-ui';
import { Num, formatNum, useNumLocale } from '@/features/arcade/components/ui/num';
import {
  RECEIPT_TIMING as R,
  useCueTimers,
  useResultClock,
  useSkipOnTap,
} from '@/features/arcade/components/results/result-sequence';
import { SoundManager } from '@/features/arcade/lib/sound-manager';
import { getWagerCelebrationTier } from '@/features/arcade/lib/wager-celebration';
import {
  useReceiptFairness,
  type WagerFairness,
} from '@/features/arcade/lib/wager-fairness-store';

/* The receipt: what a wager prints (tixy theme). Stake, paid and net each
   get a line, so a 0.5× drop never reads as a win. The paper feeds out of
   the printer on one eased curve, the lines type in on a steady beat with a
   printer tick each, and the net lands last with one small settle (about
   1 s, RECEIPT_TIMING). The slip is laid out at its full height from the
   first frame and only its clip moves, so nothing around it shifts. Reduced
   motion fades the whole receipt in. A tap skips to the end. The last line
   is the round's seed with a copy button. The look is the mockup's
   `.receipt` / `.slip`.

   No hash or verify link yet: the server reveals the seed after the round
   but commits nothing before it, so a hash would prove nothing. Add verify
   once the server commits a salted hash up front.

   Several rounds on one receipt (plinko's drop 10): pass `rounds`. The
   stake, paid and net lines are the totals and print first, so the net is
   always in view. Under them each round prints a line with its multiplier,
   its seed and what it paid; past four, the first three show and the rest
   fold behind "7 more". The copy button copies every seed. The single seed
   line goes. */

/** One settled round on a receipt that carries several. */
export type WagerReceiptRound = {
  /** The server's multiplier for the round. */
  multiplier?: number | null;
  /** What the round paid, as settled. */
  payout: number;
  /** The round's revealed seed. */
  seed?: number | null;
};

export function WagerReceipt({
  sequenceKey,
  stake,
  payout,
  multiplier,
  jackpot,
  heading,
  headline,
  detail,
  fairness,
  rounds,
  roundNoun = 'rounds',
  sound,
  compact,
  footer,
  className,
}: {
  sequenceKey: string;
  stake: number;
  payout: number;
  multiplier?: number | null;
  jackpot?: boolean;
  heading?: ReactNode;
  headline?: ReactNode;
  detail?: ReactNode;
  /** The round's seed. Defaults to what ArcadeProvablyFair published. */
  fairness?: WagerFairness | null;
  /** Several rounds printed on one receipt, one line each with its seed. */
  rounds?: readonly WagerReceiptRound[];
  /** What a round is called in the list's name: `drops`, `spins`. */
  roundNoun?: string;
  /** Printer chatter and the payout cue. False keeps the receipt silent. */
  sound: boolean;
  compact?: boolean;
  /** Printed under the receipt once it has fed out (achievements). */
  footer?: ReactNode;
  className?: string;
}) {
  const id = useId();
  const hasHead = Boolean(heading || headline);
  const hasDetail = Boolean(detail);
  const published = useReceiptFairness();
  const proof = fairness === undefined ? published : fairness;
  const hasRounds = Boolean(rounds && rounds.length > 0);
  const hasSeed = !hasRounds && proof?.revealedSeed != null;

  // When each line types in: one beat apart, top to bottom, the net last.
  const plan = useMemo(() => {
    const order = [
      hasHead ? 'head' : null,
      hasDetail ? 'meta' : null,
      'stake',
      'paid',
      hasRounds ? 'rounds' : null,
      hasRounds ? 'seeds' : null,
      hasSeed ? 'seed' : null,
    ].filter((line): line is string => line != null);
    const at: Record<string, number> = {};
    order.forEach((line, index) => {
      at[line] = R.firstLineAt + index * R.beatMs;
    });
    const lastAt = R.firstLineAt + (order.length - 1) * R.beatMs;
    at.net = Math.max(lastAt + R.beatMs + R.netPauseMs, R.feedMs - R.netMs / 2);
    return { order, at, doneAt: at.net + R.netMs };
  }, [hasHead, hasDetail, hasRounds, hasSeed]);

  const clock = useResultClock({ settleAt: plan.doneAt });
  const tap = useSkipOnTap(clock);
  const net = payout - stake;
  const [finished, setFinished] = useState(false);
  const done = clock.instant || clock.skipped || finished;

  const cues = useMemo(() => {
    const tier = getWagerCelebrationTier({ amount: payout, stake, multiplier, net, jackpot });
    return [
      // One printer tick per line, on the beat.
      ...plan.order.map((line) => ({
        at: plan.at[line],
        run: () => {
          if (sound) SoundManager.play('receiptFeed');
        },
      })),
      {
        at: plan.at.net,
        run: () => {
          if (!sound) return;
          if (net > 0) {
            SoundManager.play(
              tier === 'jackpot' ? 'arcadeBigWin' : tier === 'big' ? 'arcadeCashout' : 'arcadeReveal',
            );
          } else {
            SoundManager.play('receiptFeed');
          }
        },
      },
      { at: plan.doneAt, run: () => setFinished(true) },
    ];
    // One plan per printed result.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sequenceKey]);
  useCueTimers(sequenceKey, cues, clock.skipped);

  const { setPrinting } = clock;
  useEffect(() => {
    setPrinting(id, !done);
    return () => setPrinting(id, false);
  }, [id, done, setPrinting]);

  const outcome = payout <= 0 ? 'loss' : net < 0 ? 'partial' : net === 0 ? 'push' : 'win';
  const locale = useNumLocale();
  const netText = formatNum(net, { signed: true, locale });
  const line = (name: string) =>
    ({ 'data-line': name, style: { '--at': `${plan.at[name] ?? 0}ms` } as CSSProperties }) as const;

  return (
    <div
      className={['arc-receipt', className].filter(Boolean).join(' ')}
      data-receipt=''
      // run: printing. done: printed, or skipped. A receipt under reduced
      // motion is done at once and fades in (data-motion).
      data-state={done ? 'done' : 'run'}
      data-motion={clock.instant ? 'reduce' : undefined}
      data-compact={compact || undefined}
      data-wager-outcome={outcome}
      style={{ '--feed': `${R.feedMs}ms`, '--net': `${R.netMs}ms`, '--fade': `${R.fadeMs}ms` } as CSSProperties}
      {...tap}
    >
      {/* Said once, when the receipt has printed. */}
      <p className='sr-only' aria-live='polite'>
        {done ? `Net ${netText} tickets.` : ''}
      </p>
      <div className='arc-receipt-printer' aria-hidden='true' />
      <div className='arc-receipt-shadow'>
        <div className='arc-receipt-slip'>
          {hasHead ? (
            <div className='arc-receipt-head' {...line('head')}>
              {heading ? <h3>{heading}</h3> : <span />}
              {headline ? <b className='arc-receipt-headline'>{headline}</b> : null}
            </div>
          ) : null}
          {hasDetail ? (
            <div className='arc-receipt-meta' {...line('meta')}>
              {detail}
            </div>
          ) : null}
          <dl>
            <dt {...line('stake')}>stake</dt>
            <dd {...line('stake')}>
              <Num value={stake} />
            </dd>
            <dt {...line('paid')}>paid</dt>
            <dd {...line('paid')}>
              <Num value={payout} />
            </dd>
            <dt className='arc-receipt-net' {...line('net')}>
              net
            </dt>
            <dd className='arc-receipt-net' {...line('net')}>
              <Num value={net} signed />
            </dd>
          </dl>
          {hasRounds && rounds ? (
            <>
              <div {...line('rounds')}>
                <RoundLines rounds={rounds} noun={roundNoun} />
              </div>
              <div {...line('seeds')}>
                <SeedsCopy rounds={rounds} />
              </div>
            </>
          ) : hasSeed && proof?.revealedSeed != null ? (
            <div {...line('seed')}>
              <SeedLine seed={proof.revealedSeed} />
            </div>
          ) : null}
        </div>
      </div>
      {footer && done ? <div className='arc-receipt-footer'>{footer}</div> : null}
    </div>
  );
}

/* One line per round, under the totals: multiplier, seed, paid. Past four
   lines, the first three show and the rest fold. */
const ROUNDS_SHOWN = 3;

function RoundLines({ rounds, noun }: { rounds: readonly WagerReceiptRound[]; noun: string }) {
  const [open, setOpen] = useState(false);
  const fold = rounds.length > ROUNDS_SHOWN + 1;
  const shown = fold && !open ? rounds.slice(0, ROUNDS_SHOWN) : rounds;
  const hidden = rounds.length - ROUNDS_SHOWN;
  return (
    <>
      <ol className='arc-receipt-rounds' aria-label={`${rounds.length} ${noun}`}>
        {shown.map((round, index) => (
          <li key={index}>
            <span className='arc-receipt-round-x'>
              {round.multiplier != null ? <Num value={`${round.multiplier}×`} label={`${round.multiplier} times`} /> : null}
            </span>
            <span className='arc-receipt-round-seed'>
              {round.seed != null ? <Num value={String(round.seed)} label={`seed ${round.seed}`} /> : null}
            </span>
            <span className='arc-receipt-round-paid'>
              <Num value={round.payout} label={`paid ${round.payout}`} />
            </span>
          </li>
        ))}
      </ol>
      {fold ? (
        <button type='button' className='arc-receipt-more' aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          {open ? 'fewer' : `${hidden} more`}
        </button>
      ) : null}
    </>
  );
}

/* Under the totals: one copy button for every seed, in round order. */
function SeedsCopy({ rounds }: { rounds: readonly WagerReceiptRound[] }) {
  const seeds = rounds.map((round) => round.seed).filter((seed): seed is number => seed != null);
  const [copied, setCopied] = useState(false);
  const copy = () => {
    void navigator.clipboard.writeText(seeds.join(', ')).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    });
  };
  if (seeds.length === 0) return null;
  return (
    <p className='arc-receipt-proof'>
      {seeds.length === 1 ? 'seed' : `${seeds.length} seeds`}
      <ArcadeButton size='icon-xs' onClick={copy} aria-label={copied ? 'Seeds copied' : 'Copy the seeds'}>
        {copied ? <Check size={14} strokeLinecap='square' aria-hidden /> : <Copy size={14} strokeLinecap='square' aria-hidden />}
      </ArcadeButton>
    </p>
  );
}

/* The seed the round used, with a copy button. */
function SeedLine({ seed }: { seed: number }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    void navigator.clipboard.writeText(String(seed)).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    });
  };
  return (
    <p className='arc-receipt-proof'>
      seed <Num value={String(seed)} />
      <ArcadeButton size='icon-xs' onClick={copy} aria-label={copied ? 'Seed copied' : 'Copy the seed'}>
        {copied ? <Check size={14} strokeLinecap='square' aria-hidden /> : <Copy size={14} strokeLinecap='square' aria-hidden />}
      </ArcadeButton>
    </p>
  );
}
