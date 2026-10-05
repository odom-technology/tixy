'use client';

import { useEffect, useState } from 'react';

export const InfoHint = ({ text }: { text: string }) => (
  <span
    className='ml-1 inline-flex h-4 w-4 cursor-help items-center justify-center rounded-full border border-soft text-[10px] text-faint'
    title={text}
    aria-label={text}
  >
    i
  </span>
);

/**
 * Shared color input for all skin editors. Accepts either hex (wired to the
 * native color picker) or free-form strings (rgba(), css gradient strings —
 * the text field falls back to a no-op picker color when the value isn't a
 * plain hex so authors can still edit the text half).
 */
export function ColorInput({
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
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const hex = /^#[0-9a-fA-F]{6,8}$/.test(value.trim()) ? value.slice(0, 7) : '#000000';
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
          value={hex}
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

/** Simple green/red "Missing / OK" list rendered at the bottom of editors. */
export function ValidationChecklist({
  items,
}: {
  items: { label: string; ok: boolean }[];
}) {
  return (
    <section className='arcade-card-inset p-3 space-y-2'>
      <p className='text-xs font-semibold uppercase tracking-wide text-faint'>
        Validation
      </p>
      <div className='grid gap-1 text-xs'>
        {items.map((item) => (
          <div
            key={item.label}
            className={item.ok ? 'text-prize-text' : 'text-danger-text'}
          >
            {item.ok ? 'OK' : 'Missing'} - {item.label}
          </div>
        ))}
      </div>
    </section>
  );
}
