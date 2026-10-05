// ---------------------------------------------------------------------------
// Daily Ticket claim: one spin of the daily wheel a day (DAILY_WHEEL.md). The
// server draws a unit with a CSPRNG; the slot's value times the streak day's
// multiplier (1, 1, 2, 2, 3, 4, 8, repeating) is the payout, so each day's
// expected payout is the old 7-day ladder's (25, 25, 50, 50, 75, 100, 200).
// The streak counts consecutive days.
//
// A player on a streak from the old work-day claim keeps their current amount
// until the streak breaks: the claim pays the larger of the ladder and the
// held amount, and the hold carries from claim to claim in `hold_tickets`.
// Old rows (ladder = false) are bridged over the days off the old rules had
// (federal holidays and admin blackouts), so a streak across one still counts.
// ---------------------------------------------------------------------------

import {
  DAILY_CLAIM_LADDER,
  DAILY_CLAIM_LADDER_DAYS,
  DAILY_CLAIM_LEGACY_BASE_CREDITS,
  DAILY_CLAIM_LEGACY_BONUS_PER_DAY,
  DAILY_CLAIM_LEGACY_MAX_BONUS_DAYS,
} from '@/features/arcade/lib/rewards';
import { randomInt } from 'node:crypto';

import {
  DAILY_WHEEL_TOP,
  DAILY_WHEEL_UNITS,
  DAILY_WHEEL_VERSION,
  isWheelUnit,
  wheelLadderDay,
  wheelMultiplier,
  wheelPayout,
  wheelSegmentForUnit,
} from '@/features/arcade/lib/daily-wheel';
import { queryOne, withTransaction } from '@/server/db/client';
import { isPuzzleDayWithBlackouts } from '../connections-calendar';
import { getServerDateKey } from './helpers';
import type {
  DailyClaimResult,
  DailyClaimReward,
  DailyClaimStatus,
  DailyClaimWheel,
  DailyClaimWheelStatus,
} from './types';
import { mutateWalletAndLedgerForTransaction } from './wallet';

type ClaimRow = {
  user_id: string;
  date_key: string;
  streak: number | string;
  credits_awarded: number | string;
  legacy_awarded: number | string;
  is_milestone: boolean | number | string;
  claimed_at: number | string;
  hold_tickets: number | string;
  wheel_unit: number | string | null;
  wheel_value: number | string | null;
  wheel_multiplier: number | string | null;
  wheel_version: number | string | null;
};

const normalizeBoolean = (value: boolean | number | string) =>
  value === true || value === 1 || value === '1' || value === 'true';

const toClaimReward = ({
  tickets,
  streak,
  isMilestone,
}: {
  tickets: number;
  streak: number;
  isMilestone: boolean;
}): DailyClaimReward => ({
  tickets,
  credits: tickets,
  streak,
  isMilestone,
});

/** What the ladder pays on streak day `streak` (1-based, repeating). */
export const ladderTickets = (streak: number) =>
  DAILY_CLAIM_LADDER[(Math.max(1, Math.floor(streak)) - 1) % DAILY_CLAIM_LADDER_DAYS]!;

/** What the old work-day claim paid on `streak`, before its milestone bonus. */
export const legacyClaimTickets = (streak: number) =>
  DAILY_CLAIM_LEGACY_BASE_CREDITS +
  Math.min(Math.max(1, Math.floor(streak)) - 1, DAILY_CLAIM_LEGACY_MAX_BONUS_DAYS - 1) *
    DAILY_CLAIM_LEGACY_BONUS_PER_DAY;

/** A streak day's expected payout (the ladder, the spin's mean) with the
 *  hold as a floor, and whether it is the ladder's big day. What a spin
 *  pays is wheelPayout's. */
export function calculateDailyClaimReward(streakAfterClaim: number, hold = 0) {
  const safeStreak = Math.max(1, Math.floor(streakAfterClaim));
  return {
    tickets: Math.max(ladderTickets(safeStreak), Math.max(0, Math.floor(hold))),
    // The last day of the ladder is the big one.
    isMilestone: safeStreak % DAILY_CLAIM_LADDER_DAYS === 0,
  };
}

/** The wheel before a spin on streak day `streakDay`. */
function wheelStatus(streakDay: number, spin: DailyClaimWheel | null): DailyClaimWheelStatus {
  const multiplier = spin?.multiplier ?? wheelMultiplier(streakDay);
  return { ladderDay: wheelLadderDay(streakDay), multiplier, top: DAILY_WHEEL_TOP * multiplier, spin };
}

/** The spin a claim row recorded; null for a flat claim from before the wheel. */
function spinFromRow(row: ClaimRow): DailyClaimWheel | null {
  const unit = row.wheel_unit === null ? null : Number(row.wheel_unit);
  if (unit === null || !isWheelUnit(unit) || Number(row.wheel_version) !== DAILY_WHEEL_VERSION) return null;
  const value = Number(row.wheel_value ?? wheelSegmentForUnit(unit).value);
  const multiplier = Number(row.wheel_multiplier ?? 1);
  return {
    version: DAILY_WHEEL_VERSION,
    unit,
    segment: wheelSegmentForUnit(unit).index,
    value,
    multiplier,
    held: Number(row.credits_awarded ?? 0) > value * multiplier,
  };
}

/** The server's draw: a uniform unit from a CSPRNG. */
export const drawWheelUnit = () => randomInt(0, DAILY_WHEEL_UNITS);

const isUniqueViolation = (error: unknown) =>
  typeof error === 'object' && error !== null && 'code' in error && (error as { code?: string }).code === '23505';

async function getClaimForDate(userId: string, dateKey: string) {
  return queryOne<ClaimRow>(
    `SELECT user_id, date_key, streak, credits_awarded, beskar_awarded AS legacy_awarded, is_milestone, claimed_at, hold_tickets,
            wheel_unit, wheel_value, wheel_multiplier, wheel_version
     FROM daily_credit_claims
     WHERE user_id = $1 AND date_key = $2
     LIMIT 1`,
    [userId, dateKey],
  );
}

const shiftDateKey = (dateKey: string, days: number) => {
  const [year, month, day] = dateKey.split('-').map(Number);
  return getServerDateKey(new Date(year!, month! - 1, day! + days));
};

/** How far back an old work-day streak is bridged over days off. */
const LEGACY_BRIDGE_MAX_DAYS = 10;

/** Old rules: the streak lives while no work day was missed since `lastKey`. */
async function legacyStreakAlive(lastKey: string, todayKey: string) {
  for (let i = 1; i <= LEGACY_BRIDGE_MAX_DAYS; i += 1) {
    const dateKey = shiftDateKey(lastKey, i);
    if (dateKey >= todayKey) return true;
    if (await isPuzzleDayWithBlackouts(dateKey)) return false;
  }
  return false;
}

/**
 * The streak a player brings to `todayKey` (0 when it has broken) and the
 * amount they hold from before the ladder (0 for no hold).
 */
export async function resolvePriorStreak(
  userId: string,
  todayKey: string,
): Promise<{ streak: number; hold: number }> {
  const last = await queryOne<{
    date_key: string;
    streak: number | string;
    ladder: boolean;
    hold_tickets: number | string;
  }>(
    `SELECT date_key, streak, ladder, hold_tickets
     FROM daily_credit_claims
     WHERE user_id = $1 AND date_key < $2
     ORDER BY date_key DESC
     LIMIT 1`,
    [userId, todayKey],
  );
  if (!last) return { streak: 0, hold: 0 };
  const streak = Number(last.streak ?? 0);
  const continues =
    last.date_key === shiftDateKey(todayKey, -1) ||
    (!last.ladder && (await legacyStreakAlive(last.date_key, todayKey)));
  if (!continues || streak <= 0) return { streak: 0, hold: 0 };
  return {
    streak,
    hold: last.ladder ? Number(last.hold_tickets ?? 0) : legacyClaimTickets(streak + 1),
  };
}

export async function getDailyClaimStatus(
  userId: string,
): Promise<DailyClaimStatus> {
  const todayKey = getServerDateKey();

  const existing = await getClaimForDate(userId, todayKey);
  if (existing) {
    const tickets = Number(existing.credits_awarded ?? 0);
    const streak = Number(existing.streak ?? 0);
    return {
      available: false,
      reason: 'already-claimed',
      detail: null,
      claimed: true,
      claimedReward: toClaimReward({
        tickets,
        streak,
        isMilestone: normalizeBoolean(existing.is_milestone),
      }),
      streak,
      hold: Number(existing.hold_tickets ?? 0),
      todayKey,
      nextReward: null,
      wheel: wheelStatus(streak, spinFromRow(existing)),
    };
  }

  const prior = await resolvePriorStreak(userId, todayKey);
  const nextStreak = prior.streak + 1;
  const reward = calculateDailyClaimReward(nextStreak, prior.hold);

  return {
    available: true,
    reason: null,
    detail: null,
    claimed: false,
    streak: prior.streak,
    hold: prior.hold,
    todayKey,
    nextReward: toClaimReward({
      tickets: reward.tickets,
      streak: nextStreak,
      isMilestone: reward.isMilestone,
    }),
    wheel: wheelStatus(nextStreak, null),
  };
}

export async function claimDailyCredits(
  userId: string,
): Promise<DailyClaimResult> {
  return claimDailyCreditsForDate(userId, getServerDateKey());
}

/**
 * The spin for a given day key; the route always passes today's. `drawUnit`
 * is the draw (tests pass a fixed one); by default the server's CSPRNG.
 */
export async function claimDailyCreditsForDate(
  userId: string,
  todayKey: string,
  options: { drawUnit?: () => number } = {},
): Promise<DailyClaimResult> {
  try {
    return await spinForDate(userId, todayKey, options.drawUnit ?? drawWheelUnit);
  } catch (error) {
    // Two spins at once: the primary key lets one row in.
    if (isUniqueViolation(error)) throw new Error('Already claimed today.');
    throw error;
  }
}

async function spinForDate(
  userId: string,
  todayKey: string,
  drawUnit: () => number,
): Promise<DailyClaimResult> {
  return withTransaction(async (client) => {

    const existing = await client.query<ClaimRow>(
      `SELECT user_id
       FROM daily_credit_claims
       WHERE user_id = $1 AND date_key = $2
       LIMIT 1
       FOR UPDATE`,
      [userId, todayKey],
    );
    if (existing.rows[0]) {
      throw new Error('Already claimed today.');
    }

    const prior = await resolvePriorStreak(userId, todayKey);
    const newStreak = prior.streak + 1;
    const unit = drawUnit();
    if (!isWheelUnit(unit)) throw new Error('The wheel drew no unit.');
    const spin = wheelPayout(unit, newStreak, prior.hold);
    const reward = { tickets: spin.tickets, isMilestone: calculateDailyClaimReward(newStreak).isMilestone };
    const wheel: DailyClaimWheel = {
      version: DAILY_WHEEL_VERSION,
      unit,
      segment: spin.segment,
      value: spin.value,
      multiplier: spin.multiplier,
      held: spin.held,
    };
    const now = Date.now();

    const ticketLedger = await mutateWalletAndLedgerForTransaction(client, {
      userId,
      currencyType: 'credits',
      amount: reward.tickets,
      sourceType: 'daily_claim',
      sourceId: `daily-claim:${todayKey}:tickets`,
      meta: {
        dateKey: todayKey,
        streak: newStreak,
        isMilestone: reward.isMilestone,
        displayCurrency: 'tickets',
        wheel,
      },
      createdBy: null,
    });

    await client.query(
      `INSERT INTO daily_credit_claims
         (user_id, date_key, streak, credits_awarded, beskar_awarded, is_milestone, claimed_at, ladder, hold_tickets,
          wheel_unit, wheel_value, wheel_multiplier, wheel_version)
       VALUES ($1, $2, $3, $4, 0, $5, $6, TRUE, $7, $8, $9, $10, $11)`,
      [
        userId,
        todayKey,
        newStreak,
        reward.tickets,
        reward.isMilestone,
        now,
        prior.hold,
        wheel.unit,
        wheel.value,
        wheel.multiplier,
        wheel.version,
      ],
    );

    return {
      dateKey: todayKey,
      streak: newStreak,
      ticketsAwarded: reward.tickets,
      creditsAwarded: reward.tickets,
      isMilestone: reward.isMilestone,
      wheel,
      balanceAfter: {
        tickets: ticketLedger.balanceAfter,
        credits: ticketLedger.balanceAfter,
      },
    };
  });
}
