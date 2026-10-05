'use client';

import { useEffect, useMemo, useState } from 'react';
import type { RewardGameType } from '@/features/arcade/lib/rewards';
import { StoreItemPreview } from '@/features/arcade/components/store-item-preview';
import { InfoHint } from './_components';
import { contrastRatio } from './_types';
import type { ItemDraft, TypingThemeDraft } from './_types';

type ThemePreset = {
  id: string;
  label: string;
  draft: Partial<TypingThemeDraft>;
};

const THEME_PRESETS: ThemePreset[] = [
  {
    id: 'glass-cyan',
    label: 'Glass Cyan',
    draft: {
      themeBackgroundColor: '#0a1322',
      themeSurfaceColor: '#10243f',
      themeBorderColor: '#335a88',
      themeTextColor: '#dbeafe',
      themeAccentColor: '#22d3ee',
      themeErrorColor: '#f43f5e',
      themeSuccessColor: '#34d399',
      hudFrameStyle: 'glass',
      hudBadgeStyle: 'pill',
      hudMeterStyle: 'bar',
      hudShadowStrength: 42,
    },
  },
  {
    id: 'terminal-green',
    label: 'Terminal Green',
    draft: {
      themeBackgroundColor: '#05140d',
      themeSurfaceColor: '#0a2317',
      themeBorderColor: '#1e5f3a',
      themeTextColor: '#dcfce7',
      themeAccentColor: '#22c55e',
      themeErrorColor: '#fb7185',
      themeSuccessColor: '#4ade80',
      hudFrameStyle: 'terminal',
      hudBadgeStyle: 'block',
      hudMeterStyle: 'pulse',
      hudShadowStrength: 28,
    },
  },
  {
    id: 'neon-violet',
    label: 'Neon Violet',
    draft: {
      themeBackgroundColor: '#09051d',
      themeSurfaceColor: '#1a1240',
      themeBorderColor: '#8b5cf6',
      themeTextColor: '#ede9fe',
      themeAccentColor: '#c084fc',
      themeErrorColor: '#fb7185',
      themeSuccessColor: '#22c55e',
      hudFrameStyle: 'neon',
      hudBadgeStyle: 'chip',
      hudMeterStyle: 'ring',
      hudShadowStrength: 70,
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

export function TypingThemeEditor({
  itemDraft,
  typingThemeDraft,
  setTypingThemeDraft,
  editorPreviewAssetRef,
}: {
  itemDraft: ItemDraft;
  typingThemeDraft: TypingThemeDraft;
  setTypingThemeDraft: React.Dispatch<React.SetStateAction<TypingThemeDraft>>;
  editorPreviewAssetRef: Record<string, unknown> | null;
}) {
  const warnings = useMemo(() => {
    const issues: string[] = [];
    if (
      contrastRatio(
        typingThemeDraft.themeSurfaceColor,
        typingThemeDraft.themeTextColor,
      ) < 2
    ) {
      issues.push('Surface and text contrast is low for readability.');
    }
    if (
      contrastRatio(
        typingThemeDraft.themeBackgroundColor,
        typingThemeDraft.themeSurfaceColor,
      ) < 1.15
    ) {
      issues.push('Background and surface are very similar.');
    }
    if (
      contrastRatio(
        typingThemeDraft.themeAccentColor,
        typingThemeDraft.themeSurfaceColor,
      ) < 1.2
    ) {
      issues.push('Accent color may not stand out enough.');
    }
    return issues;
  }, [typingThemeDraft]);

  const frameClass = (() => {
    if (typingThemeDraft.hudFrameStyle === 'neon') return 'border-2';
    if (typingThemeDraft.hudFrameStyle === 'terminal') return 'border border-dashed';
    if (typingThemeDraft.hudFrameStyle === 'glass') return 'border backdrop-blur-sm';
    return 'border';
  })();

  const frameStyle = useMemo(() => {
    if (typingThemeDraft.hudFrameStyle === 'neon') {
      return {
        backgroundColor: typingThemeDraft.themeSurfaceColor,
        borderColor: typingThemeDraft.themeAccentColor,
        color: typingThemeDraft.themeTextColor,
        boxShadow: `0 0 ${Math.round(typingThemeDraft.hudShadowStrength / 2)}px ${typingThemeDraft.themeAccentColor}, 0 0 ${Math.round(typingThemeDraft.hudShadowStrength / 4)}px ${typingThemeDraft.themeAccentColor} inset`,
      };
    }
    if (typingThemeDraft.hudFrameStyle === 'terminal') {
      return {
        backgroundColor: typingThemeDraft.themeSurfaceColor,
        borderColor: typingThemeDraft.themeBorderColor,
        color: typingThemeDraft.themeTextColor,
        backgroundImage:
          'repeating-linear-gradient(0deg, rgba(255,255,255,0.03) 0px, rgba(255,255,255,0.03) 1px, transparent 1px, transparent 3px)',
        boxShadow: `inset 0 0 ${Math.round(typingThemeDraft.hudShadowStrength / 4)}px ${typingThemeDraft.themeAccentColor}44`,
      };
    }
    if (typingThemeDraft.hudFrameStyle === 'glass') {
      return {
        background: `linear-gradient(135deg, ${typingThemeDraft.themeSurfaceColor}ee, ${typingThemeDraft.themeSurfaceColor}aa)`,
        borderColor: typingThemeDraft.themeBorderColor,
        color: typingThemeDraft.themeTextColor,
        boxShadow: `0 8px 24px ${typingThemeDraft.themeAccentColor}22`,
      };
    }
    return {
      backgroundColor: typingThemeDraft.themeSurfaceColor,
      borderColor: typingThemeDraft.themeBorderColor,
      color: typingThemeDraft.themeTextColor,
      boxShadow: `0 0 ${Math.round(typingThemeDraft.hudShadowStrength / 8)}px ${typingThemeDraft.themeAccentColor}44`,
    };
  }, [typingThemeDraft]);

  return (
    <div className='space-y-4 rounded-panel border border-soft bg-panel p-4'>
      <div className='flex flex-wrap items-start justify-between gap-3'>
        <div>
          <h3 className='text-sm font-semibold uppercase tracking-wide text-strong'>
            Typing Theme Editor
          </h3>
          <p className='text-xs text-faint'>
            Theme now includes full HUD controls and page palette.
          </p>
        </div>
        <div className='flex flex-wrap gap-2'>
          {THEME_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type='button'
              className='rounded-tag border border-soft bg-raised px-2 py-1 text-[11px] text-body shadow-chip transition-[filter] duration-[140ms] hover:brightness-110'
              onClick={() =>
                setTypingThemeDraft((prev) => ({
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
            Frame style
            <InfoHint text='Main HUD container treatment.' />
          </span>
          <select
            className='h-8 w-full rounded border border-soft bg-background px-2 text-[11px]'
            value={typingThemeDraft.hudFrameStyle}
            onChange={(event) =>
              setTypingThemeDraft((prev) => ({
                ...prev,
                hudFrameStyle: event.target.value as TypingThemeDraft['hudFrameStyle'],
              }))
            }
          >
            <option value='minimal'>minimal</option>
            <option value='glass'>glass</option>
            <option value='neon'>neon</option>
            <option value='terminal'>terminal</option>
          </select>
        </label>

        <label className='text-xs space-y-1'>
          <span className='inline-flex items-center'>
            Badge style
            <InfoHint text='Chip style for WPM/ACC/time stats.' />
          </span>
          <select
            className='h-8 w-full rounded border border-soft bg-background px-2 text-[11px]'
            value={typingThemeDraft.hudBadgeStyle}
            onChange={(event) =>
              setTypingThemeDraft((prev) => ({
                ...prev,
                hudBadgeStyle: event.target.value as TypingThemeDraft['hudBadgeStyle'],
              }))
            }
          >
            <option value='pill'>pill</option>
            <option value='chip'>chip</option>
            <option value='block'>block</option>
            <option value='outline'>outline</option>
          </select>
        </label>

        <label className='text-xs space-y-1'>
          <span className='inline-flex items-center'>
            Meter style
            <InfoHint text='Progress meter appearance.' />
          </span>
          <select
            className='h-8 w-full rounded border border-soft bg-background px-2 text-[11px]'
            value={typingThemeDraft.hudMeterStyle}
            onChange={(event) =>
              setTypingThemeDraft((prev) => ({
                ...prev,
                hudMeterStyle: event.target.value as TypingThemeDraft['hudMeterStyle'],
              }))
            }
          >
            <option value='none'>none</option>
            <option value='bar'>bar</option>
            <option value='ring'>ring</option>
            <option value='pulse'>pulse</option>
          </select>
        </label>

        <label className='text-xs space-y-1'>
          <span className='inline-flex items-center'>
            Shadow strength
            <span className='ml-1 text-[10px] text-faint'>
              {typingThemeDraft.hudShadowStrength}
            </span>
          </span>
          <input
            type='range'
            min={0}
            max={100}
            className='w-full'
            value={typingThemeDraft.hudShadowStrength}
            onChange={(event) =>
              setTypingThemeDraft((prev) => ({
                ...prev,
                hudShadowStrength: Number(event.target.value),
              }))
            }
          />
        </label>

        <ColorInput
          label='Background'
          value={typingThemeDraft.themeBackgroundColor}
          onChange={(value) =>
            setTypingThemeDraft((prev) => ({ ...prev, themeBackgroundColor: value }))
          }
        />
        <ColorInput
          label='Surface'
          value={typingThemeDraft.themeSurfaceColor}
          onChange={(value) =>
            setTypingThemeDraft((prev) => ({ ...prev, themeSurfaceColor: value }))
          }
        />
        <ColorInput
          label='Border'
          value={typingThemeDraft.themeBorderColor}
          onChange={(value) =>
            setTypingThemeDraft((prev) => ({ ...prev, themeBorderColor: value }))
          }
        />
        <ColorInput
          label='Text'
          value={typingThemeDraft.themeTextColor}
          onChange={(value) =>
            setTypingThemeDraft((prev) => ({ ...prev, themeTextColor: value }))
          }
        />
        <ColorInput
          label='Accent'
          value={typingThemeDraft.themeAccentColor}
          onChange={(value) =>
            setTypingThemeDraft((prev) => ({ ...prev, themeAccentColor: value }))
          }
        />
        <ColorInput
          label='Error'
          value={typingThemeDraft.themeErrorColor}
          onChange={(value) =>
            setTypingThemeDraft((prev) => ({ ...prev, themeErrorColor: value }))
          }
        />
        <ColorInput
          label='Success'
          value={typingThemeDraft.themeSuccessColor}
          onChange={(value) =>
            setTypingThemeDraft((prev) => ({ ...prev, themeSuccessColor: value }))
          }
        />
      </div>

      <div
        className='rounded-lg border p-3'
        style={{
          backgroundColor: typingThemeDraft.themeBackgroundColor,
          borderColor: typingThemeDraft.themeBorderColor,
        }}
      >
        <style
          dangerouslySetInnerHTML={{
            __html: `
              @keyframes hudPulseGlow {
                0% { opacity: 0.72; filter: brightness(0.9); box-shadow: 0 0 0 rgba(0,0,0,0); }
                50% { opacity: 1; filter: brightness(1.18); box-shadow: 0 0 10px currentColor; }
                100% { opacity: 0.72; filter: brightness(0.9); box-shadow: 0 0 0 rgba(0,0,0,0); }
              }
              .hud-pulse-progress { animation: hudPulseGlow 1.2s ease-in-out infinite; }
            `,
          }}
        />
        <div className={`rounded-lg p-3 ${frameClass}`} style={frameStyle}>
          <div className='grid grid-cols-3 gap-2 text-center'>
            <div className='flex flex-col items-center gap-0.5'>
              <div className='text-3xl font-mono font-bold' style={{ color: typingThemeDraft.themeAccentColor }}>
                30
              </div>
              <div className='text-xs' style={{ color: typingThemeDraft.themeTextColor, opacity: 0.6 }}>
                seconds
              </div>
            </div>
            <div className='flex flex-col items-center gap-0.5'>
              <div className='text-3xl font-mono font-bold' style={{ color: typingThemeDraft.themeTextColor }}>
                86
              </div>
              <div className='text-xs' style={{ color: typingThemeDraft.themeTextColor, opacity: 0.6 }}>
                wpm
              </div>
            </div>
            <div className='flex flex-col items-center gap-0.5'>
              <div className='text-3xl font-mono font-bold' style={{ color: typingThemeDraft.themeTextColor }}>
                97
              </div>
              <div className='text-xs' style={{ color: typingThemeDraft.themeTextColor, opacity: 0.6 }}>
                accuracy
              </div>
            </div>
          </div>
          {typingThemeDraft.hudMeterStyle !== 'none' ? (
            <div className='mt-3'>
              {typingThemeDraft.hudMeterStyle === 'ring' ? (
                <div className='flex justify-center'>
                  <svg width='34' height='34' viewBox='0 0 36 36'>
                    <circle
                      cx='18'
                      cy='18'
                      r='15'
                      fill='none'
                      stroke={`${typingThemeDraft.themeTextColor}33`}
                      strokeWidth='4'
                    />
                    <circle
                      cx='18'
                      cy='18'
                      r='15'
                      fill='none'
                      stroke={typingThemeDraft.themeAccentColor}
                      strokeWidth='4'
                      strokeDasharray='58 94.2'
                      transform='rotate(-90 18 18)'
                      strokeLinecap='round'
                    />
                  </svg>
                </div>
              ) : (
                <div className='h-2 w-full overflow-hidden rounded-full bg-well'>
                  <div
                    className={`h-full rounded-full ${
                      typingThemeDraft.hudMeterStyle === 'pulse' ? 'hud-pulse-progress' : ''
                    }`}
                    style={{
                      width: '62%',
                      backgroundColor: typingThemeDraft.themeAccentColor,
                      color: typingThemeDraft.themeAccentColor,
                    }}
                  />
                </div>
              )}
            </div>
          ) : null}
        </div>
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
            name: itemDraft.name || 'Typing Theme Item',
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
