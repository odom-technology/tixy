import Link from 'next/link';
import type { ReactNode } from 'react';

import { AdminPage } from '@/features/admin/ui/page';

/* The frame Odom's console pages were built on. It keeps its props and now
   draws the console's page header, panel and stat, so every older page sits
   in the new shell without a rewrite. New pages use features/admin/ui. */

export function AdminConsoleFrame({ title, subtitle, actions, filters, children, className = '', contentClassName = '' }: {
  title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; filters?: ReactNode; children: ReactNode; className?: string; contentClassName?: string;
}) {
  return (
    <AdminPage title={title} sub={subtitle} tools={actions}>
      {filters ? <div className='min-w-0'>{filters}</div> : null}
      <div className={`min-w-0 ${className} ${contentClassName}`}>{children}</div>
    </AdminPage>
  );
}

export function ConsolePanel({ title, description, actions, className = '', children }: {
  title?: ReactNode; description?: ReactNode; actions?: ReactNode; className?: string; children: ReactNode;
}) {
  return (
    <section className={`adm-panel ${className}`}>
      {title || description || actions ? <div className='adm-panel-head'>
        <div>
          {title ? <h2>{title}</h2> : null}
          {description ? <p>{description}</p> : null}
        </div>
        {actions ? <div className='adm-panel-tools'>{actions}</div> : null}
      </div> : null}
      {children}
    </section>
  );
}

export function ConsoleMetric({ label, value, detail, loading = false }: {
  label: ReactNode; value: ReactNode; detail?: ReactNode; loading?: boolean;
}) {
  return <div className='adm-stat' style={{ borderRadius: 'var(--adm-radius)' }} aria-busy={loading || undefined}>
    <span className='adm-stat-label'>{label}</span>
    <span className='adm-stat-value'>{loading ? <span className='adm-skel' style={{ display: 'inline-block', width: 80, height: 28 }} aria-label='Loading' /> : value}</span>
    {detail ? <span className='adm-stat-foot'>{detail}</span> : null}
  </div>;
}

export function ConsoleTabs({ items, active, label }: {
  items: { id: string; label: string; href: string }[]; active: string; label: string;
}) {
  return <nav aria-label={label} className='adm-seg' style={{ flexWrap: 'wrap' }}>
    {items.map((item) => <Link key={item.id} href={item.href} aria-current={active === item.id ? 'page' : undefined}>
      {item.label}
    </Link>)}
  </nav>;
}
