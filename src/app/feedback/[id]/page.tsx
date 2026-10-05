import { notFound, redirect } from 'next/navigation';
import { MessageSquare } from 'lucide-react';

import {
  ArcadeChip,
  ArcadeLinkButton,
} from '@/features/arcade/components/ui/arcade-ui';
import { AppPageFrame } from '@/features/arcade/components/shell/page-frame';
import { requireIdentity } from '@/server/auth';
import { checkRole } from '@/server/auth/check-role';
import { getFeedbackById } from '@/server/feedback';

type FeedbackDetailPageProps = {
  params: Promise<{
    id: string;
  }>;
};

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Feedback detail | Arcade',
};

function formatDate(timestamp: number) {
  return new Intl.DateTimeFormat('en', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(timestamp));
}

function statusTone(status: string): 'prize' | 'info' | undefined {
  if (status === 'resolved') return 'prize';
  if (status === 'dismissed') return undefined;
  return 'info';
}

export default async function FeedbackDetailPage({
  params,
}: FeedbackDetailPageProps) {
  let identity;
  try {
    identity = await requireIdentity({ allowExternal: true });
  } catch {
    const { id } = await params;
    redirect(`/signin?next=/feedback/${encodeURIComponent(id)}`);
  }

  const { id } = await params;
  const entry = await getFeedbackById(id);
  if (!entry) notFound();

  const isAdmin = await checkRole('admin', identity);
  const canView = entry.userId === identity.userId || isAdmin;
  if (!canView) notFound();

  return (
    <AppPageFrame
      title={
        <span className='flex items-center gap-3'>
          <MessageSquare size={28} />
          Feedback Detail
        </span>
      }
      actions={<ArcadeLinkButton href='/feedback'>Feedback</ArcadeLinkButton>}
      contentClassName='space-y-6'
    >
        <article className='arcade-card p-5'>
          <div className='flex flex-wrap items-center gap-2 text-xs text-faint'>
            <ArcadeChip tone='info'>
              {entry.category.replaceAll('_', ' ')}
            </ArcadeChip>
            <ArcadeChip tone={statusTone(entry.status)} className='capitalize'>
              {entry.status}
            </ArcadeChip>
            {entry.rating ? <span>Rating {entry.rating}/5</span> : null}
          </div>

          <dl className='mt-5 grid gap-4 border-t border-soft pt-5 sm:grid-cols-2'>
            <div>
              <dt className='text-xs uppercase text-faint'>Submitted</dt>
              <dd className='mt-1 text-sm text-body'>{formatDate(entry.createdAt)}</dd>
            </div>
            <div>
              <dt className='text-xs uppercase text-faint'>Updated</dt>
              <dd className='mt-1 text-sm text-body'>{formatDate(entry.updatedAt)}</dd>
            </div>
            <div>
              <dt className='text-xs uppercase text-faint'>Page</dt>
              <dd className='mt-1 break-words text-sm text-body'>
                {entry.pagePath ?? 'Not specified'}
              </dd>
            </div>
            <div>
              <dt className='text-xs uppercase text-faint'>Reference</dt>
              <dd className='mt-1 break-all font-mono text-xs text-faint'>
                {entry.id}
              </dd>
            </div>
          </dl>

          <div className='mt-5 border-t border-soft pt-5'>
            <h2 className='text-lg font-semibold'>Message</h2>
            <p className='mt-3 whitespace-pre-wrap text-sm leading-6 text-body'>
              {entry.message}
            </p>
          </div>

          {entry.adminNote ? (
            <div className='mt-5 arcade-card-inset p-4'>
              <h2 className='text-lg font-semibold text-strong'>Admin note</h2>
              <p className='mt-3 whitespace-pre-wrap text-sm leading-6 text-body'>
                {entry.adminNote}
              </p>
              {entry.statusUpdatedAt ? (
                <p className='mt-3 text-xs text-faint'>
                  Updated {formatDate(entry.statusUpdatedAt)}
                </p>
              ) : null}
            </div>
          ) : null}
        </article>
    </AppPageFrame>
  );
}
