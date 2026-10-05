import { NextResponse } from 'next/server';

import {
  AuditCursorError,
  AUDIT_EXPORT_CAP,
  listAdminAudit,
  streamAdminAudit,
  type AuditFilters,
  type AuditRow,
} from '@/server/admin/audit';
import { withAdmin } from '@/server/admin/guard';

export const dynamic = 'force-dynamic';

const bad = (message: string) => NextResponse.json({ error: message }, { status: 400 });

/** Milliseconds, or a date the Date constructor reads; null when absent, NaN when bad. */
function parseTime(raw: string | null): number | null {
  if (!raw?.trim()) return null;
  const value = raw.trim();
  const time = /^\d+$/.test(value) ? Number(value) : Date.parse(value);
  return Number.isFinite(time) ? time : Number.NaN;
}

const csvCell = (value: unknown) => {
  let text = value === null || value === undefined ? '' : String(value);
  // A cell that starts like a formula would run in a spreadsheet.
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
};

const CSV_HEADER = [
  'id',
  'created_at',
  'actor_user_id',
  'actor_name',
  'action',
  'method',
  'route',
  'target_type',
  'target_id',
  'target_name',
  'reason',
  'status',
  'correlation_id',
  'details',
].join(',');

const csvLine = (row: AuditRow) =>
  [
    row.id,
    new Date(row.createdAt).toISOString(),
    row.actorUserId,
    row.actorName,
    row.action,
    row.method,
    row.route,
    row.targetType,
    row.targetId,
    row.targetName,
    row.reason,
    row.status,
    row.correlationId,
    JSON.stringify(row.details),
  ]
    .map(csvCell)
    .join(',');

export const GET = withAdmin(async (request) => {
  const params = new URL(request.url).searchParams;
  const from = parseTime(params.get('from'));
  const to = parseTime(params.get('to'));
  if (Number.isNaN(from)) return bad('Invalid from.');
  if (Number.isNaN(to)) return bad('Invalid to.');
  const filters: AuditFilters = {
    actor: params.get('actor'),
    action: params.get('action'),
    targetType: params.get('targetType'),
    targetId: params.get('targetId'),
    from,
    to,
  };

  if (params.get('format') === 'csv') {
    const encoder = new TextEncoder();
    const rows = streamAdminAudit(filters, AUDIT_EXPORT_CAP);
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          controller.enqueue(encoder.encode(`${CSV_HEADER}\n`));
          for await (const batch of rows) {
            controller.enqueue(encoder.encode(`${batch.map(csvLine).join('\n')}\n`));
          }
          controller.close();
        } catch (error) {
          controller.error(error);
        }
      },
    });
    return new Response(stream, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="admin-audit.csv"',
        'Cache-Control': 'no-store',
      },
    });
  }

  const limitRaw = params.get('limit');
  const limit = limitRaw === null || limitRaw === '' ? undefined : Number(limitRaw);
  if (limit !== undefined && !Number.isInteger(limit)) return bad('Invalid limit.');

  try {
    const result = await listAdminAudit({
      ...filters,
      cursor: params.get('cursor') || null,
      limit,
    });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof AuditCursorError) return bad('Invalid cursor.');
    console.error('[admin-audit] list failed', error instanceof Error ? error.message : 'unknown');
    return NextResponse.json({ error: 'Unable to load the audit log.' }, { status: 500 });
  }
});
