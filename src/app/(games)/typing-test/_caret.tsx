'use client';

import { useState, useEffect } from 'react';

// Smooth caret component that transitions position
export function Caret({
  wordsContainerRef,
  currentWordIndex,
  currentInputLength,
  caretColor,
  caretType,
  caretThickness,
  caretGlowStrength,
  caretPulseMode,
  caretTrailEnabled,
}: {
  wordsContainerRef: React.RefObject<HTMLDivElement | null>;
  currentWordIndex: number;
  currentInputLength: number;
  caretColor: string;
  caretType: 'bar' | 'block' | 'underline';
  caretThickness: number;
  caretGlowStrength: number;
  caretPulseMode: 'none' | 'soft' | 'strong';
  caretTrailEnabled: boolean;
}) {
  const [position, setPosition] = useState({
    left: 0,
    top: 0,
    width: 2.5,
    height: 0,
  });

  useEffect(() => {
    const updatePosition = () => {
      if (!wordsContainerRef.current) return;

      const activeWord = wordsContainerRef.current.querySelector(
        `[data-word-index="${currentWordIndex}"]`,
      ) as HTMLElement;
      if (!activeWord) return;

      const chars = activeWord.querySelectorAll('[data-char-index]');
      const extraChars = activeWord.querySelectorAll('[data-extra-index]');

      let targetElement: HTMLElement | null = null;
      let offsetRight = false;

      if (currentInputLength === 0) {
        // Before first character
        targetElement = chars[0] as HTMLElement;
        offsetRight = false;
      } else if (currentInputLength <= chars.length) {
        // After a typed character
        targetElement = chars[currentInputLength - 1] as HTMLElement;
        offsetRight = true;
      } else {
        // After extra characters
        const extraIndex = currentInputLength - chars.length - 1;
        if (extraChars[extraIndex]) {
          targetElement = extraChars[extraIndex] as HTMLElement;
          offsetRight = true;
        } else if (extraChars.length > 0) {
          targetElement = extraChars[extraChars.length - 1] as HTMLElement;
          offsetRight = true;
        } else {
          targetElement = chars[chars.length - 1] as HTMLElement;
          offsetRight = true;
        }
      }

      if (targetElement) {
        const containerRect = wordsContainerRef.current.getBoundingClientRect();
        const targetRect = targetElement.getBoundingClientRect();
        const baseLeft = offsetRight
          ? targetRect.right - containerRect.left
          : targetRect.left - containerRect.left;
        const baseTop = targetRect.top - containerRect.top + 2;
        const baseHeight = Math.max(4, targetRect.height - 4);
        const charWidth = Math.max(8, targetRect.width);

        if (caretType === 'underline') {
          let underlineLeft = baseLeft;
          let underlineWidth = charWidth;
          if (currentInputLength < chars.length) {
            const nextChar = chars[currentInputLength] as HTMLElement | undefined;
            if (nextChar) {
              const nextRect = nextChar.getBoundingClientRect();
              underlineLeft = nextRect.left - containerRect.left;
              underlineWidth = Math.max(8, nextRect.width);
            }
          }
          setPosition({
            left: underlineLeft,
            top: targetRect.bottom - containerRect.top - caretThickness,
            width: underlineWidth,
            height: caretThickness,
          });
        } else if (caretType === 'block') {
          let blockLeft = baseLeft;
          let blockTop = baseTop;
          let blockWidth = charWidth;
          let blockHeight = baseHeight;
          if (currentInputLength < chars.length) {
            const nextChar = chars[currentInputLength] as HTMLElement | undefined;
            if (nextChar) {
              const nextRect = nextChar.getBoundingClientRect();
              blockLeft = nextRect.left - containerRect.left;
              blockTop = nextRect.top - containerRect.top + 2;
              blockWidth = Math.max(8, nextRect.width);
              blockHeight = Math.max(4, nextRect.height - 4);
            }
          }
          setPosition({
            left: blockLeft,
            top: blockTop,
            width: blockWidth,
            height: blockHeight,
          });
        } else {
          setPosition({
            left: baseLeft,
            top: baseTop,
            width: caretThickness,
            height: baseHeight,
          });
        }
      }
    };

    // Use requestAnimationFrame for smooth updates
    const rafId = requestAnimationFrame(updatePosition);
    return () => cancelAnimationFrame(rafId);
  }, [
    wordsContainerRef,
    currentWordIndex,
    currentInputLength,
    caretThickness,
    caretType,
  ]);

  const pulseClass =
    caretPulseMode === 'strong'
      ? 'typing-caret-pulse-strong'
      : caretPulseMode === 'soft'
        ? 'typing-caret-pulse-soft'
        : '';
  const glowPx = Math.round(caretGlowStrength / 6);
  const boxShadow =
    glowPx > 0 ? `0 0 ${glowPx}px ${caretColor}` : 'none';
  const opacity = caretType === 'block' ? 0.45 : 1;

  return (
    <>
      {caretTrailEnabled ? (
        <div
          className='typing-caret opacity-35 blur-[1px]'
          style={{
            left: `${position.left - Math.max(1, Math.round(caretThickness / 2))}px`,
            top: `${position.top}px`,
            width: `${position.width}px`,
            height: `${position.height}px`,
            backgroundColor: caretColor,
            boxShadow,
          }}
        />
      ) : null}
      <div
        className={`typing-caret ${pulseClass}`}
        style={{
          left: `${position.left}px`,
          top: `${position.top}px`,
          width: `${position.width}px`,
          height: `${position.height}px`,
          backgroundColor: caretColor,
          boxShadow,
          opacity,
          borderRadius: caretType === 'block' ? '2px' : '9999px',
        }}
      />
    </>
  );
}
