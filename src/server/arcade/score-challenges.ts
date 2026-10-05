import crypto from 'node:crypto';

import {
  formatScoreChallengeTarget,
  getScoreChallengeGame,
} from '@/features/arcade/lib/score-challenge';
import { getGameDisplayRoute } from '@/features/arcade/lib/game-renames';
import { queryOne } from '@/server/db/client';

const CHALLENGE_CONTEXT = 'arcade-score-challenge-v1:';
const CHALLENGE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const RECENT_SCORE_WINDOW_MS = 10 * 60 * 1000;
const MAX_TOKEN_LENGTH = 1_024;

type ScoreEventRow = {
  score: number | string;
  mode: string | null;
  created_at: number | string;
};

type ScoreChallengeClaims = {
  v: 1;
  g: string;
  s: number;
  m: string | null;
  iat: number;
  exp: number;
};

export type VerifiedScoreChallenge = {
  gameSlug: string;
  gameTitle: string;
  gameHref: string;
  metricLabel: string;
  direction: 'high' | 'low';
  score: number;
  formattedScore: string;
  mode: string | null;
  issuedAt: number;
  expiresAt: number;
};

function challengeSecret() {
  const secret = process.env.GAME_SESSION_SECRET?.trim();
  if (!secret) throw new Error('GAME_SESSION_SECRET is required for score challenges.');
  return secret;
}

function signature(payload: string) {
  return crypto
    .createHmac('sha256', challengeSecret())
    .update(`${CHALLENGE_CONTEXT}${payload}`)
    .digest();
}

function isSafeMode(value: unknown): value is string | null {
  return value === null || (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 32 &&
    /^[a-zA-Z0-9_-]+$/.test(value)
  );
}

function claimsToChallenge(claims: ScoreChallengeClaims): VerifiedScoreChallenge | null {
  const game = getScoreChallengeGame(claims.g);
  if (!game) return null;
  return {
    gameSlug: game.slug,
    gameTitle: game.title,
    gameHref: getGameDisplayRoute(game.slug, game.href),
    metricLabel: game.metricLabel,
    direction: game.direction,
    score: claims.s,
    formattedScore: formatScoreChallengeTarget(game.slug, claims.s),
    mode: claims.m,
    issuedAt: claims.iat,
    expiresAt: claims.exp,
  };
}

export function signScoreChallenge(input: {
  gameSlug: string;
  score: number;
  mode?: string | null;
  now?: number;
}) {
  if (!getScoreChallengeGame(input.gameSlug)) {
    throw new Error('Unsupported score challenge game.');
  }
  if (!Number.isFinite(input.score) || Math.abs(input.score) > 1_000_000_000_000) {
    throw new Error('Invalid score challenge target.');
  }
  const mode = input.mode ?? null;
  if (!isSafeMode(mode)) throw new Error('Invalid score challenge mode.');

  const now = Math.floor(input.now ?? Date.now());
  const claims: ScoreChallengeClaims = {
    v: 1,
    g: input.gameSlug,
    s: input.score,
    m: mode,
    iat: now,
    exp: now + CHALLENGE_TTL_MS,
  };
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return `${payload}.${signature(payload).toString('base64url')}`;
}

export function verifyScoreChallenge(token: string, now = Date.now()) {
  if (!token || token.length > MAX_TOKEN_LENGTH) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [payload, suppliedSignature] = parts;
  if (!payload || !suppliedSignature) return null;

  let supplied: Buffer;
  try {
    supplied = Buffer.from(suppliedSignature, 'base64url');
  } catch {
    return null;
  }
  const expected = signature(payload);
  if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) {
    return null;
  }

  let claims: ScoreChallengeClaims;
  try {
    claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as ScoreChallengeClaims;
  } catch {
    return null;
  }
  if (
    claims.v !== 1 ||
    typeof claims.g !== 'string' ||
    !Number.isFinite(claims.s) ||
    Math.abs(claims.s) > 1_000_000_000_000 ||
    !isSafeMode(claims.m) ||
    !Number.isInteger(claims.iat) ||
    !Number.isInteger(claims.exp) ||
    claims.iat > now + 60_000 ||
    claims.exp <= now ||
    claims.exp - claims.iat !== CHALLENGE_TTL_MS
  ) {
    return null;
  }
  return claimsToChallenge(claims);
}

/**
 * Issues a display-only challenge from the latest accepted, anti-cheat-checked
 * score event. The caller supplies only the game slug; no client score enters
 * the signed claim, and this module has no reward or leaderboard write path.
 */
export async function createScoreChallengeForUser(input: {
  userId: string;
  gameSlug: string;
  now?: number;
}) {
  const game = getScoreChallengeGame(input.gameSlug);
  if (!game) return null;
  const now = Math.floor(input.now ?? Date.now());
  const event = await queryOne<ScoreEventRow>(
    `
      SELECT score, mode, created_at
      FROM game_score_events
      WHERE od_user_id = $1
        AND game_slug = $2
        AND created_at >= $3
      ORDER BY created_at DESC
      LIMIT 1
    `,
    [input.userId, game.slug, now - RECENT_SCORE_WINDOW_MS],
  );
  if (!event) return null;
  const score = Number(event.score);
  if (!Number.isFinite(score)) return null;

  const token = signScoreChallenge({
    gameSlug: game.slug,
    score,
    mode: event.mode,
    now,
  });
  return {
    token,
    challenge: verifyScoreChallenge(token, now),
  };
}
