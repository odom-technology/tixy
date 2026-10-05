import AdminDBClient from '../_admin-db-client';
import { AdminConsoleFrame } from '@/features/admin/components/admin-console';

export default async function AdminDatabaseEconomyPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string | string[] }>;
}) {
  const { tab } = await searchParams;
  return (
    <AdminConsoleFrame
      title='Ledger and store'
      subtitle='Ticket activity, the store and its catalog, and adjustments.'
      contentClassName='space-y-6'
    >
      <AdminDBClient
        page='economy'
        economyTab={typeof tab === 'string' ? tab : undefined}
      />
    </AdminConsoleFrame>
  );
}
