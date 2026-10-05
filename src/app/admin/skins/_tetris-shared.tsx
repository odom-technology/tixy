'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { InfoHint } from './_components';

export function SectionCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <section className='arcade-card-inset p-3 space-y-3'>
      <div>
        <p className='text-xs font-semibold uppercase tracking-wide text-faint'>
          {title}
        </p>
        {subtitle ? <p className='text-[11px] text-faint'>{subtitle}</p> : null}
      </div>
      {children}
    </section>
  );
}

export function TetrisColorInput({
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
  useEffect(() => {
    setTextValue(value);
  }, [value]);
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
          onChange={(event) => onChange(event.target.value)}
        />
        <input
          className='h-8 w-full rounded border border-soft bg-background px-2 font-mono text-[11px]'
          value={textValue}
          onChange={(event) => setTextValue(event.target.value)}
          onBlur={() => onChange(textValue)}
        />
      </div>
    </label>
  );
}

export function TetrisRangeInput({
  label,
  value,
  min,
  max,
  onChange,
  hint,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (next: number) => void;
  hint?: string;
}) {
  return (
    <label className='text-xs space-y-1'>
      <span className='inline-flex items-center'>
        {label} <span className='ml-1 text-[10px] text-faint'>{value}</span>
        {hint ? <InfoHint text={hint} /> : null}
      </span>
      <input
        type='range'
        min={min}
        max={max}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className='w-full'
      />
    </label>
  );
}

export function TetrisChecklist({
  items,
}: {
  items: Array<{ label: string; ok: boolean }>;
}) {
  return (
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
  );
}
