'use client';

import { FormEvent, useMemo, useRef, useState } from 'react';
import { CheckCircle2, MessageSquare, RefreshCw, Search } from 'lucide-react';

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
import { feedbackCategories } from '@/features/arcade/lib/feedback-categories';
import { readJson } from '@/lib/read-json';
import type { FeedbackCategory, FeedbackEntry, FeedbackStatus } from '@/server/feedback';

type StatusFilter = 'open' | 'resolved' | 'all';

type AdminFeedbackClientProps = {
  initialEntries: FeedbackEntry[];
};

const statuses: Array<{ value: StatusFilter; label: string }> = [
  { value: 'open', label: 'Open' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'all', label: 'All statuses' },
];

function formatDate(timestamp: number) {
  return new Intl.DateTimeFormat('en', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(timestamp));
}

function matchesStatus(entry: FeedbackEntry, status: StatusFilter) {
  return status === 'all' || (status === 'open' ? entry.status === 'open' : entry.status !== 'open');
}

export function AdminFeedbackClient({ initialEntries }: AdminFeedbackClientProps) {
  const [entries, setEntries] = useState(initialEntries);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<StatusFilter>('open');
  const [appliedStatus, setAppliedStatus] = useState<StatusFilter>('open');
  const [category, setCategory] = useState<FeedbackCategory | 'all'>('all');
  const [busy, setBusy] = useState<string | null>(null);
  const requestPending = useRef(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const summary = useMemo(
    () => ({
      total: entries.length,
      open: entries.filter((entry) => entry.status === 'open').length,
      resolved: entries.filter((entry) => entry.status !== 'open').length,
    }),
    [entries],
  );

  const loadEntries = async (event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault();
    if (requestPending.current) return;
    requestPending.current = true;
    setBusy('load');
    setError(null);
    setNotice(null);
    try {
      const params = new URLSearchParams({ status, category, limit: '100' });
      if (query.trim()) params.set('q', query.trim());
      const payload = await readJson<{ entries: FeedbackEntry[] }>(
        `/api/admin/feedback?${params.toString()}`,
      );
      setEntries(payload.entries);
      setAppliedStatus(status);
      setNotice(`${payload.entries.length} ${payload.entries.length === 1 ? 'ticket' : 'tickets'} loaded.`);
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      requestPending.current = false;
      setBusy(null);
    }
  };

  const updateStatus = async (entry: FeedbackEntry) => {
    if (requestPending.current) return;
    requestPending.current = true;
    const nextStatus: FeedbackStatus = entry.status === 'open' ? 'resolved' : 'open';
    setBusy(entry.id);
    setError(null);
    setNotice(null);
    try {
      const payload = await readJson<{ entry: FeedbackEntry }>('/api/admin/feedback', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: entry.id, status: nextStatus }),
      });
      setEntries((current) =>
        current
          .map((item) => (item.id === entry.id ? payload.entry : item))
          .filter((item) => matchesStatus(item, appliedStatus))
          .sort((a, b) => b.updatedAt - a.updatedAt),
      );
      setNotice(nextStatus === 'resolved' ? 'Ticket resolved. The conversation is saved.' : 'Ticket reopened.');
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      requestPending.current = false;
      setBusy(null);
    }
  };

  return (
    <AdminPageFrame
      title='Feedback'
      subtitle='Read feedback, reply in the conversation, and resolve tickets when they are complete.'
      contentClassName='space-y-6'
    >
      <section aria-label='Loaded ticket summary' className='space-y-2'>
        <div className='grid gap-3 sm:grid-cols-3'>
          <ArcadeStat label='Tickets loaded' value={summary.total} />
          <ArcadeStat label='Open in this view' value={summary.open} />
          <ArcadeStat label='Resolved in this view' value={summary.resolved} />
        </div>
        <p className='text-xs text-faint'>Up to 100 matching tickets, most recently updated first. Counts reflect this view.</p>
      </section>

      <form
        onSubmit={(event) => void loadEntries(event)}
        className='grid gap-3 arcade-card p-4 lg:grid-cols-[1fr_180px_180px_auto]'
      >
        <ArcadeField label='Search'>
          <ArcadeInput
            value={query}
            disabled={Boolean(busy)}
            onChange={(event) => setQuery(event.target.value)}
            placeholder='Message, submitter, email, page, or id'
          />
        </ArcadeField>
        <ArcadeField label='Status'>
          <select
            value={status}
            disabled={Boolean(busy)}
            onChange={(event) => setStatus(event.target.value as StatusFilter)}
            className='w-full arcade-input px-3 py-2 text-sm'
          >
            {statuses.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
        </ArcadeField>
        <ArcadeField label='Category'>
          <select
            value={category}
            disabled={Boolean(busy)}
            onChange={(event) => setCategory(event.target.value as FeedbackCategory | 'all')}
            className='w-full arcade-input px-3 py-2 text-sm'
          >
            <option value='all'>All categories</option>
            {feedbackCategories.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
        </ArcadeField>
        <div className='flex items-end gap-2'>
          <ArcadeButton type='submit' disabled={Boolean(busy)} tone='primary'>
            <Search aria-hidden size={16} />
            Search
          </ArcadeButton>
          <ArcadeButton type='button' disabled={Boolean(busy)} onClick={() => void loadEntries()}>
            <RefreshCw aria-hidden size={16} />
            {busy === 'load' ? 'Loading…' : 'Refresh'}
          </ArcadeButton>
        </div>
      </form>

      <div role='status' aria-live='polite'>
        {notice ? <ArcadeNotice tone='success'>{notice}</ArcadeNotice> : null}
      </div>
      {error ? <div role='alert'><ArcadeNotice tone='danger'>{error}</ArcadeNotice></div> : null}

      <section aria-label='Feedback tickets' aria-busy={Boolean(busy)} className='space-y-3'>
        {entries.length === 0 ? (
          <div className='arcade-card p-5 text-sm text-faint'>
            No tickets match this view. Try another status, category, or search.
          </div>
        ) : entries.map((entry) => (
          <FeedbackRow
            key={entry.id}
            entry={entry}
            busy={busy}
            onStatusChange={() => void updateStatus(entry)}
          />
        ))}
      </section>
    </AdminPageFrame>
  );
}

function FeedbackRow({ entry, busy, onStatusChange }: {
  entry: FeedbackEntry;
  busy: string | null;
  onStatusChange: () => void;
}) {
  const isOpen = entry.status === 'open';
  const categoryLabel = feedbackCategories.find((item) => item.value === entry.category)?.label ?? entry.category;

  return (
    <article className='arcade-card p-4'>
      <div className='grid gap-4 xl:grid-cols-[minmax(0,1fr)_auto]'>
        <div className='min-w-0'>
          <div className='flex flex-wrap items-center gap-2 text-xs text-faint'>
            <ArcadeChip>{categoryLabel}</ArcadeChip>
            <ArcadeChip tone={isOpen ? 'tickets' : 'prize'}>{isOpen ? 'Open' : 'Resolved'}</ArcadeChip>
            <ArcadeChip tone='info'>{entry.userId ? 'Account ticket' : 'Guest submission'}</ArcadeChip>
            {entry.rating ? <span className='arcade-num'>Rating {entry.rating}/5</span> : null}
          </div>
          <p className='mt-3 whitespace-pre-wrap break-words text-sm leading-6 text-body'>{entry.message}</p>
          <dl className='mt-4 grid gap-3 text-sm sm:grid-cols-2'>
            <div>
              <dt className='arcade-kicker'>Submitter</dt>
              <dd className='mt-1 break-words text-body'>{entry.userName || entry.userId || 'Guest'}</dd>
            </div>
            <div>
              <dt className='arcade-kicker'>Contact email</dt>
              <dd className='mt-1 break-all text-body'>{entry.email || 'Not provided'}</dd>
            </div>
            <div>
              <dt className='arcade-kicker'>Page</dt>
              <dd className='mt-1 break-words text-body'>{entry.pagePath || 'Not specified'}</dd>
            </div>
            <div>
              <dt className='arcade-kicker'>Reference</dt>
              <dd className='mt-1 break-all font-mono text-xs text-faint'>{entry.id}</dd>
            </div>
          </dl>
          <p className='mt-3 text-xs text-faint'>
            Submitted {formatDate(entry.createdAt)} · Updated {formatDate(entry.updatedAt)}
          </p>
          <p className='mt-2 text-xs text-faint'>
            {entry.userId
              ? 'Reply in the conversation. The player can read and respond from their feedback page.'
              : 'Guests cannot access a ticket conversation. Use the contact email if one was provided.'}
          </p>
        </div>
        <div className='flex flex-wrap items-start gap-2 xl:max-w-xs xl:justify-end'>
          <ArcadeLinkButton href={`/feedback/${encodeURIComponent(entry.id)}`}>
            <MessageSquare aria-hidden size={16} />
            {entry.userId ? 'Open conversation' : 'View submission'}
          </ArcadeLinkButton>
          <ArcadeButton type='button' disabled={Boolean(busy)} onClick={onStatusChange}>
            {isOpen ? <CheckCircle2 aria-hidden size={16} /> : <RefreshCw aria-hidden size={16} />}
            {busy === entry.id ? 'Updating…' : isOpen ? 'Resolve' : 'Reopen'}
          </ArcadeButton>
        </div>
      </div>
    </article>
  );
}
