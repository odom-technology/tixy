import { redirect } from 'next/navigation';

import { listFeedback } from '@/server/feedback';
import { requireIdentity } from '@/server/auth';
import { checkRole } from '@/server/auth/check-role';

import { AdminFeedbackClient } from './_admin-feedback-client';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Feedback admin | Arcade',
};

export default async function AdminFeedbackPage() {
  let identity;
  try {
    identity = await requireIdentity();
  } catch {
    redirect('/signin?next=/admin/feedback');
  }

  if (!(await checkRole('admin', identity))) {
    redirect('/');
  }

  const entries = await listFeedback({
    status: 'open',
    category: 'all',
    limit: 100,
  });

  return <AdminFeedbackClient initialEntries={entries} />;
}
