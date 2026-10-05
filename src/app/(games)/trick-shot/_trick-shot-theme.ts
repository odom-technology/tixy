'use client';

/* Trick shot is played on your own pool table: the 8-ball table skin you
   have equipped (a skin set from the prize counter, or an older one-slot
   skin), read the same way 8-ball's match page reads it. Ball size,
   pockets and physics are the engine's; a skin only changes the look and
   the sound tint (SKINS.md). */

import { useEffect, useState } from 'react';

import { findEquippedSkinSet } from '@/features/arcade/lib/skins/skin-set';
import { SoundManager } from '@/features/arcade/lib/sound-manager';
import { DEFAULT_POOL_THEME, type PoolCosmeticTheme } from '../8-ball/[id]/_pool-canvas';

type Equipped = Array<{ slot?: string; item?: { assetRef?: Record<string, unknown> | null } | null }>;

const LEGACY_BALLS: Array<[string, number[]]> = [
  ['ballYellow', [1, 9]],
  ['ballBlue', [2, 10]],
  ['ballRed', [3, 11]],
  ['ballPurple', [4, 12]],
  ['ballOrange', [5, 13]],
  ['ballGreen', [6, 14]],
  ['ballMaroon', [7, 15]],
];

export function poolThemeFromEquipped(equipped: Equipped): { theme: PoolCosmeticTheme; tint: string } {
  const skinSet = findEquippedSkinSet(equipped as Parameters<typeof findEquippedSkinSet>[0], '8-ball');
  if (skinSet) {
    const p = skinSet.palette;
    const suits = [p.ball1, p.ball2, p.ball3, p.ball4, p.ball5, p.ball6, p.ball7];
    const ballColors: Record<number, string> = {};
    suits.forEach((colour, i) => {
      if (colour) {
        ballColors[i + 1] = colour;
        ballColors[i + 9] = colour;
      }
    });
    return {
      theme: {
        feltColor: p.felt,
        feltDark: p.feltDark,
        railColor: p.rail,
        railBorder: p.railEdge,
        pocketColor: p.pocket,
        cueColor: p.cue,
        cueTipColor: p.cueTip,
        cueGlow: false,
        cueGlowColor: DEFAULT_POOL_THEME.cueGlowColor,
        ...(Object.keys(ballColors).length > 0 ? { ballColors } : {}),
        skin: { material: skinSet.material, finish: skinSet.shape, sight: p.sight, railEdge: p.railEdge },
      },
      tint: skinSet.sound,
    };
  }
  const t: Record<string, unknown> = {};
  for (const entry of equipped) if (entry?.item?.assetRef) Object.assign(t, entry.item.assetRef);
  const ballColors: Record<number, string> = {};
  for (const [key, ids] of LEGACY_BALLS) {
    if (typeof t[key] === 'string') for (const id of ids) ballColors[id] = t[key] as string;
  }
  const pick = <K extends keyof PoolCosmeticTheme>(key: K) => (t[key] as PoolCosmeticTheme[K] | undefined) ?? DEFAULT_POOL_THEME[key];
  return {
    theme: {
      feltColor: pick('feltColor'),
      feltDark: pick('feltDark'),
      railColor: pick('railColor'),
      railBorder: pick('railBorder'),
      pocketColor: pick('pocketColor'),
      cueColor: pick('cueColor'),
      cueTipColor: pick('cueTipColor'),
      cueGlow: pick('cueGlow'),
      cueGlowColor: pick('cueGlowColor'),
      ...(Object.keys(ballColors).length > 0 ? { ballColors } : {}),
    },
    tint: 'house',
  };
}

/** Your table, once signed in; the house table for guests. */
export function useTrickShotTheme(signedIn: boolean): PoolCosmeticTheme {
  const [theme, setTheme] = useState<PoolCosmeticTheme>(DEFAULT_POOL_THEME);
  useEffect(() => {
    if (!signedIn) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch('/api/store/inventory?gameType=8-ball', { cache: 'no-store' });
        if (!res.ok) return;
        const data = (await res.json().catch(() => null)) as { equipped?: Equipped } | null;
        if (cancelled) return;
        const { theme: next, tint } = poolThemeFromEquipped(data?.equipped ?? []);
        setTheme(next);
        SoundManager.setTint(tint as Parameters<typeof SoundManager.setTint>[0]);
      } catch {
        /* the house table */
      }
    })();
    return () => {
      cancelled = true;
      SoundManager.setTint('house');
    };
  }, [signedIn]);
  return theme;
}
