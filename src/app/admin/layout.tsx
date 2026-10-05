import { AdminShell } from '@/features/admin/ui/shell';
import { requireAdminPage } from '@/server/admin/guard';

import '@/features/admin/ui/admin.css';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Admin | tixy',
};

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const identity = await requireAdminPage('/admin');
  return <AdminShell adminName={identity.name?.trim() || 'admin'}>{children}</AdminShell>;
}
