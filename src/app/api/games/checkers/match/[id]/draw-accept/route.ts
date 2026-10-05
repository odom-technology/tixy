import { NextResponse } from 'next/server';
import { requireIdentity } from '@/server/auth';
import { acceptDraw } from '@/server/arcade/checkers-match';

export const dynamic = 'force-dynamic';

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  let identity;
  try {
    identity = await requireIdentity({ allowExternal: true });
  } catch {
    return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  }

  const { id: matchId } = await params;
  try {
    const { match, eloChange } = await acceptDraw(matchId, identity.userId);
    return NextResponse.json({ match, eloChange: eloChange ?? undefined });
  } catch (error) {
    const message = (error as Error).message;
    const status = message.includes('not found') ? 404
      : message.includes('not in progress') || message.includes('No draw') || message.includes('expired') ? 409
      : 403;
    return NextResponse.json({ error: message }, { status });
  }
}
