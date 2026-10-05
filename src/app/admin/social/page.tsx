import { redirect } from 'next/navigation';

import { AdminPageFrame } from '@/features/arcade/components/shell/page-frame';
import { ArcadeLinkButton } from '@/features/arcade/components/ui/arcade-ui';
import { requireIdentity } from '@/server/auth';
import { checkRole } from '@/server/auth/check-role';

import { SocialModerationClient } from './_social-moderation-client';

export default async function SocialModerationPage() {
  const identity = await requireIdentity().catch(() => null);
  if (!identity) redirect('/signin?next=/admin/social');
  if (!(await checkRole('admin', identity))) redirect('/');
  return (
    <AdminPageFrame
      title='Social moderation'
      subtitle='Review reports from tixy Lobby.'
      actions={<ArcadeLinkButton href='/admin' tone='ghost' size='sm'>Admin dashboard</ArcadeLinkButton>}
    >
      <SocialModerationClient />
    </AdminPageFrame>
  );
}
