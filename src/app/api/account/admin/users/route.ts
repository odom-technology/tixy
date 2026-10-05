import { NextResponse } from 'next/server';

import { checkRole } from '@/server/auth/check-role';
import { withAdmin } from '@/server/admin/guard';
import {
  getAccountById,
  grantRole,
  isAccountRole,
  listAccounts,
  revokeRole,
  setAccountStatus,
  type AccountStatus,
} from '@/server/accounts';

export const dynamic = 'force-dynamic';

export const GET = withAdmin(async (request) => {
  const url = new URL(request.url);
  const status = url.searchParams.get('status') as AccountStatus | 'all' | null;
  const limit = Number(url.searchParams.get('limit') ?? 50);
  const query = url.searchParams.get('q') ?? undefined;

  try {
    const users = await listAccounts({
      query,
      status: status ?? 'all',
      limit,
    });
    return NextResponse.json({ users });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message || 'Unable to list accounts.' },
      { status: 400 },
    );
  }
});

const PATCH_ACTIONS: Record<string, string> = {
  'grant-role': 'user.role.grant',
  'revoke-role': 'user.role.revoke',
  suspend: 'user.suspend',
  unsuspend: 'user.unsuspend',
  delete: 'user.delete',
  restore: 'user.restore',
};

export const PATCH = withAdmin(async (request, { identity }) => {
  let body: {
    userId?: string;
    action?: 'grant-role' | 'revoke-role' | 'suspend' | 'unsuspend' | 'delete' | 'restore';
    role?: string;
    reason?: string;
    expiresAt?: number | null;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 });
  }

  if (!body.userId?.trim()) {
    return NextResponse.json({ error: 'userId is required.' }, { status: 400 });
  }
  const target = await getAccountById(body.userId);
  if (!target) {
    return NextResponse.json({ error: 'Account not found.' }, { status: 404 });
  }
  const actorIsAdmin = await checkRole('admin', identity);
  const targetIsAdmin = target.roles.includes('admin');
  const isSelf = target.id === identity.userId;

  try {
    if (body.action === 'grant-role' || body.action === 'revoke-role') {
      if (!actorIsAdmin) {
        return NextResponse.json({ error: 'Only admins can change roles.' }, { status: 403 });
      }
      if (!body.role || !isAccountRole(body.role)) {
        return NextResponse.json({ error: 'Invalid role.' }, { status: 400 });
      }
      if (isSelf && body.action === 'revoke-role' && body.role === 'admin') {
        return NextResponse.json(
          { error: 'You cannot revoke your own admin role.' },
          { status: 400 },
        );
      }
      const account = body.action === 'grant-role'
        ? await grantRole({
            userId: body.userId,
            role: body.role,
            grantedBy: identity.userId,
          })
        : await revokeRole({ userId: body.userId, role: body.role });
      return NextResponse.json({ account });
    }

    if (targetIsAdmin && !actorIsAdmin) {
      return NextResponse.json({ error: 'Only admins can modify admin accounts.' }, { status: 403 });
    }

    if (body.action === 'suspend') {
      if (isSelf) {
        return NextResponse.json(
          { error: 'You cannot suspend your own account.' },
          { status: 400 },
        );
      }
      const account = await setAccountStatus({
        userId: body.userId,
        status: 'suspended',
        actorUserId: identity.userId,
        reason: body.reason,
        expiresAt: body.expiresAt ?? null,
      });
      return NextResponse.json({ account });
    }

    if (body.action === 'unsuspend' || body.action === 'restore') {
      const account = await setAccountStatus({
        userId: body.userId,
        status: 'active',
        actorUserId: identity.userId,
        reason: body.reason,
      });
      return NextResponse.json({ account });
    }

    if (body.action === 'delete') {
      if (isSelf) {
        return NextResponse.json(
          { error: 'You cannot delete your own account from this panel.' },
          { status: 400 },
        );
      }
      if (!actorIsAdmin) {
        return NextResponse.json({ error: 'Only admins can delete accounts.' }, { status: 403 });
      }
      const account = await setAccountStatus({
        userId: body.userId,
        status: 'deleted',
        actorUserId: identity.userId,
        reason: body.reason,
      });
      return NextResponse.json({ account });
    }

    return NextResponse.json({ error: 'Invalid action.' }, { status: 400 });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message || 'Unable to update account.' },
      { status: 400 },
    );
  }
}, {
  audit: ({ body }) => {
    const input = (body ?? {}) as { userId?: unknown; action?: unknown; reason?: unknown };
    const action = typeof input.action === 'string' ? input.action : '';
    return {
      action: PATCH_ACTIONS[action] ?? 'user.invalid_action',
      targetType: 'user',
      targetId: typeof input.userId === 'string' ? input.userId.trim() : null,
      reason: typeof input.reason === 'string' ? input.reason : null,
      details: input as Record<string, unknown>,
    };
  },
});

export const DELETE = withAdmin(async (request, { identity }) => {
  const userId = new URL(request.url).searchParams.get('userId')?.trim();
  if (!userId) {
    return NextResponse.json({ error: 'userId is required.' }, { status: 400 });
  }
  if (userId === identity.userId) {
    return NextResponse.json(
      { error: 'You cannot delete your own account from this panel.' },
      { status: 400 },
    );
  }

  try {
    const account = await setAccountStatus({
      userId,
      status: 'deleted',
      actorUserId: identity.userId,
      reason: 'Deleted by admin',
    });
    return NextResponse.json({ account });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message || 'Unable to delete account.' },
      { status: 400 },
    );
  }
}, {
  audit: ({ searchParams }) => ({
    action: 'user.delete',
    targetType: 'user',
    targetId: searchParams.get('userId')?.trim() || null,
  }),
});
