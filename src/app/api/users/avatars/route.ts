import { NextResponse } from 'next/server';

import { getAccountById } from '@/server/accounts';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  let body: { userIds?: string[] };
  try {
    body = (await request.json()) as { userIds?: string[] };
  } catch {
    return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 });
  }

  const userIds = Array.from(
    new Set((body.userIds ?? []).filter((id): id is string => typeof id === 'string' && Boolean(id.trim()))),
  ).slice(0, 200);

  const avatars: Record<string, string | null> = {};
  for (const userId of userIds) {
    const account = await getAccountById(userId);
    avatars[userId] = account?.imageUrl ?? null;
  }

  return NextResponse.json({ avatars });
}
