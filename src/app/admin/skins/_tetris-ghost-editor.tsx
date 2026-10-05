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
import type { ItemDraft, TetrisGhostDraft } from './_types';

type GhostPreset = {
  id: string;
  label: string;
  draft: Partial<TetrisGhostDraft>;
};

const GHOST_PRESETS: GhostPreset[] = [
  {
    id: 'classic',
    label: 'Classic Ghost',
    draft: {
      ghostStyle: 'filled-translucent',
      ghostOpacity: 20,
      ghostTintEnabled: false,
      panelBgColor: '#0a0a14',
      panelBorderColor: '#2a2a3a',
      panelAccentColor: '#64c8ff',
    },
  },
  {
    id: 'neon',
    label: 'Neon Ghost',
    draft: {
      ghostStyle: 'dashed',
      ghostOpacity: 45,
      ghostTintEnabled: true,
      ghostTintColor: '#00ffff',
      panelBgColor: '#050510',
      panelBorderColor: '#00ffff',
      panelAccentColor: '#ff00ff',
    },
  },
  {
    id: 'stealth',
    label: 'Stealth',
    draft: {
      ghostStyle: 'outline',
      ghostOpacity: 10,
      ghostTintEnabled: false,
      panelBgColor: '#0a0a14',
      panelBorderColor: '#1a1a2a',
      panelAccentColor: '#3a3a5a',
    },
  },
  {
    id: 'holo',
    label: 'Holo',
    draft: {
      ghostStyle: 'filled-translucent',
      ghostOpacity: 35,
      ghostTintEnabled: true,
      ghostTintColor: '#a855f7',
      panelBgColor: '#0f0818',
      panelBorderColor: '#a855f7',
      panelAccentColor: '#ec4899',
    },
  },
];

export function TetrisGhostEditor({
  itemDraft,
  tetrisGhostDraft,
  setTetrisGhostDraft,
  editorPreviewAssetRef,
}: {
  itemDraft: ItemDraft;
  tetrisGhostDraft: TetrisGhostDraft;
  setTetrisGhostDraft: React.Dispatch<React.SetStateAction<TetrisGhostDraft>>;
  editorPreviewAssetRef: Record<string, unknown> | null;
}) {
  const checklist = useMemo(
    () => [
      { label: 'Item name set', ok: itemDraft.name.trim().length > 0 },
      { label: 'Slot assigned', ok: itemDraft.slots.length > 0 },
      {
        label: 'Ghost visible (opacity >= 10)',
        ok: tetrisGhostDraft.ghostOpacity >= 10,
      },
    ],
    [itemDraft.name, itemDraft.slots.length, tetrisGhostDraft.ghostOpacity],
  );

  return (
    <div className='space-y-4 rounded-xl border border-soft bg-raised p-4'>
      <div>
        <p className='text-sm font-semibold'>Tetris Ghost & Panels Editor</p>
        <p className='text-xs text-faint'>
          Style the ghost piece projection and the Hold/Next preview panels.
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
                slots: itemDraft.slots.length > 0 ? itemDraft.slots : ['ghost'],
                assetRef: editorPreviewAssetRef,
              }}
            />
          </section>

          <section className='rounded-lg border border-soft bg-well p-3 space-y-2'>
            <p className='text-[11px] uppercase tracking-wide text-faint'>
              Quick Presets
            </p>
            <div className='grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-1'>
              {GHOST_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type='button'
                  className='rounded-tag border border-soft bg-raised px-2 py-1.5 text-xs text-body shadow-chip transition-[filter] duration-[140ms] hover:brightness-110'
                  onClick={() =>
                    setTetrisGhostDraft((prev) => ({ ...prev, ...preset.draft }))
                  }
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </section>
        </aside>

        <div className='space-y-3'>
          <SectionCard title='Ghost Piece'>
            <div className='grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3'>
              <label className='text-xs space-y-1'>
                <span>Style</span>
                <select
                  className='w-full rounded border border-soft bg-background px-2 py-1.5 text-xs'
                  value={tetrisGhostDraft.ghostStyle}
                  onChange={(event) =>
                    setTetrisGhostDraft((prev) => ({
                      ...prev,
                      ghostStyle: event.target.value as TetrisGhostDraft['ghostStyle'],
                    }))
                  }
                >
                  <option value='outline'>Outline</option>
                  <option value='filled-translucent'>Filled Translucent</option>
                  <option value='dashed'>Dashed</option>
                </select>
              </label>
              <RangeInput
                label='Opacity'
                value={tetrisGhostDraft.ghostOpacity}
                min={5}
                max={60}
                onChange={(next) =>
                  setTetrisGhostDraft((prev) => ({ ...prev, ghostOpacity: next }))
                }
              />
              <label className='inline-flex items-center gap-2 rounded border border-soft bg-background px-2 py-2 text-xs'>
                <input
                  type='checkbox'
                  checked={tetrisGhostDraft.ghostTintEnabled}
                  onChange={(event) =>
                    setTetrisGhostDraft((prev) => ({
                      ...prev,
                      ghostTintEnabled: event.target.checked,
                    }))
                  }
                />
                Tint Override
              </label>
              <ColorInput
                label='Tint Color'
                value={tetrisGhostDraft.ghostTintColor}
                onChange={(next) =>
                  setTetrisGhostDraft((prev) => ({ ...prev, ghostTintColor: next }))
                }
                hint='When enabled, overrides the piece color for the ghost.'
              />
            </div>
          </SectionCard>

          <SectionCard title='Hold / Next Panels'>
            <div className='grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3'>
              <ColorInput
                label='Panel Background'
                value={tetrisGhostDraft.panelBgColor}
                onChange={(next) =>
                  setTetrisGhostDraft((prev) => ({ ...prev, panelBgColor: next }))
                }
              />
              <ColorInput
                label='Panel Border'
                value={tetrisGhostDraft.panelBorderColor}
                onChange={(next) =>
                  setTetrisGhostDraft((prev) => ({ ...prev, panelBorderColor: next }))
                }
              />
              <ColorInput
                label='Panel Accent'
                value={tetrisGhostDraft.panelAccentColor}
                onChange={(next) =>
                  setTetrisGhostDraft((prev) => ({ ...prev, panelAccentColor: next }))
                }
                hint='Used for panel headers and highlights.'
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
