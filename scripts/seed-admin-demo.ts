/**
 * Demo data for the admin console (dev tooling: never point it at a real database).
 *
 *   npm run seed:admin-demo                      # 600 players, 90 days
 *   npm run seed:admin-demo -- --players=300 --days=60
 *   npm run seed:admin-demo -- --reset           # delete what the seed made, then seed again
 *   npm run seed:admin-demo -- --live            # only refresh "right now": presence, live sessions, open tables
 *   npm run seed:admin-demo -- --verbose         # also print each machine's actual and configured RTP and z
 *
 * Writes straight into the base tables so every admin screen has something
 * true-looking to show: accounts and guests, runs, tickets in and out with
 * matching balances, machine rounds that land near their RTP (and one machine a
 * few points high), counter and pack purchases, quests, achievements, anti-cheat
 * flags, bans and who is online. It finishes by rolling the metrics tables up
 * for 120 days. Deterministic: a seeded PRNG (20261003). Demo accounts:
 *
 *   radm-admin@example.com   RadmAdmin!2026    admin
 *   radm-player@example.com  RadmPlayer!2026   player, no admin role
 *
 * Safety: refuses unless the database name in DATABASE_URL matches
 * /(_radm|_demo|_seed)/ or --throwaway is given, never runs against a database
 * named "arcade", and refuses when NODE_ENV=production. Everything it creates
 * carries a seed marker (ids start with "seed-", guests with "guest:5eed",
 * accounts are @example.com with {"seed":true} metadata), and --reset removes
 * only those rows. The presence rows go stale after 2 minutes by design; run
 * with --live to bring them back.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

for (const f of ['env/.env.local', 'env/.env', '.env.local', '.env']) {
  try {
    const text = fs.readFileSync(path.join(process.cwd(), f), 'utf8');
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const i = line.indexOf('=');
      if (i === -1) continue;
      const k = line.slice(0, i).trim();
      let v = line.slice(i + 1).trim();
      if (!k || process.env[k] !== undefined) continue;
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      process.env[k] = v;
    }
  } catch {
    /* file may not exist */
  }
}

/* ── flags and safety ─────────────────────────────────────────────────── */

const argv = process.argv.slice(2);
const flag = (name: string) => argv.includes(`--${name}`);
const opt = (name: string, fallback: number) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  const n = hit ? Number.parseInt(hit.split('=')[1] ?? '', 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

const PLAYERS = opt('players', 600);
const DAYS = opt('days', 90);
const RESET = flag('reset');
const LIVE_ONLY = flag('live');
const THROWAWAY = flag('throwaway');

function die(message: string): never {
  console.error(`seed-admin-demo: ${message}`);
  process.exit(1);
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) die('DATABASE_URL is required.');
if (process.env.NODE_ENV === 'production') die('refusing to run with NODE_ENV=production.');
const dbName = decodeURIComponent(new URL(databaseUrl).pathname.replace(/^\//, ''));
if (dbName === 'arcade') die('refusing to seed the database named "arcade".');
if (!(/(_radm|_demo|_seed)/.test(dbName) || THROWAWAY)) {
  die(`database "${dbName}" does not look like a throwaway (_radm, _demo, _seed). Pass --throwaway to override.`);
}

/* ── imports that need the environment ────────────────────────────────── */

const { getPool } = await import('../src/server/db/client');
const { ARCADE_GAMES } = await import('../src/features/arcade/components/arcade-game-registry');
const { ACHIEVEMENTS, isRetiredAchievement } = await import('../src/server/arcade/achievements/registry');
const { currentSeason, seasonTierFromXp } = await import('../src/server/arcade/battlepass/seasons');
const { levelFromXp, levelMilestoneReward } = await import('../src/server/arcade/levels');
const { getTicketPacks } = await import('../src/server/monetization/ticket-packs');
type TicketPack = ReturnType<typeof getTicketPacks>[number];
const { GAME_DAILY_CREDIT_CAP } = await import('../src/features/arcade/lib/rewards');
const { configuredRtp, machineZ } = await import('../src/server/admin/metrics/machines');
const { createAccount } = await import('../src/server/accounts');
const { runRollup } = await import('../src/server/admin/metrics/rollup');

const pool = getPool();
const startedAt = Date.now();

/* ── deterministic randomness ─────────────────────────────────────────── */

let seedState = 20261003 >>> 0;
const rnd = (): number => {
  seedState = (seedState + 0x6d2b79f5) | 0;
  let t = Math.imul(seedState ^ (seedState >>> 15), 1 | seedState);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const pick = <T>(a: readonly T[]): T => a[Math.floor(rnd() * a.length)] as T;
const int = (lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo + 1));
const gauss = () => (rnd() + rnd() + rnd() + rnd() - 2) / 0.577;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const geo = (mean: number) => Math.floor(-Math.log(1 - rnd()) * mean);
const weighted = <T>(pairs: readonly (readonly [T, number])[]): T => {
  let x = rnd() * pairs.reduce((s, [, w]) => s + w, 0);
  for (const [v, w] of pairs) if ((x -= w) <= 0) return v;
  return pairs[pairs.length - 1]![0];
};
const shuffle = <T>(a: T[]): T[] => {
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j] as T, a[i] as T];
  }
  return a;
};
const hex = (digits: number) => Array.from({ length: digits }, () => Math.floor(rnd() * 16).toString(16)).join('');
/** A UUID-shaped id from the seeded generator, so a rerun makes the same ids. */
const uuid = () => `${hex(8)}-${hex(4)}-4${hex(3)}-8${hex(3)}-${hex(12)}`;
const sha = (text: string) => crypto.createHash('sha256').update(text).digest('hex');

/* ── time ─────────────────────────────────────────────────────────────── */

const SEC = 1000;
const MIN = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;
const WEEK = 7 * DAY;
const NOW = Date.now();
const TODAY0 = Math.floor(NOW / DAY) * DAY;
const dateKey = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const monthKey = (ms: number) => new Date(ms).toISOString().slice(0, 7);

// Evening in the UTC afternoon-to-night, a trough before dawn.
const HOUR_W = [3, 2, 1.5, 1, 0.8, 0.7, 0.8, 1.1, 1.5, 2, 2.4, 2.8, 3.2, 3.6, 4, 4.6, 5.4, 6.4, 7.4, 8, 8.2, 7.6, 6.2, 4.6];
const HOUR_PAIRS = HOUR_W.map((w, h) => [h, w] as const);
const atHour = (dayStart: number) => dayStart + weighted(HOUR_PAIRS) * HOUR + Math.floor(rnd() * HOUR);
const isWeekend = (ms: number) => [0, 6].includes(new Date(ms).getUTCDay());

/* ── the floor and the machines ───────────────────────────────────────── */

type ScoreGame = {
  key: string;
  weight: number;
  durS: [number, number];
  reward: [number, number];
  xp: [number, number];
  daily?: boolean;
  top: number;
};

const SCORE_GAMES: ScoreGame[] = [
  { key: 'snake', weight: 10, durS: [75, 40], reward: [9, 16], xp: [14, 30], top: 60 },
  { key: '2048', weight: 9, durS: [210, 90], reward: [8, 14], xp: [14, 30], top: 4000 },
  { key: 'stack', weight: 11, durS: [60, 25], reward: [10, 18], xp: [14, 32], top: 40 },
  { key: 'flappy-bird', weight: 9, durS: [35, 18], reward: [8, 14], xp: [12, 26], top: 25 },
  { key: 'ricochet', weight: 4, durS: [120, 50], reward: [12, 20], xp: [16, 34], top: 9000 },
  { key: 'ticket-stop', weight: 5, durS: [50, 20], reward: [6, 12], xp: [12, 24], top: 300 },
  { key: 'skee-ball', weight: 7, durS: [150, 50], reward: [12, 20], xp: [16, 34], top: 400 },
  { key: 'high-striker', weight: 5, durS: [30, 12], reward: [10, 16], xp: [12, 26], top: 100 },
  { key: 'tin-duck', weight: 4, durS: [100, 35], reward: [10, 16], xp: [14, 30], top: 600 },
  { key: 'word-grid', weight: 6, durS: [260, 110], reward: [30, 45], xp: [40, 70], daily: true, top: 100 },
  { key: 'tetris', weight: 2, durS: [240, 100], reward: [8, 14], xp: [14, 30], top: 20000 },
  { key: 'breakout', weight: 1.5, durS: [150, 60], reward: [8, 14], xp: [14, 28], top: 5000 },
  { key: 'minesweeper', weight: 1, durS: [120, 60], reward: [8, 14], xp: [14, 28], top: 300 },
  { key: 'typing-test', weight: 1.5, durS: [60, 5], reward: [8, 14], xp: [14, 28], top: 90 },
  { key: 'gopher', weight: 1, durS: [90, 30], reward: [8, 14], xp: [14, 28], top: 900 },
];

type MatchGame = { key: '8-ball' | 'chess' | 'connect-four'; weight: number };
const MATCH_GAMES: MatchGame[] = [
  { key: '8-ball', weight: 4 },
  { key: 'chess', weight: 4 },
  { key: 'connect-four', weight: 4 },
];

type MachineSpec = {
  key: string;
  weight: number;
  /** Win multipliers and their relative chances before scaling to the target mean. */
  table: [number, number][];
  off?: number;
  /** Bet sizes and their chances, when the machine plays smaller than the default. */
  wagers?: [number, number][];
};

const MACHINES: MachineSpec[] = [
  // The one machine that runs a few points high, so the z flag has something to show.
  { key: 'arcade-slots', weight: 24, table: [[0.5, 0.25], [1, 0.25], [1.5, 0.1], [2, 0.07], [3, 0.03], [5, 0.01]], off: 0.03, wagers: [[5, 0.3], [10, 0.35], [20, 0.2], [25, 0.1], [50, 0.05]] },
  { key: 'arcade-blackjack', weight: 5, table: [[1, 0.085], [2, 0.4], [2.5, 0.047], [3, 0.02], [4, 0.015]] },
  { key: 'arcade-plinko', weight: 4, table: [[0.3, 0.25], [0.5, 0.2], [1, 0.15], [1.5, 0.12], [2, 0.06], [3, 0.04], [5, 0.02], [10, 0.006], [26, 0.0015], [100, 0.0002]] },
  { key: 'arcade-mines', weight: 3, table: [[1.1, 0.18], [1.3, 0.12], [1.6, 0.09], [2, 0.06], [3, 0.035], [5, 0.015], [10, 0.006], [25, 0.001]] },
  { key: 'arcade-video-poker', weight: 2.5, table: [[1, 0.2], [2, 0.125], [3, 0.075], [4, 0.045], [6, 0.012], [9, 0.011], [25, 0.005], [50, 0.001], [250, 0.00004]] },
  { key: 'arcade-lucky-cage', weight: 2, table: [[0.5, 0.12], [1, 0.12], [2, 0.1], [3, 0.05], [5, 0.03], [10, 0.012], [50, 0.003]] },
  { key: 'arcade-prize-claw', weight: 3, table: [[1.5, 0.18], [3, 0.09], [8, 0.03], [20, 0.01], [50, 0.002]] },
  { key: 'arcade-roulette', weight: 1, table: [[2, 0.3], [3, 0.1], [12, 0.03], [36, 0.01]] },
  { key: 'arcade-prize-wheel', weight: 1, table: [[0.5, 0.2], [1, 0.18], [2, 0.1], [4, 0.04], [10, 0.01], [50, 0.002]] },
  { key: 'arcade-coin-flip', weight: 0.8, table: [[2, 0.485]] },
  { key: 'arcade-dice', weight: 0.7, table: [[2, 0.4], [3, 0.2], [10, 0.05]] },
  { key: 'arcade-crash', weight: 1, table: [[1.5, 0.3], [2, 0.15], [5, 0.08], [20, 0.02]] },
  { key: 'arcade-baccarat', weight: 0.5, table: [[1, 0.09], [2, 0.44], [9, 0.01]] },
];

/** The slug the registry gives each machine, for analytics events. */
const SLUG_OF_MACHINE = new Map<string, string>(
  ARCADE_GAMES.filter((g) => g.arcadeHistoryType).map((g) => [g.arcadeHistoryType as string, g.slug]),
);

const WAGERS: [number, number][] = [[5, 0.18], [10, 0.25], [20, 0.2], [25, 0.12], [50, 0.15], [100, 0.07], [250, 0.03]];

/** Multiplier sampler whose mean is the machine's configured return. */
function makeSampler(spec: MachineSpec) {
  const k = configuredRtp(spec.key) + (spec.off ?? 0);
  const meanWin = spec.table.reduce((s, [m, p]) => s + m * p, 0);
  // A hair under the target, so the pass that pins the machine mostly adds tickets.
  const scale = (k - 0.008) / meanWin;
  const table = spec.table.map(([m, p]) => [m, Math.min(0.95, p * scale)] as const);
  return (): number => {
    let x = rnd();
    for (const [m, p] of table) {
      if ((x -= p) < 0) return m;
    }
    return 0;
  };
}

/* ── plain data shapes ────────────────────────────────────────────────── */

type Player = {
  i: number;
  id: string;
  name: string;
  email: string;
  guest: boolean;
  created: number;
  until: number;
  p: number;
  grinder: boolean;
  fav: string[];
  machineAff: number;
  buyer: boolean;
  adWatcher: boolean;
  bal: number;
  store: number;
  xp: number;
  level: number;
  sxp: number;
  tier: number;
  premium: boolean;
  streak: number;
  cursor: number;
  lastActive: number;
  runs: number;
  monthRuns: Map<string, number>;
  owned: Set<string>;
  weekRuns: number;
  week: number;
  weekLastTs: number;
  pending: Pending[];
  noStoreSpend: boolean;
};

type Pending = { ts: number; kind: 'pack' | 'ad' | 'reverse'; pack?: TicketPack; purchaseId?: string };

type LedgerRow = {
  id: string;
  user: string;
  amount: number;
  type: string;
  sid: string;
  meta: Record<string, unknown> | null;
  ts: number;
  bal: number;
};

type Round = {
  id: string;
  user: string;
  name: string;
  game: string;
  wager: number;
  payout: number;
  seed: number;
  ts: number;
  payoutRow: LedgerRow | null;
};

let idCounter = 0;
const nid = (prefix: string) => `seed-${prefix}-${(idCounter++).toString(36).padStart(7, '0')}`;

const ledger: LedgerRow[] = [];
const storeLedger: LedgerRow[] = [];
const rounds: Round[] = [];
const scoreEvents: (string | number)[][] = [];
const analytics: (string | number | boolean | null)[][] = [];
const timeMetrics = new Map<string, { user: string; game: string; day: string; ms: number; runs: number; first: number; last: number }>();
const earnings = new Map<string, number>();
const dailyQuests: (string | number | boolean | null)[][] = [];
const questDays: (string | number)[][] = [];
const weeklyQuests: (string | number | boolean | null)[][] = [];
const seasonQuests: (string | number | boolean | null)[][] = [];
const levelClaims: (string | number)[][] = [];
const owned: (string | number)[][] = [];
const purchases: (string | number | null)[][] = [];
const matchPool = new Map<string, { user: Player; ts: number }[]>();

const season = currentSeason();
// The live season, whatever its key; its own config says when it started.
const SEASON_START = season.startMs;

function credit(
  u: Player,
  amount: number,
  type: string,
  sid: string,
  meta: Record<string, unknown> | null,
  ts: number,
): LedgerRow {
  if (u.bal + amount < 0) throw new Error(`seed: ${u.id} would go negative (${u.bal} ${amount} ${type})`);
  u.bal += amount;
  const row: LedgerRow = { id: nid('cl'), user: u.id, amount, type, sid, meta, ts, bal: 0 };
  ledger.push(row);
  return row;
}

function storeCredit(u: Player, amount: number, type: string, sid: string, meta: Record<string, unknown> | null, ts: number) {
  if (u.store + amount < 0) throw new Error(`seed: ${u.id} store would go negative`);
  u.store += amount;
  storeLedger.push({ id: nid('sl'), user: u.id, amount, type, sid, meta, ts, bal: 0 });
}

/** Account XP, the level rewards it unlocks and the season tiers it reaches. */
function grantXp(u: Player, amount: number, ts: number) {
  u.xp += amount;
  const level = levelFromXp(u.xp, 1);
  for (let l = u.level + 1; l <= level; l += 1) {
    const tickets = levelMilestoneReward(l);
    if (tickets > 0) {
      credit(u, tickets, 'level_reward', `level:${l}`, { level: l }, ts + 2 * SEC);
      levelClaims.push([u.id, l, tickets, ts + 2 * SEC]);
    }
  }
  u.level = Math.max(u.level, level);
  if (ts < SEASON_START) return;
  u.sxp += amount;
  const tier = seasonTierFromXp(season, u.sxp);
  for (let t = u.tier + 1; t <= tier; t += 1) {
    const cfg = season.tiers[t - 1];
    if (!cfg) continue;
    if (cfg.free.kind === 'tickets' && rnd() < 0.85) {
      credit(u, cfg.free.amount, 'battlepass', `${season.key}:free:t${t}`, { tier: t, track: 'free' }, ts + 3 * SEC);
    }
    if (u.premium && cfg.premium && cfg.premium.kind === 'tickets') {
      credit(u, cfg.premium.amount, 'battlepass', `${season.key}:premium:t${t}`, { tier: t, track: 'premium' }, ts + 4 * SEC);
    }
  }
  u.tier = Math.max(u.tier, tier);
}

/* ── the cast ─────────────────────────────────────────────────────────── */

const ADJ = ['quiet', 'swift', 'lucky', 'amber', 'neon', 'tiny', 'rusty', 'gold', 'cosmic', 'sleepy', 'brisk', 'plucky', 'mellow', 'jolly', 'crisp', 'dusty', 'giddy', 'hazy', 'loud', 'misty', 'nifty', 'proud', 'sunny', 'witty', 'zesty', 'cobalt', 'velvet', 'copper'];
const NOUN = ['otter', 'comet', 'pretzel', 'badger', 'marble', 'kettle', 'falcon', 'noodle', 'rocket', 'lantern', 'pigeon', 'walrus', 'button', 'tickets', 'gizmo', 'muffin', 'sparrow', 'cricket', 'puffin', 'dragon', 'waffle', 'hornet', 'meteor', 'pickle', 'tumbler', 'drifter', 'moth', 'ferret'];

function makeName(i: number): string {
  const base = `${ADJ[i % ADJ.length]}_${NOUN[Math.floor(i / ADJ.length) % NOUN.length]}`;
  const round = Math.floor(i / (ADJ.length * NOUN.length));
  const tail = round > 0 || i % 3 === 0 ? String(10 + ((i * 37) % 90)) : '';
  return (round > 0 ? `${base}${tail}${round}` : `${base}${tail}`).slice(0, 24);
}

const FAVS = [...SCORE_GAMES.filter((g) => !g.daily).map((g) => g.key), ...MATCH_GAMES.map((g) => g.key)];

/** Pack purchases and rewarded ads, scheduled across a player's life. */
function schedulePending(u: Player) {
  const end = Math.min(u.until, NOW - 2 * HOUR);
  if (end <= u.created + HOUR) return;
  const at = () => u.created + Math.floor(rnd() * (end - u.created));
  if (u.buyer) {
    for (let k = int(1, 3); k > 0; k -= 1) {
      const pack = weighted(packs.map((p, n) => [p, [50, 28, 15, 7][n] ?? 5] as const));
      u.pending.push({ ts: at(), kind: 'pack', pack });
    }
  }
  if (u.adWatcher) for (let k = int(1, 8); k > 0; k -= 1) u.pending.push({ ts: at(), kind: 'ad' });
  u.pending.sort((a, b) => a.ts - b.ts);
}

function makePlayer(i: number, guest: boolean): Player {
  const created = NOW - Math.floor(DAYS * DAY * (1 - Math.sqrt(rnd()))) - Math.floor(rnd() * HOUR) - 2 * HOUR;
  const oneAndDone = rnd() < (guest ? 0.7 : 0.3);
  const life = oneAndDone ? rnd() * 1.5 * DAY : -Math.log(1 - rnd()) * (guest ? 8 : 30) * DAY;
  const grinder = !guest && rnd() < 0.07;
  const name = makeName(i);
  const guestUuid = `5eed${hex(4)}${uuid().slice(8)}`;
  const favCount = grinder ? 1 : int(1, 3);
  const player: Player = {
    i,
    id: guest ? `guest:${guestUuid}` : `seed-${String(i).padStart(4, '0')}`,
    name,
    email: `${name}@example.com`,
    guest,
    created,
    until: created + life,
    p: 0.25 + rnd() * 0.55,
    grinder,
    fav: shuffle([...FAVS]).slice(0, favCount),
    machineAff: guest ? 0 : rnd() < 0.45 ? 0.8 + rnd() * 1.0 : 0.12,
    buyer: !guest && rnd() < 0.045,
    adWatcher: !guest && rnd() < 0.1,
    bal: 0,
    store: 0,
    xp: 0,
    level: 1,
    sxp: 0,
    tier: 0,
    premium: !guest && rnd() < 0.08,
    streak: 0,
    cursor: 0,
    lastActive: created,
    runs: 0,
    monthRuns: new Map(),
    owned: new Set(),
    weekRuns: 0,
    week: -1,
    weekLastTs: 0,
    pending: [],
    noStoreSpend: false,
  };
  schedulePending(player);
  return player;
}

/* ── quests ───────────────────────────────────────────────────────────── */

type Quest = { key: string; kind: string; game: string | null; goal: number; xp: number; tickets: number };
const QUEST_POOL: Quest[] = [
  { key: 'play-any-3', kind: 'play_any', game: null, goal: 3, xp: 150, tickets: 40 },
  { key: 'play-any-6', kind: 'play_any', game: null, goal: 6, xp: 250, tickets: 75 },
  { key: 'earn-150', kind: 'earn_tickets', game: null, goal: 150, xp: 150, tickets: 40 },
  { key: 'earn-250', kind: 'earn_tickets', game: null, goal: 250, xp: 300, tickets: 75 },
  { key: 'play-snake-2', kind: 'play_game', game: 'snake', goal: 2, xp: 150, tickets: 40 },
  { key: 'play-stack-2', kind: 'play_game', game: 'stack', goal: 2, xp: 150, tickets: 40 },
  { key: 'play-2048-2', kind: 'play_game', game: '2048', goal: 2, xp: 150, tickets: 40 },
  { key: 'play-skee-ball-2', kind: 'play_game', game: 'skee-ball', goal: 2, xp: 150, tickets: 40 },
  { key: 'score-flappy-bird-20', kind: 'score_game', game: 'flappy-bird', goal: 20, xp: 250, tickets: 60 },
];

type DayTally = { runs: number; earned: number; perGame: Map<string, number>; lastTs: number };

function finishQuests(u: Player, day: string, tally: DayTally) {
  const picks = shuffle([...QUEST_POOL]).slice(0, 3);
  let rerolls = 0;
  if (rnd() < 0.12) rerolls = rnd() < 0.7 ? 1 : 2;
  const closeTs = tally.lastTs + MIN;
  picks.forEach((q, slot) => {
    let progress = 0;
    if (q.kind === 'play_any') progress = tally.runs;
    else if (q.kind === 'earn_tickets') progress = tally.earned;
    else if (q.kind === 'play_game') progress = tally.perGame.get(q.game ?? '') ?? 0;
    else progress = (tally.perGame.get(q.game ?? '') ?? 0) > 0 ? Math.round(q.goal * (0.4 + rnd() * 0.9)) : 0;
    progress = Math.min(q.goal, progress);
    const done = progress >= q.goal;
    const claimed = done && rnd() < 0.82 && closeTs < NOW - 10 * SEC;
    dailyQuests.push([u.id, day, slot, q.key, q.kind, q.game, q.goal, progress, q.xp, claimed, tally.lastTs - 5 * MIN, q.tickets, null]);
    if (claimed) {
      credit(u, q.tickets, 'battlepass', `quest:${day}:${slot}`, { kind: 'daily_quest', dateKey: day, slotIndex: slot }, closeTs);
      grantXp(u, q.xp, closeTs);
    }
  });
  questDays.push([u.id, day, rerolls]);
}

function weekOf(ts: number) {
  return Math.floor((ts - SEASON_START) / WEEK) + 1;
}

/** Season 0's weekly quests: three rows a week, claimed from what the week held. */
function finishWeek(u: Player) {
  if (u.guest || u.week < 0 || u.weekRuns === 0) return;
  const rows: [string, string, number, number, number, string | null][] = [
    ['w-play-15', 'play_any', 15, 300, 100, null],
    ['w-earn-500', 'earn_tickets', 500, 300, 110, null],
    ['w-score-snake', 'score_game', 300, 350, 120, 'snake'],
  ];
  rows.forEach(([key, kind, goal, xp, tickets, game], slot) => {
    const progress = Math.min(goal, Math.round(u.weekRuns * (kind === 'earn_tickets' ? 14 : kind === 'score_game' ? 12 : 1)));
    const done = progress >= goal;
    const claimed = done && rnd() < 0.7 && u.weekLastTs + 2 * MIN < NOW - 10 * SEC;
    weeklyQuests.push([u.id, u.week, slot, key, kind, game, goal, progress, xp, tickets, claimed, u.weekLastTs - u.weekRuns * 4 * MIN, null]);
    if (claimed) {
      credit(u, tickets, 'battlepass', `weekly-quest:${u.week}:${slot}`, { kind: 'weekly_quest', week: u.week, slotIndex: slot }, u.weekLastTs + 2 * MIN);
      grantXp(u, xp, u.weekLastTs + 2 * MIN);
    }
  });
  u.weekRuns = 0;
}

function finishSeasonQuests(u: Player) {
  if (u.guest || u.runs === 0) return;
  const rows: [string, string, number, number, number, string | null][] = [
    ['season-play-40', 'play_any', 40, 600, 150, null],
    ['season-earn-2000', 'earn_tickets', 2000, 600, 150, null],
    ['season-play-stack-20', 'play_game', 20, 500, 120, 'stack'],
  ];
  rows.forEach(([key, kind, goal, xp, tickets, game], slot) => {
    const progress = Math.min(goal, Math.round(u.runs * (kind === 'earn_tickets' ? 12 : kind === 'play_game' ? 0.3 : 1)));
    const done = progress >= goal;
    const ts = u.lastActive;
    const claimed = done && rnd() < 0.75 && ts < NOW - 10 * SEC;
    seasonQuests.push([u.id, season.key, slot, key, kind, game, goal, progress, xp, tickets, claimed, u.created + HOUR, null]);
    if (claimed) {
      credit(u, tickets, 'battlepass', `season-quest:${season.key}:${slot}`, { kind: 'season_quest', seasonKey: season.key, slotIndex: slot }, ts + MIN);
      grantXp(u, xp, ts + MIN);
    }
  });
}

/* ── store catalog and packs ──────────────────────────────────────────── */

type CatalogItem = { id: string; name: string; price: number };
let catalog: CatalogItem[] = [];
const packs = getTicketPacks();

/* ── one player's whole life ──────────────────────────────────────────── */

function emitAnalytics(u: Player, slug: string, sessionKey: string, ts: number, durMs: number, completes: boolean) {
  const hash = sha(`seed:${u.id}:${sessionKey}`).slice(0, 32);
  const actor = u.guest ? null : sha(`seed-actor:${u.id}`).slice(0, 32);
  analytics.push([nid('pae'), 'game_started', hash, !u.guest, `/${slug}`, slug, 'direct', ts, actor]);
  if (completes) analytics.push([nid('pae'), 'game_completed', hash, !u.guest, `/${slug}`, slug, 'direct', ts + durMs, actor]);
}

function addTime(u: Player, key: string, ts: number, ms: number) {
  const day = dateKey(ts);
  const k = `${u.id}|${key}|${day}`;
  const row = timeMetrics.get(k) ?? { user: u.id, game: key, day, ms: 0, runs: 0, first: ts, last: ts };
  row.ms += ms;
  row.runs += 1;
  row.last = Math.max(row.last, ts);
  timeMetrics.set(k, row);
}

const machineSamplers = new Map(MACHINES.map((m) => [m.key, makeSampler(m)]));

function simulate(u: Player) {
  const firstDay = Math.floor((u.created - TODAY0) / DAY) * DAY + TODAY0;
  const sessionWeights = (): readonly (readonly [string, number])[] => [
    ...SCORE_GAMES.map((g) => [`score:${g.key}`, g.weight * (u.fav.includes(g.key) ? 3.2 : 1)] as const),
    ...MATCH_GAMES.map((g) => [`match:${g.key}`, u.guest ? 0 : g.weight * (u.fav.includes(g.key) ? 3.2 : 1)] as const),
    ...MACHINES.map((m) => [`machine:${m.key}`, m.weight * u.machineAff] as const),
  ];
  const weights = sessionWeights();

  for (let ds = firstDay; ds <= TODAY0; ds += DAY) {
    if (ds > u.until) break;
    const signupDay = ds === firstDay;
    if (!signupDay && rnd() > u.p * (isWeekend(ds) ? 1.2 : 1)) continue;

    const nSess = Math.min(5, 1 + geo(1.3));
    const times = Array.from({ length: nSess }, () => atHour(ds)).sort((a, b) => a - b);
    const day = dateKey(ds);
    const tally: DayTally = { runs: 0, earned: 0, perGame: new Map(), lastTs: 0 };
    const doneToday = new Set<string>();
    let first = true;

    for (const planned of times) {
      let ts = Math.max(planned, u.cursor + 2 * SEC, u.created + 30 * SEC);
      if (ts >= NOW - 90 * SEC) break;
      applyPending(u, ts);
      const choice = weighted(weights);
      const [kind, gameKey] = choice.split(':') as [string, string];
      if (first && !u.guest && isWeekend(ds) === false && rnd() < 0.8) {
        u.streak += 1;
        const amount = 25 + 5 * Math.min(u.streak, 9);
        credit(u, amount, 'daily_claim', `daily-claim:${day}:tickets`, { dateKey: day, streak: u.streak, isMilestone: u.streak % 7 === 0, displayCurrency: 'tickets' }, ts + 2 * SEC);
        ts += 4 * SEC;
      }
      first = false;
      const wk = weekOf(ts);
      if (u.week !== wk) {
        finishWeek(u);
        u.week = wk;
      }

      if (kind === 'score') {
        const g = SCORE_GAMES.find((x) => x.key === gameKey) as ScoreGame;
        if (g.daily && doneToday.has(g.key)) continue;
        doneToday.add(g.key);
        const heavy = u.grinder && u.fav[0] === g.key;
        const runs = g.daily ? 1 : heavy ? int(16, 34) : 1 + geo(3.6);
        const sessionKey = `${day}:${ts}`;
        const sessionRuns: number[] = [];
        for (let r = 0; r < runs; r += 1) {
          const dur = Math.round(clamp(g.durS[0] + gauss() * g.durS[1], 10, 1500) * SEC);
          if (ts + dur >= NOW - 30 * SEC) break;
          const start = ts;
          ts += dur;
          const tableKey = g.key === 'stack' && rnd() < 0.2 ? 'stack-cabinet' : g.key;
          const score = Math.max(1, Math.round(g.top * Math.exp(gauss() * 0.6) * 0.18));
          scoreEvents.push([nid('gse'), g.key, u.id, u.name, score, ts, null as unknown as number]);
          addTime(u, tableKey, ts, dur);
          emitAnalytics(u, g.key, sessionKey, start, dur, rnd() < 0.86);
          u.runs += 1;
          u.monthRuns.set(monthKey(ts), (u.monthRuns.get(monthKey(ts)) ?? 0) + 1);
          tally.runs += 1;
          tally.lastTs = ts;
          tally.perGame.set(g.key, (tally.perGame.get(g.key) ?? 0) + 1);
          sessionRuns.push(ts);
          u.weekRuns += 1;
          u.weekLastTs = ts;
          u.lastActive = ts;
          u.cursor = ts;
          if (!u.guest) {
            const want = int(g.reward[0], g.reward[1]);
            const dk = dateKey(ts);
            const key = `${u.id}|${g.key}|${dk}`;
            const got = earnings.get(key) ?? 0;
            const award = Math.min(want, GAME_DAILY_CREDIT_CAP - got);
            if (award > 0) {
              credit(u, award, 'game_reward', `game:${g.key}:${nid('run')}`, { gameType: g.key, score }, ts);
              earnings.set(key, got + award);
              tally.earned += award;
            }
            grantXp(u, int(g.xp[0], g.xp[1]), ts);
          }
          ts += int(6, 20) * SEC;
          u.cursor = ts;
        }
      } else if (kind === 'match') {
        const slot = `${day}|${gameKey}`;
        const list = matchPool.get(slot) ?? [];
        list.push({ user: u, ts });
        matchPool.set(slot, list);
        const durMs = int(4, 24) * MIN;
        emitAnalytics(u, gameKey, `${day}:${ts}`, ts, durMs, rnd() < 0.8);
        if (ts + durMs < NOW - MIN) {
          u.cursor = ts + durMs;
          u.lastActive = ts + durMs;
          tally.lastTs = ts + durMs;
          grantXp(u, 30, ts + durMs);
        }
      } else {
        const spec = MACHINES.find((m) => m.key === gameKey) as MachineSpec;
        const sample = machineSamplers.get(spec.key) as () => number;
        const bets = u.machineAff > 0.8 ? int(15, 70) : int(4, 14);
        const slug = SLUG_OF_MACHINE.get(spec.key) ?? spec.key;
        const startTs = ts;
        let played = 0;
        for (let b = 0; b < bets; b += 1) {
          const wager = weighted(spec.wagers ?? WAGERS);
          if (u.bal < wager + 100) break;
          if (ts + 20 * SEC >= NOW - 30 * SEC) break;
          const sid = nid('rs');
          const mult = sample();
          const payout = Math.round(wager * mult);
          credit(u, -wager, 'wager_hold', `arcade-hold:${sid}`, { arcadeGameType: spec.key, sessionId: sid }, ts);
          const payoutRow = payout > 0 ? credit(u, payout, 'wager_payout', `arcade-payout:${sid}`, { arcadeGameType: spec.key, sessionId: sid, multiplier: wager > 0 ? payout / wager : 0 }, ts + 3 * SEC) : null;
          rounds.push({ id: nid('rh'), user: u.id, name: u.name, game: spec.key, wager, payout, seed: int(1, 2_000_000_000), ts: ts + 3 * SEC, payoutRow });
          played += 1;
          u.runs += 1;
          u.monthRuns.set(monthKey(ts), (u.monthRuns.get(monthKey(ts)) ?? 0) + 1);
          ts += int(15, 45) * SEC;
          u.cursor = ts;
        }
        if (played > 0) {
          addTime(u, 'arcade', ts, ts - startTs);
          emitAnalytics(u, slug, `${day}:${startTs}`, startTs, ts - startTs, rnd() < 0.8);
          tally.lastTs = ts;
          u.lastActive = ts;
        }
      }

      // Counter item, now and then, when the player can afford it.
      if (!u.guest && rnd() < 0.03 && catalog.length > 0) {
        const item = catalog[Math.floor(Math.pow(rnd(), 1.6) * catalog.length)] as CatalogItem;
        const total = item.price;
        if (!u.owned.has(item.id) && u.bal + (u.noStoreSpend ? 0 : u.store) >= total + 60) {
          const pts = Math.max(ts, u.cursor) + 20 * SEC;
          const purchaseId = `purchase:${uuid()}`;
          const fromStore = u.noStoreSpend ? 0 : Math.min(u.store, total);
          const fromEarned = total - fromStore;
          const meta = { itemId: item.id, itemName: item.name, dateKey: dateKey(pts), purchaseId };
          if (fromStore > 0) storeCredit(u, -fromStore, 'store_purchase', `${purchaseId}:store`, { ...meta, displayCurrency: 'store_tickets' }, pts);
          if (fromEarned > 0) credit(u, -fromEarned, 'purchase', `${purchaseId}:earned`, { ...meta, displayCurrency: 'tickets' }, pts);
          u.owned.add(item.id);
          owned.push([u.id, item.id, pts, 'purchase']);
          u.cursor = pts;
        }
      }
    }

    if (tally.runs > 0 || tally.lastTs > 0) {
      if (!u.guest && tally.lastTs > 0) finishQuests(u, day, tally);
    }
  }
  finishWeek(u);
}

/* ── tickets bought with money, and rewarded ads ──────────────────────── */

let reversalPlanned = false;
const purchaseIndex = new Map<string, number>();

/** Apply the pack purchases, ads and one refund that came due before `ts`. */
function applyPending(u: Player, ts: number) {
  while (u.pending.length > 0 && (u.pending[0] as Pending).ts <= ts) {
    const ev = u.pending.shift() as Pending;
    const at = Math.max(ev.ts, u.cursor + SEC);
    if (ev.kind === 'ad') {
      storeCredit(u, pick([10, 15, 20, 25]), 'rewarded_ad', nid('ad'), { placement: 'ticket-stop' }, at);
    } else if (ev.kind === 'pack' && ev.pack) {
      const pack = ev.pack;
      const id = nid('tp');
      if (rnd() < 0.07) {
        purchases.push([id, u.id, pack.id, pack.tickets, pack.amount, pack.currency, rnd() < 0.5 ? 'failed' : 'expired', null, null, at, at + 30 * MIN, null, null, null]);
        continue;
      }
      const fulfilledAt = at + 40 * SEC;
      storeCredit(u, pack.tickets, 'stripe_purchase', id, { packId: pack.id, displayCurrency: 'store_tickets' }, fulfilledAt);
      purchaseIndex.set(id, purchases.length);
      purchases.push([id, u.id, pack.id, pack.tickets, pack.amount, pack.currency, 'fulfilled', `cs_seed_${id}`, `pi_seed_${id}`, at, fulfilledAt, fulfilledAt, null, null]);
      if (!reversalPlanned && pack.id === packs0Id()) {
        // One purchase is refunded a few hours later; that player keeps the
        // tickets until then so the reversal always has something to take back.
        reversalPlanned = true;
        u.noStoreSpend = true;
        u.pending.push({ ts: fulfilledAt + 3 * HOUR, kind: 'reverse', pack, purchaseId: id });
        u.pending.sort((x, y) => x.ts - y.ts);
      }
    } else if (ev.kind === 'reverse' && ev.pack && ev.purchaseId) {
      storeCredit(u, -ev.pack.tickets, 'stripe_reversal', `${ev.purchaseId}:reversal`, { packId: ev.pack.id }, at);
      const row = purchases[purchaseIndex.get(ev.purchaseId) as number] as (string | number | null)[];
      row[6] = 'refunded';
      row[12] = at;
      row[13] = 'reversed';
    }
  }
}

const packs0Id = () => packs[0]?.id ?? 'starter';

/* ── monthly boards ───────────────────────────────────────────────────── */

function simulateMonthly(list: Player[]) {
  const months = new Set<string>();
  for (const u of list) for (const m of u.monthRuns.keys()) months.add(m);
  for (const m of [...months].sort()) {
    const [y, mo] = m.split('-').map(Number) as [number, number];
    const paidAt = Date.UTC(y, mo, 1, 0, 20);
    if (paidAt >= NOW || paidAt < NOW - DAYS * DAY) continue;
    const ranked = list
      .filter((u) => (u.monthRuns.get(m) ?? 0) > 0)
      .sort((a, b) => (b.monthRuns.get(m) ?? 0) - (a.monthRuns.get(m) ?? 0))
      .slice(0, 10);
    const prizes = [1000, 600, 400, 250, 250, 150, 150, 100, 100, 100];
    ranked.forEach((u, rank) => {
      credit(u, prizes[rank] ?? 100, 'monthly_reward', `monthly-credits:${m}:runs:${u.id}`, { monthKey: m, leaderboardKey: 'runs', rank: rank + 1 }, paidAt);
    });
  }
}

/* ── friends matches ──────────────────────────────────────────────────── */

type MatchRow = (string | number | boolean | null)[];
const chessRows: MatchRow[] = [];
const connectRows: MatchRow[] = [];
const poolRows: MatchRow[] = [];

function pairMatches() {
  for (const [slot, list] of matchPool) {
    const game = slot.split('|')[1] as MatchGame['key'];
    shuffle(list);
    for (let i = 0; i < list.length; i += 2) {
      const a = list[i] as { user: Player; ts: number };
      const b = list[i + 1];
      const botId = `bot:${game}-medium`;
      const ts = b ? Math.max(a.ts, b.ts) : a.ts;
      const dur = int(4, 24) * MIN;
      if (ts + dur >= NOW - MIN) continue;
      const p1 = a.user;
      const p2 = b?.user ?? null;
      const winner = rnd() < 0.5 ? p1.id : (p2?.id ?? botId);
      const loser = winner === p1.id ? (p2?.id ?? botId) : p1.id;
      const id = nid(game === 'chess' ? 'ch' : game === 'connect-four' ? 'c4' : 'pl');
      const common = [id, p1.id, p1.name, null, p2?.id ?? botId, p2?.name ?? 'bot'] as const;
      if (game === 'chess') {
        chessRows.push([...common, p1.id, p2?.id ?? botId, 'completed', 'white', 'rapid', 600000, 0, 120000, 90000, 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', 40, 20, '1-0', winner, loser, 'checkmate', ts, ts + dur, ts + dur]);
      } else if (game === 'connect-four') {
        connectRows.push([...common, p1.id, p2?.id ?? botId, 'completed', 'white', '0'.repeat(42), 21, 21, '1-0', winner, loser, 'connect', ts, ts + dur, ts + dur]);
      } else {
        poolRows.push([...common, 'completed', 'p1', 'ended', '[]', winner, loser, 'eight-ball', 14, ts, ts + dur, ts + dur]);
      }
    }
  }
}

/* ── writes ───────────────────────────────────────────────────────────── */

type Col = [name: string, type: string];
type Client = import('pg').PoolClient;

async function bulk(client: Client, table: string, cols: Col[], rows: readonly (readonly unknown[])[], tail = '') {
  const BATCH = 4000;
  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH);
    const params = cols.map((_, c) => chunk.map((r) => r[c] ?? null));
    const unnest = cols.map((c, n) => `$${n + 1}::${c[1]}[]`).join(', ');
    await client.query(`INSERT INTO ${table} (${cols.map((c) => c[0]).join(', ')}) SELECT * FROM unnest(${unnest}) ${tail}`, params);
  }
}

async function resetSeed(client: Client) {
  const accounts = await client.query<{ id: string }>(
    `SELECT id FROM arcade_accounts WHERE email LIKE '%@example.com' AND metadata_json LIKE '%"seed":true%'`,
  );
  const ids = accounts.rows.map((r) => r.id);
  const byUser: [string, string][] = [
    ['currency_ledger', 'user_id'],
    ['store_credit_ledger', 'user_id'],
    ['wallets', 'user_id'],
    ['game_time_metrics_daily', 'user_id'],
    ['game_score_events', 'od_user_id'],
    ['game_daily_earnings', 'user_id'],
    ['arcade_round_history', 'user_id'],
    ['user_owned_items', 'user_id'],
    ['ticket_purchases', 'user_id'],
    ['user_account_xp', 'user_id'],
    ['user_season_progress', 'user_id'],
    ['user_daily_quests', 'user_id'],
    ['user_quest_day', 'user_id'],
    ['user_weekly_quests', 'user_id'],
    ['user_season_quests', 'user_id'],
    ['user_level_reward_claims', 'user_id'],
    ['user_achievements', 'user_id'],
    ['anti_cheat_logs', 'user_id'],
    ['game_bans', 'user_id'],
    ['arcade_user_presence', 'user_id'],
    ['game_sessions', 'od_user_id'],
  ];
  for (const [table, column] of byUser) {
    await client.query(`DELETE FROM ${table} WHERE ${column} = ANY($1::text[]) OR ${column} LIKE 'guest:5eed%'`, [ids]);
  }
  await client.query(`DELETE FROM product_analytics_events WHERE id LIKE 'seed-%'`);
  for (const table of ['chess_matches', 'connect_four_matches', 'pool_matches']) {
    await client.query(`DELETE FROM ${table} WHERE id LIKE 'seed-%'`);
  }
  await client.query(`DELETE FROM arcade_accounts WHERE id = ANY($1::text[])`, [ids]);
  await client.query(
    `UPDATE achievement_unlock_counts c SET count = COALESCE(
       (SELECT COUNT(*) FROM user_achievements a WHERE a.achievement_id = c.achievement_id), 0)`,
  );
  for (const table of ['admin_play_days', 'admin_ledger_days', 'admin_machine_days', 'admin_trust_days', 'admin_funnel_days', 'admin_rollup_days']) {
    await client.query(`DELETE FROM ${table}`);
  }
  return ids.length;
}

/** What is happening right now: presence, live sessions and open tables. */
async function writeLive(client: Client, accounts: { id: string; name: string }[]) {
  const ids = accounts.map((a) => a.id);
  await client.query(`DELETE FROM arcade_user_presence WHERE user_id = ANY($1::text[])`, [ids]);
  await client.query(`DELETE FROM game_sessions WHERE id LIKE 'seed-%'`);
  for (const table of ['chess_matches', 'connect_four_matches', 'pool_matches']) {
    await client.query(`DELETE FROM ${table} WHERE id LIKE 'seed-live-%'`);
  }
  const now = Date.now();
  const crowd = shuffle([...accounts]);
  const freshCount = Math.min(25, crowd.length);
  const floorSlugs = ['snake', '2048', 'stack', 'flappy-bird', 'skee-ball', '21', 'slots', 'plinko', '8-ball', 'chess', 'connect-four', 'ricochet'];
  const presence: (string | number | null)[][] = crowd.slice(0, freshCount).map((a, i) => {
    const inGame = i < 11;
    const seen = now - Math.floor(rnd() * 55) * SEC;
    return [a.id, inGame ? 'in_game' : 'online', inGame ? floorSlugs[i % floorSlugs.length] ?? null : null, seen, seen];
  });
  crowd.slice(freshCount, freshCount + 150).forEach((a) => {
    const seen = now - int(5, 600) * MIN;
    presence.push([a.id, 'offline', null, seen, seen]);
  });
  await bulk(client, 'arcade_user_presence', [['user_id', 'text'], ['status', 'text'], ['game_slug', 'text'], ['last_seen_at', 'bigint'], ['updated_at', 'bigint']], presence, 'ON CONFLICT (user_id) DO UPDATE SET status = EXCLUDED.status, game_slug = EXCLUDED.game_slug, last_seen_at = EXCLUDED.last_seen_at, updated_at = EXCLUDED.updated_at');

  const sessions: (string | number | null)[][] = [];
  const liveKeys = ['snake', 'stack-cabinet', '2048', 'flappy-bird', 'arcade-slots', 'arcade-blackjack', 'skee-ball', 'ricochet'];
  for (let i = 0; i < 12; i += 1) {
    const who = i < 9 ? (crowd[i % freshCount] as { id: string }).id : `guest:5eed${String(i).padStart(4, '0')}-0000-4000-8000-000000000000`;
    const started = now - int(1, 4) * MIN - int(0, 50) * SEC;
    sessions.push([`seed-live-gs-${i}`, who, liveKeys[i % liveKeys.length] ?? 'snake', started, now - int(2, 200) * SEC, int(3, 60)]);
  }
  await bulk(client, 'game_sessions', [['id', 'text'], ['od_user_id', 'text'], ['game_type', 'text'], ['started_at', 'bigint'], ['last_action_at', 'bigint'], ['action_count', 'integer']], sessions);

  // Open tables: waiting lobbies owned by present players, and a few live matches.
  const owners = crowd.slice(0, freshCount);
  const mk = (n: number) => owners[n % owners.length] as { id: string; name: string };
  const t0 = now - 3 * MIN;
  const chess: MatchRow[] = [];
  const connect: MatchRow[] = [];
  const poolM: MatchRow[] = [];
  const fen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
  [0, 1].forEach((n) => {
    const a = mk(n);
    chess.push([`seed-live-ch-w${n}`, a.id, a.name, null, null, null, null, null, 'waiting', 'white', 'rapid', 600000, 0, 600000, 600000, fen, t0, t0]);
  });
  {
    const a = mk(2);
    connect.push([`seed-live-c4-w0`, a.id, a.name, null, null, null, null, null, 'waiting', 'white', '0'.repeat(42), t0, t0]);
    const b = mk(3);
    poolM.push([`seed-live-pl-w0`, b.id, b.name, null, null, null, 'waiting', 'p1', 'break', '[]', t0, t0]);
  }
  {
    const a = mk(4);
    const b = mk(5);
    chess.push([`seed-live-ch-a0`, a.id, a.name, null, b.id, b.name, a.id, b.id, 'active', 'white', 'rapid', 600000, 0, 420000, 380000, fen, t0, now - 20 * SEC]);
    const c = mk(6);
    const d = mk(7);
    connect.push([`seed-live-c4-a0`, c.id, c.name, null, d.id, d.name, c.id, d.id, 'active', 'white', '0'.repeat(42), t0, now - 15 * SEC]);
    const e = mk(8);
    const f = mk(9);
    poolM.push([`seed-live-pl-a0`, e.id, e.name, null, f.id, f.name, 'active', 'p1', 'open', '[]', t0, now - 30 * SEC]);
  }
  await bulk(client, 'chess_matches', [['id', 'text'], ['player1_id', 'text'], ['player1_name', 'text'], ['invited_user_id', 'text'], ['player2_id', 'text'], ['player2_name', 'text'], ['white_id', 'text'], ['black_id', 'text'], ['status', 'text'], ['current_turn', 'text'], ['time_format', 'text'], ['initial_time_ms', 'bigint'], ['increment_ms', 'bigint'], ['white_time_ms', 'bigint'], ['black_time_ms', 'bigint'], ['fen', 'text'], ['created_at', 'bigint'], ['updated_at', 'bigint']], chess);
  await bulk(client, 'connect_four_matches', [['id', 'text'], ['player1_id', 'text'], ['player1_name', 'text'], ['invited_user_id', 'text'], ['player2_id', 'text'], ['player2_name', 'text'], ['white_id', 'text'], ['black_id', 'text'], ['status', 'text'], ['current_turn', 'text'], ['board', 'text'], ['created_at', 'bigint'], ['updated_at', 'bigint']], connect);
  await bulk(client, 'pool_matches', [['id', 'text'], ['player1_id', 'text'], ['player1_name', 'text'], ['invited_user_id', 'text'], ['player2_id', 'text'], ['player2_name', 'text'], ['status', 'text'], ['current_turn', 'text'], ['phase', 'text'], ['balls_json', 'text'], ['created_at', 'bigint'], ['updated_at', 'bigint']], poolM);
}

/* ── main ─────────────────────────────────────────────────────────────── */

async function loadAccounts() {
  const result = await pool.query<{ id: string; name: string }>(
    `SELECT id, username AS name FROM arcade_accounts WHERE id LIKE 'seed-%' AND username IS NOT NULL`,
  );
  return result.rows;
}

async function main() {
  if (LIVE_ONLY) {
    const accounts = await loadAccounts();
    if (accounts.length === 0) die('no seeded accounts; run without --live first.');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await writeLive(client, accounts);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    console.log(`Refreshed presence, live sessions and open tables for ${accounts.length} seeded accounts.`);
    return;
  }

  if (RESET) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const removed = await resetSeed(client);
      await client.query('COMMIT');
      console.log(`Reset: removed ${removed} seeded accounts and their rows.`);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } else {
    const existing = await pool.query(`SELECT 1 FROM arcade_accounts WHERE id LIKE 'seed-%' LIMIT 1`);
    if (existing.rowCount) die('seed data is already here. Run with --reset to replace it.');
  }

  const items = await pool.query<{ id: string; name: string; price: number }>(
    `SELECT id, name, price FROM store_items WHERE active AND currency_type = 'credits' AND price > 0 ORDER BY price, id`,
  );
  catalog = items.rows;

  // The cast.
  const accounts = Array.from({ length: PLAYERS }, (_, i) => makePlayer(i + 1, false));
  const guests = Array.from({ length: Math.round(PLAYERS * 0.2) }, (_, i) => makePlayer(PLAYERS + 1 + i, true));
  const everyone = [...accounts, ...guests];
  for (const u of everyone) simulate(u);
  for (const u of accounts) finishSeasonQuests(u);
  simulateMonthly(accounts);
  pairMatches();

  // Machines: pin each machine's actual return near its configured one, one a few points high.
  const byMachine = new Map<string, Round[]>();
  for (const r of rounds) {
    const list = byMachine.get(r.game) ?? [];
    list.push(r);
    byMachine.set(r.game, list);
  }
  const machineNotes: string[] = [];
  const ledgerByUser = new Map<string, LedgerRow[]>();
  for (const row of ledger) {
    const list = ledgerByUser.get(row.user) ?? [];
    list.push(row);
    ledgerByUser.set(row.user, list);
  }
  const staysAboveZero = (user: string) => {
    const list = (ledgerByUser.get(user) ?? []).slice().sort((a, b) => a.ts - b.ts || a.id.localeCompare(b.id));
    let bal = 0;
    for (const row of list) {
      bal += row.amount;
      if (bal < 0) return false;
    }
    return true;
  };
  const setPayout = (r: Round, payout: number) => {
    r.payout = payout;
    if (r.payoutRow) {
      r.payoutRow.amount = payout;
      r.payoutRow.meta = { ...(r.payoutRow.meta ?? {}), multiplier: payout / r.wager };
    }
  };
  for (const spec of MACHINES) {
    const list = byMachine.get(spec.key) ?? [];
    if (list.length < 30) continue;
    const k = configuredRtp(spec.key);
    const wagered = list.reduce((s, r) => s + r.wager, 0);
    const sd = Math.sqrt(list.reduce((s, r) => s + (r.payout - k * r.wager) ** 2, 0)) / wagered;
    const target = spec.off ? k + spec.off : k + clamp((rnd() * 2 - 1) * 1.1 * sd, -0.015, 0.015);
    let residual = Math.round(target * wagered) - list.reduce((s, r) => s + r.payout, 0);
    const wins = list.filter((r) => r.payout > 0);
    const original = new Map(wins.map((r) => [r.id, r.payout]));
    for (let guard = 0; residual !== 0 && wins.length > 0 && guard < 60; guard += 1) {
      for (const r of shuffle([...wins])) {
        if (residual === 0) break;
        if (residual > 0) {
          setPayout(r, r.payout + 1);
          residual -= 1;
        } else if (r.payout >= 2) {
          setPayout(r, r.payout - 1);
          residual += 1;
        }
      }
    }
    // A cut payout must not leave a balance negative at a later bet: put a
    // player's rounds back as they were when it would.
    for (const user of new Set(wins.filter((r) => r.payout < (original.get(r.id) ?? 0)).map((r) => r.user))) {
      if (staysAboveZero(user)) continue;
      for (const r of wins) if (r.user === user) setPayout(r, original.get(r.id) ?? r.payout);
    }
  }

  // Balances in order, per user, for both ledgers.
  const chain = (rows: LedgerRow[], label: string) => {
    const byUser = new Map<string, LedgerRow[]>();
    for (const row of rows) {
      const list = byUser.get(row.user) ?? [];
      list.push(row);
      byUser.set(row.user, list);
    }
    const finals = new Map<string, number>();
    for (const [user, list] of byUser) {
      list.sort((a, b) => a.ts - b.ts || a.id.localeCompare(b.id));
      let bal = 0;
      for (const row of list) {
        bal += row.amount;
        if (bal < 0) throw new Error(`seed: ${label} balance for ${user} went to ${bal} at ${row.type}`);
        row.bal = bal;
      }
      finals.set(user, bal);
    }
    return finals;
  };
  const creditFinals = chain(ledger, 'credits');
  const storeFinals = chain(storeLedger, 'store credits');

  for (const spec of MACHINES) {
    const list = byMachine.get(spec.key) ?? [];
    if (list.length < 30) continue;
    const k = configuredRtp(spec.key);
    const w = list.reduce((s, r) => s + r.wager, 0);
    const p = list.reduce((s, r) => s + r.payout, 0);
    const z = machineZ({
      rounds: list.length,
      wagered: w,
      paid: p,
      sumW2: list.reduce((s, r) => s + r.wager * r.wager, 0),
      sumP2: list.reduce((s, r) => s + r.payout * r.payout, 0),
      sumWP: list.reduce((s, r) => s + r.wager * r.payout, 0),
      rtp: k,
    });
    machineNotes.push(`${spec.key} ${list.length} rounds, rtp ${(p / w).toFixed(4)} vs ${k.toFixed(4)}, z ${z === null ? 'n/a' : z.toFixed(2)}`);
  }

  // Achievements.
  const catalogAch = ACHIEVEMENTS.filter((a) => !isRetiredAchievement(a));
  const achievementRows: (string | number | boolean)[][] = [];
  for (const u of accounts) {
    if (u.runs < 3) continue;
    const n = Math.min(catalogAch.length, Math.floor((u.runs / 14) * (0.5 + rnd())));
    const chosen = catalogAch
      .map((a, idx) => ({ a, score: rnd() / (1 + idx / 25) }))
      .sort((x, y) => y.score - x.score)
      .slice(0, n);
    for (const { a } of chosen) {
      const at = u.created + Math.floor(rnd() * Math.max(HOUR, u.lastActive - u.created));
      achievementRows.push([u.id, a.id, a.tier, at, a.xp, true]);
    }
  }

  // Anti-cheat, bans and suspensions.
  const flagGames = ['flappy-bird', 'snake'];
  const REASONS = ['Automation framework detected', 'Suspicious timer drift (1.184)', 'Extreme timer drift (1.842)', 'High score interval too short (48ms < 80ms)', 'Average reaction mismatch (212ms vs 164ms)'];
  const cheatRows: (string | number | null)[][] = [];
  const active = accounts.filter((u) => u.runs > 5);
  for (let d = 0; d < 14; d += 1) {
    const n = int(2, 8);
    for (let j = 0; j < n; j += 1) {
      const u = pick(active);
      const ts = TODAY0 - d * DAY + int(0, 23) * HOUR + int(0, 59) * MIN;
      if (ts >= NOW || ts < u.created) continue;
      const reject = rnd() < 0.3;
      cheatRows.push([nid('ac'), dateKey(ts), ts, rnd() < 0.8 ? pick(flagGames) : pick(['2048', 'stack', 'skee-ball', 'ricochet']), u.id, u.name, reject ? int(5000, 90000) : int(300, 4000), null, reject ? 'reject' : 'flag', reject ? 'reject' : 'flag', pick(REASONS), reject ? 'reject' : 'flag', '[]']);
    }
  }
  for (let j = 0; j < 14; j += 1) {
    const u = pick(active);
    const ts = TODAY0 - int(15, DAYS - 1) * DAY + int(0, 23) * HOUR;
    if (ts < u.created) continue;
    cheatRows.push([nid('ac'), dateKey(ts), ts, pick(flagGames), u.id, u.name, int(300, 4000), null, 'flag', 'flag', pick(REASONS), 'flag', '[]']);
  }
  const bannable = shuffle(active.filter((u) => u.runs > 20)).slice(0, 7);
  const banRows: (string | number | boolean | null)[][] = [];
  bannable.slice(0, 3).forEach((u, i) => {
    banRows.push([u.id, NOW - int(1, 20) * DAY, i === 0 ? null : NOW + int(2, 20) * DAY, i === 0, pick(REASONS), 'seed-admin']);
  });
  bannable.slice(3, 5).forEach((u) => {
    const at = NOW - int(20, 60) * DAY;
    banRows.push([u.id, at, at + 7 * DAY, false, pick(REASONS), 'seed-admin']);
  });
  const suspended = bannable.slice(5, 7);

  // Write it all.
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const nowMs = Date.now();
    await bulk(client, 'arcade_accounts', [['id', 'text'], ['email', 'text'], ['email_normalized', 'text'], ['username', 'text'], ['username_normalized', 'text'], ['image_url', 'text'], ['status', 'text'], ['metadata_json', 'text'], ['created_at', 'bigint'], ['updated_at', 'bigint'], ['last_login_at', 'bigint']],
      accounts.map((u) => [u.id, u.email, u.email, u.name, u.name.toLowerCase(), null, 'active', '{"seed":true}', u.created, u.lastActive, u.lastActive]));
    await bulk(client, 'arcade_account_roles', [['user_id', 'text'], ['role', 'text'], ['granted_at', 'bigint'], ['granted_by', 'text']], accounts.map((u) => [u.id, 'player', u.created, null]), 'ON CONFLICT DO NOTHING');

    await bulk(client, 'game_time_metrics_daily', [['user_id', 'text'], ['game_type', 'text'], ['date_key', 'text'], ['duration_ms', 'bigint'], ['run_count', 'integer'], ['first_played_at', 'bigint'], ['last_played_at', 'bigint']],
      [...timeMetrics.values()].map((r) => [r.user, r.game, r.day, r.ms, r.runs, r.first, r.last]), 'ON CONFLICT DO NOTHING');
    await bulk(client, 'game_score_events', [['id', 'text'], ['game_slug', 'text'], ['od_user_id', 'text'], ['user_name', 'text'], ['score', 'float8'], ['created_at', 'bigint'], ['mode', 'text']], scoreEvents);
    await bulk(client, 'currency_ledger', [['id', 'text'], ['user_id', 'text'], ['currency_type', 'text'], ['amount', 'integer'], ['balance_after', 'integer'], ['source_type', 'text'], ['source_id', 'text'], ['meta_json', 'text'], ['created_at', 'bigint']],
      ledger.map((r) => [r.id, r.user, 'credits', r.amount, r.bal, r.type, r.sid, r.meta ? JSON.stringify(r.meta) : null, r.ts]));
    await bulk(client, 'store_credit_ledger', [['id', 'text'], ['user_id', 'text'], ['amount', 'integer'], ['balance_after', 'integer'], ['source_type', 'text'], ['source_id', 'text'], ['meta_json', 'text'], ['created_at', 'bigint']],
      storeLedger.map((r) => [r.id, r.user, r.amount, r.bal, r.type, r.sid, r.meta ? JSON.stringify(r.meta) : null, r.ts]));
    await bulk(client, 'wallets', [['user_id', 'text'], ['credits', 'integer'], ['wupiupi', 'integer'], ['updated_at', 'bigint'], ['store_credits', 'integer']],
      accounts.map((u) => [u.id, creditFinals.get(u.id) ?? 0, 0, u.lastActive, storeFinals.get(u.id) ?? 0]), 'ON CONFLICT (user_id) DO UPDATE SET credits = EXCLUDED.credits, store_credits = EXCLUDED.store_credits, updated_at = EXCLUDED.updated_at');
    await bulk(client, 'game_daily_earnings', [['user_id', 'text'], ['game_type', 'text'], ['date_key', 'text'], ['earned_credits', 'integer']],
      [...earnings.entries()].map(([key, earned]) => {
        const [user, game, day] = key.split('|') as [string, string, string];
        return [user, game, day, earned];
      }));
    await bulk(client, 'arcade_round_history', [['id', 'text'], ['user_id', 'text'], ['user_name', 'text'], ['game_type', 'text'], ['wager_amount', 'integer'], ['payout_amount', 'integer'], ['multiplier', 'float8'], ['seed', 'bigint'], ['created_at', 'bigint']],
      rounds.map((r) => [r.id, r.user, r.name, r.game, r.wager, r.payout, r.wager > 0 ? r.payout / r.wager : 0, r.seed, r.ts]));
    await bulk(client, 'product_analytics_events', [['id', 'text'], ['event_name', 'text'], ['session_hash', 'text'], ['is_authenticated', 'boolean'], ['path', 'text'], ['game_slug', 'text'], ['source', 'text'], ['created_at', 'bigint'], ['actor_hash', 'text']], analytics);

    await bulk(client, 'chess_matches', [['id', 'text'], ['player1_id', 'text'], ['player1_name', 'text'], ['invited_user_id', 'text'], ['player2_id', 'text'], ['player2_name', 'text'], ['white_id', 'text'], ['black_id', 'text'], ['status', 'text'], ['current_turn', 'text'], ['time_format', 'text'], ['initial_time_ms', 'bigint'], ['increment_ms', 'bigint'], ['white_time_ms', 'bigint'], ['black_time_ms', 'bigint'], ['fen', 'text'], ['ply', 'integer'], ['move_count', 'integer'], ['result', 'text'], ['winner_id', 'text'], ['loser_id', 'text'], ['win_reason', 'text'], ['created_at', 'bigint'], ['updated_at', 'bigint'], ['completed_at', 'bigint']], chessRows);
    await bulk(client, 'connect_four_matches', [['id', 'text'], ['player1_id', 'text'], ['player1_name', 'text'], ['invited_user_id', 'text'], ['player2_id', 'text'], ['player2_name', 'text'], ['white_id', 'text'], ['black_id', 'text'], ['status', 'text'], ['current_turn', 'text'], ['board', 'text'], ['ply', 'integer'], ['move_count', 'integer'], ['result', 'text'], ['winner_id', 'text'], ['loser_id', 'text'], ['win_reason', 'text'], ['created_at', 'bigint'], ['updated_at', 'bigint'], ['completed_at', 'bigint']], connectRows);
    await bulk(client, 'pool_matches', [['id', 'text'], ['player1_id', 'text'], ['player1_name', 'text'], ['invited_user_id', 'text'], ['player2_id', 'text'], ['player2_name', 'text'], ['status', 'text'], ['current_turn', 'text'], ['phase', 'text'], ['balls_json', 'text'], ['winner_id', 'text'], ['loser_id', 'text'], ['win_reason', 'text'], ['move_count', 'integer'], ['created_at', 'bigint'], ['updated_at', 'bigint'], ['completed_at', 'bigint']], poolRows);

    await bulk(client, 'user_owned_items', [['user_id', 'text'], ['item_id', 'text'], ['acquired_at', 'bigint'], ['acquired_source', 'text']], owned, 'ON CONFLICT DO NOTHING');
    await bulk(client, 'ticket_purchases', [['id', 'text'], ['user_id', 'text'], ['pack_id', 'text'], ['tickets_granted', 'integer'], ['amount_total', 'integer'], ['currency', 'text'], ['status', 'text'], ['stripe_session_id', 'text'], ['stripe_payment_intent_id', 'text'], ['created_at', 'bigint'], ['updated_at', 'bigint'], ['fulfilled_at', 'bigint'], ['reversed_at', 'bigint'], ['reversal_status', 'text']], purchases);

    await bulk(client, 'user_account_xp', [['user_id', 'text'], ['xp', 'bigint'], ['updated_at', 'bigint'], ['level_floor', 'integer']],
      accounts.filter((u) => u.xp > 0).map((u) => [u.id, u.xp, u.lastActive, 1]), 'ON CONFLICT (user_id) DO UPDATE SET xp = EXCLUDED.xp, updated_at = EXCLUDED.updated_at');
    await bulk(client, 'user_level_reward_claims', [['user_id', 'text'], ['level', 'integer'], ['tickets', 'integer'], ['claimed_at', 'bigint']], levelClaims, 'ON CONFLICT DO NOTHING');
    await bulk(client, 'user_season_progress', [['user_id', 'text'], ['season_key', 'text'], ['xp', 'integer'], ['premium', 'boolean'], ['updated_at', 'bigint']],
      accounts.filter((u) => u.sxp > 0).map((u) => [u.id, season.key, u.sxp, u.premium, u.lastActive]), 'ON CONFLICT (user_id, season_key) DO UPDATE SET xp = EXCLUDED.xp, premium = EXCLUDED.premium, updated_at = EXCLUDED.updated_at');
    await bulk(client, 'user_daily_quests', [['user_id', 'text'], ['date_key', 'text'], ['slot_index', 'integer'], ['quest_key', 'text'], ['kind', 'text'], ['target_game', 'text'], ['goal', 'integer'], ['progress', 'integer'], ['reward_xp', 'integer'], ['claimed', 'boolean'], ['created_at', 'bigint'], ['reward_tickets', 'integer'], ['closed_at', 'bigint']], dailyQuests, 'ON CONFLICT DO NOTHING');
    await bulk(client, 'user_quest_day', [['user_id', 'text'], ['date_key', 'text'], ['rerolls_used', 'integer']], questDays, 'ON CONFLICT DO NOTHING');
    await bulk(client, 'user_weekly_quests', [['user_id', 'text'], ['week', 'integer'], ['slot_index', 'integer'], ['quest_key', 'text'], ['kind', 'text'], ['target_game', 'text'], ['goal', 'integer'], ['progress', 'integer'], ['reward_xp', 'integer'], ['reward_tickets', 'integer'], ['claimed', 'boolean'], ['created_at', 'bigint'], ['closed_at', 'bigint']], weeklyQuests, 'ON CONFLICT DO NOTHING');
    await bulk(client, 'user_season_quests', [['user_id', 'text'], ['season_key', 'text'], ['slot_index', 'integer'], ['quest_key', 'text'], ['kind', 'text'], ['target_game', 'text'], ['goal', 'integer'], ['progress', 'integer'], ['reward_xp', 'integer'], ['reward_tickets', 'integer'], ['claimed', 'boolean'], ['created_at', 'bigint'], ['closed_at', 'bigint']], seasonQuests, 'ON CONFLICT DO NOTHING');
    await bulk(client, 'user_achievements', [['user_id', 'text'], ['achievement_id', 'text'], ['tier', 'integer'], ['unlocked_at', 'bigint'], ['xp_awarded', 'integer'], ['seen', 'boolean']], achievementRows, 'ON CONFLICT DO NOTHING');
    await client.query(
      `INSERT INTO achievement_unlock_counts (achievement_id, count)
       SELECT achievement_id, COUNT(*) FROM user_achievements GROUP BY achievement_id
       ON CONFLICT (achievement_id) DO UPDATE SET count = EXCLUDED.count`,
    );

    await bulk(client, 'anti_cheat_logs', [['id', 'text'], ['date_key', 'text'], ['ts', 'bigint'], ['game_type', 'text'], ['user_id', 'text'], ['user_name', 'text'], ['score', 'float8'], ['mode_sec', 'integer'], ['result', 'text'], ['severity', 'text'], ['reason', 'text'], ['stage', 'text'], ['checks_json', 'text']], cheatRows);
    await bulk(client, 'game_bans', [['user_id', 'text'], ['banned_at', 'bigint'], ['banned_until', 'bigint'], ['is_indefinite', 'boolean'], ['reason', 'text'], ['banned_by', 'text']], banRows, 'ON CONFLICT (user_id) DO NOTHING');
    await client.query(`UPDATE arcade_accounts SET status = 'suspended', updated_at = $2 WHERE id = ANY($1::text[])`, [suspended.map((u) => u.id), nowMs]);

    await writeLive(client, accounts.map((u) => ({ id: u.id, name: u.name })));
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  // The two demo logins, after the cast so neither is the first account.
  const admin = await createAccount({ email: 'radm-admin@example.com', password: 'RadmAdmin!2026', username: 'radm-admin', metadata: { seed: true }, roles: ['admin'] });
  const player = await createAccount({ email: 'radm-player@example.com', password: 'RadmPlayer!2026', username: 'radm-player', metadata: { seed: true } });
  await pool.query(`DELETE FROM arcade_account_roles WHERE user_id = $1 AND role = 'admin'`, [player.id]);
  void admin;

  const rolled = await runRollup({ days: 120 });

  const counts = await pool.query<Record<string, string>>(
    `SELECT
       (SELECT COUNT(*) FROM arcade_accounts WHERE id LIKE 'seed-%' OR metadata_json LIKE '%"seed":true%') AS accounts,
       (SELECT COUNT(DISTINCT user_id) FROM game_time_metrics_daily WHERE user_id LIKE 'guest:5eed%') AS guests,
       (SELECT COUNT(*) FROM game_score_events WHERE id LIKE 'seed-%') AS runs,
       (SELECT COUNT(*) FROM arcade_round_history WHERE id LIKE 'seed-%') AS rounds,
       (SELECT COUNT(*) FROM currency_ledger WHERE id LIKE 'seed-%') AS ledger,
       (SELECT COALESCE(SUM(credits), 0) FROM wallets WHERE user_id LIKE 'seed-%') AS supply,
       (SELECT COUNT(*) FROM product_analytics_events WHERE id LIKE 'seed-%') AS events`,
  );
  const c = counts.rows[0] ?? {};
  const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(
    `Seeded ${c.accounts} accounts (${PLAYERS} players plus the two demo logins) and ${c.guests} guests over ${DAYS} days: ` +
      `${c.runs} runs, ${c.rounds} machine rounds, ${c.ledger} ticket ledger rows (${Number(c.supply).toLocaleString('en-US')} tickets held), ` +
      `${purchases.length} pack purchases, ${owned.length} counter items, ${achievementRows.length} achievements, ${cheatRows.length} anti-cheat rows, ` +
      `${banRows.length} bans, ${c.events} analytics events. Rolled up ${rolled.days} days in ${(rolled.durationMs / 1000).toFixed(1)} s; ` +
      `total ${seconds} s. Sign in as radm-admin@example.com / RadmAdmin!2026.`,
  );
  if (flag('verbose')) console.log(machineNotes.join('\n'));
}

try {
  await main();
} finally {
  await pool.end();
}
