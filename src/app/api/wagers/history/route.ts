import { NextResponse } from 'next/server';
import { requireIdentity } from '@/server/auth';
import { getArcadeHistory } from '@/server/arcade/arcade-session';

export const dynamic = 'force-dynamic';

export async function GET() {
  let identity;
  try {
    identity = await requireIdentity({ allowExternal: true });
  } catch {
    return NextResponse.json({ error: 'Sign in to play for tickets.' }, { status: 401 });
  }

  const history = await getArcadeHistory(identity.userId, 30);
  return NextResponse.json({ history });
}
