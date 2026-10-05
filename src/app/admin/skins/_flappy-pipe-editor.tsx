'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { InfoHint } from './_components';
import type { ItemDraft, FlappyPipeDraft } from './_types';

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

const PRESETS: { id: string; label: string; draft: FlappyPipeDraft }[] = [
  { id: 'classic', label: 'Classic Green', draft: { pipePrimary: '#16a34a', pipeSecondary: '#22c55e' } },
  { id: 'steel', label: 'Steel', draft: { pipePrimary: '#475569', pipeSecondary: '#94a3b8' } },
  { id: 'lava', label: 'Lava', draft: { pipePrimary: '#dc2626', pipeSecondary: '#f97316' } },
  { id: 'ice', label: 'Ice', draft: { pipePrimary: '#0284c7', pipeSecondary: '#7dd3fc' } },
  { id: 'gold', label: 'Gold', draft: { pipePrimary: '#a16207', pipeSecondary: '#fbbf24' } },
  { id: 'void', label: 'Void', draft: { pipePrimary: '#1e1b4b', pipeSecondary: '#6366f1' } },
];

function PipeCanvasPreview({ primary, secondary }: { primary: string; secondary: string }) {
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
    const skyGrad = ctx.createLinearGradient(0, 0, 0, h);
    skyGrad.addColorStop(0, '#0ea5e9');
    skyGrad.addColorStop(1, '#bae6fd');
    ctx.fillStyle = skyGrad;
    ctx.fillRect(0, 0, w, h);

    const pipeW = 50;
    const capH = 18;
    const gap = 70;
    const pipeX = (w - pipeW) / 2;
    const topH = 30;
    const bottomY = topH + gap;

    // Top pipe body
    const topGrad = ctx.createLinearGradient(pipeX, 0, pipeX + pipeW, 0);
    topGrad.addColorStop(0, primary);
    topGrad.addColorStop(1, secondary);
    ctx.fillStyle = topGrad;
    ctx.fillRect(pipeX, 0, pipeW, topH);

    // Top pipe cap
    ctx.fillStyle = secondary;
    ctx.fillRect(pipeX - 4, topH - capH, pipeW + 8, capH);

    // Bottom pipe body
    const botGrad = ctx.createLinearGradient(pipeX, bottomY, pipeX + pipeW, bottomY);
    botGrad.addColorStop(0, primary);
    botGrad.addColorStop(1, secondary);
    ctx.fillStyle = botGrad;
    ctx.fillRect(pipeX, bottomY, pipeW, h - bottomY);

    // Bottom pipe cap
    ctx.fillStyle = secondary;
    ctx.fillRect(pipeX - 4, bottomY, pipeW + 8, capH);
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

export function FlappyPipeEditor({
  itemDraft,
  flappyPipeDraft,
  setFlappyPipeDraft,
}: {
  itemDraft: ItemDraft;
  flappyPipeDraft: FlappyPipeDraft;
  setFlappyPipeDraft: React.Dispatch<React.SetStateAction<FlappyPipeDraft>>;
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
        <p className='text-sm font-semibold'>Flappy Bird - Pipe Editor</p>
        <p className='text-xs text-faint'>
          Customize pipe body and cap colors with gradient fill.
        </p>
      </div>

      <div className='grid gap-4 xl:grid-cols-[1fr_1.3fr]'>
        <aside className='space-y-3'>
          <section className='rounded-lg border border-soft bg-slate-950/45 p-3 space-y-3'>
            <p className='text-[11px] uppercase tracking-wide text-faint'>Live Preview</p>
            <PipeCanvasPreview primary={flappyPipeDraft.pipePrimary} secondary={flappyPipeDraft.pipeSecondary} />
          </section>

          <section className='rounded-lg border border-soft bg-well p-3 space-y-2'>
            <p className='text-[11px] uppercase tracking-wide text-faint'>Quick Presets</p>
            <div className='grid grid-cols-2 gap-2'>
              {PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type='button'
                  className='rounded-tag border border-soft bg-raised px-2 py-1.5 text-xs text-body shadow-chip transition-[filter] duration-[140ms] hover:brightness-110'
                  onClick={() => setFlappyPipeDraft({ ...preset.draft })}
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
                label='Primary'
                value={flappyPipeDraft.pipePrimary}
                onChange={(v) => setFlappyPipeDraft((p) => ({ ...p, pipePrimary: v }))}
                hint='Main pipe body color (left side of gradient).'
              />
              <ColorInput
                label='Secondary'
                value={flappyPipeDraft.pipeSecondary}
                onChange={(v) => setFlappyPipeDraft((p) => ({ ...p, pipeSecondary: v }))}
                hint='Pipe caps and gradient highlight.'
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
