'use client';

import { useEffect, useState } from 'react';
import { InfoHint } from './_components';
import type {
  ItemDraft,
  Game2048TilesDraft,
  Game2048GridDraft,
  Game2048BackgroundDraft,
} from './_types';

// ─── Shared inline inputs ───────────────────────────────────────────────────

function ColorInput({
  label,
  value,
  onChange,
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  hint?: string;
}) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
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
          onChange={(e) => onChange(e.target.value)}
        />
        <input
          className='h-8 w-full rounded border border-soft bg-background px-2 font-mono text-[11px]'
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => onChange(text)}
        />
      </div>
    </label>
  );
}

function TilePairInput({
  tier,
  bgValue,
  fgValue,
  onBgChange,
  onFgChange,
}: {
  tier: string;
  bgValue: string;
  fgValue: string;
  onBgChange: (v: string) => void;
  onFgChange: (v: string) => void;
}) {
  return (
    <div className='flex items-center gap-3 rounded border border-soft bg-well px-3 py-2'>
      <div
        className='flex h-9 w-12 flex-none items-center justify-center rounded text-xs font-bold tabular-nums'
        style={{ background: bgValue, color: fgValue }}
      >
        {tier}
      </div>
      <div className='grid flex-1 grid-cols-2 gap-2'>
        <ColorInput label='Bg' value={bgValue} onChange={onBgChange} />
        <ColorInput label='Text' value={fgValue} onChange={onFgChange} />
      </div>
    </div>
  );
}

function Toggle({
  label,
  value,
  onChange,
  hint,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
  hint?: string;
}) {
  return (
    <label className='flex items-center gap-2 text-xs cursor-pointer'>
      <input
        type='checkbox'
        checked={value}
        onChange={(e) => onChange(e.target.checked)}
        className='h-4 w-4 rounded border-soft'
      />
      <span>{label}</span>
      {hint ? <InfoHint text={hint} /> : null}
    </label>
  );
}

function NumberSlider({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  hint,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step?: number;
  hint?: string;
}) {
  return (
    <label className='text-xs space-y-1'>
      <span className='inline-flex items-center justify-between gap-2'>
        <span className='inline-flex items-center'>
          {label}
          {hint ? <InfoHint text={hint} /> : null}
        </span>
        <span className='font-mono text-[11px] text-faint'>{value}</span>
      </span>
      <input
        type='range'
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className='h-2 w-full cursor-pointer'
      />
    </label>
  );
}

// ─── Tiles Editor ──────────────────────────────────────────────────────────

function TilesPreview({ draft }: { draft: Game2048TilesDraft }) {
  // 4×4 sample showing the full color ramp. Board-gap matches the in-game
  // spacing so the live preview is faithful.
  const samples: Array<{ row: number; col: number; value: number }> = [
    { row: 0, col: 0, value: 2 },
    { row: 0, col: 1, value: 4 },
    { row: 0, col: 2, value: 8 },
    { row: 0, col: 3, value: 16 },
    { row: 1, col: 0, value: 32 },
    { row: 1, col: 1, value: 64 },
    { row: 1, col: 2, value: 128 },
    { row: 1, col: 3, value: 256 },
    { row: 2, col: 0, value: 512 },
    { row: 2, col: 1, value: 1024 },
    { row: 2, col: 2, value: 2048 },
  ];
  const color = (v: number): { bg: string; fg: string } => {
    const map: Record<number, { bg: string; fg: string }> = {
      2: { bg: draft.tile2Bg, fg: draft.tile2Fg },
      4: { bg: draft.tile4Bg, fg: draft.tile4Fg },
      8: { bg: draft.tile8Bg, fg: draft.tile8Fg },
      16: { bg: draft.tile16Bg, fg: draft.tile16Fg },
      32: { bg: draft.tile32Bg, fg: draft.tile32Fg },
      64: { bg: draft.tile64Bg, fg: draft.tile64Fg },
      128: { bg: draft.tile128Bg, fg: draft.tile128Fg },
      256: { bg: draft.tile256Bg, fg: draft.tile256Fg },
      512: { bg: draft.tile512Bg, fg: draft.tile512Fg },
      1024: { bg: draft.tile1024Bg, fg: draft.tile1024Fg },
      2048: { bg: draft.tile2048Bg, fg: draft.tile2048Fg },
    };
    return map[v] ?? { bg: draft.tileFallbackBg, fg: draft.tileFallbackFg };
  };
  return (
    <div className='rounded-lg bg-[#bbada0] p-3'>
      <div className='grid grid-cols-4 grid-rows-3 gap-2'>
        {Array.from({ length: 12 }).map((_, idx) => {
          const row = Math.floor(idx / 4);
          const col = idx % 4;
          const sample = samples.find((s) => s.row === row && s.col === col);
          if (!sample) {
            return (
              <div
                key={idx}
                className='h-14 w-14 rounded-md'
                style={{ background: '#cdc1b4' }}
              />
            );
          }
          const c = color(sample.value);
          const glowOn =
            draft.glowSize > 0 && sample.value >= draft.glowThreshold;
          return (
            <div
              key={idx}
              className='flex h-14 w-14 items-center justify-center rounded-md text-sm font-black tabular-nums'
              style={{
                background: c.bg,
                color: c.fg,
                boxShadow: glowOn ? `0 0 ${draft.glowSize}px ${draft.glowColor}` : undefined,
              }}
            >
              {sample.value}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function Game2048TilesEditor({
  itemDraft,
  game2048TilesDraft,
  setGame2048TilesDraft,
}: {
  itemDraft: ItemDraft;
  game2048TilesDraft: Game2048TilesDraft;
  setGame2048TilesDraft: React.Dispatch<React.SetStateAction<Game2048TilesDraft>>;
}) {
  const setField = <K extends keyof Game2048TilesDraft>(key: K) =>
    (v: Game2048TilesDraft[K]) =>
      setGame2048TilesDraft((prev) => ({ ...prev, [key]: v }));

  const tiers: Array<{
    label: string;
    bgKey: keyof Game2048TilesDraft;
    fgKey: keyof Game2048TilesDraft;
  }> = [
    { label: '2',   bgKey: 'tile2Bg',   fgKey: 'tile2Fg' },
    { label: '4',   bgKey: 'tile4Bg',   fgKey: 'tile4Fg' },
    { label: '8',   bgKey: 'tile8Bg',   fgKey: 'tile8Fg' },
    { label: '16',  bgKey: 'tile16Bg',  fgKey: 'tile16Fg' },
    { label: '32',  bgKey: 'tile32Bg',  fgKey: 'tile32Fg' },
    { label: '64',  bgKey: 'tile64Bg',  fgKey: 'tile64Fg' },
    { label: '128', bgKey: 'tile128Bg', fgKey: 'tile128Fg' },
    { label: '256', bgKey: 'tile256Bg', fgKey: 'tile256Fg' },
    { label: '512', bgKey: 'tile512Bg', fgKey: 'tile512Fg' },
    { label: '1024', bgKey: 'tile1024Bg', fgKey: 'tile1024Fg' },
    { label: '2048', bgKey: 'tile2048Bg', fgKey: 'tile2048Fg' },
    { label: '>2048', bgKey: 'tileFallbackBg', fgKey: 'tileFallbackFg' },
  ];

  return (
    <div className='space-y-4 rounded-xl border border-soft bg-raised p-4'>
      <div>
        <p className='text-sm font-semibold'>2048 — Tiles Editor</p>
        <p className='text-xs text-faint'>
          Customize per-tile colors for all tiers (2 through 2048+) plus
          merge/spawn/glow effect configuration.
        </p>
        <p className='mt-1 text-[11px] text-faint'>
          Editing: <span className='font-mono'>{itemDraft.name || '(untitled)'}</span>
        </p>
      </div>

      <div className='grid gap-4 xl:grid-cols-[1fr_1.3fr]'>
        <aside className='space-y-3'>
          <section className='space-y-3 rounded-lg border border-soft bg-slate-950/45 p-3'>
            <p className='text-[11px] uppercase tracking-wide text-faint'>
              Live Preview
            </p>
            <TilesPreview draft={game2048TilesDraft} />
          </section>
        </aside>

        <div className='space-y-3'>
          <section className='arcade-card-inset space-y-3 p-3'>
            <p className='text-xs font-semibold uppercase tracking-wide text-faint'>
              Tile Ramp
            </p>
            <div className='grid grid-cols-1 gap-2 lg:grid-cols-2'>
              {tiers.map((tier) => (
                <TilePairInput
                  key={tier.label}
                  tier={tier.label}
                  bgValue={game2048TilesDraft[tier.bgKey] as string}
                  fgValue={game2048TilesDraft[tier.fgKey] as string}
                  onBgChange={setField(tier.bgKey) as (v: string) => void}
                  onFgChange={setField(tier.fgKey) as (v: string) => void}
                />
              ))}
            </div>
          </section>

          <section className='arcade-card-inset space-y-3 p-3'>
            <p className='text-xs font-semibold uppercase tracking-wide text-faint'>
              Motion
            </p>
            <div className='grid grid-cols-1 gap-3 sm:grid-cols-3'>
              <Toggle
                label='Merge pulse'
                value={game2048TilesDraft.mergePulseEnabled}
                onChange={setField('mergePulseEnabled') as (v: boolean) => void}
                hint='Scale-pop animation on merged tiles.'
              />
              <Toggle
                label='Spawn animation'
                value={game2048TilesDraft.spawnAnimEnabled}
                onChange={setField('spawnAnimEnabled') as (v: boolean) => void}
                hint='Fade + scale-in on new tiles.'
              />
              <NumberSlider
                label='Slide duration (ms)'
                min={60}
                max={260}
                step={10}
                value={game2048TilesDraft.slideDurationMs}
                onChange={setField('slideDurationMs') as (v: number) => void}
                hint='How fast tiles slide into position.'
              />
            </div>
          </section>

          <section className='arcade-card-inset space-y-3 p-3'>
            <p className='text-xs font-semibold uppercase tracking-wide text-faint'>
              Glow (high-value tiles)
            </p>
            <div className='grid grid-cols-1 gap-3 sm:grid-cols-2'>
              <label className='text-xs space-y-1'>
                <span>Threshold (tiles ≥ this value glow)</span>
                <select
                  className='h-8 w-full rounded border border-soft bg-background px-2 text-[11px]'
                  value={game2048TilesDraft.glowThreshold}
                  onChange={(e) =>
                    (setField('glowThreshold') as (v: number) => void)(
                      Number(e.target.value),
                    )
                  }
                >
                  <option value={64}>64</option>
                  <option value={128}>128</option>
                  <option value={256}>256</option>
                  <option value={512}>512</option>
                  <option value={1024}>1024</option>
                </select>
              </label>
              <ColorInput
                label='Glow color'
                value={game2048TilesDraft.glowColor}
                onChange={setField('glowColor') as (v: string) => void}
              />
              <NumberSlider
                label='Glow size (px)'
                min={0}
                max={40}
                step={1}
                value={game2048TilesDraft.glowSize}
                onChange={setField('glowSize') as (v: number) => void}
                hint='0 disables the glow entirely.'
              />
              <Toggle
                label='Pulse glow'
                value={game2048TilesDraft.glowPulse}
                onChange={setField('glowPulse') as (v: boolean) => void}
                hint='Animate the glow opacity.'
              />
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

// ─── Grid Editor ───────────────────────────────────────────────────────────

function GridPreview({ draft }: { draft: Game2048GridDraft }) {
  return (
    <div className='flex items-center justify-center rounded-lg bg-slate-950/45 p-4'>
      <div
        className='rounded-lg p-2'
        style={{ background: draft.gridBg, border: `2px solid ${draft.gridBorder}` }}
      >
        <div
          className='grid gap-2'
          style={{
            gridTemplateColumns: 'repeat(4, 36px)',
            gridTemplateRows: 'repeat(4, 36px)',
          }}
        >
          {Array.from({ length: 16 }).map((_, i) => (
            <div
              key={i}
              className='rounded-md'
              style={{ background: draft.cellBg }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

export function Game2048GridEditor({
  itemDraft,
  game2048GridDraft,
  setGame2048GridDraft,
}: {
  itemDraft: ItemDraft;
  game2048GridDraft: Game2048GridDraft;
  setGame2048GridDraft: React.Dispatch<React.SetStateAction<Game2048GridDraft>>;
}) {
  const setField = <K extends keyof Game2048GridDraft>(key: K) =>
    (v: Game2048GridDraft[K]) =>
      setGame2048GridDraft((prev) => ({ ...prev, [key]: v }));

  return (
    <div className='space-y-4 rounded-xl border border-soft bg-raised p-4'>
      <div>
        <p className='text-sm font-semibold'>2048 — Grid Editor</p>
        <p className='text-xs text-faint'>
          Outer grid container, border, and empty-cell fill.
        </p>
        <p className='mt-1 text-[11px] text-faint'>
          Editing: <span className='font-mono'>{itemDraft.name || '(untitled)'}</span>
        </p>
      </div>

      <div className='grid gap-4 xl:grid-cols-[1fr_1.3fr]'>
        <aside className='space-y-3'>
          <section className='space-y-3 rounded-lg border border-soft bg-slate-950/45 p-3'>
            <p className='text-[11px] uppercase tracking-wide text-faint'>
              Live Preview
            </p>
            <GridPreview draft={game2048GridDraft} />
          </section>
        </aside>

        <div className='space-y-3'>
          <section className='arcade-card-inset space-y-3 p-3'>
            <p className='text-xs font-semibold uppercase tracking-wide text-faint'>
              Colors
            </p>
            <div className='grid grid-cols-1 gap-3 sm:grid-cols-3'>
              <ColorInput
                label='Grid bg'
                value={game2048GridDraft.gridBg}
                onChange={setField('gridBg') as (v: string) => void}
                hint='Background behind the tiles.'
              />
              <ColorInput
                label='Grid border'
                value={game2048GridDraft.gridBorder}
                onChange={setField('gridBorder') as (v: string) => void}
              />
              <ColorInput
                label='Empty cell'
                value={game2048GridDraft.cellBg}
                onChange={setField('cellBg') as (v: string) => void}
                hint='Fill of cells with no tile.'
              />
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

// ─── Background Editor ─────────────────────────────────────────────────────

function buildPreviewBackground(draft: Game2048BackgroundDraft): string {
  if (!draft.containerGradientEnabled) return draft.containerBg;
  const a = draft.containerGradientStart;
  const b = draft.containerGradientEnd;
  switch (draft.containerGradientDirection) {
    case 'horizontal':
      return `linear-gradient(90deg, ${a}, ${b})`;
    case 'vertical':
      return `linear-gradient(180deg, ${a}, ${b})`;
    case 'radial':
      return `radial-gradient(circle at 30% 30%, ${a}, ${b})`;
    default:
      return `linear-gradient(135deg, ${a}, ${b})`;
  }
}

function BackgroundPreview({ draft }: { draft: Game2048BackgroundDraft }) {
  return (
    <div
      className='flex h-32 items-center justify-center rounded-lg'
      style={{ background: buildPreviewBackground(draft) }}
    >
      <div
        className='flex h-20 w-32 items-center justify-center rounded-md border'
        style={{ borderColor: draft.containerBorder, background: 'rgba(255,255,255,0.06)' }}
      >
        <span className='text-[11px] text-white/80'>Panel</span>
      </div>
    </div>
  );
}

export function Game2048BackgroundEditor({
  itemDraft,
  game2048BackgroundDraft,
  setGame2048BackgroundDraft,
}: {
  itemDraft: ItemDraft;
  game2048BackgroundDraft: Game2048BackgroundDraft;
  setGame2048BackgroundDraft: React.Dispatch<
    React.SetStateAction<Game2048BackgroundDraft>
  >;
}) {
  const setField = <K extends keyof Game2048BackgroundDraft>(key: K) =>
    (v: Game2048BackgroundDraft[K]) =>
      setGame2048BackgroundDraft((prev) => ({ ...prev, [key]: v }));

  return (
    <div className='space-y-4 rounded-xl border border-soft bg-raised p-4'>
      <div>
        <p className='text-sm font-semibold'>2048 — Background Editor</p>
        <p className='text-xs text-faint'>
          Panel background behind the board. Solid color or 2-stop gradient.
        </p>
        <p className='mt-1 text-[11px] text-faint'>
          Editing: <span className='font-mono'>{itemDraft.name || '(untitled)'}</span>
        </p>
      </div>

      <div className='grid gap-4 xl:grid-cols-[1fr_1.3fr]'>
        <aside className='space-y-3'>
          <section className='space-y-3 rounded-lg border border-soft bg-slate-950/45 p-3'>
            <p className='text-[11px] uppercase tracking-wide text-faint'>
              Live Preview
            </p>
            <BackgroundPreview draft={game2048BackgroundDraft} />
          </section>
        </aside>

        <div className='space-y-3'>
          <section className='arcade-card-inset space-y-3 p-3'>
            <p className='text-xs font-semibold uppercase tracking-wide text-faint'>
              Solid
            </p>
            <div className='grid grid-cols-1 gap-3 sm:grid-cols-2'>
              <ColorInput
                label='Background'
                value={game2048BackgroundDraft.containerBg}
                onChange={setField('containerBg') as (v: string) => void}
              />
              <ColorInput
                label='Border'
                value={game2048BackgroundDraft.containerBorder}
                onChange={setField('containerBorder') as (v: string) => void}
              />
            </div>
          </section>

          <section className='arcade-card-inset space-y-3 p-3'>
            <p className='text-xs font-semibold uppercase tracking-wide text-faint'>
              Gradient
            </p>
            <Toggle
              label='Enable gradient (overrides solid background)'
              value={game2048BackgroundDraft.containerGradientEnabled}
              onChange={
                setField('containerGradientEnabled') as (v: boolean) => void
              }
            />
            <div className='grid grid-cols-1 gap-3 sm:grid-cols-3'>
              <ColorInput
                label='Start'
                value={game2048BackgroundDraft.containerGradientStart}
                onChange={setField('containerGradientStart') as (v: string) => void}
              />
              <ColorInput
                label='End'
                value={game2048BackgroundDraft.containerGradientEnd}
                onChange={setField('containerGradientEnd') as (v: string) => void}
              />
              <label className='text-xs space-y-1'>
                <span>Direction</span>
                <select
                  className='h-8 w-full rounded border border-soft bg-background px-2 text-[11px]'
                  value={game2048BackgroundDraft.containerGradientDirection}
                  onChange={(e) =>
                    (setField('containerGradientDirection') as (
                      v: Game2048BackgroundDraft['containerGradientDirection'],
                    ) => void)(
                      e.target
                        .value as Game2048BackgroundDraft['containerGradientDirection'],
                    )
                  }
                >
                  <option value='horizontal'>Horizontal</option>
                  <option value='vertical'>Vertical</option>
                  <option value='diagonal'>Diagonal</option>
                  <option value='radial'>Radial</option>
                </select>
              </label>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
