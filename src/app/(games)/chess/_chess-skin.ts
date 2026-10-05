// ---------------------------------------------------------------------------
// Chess skin sets (docs/design/tixy-rebrand/SKINS.md): the palette, the
// board material, the piece shape and the sound tint, drawn together. A skin
// never moves a square or a hit area; it only changes how they look.
//
// `chessSkinLook` turns a skin set into the board and pieces themes the board
// already takes, plus the few extras a skin needs (the shape, the frame, and
// the material's pattern for each square).
// ---------------------------------------------------------------------------

import type { ChessBoardTheme, ChessPiecesTheme } from '@/features/arcade/lib/chess/theme';
import {
  contrastRatio,
  mixHex,
  readableOn,
  type SkinMaterialOf,
  type SkinSet,
  type SkinSoundTint,
} from '@/features/arcade/lib/skins/skin-set';

import type { ChessPieceShape } from './_piece-svg';

const INK = '#1f1a16';
const PAPER = '#f4ebdc';

type ChessMaterial = SkinMaterialOf<'chess'>;

export type ChessSkinLook = {
  shape: ChessPieceShape;
  material: ChessMaterial;
  sound: SkinSoundTint;
  board: ChessBoardTheme;
  pieces: ChessPiecesTheme;
  /** Outline for the white and the black pieces: ink or paper, by contrast. */
  strokeWhite: string;
  strokeBlack: string;
  /** The frame behind the board: its colour and its material, as CSS. */
  frame: string;
  frameArt: string;
  /** The material on one square, as a CSS background-image. `n` varies the
   *  grain from square to square. */
  squareArt: (dark: boolean, n: number) => string;
};

const svgUrl = (svg: string) => `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;

/* The pattern lines of a material over a base colour, in a 100 by 100 box
   that stretches to the square. Flat strokes only, never a gradient. */
function materialSvg(material: ChessMaterial, base: string, variant: number): string {
  const tone = readableOn(base, INK, PAPER);
  const open = "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100' preserveAspectRatio='none'>";
  const line = (d: string, colour: string, width: number) =>
    `<path d='${d}' fill='none' stroke='${colour}' stroke-width='${width}' stroke-linecap='round' vector-effect='non-scaling-stroke'/>`;
  const v = variant % 4;
  switch (material) {
    case 'walnut':
    case 'maple': {
      const grain = mixHex(base, tone, material === 'walnut' ? 0.2 : 0.14);
      const ys = [18 + v * 4, 46 - v * 3, 74 + v * 2];
      const waves = ys.map((y, i) => {
        const amp = 4 + ((v + i) % 3) * 1.5;
        return line(`M0 ${y} Q25 ${y - amp} 50 ${y} T100 ${y}`, grain, 1.1);
      });
      return `${open}${waves.join('')}</svg>`;
    }
    case 'paper': {
      const rule = mixHex(base, tone, 0.14);
      return `${open}${line('M0 34H100M0 67H100', rule, 1)}</svg>`;
    }
    case 'slate': {
      const chalk = mixHex(base, PAPER, 0.22);
      const x = 12 + v * 9;
      return `${open}${line(`M${x} 30L${x + 34} 24`, chalk, 1.4)}${line(`M${58 - v * 6} 74L${86 - v * 6} 70`, chalk, 1.4)}</svg>`;
    }
    case 'felt': {
      const dot = mixHex(base, tone, 0.16);
      return `${open}<defs><pattern id='w' width='12.5' height='12.5' patternUnits='userSpaceOnUse'><circle cx='3' cy='3' r='1.5' fill='${dot}'/><circle cx='9.25' cy='9.25' r='1.5' fill='${dot}'/></pattern></defs><rect width='100' height='100' fill='url(#w)'/></svg>`;
    }
  }
}

/* The dots that mark a legal move: ink or paper, whichever holds on both
   squares. */
function legalInk(light: string, dark: string): string {
  const score = (c: string) => Math.min(contrastRatio(c, light), contrastRatio(c, dark));
  return score(INK) >= score(PAPER) ? INK : PAPER;
}

const withAlpha = (hex: string, alpha: number) => {
  const n = Number.parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
};

export function chessSkinLook(skin: SkinSet<'chess'>): ChessSkinLook {
  const p = skin.palette;
  const cache = new Map<string, string>();
  const art = (base: string, variant: number) => {
    const key = `${base}${variant}`;
    let url = cache.get(key);
    if (!url) {
      url = svgUrl(materialSvg(skin.material, base, variant));
      cache.set(key, url);
    }
    return url;
  };
  return {
    shape: skin.shape,
    material: skin.material,
    sound: skin.sound,
    board: {
      lightColor: p.light,
      darkColor: p.dark,
      borderColor: p.frame,
      highlightColor: withAlpha(p.mark, 0.9),
      selectedColor: p.mark,
      legalMoveColor: legalInk(p.light, p.dark),
    },
    pieces: {
      whiteColor: p.white,
      blackColor: p.black,
      whiteShadow: 'rgba(31, 26, 22, 0.35)',
      blackShadow: 'rgba(244, 235, 220, 0.2)',
    },
    strokeWhite: readableOn(p.white, INK, PAPER),
    strokeBlack: readableOn(p.black, INK, PAPER),
    frame: p.frame,
    frameArt: art(p.frame, 0),
    squareArt: (dark, n) => art(dark ? p.dark : p.light, n),
  };
}
