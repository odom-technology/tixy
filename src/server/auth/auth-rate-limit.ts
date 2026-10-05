import { NextResponse } from 'next/server';

/**
 * In-memory sliding-window rate limiter for auth endpoints.
 *
 * Single-instance deployment is a given, so a process-local Map is
 * sufficient. Buckets are pruned lazily on access.
 */

export type RateLimitResult =
  | { limited: false }
  | { limited: true; retryAfterSeconds: number };

type RateLimitBucket = {
  hits: number[];
  windowMs: number;
};

type RateLimitRule = {
  key: string;
  limit: number;
  windowMs: number;
};

function envInt(name: string, fallback: number) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

// Like envInt but allows 0 (used for trusted-proxy depth, where 0 is a
// meaningful value that disables X-Forwarded-For trust entirely).
function envIntAllowZero(name: string, fallback: number) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

const SIGNIN_LIMIT = envInt('SIGNIN_RATE_LIMIT', 10);
// Per-identifier ceiling across all IPs, so an attacker rotating source IPs
// still hits a hard cap on guesses against a single account. Kept a little
// higher than the per-IP limit so a legitimate user on a couple of networks
// is not locked out.
const SIGNIN_ID_LIMIT = envInt('SIGNIN_ID_RATE_LIMIT', 20);
// A separate per-IP ceiling prevents an attacker from bypassing the
// identifier-specific buckets by rotating through nonexistent usernames.
const SIGNIN_IP_LIMIT = envInt('SIGNIN_IP_RATE_LIMIT', 60);
const SIGNIN_WINDOW_MS = 15 * 60 * 1000;
// Number of trusted reverse-proxy hops in front of the app. The real client IP
// is this many entries from the RIGHT of X-Forwarded-For (each proxy appends
// the peer it saw). Default 1 matches the documented single-proxy deployment.
const TRUSTED_PROXY_COUNT = envIntAllowZero('TRUSTED_PROXY_COUNT', 1);
// Registration is keyed on IP, and shared office/NAT IPs mean many legitimate
// users register from a single address. Keep the per-IP ceiling generous (and
// env-tunable) so a single shared IP does not lock out a whole office, while
// still capping runaway automated signup abuse.
const REGISTER_LIMIT = envInt('REGISTER_RATE_LIMIT', 60);
const REGISTER_WINDOW_MS = 60 * 60 * 1000;
const RECOVER_LIMIT = envInt('RECOVER_RATE_LIMIT', 5);
const RECOVER_WINDOW_MS = 60 * 60 * 1000;
const PRUNE_INTERVAL_MS = 60 * 1000;

/**
 * IPs that bypass auth rate limiting entirely. Set RATE_LIMIT_IP_ALLOWLIST to a
 * comma-separated list (e.g. the office egress IP) to exempt trusted networks.
 */
const IP_ALLOWLIST = new Set(
  (process.env.RATE_LIMIT_IP_ALLOWLIST ?? '')
    .split(',')
    .map((ip) => ip.trim())
    .filter(Boolean),
);

const buckets = new Map<string, RateLimitBucket>();
let lastPruneAt = 0;

/* How often each rule family said "limited" since this process started, for
   the admin trust page. Families, not keys: no identifier or IP is kept. */
const limitHits = new Map<string, number>();
const limitHitsSince = Date.now();

function ruleFamily(key: string) {
  const [head = '', second = ''] = key.split(':');
  // signin:<identifier>:<ip> is the per-identifier-and-IP rule; the others
  // are signin:id and signin:ip.
  if (head === 'signin' && second !== 'id' && second !== 'ip') return 'signin:id+ip';
  return `${head}:${second}`;
}

/** Limited results by rule family since the server process started. */
export function getRateLimitHits(): { since: number; rules: { rule: string; hits: number }[] } {
  return {
    since: limitHitsSince,
    rules: [...limitHits.entries()]
      .map(([rule, hits]) => ({ rule, hits }))
      .sort((a, b) => b.hits - a.hits || a.rule.localeCompare(b.rule)),
  };
}

function pruneExpiredBuckets(now: number) {
  if (now - lastPruneAt < PRUNE_INTERVAL_MS) return;
  lastPruneAt = now;
  for (const [key, bucket] of buckets) {
    const cutoff = now - bucket.windowMs;
    bucket.hits = bucket.hits.filter((hit) => hit > cutoff);
    if (bucket.hits.length === 0) buckets.delete(key);
  }
}

function checkRule(rule: RateLimitRule, now: number): RateLimitResult {
  const bucket = buckets.get(rule.key);
  if (!bucket) return { limited: false };
  const cutoff = now - rule.windowMs;
  bucket.hits = bucket.hits.filter((hit) => hit > cutoff);
  if (bucket.hits.length < rule.limit) return { limited: false };
  const oldest = bucket.hits[0];
  return {
    limited: true,
    retryAfterSeconds: Math.max(1, Math.ceil((oldest + rule.windowMs - now) / 1000)),
  };
}

function recordHit(rule: RateLimitRule, now: number) {
  const bucket = buckets.get(rule.key);
  if (bucket) {
    bucket.hits.push(now);
    bucket.windowMs = rule.windowMs;
  } else {
    buckets.set(rule.key, { hits: [now], windowMs: rule.windowMs });
  }
}

function consume(rules: RateLimitRule[]): RateLimitResult {
  const now = Date.now();
  pruneExpiredBuckets(now);

  let limited: RateLimitResult = { limited: false };
  for (const rule of rules) {
    const result = checkRule(rule, now);
    if (result.limited) {
      const family = ruleFamily(rule.key);
      limitHits.set(family, (limitHits.get(family) ?? 0) + 1);
    }
    if (
      result.limited &&
      (!limited.limited || result.retryAfterSeconds > limited.retryAfterSeconds)
    ) {
      limited = result;
    }
  }
  if (limited.limited) return limited;

  for (const rule of rules) recordHit(rule, now);
  return { limited: false };
}

function normalizeIdentifier(value: string) {
  return value.trim().toLowerCase();
}

export function getClientIp(request: Request) {
  // X-Forwarded-For is client-controllable: a client can pre-seed forged
  // entries, and the first trusted proxy appends the real peer to the RIGHT of
  // the list. Trusting the leftmost token therefore lets an attacker forge the
  // IP (defeating per-IP rate limiting and poisoning audit logs). Instead read
  // TRUSTED_PROXY_COUNT hops from the right — the entry our own proxy set.
  if (TRUSTED_PROXY_COUNT > 0) {
    const chain = request.headers
      .get('x-forwarded-for')
      ?.split(',')
      .map((entry) => entry.trim())
      .filter(Boolean);
    if (chain && chain.length > 0) {
      const index = Math.max(0, chain.length - TRUSTED_PROXY_COUNT);
      const candidate = chain[index];
      if (candidate) return candidate;
    }
  }
  return request.headers.get('x-real-ip')?.trim() || 'unknown';
}

/** True when the IP is on the trusted allowlist and should skip rate limiting. */
function isAllowlistedIp(ip: string) {
  return IP_ALLOWLIST.has(ip);
}

function signinKey(identifier: string, ip: string) {
  return `signin:${normalizeIdentifier(identifier)}:${ip}`;
}

function signinIdentifierKey(identifier: string) {
  return `signin:id:${normalizeIdentifier(identifier)}`;
}

/**
 * Signin: SIGNIN_LIMIT attempts per 15 minutes per identifier+IP, AND a
 * SIGNIN_ID_LIMIT ceiling per identifier across all IPs. The per-identifier
 * dimension is what actually bounds online brute force once source IPs can no
 * longer be forged (see getClientIp).
 */
export function consumeSigninRateLimit(identifier: string, ip: string): RateLimitResult {
  if (isAllowlistedIp(ip)) return { limited: false };
  return consume([
    { key: signinKey(identifier, ip), limit: SIGNIN_LIMIT, windowMs: SIGNIN_WINDOW_MS },
    { key: signinIdentifierKey(identifier), limit: SIGNIN_ID_LIMIT, windowMs: SIGNIN_WINDOW_MS },
    { key: `signin:ip:${ip}`, limit: SIGNIN_IP_LIMIT, windowMs: SIGNIN_WINDOW_MS },
  ]);
}

/** Clears the signin counters after a successful authentication. */
export function resetSigninRateLimit(identifier: string, ip: string) {
  buckets.delete(signinKey(identifier, ip));
  buckets.delete(signinIdentifierKey(identifier));
}

/** Register: REGISTER_LIMIT attempts per hour per IP (allowlisted IPs bypass). */
export function consumeRegisterRateLimit(ip: string): RateLimitResult {
  if (isAllowlistedIp(ip)) return { limited: false };
  return consume([
    { key: `register:ip:${ip}`, limit: REGISTER_LIMIT, windowMs: REGISTER_WINDOW_MS },
  ]);
}

/** Recover: 5 attempts per hour per identifier and 5 per hour per IP. */
export function consumeRecoverRateLimit(identifier: string, ip: string): RateLimitResult {
  if (isAllowlistedIp(ip)) return { limited: false };
  return consume([
    {
      key: `recover:id:${normalizeIdentifier(identifier)}`,
      limit: RECOVER_LIMIT,
      windowMs: RECOVER_WINDOW_MS,
    },
    { key: `recover:ip:${ip}`, limit: RECOVER_LIMIT, windowMs: RECOVER_WINDOW_MS },
  ]);
}

/** A read endpoint polled by pages (the home's live parts): `limit` requests
 *  per `windowMs` per key. Same buckets and pruning as the auth limits. */
export function consumeReadRateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  return consume([{ key: `read:${key}`, limit, windowMs }]);
}

export function tooManyAttemptsResponse(retryAfterSeconds: number) {
  return NextResponse.json(
    { error: 'Too many attempts. Try again later.' },
    { status: 429, headers: { 'Retry-After': String(retryAfterSeconds) } },
  );
}
