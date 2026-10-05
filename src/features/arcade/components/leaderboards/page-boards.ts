/* Which board each game gets on the leaderboards page. The page lists the floor,
   read from the registry when it renders (getFloorGroups), so a game that
   comes onto the floor shows up here on its own, and one that leaves drops
   out. This file only says what kind of board a game has, for any game that
   has one; the floor decides which of them are shown.

   - score: the shared board (game-leaderboard.tsx), today / week / all time
     where the game is on the window endpoint, last season where it exists.
   - rating: the friends games. The rating board, then the bot boards.
   - wins: ticket machines have no skill board. They show the biggest win
     each player landed this week, read from the round history by its
     (game_type, created_at) index. */

import {
  getFloorGroups,
  getArcadeGameBySlug,
  isOnFloor,
  type ArcadeFloorGroup,
  type ArcadeGameEntry,
} from '@/features/arcade/components/arcade-game-registry';
import type { GameBoardMode, GameBoardType } from '@/features/arcade/components/game-leaderboard';
import { getGameDisplayName } from '@/features/arcade/lib/game-renames';

export type PageBoard =
  | { kind: 'score'; gameType: GameBoardType; modes?: ReadonlyArray<GameBoardMode> }
  | { kind: 'rating'; gameType: GameBoardType; modes: ReadonlyArray<GameBoardMode> }
  | { kind: 'wins'; historyType: string };

const RATING_GAMES = new Set<GameBoardType>(['8-ball', 'chess', 'connect-four', 'reversi', 'battleship']);

/* Every game the shared board can draw from a score. */
const SCORE_GAMES = new Set<GameBoardType>([
  'flappy-bird', 'snake', 'reaction-time', 'typing-test', 'tetris', 'connections', '2048',
  'word-grid', 'pangram', 'stack', 'sequence', 'breakout', 'tumbler', 'gopher', 'ricochet',
  'swerve', 'sudoku', 'math', 'minesweeper', 'bubble-shooter', 'gem-swap', 'sky-climber',
  'log-splitter', 'knife-booth', 'melon-chop', 'tin-duck', 'boardwalk-hop', 'punch-card',
  'freecell', 'blitz-tactics', 'high-striker', 'skee-ball', 'gunrush', 'ticket-stop',
  'trick-shot',
  'ring-toss',
  'trick-shot', 'mini-golf', 'bumper-cars',
  // Derby: fastest win (the shared board, today / week / all time).
  'derby',
]);

/* The same splits game-leaderboard.tsx exports. Spelled out here because that
   file is a client module, and the server reads this one to check a link. */
const RANKED_AND_BOT_MODES: ReadonlyArray<GameBoardMode> = [
  { value: 'ranked', label: 'ranked' },
  { value: 'easy', label: 'easy bot' },
  { value: 'medium', label: 'medium bot' },
  { value: 'hard', label: 'hard bot' },
];
const DAILY_BOARD_MODES: ReadonlyArray<GameBoardMode> = [
  { value: 'daily', label: 'daily' },
  { value: 'alltime', label: 'all time' },
];
const TIMER_BOARD_MODES: ReadonlyArray<GameBoardMode> = [
  { value: 15, label: '15s' },
  { value: 30, label: '30s' },
  { value: 60, label: '60s' },
];

const DIFFICULTY = (keys: readonly string[]): ReadonlyArray<GameBoardMode> =>
  keys.map((key) => ({ value: key, label: key }));

/* A game's own split, where its board keeps one best per split. */
const SCORE_MODES: Partial<Record<GameBoardType, ReadonlyArray<GameBoardMode>>> = {
  'word-grid': DAILY_BOARD_MODES,
  'trick-shot': DAILY_BOARD_MODES,
  'bumper-cars': [
    { value: 'week', label: 'this week' },
    { value: 'alltime', label: 'all time' },
  ],
  'mini-golf': DAILY_BOARD_MODES,
  connections: DAILY_BOARD_MODES,
  pangram: DAILY_BOARD_MODES,
  'typing-test': TIMER_BOARD_MODES,
  sudoku: DIFFICULTY(['easy', 'medium', 'hard', 'expert', 'evil']),
  minesweeper: DIFFICULTY(['beginner', 'intermediate', 'expert']),
  'punch-card': [
    { value: '10x10', label: '10×10' },
    { value: '5x5', label: '5×5' },
    { value: '15x15', label: '15×15' },
  ],
  freecell: [
    { value: 'daily', label: 'daily deal' },
    { value: 'free', label: 'free play' },
  ],
};

export function boardForGame(game: ArcadeGameEntry): PageBoard | null {
  const slug = game.slug as GameBoardType;
  if (RATING_GAMES.has(slug)) return { kind: 'rating', gameType: slug, modes: RANKED_AND_BOT_MODES };
  if (SCORE_GAMES.has(slug)) return { kind: 'score', gameType: slug, modes: SCORE_MODES[slug] };
  if (game.arcadeHistoryType) return { kind: 'wins', historyType: game.arcadeHistoryType };
  return null;
}

/** Lowercase, as the floor says it. 8-ball's registry title carries "pool". */
export function boardGameName(game: ArcadeGameEntry): string {
  if (game.slug === '8-ball') return '8-ball';
  return getGameDisplayName(game.slug, game.title).toLowerCase();
}

export type PickerGame = {
  slug: string;
  name: string;
  href: string;
  group: ArcadeFloorGroup['id'];
  board: PageBoard;
};

export type PickerGroup = { group: ArcadeFloorGroup; games: PickerGame[] };

/** The floor, group by group, keeping only games with a board. */
export function getPickerGroups(): PickerGroup[] {
  return getFloorGroups()
    .map(({ group, games }) => ({
      group,
      games: games.flatMap((game) => {
        const board = boardForGame(game);
        return board
          ? [{ slug: game.slug, name: boardGameName(game), href: game.href, group: group.id, board }]
          : [];
      }),
    }))
    .filter(({ games }) => games.length > 0);
}

/** A game the page can open: on the floor and with a board. Anything else,
 *  an old link to a reserve or retired game included, is the overview. */
export function pickableGame(slug: string | null | undefined): string | null {
  if (!slug || !isOnFloor(slug)) return null;
  const game = getArcadeGameBySlug(slug);
  return game && boardForGame(game) ? slug : null;
}

/** The mode a board link asked for, if the board has it. */
export function pickableMode(board: PageBoard, mode: string | null | undefined): string | null {
  if (!mode || board.kind === 'wins' || !board.modes) return null;
  return board.modes.some((m) => String(m.value) === mode) ? mode : null;
}
