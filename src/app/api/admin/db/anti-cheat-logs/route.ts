import { NextResponse } from 'next/server';
import { withAdmin } from '@/server/admin/guard';
import {
  getAntiCheatLogs,
  serializeAntiCheatLogs,
} from '@/server/arcade/anti-cheat-logs';

export const dynamic = 'force-dynamic';

export const GET = withAdmin(async (request) => {
  const url = new URL(request.url);
  const format = url.searchParams.get('format');
  const date = url.searchParams.get('date') ?? undefined;

  if (format === 'txt') {
    const body = await serializeAntiCheatLogs(date);
    const { dateKey } = await getAntiCheatLogs(date);
    return new NextResponse(body, {
      status: 200,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Content-Disposition': `attachment; filename="anti-cheat-logs-${dateKey}.txt"`,
      },
    });
  }

  const logs = await getAntiCheatLogs(date);
  return NextResponse.json(logs);
});
