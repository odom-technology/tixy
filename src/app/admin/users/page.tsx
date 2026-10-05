import { requireAdminPage } from '@/server/admin/guard';
import { listAdminUsers } from '@/server/admin/users';

import { UsersClient } from './_users-client';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Users | tixy admin' };

export default async function AdminUsersPage({ searchParams }: { searchParams: Promise<{ user?: string; q?: string }> }) {
  const identity = await requireAdminPage('/admin/users');
  const params = await searchParams;
  const initial = await listAdminUsers({ q: params.q ?? null, limit: 50 }).catch((error: Error) => {
    console.error('[admin] user list failed', error.message);
    return null;
  });
  return <UsersClient currentUserId={identity.userId} initial={initial} initialQuery={params.q ?? ''} initialUser={params.user ?? null} />;
}
