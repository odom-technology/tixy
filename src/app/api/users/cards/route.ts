import { NextResponse } from 'next/server';

import { getPlayerCardsForUsers } from '@/server/arcade/player-cards';

export const dynamic = 'force-dynamic';

// Batched player namecards (name + avatar + equipped flair) for many users.
// Powers cosmetic rendering on leaderboards and match player bars.
//   POST { userIds: string[] } -> { cards: Record<userId, PlayerCard> }
export async function POST(request: Request) {
  let body: { userIds?: string[] };
  try {
    body = (await request.json()) as { userIds?: string[] };
  } catch {
    return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 });
  }

  const userIds = (body.userIds ?? []).filter(
    (id): id is string => typeof id === 'string' && Boolean(id.trim()),
  );

  try {
    const map = await getPlayerCardsForUsers(userIds);
    const cards = Object.fromEntries(map);
    return NextResponse.json({ cards });
  } catch (error) {
    console.error('player cards fetch failed:', error);
    return NextResponse.json({ error: 'Failed to load player cards.' }, { status: 500 });
  }
}
