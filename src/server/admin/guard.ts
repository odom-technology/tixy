import { randomUUID } from 'node:crypto';

import { NextResponse } from 'next/server';
import { redirect } from 'next/navigation';

import { logSecurityEvent } from '@/lib/secure-logger';
import { recordAdminAction, type AuditSpec } from '@/server/admin/audit';
import { requireIdentity, type ArcadeIdentity } from '@/server/auth';
import { consumeReadRateLimit, tooManyAttemptsResponse } from '@/server/auth/auth-rate-limit';
import { checkRole } from '@/server/auth/check-role';

/* One gate for every admin route: signed in (401), admin (403), then a
   per-admin rate limit (429). Reads get 240 a minute, writes 40; a console
   page fans out to a handful of reads, and nobody grants 40 things a minute
   by hand. The limits are per process, like the auth limits.

   Every write (POST, PUT, PATCH, DELETE) also leaves a row in admin_audit_log:
   who, which action, which target, the reason, a sanitised copy of the
   request's allowlisted fields, and the HTTP status the route returned.
   Refused attempts (4xx) are recorded too, because a refused grant is worth
   seeing. A route names its action with the `audit` option; with none, the
   action is the route path plus the method (for example `admin.skins.post`).

   What this does not do: the audit row is written after the route's own write
   has committed, not inside its transaction, so a crash between the two can
   lose a row. A failed audit write is logged and never fails the request. The
   routes' own domain records (arcade_account_moderation_actions, the ledger's
   created_by, game_bans.banned_by) stay as they are; this log sits beside them. */

export const ADMIN_READ_LIMIT = 240;
export const ADMIN_WRITE_LIMIT = 40;
const WINDOW_MS = 60_000;

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export type AdminRouteContext<P = unknown> = {
  identity: ArcadeIdentity;
  params: P;
};

type RouteSegment<P> = { params: Promise<P> };

type AdminHandler<P> = (
  request: Request,
  context: AdminRouteContext<P>,
) => Promise<Response> | Response;

export type AuditContext<P = unknown> = {
  request: Request;
  /** The parsed JSON body, or null when there was none or it was not JSON. */
  body: unknown;
  searchParams: URLSearchParams;
  identity: ArcadeIdentity;
  params: P;
  response: Response;
  status: number;
};

export type AdminGuardOptions<P = unknown> = {
  /** Overrides the default per-minute limit for this route. */
  limit?: number;
  /** Names the audit row for a write, after the handler ran. Return null to skip it. */
  audit?: (context: AuditContext<P>) => AuditSpec | null | Promise<AuditSpec | null>;
};

export async function resolveAdmin(): Promise<
  { identity: ArcadeIdentity; response: null } | { identity: null; response: Response }
> {
  let identity: ArcadeIdentity;
  try {
    identity = await requireIdentity();
  } catch {
    return {
      identity: null,
      response: NextResponse.json({ error: 'Authentication required.' }, { status: 401 }),
    };
  }
  if (!(await checkRole('admin', identity))) {
    return { identity: null, response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
  }
  return { identity, response: null };
}

const NON_JSON_TYPES = /multipart|form-data|x-www-form|octet-stream|image\/|video\/|audio\//i;

async function readJsonBody(request: Request): Promise<unknown> {
  if (NON_JSON_TYPES.test(request.headers.get('content-type') ?? '')) return null;
  try {
    return await request.clone().json();
  } catch {
    return null;
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** The JSON the route answered with, for audit specs that need an id the route made. */
export async function responseJson(response: Response): Promise<Record<string, unknown>> {
  try {
    return asRecord(await response.clone().json());
  } catch {
    return {};
  }
}

function correlationIdFor(request: Request) {
  const given = request.headers.get('x-correlation-id')?.trim();
  return given && /^[\w.:-]{1,100}$/.test(given) ? given : randomUUID();
}

/** `admin.db.rewards.post`; dynamic segments become `:name`. */
function defaultAction(pathname: string, method: string, params: unknown) {
  const values = new Map<string, string>();
  for (const [key, value] of Object.entries(asRecord(params))) {
    if (typeof value === 'string') values.set(value, key);
  }
  const segments = pathname
    .split('/')
    .filter(Boolean)
    .filter((segment, index) => !(index === 0 && segment === 'api'))
    .map((segment) => {
      const decoded = decodeURIComponent(segment);
      return values.has(decoded) ? `:${values.get(decoded)}` : segment;
    });
  return `${segments.join('.')}.${method.toLowerCase()}`;
}

function defaultAuditSpec<P>(context: AuditContext<P>): AuditSpec {
  const body = asRecord(context.body);
  const url = new URL(context.request.url);
  const spec: AuditSpec = {
    action: defaultAction(url.pathname, context.request.method, context.params),
    reason: typeof body.reason === 'string' ? body.reason : null,
    details: body,
  };
  if (typeof body.userId === 'string' && body.userId.trim()) {
    spec.targetType = 'user';
    spec.targetId = body.userId.trim();
  } else if (typeof body.itemId === 'string' && body.itemId.trim()) {
    spec.targetType = 'item';
    spec.targetId = body.itemId.trim();
  }
  return spec;
}

export function withAdmin<P = Record<string, string | string[]>>(
  handler: AdminHandler<P>,
  options: AdminGuardOptions<P> = {},
) {
  return async function adminRoute(request: Request, segment?: RouteSegment<P>) {
    const auth = await resolveAdmin();
    if (auth.response) {
      const where = new URL(request.url).pathname;
      if (auth.response.status === 401) {
        await logSecurityEvent.authenticationFailure(`admin route ${where}`, request);
      } else {
        await logSecurityEvent.authorizationFailure(null, `admin route ${where}`, request);
      }
      return auth.response;
    }
    const identity = auth.identity;
    const method = request.method.toUpperCase();
    const write = WRITE_METHODS.has(method);
    const limit = options.limit ?? (write ? ADMIN_WRITE_LIMIT : ADMIN_READ_LIMIT);
    const limited = consumeReadRateLimit(
      `admin:${write ? 'write' : 'read'}:${identity.userId}`,
      limit,
      WINDOW_MS,
    );
    if (limited.limited) return tooManyAttemptsResponse(limited.retryAfterSeconds);
    const params = (segment?.params ? await segment.params : {}) as P;
    if (!write) return handler(request, { identity, params });

    const body = await readJsonBody(request);
    const correlationId = correlationIdFor(request);
    let response: Response | null = null;
    let status = 500;
    try {
      response = await handler(request, { identity, params });
      status = response.status;
      return response;
    } finally {
      await audit({ request, body, identity, params, response, status, correlationId, options });
      try {
        response?.headers.set('x-correlation-id', correlationId);
      } catch {
        // Some responses have immutable headers; the id is still on the audit row.
      }
    }
  };
}

async function audit<P>(input: {
  request: Request;
  body: unknown;
  identity: ArcadeIdentity;
  params: P;
  response: Response | null;
  status: number;
  correlationId: string;
  options: AdminGuardOptions<P>;
}) {
  try {
    const { request, identity, options } = input;
    const context: AuditContext<P> = {
      request,
      body: input.body,
      searchParams: new URL(request.url).searchParams,
      identity,
      params: input.params,
      response: input.response ?? new Response(null, { status: input.status }),
      status: input.status,
    };
    let spec: AuditSpec | null;
    if (options.audit) {
      try {
        spec = await options.audit(context);
      } catch (err) {
        console.error('[admin-audit] spec failed', err instanceof Error ? err.message : 'unknown');
        spec = defaultAuditSpec(context);
      }
    } else {
      spec = defaultAuditSpec(context);
    }
    if (!spec) return;
    await recordAdminAction({
      ...spec,
      actorUserId: identity.userId,
      actorName: identity.name ?? null,
      method: request.method,
      route: new URL(request.url).pathname,
      status: input.status,
      correlationId: input.correlationId,
    });
  } catch (err) {
    console.error('[admin-audit] write failed', err instanceof Error ? err.message : 'unknown');
  }
}

/** For server pages: sends a signed-out visitor to sign in and a player home. */
export async function requireAdminPage(next = '/admin'): Promise<ArcadeIdentity> {
  let identity: ArcadeIdentity;
  try {
    identity = await requireIdentity();
  } catch {
    redirect(`/signin?next=${encodeURIComponent(next)}`);
  }
  if (!(await checkRole('admin', identity))) redirect('/');
  return identity;
}
