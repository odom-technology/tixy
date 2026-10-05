'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { InfoHint } from './_components';
import type { ItemDraft, EightBallTableDraft } from './_types';

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

const PRESETS: { id: string; label: string; draft: EightBallTableDraft }[] = [
  { id: 'classic', label: 'Classic Green', draft: { feltColor: '#0d6b3d', feltDark: '#0a5730', railColor: '#5c3a1e', railBorder: '#3d2512', pocketColor: '#111111' } },
  { id: 'midnight', label: 'Midnight', draft: { feltColor: '#1e293b', feltDark: '#0f172a', railColor: '#334155', railBorder: '#1e293b', pocketColor: '#020617' } },
  { id: 'royal', label: 'Royal Purple', draft: { feltColor: '#4c1d95', feltDark: '#3b0764', railColor: '#6d28d9', railBorder: '#4c1d95', pocketColor: '#1e1b4b' } },
  { id: 'ocean', label: 'Ocean', draft: { feltColor: '#164e63', feltDark: '#0e3a4a', railColor: '#155e75', railBorder: '#0c4a5e', pocketColor: '#042f2e' } },
  { id: 'synthwave', label: 'Synthwave', draft: { feltColor: '#1a0533', feltDark: '#0d0019', railColor: '#7c3aed', railBorder: '#4c1d95', pocketColor: '#0a0015' } },
  { id: 'crimson', label: 'Crimson', draft: { feltColor: '#7f1d1d', feltDark: '#5c1515', railColor: '#991b1b', railBorder: '#7f1d1d', pocketColor: '#1c0505' } },
];

function TableCanvasPreview({ draft }: { draft: EightBallTableDraft }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const w = canvas.width;
    const h = canvas.height;

    ctx.clearRect(0, 0, w, h);

    // Background
    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(0, 0, w, h);

    const pad = 8;
    const railW = 14;
    const tableW = w - pad * 2;
    const tableH = h - pad * 2;
    const tx = pad;
    const ty = pad;

    // Rail border (outer)
    ctx.fillStyle = draft.railBorder;
    ctx.beginPath();
    ctx.roundRect(tx, ty, tableW, tableH, 6);
    ctx.fill();

    // Rail
    ctx.fillStyle = draft.railColor;
    ctx.beginPath();
    ctx.roundRect(tx + 2, ty + 2, tableW - 4, tableH - 4, 5);
    ctx.fill();

    // Felt (playing surface)
    const feltX = tx + railW;
    const feltY = ty + railW;
    const feltW = tableW - railW * 2;
    const feltH = tableH - railW * 2;

    const feltGrad = ctx.createRadialGradient(
      feltX + feltW / 2, feltY + feltH / 2, 0,
      feltX + feltW / 2, feltY + feltH / 2, Math.max(feltW, feltH) * 0.7,
    );
    feltGrad.addColorStop(0, draft.feltColor);
    feltGrad.addColorStop(1, draft.feltDark);
    ctx.fillStyle = feltGrad;
    ctx.fillRect(feltX, feltY, feltW, feltH);

    // Pockets
    const pocketR = 7;
    const pockets = [
      [feltX + 2, feltY + 2],
      [feltX + feltW / 2, feltY - 1],
      [feltX + feltW - 2, feltY + 2],
      [feltX + 2, feltY + feltH - 2],
      [feltX + feltW / 2, feltY + feltH + 1],
      [feltX + feltW - 2, feltY + feltH - 2],
    ];
    ctx.fillStyle = draft.pocketColor;
    for (const [px, py] of pockets) {
      ctx.beginPath();
      ctx.arc(px, py, pocketR, 0, Math.PI * 2);
      ctx.fill();
    }

    // Diamond markers on rails
    ctx.fillStyle = draft.feltColor + '40';
    const diamondSize = 2;
    for (let i = 1; i <= 3; i++) {
      const dx = feltX + (feltW * i) / 4;
      // Top rail
      ctx.beginPath();
      ctx.arc(dx, ty + railW / 2, diamondSize, 0, Math.PI * 2);
      ctx.fill();
      // Bottom rail
      ctx.beginPath();
      ctx.arc(dx, ty + tableH - railW / 2, diamondSize, 0, Math.PI * 2);
      ctx.fill();
    }
    for (let i = 1; i <= 2; i++) {
      const dy = feltY + (feltH * i) / 3;
      // Left rail
      ctx.beginPath();
      ctx.arc(tx + railW / 2, dy, diamondSize, 0, Math.PI * 2);
      ctx.fill();
      // Right rail
      ctx.beginPath();
      ctx.arc(tx + tableW - railW / 2, dy, diamondSize, 0, Math.PI * 2);
      ctx.fill();
    }
  }, [draft]);

  return (
    <canvas
      ref={canvasRef}
      width={280}
      height={160}
      className='w-full rounded-lg'
      style={{ imageRendering: 'auto' }}
    />
  );
}

export function EightBallTableEditor({
  itemDraft,
  eightBallTableDraft,
  setEightBallTableDraft,
}: {
  itemDraft: ItemDraft;
  eightBallTableDraft: EightBallTableDraft;
  setEightBallTableDraft: React.Dispatch<React.SetStateAction<EightBallTableDraft>>;
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
        <p className='text-sm font-semibold'>8-Ball - Table Editor</p>
        <p className='text-xs text-faint'>
          Customize the felt, rails, and pocket colors.
        </p>
      </div>

      <div className='grid gap-4 xl:grid-cols-[1fr_1.3fr]'>
        <aside className='space-y-3'>
          <section className='rounded-lg border border-soft bg-slate-950/45 p-3 space-y-3'>
            <p className='text-[11px] uppercase tracking-wide text-faint'>Live Preview</p>
            <TableCanvasPreview draft={eightBallTableDraft} />
          </section>

          <section className='rounded-lg border border-soft bg-well p-3 space-y-2'>
            <p className='text-[11px] uppercase tracking-wide text-faint'>Quick Presets</p>
            <div className='grid grid-cols-2 gap-2'>
              {PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type='button'
                  className='rounded-tag border border-soft bg-raised px-2 py-1.5 text-xs text-body shadow-chip transition-[filter] duration-[140ms] hover:brightness-110'
                  onClick={() => setEightBallTableDraft({ ...preset.draft })}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </section>
        </aside>

        <div className='space-y-3'>
          <section className='arcade-card-inset p-3 space-y-3'>
            <p className='text-xs font-semibold uppercase tracking-wide text-faint'>Felt</p>
            <div className='grid grid-cols-1 gap-3 sm:grid-cols-2'>
              <ColorInput
                label='Felt Color'
                value={eightBallTableDraft.feltColor}
                onChange={(v) => setEightBallTableDraft((p) => ({ ...p, feltColor: v }))}
                hint='Main playing surface color.'
              />
              <ColorInput
                label='Felt Dark'
                value={eightBallTableDraft.feltDark}
                onChange={(v) => setEightBallTableDraft((p) => ({ ...p, feltDark: v }))}
                hint='Edge/shadow gradient color.'
              />
            </div>
          </section>

          <section className='arcade-card-inset p-3 space-y-3'>
            <p className='text-xs font-semibold uppercase tracking-wide text-faint'>Rails & Pockets</p>
            <div className='grid grid-cols-1 gap-3 sm:grid-cols-2'>
              <ColorInput
                label='Rail Color'
                value={eightBallTableDraft.railColor}
                onChange={(v) => setEightBallTableDraft((p) => ({ ...p, railColor: v }))}
                hint='Main rail/cushion color.'
              />
              <ColorInput
                label='Rail Border'
                value={eightBallTableDraft.railBorder}
                onChange={(v) => setEightBallTableDraft((p) => ({ ...p, railBorder: v }))}
                hint='Outer rail border color.'
              />
              <ColorInput
                label='Pocket Color'
                value={eightBallTableDraft.pocketColor}
                onChange={(v) => setEightBallTableDraft((p) => ({ ...p, pocketColor: v }))}
                hint='Color of the pocket openings.'
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
