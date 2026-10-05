import { Children, type CSSProperties, type ReactNode } from 'react';

import { change, fmtFigure, fmtPct } from './format';

/* Page primitives. Plain components with no server imports, so client
   screens can use them too. */

export function AdminPage({
  title,
  sub,
  tools,
  children,
}: {
  title: ReactNode;
  sub?: ReactNode;
  tools?: ReactNode;
  children: ReactNode;
}) {
  return (
    <>
      <header className='adm-topbar'>
        <h1>{title}</h1>
        {sub ? <span className='adm-topbar-sub'>{sub}</span> : null}
        {tools ? <div className='adm-topbar-tools'>{tools}</div> : null}
      </header>
      <div className='adm-content'>{children}</div>
    </>
  );
}

export function Panel({
  title,
  sub,
  tools,
  flush = false,
  className = '',
  id,
  children,
}: {
  title?: ReactNode;
  sub?: ReactNode;
  tools?: ReactNode;
  flush?: boolean;
  className?: string;
  id?: string;
  children: ReactNode;
}) {
  const headingId = id ? `${id}-title` : undefined;
  return (
    <section className={`adm-panel ${className}`} id={id} aria-labelledby={title ? headingId : undefined}>
      {title || sub || tools ? (
        <div className='adm-panel-head'>
          <div>
            {title ? <h2 id={headingId}>{title}</h2> : null}
            {sub ? <p>{sub}</p> : null}
          </div>
          {tools ? <div className='adm-panel-tools'>{tools}</div> : null}
        </div>
      ) : null}
      <div className='adm-panel-body' data-flush={flush || undefined}>
        {children}
      </div>
    </section>
  );
}

export function Grid({ cols, children }: { cols: '2' | '3' | '2-1'; children: ReactNode }) {
  return <div className='adm-grid' data-cols={cols}>{children}</div>;
}

export function Stats({ label, children }: { label: string; children: ReactNode }) {
  const n = Children.toArray(children).filter(Boolean).length || 1;
  return (
    <section className='adm-stats-wrap' aria-label={label}>
      <div className='adm-stats' data-many={n >= 8 || undefined} style={{ '--n': n, '--half': Math.ceil(n / 2) } as CSSProperties}>{children}</div>
    </section>
  );
}

/** Direction of good for a delta: up (runs, revenue) or down (flags). */
export type Good = 'up' | 'down' | 'neither';

export function Delta({ value, previous, good = 'up', label = 'vs previous' }: {
  value: number;
  previous: number | null | undefined;
  good?: Good;
  label?: string;
}) {
  const ratio = change(value, previous);
  if (ratio === null) return <span className='adm-delta'>no baseline</span>;
  const digits = Math.abs(ratio) >= 1 ? 0 : 1;
  const bad = good !== 'neither' && Math.abs(ratio) >= 0.005 && (good === 'up' ? ratio < 0 : ratio > 0);
  const arrow = ratio > 0.0005 ? '↑' : ratio < -0.0005 ? '↓' : '';
  return (
    <span className='adm-delta' data-bad={bad || undefined} title={`${label}: ${fmtFigure(previous ?? 0)}`}>
      {arrow} {fmtPct(Math.abs(ratio), digits)} <span className='adm-visually-hidden'>{label}</span>
    </span>
  );
}

export function Stat({
  label,
  value,
  unit,
  foot,
  tickets = false,
  title,
}: {
  label: ReactNode;
  value: ReactNode;
  unit?: string;
  foot?: ReactNode;
  tickets?: boolean;
  title?: string;
}) {
  return (
    <div className='adm-stat' data-tickets={tickets || undefined} title={title}>
      <span className='adm-stat-label'>{label}</span>
      <span className='adm-stat-value' data-unit={unit} data-text={typeof value === 'string' && !/\d/.test(value) ? true : undefined}>{value}</span>
      <span className='adm-stat-foot'>{foot}</span>
    </div>
  );
}

export function Empty({ title, children }: { title: ReactNode; children?: ReactNode }) {
  return (
    <div className='adm-empty' role='status'>
      <strong>{title}</strong>
      {children ? <p>{children}</p> : null}
    </div>
  );
}

export function Skeleton({ width = '100%', height = 14 }: { width?: number | string; height?: number }) {
  return <span className='adm-skel' style={{ width, height }} aria-hidden='true' />;
}

/** A loading page: the same frame as the page it stands in for. */
export function PageSkeleton({ title, panels = 3, stats = 5 }: { title: string; panels?: number; stats?: number }) {
  return (
    <AdminPage title={title} sub={<span aria-live='polite'>Loading.</span>}>
      <div className='adm-stats' aria-hidden='true' style={{ '--n': stats } as CSSProperties}>
        {Array.from({ length: stats }, (_, index) => (
          <div key={index} className='adm-stat'>
            <Skeleton width={90} height={12} />
            <Skeleton width={70} height={30} />
            <Skeleton width={110} height={12} />
          </div>
        ))}
      </div>
      {Array.from({ length: panels }, (_, index) => (
        <div key={index} className='adm-panel' aria-hidden='true' style={{ padding: 16, display: 'grid', gap: 10 }}>
          <Skeleton width={160} height={14} />
          <Skeleton height={index === 0 ? 180 : 96} />
        </div>
      ))}
    </AdminPage>
  );
}

export function Note({ tone, children }: { tone?: 'alert'; children: ReactNode }) {
  return <div className='adm-note' data-tone={tone} role={tone === 'alert' ? 'alert' : undefined}>{children}</div>;
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className='adm-kbd'>{children}</kbd>;
}
