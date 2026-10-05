'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { RewardGameType } from '@/features/arcade/lib/rewards';
import { StoreItemPreview } from '@/features/arcade/components/store-item-preview';
import { InfoHint } from './_components';
import { contrastRatio } from './_types';
import type { ItemDraft, SnakeBodyDraft } from './_types';

const HEX_COLOR_RE = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
const MAX_HISTORY_STATES = 80;

type SnakePreset = {
  id: string;
  label: string;
  draft: Partial<SnakeBodyDraft>;
};

const SNAKE_PRESETS: SnakePreset[] = [
  {
    id: 'neon-racer',
    label: 'Neon Racer',
    draft: {
      bodyPrimary: '#22d3ee',
      bodySecondary: '#0e7490',
      bodyGradient: 'combined',
      bodyPatternStyle: 'stripes',
      bodyPatternColor: '#e0f2fe',
      bodyPatternIntensity: 45,
      bodyGlowEnabled: true,
      bodyGlowStyle: 'pulse',
      bodyGlowColor: '#38bdf8',
      bodyGlowSpeed: 58,
      bodyGlowSize: 72,
      previewBgMode: 'custom-gradient',
      previewBgColors: ['#020617', '#0f172a', '#164e63'],
    },
  },
  {
    id: 'ember-drake',
    label: 'Ember Drake',
    draft: {
      bodyPrimary: '#f97316',
      bodySecondary: '#7c2d12',
      bodyGradient: 'linear',
      bodyPatternStyle: 'stripes',
      bodyPatternColor: '#fdba74',
      bodyPatternIntensity: 62,
      bodyGlowEnabled: true,
      bodyGlowStyle: 'steady',
      bodyGlowColor: '#fb923c',
      bodyGlowSize: 66,
      previewBgMode: 'custom-gradient',
      previewBgColors: ['#2c0f0f', '#7c2d12', '#f97316'],
    },
  },
  {
    id: 'mint-stealth',
    label: 'Mint Stealth',
    draft: {
      bodyPrimary: '#22c55e',
      bodySecondary: '#14532d',
      bodyGradient: 'radial',
      bodyPatternStyle: 'dots',
      bodyPatternColor: '#dcfce7',
      bodyPatternIntensity: 28,
      bodyGlowEnabled: false,
      previewBgMode: 'auto',
    },
  },
  {
    id: 'glacier-viper',
    label: 'Glacier Viper',
    draft: {
      bodyPrimary: '#60a5fa',
      bodySecondary: '#1e3a8a',
      bodyGradient: 'linear',
      bodyPatternStyle: 'dots',
      bodyPatternColor: '#dbeafe',
      bodyPatternIntensity: 36,
      bodyGlowEnabled: true,
      bodyGlowStyle: 'steady',
      bodyGlowColor: '#93c5fd',
      bodyGlowSize: 58,
      previewBgMode: 'custom-gradient',
      previewBgColors: ['#020617', '#1e3a8a', '#60a5fa'],
    },
  },
  {
    id: 'toxic-lime',
    label: 'Toxic Lime',
    draft: {
      bodyPrimary: '#84cc16',
      bodySecondary: '#3f6212',
      bodyGradient: 'combined',
      bodyPatternStyle: 'stripes',
      bodyPatternColor: '#ecfccb',
      bodyPatternIntensity: 64,
      bodyGlowEnabled: true,
      bodyGlowStyle: 'pulse',
      bodyGlowColor: '#a3e635',
      bodyGlowSpeed: 66,
      bodyGlowSize: 80,
      previewBgMode: 'custom-gradient',
      previewBgColors: ['#0b1320', '#365314', '#84cc16'],
    },
  },
  {
    id: 'royal-plum',
    label: 'Royal Plum',
    draft: {
      bodyPrimary: '#a855f7',
      bodySecondary: '#581c87',
      bodyGradient: 'radial',
      bodyPatternStyle: 'dots',
      bodyPatternColor: '#f3e8ff',
      bodyPatternIntensity: 52,
      bodyGlowEnabled: false,
      previewBgMode: 'custom-gradient',
      previewBgColors: ['#12091d', '#4c1d95', '#a855f7'],
    },
  },
  {
    id: 'sunset-cobra',
    label: 'Sunset Cobra',
    draft: {
      bodyPrimary: '#fb7185',
      bodySecondary: '#f97316',
      bodyGradient: 'combined',
      bodyPatternStyle: 'stripes',
      bodyPatternColor: '#ffe4e6',
      bodyPatternIntensity: 40,
      bodyGlowEnabled: true,
      bodyGlowStyle: 'steady',
      bodyGlowColor: '#fdba74',
      bodyGlowSize: 62,
      previewBgMode: 'custom-gradient',
      previewBgColors: ['#2a0f0a', '#9a3412', '#fb7185'],
    },
  },
  {
    id: 'obsidian-ghost',
    label: 'Obsidian Ghost',
    draft: {
      bodyPrimary: '#334155',
      bodySecondary: '#0f172a',
      bodyGradient: 'flat',
      bodyPatternStyle: 'none',
      bodyPatternColor: '#cbd5e1',
      bodyPatternIntensity: 0,
      bodyGlowEnabled: true,
      bodyGlowStyle: 'pulse',
      bodyGlowColor: '#94a3b8',
      bodyGlowSpeed: 38,
      bodyGlowSize: 70,
      previewBgMode: 'solid',
      previewBgSolid: '#020617',
    },
  },
];

const toValidHex = (value: string, fallback: string) => {
  const normalized = value.trim().startsWith('#')
    ? value.trim()
    : `#${value.trim()}`;
  return HEX_COLOR_RE.test(normalized) ? normalized.toLowerCase() : fallback;
};

const randomHexColor = () => {
  const hue = Math.floor(Math.random() * 360);
  const saturation = 60 + Math.floor(Math.random() * 30);
  const lightness = 35 + Math.floor(Math.random() * 30);

  const sat = saturation / 100;
  const light = lightness / 100;
  const chroma = (1 - Math.abs(2 * light - 1)) * sat;
  const hPrime = hue / 60;
  const x = chroma * (1 - Math.abs((hPrime % 2) - 1));

  let r1 = 0;
  let g1 = 0;
  let b1 = 0;

  if (hPrime >= 0 && hPrime < 1) {
    r1 = chroma;
    g1 = x;
  } else if (hPrime >= 1 && hPrime < 2) {
    r1 = x;
    g1 = chroma;
  } else if (hPrime >= 2 && hPrime < 3) {
    g1 = chroma;
    b1 = x;
  } else if (hPrime >= 3 && hPrime < 4) {
    g1 = x;
    b1 = chroma;
  } else if (hPrime >= 4 && hPrime < 5) {
    r1 = x;
    b1 = chroma;
  } else {
    r1 = chroma;
    b1 = x;
  }

  const m = light - chroma / 2;
  const toChannel = (v: number) =>
    Math.max(0, Math.min(255, Math.round((v + m) * 255)))
      .toString(16)
      .padStart(2, '0');

  return `#${toChannel(r1)}${toChannel(g1)}${toChannel(b1)}`;
};

function SectionCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section className='arcade-card-inset p-3 space-y-3'>
      <div>
        <p className='text-xs font-semibold uppercase tracking-wide text-faint'>
          {title}
        </p>
        {subtitle ? <p className='text-[11px] text-faint'>{subtitle}</p> : null}
      </div>
      {children}
    </section>
  );
}

function ColorInput({
  label,
  value,
  disabled = false,
  hint,
  onChange,
}: {
  label: string;
  value: string;
  disabled?: boolean;
  hint?: string;
  onChange: (next: string) => void;
}) {
  const [textValue, setTextValue] = useState(value);

  useEffect(() => {
    setTextValue(value);
  }, [value]);

  return (
    <label className={`text-xs space-y-1 ${disabled ? 'opacity-50' : ''}`}>
      <span className='inline-flex items-center'>
        {label}
        {hint ? <InfoHint text={hint} /> : null}
      </span>
      <div className='flex items-center gap-2'>
        <input
          type='color'
          className='h-8 w-12 rounded border border-soft bg-background p-1'
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
        />
        <input
          className='h-8 w-full rounded border border-soft bg-background px-2 font-mono text-[11px]'
          value={textValue}
          disabled={disabled}
          onChange={(e) => setTextValue(e.target.value)}
          onBlur={() => {
            const next = toValidHex(textValue, value);
            setTextValue(next);
            if (next !== value) onChange(next);
          }}
        />
      </div>
    </label>
  );
}

export function SnakeBodyEditor({
  itemDraft,
  snakeBodyDraft,
  setSnakeBodyDraft,
  editorPreviewAssetRef,
}: {
  itemDraft: ItemDraft;
  snakeBodyDraft: SnakeBodyDraft;
  setSnakeBodyDraft: React.Dispatch<React.SetStateAction<SnakeBodyDraft>>;
  editorPreviewAssetRef: Record<string, unknown>;
}) {
  const historyRef = useRef<string[]>([]);
  const redoRef = useRef<string[]>([]);
  const ignoreHistoryRef = useRef(false);
  const [historyState, setHistoryState] = useState({
    canUndo: false,
    canRedo: false,
  });

  const syncHistoryState = useCallback(() => {
    setHistoryState({
      canUndo: historyRef.current.length > 1,
      canRedo: redoRef.current.length > 0,
    });
  }, []);

  useEffect(() => {
    const serialized = JSON.stringify(snakeBodyDraft);
    if (ignoreHistoryRef.current) {
      ignoreHistoryRef.current = false;
      return;
    }
    const history = historyRef.current;
    if (history[history.length - 1] === serialized) return;
    history.push(serialized);
    if (history.length > MAX_HISTORY_STATES) history.shift();
    redoRef.current = [];
    syncHistoryState();
  }, [snakeBodyDraft, syncHistoryState]);

  const updateDraft = useCallback(
    (updater: (prev: SnakeBodyDraft) => SnakeBodyDraft) => {
      setSnakeBodyDraft((prev) => updater(prev));
    },
    [setSnakeBodyDraft],
  );

  const applyPreset = useCallback(
    (preset: SnakePreset) => {
      updateDraft((prev) => ({
        ...prev,
        ...preset.draft,
        previewBgColors: preset.draft.previewBgColors
          ? [...preset.draft.previewBgColors]
          : prev.previewBgColors,
      }));
    },
    [updateDraft],
  );

  const randomizeStyle = useCallback(() => {
    const primary = randomHexColor();
    const secondary = randomHexColor();
    const pattern = randomHexColor();

    updateDraft((prev) => ({
      ...prev,
      bodyPrimary: primary,
      bodySecondary: prev.bodyGradient === 'flat' ? primary : secondary,
      bodyPatternColor: pattern,
      previewBgMode: 'custom-gradient',
      previewBgColors: [
        '#0b1220',
        primary,
        prev.bodyGradient === 'flat' ? pattern : secondary,
      ],
    }));
  }, [updateDraft]);

  const undo = useCallback(() => {
    const history = historyRef.current;
    if (history.length <= 1) return;

    const current = history.pop();
    if (!current) return;
    redoRef.current.unshift(current);

    const previous = history[history.length - 1];
    if (!previous) return;

    ignoreHistoryRef.current = true;
    setSnakeBodyDraft(JSON.parse(previous) as SnakeBodyDraft);
    syncHistoryState();
  }, [setSnakeBodyDraft, syncHistoryState]);

  const redo = useCallback(() => {
    const next = redoRef.current.shift();
    if (!next) return;

    ignoreHistoryRef.current = true;
    setSnakeBodyDraft(JSON.parse(next) as SnakeBodyDraft);
    historyRef.current.push(next);
    if (historyRef.current.length > MAX_HISTORY_STATES) {
      historyRef.current.shift();
    }
    syncHistoryState();
  }, [setSnakeBodyDraft, syncHistoryState]);

  const snakeWarnings = useMemo(() => {
    const warnings: string[] = [];

    if (contrastRatio(snakeBodyDraft.bodyPrimary, '#0b1220') < 2) {
      warnings.push('Low contrast between snake body and dark board.');
    }

    if (
      snakeBodyDraft.bodyGradient !== 'flat' &&
      contrastRatio(snakeBodyDraft.bodyPrimary, snakeBodyDraft.bodySecondary) < 1.12
    ) {
      warnings.push('Primary and secondary body colors are very similar for the selected gradient.');
    }

    if (
      snakeBodyDraft.bodyGlowEnabled &&
      contrastRatio(snakeBodyDraft.bodyGlowColor, snakeBodyDraft.bodyPrimary) <
        1.3
    ) {
      warnings.push('Glow color is very close to body primary color.');
    }

    if (
      snakeBodyDraft.bodyPatternStyle !== 'none' &&
      snakeBodyDraft.bodyPatternIntensity < 12
    ) {
      warnings.push('Pattern intensity is very subtle and may not be visible.');
    }

    if (snakeBodyDraft.bodyGlowEnabled && snakeBodyDraft.bodyGlowSize < 20) {
      warnings.push('Glow is enabled but glow size is very small.');
    }

    if (
      snakeBodyDraft.bodyGlowEnabled &&
      snakeBodyDraft.bodyGlowStyle === 'pulse-dual' &&
      contrastRatio(snakeBodyDraft.bodyGlowColor, snakeBodyDraft.bodyGlowColorAlt) < 1.2
    ) {
      warnings.push('Pulse-dual colors are too close; the color transition may be hard to notice.');
    }

    return warnings;
  }, [snakeBodyDraft]);

  const publishChecklist = useMemo(
    () => [
      { label: 'Item name set', ok: itemDraft.name.trim().length > 0 },
      { label: 'Slot assigned', ok: itemDraft.slots.length > 0 },
      {
        label: 'Glow settings consistent',
        ok:
          !snakeBodyDraft.bodyGlowEnabled ||
          (snakeBodyDraft.bodyGlowSize >= 20 &&
            snakeBodyDraft.bodyGlowStyle !== 'none'),
      },
      {
        label: 'Pattern configured (or disabled)',
        ok:
          snakeBodyDraft.bodyPatternStyle === 'none' ||
          snakeBodyDraft.bodyPatternIntensity > 0,
      },
    ],
    [
      itemDraft.name,
      itemDraft.slots.length,
      snakeBodyDraft.bodyGlowEnabled,
      snakeBodyDraft.bodyGlowSize,
      snakeBodyDraft.bodyGlowStyle,
      snakeBodyDraft.bodyPatternIntensity,
      snakeBodyDraft.bodyPatternStyle,
    ],
  );

  return (
    <div className='space-y-4 rounded-xl border border-soft bg-raised p-4'>
      <div className='flex flex-wrap items-start justify-between gap-3'>
        <div>
          <p className='text-sm font-semibold'>Snake Body Editor</p>
          <p className='text-xs text-faint'>
            Build the body style first, then tune glow and card background.
          </p>
        </div>
        <div className='flex flex-wrap gap-2'>
          <button
            type='button'
            className='rounded border border-soft px-2.5 py-1 text-xs disabled:opacity-40'
            disabled={!historyState.canUndo}
            onClick={undo}
          >
            Undo
          </button>
          <button
            type='button'
            className='rounded border border-soft px-2.5 py-1 text-xs disabled:opacity-40'
            disabled={!historyState.canRedo}
            onClick={redo}
          >
            Redo
          </button>
          <button
            type='button'
            className='rounded border border-soft bg-background px-2.5 py-1 text-xs'
            onClick={randomizeStyle}
          >
            Randomize
          </button>
        </div>
      </div>

      <div className='grid gap-4 2xl:grid-cols-[1fr_1.3fr]'>
        <aside className='space-y-3'>
          <section className='rounded-lg border border-soft bg-slate-950/45 p-3 space-y-3'>
            <p className='text-[11px] uppercase tracking-wide text-faint'>
              Live Preview
            </p>
            <StoreItemPreview
              item={{
                name: itemDraft.name || 'Preview Item Name',
                gameType: itemDraft.gameType as RewardGameType,
                slots: itemDraft.slots.length > 0 ? itemDraft.slots : ['body'],
                assetRef: editorPreviewAssetRef,
              }}
              snakeAlign='center'
            />
          </section>

          <section className='rounded-lg border border-soft bg-well p-3 space-y-2'>
            <p className='text-[11px] uppercase tracking-wide text-faint'>
              Quick Presets
            </p>
            <div className='grid grid-cols-1 gap-2 md:grid-cols-3 xl:grid-cols-1'>
              {SNAKE_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type='button'
                  className='rounded-tag border border-soft bg-raised px-2 py-1.5 text-xs text-body shadow-chip transition-[filter] duration-[140ms] hover:brightness-110'
                  onClick={() => applyPreset(preset)}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </section>
        </aside>

        <div className='space-y-3'>
          <SectionCard
            title='Palette And Pattern'
            subtitle='Primary visual identity of the body pearls.'
          >
            <div className='grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3'>
              <ColorInput
                label='Primary'
                value={snakeBodyDraft.bodyPrimary}
                onChange={(next) =>
                  updateDraft((prev) => ({
                    ...prev,
                    bodyPrimary: next,
                    ...(prev.bodyGradient === 'flat'
                      ? { bodySecondary: next }
                      : {}),
                  }))
                }
              />

              <ColorInput
                label={
                  snakeBodyDraft.bodyGradient === 'flat'
                    ? 'Secondary (auto-locked)'
                    : 'Secondary'
                }
                value={snakeBodyDraft.bodySecondary}
                disabled={snakeBodyDraft.bodyGradient === 'flat'}
                onChange={(next) =>
                  updateDraft((prev) => ({
                    ...prev,
                    bodySecondary: next,
                  }))
                }
              />

              <label className='text-xs space-y-1'>
                <span>
                  Gradient Mode
                  <InfoHint text='How primary and secondary blend across the body.' />
                </span>
                <select
                  className='w-full rounded border border-soft bg-background px-2 py-1'
                  value={snakeBodyDraft.bodyGradient}
                  onChange={(e) =>
                    updateDraft((prev) => {
                      const next = e.target.value as SnakeBodyDraft['bodyGradient'];
                      return {
                        ...prev,
                        bodyGradient: next,
                        ...(next === 'flat'
                          ? { bodySecondary: prev.bodyPrimary }
                          : {}),
                      };
                    })
                  }
                >
                  <option value='flat'>Flat (single color)</option>
                  <option value='linear'>Linear (head to tail)</option>
                  <option value='radial'>Radial (3D pearl)</option>
                  <option value='combined'>Combined</option>
                </select>
              </label>

              <label className='text-xs space-y-1'>
                <span>
                  Pattern
                  <InfoHint text='Overlay pattern drawn on top of body pearls.' />
                </span>
                <select
                  className='w-full rounded border border-soft bg-background px-2 py-1'
                  value={snakeBodyDraft.bodyPatternStyle}
                  onChange={(e) =>
                    updateDraft((prev) => ({
                      ...prev,
                      bodyPatternStyle: e.target
                        .value as SnakeBodyDraft['bodyPatternStyle'],
                    }))
                  }
                >
                  <option value='none'>None</option>
                  <option value='stripes'>Stripes</option>
                  <option value='dots'>Dots</option>
                </select>
              </label>

              <ColorInput
                label='Pattern Color'
                disabled={snakeBodyDraft.bodyPatternStyle === 'none'}
                value={snakeBodyDraft.bodyPatternColor}
                onChange={(next) =>
                  updateDraft((prev) => ({
                    ...prev,
                    bodyPatternColor: next,
                  }))
                }
              />

              <label
                className={`text-xs space-y-1 ${
                  snakeBodyDraft.bodyPatternStyle === 'none'
                    ? 'opacity-50 pointer-events-none'
                    : ''
                }`}
              >
                <span>
                  Pattern Intensity ({snakeBodyDraft.bodyPatternIntensity})
                  <InfoHint text='Controls alpha and thickness of pattern rendering.' />
                </span>
                <input
                  type='range'
                  min={0}
                  max={100}
                  value={snakeBodyDraft.bodyPatternIntensity}
                  onChange={(e) =>
                    updateDraft((prev) => ({
                      ...prev,
                      bodyPatternIntensity: Number(e.target.value),
                    }))
                  }
                />
              </label>
            </div>
          </SectionCard>

          <SectionCard
            title='Glow'
            subtitle='Movement readability and energy profile.'
          >
            <div className='grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4'>
              <label className='inline-flex items-center gap-2 text-xs pt-1'>
                <input
                  type='checkbox'
                  checked={snakeBodyDraft.bodyGlowEnabled}
                  onChange={(e) =>
                    updateDraft((prev) => ({
                      ...prev,
                      bodyGlowEnabled: e.target.checked,
                    }))
                  }
                />
                <span>Enable glow</span>
              </label>

              <ColorInput
                label='Glow Color'
                value={snakeBodyDraft.bodyGlowColor}
                disabled={!snakeBodyDraft.bodyGlowEnabled}
                onChange={(next) =>
                  updateDraft((prev) => ({
                    ...prev,
                    bodyGlowColor: next,
                  }))
                }
              />

              <ColorInput
                label='Pulse Alt Color'
                value={snakeBodyDraft.bodyGlowColorAlt}
                disabled={
                  !snakeBodyDraft.bodyGlowEnabled ||
                  snakeBodyDraft.bodyGlowStyle !== 'pulse-dual'
                }
                hint='Used only for Two-Tone Pulse.'
                onChange={(next) =>
                  updateDraft((prev) => ({
                    ...prev,
                    bodyGlowColorAlt: next,
                  }))
                }
              />

              <label
                className={`text-xs space-y-1 ${
                  !snakeBodyDraft.bodyGlowEnabled
                    ? 'opacity-50 pointer-events-none'
                    : ''
                }`}
              >
                <span>
                  Style
                  <InfoHint text='Steady glow or pulse animation.' />
                </span>
                <select
                  className='w-full rounded border border-soft bg-background px-2 py-1'
                  value={snakeBodyDraft.bodyGlowStyle}
                  onChange={(e) =>
                    updateDraft((prev) => ({
                      ...prev,
                      bodyGlowStyle: e.target
                        .value as SnakeBodyDraft['bodyGlowStyle'],
                    }))
                  }
                >
                  <option value='none'>None</option>
                  <option value='steady'>Steady</option>
                  <option value='pulse'>Pulse</option>
                  <option value='pulse-dual'>Two-Tone Pulse</option>
                </select>
              </label>

              <label
                className={`text-xs space-y-1 ${
                  (snakeBodyDraft.bodyGlowStyle !== 'pulse' &&
                    snakeBodyDraft.bodyGlowStyle !== 'pulse-dual') ||
                  !snakeBodyDraft.bodyGlowEnabled
                    ? 'opacity-50 pointer-events-none'
                    : ''
                }`}
              >
                <span>
                  Pulse Speed ({snakeBodyDraft.bodyGlowSpeed})
                  <InfoHint text='Higher values pulse faster.' />
                </span>
                <input
                  type='range'
                  min={10}
                  max={100}
                  value={snakeBodyDraft.bodyGlowSpeed}
                  onChange={(e) =>
                    updateDraft((prev) => ({
                      ...prev,
                      bodyGlowSpeed: Number(e.target.value),
                    }))
                  }
                />
              </label>

              <label
                className={`text-xs space-y-1 ${
                  !snakeBodyDraft.bodyGlowEnabled
                    ? 'opacity-50 pointer-events-none'
                    : ''
                }`}
              >
                <span>
                  Glow Size ({snakeBodyDraft.bodyGlowSize})
                  <InfoHint text='Larger values spread farther from the body.' />
                </span>
                <input
                  type='range'
                  min={10}
                  max={200}
                  value={snakeBodyDraft.bodyGlowSize}
                  onChange={(e) =>
                    updateDraft((prev) => ({
                      ...prev,
                      bodyGlowSize: Number(e.target.value),
                    }))
                  }
                />
              </label>
            </div>
          </SectionCard>

          <SectionCard
            title='Store Card Background'
            subtitle='How this item appears in catalog and card previews.'
          >
            <div className='grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4'>
              <label className='text-xs space-y-1'>
                <span>
                  Mode
                  <InfoHint text='Auto derives from body colors. Custom gradient supports up to 4 colors.' />
                </span>
                <select
                  className='w-full rounded border border-soft bg-background px-2 py-1'
                  value={snakeBodyDraft.previewBgMode}
                  onChange={(e) =>
                    updateDraft((prev) => ({
                      ...prev,
                      previewBgMode: e.target
                        .value as SnakeBodyDraft['previewBgMode'],
                    }))
                  }
                >
                  <option value='auto'>Auto (from body colors)</option>
                  <option value='solid'>Solid</option>
                  <option value='custom-gradient'>Custom Gradient</option>
                </select>
              </label>

              {snakeBodyDraft.previewBgMode === 'solid' ? (
                <ColorInput
                  label='Background Color'
                  value={snakeBodyDraft.previewBgSolid}
                  onChange={(next) =>
                    updateDraft((prev) => ({
                      ...prev,
                      previewBgSolid: next,
                    }))
                  }
                />
              ) : null}
            </div>

            {snakeBodyDraft.previewBgMode === 'custom-gradient' ? (
              <div className='space-y-2'>
                <div className='flex flex-wrap items-end gap-3'>
                  {snakeBodyDraft.previewBgColors.map((color, idx) => (
                    <div key={idx} className='text-xs space-y-1'>
                      <span className='flex items-center gap-1'>
                        Color {idx + 1}
                        {snakeBodyDraft.previewBgColors.length > 2 ? (
                          <button
                            type='button'
                            className='text-[10px] text-red-300 hover:text-red-200'
                            onClick={() =>
                              updateDraft((prev) => ({
                                ...prev,
                                previewBgColors: prev.previewBgColors.filter(
                                  (_, i) => i !== idx,
                                ),
                              }))
                            }
                          >
                            remove
                          </button>
                        ) : null}
                      </span>
                      <input
                        type='color'
                        className='h-8 w-16 rounded border border-soft bg-background p-1'
                        value={color}
                        onChange={(e) =>
                          updateDraft((prev) => ({
                            ...prev,
                            previewBgColors: prev.previewBgColors.map((c, i) =>
                              i === idx ? e.target.value : c,
                            ),
                          }))
                        }
                      />
                    </div>
                  ))}
                  {snakeBodyDraft.previewBgColors.length < 4 ? (
                    <button
                      type='button'
                      className='rounded border border-soft px-2 py-1 text-xs'
                      onClick={() =>
                        updateDraft((prev) => ({
                          ...prev,
                          previewBgColors: [...prev.previewBgColors, '#1e293b'],
                        }))
                      }
                    >
                      Add Color
                    </button>
                  ) : null}
                </div>
                <div
                  className='h-6 w-full rounded border border-soft'
                  style={{
                    background:
                      snakeBodyDraft.previewBgColors.length > 1
                        ? `linear-gradient(135deg, ${snakeBodyDraft.previewBgColors.join(', ')})`
                        : (snakeBodyDraft.previewBgColors[0] ?? '#0f172a'),
                  }}
                />
              </div>
            ) : null}
          </SectionCard>

          <SectionCard
            title='Validation'
            subtitle='Quick checks before publishing this item.'
          >
            {snakeWarnings.length > 0 ? (
              <div className='space-y-1'>
                {snakeWarnings.map((warning) => (
                  <div
                    key={warning}
                    className='rounded-tag border border-soft bg-well px-2 py-1 text-xs text-tickets-text'
                  >
                    {warning}
                  </div>
                ))}
              </div>
            ) : (
              <p className='text-xs text-prize-text'>No active warnings.</p>
            )}

            <div className='grid gap-1 text-xs'>
              {publishChecklist.map((item) => (
                <div
                  key={item.label}
                  className={item.ok ? 'text-prize-text' : 'text-danger-text'}
                >
                  {item.ok ? 'OK' : 'Missing'} - {item.label}
                </div>
              ))}
            </div>
          </SectionCard>
        </div>
      </div>
    </div>
  );
}
