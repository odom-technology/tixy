'use client';

import { useLayoutEffect, useRef, type ReactNode, type RefObject } from 'react';

import { FEEL, feelReducedMotion } from '@/features/arcade/lib/game-feel';
import { SoundManager } from '@/features/arcade/lib/sound-manager';

/** How long a card takes to cross from the shoe, and to turn over. */
export const DEAL_SLIDE_MS = 340;
export const DEAL_FLIP_MS = 320;

/** One soft sound per card as it turns face up. */
export function playCardFlip() {
  SoundManager.play('arcadeReveal', { volume: 0.5 });
}

/**
 * A card for the card machines (21, video poker). Both faces are in the DOM.
 * On mount the Web Animations API slides the card from `from` (the shoe) to
 * where it sits and, when `faceUp`, turns it over `delayMs` later. A later
 * change of `faceUp` turns it again (video poker's draw turns the cards you
 * let go to their backs, then the new ones up; 21's hole card turns at the
 * dealer's reveal). With reduced motion it simply shows the right side.
 * `front` and `back` must be the same size.
 */
export function DealtCard({
  front,
  back,
  faceUp = true,
  from,
  delayMs = 0,
  animate = true,
  onFlip,
}: {
  front: ReactNode;
  back: ReactNode;
  faceUp?: boolean;
  /** The shoe or deck the card slides out of. Without it the card only turns. */
  from?: RefObject<HTMLElement | null>;
  delayMs?: number;
  /** False for a card already on the table: it shows without arriving. */
  animate?: boolean;
  /** Called as the card reaches its face, for a sound. */
  onFlip?: () => void;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const flipRef = useRef(onFlip);
  const mounted = useRef(false);
  const shown = useRef(animate ? false : faceUp);
  flipRef.current = onFlip;

  useLayoutEffect(() => {
    const outer = wrap.current;
    const turn = inner.current;
    if (!outer || !turn) return;
    const animations: Animation[] = [];
    let timer: ReturnType<typeof setTimeout> | undefined;
    const playable = !feelReducedMotion() && typeof outer.animate === 'function';
    const first = !mounted.current;
    mounted.current = true;

    try {
      let flipDelay = delayMs;
      if (first && animate && playable) {
        const box = outer.getBoundingClientRect();
        const source = from?.current?.getBoundingClientRect();
        if (source && box.width > 0) {
          const dx = source.left + source.width / 2 - (box.left + box.width / 2);
          const dy = source.top + source.height / 2 - (box.top + box.height / 2);
          animations.push(
            outer.animate(
              [
                { transform: `translate(${dx}px, ${dy}px) rotate(-14deg) scale(0.82)`, opacity: 0.2 },
                { opacity: 1, offset: 0.2 },
                { transform: 'translate(0, 0) rotate(0deg) scale(1)', opacity: 1 },
              ],
              { duration: DEAL_SLIDE_MS, delay: delayMs, easing: FEEL.settleEase, fill: 'backwards' },
            ),
          );
          flipDelay += DEAL_SLIDE_MS * 0.4;
        }
      }
      if (shown.current !== faceUp && playable) {
        animations.push(
          turn.animate(
            [{ transform: `rotateY(${shown.current ? 0 : 180}deg)` }, { transform: `rotateY(${faceUp ? 0 : 180}deg)` }],
            { duration: DEAL_FLIP_MS, delay: flipDelay, easing: FEEL.springEase, fill: 'backwards' },
          ),
        );
        if (faceUp) {
          timer = setTimeout(() => flipRef.current?.(), flipDelay + DEAL_FLIP_MS * 0.5);
        }
      }
    } catch {
      // Motion is an enhancement.
    }
    shown.current = faceUp;
    return () => {
      if (timer) clearTimeout(timer);
      for (const animation of animations) animation.cancel();
    };
    // The deal plays on mount and again when the card turns.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [faceUp]);

  return (
    <div ref={wrap} className='arc-dealt-card' style={{ perspective: '900px' }}>
      <div
        ref={inner}
        className='arc-dealt-card-inner'
        style={{
          position: 'relative',
          transformStyle: 'preserve-3d',
          transform: faceUp ? 'rotateY(0deg)' : 'rotateY(180deg)',
        }}
      >
        <div style={{ backfaceVisibility: 'hidden' }}>{front}</div>
        <div style={{ position: 'absolute', inset: 0, backfaceVisibility: 'hidden', transform: 'rotateY(180deg)' }}>
          {back}
        </div>
      </div>
    </div>
  );
}
