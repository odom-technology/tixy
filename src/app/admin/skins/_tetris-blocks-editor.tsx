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
import type { ItemDraft, TetrisBlocksDraft } from './_types';

type BlocksPreset = {
  id: string;
  label: string;
  draft: Partial<TetrisBlocksDraft>;
};

const BLOCKS_PRESETS: BlocksPreset[] = [
  {
    id: 'standard',
    label: 'Arcade Classic',
    draft: {
      colorI: '#00f0f0', colorO: '#f0f000', colorT: '#a000f0',
      colorS: '#00f000', colorZ: '#f00000', colorJ: '#0000f0', colorL: '#f0a000',
      blockShading: 'bevel', highlightIntensity: 15, borderWidth: 0,
      blockGlowEnabled: false,
    },
  },
  {
    id: 'neon',
    label: 'Neon Pulse',
    draft: {
      colorI: '#00e5ff', colorO: '#ffe600', colorT: '#e000ff',
      colorS: '#00ff7f', colorZ: '#ff1744', colorJ: '#2979ff', colorL: '#ff9100',
      blockShading: 'neon', highlightIntensity: 35,
      blockGlowEnabled: true, blockGlowColor: '#ffffff', blockGlowSize: 70,
    },
  },
  {
    id: 'chrome',
    label: 'Chrome',
    draft: {
      colorI: '#b0e0ff', colorO: '#ffeb99', colorT: '#d4a5ff',
      colorS: '#99ffa8', colorZ: '#ff9999', colorJ: '#99b5ff', colorL: '#ffc988',
      blockShading: 'gradient', highlightColor: '#ffffff', highlightIntensity: 45,
      borderColor: '#2a2a3a', borderWidth: 1,
    },
  },
  {
    id: 'monochrome',
    label: 'Monochrome',
    draft: {
      colorI: '#e5e5e5', colorO: '#cccccc', colorT: '#999999',
      colorS: '#b3b3b3', colorZ: '#7f7f7f', colorJ: '#4d4d4d', colorL: '#666666',
      blockShading: 'flat', highlightIntensity: 25,
      borderColor: '#000000', borderWidth: 1,
    },
  },
  {
    id: 'candy',
    label: 'Candy',
    draft: {
      colorI: '#67e8f9', colorO: '#fde68a', colorT: '#f0abfc',
      colorS: '#86efac', colorZ: '#fda4af', colorJ: '#a5b4fc', colorL: '#fdba74',
      blockShading: 'bevel', highlightIntensity: 30,
      blockGlowEnabled: false,
    },
  },
];

export function TetrisBlocksEditor({
  itemDraft,
  tetrisBlocksDraft,
  setTetrisBlocksDraft,
  editorPreviewAssetRef,
}: {
  itemDraft: ItemDraft;
  tetrisBlocksDraft: TetrisBlocksDraft;
  setTetrisBlocksDraft: React.Dispatch<React.SetStateAction<TetrisBlocksDraft>>;
  editorPreviewAssetRef: Record<string, unknown> | null;
}) {
  const checklist = useMemo(
    () => [
      { label: 'Item name set', ok: itemDraft.name.trim().length > 0 },
      { label: 'Slot assigned', ok: itemDraft.slots.length > 0 },
      {
        label: 'Glow configured (or disabled)',
        ok: !tetrisBlocksDraft.blockGlowEnabled || tetrisBlocksDraft.blockGlowSize >= 10,
      },
    ],
    [
      itemDraft.name,
      itemDraft.slots.length,
      tetrisBlocksDraft.blockGlowEnabled,
      tetrisBlocksDraft.blockGlowSize,
    ],
  );

  return (
    <div className='space-y-4 rounded-xl border border-soft bg-raised p-4'>
      <div>
        <p className='text-sm font-semibold'>Tetris Blocks Editor</p>
        <p className='text-xs text-faint'>
          Customize the 7 tetromino colors, shading, highlights, and glow.
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
                slots: itemDraft.slots.length > 0 ? itemDraft.slots : ['blocks'],
                assetRef: editorPreviewAssetRef,
              }}
            />
          </section>

          <section className='rounded-lg border border-soft bg-well p-3 space-y-2'>
            <p className='text-[11px] uppercase tracking-wide text-faint'>
              Quick Presets
            </p>
            <div className='grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-1'>
              {BLOCKS_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type='button'
                  className='rounded-tag border border-soft bg-raised px-2 py-1.5 text-xs text-body shadow-chip transition-[filter] duration-[140ms] hover:brightness-110'
                  onClick={() =>
                    setTetrisBlocksDraft((prev) => ({ ...prev, ...preset.draft }))
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
            title='Piece Colors'
            subtitle='One color per tetromino (I, O, T, S, Z, J, L).'
          >
            <div className='grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3'>
              <ColorInput
                label='I (line)'
                value={tetrisBlocksDraft.colorI}
                onChange={(next) => setTetrisBlocksDraft((prev) => ({ ...prev, colorI: next }))}
              />
              <ColorInput
                label='O (square)'
                value={tetrisBlocksDraft.colorO}
                onChange={(next) => setTetrisBlocksDraft((prev) => ({ ...prev, colorO: next }))}
              />
              <ColorInput
                label='T'
                value={tetrisBlocksDraft.colorT}
                onChange={(next) => setTetrisBlocksDraft((prev) => ({ ...prev, colorT: next }))}
              />
              <ColorInput
                label='S'
                value={tetrisBlocksDraft.colorS}
                onChange={(next) => setTetrisBlocksDraft((prev) => ({ ...prev, colorS: next }))}
              />
              <ColorInput
                label='Z'
                value={tetrisBlocksDraft.colorZ}
                onChange={(next) => setTetrisBlocksDraft((prev) => ({ ...prev, colorZ: next }))}
              />
              <ColorInput
                label='J'
                value={tetrisBlocksDraft.colorJ}
                onChange={(next) => setTetrisBlocksDraft((prev) => ({ ...prev, colorJ: next }))}
              />
              <ColorInput
                label='L'
                value={tetrisBlocksDraft.colorL}
                onChange={(next) => setTetrisBlocksDraft((prev) => ({ ...prev, colorL: next }))}
              />
            </div>
          </SectionCard>

          <SectionCard
            title='Shading & Highlight'
            subtitle='How pieces are rendered: flat, beveled, gradient, or neon.'
          >
            <div className='grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3'>
              <label className='text-xs space-y-1'>
                <span>Shading</span>
                <select
                  className='w-full rounded border border-soft bg-background px-2 py-1.5 text-xs'
                  value={tetrisBlocksDraft.blockShading}
                  onChange={(event) =>
                    setTetrisBlocksDraft((prev) => ({
                      ...prev,
                      blockShading: event.target.value as TetrisBlocksDraft['blockShading'],
                    }))
                  }
                >
                  <option value='flat'>Flat</option>
                  <option value='bevel'>Bevel</option>
                  <option value='gradient'>Gradient</option>
                  <option value='neon'>Neon</option>
                </select>
              </label>
              <ColorInput
                label='Highlight'
                value={tetrisBlocksDraft.highlightColor}
                onChange={(next) =>
                  setTetrisBlocksDraft((prev) => ({ ...prev, highlightColor: next }))
                }
              />
              <RangeInput
                label='Highlight Intensity'
                value={tetrisBlocksDraft.highlightIntensity}
                min={0}
                max={100}
                onChange={(next) =>
                  setTetrisBlocksDraft((prev) => ({ ...prev, highlightIntensity: next }))
                }
              />
              <ColorInput
                label='Border Color'
                value={tetrisBlocksDraft.borderColor}
                onChange={(next) =>
                  setTetrisBlocksDraft((prev) => ({ ...prev, borderColor: next }))
                }
              />
              <RangeInput
                label='Border Width'
                value={tetrisBlocksDraft.borderWidth}
                min={0}
                max={4}
                onChange={(next) =>
                  setTetrisBlocksDraft((prev) => ({ ...prev, borderWidth: next }))
                }
              />
            </div>
          </SectionCard>

          <SectionCard
            title='Glow'
            subtitle='Optional aura around the active piece. Higher rarity items typically enable this.'
          >
            <div className='grid grid-cols-1 gap-3 sm:grid-cols-2'>
              <label className='inline-flex items-center gap-2 rounded border border-soft bg-background px-2 py-2 text-xs'>
                <input
                  type='checkbox'
                  checked={tetrisBlocksDraft.blockGlowEnabled}
                  onChange={(event) =>
                    setTetrisBlocksDraft((prev) => ({
                      ...prev,
                      blockGlowEnabled: event.target.checked,
                    }))
                  }
                />
                Enable Glow
              </label>
              <ColorInput
                label='Glow Color'
                value={tetrisBlocksDraft.blockGlowColor}
                onChange={(next) =>
                  setTetrisBlocksDraft((prev) => ({ ...prev, blockGlowColor: next }))
                }
              />
              <RangeInput
                label='Glow Size'
                value={tetrisBlocksDraft.blockGlowSize}
                min={0}
                max={100}
                onChange={(next) =>
                  setTetrisBlocksDraft((prev) => ({ ...prev, blockGlowSize: next }))
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
