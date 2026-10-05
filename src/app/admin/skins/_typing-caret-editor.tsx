'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

import { InfoHint } from './_components';
import { contrastRatio } from './_types';
import type { ItemDraft, TypingCaretDraft } from './_types';

type CaretPreset = {
  id: string;
  label: string;
  draft: Partial<TypingCaretDraft>;
};

const CARET_PRESETS: CaretPreset[] = [
  {
    id: 'classic-bar',
    label: 'Classic Bar',
    draft: {
      caretType: 'bar',
      caretThickness: 3,
      caretGlowStrength: 20,
      caretPulseMode: 'none',
      caretTrailEnabled: false,
    },
  },
  {
    id: 'neon-beam',
    label: 'Neon Beam',
    draft: {
      caretType: 'bar',
      caretThickness: 4,
      caretGlowStrength: 70,
      caretPulseMode: 'strong',
      caretTrailEnabled: true,
    },
  },
  {
    id: 'focus-underline',
    label: 'Focus Underline',
    draft: {
      caretType: 'underline',
      caretThickness: 4,
      caretGlowStrength: 45,
      caretPulseMode: 'soft',
      caretTrailEnabled: false,
    },
  },
];

function ColorInput({
  label,
  value,
  onChange,
  hint,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  hint?: string;
}) {
  const [textValue, setTextValue] = useState(value);

  useEffect(() => {
    setTextValue(value);
  }, [value]);

  return (
    <label className='text-xs space-y-1'>
      <span className='inline-flex items-center'>
        {label}
        {hint ? <InfoHint text={hint} /> : null}
      </span>
      <div className='flex items-center gap-2'>
        <input
          type='color'
          className='h-8 w-10 cursor-pointer rounded border border-soft bg-transparent p-0'
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
        <input
          className='h-8 w-full rounded border border-soft bg-background px-2 font-mono text-[11px]'
          value={textValue}
          onChange={(event) => setTextValue(event.target.value)}
          onBlur={() => onChange(textValue)}
        />
      </div>
    </label>
  );
}

export function TypingCaretEditor({
  itemDraft,
  typingCaretDraft,
  setTypingCaretDraft,
}: {
  itemDraft: ItemDraft;
  typingCaretDraft: TypingCaretDraft;
  setTypingCaretDraft: React.Dispatch<React.SetStateAction<TypingCaretDraft>>;
}) {
  const warnings = useMemo(() => {
    const issues: string[] = [];
    if (contrastRatio(typingCaretDraft.caretColor, '#0f172a') < 1.2) {
      issues.push('Caret color may be hard to see on dark backgrounds.');
    }
    if (typingCaretDraft.caretType === 'underline' && typingCaretDraft.caretThickness < 2) {
      issues.push('Underline caret is usually clearer at 2px+ thickness.');
    }
    return issues;
  }, [typingCaretDraft]);

  const previewWords = useMemo(() => ['galactic', 'typing', 'drill'], []);
  const [previewStep, setPreviewStep] = useState(0);
  const previewContainerRef = useRef<HTMLDivElement | null>(null);
  const previousCaretPositionRef = useRef({
    left: 0,
    top: 0,
    width: typingCaretDraft.caretThickness,
    height: 18,
  });
  const [caretPosition, setCaretPosition] = useState({
    left: 0,
    top: 0,
    width: typingCaretDraft.caretThickness,
    height: 18,
  });
  const [trailPosition, setTrailPosition] = useState<{
    left: number;
    top: number;
    width: number;
    height: number;
  } | null>(null);
  const samePosition = (
    a: { left: number; top: number; width: number; height: number } | null,
    b: { left: number; top: number; width: number; height: number } | null,
  ) =>
    a?.left === b?.left &&
    a?.top === b?.top &&
    a?.width === b?.width &&
    a?.height === b?.height;

  const previewTypingState = useMemo(() => {
    const perWordSteps = previewWords.map((word) => word.length + 4);
    const totalSteps = perWordSteps.reduce((sum, steps) => sum + steps, 0);
    let cursor = totalSteps > 0 ? previewStep % totalSteps : 0;
    let currentWordIndex = 0;
    let currentInputLength = 0;

    for (let i = 0; i < previewWords.length; i += 1) {
      const word = previewWords[i];
      const segment = perWordSteps[i] ?? word.length + 4;
      if (cursor < segment) {
        currentWordIndex = i;
        currentInputLength = Math.min(cursor, word.length);
        break;
      }
      cursor -= segment;
    }

    const typedInputs = previewWords.map((word, index) => {
      if (index < currentWordIndex) return word;
      if (index > currentWordIndex) return '';
      return word.slice(0, currentInputLength);
    });

    return { currentWordIndex, currentInputLength, typedInputs };
  }, [previewStep, previewWords]);

  useEffect(() => {
    const interval = setInterval(() => {
      setPreviewStep((prev) => prev + 1);
    }, 130);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!previewContainerRef.current) return;
    const activeWord = previewContainerRef.current.querySelector(
      `[data-word-index="${previewTypingState.currentWordIndex}"]`,
    ) as HTMLElement | null;
    if (!activeWord) return;

    const chars = activeWord.querySelectorAll('[data-char-index]');
    if (chars.length === 0) return;

    let targetElement: HTMLElement | null = null;
    let offsetRight = false;
    if (previewTypingState.currentInputLength === 0) {
      targetElement = chars[0] as HTMLElement;
      offsetRight = false;
    } else {
      const index = Math.min(
        previewTypingState.currentInputLength - 1,
        chars.length - 1,
      );
      targetElement = chars[index] as HTMLElement;
      offsetRight = true;
    }
    if (!targetElement) return;

    const containerRect = previewContainerRef.current.getBoundingClientRect();
    const targetRect = targetElement.getBoundingClientRect();
    const baseLeft = offsetRight
      ? targetRect.right - containerRect.left
      : targetRect.left - containerRect.left;
    const baseTop = targetRect.top - containerRect.top + 2;
    const baseHeight = Math.max(4, targetRect.height - 4);
    const charWidth = Math.max(8, targetRect.width);

    let nextPosition:
      | { left: number; top: number; width: number; height: number }
      | undefined;
    if (typingCaretDraft.caretType === 'underline') {
      let underlineLeft = baseLeft;
      let underlineWidth = charWidth;
      if (previewTypingState.currentInputLength < chars.length) {
        const nextChar = chars[previewTypingState.currentInputLength] as
          | HTMLElement
          | undefined;
        if (nextChar) {
          const nextRect = nextChar.getBoundingClientRect();
          underlineLeft = nextRect.left - containerRect.left;
          underlineWidth = Math.max(8, nextRect.width);
        }
      }
      nextPosition = {
        left: underlineLeft,
        top: targetRect.bottom - containerRect.top - typingCaretDraft.caretThickness,
        width: underlineWidth,
        height: typingCaretDraft.caretThickness,
      };
    } else if (typingCaretDraft.caretType === 'block') {
      let blockLeft = baseLeft;
      let blockTop = baseTop;
      let blockWidth = charWidth;
      let blockHeight = baseHeight;
      if (previewTypingState.currentInputLength < chars.length) {
        const nextChar = chars[previewTypingState.currentInputLength] as
          | HTMLElement
          | undefined;
        if (nextChar) {
          const nextRect = nextChar.getBoundingClientRect();
          blockLeft = nextRect.left - containerRect.left;
          blockTop = nextRect.top - containerRect.top + 2;
          blockWidth = Math.max(8, nextRect.width);
          blockHeight = Math.max(4, nextRect.height - 4);
        }
      }
      nextPosition = {
        left: blockLeft,
        top: blockTop,
        width: blockWidth,
        height: blockHeight,
      };
    } else {
      nextPosition = {
        left: baseLeft,
        top: baseTop,
        width: typingCaretDraft.caretThickness,
        height: baseHeight,
      };
    }

    if (typingCaretDraft.caretTrailEnabled) {
      const nextTrail = previousCaretPositionRef.current;
      setTrailPosition((prev) => (samePosition(prev, nextTrail) ? prev : nextTrail));
    } else {
      setTrailPosition((prev) => (prev === null ? prev : null));
    }
    previousCaretPositionRef.current = nextPosition;
    setCaretPosition((prev) => (samePosition(prev, nextPosition) ? prev : nextPosition));
  }, [
    previewTypingState,
    typingCaretDraft.caretThickness,
    typingCaretDraft.caretTrailEnabled,
    typingCaretDraft.caretType,
  ]);

  const previewCaretStyle = useMemo(() => {
    const glowPx = Math.round(typingCaretDraft.caretGlowStrength / 6);
    const pulseClass =
      typingCaretDraft.caretPulseMode === 'strong'
        ? 'typing-caret-pulse-strong'
        : typingCaretDraft.caretPulseMode === 'soft'
          ? 'typing-caret-pulse-soft'
          : '';
    const common = {
      backgroundColor: typingCaretDraft.caretColor,
      boxShadow:
        glowPx > 0 ? `0 0 ${glowPx}px ${typingCaretDraft.caretColor}` : 'none',
    };
    return { common, pulseClass };
  }, [typingCaretDraft]);

  return (
    <div className='space-y-4 rounded-panel border border-soft bg-panel p-4'>
      <div className='flex flex-wrap items-start justify-between gap-3'>
        <div>
          <h3 className='text-sm font-semibold uppercase tracking-wide text-tickets-text'>
            Typing Caret Editor
          </h3>
          <p className='text-xs text-strong/80'>
            Configure cursor shape, pulse, glow, and trail behavior.
          </p>
        </div>
        <div className='flex flex-wrap gap-2'>
          {CARET_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type='button'
              className='rounded-tag border border-soft bg-raised px-2 py-1 text-[11px] text-body shadow-chip transition-[filter] duration-[140ms] hover:brightness-110'
              onClick={() =>
                setTypingCaretDraft((prev) => ({
                  ...prev,
                  ...preset.draft,
                }))
              }
            >
              {preset.label}
            </button>
          ))}
        </div>
      </div>

      <div className='grid gap-3 md:grid-cols-2 xl:grid-cols-4'>
        <label className='text-xs space-y-1'>
          <span className='inline-flex items-center'>
            Caret type
            <InfoHint text='Cursor shape used while typing.' />
          </span>
          <select
            className='h-8 w-full rounded border border-soft bg-background px-2 text-[11px]'
            value={typingCaretDraft.caretType}
            onChange={(event) =>
              setTypingCaretDraft((prev) => ({
                ...prev,
                caretType: event.target.value as TypingCaretDraft['caretType'],
              }))
            }
          >
            <option value='bar'>Bar</option>
            <option value='block'>Block</option>
            <option value='underline'>Underline</option>
          </select>
        </label>

        <label className='text-xs space-y-1'>
          <span className='inline-flex items-center'>
            Pulse mode
            <InfoHint text='Idle animation intensity.' />
          </span>
          <select
            className='h-8 w-full rounded border border-soft bg-background px-2 text-[11px]'
            value={typingCaretDraft.caretPulseMode}
            onChange={(event) =>
              setTypingCaretDraft((prev) => ({
                ...prev,
                caretPulseMode: event.target.value as TypingCaretDraft['caretPulseMode'],
              }))
            }
          >
            <option value='none'>None</option>
            <option value='soft'>Soft</option>
            <option value='strong'>Strong</option>
          </select>
        </label>

        <label className='text-xs space-y-1'>
          <span className='inline-flex items-center'>
            Thickness ({typingCaretDraft.caretThickness}px)
            <InfoHint text='Line thickness for bar/underline; affects block edge emphasis.' />
          </span>
          <input
            type='range'
            min={1}
            max={12}
            step={1}
            className='w-full'
            value={typingCaretDraft.caretThickness}
            onChange={(event) =>
              setTypingCaretDraft((prev) => ({
                ...prev,
                caretThickness: Number(event.target.value),
              }))
            }
          />
        </label>

        <label className='text-xs space-y-1'>
          <span className='inline-flex items-center'>
            Glow ({typingCaretDraft.caretGlowStrength})
            <InfoHint text='Glow intensity around the cursor.' />
          </span>
          <input
            type='range'
            min={0}
            max={100}
            step={1}
            className='w-full'
            value={typingCaretDraft.caretGlowStrength}
            onChange={(event) =>
              setTypingCaretDraft((prev) => ({
                ...prev,
                caretGlowStrength: Number(event.target.value),
              }))
            }
          />
        </label>
      </div>

      <div className='grid gap-3 md:grid-cols-2'>
        <ColorInput
          label='Caret color'
          value={typingCaretDraft.caretColor}
          onChange={(value) =>
            setTypingCaretDraft((prev) => ({ ...prev, caretColor: value }))
          }
        />
        <label className='flex items-center gap-2 self-end pb-1 text-xs'>
          <input
            type='checkbox'
            checked={typingCaretDraft.caretTrailEnabled}
            onChange={(event) =>
              setTypingCaretDraft((prev) => ({
                ...prev,
                caretTrailEnabled: event.target.checked,
              }))
            }
          />
          <span>Enable trail effect</span>
        </label>
      </div>

      {warnings.length > 0 ? (
        <ul className='list-disc space-y-1 pl-5 text-xs text-tickets-text'>
          {warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      ) : null}

      <div className='rounded-lg border border-soft bg-slate-950/70 p-3'>
        <p className='mb-2 text-[11px] uppercase tracking-wide text-faint'>
          Caret Preview ({itemDraft.gameType} / caret)
        </p>
        <style
          dangerouslySetInnerHTML={{
            __html: `
              .typing-caret-preview {
                position: absolute;
                pointer-events: none;
                transition: left 16ms linear, top 16ms linear, width 16ms linear, height 16ms linear;
                will-change: left, top, width, height, transform;
              }
              .typing-caret-pulse-soft {
                animation: caretPreviewPulseSoft 1.3s ease-in-out infinite;
              }
              .typing-caret-pulse-strong {
                animation: caretPreviewPulseStrong 0.95s ease-in-out infinite;
              }
              @keyframes caretPreviewPulseSoft {
                0%, 100% { opacity: 0.72; transform: scale(0.98); }
                50% { opacity: 1; transform: scale(1.02); }
              }
              @keyframes caretPreviewPulseStrong {
                0%, 100% { opacity: 0.55; transform: scale(0.94); }
                50% { opacity: 1; transform: scale(1.08); }
              }
            `,
          }}
        />
        <div
          ref={previewContainerRef}
          className='relative rounded border border-soft bg-slate-900/70 px-3 py-4 font-mono text-lg text-slate-200'
        >
          <div className='relative flex flex-wrap gap-x-2 gap-y-2'>
            {previewWords.map((word, wordIndex) => {
              const typedInput = previewTypingState.typedInputs[wordIndex] ?? '';
              const isActive = wordIndex === previewTypingState.currentWordIndex;
              const isTyped = wordIndex < previewTypingState.currentWordIndex;
              return (
                <span
                  key={word}
                  data-word-index={wordIndex}
                  className={`relative ${
                    isActive ? 'opacity-100' : isTyped ? 'opacity-65' : 'opacity-100'
                  }`}
                >
                  {word.split('').map((char, charIndex) => {
                    let colorValue = '#64748b';
                    if (isTyped || isActive) {
                      if (charIndex < typedInput.length) {
                        colorValue = typedInput[charIndex] === char ? '#e2e8f0' : '#ef4444';
                      }
                    }
                    return (
                      <span
                        key={`${wordIndex}-${charIndex}`}
                        data-char-index={charIndex}
                        style={{ color: colorValue }}
                      >
                        {char}
                      </span>
                    );
                  })}
                </span>
              );
            })}
          </div>

          {trailPosition ? (
            <span
              className='typing-caret-preview opacity-35 blur-[1px]'
              style={{
                left: `${trailPosition.left}px`,
                top: `${trailPosition.top}px`,
                width: `${trailPosition.width}px`,
                height: `${trailPosition.height}px`,
                borderRadius: typingCaretDraft.caretType === 'block' ? 2 : 999,
                ...previewCaretStyle.common,
              }}
            />
          ) : null}
          <span
            className={`typing-caret-preview ${previewCaretStyle.pulseClass}`}
            style={{
              left: `${caretPosition.left}px`,
              top: `${caretPosition.top}px`,
              width: `${caretPosition.width}px`,
              height: `${caretPosition.height}px`,
              borderRadius: typingCaretDraft.caretType === 'block' ? 2 : 999,
              opacity: typingCaretDraft.caretType === 'block' ? 0.45 : 1,
              ...previewCaretStyle.common,
            }}
          />
        </div>
      </div>
    </div>
  );
}
