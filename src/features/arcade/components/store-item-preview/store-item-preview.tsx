'use client';

import Image from 'next/image';
import { type PreviewItem, getAssetImageUrl, getAssetColors, readStr } from './helpers';
import { readSkinSet } from '@/features/arcade/lib/skins/skin-set';
import { KitProfilePreview, SkinSetPreview, TitlePreview, readKitProfilePreview } from './skin-set-preview';
import {
  type TypingPreviewContext,
  resolveTypingPreviewSlot,
  typingPreviewKeyframes,
} from './typing-theme';
import {
  DEFAULT_PLAYERCARD_THEME,
  getPlayercardAnimationStyle,
  getPlayercardAnimationStylesheet,
  isPlayercardAnimation,
} from '@/features/arcade/lib/pool-playercard-theme';
import { SnakeBodyCanvasPreview, SnakeBoardCanvasPreview, SnakeFoodCanvasPreview } from './snake-canvas';
import { TypingGameMiniPreview } from './typing-preview';
import { TetrisMiniPreview, resolveTetrisPreviewSlot } from './tetris-preview';
import { resolveNewGamePreview } from './new-game-previews';

function resolveFlappyPreviewSlot(slots: string[]): string | null {
  const priority = ['bird', 'pipe', 'background', 'trail'];
  for (const s of priority) {
    if (slots.includes(s)) return s;
  }
  return null;
}

/**
 * Game-accurate bird SVG. Coordinates match the in-game drawBird() exactly:
 * body ellipse(0,0, 15,12), wing ellipse(-5,2, 10,6), eye arc(8,-5, 6),
 * pupil arc(10,-5, 3), beak triangle (15,0)→(25,3)→(15,6).
 * ViewBox padded to -18,-15 → 28,15 so glow/shadow has room.
 */
function FlappyBirdSvg({
  primary,
  secondary,
  size = 80,
}: {
  primary: string;
  secondary: string;
  size?: number;
}) {
  const aspect = 46 / 30; // viewBox width / height
  const w = size;
  const h = Math.round(size / aspect);
  return (
    <svg width={w} height={h} viewBox='-18 -15 46 30'>
      {/* body */}
      <ellipse cx='0' cy='0' rx='15' ry='12' fill={primary} />
      {/* wing */}
      <ellipse cx='-5' cy='2' rx='10' ry='6' fill={secondary} transform='rotate(-12 -5 2)' />
      {/* eye white */}
      <circle cx='8' cy='-5' r='6' fill='#fff' />
      {/* pupil */}
      <circle cx='10' cy='-5' r='3' fill='#000' />
      {/* beak */}
      <polygon points='15,0 25,3 15,6' fill='#ef4444' />
    </svg>
  );
}

function resolvePoolPreviewSlot(slots: string[]): string | null {
  const priority = ['playercard', 'table', 'cue', 'balls'];
  for (const s of priority) {
    if (slots.includes(s)) return s;
  }
  return null;
}

function PoolMiniPreview({
  assetRef,
  slot,
}: {
  assetRef: Record<string, unknown> | null;
  slot: string;
}) {
  if (slot === 'table') {
    const felt = readStr(assetRef, 'feltColor', '#1a6b37');
    const rail = readStr(assetRef, 'railColor', '#5c3a1e');
    const pocket = readStr(assetRef, 'pocketColor', '#0a0a0a');
    return (
      <div className='relative h-full w-full overflow-hidden'>
        {/* Rail */}
        <div className='absolute inset-0' style={{ background: rail }} />
        {/* Felt */}
        <div className='absolute inset-[12%]' style={{ background: felt, borderRadius: 4 }} />
        {/* Pockets */}
        {[
          { top: '8%', left: '8%' }, { top: '8%', right: '8%' },
          { bottom: '8%', left: '8%' }, { bottom: '8%', right: '8%' },
          { top: '8%', left: '50%', transform: 'translateX(-50%)' },
          { bottom: '8%', left: '50%', transform: 'translateX(-50%)' },
        ].map((pos, i) => (
          <div
            key={i}
            className='absolute h-[10px] w-[10px] rounded-full'
            style={{ ...pos, background: pocket } as React.CSSProperties}
          />
        ))}
        {/* Mini balls for context */}
        <div className='absolute' style={{ top: '45%', left: '60%' }}>
          <div className='h-[6px] w-[6px] rounded-full bg-yellow-400' />
        </div>
        <div className='absolute' style={{ top: '50%', left: '65%' }}>
          <div className='h-[6px] w-[6px] rounded-full bg-blue-500' />
        </div>
        <div className='absolute' style={{ top: '40%', left: '63%' }}>
          <div className='h-[6px] w-[6px] rounded-full bg-red-500' />
        </div>
      </div>
    );
  }

  if (slot === 'cue') {
    const cueColor = readStr(assetRef, 'cueColor', '#c4956a');
    const tipColor = readStr(assetRef, 'cueTipColor', '#6b4c2f');
    const glow = assetRef?.cueGlow === true;
    const glowColor = readStr(assetRef, 'cueGlowColor', '#ffffff');
    return (
      <div className='flex h-full w-full items-center justify-center' style={{ background: '#1a6b37' }}>
        <div className='relative flex items-center' style={{ width: '75%' }}>
          <div
            className='h-[5px] flex-1 rounded-full'
            style={{
              background: cueColor,
              boxShadow: glow ? `0 0 8px 2px ${glowColor}, 0 0 16px 4px ${glowColor}40` : undefined,
            }}
          />
          <div
            className='absolute left-0 h-[4px] w-[14%] rounded-l-full'
            style={{ background: tipColor }}
          />
        </div>
      </div>
    );
  }

  if (slot === 'balls') {
    const colors = [
      readStr(assetRef, 'ballYellow', '#f6c700'),
      readStr(assetRef, 'ballBlue', '#003da5'),
      readStr(assetRef, 'ballRed', '#d32f2f'),
      readStr(assetRef, 'ballPurple', '#4a148c'),
      readStr(assetRef, 'ballOrange', '#e65100'),
      readStr(assetRef, 'ballGreen', '#2e7d32'),
      readStr(assetRef, 'ballMaroon', '#6d1b1b'),
    ];
    return (
      <div className='flex h-full w-full items-center justify-center' style={{ background: '#0d6b3d' }}>
        <div className='grid grid-cols-4 gap-[5px]'>
          {colors.map((c, i) => (
            <div
              key={i}
              className='h-[14px] w-[14px] rounded-full'
              style={{
                background: `radial-gradient(circle at 35% 35%, ${c}dd, ${c})`,
                boxShadow: `inset -1px -1px 2px rgba(0,0,0,0.3), 0 1px 2px rgba(0,0,0,0.2)`,
              }}
            />
          ))}
          {/* 8-ball */}
          <div
            className='h-[14px] w-[14px] rounded-full'
            style={{
              background: 'radial-gradient(circle at 35% 35%, #333, #111)',
              boxShadow: 'inset -1px -1px 2px rgba(0,0,0,0.3), 0 1px 2px rgba(0,0,0,0.2)',
            }}
          />
        </div>
      </div>
    );
  }

  if (slot === 'playercard') {
    const cardBg = readStr(assetRef, 'cardBg', DEFAULT_PLAYERCARD_THEME.cardBg);
    const cardBorder = readStr(assetRef, 'cardBorder', DEFAULT_PLAYERCARD_THEME.cardBorder);
    const nameColor = readStr(assetRef, 'nameColor', DEFAULT_PLAYERCARD_THEME.nameColor);
    const eloColor = readStr(assetRef, 'eloColor', DEFAULT_PLAYERCARD_THEME.eloColor);
    const animationPrimaryColor = readStr(
      assetRef,
      'animationPrimaryColor',
      DEFAULT_PLAYERCARD_THEME.animationPrimaryColor,
    );
    const animationSecondaryColor = readStr(
      assetRef,
      'animationSecondaryColor',
      DEFAULT_PLAYERCARD_THEME.animationSecondaryColor,
    );
    const rawAnimation = readStr(assetRef, 'cardAnimation', DEFAULT_PLAYERCARD_THEME.cardAnimation);
    const cardAnimation = isPlayercardAnimation(rawAnimation)
      ? rawAnimation
      : DEFAULT_PLAYERCARD_THEME.cardAnimation;
    const previewTheme = {
      cardBg,
      cardBorder,
      nameColor,
      eloColor,
      cardAnimation,
      animationPrimaryColor,
      animationSecondaryColor,
    };
    const hasAnimation = cardAnimation !== 'none';
    return (
      <div className='flex h-full w-full items-center justify-center p-3'>
        {hasAnimation ? (
          <style dangerouslySetInnerHTML={{ __html: getPlayercardAnimationStylesheet('pc-store') }} />
        ) : null}
        <div
          className='flex w-full items-center gap-2 rounded-lg px-3 py-2 overflow-hidden'
          style={{
            background: cardBg,
            border: `1.5px solid ${cardBorder}`,
            ...getPlayercardAnimationStyle(previewTheme, { prefix: 'pc-store' }),
          }}
        >
          <div className='h-8 w-8 rounded-full bg-white/20 shrink-0' />
          <div className='min-w-0'>
            <p className='text-xs font-semibold truncate' style={{ color: nameColor }}>Player</p>
            <p className='text-[10px]' style={{ color: eloColor }}>1200 Skilled</p>
          </div>
        </div>
      </div>
    );
  }

  return null;
}

function FlappyMiniPreview({
  assetRef,
  slot,
}: {
  assetRef: Record<string, unknown> | null;
  slot: string;
}) {
  if (slot === 'bird') {
    const primary = readStr(assetRef, 'birdPrimary', '#fbbf24');
    const secondary = readStr(assetRef, 'birdSecondary', '#f59e0b');
    return (
      <div className='flex h-full w-full items-center justify-center' style={{ background: 'linear-gradient(180deg, #0ea5e9 0%, #bae6fd 100%)' }}>
        <div className='arcprev-bob'>
          <FlappyBirdSvg primary={primary} secondary={secondary} size={90} />
        </div>
      </div>
    );
  }

  if (slot === 'pipe') {
    const primary = readStr(assetRef, 'pipePrimary', '#16a34a');
    const secondary = readStr(assetRef, 'pipeSecondary', '#22c55e');
    // Matches game: PIPE_WIDTH=60, cap is PIPE_WIDTH+10=70 wide and 25px tall,
    // gradient goes primary → secondary → primary horizontally.
    return (
      <div className='flex h-full w-full items-center justify-center' style={{ background: 'linear-gradient(180deg, #0ea5e9 0%, #bae6fd 100%)' }}>
        <div className='flex flex-col items-center' style={{ gap: 28 }}>
          {/* top pipe */}
          <div className='flex flex-col items-center'>
            <div style={{ width: 36, height: 32, background: `linear-gradient(90deg, ${primary}, ${secondary} 50%, ${primary})` }} />
            <div style={{ width: 44, height: 10, background: secondary }} />
          </div>
          {/* bottom pipe */}
          <div className='flex flex-col items-center'>
            <div style={{ width: 44, height: 10, background: secondary }} />
            <div style={{ width: 36, height: 32, background: `linear-gradient(90deg, ${primary}, ${secondary} 50%, ${primary})` }} />
          </div>
        </div>
      </div>
    );
  }

  if (slot === 'background') {
    const skyTop = readStr(assetRef, 'skyTop', '#0ea5e9');
    const skyBottom = readStr(assetRef, 'skyBottom', '#bae6fd');
    const ground = readStr(assetRef, 'ground', '#84cc16');
    // Matches game: sky gradient, cloud circles, ground bar with grass line.
    // Ground is bottom 50px of 600px canvas = ~8%, but we use more for the preview.
    return (
      <div className='relative h-full w-full overflow-hidden'>
        <div className='absolute inset-0' style={{ background: `linear-gradient(180deg, ${skyTop} 0%, ${skyBottom} 70%, ${skyBottom} 100%)` }} />
        {/* clouds — matches game drawCloud positions; slow roll like the scroll */}
        <svg className='arcprev-clouds absolute inset-0 h-full w-full' viewBox='0 0 400 600' preserveAspectRatio='xMidYMid slice'>
          <circle cx='50' cy='80' r='20' fill='rgba(255,255,255,0.5)' />
          <circle cx='75' cy='70' r='25' fill='rgba(255,255,255,0.5)' />
          <circle cx='100' cy='80' r='20' fill='rgba(255,255,255,0.5)' />
          <circle cx='75' cy='85' r='15' fill='rgba(255,255,255,0.5)' />
          <circle cx='250' cy='120' r='16' fill='rgba(255,255,255,0.4)' />
          <circle cx='270' cy='112' r='20' fill='rgba(255,255,255,0.4)' />
          <circle cx='290' cy='120' r='16' fill='rgba(255,255,255,0.4)' />
          <circle cx='320' cy='60' r='12' fill='rgba(255,255,255,0.35)' />
          <circle cx='335' cy='54' r='15' fill='rgba(255,255,255,0.35)' />
          <circle cx='350' cy='60' r='12' fill='rgba(255,255,255,0.35)' />
        </svg>
        {/* grass line */}
        <div className='absolute bottom-[14%] left-0 right-0 h-[3px]' style={{ background: `linear-gradient(90deg, ${ground}, ${ground})`, filter: 'brightness(0.7)' }} />
        {/* ground */}
        <div className='absolute bottom-0 left-0 right-0 h-[14%]' style={{ background: ground }} />
        {/* small bird silhouette for context */}
        <div className='absolute' style={{ left: '18%', top: '45%' }}>
          <div className='arcprev-bob'>
            <FlappyBirdSvg primary='#fbbf24' secondary='#f59e0b' size={32} />
          </div>
        </div>
      </div>
    );
  }

  if (slot === 'trail') {
    const colors: string[] = Array.isArray(assetRef?.trailColors) && (assetRef!.trailColors as string[]).length > 0
      ? (assetRef!.trailColors as string[])
      : [readStr(assetRef, 'trailColor', '#f97316')];
    // Trail particles fanning out behind the bird, matching the in-game
    // particle system: spawn behind bird, drift left with decay and glow.
    // Particles get larger and more opaque closer to the bird (right side).
    const particles = [
      { x: 10, y: 42, r: 2.5, a: 0.08 },
      { x: 16, y: 54, r: 3.0, a: 0.10 },
      { x: 22, y: 38, r: 3.0, a: 0.12 },
      { x: 28, y: 48, r: 3.5, a: 0.15 },
      { x: 34, y: 56, r: 3.5, a: 0.18 },
      { x: 40, y: 44, r: 4.0, a: 0.22 },
      { x: 46, y: 52, r: 4.5, a: 0.28 },
      { x: 52, y: 46, r: 5.0, a: 0.34 },
      { x: 57, y: 50, r: 5.5, a: 0.40 },
      { x: 62, y: 44, r: 6.0, a: 0.48 },
    ];
    return (
      <div className='relative h-full w-full overflow-hidden' style={{ background: 'linear-gradient(180deg, #0ea5e9 0%, #bae6fd 100%)' }}>
        {/* trail particles — drift and decay like the in-game system */}
        <svg className='absolute inset-0 h-full w-full' viewBox='0 0 100 100' preserveAspectRatio='none'>
          {particles.map((p, i) => {
            const c = colors[i % colors.length];
            return (
              <g
                key={i}
                className='arcprev-drift'
                style={{ animationDelay: `${-i * 0.14}s` }}
              >
                {/* glow */}
                <circle cx={p.x} cy={p.y} r={p.r + 2} fill={c} opacity={p.a * 0.3} />
                {/* core */}
                <circle cx={p.x} cy={p.y} r={p.r} fill={c} opacity={p.a} />
              </g>
            );
          })}
        </svg>
        {/* bird at the right side */}
        <div className='absolute' style={{ right: '10%', top: '50%', transform: 'translateY(-50%)' }}>
          <div className='arcprev-bob'>
            <FlappyBirdSvg primary='#fbbf24' secondary='#f59e0b' size={36} />
          </div>
        </div>
      </div>
    );
  }

  return null;
}

function resolveCoinFlipPreviewSlot(slots: string[]): string | null {
  const priority = ['coin', 'trail', 'background'];
  return priority.find((s) => slots.includes(s)) ?? null;
}

function CoinFlipMiniPreview({
  assetRef,
  slot,
}: {
  assetRef: Record<string, unknown> | null;
  slot: string;
}) {
  if (slot === 'coin') {
    const hp = readStr(assetRef, 'headsPrimary', '#fcd34d');
    const hs = readStr(assetRef, 'headsSecondary', '#f59e0b');
    const ht = readStr(assetRef, 'headsText', '#92400e');
    const tp = readStr(assetRef, 'tailsPrimary', '#7dd3fc');
    const ts = readStr(assetRef, 'tailsSecondary', '#0ea5e9');
    const tt = readStr(assetRef, 'tailsText', '#0c4a6e');
    const border = readStr(assetRef, 'border', '#d97706');
    return (
      <div className='flex h-full w-full items-center justify-center gap-3' style={{ background: '#0f172a' }}>
        {/* Heads face — wobbles like the in-game flip */}
        <div
          className='arcprev-wobble flex h-16 w-16 items-center justify-center rounded-full border-[3px] text-xl font-black'
          style={{
            background: `radial-gradient(ellipse at 35% 30%, ${hp} 0%, ${hs} 60%)`,
            borderColor: border,
            color: ht,
          }}
        >
          H
        </div>
        {/* Tails face — offset half a cycle */}
        <div
          className='arcprev-wobble flex h-16 w-16 items-center justify-center rounded-full border-[3px] text-xl font-black'
          style={{
            background: `radial-gradient(ellipse at 35% 30%, ${tp} 0%, ${ts} 60%)`,
            borderColor: border,
            color: tt,
            animationDelay: '-0.95s',
          }}
        >
          T
        </div>
      </div>
    );
  }

  if (slot === 'trail') {
    const color = readStr(assetRef, 'color', '#fbbf24');
    const secondary = readStr(assetRef, 'secondaryColor', '#f97316');
    return (
      <div className='flex h-full w-full items-center justify-center' style={{ background: '#0f172a' }}>
        <div className='relative'>
          <div
            className='h-12 w-12 rounded-full'
            style={{ background: `radial-gradient(circle, ${color} 0%, ${secondary} 70%, transparent 100%)` }}
          />
          {/* Particle dots — orbit like the in-game trail */}
          <div className='arcprev-orbit absolute inset-0'>
            {[0, 45, 90, 135, 180, 225, 270, 315].map((angle) => (
              <div
                key={angle}
                className='absolute h-1.5 w-1.5 rounded-full'
                style={{
                  background: color,
                  left: `calc(50% + ${Math.cos(angle * Math.PI / 180) * 24}px - 3px)`,
                  top: `calc(50% + ${Math.sin(angle * Math.PI / 180) * 24}px - 3px)`,
                  opacity: 0.7,
                }}
              />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (slot === 'background') {
    const start = readStr(assetRef, 'bgGradientStart', '#0f172a');
    const end = readStr(assetRef, 'bgGradientEnd', '#1e293b');
    const accent = readStr(assetRef, 'accentColor', '#334155');
    return (
      <div
        className='relative h-full w-full'
        style={{ background: `linear-gradient(180deg, ${start} 0%, ${end} 100%)` }}
      >
        <div
          className='arcprev-glow absolute inset-x-0 bottom-0 h-1/3 opacity-30'
          style={{ background: `radial-gradient(ellipse at center bottom, ${accent} 0%, transparent 70%)` }}
        />
        {/* Coin silhouette in center */}
        <div className='absolute inset-0 flex items-center justify-center'>
          <div
            className='h-14 w-14 rounded-full border-2 opacity-20'
            style={{ borderColor: accent }}
          />
        </div>
      </div>
    );
  }

  return null;
}

function resolveGame2048PreviewSlot(slots: string[]): string | null {
  const priority = ['tiles', 'grid', 'background'];
  return priority.find((s) => slots.includes(s)) ?? null;
}

function resolveChessPreviewSlot(slots: string[]): string | null {
  const priority = ['board', 'pieces', 'clock'];
  return priority.find((s) => slots.includes(s)) ?? null;
}

/** 3×3 chess-board preview with a pair of pieces, driven by the item theme. */
function ChessMiniPreview({
  assetRef,
  slot,
}: {
  assetRef: Record<string, unknown> | null;
  slot: string;
}) {
  const light = readStr(assetRef, 'boardLightColor', '#f0d9b5');
  const dark = readStr(assetRef, 'boardDarkColor', '#b58863');
  const border = readStr(assetRef, 'boardBorderColor', '#3d2817');
  const whitePiece = readStr(assetRef, 'piecesWhiteColor', '#f8fafc');
  const blackPiece = readStr(assetRef, 'piecesBlackColor', '#0f172a');

  if (slot === 'clock') {
    const activeColor = readStr(assetRef, 'clockActiveColor', '#34d399');
    const activeBg = readStr(assetRef, 'clockActiveBg', 'rgba(16, 185, 129, 0.12)');
    return (
      <div className='flex h-full w-full items-center justify-center gap-2 p-3' style={{ background: '#0f172a' }}>
        <div className='flex h-10 w-20 items-center justify-center rounded-md font-mono text-sm font-bold text-white' style={{ background: '#1f2937' }}>
          5:00
        </div>
        <div
          className='flex h-10 w-20 items-center justify-center rounded-md border font-mono text-sm font-bold tabular-nums'
          style={{ background: activeBg, borderColor: activeColor, color: activeColor }}
        >
          4:57
        </div>
      </div>
    );
  }

  // Default: render a themed 3×3 mini board with sample pieces.
  return (
    <div className='flex h-full w-full items-center justify-center p-1' style={{ background: '#0f172a' }}>
      <div
        className='grid h-full max-h-full grid-cols-3 overflow-hidden rounded-md border'
        style={{ borderColor: border, aspectRatio: '1 / 1' }}
      >
        {Array.from({ length: 9 }).map((_, i) => {
          const r = Math.floor(i / 3);
          const c = i % 3;
          const isDark = (r + c) % 2 === 1;
          // A simple sample position: white king center, black pawn top-right.
          const showWhiteKing = r === 1 && c === 1;
          const showBlackPawn = r === 0 && c === 2;
          return (
            <div
              key={i}
              className='relative flex items-center justify-center'
              style={{ background: isDark ? dark : light }}
            >
              {showWhiteKing && (
                <span style={{ color: whitePiece, fontSize: '1.4rem', lineHeight: 1, textShadow: '0 1px 1px rgba(0,0,0,0.5)' }}>♔</span>
              )}
              {showBlackPawn && (
                <span style={{ color: blackPiece, fontSize: '1.2rem', lineHeight: 1 }}>♟</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Game2048MiniPreview({
  assetRef,
  slot,
}: {
  assetRef: Record<string, unknown> | null;
  slot: string;
}) {
  if (slot === 'tiles') {
    // Mini 2x2 with sample values that span the color ramp.
    const samples: Array<{ v: number; bgKey: string; fgKey: string; fallbackBg: string; fallbackFg: string }> = [
      { v: 2, bgKey: 'tile2Bg', fgKey: 'tile2Fg', fallbackBg: '#eee4da', fallbackFg: '#776e65' },
      { v: 8, bgKey: 'tile8Bg', fgKey: 'tile8Fg', fallbackBg: '#f2b179', fallbackFg: '#f9f6f2' },
      { v: 64, bgKey: 'tile64Bg', fgKey: 'tile64Fg', fallbackBg: '#f65e3b', fallbackFg: '#f9f6f2' },
      { v: 512, bgKey: 'tile512Bg', fgKey: 'tile512Fg', fallbackBg: '#edc850', fallbackFg: '#f9f6f2' },
    ];
    const glowColor = readStr(assetRef, 'glowColor', '#ffd166');
    const glowSizeRaw = assetRef?.glowSize;
    const glowSize =
      typeof glowSizeRaw === 'number' && Number.isFinite(glowSizeRaw)
        ? Math.max(0, Math.min(40, glowSizeRaw))
        : 0;
    return (
      <div className='flex h-full w-full items-center justify-center' style={{ background: '#bbada0' }}>
        <div className='grid grid-cols-2 gap-1.5 p-2'>
          {samples.map(({ v, bgKey, fgKey, fallbackBg, fallbackFg }) => {
            const bg = readStr(assetRef, bgKey, fallbackBg);
            const fg = readStr(assetRef, fgKey, fallbackFg);
            const showGlow = v >= 256 && glowSize > 0;
            return (
              <div
                key={v}
                className='flex h-10 w-10 items-center justify-center rounded-md text-sm font-black tabular-nums'
                style={{
                  background: bg,
                  color: fg,
                  boxShadow: showGlow ? `0 0 ${glowSize}px ${glowColor}` : undefined,
                }}
              >
                {v}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  if (slot === 'grid') {
    const gridBg = readStr(assetRef, 'gridBg', '#bbada0');
    const gridBorder = readStr(assetRef, 'gridBorder', '#a59689');
    const cellBg = readStr(assetRef, 'cellBg', '#cdc1b4');
    return (
      <div
        className='relative flex h-full w-full items-center justify-center'
        style={{ background: '#0f172a' }}
      >
        <div
          className='rounded-lg p-2'
          style={{ background: gridBg, border: `2px solid ${gridBorder}` }}
        >
          <div
            className='grid gap-1'
            style={{
              gridTemplateColumns: 'repeat(3, 18px)',
              gridTemplateRows: 'repeat(3, 18px)',
            }}
          >
            {Array.from({ length: 9 }).map((_, i) => (
              <div
                key={i}
                className='rounded'
                style={{ background: cellBg }}
              />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (slot === 'background') {
    const bg = readStr(assetRef, 'containerBg', '#1f2937');
    const gradientEnabled = assetRef?.containerGradientEnabled === true;
    const start = readStr(assetRef, 'containerGradientStart', '#0f172a');
    const end = readStr(assetRef, 'containerGradientEnd', '#1e293b');
    const direction = readStr(assetRef, 'containerGradientDirection', 'diagonal');
    let background: string = bg;
    if (gradientEnabled) {
      switch (direction) {
        case 'horizontal':
          background = `linear-gradient(90deg, ${start}, ${end})`;
          break;
        case 'vertical':
          background = `linear-gradient(180deg, ${start}, ${end})`;
          break;
        case 'radial':
          background = `radial-gradient(circle at 30% 30%, ${start}, ${end})`;
          break;
        default:
          background = `linear-gradient(135deg, ${start}, ${end})`;
      }
    }
    const border = readStr(assetRef, 'containerBorder', '#334155');
    return (
      <div className='relative h-full w-full' style={{ background }}>
        <div className='absolute inset-3 rounded-md border' style={{ borderColor: border }}>
          <div className='flex h-full w-full items-center justify-center'>
            <div className='h-10 w-10 rounded-md bg-raised' />
          </div>
        </div>
      </div>
    );
  }

  return null;
}

export function StoreItemPreview({
  item,
  compact = false,
  forceSquare = false,
  animated = false,
  snakeAlign = 'head',
  snakeBoardAssetRef = null,
  typingPreviewContext,
}: {
  item: PreviewItem;
  compact?: boolean;
  forceSquare?: boolean;
  /* Store surfaces opt in to the store-midway.css motion layer (idle float,
     hover/auto sheen, gradient drift, legendary glow). Defaults off so
     inventory/profile/modal call sites are untouched. */
  animated?: boolean;
  snakeAlign?: 'head' | 'center';
  snakeBoardAssetRef?: Record<string, unknown> | null;
  typingPreviewContext?: TypingPreviewContext;
}) {
  // Counter prizes: a skin set, an art kit frame or namecard, or a title.
  const skinSet = readSkinSet(item.assetRef);
  const kitPreview = skinSet ? null : readKitProfilePreview(item.slots, item.assetRef);
  const titleText =
    !skinSet && !kitPreview && item.id?.startsWith('counter-title-') && typeof item.assetRef?.text === 'string'
      ? item.assetRef.text
      : null;
  if (skinSet || kitPreview || titleText) {
    const sizeClass = forceSquare ? 'aspect-square' : compact ? 'h-24' : 'h-32';
    return (
      <div className={`relative w-full overflow-hidden rounded-well ${sizeClass}`} data-counter-preview>
        {skinSet ? (
          <SkinSetPreview skin={skinSet} />
        ) : kitPreview ? (
          <KitProfilePreview preview={kitPreview} />
        ) : (
          <TitlePreview text={titleText!} />
        )}
      </div>
    );
  }
  const isSnakeBodyPreview =
    item.gameType === 'snake' && item.slots.includes('body');
  const isSnakeBoardPreview =
    item.gameType === 'snake' && item.slots.includes('board');
  const isSnakeFoodPreview =
    item.gameType === 'snake' && item.slots.includes('food');
  const typingPreviewSlot =
    item.gameType === 'typing-test' ? resolveTypingPreviewSlot(item.slots) : null;
  const isTypingPreview = item.gameType === 'typing-test' && typingPreviewSlot !== null;
  const flappyPreviewSlot =
    item.gameType === 'flappy-bird' ? resolveFlappyPreviewSlot(item.slots) : null;
  const isFlappyPreview = item.gameType === 'flappy-bird' && flappyPreviewSlot !== null;
  const poolPreviewSlot =
    item.gameType === '8-ball' ? resolvePoolPreviewSlot(item.slots) : null;
  const isPoolPreview = item.gameType === '8-ball' && poolPreviewSlot !== null;
  const tetrisPreviewSlot =
    item.gameType === 'tetris' ? resolveTetrisPreviewSlot(item.slots) : null;
  const isTetrisPreview = item.gameType === 'tetris' && tetrisPreviewSlot !== null;
  const coinFlipPreviewSlot =
    item.gameType === 'coin-flip' ? resolveCoinFlipPreviewSlot(item.slots) : null;
  const isCoinFlipPreview = item.gameType === 'coin-flip' && coinFlipPreviewSlot !== null;
  const game2048PreviewSlot =
    item.gameType === '2048' ? resolveGame2048PreviewSlot(item.slots) : null;
  const isGame2048Preview = item.gameType === '2048' && game2048PreviewSlot !== null;
  const chessPreviewSlot =
    item.gameType === 'chess' ? resolveChessPreviewSlot(item.slots) : null;
  const isChessPreview = item.gameType === 'chess' && chessPreviewSlot !== null;
  const resolvedTypingPreviewContext: TypingPreviewContext | null =
    isTypingPreview && typingPreviewSlot
      ? {
          theme: typingPreviewContext?.theme ?? null,
          caret: typingPreviewContext?.caret ?? null,
          feedback: typingPreviewContext?.feedback ?? null,
          'text-style': typingPreviewContext?.['text-style'] ?? null,
          [typingPreviewSlot]: item.assetRef,
        }
      : null;
  const imageUrl = getAssetImageUrl(item.assetRef);
  const colors = getAssetColors(item.gameType, item.assetRef) ?? ['#0f172a'];
  // Game-accurate mini preview for the newer games + profile cosmetics (null for
  // games with a dedicated preview above, or games not covered → color fallback).
  const newGamePreview = resolveNewGamePreview(item.gameType, item.slots, item.assetRef);
  const setLabels = Array.isArray(item.setLabels)
    ? item.setLabels.filter((label) => typeof label === 'string' && label.trim())
    : [];
  const primarySetLabel = setLabels[0];
  const extraSetCount = Math.max(0, setLabels.length - 1);
  const sizeClass = forceSquare ? 'aspect-square' : compact ? 'h-24' : 'h-32';
  const bgStyle = {
    background:
      colors.length > 1
        ? `linear-gradient(135deg, ${colors.join(', ')})`
        : (colors[0] ?? '#0f172a'),
  };
  const rarity = typeof item.rarity === 'string' ? item.rarity : '';
  const autoSheen =
    animated && (rarity === 'epic' || rarity === 'legendary' || rarity === 'mythic');
  const glowTier =
    animated && (rarity === 'legendary' || rarity === 'mythic') ? rarity : undefined;

  return (
    <div
      className={`relative w-full overflow-hidden rounded-well border-2 border-ink bg-well ${sizeClass} ${animated ? 'store-mw-anim' : ''}`}
      data-sheen={autoSheen ? 'auto' : undefined}
      data-glow={glowTier}
    >
      {primarySetLabel ? (
        <div className='pointer-events-none absolute left-2 top-2 z-20 inline-flex max-w-[85%] items-center gap-1 rounded-full border border-ink bg-raised px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-strong shadow-chip'>
          <span className='truncate'>{primarySetLabel}</span>
          {extraSetCount > 0 ? <span className='shrink-0'>+{extraSetCount}</span> : null}
        </div>
      ) : null}
      <div className={animated ? 'store-mw-anim-float relative h-full w-full' : 'relative h-full w-full'}>
      {isTypingPreview && typingPreviewSlot ? (
        <TypingGameMiniPreview
          typingPreviewContext={resolvedTypingPreviewContext ?? {}}
          previewSlot={typingPreviewSlot}
          compact={compact}
        />
      ) : isPoolPreview && poolPreviewSlot ? (
        <div className='h-full w-full'>
          <PoolMiniPreview
            assetRef={item.assetRef}
            slot={poolPreviewSlot}
          />
        </div>
      ) : isTetrisPreview && tetrisPreviewSlot ? (
        <div className='h-full w-full'>
          <TetrisMiniPreview
            assetRef={item.assetRef}
            slot={tetrisPreviewSlot}
          />
        </div>
      ) : isFlappyPreview && flappyPreviewSlot ? (
        <div className='h-full w-full'>
          <FlappyMiniPreview
            assetRef={item.assetRef}
            slot={flappyPreviewSlot}
          />
        </div>
      ) : isCoinFlipPreview && coinFlipPreviewSlot ? (
        <div className='h-full w-full'>
          <CoinFlipMiniPreview
            assetRef={item.assetRef}
            slot={coinFlipPreviewSlot}
          />
        </div>
      ) : isGame2048Preview && game2048PreviewSlot ? (
        <div className='h-full w-full'>
          <Game2048MiniPreview
            assetRef={item.assetRef}
            slot={game2048PreviewSlot}
          />
        </div>
      ) : isChessPreview && chessPreviewSlot ? (
        <div className='h-full w-full'>
          <ChessMiniPreview
            assetRef={item.assetRef}
            slot={chessPreviewSlot}
          />
        </div>
      ) : isSnakeBodyPreview ? (
        <div className='h-full w-full'>
          <SnakeBodyCanvasPreview
            assetRef={item.assetRef}
            boardAssetRef={snakeBoardAssetRef}
            align={snakeAlign}
          />
        </div>
      ) : isSnakeBoardPreview ? (
        <div className='h-full w-full'>
          <SnakeBoardCanvasPreview assetRef={item.assetRef} />
        </div>
      ) : isSnakeFoodPreview ? (
        <div className='h-full w-full'>
          <SnakeFoodCanvasPreview
            assetRef={item.assetRef}
            boardAssetRef={snakeBoardAssetRef}
          />
        </div>
      ) : newGamePreview ? (
        <div className='h-full w-full'>{newGamePreview}</div>
      ) : imageUrl ? (
        // Route through next/image so multi‑MB cosmetics are resized for the
        // ~128–256 CSS px store wells (Lighthouse: store was shipping 2–3MB
        // raw PNGs per avatar and tanking LCP / total payload).
        <Image
          src={imageUrl}
          alt={`${item.name} preview`}
          fill
          sizes={
            compact
              ? '(max-width: 640px) 30vw, 6rem'
              : '(max-width: 640px) 45vw, (max-width: 1280px) 20vw, 12rem'
          }
          className='object-cover'
          loading='lazy'
        />
      ) : (
        <div
          className={`h-full w-full ${animated ? 'store-mw-anim-drift' : ''}`}
          style={bgStyle}
        />
      )}
      </div>
      <style
        dangerouslySetInnerHTML={{
          __html: `${typingPreviewKeyframes}
            .typing-preview-hud-pulse {
              animation: typingPreviewHudPulse 1.2s ease-in-out infinite;
            }
          `,
        }}
      />
    </div>
  );
}
