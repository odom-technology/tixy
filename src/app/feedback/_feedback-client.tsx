'use client';

import { FormEvent, useMemo, useState } from 'react';
import Link from 'next/link';
import { MessageSquare, Send } from 'lucide-react';

import {
  ArcadeButton,
  ArcadeChip,
  ArcadeLinkButton,
  ArcadeNotice,
} from '@/features/arcade/components/ui/arcade-ui';
import { AppPageFrame } from '@/features/arcade/components/shell/page-frame';

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

type FeedbackEntry = {
  id: string;
  category: FeedbackCategory;
  rating: number | null;
  message: string;
  pagePath: string | null;
  status: 'open' | 'resolved' | 'dismissed';
  createdAt: number;
  updatedAt: number;
};

type FeedbackClientProps = {
  account: {
    username: string | null;
    email: string;
  } | null;
  initialEntries: FeedbackEntry[];
  initialCategory?: FeedbackCategory;
  contactMode?: boolean;
};

const categories: Array<{
  value: FeedbackCategory;
  label: string;
  hint: string;
  prompt: string;
  placeholder: string;
  pageLabel?: string;
}> = [
  { value: 'other', label: 'General question', hint: 'Ask us anything about Arcade or Odom Tech.', prompt: 'What would you like to ask?', placeholder: 'Tell us what you need help with or would like to know.' },
  { value: 'bug', label: 'Bug report', hint: 'Tell us what happened so we can reproduce it.', prompt: 'What went wrong?', placeholder: 'What did you expect? What happened instead? Include steps to reproduce it.', pageLabel: 'Page or game where it happened' },
  { value: 'game_request', label: 'Game request', hint: 'Suggest a game or an improvement to an existing one.', prompt: 'What would you like to see?', placeholder: 'Describe the game or feature and why it would be fun.' },
  { value: 'performance', label: 'Slow or broken page', hint: 'Help us track down slow loading, lag, or errors.', prompt: 'What felt slow or failed?', placeholder: 'Which device and browser were you using? What happened?', pageLabel: 'Page or game affected' },
  { value: 'layout', label: 'Design feedback', hint: 'Share what is confusing or could be easier to use.', prompt: 'What could we improve?', placeholder: 'What were you trying to do, and what made it difficult?', pageLabel: 'Page you are referring to' },
  { value: 'account', label: 'Account help', hint: 'Tell us about sign in, profile, or account access issues.', prompt: 'How can we help with your account?', placeholder: 'Describe the issue. Do not include your password or recovery code.' },
  { value: 'purchase', label: 'Purchase help', hint: 'Ask about a charge, purchase, or digital item.', prompt: 'What happened with your purchase?', placeholder: 'Include the approximate date and item. Do not include card numbers or payment details.' },
  { value: 'privacy', label: 'Privacy request', hint: 'Ask about your data or request a privacy action.', prompt: 'What privacy help do you need?', placeholder: 'Describe your request. We may ask you to verify account ownership before acting.' },
  { value: 'ads', label: 'Ad issue', hint: 'Report an ad that is confusing, inappropriate, or broken.', prompt: 'What was wrong with the ad?', placeholder: 'Describe the ad and where you saw it. Do not include sensitive personal information.', pageLabel: 'Page where you saw the ad' },
];

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
  initialCategory = 'game_request',
  contactMode = false,
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
      setEntries((current) => [payload.entry!, ...current].slice(0, 10));
      setMessage('');
      setPagePath('');
      setNotice('Your message was sent. Thank you for reaching out.');
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AppPageFrame
      eyebrow={contactMode ? 'Support' : 'Feedback'}
      title={
        <span className='flex items-center gap-3'>
          <MessageSquare size={28} />
          {contactMode ? 'Contact' : 'Floor Notes'}
        </span>
      }
      subtitle={contactMode ? 'Send a message to the Arcade team. Choose a reason so we can help faster.' : 'Send game requests, design notes, and account issues to the team.'}
      contentClassName='space-y-6'
    >
        <div className={contactMode ? 'mx-auto max-w-3xl' : 'grid gap-5 lg:grid-cols-[1fr_0.8fr]'}>
          <section className={panelClass}>
            <form onSubmit={submit} className='space-y-4'>
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
              ) : <p className='text-sm text-faint'>We can reply using your account email.</p>}

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
                  disabled={busy}
                >
                  <Send size={16} />
                  {busy ? 'Submitting...' : 'Submit'}
                </ArcadeButton>
              </div>
              {notice ? <div role='status'><ArcadeNotice tone='success'>{notice}</ArcadeNotice></div> : null}
              {error ? <div role='alert'><ArcadeNotice tone='danger'>{error}</ArcadeNotice></div> : null}
            </form>
          </section>

          {!contactMode ? <aside className={panelClass}>
            <h2 className='text-lg font-semibold'>
              {account ? 'Recent notes' : 'Player card'}
            </h2>
            {account ? (
              <div className='mt-4 space-y-3'>
                {entries.length === 0 ? (
                  <p className='arcade-card-inset px-4 py-6 text-center text-sm text-faint'>
                    No feedback submitted yet.
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
                        <span>{entry.status}</span>
                        <span>{formatDate(entry.createdAt)}</span>
                      </div>
                      <p className='mt-2 line-clamp-3 text-sm text-strong'>
                        {entry.message}
                      </p>
                      <p className='mt-2 text-xs font-semibold text-primary-text'>
                        Open details
                      </p>
                    </Link>
                  ))
                )}
              </div>
            ) : (
              <div className='mt-4 space-y-3 text-sm text-faint'>
                <ArcadeLinkButton href='/signin?next=/feedback/new' tone='primary'>
                  Sign in
                </ArcadeLinkButton>
              </div>
            )}
          </aside> : null}
        </div>
    </AppPageFrame>
  );
}
