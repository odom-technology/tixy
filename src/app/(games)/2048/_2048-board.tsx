'use client';

/* The 2048 board: the frame, the cells and the tiles, drawn from a theme.
   The game draws it, and so does the prize counter's preview of a 2048
   skin, so a skin looks the same in both. */

import { useMemo, type Ref } from 'react';

import type { Game2048CosmeticTheme, Tile } from './_2048-types';
import { buildContainerBackground, materialBackground, resolveTileColor } from './_2048-theme';
import { GRID_SIZE } from './_2048-helpers';

/* Scoped CSS for the tiles. Class names are prefixed to avoid collisions.
   The bevel (inset face highlight + bottom shade) is a structural depth
   effect layered over whatever face color the theme supplies, so equipped
   skins keep their colors. Sizes are container units of the board, so the
   board fills the screen at any size. */
export const GAME_2048_CSS = `
        @keyframes tile2048-spawn {
          0%   { transform: scale(0); opacity: 0; }
          60%  { transform: scale(1.08); opacity: 1; }
          100% { transform: scale(1); opacity: 1; }
        }
        @keyframes tile2048-glow-pulse {
          0%, 100% { box-shadow: var(--tile2048-bevel), 0 0 var(--tile-glow-size, 0px) var(--tile-glow-color, transparent); }
          50%      { box-shadow: var(--tile2048-bevel), 0 0 calc(var(--tile-glow-size, 0px) * 1.8) var(--tile-glow-color, transparent); }
        }
        .tile2048-frame {
          position: absolute;
          inset: 0;
          container-type: size;
          user-select: none;
        }
        .tile2048-board {
          position: absolute;
          inset: 1.4cqw;
          --tile-gap: 2.2cqw;
          border-radius: 1.8cqw;
        }
        .tile2048-cells {
          position: absolute;
          inset: var(--tile-gap);
          display: grid;
          gap: var(--tile-gap);
        }
        .tile2048-cell {
          border-radius: 1.4cqw;
          box-shadow: inset 0 2px 5px #00000070, inset 0 0 0 1px #ffffff08;
        }
        .tile2048-tiles {
          position: absolute;
          inset: var(--tile-gap);
        }
        .tile2048-tile {
          position: absolute;
          display: flex;
          align-items: center;
          justify-content: center;
          border-radius: 1.4cqw;
          transition-property: left, top;
          transition-timing-function: cubic-bezier(0.25, 1, 0.5, 1);
          font-weight: 800;
          font-family: var(--font-num);
          letter-spacing: -0.01em;
          will-change: transform;
          /* chip: top highlight and bottom shade over the face colour */
          --tile2048-bevel:
            inset 0 0 0 0.55cqw var(--tile-edge, transparent),
            inset 0 0.3cqw 0 #ffffff55,
            inset 0 -0.7cqw 1cqw #00000030,
            0 0.35cqw 0 #00000050;
          box-shadow: var(--tile2048-bevel);
        }
        .tile2048-tile[data-spawned='true'] {
          animation: tile2048-spawn 160ms ease-out;
        }
        .tile2048-tile[data-glow='true'] {
          box-shadow: var(--tile2048-bevel), 0 0 var(--tile-glow-size, 0px) var(--tile-glow-color, transparent);
        }
        .tile2048-tile[data-glow='true'][data-glow-pulse='true'] {
          animation: tile2048-glow-pulse 2.2s ease-in-out infinite;
        }
        .tile2048-tile[data-spawned='true'][data-glow='true'][data-glow-pulse='true'] {
          animation: tile2048-spawn 160ms ease-out, tile2048-glow-pulse 2.2s ease-in-out 160ms infinite;
        }
        /* A skin set's tile shape (SKINS.md): the same box, cut differently. */
        .tile2048-board[data-shape='coin'] :is(.tile2048-tile, .tile2048-cell) { border-radius: 50%; }
        .tile2048-board[data-shape='coin'] .tile2048-tile {
          outline: 0.6cqw dashed color-mix(in srgb, currentColor 40%, transparent);
          outline-offset: -1.5cqw;
        }
        .tile2048-board[data-shape='coin'] .tile2048-inner,
        .tile2048-board[data-shape='badge'] .tile2048-inner { transform: scale(0.84); }
        .tile2048-board[data-shape='block'] :is(.tile2048-tile, .tile2048-cell) { border-radius: 0.3cqw; }
        .tile2048-board[data-shape='block'] .tile2048-tile {
          --tile2048-bevel: inset 0 -1.3cqw 0 #00000038, 0 0.35cqw 0 #00000050;
        }
        .tile2048-board[data-shape='badge'] :is(.tile2048-tile, .tile2048-cell) {
          border-radius: 0;
          clip-path: polygon(28% 0, 72% 0, 100% 28%, 100% 72%, 72% 100%, 28% 100%, 0 72%, 0 28%);
        }
        .tile2048-board[data-shape='stub'] :is(.tile2048-tile, .tile2048-cell) {
          -webkit-mask:
            radial-gradient(circle at 0 50%, #0000 2.4cqw, #000 calc(2.4cqw + 0.5px)) left / 51% 100% no-repeat,
            radial-gradient(circle at 100% 50%, #0000 2.4cqw, #000 calc(2.4cqw + 0.5px)) right / 51% 100% no-repeat;
          mask:
            radial-gradient(circle at 0 50%, #0000 2.4cqw, #000 calc(2.4cqw + 0.5px)) left / 51% 100% no-repeat,
            radial-gradient(circle at 100% 50%, #0000 2.4cqw, #000 calc(2.4cqw + 0.5px)) right / 51% 100% no-repeat;
        }
        .tile2048-board[data-shape='stub'] .tile2048-tile::after {
          content: '';
          position: absolute;
          top: 16%;
          bottom: 16%;
          right: 22%;
          border-left: 0.5cqw dashed color-mix(in srgb, currentColor 40%, transparent);
        }
        .tile2048-board[data-shape='stub'] .tile2048-inner { padding-right: 18%; }
        .tile2048-inner {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 100%;
          height: 100%;
          line-height: 1;
        }
        .tile2048-controls {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 0.75rem;
          width: 100%;
          max-width: 28rem;
          margin: 0 auto;
          color: var(--tixy-on-ink-2);
        }
        .tile2048-score, .tile2048-undo {
          display: flex;
          align-items: baseline;
          gap: 0.375rem;
          font-size: 0.9375rem;
        }
        .tile2048-score small, .tile2048-undo small { font-size: inherit; }
        .tile2048-score .arc-digits {
          font-family: var(--font-num);
          font-size: 1.75rem;
          font-weight: 800;
          color: var(--tixy-paper, #f4ebdc);
        }
        .tile2048-undo { align-items: center; }
        @media (prefers-reduced-motion: reduce) {
          .tile2048-tile { transition-duration: 0ms !important; }
          .tile2048-tile[data-spawned='true'],
          .tile2048-tile[data-glow='true'][data-glow-pulse='true'],
          .tile2048-tile[data-spawned='true'][data-glow='true'][data-glow-pulse='true'] {
            animation: none;
          }
          .tile2048-tile[data-glow='true'] { box-shadow: var(--tile2048-bevel); }
        }
`;

// Tile numerals scale with the board: a share of the board's own
// size (container units), so a phone and a monitor read the same.
export const tileFontSize = (value: number): string => {
  const digits = String(value).length;
  if (digits >= 5) return '5.6cqw';
  if (digits === 4) return '7.2cqw';
  if (digits === 3) return '8.8cqw';
  return '10.6cqw';
};

export function Game2048Board({
  theme,
  tiles,
  boardRef,
}: {
  theme: Game2048CosmeticTheme;
  tiles: readonly Tile[];
  boardRef?: Ref<HTMLDivElement>;
}) {
  const containerStyle = useMemo(
    () => ({
      background: buildContainerBackground(theme),
      borderColor: theme.containerBorder,
    }),
    [theme],
  );
  return (
    <div className='tile2048-frame' style={containerStyle} aria-label='2048 game board' role='group'>
      <div
        ref={boardRef}
        className='tile2048-board'
        data-shape={theme.skin?.shape}
        data-material={theme.skin?.material}
        style={{
          backgroundColor: theme.gridBg,
          ...materialBackground(theme),
          border: `2px solid ${theme.gridBorder}`,
        }}
      >
        {/* Empty-cell background layer */}
        <div
          className='tile2048-cells'
          style={{
            gridTemplateColumns: `repeat(${GRID_SIZE}, minmax(0, 1fr))`,
            gridTemplateRows: `repeat(${GRID_SIZE}, minmax(0, 1fr))`,
          }}
          aria-hidden='true'
        >
          {Array.from({ length: GRID_SIZE * GRID_SIZE }).map((_, i) => (
            <div
              key={i}
              className='tile2048-cell'
              style={{ backgroundColor: theme.cellBg }}
            />
          ))}
        </div>

        {/* Tile layer */}
        <div className='tile2048-tiles'>
          {tiles.map((tile) => {
            const color = resolveTileColor(tile.value, theme);
            const glowOn =
              theme.glowSize > 0 &&
              theme.glowThreshold > 0 &&
              tile.value >= theme.glowThreshold;
            return (
              <div
                key={tile.id}
                className='tile2048-tile'
                data-merged={tile.merged ? 'true' : 'false'}
                data-spawned={
                  tile.spawned && theme.spawnAnimEnabled ? 'true' : 'false'
                }
                data-glow={glowOn ? 'true' : 'false'}
                data-glow-pulse={theme.glowPulse ? 'true' : 'false'}
                style={{
                  // Same maths as the cell grid: four cells and three gaps.
                  left: `calc((100% + var(--tile-gap)) / ${GRID_SIZE} * ${tile.col})`,
                  top: `calc((100% + var(--tile-gap)) / ${GRID_SIZE} * ${tile.row})`,
                  width: `calc((100% - ${GRID_SIZE - 1} * var(--tile-gap)) / ${GRID_SIZE})`,
                  height: `calc((100% - ${GRID_SIZE - 1} * var(--tile-gap)) / ${GRID_SIZE})`,
                  backgroundColor: color.bg,
                  color: color.fg,
                  fontSize: tileFontSize(tile.value),
                  transitionDuration: `${theme.slideDurationMs}ms`,
                  // Custom props consumed by the .tile2048-tile[data-glow] CSS rules.
                  ['--tile-edge' as never]: color.edge ?? 'transparent',
                  ['--tile-glow-size' as never]: `${theme.glowSize}px`,
                  ['--tile-glow-color' as never]: theme.glowColor,
                }}
              >
                <div className='tile2048-inner'>{tile.value}</div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
