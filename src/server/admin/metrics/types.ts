/* The admin metrics read model. Every payload is aggregate: counts, sums and
   rates. The only per-player rows are the ones an operator needs to act on
   (biggest wins, flagged runs, who is online), and those carry the account id
   and username, never an email. Days are UTC calendar days, 'YYYY-MM-DD'.
   Definitions live in docs/admin-metrics.md. */

export const METRIC_WINDOWS = [7, 30, 90] as const;
export type MetricWindowDays = (typeof METRIC_WINDOWS)[number];

export type MetricWindow = {
  days: MetricWindowDays;
  /** First day in the window, inclusive. */
  from: string;
  /** Last day in the window, inclusive; today, which is partial. */
  to: string;
  /** The equal-length window just before, for deltas. */
  previousFrom: string;
  previousTo: string;
  /** When the newest rollup row was written, ms since epoch. */
  rolledAt: number | null;
};

/** A headline number with the same measure over the previous window.
    previous is null when there is no baseline (no data that far back). */
export type Kpi = {
  value: number;
  previous: number | null;
};

/** A dense day series: one point per day in the window, zeros included. */
export type DayPoint = { day: string; value: number };

export type GameRef = {
  /** The stored key (game_type), e.g. 'arcade-blackjack', 'stack-cabinet'. */
  key: string;
  /** Registry slug when the key maps to one, e.g. '21', 'stack'. */
  slug: string | null;
  title: string;
  onFloor: boolean;
  /** Floor group id when on the floor. */
  group: string | null;
};

/* ---------------------------------------------------------------- overview */

export type OverviewMetrics = {
  window: MetricWindow;
  dauToday: number;
  dauYesterday: number;
  wau: Kpi;
  mau: Kpi;
  newPlayers: Kpi;
  runs: Kpi;
  ticketsMinted: Kpi;
  ticketsSpent: Kpi;
  /** Cents, by currency; usually one entry, 'usd'. */
  revenue: { currency: string; cents: Kpi }[];
  flags: Kpi;
  onlineNow: number;
  activeSeries: DayPoint[];
  runsSeries: DayPoint[];
  topGames: { game: GameRef; runs: number; players: number; share: number }[];
};

/* ----------------------------------------------------------------- players */

export type PlayersMetrics = {
  window: MetricWindow;
  dau: Kpi; // average DAU over the window's complete days
  wau: Kpi;
  mau: Kpi;
  /** DAU / MAU on the last complete day. */
  stickiness: number | null;
  daily: {
    day: string;
    active: number;
    newPlayers: number;
    returning: number;
    accounts: number;
    guests: number;
  }[];
  signups: DayPoint[];
  /** Signup-week cohorts (accounts only), newest first, at most 12. */
  cohorts: {
    /** Monday of the signup week. */
    week: string;
    size: number;
    /** Share of the cohort active on exactly day N after signup, null while
        the day hasn't happened for every member. */
    d1: number | null;
    d7: number | null;
    d30: number | null;
    /** Share active at least once in week N after the signup week, N = 1..8. */
    weeks: (number | null)[];
  }[];
  /** Whole-window D1/D7/D30 over every eligible account. */
  retention: {
    d1: { eligible: number; retained: number };
    d7: { eligible: number; retained: number };
    d30: { eligible: number; retained: number };
  };
};

/* ------------------------------------------------------------------- games */

export type GameRow = {
  game: GameRef;
  /** Browser sessions that started the game (product analytics), per day, summed. */
  starts: number;
  /** Browser sessions that finished it. */
  finishes: number;
  /** finishes / starts, null when no starts. */
  finishRate: number | null;
  /** Server-recorded runs: finished scored runs, machine rounds, completed matches. */
  runs: number;
  players: number;
  playMs: number;
  /** playMs / runs over runs that record time; null when none do. */
  avgRunMs: number | null;
  /** runs / all runs in the window. */
  shareOfRuns: number;
  /** playMs / all playMs in the window. */
  shareOfTime: number;
  runsSeries: number[];
  previousRuns: number | null;
};

export type GamesMetrics = {
  window: MetricWindow;
  floor: GameRow[];
  offFloor: GameRow[];
  totals: { runs: number; players: number; playMs: number; starts: number; finishes: number };
};

/* ----------------------------------------------------------------- economy */

export type LedgerBucket =
  | 'game_rewards'
  | 'daily_claim'
  | 'quests'
  | 'season'
  | 'levels'
  | 'achievements'
  | 'monthly_boards'
  | 'weekly_boards'
  | 'wager_payouts'
  | 'admin'
  | 'refunds'
  | 'other_in'
  | 'counter'
  | 'wager_stakes'
  | 'continues'
  | 'other_out';

export type EconomyMetrics = {
  window: MetricWindow;
  minted: Kpi;
  spent: Kpi;
  net: Kpi;
  /** Sum of wallets.credits now. */
  supply: number;
  holders: number;
  daily: { day: string; minted: number; spent: number; net: number }[];
  sources: { bucket: LedgerBucket; amount: number; entries: number; users: number; previous: number | null }[];
  sinks: { bucket: LedgerBucket; amount: number; entries: number; users: number; previous: number | null }[];
  /** Bought tickets (wallets.store_credits): Stripe packs and ad rewards in,
      counter purchases out. */
  bought: {
    granted: number;
    spent: number;
    reversed: number;
    adRewards: number;
    supply: number;
  };
  dailyCap: {
    cap: number;
    /** Player-game-days that earned anything. */
    earningDays: number;
    /** Of those, days that reached the cap. */
    cappedDays: number;
    /** Players who hit the cap in at least one game. */
    cappedPlayers: number;
    byGame: { game: GameRef; earningDays: number; cappedDays: number }[];
  };
  /** The daily spin (DAILY_WHEEL.md): spins in the window and where they landed. */
  dailySpin: {
    spins: number;
    /** Tickets the spins paid, legacy holds included. */
    paid: number;
    /** The ladder amount each spin stands for: 25 x its multiplier, summed. */
    expected: number;
    bySlot: { value: number; chance: number; spins: number; paid: number }[];
  };
  balances: {
    buckets: { label: string; min: number; max: number | null; players: number; tickets: number }[];
    median: number;
    p90: number;
    p99: number;
    /** Share of all tickets held by the top 1% of holders. */
    top1Share: number | null;
  };
};

/* ---------------------------------------------------------------- machines */

export type MachineRow = {
  game: GameRef;
  rounds: number;
  players: number;
  wagered: number;
  paid: number;
  /** paid / wagered, null when nothing was wagered. */
  actualRtp: number | null;
  configuredRtp: number;
  /** (paid − configuredRtp × wagered) / (sd × √rounds); |z| > 3 is worth a look. */
  z: number | null;
  houseNet: number;
  biggestWin: number;
  previousRounds: number | null;
};

export type MachinesMetrics = {
  window: MetricWindow;
  floor: MachineRow[];
  offFloor: MachineRow[];
  totals: { rounds: number; wagered: number; paid: number; actualRtp: number | null };
  daily: { day: string; wagered: number; paid: number }[];
  biggestWins: {
    id: string;
    game: GameRef;
    userId: string;
    username: string;
    wager: number;
    payout: number;
    multiplier: number;
    at: number;
  }[];
};

/* ----------------------------------------------------------------- counter */

export type CounterMetrics = {
  window: MetricWindow;
  purchases: Kpi;
  buyers: Kpi;
  ticketsSpent: Kpi;
  items: {
    itemId: string;
    name: string;
    kind: string;
    price: number;
    active: boolean;
    purchases: number;
    tickets: number;
    owners: number;
  }[];
  packs: {
    packId: string;
    purchases: number;
    tickets: number;
    cents: number;
    currency: string;
    refunds: number;
  }[];
  revenue: { currency: string; cents: Kpi }[];
  payers: Kpi;
  /** Accounts active in the window who bought a counter item / a ticket pack. */
  conversion: {
    activeAccounts: number;
    itemBuyers: number;
    packBuyers: number;
    firstTimePackBuyers: number;
  };
  checkoutFunnel: { started: number; fulfilled: number; failed: number; expired: number; reversed: number };
  dailyRevenue: DayPoint[];
};

/* ------------------------------------------------------------- progression */

export type ProgressionMetrics = {
  window: MetricWindow;
  levels: { level: number; players: number }[];
  levelBands: { label: string; min: number; max: number | null; players: number }[];
  medianLevel: number;
  season: {
    key: string;
    name: string;
    tiers: number;
    distribution: { tier: number; players: number }[];
    premium: number;
  } | null;
  quests: {
    daily: { assigned: number; completed: number; claimed: number };
    weekly: { assigned: number; completed: number; claimed: number };
    season: { assigned: number; completed: number; claimed: number };
    rerolls: { playerDays: number; rerollDays: number; rerolls: number };
    byKind: { kind: string; assigned: number; completed: number }[];
  };
  achievements: {
    unlocked: Kpi;
    daily: DayPoint[];
    top: { id: string; name: string; holders: number; unlockedInWindow: number }[];
  };
};

/* ------------------------------------------------------------------- trust */

export type TrustMetrics = {
  window: MetricWindow;
  flags: Kpi;
  rejects: Kpi;
  passes: Kpi;
  byGame: { game: GameRef; pass: number; flag: number; reject: number; players: number }[];
  daily: { day: string; flag: number; reject: number }[];
  recent: {
    id: string;
    game: GameRef;
    userId: string | null;
    username: string | null;
    result: 'flag' | 'reject';
    reason: string | null;
    score: number;
    at: number;
  }[];
  bans: {
    activeGameBans: number;
    issuedInWindow: number;
    suspendedAccounts: number;
    recent: { userId: string; username: string | null; bannedAt: number; until: number | null; indefinite: boolean; reason: string | null }[];
  };
  /** In-memory, since the server process started. */
  rateLimits: { since: number; rules: { rule: string; hits: number }[] };
  /** Days of anti-cheat log the server keeps (ANTI_CHEAT_LOG_RETENTION_DAYS). */
  logRetentionDays: number;
};

/* -------------------------------------------------------------------- live */

export type LiveMetrics = {
  at: number;
  /** Accounts with presence seen in the last 2 minutes, status not offline. */
  online: number;
  inGame: number;
  /** Game sessions (accounts and guests) with an action in the last 5 minutes. */
  activeSessions: number;
  byGame: { game: GameRef; players: number; sessions: number }[];
  /** Up to 50, most recent first. Usernames only. */
  players: { userId: string; username: string; status: string; game: GameRef | null; lastSeenAt: number }[];
  openTables: { game: GameRef; waiting: number; playing: number }[];
  last15m: { runs: number; rounds: number; ticketsMinted: number };
};
