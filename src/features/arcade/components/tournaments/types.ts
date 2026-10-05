/**
 * Shared structural types for tournament UI. The per-game server tournament
 * modules (`chess-tournament.ts`, `pool-tournament.ts`) export their own
 * richer `Tournament` / `TournamentMatch` / `BracketData` types — those pass
 * straight into these shared shapes because they're structural supersets.
 *
 * Chess' match type has an extra `draws` field that pool's doesn't; it's
 * optional here so both sides assign without casting.
 */

type TournamentBracketType = 'winners' | 'losers' | 'grand_final';
type TournamentMatchStatus = 'pending' | 'active' | 'completed';

// fallow-ignore-next-line duplicate-export
export type TournamentMatch = {
  id: string;
  tournamentId: string;
  bracket: TournamentBracketType;
  round: number;
  position: number;
  player1Id: string | null;
  player2Id: string | null;
  player1Name: string | null;
  player2Name: string | null;
  isBye: boolean;
  seriesMatchIds: string[];
  player1Wins: number;
  player2Wins: number;
  /** Only present for games that can draw (chess). */
  draws?: number;
  winnerId: string | null;
  loserId: string | null;
  status: TournamentMatchStatus;
  overriddenBy: string | null;
  overrideReason: string | null;
  createdAt: number;
  completedAt: number | null;
};

// fallow-ignore-next-line duplicate-export
export type BracketData = {
  winners: TournamentMatch[][];
  losers: TournamentMatch[][];
  grandFinal: TournamentMatch[];
};

export type WagerPool = {
  player1Total: number;
  player2Total: number;
  totalPool: number;
};
