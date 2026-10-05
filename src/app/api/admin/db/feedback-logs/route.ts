import { NextResponse } from 'next/server';

import { withAdmin } from '@/server/admin/guard';
import { getFeedbackLogs, serializeFeedbackLogs } from '@/server/feedback';

export const dynamic = 'force-dynamic';

export const GET = withAdmin(async (request) => {
  const url = new URL(request.url);
  const format = url.searchParams.get('format');
  const date = url.searchParams.get('date') ?? undefined;

  if (format === 'txt') {
    const body = await serializeFeedbackLogs(date);
    const { dateKey } = await getFeedbackLogs(date);
    return new NextResponse(body, {
      status: 200,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Content-Disposition': `attachment; filename="feedback-logs-${dateKey}.txt"`,
      },
    });
  }

  return NextResponse.json(await getFeedbackLogs(date));
});
