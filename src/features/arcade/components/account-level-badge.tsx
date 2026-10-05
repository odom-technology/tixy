import { LevelBadge } from '@/features/brand/avatars/level-badge';
import type { LevelTier } from '@/server/arcade/levels';

type AccountLevelBadgeProps = {
  level: number;
  into: number;
  need: number;
  /** Accepted for older callers. The badge's rim and colour come from the
   *  level itself, and the band's name is never shown. */
  tier?: LevelTier;
  /** Hide the thin XP-to-next bar (e.g. tight leaderboard rows). */
  showBar?: boolean;
  className?: string;
};

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(' ');
}

/**
 * The account level: the SVG level badge with the number on it, "Level 6",
 * and an optional bar with the XP to the next level. Pure presentational, so
 * it renders in server (profile) and client (leaderboard) trees.
 */
export function AccountLevelBadge({
  level,
  into,
  need,
  showBar = true,
  className,
}: AccountLevelBadgeProps) {
  const pct = need > 0 ? Math.max(0, Math.min(100, (into / need) * 100)) : 0;
  return (
    <div className={cx('flex min-w-0 items-center gap-2.5', className)}>
      <LevelBadge level={level} size={40} className='shrink-0' />
      <div className='min-w-0 flex-1'>
        <span className='text-sm font-bold text-strong'>Level {level.toLocaleString('en-US')}</span>
        {showBar ? (
          <>
            <div className='mt-1 h-1.5 w-full overflow-hidden rounded-full bg-panel'>
              <div className='h-full rounded-full bg-ink' style={{ width: `${pct}%` }} />
            </div>
            <p className='mt-0.5 text-[11px] tabular-nums text-faint'>
              {Math.max(0, need - into).toLocaleString('en-US')} xp to Level {(level + 1).toLocaleString('en-US')}
            </p>
          </>
        ) : null}
      </div>
    </div>
  );
}
