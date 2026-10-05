'use client';

import { useEffect, useMemo, useState } from 'react';
import type { RewardGameType } from '@/features/arcade/lib/rewards';
import { StoreItemPreview } from '@/features/arcade/components/store-item-preview';
import { InfoHint } from './_components';
import { contrastRatio } from './_types';
import type { ItemDraft, TypingFeedbackDraft } from './_types';

type FeedbackPreset = {
  id: string;
  label: string;
  draft: Partial<TypingFeedbackDraft>;
};

const FEEDBACK_PRESETS: FeedbackPreset[] = [
  {
    id: 'clean-underline',
    label: 'Clean Underline',
    draft: {
      missEffectColor: '#fb7185',
      feedbackStyle: 'underline',
      feedbackStrength: 40,
      feedbackDurationMs: 140,
      feedbackParticlesEnabled: false,
    },
  },
  {
    id: 'reactive-shake',
    label: 'Reactive Shake',
    draft: {
      missEffectColor: '#f43f5e',
      feedbackStyle: 'shake',
      feedbackStrength: 70,
      feedbackDurationMs: 180,
      feedbackParticlesEnabled: false,
    },
  },
  {
    id: 'impact-burst',
    label: 'Impact Burst',
    draft: {
      missEffectColor: '#fb7185',
      feedbackStyle: 'particles',
      feedbackStrength: 82,
      feedbackDurationMs: 220,
      feedbackParticlesEnabled: true,
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

export function TypingFeedbackEditor({
  itemDraft,
  typingFeedbackDraft,
  setTypingFeedbackDraft,
  editorPreviewAssetRef,
}: {
  itemDraft: ItemDraft;
  typingFeedbackDraft: TypingFeedbackDraft;
  setTypingFeedbackDraft: React.Dispatch<React.SetStateAction<TypingFeedbackDraft>>;
  editorPreviewAssetRef: Record<string, unknown> | null;
}) {
  const warnings = useMemo(() => {
    const issues: string[] = [];
    if (contrastRatio(typingFeedbackDraft.missEffectColor, '#111827') < 1.4) {
      issues.push('Miss effect color may be too subtle on dark backgrounds.');
    }
    if (typingFeedbackDraft.feedbackStyle === 'none' && typingFeedbackDraft.feedbackStrength > 10) {
      issues.push('Feedback strength is high, but style is set to none.');
    }
    return issues;
  }, [typingFeedbackDraft]);

  const feedbackPreviewStyle = useMemo(() => {
    const duration = Math.max(80, typingFeedbackDraft.feedbackDurationMs);
    const strength = Math.max(0, typingFeedbackDraft.feedbackStrength);
    if (typingFeedbackDraft.feedbackStyle === 'none') return {};
    if (typingFeedbackDraft.feedbackStyle === 'underline') {
      return {
        borderBottom: `2px solid ${typingFeedbackDraft.missEffectColor}`,
      };
    }
    if (typingFeedbackDraft.feedbackStyle === 'shake') {
      const shakeDistance = 1 + Math.round(strength / 30);
      return {
        animation: `typingFeedbackShake ${duration}ms ease-in-out infinite`,
        ['--typing-feedback-shake-distance' as string]: `${shakeDistance}px`,
      };
    }
    if (typingFeedbackDraft.feedbackStyle === 'flash') {
      return {
        animation: `typingFeedbackFlash ${duration}ms ease-in-out infinite`,
      };
    }
    return {
      textShadow: `0 0 ${4 + Math.round(strength / 6)}px ${typingFeedbackDraft.missEffectColor}, 0 0 ${8 + Math.round(strength / 4)}px ${typingFeedbackDraft.missEffectColor}`,
      animation: typingFeedbackDraft.feedbackParticlesEnabled
        ? `typingFeedbackParticlePulse ${duration}ms ease-in-out infinite`
        : undefined,
    };
  }, [typingFeedbackDraft]);

  return (
    <div className='space-y-4 rounded-panel border border-soft bg-panel p-4'>
      <div className='flex flex-wrap items-start justify-between gap-3'>
        <div>
          <h3 className='text-sm font-semibold uppercase tracking-wide text-danger-text'>
            Typing Feedback Editor
          </h3>
          <p className='text-xs text-faint'>
            Configure incorrect character feedback visuals.
          </p>
        </div>
        <div className='flex flex-wrap gap-2'>
          {FEEDBACK_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type='button'
              className='rounded-tag border border-soft bg-raised px-2 py-1 text-[11px] text-body shadow-chip transition-[filter] duration-[140ms] hover:brightness-110'
              onClick={() =>
                setTypingFeedbackDraft((prev) => ({
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
            Feedback style
            <InfoHint text='Primary incorrect-input feedback style.' />
          </span>
          <select
            className='h-8 w-full rounded border border-soft bg-background px-2 text-[11px]'
            value={typingFeedbackDraft.feedbackStyle}
            onChange={(event) =>
              setTypingFeedbackDraft((prev) => ({
                ...prev,
                feedbackStyle: event.target.value as TypingFeedbackDraft['feedbackStyle'],
              }))
            }
          >
            <option value='none'>none</option>
            <option value='underline'>underline</option>
            <option value='shake'>shake</option>
            <option value='flash'>flash</option>
            <option value='particles'>particles</option>
          </select>
        </label>

        <label className='text-xs space-y-1'>
          <span className='inline-flex items-center'>
            Strength
            <span className='ml-1 text-[10px] text-faint'>
              {typingFeedbackDraft.feedbackStrength}
            </span>
          </span>
          <input
            type='range'
            min={0}
            max={100}
            className='w-full'
            value={typingFeedbackDraft.feedbackStrength}
            onChange={(event) =>
              setTypingFeedbackDraft((prev) => ({
                ...prev,
                feedbackStrength: Number(event.target.value),
              }))
            }
          />
        </label>

        <label className='text-xs space-y-1'>
          <span className='inline-flex items-center'>
            Duration (ms)
            <span className='ml-1 text-[10px] text-faint'>
              {typingFeedbackDraft.feedbackDurationMs}
            </span>
          </span>
          <input
            type='range'
            min={80}
            max={500}
            step={10}
            className='w-full'
            value={typingFeedbackDraft.feedbackDurationMs}
            onChange={(event) =>
              setTypingFeedbackDraft((prev) => ({
                ...prev,
                feedbackDurationMs: Number(event.target.value),
              }))
            }
          />
        </label>

        <label className='flex items-center gap-2 text-xs pt-6'>
          <input
            type='checkbox'
            checked={typingFeedbackDraft.feedbackParticlesEnabled}
            onChange={(event) =>
              setTypingFeedbackDraft((prev) => ({
                ...prev,
                feedbackParticlesEnabled: event.target.checked,
              }))
            }
          />
          <span>Enable particles</span>
        </label>

        <ColorInput
          label='Miss Effect Color'
          value={typingFeedbackDraft.missEffectColor}
          onChange={(value) =>
            setTypingFeedbackDraft((prev) => ({ ...prev, missEffectColor: value }))
          }
          hint='Color used for incorrect character feedback.'
        />
      </div>

      <div className='rounded-lg border border-soft bg-slate-950/60 p-3 space-y-2'>
        <p className='text-[11px] uppercase tracking-wide text-faint'>Feedback Preview</p>
        <div className='rounded-md border border-slate-800 bg-slate-950/70 px-3 py-2 font-mono text-sm'>
          <span style={{ color: '#e2e8f0' }}>focus </span>
          <span style={{ color: '#e2e8f0' }}>word </span>
          <span
            className='inline-block'
            style={{
              color: typingFeedbackDraft.missEffectColor,
              ...feedbackPreviewStyle,
            }}
          >
            mistyped
          </span>
        </div>
        <style
          dangerouslySetInnerHTML={{
            __html: `
              @keyframes typingFeedbackShake {
                0%, 100% { transform: translateX(0); }
                25% { transform: translateX(calc(var(--typing-feedback-shake-distance, 1px) * -1)); }
                75% { transform: translateX(var(--typing-feedback-shake-distance, 1px)); }
              }
              @keyframes typingFeedbackFlash {
                0%, 100% { opacity: 1; }
                50% { opacity: 0.45; }
              }
              @keyframes typingFeedbackParticlePulse {
                0%, 100% { filter: brightness(0.9); }
                50% { filter: brightness(1.35); }
              }
            `,
          }}
        />
      </div>

      {warnings.length > 0 ? (
        <ul className='list-disc space-y-1 pl-5 text-xs text-tickets-text'>
          {warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      ) : null}

      <div className='rounded-lg border border-soft bg-slate-900/40 p-3'>
        <StoreItemPreview
          item={{
            name: itemDraft.name || 'Typing Feedback Item',
            gameType: itemDraft.gameType as RewardGameType,
            slots: itemDraft.slots,
            assetRef: editorPreviewAssetRef,
          }}
          snakeAlign='center'
        />
      </div>
    </div>
  );
}
