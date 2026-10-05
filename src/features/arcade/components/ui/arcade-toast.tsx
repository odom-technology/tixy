'use client';

import { X } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';

/**
 * The toast frame: a paper panel that lifts in from the edge on one axis
 * and goes the same way. The caller places it (fixed, bottom right) and owns
 * its timing. The achievement toaster draws its unlocks in it.
 */
export function ArcadeToast({
  state = 'open',
  icon,
  title,
  children,
  meta,
  href,
  linkLabel,
  onDismiss,
  dismissLabel = 'dismiss',
  className,
}: {
  state?: 'open' | 'closed';
  /** A badge or picture, 40 to 56 px. */
  icon?: ReactNode;
  /** The name of what happened, lowercase. */
  title: ReactNode;
  /** One sentence. */
  children?: ReactNode;
  /** A number line under the sentence: "+150 xp". */
  meta?: ReactNode;
  /** Makes the body a link. */
  href?: string;
  /** What the link says to a screen reader. */
  linkLabel?: string;
  onDismiss?: () => void;
  dismissLabel?: string;
  className?: string;
}) {
  const body = (
    <>
      {icon ? <span className='tx-toast-icon'>{icon}</span> : null}
      <span className='tx-toast-text'>
        <span className='tx-toast-title'>{title}</span>
        {children ? <span className='tx-toast-line'>{children}</span> : null}
        {meta ? <span className='tx-toast-meta'>{meta}</span> : null}
      </span>
    </>
  );
  return (
    <div data-state={state} className={['arc-toast tx-toast', className].filter(Boolean).join(' ')}>
      {href ? (
        <Link href={href} className='tx-toast-body' aria-label={linkLabel}>
          {body}
        </Link>
      ) : (
        <div className='tx-toast-body'>{body}</div>
      )}
      {onDismiss ? (
        <button type='button' onClick={onDismiss} className='tx-toast-close' aria-label={dismissLabel}>
          <X size={14} strokeWidth={2} strokeLinecap='square' aria-hidden />
        </button>
      ) : null}
    </div>
  );
}
