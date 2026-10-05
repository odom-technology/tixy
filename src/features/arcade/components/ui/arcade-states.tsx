import type { ReactNode } from 'react';

import { TixyHost } from '@/features/brand/tixy-host';

/**
 * Something is loading: three dots that step in turn, and the sentence that
 * says what ("Loading the table."). No ellipsis, no spinner text. Under
 * reduced motion the dots hold still. On an ink screen the dots turn paper.
 */
export function ArcadeLoading({
  label,
  size = 'md',
  className,
}: {
  /** One sentence with a full stop. Leave it out for the dots alone. */
  label?: string;
  size?: 'sm' | 'md';
  className?: string;
}) {
  return (
    <span
      className={['tx-loading', className].filter(Boolean).join(' ')}
      data-size={size}
      role='status'
      aria-label={label ? undefined : 'Loading.'}
    >
      <ArcadeLoadingDots />
      {label ? <span className='tx-loading-label'>{label}</span> : null}
    </span>
  );
}

/** The three dots alone, for a line that already says what is loading. */
export function ArcadeLoadingDots({ className }: { className?: string }) {
  return (
    <span className={['tx-dots', className].filter(Boolean).join(' ')} aria-hidden>
      <i />
      <i />
      <i />
    </span>
  );
}

/**
 * Nothing here yet: the host, one sentence and, if there is one, the thing
 * to do about it. The host turns up on empty screens and doesn't talk.
 */
export function ArcadeEmpty({
  title,
  children,
  action,
  host = true,
  className,
}: {
  /** A short lowercase heading, when the sentence needs one. */
  title?: ReactNode;
  /** One sentence: what would be here, and how it gets here. */
  children: ReactNode;
  /** One button. */
  action?: ReactNode;
  /** Leave the host out where space is tight (a row in a list). */
  host?: boolean;
  className?: string;
}) {
  return (
    <div className={['tx-empty', className].filter(Boolean).join(' ')} data-host={host || undefined}>
      {host ? <TixyHost width={72} className='tx-empty-host' /> : null}
      <div className='tx-empty-text'>
        {title ? <p className='tx-empty-title'>{title}</p> : null}
        <p className='tx-empty-line'>{children}</p>
        {action ? <div className='tx-empty-action'>{action}</div> : null}
      </div>
    </div>
  );
}
