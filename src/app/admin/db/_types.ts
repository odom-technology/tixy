import type { GameTimeBucket } from '@/features/arcade/lib/game-time';

type SnakeScoreRow = {
  id: string;
  score: number;
  user_name?: string | null;
};

type FlappyBirdScoreRow = {
  id: string;
  score: number;
  user_name?: string | null;
};

type ReactionTimeScoreRow = {
  id: string;
  score: number;
  average_time: number;
  best_time: number;
  attempts: number;
  user_name?: string | null;
};

type TypingTestScoreRow = {
  id: string;
  wpm: number;
  raw_wpm: number;
  accuracy: number;
  mode: number;
  correct_chars: number;
  incorrect_chars: number;
  total_chars: number;
  words_completed: number;
  user_name?: string | null;
};

type TetrisScoreRow = {
  id: string;
  score: number;
  level: number;
  lines: number;
  best_lines: number;
  best_lines_score: number;
  best_lines_level: number;
  total_games: number;
  total_lines: number;
  total_play_time_ms: number;
  user_name?: string | null;
};

type CoinFlipScoreRow = {
  id: string;
  streak: number;
  chosen_side: string;
  user_name?: string | null;
};

type ConnectionsScoreRow = {
  id: string;
  puzzle_date: string;
  mistakes: number;
  time_seconds: number;
  solved: number;
  user_name?: string | null;
};

type PoolStatsRow = {
  user_id: string;
  user_name: string;
  wins: number;
  losses: number;
  forfeits: number;
  current_streak: number;
  best_streak: number;
  total_shots: number;
  total_balls_pocketed: number;
  updated_at: number;
};

type PoolEloRow = {
  user_id: string;
  user_name: string;
  elo_rating: number;
  total_wins: number;
  total_losses: number;
  total_games: number;
  peak_elo: number;
  last_played: number | null;
  created_at: number;
};

type GameBanStatus = {
  isBanned: boolean;
  isIndefinite: boolean;
  bannedAt: number | null;
  bannedUntil: number | null;
  reason: string | null;
  bannedBy: string | null;
  remainingMs: number;
};

type AntiCheatRestriction = {
  blocked: boolean;
  recentFlags: number;
  threshold: number;
  windowMs: number;
  retryAfterMs: number;
};

type WalletState = {
  userId: string;
  credits: number;
  updatedAt: number;
};

export type StoreCatalogItem = {
  id: string;
  name: string;
  gameType: string;
  rarity: string;
  currencyType: 'credits';
  price: number;
  slots: string[];
  active?: boolean;
  seasonTag?: string | null;
};

export type StoreCatalogGroup = {
  id: string;
  name: string;
  itemIds: string[];
};

export type StoreVisibilityConfig = {
  creditsEnabled: boolean;
  gameCreditsEnabled: boolean;
};

export type OwnedStoreItem = {
  item: StoreCatalogItem;
  acquiredAt: number;
  acquiredSource: string;
  grantedToAll: boolean;
};

type EquippedStoreItem = {
  slot: string;
  item: StoreCatalogItem;
  equippedAt: number;
};

export type CurrencyLedgerEntry = {
  id: string;
  userId: string;
  userName?: string | null;
  currencyType: 'credits';
  amount: number;
  balanceAfter: number;
  sourceType: string;
  sourceId: string;
  reason?: string | null;
  createdAt: number;
  createdBy?: string | null;
  meta?: Record<string, unknown> | null;
};

type ArcadePerGameStats = {
  gameType: string;
  rounds: number;
  wagered: number;
  paidOut: number;
  houseProfit: number;
  actualRtp: number;
};

export type ArcadeEconomyStats = {
  walletCount: number;
  totalCreditsInWallets: number;
  arcadeRoundsPlayed: number;
  arcadeCreditsWagered: number;
  arcadeCreditsPaidOut: number;
  arcadeHouseProfit: number;
  arcadeActualRtp: number;
  perGame: ArcadePerGameStats[];
  storeCreditsSpent: number;
};

export type UserData = {
  userId: string;
  snakeScores: SnakeScoreRow[];
  flappyBirdScores: FlappyBirdScoreRow[];
  reactionTimeScores: ReactionTimeScoreRow[];
  typingTestScores: TypingTestScoreRow[];
  tetrisScores: TetrisScoreRow[];
  coinFlipScores: CoinFlipScoreRow[];
  connectionsScores: ConnectionsScoreRow[];
  poolStats: PoolStatsRow | null;
  poolElo: PoolEloRow | null;
  gameBan: GameBanStatus;
  antiCheatRestriction?: AntiCheatRestriction;
  wallet: WalletState;
  gameTimeMetrics?: {
    today: GameTimeBucket;
    allTime: GameTimeBucket;
    monthToDate: GameTimeBucket;
    lastMonth: GameTimeBucket;
  };
  ownedItems: OwnedStoreItem[];
  equippedItems: EquippedStoreItem[];
  storeCatalog: StoreCatalogItem[];
};

export type TimeCardRow = {
  userId: string;
  username: string;
  today: GameTimeBucket;
  monthToDate: GameTimeBucket;
  lastMonth: GameTimeBucket;
  allTime: GameTimeBucket;
};

type AntiCheatLogEntry = {
  id: string;
  ts: number;
  dateKey: string;
  gameType: string;
  userId?: string;
  userName?: string | null;
  score: number;
  modeSec?: number;
  result: 'pass' | 'flag' | 'reject';
  severity?: 'reject' | 'flag';
  reason?: string;
  stage?: string;
  checks?: string[];
};

export type AntiCheatLogResponse = {
  dateKey: string;
  entries: AntiCheatLogEntry[];
  availableDates?: string[];
  retentionDays?: number;
};

type FeedbackLogEntry = {
  id: string;
  reportId?: string;
  ts: number;
  dateKey: string;
  type:
    | 'report_created'
    | 'report_resolved'
    | 'report_dismissed'
    | 'thread_hidden'
    | 'thread_unhidden'
    | 'thread_locked'
    | 'thread_unlocked'
    | 'thread_deleted'
    | 'comment_hidden'
    | 'comment_unhidden'
    | 'comment_deleted';
  status?: 'open' | 'resolved' | 'dismissed';
  reason?: string;
  targetType: 'thread' | 'comment';
  targetId: string;
  threadId: string;
  action: string;
  userId?: string | null;
  userName?: string | null;
  details?: string | null;
};

export type FeedbackLogResponse = {
  dateKey: string;
  entries: FeedbackLogEntry[];
  availableDates?: string[];
};
