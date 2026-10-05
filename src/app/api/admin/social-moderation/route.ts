import { NextResponse } from 'next/server';

import { withAdmin } from '@/server/admin/guard';
import {
  listOpenLobbyMessageReports,
  resolveLobbyMessageReport,
} from '@/server/social/messaging';

export const GET = withAdmin(async () => {
  return NextResponse.json({ reports: await listOpenLobbyMessageReports() });
});

export const PATCH = withAdmin(async (request, { identity }) => {
  let body: { reportId?: string; action?: 'remove' | 'dismiss' };
  try { body = (await request.json()) as typeof body; } catch { return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 }); }
  if (!body.reportId?.trim() || (body.action !== 'remove' && body.action !== 'dismiss')) {
    return NextResponse.json({ error: 'Invalid report action.' }, { status: 400 });
  }
  const resolved = await resolveLobbyMessageReport({
    reportId: body.reportId.trim(),
    actorUserId: identity.userId,
    removeMessage: body.action === 'remove',
  });
  return resolved ? NextResponse.json({ ok: true }) : NextResponse.json({ error: 'Report not found.' }, { status: 404 });
}, {
  audit: ({ body }) => {
    const input = (body ?? {}) as { reportId?: unknown; action?: unknown };
    return {
      action: 'social.moderate',
      targetType: 'report',
      targetId: typeof input.reportId === 'string' ? input.reportId.trim() : null,
      details: { action: input.action },
    };
  },
});
