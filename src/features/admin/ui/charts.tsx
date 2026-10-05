'use client';

import { useCallback, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { fmtCompact, fmtDay, fmtInt, fmtMoney } from './format';
import { Empty } from './page';

/* Charts are client components, so a server page names a format instead of
   passing a function. 'money' values are whole currency units. */
export type ValueFormat = 'int' | 'money';
function formatter(format: ValueFormat | undefined, currency = 'usd') {
  return format === 'money' ? (v: number) => fmtMoney(Math.round(v * 100), currency) : fmtInt;
}

/* Hand-drawn SVG charts at the container's real width, so text never
   scales. One y axis per chart. Solid hairline grid. Lines 2 px, columns at
   most 24 px with a 2 px gap. Every chart has a hover readout, arrow-key
   stepping when focused, and the numbers in a table under "show table". */

export type Tone = 'ink' | 'ink-2' | 'ticket' | 'series-2' | 'red';

const TONE: Record<Tone, string> = {
  ink: 'var(--adm-ink)',
  'ink-2': 'var(--adm-ink-2)',
  ticket: 'var(--adm-ticket)',
  'series-2': 'var(--adm-series-2)',
  red: 'var(--adm-red)',
};

const PAD = { l: 44, r: 12, t: 10, b: 22 };

function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    setWidth(element.clientWidth);
    const observer = new ResizeObserver(([entry]) => setWidth(Math.floor(entry.contentRect.width)));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, width];
}

/** Round axis ticks: 0 to a nice top in 3 or 4 steps. */
function niceTicks(min: number, max: number, count = 4): number[] {
  if (max === min) max = min + 1;
  const span = max - min;
  const raw = span / count;
  const power = 10 ** Math.floor(Math.log10(raw));
  // Counts are whole numbers, so a step is never under 1.
  const step = Math.max(1, [1, 2, 2.5, 5, 10].map((m) => m * power).find((s) => span / s <= count) ?? 10 * power);
  const start = Math.floor(min / step) * step;
  const ticks: number[] = [];
  for (let v = start; v <= max + step * 0.001; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
  if (ticks.at(-1)! < max) ticks.push(ticks.at(-1)! + step);
  return ticks;
}

type Series = { name: string; values: number[]; tone: Tone; area?: boolean };

function Legend({ series }: { series: { name: string; tone: Tone }[] }) {
  if (series.length < 2) return null;
  return (
    <div className='adm-legend' style={{ marginBottom: 6 }}>
      {series.map((item) => (
        <span key={item.name}><i className='adm-mark' style={{ background: TONE[item.tone] }} />{item.name}</span>
      ))}
    </div>
  );
}

function TableView({ labels, series, format }: { labels: string[]; series: { name: string; values: number[] }[]; format: (v: number) => string }) {
  return (
    <details>
      <summary>show table</summary>
      <div className='adm-table-wrap' style={{ maxHeight: 280, overflow: 'auto', marginTop: 6 }}>
        <table className='adm-table'>
          <thead>
            <tr>
              <th scope='col'>day</th>
              {series.map((item) => <th key={item.name} scope='col' data-align='right'>{item.name}</th>)}
            </tr>
          </thead>
          <tbody>
            {labels.map((label, index) => (
              <tr key={label}>
                <td>{label}</td>
                {series.map((item) => <td key={item.name} data-align='right'>{format(item.values[index] ?? 0)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function useHover(count: number) {
  const [index, setIndex] = useState<number | null>(null);
  const onKeyDown = useCallback((event: React.KeyboardEvent) => {
    if (!count) return;
    if (event.key === 'ArrowRight') { event.preventDefault(); setIndex((i) => Math.min(count - 1, (i ?? -1) + 1)); }
    else if (event.key === 'ArrowLeft') { event.preventDefault(); setIndex((i) => Math.max(0, (i ?? count) - 1)); }
    else if (event.key === 'Home') { event.preventDefault(); setIndex(0); }
    else if (event.key === 'End') { event.preventDefault(); setIndex(count - 1); }
    else if (event.key === 'Escape') setIndex(null);
  }, [count]);
  return { index, setIndex, onKeyDown };
}

function Tip({ x, width, title, rows }: { x: number; width: number; title: string; rows: { name: string; tone?: Tone; value: string }[] }) {
  const left = x > width - 170 ? x - 158 : x + 12;
  return (
    <div className='adm-chart-tip' style={{ left, top: 4 }}>
      <b>{title}</b>
      {rows.map((row) => (
        <div key={row.name}>
          {row.tone ? <i className='adm-mark' style={{ background: TONE[row.tone] }} /> : null}
          <span>{row.name}</span>
          <span>{row.value}</span>
        </div>
      ))}
    </div>
  );
}

/** Lines over days. Optional area wash on the first series. */
export function TrendChart({
  days,
  series,
  height = 180,
  label,
  format: formatName,
  currency,
  empty,
}: {
  days: string[];
  series: Series[];
  height?: number;
  label: string;
  format?: ValueFormat;
  currency?: string;
  empty?: ReactNode;
}) {
  const format = formatter(formatName, currency);
  const [ref, width] = useWidth<HTMLDivElement>();
  const n = days.length;
  const { index, setIndex, onKeyDown } = useHover(n);
  const max = Math.max(0, ...series.flatMap((s) => s.values));
  const min = Math.min(0, ...series.flatMap((s) => s.values));
  const ticks = useMemo(() => niceTicks(min, max), [min, max]);
  const top = ticks.at(-1)!;
  const bottom = ticks[0];
  const iw = Math.max(1, width - PAD.l - PAD.r);
  const ih = height - PAD.t - PAD.b;
  const x = (i: number) => PAD.l + (n <= 1 ? iw / 2 : (i / (n - 1)) * iw);
  const y = (v: number) => PAD.t + (1 - (v - bottom) / (top - bottom || 1)) * ih;
  const hasData = series.some((s) => s.values.some((v) => v !== 0));
  const partial = days.at(-1) === todayKey();
  const labelEvery = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(iw / 72))));

  return (
    <div className='adm-chart' ref={ref}>
      <Legend series={series} />
      {!hasData ? empty ?? <Empty title='Nothing recorded in this window.' /> : null}
      {width > 0 && hasData ? (
        <svg
          width={width}
          height={height}
          role='img'
          aria-label={label}
          tabIndex={0}
          onKeyDown={onKeyDown}
          onBlur={() => setIndex(null)}
          onPointerLeave={() => setIndex(null)}
          onPointerMove={(event) => {
            const rect = (event.currentTarget as SVGSVGElement).getBoundingClientRect();
            const px = event.clientX - rect.left - PAD.l;
            setIndex(Math.max(0, Math.min(n - 1, Math.round((px / iw) * (n - 1)))));
          }}
        >
          {ticks.map((tick) => (
            <g key={tick}>
              <line x1={PAD.l} x2={width - PAD.r} y1={y(tick)} y2={y(tick)} stroke='var(--adm-line)' />
              <text x={PAD.l - 8} y={y(tick) + 4} textAnchor='end'>{fmtCompact(tick)}</text>
            </g>
          ))}
          {days.map((day, i) => (i % labelEvery === 0 || i === n - 1) && (i === n - 1 || n - 1 - i >= labelEvery * 0.6) ? (
            <text key={day} x={x(i)} y={height - 6} textAnchor={i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}>{fmtDay(day)}</text>
          ) : null)}
          {series.map((s) => {
            // Today is partial: its segment is dashed so a half day doesn't read as a drop.
            const solidTo = partial && n > 1 ? n - 1 : n;
            const d = s.values.slice(0, solidTo).map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
            const all = s.values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
            return (
              <g key={s.name}>
                {s.area ? <path d={`${all}L${x(n - 1)},${y(Math.max(0, bottom))}L${x(0)},${y(Math.max(0, bottom))}Z`} fill={TONE[s.tone]} opacity={0.1} /> : null}
                <path d={d} fill='none' stroke={TONE[s.tone]} strokeWidth={2} strokeLinejoin='round' strokeLinecap='round' />
                {solidTo < n ? (
                  <path d={`M${x(n - 2).toFixed(1)},${y(s.values[n - 2] ?? 0).toFixed(1)}L${x(n - 1).toFixed(1)},${y(s.values[n - 1] ?? 0).toFixed(1)}`} fill='none' stroke={TONE[s.tone]} strokeWidth={2} strokeDasharray='3 4' strokeLinecap='round' opacity={0.6} />
                ) : null}
              </g>
            );
          })}
          {index !== null ? (
            <g>
              <line x1={x(index)} x2={x(index)} y1={PAD.t} y2={PAD.t + ih} stroke='var(--adm-line-strong)' />
              {series.map((s) => (
                <circle key={s.name} cx={x(index)} cy={y(s.values[index] ?? 0)} r={4} fill={TONE[s.tone]} stroke='var(--adm-panel)' strokeWidth={2} />
              ))}
            </g>
          ) : null}
        </svg>
      ) : null}
      {index !== null && width > 0 ? (
        <Tip x={x(index)} width={width} title={`${fmtDay(days[index])}${partial && index === n - 1 ? ', so far' : ''}`} rows={series.map((s) => ({ name: s.name, tone: s.tone, value: format(s.values[index] ?? 0) }))} />
      ) : null}
      {hasData ? <TableView labels={days} series={series} format={format} /> : null}
    </div>
  );
}

/** Tickets in above the line, tickets out below it, the net as a line. */
export function FlowChart({
  days,
  inflow,
  outflow,
  height = 200,
  label,
  inName = 'minted',
  outName = 'spent',
}: {
  days: string[];
  inflow: number[];
  outflow: number[];
  height?: number;
  label: string;
  inName?: string;
  outName?: string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const n = days.length;
  const { index, setIndex, onKeyDown } = useHover(n);
  const net = days.map((_, i) => (inflow[i] ?? 0) - (outflow[i] ?? 0));
  const partial = days.at(-1) === todayKey();
  const max = Math.max(1, ...inflow, ...net);
  const min = Math.min(0, ...outflow.map((v) => -v), ...net);
  const ticks = niceTicks(min, max, 4);
  const top = ticks.at(-1)!;
  const bottom = ticks[0];
  const iw = Math.max(1, width - PAD.l - PAD.r);
  const ih = height - PAD.t - PAD.b;
  const band = iw / Math.max(1, n);
  const barW = Math.max(1, Math.min(24, band - 2));
  const cx = (i: number) => PAD.l + band * i + band / 2;
  const y = (v: number) => PAD.t + (1 - (v - bottom) / (top - bottom || 1)) * ih;
  const r = Math.min(4, barW / 2);
  const labelEvery = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(iw / 72))));
  const hasData = inflow.some((v) => v) || outflow.some((v) => v);

  // A column with a rounded data end and a square end on the zero line.
  const column = (i: number, value: number, up: boolean) => {
    if (!value) return null;
    const x0 = cx(i) - barW / 2;
    const y0 = y(0);
    const y1 = y(up ? value : -value);
    const h = Math.abs(y1 - y0);
    const rr = Math.min(r, h);
    if (up) {
      return `M${x0},${y0}V${y1 + rr}Q${x0},${y1} ${x0 + rr},${y1}H${x0 + barW - rr}Q${x0 + barW},${y1} ${x0 + barW},${y1 + rr}V${y0}Z`;
    }
    return `M${x0},${y0}V${y1 - rr}Q${x0},${y1} ${x0 + rr},${y1}H${x0 + barW - rr}Q${x0 + barW},${y1} ${x0 + barW},${y1 - rr}V${y0}Z`;
  };

  return (
    <div className='adm-chart' ref={ref}>
      {hasData ? <Legend series={[{ name: inName, tone: 'ticket' }, { name: outName, tone: 'ink-2' }, { name: 'net', tone: 'ink' }]} /> : <Empty title='No tickets moved in this window.' />}
      {width > 0 && hasData ? (
        <svg
          width={width}
          height={height}
          role='img'
          aria-label={label}
          tabIndex={0}
          onKeyDown={onKeyDown}
          onBlur={() => setIndex(null)}
          onPointerLeave={() => setIndex(null)}
          onPointerMove={(event) => {
            const rect = (event.currentTarget as SVGSVGElement).getBoundingClientRect();
            setIndex(Math.max(0, Math.min(n - 1, Math.floor((event.clientX - rect.left - PAD.l) / band))));
          }}
        >
          {ticks.map((tick) => (
            <g key={tick}>
              <line x1={PAD.l} x2={width - PAD.r} y1={y(tick)} y2={y(tick)} stroke={tick === 0 ? 'var(--adm-line-strong)' : 'var(--adm-line)'} />
              <text x={PAD.l - 8} y={y(tick) + 4} textAnchor='end'>{fmtCompact(tick)}</text>
            </g>
          ))}
          {index !== null ? <rect x={cx(index) - band / 2} y={PAD.t} width={band} height={ih} fill='var(--adm-raised)' opacity={0.6} /> : null}
          {days.map((day, i) => (
            <g key={day} opacity={partial && i === n - 1 ? 0.45 : 1}>
              {column(i, inflow[i] ?? 0, true) ? <path d={column(i, inflow[i] ?? 0, true)!} fill={TONE.ticket} /> : null}
              {column(i, outflow[i] ?? 0, false) ? <path d={column(i, outflow[i] ?? 0, false)!} fill={TONE['ink-2']} /> : null}
            </g>
          ))}
          <path d={net.map((v, i) => `${i ? 'L' : 'M'}${cx(i).toFixed(1)},${y(v).toFixed(1)}`).join('')} fill='none' stroke={TONE.ink} strokeWidth={2} strokeLinejoin='round' />
          {days.map((day, i) => (i % labelEvery === 0 || i === n - 1) && (i === n - 1 || n - 1 - i >= labelEvery * 0.6) ? (
            <text key={day} x={cx(i)} y={height - 6} textAnchor='middle'>{fmtDay(day)}</text>
          ) : null)}
        </svg>
      ) : null}
      {index !== null && width > 0 ? (
        <Tip
          x={cx(index)}
          width={width}
          title={`${fmtDay(days[index])}${partial && index === n - 1 ? ', so far' : ''}`}
          rows={[
            { name: inName, tone: 'ticket', value: fmtInt(inflow[index] ?? 0) },
            { name: outName, tone: 'ink-2', value: fmtInt(outflow[index] ?? 0) },
            { name: 'net', tone: 'ink', value: fmtInt(net[index]) },
          ]}
        />
      ) : null}
      {hasData ? <TableView labels={days} series={[{ name: inName, values: inflow }, { name: outName, values: outflow }, { name: 'net', values: net }]} format={fmtInt} /> : null}
    </div>
  );
}

/** Columns over ordered categories: levels, tiers, balance bands. */
export function ColumnChart({
  labels,
  values,
  height = 160,
  label,
  tone = 'ink-2',
  xTitle,
  seriesName = 'players',
  format: formatName,
  currency,
}: {
  labels: string[];
  values: number[];
  height?: number;
  label: string;
  tone?: Tone;
  xTitle?: string;
  seriesName?: string;
  format?: ValueFormat;
  currency?: string;
}) {
  const format = formatter(formatName, currency);
  const [ref, width] = useWidth<HTMLDivElement>();
  const n = labels.length;
  const { index, setIndex, onKeyDown } = useHover(n);
  const ticks = niceTicks(0, Math.max(1, ...values), 3);
  const top = ticks.at(-1)!;
  const iw = Math.max(1, width - PAD.l - PAD.r);
  const ih = height - PAD.t - PAD.b;
  const band = iw / Math.max(1, n);
  const barW = Math.max(1, Math.min(24, band - 2));
  const cx = (i: number) => PAD.l + band * i + band / 2;
  const y = (v: number) => PAD.t + (1 - v / top) * ih;
  const longest = Math.max(1, ...labels.map((text) => text.length));
  const labelEvery = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(iw / Math.max(40, longest * 7 + 14)))));
  if (!values.some((v) => v)) return <Empty title='Nothing to show yet.' />;

  return (
    <div className='adm-chart' ref={ref}>
      {width > 0 ? (
        <svg
          width={width}
          height={height}
          role='img'
          aria-label={label}
          tabIndex={0}
          onKeyDown={onKeyDown}
          onBlur={() => setIndex(null)}
          onPointerLeave={() => setIndex(null)}
          onPointerMove={(event) => {
            const rect = (event.currentTarget as SVGSVGElement).getBoundingClientRect();
            setIndex(Math.max(0, Math.min(n - 1, Math.floor((event.clientX - rect.left - PAD.l) / band))));
          }}
        >
          {ticks.map((tick) => (
            <g key={tick}>
              <line x1={PAD.l} x2={width - PAD.r} y1={y(tick)} y2={y(tick)} stroke={tick === 0 ? 'var(--adm-line-strong)' : 'var(--adm-line)'} />
              <text x={PAD.l - 8} y={y(tick) + 4} textAnchor='end'>{fmtCompact(tick)}</text>
            </g>
          ))}
          {values.map((value, i) => {
            if (!value) return null;
            const x0 = cx(i) - barW / 2;
            const y1 = y(value);
            const h = y(0) - y1;
            const rr = Math.min(4, barW / 2, h);
            return (
              <path
                key={labels[i]}
                d={`M${x0},${y(0)}V${y1 + rr}Q${x0},${y1} ${x0 + rr},${y1}H${x0 + barW - rr}Q${x0 + barW},${y1} ${x0 + barW},${y1 + rr}V${y(0)}Z`}
                fill={TONE[tone]}
                opacity={index === null || index === i ? 1 : 0.55}
              />
            );
          })}
          {labels.map((text, i) => (i % labelEvery === 0 ? (
            <text key={text} x={cx(i)} y={height - 6} textAnchor='middle'>{text}</text>
          ) : null))}
        </svg>
      ) : null}
      {index !== null && width > 0 ? (
        <Tip x={cx(index)} width={width} title={xTitle ? `${xTitle} ${labels[index]}` : labels[index]} rows={[{ name: seriesName, value: format(values[index] ?? 0) }]} />
      ) : null}
      <details>
        <summary>show table</summary>
        <div className='adm-table-wrap' style={{ maxHeight: 280, overflow: 'auto', marginTop: 6 }}>
          <table className='adm-table'>
            <thead><tr><th scope='col'>{xTitle ?? 'bucket'}</th><th scope='col' data-align='right'>{seriesName}</th></tr></thead>
            <tbody>
              {labels.map((text, i) => <tr key={text}><td>{text}</td><td data-align='right'>{format(values[i] ?? 0)}</td></tr>)}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}

/** A tiny trend for a table cell. No axis, no hover; the row has the number. */
export function Spark({ values, width = 72, height = 20, tone = 'ink-2' }: { values: number[]; width?: number; height?: number; tone?: Tone }) {
  const max = Math.max(1, ...values);
  const n = values.length;
  if (n < 2) return null;
  const d = values.map((v, i) => `${i ? 'L' : 'M'}${((i / (n - 1)) * (width - 2) + 1).toFixed(1)},${(height - 1 - (v / max) * (height - 2)).toFixed(1)}`).join('');
  return (
    <svg width={width} height={height} aria-hidden='true' style={{ display: 'inline-block', verticalAlign: 'middle' }}>
      <path d={d} fill='none' stroke={TONE[tone]} strokeWidth={1.5} strokeLinejoin='round' />
    </svg>
  );
}
