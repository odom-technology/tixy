import { NextResponse } from 'next/server';

import { requireIdentity } from '@/server/auth';
import {
  claimQuest,
  claimSeasonQuest,
  claimWeeklyCard,
  claimWeeklyQuest,
  getBattlepassState,
  rerollQuest,
} from '@/server/arcade/battlepass';
import { currentSeason } from '@/server/arcade/battlepass/seasons';

export const dynamic = 'force-dynamic';

// Hard upper bound on quest slots (3 in play today; small headroom). Bounding
// BOTH params matters: an out-of-int4-range integer reaches Postgres otherwise
// and its raw "out of range for type integer" error leaks back to the client.
const MAX_SLOT_INDEX = 31;

// POST { action: 'claim' | 'reroll' | 'claim-weekly' | 'claim-card' | 'claim-season', slotIndex, week? }
export async function POST(request: Request) {
  let identity;
  try {
    identity = await requireIdentity({ allowExternal: true });
  } catch {
    return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  }
  let body: { action?: unknown; slotIndex?: unknown; week?: unknown };
  try {
    body = (await request.json()) as { action?: unknown; slotIndex?: unknown; week?: unknown };
  } catch {
    return NextResponse.json({ error: 'Invalid body.' }, { status: 400 });
  }
  const slotIndex = Number(body.slotIndex);
  if (!Number.isInteger(slotIndex) || slotIndex < 0 || slotIndex > MAX_SLOT_INDEX) {
    return NextResponse.json({ error: 'Invalid quest.' }, { status: 400 });
  }
  try {
    if (body.action === 'reroll') {
      await rerollQuest(identity.userId, slotIndex);
    } else if (body.action === 'claim') {
      await claimQuest(identity.userId, slotIndex);
    } else if (body.action === 'claim-weekly') {
      // The old season 0's weekly ladder. Season 0 was restarted on the card, so
      // these quests are closed and unclaimed ones pay nothing.
      const season = currentSeason();
      const week = Number(body.week);
      if (season.weeklyCard) {
        return NextResponse.json({ error: 'That quest is closed.' }, { status: 400 });
      }
      if (!Number.isInteger(week) || week < 1 || week > season.totalWeeks) {
        return NextResponse.json({ error: 'Invalid week.' }, { status: 400 });
      }
      await claimWeeklyQuest(identity.userId, week, slotIndex);
    } else if (body.action === 'claim-card') {
      const season = currentSeason();
      const week = Number(body.week);
      if (!season.weeklyCard || !Number.isInteger(week) || week < 1 || week > season.totalWeeks) {
        return NextResponse.json({ error: 'Invalid week.' }, { status: 400 });
      }
      await claimWeeklyCard(identity.userId, season.key, week, slotIndex);
    } else if (body.action === 'claim-season') {
      // The old season 0's season quests: closed, as above.
      if (currentSeason().weeklyCard) {
        return NextResponse.json({ error: 'That quest is closed.' }, { status: 400 });
      }
      await claimSeasonQuest(identity.userId, slotIndex, currentSeason().key);
    } else {
      return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
    }
    const state = await getBattlepassState(identity.userId);
    return NextResponse.json({ success: true, state });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed.';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
