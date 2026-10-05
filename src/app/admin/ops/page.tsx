import { getArcadeGameBySlug, getReserveGames, ARCADE_GAMES } from '@/features/arcade/components/arcade-game-registry';
import { requireAdminPage } from '@/server/admin/guard';

import { OpsClient } from './_ops-client';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Jobs | tixy admin' };

export default async function AdminOpsPage() {
  await requireAdminPage('/admin/ops');
  // Quests can be completed for any game that is off the floor.
  const reserve = new Set(getReserveGames().map((game) => game.slug));
  const offFloor = ARCADE_GAMES.filter((game) => game.placement.status !== 'floor')
    .map((game) => ({ slug: game.slug, title: getArcadeGameBySlug(game.slug)?.title ?? game.slug, status: reserve.has(game.slug) ? 'reserve' : game.placement.status }))
    .sort((a, b) => a.title.localeCompare(b.title));
  return <OpsClient offFloor={offFloor} />;
}
