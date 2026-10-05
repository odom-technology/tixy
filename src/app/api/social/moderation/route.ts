import { NextResponse } from 'next/server';

import { recordAdminAction } from '@/server/admin/audit';
import { requireIdentity } from '@/server/auth';
import { getAccountsByIds } from '@/server/accounts';
import { deleteFriendshipBetweenUsers } from '@/server/arcade/multiplayer';
import { blockUser, listBlockedUsers, unblockUser } from '@/server/social/blocks';
import {
  removeArcadeLobbyMessage,
  reportArcadeLobbyMessage,
} from '@/server/social/messaging';

export async function GET() {
  let identity;
  try {
    identity = await requireIdentity({ allowExternal: true });
  } catch {
    return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  }
  const ids = await listBlockedUsers(identity.userId);
  const accounts = await getAccountsByIds(ids);
  const byId = new Map(accounts.map((account) => [account.id, account]));
  return NextResponse.json({
    blocked: ids.map((userId) => ({
      userId,
      name: byId.get(userId)?.username || 'Player',
      imageUrl: byId.get(userId)?.imageUrl ?? null,
    })),
  });
}

export async function POST(request: Request) {
  let identity;
  try {
    identity = await requireIdentity({ allowExternal: true });
  } catch {
    return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  }
  let body: {
    action?: 'report' | 'block' | 'unblock' | 'remove-message';
    messageId?: string;
    targetUserId?: string;
    reason?: string;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 });
  }

  if (body.action === 'report' && body.messageId?.trim()) {
    const reported = await reportArcadeLobbyMessage({
      reporterUserId: identity.userId,
      messageId: body.messageId.trim(),
      reason: body.reason,
    });
    return reported
      ? NextResponse.json({ ok: true })
      : NextResponse.json({ error: 'Message not found.' }, { status: 404 });
  }
  if ((body.action === 'block' || body.action === 'unblock') && body.targetUserId?.trim()) {
    const targetUserId = body.targetUserId.trim();
    if (targetUserId === identity.userId) {
      return NextResponse.json({ error: 'You cannot block yourself.' }, { status: 400 });
    }
    if (body.action === 'block') {
      await blockUser(identity.userId, targetUserId);
      await deleteFriendshipBetweenUsers(identity.userId, targetUserId);
    } else await unblockUser(identity.userId, targetUserId);
    return NextResponse.json({ ok: true });
  }
  if (body.action === 'remove-message' && body.messageId?.trim()) {
    if (!identity.roles?.includes('admin')) {
      return NextResponse.json({ error: 'Admin access required.' }, { status: 403 });
    }
    const removed = await removeArcadeLobbyMessage({
      messageId: body.messageId.trim(),
      actorUserId: identity.userId,
    });
    // This route is shared with players, so it can't sit behind withAdmin; the
    // admin branch writes its own audit row.
    await recordAdminAction({
      action: 'social.message.remove',
      actorUserId: identity.userId,
      actorName: identity.name ?? null,
      method: 'POST',
      route: '/api/social/moderation',
      targetType: 'message',
      targetId: body.messageId.trim(),
      status: removed ? 200 : 404,
    });
    return removed
      ? NextResponse.json({ ok: true })
      : NextResponse.json({ error: 'Message not found.' }, { status: 404 });
  }
  return NextResponse.json({ error: 'Invalid moderation action.' }, { status: 400 });
}
