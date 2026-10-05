/* Which boards read the rolling-window endpoint (`/api/leaderboard/window`)
   and so get today / week / all time. Hardcoded, mirroring
   SCORE_LEADERBOARD_GAMES in '@/server/arcade/score-events', so client code
   never imports that server-only module. Elo ladders (chess, 8-ball) and
   daily puzzles (connections, word-grid, pangram) are absent: they keep their
   own boards. Punch card is absent on purpose: its boards are per size (a 5x5
   blitz isn't comparable to a 15x15 marathon), so it reads its own route with
   the size as `mode`. */
const WINDOWED_SCORE_GAMES: ReadonlySet<string> = new Set([
  'snake',
  'flappy-bird',
  '2048',
  'tetris',
  'breakout',
  'stack',
  'sequence',
  'gopher',
  'ricochet',
  'swerve',
  'tumbler',
  'knife-booth',
  'log-splitter',
  'melon-chop',
  'tin-duck',
  'boardwalk-hop',
  'high-striker',
  'skee-ball',
  'gunrush',
  'ticket-stop',
  'ring-toss',
  'derby',
  'math',
  'blitz-tactics',
  'typing-test',
  'reaction-time',
  'sudoku',
  'bubble-shooter',
  'gem-swap',
  'sky-climber',
  'minesweeper',
]);

/** True when a game's board should read the window endpoint. */
export function isWindowedBoardGame(gameType: string, mode?: number | string): boolean {
  // Tetris keeps a lines board on its own route.
  if (gameType === 'tetris' && mode === 'lines') return false;
  return WINDOWED_SCORE_GAMES.has(gameType);
}

/** Games whose own route (not the window endpoint) serves last season, and
 *  the query parameter that asks for it. Ticket stop's rules 1 board is the
 *  old bulb ring's table; the window endpoint only knows the lock. */
const OWN_ROUTE_SEASON: Record<string, { param: 'mode' | 'season'; value: string }> = {
  'ticket-stop': { param: 'mode', value: 'last-season' },
};

export function ownRouteSeason(gameType: string) {
  return OWN_ROUTE_SEASON[gameType] ?? null;
}
