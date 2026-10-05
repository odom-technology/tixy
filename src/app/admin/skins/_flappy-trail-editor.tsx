'use client';

import { useEffect, useMemo, useState } from 'react';
import { InfoHint } from './_components';
import type { ItemDraft, FlappyTrailDraft } from './_types';

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
  useEffect(() => setTextValue(value), [value]);
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
          value={textValue}
          onChange={(e) => setTextValue(e.target.value)}
          onBlur={() => onChange(textValue)}
        />
      </div>
    </label>
  );
}

const PRESETS: { id: string; label: string; draft: FlappyTrailDraft }[] = [
  { id: 'flame', label: 'Flame', draft: { trailColors: ['#f97316'] } },
  { id: 'ice', label: 'Ice Trail', draft: { trailColors: ['#38bdf8'] } },
  { id: 'rainbow', label: 'Rainbow', draft: { trailColors: ['#ef4444', '#f97316', '#eab308', '#22c55e', '#3b82f6', '#8b5cf6'] } },
  { id: 'neon-green', label: 'Neon Green', draft: { trailColors: ['#22c55e'] } },
  { id: 'sunset', label: 'Sunset Fade', draft: { trailColors: ['#ef4444', '#f97316', '#fbbf24'] } },
  { id: 'ocean', label: 'Ocean', draft: { trailColors: ['#06b6d4', '#3b82f6', '#6366f1'] } },
];

function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const e = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const v = Number.parseInt(e, 16);
  return `rgba(${(v >> 16) & 255}, ${(v >> 8) & 255}, ${v & 255}, ${alpha})`;
}

const TRAIL_PARTICLES = [
  { x: 16, y: 42, r: 3, a: 0.08 },
  { x: 28, y: 56, r: 3.5, a: 0.1 },
  { x: 22, y: 68, r: 2.5, a: 0.07 },
  { x: 38, y: 48, r: 4, a: 0.14 },
  { x: 42, y: 64, r: 3, a: 0.12 },
  { x: 52, y: 52, r: 4.5, a: 0.18 },
  { x: 56, y: 62, r: 3.5, a: 0.15 },
  { x: 64, y: 55, r: 5, a: 0.22 },
  { x: 68, y: 48, r: 4, a: 0.2 },
  { x: 76, y: 58, r: 5.5, a: 0.28 },
  { x: 82, y: 52, r: 5, a: 0.3 },
  { x: 88, y: 56, r: 6, a: 0.35 },
];

export function FlappyTrailEditor({
  itemDraft,
  flappyTrailDraft,
  setFlappyTrailDraft,
}: {
  itemDraft: ItemDraft;
  flappyTrailDraft: FlappyTrailDraft;
  setFlappyTrailDraft: React.Dispatch<React.SetStateAction<FlappyTrailDraft>>;
}) {
  const colors = flappyTrailDraft.trailColors;

  const checklist = useMemo(
    () => [
      { label: 'Item name set', ok: itemDraft.name.trim().length > 0 },
      { label: 'Slot assigned', ok: itemDraft.slots.length > 0 },
      { label: 'At least one color', ok: colors.length > 0 },
    ],
    [itemDraft.name, itemDraft.slots.length, colors.length],
  );

  const updateColor = (index: number, value: string) => {
    setFlappyTrailDraft((prev) => {
      const next = [...prev.trailColors];
      next[index] = value;
      return { trailColors: next };
    });
  };

  const addColor = () => {
    setFlappyTrailDraft((prev) => ({
      trailColors: [...prev.trailColors, '#ffffff'],
    }));
  };

  const removeColor = (index: number) => {
    setFlappyTrailDraft((prev) => ({
      trailColors: prev.trailColors.filter((_, i) => i !== index),
    }));
  };

  return (
    <div className='space-y-4 rounded-xl border border-soft bg-raised p-4'>
      <div>
        <p className='text-sm font-semibold'>Flappy Bird - Trail Editor</p>
        <p className='text-xs text-faint'>
          Set the particle trail colors. Multi-color trails cycle randomly between colors for each particle.
        </p>
      </div>

      <div className='grid gap-4 xl:grid-cols-[1fr_1.3fr]'>
        <aside className='space-y-3'>
          <section className='rounded-lg border border-soft bg-slate-950/45 p-3 space-y-3'>
            <p className='text-[11px] uppercase tracking-wide text-faint'>Trail Preview</p>
            <div className='relative flex items-center justify-center overflow-hidden rounded-lg' style={{ background: 'linear-gradient(180deg, #0ea5e9, #bae6fd)', height: 120 }}>
              {TRAIL_PARTICLES.map((p, i) => {
                const c = colors.length > 0 ? colors[i % colors.length] : '#f97316';
                return (
                  <div
                    key={i}
                    className='absolute rounded-full'
                    style={{
                      left: `${p.x}px`,
                      top: `${p.y}px`,
                      width: `${p.r * 2}px`,
                      height: `${p.r * 2}px`,
                      backgroundColor: hexToRgba(c, p.a),
                      boxShadow: p.a > 0.15 ? `0 0 ${p.r + 3}px ${hexToRgba(c, p.a * 0.4)}` : undefined,
                    }}
                  />
                );
              })}
              <div
                className='absolute flex h-10 w-10 items-center justify-center rounded-full text-lg'
                style={{ backgroundColor: '#fbbf24', right: 30, top: '50%', transform: 'translateY(-50%)' }}
              >
                <span className='text-xs'>bird</span>
              </div>
            </div>
          </section>

          <section className='rounded-lg border border-soft bg-well p-3 space-y-2'>
            <p className='text-[11px] uppercase tracking-wide text-faint'>Quick Presets</p>
            <div className='grid grid-cols-2 gap-2'>
              {PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type='button'
                  className='rounded-tag border border-soft bg-raised px-2 py-1.5 text-xs text-body shadow-chip transition-[filter] duration-[140ms] hover:brightness-110'
                  onClick={() => setFlappyTrailDraft({ ...preset.draft })}
                >
                  {preset.label}
                  {preset.draft.trailColors.length > 1 ? (
                    <span className='ml-1 inline-flex gap-0.5'>
                      {preset.draft.trailColors.map((c, i) => (
                        <span key={i} className='inline-block h-2 w-2 rounded-full' style={{ backgroundColor: c }} />
                      ))}
                    </span>
                  ) : null}
                </button>
              ))}
            </div>
          </section>
        </aside>

        <div className='space-y-3'>
          <section className='arcade-card-inset p-3 space-y-3'>
            <div className='flex items-center justify-between'>
              <p className='text-xs font-semibold uppercase tracking-wide text-faint'>
                Trail Colors ({colors.length})
              </p>
              <button
                type='button'
                className='rounded-tag border border-soft bg-raised px-2 py-1 text-[11px] text-body shadow-chip transition-[filter] duration-[140ms] hover:brightness-110'
                onClick={addColor}
              >
                + Add Color
              </button>
            </div>
            <div className='grid grid-cols-1 gap-3'>
              {colors.map((color, i) => (
                <div key={i} className='flex items-end gap-2'>
                  <div className='flex-1'>
                    <ColorInput
                      label={colors.length === 1 ? 'Trail Color' : `Color ${i + 1}`}
                      value={color}
                      onChange={(v) => updateColor(i, v)}
                    />
                  </div>
                  {colors.length > 1 ? (
                    <button
                      type='button'
                      className='mb-0.5 h-8 rounded-tag border border-soft bg-raised px-2 text-[11px] text-danger-text shadow-chip transition-[filter] duration-[140ms] hover:brightness-110'
                      onClick={() => removeColor(i)}
                    >
                      Remove
                    </button>
                  ) : null}
                </div>
              ))}
            </div>
            <p className='text-[10px] text-faint'>
              {colors.length > 1
                ? 'Each particle randomly picks a color from the list, creating a multi-colored trail effect.'
                : 'Add more colors for a multi-colored particle trail. Equipping any trail item automatically enables the trail effect.'}
            </p>
          </section>

          <section className='arcade-card-inset p-3 space-y-2'>
            <p className='text-xs font-semibold uppercase tracking-wide text-faint'>Validation</p>
            <div className='grid gap-1 text-xs'>
              {checklist.map((item) => (
                <div key={item.label} className={item.ok ? 'text-prize-text' : 'text-danger-text'}>
                  {item.ok ? 'OK' : 'Missing'} - {item.label}
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
