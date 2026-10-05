import type { ReactNode } from 'react';

import { fmtInt } from './format';

/* Label, value, and a thin bar under them. For ranked breakdowns where a
   chart would only restate the numbers: sources, sinks, top games. */

export function BarList({
  items,
  tone,
  label,
  format = fmtInt,
}: {
  items: { key: string; label: ReactNode; value: number; detail?: ReactNode }[];
  tone?: 'ticket';
  label: string;
  format?: (value: number) => string;
}) {
  const max = Math.max(1, ...items.map((item) => Math.abs(item.value)));
  return (
    <ul className='adm-barlist' data-tone={tone} aria-label={label}>
      {items.map((item) => (
        <li key={item.key}>
          <span>{item.label}</span>
          <span>
            {format(item.value)}
            {item.detail ? <span className='adm-sub' style={{ color: 'var(--adm-ink-3)', marginLeft: 8, fontSize: 12 }}>{item.detail}</span> : null}
          </span>
          <span className='adm-barlist-track' aria-hidden='true'>
            <i style={{ width: `${(Math.abs(item.value) / max) * 100}%` }} />
          </span>
        </li>
      ))}
    </ul>
  );
}

export function Meter({ ratio, tickets = false, label }: { ratio: number | null; tickets?: boolean; label?: string }) {
  const width = ratio == null || !Number.isFinite(ratio) ? 0 : Math.max(0, Math.min(1, ratio)) * 100;
  return (
    <span className='adm-meter' data-tickets={tickets || undefined} role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      <i style={{ width: `${width}%` }} />
    </span>
  );
}
