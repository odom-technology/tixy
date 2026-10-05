'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';

import { DataTable } from '@/features/admin/ui/data-table';
import { Ago } from '@/features/admin/ui/ago';
import { fmtDate, fmtInt } from '@/features/admin/ui/format';
import { AdminPage, Note, Panel } from '@/features/admin/ui/page';
import type { AdminUserRow } from '@/server/admin/users';

import { UserSheet } from './_user-sheet';

type ListResult = { users: AdminUserRow[]; nextCursor: string | null; total: number };

const SORTS = [
  { id: 'created', label: 'newest' },
  { id: 'last_login', label: 'last seen' },
  { id: 'balance', label: 'balance' },
  { id: 'level', label: 'level' },
] as const;

export function UsersClient({
  currentUserId,
  initial,
  initialQuery,
  initialUser,
}: {
  currentUserId: string;
  initial: ListResult | null;
  initialQuery: string;
  initialUser: string | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [query, setQuery] = useState(initialQuery);
  const [status, setStatus] = useState('all');
  const [role, setRole] = useState('all');
  const [sort, setSort] = useState<(typeof SORTS)[number]['id']>('created');
  const [list, setList] = useState<ListResult | null>(initial);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(initial ? null : 'The user list did not load.');
  const openUser = searchParams.get('user') ?? initialUser;
  const first = useRef(true);
  const search = useRef<HTMLInputElement>(null);

  const load = useCallback(
    async (cursor: string | null) => {
      setLoading(true);
      try {
        const params = new URLSearchParams({ status, role, sort, dir: 'desc', limit: '50' });
        if (query.trim()) params.set('q', query.trim());
        if (cursor) params.set('cursor', cursor);
        const response = await fetch(`/api/admin/users?${params}`, { cache: 'no-store' });
        const data = (await response.json()) as ListResult & { error?: string };
        if (!response.ok) throw new Error(data.error ?? `The server answered ${response.status}.`);
        setList((previous) => (cursor && previous ? { ...data, users: [...previous.users, ...data.users] } : data));
        setError(null);
      } catch (caught) {
        setError((caught as Error).message);
      } finally {
        setLoading(false);
      }
    },
    [query, role, sort, status],
  );

  // Search as you type, 250 ms after the last key; filters apply at once.
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const timer = window.setTimeout(() => void load(null), 250);
    return () => window.clearTimeout(timer);
  }, [load]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (event.key === 'f' && !event.metaKey && !event.ctrlKey && target && !['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) && !document.querySelector('dialog[open]')) {
        event.preventDefault();
        search.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const setOpenUser = (id: string | null) => {
    const params = new URLSearchParams(searchParams.toString());
    if (id) params.set('user', id);
    else params.delete('user');
    router.replace(`${pathname}${params.size ? `?${params}` : ''}`, { scroll: false });
  };

  const onChanged = () => void load(null);

  return (
    <AdminPage title='Users' sub={list ? `${fmtInt(list.total)} accounts match.` : undefined}>
      {error ? <Note tone='alert'>{error}</Note> : null}
      <Panel flush>
        <div className='adm-table-bar' style={{ paddingTop: 12 }}>
          <input
            ref={search}
            className='adm-input'
            type='search'
            placeholder='username, email or account id'
            aria-label='Search accounts'
            aria-keyshortcuts='f'
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            style={{ width: 280 }}
          />
          <div className='adm-seg' role='group' aria-label='Status'>
            {['all', 'active', 'suspended', 'deleted'].map((option) => (
              <button key={option} type='button' aria-pressed={status === option} onClick={() => setStatus(option)}>{option}</button>
            ))}
          </div>
          <select className='adm-select' aria-label='Role' value={role} onChange={(event) => setRole(event.target.value)}>
            <option value='all'>every role</option>
            <option value='admin'>admins</option>
            <option value='player'>players</option>
          </select>
          <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center', color: 'var(--adm-ink-3)', fontSize: 12 }}>
            sort
            <select className='adm-select' value={sort} onChange={(event) => setSort(event.target.value as typeof sort)}>
              {SORTS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
            </select>
          </label>
          {loading ? <span className='adm-topbar-sub' aria-live='polite'>Loading.</span> : null}
        </div>
        <DataTable
          caption='Accounts'
          paged={false}
          activeKey={openUser}
          onRowClick={(row) => setOpenUser(row.key)}
          columns={[
            { label: 'player', sortable: false },
            { label: 'email', sortable: false, minWidth: 180 },
            { label: 'status', sortable: false },
            { label: 'level', align: 'right', sortable: false },
            { label: 'tickets', align: 'right', sortable: false },
            { label: 'bought', align: 'right', sortable: false },
            { label: 'joined', align: 'right', sortable: false },
            { label: 'last seen', align: 'right', sortable: false },
          ]}
          rows={(list?.users ?? []).map((user) => ({
            key: user.id,
            cells: [
              <span key='n'>
                {user.username ?? user.displayName}
                {user.roles.includes('admin') ? <span className='adm-sub'> admin</span> : null}
                {user.id === currentUserId ? <span className='adm-sub'> you</span> : null}
              </span>,
              user.email,
              user.status,
              fmtInt(user.level),
              fmtInt(user.tickets),
              fmtInt(user.boughtTickets),
              fmtDate(user.createdAt),
              <Ago key='a' ms={user.lastLoginAt} />,
            ],
            muted: [1, 6, 7],
            alert: user.status === 'suspended' ? [2] : [],
          }))}
          emptyTitle={query ? 'No account matches that search.' : 'No accounts yet.'}
          footer={
            list ? (
              <>
                <span>{fmtInt(list.users.length)} of {fmtInt(list.total)}</span>
                {list.nextCursor ? (
                  <button type='button' className='adm-btn' data-size='sm' disabled={loading} onClick={() => void load(list.nextCursor)}>load 50 more</button>
                ) : null}
              </>
            ) : null
          }
        />
      </Panel>
      {openUser ? <UserSheet userId={openUser} currentUserId={currentUserId} onClose={() => setOpenUser(null)} onChanged={onChanged} /> : null}
    </AdminPage>
  );
}
