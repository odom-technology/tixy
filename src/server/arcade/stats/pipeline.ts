// Orchestration: apply stat deltas, layer the cross-cutting global rollups
// (games / playtime / tickets / play-streak / distinct-games), then evaluate
// achievements over exactly the keys that changed. Best-effort by design — a
// failure here must never break a score save, daily claim, or match settle, so
// every public entrypoint swallows its own errors.
import { getServerDateKey } from "@/server/arcade/rewards/helpers";
import { queryOne } from "@/server/db/client";
import type { GameRewardContext } from "@/server/arcade/rewards/types";
import type { UnlockResult } from "@/server/arcade/achievements/types";
import { applyStatDeltas, getUserStats } from "./record";
import {
  statDeltasForRun,
  isResultGame,
  isDailyGame,
  type RunExtra,
} from "./deltas";
import {
  add,
  max,
  set,
  secretStat,
  playedFlag,
  GLOBAL,
  MP,
  DAILY,
  type StatDelta,
} from "./stat-keys";

/** A palindrome needs 3 digits: 11 and 22 are everyone's first scores. */
export const isPalindrome = (n: number) => {
  const s = String(n);
  return s.length >= 3 && s === [...s].reverse().join("");
};

/** The hour and date secrets. A game of any kind counts, a machine round too. */
export function timeSecretDeltas(now: Date): StatDelta[] {
  const out: StatDelta[] = [];
  const hour = now.getHours();
  if (hour === 3) out.push(add(secretStat("night_owl"), 1));
  if (hour === 5) out.push(add(secretStat("early_bird"), 1));
  if (now.getMonth() === 0 && now.getDate() === 1)
    out.push(add(secretStat("newyear"), 1));
  return out;
}

/** The number secrets by lifetime count: Elite at 13 hours 37 minutes of play
 *  and Sweet, Sweet Pi at the 314th game. Each fires once, on the call that
 *  crosses the line, so a score of 1337 or 314 and the count both feed the
 *  same trigger. */
export const LEET_PLAYTIME_MS = (13 * 60 + 37) * 60_000;
export const PI_GAMES = 314;

export function milestoneSecretDeltas(
  prior: Map<string, number>,
  added: { games: number; playtimeMs: number },
): StatDelta[] {
  const out: StatDelta[] = [];
  const games = prior.get(GLOBAL.games) ?? 0;
  const playtime = prior.get(GLOBAL.playtimeMs) ?? 0;
  if (games < PI_GAMES && games + added.games >= PI_GAMES)
    out.push(add(secretStat("pi"), 1));
  if (playtime < LEET_PLAYTIME_MS && playtime + added.playtimeMs >= LEET_PLAYTIME_MS)
    out.push(add(secretStat("leet"), 1));
  return out;
}

/**
 * Server-detected secret triggers for a run — unspoofable, unlike the client
 * easter-egg endpoint. Covers score-shape secrets and the time secrets that
 * should only fire on an actual play.
 */
export function secretRunDeltas(
  context: { gameType: string } & Record<string, unknown>,
  now: Date,
): StatDelta[] {
  const out: StatDelta[] = [];
  const score = typeof context.score === "number" ? context.score : undefined;
  if (score !== undefined) {
    if (score === 0) out.push(add(secretStat("humble"), 1));
    if (score === 1337) out.push(add(secretStat("leet"), 1));
    if (score === 314) out.push(add(secretStat("pi"), 1));
    if (isPalindrome(score)) out.push(add(secretStat("palindrome"), 1));
  }
  out.push(...timeSecretDeltas(now));
  return out;
}

/** "One More Game": the 20th game of a calendar day. Counts skill runs, matches and wagers. */
function marathonDeltas(
  prior: Map<string, number>,
  todayInt: number,
): StatDelta[] {
  const sameDay = prior.get(GLOBAL.gamesTodayDate) === todayInt;
  const gamesToday = (sameDay ? (prior.get(GLOBAL.gamesToday) ?? 0) : 0) + 1;
  const out = [
    set(GLOBAL.gamesTodayDate, todayInt),
    set(GLOBAL.gamesToday, gamesToday),
  ];
  if (gamesToday >= 20) out.push(set(secretStat("marathon"), 20));
  return out;
}

/** "Many Happy Returns": a run on the month and day the account was made, in a later year. */
async function birthdayDeltas(userId: string, now: Date): Promise<StatDelta[]> {
  const row = await queryOne<{ created_at: string | number }>(
    "SELECT created_at FROM arcade_accounts WHERE id = $1",
    [userId],
  );
  if (!row) return [];
  const created = new Date(Number(row.created_at));
  const anniversary =
    created.getFullYear() < now.getFullYear() &&
    created.getMonth() === now.getMonth() &&
    created.getDate() === now.getDate();
  return anniversary ? [add(secretStat("birthday"), 1)] : [];
}

const dateKeyToInt = (key: string) => Number(key.replace(/-/g, ""));

const yesterdayInt = (today: Date): number => {
  const y = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate() - 1,
  );
  return dateKeyToInt(getServerDateKey(y));
};

/**
 * Apply a batch of stat deltas (non-run events: level-up, purchase, wager,
 * secret trigger) and evaluate the achievements those keys feed. Returns any
 * newly-unlocked achievements for toasting.
 */
export async function recordStats(
  userId: string,
  deltas: StatDelta[],
): Promise<UnlockResult[]> {
  try {
    const changed = await applyStatDeltas(userId, deltas);
    return await evaluate(userId, changed);
  } catch (error) {
    console.error("[stats] recordStats failed:", error);
    return [];
  }
}

/** Lurker: opening 100 different players' profiles. */
export const LURKER_PROFILES = 100;

/**
 * Count a signed-in player opening another player's profile, once per profile.
 * Opening the same page again, or refreshing it, adds nothing. The seen marks
 * stop once the 100th profile is counted.
 */
export async function recordProfileView(
  viewerId: string,
  profileId: string,
): Promise<UnlockResult[]> {
  if (!viewerId || !profileId || viewerId === profileId) return [];
  try {
    const lurker = secretStat("lurker");
    const prior = await getUserStats(viewerId, [lurker]);
    if ((prior.get(lurker) ?? 0) >= LURKER_PROFILES) return [];
    const seen = secretStat(`lurker_seen.${profileId}`);
    const changed = await applyStatDeltas(viewerId, [set(seen, 1)]);
    if (!changed.has(seen)) return [];
    return await recordStats(viewerId, [add(lurker, 1)]);
  } catch (error) {
    console.error("[stats] recordProfileView failed:", error);
    return [];
  }
}

/**
 * Record one authoritative wager settlement. Wager payouts include the
 * returned stake, so economy achievements advance from positive NET profit,
 * never from the gross wallet credit. This runs after the guarded settlement
 * transaction; failures cannot affect the payout that already committed.
 */
export async function recordWagerSettlementStats(
  userId: string,
  {
    gameType,
    durationMs,
    netProfit,
  }: {
    gameType: string;
    durationMs: number;
    netProfit: number;
  },
): Promise<UnlockResult[]> {
  try {
    const today = new Date();
    const todayInt = dateKeyToInt(getServerDateKey(today));
    const priorToday = await getUserStats(userId, [
      GLOBAL.gamesToday,
      GLOBAL.gamesTodayDate,
      GLOBAL.games,
      GLOBAL.playtimeMs,
    ]);
    const deltas: StatDelta[] = [
      add(GLOBAL.games, 1),
      set(playedFlag(gameType), 1),
      ...marathonDeltas(priorToday, todayInt),
      ...timeSecretDeltas(today),
      ...milestoneSecretDeltas(priorToday, {
        games: 1,
        playtimeMs: durationMs > 0 ? Math.round(durationMs) : 0,
      }),
      ...(await birthdayDeltas(userId, today)),
    ];
    if (durationMs > 0)
      deltas.push(add(GLOBAL.playtimeMs, Math.round(durationMs)));
    if (netProfit > 0) {
      const profit = Math.round(netProfit);
      deltas.push(add(GLOBAL.ticketsEarned, profit));
      deltas.push(max(GLOBAL.biggestWin, profit));
      deltas.push(add(GLOBAL.wagerWon, 1));
    }

    const changed = await applyStatDeltas(userId, deltas);
    if (changed.has(playedFlag(gameType))) {
      const distinctChanged = await applyStatDeltas(userId, [
        add(GLOBAL.distinctGames, 1),
      ]);
      distinctChanged.forEach((key) => changed.add(key));
    }
    return await evaluate(userId, changed);
  } catch (error) {
    console.error("[stats] recordWagerSettlementStats failed:", error);
    return [];
  }
}

/**
 * Record a finished game run: per-game deltas + global rollups + play-streak +
 * first-play distinct tracking, then evaluate. `extra` carries signature
 * metrics not on the context (snake length, tetris lines, 2048 tile, ...).
 */
export async function recordGameRunStats(
  userId: string,
  context: GameRewardContext,
  extra: RunExtra & { durationMs?: number; ticketsEarned?: number } = {},
): Promise<UnlockResult[]> {
  try {
    const slug = context.gameType;
    const deltas = statDeltasForRun(context, extra);

    // Global rollups.
    deltas.push(add(GLOBAL.games, 1));
    if (extra.durationMs && extra.durationMs > 0) {
      deltas.push(add(GLOBAL.playtimeMs, Math.round(extra.durationMs)));
    }
    if (extra.ticketsEarned && extra.ticketsEarned > 0) {
      deltas.push(add(GLOBAL.ticketsEarned, Math.round(extra.ticketsEarned)));
      deltas.push(max(GLOBAL.biggestWin, Math.round(extra.ticketsEarned)));
    }

    // First-play flag (drives distinct-games count below).
    deltas.push(set(playedFlag(slug), 1));

    // Multiplayer win streak (consecutive wins across all elo games).
    if (isResultGame(slug) && "result" in context) {
      if (context.result === "win") {
        const prior = await getUserStats(userId, [MP.winStreak]);
        const next = (prior.get(MP.winStreak) ?? 0) + 1;
        deltas.push(set(MP.winStreak, next));
        deltas.push(max(MP.winStreakBest, next));
      } else {
        deltas.push(set(MP.winStreak, 0));
      }
    }

    // Did this run solve a daily puzzle? (pangram always; connections/word-grid
    // only when context.solved). Drives the daily-puzzle streak below.
    const dailySolved =
      isDailyGame(slug) &&
      (slug === "pangram" || ("solved" in context && context.solved === true));

    // Play-streak (any game) + daily-puzzle streak (solves only): read prior
    // day + streak, advance/reset. Both keyed on the server date.
    const today = new Date();
    const todayInt = dateKeyToInt(getServerDateKey(today));
    const yesterday = yesterdayInt(today);
    const prior = await getUserStats(userId, [
      GLOBAL.lastPlayDate,
      GLOBAL.playStreak,
      DAILY.lastSolveDate,
      DAILY.streak,
      GLOBAL.gamesToday,
      GLOBAL.gamesTodayDate,
      GLOBAL.games,
      GLOBAL.playtimeMs,
    ]);

    const lastDate = prior.get(GLOBAL.lastPlayDate) ?? 0;
    if (lastDate !== todayInt) {
      const next =
        lastDate === yesterday ? (prior.get(GLOBAL.playStreak) ?? 0) + 1 : 1;
      deltas.push(set(GLOBAL.lastPlayDate, todayInt));
      deltas.push(set(GLOBAL.playStreak, next));
      deltas.push(max(GLOBAL.playStreakBest, next));
    }

    if (dailySolved) {
      const lastSolve = prior.get(DAILY.lastSolveDate) ?? 0;
      if (lastSolve !== todayInt) {
        const next =
          lastSolve === yesterday ? (prior.get(DAILY.streak) ?? 0) + 1 : 1;
        deltas.push(set(DAILY.lastSolveDate, todayInt));
        deltas.push(set(DAILY.streak, next));
        deltas.push(max(DAILY.streakBest, next));
      }
    }

    // Server-side secret achievements (unspoofable, fire on a real run).
    deltas.push(...secretRunDeltas(context, today));
    deltas.push(
      ...milestoneSecretDeltas(prior, {
        games: 1,
        playtimeMs: extra.durationMs && extra.durationMs > 0 ? Math.round(extra.durationMs) : 0,
      }),
    );
    deltas.push(...marathonDeltas(prior, todayInt));
    deltas.push(...(await birthdayDeltas(userId, today)));

    const changed = await applyStatDeltas(userId, deltas);

    // First time this game was ever played → bump distinct-games count.
    if (changed.has(playedFlag(slug))) {
      const distinctChanged = await applyStatDeltas(userId, [
        add(GLOBAL.distinctGames, 1),
      ]);
      distinctChanged.forEach((k) => changed.add(k));
    }

    return await evaluate(userId, changed);
  } catch (error) {
    console.error("[stats] recordGameRunStats failed:", error);
    return [];
  }
}

async function evaluate(
  userId: string,
  changedKeys: Set<string>,
): Promise<UnlockResult[]> {
  if (changedKeys.size === 0) return [];
  const { evaluateAchievements } =
    await import("@/server/arcade/achievements/engine");
  return evaluateAchievements(userId, changedKeys);
}
