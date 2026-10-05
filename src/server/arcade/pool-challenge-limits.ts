// Thin binding over the generic challenge-limits module (game type = '8-ball').
// The shared logic + storage now live in @/server/social/challenge-limits.
import {
  checkChallengeSendAllowed,
  clearChallengeDenials,
  recordChallengeDenied,
  recordChallengeSend,
  type ChallengeSendAllowed,
} from '@/server/social/challenge-limits';

export type { ChallengeSendAllowed };

const GAME_TYPE = '8-ball';

export const checkPoolChallengeSendAllowed = (args: {
  senderUserId: string;
  targetUserId: string;
  now?: number;
}) => checkChallengeSendAllowed({ gameType: GAME_TYPE, ...args });

export const recordPoolChallengeSend = (args: { senderUserId: string; now?: number }) =>
  recordChallengeSend({ gameType: GAME_TYPE, ...args });

export const recordPoolChallengeDenied = (args: {
  senderUserId: string;
  targetUserId: string;
  now?: number;
}) => recordChallengeDenied({ gameType: GAME_TYPE, ...args });

export const clearPoolChallengeDenials = (args: { senderUserId: string; targetUserId: string }) =>
  clearChallengeDenials({ gameType: GAME_TYPE, ...args });
