'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { InfoHint } from './_components';
import type { ItemDraft, FlappyBirdDraft } from './_types';

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

const PRESETS: { id: string; label: string; draft: FlappyBirdDraft }[] = [
  { id: 'classic', label: 'Classic Yellow', draft: { birdPrimary: '#fbbf24', birdSecondary: '#f59e0b' } },
  { id: 'bluebird', label: 'Blue Jay', draft: { birdPrimary: '#3b82f6', birdSecondary: '#1d4ed8' } },
  { id: 'phoenix', label: 'Phoenix', draft: { birdPrimary: '#ef4444', birdSecondary: '#f97316' } },
  { id: 'emerald', label: 'Emerald', draft: { birdPrimary: '#10b981', birdSecondary: '#059669' } },
  { id: 'neon-pink', label: 'Neon Pink', draft: { birdPrimary: '#ec4899', birdSecondary: '#db2777' } },
  { id: 'arctic', label: 'Arctic', draft: { birdPrimary: '#e0f2fe', birdSecondary: '#7dd3fc' } },
];

function BirdCanvasPreview({ primary, secondary }: { primary: string; secondary: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const w = canvas.width;
    const h = canvas.height;

    ctx.clearRect(0, 0, w, h);

    // Sky background
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, '#0ea5e9');
    grad.addColorStop(1, '#bae6fd');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    const cx = w / 2;
    const cy = h / 2;

    // Bird body — exact game proportions: rx=15, ry=12 (BIRD_SIZE=30)
    ctx.fillStyle = primary;
    ctx.beginPath();
    ctx.ellipse(cx, cy, 15, 12, 0, 0, Math.PI * 2);
    ctx.fill();

    // Wing
    ctx.fillStyle = secondary;
    ctx.beginPath();
    ctx.ellipse(cx - 5, cy + 2, 10, 6, -0.3, 0, Math.PI * 2);
    ctx.fill();

    // Eye
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(cx + 8, cy - 5, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.arc(cx + 10, cy - 5, 3, 0, Math.PI * 2);
    ctx.fill();

    // Beak
    ctx.fillStyle = '#ef4444';
    ctx.beginPath();
    ctx.moveTo(cx + 15, cy);
    ctx.lineTo(cx + 25, cy + 3);
    ctx.lineTo(cx + 15, cy + 6);
    ctx.closePath();
    ctx.fill();
  }, [primary, secondary]);

  return (
    <canvas
      ref={canvasRef}
      width={180}
      height={140}
      className='w-full rounded-lg'
      style={{ imageRendering: 'auto' }}
    />
  );
}

export function FlappyBirdEditor({
  itemDraft,
  flappyBirdDraft,
  setFlappyBirdDraft,
}: {
  itemDraft: ItemDraft;
  flappyBirdDraft: FlappyBirdDraft;
  setFlappyBirdDraft: React.Dispatch<React.SetStateAction<FlappyBirdDraft>>;
}) {
  const checklist = useMemo(
    () => [
      { label: 'Item name set', ok: itemDraft.name.trim().length > 0 },
      { label: 'Slot assigned', ok: itemDraft.slots.length > 0 },
    ],
    [itemDraft.name, itemDraft.slots.length],
  );

  return (
    <div className='space-y-4 rounded-xl border border-soft bg-raised p-4'>
      <div>
        <p className='text-sm font-semibold'>Flappy Bird - Bird Editor</p>
        <p className='text-xs text-faint'>
          Customize the bird&apos;s body and wing colors.
        </p>
      </div>

      <div className='grid gap-4 xl:grid-cols-[1fr_1.3fr]'>
        <aside className='space-y-3'>
          <section className='rounded-lg border border-soft bg-slate-950/45 p-3 space-y-3'>
            <p className='text-[11px] uppercase tracking-wide text-faint'>Live Preview</p>
            <BirdCanvasPreview primary={flappyBirdDraft.birdPrimary} secondary={flappyBirdDraft.birdSecondary} />
          </section>

          <section className='rounded-lg border border-soft bg-well p-3 space-y-2'>
            <p className='text-[11px] uppercase tracking-wide text-faint'>Quick Presets</p>
            <div className='grid grid-cols-2 gap-2'>
              {PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type='button'
                  className='rounded-tag border border-soft bg-raised px-2 py-1.5 text-xs text-body shadow-chip transition-[filter] duration-[140ms] hover:brightness-110'
                  onClick={() => setFlappyBirdDraft({ ...preset.draft })}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </section>
        </aside>

        <div className='space-y-3'>
          <section className='arcade-card-inset p-3 space-y-3'>
            <p className='text-xs font-semibold uppercase tracking-wide text-faint'>Colors</p>
            <div className='grid grid-cols-1 gap-3 sm:grid-cols-2'>
              <ColorInput
                label='Body (Primary)'
                value={flappyBirdDraft.birdPrimary}
                onChange={(v) => setFlappyBirdDraft((p) => ({ ...p, birdPrimary: v }))}
                hint='Main body color of the bird.'
              />
              <ColorInput
                label='Wing (Secondary)'
                value={flappyBirdDraft.birdSecondary}
                onChange={(v) => setFlappyBirdDraft((p) => ({ ...p, birdSecondary: v }))}
                hint='Wing accent color.'
              />
            </div>
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
