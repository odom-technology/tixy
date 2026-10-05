import AdminDBClient from '../_admin-db-client';
import { AdminPageFrame } from '@/features/arcade/components/shell/page-frame';

export default function AdminDatabaseGameTimePage() {
  return (
    <AdminPageFrame
      title='Game time'
      subtitle='Audit player time cards and game sessions.'
      contentClassName='space-y-6'
    >
      <AdminDBClient page='game-time' />
    </AdminPageFrame>
  );
}
