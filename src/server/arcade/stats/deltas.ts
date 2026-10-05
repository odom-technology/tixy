// Maps a finished game run (the GameRewardContext every score route already
// builds, plus a small per-game `extra` of "cool" metrics the context doesn't
// carry) into stat deltas. The orchestration in ./pipeline.ts layers the
// cross-cutting global rollups (games, playtime, streak, distinct) on top.
import type { GameRewardContext } from '@/server/arcade/rewards/types';
import {
  add,
  max,
  min,
  gameStat,
  DAILY,
  MP,
  type StatDelta,
} from './stat-keys';

/** Signature metrics not present on GameRewardContext, passed by the route. */
export type RunExtra = {
  /** Snake: apples eaten / longest body length this run. */
  snakeApples?: number;
  snakeLength?: number;
  /** Flappy: pipes passed. */
  flappyPipes?: number;
  /** 2048: highest tile reached this run. */
  highestTile?: number;
  /** Tetris: lines cleared, 4-line "tetris" clears, top level. */
  tetrisLines?: number;
  tetrisTetrises?: number;
  tetrisLevel?: number;
  /** Typing: accuracy %, words completed. */
  typingAccuracy?: number;
  typingWords?: number;
  /** Daily puzzles: was this a flawless solve (no mistakes / 1 guess / all pangrams). */
  perfectDaily?: boolean;
  /** Mini golf: holes in one this round. */
  golfAces?: number;
  /** Trick shot: the streak of cleared days, today's clear included. */
  trickShotStreak?: number;
  /** Trick shot: today's clear came on the day's first try. */
  trickShotFirstTry?: boolean;
  /** High striker: hits in the run (its depth), and its longest bell streak. */
  strikerSwings?: number;
  strikerBellStreak?: number;
};

/** True for the cross-game multiplayer / elo games. */
const RESULT_GAMES = new Set([
  '8-ball',
  'chess',
  'connect-four',
  'checkers',
  'reversi',
  'battleship',
]);

const DAILY_GAMES = new Set(['connections', 'word-grid', 'pangram']);

/**
 * Build the per-game stat deltas for one run. Returns deltas only — the global
 * rollups (total games, playtime, streak, distinct-games, tickets) are added by
 * recordGameRunStats so they stay in one place.
 */
export function statDeltasForRun(
  context: GameRewardContext,
  extra: RunExtra = {},
): StatDelta[] {
  const slug = context.gameType;
  const out: StatDelta[] = [add(gameStat(slug, 'games'), 1)];

  switch (context.gameType) {
    case 'snake':
      out.push(max(gameStat(slug, 'best'), context.score));
      if (extra.snakeApples) out.push(add(gameStat(slug, 'apples'), extra.snakeApples));
      if (extra.snakeLength) out.push(max(gameStat(slug, 'length'), extra.snakeLength));
      break;
    case 'flappy-bird':
      out.push(max(gameStat(slug, 'best'), context.score));
      if (extra.flappyPipes) out.push(add(gameStat(slug, 'pipes'), extra.flappyPipes));
      break;
    case '2048':
      out.push(max(gameStat(slug, 'best'), context.score));
      if (extra.highestTile) {
        out.push(max(gameStat(slug, 'highest_tile'), extra.highestTile));
        if (extra.highestTile >= 2048) out.push(add(gameStat(slug, 'wins_2048'), 1));
      }
      break;
    case 'tetris':
      out.push(max(gameStat(slug, 'best'), context.score));
      if (extra.tetrisLines) out.push(add(gameStat(slug, 'lines'), extra.tetrisLines));
      if (extra.tetrisTetrises) out.push(add(gameStat(slug, 'tetrises'), extra.tetrisTetrises));
      if (extra.tetrisLevel) out.push(max(gameStat(slug, 'level'), extra.tetrisLevel));
      break;
    case 'typing-test':
      out.push(max(gameStat(slug, 'best_wpm'), context.wpm));
      if (extra.typingAccuracy) out.push(max(gameStat(slug, 'best_accuracy'), extra.typingAccuracy));
      if (extra.typingWords) out.push(add(gameStat(slug, 'words'), extra.typingWords));
      break;
    case 'reaction-time':
      if (context.averageTime > 0) out.push(min(gameStat(slug, 'best_ms'), Math.round(context.averageTime)));
      break;
    case 'sudoku':
      out.push(add(gameStat(slug, 'solved'), 1));
      if (context.solveTimeMs > 0) {
        out.push(min(gameStat(slug, 'best_ms'), Math.round(context.solveTimeMs)));
        out.push(min(gameStat(`${slug}.${context.difficulty}`, 'best_ms'), Math.round(context.solveTimeMs)));
      }
      break;
    case 'minesweeper':
      out.push(add(gameStat(slug, 'wins'), 1));
      if (context.solveTimeMs > 0) {
        out.push(min(gameStat(slug, 'best_ms'), Math.round(context.solveTimeMs)));
        out.push(min(gameStat(`${slug}.${context.difficulty}`, 'best_ms'), Math.round(context.solveTimeMs)));
      }
      break;
    case 'punch-card':
      out.push(add(gameStat(slug, 'solved'), 1));
      if (context.solveTimeMs > 0) {
        out.push(min(gameStat(slug, 'best_ms'), Math.round(context.solveTimeMs)));
        out.push(min(gameStat(`${slug}.${context.size}`, 'best_ms'), Math.round(context.solveTimeMs)));
      }
      break;
    case 'freecell':
      out.push(add(gameStat(slug, 'solved'), 1));
      if (context.solveTimeMs > 0) {
        out.push(min(gameStat(slug, 'best_ms'), Math.round(context.solveTimeMs)));
        out.push(min(gameStat(`${slug}.${context.mode}`, 'best_ms'), Math.round(context.solveTimeMs)));
      }
      break;
    case 'pangram':
      out.push(max(gameStat(slug, 'best'), context.score));
      if (context.pangrams) out.push(add(gameStat(slug, 'pangrams'), context.pangrams));
      // Pangram has no win/lose; playing it counts as a daily solve.
      out.push(add(DAILY.solved, 1));
      break;
    case 'connections':
      if (context.solved) {
        out.push(add(gameStat(slug, 'solved'), 1));
        out.push(add(DAILY.solved, 1));
      }
      break;
    // Derby: races are `games`; wins, top-three finishes and the best place.
    case 'derby':
      if (context.place === 1) out.push(add(gameStat(slug, 'wins'), 1));
      if (context.place <= 3) out.push(add(gameStat(slug, 'podiums'), 1));
      out.push(min(gameStat(slug, 'best_place'), context.place));
      break;
    // Trick shot records a try only when it sets the day's best, and a clear
    // is the most a day can reach, so a clear is counted once a day. The
    // best day's score; days cleared, the longest streak of them and clears
    // on the first try, for the achievements. A clear is not a daily-puzzle
    // solve: DAILY counts the word puzzles.
    case 'trick-shot':
      out.push(max(gameStat(slug, 'best'), context.score));
      if (context.clear) {
        out.push(add(gameStat(slug, 'clears'), 1));
        if (extra.trickShotStreak) out.push(max(gameStat(slug, 'best_streak'), extra.trickShotStreak));
        if (extra.trickShotFirstTry) out.push(add(gameStat(slug, 'first_try_clears'), 1));
      }
      break;
    case 'word-grid':
      if (context.solved) {
        out.push(add(gameStat(slug, 'solved'), 1));
        out.push(add(DAILY.solved, 1));
      }
      break;
    case 'coin-flip':
      out.push(max(gameStat(slug, 'best_streak'), context.streak));
      break;
    // Plain score games.
    case 'stack':
    case 'sequence':
    case 'breakout':
    case 'tumbler':
    case 'gopher':
    case 'ricochet':
    case 'swerve':
    case 'math':
    case 'blitz-tactics':
    case 'bubble-shooter':
    case 'gem-swap':
    case 'sky-climber':
    case 'log-splitter':
    case 'knife-booth':
    case 'melon-chop':
    case 'boardwalk-hop':
    case 'skee-ball':
    case 'gunrush':
    case 'stack-cabinet':
    // Ring toss
    case 'ring-toss':
      out.push(max(gameStat(slug, 'best'), context.score));
      break;
    // Tin duck: `best` is rules 1's (the retired Duck Hunter series reads it);
    // `best_gallery` is the best thirty second run, for Sharpshooter. Every run
    // saved now is rules 2.
    case 'tin-duck':
      out.push(max(gameStat(slug, 'best'), context.score));
      out.push(max(gameStat(slug, 'best_gallery'), context.score));
      break;
    // Mini golf: `best` is the best round's points (7 minus each hole's
    // strokes), `aces` every hole in one in a counted round (Ace Pilot).
    // Bumper cars: the best round's score, bumps landed for Fender bender,
    // rounds played and rounds won.
    case 'bumper-cars':
      out.push(max(gameStat(slug, 'best'), context.score));
      out.push(add(gameStat(slug, 'bumps'), context.bumps));
      out.push(add(gameStat(slug, 'rounds'), 1));
      if (context.place === 1 && context.points > 0) out.push(add(gameStat(slug, 'wins'), 1));
      break;
    case 'mini-golf':
      out.push(max(gameStat(slug, 'best'), context.score));
      if (extra.golfAces) out.push(add(gameStat(slug, 'aces'), extra.golfAces));
      break;
    // Ticket stop's rules 2 score is hits, a different scale from rules 1's
    // points, so it has its own stat key.
    case 'ticket-stop':
      out.push(max(gameStat(slug, 'lock_best'), context.score));
      break;
    // High striker, rules 3 (the endless tower). Rules 1 and 2 wrote `best`
    // and `best_five`; migration 0073 cleared them with their achievements, and
    // nothing writes them now. The endless stats: the best score, the deepest
    // run (hits) and the longest bell streak.
    case 'high-striker':
      out.push(max(gameStat(slug, 'endless_best'), context.score));
      if (extra.strikerSwings) out.push(max(gameStat(slug, 'endless_depth'), extra.strikerSwings));
      if (extra.strikerBellStreak) out.push(max(gameStat(slug, 'endless_streak'), extra.strikerBellStreak));
      break;
    // Multiplayer / elo result games.
    case '8-ball':
    case 'chess':
    case 'connect-four':
    case 'checkers':
    case 'reversi':
    case 'battleship': {
      const won = context.result === 'win';
      out.push(add(gameStat(slug, won ? 'wins' : 'losses'), 1));
      out.push(add(MP.games, 1));
      out.push(add(won ? MP.wins : MP.losses, 1));
      if (won && context.vsBot && context.botDifficulty === 'hard') {
        out.push(add(MP.botHardWins, 1));
        out.push(add(gameStat(slug, 'bot_hard_wins'), 1));
      }
      break;
    }
    default:
      break;
  }

  // DAILY.solved is pushed per-game above (gated on an actual solve). The daily
  // streak (DAILY.streak/streakBest) is maintained in the pipeline, which has
  // the prior-day state to read.
  if (extra.perfectDaily) out.push(add(DAILY.perfect, 1));

  return out;
}

export function isResultGame(slug: string): boolean {
  return RESULT_GAMES.has(slug);
}

export function isDailyGame(slug: string): boolean {
  return DAILY_GAMES.has(slug);
}
