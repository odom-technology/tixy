// ---------------------------------------------------------------------------
// Connect Four cosmetic theme.
//
// The in-game board (see `_board.tsx` + `_connect-four.css`) is DOM/CSS-rendered
// rather than canvas, so cosmetics flow in as CSS custom properties applied
// inline on the `.connect-four-arcade` wrapper. The CSS references each var with
// the default as its fallback, and DEFAULT_CONNECT_FOUR_THEME holds the same
// values, so an empty loadout and a missing var look the same.
//
// Equipped skins overlay on top of the default via buildConnectFourTheme():
//   - slot "discs"      → player disc colors + glints/edges (+ optional glow fx)
//   - slot "board"      → playfield, hole cavities, rack frame/edge
//   - slot "background" → backdrop mat (top/bottom) + interaction accent
// ---------------------------------------------------------------------------

import {
  contrastRatio,
  findEquippedSkinSet,
  mixHex,
  readableOn,
  type SkinSet,
  type SkinSoundTint,
} from '@/features/arcade/lib/skins/skin-set';

export type InventoryCosmeticResponse = {
  equipped?: Array<{
    slot?: string;
    item?: {
      assetRef?: Record<string, unknown> | null;
    } | null;
  }>;
};

export type ConnectFourChipShape = SkinSet<'connect-four'>['shape'];

/* One side's chip in a skin set: the body, the ink for its mark (the pip
   or the holes) and the flat outline that keeps it off the hole. */
export type ConnectFourChipLook = { fill: string; ink: string; edge: string };

/* An equipped skin set (SKINS.md). `you` is the viewer's chip and `them` the
   other seat's; a spectator sees red as `you`. */
export type ConnectFourSkin = {
  shape: ConnectFourChipShape;
  material: SkinSet<'connect-four'>['material'];
  sound: SkinSoundTint;
  you: ConnectFourChipLook;
  them: ConnectFourChipLook;
  /** The rack face's material, as CSS layers over the frame colour. */
  face: { image: string; size: string; inset: string };
  /** The ring round the winning four, held at 3:1 on the holes. */
  win: string;
};

export type ConnectFourCosmeticTheme = {
  // A skin set, when one is equipped: it draws the chips and the rack.
  skin: ConnectFourSkin | null;
  // discs — player 1 (red) enamel: glint (top highlight) → body → edge.
  player1Color: string;
  player1Glint: string;
  player1Edge: string;
  // discs — player 2 (yellow/amber) enamel.
  player2Color: string;
  player2Glint: string;
  player2Edge: string;
  // optional disc-drop glow (off by default).
  discGlow: boolean;
  // board — lacquered-wood playfield (top → deep).
  boardColor: string;
  boardColorDeep: string;
  // board — punched hole cavities (rim → deep).
  holeColor: string;
  holeColorDeep: string;
  // board — cream cabinet frame (top → bottom) and its hard edge/border.
  frameTop: string;
  frameBottom: string;
  frameEdge: string;
  // background — backdrop mat behind the cabinet + interaction accent.
  bgTop: string;
  bgBottom: string;
  accent: string;
};

/* DEFAULT look, from the tixy palette (docs/design/tixy-rebrand/PLAN.md):
   a dark rack with deep holes, red and ticket-amber chips with paper rims.
   Every value here is the fallback of the matching var in
   `_connect-four.css`, so an empty loadout and a missing var look the same.
   Equipped skins overlay on top through buildConnectFourTheme(). Background
   top/bottom are transparent (no mat) by default. */
export const DEFAULT_CONNECT_FOUR_THEME: ConnectFourCosmeticTheme = {
  player1Glint: '#d4604f',
  player1Color: '#b83627',
  player1Edge: '#8a2a1e',
  player2Glint: '#f8c57a',
  player2Color: '#f2a33c',
  player2Edge: '#c47f1f',
  discGlow: false,
  boardColor: '#5e4d3e',
  boardColorDeep: '#46392e',
  holeColor: '#1f1a16',
  holeColorDeep: '#120f0c',
  frameTop: '#2b2119',
  frameBottom: '#2b2119',
  frameEdge: '#1f1a16',
  bgTop: 'transparent',
  bgBottom: 'transparent',
  accent: '#f2a33c',
  skin: null,
};

const INK = '#1f1a16';
const PAPER = '#f4ebdc';

export const chipLook = (fill: string): ConnectFourChipLook => {
  const ink = readableOn(fill, INK, PAPER);
  return { fill, ink, edge: mixHex(fill, ink, 0.4) };
};

/* The rack face's material as CSS: flat, hard-edged layers over the frame
   colour. */
const faceMaterial = (skin: SkinSet<'connect-four'>): { image: string; size: string; inset: string } => {
  const frame = skin.palette.frame;
  const tone = readableOn(frame, INK, PAPER);
  const seam = mixHex(frame, tone, 0.3);
  const alt = mixHex(frame, tone, 0.07);
  switch (skin.material) {
    case 'planks':
      return {
        image: `repeating-linear-gradient(180deg, transparent 0, transparent calc(16.667% - 2px), ${seam} calc(16.667% - 2px), ${seam} 16.667%), repeating-linear-gradient(180deg, transparent 0 16.667%, ${alt} 16.667% 33.333%)`,
        size: 'auto',
        inset: 'none',
      };
    case 'tin': {
      const dimple = mixHex(frame, tone, 0.2);
      return { image: `radial-gradient(circle, ${dimple} 0 1.6px, transparent 1.8px)`, size: '14px 14px', inset: 'none' };
    }
    case 'ink':
      return { image: `linear-gradient(180deg, transparent 0 50%, ${mixHex(frame, '#000000', 0.35)} 50%)`, size: 'auto', inset: 'none' };
    default: {
      // enamel: a pinstripe just inside the edge
      const stripe = mixHex(frame, tone, 0.45);
      return { image: 'none', size: 'auto', inset: `inset 0 0 0 3px ${frame}, inset 0 0 0 4.5px ${stripe}` };
    }
  }
};

/* A skin set fills the rack, the holes and both chips at once. The rack's
   face is the frame colour; the cabinet around it is a step away from it. */
export const applyConnectFourSkinSet = (skin: SkinSet<'connect-four'>): ConnectFourCosmeticTheme => {
  const p = skin.palette;
  const cabinet = mixHex(p.frame, readableOn(p.frame, INK, PAPER), 0.22);
  return {
    ...DEFAULT_CONNECT_FOUR_THEME,
    player1Color: p.you,
    player2Color: p.them,
    boardColor: p.frame,
    boardColorDeep: p.frame,
    holeColor: p.hole,
    holeColorDeep: p.hole,
    frameTop: cabinet,
    frameBottom: cabinet,
    frameEdge: mixHex(cabinet, readableOn(cabinet, INK, PAPER), 0.4),
    accent: readableOn(p.frame, INK, PAPER),
    skin: {
      shape: skin.shape,
      material: skin.material,
      sound: skin.sound,
      you: chipLook(p.you),
      them: chipLook(p.them),
      face: faceMaterial(skin),
      win: contrastRatio(p.mark, p.hole) >= 3 ? p.mark : readableOn(p.hole, INK, PAPER),
    },
  };
};

const readAssetColor = (
  assetRef: Record<string, unknown> | null | undefined,
  key: string,
  fallback: string,
) => {
  const value = assetRef?.[key];
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : fallback;
};

export const buildConnectFourTheme = (
  response: InventoryCosmeticResponse,
): ConnectFourCosmeticTheme => {
  const skinSet = findEquippedSkinSet(response.equipped, 'connect-four');
  if (skinSet) return applyConnectFourSkinSet(skinSet);
  const theme: ConnectFourCosmeticTheme = { ...DEFAULT_CONNECT_FOUR_THEME };
  for (const equipped of response.equipped ?? []) {
    const slot = equipped?.slot;
    const assetRef = equipped?.item?.assetRef ?? null;
    if (!slot || !assetRef) continue;

    if (slot === 'discs') {
      theme.player1Color = readAssetColor(assetRef, 'player1Color', theme.player1Color);
      theme.player1Glint = readAssetColor(assetRef, 'player1Glint', theme.player1Glint);
      theme.player1Edge = readAssetColor(assetRef, 'player1Edge', theme.player1Edge);
      theme.player2Color = readAssetColor(assetRef, 'player2Color', theme.player2Color);
      theme.player2Glint = readAssetColor(assetRef, 'player2Glint', theme.player2Glint);
      theme.player2Edge = readAssetColor(assetRef, 'player2Edge', theme.player2Edge);
      if (typeof assetRef.discGlow === 'boolean') {
        theme.discGlow = assetRef.discGlow;
      }
    } else if (slot === 'board') {
      theme.boardColor = readAssetColor(assetRef, 'boardColor', theme.boardColor);
      theme.boardColorDeep = readAssetColor(assetRef, 'boardColorDeep', theme.boardColorDeep);
      theme.holeColor = readAssetColor(assetRef, 'holeColor', theme.holeColor);
      theme.holeColorDeep = readAssetColor(assetRef, 'holeColorDeep', theme.holeColorDeep);
      theme.frameTop = readAssetColor(assetRef, 'frameTop', theme.frameTop);
      theme.frameBottom = readAssetColor(assetRef, 'frameBottom', theme.frameBottom);
      theme.frameEdge = readAssetColor(assetRef, 'frameEdge', theme.frameEdge);
    } else if (slot === 'background') {
      theme.bgTop = readAssetColor(assetRef, 'bgTop', theme.bgTop);
      theme.bgBottom = readAssetColor(assetRef, 'bgBottom', theme.bgBottom);
      theme.accent = readAssetColor(assetRef, 'accent', theme.accent);
    }
  }
  return theme;
};

/* Map the theme onto the CSS custom properties consumed by `_connect-four.css`.
   Returned as a React.CSSProperties (with `--*` keys) for inline application on
   the `.connect-four-arcade` wrapper. A non-transparent backdrop also lifts the
   mat padding/radius so the background skin reads as a frame behind the cabinet. */
export const connectFourThemeVars = (
  theme: ConnectFourCosmeticTheme,
): React.CSSProperties => {
  const hasBackdrop =
    theme.bgTop !== 'transparent' || theme.bgBottom !== 'transparent';
  return {
    '--c4-disc-red': theme.player1Color,
    '--c4-disc-red-glint': theme.player1Glint,
    '--c4-disc-red-edge': theme.player1Edge,
    '--c4-disc-yellow': theme.player2Color,
    '--c4-disc-yellow-glint': theme.player2Glint,
    '--c4-disc-yellow-edge': theme.player2Edge,
    '--c4-board': theme.boardColor,
    '--c4-board-deep': theme.boardColorDeep,
    '--c4-hole': theme.holeColor,
    '--c4-hole-deep': theme.holeColorDeep,
    '--c4-frame-top': theme.frameTop,
    '--c4-frame-bottom': theme.frameBottom,
    '--c4-frame-edge': theme.frameEdge,
    '--c4-bg-top': theme.bgTop,
    '--c4-bg-bottom': theme.bgBottom,
    '--c4-accent': theme.accent,
    ...(theme.skin
      ? {
          '--c4-you': theme.skin.you.fill,
          '--c4-you-ink': theme.skin.you.ink,
          '--c4-you-edge': theme.skin.you.edge,
          '--c4-them': theme.skin.them.fill,
          '--c4-them-ink': theme.skin.them.ink,
          '--c4-them-edge': theme.skin.them.edge,
          '--c4-face-image': theme.skin.face.image,
          '--c4-face-size': theme.skin.face.size,
          '--c4-face-inset': theme.skin.face.inset,
          '--c4-win': theme.skin.win,
        }
      : {}),
    '--c4-bg-pad': hasBackdrop ? 'clamp(8px, 1.6vw, 16px)' : '0px',
    '--c4-bg-radius': hasBackdrop ? 'calc(var(--radius-well, 16px) + 14px)' : '0px',
  } as React.CSSProperties;
};

/* A red/yellow disc gradient string for non-board surfaces (e.g. the move-list
   dots), kept in sync with the `.c4-disc-*` CSS so equipped disc skins show
   everywhere. */
export const connectFourDiscGradient = (
  theme: ConnectFourCosmeticTheme,
  color: 'red' | 'yellow',
): string =>
  color === 'red'
    ? `radial-gradient(circle at 50% 34%, ${theme.player1Glint}, ${theme.player1Color} 64%, ${theme.player1Edge} 100%)`
    : `radial-gradient(circle at 50% 34%, ${theme.player2Glint}, ${theme.player2Color} 60%, ${theme.player2Edge} 100%)`;
