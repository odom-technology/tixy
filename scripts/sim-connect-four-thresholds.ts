/**
 * Connect four win rates and game length, used to set the tiers of the
 * "connect-four-wins" achievement series in src/server/arcade/achievements.
 *
 * Usage: tsx scripts/sim-connect-four-thresholds.ts
 *
 * Wins are a count, so the question is how long a tier takes. A proxy player
 * is the bot's own search with a chance of a random move (a slip), playing
 * both colours against each bot level. It prints the win rate, the mean
 * length of a won game, and the hours of play at 4 seconds a move that the
 * tiers cost at that win rate.
 */
import { computeBotMove, type BotDifficulty } from '../src/server/arcade/connect-four-bot';
import { STARTING_BOARD, applyMove, detectGameEnd, legalMovesFrom, type Color } from '../src/features/arcade/lib/connect-four';

const GAMES = 30;
const SECONDS_PER_MOVE = 4;
const TIERS = [1, 10, 40, 150, 500];
const LEVELS: BotDifficulty[] = ['easy', 'medium', 'hard'];
const PROXIES = [
  { name: 'casual', slip: 0.35, engine: 'easy' as BotDifficulty },
  { name: 'good', slip: 0.15, engine: 'medium' as BotDifficulty },
  { name: 'strong', slip: 0.05, engine: 'hard' as BotDifficulty },
];

async function play(proxySlip: number, engine: BotDifficulty, opponent: BotDifficulty, proxyColor: Color) {
  let board = STARTING_BOARD;
  let turn: Color = 'red';
  let plies = 0;
  for (;;) {
    let column: number;
    if (turn === proxyColor) {
      const legal = legalMovesFrom(board);
      column = Math.random() < proxySlip ? legal[Math.floor(Math.random() * legal.length)] : await computeBotMove(board, engine);
    } else {
      column = await computeBotMove(board, opponent);
    }
    board = applyMove(board, column, turn).board;
    plies += 1;
    const end = detectGameEnd(board);
    if (end.over) return { won: end.winnerColor === proxyColor, plies };
    turn = turn === 'red' ? 'yellow' : 'red';
  }
}

for (const proxy of PROXIES) {
  for (const level of LEVELS) {
    let wins = 0;
    let allPlies = 0;
    for (let g = 0; g < GAMES; g += 1) {
      const r = await play(proxy.slip, proxy.engine, level, g % 2 === 0 ? 'red' : 'yellow');
      allPlies += r.plies;
      if (r.won) {
        wins += 1;
      }
    }
    const rate = wins / GAMES;
    const movesPerGame = allPlies / GAMES / 2;
    const hours = TIERS.map((t) => (rate > 0 ? ((t / rate) * movesPerGame * SECONDS_PER_MOVE) / 3600 : Infinity).toFixed(1));
    console.log(
      `${proxy.name.padEnd(7)} vs ${level.padEnd(6)} win ${(rate * 100).toFixed(0).padStart(3)}%  moves/game ${movesPerGame.toFixed(1)}  hours for ${TIERS.join('/')} wins: ${hours.join('/')}`,
    );
  }
}
