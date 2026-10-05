import type {
  StoreRarity,
  CurrencyType,
  GameSlot,
  RewardGameType,
} from '@/features/arcade/lib/rewards';

export type { StoreRarity, CurrencyType, GameSlot, RewardGameType };

export type LedgerSourceType =
  | 'game_reward'
  | 'shift_reward'
  | 'monthly_reward'
  | 'weekly_board'
  | 'purchase'
  | 'stripe_purchase'
  | 'stripe_reversal'
  | 'admin_adjust'
  | 'admin_grant'
  | 'refund'
  | 'wager_hold'
  | 'wager_payout'
  | 'wager_refund'
  | 'daily_claim'
  | 'battlepass'
  | 'level_reward'
  | 'achievement';

export type DailyClaimUnavailableReason =
  | 'weekend'
  | 'holiday'
  | 'blackout'
  | 'already-claimed';

export type DailyClaimReward = {
  tickets: number;
  /** Storage-compatible alias for older callers. */
  credits: number;
  streak: number;
  isMilestone: boolean;
};

/** The daily spin (DAILY_WHEEL.md): where the wheel stopped and how it paid. */
export type DailyClaimWheel = {
  /** Layout version the unit belongs to. */
  version: number;
  /** The drawn unit, 0 to 49. */
  unit: number;
  /** The slot's index on the wheel. */
  segment: number;
  /** The slot's base value. */
  value: number;
  /** The streak day's multiplier. */
  multiplier: number;
  /** True when a legacy hold paid more than the wheel. */
  held: boolean;
};

/** Today's wheel in a status: the multiplier for a spin, or the spin made. */
export type DailyClaimWheelStatus = {
  /** Day of the 7-day ladder, 1 to 7. */
  ladderDay: number;
  multiplier: number;
  /** The top slot's value at this multiplier. */
  top: number;
  /** The spin, once made. Null before, and for a flat claim from before the wheel. */
  spin: DailyClaimWheel | null;
};

export type DailyClaimStatus = {
  available: boolean;
  reason: DailyClaimUnavailableReason | null;
  /** Human-readable reason detail (holiday name, blackout reason). */
  detail: string | null;
  claimed: boolean;
  claimedReward?: DailyClaimReward;
  streak: number;
  /** Tickets a player on an old streak keeps until it breaks; 0 for none. */
  hold: number;
  todayKey: string;
  nextReward: DailyClaimReward | null;
  wheel: DailyClaimWheelStatus;
};

export type DailyClaimResult = {
  dateKey: string;
  streak: number;
  ticketsAwarded: number;
  /** Storage-compatible alias for older callers. */
  creditsAwarded: number;
  isMilestone: boolean;
  wheel: DailyClaimWheel;
  balanceAfter: {
    tickets: number;
    /** Storage-compatible alias for older callers. */
    credits: number;
  };
};

// fallow-ignore-next-line duplicate-export
export type WalletRow = {
  userId: string;
  /** Public name: Tickets. Kept as `credits` in storage for compatibility. */
  credits: number;
  /** Store-only Tickets from real-money purchases and rewarded ads. */
  storeCredits: number;
  /** Tickets available for cosmetic store purchases. */
  spendableCredits: number;
  updatedAt: number;
};

export type StoreItem = {
  id: string;
  name: string;
  gameType: RewardGameType;
  rarity: string;
  currencyType: CurrencyType;
  price: number;
  slots: GameSlot[];
  active: boolean;
  seasonTag: string | null;
  assetRef: Record<string, unknown> | null;
  createdAt: number;
};

export type RotationEntry = {
  dateKey: string;
  slotIndex: number;
  item: StoreItem;
};

export type StoreVisibilityConfig = {
  creditsEnabled: boolean;
  gameCreditsEnabled: boolean;
};

export type OwnedStoreItem = {
  item: StoreItem;
  acquiredAt: number;
  acquiredSource: string;
  grantedToAll: boolean;
};

export type EquippedStoreItem = {
  slot: GameSlot;
  item: StoreItem;
  equippedAt: number;
};

export type LedgerEntry = {
  id: string;
  userId: string;
  currencyType: CurrencyType;
  amount: number;
  balanceAfter: number;
  sourceType: LedgerSourceType;
  sourceId: string;
  reason: string | null;
  meta: Record<string, unknown> | null;
  createdAt: number;
  createdBy: string | null;
};

export type SkinGroup = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  gameType: RewardGameType | null;
  active: boolean;
  createdAt: number;
  updatedAt: number;
  createdBy: string | null;
  updatedBy: string | null;
  itemIds: string[];
};

export type GameRewardContext =
  | { gameType: 'snake'; score: number }
  | { gameType: 'flappy-bird'; score: number }
  | { gameType: 'typing-test'; wpm: number; mode: 15 | 30 | 60 }
  | { gameType: 'reaction-time'; averageTime: number }
  | { gameType: 'coin-flip'; streak: number }
  | { gameType: '8-ball'; result: 'win' | 'loss'; vsBot: boolean; botDifficulty?: 'easy' | 'medium' | 'hard' }
  | { gameType: 'tetris'; score: number }
  | { gameType: 'connections'; solved: boolean; mistakes: number }
  | { gameType: '2048'; score: number }
  | { gameType: 'chess'; result: 'win' | 'loss'; vsBot: boolean; botDifficulty?: 'easy' | 'medium' | 'hard' }
  | { gameType: 'word-grid'; solved: boolean; guesses: number }
  | { gameType: 'pangram'; score: number; pangrams: number }
  | { gameType: 'stack'; score: number }
  | { gameType: 'sequence'; score: number }
  | { gameType: 'breakout'; score: number }
  | { gameType: 'tumbler'; score: number }
  | { gameType: 'gopher'; score: number }
  | { gameType: 'ricochet'; score: number }
  | { gameType: 'swerve'; score: number }
  | { gameType: 'sudoku'; solveTimeMs: number; difficulty: string }
  | { gameType: 'math'; score: number }
  | { gameType: 'blitz-tactics'; score: number }
  | { gameType: 'high-striker'; score: number }
  | { gameType: 'skee-ball'; score: number }
  | { gameType: 'gunrush'; score: number }
  | { gameType: 'ticket-stop'; score: number }
  /** Trick shot: a try that set the day's best, 0 to 100 (pots' share of 70,
   *  30 for a clear). `previousBest` is the day's best before it, null or
   *  absent on the day's first try: a later try is paid the difference. */
  | { gameType: 'trick-shot'; score: number; clear: boolean; previousBest?: number | null }
  /** Derby: the place a lane finished, out of `field` lanes (bots included). */
  | { gameType: 'derby'; place: number; field: number; humans: number }
  // Mini golf: score is the round's points (7 minus each hole's strokes, summed).
  | { gameType: 'mini-golf'; score: number }
  /** Bumper cars: a round's score is its points plus the podium bonus (rules.ts). */
  | { gameType: 'bumper-cars'; score: number; points: number; bumps: number; place: number; cars: number }
  /** Stacker's cabinet mode: score is rows placed, 0 to 15. */
  | { gameType: 'stack-cabinet'; score: number }
  /** Ring toss: score is points from ten rings, 0 to 1000. */
  | { gameType: 'ring-toss'; score: number }
  | { gameType: 'connect-four'; result: 'win' | 'loss'; vsBot: boolean; botDifficulty?: 'easy' | 'medium' | 'hard' }
  | { gameType: 'checkers'; result: 'win' | 'loss'; vsBot: boolean; botDifficulty?: 'easy' | 'medium' | 'hard' }
  | { gameType: 'reversi'; result: 'win' | 'loss'; vsBot: boolean; botDifficulty?: 'easy' | 'medium' | 'hard' }
  | { gameType: 'battleship'; result: 'win' | 'loss'; vsBot: boolean; botDifficulty?: 'easy' | 'medium' | 'hard' }
  | { gameType: 'bubble-shooter'; score: number }
  | { gameType: 'gem-swap'; score: number }
  | { gameType: 'sky-climber'; score: number }
  | { gameType: 'minesweeper'; solveTimeMs: number; difficulty: string }
  | { gameType: 'log-splitter'; score: number }
  | { gameType: 'knife-booth'; score: number }
  | { gameType: 'melon-chop'; score: number }
  | { gameType: 'tin-duck'; score: number }
  | { gameType: 'boardwalk-hop'; score: number }
  | { gameType: 'punch-card'; solveTimeMs: number; size: string }
  | { gameType: 'freecell'; solveTimeMs: number; mode: string; moveCount: number };

/** Account-level XP gained on this run, for the end-of-game XP burst. */
export type AccountXpReward = {
  /** XP granted by this run (already includes the premium multiplier). */
  xpGained: number;
  /** Lifetime account XP after this run. */
  xp: number;
  /** Account level after this run. */
  level: number;
  /** XP earned into the current level (for the bar). */
  into: number;
  /** XP required to reach the next level. */
  need: number;
  /** Whether this run pushed the account up at least one level. */
  leveledUp: boolean;
  /** Bonus Tickets auto-granted by crossing milestone level(s) on this run. */
  bonusTickets?: number;
  /** The level before this run. With `level` it says which levels the run crossed. */
  levelBefore?: number;
  /** Where the bar stood before the run, in the level the run started in. */
  intoBefore?: number;
  needBefore?: number;
  /** Each milestone this run paid, lowest level first. */
  milestones?: Array<{ level: number; tickets: number }>;
  /** Cosmetic tier band for the (new) level. */
  tier: { name: string; color: string; icon: string; image?: string };
  /** The season row this run moved: tier before and after, XP into the tier. */
  season?: {
    tierBefore: number;
    tier: number;
    into: number;
    need: number;
    atMax: boolean;
  };
};

export type GameRewardResult = {
  awardedTickets: number;
  wantedTickets: number;
  /** Storage-compatible alias for older callers. */
  awardedCredits: number;
  /** Storage-compatible alias for older callers. */
  wantedCredits: number;
  dateKey: string;
  earnedTodayTotal: number;
  capRemaining: number;
  ledgerId?: string;
  balanceAfter?: number;
  /** Present when account XP was granted for this run (Phase B animation). */
  account?: AccountXpReward;
};

export type DailyGameCreditsProgress = {
  dateKey: string;
  earned: number;
  cap: number;
  remaining: number;
};

export type MonthlyRewardsResult = {
  monthKey: string;
  /** 'retired': the month is October 2026 or later, when the weekly boards pay instead. Nothing is written. */
  status: 'completed' | 'already-ran' | 'retired';
  awardedUsers: number;
  totalCreditsAwarded: number;
  awards: Array<{
    leaderboardKey: string;
    userId: string;
    rank: number;
    credits: number;
  }>;
};
