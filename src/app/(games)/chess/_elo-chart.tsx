'use client';

import { useState } from 'react';

/**
 * Compact line chart of a player's chess ELO over time. Pure SVG, no deps —
 * mirrors the reaction-time chart pattern so tixy-wide styling stays
 * consistent. Accepts a list of rating checkpoints (after each match).
 */

export type EloChartPoint = {
  matchId: string;
  ratingAfter: number;
  change: number;
  outcome: 'win' | 'loss' | 'draw';
  timestamp: number;
};

type Layout = {
  width: number;
  height: number;
  plotLeft: number;
  plotRight: number;
  plotTop: number;
  plotBottom: number;
  points: Array<{ index: number; x: number; y: number; point: EloChartPoint }>;
  linePath: string;
  areaPath: string;
  yTicks: Array<{ value: number; y: number }>;
};

const SIZE = {
  width: 860,
  height: 260,
  marginTop: 18,
  marginRight: 18,
  marginBottom: 34,
  marginLeft: 52,
};

function buildLayout(points: EloChartPoint[]): Layout {
  const plotLeft = SIZE.marginLeft;
  const plotRight = SIZE.width - SIZE.marginRight;
  const plotTop = SIZE.marginTop;
  const plotBottom = SIZE.height - SIZE.marginBottom;
  const plotWidth = plotRight - plotLeft;
  const plotHeight = plotBottom - plotTop;

  const values = points.map((p) => p.ratingAfter);
  const minVal = values.length > 0 ? Math.min(...values) : 0;
  const maxVal = values.length > 0 ? Math.max(...values) : 0;
  const spread = Math.max(40, maxVal - minVal);
  const domainMin = Math.floor((minVal - spread * 0.15) / 20) * 20;
  const domainMax = Math.ceil((maxVal + spread * 0.15) / 20) * 20;
  const domainSpan = Math.max(1, domainMax - domainMin);

  const plotted = points.map((point, index) => {
    const x =
      points.length === 1
        ? plotLeft + plotWidth / 2
        : plotLeft + (plotWidth * index) / (points.length - 1);
    const y = plotTop + ((domainMax - point.ratingAfter) / domainSpan) * plotHeight;
    return { index, x, y, point };
  });

  const linePath =
    plotted.length > 0
      ? plotted.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ')
      : '';

  const areaPath =
    plotted.length > 0
      ? `${linePath} L ${plotted[plotted.length - 1].x} ${plotBottom} L ${plotted[0].x} ${plotBottom} Z`
      : '';

  const tickCount = 4;
  const yTicks = Array.from({ length: tickCount }, (_, idx) => {
    const value = Math.round(domainMax - (idx * domainSpan) / (tickCount - 1));
    const y = plotTop + ((domainMax - value) / domainSpan) * plotHeight;
    return { value, y };
  });

  return {
    width: SIZE.width,
    height: SIZE.height,
    plotLeft,
    plotRight,
    plotTop,
    plotBottom,
    points: plotted,
    linePath,
    areaPath,
    yTicks,
  };
}

function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function outcomeColor(outcome: 'win' | 'loss' | 'draw'): string {
  if (outcome === 'win') return 'var(--enamel-prize)';
  if (outcome === 'loss') return 'var(--enamel-danger)';
  return 'var(--text-muted)';
}

export function EloChart({
  points,
  accentColor = 'var(--enamel-tickets)',
}: {
  points: EloChartPoint[];
  accentColor?: string;
}) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  if (points.length === 0) {
    return (
      <div className='rounded-panel border border-soft bg-panel p-6 text-center text-xs text-faint'>
        Play a ranked match against another player to start tracking your Elo.
      </div>
    );
  }

  const layout = buildLayout(points);
  const hovered = hoveredIndex === null ? null : layout.points[hoveredIndex] ?? null;
  const hoveredPoint = hovered?.point ?? null;

  return (
    <div className='relative'>
      <svg
        className='h-48 w-full'
        viewBox={`0 0 ${layout.width} ${layout.height}`}
        preserveAspectRatio='none'
        role='img'
        aria-label='Chess ELO history'
      >
        {layout.yTicks.map((tick) => (
          <g key={`y-tick-${tick.value}`}>
            <line
              x1={layout.plotLeft}
              y1={tick.y}
              x2={layout.plotRight}
              y2={tick.y}
              stroke='var(--border-soft)'
              strokeDasharray='3 6'
            />
            <text
              x={layout.plotLeft - 8}
              y={tick.y + 4}
              textAnchor='end'
              fontSize='11'
              fill='var(--text-muted)'
            >
              {tick.value}
            </text>
          </g>
        ))}

        <line
          x1={layout.plotLeft}
          y1={layout.plotTop}
          x2={layout.plotLeft}
          y2={layout.plotBottom}
          stroke='var(--border-soft)'
          strokeWidth='1.25'
        />
        <line
          x1={layout.plotLeft}
          y1={layout.plotBottom}
          x2={layout.plotRight}
          y2={layout.plotBottom}
          stroke='var(--border-soft)'
          strokeWidth='1.25'
        />

        {layout.points.length > 1 && (
          <path
            d={layout.linePath}
            fill='none'
            stroke={accentColor}
            strokeWidth='3'
            strokeLinecap='round'
            strokeLinejoin='round'
          />
        )}

        {layout.points.map((p) => {
          const isHovered = hoveredIndex === p.index;
          return (
            <circle
              key={p.index}
              cx={p.x}
              cy={p.y}
              r={isHovered ? 6 : 4}
              fill={isHovered ? 'var(--text-strong)' : outcomeColor(p.point.outcome)}
              stroke={outcomeColor(p.point.outcome)}
              strokeWidth={isHovered ? 3 : 2}
              className='cursor-pointer transition-all duration-150'
              onMouseEnter={() => setHoveredIndex(p.index)}
              onMouseLeave={() =>
                setHoveredIndex((curr) => (curr === p.index ? null : curr))
              }
              onFocus={() => setHoveredIndex(p.index)}
              onBlur={() =>
                setHoveredIndex((curr) => (curr === p.index ? null : curr))
              }
              tabIndex={0}
            >
              <title>{`${p.point.ratingAfter} (${p.point.change >= 0 ? '+' : ''}${p.point.change}) — ${formatDate(p.point.timestamp)}`}</title>
            </circle>
          );
        })}
      </svg>

      {hoveredPoint && hovered && (
        <div
          className='pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-tag border-2 border-ink bg-raised px-2.5 py-1.5 text-xs text-strong shadow-chip'
          style={{
            left: `${(hovered.x / layout.width) * 100}%`,
            top: `${(hovered.y / layout.height) * 100}%`,
          }}
        >
          <div className='arcade-num font-semibold'>
            {hoveredPoint.ratingAfter}{' '}
            <span
              className={
                hoveredPoint.change > 0
                  ? 'text-prize-text'
                  : hoveredPoint.change < 0
                    ? 'text-danger-text'
                    : 'text-body'
              }
            >
              ({hoveredPoint.change >= 0 ? '+' : ''}
              {hoveredPoint.change})
            </span>
          </div>
          <div className='text-[10px] text-faint'>
            {formatDate(hoveredPoint.timestamp)} · {hoveredPoint.outcome}
          </div>
        </div>
      )}
    </div>
  );
}
