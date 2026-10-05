import {
  Coins,
  ShieldAlert,
  type LucideIcon,
} from 'lucide-react';

type UserWalletSummary = {
  credits: number;
};

type UserGameBanSummary = {
  isBanned: boolean;
  isIndefinite: boolean;
  bannedUntil: number | null;
  reason: string | null;
  remainingMs: number;
};

type UserSummaryMetricsProps = {
  wallet: UserWalletSummary;
  gameBan: UserGameBanSummary;
  className?: string;
  surface?: 'section' | 'inset';
};

const formatCount = (value: number) =>
  new Intl.NumberFormat('en-US').format(value);

const formatDateTime = (value: number | null) => {
  if (!value) return null;
  return new Date(value).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: false,
  });
};

const formatRemaining = (ms: number) => {
  const totalMinutes = Math.max(1, Math.ceil(ms / 60000));
  if (totalMinutes >= 1440) {
    const days = Math.ceil(totalMinutes / 1440);
    return `${days}d left`;
  }
  if (totalMinutes >= 60) {
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return minutes > 0 ? `${hours}h ${minutes}m left` : `${hours}h left`;
  }
  return `${totalMinutes}m left`;
};

function SummaryMetricCard({
  label,
  value,
  detail,
  icon: Icon,
  tone = 'neutral',
  surface = 'section',
}: {
  label: string;
  value: string;
  detail: string;
  icon: LucideIcon;
  tone?: 'neutral' | 'warning' | 'danger';
  surface?: 'section' | 'inset';
}) {
  const surfaceClass =
    surface === 'inset' ? 'inset-shadow-well bg-well' : 'bg-panel shadow-chip';
  const toneClass =
    tone === 'danger'
      ? `border-danger ${surfaceClass}`
      : tone === 'warning'
        ? `border-tickets ${surfaceClass}`
        : `border-soft ${surfaceClass}`;

  return (
    <div className={`rounded-panel border px-4 py-4 ${toneClass}`}>
      <div className='flex items-start justify-between gap-3'>
        <div>
          <p className='text-[11px] font-medium uppercase tracking-[0.16em] text-faint'>
            {label}
          </p>
          <p className='mt-2 text-lg font-semibold text-strong'>{value}</p>
          <p className='mt-1 text-xs text-faint'>{detail}</p>
        </div>
        <div className='rounded-lg bg-primary/10 p-2 text-primary'>
          <Icon className='h-4 w-4' />
        </div>
      </div>
    </div>
  );
}

export function UserSummaryMetrics({
  wallet,
  gameBan,
  className,
  surface = 'section',
}: UserSummaryMetricsProps) {
  const banValue = gameBan.isBanned
    ? gameBan.isIndefinite
      ? 'Indefinite ban'
      : 'Temporary ban'
    : 'Clear';
  const banDetail = gameBan.isBanned
    ? gameBan.isIndefinite
      ? gameBan.reason?.trim() || 'No automatic expiry'
      : `${formatRemaining(gameBan.remainingMs)}${gameBan.bannedUntil ? ` · until ${formatDateTime(gameBan.bannedUntil)}` : ''}`
    : '';
  const classes = ['grid gap-3', className].filter(Boolean).join(' ');

  return (
    <div className={classes}>
      <SummaryMetricCard
        label='Tickets'
        value={formatCount(wallet.credits)}
        detail=''
        icon={Coins}
        surface={surface}
      />
      <SummaryMetricCard
        label='Ban Status'
        value={banValue}
        detail={banDetail}
        icon={ShieldAlert}
        tone={gameBan.isBanned ? 'danger' : 'neutral'}
        surface={surface}
      />
    </div>
  );
}
