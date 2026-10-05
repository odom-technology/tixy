'use client';

import { useEffect, useMemo, useState } from 'react';
import { InfoHint } from './_components';
import type {
  ItemDraft,
  CoinFlipCoinDraft,
  CoinFlipTrailDraft,
  CoinFlipBackgroundDraft,
} from './_types';

function ColorInput({
  label, value, onChange, hint,
}: { label: string; value: string; onChange: (v: string) => void; hint?: string }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return (
    <label className='text-xs space-y-1'>
      <span className='inline-flex items-center'>{label}{hint ? <InfoHint text={hint} /> : null}</span>
      <div className='flex items-center gap-2'>
        <input type='color' className='h-8 w-10 cursor-pointer rounded border border-soft bg-transparent p-0' value={value} onChange={(e) => onChange(e.target.value)} />
        <input className='h-8 w-full rounded border border-soft bg-background px-2 font-mono text-[11px]' value={text} onChange={(e) => setText(e.target.value)} onBlur={() => onChange(text)} />
      </div>
    </label>
  );
}

function Toggle({ label, value, onChange, hint }: { label: string; value: boolean; onChange: (v: boolean) => void; hint?: string }) {
  return (
    <label className='flex items-center gap-2 text-xs cursor-pointer'>
      <input type='checkbox' checked={value} onChange={(e) => onChange(e.target.checked)} className='h-4 w-4 rounded border-soft' />
      <span>{label}</span>
      {hint ? <InfoHint text={hint} /> : null}
    </label>
  );
}

// ─── Coin Editor ────────────────────────────────────────────────────────────

function CoinPreview({ draft }: { draft: CoinFlipCoinDraft }) {
  return (
    <div className='flex items-center justify-center gap-4 rounded-lg bg-slate-950/50 p-4'>
      <div
        className='flex h-20 w-20 items-center justify-center rounded-full border-[3px] text-2xl font-black'
        style={{
          background: `radial-gradient(ellipse at 35% 30%, ${draft.headsPrimary} 0%, ${draft.headsSecondary} 60%)`,
          borderColor: draft.border,
          color: draft.headsText,
          boxShadow: draft.glow ? `0 0 ${20}px ${draft.glowColor}40` : undefined,
        }}
      >H</div>
      <div
        className='flex h-20 w-20 items-center justify-center rounded-full border-[3px] text-2xl font-black'
        style={{
          background: `radial-gradient(ellipse at 35% 30%, ${draft.tailsPrimary} 0%, ${draft.tailsSecondary} 60%)`,
          borderColor: draft.border,
          color: draft.tailsText,
          boxShadow: draft.glow ? `0 0 ${20}px ${draft.glowColor}40` : undefined,
        }}
      >T</div>
    </div>
  );
}

const COIN_PRESETS: { id: string; label: string; draft: CoinFlipCoinDraft }[] = [
  { id: 'classic', label: 'Classic Gold', draft: { headsPrimary: '#fcd34d', headsSecondary: '#f59e0b', headsText: '#92400e', tailsPrimary: '#7dd3fc', tailsSecondary: '#0ea5e9', tailsText: '#0c4a6e', border: '#d97706', shine: true, glow: false, glowColor: '#ffffff' } },
  { id: 'silver', label: 'Silver', draft: { headsPrimary: '#e2e8f0', headsSecondary: '#94a3b8', headsText: '#334155', tailsPrimary: '#cbd5e1', tailsSecondary: '#64748b', tailsText: '#1e293b', border: '#475569', shine: true, glow: false, glowColor: '#ffffff' } },
  { id: 'neon', label: 'Neon', draft: { headsPrimary: '#00ff88', headsSecondary: '#00cc6a', headsText: '#003d20', tailsPrimary: '#ff00ff', tailsSecondary: '#cc00cc', tailsText: '#3d003d', border: '#00ffff', shine: true, glow: true, glowColor: '#00ff88' } },
  { id: 'obsidian', label: 'Obsidian', draft: { headsPrimary: '#1e1e2e', headsSecondary: '#0a0a14', headsText: '#a855f7', tailsPrimary: '#0a0a14', tailsSecondary: '#1e1e2e', tailsText: '#ec4899', border: '#6d28d9', shine: false, glow: true, glowColor: '#a855f7' } },
];

export function CoinFlipCoinEditor({
  itemDraft, coinFlipCoinDraft, setCoinFlipCoinDraft,
}: {
  itemDraft: ItemDraft;
  coinFlipCoinDraft: CoinFlipCoinDraft;
  setCoinFlipCoinDraft: React.Dispatch<React.SetStateAction<CoinFlipCoinDraft>>;
}) {
  const set = (k: keyof CoinFlipCoinDraft) => (v: string | boolean) =>
    setCoinFlipCoinDraft((p) => ({ ...p, [k]: v }));

  const checklist = useMemo(() => [
    { label: 'Item name set', ok: itemDraft.name.trim().length > 0 },
    { label: 'Slot assigned', ok: itemDraft.slots.length > 0 },
  ], [itemDraft.name, itemDraft.slots.length]);

  return (
    <div className='space-y-4 rounded-xl border border-soft bg-raised p-4'>
      <div>
        <p className='text-sm font-semibold'>Coin Flip - Coin Editor</p>
        <p className='text-xs text-faint'>Customize the heads and tails face colors.</p>
      </div>
      <div className='grid gap-4 xl:grid-cols-[1fr_1.3fr]'>
        <aside className='space-y-3'>
          <section className='rounded-lg border border-soft bg-slate-950/45 p-3 space-y-3'>
            <p className='text-[11px] uppercase tracking-wide text-faint'>Live Preview</p>
            <CoinPreview draft={coinFlipCoinDraft} />
          </section>
          <section className='rounded-lg border border-soft bg-well p-3 space-y-2'>
            <p className='text-[11px] uppercase tracking-wide text-faint'>Quick Presets</p>
            <div className='grid grid-cols-2 gap-2'>
              {COIN_PRESETS.map((p) => (
                <button key={p.id} type='button' className='rounded-tag border border-soft bg-raised px-2 py-1.5 text-xs text-body shadow-chip transition-[filter] duration-[140ms] hover:brightness-110' onClick={() => setCoinFlipCoinDraft({ ...p.draft })}>{p.label}</button>
              ))}
            </div>
          </section>
        </aside>
        <div className='space-y-3'>
          <section className='arcade-card-inset p-3 space-y-3'>
            <p className='text-xs font-semibold uppercase tracking-wide text-faint'>Heads Face</p>
            <div className='grid grid-cols-1 gap-3 sm:grid-cols-3'>
              <ColorInput label='Primary' value={coinFlipCoinDraft.headsPrimary} onChange={set('headsPrimary') as (v: string) => void} hint='Main gradient color' />
              <ColorInput label='Secondary' value={coinFlipCoinDraft.headsSecondary} onChange={set('headsSecondary') as (v: string) => void} hint='Edge gradient color' />
              <ColorInput label='Text' value={coinFlipCoinDraft.headsText} onChange={set('headsText') as (v: string) => void} hint='Letter color' />
            </div>
          </section>
          <section className='arcade-card-inset p-3 space-y-3'>
            <p className='text-xs font-semibold uppercase tracking-wide text-faint'>Tails Face</p>
            <div className='grid grid-cols-1 gap-3 sm:grid-cols-3'>
              <ColorInput label='Primary' value={coinFlipCoinDraft.tailsPrimary} onChange={set('tailsPrimary') as (v: string) => void} />
              <ColorInput label='Secondary' value={coinFlipCoinDraft.tailsSecondary} onChange={set('tailsSecondary') as (v: string) => void} />
              <ColorInput label='Text' value={coinFlipCoinDraft.tailsText} onChange={set('tailsText') as (v: string) => void} />
            </div>
          </section>
          <section className='arcade-card-inset p-3 space-y-3'>
            <p className='text-xs font-semibold uppercase tracking-wide text-faint'>Effects</p>
            <div className='grid grid-cols-1 gap-3 sm:grid-cols-2'>
              <ColorInput label='Border' value={coinFlipCoinDraft.border} onChange={set('border') as (v: string) => void} />
              <ColorInput label='Glow Color' value={coinFlipCoinDraft.glowColor} onChange={set('glowColor') as (v: string) => void} />
            </div>
            <div className='flex gap-4'>
              <Toggle label='Shine' value={coinFlipCoinDraft.shine} onChange={set('shine') as (v: boolean) => void} />
              <Toggle label='Glow' value={coinFlipCoinDraft.glow} onChange={set('glow') as (v: boolean) => void} />
            </div>
          </section>
          <section className='arcade-card-inset p-3 space-y-2'>
            <p className='text-xs font-semibold uppercase tracking-wide text-faint'>Validation</p>
            <div className='grid gap-1 text-xs'>
              {checklist.map((c) => <div key={c.label} className={c.ok ? 'text-prize-text' : 'text-danger-text'}>{c.ok ? 'OK' : 'Missing'} - {c.label}</div>)}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

// ─── Trail Editor ───────────────────────────────────────────────────────────

export function CoinFlipTrailEditor({
  coinFlipTrailDraft, setCoinFlipTrailDraft,
}: {
  itemDraft: ItemDraft;
  coinFlipTrailDraft: CoinFlipTrailDraft;
  setCoinFlipTrailDraft: React.Dispatch<React.SetStateAction<CoinFlipTrailDraft>>;
}) {
  return (
    <div className='space-y-4 rounded-xl border border-soft bg-raised p-4'>
      <div>
        <p className='text-sm font-semibold'>Coin Flip - Trail Editor</p>
        <p className='text-xs text-faint'>Customize the particle trail during coin flips.</p>
      </div>
      <div className='space-y-3'>
        <section className='arcade-card-inset p-3 space-y-3'>
          <div className='grid grid-cols-1 gap-3 sm:grid-cols-2'>
            <ColorInput label='Primary Color' value={coinFlipTrailDraft.color} onChange={(v) => setCoinFlipTrailDraft((p) => ({ ...p, color: v }))} />
            <ColorInput label='Secondary Color' value={coinFlipTrailDraft.secondaryColor} onChange={(v) => setCoinFlipTrailDraft((p) => ({ ...p, secondaryColor: v }))} />
          </div>
          <div className='grid grid-cols-1 gap-3 sm:grid-cols-3'>
            <label className='text-xs space-y-1'>
              <span>Particle Type</span>
              <select className='h-8 w-full rounded border border-soft bg-background px-2 text-xs' value={coinFlipTrailDraft.particleType} onChange={(e) => setCoinFlipTrailDraft((p) => ({ ...p, particleType: e.target.value }))}>
                <option value='sparkle'>Sparkle</option>
                <option value='flame'>Flame</option>
                <option value='crystal'>Crystal</option>
                <option value='wave'>Wave</option>
              </select>
            </label>
            <label className='text-xs space-y-1'>
              <span>Count</span>
              <input type='number' min={1} max={30} className='h-8 w-full rounded border border-soft bg-background px-2 text-xs' value={coinFlipTrailDraft.count} onChange={(e) => setCoinFlipTrailDraft((p) => ({ ...p, count: Number(e.target.value) }))} />
            </label>
            <label className='text-xs space-y-1'>
              <span>Spread</span>
              <input type='number' min={5} max={50} className='h-8 w-full rounded border border-soft bg-background px-2 text-xs' value={coinFlipTrailDraft.spread} onChange={(e) => setCoinFlipTrailDraft((p) => ({ ...p, spread: Number(e.target.value) }))} />
            </label>
          </div>
        </section>
      </div>
    </div>
  );
}

// ─── Background Editor ──────────────────────────────────────────────────────

export function CoinFlipBackgroundEditor({
  coinFlipBackgroundDraft, setCoinFlipBackgroundDraft,
}: {
  itemDraft: ItemDraft;
  coinFlipBackgroundDraft: CoinFlipBackgroundDraft;
  setCoinFlipBackgroundDraft: React.Dispatch<React.SetStateAction<CoinFlipBackgroundDraft>>;
}) {
  return (
    <div className='space-y-4 rounded-xl border border-soft bg-raised p-4'>
      <div>
        <p className='text-sm font-semibold'>Coin Flip - Background Editor</p>
        <p className='text-xs text-faint'>Customize the game area background.</p>
      </div>
      <div className='grid gap-4 xl:grid-cols-[1fr_1.3fr]'>
        <section className='rounded-lg border border-soft bg-slate-950/45 p-3 space-y-3'>
          <p className='text-[11px] uppercase tracking-wide text-faint'>Live Preview</p>
          <div className='h-24 w-full rounded-lg overflow-hidden' style={{ background: `linear-gradient(180deg, ${coinFlipBackgroundDraft.bgGradientStart} 0%, ${coinFlipBackgroundDraft.bgGradientEnd} 100%)` }}>
            <div className='flex h-full items-center justify-center'>
              <div className='h-14 w-14 rounded-full border-2 opacity-20' style={{ borderColor: coinFlipBackgroundDraft.accentColor }} />
            </div>
          </div>
        </section>
        <section className='arcade-card-inset p-3 space-y-3'>
          <div className='grid grid-cols-1 gap-3 sm:grid-cols-3'>
            <ColorInput label='Gradient Start' value={coinFlipBackgroundDraft.bgGradientStart} onChange={(v) => setCoinFlipBackgroundDraft((p) => ({ ...p, bgGradientStart: v }))} />
            <ColorInput label='Gradient End' value={coinFlipBackgroundDraft.bgGradientEnd} onChange={(v) => setCoinFlipBackgroundDraft((p) => ({ ...p, bgGradientEnd: v }))} />
            <ColorInput label='Accent' value={coinFlipBackgroundDraft.accentColor} onChange={(v) => setCoinFlipBackgroundDraft((p) => ({ ...p, accentColor: v }))} />
          </div>
        </section>
      </div>
    </div>
  );
}
