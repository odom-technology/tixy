import { listAdminAudit } from '@/server/admin/audit';
import { requireAdminPage } from '@/server/admin/guard';

import { AuditClient } from './_audit-client';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Audit log | tixy admin' };

export default async function AdminAuditPage() {
  await requireAdminPage('/admin/audit');
  const initial = await listAdminAudit({ limit: 50 }).catch((error: Error) => {
    console.error('[admin] audit list failed', error.message);
    return null;
  });
  return <AuditClient initial={initial} />;
}
