'use client';

import { useCallback, useEffect, useState } from 'react';
import { Coins, Flame, Check, Sparkles, Gift } from 'lucide-react';
import type {
  DailyClaimResult,
  DailyClaimStatus,
} from '@/server/arcade/rewards/types';
import { ArcadeTicketDispenser } from '@/features/arcade/components/ui/arcade-interactive';
import { useGamesWallet } from '@/features/arcade/components/shell/games-wallet-provider';

type Props = {
  /** Visual density. Compact matches the mobile wallet card. */
  compact?: boolean;
  className?: string;
  /**
   * `pill` (default) — the inline wallet pill.
   * `dispenser` — the Midway balance panel + ticket dispenser. Delegates
   * the claim to the same API/handler; streak/cap/milestone logic is
   * unchanged. Reads the live ticket balance from the wallet provider, so
   * it must render inside a `GamesWalletProvider`.
   */
  variant?: 'pill' | 'dispenser';
};

type Phase = 'loading' | 'ready' | 'claimed' | 'unavailable' | 'claiming';

function unavailableLabel(
  reason: DailyClaimStatus['reason'],
  detail: string | null,
): string {
  if (reason === 'weekend') return 'Return Monday';
  if (reason === 'holiday') return detail ? `Closed · ${detail}` : 'Holiday';
  if (reason === 'blackout') return detail ? `Closed · ${detail}` : 'Off day';
  return 'Unavailable';
}

/* Dispenser visual for the daily claim. Lives in its own component so the
   wallet hook is only invoked for the dispenser variant (the pill variant
   may render outside a GamesWalletProvider). The claim itself is delegated
   to the shared handler — streak/cap/milestone logic stays untouched. */
function DailyClaimDispenser({
  status,
  phase,
  claimAmount,
  onClaim,
  className,
}: {
  status: DailyClaimStatus;
  phase: Phase;
  claimAmount: number;
  onClaim: () => Promise<void> | void;
  className?: string;
}) {
  const { wallet } = useGamesWallet();
  const claimed = phase === 'claimed';
  // Unavailable (weekend/holiday/blackout) keeps the dispenser but disables
  // the key with the reason as its label.
  const unavailable = phase === 'unavailable';
  const disabled = phase === 'claiming' || unavailable;
  const label = unavailable
    ? unavailableLabel(status.reason, status.detail)
    : phase === 'claiming'
      ? 'Claiming…'
      : undefined;

  return (
    <ArcadeTicketDispenser
      className={className}
      balance={wallet.credits}
      claimAmount={claimAmount}
      claimed={claimed}
      claimDisabled={disabled}
      claimLabel={label}
      onClaim={onClaim}
    />
  );
}

export function DailyClaimButton({
  compact = false,
  className,
  variant = 'pill',
}: Props) {
  const [status, setStatus] = useState<DailyClaimStatus | null>(null);
  const [phase, setPhase] = useState<Phase>('loading');
  const [error, setError] = useState<string | null>(null);
  const [justClaimed, setJustClaimed] = useState<DailyClaimResult | null>(null);

  /* ---------- Load status ---------- */
  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/games/daily-claim', { cache: 'no-store' });
      if (!res.ok) {
        setPhase('unavailable');
        return;
      }
      const data = (await res.json()) as DailyClaimStatus;
      setStatus(data);
      if (data.available) setPhase('ready');
      else if (data.claimed) setPhase('claimed');
      else setPhase('unavailable');
    } catch {
      setPhase('unavailable');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /* ---------- Claim ---------- */
  const handleClaim = useCallback(async () => {
    if (phase !== 'ready') return;
    setPhase('claiming');
    setError(null);
    try {
      const res = await fetch('/api/games/daily-claim', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error ?? 'Failed to claim.');
        setPhase('ready');
        return;
      }
      setJustClaimed(data as DailyClaimResult);
      setPhase('claimed');
      // Refresh status so streak/claimedReward updates
      void load();
      // Notify wallet displays to refresh
      window.dispatchEvent(new Event('store-inventory-updated'));
    } catch {
      setError('Network error.');
      setPhase('ready');
    }
  }, [phase, load]);

  /* ---------- Clear the brief "just claimed" burst after a few seconds ---------- */
  useEffect(() => {
    if (!justClaimed) return;
    const timer = setTimeout(() => setJustClaimed(null), 3500);
    return () => clearTimeout(timer);
  }, [justClaimed]);

  if (phase === 'loading' || !status) {
    return (
      <div
        className={`arcade-card-inset ${
          compact
            ? 'flex items-center justify-center px-3 py-3 text-xs'
            : 'px-4 py-3 text-sm'
        } ${className ?? ''}`}
      >
        <div
          className={`rounded-tag bg-raised ${compact ? 'h-4 w-16' : 'h-4 w-32'}`}
        />
      </div>
    );
  }

  /* ---------- Dispenser variant ---------- */
  if (variant === 'dispenser') {
    const dispenserAmount =
      (phase === 'claimed'
        ? status.claimedReward?.tickets ?? status.claimedReward?.credits
        : status.nextReward?.tickets ?? status.nextReward?.credits) ?? 50;
    return (
      <DailyClaimDispenser
        status={status}
        phase={phase}
        claimAmount={dispenserAmount}
        onClaim={() => void handleClaim()}
        className={className}
      />
    );
  }

  const streak = status.streak;
  const streakLabel = streak === 0 ? 'No streak yet' : `${streak}-day streak`;

  /* ---------- Already-claimed state ---------- */
  if (phase === 'claimed') {
    const claimedTickets =
      justClaimed?.ticketsAwarded ??
      justClaimed?.creditsAwarded ??
      status.claimedReward?.tickets ??
      status.claimedReward?.credits ??
      0;
    const isMilestone =
      justClaimed?.isMilestone ?? status.claimedReward?.isMilestone ?? false;

    return (
      <div
        className={`arcade-card-inset relative ${
          compact ? 'px-3 py-2 text-xs' : 'px-4 py-3 text-sm'
        } ${className ?? ''}`}
      >
        {compact ? (
          <>
            <div className='flex min-h-5 items-center'>
              <span className='inline-flex items-center gap-1 text-sm font-semibold text-prize-text'>
                <Check size={13} /> Claimed
              </span>
            </div>
            <div className='mt-2 flex items-center justify-between text-[11px] font-medium'>
              <span className='arcade-num inline-flex items-center text-prize-text'>
                +{claimedTickets}
              </span>
              <span className='arcade-num inline-flex items-center gap-1 text-tickets-text'>
                <Flame size={11} /> {streak}
              </span>
            </div>
            <div className='mt-2 h-1.5 w-full overflow-hidden rounded-full border border-ink bg-well'>
              <div className='h-full w-full rounded-full bg-prize' />
            </div>
          </>
        ) : (
          <>
            <div className='flex items-center justify-between gap-3'>
              <span className='inline-flex items-center gap-1.5 font-semibold text-prize-text'>
                <Check size={14} />
                Claimed today
              </span>
              <span className='arcade-num inline-flex items-center gap-1.5 font-semibold text-tickets-text'>
                <Flame size={13} />
                {streak}
              </span>
            </div>
            <div className='mt-1 flex flex-wrap items-baseline gap-1.5 text-xs'>
              <span className='arcade-num font-bold text-prize-text'>
                +{claimedTickets}
              </span>
              <span className='text-faint'>Tickets</span>
              {isMilestone && (
                <span className='inline-flex items-center gap-0.5 rounded-full border border-ink bg-tickets px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-tickets-on'>
                  <Sparkles size={9} /> Milestone
                </span>
              )}
            </div>
          </>
        )}
        {justClaimed && (
          <div className='pointer-events-none absolute'>
            {/* Coin burst animation — visually associated with the pill */}
          </div>
        )}
      </div>
    );
  }

  /* ---------- Unavailable state ---------- */
  if (phase === 'unavailable') {
    return (
      <div
        className={`arcade-card-inset text-faint ${
          compact ? 'px-3 py-2 text-xs' : 'px-4 py-3 text-sm'
        } ${className ?? ''}`}
      >
        {compact ? (
          <>
            <div className='flex min-h-5 items-center'>
              <span className='inline-flex items-center gap-1.5 text-sm font-medium'>
                <Gift size={14} />
                Daily reward
              </span>
            </div>
            <div className='mt-2 flex items-center justify-between gap-2 text-[11px] font-medium'>
              <span className='truncate'>
                {unavailableLabel(status.reason, status.detail)}
              </span>
              {streak > 0 ? (
                <span className='arcade-num inline-flex items-center gap-1 text-[11px] font-semibold text-tickets-text'>
                  <Flame size={11} /> {streak}
                </span>
              ) : (
                <span />
              )}
            </div>
            <div className='mt-2 h-1.5 w-full overflow-hidden rounded-full border border-ink bg-well' />
          </>
        ) : (
          <>
            <div className='flex items-center justify-between gap-3'>
              <span className='inline-flex items-center gap-1.5 font-medium'>
                <Gift size={14} />
                Daily reward
              </span>
              {streak > 0 && (
                <span className='arcade-num inline-flex items-center gap-1.5 font-semibold text-tickets-text'>
                  <Flame size={13} />
                  {streak}
                </span>
              )}
            </div>
            <p className='mt-1 text-xs'>
              {unavailableLabel(status.reason, status.detail)}
            </p>
          </>
        )}
      </div>
    );
  }

  /* ---------- Ready / Claiming state ---------- */
  const next = status.nextReward;
  const claimAmount = next?.tickets ?? next?.credits ?? 50;
  const nextIsMilestone = next?.isMilestone ?? false;

  return (
    <button
      type='button'
      onClick={() => void handleClaim()}
      disabled={phase === 'claiming'}
      className={`relative w-full rounded-key border-2 border-ink bg-tickets text-tickets-on shadow-[0_4px_0_var(--enamel-tickets-edge),0_6px_0_var(--shadow-color)] transition-[transform,box-shadow,filter] duration-[90ms] hover:brightness-107 active:translate-y-[3px] active:shadow-[0_1px_0_var(--enamel-tickets-edge),0_2px_0_var(--shadow-color)] disabled:cursor-wait disabled:opacity-70 ${
        compact ? 'px-3 py-2 text-xs' : 'px-4 py-3 text-left text-sm'
      } ${className ?? ''}`}
      aria-label='Claim daily reward'
    >
      {compact ? (
        <>
          <div className='relative flex min-h-5 items-center'>
            <span className='inline-flex items-center gap-1.5 text-sm font-bold'>
              <Gift size={14} />
              {phase === 'claiming' ? 'Claiming…' : 'Claim'}
            </span>
          </div>
          <div className='relative mt-2 flex items-center justify-between text-[11px] font-medium'>
            <span className='arcade-num inline-flex items-center font-bold'>
              +{claimAmount}
            </span>
            <span className='arcade-num inline-flex items-center gap-1 font-semibold'>
              <Flame size={11} /> {streak}
            </span>
          </div>
        </>
      ) : (
        <>
          <div className='relative flex items-center justify-between gap-3'>
            <span className='inline-flex items-center gap-1.5 font-bold'>
              <Gift size={14} />
              {phase === 'claiming' ? 'Claiming…' : 'Claim daily'}
            </span>
            <span className='arcade-num inline-flex items-center gap-1.5 font-semibold'>
              <Flame size={13} />
              {streak}
            </span>
          </div>

          <div className='relative mt-1 flex flex-wrap items-baseline gap-1.5 text-xs'>
            <Coins size={12} />
            <span className='arcade-num font-bold'>+{claimAmount}</span>
            <span>Tickets</span>
            {nextIsMilestone && (
              <span className='inline-flex items-center gap-0.5 rounded-full border border-ink bg-key-face px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-key-face-on'>
                <Sparkles size={9} /> Milestone
              </span>
            )}
            <span className='ml-auto text-[10px] font-medium'>{streakLabel}</span>
          </div>
        </>
      )}

      {error && (
        <p className='relative mt-1 text-[10px] font-semibold'>{error}</p>
      )}
    </button>
  );
}
