import { GamesLeaderboardsPage } from '@/features/arcade/components/games-leaderboards-page';

export const metadata = {
  title: 'Leaderboards | tixy.lol',
};

export const dynamic = 'force-dynamic';

export default function ArcadeLeaderboardPage() {
  return <GamesLeaderboardsPage />;
}
