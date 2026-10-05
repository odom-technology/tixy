import { redirect } from 'next/navigation';

import { hasActiveAccountSession } from '@/server/auth/page-utils';

import { RecoverClient } from './_recover-client';

export const metadata = {
  title: 'Recover account | tixy',
};

export default async function RecoverPage() {
  if (await hasActiveAccountSession()) redirect('/settings');
  return <RecoverClient />;
}
