import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import {
  getArcadeWagerOutcome,
  getTicketCelebrationTier,
} from '../src/features/arcade/components/results/arcade-run-result';
import {
  awardedRunTickets,
  parseArcadeRunResult,
  wantedRunTickets,
} from '../src/features/arcade/lib/run-result';
import { getWagerFeedbackEvent } from '../src/features/arcade/lib/wager-celebration';

const parsed = parseArcadeRunResult({
  reward: {
    awardedCredits: 24,
    wantedTickets: 30,
  },
  achievements: [
    {
      id: 'first-flight',
      name: 'First Flight',
      description: 'Finish a flight.',
      icon: '/achievement.png',
      rarity: 'common',
      category: 'arcade',
      tier: 0,
      xp: 50,
    },
    { id: 'invalid' },
  ],
});

assert.equal(awardedRunTickets(parsed.reward), 24);
assert.equal(wantedRunTickets(parsed.reward), 30);
assert.equal(parsed.achievements.length, 1);

assert.equal(
  getArcadeWagerOutcome({ payout: 0, stake: 100 }),
  'loss',
);
assert.equal(
  getArcadeWagerOutcome({ payout: 80, stake: 100 }),
  'partial',
);
assert.equal(
  getArcadeWagerOutcome({ payout: 100, stake: 100 }),
  'push',
);
assert.equal(
  getArcadeWagerOutcome({ payout: 250, stake: 100 }),
  'win',
);

// Large gross partial returns are never promoted to a big win.
assert.equal(
  getTicketCelebrationTier({ amount: 9000, stake: 10000, net: -1000 }),
  'standard',
);
assert.equal(
  getTicketCelebrationTier({ amount: 400, stake: 100, net: 300 }),
  'big',
);
assert.equal(
  getTicketCelebrationTier({ amount: 1200, stake: 100, net: 1100 }),
  'jackpot',
);
assert.equal(
  getWagerFeedbackEvent({
    won: true,
    amount: 250,
    stake: 100,
    multiplier: 2.5,
  }),
  'round-win',
);
assert.equal(
  getWagerFeedbackEvent({
    won: true,
    amount: 400,
    stake: 100,
    multiplier: 4,
  }),
  'jackpot',
);
assert.equal(
  getWagerFeedbackEvent({
    won: false,
    amount: 0,
    stake: 100,
  }),
  'loss',
);

const gamesRoot = join(process.cwd(), 'src/app/(games)');
const sourceFor = (slug: string) =>
  (readdirSync(join(gamesRoot, slug), { recursive: true, encoding: 'utf8' }) as string[])
    .filter((file) => file.endsWith('.tsx'))
    .map((file) => readFileSync(join(gamesRoot, slug, file), 'utf8'))
    .join('\n');

const rewardedRunGames = [
  '2048', 'blitz-tactics', 'boardwalk-hop', 'breakout', 'bubble-shooter',
  'connections', 'flappy-bird', 'freecell', 'gem-swap', 'gopher',
  'gunrush', 'high-striker', 'knife-booth', 'log-splitter', 'math', 'melon-chop',
  'minesweeper', 'pangram', 'punch-card', 'reaction-time', 'ricochet',
  'sequence', 'skee-ball', 'sky-climber', 'snake', 'stack', 'sudoku',
  'swerve', 'tetris', 'tin-duck', 'tumbler', 'typing-test', 'word-grid',
];
for (const slug of rewardedRunGames) {
  assert.match(
    sourceFor(slug),
    /ArcadeRunRewards|ArcadeRunResult/,
    `${slug} must render the shared run reward result`,
  );
}

const wagerGames = [
  '21', 'baccarat', 'cases', 'chicken', 'coin-flip', 'crash', 'darts',
  'derby', 'dice', 'dragon', 'fortune-teller', 'gem-roll', 'hilo', 'keno',
  'lightspeed', 'limbo', 'lucky-cage', 'mines', 'packs', 'plinko',
  'prize-claw', 'prize-wheel', 'pump', 'roulette', 'scratch', 'slots',
  'stoplight', 'video-poker',
];
for (const slug of wagerGames) {
  const source = sourceFor(slug);
  assert.match(
    source,
    /ArcadeWagerResultPlate|TicketPayoutBurst/,
    `${slug} must render a wager-safe ticket result`,
  );
  assert.match(source, /achievements/, `${slug} must render run achievements`);
}

for (const slug of ['8-ball', 'battleship', 'checkers', 'chess', 'connect-four', 'reversi']) {
  assert.match(
    sourceFor(slug),
    /ArcadeRunRewards|<ArcadeRunResult[^>]*\sreward=/,
    `${slug} must render multiplayer run rewards`,
  );
}

for (const moduleName of ['pool', 'battleship', 'checkers', 'chess', 'connect-four', 'reversi']) {
  // #57 moved pool's settlement into pool-settle.ts; read both.
  const files = moduleName === 'pool' ? ['pool-match.ts', 'pool-settle.ts'] : [`${moduleName}-match.ts`];
  const source = files
    .map((file) => readFileSync(join(process.cwd(), `src/server/arcade/${file}`), 'utf8'))
    .join('\n');
  assert.match(
    source,
    /recordMatchRunResult\s*\(/,
    `${moduleName} match settlement must retain the shared result payload`,
  );
  assert.doesNotMatch(
    source,
    /accountXpBurstByMatchUser|takeAccountXpBurst/,
    `${moduleName} must deliver account XP through the shared run result`,
  );
}

for (const slug of ['flappy-bird', 'snake']) {
  const source = sourceFor(slug);
  assert.match(source, /ArcadeGameHud|<GameShell\b/, `${slug} must render the shared live HUD or the game shell strip`);
  assert.match(
    source,
    /ArcadeGameplayCallouts/,
    `${slug} must render shared gameplay callouts`,
  );
}

for (const slug of ['tetris', 'breakout']) {
  assert.match(
    sourceFor(slug),
    /ArcadeGameplayCallouts/,
    `${slug} must render shared gameplay callouts`,
  );
}

for (const slug of ['crash', 'limbo', 'slots']) {
  assert.match(
    sourceFor(slug),
    // #58 and #59 moved every wager game onto the machine frame.
    /ArcadeGameHud|<ArcadeMachine\b/,
    `${slug} must render the shared wager HUD or the machine frame`,
  );
}

console.log('run result and wager payout invariants passed');
