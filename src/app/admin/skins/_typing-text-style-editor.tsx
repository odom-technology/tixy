'use client';

import { useEffect, useMemo, useState } from 'react';

import { InfoHint } from './_components';
import { contrastRatio } from './_types';
import type { ItemDraft, TypingTextStyleDraft } from './_types';

type TextStylePreset = {
  id: string;
  label: string;
  draft: Partial<TypingTextStyleDraft>;
};

const TEXT_STYLE_PRESETS: TextStylePreset[] = [
  {
    id: 'mono-clean',
    label: 'Mono Clean',
    draft: {
      textFontFamily: 'mono',
      textFontWeight: 500,
      textLetterSpacing: 0,
      textWordSpacing: 12,
      textCurrentWordStyle: 'underline',
      textCurrentWordColor: '#facc15',
      textCurrentWordStrength: 45,
    },
  },
  {
    id: 'sans-soft',
    label: 'Sans Soft',
    draft: {
      textFontFamily: 'sans',
      textFontWeight: 600,
      textLetterSpacing: 0.4,
      textWordSpacing: 14,
      textCurrentWordStyle: 'box',
      textCurrentWordColor: '#22d3ee',
      textCurrentWordStrength: 35,
    },
  },
  {
    id: 'serif-focus',
    label: 'Serif Focus',
    draft: {
      textFontFamily: 'serif',
      textFontWeight: 600,
      textLetterSpacing: 0.2,
      textWordSpacing: 15,
      textCurrentWordStyle: 'glow',
      textCurrentWordColor: '#f97316',
      textCurrentWordStrength: 70,
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

const getFontFamilyCss = (family: TypingTextStyleDraft['textFontFamily']) => {
  if (family === 'sans') return 'ui-sans-serif, system-ui, sans-serif';
  if (family === 'serif') return 'ui-serif, Georgia, Cambria, serif';
  return 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace';
};

export function TypingTextStyleEditor({
  itemDraft,
  typingTextStyleDraft,
  setTypingTextStyleDraft,
}: {
  itemDraft: ItemDraft;
  typingTextStyleDraft: TypingTextStyleDraft;
  setTypingTextStyleDraft: React.Dispatch<
    React.SetStateAction<TypingTextStyleDraft>
  >;
}) {
  const warnings = useMemo(() => {
    const issues: string[] = [];
    if (
      contrastRatio(typingTextStyleDraft.textColor, typingTextStyleDraft.correctColor) <
      1.15
    ) {
      issues.push('Base text and correct text are very similar.');
    }
    if (
      contrastRatio(typingTextStyleDraft.textCurrentWordColor, typingTextStyleDraft.textColor) <
      1.15
    ) {
      issues.push('Current-word highlight may not stand out enough.');
    }
    return issues;
  }, [typingTextStyleDraft]);

  const currentWordStyle = useMemo(() => {
    const alpha = Math.max(
      0.08,
      Math.min(0.7, typingTextStyleDraft.textCurrentWordStrength / 100),
    );
    if (typingTextStyleDraft.textCurrentWordStyle === 'underline') {
      return {
        borderBottom: `2px solid ${typingTextStyleDraft.textCurrentWordColor}`,
      };
    }
    if (typingTextStyleDraft.textCurrentWordStyle === 'box') {
      return {
        borderRadius: '0.35rem',
        backgroundColor: `${typingTextStyleDraft.textCurrentWordColor}${Math.round(alpha * 255)
          .toString(16)
          .padStart(2, '0')}`,
        paddingInline: '0.2rem',
      };
    }
    if (typingTextStyleDraft.textCurrentWordStyle === 'glow') {
      return {
        textShadow: `0 0 ${Math.round(typingTextStyleDraft.textCurrentWordStrength / 8) + 4}px ${typingTextStyleDraft.textCurrentWordColor}`,
      };
    }
    return {};
  }, [typingTextStyleDraft]);

  return (
    <div className='space-y-4 rounded-panel border border-soft bg-panel p-4'>
      <div className='flex flex-wrap items-start justify-between gap-3'>
        <div>
          <h3 className='text-sm font-semibold uppercase tracking-wide text-strong'>
            Typing Text Style Editor
          </h3>
          <p className='text-xs text-faint'>
            Configure word rendering and active-word emphasis.
          </p>
        </div>
        <div className='flex flex-wrap gap-2'>
          {TEXT_STYLE_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type='button'
              className='rounded-tag border border-soft bg-raised px-2 py-1 text-[11px] text-body shadow-chip transition-[filter] duration-[140ms] hover:brightness-110'
              onClick={() =>
                setTypingTextStyleDraft((prev) => ({
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
            Font family
            <InfoHint text='Main word font style.' />
          </span>
          <select
            className='h-8 w-full rounded border border-soft bg-background px-2 text-[11px]'
            value={typingTextStyleDraft.textFontFamily}
            onChange={(event) =>
              setTypingTextStyleDraft((prev) => ({
                ...prev,
                textFontFamily: event.target.value as TypingTextStyleDraft['textFontFamily'],
              }))
            }
          >
            <option value='mono'>Mono</option>
            <option value='sans'>Sans</option>
            <option value='serif'>Serif</option>
          </select>
        </label>

        <label className='text-xs space-y-1'>
          <span className='inline-flex items-center'>
            Font weight
            <InfoHint text='Character thickness.' />
          </span>
          <select
            className='h-8 w-full rounded border border-soft bg-background px-2 text-[11px]'
            value={typingTextStyleDraft.textFontWeight}
            onChange={(event) =>
              setTypingTextStyleDraft((prev) => ({
                ...prev,
                textFontWeight: Number(event.target.value) as TypingTextStyleDraft['textFontWeight'],
              }))
            }
          >
            <option value={400}>400</option>
            <option value={500}>500</option>
            <option value={600}>600</option>
            <option value={700}>700</option>
          </select>
        </label>

        <label className='text-xs space-y-1'>
          <span className='inline-flex items-center'>
            Letter spacing ({typingTextStyleDraft.textLetterSpacing.toFixed(1)}px)
            <InfoHint text='Spacing between letters.' />
          </span>
          <input
            type='range'
            min={-1}
            max={4}
            step={0.1}
            className='w-full'
            value={typingTextStyleDraft.textLetterSpacing}
            onChange={(event) =>
              setTypingTextStyleDraft((prev) => ({
                ...prev,
                textLetterSpacing: Number(event.target.value),
              }))
            }
          />
        </label>

        <label className='text-xs space-y-1'>
          <span className='inline-flex items-center'>
            Word spacing ({typingTextStyleDraft.textWordSpacing}px)
            <InfoHint text='Horizontal distance between words.' />
          </span>
          <input
            type='range'
            min={8}
            max={24}
            step={1}
            className='w-full'
            value={typingTextStyleDraft.textWordSpacing}
            onChange={(event) =>
              setTypingTextStyleDraft((prev) => ({
                ...prev,
                textWordSpacing: Number(event.target.value),
              }))
            }
          />
        </label>
      </div>

      <div className='grid gap-3 md:grid-cols-2 xl:grid-cols-4'>
        <label className='text-xs space-y-1'>
          <span className='inline-flex items-center'>
            Current word style
            <InfoHint text='How the active word is highlighted.' />
          </span>
          <select
            className='h-8 w-full rounded border border-soft bg-background px-2 text-[11px]'
            value={typingTextStyleDraft.textCurrentWordStyle}
            onChange={(event) =>
              setTypingTextStyleDraft((prev) => ({
                ...prev,
                textCurrentWordStyle:
                  event.target.value as TypingTextStyleDraft['textCurrentWordStyle'],
              }))
            }
          >
            <option value='none'>None</option>
            <option value='underline'>Underline</option>
            <option value='glow'>Glow</option>
            <option value='box'>Box</option>
          </select>
        </label>

        <label className='text-xs space-y-1'>
          <span className='inline-flex items-center'>
            Current word intensity ({typingTextStyleDraft.textCurrentWordStrength})
            <InfoHint text='Strength of active-word visual effect.' />
          </span>
          <input
            type='range'
            min={0}
            max={100}
            step={1}
            className='w-full'
            value={typingTextStyleDraft.textCurrentWordStrength}
            onChange={(event) =>
              setTypingTextStyleDraft((prev) => ({
                ...prev,
                textCurrentWordStrength: Number(event.target.value),
              }))
            }
          />
        </label>

        <ColorInput
          label='Base text color'
          value={typingTextStyleDraft.textColor}
          onChange={(value) =>
            setTypingTextStyleDraft((prev) => ({ ...prev, textColor: value }))
          }
        />
        <ColorInput
          label='Correct text color'
          value={typingTextStyleDraft.correctColor}
          onChange={(value) =>
            setTypingTextStyleDraft((prev) => ({ ...prev, correctColor: value }))
          }
        />
        <ColorInput
          label='Error text color'
          value={typingTextStyleDraft.errorColor}
          onChange={(value) =>
            setTypingTextStyleDraft((prev) => ({ ...prev, errorColor: value }))
          }
        />
        <ColorInput
          label='Current word color'
          value={typingTextStyleDraft.textCurrentWordColor}
          onChange={(value) =>
            setTypingTextStyleDraft((prev) => ({
              ...prev,
              textCurrentWordColor: value,
            }))
          }
        />
      </div>

      {warnings.length > 0 ? (
        <div className='rounded-well border border-soft bg-well p-2 text-[11px] text-strong'>
          <p className='font-medium'>Preview notes</p>
          <ul className='mt-1 list-disc pl-4'>
            {warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className='rounded-lg border border-soft bg-slate-950/70 p-3'>
        <p className='mb-2 text-[11px] uppercase tracking-wide text-faint'>
          Live Preview ({itemDraft.gameType} / text-style)
        </p>
        <div
          className='flex flex-wrap items-center gap-y-2 text-lg'
          style={{
            color: typingTextStyleDraft.textColor,
            fontFamily: getFontFamilyCss(typingTextStyleDraft.textFontFamily),
            fontWeight: typingTextStyleDraft.textFontWeight,
            letterSpacing: `${typingTextStyleDraft.textLetterSpacing}px`,
            columnGap: `${typingTextStyleDraft.textWordSpacing}px`,
            rowGap: `${Math.max(8, typingTextStyleDraft.textWordSpacing - 4)}px`,
          }}
        >
          <span style={{ color: typingTextStyleDraft.correctColor }}>fleet</span>
          <span style={currentWordStyle}>signal</span>
          <span style={{ color: typingTextStyleDraft.errorColor }}>drfit</span>
          <span>status</span>
          <span>transmit</span>
        </div>
      </div>
    </div>
  );
}
