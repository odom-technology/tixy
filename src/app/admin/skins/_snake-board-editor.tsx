'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { RewardGameType } from '@/features/arcade/lib/rewards';
import { StoreItemPreview } from '@/features/arcade/components/store-item-preview';
import { InfoHint } from './_components';
import { contrastRatio } from './_types';
import type { ItemDraft, SnakeBoardDraft } from './_types';

const HEX_COLOR_RE = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

type BoardPreset = {
  id: string;
  label: string;
  draft: Partial<SnakeBoardDraft>;
};

const BOARD_PRESETS: BoardPreset[] = [
  {
    id: 'classic',
    label: 'Classic',
    draft: {
      boardColorA: '#aad751',
      boardColorB: '#a2d149',
      boardTileGradientEnabled: false,
      boardGlobalGradientEnabled: false,
      boardGridLineColor: '#6f9953',
      boardGridLineWidth: 1,
      boardBorderColor: '#5d7f45',
      boardBorderWidth: 2,
      boardVignette: 0,
    },
  },
  {
    id: 'neon',
    label: 'Neon Grid',
    draft: {
      boardColorA: '#0f172a',
      boardColorB: '#1e293b',
      boardTileColorA2: '#164e63',
      boardTileColorB2: '#155e75',
      boardTileGradientEnabled: true,
      boardTileGradientDirection: 'diagonal',
      boardGlobalGradientEnabled: true,
      boardGlobalGradientStart: '#0ea5e9',
      boardGlobalGradientEnd: '#0f172a',
      boardGlobalGradientDirection: 'radial',
      boardGlobalGradientStrength: 45,
      boardGridLineColor: '#22d3ee',
      boardGridLineWidth: 2,
      boardBorderColor: '#38bdf8',
      boardBorderWidth: 4,
      boardVignette: 30,
    },
  },
  {
    id: 'sand',
    label: 'Desert',
    draft: {
      boardColorA: '#caa86a',
      boardColorB: '#b8925a',
      boardTileColorA2: '#d4af76',
      boardTileColorB2: '#c98d4b',
      boardTileGradientEnabled: true,
      boardTileGradientDirection: 'horizontal',
      boardGlobalGradientEnabled: true,
      boardGlobalGradientStart: '#4b2b13',
      boardGlobalGradientEnd: '#000000',
      boardGlobalGradientDirection: 'vertical',
      boardGlobalGradientStrength: 20,
      boardGridLineColor: '#8f6c3a',
      boardGridLineWidth: 1,
      boardBorderColor: '#6d4f24',
      boardBorderWidth: 3,
      boardVignette: 18,
    },
  },
  {
    id: 'arctic-lab',
    label: 'Arctic Lab',
    draft: {
      boardColorA: '#dbeafe',
      boardColorB: '#bfdbfe',
      boardTileColorA2: '#93c5fd',
      boardTileColorB2: '#60a5fa',
      boardTileGradientEnabled: true,
      boardTileGradientDirection: 'vertical',
      boardGlobalGradientEnabled: true,
      boardGlobalGradientStart: '#0f172a',
      boardGlobalGradientEnd: '#1d4ed8',
      boardGlobalGradientDirection: 'diagonal',
      boardGlobalGradientStrength: 24,
      boardGridLineColor: '#1d4ed8',
      boardGridLineWidth: 1,
      boardBorderColor: '#1e40af',
      boardBorderWidth: 3,
      boardVignette: 34,
    },
  },
  {
    id: 'lava-grid',
    label: 'Lava Grid',
    draft: {
      boardColorA: '#7f1d1d',
      boardColorB: '#991b1b',
      boardTileColorA2: '#dc2626',
      boardTileColorB2: '#f97316',
      boardTileGradientEnabled: true,
      boardTileGradientDirection: 'radial',
      boardGlobalGradientEnabled: true,
      boardGlobalGradientStart: '#ffedd5',
      boardGlobalGradientEnd: '#450a0a',
      boardGlobalGradientDirection: 'radial',
      boardGlobalGradientStrength: 32,
      boardGridLineColor: '#fca5a5',
      boardGridLineWidth: 2,
      boardBorderColor: '#fb7185',
      boardBorderWidth: 4,
      boardVignette: 72,
    },
  },
  {
    id: 'violet-circuit',
    label: 'Violet Circuit',
    draft: {
      boardColorA: '#312e81',
      boardColorB: '#4c1d95',
      boardTileColorA2: '#6366f1',
      boardTileColorB2: '#8b5cf6',
      boardTileGradientEnabled: true,
      boardTileGradientDirection: 'diagonal',
      boardGlobalGradientEnabled: true,
      boardGlobalGradientStart: '#22d3ee',
      boardGlobalGradientEnd: '#0f172a',
      boardGlobalGradientDirection: 'horizontal',
      boardGlobalGradientStrength: 18,
      boardGridLineColor: '#c4b5fd',
      boardGridLineWidth: 1,
      boardBorderColor: '#a78bfa',
      boardBorderWidth: 2,
      boardVignette: 28,
    },
  },
  {
    id: 'emerald-temple',
    label: 'Emerald Temple',
    draft: {
      boardColorA: '#14532d',
      boardColorB: '#166534',
      boardTileColorA2: '#22c55e',
      boardTileColorB2: '#4ade80',
      boardTileGradientEnabled: true,
      boardTileGradientDirection: 'horizontal',
      boardGlobalGradientEnabled: true,
      boardGlobalGradientStart: '#bbf7d0',
      boardGlobalGradientEnd: '#052e16',
      boardGlobalGradientDirection: 'vertical',
      boardGlobalGradientStrength: 22,
      boardGridLineColor: '#86efac',
      boardGridLineWidth: 1,
      boardBorderColor: '#4ade80',
      boardBorderWidth: 3,
      boardVignette: 44,
    },
  },
  {
    id: 'void-matrix',
    label: 'Void Matrix',
    draft: {
      boardColorA: '#020617',
      boardColorB: '#111827',
      boardTileColorA2: '#0f172a',
      boardTileColorB2: '#1f2937',
      boardTileGradientEnabled: false,
      boardGlobalGradientEnabled: true,
      boardGlobalGradientStart: '#94a3b8',
      boardGlobalGradientEnd: '#000000',
      boardGlobalGradientDirection: 'radial',
      boardGlobalGradientStrength: 40,
      boardGridLineColor: '#475569',
      boardGridLineWidth: 0,
      boardBorderColor: '#64748b',
      boardBorderWidth: 4,
      boardVignette: 110,
    },
  },
];

const toValidHex = (value: string, fallback: string) => {
  const normalized = value.trim().startsWith('#')
    ? value.trim()
    : `#${value.trim()}`;
  return HEX_COLOR_RE.test(normalized) ? normalized.toLowerCase() : fallback;
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
  hint,
  onChange,
}: {
  label: string;
  value: string;
  hint?: string;
  onChange: (next: string) => void;
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
          className='h-8 w-12 rounded border border-soft bg-background p-1'
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
        <input
          className='h-8 w-full rounded border border-soft bg-background px-2 font-mono text-[11px]'
          value={textValue}
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

export function SnakeBoardEditor({
  itemDraft,
  snakeBoardDraft,
  setSnakeBoardDraft,
  editorPreviewAssetRef,
}: {
  itemDraft: ItemDraft;
  snakeBoardDraft: SnakeBoardDraft;
  setSnakeBoardDraft: React.Dispatch<React.SetStateAction<SnakeBoardDraft>>;
  editorPreviewAssetRef: Record<string, unknown>;
}) {
  const boardImageInputRef = useRef<HTMLInputElement | null>(null);
  const [boardImageUploading, setBoardImageUploading] = useState(false);
  const [boardImageError, setBoardImageError] = useState<string | null>(null);

  const handleUploadBoardImage = async (file: File) => {
    if (!file.type.startsWith('image/')) {
      setBoardImageError('Only image files are supported.');
      return;
    }
    setBoardImageUploading(true);
    setBoardImageError(null);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const response = await fetch('/api/storage/upload', {
        method: 'POST',
        body: formData,
      });
      const payload = (await response.json().catch(() => null)) as
        | { url?: string; error?: string }
        | null;
      if (!response.ok || !payload?.url) {
        throw new Error(payload?.error || 'Failed to upload board image.');
      }
      setSnakeBoardDraft((prev) => ({
        ...prev,
        boardImageUrl: payload.url!,
      }));
    } catch (error) {
      setBoardImageError(
        error instanceof Error ? error.message : 'Failed to upload board image.',
      );
    } finally {
      setBoardImageUploading(false);
    }
  };

  const boardWarnings = useMemo(() => {
    const warnings: string[] = [];

    if (
      contrastRatio(snakeBoardDraft.boardColorA, snakeBoardDraft.boardColorB) <
      1.08
    ) {
      warnings.push(
        'Tile colors are very similar; checkerboard pattern may be hard to notice.',
      );
    }

    if (
      snakeBoardDraft.boardGridLineWidth > 0 &&
      contrastRatio(
        snakeBoardDraft.boardGridLineColor,
        snakeBoardDraft.boardColorA,
      ) < 1.15 &&
      contrastRatio(
        snakeBoardDraft.boardGridLineColor,
        snakeBoardDraft.boardColorB,
      ) < 1.15
    ) {
      warnings.push('Grid line color blends into both tile colors.');
    }

    if (
      snakeBoardDraft.boardBorderWidth > 0 &&
      contrastRatio(
        snakeBoardDraft.boardBorderColor,
        snakeBoardDraft.boardColorA,
      ) < 1.2
    ) {
      warnings.push('Border color has low contrast with board tiles.');
    }

    return warnings;
  }, [snakeBoardDraft]);

  const boardChecklist = useMemo(
    () => [
      { label: 'Item name set', ok: itemDraft.name.trim().length > 0 },
      { label: 'Slot assigned', ok: itemDraft.slots.length > 0 },
      {
        label: 'Tile contrast readable',
        ok:
          snakeBoardDraft.boardImageUrl.trim().length > 0 ||
          contrastRatio(snakeBoardDraft.boardColorA, snakeBoardDraft.boardColorB) >= 1.08,
      },
      {
        label: 'Grid line configured (or hidden)',
        ok:
          snakeBoardDraft.boardGridLineWidth === 0 ||
          contrastRatio(
            snakeBoardDraft.boardGridLineColor,
            snakeBoardDraft.boardColorA,
          ) >= 1.15 ||
          contrastRatio(
            snakeBoardDraft.boardGridLineColor,
            snakeBoardDraft.boardColorB,
          ) >= 1.15,
      },
      {
        label: 'Border configured (or hidden)',
        ok:
          snakeBoardDraft.boardBorderWidth === 0 ||
          contrastRatio(
            snakeBoardDraft.boardBorderColor,
            snakeBoardDraft.boardColorA,
          ) >= 1.2 ||
          contrastRatio(
            snakeBoardDraft.boardBorderColor,
            snakeBoardDraft.boardColorB,
          ) >= 1.2,
      },
    ],
    [itemDraft.name, itemDraft.slots.length, snakeBoardDraft],
  );

  return (
    <div className='space-y-4 rounded-xl border border-soft bg-raised p-4'>
      <div>
        <p className='text-sm font-semibold'>Snake Board Editor</p>
        <p className='text-xs text-faint'>
          Start with base tiles, then layer gradients and edge effects.
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
              forceSquare
              snakeAlign='center'
            />
          </section>

          <section className='rounded-lg border border-soft bg-well p-3 space-y-2'>
            <p className='text-[11px] uppercase tracking-wide text-faint'>
              Quick Presets
            </p>
            <div className='grid grid-cols-1 gap-2 md:grid-cols-3 xl:grid-cols-1'>
              {BOARD_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type='button'
                  className='rounded-tag border border-soft bg-raised px-2 py-1.5 text-xs text-body shadow-chip transition-[filter] duration-[140ms] hover:brightness-110'
                  onClick={() =>
                    setSnakeBoardDraft((prev) => ({
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
            title='Board Image'
            subtitle='Upload an image texture to use as the board background.'
          >
            <div className='grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3'>
              <div className='flex flex-wrap items-center gap-2 sm:col-span-2 lg:col-span-3'>
                <button
                  type='button'
                  className='rounded-tag border border-soft bg-raised px-2 py-1.5 text-xs text-body shadow-chip transition-[filter] duration-[140ms] hover:brightness-110 disabled:opacity-60'
                  disabled={boardImageUploading}
                  onClick={() => boardImageInputRef.current?.click()}
                >
                  {boardImageUploading ? 'Uploading...' : 'Upload Image'}
                </button>
                <button
                  type='button'
                  className='rounded border border-soft px-2 py-1.5 text-xs hover:bg-raised disabled:opacity-60'
                  disabled={boardImageUploading || snakeBoardDraft.boardImageUrl.trim().length === 0}
                  onClick={() =>
                    setSnakeBoardDraft((prev) => ({
                      ...prev,
                      boardImageUrl: '',
                    }))
                  }
                >
                  Remove Image
                </button>
                <input
                  ref={boardImageInputRef}
                  type='file'
                  accept='image/*'
                  className='hidden'
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (!file) return;
                    void handleUploadBoardImage(file);
                    event.currentTarget.value = '';
                  }}
                />
              </div>
              {snakeBoardDraft.boardImageUrl.trim().length > 0 ? (
                <div className='sm:col-span-2 lg:col-span-3'>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={snakeBoardDraft.boardImageUrl}
                    alt='Board texture preview'
                    className='h-28 w-full rounded border border-soft object-cover'
                  />
                </div>
              ) : null}
              <label
                className={`text-xs space-y-1 sm:col-span-2 lg:col-span-3 ${
                  snakeBoardDraft.boardImageUrl.trim().length === 0
                    ? 'opacity-50 pointer-events-none'
                    : ''
                }`}
              >
                <span>Image Zoom ({snakeBoardDraft.boardImageZoom}%)</span>
                <input
                  type='range'
                  min={60}
                  max={220}
                  value={snakeBoardDraft.boardImageZoom}
                  onChange={(e) =>
                    setSnakeBoardDraft((prev) => ({
                      ...prev,
                      boardImageZoom: Number(e.target.value),
                    }))
                  }
                />
              </label>
              <label
                className={`text-xs space-y-1 sm:col-span-2 lg:col-span-3 ${
                  snakeBoardDraft.boardImageUrl.trim().length === 0
                    ? 'opacity-50 pointer-events-none'
                    : ''
                }`}
              >
                <span>Horizontal Crop ({snakeBoardDraft.boardImageOffsetX})</span>
                <input
                  type='range'
                  min={-100}
                  max={100}
                  value={snakeBoardDraft.boardImageOffsetX}
                  onChange={(e) =>
                    setSnakeBoardDraft((prev) => ({
                      ...prev,
                      boardImageOffsetX: Number(e.target.value),
                    }))
                  }
                />
              </label>
              <label
                className={`text-xs space-y-1 sm:col-span-2 lg:col-span-3 ${
                  snakeBoardDraft.boardImageUrl.trim().length === 0
                    ? 'opacity-50 pointer-events-none'
                    : ''
                }`}
              >
                <span>Vertical Crop ({snakeBoardDraft.boardImageOffsetY})</span>
                <input
                  type='range'
                  min={-100}
                  max={100}
                  value={snakeBoardDraft.boardImageOffsetY}
                  onChange={(e) =>
                    setSnakeBoardDraft((prev) => ({
                      ...prev,
                      boardImageOffsetY: Number(e.target.value),
                    }))
                  }
                />
              </label>
              {boardImageError ? (
                <p className='sm:col-span-2 lg:col-span-3 text-xs text-danger-text'>
                  {boardImageError}
                </p>
              ) : null}
            </div>
          </SectionCard>

          <SectionCard
            title='Base Tiles'
            subtitle='Checker colors and per-tile gradient controls.'
          >
            <div className='grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3'>
              <ColorInput
                label='Tile Color A'
                value={snakeBoardDraft.boardColorA}
                onChange={(next) =>
                  setSnakeBoardDraft((prev) => ({
                    ...prev,
                    boardColorA: next,
                  }))
                }
              />
              <ColorInput
                label='Tile Color B'
                value={snakeBoardDraft.boardColorB}
                onChange={(next) =>
                  setSnakeBoardDraft((prev) => ({
                    ...prev,
                    boardColorB: next,
                  }))
                }
              />
              <ColorInput
                label='Tile A Gradient Color'
                hint='Second color for tile A when tile gradients are enabled.'
                value={snakeBoardDraft.boardTileColorA2}
                onChange={(next) =>
                  setSnakeBoardDraft((prev) => ({
                    ...prev,
                    boardTileColorA2: next,
                  }))
                }
              />
              <ColorInput
                label='Tile B Gradient Color'
                hint='Second color for tile B when tile gradients are enabled.'
                value={snakeBoardDraft.boardTileColorB2}
                onChange={(next) =>
                  setSnakeBoardDraft((prev) => ({
                    ...prev,
                    boardTileColorB2: next,
                  }))
                }
              />

              <label className='text-xs space-y-1'>
                <span>
                  Tile Gradient
                  <InfoHint text='Applies a gradient inside each checker tile.' />
                </span>
                <select
                  className='w-full rounded border border-soft bg-background px-2 py-1'
                  value={snakeBoardDraft.boardTileGradientEnabled ? 'on' : 'off'}
                  onChange={(e) =>
                    setSnakeBoardDraft((prev) => ({
                      ...prev,
                      boardTileGradientEnabled: e.target.value === 'on',
                    }))
                  }
                >
                  <option value='off'>Off</option>
                  <option value='on'>On</option>
                </select>
              </label>

              <label
                className={`text-xs space-y-1 ${
                  !snakeBoardDraft.boardTileGradientEnabled
                    ? 'opacity-50 pointer-events-none'
                    : ''
                }`}
              >
                <span>Tile Gradient Direction</span>
                <select
                  className='w-full rounded border border-soft bg-background px-2 py-1'
                  value={snakeBoardDraft.boardTileGradientDirection}
                  onChange={(e) =>
                    setSnakeBoardDraft((prev) => ({
                      ...prev,
                      boardTileGradientDirection: e.target
                        .value as SnakeBoardDraft['boardTileGradientDirection'],
                    }))
                  }
                >
                  <option value='diagonal'>Diagonal</option>
                  <option value='horizontal'>Horizontal</option>
                  <option value='vertical'>Vertical</option>
                  <option value='radial'>Radial</option>
                </select>
              </label>
            </div>
          </SectionCard>

          <SectionCard
            title='Global Overlay And Frame'
            subtitle='Board-wide gradients plus grid and border tuning.'
          >
            <div className='grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3'>
              <label className='text-xs space-y-1'>
                <span>
                  Board Gradient
                  <InfoHint text='Applies a gradient across the entire board area.' />
                </span>
                <select
                  className='w-full rounded border border-soft bg-background px-2 py-1'
                  value={snakeBoardDraft.boardGlobalGradientEnabled ? 'on' : 'off'}
                  onChange={(e) =>
                    setSnakeBoardDraft((prev) => ({
                      ...prev,
                      boardGlobalGradientEnabled: e.target.value === 'on',
                    }))
                  }
                >
                  <option value='off'>Off</option>
                  <option value='on'>On</option>
                </select>
              </label>

              <ColorInput
                label='Global Gradient Start'
                value={snakeBoardDraft.boardGlobalGradientStart}
                onChange={(next) =>
                  setSnakeBoardDraft((prev) => ({
                    ...prev,
                    boardGlobalGradientStart: next,
                  }))
                }
              />

              <ColorInput
                label='Global Gradient End'
                value={snakeBoardDraft.boardGlobalGradientEnd}
                onChange={(next) =>
                  setSnakeBoardDraft((prev) => ({
                    ...prev,
                    boardGlobalGradientEnd: next,
                  }))
                }
              />

              <label
                className={`text-xs space-y-1 ${
                  !snakeBoardDraft.boardGlobalGradientEnabled
                    ? 'opacity-50 pointer-events-none'
                    : ''
                }`}
              >
                <span>Global Gradient Direction</span>
                <select
                  className='w-full rounded border border-soft bg-background px-2 py-1'
                  value={snakeBoardDraft.boardGlobalGradientDirection}
                  onChange={(e) =>
                    setSnakeBoardDraft((prev) => ({
                      ...prev,
                      boardGlobalGradientDirection: e.target
                        .value as SnakeBoardDraft['boardGlobalGradientDirection'],
                    }))
                  }
                >
                  <option value='diagonal'>Diagonal</option>
                  <option value='horizontal'>Horizontal</option>
                  <option value='vertical'>Vertical</option>
                  <option value='radial'>Radial</option>
                </select>
              </label>

              <label
                className={`text-xs space-y-1 ${
                  !snakeBoardDraft.boardGlobalGradientEnabled
                    ? 'opacity-50 pointer-events-none'
                    : ''
                }`}
              >
                <span>
                  Global Gradient Strength ({snakeBoardDraft.boardGlobalGradientStrength}%)
                </span>
                <input
                  type='range'
                  min={0}
                  max={100}
                  value={snakeBoardDraft.boardGlobalGradientStrength}
                  onChange={(e) =>
                    setSnakeBoardDraft((prev) => ({
                      ...prev,
                      boardGlobalGradientStrength: Number(e.target.value),
                    }))
                  }
                />
              </label>

              <ColorInput
                label='Grid Line Color'
                hint='Used for cell separators.'
                value={snakeBoardDraft.boardGridLineColor}
                onChange={(next) =>
                  setSnakeBoardDraft((prev) => ({
                    ...prev,
                    boardGridLineColor: next,
                  }))
                }
              />

              <label className='text-xs space-y-1'>
                <span>
                  Grid Line Width ({snakeBoardDraft.boardGridLineWidth}px)
                  <InfoHint text='Set to 0 to hide grid lines.' />
                </span>
                <input
                  type='range'
                  min={0}
                  max={4}
                  value={snakeBoardDraft.boardGridLineWidth}
                  onChange={(e) =>
                    setSnakeBoardDraft((prev) => ({
                      ...prev,
                      boardGridLineWidth: Number(e.target.value),
                    }))
                  }
                />
              </label>

              <ColorInput
                label='Outer Border Color'
                hint='Color of the board edge outline.'
                value={snakeBoardDraft.boardBorderColor}
                onChange={(next) =>
                  setSnakeBoardDraft((prev) => ({
                    ...prev,
                    boardBorderColor: next,
                  }))
                }
              />

              <label className='text-xs space-y-1'>
                <span>
                  Border Width ({snakeBoardDraft.boardBorderWidth}px)
                  <InfoHint text='Set to 0 to hide the outer border.' />
                </span>
                <input
                  type='range'
                  min={0}
                  max={10}
                  value={snakeBoardDraft.boardBorderWidth}
                  onChange={(e) =>
                    setSnakeBoardDraft((prev) => ({
                      ...prev,
                      boardBorderWidth: Number(e.target.value),
                    }))
                  }
                />
              </label>

              <label className='text-xs space-y-1 sm:col-span-2 lg:col-span-3'>
                <span>
                  Edge Vignette ({snakeBoardDraft.boardVignette}%)
                  <InfoHint text='Darkens board edges for depth. Extended range for dramatic mood.' />
                </span>
                <input
                  type='range'
                  min={0}
                  max={200}
                  value={snakeBoardDraft.boardVignette}
                  onChange={(e) =>
                    setSnakeBoardDraft((prev) => ({
                      ...prev,
                      boardVignette: Number(e.target.value),
                    }))
                  }
                />
              </label>
            </div>
          </SectionCard>

          <SectionCard
            title='Validation'
            subtitle='Quick checks before publishing this board.'
          >
            {boardWarnings.length > 0 ? (
              <div className='space-y-1'>
                {boardWarnings.map((warning) => (
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
              {boardChecklist.map((item) => (
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
