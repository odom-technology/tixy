'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { InfoHint } from './_components';
import type { ItemDraft, EightBallBallsDraft } from './_types';
import { DEFAULT_EIGHT_BALL_BALLS_DRAFT } from './_types';

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

const BALL_INFO: { key: keyof EightBallBallsDraft; label: string; solidId: number; stripeId: number }[] = [
  { key: 'ballYellow', label: 'Yellow', solidId: 1, stripeId: 9 },
  { key: 'ballBlue', label: 'Blue', solidId: 2, stripeId: 10 },
  { key: 'ballRed', label: 'Red', solidId: 3, stripeId: 11 },
  { key: 'ballPurple', label: 'Purple', solidId: 4, stripeId: 12 },
  { key: 'ballOrange', label: 'Orange', solidId: 5, stripeId: 13 },
  { key: 'ballGreen', label: 'Green', solidId: 6, stripeId: 14 },
  { key: 'ballMaroon', label: 'Maroon', solidId: 7, stripeId: 15 },
];

const PRESETS: { id: string; label: string; draft: EightBallBallsDraft }[] = [
  { id: 'classic', label: 'Classic', draft: { ...DEFAULT_EIGHT_BALL_BALLS_DRAFT } },
  {
    id: 'neon',
    label: 'Neon',
    draft: {
      ballYellow: '#facc15', ballBlue: '#38bdf8', ballRed: '#fb7185',
      ballPurple: '#c084fc', ballOrange: '#fb923c', ballGreen: '#4ade80', ballMaroon: '#f472b6',
    },
  },
  {
    id: 'pastel',
    label: 'Pastel',
    draft: {
      ballYellow: '#fef08a', ballBlue: '#bfdbfe', ballRed: '#fecaca',
      ballPurple: '#e9d5ff', ballOrange: '#fed7aa', ballGreen: '#bbf7d0', ballMaroon: '#fecdd3',
    },
  },
  {
    id: 'monochrome',
    label: 'Monochrome',
    draft: {
      ballYellow: '#e2e8f0', ballBlue: '#94a3b8', ballRed: '#64748b',
      ballPurple: '#475569', ballOrange: '#cbd5e1', ballGreen: '#334155', ballMaroon: '#1e293b',
    },
  },
  {
    id: 'jewel',
    label: 'Jewel Tones',
    draft: {
      ballYellow: '#ca8a04', ballBlue: '#1e40af', ballRed: '#991b1b',
      ballPurple: '#6b21a8', ballOrange: '#c2410c', ballGreen: '#166534', ballMaroon: '#881337',
    },
  },
  {
    id: 'ocean',
    label: 'Ocean',
    draft: {
      ballYellow: '#a3e635', ballBlue: '#06b6d4', ballRed: '#f43f5e',
      ballPurple: '#8b5cf6', ballOrange: '#f97316', ballGreen: '#14b8a6', ballMaroon: '#e11d48',
    },
  },
];

function adjustHex(hex: string, amount: number): string {
  const n = hex.replace('#', '');
  const r = Math.max(0, Math.min(255, parseInt(n.substring(0, 2), 16) + amount));
  const g = Math.max(0, Math.min(255, parseInt(n.substring(2, 4), 16) + amount));
  const b = Math.max(0, Math.min(255, parseInt(n.substring(4, 6), 16) + amount));
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

function BallsCanvasPreview({ draft }: { draft: EightBallBallsDraft }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const drawBall = useCallback((
    ctx: CanvasRenderingContext2D,
    x: number, y: number, r: number,
    fill: string, stripe: boolean, id: number,
  ) => {
    // Shadow
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.beginPath();
    ctx.ellipse(x + 2, y + 3, r * 0.85, r * 0.55, 0.15, 0, Math.PI * 2);
    ctx.fill();

    // Ball body
    const grad = ctx.createRadialGradient(x - r * 0.4, y - r * 0.4, r * 0.1, x + r * 0.1, y + r * 0.15, r);
    if (stripe) {
      grad.addColorStop(0, '#ffffff');
      grad.addColorStop(0.5, '#f4f4f4');
      grad.addColorStop(1, '#d8d8d8');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
      // Stripe band
      ctx.save();
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.clip();
      const bandH = r * 0.85;
      const sg = ctx.createLinearGradient(x - r, y - bandH / 2, x + r, y + bandH / 2);
      sg.addColorStop(0, adjustHex(fill, 30));
      sg.addColorStop(0.5, fill);
      sg.addColorStop(1, adjustHex(fill, -30));
      ctx.fillStyle = sg;
      ctx.fillRect(x - r, y - bandH / 2, r * 2, bandH);
      ctx.restore();
    } else if (id === 0) {
      // Cue ball
      grad.addColorStop(0, '#ffffff');
      grad.addColorStop(0.4, '#f7f7f7');
      grad.addColorStop(1, '#d7d7d7');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    } else if (id === 8) {
      // 8-ball always black
      grad.addColorStop(0, '#333333');
      grad.addColorStop(0.5, '#111111');
      grad.addColorStop(1, '#000000');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    } else {
      // Solid
      grad.addColorStop(0, adjustHex(fill, 36));
      grad.addColorStop(0.5, fill);
      grad.addColorStop(1, adjustHex(fill, -34));
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }

    // Number circle
    if (id > 0) {
      const nr = r * 0.33;
      const ng = ctx.createRadialGradient(x - nr * 0.2, y - nr * 0.2, nr * 0.1, x, y, nr);
      ng.addColorStop(0, '#ffffff');
      ng.addColorStop(1, '#e4e4e4');
      ctx.fillStyle = ng;
      ctx.beginPath();
      ctx.arc(x, y, nr, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#111';
      ctx.font = `bold ${Math.round(r * 0.4)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(id.toString(), x, y + 0.5);
    }

    // Specular highlight
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.beginPath();
    ctx.arc(x - r * 0.3, y - r * 0.35, r * 0.14, 0, Math.PI * 2);
    ctx.fill();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const w = canvas.width;
    const h = canvas.height;

    ctx.clearRect(0, 0, w, h);

    // Felt background
    ctx.fillStyle = '#0d6b3d';
    ctx.fillRect(0, 0, w, h);

    const r = 14;
    const gap = r * 2 + 6;
    const startX = 24;

    // Row 1: Solids 1-7
    const y1 = 32;
    for (let i = 0; i < 7; i++) {
      const info = BALL_INFO[i];
      drawBall(ctx, startX + i * gap, y1, r, draft[info.key], false, info.solidId);
    }

    // Row 2: 8-ball + Stripes 9-15
    const y2 = 72;
    drawBall(ctx, startX, y2, r, '#111111', false, 8);
    for (let i = 0; i < 7; i++) {
      const info = BALL_INFO[i];
      drawBall(ctx, startX + (i + 1) * gap, y2, r, draft[info.key], true, info.stripeId);
    }
  }, [draft, drawBall]);

  return (
    <canvas
      ref={canvasRef}
      width={280}
      height={104}
      className='w-full rounded-lg'
      style={{ imageRendering: 'auto' }}
    />
  );
}

export function EightBallBallsEditor({
  itemDraft,
  eightBallBallsDraft,
  setEightBallBallsDraft,
}: {
  itemDraft: ItemDraft;
  eightBallBallsDraft: EightBallBallsDraft;
  setEightBallBallsDraft: React.Dispatch<React.SetStateAction<EightBallBallsDraft>>;
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
        <p className='text-sm font-semibold'>8-Ball - Ball Set Editor</p>
        <p className='text-xs text-faint'>
          Customize the 7 ball colors. Each color applies to the matching solid and stripe ball. The 8-ball stays black and cue ball stays white.
        </p>
      </div>

      <div className='grid gap-4 xl:grid-cols-[1fr_1.3fr]'>
        <aside className='space-y-3'>
          <section className='rounded-lg border border-soft bg-slate-950/45 p-3 space-y-3'>
            <p className='text-[11px] uppercase tracking-wide text-faint'>Live Preview</p>
            <BallsCanvasPreview draft={eightBallBallsDraft} />
          </section>

          <section className='rounded-lg border border-soft bg-well p-3 space-y-2'>
            <p className='text-[11px] uppercase tracking-wide text-faint'>Quick Presets</p>
            <div className='grid grid-cols-2 gap-2'>
              {PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type='button'
                  className='rounded-tag border border-soft bg-raised px-2 py-1.5 text-xs text-body shadow-chip transition-[filter] duration-[140ms] hover:brightness-110'
                  onClick={() => setEightBallBallsDraft({ ...preset.draft })}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </section>
        </aside>

        <div className='space-y-3'>
          <section className='arcade-card-inset p-3 space-y-3'>
            <p className='text-xs font-semibold uppercase tracking-wide text-faint'>Ball Colors</p>
            <div className='grid grid-cols-1 gap-3 sm:grid-cols-2'>
              {BALL_INFO.map((info) => (
                <ColorInput
                  key={info.key}
                  label={`${info.label} (${info.solidId} & ${info.stripeId})`}
                  value={eightBallBallsDraft[info.key]}
                  onChange={(v) => setEightBallBallsDraft((p) => ({ ...p, [info.key]: v }))}
                  hint={`Color for ball ${info.solidId} (solid) and ${info.stripeId} (stripe).`}
                />
              ))}
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
