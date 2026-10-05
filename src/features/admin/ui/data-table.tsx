'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ArrowDown, ArrowUp } from 'lucide-react';

import { Empty } from './page';

/* One table for the console. Cells arrive rendered, with a sort value per
   cell, so a server page can build a table without passing functions to the
   client. Sorting, the text filter and paging run here, over the rows the
   page loaded; tables that page on the server (users, the audit log, a
   ledger) pass `paged={false}` and render their own "load more". */

export type Column = {
  label: string;
  align?: 'left' | 'right';
  /** Not sortable when false. */
  sortable?: boolean;
  /** First click sorts this way. Numbers usually want 'desc'. */
  firstDir?: 'asc' | 'desc';
  /** Hidden from screen at narrow widths (phone). */
  minWidth?: number;
  title?: string;
};

export type Row = {
  key: string;
  cells: ReactNode[];
  /** One per column; null sorts last. */
  sort?: (string | number | null)[];
  /** Text the filter box matches against. */
  search?: string;
  href?: string;
  /** Per-cell flags. */
  muted?: number[];
  alert?: number[];
  wrap?: number[];
};

export type DataTableProps = {
  columns: Column[];
  rows: Row[];
  caption: string;
  /** Initial sort column and direction. */
  sortBy?: number;
  sortDir?: 'asc' | 'desc';
  filter?: boolean | string;
  pageSize?: number;
  paged?: boolean;
  empty?: ReactNode;
  emptyTitle?: string;
  onRowClick?: (row: Row) => void;
  activeKey?: string | null;
  toolbar?: ReactNode;
  scroll?: boolean;
  footer?: ReactNode;
};

function compare(a: string | number | null | undefined, b: string | number | null | undefined) {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b), 'en', { numeric: true, sensitivity: 'base' });
}

export function DataTable({
  columns,
  rows,
  caption,
  sortBy,
  sortDir = 'desc',
  filter = false,
  pageSize = 25,
  paged = true,
  empty,
  emptyTitle = 'Nothing here yet.',
  onRowClick,
  activeKey = null,
  toolbar,
  scroll = false,
  footer,
}: DataTableProps) {
  const router = useRouter();
  const [sort, setSort] = useState<{ col: number; dir: 'asc' | 'desc' } | null>(
    sortBy === undefined ? null : { col: sortBy, dir: sortDir },
  );
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const [size, setSize] = useState(pageSize);
  const [focus, setFocus] = useState(-1);
  const body = useRef<HTMLTableSectionElement>(null);

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return rows;
    return rows.filter((row) => (row.search ?? '').toLowerCase().includes(term));
  }, [query, rows]);

  const sorted = useMemo(() => {
    if (!sort) return filtered;
    const list = [...filtered];
    list.sort((a, b) => {
      const result = compare(a.sort?.[sort.col], b.sort?.[sort.col]);
      const aNull = a.sort?.[sort.col] == null;
      const bNull = b.sort?.[sort.col] == null;
      if (aNull || bNull) return result; // nulls last either way
      return sort.dir === 'asc' ? result : -result;
    });
    return list;
  }, [filtered, sort]);

  const pages = paged ? Math.max(1, Math.ceil(sorted.length / size)) : 1;
  const current = Math.min(page, pages - 1);
  const visible = paged ? sorted.slice(current * size, current * size + size) : sorted;
  const interactive = Boolean(onRowClick) || rows.some((row) => row.href);

  useEffect(() => {
    setPage(0);
  }, [query, size, rows]);

  const open = (row: Row) => {
    if (onRowClick) onRowClick(row);
    else if (row.href) router.push(row.href);
  };

  const focusRow = (index: number) => {
    const clamped = Math.max(0, Math.min(visible.length - 1, index));
    setFocus(clamped);
    const element = body.current?.querySelectorAll<HTMLTableRowElement>('tr[data-row]')[clamped];
    element?.focus();
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (!interactive) return;
    if (event.key === 'j' || event.key === 'ArrowDown') {
      event.preventDefault();
      focusRow(focus + 1);
    } else if (event.key === 'k' || event.key === 'ArrowUp') {
      event.preventDefault();
      focusRow(focus - 1);
    } else if (event.key === 'Enter' && focus >= 0 && visible[focus]) {
      event.preventDefault();
      open(visible[focus]);
    } else if (event.key === 'PageDown' && paged && current < pages - 1) {
      event.preventDefault();
      setPage(current + 1);
    } else if (event.key === 'PageUp' && paged && current > 0) {
      event.preventDefault();
      setPage(current - 1);
    }
  };

  const showBar = Boolean(filter) || Boolean(toolbar);

  return (
    <div>
      {showBar ? (
        <div className='adm-table-bar'>
          {filter ? (
            <input
              className='adm-input'
              type='search'
              placeholder={typeof filter === 'string' ? filter : 'filter'}
              aria-label={`Filter ${caption}`}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              style={{ width: 220 }}
            />
          ) : null}
          {toolbar}
        </div>
      ) : null}
      <div className='adm-table-wrap' data-scroll={scroll || undefined}>
        <table className='adm-table' onKeyDown={onKeyDown}>
          <caption className='adm-visually-hidden'>{caption}</caption>
          <thead>
            <tr>
              {columns.map((column, index) => {
                const active = sort?.col === index;
                const ariaSort = active ? (sort!.dir === 'asc' ? 'ascending' : 'descending') : undefined;
                const sortable = column.sortable !== false && rows.some((row) => row.sort?.[index] !== undefined);
                return (
                  <th key={column.label + index} scope='col' data-align={column.align} aria-sort={ariaSort} title={column.title} style={column.minWidth ? { minWidth: column.minWidth } : undefined}>
                    {sortable ? (
                      <button
                        type='button'
                        onClick={() =>
                          setSort((previous) =>
                            previous?.col === index
                              ? { col: index, dir: previous.dir === 'asc' ? 'desc' : 'asc' }
                              : { col: index, dir: column.firstDir ?? (column.align === 'right' ? 'desc' : 'asc') },
                          )
                        }
                      >
                        {column.label}
                        {active ? (sort!.dir === 'asc' ? <ArrowUp size={11} strokeWidth={2.5} aria-hidden /> : <ArrowDown size={11} strokeWidth={2.5} aria-hidden />) : null}
                      </button>
                    ) : (
                      column.label
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody ref={body}>
            {visible.map((row, rowIndex) => (
              <tr
                key={row.key}
                data-row
                data-interactive={interactive || undefined}
                data-active={activeKey === row.key || undefined}
                tabIndex={interactive ? (rowIndex === Math.max(0, focus) ? 0 : -1) : undefined}
                onClick={interactive ? () => open(row) : undefined}
                onFocus={() => setFocus(rowIndex)}
              >
                {row.cells.map((cell, cellIndex) => (
                  <td
                    key={cellIndex}
                    data-align={columns[cellIndex]?.align}
                    data-muted={row.muted?.includes(cellIndex) || undefined}
                    data-alert={row.alert?.includes(cellIndex) || undefined}
                    data-wrap={row.wrap?.includes(cellIndex) || undefined}
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {!visible.length ? (empty ?? <Empty title={query ? 'No rows match the filter.' : emptyTitle} />) : null}
      </div>
      {paged && sorted.length > Math.min(size, 25) ? (
        <div className='adm-table-foot'>
          <span>
            {current * size + 1} to {Math.min(sorted.length, current * size + size)} of {sorted.length.toLocaleString('en-US')}
            {query ? ` (filtered from ${rows.length.toLocaleString('en-US')})` : ''}
          </span>
          <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <label className='adm-visually-hidden' htmlFor={`adm-size-${caption}`}>Rows per page</label>
            <select id={`adm-size-${caption}`} className='adm-select' value={size} onChange={(event) => setSize(Number(event.target.value))} style={{ minHeight: 26 }}>
              {[25, 50, 100].map((option) => <option key={option} value={option}>{option} a page</option>)}
            </select>
            <button type='button' className='adm-btn' data-size='sm' disabled={current === 0} onClick={() => setPage(current - 1)}>previous</button>
            <button type='button' className='adm-btn' data-size='sm' disabled={current >= pages - 1} onClick={() => setPage(current + 1)}>next</button>
          </span>
        </div>
      ) : footer ? (
        <div className='adm-table-foot'>{footer}</div>
      ) : null}
    </div>
  );
}
