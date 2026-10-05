'use client';

import {
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';

import { Num } from '@/features/arcade/components/ui/num';
import { isNumericLabel } from '@/features/arcade/components/gameplay/callout-motion';
import { useIsTixyTheme } from '@/features/arcade/lib/use-arcade-theme';

export type ArcadeGameHudTone =
  | 'neutral'
  | 'prize'
  | 'tickets'
  | 'danger'
  | 'info';

export type ArcadeGameHudMetric = {
  label: string;
  value: ReactNode;
  /** Remounts only the number plate so meaningful value changes get one pop. */
  pulseKey?: string | number;
  detail?: ReactNode;
  tone?: ArcadeGameHudTone;
  emphasis?: boolean;
};

export type ArcadeGameHudStatus = {
  label: ReactNode;
  tone?: ArcadeGameHudTone;
  pulseKey?: string | number;
};

function joinClassNames(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(' ');
}

export function ArcadeGameHud({
  metrics,
  status,
  actions,
  label = 'Game status',
  compact = false,
  className,
}: {
  metrics: ArcadeGameHudMetric[];
  status?: ArcadeGameHudStatus | null;
  actions?: ReactNode;
  label?: string;
  compact?: boolean;
  className?: string;
}) {
  return (
    <section
      className={joinClassNames('arc-game-hud', className)}
      data-compact={compact || undefined}
      aria-label={label}
    >
      <div className='arc-game-hud-metrics'>
        {metrics.map((metric) => (
          <div
            key={metric.label}
            className='arc-game-hud-metric'
            data-tone={metric.tone ?? 'neutral'}
            data-emphasis={metric.emphasis || undefined}
          >
            <span className='arc-game-hud-label'>{metric.label}</span>
            <span
              key={metric.pulseKey ?? String(metric.value)}
              className='arc-game-hud-value arcade-num'
            >
              {metric.value}
            </span>
            {metric.detail != null ? (
              <span className='arc-game-hud-detail'>{metric.detail}</span>
            ) : null}
          </div>
        ))}
      </div>
      {status ? (
        <div
          className='arc-game-hud-status'
          data-tone={status.tone ?? 'neutral'}
          key={status.pulseKey ?? String(status.label)}
          role='status'
        >
          <span className='arc-game-hud-status-dot' aria-hidden />
          <span>{status.label}</span>
        </div>
      ) : null}
      {actions ? <div className='arc-game-hud-actions'>{actions}</div> : null}
    </section>
  );
}

export type ArcadeGameplayCalloutTone =
  | 'score'
  | 'combo'
  | 'best'
  | 'success'
  | 'warning'
  | 'danger'
  | 'neutral';

export type ArcadeGameplayCallout = {
  id: number;
  label: ReactNode;
  detail?: ReactNode;
  tone: ArcadeGameplayCalloutTone;
  x?: number;
  y?: number;
  announce?: string;
  /** A number set big in the number face under the label: the score a new
   *  best reached, a combo's count. */
  value?: number;
  /** Prefix a positive `value` with +. */
  signed?: boolean;
  /** How long it shows, in ms. The motion is timed to it. */
  duration?: number;
};

/** The game shell's strip carries this slot; a new best lands there. */
export const SHELL_MOMENT_ATTR = 'data-shell-moment';

export function ArcadeGameplayCallouts({
  items,
  className,
}: {
  items: ArcadeGameplayCallout[];
  className?: string;
}) {
  const announcement = [...items].reverse().find((item) => item.announce)?.announce;
  const tixy = useIsTixyTheme();
  const layerRef = useRef<HTMLDivElement>(null);
  // Inside the game shell under tixy, a new best goes up into the strip, so
  // it never sits over the play. Elsewhere it stays in the stage's top band.
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => {
    const found = tixy
      ? layerRef.current
          ?.closest('.arc-shell-cabinet')
          ?.querySelector<HTMLElement>(`[${SHELL_MOMENT_ATTR}]`) ?? null
      : null;
    setSlot(found);
  }, [tixy]);

  const inStage = slot ? items.filter((item) => item.tone !== 'best') : items;
  const inStrip = slot ? items.filter((item) => item.tone === 'best') : [];

  return (
    <div
      ref={layerRef}
      className={joinClassNames('arc-game-callout-layer', className)}
      aria-hidden={!announcement}
    >
      {inStage.map((item, index) => (
        <Callout key={item.id} item={item} index={index} />
      ))}
      {slot && inStrip.length > 0
        ? createPortal(
            inStrip.map((item) => <Callout key={item.id} item={item} index={0} place='strip' />),
            slot,
          )
        : null}
      {announcement ? (
        <span className='sr-only' aria-live='polite'>
          {announcement}
        </span>
      ) : null}
    </div>
  );
}

function Callout({
  item,
  index,
  place,
}: {
  item: ArcadeGameplayCallout;
  index: number;
  place?: 'strip';
}) {
  return (
    <div
      className='arc-game-callout'
      data-tone={item.tone}
      data-place={place}
      data-numeric={isNumericLabel(item.label) || undefined}
      data-value={item.value != null || undefined}
      style={
        {
          '--callout-x': `${Math.max(0, Math.min(100, item.x ?? 50))}%`,
          '--callout-y': `${Math.max(0, Math.min(100, item.y ?? 26))}%`,
          '--callout-i': index,
          ...(item.duration ? { '--callout-ms': `${Math.max(160, item.duration)}ms` } : null),
        } as CSSProperties
      }
      aria-hidden='true'
    >
      <span className='arc-game-callout-label'>{item.label}</span>
      {item.value != null ? (
        <Num className='arc-game-callout-value' value={item.value} signed={item.signed} aria-hidden />
      ) : null}
      {item.detail != null ? (
        <span className='arc-game-callout-detail'>{item.detail}</span>
      ) : null}
    </div>
  );
}

/**
 * A start countdown drawn over the stage: 3, 2, 1, go. Pass the number on
 * screen, 'go', or null when it is done. Each value punches in on its own;
 * under reduced motion it simply shows. The game plays its own tick.
 */
export function ArcadeCountdown({
  value,
  className,
}: {
  value: number | 'go' | null;
  className?: string;
}) {
  if (value == null) return null;
  return (
    <div className={joinClassNames('arc-countdown', className)} role='status' aria-live='assertive'>
      <span key={String(value)} className='arc-countdown-value' data-go={value === 'go' || undefined}>
        {value === 'go' ? 'go' : <Num value={value} />}
      </span>
    </div>
  );
}
