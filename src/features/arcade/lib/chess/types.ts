// ---------------------------------------------------------------------------
// Shared chess types (usable in server and client).
// ---------------------------------------------------------------------------

export type MatchStatus = 'waiting' | 'active' | 'completed' | 'forfeited';

export type WinReason =
  | 'checkmate'
  | 'resignation'
  | 'timeout'
  | 'stalemate'
  | 'draw_agreement'
  | 'threefold'
  | 'fifty_move'
  | 'insufficient_material'
  | 'forfeit';

export type GameResult = '1-0' | '0-1' | '1/2-1/2';

export type ChessColor = 'white' | 'black';

export type ChessMatch = {
  id: string;
  player1Id: string;
  player1Name: string;
  player2Id: string | null;
  player2Name: string | null;
  invitedUserId: string | null;
  whiteId: string | null;
  blackId: string | null;
  status: MatchStatus;
  currentTurn: string;
  timeFormat: string;
  initialTimeMs: number;
  incrementMs: number;
  whiteTimeMs: number;
  blackTimeMs: number;
  lastMoveAt: number | null;
  fen: string;
  ply: number;
  moveCount: number;
  lastMoveUci: string | null;
  lastMoveSan: string | null;
  drawOfferedBy: string | null;
  drawOfferedAt: number | null;
  result: GameResult | null;
  winnerId: string | null;
  loserId: string | null;
  winReason: WinReason | null;
  tournamentMatchId: string | null;
  wagerAmount: number | null;
  wagerStatus: string | null;
  createdAt: number;
  updatedAt: number;
  completedAt: number | null;
};

// ---------------------------------------------------------------------------
// Time format presets — shared between lobby UI, match logic, and ELO filters.
// ---------------------------------------------------------------------------

type TimeFormatCategory = 'ultra' | 'blitz' | 'rapid';

type TimeFormatPreset = {
  id: string;
  category: TimeFormatCategory;
  label: string;
  initialTimeMs: number;
  incrementMs: number;
};

/**
 * Exactly three presets — one per mode. The UI surfaces these by category
 * label only (Ultra / Blitz / Rapid) rather than by minute configuration.
 */
export const TIME_FORMAT_PRESETS: TimeFormatPreset[] = [
  { id: 'ultra', category: 'ultra', label: 'Ultra', initialTimeMs: 120_000, incrementMs: 1_000 },
  { id: 'blitz', category: 'blitz', label: 'Blitz', initialTimeMs: 300_000, incrementMs: 3_000 },
  { id: 'rapid', category: 'rapid', label: 'Rapid', initialTimeMs: 600_000, incrementMs: 5_000 },
];

const TIME_FORMAT_BY_ID: Record<string, TimeFormatPreset> = Object.fromEntries(
  TIME_FORMAT_PRESETS.map((p) => [p.id, p]),
);

export function resolveTimeFormat(id: string | null | undefined): TimeFormatPreset {
  return (id && TIME_FORMAT_BY_ID[id]) || TIME_FORMAT_BY_ID.blitz;
}

export function isValidTimeFormatId(id: unknown): id is string {
  return typeof id === 'string' && id in TIME_FORMAT_BY_ID;
}

// Starting position FEN (standard chess).
export const STARTING_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
