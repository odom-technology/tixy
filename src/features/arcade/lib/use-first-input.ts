'use client';

import { useEffect, useRef, type RefObject } from 'react';

/* The first input starts the run, and the keys around a game stay where
   they belong. GameStage uses both hooks for you; call them yourself only
   for a stage the shell doesn't draw. See docs/design/tixy-rebrand/SHELL.md.

   useFirstInput: while `enabled`, a press on `target` (mouse, pen or touch)
   or one of `keys` anywhere on the page calls `onInput` once. Nothing else
   sees that press: not its pointerdown, touchstart, touchend, mousedown,
   mouseup or click, and not the key's repeats while it is held. So a game
   whose drop or flap handler also starts an idle run can't start twice.

   useGameKeyGuard: in every phase, keys aimed at a button, a link, a field
   or an open sheet never reach the game's window key handlers, and Space
   on an open sheet doesn't scroll the page. While a run is playing, space
   and the arrows (their repeats too) don't scroll the page either, nor does
   space after the run, on the result. */

export const FIRST_INPUT_KEYS = ['Space', 'Enter', 'ArrowUp'] as const;

/** What started the run. `x` and `y` are in CSS px from the screen's
 *  top-left corner, inside the bezel. */
export type GameInput = { kind: 'key'; code: string } | { kind: 'pointer'; x: number; y: number };

const INTERACTIVE =
  'a[href], button, input, select, textarea, summary, [contenteditable=""], [contenteditable="true"], [role="button"], [role="dialog"], [data-first-input="ignore"]';
const TEXT_FIELD = 'input, textarea, select, [contenteditable=""], [contenteditable="true"]';
const ACTIVATABLE = 'a[href], button, summary, [role="button"]';
const ACTIVATION_KEYS = ['Space', 'Enter'];
const SCROLL_KEYS = ['Space', 'ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End'];

function closest(target: EventTarget | null, selector: string): boolean {
  return target instanceof Element && target.closest(selector) !== null;
}

/** True when a key or press belongs to a control (a button, a field, an open
 *  sheet) and not to the game. The stage's screen is not a control. Games
 *  can use it in their own key handlers. */
export function isControlTarget(target: EventTarget | null): boolean {
  return closest(target, INTERACTIVE);
}

/** True while a modal dialog or sheet is open over the page. */
export function isDialogOpen(): boolean {
  if (typeof document === 'undefined') return false;
  return document.querySelector('[aria-modal="true"]') !== null;
}

export function useFirstInput({
  enabled,
  busy = false,
  onInput,
  target,
  keys = FIRST_INPUT_KEYS,
}: {
  enabled: boolean;
  /** Swallow presses without starting: a session or assets are loading. */
  busy?: boolean;
  onInput: (input: GameInput) => void;
  /** The element a press must land on: the stage's screen. */
  target: RefObject<HTMLElement | null>;
  /** `KeyboardEvent.code` values that start the run. */
  keys?: readonly string[];
}) {
  const onInputRef = useRef(onInput);
  onInputRef.current = onInput;
  const keysRef = useRef(keys);
  keysRef.current = keys;
  const busyRef = useRef(busy);
  busyRef.current = busy;
  // The press being swallowed. It outlives `enabled`: the run usually
  // starts before the finger lifts.
  const swallowUntilRef = useRef(0);
  const heldKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const el = target.current;

    // Capture on the screen, so the press stops before it reaches the
    // canvas and before React's root listener dispatches onPointerDown.
    const onPointerDown = (event: PointerEvent) => {
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      if (isControlTarget(event.target)) return;
      event.preventDefault();
      event.stopPropagation();
      swallowUntilRef.current = performance.now() + 1000;
      if (busyRef.current || !el) return;
      const rect = el.getBoundingClientRect();
      onInputRef.current({
        kind: 'pointer',
        x: event.clientX - rect.left - el.clientLeft,
        y: event.clientY - rect.top - el.clientTop,
      });
    };

    // Capture on window, which runs before every other key listener.
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      if (!keysRef.current.includes(event.code)) return;
      // A control's key: useGameKeyGuard keeps it from the game.
      if (isControlTarget(event.target) || isDialogOpen()) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.repeat) return;
      heldKeyRef.current = event.code;
      if (busyRef.current) return;
      onInputRef.current({ kind: 'key', code: event.code });
    };

    el?.addEventListener('pointerdown', onPointerDown, { capture: true });
    window.addEventListener('keydown', onKeyDown, { capture: true });
    return () => {
      el?.removeEventListener('pointerdown', onPointerDown, { capture: true });
      window.removeEventListener('keydown', onKeyDown, { capture: true });
    };
  }, [enabled, target]);

  // The rest of a swallowed press, in any phase.
  useEffect(() => {
    const el = target.current;
    const swallow = (event: Event) => {
      if (performance.now() > swallowUntilRef.current) return;
      if (event.cancelable) event.preventDefault();
      event.stopPropagation();
      if (event.type === 'click') swallowUntilRef.current = 0;
    };
    const types = ['touchstart', 'touchend', 'mousedown', 'mouseup', 'click'] as const;
    for (const type of types) el?.addEventListener(type, swallow, { capture: true, passive: false });

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.repeat && event.code === heldKeyRef.current) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code === heldKeyRef.current) heldKeyRef.current = null;
    };
    window.addEventListener('keydown', onKeyDown, { capture: true });
    window.addEventListener('keyup', onKeyUp, { capture: true });
    return () => {
      for (const type of types) el?.removeEventListener(type, swallow, { capture: true });
      window.removeEventListener('keydown', onKeyDown, { capture: true });
      window.removeEventListener('keyup', onKeyUp, { capture: true });
    };
  }, [target]);
}

/** Keys a game plays with that the page would also scroll on. */
const PLAY_SCROLL_KEYS = ['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];

/** Keeps control and sheet keys away from the game's window listeners, in
 *  every phase. It listens on document, after the control's own handlers
 *  and before window, where games listen.
 *
 *  `phase` is the stage's. While it is `playing`, the play keys (space and
 *  the arrows) never scroll the page, the repeats a held key sends included,
 *  unless they are aimed at a control, a field or an open sheet. While it is
 *  `over`, space doesn't either (it plays again, and a key still held from
 *  the last swing keeps repeating into the result). The game still hears
 *  them: only the page's default is stopped. In `ready`, useFirstInput
 *  already owns them. */
export function useGameKeyGuard(keys: readonly string[] = FIRST_INPUT_KEYS, phase?: 'ready' | 'playing' | 'over') {
  const keysRef = useRef(keys);
  keysRef.current = keys;
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // A field keeps its keys, and a game that types into its own field
      // keeps hearing them.
      if (closest(event.target, TEXT_FIELD)) return;
      if (isDialogOpen()) {
        event.stopPropagation();
        if (SCROLL_KEYS.includes(event.code) && !closest(event.target, ACTIVATABLE)) {
          event.preventDefault();
        }
        return;
      }
      if (
        isControlTarget(event.target) &&
        (ACTIVATION_KEYS.includes(event.code) || keysRef.current.includes(event.code))
      ) {
        event.stopPropagation();
        return;
      }
      if (isControlTarget(event.target) || event.altKey || event.ctrlKey || event.metaKey) return;
      const owned =
        (phaseRef.current === 'playing' && PLAY_SCROLL_KEYS.includes(event.code)) ||
        (phaseRef.current === 'over' && event.code === 'Space');
      if (owned) event.preventDefault();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);
}
