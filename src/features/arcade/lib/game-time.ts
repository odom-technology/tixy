import { getGameTitle } from './game-renames';
export type RawGameTimeGameType =
  | 'snake'
  | 'flappy-bird'
  | 'typing-test'
  | 'reaction-time'
  | 'coin-flip'
  | '8-ball'
  | 'tetris'
  | 'connections'
  | 'word-grid'
  | 'pangram'
  | '2048'
  | 'chess'
  | 'stack'
  | 'sequence'
  | 'breakout'
  | 'tumbler'
  | 'gopher'
  | 'ricochet'
  | 'swerve'
  | 'sudoku'
  | 'math'
  | 'blitz-tactics'
  | 'connect-four'
  | 'checkers'
  | 'reversi'
  | 'battleship'
  | 'bubble-shooter'
  | 'gem-swap'
  | 'sky-climber'
  | 'minesweeper'
  | 'log-splitter'
  | 'knife-booth'
  | 'melon-chop'
  | 'tin-duck'
  | 'boardwalk-hop'
  | 'high-striker'
  | 'skee-ball'
  | 'gunrush'
  | 'ticket-stop'
  | 'trick-shot'
  | 'stack-cabinet'
  | 'ring-toss'
  | 'mini-golf'
  | 'bumper-cars'
  | 'punch-card'
  | 'freecell'
  | 'arcade'
  | 'arcade-coin-flip'
  | 'arcade-mines'
  | 'arcade-slots'
  | 'arcade-crash'
  | 'arcade-stoplight'
  | 'arcade-plinko'
  | 'arcade-dice'
  | 'arcade-chicken'
  | 'arcade-hilo'
  | 'arcade-cases'
  | 'arcade-packs'
  | 'arcade-darts'
  | 'arcade-lightspeed'
  | 'arcade-blackjack'
  | 'arcade-limbo'
  | 'arcade-dragon'
  | 'arcade-video-poker'
  | 'arcade-roulette'
  | 'arcade-scratch'
  | 'arcade-pump'
  | 'arcade-prize-claw';

export type GameTimeDisplayGameId =
  | 'snake'
  | 'flappy-bird'
  | 'typing-test'
  | 'reaction-time'
  | 'coin-flip'
  | '8-ball'
  | 'tetris'
  | 'connections'
  | 'word-grid'
  | 'pangram'
  | '2048'
  | 'chess'
  | 'mines'
  | 'slots'
  | 'crash'
  | 'stoplight'
  | 'plinko'
  | 'dice'
  | 'chicken'
  | 'hilo'
  | 'cases'
  | 'packs'
  | 'darts'
  | 'lightspeed'
  | 'blackjack'
  | 'limbo'
  | 'dragon'
  | 'video-poker'
  | 'roulette'
  | 'scratch'
  | 'pump'
  | 'prize-claw'
  | 'stack'
  | 'sequence'
  | 'breakout'
  | 'tumbler'
  | 'gopher'
  | 'ricochet'
  | 'swerve'
  | 'sudoku'
  | 'math'
  | 'blitz-tactics'
  | 'connect-four'
  | 'checkers'
  | 'reversi'
  | 'battleship'
  | 'bubble-shooter'
  | 'gem-swap'
  | 'sky-climber'
  | 'minesweeper'
  | 'log-splitter'
  | 'knife-booth'
  | 'melon-chop'
  | 'tin-duck'
  | 'boardwalk-hop'
  | 'high-striker'
  | 'skee-ball'
  | 'gunrush'
  | 'ticket-stop'
  | 'trick-shot'
  | 'ring-toss'
  | 'mini-golf'
  | 'bumper-cars'
  | 'punch-card'
  | 'freecell'
  | 'arcade-legacy';

type GameTimeDisplayDefinition = {
  id: GameTimeDisplayGameId;
  label: string;
  rawGameTypes: RawGameTimeGameType[];
};

const RAW_GAME_TIME_DISPLAY_GAMES: GameTimeDisplayDefinition[] = [
  { id: 'snake', label: 'Snake', rawGameTypes: ['snake'] },
  { id: 'flappy-bird', label: 'Flappy Bird', rawGameTypes: ['flappy-bird'] },
  { id: 'typing-test', label: 'Typing Test', rawGameTypes: ['typing-test'] },
  { id: 'reaction-time', label: 'Reaction Time', rawGameTypes: ['reaction-time'] },
  { id: 'coin-flip', label: 'Coin Flip', rawGameTypes: ['coin-flip', 'arcade-coin-flip'] },
  { id: '8-ball', label: '8-Ball', rawGameTypes: ['8-ball'] },
  { id: 'tetris', label: 'Tetris', rawGameTypes: ['tetris'] },
  { id: 'connections', label: 'Connections', rawGameTypes: ['connections'] },
  { id: 'word-grid', label: 'Word Grid', rawGameTypes: ['word-grid'] },
  { id: 'pangram', label: 'Pangram', rawGameTypes: ['pangram'] },
  { id: '2048', label: '2048', rawGameTypes: ['2048'] },
  { id: 'chess', label: 'Chess', rawGameTypes: ['chess'] },
  { id: 'mines', label: 'Mines', rawGameTypes: ['arcade-mines'] },
  { id: 'slots', label: 'Slots', rawGameTypes: ['arcade-slots'] },
  { id: 'crash', label: 'Crash', rawGameTypes: ['arcade-crash'] },
  { id: 'stoplight', label: 'Lucky Wheel', rawGameTypes: ['arcade-stoplight'] },
  { id: 'plinko', label: 'Plinko', rawGameTypes: ['arcade-plinko'] },
  { id: 'dice', label: 'Dice', rawGameTypes: ['arcade-dice'] },
  { id: 'chicken', label: 'Crossy Chicken', rawGameTypes: ['arcade-chicken'] },
  { id: 'hilo', label: 'Hi-Lo', rawGameTypes: ['arcade-hilo'] },
  { id: 'cases', label: 'Cases', rawGameTypes: ['arcade-cases'] },
  { id: 'packs', label: 'Packs', rawGameTypes: ['arcade-packs'] },
  { id: 'darts', label: 'Darts', rawGameTypes: ['arcade-darts'] },
  { id: 'lightspeed', label: 'Lightspeed', rawGameTypes: ['arcade-lightspeed'] },
  { id: 'blackjack', label: '21', rawGameTypes: ['arcade-blackjack'] },
  { id: 'limbo', label: 'Limbo', rawGameTypes: ['arcade-limbo'] },
  { id: 'dragon', label: 'Dragon Tower', rawGameTypes: ['arcade-dragon'] },
  { id: 'video-poker', label: 'Video Poker', rawGameTypes: ['arcade-video-poker'] },
  { id: 'roulette', label: 'Roulette', rawGameTypes: ['arcade-roulette'] },
  { id: 'scratch', label: 'Scratch Cards', rawGameTypes: ['arcade-scratch'] },
  { id: 'pump', label: 'Pump', rawGameTypes: ['arcade-pump'] },
  // Wager cabinets built after the switch record their play time under the
  // shared 'arcade' umbrella (see settleArcadeSession), so this row stays at
  // zero and is filtered out of the breakdown. It is here so the mapping is
  // already correct if per-cabinet arcade time is ever turned back on.
  { id: 'prize-claw', label: 'Prize Claw', rawGameTypes: ['arcade-prize-claw'] },
  // Stacker's cabinet mode counts as time in stack.
  { id: 'stack', label: 'Stack', rawGameTypes: ['stack', 'stack-cabinet'] },
  { id: 'sequence', label: 'Sequence Memory', rawGameTypes: ['sequence'] },
  { id: 'breakout', label: 'Breakout', rawGameTypes: ['breakout'] },
  { id: 'tumbler', label: 'Tumbler', rawGameTypes: ['tumbler'] },
  { id: 'gopher', label: 'Gopher Pop', rawGameTypes: ['gopher'] },
  { id: 'ricochet', label: 'Ricochet', rawGameTypes: ['ricochet'] },
  { id: 'swerve', label: 'Swerve', rawGameTypes: ['swerve'] },
  { id: 'sudoku', label: 'Sudoku', rawGameTypes: ['sudoku'] },
  { id: 'math', label: 'Mental Math Sprint', rawGameTypes: ['math'] },
  { id: 'blitz-tactics', label: 'Blitz Tactics', rawGameTypes: ['blitz-tactics'] },
  { id: 'connect-four', label: 'Connect Four', rawGameTypes: ['connect-four'] },
  { id: 'checkers', label: 'Checkers', rawGameTypes: ['checkers'] },
  { id: 'reversi', label: 'Reversi', rawGameTypes: ['reversi'] },
  { id: 'battleship', label: 'Battleship', rawGameTypes: ['battleship'] },
  { id: 'bubble-shooter', label: 'Gumball Drop', rawGameTypes: ['bubble-shooter'] },
  { id: 'gem-swap', label: 'Gem Swap', rawGameTypes: ['gem-swap'] },
  { id: 'sky-climber', label: 'Sky Climber', rawGameTypes: ['sky-climber'] },
  { id: 'minesweeper', label: 'Minesweeper', rawGameTypes: ['minesweeper'] },
  { id: 'log-splitter', label: 'Log Splitter', rawGameTypes: ['log-splitter'] },
  { id: 'knife-booth', label: 'Knife Booth', rawGameTypes: ['knife-booth'] },
  { id: 'melon-chop', label: 'Melon Chop', rawGameTypes: ['melon-chop'] },
  { id: 'tin-duck', label: 'Tin Duck Gallery', rawGameTypes: ['tin-duck'] },
  { id: 'boardwalk-hop', label: 'Boardwalk Hop', rawGameTypes: ['boardwalk-hop'] },
  { id: 'high-striker', label: 'High Striker', rawGameTypes: ['high-striker'] },
  { id: 'skee-ball', label: 'Skee-Ball', rawGameTypes: ['skee-ball'] },
  { id: 'gunrush', label: 'Gunrush', rawGameTypes: ['gunrush'] },
  { id: 'ticket-stop', label: 'Ticket Stop', rawGameTypes: ['ticket-stop'] },
  { id: 'trick-shot', label: 'Trick Shot', rawGameTypes: ['trick-shot'] },
  { id: 'ring-toss', label: 'Ring Toss', rawGameTypes: ['ring-toss'] },
  { id: 'mini-golf', label: 'Mini Golf', rawGameTypes: ['mini-golf'] },
  { id: 'bumper-cars', label: 'Bumper Cars', rawGameTypes: ['bumper-cars'] },
  { id: 'punch-card', label: 'Punch Card', rawGameTypes: ['punch-card'] },
  { id: 'freecell', label: 'FreeCell Sprint', rawGameTypes: ['freecell'] },
  { id: 'arcade-legacy', label: 'tixy (Legacy)', rawGameTypes: ['arcade'] },
];

export const GAME_TIME_DISPLAY_GAMES: GameTimeDisplayDefinition[] = RAW_GAME_TIME_DISPLAY_GAMES.map((game) => ({
  ...game,
  label: getGameTitle(game.id, game.label),
}));

const DISPLAY_GAME_IDS = GAME_TIME_DISPLAY_GAMES.map((game) => game.id);

const RAW_TO_DISPLAY_ID = Object.fromEntries(
  GAME_TIME_DISPLAY_GAMES.flatMap((game) =>
    game.rawGameTypes.map((rawGameType) => [rawGameType, game.id]),
  ),
) as Record<RawGameTimeGameType, GameTimeDisplayGameId>;

const DISPLAY_LABELS = Object.fromEntries(
  GAME_TIME_DISPLAY_GAMES.map((game) => [game.id, game.label]),
) as Record<GameTimeDisplayGameId, string>;

type GameTimeBreakdown = Record<GameTimeDisplayGameId, number>;

export type GameTimeBucket = {
  games: GameTimeBreakdown;
  totalMs: number;
  mostPlayedGameId: GameTimeDisplayGameId | null;
  mostPlayedGameMs: number;
};

export type UserGameTimeMetrics = {
  today: GameTimeBucket;
  allTime: GameTimeBucket;
  monthToDate: GameTimeBucket;
  lastMonth: GameTimeBucket;
};

function createEmptyGameTimeBreakdown(): GameTimeBreakdown {
  return Object.fromEntries(
    DISPLAY_GAME_IDS.map((gameId) => [gameId, 0]),
  ) as GameTimeBreakdown;
}

export function createEmptyGameTimeBucket(): GameTimeBucket {
  return {
    games: createEmptyGameTimeBreakdown(),
    totalMs: 0,
    mostPlayedGameId: null,
    mostPlayedGameMs: 0,
  };
}

function getGameTimeDisplayId(
  rawGameType: string,
): GameTimeDisplayGameId | null {
  return (RAW_TO_DISPLAY_ID as Record<string, GameTimeDisplayGameId | undefined>)[
    rawGameType
  ] ?? null;
}

export function getGameTimeDisplayLabel(
  gameId: GameTimeDisplayGameId,
): string {
  return DISPLAY_LABELS[gameId];
}

export function addGameTimeDurationToBucket(
  bucket: GameTimeBucket,
  rawGameType: string,
  durationMs: number,
) {
  if (!Number.isFinite(durationMs) || durationMs <= 0) return;
  const displayId = getGameTimeDisplayId(rawGameType);
  if (!displayId) return;
  bucket.games[displayId] += durationMs;
  bucket.totalMs += durationMs;
}

export function finalizeGameTimeBucket(bucket: GameTimeBucket): GameTimeBucket {
  let topId: GameTimeDisplayGameId | null = null;
  let topMs = 0;

  for (const game of GAME_TIME_DISPLAY_GAMES) {
    const durationMs = bucket.games[game.id];
    if (durationMs > topMs) {
      topId = game.id;
      topMs = durationMs;
    }
  }

  bucket.mostPlayedGameId = topId;
  bucket.mostPlayedGameMs = topMs;
  return bucket;
}

export function getGameTimeDuration(
  bucket: GameTimeBucket,
  gameId: GameTimeDisplayGameId | 'all',
) {
  if (gameId === 'all') return bucket.totalMs;
  return bucket.games[gameId] ?? 0;
}

export function getNonZeroGameTimeRows(bucket: GameTimeBucket) {
  return GAME_TIME_DISPLAY_GAMES
    .map((game) => ({
      id: game.id,
      label: game.label,
      durationMs: bucket.games[game.id],
    }))
    .filter((row) => row.durationMs > 0)
    .sort((a, b) => b.durationMs - a.durationMs || a.label.localeCompare(b.label));
}
