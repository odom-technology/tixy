'use client';

import Link from 'next/link';
import { Fragment, useCallback, useEffect, useRef, useState } from 'react';

import { fmtInt, fmtTime } from '@/features/admin/ui/format';
import { AdminPage, Empty, Note, Panel } from '@/features/admin/ui/page';
import type { AuditListResult, AuditRow } from '@/server/admin/audit';

const RANGES = [
  { id: '1', label: 'today', days: 1 },
  { id: '7', label: '7 days', days: 7 },
  { id: '30', label: '30 days', days: 30 },
  { id: 'all', label: 'all', days: 0 },
];

function since(days: number) {
  if (!days) return null;
  const now = new Date();
  const midnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return midnight - (days - 1) * 86_400_000;
}

function detailText(value: unknown) {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return value.join(', ');
  return String(value);
}

export function AuditClient({ initial }: { initial: AuditListResult | null }) {
  const [list, setList] = useState<AuditListResult | null>(initial);
  const [error, setError] = useState<string | null>(initial ? null : 'The audit log did not load.');
  const [loading, setLoading] = useState(false);
  const [actor, setActor] = useState('');
  const [action, setAction] = useState('');
  const [target, setTarget] = useState('');
  const [range, setRange] = useState('all');
  const [refused, setRefused] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const first = useRef(true);

  const params = useCallback(() => {
    const query = new URLSearchParams({ limit: '50' });
    if (actor.trim()) query.set('actor', actor.trim());
    if (action.trim()) query.set('action', `${action.trim().replace(/\*$/, '')}*`);
    if (target.trim()) query.set('targetId', target.trim());
    const from = since(RANGES.find((r) => r.id === range)?.days ?? 0);
    if (from) query.set('from', String(from));
    return query;
  }, [action, actor, range, target]);

  const load = useCallback(
    async (cursor: string | null) => {
      setLoading(true);
      try {
        const query = params();
        if (cursor) query.set('cursor', cursor);
        const response = await fetch(`/api/admin/audit?${query}`, { cache: 'no-store' });
        const data = (await response.json()) as AuditListResult & { error?: string };
        if (!response.ok) throw new Error(data.error ?? `The server answered ${response.status}.`);
        setList((previous) => (cursor && previous ? { ...data, rows: [...previous.rows, ...data.rows] } : data));
        setError(null);
      } catch (caught) {
        setError((caught as Error).message);
      } finally {
        setLoading(false);
      }
    },
    [params],
  );

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const timer = window.setTimeout(() => void load(null), 250);
    return () => window.clearTimeout(timer);
  }, [load]);

  const rows = (list?.rows ?? []).filter((row) => !refused || row.status >= 400);
  const csv = params();
  csv.set('format', 'csv');
  csv.delete('limit');

  return (
    <AdminPage
      title='Audit log'
      sub='Every admin write, newest first, refused ones included. Nothing can edit or clear it.'
      tools={<a className='adm-btn' href={`/api/admin/audit?${csv}`} download>export csv</a>}
    >
      {error ? <Note tone='alert'>{error}</Note> : null}
      <Panel flush>
        <div className='adm-table-bar' style={{ paddingTop: 12 }}>
          <input className='adm-input' type='search' placeholder='admin username or id' aria-label='Filter by admin' value={actor} onChange={(event) => setActor(event.target.value)} style={{ width: 190 }} />
          <input className='adm-input' type='search' placeholder='action, e.g. user.tickets' aria-label='Filter by action' value={action} onChange={(event) => setAction(event.target.value)} style={{ width: 200 }} />
          <input className='adm-input' type='search' placeholder='target id' aria-label='Filter by target id' value={target} onChange={(event) => setTarget(event.target.value)} style={{ width: 200 }} />
          <div className='adm-seg' role='group' aria-label='Time range'>
            {RANGES.map((option) => (
              <button key={option.id} type='button' aria-pressed={range === option.id} onClick={() => setRange(option.id)}>{option.label}</button>
            ))}
          </div>
          <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center', fontSize: 12, color: 'var(--adm-ink-2)' }}>
            <input type='checkbox' checked={refused} onChange={(event) => setRefused(event.target.checked)} /> refused only
          </label>
          {loading ? <span className='adm-topbar-sub' aria-live='polite'>Loading.</span> : null}
        </div>
        <div className='adm-table-wrap'>
          <table className='adm-table'>
            <caption className='adm-visually-hidden'>Audit log</caption>
            <thead>
              <tr>
                <th scope='col'>when (UTC)</th>
                <th scope='col'>admin</th>
                <th scope='col'>action</th>
                <th scope='col'>target</th>
                <th scope='col'>reason</th>
                <th scope='col' data-align='right'>result</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row: AuditRow) => {
                const expanded = open === row.id;
                const entries = Object.entries(row.details ?? {});
                return (
                  <Fragment key={row.id}>
                    <tr
                      data-interactive
                      data-active={expanded || undefined}
                      tabIndex={0}
                      aria-expanded={expanded}
                      onClick={() => setOpen(expanded ? null : row.id)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          setOpen(expanded ? null : row.id);
                        }
                      }}
                    >
                      <td data-muted>{fmtTime(row.createdAt)}</td>
                      <td>{row.actorName ?? row.actorUserId.slice(0, 8)}</td>
                      <td>{row.action}</td>
                      <td>
                        {row.targetType === 'user' && row.targetId ? (
                          <Link href={`/admin/users?user=${encodeURIComponent(row.targetId)}`} onClick={(event) => event.stopPropagation()} style={{ textDecoration: 'underline', textUnderlineOffset: 3 }}>
                            {row.targetName ?? row.targetId.slice(0, 8)}
                          </Link>
                        ) : row.targetId && !row.action.endsWith(row.targetId) ? (
                          <span>{row.targetType ? `${row.targetType} ` : ''}{row.targetId}</span>
                        ) : (
                          <span className='adm-sub'>{row.targetType ?? 'none'}</span>
                        )}
                      </td>
                      <td data-wrap style={{ maxWidth: 360 }}>{row.reason ?? ''}</td>
                      <td data-align='right' data-alert={row.status >= 400 || undefined}>{row.status >= 400 ? `refused ${row.status}` : 'done'}</td>
                    </tr>
                    {expanded ? (
                      <tr>
                        <td colSpan={6} style={{ height: 'auto', padding: '10px 16px 14px', background: 'var(--adm-ground)', whiteSpace: 'normal' }}>
                          <dl className='adm-dl'>
                            <dt>route</dt><dd>{row.method} {row.route}</dd>
                            {row.correlationId ? <><dt>request</dt><dd className='num' style={{ fontSize: 12 }}>{row.correlationId}</dd></> : null}
                            {entries.length ? entries.map(([key, value]) => (
                              <Fragment key={key}><dt>{key}</dt><dd>{detailText(value)}</dd></Fragment>
                            )) : <><dt>details</dt><dd>none recorded</dd></>}
                          </dl>
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
          {!rows.length ? <Empty title='Nothing recorded for these filters.'>Admin writes fill this log. Empty means none match.</Empty> : null}
        </div>
        {list ? (
          <div className='adm-table-foot'>
            <span>{fmtInt(list.rows.length)} of {fmtInt(list.total)}</span>
            {list.nextCursor ? <button type='button' className='adm-btn' data-size='sm' disabled={loading} onClick={() => void load(list.nextCursor)}>load 50 more</button> : null}
          </div>
        ) : null}
      </Panel>
    </AdminPage>
  );
}
