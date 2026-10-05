'use client';

import { useEffect, useMemo, useState } from 'react';

import {
  BoardTabs,
  BoardView,
  type BoardTabItem,
} from '@/features/arcade/components/leaderboard-board';
import { isWindowedBoardGame, ownRouteSeason } from '@/features/arcade/components/leaderboard-games';
import { useBoard, type BoardPeriod } from '@/features/arcade/components/use-board';

export type GameBoardType =
  | 'flappy-bird' | 'snake' | 'reaction-time' | 'typing-test' | 'coin-flip' | '8-ball'
  | 'tetris' | 'connections' | '2048' | 'chess' | 'word-grid' | 'pangram' | 'stack'
  | 'sequence' | 'breakout' | 'tumbler' | 'gopher' | 'ricochet' | 'swerve' | 'sudoku'
  | 'math' | 'minesweeper' | 'bubble-shooter' | 'gem-swap' | 'sky-climber'
  | 'log-splitter' | 'knife-booth' | 'melon-chop' | 'tin-duck' | 'boardwalk-hop'
  | 'punch-card' | 'freecell' | 'blitz-tactics' | 'high-striker' | 'skee-ball'
  | 'gunrush' | 'ticket-stop' | 'connect-four' | 'reversi' | 'battleship'
  | 'trick-shot'
  // Ring toss
  | 'ring-toss'
  | 'mini-golf'
  | 'bumper-cars'
  | 'derby';

/** One pick of a game's own split: a difficulty, a timer, a bot, a size. */
export type GameBoardMode = BoardTabItem<string | number>;

/** Ranked, then the speed run against each bot: chess, 8-ball and the other
 *  board games share this split. */
export const RANKED_AND_BOT_MODES: ReadonlyArray<GameBoardMode> = [
  { value: 'ranked', label: 'ranked' },
  { value: 'easy', label: 'easy bot' },
  { value: 'medium', label: 'medium bot' },
  { value: 'hard', label: 'hard bot' },
];

/** The daily puzzles: today's solvers, and everyone's record. */
export const DAILY_BOARD_MODES: ReadonlyArray<GameBoardMode> = [
  { value: 'daily', label: 'daily' },
  { value: 'alltime', label: 'all time' },
];

/** Typing test keeps a best per timer. */
export const TIMER_BOARD_MODES: ReadonlyArray<GameBoardMode> = [
  { value: 15, label: '15s' },
  { value: 30, label: '30s' },
  { value: 60, label: '60s' },
];

const PERIODS: ReadonlyArray<BoardTabItem<BoardPeriod>> = [
  { value: 'today', label: 'today' },
  { value: 'week', label: 'week' },
  { value: 'all', label: 'all time' },
];

const EMPTY_TEXT: Record<BoardPeriod, string> = {
  today: 'No scores today yet. Yours goes first.',
  week: 'No scores this week yet. Yours goes first.',
  all: 'No scores yet. Yours goes first.',
  season: 'No scores from last season.',
};

type GameLeaderboardProps = {
  gameType: GameBoardType;
  /** The game's own split (difficulty, timer, size). Pass `modes` to show it
   *  as tabs; with `onModeChange` the game keeps the state, without it the
   *  tabs start on `mode` and keep their own. */
  mode?: number | string;
  modes?: ReadonlyArray<GameBoardMode>;
  onModeChange?: (mode: string | number) => void;
  /** Bumping this reloads the board, after a run for instance. */
  refreshKey?: number;
  /** Where the board starts. */
  initialPeriod?: BoardPeriod;
  /** Kept so call sites compile; every board shows the top 10 with a
   *  "show all" button, and the viewer's rank first. */
  maxEntries?: number;
  showFullLeaderboard?: boolean;
  enableFullLeaderboardModal?: boolean;
  fullLeaderboardDisplay?: 'modal' | 'inline';
  fullLeaderboardTitle?: string;
  limit?: number | 'all';
  /** The aria label of the board. */
  label?: string;
};

/**
 * One leaderboard for every game: your rank and the scores around you first,
 * then the top. Games on the window endpoint get today, week and all time,
 * and last season when the game's rules changed. Everything else reads the
 * game's own route and shows what it has.
 */
export function GameLeaderboard({
  gameType,
  mode,
  modes,
  onModeChange,
  refreshKey,
  initialPeriod = 'all',
  showFullLeaderboard = false,
  label,
}: GameLeaderboardProps) {
  const [period, setPeriod] = useState<BoardPeriod>(initialPeriod);
  const [expanded, setExpanded] = useState(showFullLeaderboard);
  // Typing test's board is per timer; 60 s is the one it always showed.
  const startMode =
    gameType === 'typing-test' ? (mode ?? 60) : (mode ?? modes?.[0]?.value);
  const [ownMode, setOwnMode] = useState<string | number | undefined>(startMode);

  // Tabs without an owner follow the prop when it changes.
  useEffect(() => setOwnMode(startMode), [startMode]);
  const activeMode = onModeChange ? startMode : ownMode;
  const pickMode = (next: string | number) => {
    setOwnMode(next);
    setExpanded(showFullLeaderboard);
    onModeChange?.(next);
  };

  const windowed = isWindowedBoardGame(gameType, activeMode);
  const board = useBoard({ gameType, mode: activeMode, period, refreshKey });

  const periodItems = useMemo(() => {
    const items: BoardTabItem<BoardPeriod>[] = windowed ? [...PERIODS] : [];
    const hasSeason = board.seasonMode != null || ownRouteSeason(gameType) != null;
    if (hasSeason) items.push({ value: 'season', label: 'last season' });
    return items;
  }, [board.seasonMode, gameType, windowed]);

  // A board that can't show the picked period falls back to all time.
  const shownPeriod = periodItems.some((item) => item.value === period) ? period : 'all';
  useEffect(() => {
    if (shownPeriod !== period) setPeriod(shownPeriod);
  }, [period, shownPeriod]);

  const hasTabs = (modes?.length ?? 0) > 1 || periodItems.length > 1;

  return (
    <div className='arc-board' aria-busy={board.busy || undefined} aria-label={label}>
      {hasTabs ? (
        <div className='arc-board-nav'>
          {modes && modes.length > 1 ? (
            <BoardTabs
              items={modes}
              value={activeMode ?? modes[0]!.value}
              onChange={pickMode}
              label='Board'
            />
          ) : null}
          {periodItems.length > 1 ? (
            <BoardTabs
              items={periodItems}
              value={shownPeriod}
              onChange={(next) => {
                setPeriod(next);
                setExpanded(showFullLeaderboard);
              }}
              label='Period'
            />
          ) : null}
        </div>
      ) : null}
      <div className='arc-board-body grid gap-3.5'>
        <BoardView
          loading={board.loading}
          rows={board.rows}
          around={board.around}
          viewer={board.viewer}
          signedIn={board.signedIn}
          emptyText={EMPTY_TEXT[shownPeriod]}
          expanded={expanded}
          onToggleExpanded={() => setExpanded((prev) => !prev)}
        />
      </div>
    </div>
  );
}
