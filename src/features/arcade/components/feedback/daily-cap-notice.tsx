import { ArcadeStub } from '@/features/arcade/components/ui/arcade-ui';
import { Num } from '@/features/arcade/components/ui/num';

/**
 * What the daily ticket cap held back from a run. Pass what the run wanted
 * and what it paid (`wantedRunTickets(reward)`, `awardedRunTickets(reward)`);
 * it renders nothing when the cap held nothing back. The held-back tickets
 * print on a void stub, so it reads as tickets that didn't arrive.
 */
export function DailyCapNotice({
  wanted,
  awarded,
  cap,
  className,
}: {
  wanted: number;
  awarded: number;
  /** Today's cap, when the caller knows it. */
  cap?: number | null;
  className?: string;
}) {
  const heldBack = Math.max(0, Math.floor(wanted) - Math.floor(awarded));
  if (heldBack <= 0) return null;
  const reached = awarded <= 0;
  return (
    <p className={['tx-cap', className].filter(Boolean).join(' ')} role='note'>
      <ArcadeStub size='sm' muted>
        <Num value={heldBack} labelSuffix='tickets held back' />
      </ArcadeStub>
      <span>
        {reached
          ? 'Daily cap reached. Your score and achievements still count.'
          : cap
            ? <>Held back by today&apos;s cap of <Num value={cap} /> tickets.</>
            : 'Held back by the daily cap.'}
      </span>
    </p>
  );
}
