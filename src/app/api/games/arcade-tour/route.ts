import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/* The arcade tour is scrapped, so no new weeks start. The standings code stays
   in src/server/arcade/arcade-tour.ts until phase 8. */
export async function GET() {
  return NextResponse.json({ error: 'The arcade tour has ended.' }, { status: 410 });
}
