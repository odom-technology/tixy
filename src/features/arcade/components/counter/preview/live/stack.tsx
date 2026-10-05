'use client';

/* Stacker, drawn by the cabinet's own frame painter (_stacker-cabinet-draw.ts):
   a tower of lit rows with the next row sweeping across the top. The rows
   come from the cabinet engine itself, stopped where each one lands square. */

import { useMemo } from 'react';

import { drawStacker, stackerGeometry } from '@/app/(games)/stack/_stacker-cabinet-draw';
import { buildStackSkinLook } from '@/app/(games)/stack/_stack-skin-draw';
import type { SkinSet } from '@/features/arcade/lib/skins/skin-set';
import {
  STACKER_ARM_MS,
  stackerLayout,
  stackerRowStart,
  stackerState,
  stackerView,
} from '@/server/arcade/stack-cabinet-engine';

import { CanvasStill } from './canvas-still';
import type { LiveProps } from './types';

const ROWS = 8;

/* Stops that land each row on the one below, found by stepping the row's
   own clock until it lines up. */
function towerStops(seed: number) {
  const layout = stackerLayout(seed);
  const stops: number[] = [];
  for (let row = 0; row < ROWS; row += 1) {
    const start = stackerRowStart(stops, row);
    const before = stackerState(layout, stops).width;
    let found = false;
    for (let t = start + STACKER_ARM_MS; t < start + 8000; t += 5) {
      const next = stackerState(layout, [...stops, t]);
      if (!next.over && next.width === before && next.tower.length === row + 1) {
        stops.push(t);
        found = true;
        break;
      }
    }
    if (!found) break;
  }
  const last = stops[stops.length - 1] ?? 0;
  const runMs = stackerRowStart(stops, stops.length) + 260;
  return { layout, stops, runMs: Math.max(runMs, last) };
}

export default function StackLive({ skin }: LiveProps) {
  const look = useMemo(() => (skin ? buildStackSkinLook(skin as SkinSet<'stack'>) : null), [skin]);
  const tower = useMemo(() => towerStops(7), []);
  return (
    <CanvasStill
      deps={[look, tower]}
      draw={(ctx, width, height, dpr) => {
        const g = stackerGeometry(width, height);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        drawStacker(ctx, g, {
          layout: tower.layout,
          view: stackerView(tower.layout, tower.stops, tower.runMs),
          runMs: tower.runMs,
          now: 0,
          falling: [],
          shards: [],
          pulse: null,
          chase: null,
          minorBanked: false,
          majorBanked: false,
          missed: false,
          reducedMotion: true,
          dpr,
          skin: look,
        });
      }}
    />
  );
}
