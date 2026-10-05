import crypto from 'node:crypto';

import { query } from '@/server/db/client';

export const PRODUCT_ANALYTICS_EVENTS = [
  'landing_view',
  'game_started',
  'game_completed',
  'auth_nudge_shown',
  'auth_nudge_clicked',
  'auth_nudge_dismissed',
  'signup_success',
  'signin_success',
  'result_shared',
  'challenge_opened',
] as const;

export type ProductAnalyticsEvent = (typeof PRODUCT_ANALYTICS_EVENTS)[number];

const EVENT_NAMES = new Set<string>(PRODUCT_ANALYTICS_EVENTS);
const SESSION_ID_PATTERN = /^[a-zA-Z0-9_-]{16,80}$/;
const EVENT_ID_PATTERN = /^[a-zA-Z0-9_-]{16,80}$/;
const CONTEXT_VALUE_PATTERN = /^[a-z0-9][a-z0-9_-]*$/;
const MAX_EVENTS_PER_SESSION_HOUR = 240;

type ProductEventInput = {
  id?: string | null;
  event: string;
  sessionId: string;
  isAuthenticated: boolean;
  actorId?: string | null;
  path?: string | null;
  gameSlug?: string | null;
  source?: string | null;
};

type OrderedFunnelRow = Record<ProductAnalyticsEvent, string>;

type GameConversionRow = {
  game_slug: string;
  starts: string;
  completions: string;
};

type SourceRow = {
  source: string;
  event_name: ProductAnalyticsEvent;
  sessions: string;
};

type RetentionRow = {
  activated: string;
  d1_eligible: string;
  d1_retained: string;
  d7_eligible: string;
  d7_retained: string;
};

type FunnelCountRow = {
  event_name: ProductAnalyticsEvent;
  events: string;
  sessions: string;
};

type FunnelDailyRow = FunnelCountRow & {
  day: string;
};

function normalizedContextValue(value: string | null | undefined) {
  const normalized = value?.trim().toLowerCase() ?? '';
  if (!normalized || normalized.length > 48 || !CONTEXT_VALUE_PATTERN.test(normalized)) {
    return null;
  }
  return normalized;
}

function normalizedPath(value: string | null | undefined) {
  const path = value?.split(/[?#]/, 1)[0]?.trim() ?? '';
  if (!path.startsWith('/') || path.startsWith('//') || path.length > 160) return null;
  if (path === '/') return path;
  const [section] = path.split('/').filter(Boolean);
  return section ? `/${section.toLowerCase()}` : null;
}

function parseCount(value: string | number | null | undefined) {
  const count = Number(value ?? 0);
  return Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
}

function hashActor(actorId: string | null | undefined) {
  if (!actorId) return null;
  const secret = process.env.PRODUCT_ANALYTICS_HASH_SECRET
    ?? process.env.GAME_SESSION_SECRET;
  if (!secret || secret.length < 16) return null;
  return crypto
    .createHmac('sha256', secret)
    .update(`arcade-product-actor:${actorId}`)
    .digest('hex');
}

function percent(numerator: number, denominator: number) {
  return denominator > 0 ? Math.round((numerator / denominator) * 10_000) / 100 : null;
}

export function isProductAnalyticsEvent(value: string): value is ProductAnalyticsEvent {
  return EVENT_NAMES.has(value);
}

/**
 * Records only a short, allow-listed funnel event. The browser session token is
 * one-session-only and is irreversibly hashed before storage. No request
 * metadata, raw account identifier, query string, or arbitrary properties
 * persist. Authenticated actors may receive a keyed, one-way pseudonym used
 * only for aggregate retention cohorts.
 */
export async function captureProductEvent(input: ProductEventInput) {
  if (!isProductAnalyticsEvent(input.event)) return false;
  if (!SESSION_ID_PATTERN.test(input.sessionId)) return false;

  const now = Date.now();
  const sessionHash = crypto
    .createHash('sha256')
    .update(`arcade-product-event:${input.sessionId}`)
    .digest('hex');

  const recent = await query<{ count: string }>(
    `
      SELECT COUNT(*)::text AS count
      FROM product_analytics_events
      WHERE session_hash = $1 AND created_at >= $2
    `,
    [sessionHash, now - 60 * 60 * 1000],
  );
  if (parseCount(recent.rows[0]?.count) >= MAX_EVENTS_PER_SESSION_HOUR) {
    return false;
  }

  await query(
    `
      INSERT INTO product_analytics_events (
        id,
        event_name,
        session_hash,
        actor_hash,
        is_authenticated,
        path,
        game_slug,
        source,
        created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      ON CONFLICT(id) DO NOTHING
    `,
    [
      input.id && EVENT_ID_PATTERN.test(input.id) ? input.id : crypto.randomUUID(),
      input.event,
      sessionHash,
      input.isAuthenticated ? hashActor(input.actorId) : null,
      input.isAuthenticated,
      normalizedPath(input.path),
      normalizedContextValue(input.gameSlug),
      normalizedContextValue(input.source),
      now,
    ],
  );
  return true;
}

/** Aggregate-only admin read model; raw session hashes never leave the server. */
export async function getProductFunnelAnalytics(days = 30) {
  const safeDays = Math.max(1, Math.min(90, Math.floor(days) || 30));
  const cutoff = Date.now() - safeDays * 24 * 60 * 60 * 1000;

  const [totalsResult, dailyResult, funnelResult, gamesResult, sourcesResult, retentionResult] = await Promise.all([
    query<FunnelCountRow>(
      `
        SELECT
          event_name,
          COUNT(*)::text AS events,
          COUNT(DISTINCT session_hash)::text AS sessions
        FROM product_analytics_events
        WHERE created_at >= $1
        GROUP BY event_name
        ORDER BY event_name
      `,
      [cutoff],
    ),
    query<FunnelDailyRow>(
      `
        SELECT
          to_char(
            to_timestamp(created_at / 1000.0) AT TIME ZONE 'UTC',
            'YYYY-MM-DD'
          ) AS day,
          event_name,
          COUNT(*)::text AS events,
          COUNT(DISTINCT session_hash)::text AS sessions
        FROM product_analytics_events
        WHERE created_at >= $1
        GROUP BY day, event_name
        ORDER BY day, event_name
      `,
      [cutoff],
    ),
    query<OrderedFunnelRow>(
      `
        WITH landing AS (
          SELECT session_hash, MIN(created_at) AS landing_view
          FROM product_analytics_events
          WHERE created_at >= $1 AND event_name = 'landing_view'
          GROUP BY session_hash
        ), started AS (
          SELECT l.*,
                 (SELECT MIN(e.created_at)
                    FROM product_analytics_events e
                   WHERE e.session_hash = l.session_hash
                     AND e.event_name = 'game_started'
                     AND e.created_at >= l.landing_view) AS game_started
          FROM landing l
        ), completed AS (
          SELECT s.*,
                 (SELECT MIN(e.created_at)
                    FROM product_analytics_events e
                   WHERE e.session_hash = s.session_hash
                     AND e.event_name = 'game_completed'
                     AND e.created_at >= s.game_started) AS game_completed
          FROM started s
        ), nudged AS (
          SELECT c.*,
                 (SELECT MIN(e.created_at)
                    FROM product_analytics_events e
                   WHERE e.session_hash = c.session_hash
                     AND e.event_name = 'auth_nudge_shown'
                     AND e.created_at >= c.game_completed) AS auth_nudge_shown
          FROM completed c
        ), clicked AS (
          SELECT n.*,
                 (SELECT MIN(e.created_at)
                    FROM product_analytics_events e
                   WHERE e.session_hash = n.session_hash
                     AND e.event_name = 'auth_nudge_clicked'
                     AND e.created_at >= n.auth_nudge_shown) AS auth_nudge_clicked
          FROM nudged n
        ), signed_up AS (
          SELECT c.*,
                 (SELECT MIN(e.created_at)
                    FROM product_analytics_events e
                   WHERE e.session_hash = c.session_hash
                     AND e.event_name = 'signup_success'
                     AND e.created_at >= c.auth_nudge_clicked) AS signup_success
          FROM clicked c
        )
        SELECT
          COUNT(landing_view)::text AS landing_view,
          COUNT(game_started)::text AS game_started,
          COUNT(game_completed)::text AS game_completed,
          COUNT(auth_nudge_shown)::text AS auth_nudge_shown,
          COUNT(auth_nudge_clicked)::text AS auth_nudge_clicked,
          COUNT(signup_success)::text AS signup_success,
          '0'::text AS auth_nudge_dismissed,
          '0'::text AS signin_success,
          '0'::text AS result_shared,
          '0'::text AS challenge_opened
        FROM signed_up
      `,
      [cutoff],
    ),
    query<GameConversionRow>(
      `
        WITH starts AS (
          SELECT session_hash, game_slug, MIN(created_at) AS started_at
          FROM product_analytics_events
          WHERE created_at >= $1
            AND event_name = 'game_started'
            AND game_slug IS NOT NULL
          GROUP BY session_hash, game_slug
        ), conversions AS (
          SELECT s.*,
                 EXISTS (
                   SELECT 1
                   FROM product_analytics_events e
                   WHERE e.session_hash = s.session_hash
                     AND e.game_slug = s.game_slug
                     AND e.event_name = 'game_completed'
                     AND e.created_at >= s.started_at
                 ) AS completed
          FROM starts s
        )
        SELECT game_slug,
               COUNT(*)::text AS starts,
               COUNT(*) FILTER (WHERE completed)::text AS completions
        FROM conversions
        GROUP BY game_slug
        ORDER BY COUNT(*) DESC, game_slug
        LIMIT 50
      `,
      [cutoff],
    ),
    query<SourceRow>(
      `
        SELECT COALESCE(source, 'unspecified') AS source,
               event_name,
               COUNT(DISTINCT session_hash)::text AS sessions
        FROM product_analytics_events
        WHERE created_at >= $1 AND source IS NOT NULL
        GROUP BY source, event_name
        ORDER BY COUNT(DISTINCT session_hash) DESC
        LIMIT 50
      `,
      [cutoff],
    ),
    query<RetentionRow>(
      `
        WITH activations AS (
          SELECT actor_hash,
                 MIN((to_timestamp(created_at / 1000.0) AT TIME ZONE 'UTC')::date) AS activated_on
          FROM product_analytics_events
          WHERE actor_hash IS NOT NULL AND event_name = 'game_completed'
          GROUP BY actor_hash
        ), cohort AS (
          SELECT * FROM activations
          WHERE activated_on >= (to_timestamp($1 / 1000.0) AT TIME ZONE 'UTC')::date
        )
        SELECT
          COUNT(*)::text AS activated,
          COUNT(*) FILTER (WHERE activated_on <= (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date - 1)::text AS d1_eligible,
          COUNT(*) FILTER (
            WHERE activated_on <= (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date - 1
              AND EXISTS (
                SELECT 1 FROM product_analytics_events e
                WHERE e.actor_hash = cohort.actor_hash
                  AND (to_timestamp(e.created_at / 1000.0) AT TIME ZONE 'UTC')::date = cohort.activated_on + 1
              )
          )::text AS d1_retained,
          COUNT(*) FILTER (WHERE activated_on <= (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date - 7)::text AS d7_eligible,
          COUNT(*) FILTER (
            WHERE activated_on <= (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date - 7
              AND EXISTS (
                SELECT 1 FROM product_analytics_events e
                WHERE e.actor_hash = cohort.actor_hash
                  AND (to_timestamp(e.created_at / 1000.0) AT TIME ZONE 'UTC')::date = cohort.activated_on + 7
              )
          )::text AS d7_retained
        FROM cohort
      `,
      [cutoff],
    ),
  ]);

  const emptyTotals = Object.fromEntries(
    PRODUCT_ANALYTICS_EVENTS.map((event) => [event, { events: 0, sessions: 0 }]),
  ) as Record<ProductAnalyticsEvent, { events: number; sessions: number }>;

  for (const row of totalsResult.rows) {
    if (!isProductAnalyticsEvent(row.event_name)) continue;
    emptyTotals[row.event_name] = {
      events: parseCount(row.events),
      sessions: parseCount(row.sessions),
    };
  }

  const funnelEvents: ProductAnalyticsEvent[] = [
    'landing_view',
    'game_started',
    'game_completed',
    'auth_nudge_shown',
    'auth_nudge_clicked',
    'signup_success',
  ];
  const orderedCounts = funnelResult.rows[0];
  let previousSessions: number | null = null;
  const funnel = funnelEvents.map((event) => {
    const sessions = parseCount(orderedCounts?.[event]);
    const rateFromPrevious = previousSessions === null
      ? null
      : percent(sessions, previousSessions);
    previousSessions = sessions;
    return { event, sessions, rateFromPrevious };
  });

  const retentionRow = retentionResult.rows[0];
  const retention = {
    activated: parseCount(retentionRow?.activated),
    d1: {
      eligible: parseCount(retentionRow?.d1_eligible),
      retained: parseCount(retentionRow?.d1_retained),
      rate: percent(parseCount(retentionRow?.d1_retained), parseCount(retentionRow?.d1_eligible)),
    },
    d7: {
      eligible: parseCount(retentionRow?.d7_eligible),
      retained: parseCount(retentionRow?.d7_retained),
      rate: percent(parseCount(retentionRow?.d7_retained), parseCount(retentionRow?.d7_eligible)),
    },
  };

  return {
    days: safeDays,
    from: new Date(cutoff).toISOString(),
    totals: emptyTotals,
    funnel,
    retention,
    games: gamesResult.rows.map((row) => {
      const starts = parseCount(row.starts);
      const completions = parseCount(row.completions);
      return {
        gameSlug: row.game_slug,
        starts,
        completions,
        completionRate: percent(completions, starts),
      };
    }),
    sources: sourcesResult.rows.map((row) => ({
      source: row.source,
      event: row.event_name,
      sessions: parseCount(row.sessions),
    })),
    daily: dailyResult.rows.map((row) => ({
      day: row.day,
      event: row.event_name,
      events: parseCount(row.events),
      sessions: parseCount(row.sessions),
    })),
  };
}
