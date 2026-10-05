import { redirect } from 'next/navigation';

import { NotificationsClient } from '@/app/notifications/_notifications-client';
import { AppPageFrame } from '@/features/arcade/components/shell/page-frame';
import { ArcadeLinkButton } from '@/features/arcade/components/ui/arcade-ui';
import { ActivityFeed } from '@/features/social/activity/activity-feed';
import type { SocialThreadTarget } from '@/features/social/social-types';
import { SocialSafetyPanel } from '@/features/social/social-safety-panel';
import { requireIdentity } from '@/server/auth';
import { getUnreadNotificationCount, listNotificationsForUser } from '@/server/services/notifications';

import { SocialClient } from './_social-client';

export const dynamic = 'force-dynamic';

export default async function SocialPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; c?: string; tab?: string }>;
}) {
  const identity = await requireIdentity({ allowExternal: true }).catch(() => null);
  if (!identity) redirect('/signin?next=/social');
  const { view, c, tab } = await searchParams;
  const resolvedView = view || (tab === 'activity' ? 'alerts' : tab);

  if (resolvedView === 'alerts') {
    const [notifications, unreadCount] = await Promise.all([
      listNotificationsForUser(identity.userId, 40),
      getUnreadNotificationCount(identity.userId),
    ]);
    return (
      <AppPageFrame
        title='alerts'
        subtitle='What your friends did, the games you were invited to, and notices about your account.'
        actions={<ArcadeLinkButton href='/social' size='sm'>back</ArcadeLinkButton>}
        contentClassName='space-y-5'
      >
        <ActivityFeed currentUserId={identity.userId} />
        <NotificationsClient initialNotifications={notifications} initialUnreadCount={unreadCount} embedded />
      </AppPageFrame>
    );
  }

  if (resolvedView === 'safety') {
    return (
      <AppPageFrame
        title='safety'
        subtitle='Who can message you, add you and invite you to a game.'
        actions={<ArcadeLinkButton href='/social' size='sm'>back</ArcadeLinkButton>}
      >
        <SocialSafetyPanel />
      </AppPageFrame>
    );
  }

  let initialThread: SocialThreadTarget | null = null;
  if (resolvedView === 'lobby') initialThread = { kind: 'lobby', id: 'arcade-lobby' };
  if ((resolvedView === 'dm' || resolvedView === 'messages') && c?.trim()) {
    initialThread = { kind: 'dm', id: c.trim() };
  }
  return <SocialClient initialThread={initialThread} initialTab={resolvedView === 'chats' || resolvedView === 'lobby' || resolvedView === 'dm' || resolvedView === 'messages' ? 'chats' : 'friends'} />;
}
