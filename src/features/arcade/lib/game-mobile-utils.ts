/**
 * Shared mobile utilities for all games.
 *
 * Provides hooks and helpers for:
 * - Preventing browser gestures during gameplay (pull-to-refresh, pinch zoom, scroll bounce)
 * - Detecting touch/mobile devices
 * - Safe area inset handling
 * - Responsive game viewport sizing
 */

import { useEffect, useSyncExternalStore } from 'react';

// ---------------------------------------------------------------------------
// Device detection
// ---------------------------------------------------------------------------

let _isTouchCached: boolean | null = null;

/**
 * Returns true if the device supports touch input (cached after first call).
 *
 * WARNING: returns false on the server, so calling this during render makes
 * the first client render disagree with the server HTML on touch devices
 * (hydration mismatch). Use it only inside event handlers and effects; use
 * `useIsTouchDevice()` for anything rendered.
 */
export function isTouchDevice(): boolean {
  if (_isTouchCached !== null) return _isTouchCached;
  if (typeof window === 'undefined') return false;
  _isTouchCached =
    'ontouchstart' in window ||
    navigator.maxTouchPoints > 0 ||
    // @ts-expect-error — vendor prefix
    navigator.msMaxTouchPoints > 0;
  return _isTouchCached;
}

// Touch capability does not change during a page's lifetime, so there is
// nothing to subscribe to; the snapshot is read once after hydration.
const _subscribeNoop = () => () => {};
const _getServerTouchSnapshot = () => false;

/**
 * Hydration-safe touch detection for use during render.
 *
 * Returns false during SSR and the first client render (matching the server
 * HTML exactly), then re-renders with the real touch capability immediately
 * after hydration. Instruction copy therefore swaps in without a hydration
 * mismatch.
 */
export function useIsTouchDevice(): boolean {
  return useSyncExternalStore(_subscribeNoop, isTouchDevice, _getServerTouchSnapshot);
}

// ---------------------------------------------------------------------------
// Gesture prevention
// ---------------------------------------------------------------------------

/**
 * Hook that tames disruptive browser-default gestures during gameplay without
 * locking the page. While `active` is true it:
 * - Prevents pull-to-refresh / scroll-chaining to the browser chrome
 *   (`overscroll-behavior: none`).
 * - Suppresses text selection while tapping controls (`user-select: none`).
 * - Blocks the long-press context menu.
 *
 * It deliberately does NOT lock page scrolling: players want to scroll the page
 * (mouse wheel / touch drag) to reposition the game within the viewport during
 * a run. Page scroll and canvas gameplay coexist because games that need
 * in-canvas touch gestures set `touch-action: none` on their own <canvas>
 * element (and preventDefault their own pointer/touch handlers), so the canvas
 * consumes those gestures while the surrounding page stays scrollable.
 * Keyboard scrolling (arrows/space) stays blocked during play via each game's
 * own keydown handlers, which is intended.
 *
 * Call with `active = true` when a game is in progress and `false` otherwise
 * so that normal page interactions work outside of gameplay.
 */
export function usePreventGameGestures(active: boolean): void {
  useEffect(() => {
    if (!active) return;

    const html = document.documentElement;
    const body = document.body;

    // Inline styles we add (and will remove on cleanup)
    const prev = {
      htmlOverscroll: html.style.overscrollBehavior,
      bodyOverscroll: body.style.overscrollBehavior,
      bodyUserSelect: body.style.userSelect,
      bodyWebkitUserSelect: (body.style as unknown as Record<string, string>).webkitUserSelect ?? '',
    };

    // Prevent pull-to-refresh and scroll-chaining without blocking in-page
    // scrolling (unlike `overflow: hidden` / `touch-action: none`, which would
    // freeze the page under the game).
    html.style.overscrollBehavior = 'none';
    body.style.overscrollBehavior = 'none';
    body.style.userSelect = 'none';
    (body.style as unknown as Record<string, string>).webkitUserSelect = 'none';

    // Block context menu (long-press on mobile). Does not affect scrolling.
    const onContextMenu = (e: Event) => {
      e.preventDefault();
    };

    document.addEventListener('contextmenu', onContextMenu, { passive: false });

    return () => {
      html.style.overscrollBehavior = prev.htmlOverscroll;
      body.style.overscrollBehavior = prev.bodyOverscroll;
      body.style.userSelect = prev.bodyUserSelect;
      (body.style as unknown as Record<string, string>).webkitUserSelect = prev.bodyWebkitUserSelect;
      document.removeEventListener('contextmenu', onContextMenu);
    };
  }, [active]);
}

// ---------------------------------------------------------------------------
// Instruction text helpers
// ---------------------------------------------------------------------------

/**
 * Returns context-appropriate control instructions based on device type.
 * Callers must pass a hydration-safe touch flag (see `useIsTouchDevice`).
 */
export function getControlInstructions(
  game: 'snake' | 'flappy-bird' | 'reaction-time' | 'typing-test',
  touch: boolean,
): { primary: string; secondary?: string } {
  switch (game) {
    case 'snake':
      return touch
        ? { primary: 'Swipe or use the d-pad to move' }
        : { primary: 'Arrow keys or WASD to move', secondary: 'P or Esc to pause' };
    case 'flappy-bird':
      return touch
        ? { primary: 'Tap anywhere to flap' }
        : { primary: 'Press Space or click to flap' };
    case 'reaction-time':
      return touch
        ? { primary: 'Tap when the screen turns green' }
        : { primary: 'Click when the screen turns green' };
    case 'typing-test':
      return touch
        ? { primary: 'Type on the on-screen keyboard' }
        : { primary: 'Start typing when ready' };
  }
}

// ---------------------------------------------------------------------------
// Reaction time tier system
// ---------------------------------------------------------------------------

type ReactionTier = {
  label: string;
  color: string;
  emoji: string;
  description: string;
};

/** Returns a tier classification for a given average reaction time in ms. */
export function getReactionTier(avgMs: number): ReactionTier {
  if (avgMs <= 160) {
    return { label: 'Lightning', color: '#f59e0b', emoji: '⚡', description: 'Superhuman reflexes' };
  }
  if (avgMs <= 200) {
    return { label: 'Blazing', color: '#ef4444', emoji: '🔥', description: 'Exceptionally fast' };
  }
  if (avgMs <= 250) {
    return { label: 'Fast', color: '#22c55e', emoji: '🏎️', description: 'Above average' };
  }
  if (avgMs <= 350) {
    return { label: 'Average', color: '#3b82f6', emoji: '👍', description: 'Right on target' };
  }
  if (avgMs <= 450) {
    return { label: 'Steady', color: '#8b5cf6', emoji: '🐢', description: 'Room to improve' };
  }
  return { label: 'Slow', color: '#6b7280', emoji: '😴', description: 'Keep practicing' };
}
