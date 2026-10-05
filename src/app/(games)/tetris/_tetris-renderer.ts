import {
  COLS,
  ROWS,
  HIDDEN_ROWS,
  TOTAL_ROWS,
  PIECE_SHAPES,
  type PieceType,
} from './_tetris-config';
import { TetrisEngine } from './_tetris-engine';
import type { TetrisFx } from './_tetris-effects';
import type { TetrisCosmeticTheme } from './_tetris-types';

// ---------------------------------------------------------------------------
// Renderer helpers — all read from theme (theme has full defaults)
// ---------------------------------------------------------------------------
const MIN_BOARD_CELL_SIZE = 12;

// ---------------------------------------------------------------------------
// Cell sprite cache — a cell's shading is position-independent, so each
// (color, size, shading-tuning) combo is prerendered once and blitted. This
// keeps the per-frame cost flat even with gradient/bevel themes at high DPR.
// ---------------------------------------------------------------------------
const CELL_SPRITE_CACHE_LIMIT = 64;
const cellSpriteCache = new Map<string, HTMLCanvasElement>();

function cellSpriteKey(
  color: string,
  size: number,
  theme: TetrisCosmeticTheme,
): string {
  return [
    color,
    size,
    theme.blockShading,
    theme.blockHighlightColor,
    theme.blockHighlightIntensity,
    theme.blockBorderColor,
    theme.blockBorderWidth,
  ].join('|');
}

function getCellSprite(
  color: string,
  size: number,
  theme: TetrisCosmeticTheme,
): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null;
  const key = cellSpriteKey(color, size, theme);
  const cached = cellSpriteCache.get(key);
  if (cached) return cached;
  if (cellSpriteCache.size >= CELL_SPRITE_CACHE_LIMIT) cellSpriteCache.clear();
  const sprite = document.createElement('canvas');
  sprite.width = size;
  sprite.height = size;
  const sctx = sprite.getContext('2d');
  if (!sctx) return null;
  drawCell(sctx, 0, 0, color, size, theme);
  cellSpriteCache.set(key, sprite);
  return sprite;
}

/** Draw a shaded cell, using the prerendered sprite when available. */
function drawCellCached(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  color: string,
  size: number,
  theme: TetrisCosmeticTheme,
) {
  const sprite = getCellSprite(color, size, theme);
  if (sprite) {
    ctx.drawImage(sprite, x, y);
  } else {
    drawCell(ctx, x, y, color, size, theme);
  }
}

function drawCell(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  color: string,
  size: number,
  theme: TetrisCosmeticTheme,
) {
  // Base fill — shading depends on theme.blockShading
  if (theme.blockShading === 'gradient') {
    const grad = ctx.createLinearGradient(x, y, x + size, y + size);
    grad.addColorStop(0, theme.blockHighlightColor);
    grad.addColorStop(1, color);
    ctx.fillStyle = grad;
  } else {
    ctx.fillStyle = color;
  }
  ctx.fillRect(x + 1, y + 1, size - 2, size - 2);

  // Highlight (bevel) — Midway enamel recipe mirroring .mk-cell[data-p]:
  // a bright inset top band, a softer left edge, and a dark bottom shade.
  // Scaled by blockHighlightIntensity so equipped skins still vary it.
  if (theme.blockShading === 'bevel' || theme.blockShading === 'neon') {
    const hi = theme.blockHighlightIntensity / 100;
    const band = Math.max(2, Math.round(size * 0.16));

    // top highlight band
    ctx.fillStyle = theme.blockHighlightColor;
    ctx.globalAlpha = Math.min(1, hi);
    ctx.fillRect(x + 1, y + 1, size - 2, band);

    // left highlight edge (subtler)
    ctx.globalAlpha = Math.min(1, hi * 0.55);
    ctx.fillRect(x + 1, y + 1, 2, size - 2);

    // bottom shade band — depth, not light
    ctx.fillStyle = '#000000';
    ctx.globalAlpha = Math.min(1, hi * 0.95);
    ctx.fillRect(x + 1, y + size - 1 - band, size - 2, band);

    ctx.globalAlpha = 1.0;
  }

  // Border
  if (theme.blockBorderWidth > 0) {
    ctx.strokeStyle = theme.blockBorderColor;
    ctx.lineWidth = theme.blockBorderWidth;
    ctx.strokeRect(
      x + 1 + theme.blockBorderWidth / 2,
      y + 1 + theme.blockBorderWidth / 2,
      size - 2 - theme.blockBorderWidth,
      size - 2 - theme.blockBorderWidth,
    );
  }
}

export function drawBoard(
  ctx: CanvasRenderingContext2D,
  engine: TetrisEngine,
  theme: TetrisCosmeticTheme,
  fx?: TetrisFx,
) {
  const w = ctx.canvas.width;
  const h = ctx.canvas.height;
  ctx.clearRect(0, 0, w, h);

  const cellSize = Math.max(MIN_BOARD_CELL_SIZE, Math.floor(Math.min(w / COLS, h / ROWS)));
  const boardWidth = cellSize * COLS;
  const boardHeight = cellSize * ROWS;
  let offsetX = Math.floor((w - boardWidth) / 2);
  let offsetY = Math.floor((h - boardHeight) / 2);

  // Board shake — shifts the whole board for difficult clears.
  if (fx) {
    const shake = fx.shakeOffset(performance.now());
    offsetX += shake.x * cellSize;
    offsetY += shake.y * cellSize;
  }

  // Background (solid / linear / radial)
  if (theme.boardBgMode === 'linear') {
    const grad = ctx.createLinearGradient(
      offsetX,
      offsetY,
      offsetX,
      offsetY + boardHeight,
    );
    grad.addColorStop(0, theme.boardBgStart);
    grad.addColorStop(1, theme.boardBgEnd);
    ctx.fillStyle = grad;
  } else if (theme.boardBgMode === 'radial') {
    const grad = ctx.createRadialGradient(
      offsetX + boardWidth / 2,
      offsetY + boardHeight / 2,
      0,
      offsetX + boardWidth / 2,
      offsetY + boardHeight / 2,
      Math.max(boardWidth, boardHeight) / 1.2,
    );
    grad.addColorStop(0, theme.boardBgStart);
    grad.addColorStop(1, theme.boardBgEnd);
    ctx.fillStyle = grad;
  } else {
    ctx.fillStyle = theme.boardBgStart;
  }
  ctx.fillRect(offsetX - 2, offsetY - 2, boardWidth + 4, boardHeight + 4);

  // Empty cell tint (subtle wash over empty cells)
  if (theme.emptyCellTintStrength > 0) {
    ctx.save();
    ctx.globalAlpha = theme.emptyCellTintStrength / 100;
    ctx.fillStyle = theme.emptyCellTint;
    for (let row = HIDDEN_ROWS; row < TOTAL_ROWS; row++) {
      const visRow = row - HIDDEN_ROWS;
      for (let col = 0; col < COLS; col++) {
        if (engine.board[row][col]) continue;
        if ((row + col) % 2 === 0) {
          ctx.fillRect(
            offsetX + col * cellSize,
            offsetY + visRow * cellSize,
            cellSize,
            cellSize,
          );
        }
      }
    }
    ctx.restore();
  }

  // Grid
  if (theme.gridVisible && theme.gridLineWidth > 0) {
    ctx.strokeStyle = theme.gridLineColor;
    ctx.globalAlpha = 0.12;
    ctx.lineWidth = Math.max(1, theme.gridLineWidth * (cellSize / 28));
    for (let col = 1; col < COLS; col++) {
      ctx.beginPath();
      ctx.moveTo(offsetX + col * cellSize, offsetY);
      ctx.lineTo(offsetX + col * cellSize, offsetY + boardHeight);
      ctx.stroke();
    }
    for (let row = 1; row < ROWS; row++) {
      ctx.beginPath();
      ctx.moveTo(offsetX, offsetY + row * cellSize);
      ctx.lineTo(offsetX + boardWidth, offsetY + row * cellSize);
      ctx.stroke();
    }
    ctx.globalAlpha = 1.0;
  }

  // Board cells
  for (let row = HIDDEN_ROWS; row < TOTAL_ROWS; row++) {
    const visRow = row - HIDDEN_ROWS;
    for (let col = 0; col < COLS; col++) {
      const cell = engine.board[row][col];
      if (!cell) continue;
      const color =
        engine.isGameOver && row >= engine.gameOverAnimRow
          ? '#2a2014' // collapsed rows fade to dark wood, not neutral grey
          : theme.blockColors[cell];
      drawCellCached(
        ctx,
        offsetX + col * cellSize,
        offsetY + visRow * cellSize,
        color,
        cellSize,
        theme,
      );
    }
  }

  // Lock flash — a brief bright wash over the just-locked piece cells.
  if (fx && fx.lockFlashCells.length > 0) {
    const alpha = fx.lockFlashAlpha;
    if (alpha > 0) {
      ctx.fillStyle = fx.lockFlashColor;
      ctx.globalAlpha = Math.min(1, alpha);
      for (const cell of fx.lockFlashCells) {
        const visRow = cell.y - HIDDEN_ROWS;
        if (visRow < 0) continue;
        ctx.fillRect(
          offsetX + cell.x * cellSize + 1,
          offsetY + visRow * cellSize + 1,
          cellSize - 2,
          cellSize - 2,
        );
      }
      ctx.globalAlpha = 1.0;
    }
  }

  // Clear animation — themed
  if (engine.clearingRows.length > 0) {
    const isTetrisClear = engine.clearingRows.length === 4;
    const flashColor = isTetrisClear ? theme.tetrisClearColor : theme.lineClearColor;
    const intensity = theme.lineClearIntensity / 100;
    const progress = Math.min(1, engine.clearAnimTimer / 180);

    for (const row of engine.clearingRows) {
      const visRow = row - HIDDEN_ROWS;
      if (visRow < 0) continue;
      const cellY = offsetY + visRow * cellSize;

      if (theme.lineClearStyle === 'flash') {
        const alpha = (1 - progress) * intensity;
        ctx.fillStyle = flashColor;
        ctx.globalAlpha = alpha;
        ctx.fillRect(offsetX, cellY, boardWidth, cellSize);
      } else if (theme.lineClearStyle === 'dissolve') {
        const alpha = (1 - progress) * intensity;
        ctx.fillStyle = flashColor;
        for (let c = 0; c < COLS; c++) {
          if ((c + row) % 2 === Math.floor(progress * 2) % 2) {
            ctx.globalAlpha = alpha;
            ctx.fillRect(offsetX + c * cellSize, cellY, cellSize, cellSize);
          }
        }
      } else if (theme.lineClearStyle === 'sweep') {
        const sweepEnd = Math.floor(progress * COLS);
        ctx.fillStyle = flashColor;
        ctx.globalAlpha = intensity;
        ctx.fillRect(offsetX, cellY, sweepEnd * cellSize, cellSize);
      } else if (theme.lineClearStyle === 'shatter') {
        ctx.fillStyle = flashColor;
        ctx.globalAlpha = (1 - progress) * intensity;
        for (let c = 0; c < COLS; c++) {
          const dx = (c - COLS / 2) * progress * (cellSize * 0.14);
          ctx.fillRect(
            offsetX + c * cellSize + dx,
            cellY + progress * (cellSize * 0.28),
            cellSize,
            cellSize,
          );
        }
      }
    }
    ctx.globalAlpha = 1.0;
  }

  // Ghost piece + current piece (skip during clear animation)
  if (engine.current && !engine.isGameOver && engine.clearingRows.length === 0) {
    const shape = PIECE_SHAPES[engine.current.type][engine.current.rotation];
    const color = theme.blockColors[engine.current.type];

    // Ghost
    if (!engine.isPaused) {
      const ghostY = engine.getGhostY();
      const ghostColor = theme.ghostTintEnabled ? theme.ghostTintColor : color;
      const opacity = theme.ghostOpacity / 100;
      for (let r = 0; r < shape.length; r++) {
        for (let c = 0; c < shape[r].length; c++) {
          if (!shape[r][c]) continue;
          const visRow = ghostY + r - HIDDEN_ROWS;
          if (visRow < 0) continue;
          const gx = offsetX + (engine.current.x + c) * cellSize;
          const gy = offsetY + visRow * cellSize;
          const ghostInset = Math.max(1, Math.floor(cellSize * 0.08));
          const ghostStroke = Math.max(1, Math.floor(cellSize * 0.08));
          if (theme.ghostStyle === 'outline') {
            ctx.strokeStyle = ghostColor;
            ctx.globalAlpha = Math.min(1, opacity * 3);
            ctx.lineWidth = ghostStroke;
            ctx.strokeRect(gx + ghostInset, gy + ghostInset, cellSize - ghostInset * 2, cellSize - ghostInset * 2);
          } else if (theme.ghostStyle === 'dashed') {
            ctx.strokeStyle = ghostColor;
            ctx.globalAlpha = Math.min(1, opacity * 3);
            ctx.lineWidth = ghostStroke;
            ctx.setLineDash([Math.max(2, cellSize * 0.16), Math.max(2, cellSize * 0.12)]);
            ctx.strokeRect(gx + ghostInset, gy + ghostInset, cellSize - ghostInset * 2, cellSize - ghostInset * 2);
            ctx.setLineDash([]);
          } else {
            ctx.fillStyle = ghostColor;
            ctx.globalAlpha = opacity;
            ctx.fillRect(gx + 1, gy + 1, cellSize - 2, cellSize - 2);
          }
        }
      }
      ctx.globalAlpha = 1.0;
    }

    // Current piece
    for (let r = 0; r < shape.length; r++) {
      for (let c = 0; c < shape[r].length; c++) {
        if (!shape[r][c]) continue;
        const visRow = engine.current.y + r - HIDDEN_ROWS;
        if (visRow < 0) continue;
        const px = offsetX + (engine.current.x + c) * cellSize;
        const py = offsetY + visRow * cellSize;

        // Block glow (under the block)
        if (theme.blockGlowEnabled && theme.blockGlowSize > 0) {
          ctx.save();
          ctx.shadowColor = theme.blockGlowColor;
          ctx.shadowBlur = theme.blockGlowSize / 3;
          drawCellCached(ctx, px, py, color, cellSize, theme);
          ctx.restore();
        } else {
          drawCellCached(ctx, px, py, color, cellSize, theme);
        }
      }
    }
  }

  // Hard-drop impact rings — expanding shockwave across the landing row.
  if (fx) {
    fx.forEachImpact((im, progress) => {
      const visRow = im.row - HIDDEN_ROWS;
      if (visRow < 0) return;
      const cx = offsetX + im.colCenter * cellSize;
      const cy = offsetY + (visRow + 1) * cellSize;
      const strength = Math.min(1, im.size / 100);
      const spread = (im.halfWidth + progress * 2.2) * cellSize;
      const alpha = (1 - progress) * (0.35 + 0.45 * strength);
      ctx.strokeStyle = im.color;
      ctx.globalAlpha = Math.max(0, alpha);
      ctx.lineWidth = Math.max(1, cellSize * 0.09 * (1 - progress * 0.5));
      ctx.beginPath();
      ctx.ellipse(
        cx,
        cy,
        spread,
        cellSize * (0.22 + progress * 0.18),
        0,
        0,
        Math.PI * 2,
      );
      ctx.stroke();
      ctx.globalAlpha = 1.0;
    });

    // Particles — line-clear bursts and hard-drop dust.
    fx.forEachParticle((p, alpha) => {
      const visRow = p.y - HIDDEN_ROWS;
      if (visRow < -1) return;
      const s = Math.max(1, p.size * cellSize);
      ctx.fillStyle = p.color;
      ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
      ctx.fillRect(
        offsetX + p.x * cellSize - s / 2,
        offsetY + visRow * cellSize - s / 2,
        s,
        s,
      );
    });
    ctx.globalAlpha = 1.0;
  }

  // Vignette
  if (theme.vignette > 0) {
    const v = theme.vignette / 100;
    const grad = ctx.createRadialGradient(
      offsetX + boardWidth / 2,
      offsetY + boardHeight / 2,
      boardWidth * 0.3,
      offsetX + boardWidth / 2,
      offsetY + boardHeight / 2,
      boardWidth * 0.9,
    );
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(1, `rgba(0,0,0,${v})`);
    ctx.fillStyle = grad;
    ctx.fillRect(offsetX, offsetY, boardWidth, boardHeight);
  }

  // Border
  if (theme.borderWidth > 0) {
    if (theme.borderGlowEnabled) {
      ctx.save();
      ctx.shadowColor = theme.borderGlowColor;
      ctx.shadowBlur = 12;
      ctx.strokeStyle = theme.borderColor;
      ctx.lineWidth = theme.borderWidth;
      ctx.strokeRect(
        offsetX - theme.borderWidth / 2,
        offsetY - theme.borderWidth / 2,
        boardWidth + theme.borderWidth,
        boardHeight + theme.borderWidth,
      );
      ctx.restore();
    } else {
      ctx.strokeStyle = theme.borderColor;
      ctx.lineWidth = theme.borderWidth;
      ctx.strokeRect(
        offsetX - theme.borderWidth / 2,
        offsetY - theme.borderWidth / 2,
        boardWidth + theme.borderWidth,
        boardHeight + theme.borderWidth,
      );
    }
  }
}

export function drawMiniPiece(
  ctx: CanvasRenderingContext2D,
  type: PieceType,
  x: number,
  y: number,
  cellSize: number,
  theme: TetrisCosmeticTheme,
  alpha = 1.0,
) {
  const shape = PIECE_SHAPES[type][0];
  const color = theme.blockColors[type];
  ctx.globalAlpha = alpha;
  for (let r = 0; r < shape.length; r++) {
    for (let c = 0; c < shape[r].length; c++) {
      if (!shape[r][c]) continue;
      // Same shading path as board cells so previews match the playfield
      drawCell(ctx, x + c * cellSize, y + r * cellSize, color, cellSize, theme);
    }
  }
  ctx.globalAlpha = 1.0;
}
