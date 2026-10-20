'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { CheckCircle2, RefreshCw, Send } from 'lucide-react';

import { ArcadeButton, ArcadeChip, ArcadeLinkButton, ArcadeNotice } from '@/features/arcade/components/ui/arcade-ui';
import { AppPageFrame } from '@/features/arcade/components/shell/page-frame';
import type { FeedbackComment, FeedbackTicketEntry } from '@/server/feedback';

type Conversation = {
  entry: FeedbackTicketEntry;
  comments: FeedbackComment[];
  hasMore: boolean;
  contactEmail?: string | null;
};

function formatDate(timestamp: number) {
  return new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' }).format(timestamp);
}

async function readResponse<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.error || 'Unable to update this ticket. Please try again.');
  return payload as T;
}

export function TicketConversation({ initialConversation, isAdmin, canReply }: {
  initialConversation: Conversation;
  isAdmin: boolean;
  canReply: boolean;
}) {
  const [conversation, setConversation] = useState(initialConversation);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState<'reply' | 'status' | 'refresh' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const requestVersion = useRef(0);
  const { entry, comments } = conversation;
  const ticketUrl = `/api/feedback/${encodeURIComponent(entry.id)}`;
  const isOpen = entry.status === 'open';

  const refresh = useCallback(async (manual = false) => {
    const version = ++requestVersion.current;
    if (manual) { setBusy('refresh'); setError(null); }
    try {
      const latest = await readResponse<Conversation>(await fetch(ticketUrl, { cache: 'no-store' }));
      if (version === requestVersion.current) {
        setConversation(latest);
        setError(null);
        if (manual) setNotice('Conversation updated.');
      }
    } catch (caught) {
      if (version === requestVersion.current) setError((caught as Error).message);
    } finally {
      if (manual && version === requestVersion.current) setBusy(null);
    }
  }, [ticketUrl]);

  useEffect(() => {
    if (busy) return;
    const update = () => { if (!document.hidden) void refresh(); };
    const timer = window.setInterval(update, 30_000);
    window.addEventListener('focus', update);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', update);
    };
  }, [busy, refresh]);

  async function sendReply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !message.trim()) return;
    requestVersion.current += 1;
    setBusy('reply'); setError(null); setNotice(null);
    try {
      const url = isAdmin ? `/api/admin/feedback/${encodeURIComponent(entry.id)}/comments` : `${ticketUrl}/comments`;
      const result = await readResponse<{ entry: FeedbackTicketEntry; comment: FeedbackComment }>(await fetch(url, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message }),
      }));
      setConversation(current => ({ ...current, entry: result.entry, comments: [...current.comments, result.comment] }));
      setMessage('');
      setNotice('Reply sent.');
      await refresh();
    } catch (caught) {
      setError((caught as Error).message);
      // Keep the draft when another person has resolved the ticket or a request fails.
    } finally { setBusy(null); }
  }

  async function changeStatus() {
    if (busy) return;
    requestVersion.current += 1;
    setBusy('status'); setError(null); setNotice(null);
    try {
      const result = await readResponse<{ entry: FeedbackTicketEntry }>(await fetch('/api/admin/feedback', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: entry.id, status: isOpen ? 'resolved' : 'open' }),
      }));
      setConversation(current => ({ ...current, entry: {
        ...current.entry, status: result.entry.status, updatedAt: result.entry.updatedAt,
      } }));
      await refresh();
      setNotice(isOpen ? 'Ticket resolved. The conversation is saved.' : 'Ticket reopened.');
    } catch (caught) { setError((caught as Error).message); }
    finally { setBusy(null); }
  }

  return (
    <AppPageFrame
      eyebrow='Support'
      title={isAdmin ? 'Feedback ticket' : 'Your feedback ticket'}
      subtitle='Keep the conversation together. Replies are private to the submitter and Tixy admins.'
      actions={<ArcadeLinkButton href={isAdmin ? '/admin/feedback' : '/feedback'}>{isAdmin ? 'Feedback inbox' : 'Your tickets'}</ArcadeLinkButton>}
      contentClassName='space-y-5'
    >
      <section className='arcade-card space-y-4 p-4 sm:p-6' aria-labelledby='ticket-heading'>
        <div className='flex flex-wrap items-start justify-between gap-3'>
          <div className='space-y-2'>
            <h2 id='ticket-heading' className='text-lg font-semibold'>Original request</h2>
            <div className='flex flex-wrap items-center gap-2 text-xs text-faint'>
              <ArcadeChip className='capitalize'>{entry.category.replaceAll('_', ' ')}</ArcadeChip>
              <ArcadeChip tone={isOpen ? 'info' : 'prize'}>{isOpen ? 'Open' : 'Resolved'}</ArcadeChip>
              {entry.rating ? <span>Rating {entry.rating}/5</span> : null}
            </div>
          </div>
          {isAdmin ? <ArcadeButton disabled={Boolean(busy)} onClick={() => void changeStatus()}>
            {isOpen ? <CheckCircle2 size={16} /> : <RefreshCw size={16} />}
            {busy === 'status' ? 'Saving…' : isOpen ? 'Resolve ticket' : 'Reopen ticket'}
          </ArcadeButton> : null}
        </div>
        <p className='whitespace-pre-wrap break-words text-sm leading-7 text-body'>{entry.message}</p>
        <dl className='grid gap-4 border-t border-soft pt-4 text-sm sm:grid-cols-2'>
          <div><dt className='text-xs text-faint'>Submitted</dt><dd className='mt-1'>{formatDate(entry.createdAt)}</dd></div>
          <div><dt className='text-xs text-faint'>Last updated</dt><dd className='mt-1'>{formatDate(entry.updatedAt)}</dd></div>
          {entry.pagePath ? <div><dt className='text-xs text-faint'>Page or game</dt><dd className='mt-1 break-words'>{entry.pagePath}</dd></div> : null}
          {isAdmin ? <div><dt className='text-xs text-faint'>Contact email</dt><dd className='mt-1 break-all'>{conversation.contactEmail || 'Not provided'}</dd></div> : null}
          <div><dt className='text-xs text-faint'>Ticket reference</dt><dd className='mt-1 break-all font-mono text-xs'>{entry.id}</dd></div>
        </dl>
      </section>

      <section className='arcade-card space-y-5 p-4 sm:p-6' aria-labelledby='conversation-heading'>
        <div className='flex flex-wrap items-center justify-between gap-3'>
          <div><h2 id='conversation-heading' className='text-lg font-semibold'>Conversation</h2><p className='mt-1 text-xs text-faint'>Updates refresh automatically while this page is open.</p></div>
          <ArcadeButton disabled={Boolean(busy)} onClick={() => void refresh(true)}><RefreshCw size={16} />{busy === 'refresh' ? 'Refreshing…' : 'Refresh replies'}</ArcadeButton>
        </div>
        {conversation.hasMore ? <ArcadeNotice tone='info'>Showing the latest 200 replies.</ArcadeNotice> : null}
        {entry.adminNote ? <article className='arcade-card-inset p-4'><h3 className='text-sm font-semibold'>Earlier admin response</h3><p className='mt-2 whitespace-pre-wrap break-words text-sm leading-6'>{entry.adminNote}</p></article> : null}
        {comments.length === 0 ? <p className='text-sm text-faint'>No replies yet. Follow up here and check back for a response.</p> : <ol aria-label='Ticket replies' className='space-y-3'>
          {comments.map(comment => <li key={comment.id} className={`rounded-xl border p-4 ${comment.authorRole === 'admin' ? 'border-soft bg-raised' : 'border-soft bg-well'}`}>
            <div className='flex flex-wrap items-center justify-between gap-2 text-xs text-faint'>
              <h3 className='font-semibold text-strong'>{comment.authorRole === 'admin' ? 'Tixy support' : comment.authorName || 'Player'}</h3>
              <time dateTime={new Date(comment.createdAt).toISOString()}>{formatDate(comment.createdAt)}</time>
            </div>
            <p className='mt-2 whitespace-pre-wrap break-words text-sm leading-7 text-body'>{comment.message}</p>
          </li>)}
        </ol>}
        {!canReply ? <ArcadeNotice tone='info'>This was submitted without an account. Use the contact email above for follow-up; this guest cannot access an in-app conversation.</ArcadeNotice> : isOpen ? <form onSubmit={event => void sendReply(event)} className='space-y-3 border-t border-soft pt-5'>
          <label className='block text-sm font-semibold' htmlFor='ticket-reply'>{isAdmin ? 'Reply to the player' : 'Add a reply'}</label>
          <textarea id='ticket-reply' value={message} onChange={event => setMessage(event.target.value)} maxLength={3000} minLength={1} required rows={5} placeholder={isAdmin ? 'Write a response the player can read on this ticket.' : 'Add details or respond to Tixy support.'} className='arcade-input w-full resize-y px-3 py-2 text-sm leading-7' aria-describedby='reply-help' disabled={busy === 'reply'} />
          <div className='flex flex-wrap items-center justify-between gap-3'>
            <p id='reply-help' className='text-xs text-faint'>{message.length}/3000 characters · Don’t include passwords or payment details.</p>
            <ArcadeButton type='submit' tone='primary' disabled={Boolean(busy) || !message.trim()}><Send size={16} />{busy === 'reply' ? 'Sending…' : 'Send reply'}</ArcadeButton>
          </div>
        </form> : <ArcadeNotice tone='info'>This ticket is resolved. {isAdmin ? 'Reopen it to continue the conversation.' : 'If you still need help, submit a new ticket and include this ticket’s reference.'}</ArcadeNotice>}
        {notice ? <div role='status'><ArcadeNotice tone='success'>{notice}</ArcadeNotice></div> : null}
        {error ? <div role='alert'><ArcadeNotice tone='danger'>{error}</ArcadeNotice></div> : null}
      </section>
    </AppPageFrame>
  );
}
