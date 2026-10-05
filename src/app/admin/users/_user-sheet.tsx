'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';

import { DataTable } from '@/features/admin/ui/data-table';
import { fmtAgo, fmtDate, fmtDuration, fmtInt, fmtMoney, fmtSigned, fmtTime } from '@/features/admin/ui/format';
import { Empty, Note } from '@/features/admin/ui/page';
import { useToast } from '@/features/admin/ui/toast';
import type { getAdminUserProfile, listUserLedger } from '@/server/admin/users';

import { GrantItemDialog } from './_grant-item-dialog';
import { ActionDialog, type ActionField } from './_action-dialog';

type Profile = Awaited<ReturnType<typeof getAdminUserProfile>>;
type Ledger = Awaited<ReturnType<typeof listUserLedger>>;
type NonNull<T> = T extends null | undefined ? never : T;
type P = NonNull<Profile>;

type Action =
  | 'tickets'
  | 'ban'
  | 'unban'
  | 'suspend'
  | 'unsuspend'
  | 'delete'
  | 'restore'
  | 'grant-admin'
  | 'revoke-admin'
  | null;

async function send(url: string, method: string, body: unknown) {
  const response = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) throw new Error(data.error ?? `The server answered ${response.status}.`);
  return data;
}

const BAN_LENGTHS = [
  { id: '1h', label: '1 hour', hours: 1, minutes: 0 },
  { id: '6h', label: '6 hours', hours: 6, minutes: 0 },
  { id: 'max', label: '11 hours 59 minutes', hours: 11, minutes: 59 },
  { id: 'indefinite', label: 'until lifted', hours: 0, minutes: 0 },
];

const SUSPEND_LENGTHS = [
  { id: '24h', label: '24 hours', ms: 86_400_000 },
  { id: '7d', label: '7 days', ms: 7 * 86_400_000 },
  { id: 'indefinite', label: 'until lifted', ms: 0 },
];

function Section({ title, children, tools }: { title: string; children: React.ReactNode; tools?: React.ReactNode }) {
  return (
    <section style={{ display: 'grid', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>{title}</h3>
        {tools ? <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>{tools}</div> : null}
      </div>
      {children}
    </section>
  );
}

export function UserSheet({ userId, currentUserId, onClose, onChanged }: { userId: string; currentUserId: string; onClose: () => void; onChanged: () => void }) {
  const toast = useToast();
  const [profile, setProfile] = useState<P | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ledger, setLedger] = useState<Ledger | null>(null);
  const [ledgerKind, setLedgerKind] = useState<'all' | 'earned' | 'bought'>('all');
  const [ledgerLoading, setLedgerLoading] = useState(false);
  const [action, setAction] = useState<Action>(null);
  const [gifting, setGifting] = useState(false);
  const closeButton = useRef<HTMLButtonElement>(null);

  const loadProfile = useCallback(async () => {
    try {
      const response = await fetch(`/api/admin/users/${encodeURIComponent(userId)}`, { cache: 'no-store' });
      const data = (await response.json()) as { profile?: P; error?: string } & Partial<P>;
      if (!response.ok) throw new Error(data.error ?? `The server answered ${response.status}.`);
      setProfile((data.profile ?? data) as P);
      setError(null);
    } catch (caught) {
      setError((caught as Error).message);
    }
  }, [userId]);

  const loadLedger = useCallback(
    async (cursor: string | null) => {
      setLedgerLoading(true);
      try {
        const params = new URLSearchParams({ ledger: ledgerKind, limit: '25' });
        if (cursor) params.set('cursor', cursor);
        const response = await fetch(`/api/admin/users/${encodeURIComponent(userId)}/ledger?${params}`, { cache: 'no-store' });
        const data = (await response.json()) as Ledger & { error?: string };
        if (!response.ok) throw new Error(data.error ?? `The server answered ${response.status}.`);
        setLedger((previous) => (cursor && previous ? { ...data, rows: [...previous.rows, ...data.rows] } : data));
      } catch (caught) {
        toast.show(`The ledger did not load: ${(caught as Error).message}`, 'alert');
      } finally {
        setLedgerLoading(false);
      }
    },
    [ledgerKind, toast, userId],
  );

  useEffect(() => {
    setProfile(null);
    void loadProfile();
  }, [loadProfile]);

  useEffect(() => {
    void loadLedger(null);
  }, [loadLedger]);

  useEffect(() => {
    closeButton.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !document.querySelector('dialog[open]')) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const refresh = async (message: string) => {
    toast.show(message);
    await Promise.all([loadProfile(), loadLedger(null)]);
    onChanged();
  };

  const isSelf = userId === currentUserId;
  const isAdmin = profile?.roles.includes('admin') ?? false;
  const name = profile ? profile.username ?? profile.displayName : 'Loading';

  const dialogFor = (kind: NonNull<Action>): { title: string; fields: ActionField[]; confirm: string; tone?: 'danger'; submit: (values: Record<string, string>) => Promise<string> } => {
    switch (kind) {
      case 'tickets':
        return {
          title: `Tickets for ${name}`,
          confirm: 'apply',
          fields: [
            { name: 'direction', label: 'change', type: 'choice', options: [{ id: 'add', label: 'add' }, { id: 'remove', label: 'remove' }], initial: 'add' },
            { name: 'amount', label: 'tickets', type: 'number', required: true, min: 1 },
            { name: 'reason', label: 'reason', type: 'textarea', required: true, hint: 'Shown in the ledger and the audit log.' },
          ],
          submit: async (values) => {
            const amount = Math.trunc(Number(values.amount));
            if (!Number.isFinite(amount) || amount <= 0) throw new Error('Enter a whole number of tickets above zero.');
            const signed = values.direction === 'remove' ? -amount : amount;
            await send('/api/admin/db/user', 'POST', { action: 'currency-adjust', userId, currencyType: 'credits', amount: signed, reason: values.reason });
            return `${fmtSigned(signed)} tickets for ${name}.`;
          },
        };
      case 'ban':
        return {
          title: `Ban ${name} from games`,
          confirm: 'ban',
          tone: 'danger',
          fields: [
            { name: 'length', label: 'for', type: 'choice', options: BAN_LENGTHS.map(({ id, label }) => ({ id, label })), initial: '1h' },
            { name: 'reason', label: 'reason', type: 'textarea', required: true },
          ],
          submit: async (values) => {
            const length = BAN_LENGTHS.find((option) => option.id === values.length) ?? BAN_LENGTHS[0];
            await send('/api/admin/db/user', 'POST', { action: 'ban', userId, banHours: length.hours, banMinutes: length.minutes, banIndefinite: length.id === 'indefinite', reason: values.reason });
            return `${name} is banned from games.`;
          },
        };
      case 'unban':
        return {
          title: `Lift ${name}’s game ban`,
          confirm: 'lift ban',
          fields: [{ name: 'reason', label: 'reason', type: 'textarea', required: true }],
          submit: async (values) => {
            await send('/api/admin/db/user', 'POST', { action: 'unban', userId, reason: values.reason });
            return `${name} can play again. Recent anti-cheat flags were cleared with the ban.`;
          },
        };
      case 'suspend':
        return {
          title: `Suspend ${name}`,
          confirm: 'suspend',
          tone: 'danger',
          fields: [
            { name: 'length', label: 'for', type: 'choice', options: SUSPEND_LENGTHS.map(({ id, label }) => ({ id, label })), initial: '24h' },
            { name: 'reason', label: 'reason', type: 'textarea', required: true, hint: 'A suspended account cannot sign in.' },
          ],
          submit: async (values) => {
            const length = SUSPEND_LENGTHS.find((option) => option.id === values.length) ?? SUSPEND_LENGTHS[0];
            await send('/api/account/admin/users', 'PATCH', { userId, action: 'suspend', reason: values.reason, expiresAt: length.ms ? Date.now() + length.ms : null });
            return `${name} is suspended.`;
          },
        };
      case 'unsuspend':
        return {
          title: `Lift ${name}’s suspension`,
          confirm: 'lift',
          fields: [{ name: 'reason', label: 'reason', type: 'textarea', required: true }],
          submit: async (values) => {
            await send('/api/account/admin/users', 'PATCH', { userId, action: 'unsuspend', reason: values.reason });
            return `${name} can sign in again.`;
          },
        };
      case 'delete':
        return {
          title: `Delete ${name}`,
          confirm: 'delete',
          tone: 'danger',
          fields: [
            { name: 'reason', label: 'reason', type: 'textarea', required: true, hint: 'The account is marked deleted and can be restored. Scores and purchases stay.' },
            { name: 'confirm', label: `type ${profile?.username ?? 'the username'} to confirm`, type: 'text', required: true, mustEqual: profile?.username ?? undefined },
          ],
          submit: async (values) => {
            await send('/api/account/admin/users', 'PATCH', { userId, action: 'delete', reason: values.reason });
            return `${name} is deleted.`;
          },
        };
      case 'restore':
        return {
          title: `Restore ${name}`,
          confirm: 'restore',
          fields: [{ name: 'reason', label: 'reason', type: 'textarea', required: true }],
          submit: async (values) => {
            await send('/api/account/admin/users', 'PATCH', { userId, action: 'restore', reason: values.reason });
            return `${name} is restored.`;
          },
        };
      case 'grant-admin':
        return {
          title: `Make ${name} an admin`,
          confirm: 'grant admin',
          tone: 'danger',
          fields: [
            { name: 'reason', label: 'reason', type: 'textarea', required: true, hint: 'Admins can do everything on this console.' },
            { name: 'confirm', label: `type ${profile?.username ?? 'the username'} to confirm`, type: 'text', required: true, mustEqual: profile?.username ?? undefined },
          ],
          submit: async (values) => {
            await send('/api/account/admin/users', 'PATCH', { userId, action: 'grant-role', role: 'admin', reason: values.reason });
            return `${name} is an admin.`;
          },
        };
      case 'revoke-admin':
        return {
          title: `Remove ${name}’s admin role`,
          confirm: 'remove admin',
          tone: 'danger',
          fields: [{ name: 'reason', label: 'reason', type: 'textarea', required: true }],
          submit: async (values) => {
            await send('/api/account/admin/users', 'PATCH', { userId, action: 'revoke-role', role: 'admin', reason: values.reason });
            return `${name} is no longer an admin.`;
          },
        };
    }
  };

  const dialog = action ? dialogFor(action) : null;
  const ban = profile?.gameBan as { isBanned: boolean; isIndefinite: boolean; bannedUntil: number | null; reason: string | null; remainingMs: number } | undefined;

  return (
    <>
      <div style={{ position: 'fixed', inset: 0, zIndex: 49, background: 'rgb(31 26 22 / 0.18)' }} onClick={onClose} aria-hidden='true' />
      <aside className='adm-sheet' role='dialog' aria-modal='true' aria-label={`Account ${name}`}>
        <div className='adm-sheet-head'>
          {profile?.imageUrl ? <span aria-hidden='true' style={{ width: 36, height: 36, flex: 'none', borderRadius: 18, background: `var(--adm-raised) center / cover no-repeat url(${JSON.stringify(profile.imageUrl)})` }} /> : null}
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 16, fontWeight: 800, letterSpacing: '-0.01em' }}>{name}</div>
            <div className='adm-sub' style={{ color: 'var(--adm-ink-3)', fontSize: 12 }}>
              {profile ? `${profile.status}${isAdmin ? ', admin' : ''}${isSelf ? ', you' : ''}` : ' '}
            </div>
          </div>
          <button ref={closeButton} type='button' className='adm-btn' data-tone='ghost' data-icon style={{ marginLeft: 'auto' }} onClick={onClose} aria-label='Close'>
            <X size={15} strokeWidth={2} strokeLinecap='square' aria-hidden />
          </button>
        </div>
        <div className='adm-sheet-body'>
          {error ? <Note tone='alert'>{error}</Note> : null}
          {!profile && !error ? <Empty title='Loading the account.' /> : null}
          {profile ? (
            <>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                <button type='button' className='adm-btn' data-tone='primary' onClick={() => setAction('tickets')}>tickets</button>
                <button type='button' className='adm-btn' onClick={() => setGifting(true)} disabled={profile.status === 'deleted'}>gift item</button>
                {ban?.isBanned ? (
                  <button type='button' className='adm-btn' onClick={() => setAction('unban')}>lift ban</button>
                ) : (
                  <button type='button' className='adm-btn' onClick={() => setAction('ban')} disabled={isSelf}>game ban</button>
                )}
                {profile.status === 'suspended' ? (
                  <button type='button' className='adm-btn' onClick={() => setAction('unsuspend')}>lift suspension</button>
                ) : profile.status === 'active' ? (
                  <button type='button' className='adm-btn' onClick={() => setAction('suspend')} disabled={isSelf}>suspend</button>
                ) : null}
                {isAdmin ? (
                  <button type='button' className='adm-btn' onClick={() => setAction('revoke-admin')} disabled={isSelf}>remove admin</button>
                ) : (
                  <button type='button' className='adm-btn' onClick={() => setAction('grant-admin')} disabled={profile.status !== 'active'}>make admin</button>
                )}
                {profile.status === 'deleted' ? (
                  <button type='button' className='adm-btn' onClick={() => setAction('restore')}>restore</button>
                ) : (
                  <button type='button' className='adm-btn' data-tone='danger' onClick={() => setAction('delete')} disabled={isSelf}>delete</button>
                )}
              </div>

              {ban?.isBanned ? (
                <Note tone='alert'>
                  Banned from games {ban.isIndefinite ? 'until lifted' : `for ${fmtDuration(ban.remainingMs)} more`}{ban.reason ? `: ${ban.reason}` : '.'}
                </Note>
              ) : null}

              <dl className='adm-dl'>
                <dt>email</dt><dd>{profile.email}</dd>
                <dt>account id</dt><dd className='num' style={{ fontSize: 12 }}>{profile.id}</dd>
                <dt>joined</dt><dd>{fmtDate(profile.createdAt)}</dd>
                <dt>last sign-in</dt><dd>{profile.lastLoginAt ? `${fmtTime(profile.lastLoginAt)} UTC` : 'never'}</dd>
                <dt>tickets</dt><dd className='num'>{fmtInt(profile.wallet.tickets)} earned, {fmtInt(profile.wallet.boughtTickets)} bought</dd>
                <dt>level</dt><dd className='num'>{fmtInt(profile.level.level)} ({fmtInt(profile.level.xp)} XP)</dd>
                <dt>season</dt><dd className='num'>tier {fmtInt(profile.season.tier)} of {fmtInt(profile.season.maxTier)}</dd>
                <dt>items</dt><dd className='num'>{fmtInt(profile.itemsOwned)} owned, {fmtInt(profile.itemsEquipped)} worn</dd>
                <dt>last 7 days</dt><dd className='num'>{fmtInt(profile.activity.last7Days.runs)} runs, {fmtInt(profile.activity.last7Days.tickets)} tickets earned</dd>
                <dt>last 30 days</dt><dd className='num'>{fmtInt(profile.activity.last30Days.runs)} runs, {fmtInt(profile.activity.last30Days.tickets)} tickets earned</dd>
              </dl>

              <Section
                title='Ledger'
                tools={
                  <div className='adm-seg' role='group' aria-label='Which tickets'>
                    {(['all', 'earned', 'bought'] as const).map((kind) => (
                      <button key={kind} type='button' aria-pressed={ledgerKind === kind} onClick={() => setLedgerKind(kind)}>{kind}</button>
                    ))}
                  </div>
                }
              >
                <div style={{ margin: '0 -16px' }}>
                  <DataTable
                    caption='Ledger'
                    paged={false}
                    columns={[{ label: 'when', sortable: false }, { label: 'what', sortable: false }, { label: 'change', align: 'right', sortable: false }, { label: 'balance', align: 'right', sortable: false }]}
                    rows={(ledger?.rows ?? []).map((row) => ({
                      key: `${row.ledger}:${row.id}`,
                      cells: [
                        fmtTime(row.createdAt),
                        <span key='w'>
                          {row.label}
                          {row.ledger === 'bought' ? <span className='adm-sub'> bought</span> : null}
                          {row.createdBy ? <span className='adm-sub'> by {row.createdBy}</span> : null}
                        </span>,
                        fmtSigned(row.amount),
                        fmtInt(row.balanceAfter),
                      ],
                      muted: [0, 3],
                      wrap: [1],
                    }))}
                    emptyTitle={ledgerLoading ? 'Loading the ledger.' : 'No ledger entries.'}
                    footer={ledger?.nextCursor ? <button type='button' className='adm-btn' data-size='sm' disabled={ledgerLoading} onClick={() => void loadLedger(ledger.nextCursor)}>load 25 more</button> : undefined}
                  />
                </div>
              </Section>

              {profile.antiCheatFlags.length ? (
                <Section title='Anti-cheat'>
                  <div style={{ margin: '0 -16px' }}>
                    <DataTable
                      caption='Anti-cheat flags'
                      paged={false}
                      columns={[{ label: 'when' }, { label: 'game' }, { label: 'result' }, { label: 'reason' }]}
                      rows={profile.antiCheatFlags.map((flag) => ({
                        key: flag.id,
                        cells: [fmtTime(flag.ts), flag.gameType, flag.result === 'reject' ? 'rejected' : 'flagged', flag.reason ?? 'n/a'],
                        sort: [flag.ts, flag.gameType, flag.result, flag.reason],
                        alert: flag.result === 'reject' ? [2] : [],
                        muted: [0],
                        wrap: [3],
                      }))}
                    />
                  </div>
                </Section>
              ) : null}

              {profile.purchases.length ? (
                <Section title='Ticket packs'>
                  <div style={{ margin: '0 -16px' }}>
                    <DataTable
                      caption='Ticket pack purchases'
                      paged={false}
                      columns={[{ label: 'when' }, { label: 'pack' }, { label: 'status' }, { label: 'tickets', align: 'right' }, { label: 'paid', align: 'right' }]}
                      rows={profile.purchases.map((purchase) => ({
                        key: purchase.id,
                        cells: [fmtTime(purchase.createdAt), purchase.packId, purchase.reversedAt ? `reversed (${purchase.reversalStatus ?? 'refund'})` : purchase.status, fmtInt(purchase.ticketsGranted), fmtMoney(purchase.amountTotal, purchase.currency)],
                        sort: [purchase.createdAt, purchase.packId, purchase.status, purchase.ticketsGranted, purchase.amountTotal],
                        alert: purchase.reversedAt ? [2] : [],
                        muted: [0],
                      }))}
                    />
                  </div>
                </Section>
              ) : null}

              <Section title='History'>
                {profile.audit.length || profile.moderationHistory.length ? (
                  <div style={{ margin: '0 -16px' }}>
                    <DataTable
                      caption='Admin history for this account'
                      paged={false}
                      columns={[{ label: 'when' }, { label: 'what' }, { label: 'by' }, { label: 'reason' }]}
                      rows={[
                        ...profile.audit.map((row) => ({
                          key: `a:${row.id}`,
                          at: row.createdAt,
                          cells: [fmtAgo(row.createdAt), row.status >= 400 ? `${row.action} (refused)` : row.action, row.actorName ?? row.actorUserId.slice(0, 8), row.reason ?? ''],
                          alert: row.status >= 400 ? [1] : [],
                        })),
                        ...profile.moderationHistory.map((row) => ({
                          key: `m:${row.id}`,
                          at: row.createdAt,
                          cells: [fmtAgo(row.createdAt), `account ${row.action}`, row.actorName ?? 'system', row.reason ?? ''],
                          alert: [] as number[],
                        })),
                      ]
                        .sort((a, b) => b.at - a.at)
                        .map(({ key, cells, at, alert }) => ({ key, cells, alert, sort: [at, String(cells[1]), String(cells[2]), String(cells[3])], muted: [0], wrap: [3] }))}
                    />
                  </div>
                ) : (
                  <p style={{ margin: 0, color: 'var(--adm-ink-3)', fontSize: 12 }}>No admin has acted on this account.</p>
                )}
              </Section>
            </>
          ) : null}
        </div>
      </aside>

      {dialog ? (
        <ActionDialog
          title={dialog.title}
          fields={dialog.fields}
          confirm={dialog.confirm}
          tone={dialog.tone}
          onClose={() => setAction(null)}
          onSubmit={async (values) => {
            const message = await dialog.submit(values);
            setAction(null);
            await refresh(message);
          }}
        />
      ) : null}

      {gifting && profile ? (
        <div className='adm-legacy-dialog'>
          <GrantItemDialog
            recipient={{ id: profile.id, username: profile.username, email: profile.email }}
            onClose={() => setGifting(false)}
            onGranted={(message) => {
              setGifting(false);
              void refresh(message);
            }}
          />
        </div>
      ) : null}
    </>
  );
}
