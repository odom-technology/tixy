import { NextResponse } from 'next/server';

import { requireIdentity } from '@/server/auth';
import { withCurrentLeaderboardNames } from '@/server/arcade/leaderboard-identities';
import {
  getScoreLeaderboardWindow,
  getScoresAroundUser,
  getUserRankInWindow,
  isScoreLeaderboardGame,
  isValidGameMode,
  resolveGameMode,
  SCORE_LEADERBOARD_GAMES,
  type LeaderboardWindow,
} from '@/server/arcade/score-events';
import { metricFormatFor } from '@/features/arcade/lib/score-metric-format';

export const dynamic = 'force-dynamic';

const WINDOWS = new Set<LeaderboardWindow>(['1d', '7d', '30d', 'all']);

// Unified rolling-window leaderboard for score-based games:
//   GET /api/leaderboard/window?game=<slug>&window=1d|7d|30d|all&limit=50&mode=<key>
// Elo/PvP games are served by their own /elo-leaderboard routes.
//
// `mode` (typing 15/30/60, sudoku/minesweeper difficulty) is validated against a
// per-game allowlist; an invalid mode for a mode-split game is a 400. For a game
// with no mode split, `mode` is ignored. When the caller is signed in, the
// response also carries `viewer` = the caller's own rank/score in this window,
// so the UI can surface it even when the viewer is outside the visible top-N,
// and `around` = the viewer's row with two rows above and below it.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const game = (searchParams.get('game') ?? '').trim();
  const windowParam = (searchParams.get('window') ?? 'all').trim() as LeaderboardWindow;
  const limit = Number(searchParams.get('limit') ?? 50);
  const rawMode = searchParams.get('mode');

  if (!isScoreLeaderboardGame(game)) {
    return NextResponse.json({ error: 'Unknown or unsupported game.' }, { status: 400 });
  }
  const window = WINDOWS.has(windowParam) ? windowParam : 'all';

  const meta = SCORE_LEADERBOARD_GAMES[game]!;
  // Validate mode against the per-game allowlist. Provided-but-invalid on a
  // mode-split game is a hard 400; otherwise resolve (defaults to the first mode
  // for split games, null for the rest).
  if (meta.modes && rawMode != null && rawMode !== '' && !isValidGameMode(game, rawMode)) {
    return NextResponse.json({ error: 'Invalid mode for this game.' }, { status: 400 });
  }
  const mode = resolveGameMode(game, rawMode);

  try {
    const leaderboard = await getScoreLeaderboardWindow(game, window, limit, mode);

    // Best-effort viewer rank (never blocks the board). Carries the viewer's
    // odUserId so the UI can gate the pinned "you" row by membership in the
    // visible rows (tie-safe) rather than comparing rank to row count.
    let viewer: { odUserId: string; rank: number; score: number } | null = null;
    let around: Awaited<ReturnType<typeof getScoresAroundUser>> = [];
    try {
      const identity = await requireIdentity({ allowExternal: true, allowGuest: true });
      const rank = await getUserRankInWindow(game, window, identity.userId, mode);
      if (rank) {
        viewer = { odUserId: identity.userId, ...rank };
        around = await getScoresAroundUser(game, window, identity.userId, mode);
      }
    } catch {
      // Signed-out or lookup failed — omit the viewer row.
    }

    const namedRows = await withCurrentLeaderboardNames([...leaderboard, ...around]);

    return NextResponse.json({
      game,
      window,
      mode,
      modes: meta.modes ?? null,
      metricLabel: meta.metricLabel,
      metricFormat: metricFormatFor(game),
      direction: meta.direction,
      leaderboard: namedRows.slice(0, leaderboard.length),
      viewer,
      around: namedRows.slice(leaderboard.length),
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('windowed leaderboard failed:', error);
    return NextResponse.json({ error: 'Failed to load leaderboard.' }, { status: 500 });
  }
}
