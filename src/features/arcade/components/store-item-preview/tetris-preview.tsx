'use client';

import { readBool, readNum, readStr } from './helpers';

// Minimal tetromino shapes (for preview only)
const PREVIEW_SHAPES = {
  I: [[0, 0, 0, 0], [1, 1, 1, 1], [0, 0, 0, 0], [0, 0, 0, 0]],
  O: [[1, 1], [1, 1]],
  T: [[0, 1, 0], [1, 1, 1], [0, 0, 0]],
  S: [[0, 1, 1], [1, 1, 0], [0, 0, 0]],
  Z: [[1, 1, 0], [0, 1, 1], [0, 0, 0]],
  J: [[1, 0, 0], [1, 1, 1], [0, 0, 0]],
  L: [[0, 0, 1], [1, 1, 1], [0, 0, 0]],
} as const;

const DEFAULT_COLORS = {
  I: '#00f0f0',
  O: '#f0f000',
  T: '#a000f0',
  S: '#00f000',
  Z: '#f00000',
  J: '#0000f0',
  L: '#f0a000',
};

export function resolveTetrisPreviewSlot(slots: string[]): string | null {
  const priority = ['blocks', 'board', 'effects', 'ghost'];
  for (const s of priority) {
    if (slots.includes(s)) return s;
  }
  return null;
}

type Shading = 'flat' | 'bevel' | 'gradient' | 'neon';

function renderBlock(
  color: string,
  shading: Shading,
  highlightColor: string,
  highlightIntensity: number,
  borderColor: string,
  borderWidth: number,
  glowColor: string,
  glowEnabled: boolean,
  glowSize: number,
  size: number,
  key: string,
  x: number,
  y: number,
) {
  const style: React.CSSProperties = {
    position: 'absolute',
    left: x,
    top: y,
    width: size,
    height: size,
    background: color,
    border: borderWidth > 0 ? `${borderWidth}px solid ${borderColor}` : undefined,
    boxShadow:
      glowEnabled && glowSize > 0
        ? `0 0 ${Math.max(4, (glowSize / 100) * 12)}px ${glowColor}`
        : undefined,
  };
  if (shading === 'gradient') {
    style.background = `linear-gradient(135deg, ${highlightColor}, ${color})`;
  } else if (shading === 'neon') {
    style.background = color;
    style.boxShadow = `0 0 ${Math.max(6, (glowSize / 100) * 16)}px ${glowColor}, inset 0 0 4px ${highlightColor}`;
  }
  return (
    <div key={key} style={style}>
      {shading === 'bevel' ? (
        <>
          <div
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              height: Math.max(1, Math.round(size * 0.2)),
              background: highlightColor,
              opacity: highlightIntensity / 100,
            }}
          />
          <div
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              bottom: 0,
              width: Math.max(1, Math.round(size * 0.2)),
              background: highlightColor,
              opacity: highlightIntensity / 100,
            }}
          />
        </>
      ) : null}
    </div>
  );
}

function BlocksPreview({ assetRef }: { assetRef: Record<string, unknown> | null }) {
  const colors = {
    I: readStr(assetRef, 'colorI', DEFAULT_COLORS.I),
    O: readStr(assetRef, 'colorO', DEFAULT_COLORS.O),
    T: readStr(assetRef, 'colorT', DEFAULT_COLORS.T),
    S: readStr(assetRef, 'colorS', DEFAULT_COLORS.S),
    Z: readStr(assetRef, 'colorZ', DEFAULT_COLORS.Z),
    J: readStr(assetRef, 'colorJ', DEFAULT_COLORS.J),
    L: readStr(assetRef, 'colorL', DEFAULT_COLORS.L),
  };
  const shading = (readStr(assetRef, 'blockShading', 'bevel') as Shading);
  const highlightColor = readStr(assetRef, 'highlightColor', '#ffffff');
  const highlightIntensity = readNum(assetRef, 'highlightIntensity', 15, 0, 100);
  const borderColor = readStr(assetRef, 'borderColor', '#000000');
  const borderWidth = readNum(assetRef, 'borderWidth', 0, 0, 4);
  const glowEnabled = readBool(assetRef, 'blockGlowEnabled', false);
  const glowColor = readStr(assetRef, 'blockGlowColor', '#ffffff');
  const glowSize = readNum(assetRef, 'blockGlowSize', 40, 0, 100);

  const cell = 14;
  const gap = 16;

  // Row 1: I, O, T, S
  // Row 2: Z, J, L
  const row1: Array<{ type: keyof typeof PREVIEW_SHAPES; cols: number }> = [
    { type: 'I', cols: 4 },
    { type: 'O', cols: 2 },
    { type: 'T', cols: 3 },
    { type: 'S', cols: 3 },
  ];
  const row2: Array<{ type: keyof typeof PREVIEW_SHAPES; cols: number }> = [
    { type: 'Z', cols: 3 },
    { type: 'J', cols: 3 },
    { type: 'L', cols: 3 },
  ];

  const renderRow = (
    row: typeof row1,
    yOffset: number,
    xStart: number,
  ) => {
    const blocks: React.ReactNode[] = [];
    let x = xStart;
    for (const { type, cols } of row) {
      const shape = PREVIEW_SHAPES[type];
      for (let r = 0; r < shape.length; r++) {
        for (let c = 0; c < shape[r].length; c++) {
          if (!shape[r][c]) continue;
          blocks.push(
            renderBlock(
              colors[type],
              shading,
              highlightColor,
              highlightIntensity,
              borderColor,
              borderWidth,
              glowColor,
              glowEnabled,
              glowSize,
              cell,
              `${type}-${r}-${c}`,
              x + c * cell,
              yOffset + r * cell,
            ),
          );
        }
      }
      x += cols * cell + gap;
    }
    return blocks;
  };

  return (
    <div
      className='relative h-full w-full overflow-hidden rounded-lg'
      style={{ background: 'linear-gradient(135deg, #0a0a14, #101028)' }}
    >
      {renderRow(row1, 30, 12)}
      {renderRow(row2, 90, 30)}
    </div>
  );
}

function BoardPreview({ assetRef }: { assetRef: Record<string, unknown> | null }) {
  const bgMode = readStr(assetRef, 'boardBgMode', 'solid');
  const bgStart = readStr(assetRef, 'boardBgStart', '#0a0a14');
  const bgEnd = readStr(assetRef, 'boardBgEnd', '#101028');
  const gridColor = readStr(assetRef, 'gridLineColor', '#ffffff');
  const gridWidth = readNum(assetRef, 'gridLineWidth', 1, 0, 4);
  const gridVisible = readBool(assetRef, 'gridVisible', true);
  const borderColor = readStr(assetRef, 'borderColor', '#64c8ff');
  const borderWidth = readNum(assetRef, 'borderWidth', 2, 0, 8);
  const borderGlowEnabled = readBool(assetRef, 'borderGlowEnabled', false);
  const borderGlowColor = readStr(assetRef, 'borderGlowColor', '#64c8ff');
  const vignette = readNum(assetRef, 'vignette', 0, 0, 100);

  const cols = 10;
  const rows = 14;
  const cell = 10;
  const w = cols * cell;
  const h = rows * cell;

  let background = bgStart;
  if (bgMode === 'linear') {
    background = `linear-gradient(180deg, ${bgStart}, ${bgEnd})`;
  } else if (bgMode === 'radial') {
    background = `radial-gradient(circle, ${bgStart}, ${bgEnd})`;
  }

  // A few locked blocks at bottom for visual interest
  const lockedCells: Array<[number, number, string]> = [
    [rows - 1, 0, '#00f0f0'],
    [rows - 1, 1, '#00f0f0'],
    [rows - 1, 2, '#00f0f0'],
    [rows - 1, 3, '#00f0f0'],
    [rows - 1, 4, '#f0f000'],
    [rows - 1, 5, '#f0f000'],
    [rows - 1, 6, '#a000f0'],
    [rows - 1, 7, '#a000f0'],
    [rows - 1, 8, '#a000f0'],
    [rows - 1, 9, '#f00000'],
    [rows - 2, 4, '#f0f000'],
    [rows - 2, 5, '#f0f000'],
    [rows - 2, 6, '#a000f0'],
  ];

  return (
    <div
      className='relative h-full w-full overflow-hidden rounded-lg flex items-center justify-center'
      style={{ background: '#060610' }}
    >
      <div
        style={{
          position: 'relative',
          width: w,
          height: h,
          background,
          border:
            borderWidth > 0 ? `${borderWidth}px solid ${borderColor}` : undefined,
          boxShadow: borderGlowEnabled
            ? `0 0 12px ${borderGlowColor}, 0 0 4px ${borderGlowColor}`
            : undefined,
        }}
      >
        {/* Grid lines */}
        {gridVisible
          ? Array.from({ length: cols - 1 }, (_, i) => (
              <div
                key={`vg-${i}`}
                style={{
                  position: 'absolute',
                  left: (i + 1) * cell - gridWidth / 2,
                  top: 0,
                  bottom: 0,
                  width: gridWidth,
                  background: gridColor,
                  opacity: 0.18,
                }}
              />
            ))
          : null}
        {gridVisible
          ? Array.from({ length: rows - 1 }, (_, i) => (
              <div
                key={`hg-${i}`}
                style={{
                  position: 'absolute',
                  top: (i + 1) * cell - gridWidth / 2,
                  left: 0,
                  right: 0,
                  height: gridWidth,
                  background: gridColor,
                  opacity: 0.18,
                }}
              />
            ))
          : null}
        {/* Locked blocks */}
        {lockedCells.map(([r, c, color]) => (
          <div
            key={`b-${r}-${c}`}
            style={{
              position: 'absolute',
              left: c * cell + 1,
              top: r * cell + 1,
              width: cell - 2,
              height: cell - 2,
              background: color,
            }}
          />
        ))}
        {/* Vignette */}
        {vignette > 0 ? (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              pointerEvents: 'none',
              background: `radial-gradient(circle, transparent 40%, rgba(0,0,0,${vignette / 100}) 100%)`,
            }}
          />
        ) : null}
      </div>
    </div>
  );
}

function EffectsPreview({
  assetRef,
}: {
  assetRef: Record<string, unknown> | null;
}) {
  const style = readStr(assetRef, 'lineClearStyle', 'flash');
  const clearColor = readStr(assetRef, 'lineClearColor', '#ffffff');
  const intensity = readNum(assetRef, 'lineClearIntensity', 70, 0, 100);
  const tetrisColor = readStr(assetRef, 'tetrisClearColor', '#ffd700');
  const tspinColor = readStr(assetRef, 'tspinHighlightColor', '#a000f0');

  const cols = 10;
  const rows = 8;
  const cell = 14;
  const w = cols * cell;
  const h = rows * cell;

  return (
    <div
      className='relative h-full w-full overflow-hidden rounded-lg flex items-center justify-center'
      style={{ background: '#06060c' }}
    >
      <div
        style={{
          position: 'relative',
          width: w,
          height: h,
          background: '#0a0a14',
          border: '2px solid #1a1a2a',
        }}
      >
        {/* Static blocks */}
        {Array.from({ length: cols }, (_, c) => (
          <div
            key={`s1-${c}`}
            style={{
              position: 'absolute',
              left: c * cell + 1,
              top: (rows - 3) * cell + 1,
              width: cell - 2,
              height: cell - 2,
              background: c % 2 === 0 ? '#00f0f0' : '#f0a000',
            }}
          />
        ))}
        {/* Clearing row - with style applied; pulses like a live clear */}
        <div className='arcprev-pulse' style={{ position: 'absolute', inset: 0 }}>
        {Array.from({ length: cols }, (_, c) => {
          const baseStyle: React.CSSProperties = {
            position: 'absolute',
            left: c * cell + 1,
            top: (rows - 1) * cell + 1,
            width: cell - 2,
            height: cell - 2,
          };
          if (style === 'flash') {
            return (
              <div
                key={`f-${c}`}
                style={{
                  ...baseStyle,
                  background: clearColor,
                  opacity: intensity / 100,
                  boxShadow: `0 0 8px ${clearColor}`,
                }}
              />
            );
          }
          if (style === 'dissolve') {
            return (
              <div
                key={`f-${c}`}
                style={{
                  ...baseStyle,
                  background: clearColor,
                  opacity: (intensity / 100) * (1 - c / cols),
                }}
              />
            );
          }
          if (style === 'shatter') {
            return (
              <div
                key={`f-${c}`}
                style={{
                  ...baseStyle,
                  background: clearColor,
                  opacity: intensity / 100,
                  transform: `rotate(${(c * 15) % 45 - 22}deg) scale(0.9)`,
                }}
              />
            );
          }
          // sweep
          return (
            <div
              key={`f-${c}`}
              style={{
                ...baseStyle,
                background: `linear-gradient(90deg, ${clearColor} ${c * 10}%, transparent ${c * 10 + 50}%)`,
                opacity: intensity / 100,
              }}
            />
          );
        })}
        </div>
        {/* Label bar */}
        <div
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: 4,
            textAlign: 'center',
            fontSize: 9,
            color: tetrisColor,
            textShadow: `0 0 4px ${tetrisColor}`,
            fontWeight: 700,
            letterSpacing: 1,
          }}
        >
          {style.toUpperCase()}
        </div>
        {/* T-spin indicator */}
        <div
          style={{
            position: 'absolute',
            right: 4,
            top: 18,
            width: 8,
            height: 8,
            background: tspinColor,
            borderRadius: 2,
            boxShadow: `0 0 6px ${tspinColor}`,
          }}
        />
      </div>
    </div>
  );
}

function GhostPreview({ assetRef }: { assetRef: Record<string, unknown> | null }) {
  const ghostStyle = readStr(assetRef, 'ghostStyle', 'filled-translucent');
  const ghostOpacity = readNum(assetRef, 'ghostOpacity', 20, 5, 60) / 100;
  const tintEnabled = readBool(assetRef, 'ghostTintEnabled', false);
  const tintColor = readStr(assetRef, 'ghostTintColor', '#ffffff');
  const panelBg = readStr(assetRef, 'panelBgColor', '#0a0a14');
  const panelBorder = readStr(assetRef, 'panelBorderColor', '#2a2a3a');
  const panelAccent = readStr(assetRef, 'panelAccentColor', '#64c8ff');

  const pieceColor = tintEnabled ? tintColor : '#00f0f0';
  const cell = 12;

  return (
    <div
      className='relative h-full w-full overflow-hidden rounded-lg flex items-center justify-center gap-3 p-3'
      style={{ background: '#060610' }}
    >
      {/* Mini board with piece + ghost */}
      <div
        style={{
          position: 'relative',
          width: cell * 6,
          height: cell * 10,
          background: panelBg,
          border: `2px solid ${panelBorder}`,
        }}
      >
        {/* Current I-piece at top */}
        {[0, 1, 2, 3].map((c) => (
          <div
            key={`cur-${c}`}
            style={{
              position: 'absolute',
              left: c * cell + cell + 1,
              top: cell + 1,
              width: cell - 2,
              height: cell - 2,
              background: pieceColor,
            }}
          />
        ))}
        {/* Ghost I-piece at bottom */}
        {[0, 1, 2, 3].map((c) => {
          const base: React.CSSProperties = {
            position: 'absolute',
            left: c * cell + cell + 1,
            top: (8) * cell + 1,
            width: cell - 2,
            height: cell - 2,
          };
          if (ghostStyle === 'outline') {
            return (
              <div
                key={`g-${c}`}
                style={{
                  ...base,
                  border: `1.5px solid ${pieceColor}`,
                  opacity: ghostOpacity * 3,
                }}
              />
            );
          }
          if (ghostStyle === 'dashed') {
            return (
              <div
                key={`g-${c}`}
                style={{
                  ...base,
                  border: `1.5px dashed ${pieceColor}`,
                  opacity: ghostOpacity * 3,
                }}
              />
            );
          }
          return (
            <div
              key={`g-${c}`}
              style={{
                ...base,
                background: pieceColor,
                opacity: ghostOpacity,
              }}
            />
          );
        })}
      </div>
      {/* Hold/Next panel stack */}
      <div className='flex flex-col gap-2'>
        <div
          style={{
            width: cell * 4,
            height: cell * 3,
            background: panelBg,
            border: `1.5px solid ${panelBorder}`,
            position: 'relative',
          }}
        >
          <div
            style={{
              fontSize: 7,
              color: panelAccent,
              padding: '1px 3px',
              textTransform: 'uppercase',
              letterSpacing: 0.5,
              fontWeight: 600,
            }}
          >
            Hold
          </div>
          {/* T piece in hold */}
          <div
            style={{
              position: 'absolute',
              left: cell * 0.5,
              top: cell * 1.2,
              width: cell - 2,
              height: cell - 2,
              background: '#a000f0',
            }}
          />
          <div
            style={{
              position: 'absolute',
              left: cell * 1.5,
              top: cell * 1.2,
              width: cell - 2,
              height: cell - 2,
              background: '#a000f0',
            }}
          />
          <div
            style={{
              position: 'absolute',
              left: cell * 2.5,
              top: cell * 1.2,
              width: cell - 2,
              height: cell - 2,
              background: '#a000f0',
            }}
          />
          <div
            style={{
              position: 'absolute',
              left: cell * 1.5,
              top: cell * 0.2,
              width: cell - 2,
              height: cell - 2,
              background: '#a000f0',
            }}
          />
        </div>
        <div
          style={{
            width: cell * 4,
            height: cell * 4,
            background: panelBg,
            border: `1.5px solid ${panelBorder}`,
            position: 'relative',
          }}
        >
          <div
            style={{
              fontSize: 7,
              color: panelAccent,
              padding: '1px 3px',
              textTransform: 'uppercase',
              letterSpacing: 0.5,
              fontWeight: 600,
            }}
          >
            Next
          </div>
          {/* O piece */}
          <div
            style={{
              position: 'absolute',
              left: cell * 1,
              top: cell * 1.5,
              width: cell - 2,
              height: cell - 2,
              background: '#f0f000',
            }}
          />
          <div
            style={{
              position: 'absolute',
              left: cell * 2,
              top: cell * 1.5,
              width: cell - 2,
              height: cell - 2,
              background: '#f0f000',
            }}
          />
          <div
            style={{
              position: 'absolute',
              left: cell * 1,
              top: cell * 2.5,
              width: cell - 2,
              height: cell - 2,
              background: '#f0f000',
            }}
          />
          <div
            style={{
              position: 'absolute',
              left: cell * 2,
              top: cell * 2.5,
              width: cell - 2,
              height: cell - 2,
              background: '#f0f000',
            }}
          />
        </div>
      </div>
    </div>
  );
}

export function TetrisMiniPreview({
  assetRef,
  slot,
}: {
  assetRef: Record<string, unknown> | null;
  slot: string;
}) {
  if (slot === 'blocks') return <BlocksPreview assetRef={assetRef} />;
  if (slot === 'board') return <BoardPreview assetRef={assetRef} />;
  if (slot === 'effects') return <EffectsPreview assetRef={assetRef} />;
  if (slot === 'ghost') return <GhostPreview assetRef={assetRef} />;
  return null;
}
