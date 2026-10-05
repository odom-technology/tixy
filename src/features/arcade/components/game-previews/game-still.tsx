'use client';

import { useEffect, useState, type ComponentType } from 'react';

import { hasGameStill } from './still-slugs';
import { loadGamePreviewAnim } from './index';
import type { PreviewProps } from './kit';

/** A floor game's resting frame, loaded on its own when it is needed. Fills
 *  its parent (the screen is absolutely positioned) and renders nothing for a
 *  game that has no kit screen, so callers can fall back to a poster. */
export function GameStill({ slug }: { slug: string }) {
  const [Screen, setScreen] = useState<ComponentType<PreviewProps> | null>(null);
  useEffect(() => {
    if (!hasGameStill(slug)) return;
    let cancelled = false;
    void loadGamePreviewAnim(slug).then((Comp) => {
      if (!cancelled && Comp) setScreen(() => Comp);
    });
    return () => {
      cancelled = true;
    };
  }, [slug]);
  return Screen ? <Screen still /> : null;
}
