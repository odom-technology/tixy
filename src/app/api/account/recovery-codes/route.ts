import { NextResponse } from 'next/server';

import {
  getRecoveryCodeSummary,
  rotateRecoveryCodes,
} from '@/server/account-recovery';
import { requireIdentity } from '@/server/auth';

export const dynamic = 'force-dynamic';

export async function GET() {
  let identity;
  try {
    identity = await requireIdentity({ allowExternal: true });
  } catch {
    return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  }

  return NextResponse.json({
    summary: await getRecoveryCodeSummary(identity.userId),
  });
}

export async function POST() {
  let identity;
  try {
    identity = await requireIdentity({ allowExternal: true });
  } catch {
    return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  }

  try {
    return NextResponse.json(await rotateRecoveryCodes(identity.userId));
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message || 'Unable to generate recovery codes.' },
      { status: 400 },
    );
  }
}
