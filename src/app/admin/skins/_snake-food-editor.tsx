'use client';

import { useEffect, useMemo, useState } from 'react';
import type { RewardGameType } from '@/features/arcade/lib/rewards';
import { StoreItemPreview } from '@/features/arcade/components/store-item-preview';
import { InfoHint } from './_components';
import { contrastRatio } from './_types';
import type { ItemDraft, SnakeFoodDraft } from './_types';

type FoodPreset = {
  id: string;
  label: string;
  draft: Partial<SnakeFoodDraft>;
};

const FOOD_PRESETS: FoodPreset[] = [
  {
    id: 'classic-apple',
    label: 'Classic Apple',
    draft: {
      foodShape: 'apple',
      foodPrimary: '#e54d2e',
      foodHighlight: '#f0967a',
      foodStemColor: '#7a5230',
      foodLeafColor: '#6abf3b',
      foodSize: 100,
      foodPulse: 40,
      foodGlowEnabled: false,
    },
  },
  {
    id: 'neon-orb',
    label: 'Neon Orb',
    draft: {
      foodShape: 'orb',
      foodPrimary: '#22d3ee',
      foodHighlight: '#a5f3fc',
      foodSize: 112,
      foodPulse: 62,
      foodGlowEnabled: true,
      foodGlowColor: '#22d3ee',
      foodGlowSize: 64,
    },
  },
  {
    id: 'ember-gem',
    label: 'Ember Gem',
    draft: {
      foodShape: 'diamond',
      foodPrimary: '#fb923c',
      foodHighlight: '#fed7aa',
      foodSize: 104,
      foodPulse: 34,
      foodGlowEnabled: true,
      foodGlowColor: '#f97316',
      foodGlowSize: 52,
    },
  },
  {
    id: 'plasma-core',
    label: 'Plasma Core',
    draft: {
      foodShape: 'orb',
      foodPrimary: '#a855f7',
      foodHighlight: '#f3e8ff',
      foodSize: 118,
      foodPulse: 70,
      foodGlowEnabled: true,
      foodGlowColor: '#c084fc',
      foodGlowSize: 72,
    },
  },
  {
    id: 'mint-drop',
    label: 'Mint Drop',
    draft: {
      foodShape: 'apple',
      foodPrimary: '#22c55e',
      foodHighlight: '#bbf7d0',
      foodStemColor: '#4d7c0f',
      foodLeafColor: '#86efac',
      foodSize: 92,
      foodPulse: 20,
      foodGlowEnabled: false,
    },
  },
];

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

function RangeInput({
  label,
  value,
  min,
  max,
  onChange,
  hint,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (next: number) => void;
  hint?: string;
}) {
  return (
    <label className='text-xs space-y-1'>
      <span className='inline-flex items-center'>
        {label} <span className='ml-1 text-[10px] text-faint'>{value}</span>
        {hint ? <InfoHint text={hint} /> : null}
      </span>
      <input
        type='range'
        min={min}
        max={max}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className='w-full'
      />
    </label>
  );
}

export function SnakeFoodEditor({
  itemDraft,
  snakeFoodDraft,
  setSnakeFoodDraft,
  editorPreviewAssetRef,
}: {
  itemDraft: ItemDraft;
  snakeFoodDraft: SnakeFoodDraft;
  setSnakeFoodDraft: React.Dispatch<React.SetStateAction<SnakeFoodDraft>>;
  editorPreviewAssetRef: Record<string, unknown> | null;
}) {
  const foodWarnings = useMemo(() => {
    const warnings: string[] = [];

    if (contrastRatio(snakeFoodDraft.foodPrimary, snakeFoodDraft.foodHighlight) < 1.12) {
      warnings.push('Primary and highlight are very similar; shape depth may be hard to notice.');
    }

    if (
      snakeFoodDraft.foodGlowEnabled &&
      contrastRatio(snakeFoodDraft.foodGlowColor, snakeFoodDraft.foodPrimary) < 1.25
    ) {
      warnings.push('Glow color is close to primary color; glow effect may look weak.');
    }

    if (
      snakeFoodDraft.foodShape === 'apple' &&
      contrastRatio(snakeFoodDraft.foodStemColor, snakeFoodDraft.foodPrimary) < 1.08
    ) {
      warnings.push('Stem color is very close to apple body color.');
    }

    if (
      snakeFoodDraft.foodShape === 'apple' &&
      contrastRatio(snakeFoodDraft.foodLeafColor, snakeFoodDraft.foodPrimary) < 1.08
    ) {
      warnings.push('Leaf color is very close to apple body color.');
    }

    if (snakeFoodDraft.foodPulse > 80 && snakeFoodDraft.foodSize > 125) {
      warnings.push('Large size + high pulse can feel visually noisy in-game.');
    }

    return warnings;
  }, [snakeFoodDraft]);

  const foodChecklist = useMemo(
    () => [
      { label: 'Item name set', ok: itemDraft.name.trim().length > 0 },
      { label: 'Slot assigned', ok: itemDraft.slots.length > 0 },
      {
        label: 'Glow configured (or disabled)',
        ok: !snakeFoodDraft.foodGlowEnabled || snakeFoodDraft.foodGlowSize >= 20,
      },
      { label: 'Shape selected', ok: ['apple', 'orb', 'diamond'].includes(snakeFoodDraft.foodShape) },
    ],
    [
      itemDraft.name,
      itemDraft.slots.length,
      snakeFoodDraft.foodGlowEnabled,
      snakeFoodDraft.foodGlowSize,
      snakeFoodDraft.foodShape,
    ],
  );

  return (
    <div className='space-y-4 rounded-xl border border-soft bg-raised p-4'>
      <div>
        <p className='text-sm font-semibold'>Snake Food Editor</p>
        <p className='text-xs text-faint'>
          Build custom apples, orbs, and gems with glow, pulse, and color controls.
        </p>
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
                slots: itemDraft.slots.length > 0 ? itemDraft.slots : ['food'],
                assetRef: editorPreviewAssetRef,
              }}
              snakeAlign='center'
            />
          </section>

          <section className='rounded-lg border border-soft bg-well p-3 space-y-2'>
            <p className='text-[11px] uppercase tracking-wide text-faint'>
              Quick Presets
            </p>
            <div className='grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-1'>
              {FOOD_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type='button'
                  className='rounded-tag border border-soft bg-raised px-2 py-1.5 text-xs text-body shadow-chip transition-[filter] duration-[140ms] hover:brightness-110'
                  onClick={() =>
                    setSnakeFoodDraft((prev) => ({
                      ...prev,
                      ...preset.draft,
                    }))
                  }
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </section>
        </aside>

        <div className='space-y-3'>
          <SectionCard
            title='Food Style'
            subtitle='Choose the shape profile and core appearance.'
          >
            <div className='grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3'>
              <label className='text-xs space-y-1'>
                <span className='inline-flex items-center'>
                  Shape
                  <InfoHint text='Apple includes leaf/stem. Orb and diamond are abstract pickups.' />
                </span>
                <select
                  className='w-full rounded border border-soft bg-background px-2 py-1.5 text-xs'
                  value={snakeFoodDraft.foodShape}
                  onChange={(event) =>
                    setSnakeFoodDraft((prev) => ({
                      ...prev,
                      foodShape: event.target.value as SnakeFoodDraft['foodShape'],
                    }))
                  }
                >
                  <option value='apple'>Apple</option>
                  <option value='orb'>Orb</option>
                  <option value='diamond'>Diamond</option>
                </select>
              </label>
              <RangeInput
                label='Size'
                value={snakeFoodDraft.foodSize}
                min={60}
                max={140}
                onChange={(next) =>
                  setSnakeFoodDraft((prev) => ({ ...prev, foodSize: next }))
                }
              />
              <RangeInput
                label='Pulse'
                value={snakeFoodDraft.foodPulse}
                min={0}
                max={100}
                onChange={(next) =>
                  setSnakeFoodDraft((prev) => ({ ...prev, foodPulse: next }))
                }
                hint='Higher values create more scale animation while idle.'
              />
            </div>
          </SectionCard>

          <SectionCard
            title='Palette'
            subtitle='Control the body highlight, and stem/leaf for apple skins.'
          >
            <div className='grid grid-cols-1 gap-3 sm:grid-cols-2'>
              <ColorInput
                label='Primary'
                value={snakeFoodDraft.foodPrimary}
                onChange={(next) =>
                  setSnakeFoodDraft((prev) => ({ ...prev, foodPrimary: next }))
                }
              />
              <ColorInput
                label='Highlight'
                value={snakeFoodDraft.foodHighlight}
                onChange={(next) =>
                  setSnakeFoodDraft((prev) => ({ ...prev, foodHighlight: next }))
                }
              />
              <ColorInput
                label='Stem Color'
                value={snakeFoodDraft.foodStemColor}
                onChange={(next) =>
                  setSnakeFoodDraft((prev) => ({ ...prev, foodStemColor: next }))
                }
              />
              <ColorInput
                label='Leaf Color'
                value={snakeFoodDraft.foodLeafColor}
                onChange={(next) =>
                  setSnakeFoodDraft((prev) => ({ ...prev, foodLeafColor: next }))
                }
              />
            </div>
          </SectionCard>

          <SectionCard
            title='Glow'
            subtitle='Add a pickup aura for stronger visual pop.'
          >
            <div className='grid grid-cols-1 gap-3 sm:grid-cols-2'>
              <label className='inline-flex items-center gap-2 rounded border border-soft bg-background px-2 py-2 text-xs'>
                <input
                  type='checkbox'
                  checked={snakeFoodDraft.foodGlowEnabled}
                  onChange={(event) =>
                    setSnakeFoodDraft((prev) => ({
                      ...prev,
                      foodGlowEnabled: event.target.checked,
                    }))
                  }
                />
                Enable Glow
              </label>
              <ColorInput
                label='Glow Color'
                value={snakeFoodDraft.foodGlowColor}
                onChange={(next) =>
                  setSnakeFoodDraft((prev) => ({ ...prev, foodGlowColor: next }))
                }
              />
              <RangeInput
                label='Glow Size'
                value={snakeFoodDraft.foodGlowSize}
                min={10}
                max={140}
                onChange={(next) =>
                  setSnakeFoodDraft((prev) => ({ ...prev, foodGlowSize: next }))
                }
              />
            </div>
          </SectionCard>

          <SectionCard
            title='Validation'
            subtitle='Quick checks before publishing this food item.'
          >
            {foodWarnings.length > 0 ? (
              <div className='space-y-1'>
                {foodWarnings.map((warning) => (
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
              {foodChecklist.map((item) => (
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
