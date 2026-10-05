'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { InfoHint } from './_components';
import type { ItemDraft, EightBallCueDraft } from './_types';

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

const PRESETS: { id: string; label: string; draft: EightBallCueDraft }[] = [
  { id: 'classic', label: 'Classic Wood', draft: { cueColor: '#d4a574', cueTipColor: '#1a1a2e', cueGlow: false, cueGlowColor: '#22d3ee' } },
  { id: 'neon', label: 'Neon Cyan', draft: { cueColor: '#06b6d4', cueTipColor: '#0891b2', cueGlow: true, cueGlowColor: '#22d3ee' } },
  { id: 'golden', label: 'Golden', draft: { cueColor: '#d4a017', cueTipColor: '#92700c', cueGlow: true, cueGlowColor: '#fbbf24' } },
  { id: 'crimson', label: 'Crimson', draft: { cueColor: '#dc2626', cueTipColor: '#7f1d1d', cueGlow: true, cueGlowColor: '#f87171' } },
  { id: 'obsidian', label: 'Obsidian', draft: { cueColor: '#1e1e2e', cueTipColor: '#0f0f1a', cueGlow: true, cueGlowColor: '#a78bfa' } },
  { id: 'sakura', label: 'Sakura', draft: { cueColor: '#f9a8d4', cueTipColor: '#be185d', cueGlow: true, cueGlowColor: '#fbcfe8' } },
];

function CueCanvasPreview({ draft }: { draft: EightBallCueDraft }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const w = canvas.width;
    const h = canvas.height;

    ctx.clearRect(0, 0, w, h);

    // Dark background
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, w, h);

    const cx = w / 2;
    const cy = h / 2;
    const cueLength = w * 0.75;
    const cueWidth = 8;
    const tipLength = 18;
    const startX = cx - cueLength / 2;
    const endX = cx + cueLength / 2;

    // Glow effect
    if (draft.cueGlow) {
      ctx.save();
      ctx.shadowColor = draft.cueGlowColor;
      ctx.shadowBlur = 16;
      ctx.fillStyle = draft.cueGlowColor + '30';
      ctx.beginPath();
      ctx.roundRect(startX - 4, cy - cueWidth / 2 - 4, cueLength + 8, cueWidth + 8, 6);
      ctx.fill();
      ctx.restore();
    }

    // Cue body
    const bodyGrad = ctx.createLinearGradient(startX, cy - cueWidth / 2, startX, cy + cueWidth / 2);
    bodyGrad.addColorStop(0, draft.cueColor);
    bodyGrad.addColorStop(0.5, lighten(draft.cueColor, 30));
    bodyGrad.addColorStop(1, draft.cueColor);
    ctx.fillStyle = bodyGrad;
    ctx.beginPath();
    ctx.roundRect(startX + tipLength, cy - cueWidth / 2, cueLength - tipLength, cueWidth, 3);
    ctx.fill();

    // Cue tip
    ctx.fillStyle = draft.cueTipColor;
    ctx.beginPath();
    ctx.roundRect(startX, cy - cueWidth / 2 + 1, tipLength + 2, cueWidth - 2, [3, 0, 0, 3]);
    ctx.fill();

    // Ferrule (white ring between tip and body)
    ctx.fillStyle = '#e2e8f0';
    ctx.fillRect(startX + tipLength - 1, cy - cueWidth / 2, 3, cueWidth);

    // Wrap detail
    const wrapX = endX - cueLength * 0.25;
    ctx.fillStyle = '#1e293b';
    ctx.fillRect(wrapX, cy - cueWidth / 2, 20, cueWidth);
    ctx.fillStyle = draft.cueColor;
    for (let i = 0; i < 3; i++) {
      ctx.fillRect(wrapX + 3 + i * 6, cy - cueWidth / 2, 3, cueWidth);
    }

    // Bumper
    ctx.fillStyle = '#0f172a';
    ctx.beginPath();
    ctx.roundRect(endX - 6, cy - cueWidth / 2, 6, cueWidth, [0, 3, 3, 0]);
    ctx.fill();
  }, [draft]);

  return (
    <canvas
      ref={canvasRef}
      width={280}
      height={80}
      className='w-full rounded-lg'
      style={{ imageRendering: 'auto' }}
    />
  );
}

function lighten(hex: string, amount: number): string {
  const n = hex.replace('#', '');
  const r = Math.min(255, parseInt(n.substring(0, 2), 16) + amount);
  const g = Math.min(255, parseInt(n.substring(2, 4), 16) + amount);
  const b = Math.min(255, parseInt(n.substring(4, 6), 16) + amount);
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

export function EightBallCueEditor({
  itemDraft,
  eightBallCueDraft,
  setEightBallCueDraft,
}: {
  itemDraft: ItemDraft;
  eightBallCueDraft: EightBallCueDraft;
  setEightBallCueDraft: React.Dispatch<React.SetStateAction<EightBallCueDraft>>;
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
        <p className='text-sm font-semibold'>8-Ball - Cue Editor</p>
        <p className='text-xs text-faint'>
          Customize the cue stick colors and glow effect.
        </p>
      </div>

      <div className='grid gap-4 xl:grid-cols-[1fr_1.3fr]'>
        <aside className='space-y-3'>
          <section className='rounded-lg border border-soft bg-slate-950/45 p-3 space-y-3'>
            <p className='text-[11px] uppercase tracking-wide text-faint'>Live Preview</p>
            <CueCanvasPreview draft={eightBallCueDraft} />
          </section>

          <section className='rounded-lg border border-soft bg-well p-3 space-y-2'>
            <p className='text-[11px] uppercase tracking-wide text-faint'>Quick Presets</p>
            <div className='grid grid-cols-2 gap-2'>
              {PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type='button'
                  className='rounded-tag border border-soft bg-raised px-2 py-1.5 text-xs text-body shadow-chip transition-[filter] duration-[140ms] hover:brightness-110'
                  onClick={() => setEightBallCueDraft({ ...preset.draft })}
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
                label='Cue Body'
                value={eightBallCueDraft.cueColor}
                onChange={(v) => setEightBallCueDraft((p) => ({ ...p, cueColor: v }))}
                hint='Main wood/body color of the cue stick.'
              />
              <ColorInput
                label='Cue Tip'
                value={eightBallCueDraft.cueTipColor}
                onChange={(v) => setEightBallCueDraft((p) => ({ ...p, cueTipColor: v }))}
                hint='Tip (leather) color.'
              />
            </div>
          </section>

          <section className='arcade-card-inset p-3 space-y-3'>
            <p className='text-xs font-semibold uppercase tracking-wide text-faint'>Glow Effect</p>
            <label className='flex items-center gap-2 text-xs'>
              <input
                type='checkbox'
                checked={eightBallCueDraft.cueGlow}
                onChange={(e) => setEightBallCueDraft((p) => ({ ...p, cueGlow: e.target.checked }))}
                className='h-4 w-4 rounded border-soft'
              />
              Enable glow
            </label>
            {eightBallCueDraft.cueGlow && (
              <ColorInput
                label='Glow Color'
                value={eightBallCueDraft.cueGlowColor}
                onChange={(v) => setEightBallCueDraft((p) => ({ ...p, cueGlowColor: v }))}
                hint='Color of the ambient glow around the cue.'
              />
            )}
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
