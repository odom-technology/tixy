'use client';

import { useState } from 'react';

type ReactionChartPoint = {
  trial: number;
  time: number;
  x: number;
  y: number;
};

const roundToHundredth = (value: number) => Math.round(value * 100) / 100;
const roundToMs = (value: number) => Math.round(value);
const formatMs = (value: number) => roundToHundredth(value).toFixed(2);

const REACTION_CHART_SIZE = {
  width: 860,
  height: 300,
  marginTop: 20,
  marginRight: 24,
  marginBottom: 40,
  marginLeft: 62,
};

const buildReactionChartLayout = (values: number[]) => {
  const chartWidth = REACTION_CHART_SIZE.width;
  const chartHeight = REACTION_CHART_SIZE.height;
  const plotLeft = REACTION_CHART_SIZE.marginLeft;
  const plotRight = chartWidth - REACTION_CHART_SIZE.marginRight;
  const plotTop = REACTION_CHART_SIZE.marginTop;
  const plotBottom = chartHeight - REACTION_CHART_SIZE.marginBottom;
  const plotWidth = plotRight - plotLeft;
  const plotHeight = plotBottom - plotTop;

  const minVal = Math.min(...values);
  const maxVal = Math.max(...values);
  const spread = Math.max(20, maxVal - minVal);
  const domainMin = Math.max(0, Math.floor((minVal - spread * 0.25) / 10) * 10);
  const domainMax = Math.ceil((maxVal + spread * 0.25) / 10) * 10;
  const domainSpan = Math.max(1, domainMax - domainMin);

  const points: ReactionChartPoint[] = values.map((time, index) => {
    const x =
      values.length === 1
        ? plotLeft + plotWidth / 2
        : plotLeft + (plotWidth * index) / (values.length - 1);
    const y = plotTop + ((domainMax - time) / domainSpan) * plotHeight;
    return {
      trial: index + 1,
      time,
      x,
      y,
    };
  });

  const linePath =
    points.length > 0
      ? points
          .map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`)
          .join(' ')
      : '';

  const areaPath =
    points.length > 0
      ? `${linePath} L ${points[points.length - 1].x} ${plotBottom} L ${points[0].x} ${plotBottom} Z`
      : '';

  const tickCount = 5;
  const yTicks = Array.from({ length: tickCount }, (_, idx) => {
    const value = domainMax - (idx * domainSpan) / (tickCount - 1);
    const y = plotTop + ((domainMax - value) / domainSpan) * plotHeight;
    return { value: roundToMs(value), y };
  });

  return {
    chartWidth,
    chartHeight,
    plotLeft,
    plotRight,
    plotTop,
    plotBottom,
    points,
    linePath,
    areaPath,
    yTicks,
  };
};

export function ReactionTimelineChart({
  results,
  accentColor,
}: {
  results: number[];
  accentColor: string;
}) {
  const [hoveredTrial, setHoveredTrial] = useState<number | null>(null);
  const layout = buildReactionChartLayout(results);
  const hoveredPoint =
    hoveredTrial === null
      ? null
      : layout.points.find((point) => point.trial === hoveredTrial) ?? null;

  return (
    <div className='relative'>
      <svg
        className='h-52 w-full'
        viewBox={`0 0 ${layout.chartWidth} ${layout.chartHeight}`}
        preserveAspectRatio='none'
        role='img'
        aria-label='Reaction time trend graph'
      >
        {layout.yTicks.map((tick) => (
          <g key={`y-tick-${tick.value}`}>
            <line
              x1={layout.plotLeft}
              y1={tick.y}
              x2={layout.plotRight}
              y2={tick.y}
              style={{ stroke: 'var(--border-soft)' }}
              strokeDasharray='3 6'
            />
            <text
              x={layout.plotLeft - 10}
              y={tick.y + 4}
              textAnchor='end'
              fontSize='11'
              style={{ fill: 'var(--text-muted)' }}
            >
              {tick.value}ms
            </text>
          </g>
        ))}

        <line
          x1={layout.plotLeft}
          y1={layout.plotTop}
          x2={layout.plotLeft}
          y2={layout.plotBottom}
          style={{ stroke: 'var(--border-soft)' }}
          strokeWidth='1.5'
        />
        <line
          x1={layout.plotLeft}
          y1={layout.plotBottom}
          x2={layout.plotRight}
          y2={layout.plotBottom}
          style={{ stroke: 'var(--border-soft)' }}
          strokeWidth='1.5'
        />

        {layout.points.length > 1 && (
          <path
            d={layout.linePath}
            fill='none'
            style={{ stroke: accentColor }}
            strokeWidth='3'
            strokeLinecap='round'
            strokeLinejoin='round'
          />
        )}

        {layout.points.map((point) => {
          const isHovered = hoveredTrial === point.trial;
          return (
            <g key={`point-${point.trial}`}>
              <line
                x1={point.x}
                y1={layout.plotBottom}
                x2={point.x}
                y2={point.y}
                style={{ stroke: 'var(--border-soft)' }}
                strokeDasharray='2 5'
              />
              <circle
                cx={point.x}
                cy={point.y}
                r={isHovered ? 7 : 5}
                style={{
                  fill: isHovered ? 'var(--text-strong)' : accentColor,
                  stroke: accentColor,
                }}
                strokeWidth={isHovered ? 3 : 2}
                className='cursor-pointer transition-all duration-150'
                onMouseEnter={() => setHoveredTrial(point.trial)}
                onMouseLeave={() =>
                  setHoveredTrial((current) => (current === point.trial ? null : current))
                }
                onFocus={() => setHoveredTrial(point.trial)}
                onBlur={() =>
                  setHoveredTrial((current) => (current === point.trial ? null : current))
                }
                tabIndex={0}
              >
                <title>{`Trial ${point.trial}: ${formatMs(point.time)}ms`}</title>
              </circle>
              <text
                x={point.x}
                y={layout.plotBottom + 16}
                textAnchor='middle'
                fontSize='11'
                style={{ fill: 'var(--text-muted)' }}
              >
                {point.trial}
              </text>
            </g>
          );
        })}
      </svg>

      {hoveredPoint && (
        <div
          className='pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-tag border-2 border-ink bg-raised px-2.5 py-1.5 text-xs text-body shadow-chip'
          style={{
            left: `${(hoveredPoint.x / layout.chartWidth) * 100}%`,
            top: `${(hoveredPoint.y / layout.chartHeight) * 100}%`,
          }}
        >
          Trial {hoveredPoint.trial}:{' '}
          <span className='arcade-num font-semibold text-strong'>
            {formatMs(hoveredPoint.time)}ms
          </span>
        </div>
      )}
    </div>
  );
}
