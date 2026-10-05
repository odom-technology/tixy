import { Suspense } from 'react';

import { FLOOR_STILLS } from '@/features/arcade/components/game-previews/stills';
import { LeaderboardsView } from '@/features/arcade/components/leaderboards/leaderboards-view';
import { getFloorStandings } from '@/server/arcade/leaderboard-overview';
import { getWeeklyBoardsView } from '@/server/arcade/rewards/weekly-boards';
import { isGuestUserId } from '@/server/auth/guest';
import { requireIdentity } from '@/server/auth';
import { checkRole } from '@/server/auth/check-role';

/* The leaderboards page. Nothing here waits on a board: the picker and the
   overview's tiles render at once, and this week's paid boards and the
   player's ranks stream into place in their own boxes. */
export async function GamesLeaderboardsPage() {
  let userId: string | null = null;
  let canAdminClear = false;
  try {
    const identity = await requireIdentity({ allowExternal: true, allowGuest: true });
    userId = identity.userId;
    canAdminClear = await checkRole('admin', identity);
  } catch {
    // Signed out: the boards without a "you".
  }

  const standings = userId ? getFloorStandings(userId).catch(() => []) : null;
  // A guest can't win a weekly board, so a guest has no place on one.
  const weekly = getWeeklyBoardsView(userId && !isGuestUserId(userId) ? userId : null).catch((error) => {
    console.error('weekly boards failed:', error);
    return null;
  });

  return (
    <Suspense fallback={null}>
      <LeaderboardsView
        stills={FLOOR_STILLS}
        standings={standings}
        weekly={weekly}
        canAdminClear={canAdminClear}
      />
    </Suspense>
  );
}
