'use client';

import type { ReactNode } from 'react';
import type { GameLeaderboardEntry } from './use-game-leaderboard';

/* What a score reads like on a board, per game. The board itself is
   leaderboard-board.tsx; game-leaderboard.tsx feeds it. */

function formatDurationMs(durationMs: number) {
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

type ScoreDisplay = {
  score: ReactNode;
  scoreSub?: ReactNode;
  /** Optional separate Tier cell (Elo ranked modes only). */
  tier?: ReactNode;
  /** Optional separate W-L record cell (Elo ranked modes only). */
  record?: ReactNode;
};

export function getScoreDisplay(
  entry: GameLeaderboardEntry,
  gameType: string,
  mode?: string | number,
): ScoreDisplay {
  switch (gameType) {
    case 'reaction-time':
      return {
        score: `${Number(entry.averageTime ?? 0).toFixed(2)}ms`,
        scoreSub: `best ${Number(entry.bestTime ?? 0).toFixed(2)}ms`,
      };
    case 'typing-test':
      return {
        score: `${entry.wpm} wpm`,
        scoreSub: `${entry.accuracy?.toFixed(1)}%`,
      };
    case '8-ball':
      // Speed run mode: show turns
      if (entry.fewestTurns) {
        return {
          score: `${entry.fewestTurns} turns`,
          scoreSub:
            typeof entry.totalTurnDurationMs === 'number' && entry.totalTurnDurationMs > 0
              ? `${formatDurationMs(entry.totalTurnDurationMs)} active`
              : entry.achievedAt
                ? new Date(entry.achievedAt).toLocaleDateString('en-US', {
                    month: 'short',
                    day: 'numeric',
                  })
                : undefined,
        };
      }
      // Ranked mode: show Elo + tier + record as separate columns
      return {
        score: entry.eloRating ?? entry.score,
        tier: entry.tier,
        record:
          typeof entry.totalWins === 'number'
            ? `${entry.totalWins}-${entry.totalLosses ?? 0}`
            : undefined,
      };
    case 'chess':
    case 'connect-four':
    case 'reversi':
    case 'battleship':
      // Speed run mode: show half-moves (ply), moves or shots
      if (entry.fewestPly) {
        return {
          score: `${entry.fewestPly} ${gameType === 'chess' ? 'ply' : gameType === 'battleship' ? 'shots' : 'moves'}`,
          scoreSub:
            typeof entry.totalThinkingMs === 'number' && entry.totalThinkingMs > 0
              ? `${formatDurationMs(entry.totalThinkingMs)} active`
              : entry.achievedAt
                ? new Date(entry.achievedAt).toLocaleDateString('en-US', {
                    month: 'short',
                    day: 'numeric',
                  })
                : undefined,
        };
      }
      return {
        score: entry.eloRating ?? entry.score,
        tier: entry.tier,
        record:
          typeof entry.totalWins === 'number'
            ? `${entry.totalWins}-${entry.totalLosses ?? 0}${entry.totalDraws ? `-${entry.totalDraws}` : ''}`
            : undefined,
      };
    case 'tetris': {
      if (mode === 'lines') {
        return {
          score: `${(((entry as Record<string, unknown>).lines as number) ?? entry.score ?? 0).toLocaleString()} lines`,
        };
      }
      const linesCleared = (entry as Record<string, unknown>).lines as number | undefined;
      return {
        score: (entry.score ?? 0).toLocaleString(),
        scoreSub:
          typeof linesCleared === 'number'
            ? `${linesCleared.toLocaleString()} lines`
            : undefined,
      };
    }
    case 'connections': {
      const ext = entry as Record<string, unknown>;
      const connStreak = ext.streak as number | undefined;

      // All-time mode: total solved + solve rate + total mistakes tiebreaker
      if (mode === 'alltime') {
        const totalSolved = ext.totalSolved as number | undefined;
        const solveRate = ext.solveRate as number | undefined;
        const totalMistakes = ext.totalMistakes as number | undefined;
        return {
          score: `${totalSolved ?? 0} solved`,
          scoreSub: `${solveRate ?? 0}% rate · ${totalMistakes ?? 0} mistakes${connStreak ? ` · streak ${connStreak}` : ''}`,
        };
      }

      // Daily mode (default)
      const solved = ext.solved;
      const connMistakes = ext.mistakes as number | undefined;
      const connTime = ext.timeSeconds as number | undefined;
      if (!solved) {
        return {
          score: 'dnf',
          scoreSub: connStreak ? `streak ${connStreak}` : undefined,
        };
      }
      const time =
        typeof connTime === 'number'
          ? `${Math.floor(connTime / 60)}:${String(Math.floor(connTime % 60)).padStart(2, '0')}`
          : '';
      const sub = `${time}${connStreak ? `${time ? ' · ' : ''}streak ${connStreak}` : ''}`;
      return {
        score: `${connMistakes ?? 0} mistake${connMistakes !== 1 ? 's' : ''}`,
        scoreSub: sub || undefined,
      };
    }
    case 'trick-shot': {
      const ext = entry as Record<string, unknown>;
      if (mode === 'alltime') {
        const played = ext.played as number | undefined;
        const best = ext.best as number | undefined;
        return {
          score: `${(ext.clears as number | undefined) ?? 0} cleared`,
          scoreSub: `${played ?? 0} played${typeof best === 'number' ? ` · best ${best}` : ''}`,
        };
      }
      // The day's best try: balls down, then the tries it took ("3 balls,
      // 7 tries"), as the board ranks them.
      const pots = Number(ext.pots ?? 0);
      const tries = Math.max(1, Number(ext.tries ?? 1));
      const mark = ext.clear ? 'clear' : ext.scratch ? 'scratch' : null;
      return {
        score: `${pots} ${pots === 1 ? 'ball' : 'balls'}`,
        scoreSub: `${tries} ${tries === 1 ? 'try' : 'tries'}${mark ? `, ${mark}` : ''}`,
      };
    }
    case 'bumper-cars': {
      // The best round's score; under it, rounds and wins.
      const ext = entry as Record<string, unknown>;
      const rounds = Number(ext.rounds ?? 0);
      const wins = Number(ext.wins ?? 0);
      return {
        score: `${entry.score ?? 0}`,
        scoreSub: `${rounds} ${rounds === 1 ? 'round' : 'rounds'}${wins > 0 ? `, ${wins} won` : ''}`,
      };
    }
    case 'mini-golf': {
      // Strokes against par: E, -2, +3. The day's round, or a player's best.
      const ext = entry as Record<string, unknown>;
      const toPar = Number(ext.toPar ?? entry.score ?? 0);
      const strokes = ext.strokes as number | undefined;
      const aces = Number(ext.aces ?? 0);
      return {
        score: toPar === 0 ? 'E' : toPar > 0 ? `+${toPar}` : `\u2212${-toPar}`,
        scoreSub: [
          typeof strokes === 'number' ? `${strokes} strokes` : null,
          aces > 0 ? `${aces} ${aces === 1 ? 'ace' : 'aces'}` : null,
          mode === 'alltime' && typeof ext.roundDate === 'string' ? ext.roundDate : null,
        ]
          .filter(Boolean)
          .join(' · ') || undefined,
      };
    }
    case 'word-grid': {
      const ext = entry as Record<string, unknown>;
      const wgStreak = ext.streak as number | undefined;
      if (mode === 'alltime') {
        const totalSolved = ext.totalSolved as number | undefined;
        const solveRate = ext.solveRate as number | undefined;
        const avgGuesses = ext.avgGuesses as number | undefined;
        return {
          score: `${totalSolved ?? 0} solved`,
          scoreSub: `${solveRate ?? 0}% rate${typeof avgGuesses === 'number' ? ` · ${avgGuesses.toFixed(1)} avg` : ''}${wgStreak ? ` · streak ${wgStreak}` : ''}`,
        };
      }
      const wgGuesses = ext.guesses as number | undefined;
      if (!ext.solved) {
        return {
          score: 'X/6',
          scoreSub: wgStreak ? `streak ${wgStreak}` : undefined,
        };
      }
      return {
        score: `${wgGuesses ?? 0}/6`,
        scoreSub: wgStreak ? `streak ${wgStreak}` : undefined,
      };
    }
    case 'pangram': {
      const ext = entry as Record<string, unknown>;
      const pgStreak = ext.streak as number | undefined;
      if (mode === 'alltime') {
        const bestScore = ext.bestScore as number | undefined;
        const totalWords = ext.totalWords as number | undefined;
        return {
          score: `${bestScore ?? 0} best`,
          scoreSub: `${(totalWords ?? 0).toLocaleString()} words${pgStreak ? ` · streak ${pgStreak}` : ''}`,
        };
      }
      const pgScore = ext.score as number | undefined;
      const wordsFound = ext.wordsFound as number | undefined;
      const pangrams = ext.pangrams as number | undefined;
      return {
        score: `${(pgScore ?? 0).toLocaleString()} pts`,
        scoreSub: `${wordsFound ?? 0} words${pangrams ? ` · ${pangrams} pangram${pangrams !== 1 ? 's' : ''}` : ''}${pgStreak ? ` · streak ${pgStreak}` : ''}`,
      };
    }
    case 'sudoku': {
      const ext = entry as Record<string, unknown>;
      const ms = (ext.solveTimeMs as number | undefined) ?? (entry.score as number | undefined);
      const diff = ext.difficulty as string | undefined;
      const timeStr =
        typeof ms === 'number'
          ? `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}`
          : '—';
      return {
        score: timeStr,
        scoreSub: diff ? diff.toLowerCase() : undefined,
      };
    }
    case 'minesweeper': {
      const ext = entry as Record<string, unknown>;
      const ms = (ext.solveTimeMs as number | undefined) ?? (entry.score as number | undefined);
      const diff = ext.difficulty as string | undefined;
      const timeStr =
        typeof ms === 'number'
          ? `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}`
          : '—';
      return {
        score: timeStr,
        scoreSub: diff ? diff.toLowerCase() : undefined,
      };
    }
    case 'punch-card': {
      const ext = entry as Record<string, unknown>;
      const ms = (ext.solveTimeMs as number | undefined) ?? (entry.score as number | undefined);
      const size = ext.size as string | undefined;
      const timeStr =
        typeof ms === 'number'
          ? `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}`
          : '—';
      return {
        score: timeStr,
        scoreSub: size ? size.replace('x', '×') : undefined,
      };
    }
    case 'freecell': {
      const ext = entry as Record<string, unknown>;
      const ms = (ext.solveTimeMs as number | undefined) ?? (entry.score as number | undefined);
      const moves = ext.moveCount as number | undefined;
      const mode = ext.mode as string | undefined;
      const timeStr =
        typeof ms === 'number'
          ? `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}`
          : '—';
      const parts: string[] = [];
      if (mode) parts.push(mode.toLowerCase());
      if (typeof moves === 'number') parts.push(`${moves} moves`);
      return {
        score: timeStr,
        scoreSub: parts.length ? parts.join(' · ') : undefined,
      };
    }
    case 'coin-flip': {
      const totalGamesPlayed = entry.totalGamesPlayed ?? 0;
      const accuracyPercentage = entry.accuracyPercentage ?? 0;
      return {
        score: `${entry.score ?? 0} streak`,
        scoreSub: `${totalGamesPlayed.toLocaleString()} games · ${accuracyPercentage.toFixed(1)}%`,
      };
    }
    case '2048': {
      const highestTile = (entry as Record<string, unknown>).highestTile as number | undefined;
      return {
        score: (entry.score ?? 0).toLocaleString(),
        scoreSub:
          typeof highestTile === 'number'
            ? `best tile ${highestTile.toLocaleString()}`
            : undefined,
      };
    }
    case 'flappy-bird':
    case 'snake':
    default:
      return { score: entry.score };
  }
}

/* Rows stack flush inside this padding-0 panel frame. */
export function LeaderboardRows({ children }: { children: ReactNode }) {
  return (
    <div className='overflow-hidden rounded-panel border-2 border-ink bg-panel shadow-panel'>
      {children}
    </div>
  );
}
