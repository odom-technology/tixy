'use client';

import { FormEvent, useMemo, useState } from 'react';
import Link from 'next/link';
import { MessageSquare, RefreshCw, Send } from 'lucide-react';

import {
  ArcadeButton,
  ArcadeChip,
  ArcadeNotice,
} from '@/features/arcade/components/ui/arcade-ui';
import { AppPageFrame } from '@/features/arcade/components/shell/page-frame';
import { feedbackCategories as categories } from '@/features/arcade/lib/feedback-categories';
import type { FeedbackCategory, FeedbackTicketEntry } from '@/server/feedback';

type FeedbackEntry = FeedbackTicketEntry;

type FeedbackClientProps = {
  account: {
    username: string | null;
  } | null;
  initialEntries: FeedbackEntry[];
  initialCategory?: FeedbackCategory;
};

const categoryLabels = new Map(
  categories.map((category) => [category.value, category.label]),
);

const inputClass =
  'mt-2 arcade-input px-3 py-2';
const panelClass = 'arcade-card p-5';

function formatDate(timestamp: number) {
  return new Intl.DateTimeFormat('en', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(timestamp));
}

export function FeedbackClient({
  account,
  initialEntries,
  initialCategory = 'other',
}: FeedbackClientProps) {
  const [category, setCategory] = useState<FeedbackCategory>(initialCategory);
  const [rating, setRating] = useState('');
  const [message, setMessage] = useState('');
  const [pagePath, setPagePath] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [entries, setEntries] = useState(initialEntries);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [website, setWebsite] = useState('');
  const [submittedId, setSubmittedId] = useState<string | null>(null);
  const [historyBusy, setHistoryBusy] = useState(false);

  async function refreshTickets() {
    if (busy || historyBusy) return;
    setHistoryBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/feedback', { cache: 'no-store' });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Unable to load your tickets.');
      setEntries(payload.entries);
    } catch (caught) {
      setError((caught as Error).message);
    } finally { setHistoryBusy(false); }
  }

  const remaining = useMemo(() => 3000 - message.length, [message.length]);
  const selectedCategory = categories.find((item) => item.value === category) ?? categories[0];
  const showRating = category === 'game_request' || category === 'layout' || category === 'performance';
  const emailRequired = !account && (category === 'account' || category === 'purchase' || category === 'privacy');

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);

    try {
      const response = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          category,
          rating: showRating && rating ? Number(rating) : null,
          message,
          pagePath: selectedCategory.pageLabel ? pagePath : null,
          contactEmail,
          website,
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        entry?: FeedbackEntry;
        error?: string;
      };
      if (!response.ok || !payload.entry) {
        throw new Error(payload.error || 'Unable to submit feedback.');
      }
      setEntries((current) => [payload.entry!, ...current].slice(0, 50));
      setSubmittedId(payload.entry.id);
      setMessage('');
      setPagePath('');
      setNotice(account ? 'Your ticket is open. Continue the conversation and read replies here in Tixy.' : 'Your message was sent. If you included an email, the team can use it to follow up.');
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AppPageFrame
      eyebrow='Support'
      title={
        <span className='flex items-center gap-3'>
          <MessageSquare size={28} />
          Feedback
        </span>
      }
      subtitle='Ask a question, report a problem, or suggest a game. Signed-in players can follow up and read replies on their private tickets.'
      contentClassName='space-y-6'
    >
        <div className={account ? 'grid items-start gap-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]' : 'mx-auto max-w-3xl'}>
          <section className={panelClass}>
            <h2 className='mb-4 text-lg font-semibold'>Open a ticket</h2>
            {!account ? <p className='mb-5 text-sm leading-6 text-faint'><Link href='/signin?next=/feedback' className='arcade-link'>Sign in</Link> for a private conversation with the Tixy team and in-app reply notifications. You can also submit as a guest and leave an email for follow-up.</p> : null}
            <form onSubmit={submit} className='space-y-4'>
              <fieldset disabled={busy || historyBusy} className='min-w-0 space-y-4'>
              <label className='block'>
                <span className='text-sm font-medium text-faint'>What is this about?</span>
                <select
                  value={category}
                  onChange={(event) =>
                    setCategory(event.target.value as FeedbackCategory)
                  }
                  className={inputClass}
                >
                  {categories.map((item) => (
                    <option key={item.value} value={item.value}>
                      {item.label}
                    </option>
                  ))}
                </select>
                <span className='mt-2 block text-xs text-faint'>{selectedCategory.hint}</span>
              </label>

              {showRating ? <label className='block'>
                <span className='text-sm font-medium text-faint'>Rating (optional)</span>
                <select
                  value={rating}
                  onChange={(event) => setRating(event.target.value)}
                  className={inputClass}
                >
                  <option value=''>Choose a rating</option>
                  <option value='5'>5</option>
                  <option value='4'>4</option>
                  <option value='3'>3</option>
                  <option value='2'>2</option>
                  <option value='1'>1</option>
                </select>
              </label> : null}

              {!account ? (
                <label className='block'>
                  <span className='text-sm font-medium text-faint'>
                    Your email {emailRequired ? '(required for a reply)' : '(optional for a reply)'}
                  </span>
                  <input
                    value={contactEmail}
                    onChange={(event) => setContactEmail(event.target.value)}
                    type='email'
                    autoComplete='email'
                    required={emailRequired}
                    maxLength={254}
                    className={inputClass}
                  />
                </label>
              ) : <p className='text-sm text-faint'>Replies appear on your ticket in Tixy. We’ll notify you in-app when the team responds, if feedback notifications are enabled.</p>}

              {selectedCategory.pageLabel ? <label className='block'>
                <span className='text-sm font-medium text-faint'>{selectedCategory.pageLabel} (optional)</span>
                <input
                  value={pagePath}
                  onChange={(event) => setPagePath(event.target.value)}
                  placeholder='e.g. /games or the game name'
                  maxLength={300}
                  className={inputClass}
                />
              </label> : null}

              <label className='block'>
                <span className='text-sm font-medium text-faint'>{selectedCategory.prompt}</span>
                <textarea
                  value={message}
                  onChange={(event) => setMessage(event.target.value.slice(0, 3000))}
                  rows={8}
                  minLength={10}
                  required
                  placeholder={selectedCategory.placeholder}
                  className={`${inputClass} resize-y leading-6`}
                />
              </label>

              <label className='absolute -left-[9999px]' aria-hidden='true'>
                Website
                <input name='website' value={website} onChange={(event) => setWebsite(event.target.value)} tabIndex={-1} autoComplete='off' />
              </label>

              <div className='flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between'>
                <span
                  className={`text-xs ${remaining < 100 ? 'text-tickets-text' : 'text-faint'}`}
                >
                  {remaining} characters left
                </span>
                <ArcadeButton
                  type='submit'
                  tone='primary'
                  disabled={busy || historyBusy}
                >
                  <Send size={16} />
                  {busy ? 'Sending...' : 'Submit ticket'}
                </ArcadeButton>
              </div>
              {notice ? <div role='status'><ArcadeNotice tone='success'>{notice}{account && submittedId ? <Link className='arcade-link ml-2' href={`/feedback/${encodeURIComponent(submittedId)}`}>Open your ticket</Link> : null}</ArcadeNotice></div> : null}
              {error ? <div role='alert'><ArcadeNotice tone='danger'>{error}</ArcadeNotice></div> : null}
              </fieldset>
            </form>
          </section>

          {account ? (
            <aside className={panelClass}>
              <div className='flex flex-wrap items-center justify-between gap-3'>
                <h2 className='text-lg font-semibold'>Your tickets</h2>
                <ArcadeButton type='button' size='sm' disabled={busy || historyBusy} onClick={() => void refreshTickets()}><RefreshCw size={16} />{historyBusy ? 'Refreshing…' : 'Refresh tickets'}</ArcadeButton>
              </div>
              <p className='mt-2 text-sm text-faint'>Your latest 50 tickets, most recently updated first. Open one to read replies or add more details.</p>
              <div className='mt-4 space-y-3'>
                {entries.length === 0 ? (
                  <p className='arcade-card-inset px-4 py-6 text-center text-sm text-faint'>
                    You haven’t opened any tickets yet.
                  </p>
                ) : (
                  entries.map((entry) => (
                    <Link
                      key={entry.id}
                      href={`/feedback/${encodeURIComponent(entry.id)}`}
                      className='block arcade-card-inset p-3 transition hover:brightness-110'
                    >
                      <div className='flex flex-wrap items-center gap-2 text-xs text-faint'>
                        <ArcadeChip tone='primary'>
                          {categoryLabels.get(entry.category) ?? entry.category.replaceAll('_', ' ')}
                        </ArcadeChip>
                        <span>{entry.status === 'open' ? 'Open' : 'Resolved'}</span>
                        <span>Updated {formatDate(entry.updatedAt)}</span>
                      </div>
                      <p className='mt-2 line-clamp-3 text-sm text-strong'>
                        {entry.message}
                      </p>
                      <p className='mt-2 text-xs font-semibold text-primary-text'>
                        Open conversation
                      </p>
                    </Link>
                  ))
                )}
              </div>
            </aside>
          ) : null}
        </div>
    </AppPageFrame>
  );
}
