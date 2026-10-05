import { NextResponse } from 'next/server';

import { requireIdentity } from '@/server/auth';
import { getAccountByEmail, getAccountById, getAccountByUsername } from '@/server/accounts';
import {
  acceptArcadeFriendship,
  deleteArcadeFriendship,
  getOtherFriendshipUserId,
  listFriendshipsForUser,
  sendArcadeFriendRequest,
} from '@/server/arcade/multiplayer';
import { recordActivityEvent } from '@/server/services/activity-events';
import { createNotification } from '@/server/services/notifications';
import { evaluateProfileMilestones } from '@/server/services/profile-milestones';
import { isBlocked } from '@/server/social/blocks';
import { listFriendSummaries } from '@/server/social/friends';

export const dynamic = 'force-dynamic';

async function listForIdentity(userId: string) {
  return listFriendSummaries(userId);
}

export async function GET() {
  let identity;
  try {
    identity = await requireIdentity({ allowExternal: true });
  } catch {
    return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  }

  try {
    return NextResponse.json(await listForIdentity(identity.userId));
  } catch (error) {
    console.error('Failed to load friends:', error);
    return NextResponse.json({ error: 'Unable to load friends right now.' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  let identity;
  try {
    identity = await requireIdentity({ allowExternal: true });
  } catch {
    return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  }

  let body: {
    email?: string;
    lookup?: string;
    targetUserId?: string;
    username?: string;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 });
  }

  try {
    const before = await listFriendshipsForUser(identity.userId);
    const beforeIds = new Set(
      [...before.friends, ...before.incoming, ...before.outgoing].map((friendship) =>
        getOtherFriendshipUserId(friendship, identity.userId),
      ),
    );

    const lookup = body.lookup?.trim() || '';
    const target = body.targetUserId?.trim()
      ? await getAccountById(body.targetUserId.trim())
      : body.username?.trim()
        ? await getAccountByUsername(body.username)
        : body.email?.trim()
          ? await getAccountByEmail(body.email)
          : lookup
            ? lookup.includes('@')
              ? await getAccountByEmail(lookup)
              : await getAccountByUsername(lookup)
            : null;
    if (!target || target.status !== 'active') {
      return NextResponse.json({ error: 'No active user found.' }, { status: 404 });
    }
    if (target.id === identity.userId) {
      return NextResponse.json({ error: 'You cannot add yourself as a friend.' }, { status: 400 });
    }
    if (await isBlocked(identity.userId, target.id)) {
      return NextResponse.json({ error: 'You cannot add this user.' }, { status: 403 });
    }

    const friendship = await sendArcadeFriendRequest({
      requesterUserId: identity.userId,
      recipientUserId: target.id,
    });

    if (
      friendship.status === 'pending' &&
      friendship.requesterUserId === identity.userId &&
      !beforeIds.has(target.id)
    ) {
      const requesterName = identity.name?.trim() || 'Someone';
      await createNotification({
        userId: target.id,
        type: 'friend_request',
        title: 'New friend request',
        body: `${requesterName} sent you a friend request.`,
        href: '/friends',
        preferenceKey: 'game_notifications',
      });
    }

    return NextResponse.json({
      success: true,
      friendship,
      ...(await listForIdentity(identity.userId)),
    });
  } catch (error) {
    console.error('Failed to add friend:', error);
    return NextResponse.json(
      { error: (error as Error).message || 'Unable to add friend.' },
      { status: 500 },
    );
  }
}

export async function PATCH(request: Request) {
  let identity;
  try {
    identity = await requireIdentity({ allowExternal: true });
  } catch {
    return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  }

  let body: {
    friendshipId?: string;
    action?: 'accept' | 'decline' | 'remove';
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 });
  }

  if (!body.friendshipId?.trim()) {
    return NextResponse.json({ error: 'friendshipId is required.' }, { status: 400 });
  }

  try {
    if (body.action === 'accept') {
      const friendship = await acceptArcadeFriendship({
        friendshipId: body.friendshipId,
        actorUserId: identity.userId,
      });
      await createNotification({
        userId: friendship.requesterUserId,
        type: 'friend_request_accepted',
        title: 'Friend request accepted',
        body: `${identity.name?.trim() || 'Someone'} accepted your friend request.`,
        href: '/social?tab=friends',
        preferenceKey: 'game_notifications',
      });
      // Feed event for both new friends (fail-soft).
      void recordActivityEvent({
        userId: identity.userId,
        type: 'friend_added',
        payload: { friendUserId: friendship.requesterUserId },
      });
      void recordActivityEvent({
        userId: friendship.requesterUserId,
        type: 'friend_added',
        payload: { friendUserId: identity.userId },
      });
      void evaluateProfileMilestones(identity.userId);
      void evaluateProfileMilestones(friendship.requesterUserId);
    } else if (body.action === 'decline' || body.action === 'remove') {
      await deleteArcadeFriendship({
        friendshipId: body.friendshipId,
        actorUserId: identity.userId,
      });
    } else {
      return NextResponse.json({ error: 'Invalid action.' }, { status: 400 });
    }

    return NextResponse.json({
      success: true,
      ...(await listForIdentity(identity.userId)),
    });
  } catch (error) {
    console.error('Failed to update friendship:', error);
    return NextResponse.json(
      { error: (error as Error).message || 'Unable to update friend request.' },
      { status: 500 },
    );
  }
}
