import type { ComponentType } from 'react';

import type { PreviewProps } from './kit';

/* Lazy registry of per-game hover preview animations.
 *
 * Each game's animation is a default export in ./<slug>.tsx. The 21 floor
 * games draw on the shared kit in ./kit.tsx: one 160 x 100 screen in the
 * palette and one move, 300 to 900 ms, played once, and take `still` to hold a
 * resting frame (see CABINET_ART.md). Reserve and retired games keep their
 * older looping scenes. A module loads only when a card is first pointed at
 * or focused (the floor gates on that and on reduced motion); the floor's
 * resting frames are drawn on the server (./stills.tsx). Slugs absent here
 * keep the static poster. */

type PreviewLoader = () => Promise<{ default: ComponentType<PreviewProps> }>;

const PREVIEW_LOADERS: Record<string, PreviewLoader> = {
  '2048': () => import('./2048'),
  '21': () => import('./21'),
  '8-ball': () => import('./8-ball'),
  'air-hockey': () => import('./air-hockey'),
  baccarat: () => import('./baccarat'),
  breakout: () => import('./breakout'),
  cases: () => import('./cases'),
  checkers: () => import('./checkers'),
  chess: () => import('./chess'),
  chicken: () => import('./chicken'),
  'coin-flip': () => import('./coin-flip'),
  'bumper-cars': () => import('./bumper-cars'),
  'coin-pusher': () => import('./coin-pusher'),
  'connect-four': () => import('./connect-four'),
  connections: () => import('./connections'),
  crash: () => import('./crash'),
  darts: () => import('./darts'),
  dice: () => import('./dice'),
  dragon: () => import('./dragon'),
  'flappy-bird': () => import('./flappy-bird'),
  'fortune-teller': () => import('./fortune-teller'),
  'gem-roll': () => import('./gem-roll'),
  gopher: () => import('./gopher'),
  gunrush: () => import('./gunrush'),
  'high-striker': () => import('./high-striker'),
  'skee-ball': () => import('./skee-ball'),
  hilo: () => import('./hilo'),
  keno: () => import('./keno'),
  'knife-booth': () => import('./knife-booth'),
  lightspeed: () => import('./lightspeed'),
  limbo: () => import('./limbo'),
  'log-splitter': () => import('./log-splitter'),
  'lucky-cage': () => import('./lucky-cage'),
  'tin-duck': () => import('./tin-duck'),
  'boardwalk-hop': () => import('./boardwalk-hop'),
  math: () => import('./math'),
  'blitz-tactics': () => import('./blitz-tactics'),
  'melon-chop': () => import('./melon-chop'),
  mines: () => import('./mines'),
  'mini-golf': () => import('./mini-golf'),
  packs: () => import('./packs'),
  pangram: () => import('./pangram'),
  plinko: () => import('./plinko'),
  'prize-claw': () => import('./prize-claw'),
  'prize-wheel': () => import('./prize-wheel'),
  pump: () => import('./pump'),
  'reaction-time': () => import('./reaction-time'),
  ricochet: () => import('./ricochet'),
  roulette: () => import('./roulette'),
  scratch: () => import('./scratch'),
  sequence: () => import('./sequence'),
  slots: () => import('./slots'),
  snake: () => import('./snake'),
  stack: () => import('./stack'),
  stoplight: () => import('./stoplight'),
  sudoku: () => import('./sudoku'),
  'punch-card': () => import('./punch-card'),
  freecell: () => import('./freecell'),
  swerve: () => import('./swerve'),
  tetris: () => import('./tetris'),
  tumbler: () => import('./tumbler'),
  'ticket-stop': () => import('./ticket-stop'),
  'trick-shot': () => import('./trick-shot'),
  'ring-toss': () => import('./ring-toss'),
  derby: () => import('./derby'),
  'typing-test': () => import('./typing-test'),
  'video-poker': () => import('./video-poker'),
  'word-grid': () => import('./word-grid'),
  // the duel card reuses the typing-test scene
  'typing-duel': () => import('./typing-test'),
};

const cache = new Map<string, ComponentType<PreviewProps>>();
const inflight = new Map<string, Promise<ComponentType<PreviewProps> | null>>();

/** True when a lazy hover preview exists for this cabinet slug. */
export function hasGamePreviewAnim(slug: string): boolean {
  return Object.prototype.hasOwnProperty.call(PREVIEW_LOADERS, slug);
}

/**
 * Resolve (and cache) the preview component for a slug. Returns null if the
 * slug has no preview or the dynamic import fails.
 */
export async function loadGamePreviewAnim(
  slug: string,
): Promise<ComponentType<PreviewProps> | null> {
  const hit = cache.get(slug);
  if (hit) return hit;

  const pending = inflight.get(slug);
  if (pending) return pending;

  const loader = PREVIEW_LOADERS[slug];
  if (!loader) return null;

  const promise = loader()
    .then((mod) => {
      const Comp = mod.default;
      cache.set(slug, Comp);
      inflight.delete(slug);
      return Comp;
    })
    .catch(() => {
      inflight.delete(slug);
      return null;
    });

  inflight.set(slug, promise);
  return promise;
}

/** @deprecated Prefer hasGamePreviewAnim + loadGamePreviewAnim (lazy). */
export const GAME_PREVIEW_ANIMS: Record<string, ComponentType> = {};
