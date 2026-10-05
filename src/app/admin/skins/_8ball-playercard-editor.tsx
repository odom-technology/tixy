'use client';

import { useEffect, useMemo, useState } from 'react';
import { InfoHint } from './_components';
import type { ItemDraft, EightBallPlayercardDraft } from './_types';
import { EIGHT_BALL_CARD_ANIMATIONS } from './_types';
import {
  DEFAULT_PLAYERCARD_THEME,
  getPlayercardAnimationStyle,
  getPlayercardAnimationStylesheet,
} from '@/features/arcade/lib/pool-playercard-theme';

type BackgroundMode = 'gradient' | 'solid';

type BackgroundControls = {
  mode: BackgroundMode;
  solidColor: string;
  gradientStart: string;
  gradientEnd: string;
  gradientAngle: number;
};

const DEFAULT_BACKGROUND_CONTROLS: BackgroundControls = {
  mode: 'gradient',
  solidColor: '#1e1e28',
  gradientStart: '#1e1e28',
  gradientEnd: '#14141e',
  gradientAngle: 135,
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function toHexChannel(value: number): string {
  return Math.round(clamp(value, 0, 255)).toString(16).padStart(2, '0');
}

function splitCssArguments(value: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let chunk = '';

  for (const char of value) {
    if (char === '(') depth += 1;
    if (char === ')' && depth > 0) depth -= 1;

    if (char === ',' && depth === 0) {
      const trimmed = chunk.trim();
      if (trimmed.length > 0) parts.push(trimmed);
      chunk = '';
      continue;
    }

    chunk += char;
  }

  const trailing = chunk.trim();
  if (trailing.length > 0) parts.push(trailing);
  return parts;
}

function extractFirstColorToken(value: string): string | null {
  const match = value.match(/#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b|rgba?\([^)]*\)/);
  return match ? match[0] : null;
}

function normalizeHexColor(value: string, fallback: string): string {
  const trimmed = value.trim();

  const shortHex = trimmed.match(/^#([0-9a-fA-F]{3})$/);
  if (shortHex) {
    const [r, g, b] = shortHex[1].split('');
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }

  const shortHexAlpha = trimmed.match(/^#([0-9a-fA-F]{4})$/);
  if (shortHexAlpha) {
    const [r, g, b] = shortHexAlpha[1].split('');
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }

  const longHex = trimmed.match(/^#([0-9a-fA-F]{6})$/);
  if (longHex) {
    return `#${longHex[1]}`.toLowerCase();
  }

  const longHexAlpha = trimmed.match(/^#([0-9a-fA-F]{8})$/);
  if (longHexAlpha) {
    return `#${longHexAlpha[1].slice(0, 6)}`.toLowerCase();
  }

  const rgb = trimmed.match(/^rgba?\(([^)]+)\)$/i);
  if (rgb) {
    const channels = rgb[1].split(',').map((part) => Number.parseFloat(part.trim()));
    if (channels.length >= 3 && channels.slice(0, 3).every((channel) => Number.isFinite(channel))) {
      return `#${toHexChannel(channels[0] ?? 0)}${toHexChannel(channels[1] ?? 0)}${toHexChannel(channels[2] ?? 0)}`;
    }
  }

  return fallback;
}

function parseOpacityPercent(colorValue: string, fallback = 100): number {
  const trimmed = colorValue.trim();

  const shortHexAlpha = trimmed.match(/^#([0-9a-fA-F]{4})$/);
  if (shortHexAlpha) {
    const alphaNibble = Number.parseInt(shortHexAlpha[1][3] ?? 'f', 16);
    return Math.round((alphaNibble / 15) * 100);
  }

  const longHexAlpha = trimmed.match(/^#([0-9a-fA-F]{8})$/);
  if (longHexAlpha) {
    const alphaByte = Number.parseInt(longHexAlpha[1].slice(6, 8), 16);
    return Math.round((alphaByte / 255) * 100);
  }

  const rgba = trimmed.match(/^rgba\(([^)]+)\)$/i);
  if (rgba) {
    const parts = rgba[1].split(',').map((part) => part.trim());
    const alphaRaw = Number.parseFloat(parts[3] ?? '1');
    if (Number.isFinite(alphaRaw)) {
      const alphaNormalized = alphaRaw > 1 ? alphaRaw / 100 : alphaRaw;
      return Math.round(clamp(alphaNormalized, 0, 1) * 100);
    }
  }

  return clamp(Math.round(fallback), 0, 100);
}

function formatRgbaColor(hexColor: string, opacityPercent: number): string {
  const hex = normalizeHexColor(hexColor, '#ffffff').slice(1);
  const red = Number.parseInt(hex.slice(0, 2), 16);
  const green = Number.parseInt(hex.slice(2, 4), 16);
  const blue = Number.parseInt(hex.slice(4, 6), 16);
  const alpha = clamp(opacityPercent, 0, 100) / 100;
  const alphaText = alpha.toFixed(2).replace(/\.?0+$/, '');
  return `rgba(${red},${green},${blue},${alphaText})`;
}

function parseBackgroundControls(cardBg: string): BackgroundControls {
  const trimmed = cardBg.trim();
  const fallback = DEFAULT_BACKGROUND_CONTROLS;

  if (trimmed.toLowerCase().startsWith('linear-gradient(') && trimmed.endsWith(')')) {
    const inner = trimmed.slice(trimmed.indexOf('(') + 1, -1);
    const args = splitCssArguments(inner);

    let angle = fallback.gradientAngle;
    let stopArgs = args;

    if (args[0] && /deg/i.test(args[0])) {
      const parsedAngle = Number.parseFloat(args[0]);
      if (Number.isFinite(parsedAngle)) angle = clamp(Math.round(parsedAngle), 0, 360);
      stopArgs = args.slice(1);
    }

    const colorTokens = stopArgs
      .map((stop) => extractFirstColorToken(stop))
      .filter((token): token is string => typeof token === 'string');

    const start = normalizeHexColor(colorTokens[0] ?? fallback.gradientStart, fallback.gradientStart);
    const end = normalizeHexColor(colorTokens[1] ?? colorTokens[0] ?? fallback.gradientEnd, fallback.gradientEnd);

    return {
      mode: 'gradient',
      solidColor: start,
      gradientStart: start,
      gradientEnd: end,
      gradientAngle: angle,
    };
  }

  const colorToken = extractFirstColorToken(trimmed) ?? trimmed;
  const solidColor = normalizeHexColor(colorToken, fallback.solidColor);

  return {
    mode: 'solid',
    solidColor,
    gradientStart: solidColor,
    gradientEnd: fallback.gradientEnd,
    gradientAngle: fallback.gradientAngle,
  };
}

function formatBackgroundValue(controls: BackgroundControls): string {
  if (controls.mode === 'solid') {
    return controls.solidColor;
  }
  return `linear-gradient(${clamp(Math.round(controls.gradientAngle), 0, 360)}deg, ${controls.gradientStart} 0%, ${controls.gradientEnd} 100%)`;
}

function ColorPickerInput({
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
        <span className='inline-flex h-8 flex-1 items-center rounded border border-soft bg-background px-2 font-mono text-[11px] uppercase text-faint'>
          {value}
        </span>
      </div>
    </label>
  );
}

const ANIMATION_LABELS: Record<string, string> = {
  none: 'None',
  shimmer: 'Shimmer',
  'gradient-shift': 'Gradient Shift',
  'glow-pulse': 'Glow Pulse',
  aurora: 'Aurora',
  'fire-edge': 'Fire Edge',
  holographic: 'Holographic',
};

const PRESETS: { id: string; label: string; draft: EightBallPlayercardDraft }[] = [
  {
    id: 'default',
    label: 'Default',
    draft: {
      cardBg: 'linear-gradient(135deg, rgba(30,30,40,0.95), rgba(20,20,30,0.95))',
      cardAnimation: 'none',
      cardBorder: 'rgba(255,255,255,0.1)',
      nameColor: '#ffffff',
      eloColor: '#9ca3af',
      animationPrimaryColor: DEFAULT_PLAYERCARD_THEME.animationPrimaryColor,
      animationSecondaryColor: DEFAULT_PLAYERCARD_THEME.animationSecondaryColor,
    },
  },
  {
    id: 'emerald',
    label: 'Emerald',
    draft: {
      cardBg: 'linear-gradient(135deg, #0f3d1a 0%, #1a5c2e 50%, #0d2e14 100%)',
      cardAnimation: 'none',
      cardBorder: '#22c55e40',
      nameColor: '#86efac',
      eloColor: '#4ade80',
      animationPrimaryColor: '#4ade80',
      animationSecondaryColor: '#22d3ee',
    },
  },
  {
    id: 'royal',
    label: 'Royal Gold',
    draft: {
      cardBg: 'linear-gradient(135deg, #3d2800 0%, #5c3d0a 50%, #2e1f00 100%)',
      cardAnimation: 'glow-pulse',
      cardBorder: '#eab30840',
      nameColor: '#fde68a',
      eloColor: '#f59e0b',
      animationPrimaryColor: '#fbbf24',
      animationSecondaryColor: '#f97316',
    },
  },
  {
    id: 'fire',
    label: 'Fire',
    draft: {
      cardBg: 'linear-gradient(135deg, #3d0011 0%, #6b0020 30%, #1a0008 100%)',
      cardAnimation: 'fire-edge',
      cardBorder: '#ef444460',
      nameColor: '#fca5a5',
      eloColor: '#ef4444',
      animationPrimaryColor: '#fb7185',
      animationSecondaryColor: '#f97316',
    },
  },
  {
    id: 'holographic',
    label: 'Holographic',
    draft: {
      cardBg: 'linear-gradient(135deg, #1e1b4b 0%, #312e81 30%, #1e1b4b 60%, #4c1d95 100%)',
      cardAnimation: 'holographic',
      cardBorder: '#a78bfa50',
      nameColor: '#e0e7ff',
      eloColor: '#a78bfa',
      animationPrimaryColor: '#a78bfa',
      animationSecondaryColor: '#38bdf8',
    },
  },
  {
    id: 'aurora',
    label: 'Aurora',
    draft: {
      cardBg: 'linear-gradient(135deg, #042f2e 0%, #134e4a 30%, #0f766e 60%, #042f2e 100%)',
      cardAnimation: 'aurora',
      cardBorder: '#2dd4bf40',
      nameColor: '#99f6e4',
      eloColor: '#2dd4bf',
      animationPrimaryColor: '#2dd4bf',
      animationSecondaryColor: '#67e8f9',
    },
  },
];

function PlayercardPreview({ draft }: { draft: EightBallPlayercardDraft }) {
  const anim = draft.cardAnimation !== 'none' ? draft.cardAnimation : null;
  return (
    <>
      {anim && (
        <style dangerouslySetInnerHTML={{ __html: getPlayercardAnimationStylesheet('pc-prev') }} />
      )}
      <div
        className='relative flex items-center gap-2.5 rounded-xl px-3 py-2.5 overflow-hidden'
        style={{
          background: draft.cardBg,
          border: `1.5px solid ${draft.cardBorder}`,
          ...getPlayercardAnimationStyle(draft, { prefix: 'pc-prev' }),
        }}
      >
        <div className='shrink-0 h-10 w-10 rounded-full bg-slate-600/50 flex items-center justify-center text-xs text-slate-300'>
          P1
        </div>

        <div className='flex-1 min-w-0'>
          <div className='flex items-center gap-1.5'>
            <p className='font-semibold text-sm truncate' style={{ color: draft.nameColor }}>
              Player Name
            </p>
            <span className='text-[11px] font-medium shrink-0' style={{ color: draft.eloColor }}>
              1250
            </span>
          </div>
          <div className='flex items-center gap-1.5 mt-0.5'>
            <span className='text-[10px] font-medium opacity-70' style={{ color: draft.eloColor }}>
              Silver
            </span>
            <span
              className='text-xs font-bold tracking-wide'
              style={{
                color: '#ffffff',
                textShadow: '-1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000',
              }}
            >
              Solids
            </span>
          </div>
        </div>
      </div>
    </>
  );
}

export function EightBallPlayercardEditor({
  itemDraft,
  eightBallPlayercardDraft,
  setEightBallPlayercardDraft,
}: {
  itemDraft: ItemDraft;
  eightBallPlayercardDraft: EightBallPlayercardDraft;
  setEightBallPlayercardDraft: React.Dispatch<React.SetStateAction<EightBallPlayercardDraft>>;
}) {
  const [backgroundControls, setBackgroundControls] = useState<BackgroundControls>(() =>
    parseBackgroundControls(eightBallPlayercardDraft.cardBg),
  );
  const [borderColor, setBorderColor] = useState(() =>
    normalizeHexColor(eightBallPlayercardDraft.cardBorder, '#ffffff'),
  );
  const [borderOpacity, setBorderOpacity] = useState(() =>
    parseOpacityPercent(eightBallPlayercardDraft.cardBorder, 100),
  );

  useEffect(() => {
    setBackgroundControls(parseBackgroundControls(eightBallPlayercardDraft.cardBg));
  }, [eightBallPlayercardDraft.cardBg]);

  useEffect(() => {
    setBorderColor(normalizeHexColor(eightBallPlayercardDraft.cardBorder, '#ffffff'));
    setBorderOpacity(parseOpacityPercent(eightBallPlayercardDraft.cardBorder, 100));
  }, [eightBallPlayercardDraft.cardBorder]);

  const checklist = useMemo(
    () => [
      { label: 'Item name set', ok: itemDraft.name.trim().length > 0 },
      { label: 'Slot assigned', ok: itemDraft.slots.length > 0 },
      { label: 'Background set', ok: eightBallPlayercardDraft.cardBg.trim().length > 0 },
    ],
    [itemDraft.name, itemDraft.slots.length, eightBallPlayercardDraft.cardBg],
  );

  const applyBackgroundControls = (next: BackgroundControls) => {
    setBackgroundControls(next);
    setEightBallPlayercardDraft((prev) => ({
      ...prev,
      cardBg: formatBackgroundValue(next),
    }));
  };

  const applyBorder = (nextColor: string, nextOpacity: number) => {
    const normalizedColor = normalizeHexColor(nextColor, '#ffffff');
    const normalizedOpacity = clamp(Math.round(nextOpacity), 0, 100);
    setBorderColor(normalizedColor);
    setBorderOpacity(normalizedOpacity);
    setEightBallPlayercardDraft((prev) => ({
      ...prev,
      cardBorder: formatRgbaColor(normalizedColor, normalizedOpacity),
    }));
  };

  return (
    <div className='space-y-4 rounded-xl border border-soft bg-raised p-4'>
      <div>
        <p className='text-sm font-semibold'>8-Ball - Player Card Editor</p>
        <p className='text-xs text-faint'>
          Customize the player card background, animation, and text colors.
        </p>
      </div>

      <div className='grid gap-4 xl:grid-cols-[1fr_1.3fr]'>
        <aside className='space-y-3'>
          <section className='rounded-lg border border-soft bg-slate-950/45 p-3 space-y-3'>
            <p className='text-[11px] uppercase tracking-wide text-faint'>Live Preview</p>
            <PlayercardPreview draft={eightBallPlayercardDraft} />
          </section>

          <section className='rounded-lg border border-soft bg-well p-3 space-y-2'>
            <p className='text-[11px] uppercase tracking-wide text-faint'>Quick Presets</p>
            <div className='grid grid-cols-2 gap-2'>
              {PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type='button'
                  className='rounded-tag border border-soft bg-raised px-2 py-1.5 text-xs text-body shadow-chip transition-[filter] duration-[140ms] hover:brightness-110'
                  onClick={() => setEightBallPlayercardDraft({ ...preset.draft })}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </section>
        </aside>

        <div className='space-y-3'>
          <section className='arcade-card-inset p-3 space-y-3'>
            <p className='text-xs font-semibold uppercase tracking-wide text-faint'>Background</p>

            <label className='text-xs space-y-1'>
              <span className='inline-flex items-center'>
                Fill Type
                <InfoHint text='Use pickers to build either a solid background or a two-color gradient.' />
              </span>
              <select
                className='h-8 w-full rounded border border-soft bg-background px-2 text-xs'
                value={backgroundControls.mode}
                onChange={(event) =>
                  applyBackgroundControls({
                    ...backgroundControls,
                    mode: event.target.value as BackgroundMode,
                  })
                }
              >
                <option value='gradient'>Gradient</option>
                <option value='solid'>Solid</option>
              </select>
            </label>

            {backgroundControls.mode === 'solid' ? (
              <ColorPickerInput
                label='Solid Color'
                value={backgroundControls.solidColor}
                onChange={(nextColor) =>
                  applyBackgroundControls({
                    ...backgroundControls,
                    solidColor: normalizeHexColor(nextColor, backgroundControls.solidColor),
                  })
                }
                hint='Background fill for the entire card.'
              />
            ) : (
              <div className='grid grid-cols-1 gap-3 sm:grid-cols-2'>
                <ColorPickerInput
                  label='Gradient Start'
                  value={backgroundControls.gradientStart}
                  onChange={(nextColor) =>
                    applyBackgroundControls({
                      ...backgroundControls,
                      gradientStart: normalizeHexColor(nextColor, backgroundControls.gradientStart),
                    })
                  }
                />
                <ColorPickerInput
                  label='Gradient End'
                  value={backgroundControls.gradientEnd}
                  onChange={(nextColor) =>
                    applyBackgroundControls({
                      ...backgroundControls,
                      gradientEnd: normalizeHexColor(nextColor, backgroundControls.gradientEnd),
                    })
                  }
                />
                <label className='text-xs space-y-1 sm:col-span-2'>
                  <span className='inline-flex items-center'>
                    Gradient Angle: {backgroundControls.gradientAngle}deg
                    <InfoHint text='Controls gradient direction from 0 to 360 degrees.' />
                  </span>
                  <input
                    type='range'
                    min={0}
                    max={360}
                    step={1}
                    value={backgroundControls.gradientAngle}
                    onChange={(event) =>
                      applyBackgroundControls({
                        ...backgroundControls,
                        gradientAngle: clamp(Number.parseInt(event.target.value, 10) || 0, 0, 360),
                      })
                    }
                    className='w-full accent-[var(--enamel-info)]'
                  />
                </label>
              </div>
            )}

            <div className='rounded border border-soft bg-well px-2 py-1.5 font-mono text-[10px] text-faint break-all'>
              {eightBallPlayercardDraft.cardBg}
            </div>
          </section>

          <section className='arcade-card-inset p-3 space-y-3'>
            <p className='text-xs font-semibold uppercase tracking-wide text-faint'>Animation</p>
            <label className='text-xs space-y-1'>
              <span>Card Animation</span>
              <select
                className='h-8 w-full rounded border border-soft bg-background px-2 text-xs'
                value={eightBallPlayercardDraft.cardAnimation}
                onChange={(event) =>
                  setEightBallPlayercardDraft((prev) => ({
                    ...prev,
                    cardAnimation: event.target.value as EightBallPlayercardDraft['cardAnimation'],
                  }))
                }
              >
                {EIGHT_BALL_CARD_ANIMATIONS.map((anim) => (
                  <option key={anim} value={anim}>
                    {ANIMATION_LABELS[anim] ?? anim}
                  </option>
                ))}
              </select>
            </label>
            <div className='grid grid-cols-1 gap-3 sm:grid-cols-2'>
              <ColorPickerInput
                label='Animation Primary'
                value={normalizeHexColor(
                  eightBallPlayercardDraft.animationPrimaryColor,
                  DEFAULT_PLAYERCARD_THEME.animationPrimaryColor,
                )}
                onChange={(nextColor) =>
                  setEightBallPlayercardDraft((prev) => ({
                    ...prev,
                    animationPrimaryColor: normalizeHexColor(
                      nextColor,
                      DEFAULT_PLAYERCARD_THEME.animationPrimaryColor,
                    ),
                  }))
                }
                hint='Main glow/shadow tint used by card animations.'
              />
              <ColorPickerInput
                label='Animation Secondary'
                value={normalizeHexColor(
                  eightBallPlayercardDraft.animationSecondaryColor,
                  DEFAULT_PLAYERCARD_THEME.animationSecondaryColor,
                )}
                onChange={(nextColor) =>
                  setEightBallPlayercardDraft((prev) => ({
                    ...prev,
                    animationSecondaryColor: normalizeHexColor(
                      nextColor,
                      DEFAULT_PLAYERCARD_THEME.animationSecondaryColor,
                    ),
                  }))
                }
                hint='Secondary accent used in pulse/fire/holo effects.'
              />
            </div>
            {eightBallPlayercardDraft.cardAnimation === 'none' ? (
              <p className='text-[11px] text-faint'>
                Animation colors are saved now and applied whenever a card animation is enabled.
              </p>
            ) : null}
          </section>

          <section className='arcade-card-inset p-3 space-y-3'>
            <p className='text-xs font-semibold uppercase tracking-wide text-faint'>Colors</p>
            <div className='grid grid-cols-1 gap-3 sm:grid-cols-2'>
              <ColorPickerInput
                label='Border Color'
                value={borderColor}
                onChange={(nextColor) => applyBorder(nextColor, borderOpacity)}
                hint='Card border tint.'
              />
              <label className='text-xs space-y-1'>
                <span className='inline-flex items-center'>
                  Border Opacity: {borderOpacity}%
                  <InfoHint text='Keeps subtle translucent borders without typing rgba values.' />
                </span>
                <input
                  type='range'
                  min={0}
                  max={100}
                  step={1}
                  value={borderOpacity}
                  onChange={(event) => applyBorder(borderColor, Number.parseInt(event.target.value, 10) || 0)}
                  className='w-full accent-[var(--enamel-info)]'
                />
              </label>
              <ColorPickerInput
                label='Name Color'
                value={normalizeHexColor(eightBallPlayercardDraft.nameColor, '#ffffff')}
                onChange={(nextColor) =>
                  setEightBallPlayercardDraft((prev) => ({
                    ...prev,
                    nameColor: normalizeHexColor(nextColor, '#ffffff'),
                  }))
                }
                hint='Player name text color.'
              />
              <ColorPickerInput
                label='Elo Color'
                value={normalizeHexColor(eightBallPlayercardDraft.eloColor, '#9ca3af')}
                onChange={(nextColor) =>
                  setEightBallPlayercardDraft((prev) => ({
                    ...prev,
                    eloColor: normalizeHexColor(nextColor, '#9ca3af'),
                  }))
                }
                hint='Elo rating and tier text color.'
              />
            </div>
          </section>

          <section className='arcade-card-inset p-3 space-y-2'>
            <p className='text-xs font-semibold uppercase tracking-wide text-faint'>Validation</p>
            <div className='grid gap-1 text-xs'>
              {checklist.map((item) => (
                <div key={item.label} className={item.ok ? 'text-prize-text' : 'text-danger-text'}>
                  {item.ok ? 'OK' : 'Missing'} - {item.label}
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
