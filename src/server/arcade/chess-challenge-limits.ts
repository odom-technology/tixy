// Thin binding over the generic challenge-limits module (game type = 'chess').
// The shared logic + storage now live in @/server/social/challenge-limits.
import {
  checkChallengeSendAllowed,
  clearChallengeDenials,
  recordChallengeDenied,
  recordChallengeSend,
  type ChallengeSendAllowed,
} from '@/server/social/challenge-limits';

export type { ChallengeSendAllowed };

const GAME_TYPE = 'chess';

export const checkChessChallengeSendAllowed = (args: {
  senderUserId: string;
  targetUserId: string;
  now?: number;
}) => checkChallengeSendAllowed({ gameType: GAME_TYPE, ...args });

export const recordChessChallengeSend = (args: { senderUserId: string; now?: number }) =>
  recordChallengeSend({ gameType: GAME_TYPE, ...args });

export const recordChessChallengeDenied = (args: {
  senderUserId: string;
  targetUserId: string;
  now?: number;
}) => recordChallengeDenied({ gameType: GAME_TYPE, ...args });

export const clearChessChallengeDenials = (args: { senderUserId: string; targetUserId: string }) =>
  clearChallengeDenials({ gameType: GAME_TYPE, ...args });
