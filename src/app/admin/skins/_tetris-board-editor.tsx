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
import type { ItemDraft, TetrisBoardDraft } from './_types';

type BoardPreset = {
  id: string;
  label: string;
  draft: Partial<TetrisBoardDraft>;
};

const BOARD_PRESETS: BoardPreset[] = [
  {
    id: 'midnight',
    label: 'Midnight Grid',
    draft: {
      boardBgMode: 'solid', boardBgStart: '#0a0a14', boardBgEnd: '#0a0a14',
      gridLineColor: '#ffffff', gridLineWidth: 1, gridVisible: true,
      borderColor: '#64c8ff', borderWidth: 2, borderGlowEnabled: false,
    },
  },
  {
    id: 'aurora',
    label: 'Aurora',
    draft: {
      boardBgMode: 'linear', boardBgStart: '#0a1a2e', boardBgEnd: '#1a0a2e',
      gridLineColor: '#ffffff', gridLineWidth: 1,
      borderColor: '#a855f7', borderWidth: 3,
      borderGlowEnabled: true, borderGlowColor: '#a855f7',
    },
  },
  {
    id: 'hologrid',
    label: 'Hologrid',
    draft: {
      boardBgMode: 'radial', boardBgStart: '#001a2e', boardBgEnd: '#000511',
      gridLineColor: '#00ffff', gridLineWidth: 1, gridVisible: true,
      borderColor: '#00ffff', borderWidth: 2,
      borderGlowEnabled: true, borderGlowColor: '#00ffff',
      emptyCellTint: '#00ffff', emptyCellTintStrength: 3, vignette: 30,
    },
  },
  {
    id: 'retro-arcade',
    label: 'Retro Arcade',
    draft: {
      boardBgMode: 'solid', boardBgStart: '#000000', boardBgEnd: '#000000',
      gridLineColor: '#ff00ff', gridLineWidth: 1, gridVisible: true,
      borderColor: '#ff00ff', borderWidth: 3, borderGlowEnabled: true,
      borderGlowColor: '#ff00ff', vignette: 20,
    },
  },
  {
    id: 'parchment',
    label: 'Parchment',
    draft: {
      boardBgMode: 'radial', boardBgStart: '#3a2e1f', boardBgEnd: '#1a1408',
      gridLineColor: '#d4a574', gridLineWidth: 1,
      borderColor: '#8b6f3a', borderWidth: 3, borderGlowEnabled: false,
      vignette: 45,
    },
  },
];

export function TetrisBoardEditor({
  itemDraft,
  tetrisBoardDraft,
  setTetrisBoardDraft,
  editorPreviewAssetRef,
}: {
  itemDraft: ItemDraft;
  tetrisBoardDraft: TetrisBoardDraft;
  setTetrisBoardDraft: React.Dispatch<React.SetStateAction<TetrisBoardDraft>>;
  editorPreviewAssetRef: Record<string, unknown> | null;
}) {
  const checklist = useMemo(
    () => [
      { label: 'Item name set', ok: itemDraft.name.trim().length > 0 },
      { label: 'Slot assigned', ok: itemDraft.slots.length > 0 },
      {
        label: 'Grid visible for playability',
        ok: tetrisBoardDraft.gridVisible || tetrisBoardDraft.borderWidth >= 2,
      },
    ],
    [
      itemDraft.name,
      itemDraft.slots.length,
      tetrisBoardDraft.gridVisible,
      tetrisBoardDraft.borderWidth,
    ],
  );

  return (
    <div className='space-y-4 rounded-xl border border-soft bg-raised p-4'>
      <div>
        <p className='text-sm font-semibold'>Tetris Board Editor</p>
        <p className='text-xs text-faint'>
          Customize the playfield background, grid lines, border, and vignette.
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
                slots: itemDraft.slots.length > 0 ? itemDraft.slots : ['board'],
                assetRef: editorPreviewAssetRef,
              }}
            />
          </section>

          <section className='rounded-lg border border-soft bg-well p-3 space-y-2'>
            <p className='text-[11px] uppercase tracking-wide text-faint'>
              Quick Presets
            </p>
            <div className='grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-1'>
              {BOARD_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type='button'
                  className='rounded-tag border border-soft bg-raised px-2 py-1.5 text-xs text-body shadow-chip transition-[filter] duration-[140ms] hover:brightness-110'
                  onClick={() =>
                    setTetrisBoardDraft((prev) => ({ ...prev, ...preset.draft }))
                  }
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </section>
        </aside>

        <div className='space-y-3'>
          <SectionCard title='Background'>
            <div className='grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3'>
              <label className='text-xs space-y-1'>
                <span>Background Mode</span>
                <select
                  className='w-full rounded border border-soft bg-background px-2 py-1.5 text-xs'
                  value={tetrisBoardDraft.boardBgMode}
                  onChange={(event) =>
                    setTetrisBoardDraft((prev) => ({
                      ...prev,
                      boardBgMode: event.target.value as TetrisBoardDraft['boardBgMode'],
                    }))
                  }
                >
                  <option value='solid'>Solid</option>
                  <option value='linear'>Linear Gradient</option>
                  <option value='radial'>Radial Gradient</option>
                </select>
              </label>
              <ColorInput
                label='BG Start'
                value={tetrisBoardDraft.boardBgStart}
                onChange={(next) =>
                  setTetrisBoardDraft((prev) => ({ ...prev, boardBgStart: next }))
                }
              />
              <ColorInput
                label='BG End'
                value={tetrisBoardDraft.boardBgEnd}
                onChange={(next) =>
                  setTetrisBoardDraft((prev) => ({ ...prev, boardBgEnd: next }))
                }
                hint='Only applies to gradient modes.'
              />
            </div>
          </SectionCard>

          <SectionCard title='Grid Lines'>
            <div className='grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3'>
              <label className='inline-flex items-center gap-2 rounded border border-soft bg-background px-2 py-2 text-xs'>
                <input
                  type='checkbox'
                  checked={tetrisBoardDraft.gridVisible}
                  onChange={(event) =>
                    setTetrisBoardDraft((prev) => ({
                      ...prev,
                      gridVisible: event.target.checked,
                    }))
                  }
                />
                Show Grid
              </label>
              <ColorInput
                label='Grid Color'
                value={tetrisBoardDraft.gridLineColor}
                onChange={(next) =>
                  setTetrisBoardDraft((prev) => ({ ...prev, gridLineColor: next }))
                }
              />
              <RangeInput
                label='Grid Width'
                value={tetrisBoardDraft.gridLineWidth}
                min={0}
                max={4}
                onChange={(next) =>
                  setTetrisBoardDraft((prev) => ({ ...prev, gridLineWidth: next }))
                }
              />
            </div>
          </SectionCard>

          <SectionCard title='Border & Glow'>
            <div className='grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3'>
              <ColorInput
                label='Border Color'
                value={tetrisBoardDraft.borderColor}
                onChange={(next) =>
                  setTetrisBoardDraft((prev) => ({ ...prev, borderColor: next }))
                }
              />
              <RangeInput
                label='Border Width'
                value={tetrisBoardDraft.borderWidth}
                min={0}
                max={8}
                onChange={(next) =>
                  setTetrisBoardDraft((prev) => ({ ...prev, borderWidth: next }))
                }
              />
              <label className='inline-flex items-center gap-2 rounded border border-soft bg-background px-2 py-2 text-xs'>
                <input
                  type='checkbox'
                  checked={tetrisBoardDraft.borderGlowEnabled}
                  onChange={(event) =>
                    setTetrisBoardDraft((prev) => ({
                      ...prev,
                      borderGlowEnabled: event.target.checked,
                    }))
                  }
                />
                Enable Border Glow
              </label>
              <ColorInput
                label='Glow Color'
                value={tetrisBoardDraft.borderGlowColor}
                onChange={(next) =>
                  setTetrisBoardDraft((prev) => ({ ...prev, borderGlowColor: next }))
                }
              />
            </div>
          </SectionCard>

          <SectionCard title='Ambience'>
            <div className='grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3'>
              <ColorInput
                label='Empty Cell Tint'
                value={tetrisBoardDraft.emptyCellTint}
                onChange={(next) =>
                  setTetrisBoardDraft((prev) => ({ ...prev, emptyCellTint: next }))
                }
                hint='Subtle tint laid over empty cells.'
              />
              <RangeInput
                label='Tint Strength'
                value={tetrisBoardDraft.emptyCellTintStrength}
                min={0}
                max={20}
                onChange={(next) =>
                  setTetrisBoardDraft((prev) => ({ ...prev, emptyCellTintStrength: next }))
                }
              />
              <RangeInput
                label='Vignette'
                value={tetrisBoardDraft.vignette}
                min={0}
                max={100}
                onChange={(next) =>
                  setTetrisBoardDraft((prev) => ({ ...prev, vignette: next }))
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
