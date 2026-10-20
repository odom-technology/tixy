import { notFound, redirect } from 'next/navigation';

import { requireIdentity } from '@/server/auth';
import { checkRole } from '@/server/auth/check-role';
import { FeedbackError, getFeedbackById, getFeedbackConversation } from '@/server/feedback';

import { TicketConversation } from './_ticket-conversation';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Feedback ticket | tixy', robots: { index: false, follow: false } };

export default async function FeedbackDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let identity;
  try {
    identity = await requireIdentity({ allowExternal: true });
  } catch {
    redirect(`/signin?next=${encodeURIComponent(`/feedback/${id}`)}`);
  }
  const isAdmin = await checkRole('admin', identity);
  let conversation: Awaited<ReturnType<typeof getFeedbackConversation>>;
  let canReply = true;
  try {
    conversation = await getFeedbackConversation(id, { userId: identity.userId, isAdmin });
    canReply = isAdmin ? Boolean((await getFeedbackById(id))?.userId) : true;
  } catch (error) {
    if (error instanceof FeedbackError && error.status === 404) notFound();
    throw error;
  }
  return <TicketConversation initialConversation={conversation} isAdmin={isAdmin} canReply={canReply} />;
}
