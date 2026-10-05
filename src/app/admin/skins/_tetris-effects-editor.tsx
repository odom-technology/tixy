'use client';

import { useMemo } from 'react';
import type { RewardGameType } from '@/features/arcade/lib/rewards';
import { StoreItemPreview } from '@/features/arcade/components/store-item-preview';
import {
  SectionCard,
  TetrisChecklist,
  TetrisColorInput as ColorInput,
  TetrisRangeInput as RangeInput,
} from './_tetris-shared';
import type { ItemDraft, TetrisEffectsDraft } from './_types';

type EffectsPreset = {
  id: string;
  label: string;
  draft: Partial<TetrisEffectsDraft>;
};

const EFFECTS_PRESETS: EffectsPreset[] = [
  {
    id: 'classic',
    label: 'Classic Flash',
    draft: {
      lineClearStyle: 'flash',
      lineClearColor: '#ffffff',
      lineClearIntensity: 70,
      tetrisClearColor: '#ffd700',
      lockFlashColor: '#ffffff',
      lockFlashIntensity: 20,
    },
  },
  {
    id: 'crt',
    label: 'Retro CRT',
    draft: {
      lineClearStyle: 'sweep',
      lineClearColor: '#00ff41',
      lineClearIntensity: 85,
      tetrisClearColor: '#00ffaa',
      lockFlashColor: '#00ff41',
      lockFlashIntensity: 40,
      hardDropImpactColor: '#00ff41',
    },
  },
  {
    id: 'firework',
    label: 'Firework Burst',
    draft: {
      lineClearStyle: 'dissolve',
      lineClearColor: '#ffd700',
      lineClearIntensity: 90,
      tetrisClearColor: '#ff1493',
      tspinHighlightColor: '#ff00ff',
      hardDropImpactColor: '#ffd700',
      hardDropImpactSize: 80,
    },
  },
  {
    id: 'shatter',
    label: 'Shatter',
    draft: {
      lineClearStyle: 'shatter',
      lineClearColor: '#f87171',
      lineClearIntensity: 95,
      tetrisClearColor: '#fbbf24',
      lockFlashColor: '#f87171',
      hardDropImpactColor: '#f87171',
      hardDropImpactSize: 70,
    },
  },
  {
    id: 'cascade',
    label: 'Cascade (Rainbow)',
    draft: {
      lineClearStyle: 'sweep',
      lineClearColor: '#a855f7',
      lineClearIntensity: 100,
      tetrisClearColor: '#f0f',
      tspinHighlightColor: '#0ff',
      lockFlashColor: '#ffffff',
      lockFlashIntensity: 35,
      hardDropImpactColor: '#a855f7',
      hardDropImpactSize: 90,
    },
  },
];

export function TetrisEffectsEditor({
  itemDraft,
  tetrisEffectsDraft,
  setTetrisEffectsDraft,
  editorPreviewAssetRef,
}: {
  itemDraft: ItemDraft;
  tetrisEffectsDraft: TetrisEffectsDraft;
  setTetrisEffectsDraft: React.Dispatch<React.SetStateAction<TetrisEffectsDraft>>;
  editorPreviewAssetRef: Record<string, unknown> | null;
}) {
  const checklist = useMemo(
    () => [
      { label: 'Item name set', ok: itemDraft.name.trim().length > 0 },
      { label: 'Slot assigned', ok: itemDraft.slots.length > 0 },
      {
        label: 'Line clear intensity > 0',
        ok: tetrisEffectsDraft.lineClearIntensity > 0,
      },
    ],
    [itemDraft.name, itemDraft.slots.length, tetrisEffectsDraft.lineClearIntensity],
  );

  return (
    <div className='space-y-4 rounded-xl border border-soft bg-raised p-4'>
      <div>
        <p className='text-sm font-semibold'>Tetris Effects Editor</p>
        <p className='text-xs text-faint'>
          Control line clear animations, lock flashes, and hard drop impacts.
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
                slots: itemDraft.slots.length > 0 ? itemDraft.slots : ['effects'],
                assetRef: editorPreviewAssetRef,
              }}
            />
          </section>

          <section className='rounded-lg border border-soft bg-well p-3 space-y-2'>
            <p className='text-[11px] uppercase tracking-wide text-faint'>
              Quick Presets
            </p>
            <div className='grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-1'>
              {EFFECTS_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type='button'
                  className='rounded-tag border border-soft bg-raised px-2 py-1.5 text-xs text-body shadow-chip transition-[filter] duration-[140ms] hover:brightness-110'
                  onClick={() =>
                    setTetrisEffectsDraft((prev) => ({ ...prev, ...preset.draft }))
                  }
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </section>
        </aside>

        <div className='space-y-3'>
          <SectionCard title='Line Clear Animation'>
            <div className='grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3'>
              <label className='text-xs space-y-1'>
                <span>Animation Style</span>
                <select
                  className='w-full rounded border border-soft bg-background px-2 py-1.5 text-xs'
                  value={tetrisEffectsDraft.lineClearStyle}
                  onChange={(event) =>
                    setTetrisEffectsDraft((prev) => ({
                      ...prev,
                      lineClearStyle: event.target
                        .value as TetrisEffectsDraft['lineClearStyle'],
                    }))
                  }
                >
                  <option value='flash'>Flash</option>
                  <option value='dissolve'>Dissolve</option>
                  <option value='shatter'>Shatter</option>
                  <option value='sweep'>Sweep</option>
                </select>
              </label>
              <ColorInput
                label='Flash Color'
                value={tetrisEffectsDraft.lineClearColor}
                onChange={(next) =>
                  setTetrisEffectsDraft((prev) => ({ ...prev, lineClearColor: next }))
                }
              />
              <RangeInput
                label='Intensity'
                value={tetrisEffectsDraft.lineClearIntensity}
                min={0}
                max={100}
                onChange={(next) =>
                  setTetrisEffectsDraft((prev) => ({ ...prev, lineClearIntensity: next }))
                }
              />
              <ColorInput
                label='Tetris (4-line) Color'
                value={tetrisEffectsDraft.tetrisClearColor}
                onChange={(next) =>
                  setTetrisEffectsDraft((prev) => ({ ...prev, tetrisClearColor: next }))
                }
                hint='Special color used when 4 lines clear at once.'
              />
              <ColorInput
                label='T-Spin Highlight'
                value={tetrisEffectsDraft.tspinHighlightColor}
                onChange={(next) =>
                  setTetrisEffectsDraft((prev) => ({ ...prev, tspinHighlightColor: next }))
                }
              />
            </div>
          </SectionCard>

          <SectionCard title='Lock & Hard Drop'>
            <div className='grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3'>
              <ColorInput
                label='Lock Flash Color'
                value={tetrisEffectsDraft.lockFlashColor}
                onChange={(next) =>
                  setTetrisEffectsDraft((prev) => ({ ...prev, lockFlashColor: next }))
                }
              />
              <RangeInput
                label='Lock Intensity'
                value={tetrisEffectsDraft.lockFlashIntensity}
                min={0}
                max={100}
                onChange={(next) =>
                  setTetrisEffectsDraft((prev) => ({ ...prev, lockFlashIntensity: next }))
                }
              />
              <ColorInput
                label='Hard Drop Impact'
                value={tetrisEffectsDraft.hardDropImpactColor}
                onChange={(next) =>
                  setTetrisEffectsDraft((prev) => ({
                    ...prev,
                    hardDropImpactColor: next,
                  }))
                }
              />
              <RangeInput
                label='Impact Size'
                value={tetrisEffectsDraft.hardDropImpactSize}
                min={0}
                max={100}
                onChange={(next) =>
                  setTetrisEffectsDraft((prev) => ({ ...prev, hardDropImpactSize: next }))
                }
              />
            </div>
          </SectionCard>

          <SectionCard title='Validation'>
            <TetrisChecklist items={checklist} />
          </SectionCard>
        </div>
      </div>
    </div>
  );
}
