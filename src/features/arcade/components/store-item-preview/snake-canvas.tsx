'use client';

import { useEffect, useRef, useState } from 'react';
import {
  readStr,
  readNum,
  readBool,
  getAssetImageUrl,
  lerpHex,
  BODY_GRADIENT_MODES,
  BODY_GLOW_STYLES,
  type BodyGradientMode,
  type BodyGlowStyle,
} from './helpers';

type SnakeBoardTextureCacheEntry = {
  image: HTMLImageElement;
  status: 'loading' | 'ready' | 'error';
  subscribers: Set<() => void>;
};

const snakeBoardTextureCache = new Map<string, SnakeBoardTextureCacheEntry>();

const notifySnakeBoardTextureSubscribers = (entry: SnakeBoardTextureCacheEntry) => {
  for (const subscriber of entry.subscribers) {
    subscriber();
  }
};

const ensureSnakeBoardTextureEntry = (
  url: string,
): SnakeBoardTextureCacheEntry | null => {
  if (!url) return null;
  const cached = snakeBoardTextureCache.get(url);
  if (cached) return cached;
  const entry: SnakeBoardTextureCacheEntry = {
    image: new Image(),
    status: 'loading',
    subscribers: new Set(),
  };
  entry.image.onload = () => {
    const current = snakeBoardTextureCache.get(url);
    if (!current) return;
    current.status = 'ready';
    notifySnakeBoardTextureSubscribers(current);
  };
  entry.image.onerror = () => {
    const current = snakeBoardTextureCache.get(url);
    if (!current) return;
    current.status = 'error';
    notifySnakeBoardTextureSubscribers(current);
  };
  entry.image.src = url;
  snakeBoardTextureCache.set(url, entry);
  return entry;
};

const getLoadedSnakeBoardTexture = (url: string): HTMLImageElement | null => {
  const entry = ensureSnakeBoardTextureEntry(url);
  if (!entry || entry.status !== 'ready') return null;
  return entry.image;
};

const subscribeToSnakeBoardTextureLoad = (
  url: string,
  subscriber: () => void,
) => {
  const entry = ensureSnakeBoardTextureEntry(url);
  if (!entry || entry.status !== 'loading') {
    return () => undefined;
  }
  entry.subscribers.add(subscriber);
  return () => {
    entry.subscribers.delete(subscriber);
  };
};

const drawImageCover = (
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement,
  width: number,
  height: number,
  zoomPercent = 100,
  offsetXPercent = 0,
  offsetYPercent = 0,
) => {
  if (image.naturalWidth <= 0 || image.naturalHeight <= 0) return;
  const zoom = Math.max(0.6, Math.min(2.2, zoomPercent / 100));
  const scale =
    Math.max(width / image.naturalWidth, height / image.naturalHeight) * zoom;
  const drawWidth = image.naturalWidth * scale;
  const drawHeight = image.naturalHeight * scale;
  const overflowX = Math.max(0, drawWidth - width);
  const overflowY = Math.max(0, drawHeight - height);
  const normalizedX = Math.max(-100, Math.min(100, offsetXPercent)) / 100;
  const normalizedY = Math.max(-100, Math.min(100, offsetYPercent)) / 100;
  const dx = (width - drawWidth) / 2 + (overflowX / 2) * normalizedX;
  const dy = (height - drawHeight) / 2 + (overflowY / 2) * normalizedY;
  ctx.drawImage(image, dx, dy, drawWidth, drawHeight);
};

const drawSnakeBoardBackground = (
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  boardAssetRef: Record<string, unknown> | null,
) => {
  const boardImageUrl = getAssetImageUrl(boardAssetRef);
  const colorA = readStr(
    boardAssetRef,
    'boardColorA',
    readStr(boardAssetRef, 'boardBg', '#aad751'),
  );
  const colorB = readStr(
    boardAssetRef,
    'boardColorB',
    readStr(boardAssetRef, 'gridLine', '#a2d149'),
  );
  const tileColorA2 = readStr(boardAssetRef, 'boardTileColorA2', colorA);
  const tileColorB2 = readStr(boardAssetRef, 'boardTileColorB2', colorB);
  const tileGradientEnabled = readBool(
    boardAssetRef,
    'boardTileGradientEnabled',
    false,
  );
  const tileGradientDirection = readStr(
    boardAssetRef,
    'boardTileGradientDirection',
    'diagonal',
  );
  const globalGradientEnabled = readBool(
    boardAssetRef,
    'boardGlobalGradientEnabled',
    false,
  );
  const globalGradientStart = readStr(
    boardAssetRef,
    'boardGlobalGradientStart',
    '#101a2f',
  );
  const globalGradientEnd = readStr(
    boardAssetRef,
    'boardGlobalGradientEnd',
    '#000000',
  );
  const globalGradientDirection = readStr(
    boardAssetRef,
    'boardGlobalGradientDirection',
    'radial',
  );
  const globalGradientStrength = readNum(
    boardAssetRef,
    'boardGlobalGradientStrength',
    30,
    0,
    100,
  );
  const gridLineColor = readStr(
    boardAssetRef,
    'boardGridLineColor',
    readStr(boardAssetRef, 'gridLine', '#6f9953'),
  );
  const gridLineWidth = readNum(boardAssetRef, 'boardGridLineWidth', 0, 0, 4);
  const borderColor = readStr(boardAssetRef, 'boardBorderColor', '#5d7f45');
  const borderWidth = readNum(boardAssetRef, 'boardBorderWidth', 2, 0, 10);
  const vignette = readNum(boardAssetRef, 'boardVignette', 0, 0, 200);
  const boardImageZoom = readNum(boardAssetRef, 'boardImageZoom', 100, 60, 220);
  const boardImageOffsetX = readNum(boardAssetRef, 'boardImageOffsetX', 0, -100, 100);
  const boardImageOffsetY = readNum(boardAssetRef, 'boardImageOffsetY', 0, -100, 100);
  const cells = 18;

  const makeGradient = (
    x: number,
    y: number,
    width: number,
    height: number,
    start: string,
    end: string,
    direction: string,
  ) => {
    if (direction === 'horizontal') {
      const gradient = ctx.createLinearGradient(x, y, x + width, y);
      gradient.addColorStop(0, start);
      gradient.addColorStop(1, end);
      return gradient;
    }
    if (direction === 'vertical') {
      const gradient = ctx.createLinearGradient(x, y, x, y + height);
      gradient.addColorStop(0, start);
      gradient.addColorStop(1, end);
      return gradient;
    }
    if (direction === 'radial') {
      const gradient = ctx.createRadialGradient(
        x + width * 0.5,
        y + height * 0.5,
        Math.min(width, height) * 0.12,
        x + width * 0.5,
        y + height * 0.5,
        Math.max(width, height) * 0.75,
      );
      gradient.addColorStop(0, start);
      gradient.addColorStop(1, end);
      return gradient;
    }
    const gradient = ctx.createLinearGradient(x, y, x + width, y + height);
    gradient.addColorStop(0, start);
    gradient.addColorStop(1, end);
    return gradient;
  };

  const cellW = w / cells;
  const cellH = h / cells;

  for (let y = 0; y < cells; y++) {
    for (let x = 0; x < cells; x++) {
      const isA = (x + y) % 2 === 0;
      if (tileGradientEnabled) {
        ctx.fillStyle = makeGradient(
          x * cellW,
          y * cellH,
          cellW,
          cellH,
          isA ? colorA : colorB,
          isA ? tileColorA2 : tileColorB2,
          tileGradientDirection,
        );
      } else {
        ctx.fillStyle = isA ? colorA : colorB;
      }
      ctx.fillRect(x * cellW, y * cellH, cellW, cellH);
    }
  }

  if (boardImageUrl) {
    const texture = getLoadedSnakeBoardTexture(boardImageUrl);
    if (texture) {
      drawImageCover(
        ctx,
        texture,
        w,
        h,
        boardImageZoom,
        boardImageOffsetX,
        boardImageOffsetY,
      );
    }
  }

  if (globalGradientEnabled && globalGradientStrength > 0) {
    ctx.save();
    ctx.globalAlpha = Math.min(1, globalGradientStrength / 100);
    ctx.fillStyle = makeGradient(
      0,
      0,
      w,
      h,
      globalGradientStart,
      globalGradientEnd,
      globalGradientDirection,
    );
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  }

  if (gridLineWidth > 0) {
    ctx.save();
    ctx.strokeStyle = gridLineColor;
    ctx.lineWidth = gridLineWidth;
    ctx.globalAlpha = 0.75;
    for (let i = 1; i < cells; i++) {
      const x = i * cellW;
      const y = i * cellH;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }
    ctx.restore();
  }

  if (borderWidth > 0) {
    const clamped = Math.max(
      1,
      Math.min(borderWidth, Math.floor(Math.min(w, h) / 4)),
    );
    ctx.fillStyle = borderColor;
    ctx.fillRect(0, 0, w, clamped);
    ctx.fillRect(0, h - clamped, w, clamped);
    ctx.fillRect(0, 0, clamped, h);
    ctx.fillRect(w - clamped, 0, clamped, h);
  }

  if (vignette > 0) {
    const grad = ctx.createRadialGradient(
      w / 2,
      h / 2,
      Math.min(w, h) * 0.2,
      w / 2,
      h / 2,
      Math.max(w, h) * 0.75,
    );
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(
      1,
      `rgba(0,0,0,${Math.min(0.95, (vignette / 200) * 0.9)})`,
    );
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
  }
};

// --- Snake body preview matching actual game rendering ---
export function SnakeBodyCanvasPreview({
  assetRef,
  boardAssetRef = null,
  align = 'head',
}: {
  assetRef: Record<string, unknown> | null;
  boardAssetRef?: Record<string, unknown> | null;
  align?: 'head' | 'center';
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const pri = readStr(assetRef, 'bodyPrimary', '#22c55e');
    const sec = readStr(assetRef, 'bodySecondary', '#16a34a');
    const gradientMode = (
      BODY_GRADIENT_MODES.includes(readStr(assetRef, 'bodyGradient', 'flat'))
        ? readStr(assetRef, 'bodyGradient', 'flat')
        : 'flat'
    ) as BodyGradientMode;
    const glowEnabled = readBool(assetRef, 'bodyGlowEnabled', false);
    const glowColor = readStr(assetRef, 'bodyGlowColor', '#22c55e');
    const glowColorAlt = readStr(assetRef, 'bodyGlowColorAlt', '#60a5fa');
    const glowStyle = (
      BODY_GLOW_STYLES.includes(readStr(assetRef, 'bodyGlowStyle', 'none'))
        ? readStr(assetRef, 'bodyGlowStyle', 'none')
        : 'none'
    ) as BodyGlowStyle;
    const glowSpeed = readNum(assetRef, 'bodyGlowSpeed', 50, 10, 100);
    const glowSize = readNum(assetRef, 'bodyGlowSize', 50, 10, 200);
    const patternStyleRaw = readStr(assetRef, 'bodyPatternStyle', 'none');
    const patternStyle = patternStyleRaw === 'scales' ? 'stripes' : patternStyleRaw;
    const patternColor = readStr(assetRef, 'bodyPatternColor', '#dcfce7');
    const patternIntensity = readNum(assetRef, 'bodyPatternIntensity', 35, 0, 100);

    // Preview background settings
    const BG_MODES: readonly string[] = ['auto', 'solid', 'custom-gradient'];
    const bgMode = BG_MODES.includes(readStr(assetRef, 'previewBgMode', 'auto'))
      ? readStr(assetRef, 'previewBgMode', 'auto')
      : 'auto';
    const bgSolid = readStr(assetRef, 'previewBgSolid', '#0b1220');
    const bgColorsRaw = assetRef?.previewBgColors;
    const bgColors = Array.isArray(bgColorsRaw)
      ? (bgColorsRaw as unknown[])
          .filter((v): v is string => typeof v === 'string')
          .slice(0, 4)
      : [];

    let rafId = 0;
    let lastW = 0;
    let lastH = 0;
    let lastDpr = 0;

    const render = () => {
      // Pause when the tab is hidden or the canvas is not laid out (offscreen
      // store cards) so a grid of previews does not burn continuous rAF.
      if (document.hidden || canvas.offsetParent === null) {
        rafId = window.requestAnimationFrame(render);
        return;
      }
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (w !== lastW || h !== lastH || dpr !== lastDpr) {
        canvas.width = Math.floor(w * dpr);
        canvas.height = Math.floor(h * dpr);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        lastW = w;
        lastH = h;
        lastDpr = dpr;
      }

      if (w < 1 || h < 1) {
        rafId = window.requestAnimationFrame(render);
        return;
      }

      // Board background
      if (boardAssetRef) {
        drawSnakeBoardBackground(ctx, w, h, boardAssetRef);
      } else if (bgMode === 'solid') {
        ctx.fillStyle = bgSolid;
        ctx.fillRect(0, 0, w, h);
      } else if (bgMode === 'custom-gradient' && bgColors.length > 0) {
        if (bgColors.length === 1) {
          ctx.fillStyle = bgColors[0];
          ctx.fillRect(0, 0, w, h);
        } else {
          const grad = ctx.createLinearGradient(0, 0, w, h);
          bgColors.forEach((c, i) =>
            grad.addColorStop(i / (bgColors.length - 1), c),
          );
          ctx.fillStyle = grad;
          ctx.fillRect(0, 0, w, h);
        }
      } else {
        // auto: game-like checkerboard for more faithful body contrast preview
        const cells = 18;
        const cellW = w / cells;
        const cellH = h / cells;
        const boardA = '#aad751';
        const boardB = '#a2d149';
        for (let y = 0; y < cells; y++) {
          for (let x = 0; x < cells; x++) {
            const isA = (x + y) % 2 === 0;
            ctx.fillStyle = isA ? boardA : boardB;
            ctx.fillRect(x * cellW, y * cellH, cellW, cellH);
          }
        }
      }

      // Scale bodyR so the snake (including head lobes/snout) fits in the canvas
      // Head extends: vertically by (lobeOff + lobeR) = (0.71 + 0.8) * bodyR = 1.51 * bodyR
      // Head extends: horizontally past first pearl by (headFwd + snoutFwd + snoutR) = (0.23 + 0.97 + 0.8) * bodyR = 2.0 * bodyR
      const pad = 4;
      const maxVertical = (h - pad * 2) / (2 * 1.51); // half-height must fit lobes
      const maxFromHeight = Math.min(maxVertical, (h - pad * 2) / 2);
      const bodyR = Math.min(maxFromHeight, w * 0.08);
      const spacing = bodyR * 0.3;
      const shadowOff = bodyR * 0.12;

      // Head right-side extent past first pearl
      const headExtent = bodyR * 2.0;

      // Build pearl positions (straight horizontal line, head on right)
      const pearls: { x: number; y: number }[] = [];
      const availableWidth = w - pad * 2 - headExtent - bodyR;
      const maxPearls = Math.max(1, Math.floor(availableWidth / spacing) + 1);
      const pearlCount = Math.min(60, Math.max(8, maxPearls));
      const chainWidth = (pearlCount - 1) * spacing;
      const headX =
        align === 'center'
          ? Math.min((w + chainWidth) / 2, w - pad - headExtent)
          : w - pad - headExtent;
      const cy = h / 2;

      for (let i = 0; i < pearlCount; i++) {
        pearls.push({ x: headX - i * spacing, y: cy });
      }

      // Head geometry (compute early so glow can reference snout position)
      const hx = pearls[0].x;
      const hy = pearls[0].y;
      const fc = (cx: number, cy2: number, r: number) => {
        ctx.beginPath();
        ctx.arc(cx, cy2, r, 0, Math.PI * 2);
        ctx.fill();
      };
      const lobeR = bodyR * 0.8;
      const lobeOff = bodyR * 0.71;
      const headFwd = bodyR * 0.23;
      const snoutR = bodyR * 0.8;
      const snoutFwd = bodyR * 0.97;
      const eyeR = bodyR * 0.57;
      const irisR = eyeR * 0.62;
      const pupilR = irisR * 0.5;
      const hcx = hx + headFwd;
      const hcy = hy;
      const l1x = hcx;
      const l1y = hcy - lobeOff;
      const l2x = hcx;
      const l2y = hcy + lobeOff;
      const sx = hcx + snoutFwd;
      const sy = hcy;

      // Glow pass — drawn first so it sits behind the snake body
      if (glowEnabled && glowStyle !== 'none') {
        const glowSizeFactor = glowSize / 50;
        const glowBlur = bodyR * (0.9 + glowSizeFactor * 1.25);
        let glowAlpha = 0.82;
        if (glowStyle === 'pulse') {
          const speed = glowSpeed / 50;
          const time = performance.now() / 1000;
          glowAlpha =
            0.35 + 0.6 * (0.5 + 0.5 * Math.sin(time * speed * Math.PI * 2));
        }
        const glowPulseMix = (() => {
          if (glowStyle !== 'pulse-dual') return 0;
          const speed = glowSpeed / 50;
          const time = performance.now() / 1000;
          return 0.5 + 0.5 * Math.sin(time * speed * Math.PI * 2);
        })();
        const activeGlowColor =
          glowStyle === 'pulse-dual'
            ? lerpHex(glowColor, glowColorAlt, glowPulseMix)
            : glowColor;
        ctx.save();
        ctx.globalAlpha = glowAlpha;
        ctx.shadowColor = activeGlowColor;
        ctx.shadowBlur = glowBlur;
        ctx.strokeStyle = activeGlowColor;
        ctx.lineWidth = bodyR * 2.45;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();
        ctx.moveTo(pearls[pearls.length - 1].x, pearls[pearls.length - 1].y);
        for (let i = pearls.length - 2; i >= 0; i--) {
          ctx.lineTo(pearls[i].x, pearls[i].y);
        }
        ctx.stroke();
        // Head glow (lobes + snout)
        ctx.fillStyle = activeGlowColor;
        ctx.beginPath();
        ctx.arc(hcx, hcy, bodyR, 0, Math.PI * 2);
        ctx.arc(l1x, l1y, lobeR, 0, Math.PI * 2);
        ctx.arc(l2x, l2y, lobeR, 0, Math.PI * 2);
        ctx.arc(sx, sy, snoutR, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      // Shadow pass
      ctx.fillStyle = 'rgba(100,140,50,0.30)';
      ctx.beginPath();
      for (const p of pearls) {
        ctx.moveTo(p.x + bodyR, p.y + shadowOff);
        ctx.arc(p.x, p.y + shadowOff, bodyR, 0, Math.PI * 2);
      }
      ctx.fill();

      // Body pass — gradient-aware
      const total = Math.max(1, pearls.length - 1);
      for (let i = 0; i < pearls.length; i++) {
        const px = pearls[i].x;
        const py = pearls[i].y;
        const t = i / total;

        if (gradientMode === 'flat') {
          ctx.fillStyle = pri;
        } else if (gradientMode === 'linear') {
          ctx.fillStyle = lerpHex(pri, sec, t);
        } else if (gradientMode === 'radial') {
          const grad = ctx.createRadialGradient(
            px - bodyR * 0.3,
            py - bodyR * 0.3,
            bodyR * 0.1,
            px,
            py,
            bodyR,
          );
          grad.addColorStop(0, lerpHex(pri, '#ffffff', 0.25));
          grad.addColorStop(0.6, pri);
          grad.addColorStop(1, sec);
          ctx.fillStyle = grad;
        } else {
          const baseColor = lerpHex(pri, sec, t);
          const grad = ctx.createRadialGradient(
            px - bodyR * 0.3,
            py - bodyR * 0.3,
            bodyR * 0.1,
            px,
            py,
            bodyR,
          );
          grad.addColorStop(0, lerpHex(baseColor, '#ffffff', 0.25));
          grad.addColorStop(0.6, baseColor);
          grad.addColorStop(1, lerpHex(baseColor, sec, 0.5));
          ctx.fillStyle = grad;
        }
        ctx.beginPath();
        ctx.arc(px, py, bodyR, 0, Math.PI * 2);
        ctx.fill();
      }

      if (patternStyle !== 'none' && patternIntensity > 0) {
        const alpha = Math.min(0.9, 0.12 + (patternIntensity / 100) * 0.78);
        for (let i = 1; i < pearls.length; i++) {
          const px = pearls[i].x;
          const py = pearls[i].y;
          ctx.save();
          ctx.strokeStyle = patternColor;
          ctx.fillStyle = patternColor;
          ctx.globalAlpha = alpha;
          ctx.beginPath();
          ctx.arc(px, py, bodyR, 0, Math.PI * 2);
          ctx.clip();
          if (patternStyle === 'stripes') {
            ctx.lineWidth = Math.max(1, bodyR * (0.08 + patternIntensity / 800));
            const gap = Math.max(3, bodyR * (0.35 - patternIntensity / 700));
            const start = -bodyR * 2;
            const end = bodyR * 2;
            for (let k = start; k <= end; k += gap) {
              ctx.beginPath();
              ctx.moveTo(px + k - bodyR, py - bodyR);
              ctx.lineTo(px + k + bodyR, py + bodyR);
              ctx.stroke();
            }
          } else if (patternStyle === 'dots') {
            const dotR = Math.max(1, bodyR * (0.08 + patternIntensity / 650));
            ctx.beginPath();
            ctx.arc(px - bodyR * 0.2, py - bodyR * 0.15, dotR, 0, Math.PI * 2);
            ctx.arc(px + bodyR * 0.25, py + bodyR * 0.1, dotR, 0, Math.PI * 2);
            ctx.fill();
          }
          ctx.restore();
        }
      }

      // Head shadow
      ctx.fillStyle = 'rgba(100,140,50,0.30)';
      fc(hcx, hcy + shadowOff, bodyR);
      fc(l1x, l1y + shadowOff, lobeR);
      fc(l2x, l2y + shadowOff, lobeR);
      fc(sx, sy + shadowOff, snoutR);

      // Head fill
      ctx.fillStyle = pri;
      fc(hcx, hcy, bodyR);
      fc(l1x, l1y, lobeR);
      fc(l2x, l2y, lobeR);
      fc(sx, sy, snoutR);

      // Eye whites
      ctx.fillStyle = '#ffffff';
      fc(l1x, l1y, eyeR);
      fc(l2x, l2y, eyeR);

      // Irises (looking right)
      const irisOff = (eyeR - irisR) * 0.7;
      ctx.fillStyle = sec;
      fc(l1x + irisOff, l1y, irisR);
      fc(l2x + irisOff, l2y, irisR);

      // Pupils
      const pupilOff = (eyeR - pupilR) * 0.8;
      ctx.fillStyle = lerpHex(sec, '#000000', 0.55);
      fc(l1x + pupilOff, l1y, pupilR);
      fc(l2x + pupilOff, l2y, pupilR);

      // Nostrils
      const nostrilOff = snoutR * 0.38;
      ctx.fillStyle = 'rgba(39,74,168,0.85)';
      fc(sx, sy - nostrilOff, bodyR * 0.06);
      fc(sx, sy + nostrilOff, bodyR * 0.06);

      rafId = window.requestAnimationFrame(render);
    };

    rafId = window.requestAnimationFrame(render);
    return () => window.cancelAnimationFrame(rafId);
  }, [align, assetRef, boardAssetRef]);

  return <canvas ref={canvasRef} className='h-full w-full' />;
}

export function SnakeBoardCanvasPreview({
  assetRef,
}: {
  assetRef: Record<string, unknown> | null;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [textureRenderNonce, setTextureRenderNonce] = useState(0);
  const boardImageUrl = getAssetImageUrl(assetRef);

  useEffect(() => {
    if (!boardImageUrl) return;
    return subscribeToSnakeBoardTextureLoad(boardImageUrl, () => {
      setTextureRenderNonce((current) => current + 1);
    });
  }, [boardImageUrl]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const render = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      if (w < 1 || h < 1) return;

      drawSnakeBoardBackground(ctx, w, h, assetRef);
    };

    render();
    const ro = new ResizeObserver(render);
    ro.observe(canvas);

    return () => ro.disconnect();
  }, [assetRef, textureRenderNonce]);

  return <canvas ref={canvasRef} className='h-full w-full' />;
}

export function SnakeFoodCanvasPreview({
  assetRef,
  boardAssetRef = null,
}: {
  assetRef: Record<string, unknown> | null;
  boardAssetRef?: Record<string, unknown> | null;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const primary = readStr(assetRef, 'foodPrimary', '#ea4335');
    const highlight = readStr(assetRef, 'foodHighlight', '#f28b82');
    const stemColor = readStr(assetRef, 'foodStemColor', '#7a5230');
    const leafColor = readStr(assetRef, 'foodLeafColor', '#6abf3b');
    const shapeRaw = readStr(assetRef, 'foodShape', 'apple');
    const shape =
      shapeRaw === 'orb' || shapeRaw === 'diamond' ? shapeRaw : 'apple';
    const size = readNum(assetRef, 'foodSize', 100, 60, 140);
    const pulse = readNum(assetRef, 'foodPulse', 40, 0, 100);
    const glowEnabled = readBool(assetRef, 'foodGlowEnabled', false);
    const glowColor = readStr(assetRef, 'foodGlowColor', primary);
    const glowSize = readNum(assetRef, 'foodGlowSize', 48, 10, 140);

    let rafId = 0;
    let lastW = 0;
    let lastH = 0;
    let lastDpr = 0;

    const render = () => {
      // Pause when the tab is hidden or the canvas is not laid out (offscreen
      // store cards) so a grid of previews does not burn continuous rAF.
      if (document.hidden || canvas.offsetParent === null) {
        rafId = window.requestAnimationFrame(render);
        return;
      }
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (w !== lastW || h !== lastH || dpr !== lastDpr) {
        canvas.width = Math.floor(w * dpr);
        canvas.height = Math.floor(h * dpr);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        lastW = w;
        lastH = h;
        lastDpr = dpr;
      }

      if (w < 1 || h < 1) {
        rafId = window.requestAnimationFrame(render);
        return;
      }

      // Match in-game board context for food readability.
      drawSnakeBoardBackground(ctx, w, h, boardAssetRef);

      const cx = w * 0.5;
      const cy = h * 0.52;
      const pulseScale = 1 + (pulse / 100) * 0.08 * Math.sin(performance.now() / 220);
      const r = Math.min(w, h) * 0.22 * (size / 100) * pulseScale;

      ctx.fillStyle = 'rgba(20,30,50,0.45)';
      ctx.beginPath();
      ctx.ellipse(cx, cy + r * 0.95, r * 1.2, r * 0.45, 0, 0, Math.PI * 2);
      ctx.fill();

      if (glowEnabled) {
        ctx.save();
        ctx.shadowColor = glowColor;
        ctx.shadowBlur = r * (0.4 + glowSize / 70);
        ctx.fillStyle = glowColor;
        ctx.globalAlpha = 0.6;
        ctx.beginPath();
        ctx.arc(cx, cy, r * 0.95, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      if (shape === 'orb') {
        const orbGrad = ctx.createRadialGradient(
          cx - r * 0.18,
          cy - r * 0.22,
          r * 0.15,
          cx,
          cy,
          r * 1.05,
        );
        orbGrad.addColorStop(0, highlight);
        orbGrad.addColorStop(1, primary);
        ctx.fillStyle = orbGrad;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fill();
      } else if (shape === 'diamond') {
        ctx.fillStyle = primary;
        ctx.beginPath();
        ctx.moveTo(cx, cy - r * 1.05);
        ctx.lineTo(cx + r * 0.92, cy);
        ctx.lineTo(cx, cy + r * 1.05);
        ctx.lineTo(cx - r * 0.92, cy);
        ctx.closePath();
        ctx.fill();
      } else {
        ctx.fillStyle = primary;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fill();

        ctx.strokeStyle = stemColor;
        ctx.lineWidth = Math.max(2, r * 0.15);
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(cx, cy - r * 0.75);
        ctx.lineTo(cx - r * 0.06, cy - r * 1.32);
        ctx.stroke();

        ctx.fillStyle = leafColor;
        ctx.beginPath();
        ctx.ellipse(
          cx + r * 0.34,
          cy - r * 1.14,
          r * 0.38,
          r * 0.16,
          Math.PI * 0.2,
          0,
          Math.PI * 2,
        );
        ctx.fill();
      }

      ctx.fillStyle = highlight;
      ctx.globalAlpha = 0.62;
      ctx.beginPath();
      if (shape === 'diamond') {
        ctx.moveTo(cx - r * 0.2, cy - r * 0.45);
        ctx.lineTo(cx + r * 0.2, cy - r * 0.05);
        ctx.lineTo(cx, cy + r * 0.35);
        ctx.closePath();
      } else {
        ctx.arc(cx - r * 0.24, cy - r * 0.2, r * 0.38, 0, Math.PI * 2);
      }
      ctx.fill();
      ctx.globalAlpha = 1;
      rafId = window.requestAnimationFrame(render);
    };

    rafId = window.requestAnimationFrame(render);
    const ro = new ResizeObserver(render);
    ro.observe(canvas);
    return () => {
      ro.disconnect();
      window.cancelAnimationFrame(rafId);
    };
  }, [assetRef, boardAssetRef]);

  return <canvas ref={canvasRef} className='h-full w-full' />;
}
