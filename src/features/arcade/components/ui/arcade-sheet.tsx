'use client';

import { X } from 'lucide-react';
import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ComponentPropsWithoutRef,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';

import { usePresence } from '@/features/arcade/lib/use-presence';
import { ArcadeModal } from './arcade-interactive';

import './arcade-dialog.css';
import {
  ArcadeButton,
  ArcadeMarquee,
  type ArcadeEnamel,
  cx,
} from './arcade-ui';

const PHONE_QUERY = '(max-width: 639px)';
const subscribeNever = () => () => {};

/** True below the sm breakpoint, where dialogs become bottom sheets. */
function useIsPhone() {
  const [phone, setPhone] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const query = window.matchMedia(PHONE_QUERY);
    const update = () => setPhone(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return phone;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * A bottom sheet on phones and a modal from sm up. Use it for anything a
 * player opens on purpose: how to play, sign in, a challenge. It renders
 * into <body>, so it sits above the dock and doesn't pick up the tokens of
 * an ink surface it was opened from. While it is open the rest of the page
 * is inert and Tab stays inside it, on phones as well as desktop.
 */
export function ArcadeDialog({
  open,
  onClose,
  title,
  tone = 'primary',
  maxWidth = 384,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  tone?: ArcadeEnamel | 'cream';
  /** Desktop modal width in px. */
  maxWidth?: number;
  children: ReactNode;
}) {
  const phone = useIsPhone();
  // False on the server and in the hydration render, true after.
  const mounted = useSyncExternalStore(subscribeNever, () => true, () => false);
  const rootRef = useRef<HTMLDivElement>(null);
  // What had focus before the dialog took it. Layout effects run before the
  // sheet's and modal's own focus effects, so this is still the opener.
  const openerRef = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    if (open && document.activeElement instanceof HTMLElement) {
      openerRef.current = document.activeElement;
    }
  }, [open]);

  useEffect(() => {
    const root = rootRef.current;
    if (!open || !root) return;
    // Everything else in <body> goes inert, so neither a screen reader nor
    // Tab can leave the dialog.
    const others = Array.from(document.body.children).filter(
      (el): el is HTMLElement => el instanceof HTMLElement && el !== root && !el.inert,
    );
    for (const el of others) el.inert = true;

    // The desktop modal traps Tab itself; the sheet needs it here.
    const onKeyDown = (event: KeyboardEvent) => {
      if (!phone || event.key !== 'Tab') return;
      const focusable = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !root.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !root.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    };
    root.addEventListener('keydown', onKeyDown);
    return () => {
      for (const el of others) el.inert = false;
      root.removeEventListener('keydown', onKeyDown);
      // The sheet and modal hand focus back while the page is still inert,
      // which drops it on <body>. Hand it back again now that it can land.
      const opener = openerRef.current;
      const active = document.activeElement;
      if (opener?.isConnected && (!active || active === document.body || root.contains(active))) {
        opener.focus({ preventScroll: true });
      }
    };
  }, [open, phone, mounted]);

  if (!mounted) return null;
  return createPortal(
    <div ref={rootRef} className='arc-dialog-root'>
      {phone ? (
        <ArcadeSheet open={open} onClose={onClose} title={title} tone={tone}>
          {children}
        </ArcadeSheet>
      ) : (
        <ArcadeModal open={open} onClose={onClose} title={title} tone={tone} maxWidth={maxWidth}>
          {children}
        </ArcadeModal>
      )}
    </div>,
    document.body,
  );
}

/**
 * Midway bottom sheet — Vaul-style mobile pattern without the dependency.
 * Hard enamel cabinet chrome, spring slide-in, exit animation via usePresence.
 */
export function ArcadeSheet({
  open,
  onClose,
  title,
  tone = 'primary',
  children,
  className,
  ...props
}: ComponentPropsWithoutRef<'div'> & {
  open: boolean;
  onClose?: () => void;
  title: ReactNode;
  tone?: ArcadeEnamel | 'cream';
}) {
  const titleId = useId();
  const sheetRef = useRef<HTMLDivElement>(null);
  const { present, state } = usePresence(open, 180);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!present || state !== 'open') return;
    const sheet = sheetRef.current;
    if (!sheet) return;
    const restore =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    sheet.focus();

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onCloseRef.current?.();
      }
    };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
      restore?.focus();
    };
  }, [present, state]);

  if (!present) return null;

  return (
    <>
      <div
        className='arc-sheet-overlay'
        data-state={state}
        onClick={() => onClose?.()}
        aria-hidden
      />
      <div
        {...props}
        ref={sheetRef}
        role='dialog'
        aria-modal='true'
        aria-labelledby={titleId}
        tabIndex={-1}
        data-state={state}
        className={cx('arc-sheet outline-none', className)}
      >
        <div className='arc-sheet-handle' aria-hidden />
        <ArcadeMarquee
          tone={tone}
          size='md'
          trailing={
            onClose ? (
              <ArcadeButton
                tone='ghost'
                size='icon-xs'
                aria-label='close'
                onClick={onClose}
                className='text-inherit'
              >
                <X aria-hidden className='h-3.5 w-3.5' />
              </ArcadeButton>
            ) : null
          }
        >
          <span id={titleId}>{title}</span>
        </ArcadeMarquee>
        <div className='arc-sheet-body'>{children}</div>
      </div>
    </>
  );
}
