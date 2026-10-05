import { redirect } from 'next/navigation';
import { requireIdentity } from '@/server/auth';

export const dynamic = 'force-dynamic';

export default async function MessagesPage({
  searchParams,
}: {
  searchParams: Promise<{ c?: string }>;
}) {
  const identity = await requireIdentity({ allowExternal: true }).catch(() => null);
  if (!identity) redirect('/signin?next=/messages');

  const { c } = await searchParams;

  void identity;
  redirect(c ? `/social?view=dm&c=${encodeURIComponent(c)}` : '/social');
}
