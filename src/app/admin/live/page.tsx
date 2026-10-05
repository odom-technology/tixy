import { requireAdminPage } from '@/server/admin/guard';
import { getLiveMetrics } from '@/server/admin/metrics';

import { LiveClient } from './_live-client';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Live | tixy admin' };

export default async function AdminLivePage() {
  await requireAdminPage('/admin/live');
  const initial = await getLiveMetrics().catch((error: Error) => {
    console.error('[admin] live metrics failed', error.message);
    return null;
  });
  return <LiveClient initial={initial} />;
}
