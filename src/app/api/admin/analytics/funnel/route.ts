import { NextResponse } from 'next/server';

import { withAdmin } from '@/server/admin/guard';
import { getProductFunnelAnalytics } from '@/server/analytics/product-analytics';

export const dynamic = 'force-dynamic';

export const GET = withAdmin(async (request) => {
  const requestedDays = Number(new URL(request.url).searchParams.get('days') ?? 30);
  try {
    return NextResponse.json(await getProductFunnelAnalytics(requestedDays));
  } catch (error) {
    console.error('Failed to load product funnel analytics:', error);
    return NextResponse.json(
      { error: 'Unable to load funnel analytics.' },
      { status: 500 },
    );
  }
});
