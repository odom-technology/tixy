import { canonicalGamePath, getGameTitle } from './game-renames';
import { formatMetricValue } from './score-metric-format';

export type ScoreChallengeDirection = 'high' | 'low';

export type ScoreChallengeGame = {
  slug: string;
  title: string;
  href: string;
  metricLabel: string;
  direction: ScoreChallengeDirection;
};

/**
 * Only games backed by the accepted-score event log are eligible for a score
 * claim. Wager, daily-puzzle, and PvP outcomes deliberately stay out: their
 * result semantics are not comparable through one numeric target.
 */
/* Title is the display name, so a renamed game reads as its new name. The href
   stays the registry href; the server turns it into the live route. */
export const SCORE_CHALLENGE_GAMES: readonly ScoreChallengeGame[] = ([
  { slug: 'snake', title: 'Snake', href: '/snake', metricLabel: 'Score', direction: 'high' },
  { slug: 'flappy-bird', title: 'Flappy Bird', href: '/flappy-bird', metricLabel: 'Score', direction: 'high' },
  { slug: '2048', title: '2048', href: '/2048', metricLabel: 'Score', direction: 'high' },
  { slug: 'tetris', title: 'Tetris', href: '/tetris', metricLabel: 'Score', direction: 'high' },
  { slug: 'breakout', title: 'Breakout', href: '/breakout', metricLabel: 'Score', direction: 'high' },
  { slug: 'stack', title: 'Stack', href: '/stack', metricLabel: 'Score', direction: 'high' },
  { slug: 'sequence', title: 'Sequence', href: '/sequence', metricLabel: 'Level', direction: 'high' },
  { slug: 'gopher', title: 'Gopher', href: '/gopher', metricLabel: 'Score', direction: 'high' },
  { slug: 'ricochet', title: 'Ricochet', href: '/ricochet', metricLabel: 'Score', direction: 'high' },
  { slug: 'swerve', title: 'Swerve', href: '/swerve', metricLabel: 'Score', direction: 'high' },
  { slug: 'tumbler', title: 'Tumbler', href: '/tumbler', metricLabel: 'Score', direction: 'high' },
  { slug: 'log-splitter', title: 'Log Splitter', href: '/log-splitter', metricLabel: 'Score', direction: 'high' },
  { slug: 'knife-booth', title: 'Knife Booth', href: '/knife-booth', metricLabel: 'Score', direction: 'high' },
  { slug: 'melon-chop', title: 'Melon Chop', href: '/melon-chop', metricLabel: 'Score', direction: 'high' },
  { slug: 'tin-duck', title: 'Tin Duck', href: '/tin-duck', metricLabel: 'Score', direction: 'high' },
  { slug: 'boardwalk-hop', title: 'Boardwalk Hop', href: '/boardwalk-hop', metricLabel: 'Score', direction: 'high' },
  { slug: 'high-striker', title: 'High Striker', href: '/high-striker', metricLabel: 'Score', direction: 'high' },
  { slug: 'skee-ball', title: 'Skee-Ball', href: '/skee-ball', metricLabel: 'Score', direction: 'high' },
  { slug: 'gunrush', title: 'Gunrush', href: '/gunrush', metricLabel: 'Score', direction: 'high' },
  { slug: 'ticket-stop', title: 'Ticket Stop', href: '/ticket-stop', metricLabel: 'Score', direction: 'high' },
  { slug: 'ring-toss', title: 'Ring Toss', href: '/ring-toss', metricLabel: 'Score', direction: 'high' },
  { slug: 'math', title: 'Math Sprint', href: '/math', metricLabel: 'Score', direction: 'high' },
  { slug: 'blitz-tactics', title: 'Blitz Tactics', href: '/blitz-tactics', metricLabel: 'Solved', direction: 'high' },
  { slug: 'typing-test', title: 'Typing Test', href: '/typing-test', metricLabel: 'WPM', direction: 'high' },
  { slug: 'reaction-time', title: 'Reaction Time', href: '/reaction-time', metricLabel: 'Best time', direction: 'low' },
  { slug: 'sudoku', title: 'Sudoku', href: '/sudoku', metricLabel: 'Solve time', direction: 'low' },
  { slug: 'bubble-shooter', title: 'Bubble Shooter', href: '/bubble-shooter', metricLabel: 'Score', direction: 'high' },
  { slug: 'gem-swap', title: 'Gem Swap', href: '/gem-swap', metricLabel: 'Score', direction: 'high' },
  { slug: 'sky-climber', title: 'Sky Climber', href: '/sky-climber', metricLabel: 'Height', direction: 'high' },
  { slug: 'minesweeper', title: 'Minesweeper', href: '/minesweeper', metricLabel: 'Solve time', direction: 'low' },
  { slug: 'punch-card', title: 'Punch Card', href: '/punch-card', metricLabel: 'Solve time', direction: 'low' },
] as const).map((game) => ({ ...game, title: getGameTitle(game.slug, game.title) }));

const SCORE_CHALLENGE_GAME_BY_SLUG = new Map(
  SCORE_CHALLENGE_GAMES.map((game) => [game.slug, game]),
);

export function getScoreChallengeGame(slug: string) {
  return SCORE_CHALLENGE_GAME_BY_SLUG.get(slug) ?? null;
}

export function getScoreChallengeGameFromPath(rawPathname: string) {
  const pathname = canonicalGamePath(rawPathname);
  return (
    SCORE_CHALLENGE_GAMES
      .filter((game) => pathname === game.href || pathname.startsWith(`${game.href}/`))
      .sort((a, b) => b.href.length - a.href.length)[0] ?? null
  );
}

export function formatScoreChallengeTarget(slug: string, score: number) {
  return formatMetricValue(slug, score);
}

export function scoreChallengeVerb(direction: ScoreChallengeDirection) {
  return direction === 'low' ? 'Can you go faster?' : 'Can you beat it?';
}
