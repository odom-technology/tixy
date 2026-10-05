import { NextResponse } from 'next/server';

import { getTicketPacks } from '@/server/monetization/ticket-packs';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json({
    packs: getTicketPacks(),
  });
}
