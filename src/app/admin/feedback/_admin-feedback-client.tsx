'use client';

import { FormEvent, useMemo, useState } from 'react';
import {
  CheckCircle2,
  Inbox,
  RefreshCw,
  Search,
  XCircle,
} from 'lucide-react';

import {
  ArcadeButton,
  ArcadeChip,
  ArcadeField,
  ArcadeInput,
  ArcadeLinkButton,
  ArcadeNotice,
  ArcadeStat,
} from '@/features/arcade/components/ui/arcade-ui';
import { AdminPageFrame } from '@/features/arcade/components/shell/page-frame';
import { readJson } from '@/lib/read-json';

type FeedbackCategory =
  | 'bug'
  | 'game_request'
  | 'account'
  | 'layout'
  | 'performance'
  | 'privacy'
  | 'purchase'
  | 'ads'
  | 'other';

type FeedbackStatus = 'open' | 'resolved' | 'dismissed';

type FeedbackEntry = {
  id: string;
  userId: string | null;
  userName: string | null;
  email: string | null;
  category: FeedbackCategory;
  rating: number | null;
  message: string;
  pagePath: string | null;
  status: FeedbackStatus;
  adminNote: string | null;
  statusUpdatedBy: string | null;
  statusUpdatedAt: number | null;
  createdAt: number;
  updatedAt: number;
};

type FeedbackListResponse = {
  entries: FeedbackEntry[];
};

type FeedbackEntryResponse = {
  entry: FeedbackEntry;
};

type AdminFeedbackClientProps = {
  initialEntries: FeedbackEntry[];
};

const categories: Array<{ value: FeedbackCategory | 'all'; label: string }> = [
  { value: 'all', label: 'All categories' },
  { value: 'bug', label: 'Bug' },
  { value: 'game_request', label: 'Game request' },
  { value: 'account', label: 'Account' },
  { value: 'layout', label: 'Layout' },
  { value: 'performance', label: 'Performance' },
  { value: 'privacy', label: 'Privacy' },
  { value: 'purchase', label: 'Purchase' },
  { value: 'ads', label: 'Ads' },
  { value: 'other', label: 'Other' },
];

const statuses: Array<{ value: FeedbackStatus | 'all'; label: string }> = [
  { value: 'open', label: 'Open' },
  { value: 'all', label: 'All statuses' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'dismissed', label: 'Dismissed' },
];

const selectClass =
  'w-full arcade-input px-3 py-2 text-sm';

function formatDate(timestamp: number) {
  return new Intl.DateTimeFormat('en', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(timestamp));
}

function statusTone(status: FeedbackStatus) {
  if (status === 'resolved') return 'prize' as const;
  if (status === 'dismissed') return 'info' as const;
  return 'tickets' as const;
}

function labelCategory(category: FeedbackCategory) {
  return category.replaceAll('_', ' ');
}

export function AdminFeedbackClient({
  initialEntries,
}: AdminFeedbackClientProps) {
  const [entries, setEntries] = useState(initialEntries);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<FeedbackStatus | 'all'>('open');
  const [category, setCategory] = useState<FeedbackCategory | 'all'>('all');
  const [notes, setNotes] = useState<Record<string, string>>(() =>
    Object.fromEntries(initialEntries.map((entry) => [entry.id, entry.adminNote ?? ''])),
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const summary = useMemo(
    () => ({
      total: entries.length,
      open: entries.filter((entry) => entry.status === 'open').length,
      resolved: entries.filter((entry) => entry.status === 'resolved').length,
      dismissed: entries.filter((entry) => entry.status === 'dismissed').length,
    }),
    [entries],
  );

  const loadEntries = async (event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault();
    setBusy('load');
    setError(null);
    setNotice(null);
    try {
      const params = new URLSearchParams({
        status,
        category,
        limit: '100',
      });
      if (query.trim()) params.set('q', query.trim());
      const payload = await readJson<FeedbackListResponse>(
        `/api/admin/feedback?${params.toString()}`,
      );
      setEntries(payload.entries);
      setNotes(
        Object.fromEntries(
          payload.entries.map((entry) => [entry.id, entry.adminNote ?? '']),
        ),
      );
      setNotice('Feedback loaded.');
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const updateStatus = async (entry: FeedbackEntry, nextStatus: FeedbackStatus) => {
    setBusy(`${entry.id}:${nextStatus}`);
    setError(null);
    setNotice(null);
    try {
      const payload = await readJson<FeedbackEntryResponse>('/api/admin/feedback', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: entry.id,
          status: nextStatus,
          adminNote: notes[entry.id] ?? '',
        }),
      });
      setEntries((current) =>
        current.map((item) => (item.id === entry.id ? payload.entry : item)),
      );
      setNotes((current) => ({
        ...current,
        [payload.entry.id]: payload.entry.adminNote ?? '',
      }));
      setNotice('Feedback updated.');
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <AdminPageFrame
      title='Feedback'
      subtitle='Read player feedback, leave a note, close it out.'
      contentClassName='space-y-6'
    >
        <section className='grid gap-3 sm:grid-cols-4'>
          <ArcadeStat label='Loaded' value={summary.total} />
          <ArcadeStat label='Open' value={summary.open} />
          <ArcadeStat label='Resolved' value={summary.resolved} />
          <ArcadeStat label='Dismissed' value={summary.dismissed} />
        </section>

        <form
          onSubmit={(event) => void loadEntries(event)}
          className='grid gap-3 arcade-card p-4 lg:grid-cols-[1fr_180px_180px_auto]'
        >
          <ArcadeField label='Search'>
            <ArcadeInput
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder='Message, submitter, email, page, or id'
            />
          </ArcadeField>
          <ArcadeField label='Status'>
            <select
              value={status}
              onChange={(event) =>
                setStatus(event.target.value as FeedbackStatus | 'all')
              }
              className={selectClass}
            >
              {statuses.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </ArcadeField>
          <ArcadeField label='Category'>
            <select
              value={category}
              onChange={(event) =>
                setCategory(event.target.value as FeedbackCategory | 'all')
              }
              className={selectClass}
            >
              {categories.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </ArcadeField>
          <div className='flex items-end gap-2'>
            <ArcadeButton type='submit' disabled={busy === 'load'} tone='primary'>
              <Search size={16} />
              Search
            </ArcadeButton>
            <ArcadeButton
              type='button'
              disabled={busy === 'load'}
              onClick={() => void loadEntries()}
            >
              <RefreshCw size={16} />
              Refresh
            </ArcadeButton>
          </div>
        </form>

        {notice ? <ArcadeNotice tone='success'>{notice}</ArcadeNotice> : null}
        {error ? <ArcadeNotice tone='danger'>{error}</ArcadeNotice> : null}

        <section className='space-y-3'>
          {entries.length === 0 ? (
            <div className='arcade-card p-5 text-sm text-faint'>
              No feedback found.
            </div>
          ) : (
            entries.map((entry) => (
              <FeedbackRow
                key={entry.id}
                entry={entry}
                busy={busy}
                note={notes[entry.id] ?? ''}
                onNoteChange={(note) =>
                  setNotes((current) => ({
                    ...current,
                    [entry.id]: note,
                  }))
                }
                onResolve={() => void updateStatus(entry, 'resolved')}
                onDismiss={() => void updateStatus(entry, 'dismissed')}
                onReopen={() => void updateStatus(entry, 'open')}
                onSaveNote={() => void updateStatus(entry, entry.status)}
              />
            ))
            )}
          </section>
    </AdminPageFrame>
  );
}

function FeedbackRow({
  entry,
  busy,
  note,
  onNoteChange,
  onResolve,
  onDismiss,
  onReopen,
  onSaveNote,
}: {
  entry: FeedbackEntry;
  busy: string | null;
  note: string;
  onNoteChange: (note: string) => void;
  onResolve: () => void;
  onDismiss: () => void;
  onReopen: () => void;
  onSaveNote: () => void;
}) {
  const isBusy = Boolean(busy?.startsWith(`${entry.id}:`));

  return (
    <article className='arcade-card p-4'>
      <div className='grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto]'>
        <div className='min-w-0'>
          <div className='flex flex-wrap items-center gap-2 text-xs text-faint'>
            <ArcadeChip className='capitalize'>
              {labelCategory(entry.category)}
            </ArcadeChip>
            <ArcadeChip tone={statusTone(entry.status)} className='capitalize'>
              {entry.status}
            </ArcadeChip>
            {entry.rating ? (
              <span className='arcade-num'>Rating {entry.rating}/5</span>
            ) : null}
            <span>{formatDate(entry.createdAt)}</span>
          </div>
          <p className='mt-3 whitespace-pre-wrap text-sm leading-6 text-body'>
            {entry.message}
          </p>
          <dl className='mt-4 grid gap-3 text-sm sm:grid-cols-3'>
            <div>
              <dt className='arcade-kicker'>Submitter</dt>
              <dd className='mt-1 break-words text-body'>
                {entry.userName || entry.email || entry.userId || 'Guest'}
              </dd>
            </div>
            <div>
              <dt className='arcade-kicker'>Page</dt>
              <dd className='mt-1 break-words text-body'>
                {entry.pagePath || 'Not specified'}
              </dd>
            </div>
            <div>
              <dt className='arcade-kicker'>Reference</dt>
              <dd className='mt-1 break-all font-mono text-xs text-faint'>
                {entry.id}
              </dd>
            </div>
          </dl>
          <label className='mt-4 block'>
            <span className='arcade-kicker mb-2 block'>Admin note</span>
            <textarea
              value={note}
              onChange={(event) => onNoteChange(event.target.value.slice(0, 1200))}
              rows={3}
              className='w-full resize-y arcade-input px-3 py-2 text-sm'
            />
          </label>
          {entry.statusUpdatedAt ? (
            <p className='mt-2 text-xs text-faint'>
              Last status update {formatDate(entry.statusUpdatedAt)}
            </p>
          ) : null}
        </div>

        <div className='flex flex-wrap items-start gap-2 lg:max-w-xs lg:justify-end'>
          <ArcadeLinkButton
            href={`/feedback/${encodeURIComponent(entry.id)}`}
          >
            <Inbox size={16} />
            Details
          </ArcadeLinkButton>
          {entry.status !== 'resolved' ? (
            <ArcadeButton
              type='button'
              disabled={isBusy}
              onClick={onResolve}
            >
              <CheckCircle2 size={16} />
              Resolve
            </ArcadeButton>
          ) : null}
          {entry.status !== 'dismissed' ? (
            <ArcadeButton
              type='button'
              disabled={isBusy}
              onClick={onDismiss}
            >
              <XCircle size={16} />
              Dismiss
            </ArcadeButton>
          ) : null}
          {entry.status !== 'open' ? (
            <ArcadeButton
              type='button'
              disabled={isBusy}
              onClick={onReopen}
            >
              <RefreshCw size={16} />
              Reopen
            </ArcadeButton>
          ) : null}
          <ArcadeButton
            type='button'
            disabled={isBusy || note === (entry.adminNote ?? '')}
            onClick={onSaveNote}
          >
            Save note
          </ArcadeButton>
        </div>
      </div>
    </article>
  );
}
