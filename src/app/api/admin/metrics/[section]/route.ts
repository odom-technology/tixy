import { NextResponse } from 'next/server';

import { withAdmin } from '@/server/admin/guard';
import {
  getCounterMetrics,
  getEconomyMetrics,
  getGamesMetrics,
  getLiveMetrics,
  getMachinesMetrics,
  getOverviewMetrics,
  getPlayersMetrics,
  getProgressionMetrics,
  getTrustMetrics,
  parseWindow,
} from '@/server/admin/metrics';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const HEADERS = { 'Cache-Control': 'private, no-store' };

const SECTIONS: Record<string, (days: number) => Promise<unknown>> = {
  overview: getOverviewMetrics,
  players: getPlayersMetrics,
  games: getGamesMetrics,
  economy: getEconomyMetrics,
  machines: getMachinesMetrics,
  counter: getCounterMetrics,
  progression: getProgressionMetrics,
  trust: getTrustMetrics,
  live: () => getLiveMetrics(),
};

/* GET /api/admin/metrics/<section>?days=7|30|90. Admin only (withAdmin). */
export const GET = withAdmin<{ section: string }>(async (request, { params }) => {
  const load = Object.hasOwn(SECTIONS, params.section) ? SECTIONS[params.section] : undefined;
  if (!load) {
    return NextResponse.json({ error: 'Unknown section.' }, { status: 404, headers: HEADERS });
  }
  const days = parseWindow(new URL(request.url).searchParams.get('days'));
  try {
    return NextResponse.json(await load(days), { headers: HEADERS });
  } catch (error) {
    console.error(
      `[admin-metrics] ${params.section} failed`,
      error instanceof Error ? error.message : 'unknown',
    );
    return NextResponse.json({ error: 'Unable to load metrics.' }, { status: 500, headers: HEADERS });
  }
});
