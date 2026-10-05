'use client';

import type { CSSProperties } from 'react';
import {
  type TypingPreviewContext,
  type TypingPreviewSlot,
  buildTypingPreviewTheme,
  typingPreviewKeyframes,
} from './typing-theme';
import { getTypingFontFamilyCss } from './helpers';

export function TypingGameMiniPreview({
  typingPreviewContext,
  previewSlot,
  compact,
}: {
  typingPreviewContext: TypingPreviewContext;
  previewSlot: TypingPreviewSlot;
  compact: boolean;
}) {
  const theme = buildTypingPreviewTheme(typingPreviewContext);
  const showHudPreview = previewSlot === 'theme';
  const showCaretOnlyPreview = previewSlot === 'caret';
  const showFeedbackOnlyPreview = previewSlot === 'feedback';
  const showTextStyleOnlyPreview = previewSlot === 'text-style';
  const showCaretInText = showHudPreview;
  const showFeedbackInText = showHudPreview || showFeedbackOnlyPreview;
  const hudProgressPct = 62;
  const caretGlowPx = Math.round(theme.caretGlowStrength / 6);
  const caretShadow =
    caretGlowPx > 0 ? `0 0 ${caretGlowPx}px ${theme.caretColor}` : 'none';
  const caretPulseAnimation =
    theme.caretPulseMode === 'strong'
      ? 'typingPreviewCaretPulseStrong 0.95s ease-in-out infinite'
      : theme.caretPulseMode === 'soft'
        ? 'typingPreviewCaretPulseSoft 1.3s ease-in-out infinite'
        : undefined;

  const hudFrameClass =
    theme.hudFrameStyle === 'glass'
      ? 'border backdrop-blur-sm'
      : theme.hudFrameStyle === 'terminal'
        ? 'border border-dashed'
        : theme.hudFrameStyle === 'neon'
          ? 'border-2'
          : 'border';
  const hudFrameStyle =
    theme.hudFrameStyle === 'neon'
      ? {
          backgroundColor: theme.hudSurfaceColor,
          borderColor: theme.hudAccentColor,
          boxShadow: `0 0 ${Math.round(theme.hudShadowStrength / 2)}px ${theme.hudAccentColor}, 0 0 ${Math.round(theme.hudShadowStrength / 4)}px ${theme.hudAccentColor} inset`,
        }
      : theme.hudFrameStyle === 'terminal'
        ? {
            backgroundColor: theme.hudSurfaceColor,
            borderColor: theme.hudBorderColor,
            backgroundImage:
              'repeating-linear-gradient(0deg, rgba(255,255,255,0.03) 0px, rgba(255,255,255,0.03) 1px, transparent 1px, transparent 3px)',
            boxShadow: `inset 0 0 ${Math.round(theme.hudShadowStrength / 4)}px ${theme.hudAccentColor}44`,
          }
        : theme.hudFrameStyle === 'glass'
          ? {
              background: `linear-gradient(135deg, ${theme.hudSurfaceColor}ee, ${theme.hudSurfaceColor}aa)`,
              borderColor: theme.hudBorderColor,
              boxShadow: `0 8px 24px ${theme.hudAccentColor}22`,
            }
          : {
              backgroundColor: theme.hudSurfaceColor,
              borderColor: theme.hudBorderColor,
              boxShadow: `0 0 ${Math.round(theme.hudShadowStrength / 8)}px ${theme.hudAccentColor}44`,
            };


  const currentWordStyle =
    theme.textCurrentWordStyle === 'underline'
      ? {
          borderBottom: `2px solid ${theme.textCurrentWordColor}`,
        }
      : theme.textCurrentWordStyle === 'box'
        ? {
            borderRadius: '0.3rem',
            paddingInline: '0.15rem',
            backgroundColor: `${theme.textCurrentWordColor}${Math.round(
              Math.max(0.08, Math.min(0.7, theme.textCurrentWordStrength / 100)) * 255,
            )
              .toString(16)
              .padStart(2, '0')}`,
          }
        : theme.textCurrentWordStyle === 'glow'
          ? {
              textShadow: `0 0 ${Math.round(theme.textCurrentWordStrength / 8) + 4}px ${theme.textCurrentWordColor}`,
            }
          : undefined;

  const feedbackEffectStyle =
    theme.feedbackStyle === 'underline'
      ? {
          borderBottom: `2px solid ${theme.missEffectColor}`,
        }
      : theme.feedbackStyle === 'shake'
        ? {
            display: 'inline-block',
            animation: `typingFeedbackShake ${Math.max(80, theme.feedbackDurationMs)}ms ease-in-out infinite`,
            ['--typing-feedback-shake-distance' as string]:
              `${1 + Math.round(theme.feedbackStrength / 30)}px`,
          }
        : theme.feedbackStyle === 'flash'
          ? {
              display: 'inline-block',
              animation: `typingFeedbackFlash ${Math.max(80, theme.feedbackDurationMs)}ms ease-in-out infinite`,
            }
          : theme.feedbackStyle === 'particles'
            ? {
                display: 'inline-block',
                textShadow: `0 0 ${4 + Math.round(theme.feedbackStrength / 6)}px ${theme.missEffectColor}, 0 0 ${8 + Math.round(theme.feedbackStrength / 4)}px ${theme.missEffectColor}`,
                animation: theme.feedbackParticlesEnabled
                  ? `typingFeedbackParticlePulse ${Math.max(80, theme.feedbackDurationMs)}ms ease-in-out infinite`
                  : undefined,
              }
            : undefined;

  const renderCaretPreview = (variant: 'inline' | 'large' = 'inline') => {
    const isLarge = variant === 'large';
    const height = isLarge ? (compact ? 28 : 46) : compact ? 12 : 14;
    const thickness = isLarge
      ? Math.max(2, Math.round(theme.caretThickness * 1.8))
      : Math.max(1, theme.caretThickness);
    const blockWidth = isLarge ? (compact ? 14 : 24) : compact ? 7 : 9;
    const underlineWidth = isLarge ? (compact ? 48 : 86) : undefined;
    const containerStyle: CSSProperties = {
      position: 'relative',
      display: 'inline-flex',
      alignItems: 'flex-end',
      justifyContent: 'center',
      height,
      width: underlineWidth,
      marginInline: isLarge ? 0 : 1,
    };
    const baseStyle: CSSProperties =
      theme.caretType === 'underline'
        ? {
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: -1,
            height: thickness,
            borderRadius: 9999,
            backgroundColor: theme.caretColor,
            boxShadow: caretShadow,
            animation: caretPulseAnimation,
          }
        : theme.caretType === 'block'
          ? {
              width: blockWidth,
              height,
              borderRadius: 2,
              backgroundColor: theme.caretColor,
              boxShadow: caretShadow,
              opacity: 0.45,
              animation: caretPulseAnimation,
            }
          : {
              width: thickness,
              height,
              borderRadius: 9999,
              backgroundColor: theme.caretColor,
              boxShadow: caretShadow,
              animation: caretPulseAnimation,
            };
    return (
      <span style={containerStyle}>
        {theme.caretTrailEnabled ? (
          <span
            style={{
              ...baseStyle,
              position: 'absolute',
              left: isLarge ? -3 : -1,
              opacity: 0.35,
              filter: isLarge ? 'blur(1.5px)' : 'blur(1px)',
            }}
          />
        ) : null}
        <span style={baseStyle} />
      </span>
    );
  };

  return (
    <div
      className={`h-full w-full p-1.5 ${showHudPreview ? 'flex flex-col justify-center gap-1' : ''}`}
      style={{ backgroundColor: theme.panelBg }}
    >
      <style>{typingPreviewKeyframes}</style>
      {showHudPreview ? (
        <div
          className={`rounded-md px-2 py-1 ${hudFrameClass}`}
          style={{
            ...hudFrameStyle,
            fontFamily: getTypingFontFamilyCss(theme.textFontFamily),
            fontWeight: theme.textFontWeight,
          }}
        >
          <div className='flex items-center justify-between gap-2 text-[9px]'>
            <span style={{ color: theme.hudAccentColor }}>30</span>
            <span style={{ color: theme.hudTextColor }}>- wpm</span>
            <span style={{ color: theme.hudTextColor }}>- acc</span>
          </div>
          {theme.hudMeterStyle !== 'none' ? (
            <div className='mt-1 flex items-center justify-center'>
              {theme.hudMeterStyle === 'ring' ? (
                <svg width='16' height='16' viewBox='0 0 36 36'>
                  <circle
                    cx='18'
                    cy='18'
                    r='15'
                    fill='none'
                    stroke={`${theme.hudTextColor}33`}
                    strokeWidth='4'
                  />
                  <circle
                    cx='18'
                    cy='18'
                    r='15'
                    fill='none'
                    stroke={theme.hudAccentColor}
                    strokeWidth='4'
                    strokeDasharray={`${(hudProgressPct / 100) * 94.2} 94.2`}
                    transform='rotate(-90 18 18)'
                    strokeLinecap='round'
                  />
                </svg>
              ) : (
                <div className='h-1.5 w-full overflow-hidden rounded-full bg-well'>
                  <div
                    className={theme.hudMeterStyle === 'pulse' ? 'typing-preview-hud-pulse' : ''}
                    style={{
                      width: `${hudProgressPct}%`,
                      height: '100%',
                      backgroundColor: theme.hudAccentColor,
                      color: theme.hudAccentColor,
                    }}
                  />
                </div>
              )}
            </div>
          ) : null}
        </div>
      ) : null}
      {showCaretOnlyPreview ? (
        <div
          className='h-full rounded-md border px-2 py-1'
          style={{
            borderColor: theme.panelBorder,
            backgroundColor: `${theme.panelBg}cc`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <div
            className='flex items-center justify-center rounded-md border px-5 py-4'
            style={{
              borderColor: theme.panelBorder,
              backgroundColor: `${theme.hudSurfaceColor}88`,
            }}
          >
            {renderCaretPreview('large')}
          </div>
        </div>
      ) : (
      <div
        className={`${showHudPreview ? '' : 'h-full'} rounded-md border px-2 py-1`}
        style={{
          borderColor: theme.panelBorder,
          backgroundColor: `${theme.panelBg}cc`,
          display: showHudPreview ? undefined : 'flex',
          alignItems: showHudPreview ? undefined : 'center',
          justifyContent: showHudPreview ? undefined : 'center',
        }}
      >
        <div
          className={
            showTextStyleOnlyPreview
              ? 'flex flex-wrap items-center justify-center gap-x-2 leading-relaxed text-center text-[14px]'
              : showHudPreview
                ? 'flex flex-wrap items-center justify-center gap-x-1 leading-tight text-center text-[11px]'
              : 'flex flex-wrap items-center gap-x-1 leading-tight text-[11px]'
          }
          style={{
            color: theme.textColor,
            fontFamily: getTypingFontFamilyCss(theme.textFontFamily),
            fontWeight: theme.textFontWeight,
            letterSpacing: `${theme.textLetterSpacing}px`,
          }}
        >
          <span style={{ color: theme.correctColor }}>focus</span>
          <span style={currentWordStyle}>
            <span style={{ color: theme.correctColor }}>wo</span>
            {showCaretInText ? renderCaretPreview() : null}
            <span
              style={{
                color: theme.errorColor,
                ...(showFeedbackInText ? feedbackEffectStyle : undefined),
              }}
            >
              r
            </span>
            <span>d</span>
          </span>
          <span>speed</span>
        </div>
      </div>
      )}
    </div>
  );
}
