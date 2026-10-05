'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { InfoHint } from './_components';
import type { ItemDraft, FlappyBackgroundDraft } from './_types';

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

const PRESETS: { id: string; label: string; draft: FlappyBackgroundDraft }[] = [
  { id: 'classic', label: 'Classic Day', draft: { skyTop: '#0ea5e9', skyBottom: '#bae6fd', ground: '#84cc16' } },
  { id: 'sunset', label: 'Sunset', draft: { skyTop: '#7c2d12', skyBottom: '#fb923c', ground: '#a16207' } },
  { id: 'night', label: 'Night Sky', draft: { skyTop: '#020617', skyBottom: '#1e293b', ground: '#1e3a5f' } },
  { id: 'cherry', label: 'Cherry Blossom', draft: { skyTop: '#fdf2f8', skyBottom: '#fbcfe8', ground: '#86efac' } },
  { id: 'storm', label: 'Storm', draft: { skyTop: '#1e293b', skyBottom: '#475569', ground: '#365314' } },
  { id: 'alien', label: 'Alien World', draft: { skyTop: '#3b0764', skyBottom: '#7e22ce', ground: '#065f46' } },
];

function BackgroundCanvasPreview({ skyTop, skyBottom, ground }: { skyTop: string; skyBottom: string; ground: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const w = canvas.width;
    const h = canvas.height;

    ctx.clearRect(0, 0, w, h);

    // Sky gradient
    const skyGrad = ctx.createLinearGradient(0, 0, 0, h - 30);
    skyGrad.addColorStop(0, skyTop);
    skyGrad.addColorStop(1, skyBottom);
    ctx.fillStyle = skyGrad;
    ctx.fillRect(0, 0, w, h - 30);

    // Simple clouds
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    const drawCloud = (cx: number, cy: number, size: number) => {
      ctx.beginPath();
      ctx.arc(cx, cy, size, 0, Math.PI * 2);
      ctx.arc(cx + size * 0.8, cy - size * 0.3, size * 0.7, 0, Math.PI * 2);
      ctx.arc(cx + size * 1.4, cy, size * 0.6, 0, Math.PI * 2);
      ctx.fill();
    };
    drawCloud(30, 28, 12);
    drawCloud(130, 18, 10);

    // Ground
    ctx.fillStyle = ground;
    ctx.fillRect(0, h - 30, w, 30);

    // Ground texture line
    ctx.fillStyle = 'rgba(0,0,0,0.15)';
    ctx.fillRect(0, h - 30, w, 2);
  }, [skyTop, skyBottom, ground]);

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

export function FlappyBackgroundEditor({
  itemDraft,
  flappyBackgroundDraft,
  setFlappyBackgroundDraft,
}: {
  itemDraft: ItemDraft;
  flappyBackgroundDraft: FlappyBackgroundDraft;
  setFlappyBackgroundDraft: React.Dispatch<React.SetStateAction<FlappyBackgroundDraft>>;
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
        <p className='text-sm font-semibold'>Flappy Bird - Background Editor</p>
        <p className='text-xs text-faint'>
          Set the sky gradient and ground color for the game scene.
        </p>
      </div>

      <div className='grid gap-4 xl:grid-cols-[1fr_1.3fr]'>
        <aside className='space-y-3'>
          <section className='rounded-lg border border-soft bg-slate-950/45 p-3 space-y-3'>
            <p className='text-[11px] uppercase tracking-wide text-faint'>Live Preview</p>
            <BackgroundCanvasPreview
              skyTop={flappyBackgroundDraft.skyTop}
              skyBottom={flappyBackgroundDraft.skyBottom}
              ground={flappyBackgroundDraft.ground}
            />
          </section>

          <section className='rounded-lg border border-soft bg-well p-3 space-y-2'>
            <p className='text-[11px] uppercase tracking-wide text-faint'>Quick Presets</p>
            <div className='grid grid-cols-2 gap-2'>
              {PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type='button'
                  className='rounded-tag border border-soft bg-raised px-2 py-1.5 text-xs text-body shadow-chip transition-[filter] duration-[140ms] hover:brightness-110'
                  onClick={() => setFlappyBackgroundDraft({ ...preset.draft })}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </section>
        </aside>

        <div className='space-y-3'>
          <section className='arcade-card-inset p-3 space-y-3'>
            <p className='text-xs font-semibold uppercase tracking-wide text-faint'>Sky</p>
            <div className='grid grid-cols-1 gap-3 sm:grid-cols-2'>
              <ColorInput
                label='Sky Top'
                value={flappyBackgroundDraft.skyTop}
                onChange={(v) => setFlappyBackgroundDraft((p) => ({ ...p, skyTop: v }))}
                hint='Top of the sky gradient.'
              />
              <ColorInput
                label='Sky Bottom'
                value={flappyBackgroundDraft.skyBottom}
                onChange={(v) => setFlappyBackgroundDraft((p) => ({ ...p, skyBottom: v }))}
                hint='Bottom of the sky gradient (horizon).'
              />
            </div>
          </section>

          <section className='arcade-card-inset p-3 space-y-3'>
            <p className='text-xs font-semibold uppercase tracking-wide text-faint'>Ground</p>
            <div className='grid grid-cols-1 gap-3 sm:grid-cols-2'>
              <ColorInput
                label='Ground Color'
                value={flappyBackgroundDraft.ground}
                onChange={(v) => setFlappyBackgroundDraft((p) => ({ ...p, ground: v }))}
                hint='Ground/grass strip at the bottom of the screen.'
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
