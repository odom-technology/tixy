'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Info,
  Wrench,
  X,
} from 'lucide-react';
import { ArcadeButton, ArcadeAnchorButton } from '@/features/arcade/components/ui/arcade-ui';

import type { WarningBannerConfig } from '@/server/site-settings';

type SiteWarningBannerProps = {
  userId: string;
  versionToken: number | null;
  config: Pick<
    WarningBannerConfig,
    | 'message'
    | 'variant'
    | 'ctaLabel'
    | 'ctaHref'
    | 'dismissMode'
    | 'startAt'
    | 'endAt'
  >;
};

type VisibilityState = 'loading' | 'visible' | 'hidden';

function getDismissDurationMs(mode: WarningBannerConfig['dismissMode']) {
  if (mode === '24h') return 24 * 60 * 60 * 1000;
  if (mode === '7d') return 7 * 24 * 60 * 60 * 1000;
  return null;
}

function isExternalHttpLink(href: string) {
  return href.startsWith('https://') || href.startsWith('http://');
}

function formatDuration(milliseconds: number) {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const hh = String(hours).padStart(2, '0');
  const mm = String(minutes).padStart(2, '0');
  const ss = String(seconds).padStart(2, '0');
  if (days > 0) return `${days}d ${hh}:${mm}:${ss}`;
  return `${hh}:${mm}:${ss}`;
}

function formatDateTime(timestamp: number) {
  return new Intl.DateTimeFormat('en', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(timestamp));
}

/* Solid enamel per variant — the banner is a painted signage strip. */
function getBannerTone(variant: WarningBannerConfig['variant']) {
  if (variant === 'info') {
    return { wrapper: 'bg-info text-info-on', icon: Info, label: 'Info' };
  }
  if (variant === 'success') {
    return { wrapper: 'bg-prize text-prize-on', icon: CheckCircle2, label: 'Success' };
  }
  if (variant === 'critical') {
    return { wrapper: 'bg-danger text-danger-on', icon: AlertCircle, label: 'Critical' };
  }
  if (variant === 'maintenance') {
    return { wrapper: 'bg-danger text-danger-on', icon: Wrench, label: 'Maintenance' };
  }
  return { wrapper: 'bg-tickets text-tickets-on', icon: AlertTriangle, label: 'Notice' };
}

export function SiteWarningBanner({
  userId,
  versionToken,
  config,
}: SiteWarningBannerProps) {
  const [visibility, setVisibility] = useState<VisibilityState>('loading');
  const [now, setNow] = useState(() => Date.now());
  const isMaintenanceBanner = config.variant === 'maintenance';
  const tone = useMemo(() => getBannerTone(config.variant), [config.variant]);
  const dismissKey = useMemo(
    () =>
      `arcade:warning-banner-dismiss:${userId}:${versionToken ?? 'default'}`,
    [userId, versionToken],
  );

  useEffect(() => {
    if (!isMaintenanceBanner) return;
    const intervalId = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(intervalId);
  }, [isMaintenanceBanner]);

  useEffect(() => {
    if (isMaintenanceBanner || config.dismissMode === 'none') {
      setVisibility('visible');
      return;
    }

    try {
      if (config.dismissMode === 'session') {
        setVisibility(
          window.sessionStorage.getItem(dismissKey) === '1'
            ? 'hidden'
            : 'visible',
        );
        return;
      }

      const dismissedUntilRaw = window.localStorage.getItem(dismissKey);
      const dismissedUntil = dismissedUntilRaw ? Number(dismissedUntilRaw) : NaN;
      if (Number.isFinite(dismissedUntil) && dismissedUntil > Date.now()) {
        setVisibility('hidden');
        return;
      }
      window.localStorage.removeItem(dismissKey);
      setVisibility('visible');
    } catch {
      setVisibility('visible');
    }
  }, [config.dismissMode, dismissKey, isMaintenanceBanner]);

  const dismiss = () => {
    if (isMaintenanceBanner || config.dismissMode === 'none') return;
    try {
      if (config.dismissMode === 'session') {
        window.sessionStorage.setItem(dismissKey, '1');
      } else {
        const durationMs = getDismissDurationMs(config.dismissMode);
        if (durationMs) {
          window.localStorage.setItem(
            dismissKey,
            String(Date.now() + durationMs),
          );
        }
      }
    } catch {
      // Browser storage can be unavailable in private or hardened contexts.
    }
    setVisibility('hidden');
  };

  if (visibility !== 'visible') return null;

  const ctaHref = config.ctaHref.trim();
  const showCta =
    !isMaintenanceBanner && config.ctaLabel.trim() && ctaHref;
  const countdownLabel = (() => {
    if (!isMaintenanceBanner) return null;
    if (config.startAt && now < config.startAt) {
      return `Scheduled downtime starts in ${formatDuration(
        config.startAt - now,
      )} (${formatDateTime(config.startAt)}).`;
    }
    if (config.endAt && now < config.endAt) {
      return `Maintenance in progress. Estimated completion in ${formatDuration(
        config.endAt - now,
      )} (${formatDateTime(config.endAt)}).`;
    }
    if (config.startAt && now >= config.startAt) return 'Maintenance in progress.';
    return null;
  })();

  return (
    <div
      className={`mx-4 mt-4 rounded-panel border-2 border-ink px-5 py-4 shadow-panel md:mx-6 lg:mx-8 ${tone.wrapper}`}
    >
      <div className='flex items-start justify-between gap-3'>
        <div className='flex min-w-0 items-start gap-3'>
          <tone.icon className='mt-0.5 h-5 w-5 shrink-0' aria-hidden={true} />
          <div className='min-w-0'>
            <p className='text-xs font-bold tracking-[0.16em] uppercase'>
              {tone.label}
            </p>
            <p className='mt-1 text-sm font-medium break-words whitespace-pre-wrap'>
              {config.message}
            </p>
            {countdownLabel ? (
              <p className='arcade-num mt-2 text-xs font-semibold'>
                {countdownLabel}
              </p>
            ) : null}
            {showCta ? (
              <ArcadeAnchorButton
                href={ctaHref}
                target={isExternalHttpLink(ctaHref) ? '_blank' : undefined}
                rel={isExternalHttpLink(ctaHref) ? 'noreferrer' : undefined}
                tone='default'
                size='xs'
                className='mt-3'
              >
                {config.ctaLabel}
              </ArcadeAnchorButton>
            ) : null}
          </div>
        </div>

        {!isMaintenanceBanner && config.dismissMode !== 'none' ? (
          <ArcadeButton
            tone='default'
            size='icon-xs'
            onClick={dismiss}
            className='shrink-0'
            aria-label='Dismiss banner'
          >
            <X className='h-4 w-4' />
          </ArcadeButton>
        ) : null}
      </div>
    </div>
  );
}
