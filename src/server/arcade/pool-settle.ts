/**
 * What happens after an 8-ball result has committed: tickets, run results
 * and the bot speed-run record. Each payout is its own try, so one failure
 * can't skip the other player's award, the broadcasts or the bracket.
 *
 * Nothing retries a failed payout yet. Tickets are keyed by sourceId
 * (`8ball-win:<match>:<user>`), so a later retry could not pay twice.
 */
import { isGuestUserId } from '@/server/auth/guest';
import { isBotUser } from '@/server/arcade/pool-bot';
import { checkAndUpdateBotRecord, getHumanSpeedRunStats, type BotRecordResult } from '@/server/arcade/pool-elo';
import { recordMatchRunResult, type MatchRunResult } from '@/server/arcade/match-run-results';
import { awardGameRunCredits, type GameRewardResult } from '@/server/arcade/rewards/wallet';
import type { PoolMatch } from '@/server/arcade/pool-match';

export type PoolPayout = { reward: GameRewardResult; runResult: MatchRunResult };

/** Pay both human players of a finished match. Guests and bots get nothing. */
export async function payPoolMatch(
  match: Pick<PoolMatch, 'id' | 'player2Id'>,
  winnerId: string,
  loserId: string,
  winReason: string | null,
): Promise<Map<string, PoolPayout>> {
  const paid = new Map<string, PoolPayout>();
  const isBotMatch = Boolean(match.player2Id && isBotUser(match.player2Id));
  const botDifficulty = isBotMatch
    ? (match.player2Id!.replace('bot:', '') as 'easy' | 'medium' | 'hard')
    : undefined;
  const pay = async (userId: string, result: 'win' | 'loss') => {
    if (isBotUser(userId) || isGuestUserId(userId)) return;
    try {
      const context = { gameType: '8-ball' as const, result, vsBot: isBotMatch, botDifficulty };
      const reward = await awardGameRunCredits({
        userId,
        context,
        sourceId: `8ball-${result}:${match.id}:${userId}`,
        meta: { matchId: match.id, winReason },
      });
      const runResult = await recordMatchRunResult({ matchId: match.id, userId, context, reward });
      paid.set(userId, { reward, runResult });
    } catch (error) {
      console.error(`8-ball ${result} payout failed for match ${match.id}`, error);
    }
  };
  await pay(winnerId, 'win');
  await pay(loserId, 'loss');
  return paid;
}

/** The fewest-turns record against a bot: a person who sank the 8 themselves. */
export async function recordBotSpeedRun(
  match: Pick<PoolMatch, 'id' | 'player2Id'>,
  winnerId: string,
  winnerName: string,
  winReason: string | null,
): Promise<BotRecordResult | null> {
  if (!match.player2Id || !isBotUser(match.player2Id)) return null;
  if (isBotUser(winnerId) || isGuestUserId(winnerId) || winReason !== 'cleared_8ball') return null;
  try {
    const { humanTurns, totalTurnDurationMs } = await getHumanSpeedRunStats(match.id, winnerId);
    return await checkAndUpdateBotRecord(
      winnerId,
      winnerName,
      match.player2Id.replace('bot:', ''),
      humanTurns,
      totalTurnDurationMs,
    );
  } catch (error) {
    console.error(`8-ball speed-run record failed for match ${match.id}`, error);
    return null;
  }
}
