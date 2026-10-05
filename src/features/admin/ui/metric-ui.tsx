import Link from 'next/link';

import type { GameRef, Kpi, MetricWindow } from '@/server/admin/metrics/types';

import { fmtFigure, fmtTime } from './format';
import { Delta, Stat, type Good } from './page';
import { WindowTabs } from './window-tabs';

/* Pieces every metrics page shares. */

export function parseDays(value: string | string[] | undefined): number {
  const days = Number(Array.isArray(value) ? value[0] : value);
  return days === 7 || days === 90 ? days : 30;
}

export function WindowTools({ path, window }: { path: string; window: MetricWindow }) {
  return (
    <>
      <span className='adm-topbar-sub' title='Days are UTC. Today is partial.'>
        {window.rolledAt ? `updated ${fmtTime(window.rolledAt)} UTC` : 'not rolled up yet'}
      </span>
      <WindowTabs path={path} days={window.days} />
    </>
  );
}

export function KpiStat({
  label,
  kpi,
  good = 'up',
  tickets = false,
  format = fmtFigure,
  unit,
  title,
}: {
  label: string;
  kpi: Kpi;
  good?: Good;
  tickets?: boolean;
  format?: (value: number) => string;
  unit?: string;
  title?: string;
}) {
  return (
    <Stat
      label={label}
      value={format(kpi.value)}
      unit={unit}
      tickets={tickets}
      title={title}
      foot={kpi.previous == null ? <span className='adm-delta'>no baseline</span> : <><Delta value={kpi.value} previous={kpi.previous} good={good} /> <span>vs {format(kpi.previous)}</span></>}
    />
  );
}

export function GameName({ game }: { game: GameRef }) {
  return (
    <span title={game.key}>
      {game.title}
      {game.slug === null ? <span className='adm-sub'> {game.key}</span> : null}
    </span>
  );
}

export function PlayerLink({ id, name }: { id: string | null; name: string | null }) {
  if (!id) return <span>{name ?? 'guest'}</span>;
  if (id.startsWith('guest:')) return <span className='adm-sub'>guest</span>;
  return (
    <Link href={`/admin/users?user=${encodeURIComponent(id)}`} style={{ textDecoration: 'underline', textDecorationColor: 'var(--adm-line-strong)', textUnderlineOffset: 3 }}>
      {name ?? id.slice(0, 8)}
    </Link>
  );
}

export const GROUP_LABEL: Record<string, string> = {
  'with-friends': 'with friends',
  boardwalk: 'boardwalk',
  'quick-play': 'quick play',
  'ticket-machines': 'ticket machines',
  daily: 'daily',
};

/** A sequential cell: one hue, darker for more. For cohort grids. */
export function heat(ratio: number | null): React.CSSProperties {
  if (ratio == null) return {};
  const alpha = Math.max(0.04, Math.min(1, ratio)) * 0.85;
  return {
    background: `rgb(31 26 22 / ${alpha.toFixed(3)})`,
    color: alpha > 0.42 ? 'var(--adm-ground)' : 'var(--adm-ink)',
  };
}
