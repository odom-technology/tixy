'use client';

import { LogIn, UserPlus, X } from 'lucide-react';
import { usePathname, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  GUEST_RUN_COMPLETED_EVENT,
  setAuthAttributionSource,
  trackProductEvent,
} from '@/features/analytics/product-events';
import { ARCADE_GAMES } from '@/features/arcade/components/arcade-game-registry';
import { canonicalGamePath } from '@/features/arcade/lib/game-renames';
import { ArcadeModal } from '@/features/arcade/components/ui/arcade-interactive';
import {
  ArcadeButton,
  ArcadeLinkButton,
  ArcadeMarquee,
} from '@/features/arcade/components/ui/arcade-ui';

import { useGameShellPresent } from './game-shell-presence';
import { useAccountSummary } from './use-account-summary';

const DISMISS_STORAGE_KEY = 'arcade:guest-auth-nudge-dismissed-at';
const SESSION_STORAGE_KEY = 'arcade:guest-auth-nudge-session-suppressed';
const POST_RUN_STORAGE_KEY = 'arcade:guest-auth-nudge-post-run';
const DISMISS_DURATION_MS = 7 * 24 * 60 * 60 * 1000;

const ACCOUNT_FLOW_PREFIXES = [
  '/signin',
  '/signup',
  '/signout',
  '/recover',
  '/maintenance',
  '/onboarding',
  '/profile',
  '/settings',
  '/notifications',
  '/friends',
  '/privacy',
  '/terms',
  '/contact',
  '/feedback',
];

const routeMatchesPrefix = (rawPathname: string, prefix: string) => {
  const pathname = canonicalGamePath(rawPathname);
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
};

const isAccountFlowPath = (pathname: string) =>
  ACCOUNT_FLOW_PREFIXES.some((prefix) => routeMatchesPrefix(pathname, prefix));

const isGamePath = (pathname: string) =>
  ARCADE_GAMES.some((game) => routeMatchesPrefix(pathname, game.href));

const storageValue = (storage: Storage, key: string) => {
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
};

const setStorageValue = (storage: Storage, key: string, value: string) => {
  try {
    storage.setItem(key, value);
  } catch {
    // Ignore private-mode/storage permission failures. The prompt still works
    // for the current render without persistence.
  }
};

function buildAuthHref(target: 'signin' | 'signup', nextPath: string) {
  return `/${target}?next=${encodeURIComponent(nextPath)}&source=post_run_nudge`;
}

function useCurrentNextPath(pathname: string) {
  const searchParams = useSearchParams();
  return useMemo(() => {
    const query = searchParams.toString();
    return query ? `${pathname}?${query}` : pathname;
  }, [pathname, searchParams]);
}

export function GuestAuthNudge() {
  const pathname = usePathname();
  const nextPath = useCurrentNextPath(pathname);
  const { account, loaded } = useAccountSummary();
  const [visible, setVisible] = useState(false);
  const lastTrackedPathRef = useRef<string | null>(null);

  // A game in the shell says what signing in saves on its own result.
  const onShellPage = useGameShellPresent();
  const suppressedByRoute = isAccountFlowPath(pathname) || onShellPage;
  const onGameRoute = isGamePath(pathname);

  // One lightweight entry event per client-side navigation. This component is
  // already mounted globally, so no dashboard or per-game wiring is required.
  useEffect(() => {
    if (lastTrackedPathRef.current === pathname) return;
    lastTrackedPathRef.current = pathname;
    if (pathname === '/') {
      void trackProductEvent('landing_view', { source: 'arcade_home' });
      return;
    }
    const game = ARCADE_GAMES.find((entry) => routeMatchesPrefix(pathname, entry.href));
    if (game) {
      void trackProductEvent('game_started', {
        gameSlug: game.slug,
        source: 'game_route',
      });
    }
  }, [pathname]);

  useEffect(() => {
    setVisible(false);
    if (!loaded || account || suppressedByRoute) return;

    const sessionSuppressed = storageValue(sessionStorage, SESSION_STORAGE_KEY);
    if (sessionSuppressed === '1') return;

    const dismissedAtRaw = storageValue(localStorage, DISMISS_STORAGE_KEY);
    const dismissedAt = dismissedAtRaw ? Number(dismissedAtRaw) : 0;
    if (
      Number.isFinite(dismissedAt) &&
      dismissedAt > 0 &&
      Date.now() - dismissedAt < DISMISS_DURATION_MS
    ) {
      return;
    }

    // A prompt is earned by completing a guest run. There is intentionally no
    // elapsed-time fallback: visitors get to play before being asked to join.
    if (storageValue(sessionStorage, POST_RUN_STORAGE_KEY) === '1') {
      setVisible(true);
    }
  }, [account, loaded, pathname, suppressedByRoute]);

  useEffect(() => {
    if (!loaded || account || suppressedByRoute) return;

    const handleGuestRunCompleted = () => {
      if (storageValue(sessionStorage, SESSION_STORAGE_KEY) === '1') return;
      const dismissedAtRaw = storageValue(localStorage, DISMISS_STORAGE_KEY);
      const dismissedAt = dismissedAtRaw ? Number(dismissedAtRaw) : 0;
      if (
        Number.isFinite(dismissedAt) &&
        dismissedAt > 0 &&
        Date.now() - dismissedAt < DISMISS_DURATION_MS
      ) {
        return;
      }
      setStorageValue(sessionStorage, POST_RUN_STORAGE_KEY, '1');
      setVisible(true);
    };

    window.addEventListener(GUEST_RUN_COMPLETED_EVENT, handleGuestRunCompleted);
    return () => {
      window.removeEventListener(GUEST_RUN_COMPLETED_EVENT, handleGuestRunCompleted);
    };
  }, [account, loaded, suppressedByRoute]);

  useEffect(() => {
    if (!visible) return;
    void trackProductEvent('auth_nudge_shown', {
      source: onGameRoute ? 'post_run_game' : 'post_run_return',
    });
  }, [onGameRoute, visible]);

  const dismissForWeek = useCallback(() => {
    setStorageValue(localStorage, DISMISS_STORAGE_KEY, String(Date.now()));
    void trackProductEvent('auth_nudge_dismissed', { source: 'dismiss_week' });
    setVisible(false);
  }, []);

  const keepPlayingThisSession = useCallback(() => {
    setStorageValue(sessionStorage, SESSION_STORAGE_KEY, '1');
    void trackProductEvent('auth_nudge_dismissed', { source: 'keep_playing' });
    setVisible(false);
  }, []);

  const trackAuthClick = useCallback((target: 'signin' | 'signup') => {
    setAuthAttributionSource('post_run_nudge');
    void trackProductEvent('auth_nudge_clicked', {
      source: `post_run_${target}`,
    });
  }, []);

  if (!visible || !loaded || account || suppressedByRoute) return null;

  const signupHref = buildAuthHref('signup', nextPath);
  const signinHref = buildAuthHref('signin', nextPath);

  if (onGameRoute) {
    return (
      <div className='pointer-events-none fixed inset-x-0 bottom-[max(1rem,env(safe-area-inset-bottom))] z-[60] px-3 sm:px-4'>
        <aside
          role='dialog'
          aria-modal='false'
          aria-labelledby='guest-auth-nudge-title'
          className='pointer-events-auto mx-auto w-full max-w-xl overflow-hidden rounded-panel border-2 border-ink bg-panel shadow-modal'
        >
          <ArcadeMarquee
            tone='primary'
            size='sm'
            trailing={
              <ArcadeButton
                type='button'
                tone='ghost'
                size='icon-xs'
                aria-label='Dismiss sign-up prompt'
                onClick={dismissForWeek}
                className='text-inherit'
              >
                <X aria-hidden className='h-3.5 w-3.5' />
              </ArcadeButton>
            }
          >
            <span id='guest-auth-nudge-title'>Save your next run</span>
          </ArcadeMarquee>
          <div className='flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between'>
            <p className='text-sm text-body'>
              Nice run. Create a free player card to save future scores, earn tickets,
              and keep your inventory.
            </p>
            <div className='flex shrink-0 flex-wrap gap-2'>
              <ArcadeLinkButton
                href={signupHref}
                tone='primary'
                size='xs'
                onClick={() => trackAuthClick('signup')}
              >
                <UserPlus size={13} />
                Create free account
              </ArcadeLinkButton>
              <ArcadeLinkButton
                href={signinHref}
                tone='ghost'
                size='xs'
                onClick={() => trackAuthClick('signin')}
              >
                <LogIn size={13} />
                Sign in
              </ArcadeLinkButton>
              <ArcadeButton
                type='button'
                tone='ghost'
                size='xs'
                onClick={keepPlayingThisSession}
              >
                Keep playing with ads
              </ArcadeButton>
            </div>
          </div>
        </aside>
      </div>
    );
  }

  return (
    <ArcadeModal
      open
      title='Save your next run'
      tone='primary'
      onClose={dismissForWeek}
      maxWidth={520}
      actions={
        <div className='flex w-full flex-col-reverse gap-2 sm:flex-row sm:flex-wrap sm:justify-end'>
          <ArcadeButton
            type='button'
            tone='ghost'
            size='sm'
            onClick={keepPlayingThisSession}
          >
            Keep playing with ads
          </ArcadeButton>
          <ArcadeLinkButton
            href={signinHref}
            tone='ghost'
            size='sm'
            onClick={() => trackAuthClick('signin')}
          >
            <LogIn size={15} />
            Sign in
          </ArcadeLinkButton>
          <ArcadeLinkButton
            href={signupHref}
            tone='primary'
            size='sm'
            onClick={() => trackAuthClick('signup')}
          >
            <UserPlus size={15} />
            Create free account
          </ArcadeLinkButton>
        </div>
      }
    >
      <p className='text-sm text-body'>
        Nice run. Create a free player card to save future scores, earn tickets,
        and keep your inventory.
      </p>
    </ArcadeModal>
  );
}
