import { NextResponse } from 'next/server';
import {
  getFeaturedGameType,
  FEATURED_CREDIT_MULTIPLIER,
  FEATURED_CAP_BONUS,
} from '@/server/arcade/featured-game';

export const dynamic = 'force-dynamic';

const pad2 = (n: number) => n.toString().padStart(2, '0');
// Server-local date key — must match getServerDateKey() used by the reward path.
const serverDateKey = (d = new Date()) =>
  `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

// Public: which game is featured today + the boost it grants. No auth needed —
// it's the same for everyone and reveals nothing sensitive.
export async function GET() {
  const dateKey = serverDateKey();
  return NextResponse.json(
    {
      dateKey,
      gameType: getFeaturedGameType(dateKey),
      creditMultiplier: FEATURED_CREDIT_MULTIPLIER,
      capBonus: FEATURED_CAP_BONUS,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
