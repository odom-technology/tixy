import { NextResponse, type NextRequest } from 'next/server';

import {
  ACCOUNT_SESSION_COOKIE,
  getIdentityForSessionToken,
} from '@/server/accounts';
import {
  getMaintenanceModeSettings,
  getMaintenanceModeStatusForRoles,
  getSiteAvailabilitySettings,
} from '@/server/site-settings';
import { getPathRestriction } from '@/lib/site-availability';

const PUBLIC_FILE_RE = /\.(?:ico|png|jpg|jpeg|gif|webp|svg|txt|xml|json|webmanifest|css|js|map)$/i;
const PUBLIC_PAGE_PATHS = new Set([
  '/maintenance',
  '/signin',
  '/recover',
  '/contact',
  '/feedback',
  '/feedback/new',
]);
const PUBLIC_API_PATHS = new Set([
  '/api/account/me',
  '/api/account/recover',
  '/api/account/session',
  '/api/health',
  '/api/stripe/webhook',
  '/api/feedback',
]);

function isAlwaysAllowedPath(pathname: string) {
  return (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/admin') ||
    pathname.startsWith('/api/admin') ||
    pathname.startsWith('/feedback/') ||
    PUBLIC_PAGE_PATHS.has(pathname) ||
    PUBLIC_FILE_RE.test(pathname)
  );
}

function isAlwaysAllowedApi(pathname: string) {
  return PUBLIC_API_PATHS.has(pathname);
}

function continueWithPathname(request: NextRequest) {
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-arcade-pathname', request.nextUrl.pathname);
  return NextResponse.next({ request: { headers: requestHeaders } });
}

async function getRequestIdentity(request: NextRequest) {
  const sessionToken = request.cookies.get(ACCOUNT_SESSION_COOKIE)?.value;
  if (!sessionToken) return null;
  try {
    return await getIdentityForSessionToken(sessionToken);
  } catch (error) {
    console.error('Failed to read maintenance request identity:', error);
    return null;
  }
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (!pathname.startsWith('/_next') && !PUBLIC_FILE_RE.test(pathname)) {
    const { config: availability } = await getSiteAvailabilitySettings();
    const restriction = getPathRestriction(availability, pathname);
    if (restriction) {
      const headers = { 'Cache-Control': 'no-store', 'Retry-After': '300', 'X-Robots-Tag': 'noindex', 'X-Arcade-Unavailable': restriction.id };
      if (pathname.startsWith('/api/')) {
        return NextResponse.json({ error: restriction.message, unavailable: restriction.id }, { status: 503, headers });
      }
      const url = request.nextUrl.clone();
      url.pathname = '/unavailable';
      url.search = '';
      url.searchParams.set('path', pathname);
      return NextResponse.rewrite(url, { status: 503, headers });
    }
  }

  if (isAlwaysAllowedPath(pathname)) {
    return continueWithPathname(request);
  }

  if (pathname.startsWith('/api/') && isAlwaysAllowedApi(pathname)) {
    return continueWithPathname(request);
  }

  const maintenanceSetting = await getMaintenanceModeSettings();
  const anonymousStatus = getMaintenanceModeStatusForRoles({
    config: maintenanceSetting.config,
    roles: null,
  });
  if (!anonymousStatus.isActive) {
    return continueWithPathname(request);
  }

  const identity = await getRequestIdentity(request);
  const status = getMaintenanceModeStatusForRoles({
    config: maintenanceSetting.config,
    roles: identity?.roles,
  });
  if (status.canBypass) {
    return continueWithPathname(request);
  }

  if (pathname.startsWith('/api/')) {
    return NextResponse.json(
      { error: 'Arcade is currently in maintenance mode.' },
      {
        status: 503,
        headers: {
          'Cache-Control': 'no-store',
          'Retry-After': status.endsInMs
            ? String(Math.max(60, Math.ceil(status.endsInMs / 1000)))
            : '300',
          'X-Robots-Tag': 'noindex',
        },
      },
    );
  }

  const url = request.nextUrl.clone();
  url.pathname = '/maintenance';
  url.search = '';
  const response = NextResponse.redirect(url);
  response.headers.set('Cache-Control', 'no-store');
  response.headers.set('X-Robots-Tag', 'noindex');
  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image).*)'],
};
