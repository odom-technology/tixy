'use client';

/* Derby's stage inside the game shell: the canvas, the countdown, the
   callout and the result. Which race it shows (practice on this device, or
   a server race) is the client's (_race-client.tsx); the drawing and your
   aim are _race-game.ts. */

import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';

import { ArcadeCountdown } from '@/features/arcade/components/gameplay/arcade-game-hud';
import { MidwayStill } from '@/features/arcade/components/midway-still';
import { ArcadeRematchButton, ArcadeRunResult } from '@/features/arcade/components/results/arcade-run-result';
import {
  GameShell,
  GameStage,
  type GameHint,
  type GameHowTo,
  type GamePhase,
  type GameStageSize,
} from '@/features/arcade/components/shell/game-shell';
import {
  DERBY_COUNTDOWN_MS,
  DERBY_BOT_NAMES,
  DERBY_LANES,
  derbyTickets,
  type DerbyLaneSpec,
  type DerbyResult,
} from '@/features/arcade/lib/derby';
import { useFeelReducedMotion, useGameFeedback } from '@/features/arcade/lib/use-game-feedback';
import { isControlTarget, isDialogOpen } from '@/features/arcade/lib/use-first-input';

import type { DerbyLook } from './_race-theme';
import { DerbyRaceGame, FINISH_MOMENT_MS, STAGE_ASPECT, STAGE_ASPECT_WIDE, ordinalOf, type RaceGamePhase } from './_race-game';
import './_race.css';

const HINT: GameHint = { touch: 'Drag to keep your water on the target.', pointer: 'Hold the mouse button on the target.' };

const HOW_TO: GameHowTo = {
  lines: [
    'Hold to squirt and keep your water on the moving target.',
    'The nearer the middle, the faster your horse runs, and first to the wire wins.',
    `A win pays ${derbyTickets(1)} tickets and 8th pays ${derbyTickets(8)}.`,
  ],
};

const PRACTICE_LANE = 3;
/** Share of the stage's height the backboard takes (the countdown and the
 *  callout sit over it). */
const BOARD_SHARE = 0.45;

export type RaceView = {
  /** A new id puts a new race on the stage. */
  id: string;
  /** Who is in each lane: names for the result. */
  names: string[];
  setup: { seed: number; lanes: DerbyLaneSpec[]; myLane: number; clock: (perf: number) => number; local: boolean };
};

export type RaceEnd = {
  result: DerbyResult;
  myLane: number;
  names: string[];
};

export type RaceSource = {
  /** Called once the race is on the stage: news the owner already holds. */
  onMounted?: (game: DerbyRaceGame) => void;
};

type Props = {
  /** The race to run now, or null for the empty booth. */
  race: RaceView | null;
  /** Start a race from the first input (practice), or null when the lobby does. */
  onStart: (() => void) | null;
  source?: RaceSource;
  /** The result card, given the finish. Null: the default practice card. */
  renderEnd?: (end: RaceEnd, rematch: () => void) => ReactNode;
  onRematch: () => void;
  busy?: string | null;
  /** The line under the stage instead of the aim hint: the gate's line
   *  while a lobby fills. Undefined keeps the hint. */
  hint?: GameHint | null;
  below?: ReactNode;
  stat?: ReactNode;
  notice?: ReactNode;
  /** The race on the stage reached its finish here (before the server's word). */
  onFinished?: (raceId: string) => void;
  /** The equipped skin set's look. */
  look?: DerbyLook;
};

const WIDE_QUERY = '(min-width: 64rem) and (min-aspect-ratio: 1/1)';
function subscribeWide(callback: () => void) {
  const mq = window.matchMedia(WIDE_QUERY);
  mq.addEventListener('change', callback);
  return () => mq.removeEventListener('change', callback);
}
const isWide = () => window.matchMedia(WIDE_QUERY).matches;

export function DerbyStage({ race, onStart, source, renderEnd, onRematch, busy, hint, below, stat, notice, onFinished, look }: Props) {
  const stageRef = useRef<HTMLDivElement>(null);
  const { trigger, hitStopClock, shakeOffset } = useGameFeedback({ stage: stageRef });
  const reducedMotion = useFeelReducedMotion();
  const wide = useSyncExternalStore(subscribeWide, isWide, () => false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gameRef = useRef<DerbyRaceGame | null>(null);
  const calloutRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const [ready, setReady] = useState(false);
  const [canvasError, setCanvasError] = useState(false);
  const [gamePhase, setGamePhase] = useState<RaceGamePhase>('idle');
  const [countdown, setCountdown] = useState<number | 'go' | null>(null);
  const [end, setEnd] = useState<RaceEnd | null>(null);
  const [announce, setAnnounce] = useState('');
  const sourceRef = useRef(source);
  sourceRef.current = source;
  const raceRef = useRef(race);
  raceRef.current = race;
  const onFinishedRef = useRef(onFinished);
  onFinishedRef.current = onFinished;

  const fit = useCallback(({ width, height }: GameStageSize) => {
    setSize((prev) =>
      prev && prev.width === Math.floor(width) && prev.height === Math.floor(height)
        ? prev
        : { width: Math.floor(width), height: Math.floor(height) },
    );
  }, []);

  // Build the stage once it has a size; resize after.
  useEffect(() => {
    if (!size || !canvasRef.current) return;
    const existing = gameRef.current;
    if (existing) {
      existing.resize(size.width, size.height);
      return;
    }
    const game = new DerbyRaceGame(
      canvasRef.current,
      { callout: calloutRef.current },
      {
        hitStop: hitStopClock,
        trigger: (event, options) => trigger(event, options as Parameters<typeof trigger>[1]),
        shakeOffset,
      },
      {
        onPhase: setGamePhase,
        onCountdown: setCountdown,
        onFinish: (result) => {
          const current = raceRef.current;
          if (!current) return;
          const myLane = current.setup.myLane;
          const names = current.names;
          onFinishedRef.current?.(current.id);
          window.setTimeout(() => setEnd({ result, myLane, names }), reducedMotion ? 400 : FINISH_MOMENT_MS);
        },
        onReady: () => setReady(true),
        onAnnounce: setAnnounce,
      },
    );
    if (!game.build(size.width, size.height)) {
      setCanvasError(true);
      return;
    }
    gameRef.current = game;
    if (new URLSearchParams(window.location.search).has('derbyDebug')) {
      (window as unknown as { __derby?: DerbyRaceGame }).__derby = game;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size]);

  useEffect(
    () => () => {
      gameRef.current?.teardown();
      gameRef.current = null;
    },
    [],
  );

  // The equipped skin, whenever it arrives.
  useEffect(() => {
    if (ready && look) gameRef.current?.applyLook(look);
  }, [ready, look]);

  // A new race goes on the stage; none clears it.
  const raceKey = race ? race.id : '';
  useEffect(() => {
    const game = gameRef.current;
    if (!game || !ready) return;
    if (!race) {
      game.clearRace();
      setEnd(null);
      return;
    }
    setEnd(null);
    game.startRace(race.setup);
    sourceRef.current?.onMounted?.(game);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [raceKey, ready]);

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => gameRef.current?.pointerDown(e.nativeEvent);
  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => gameRef.current?.pointerMove(e.nativeEvent);
  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => gameRef.current?.pointerUp(e.nativeEvent);
  const onPointerCancel = (e: React.PointerEvent<HTMLCanvasElement>) => gameRef.current?.pointerCancel(e.nativeEvent);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.repeat || isControlTarget(e.target) || isDialogOpen()) return;
      if (gameRef.current?.keyDown(e.code, e.timeStamp)) e.preventDefault();
    };
    const up = (e: KeyboardEvent) => {
      if (isControlTarget(e.target) || isDialogOpen()) return;
      if (gameRef.current?.keyUp(e.code)) e.preventDefault();
    };
    const blur = () => gameRef.current?.releaseAll();
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
    };
  }, []);

  const phase: GamePhase = end || notice ? 'over' : race || gamePhase !== 'idle' ? 'playing' : 'ready';
  const endNode = notice ? notice : end ? (renderEnd ?? defaultEnd)(end, onRematch) : null;

  return (
    <GameShell game='derby' className='derby-midway' stat={stat} howTo={HOW_TO} below={below}>
      <GameStage
        phase={phase}
        hint={hint === undefined ? HINT : (hint ?? undefined)}
        busy={busy ?? (!ready && !canvasError ? 'Loading the booth.' : null)}
        onStart={onStart ? () => onStart() : undefined}
        aspect={wide ? STAGE_ASPECT_WIDE : STAGE_ASPECT}
        onSize={fit}
        end={endNode}
      >
        <div ref={stageRef} className='dr-stage' style={size ? { width: size.width, height: size.height } : undefined}>
          {canvasError ? (
            <MidwayStill
              game='derby'
              alt='The derby booth: eight toy horses on rails over a water gun aimed at a red and white target.'
              style={size ? { width: size.width, height: size.height } : undefined}
            />
          ) : (
            <canvas
              ref={canvasRef}
              className='dr-canvas'
              aria-label='Derby. Hold to squirt and keep your water on the moving target; the nearer the middle, the faster your horse runs. Keyboard: arrow keys aim, hold space to squirt.'
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerCancel}
              onContextMenu={(e) => e.preventDefault()}
              style={{ touchAction: 'none', width: size?.width ?? '100%', height: size?.height ?? '100%' }}
            />
          )}
          <div className='dr-board-overlay' style={{ height: `${BOARD_SHARE * 100}%` }}>
            <ArcadeCountdown value={countdown} />
            <div
              ref={calloutRef}
              className='arc-floater dr-callout'
              data-tone='score'
              data-run='false'
              aria-hidden='true'
              style={{ ['--callout-ms' as string]: '1800ms' }}
            >
              <span className='arc-floater-label' />
            </div>
          </div>
          <p className='sr-only' aria-live='polite' aria-atomic='true'>
            {announce}
          </p>
        </div>
      </GameStage>
    </GameShell>
  );
}

function defaultEnd(end: RaceEnd, rematch: () => void): ReactNode {
  const place = end.result.order.indexOf(end.myLane) + 1;
  const won = place === 1;
  return (
    <ArcadeRunResult
      title={won ? 'You won' : `${ordinalOf(place)} place`}
      tone={won ? 'win' : 'neutral'}
      stats={[
        { label: 'place', value: `${place}/${DERBY_LANES}`, highlight: won },
        { label: 'winner', value: end.names[end.result.winner] ?? `lane ${end.result.winner + 1}` },
        { label: 'race', value: `${(end.result.endT / 1000).toFixed(1)}s` },
      ]}
      guest
      actions={<ArcadeRematchButton onClick={rematch} />}
    />
  );
}

/** A practice race against seven bots, run on this device. Pays nothing. */
export function localPracticeRace(myName: string): RaceView {
  const seed = (Math.random() * 0x7fffffff) >>> 0;
  const gate = performance.now() + DERBY_COUNTDOWN_MS;
  const lanes: DerbyLaneSpec[] = [{ lane: PRACTICE_LANE, kind: 'human' }];
  const names = Array.from({ length: DERBY_LANES }, (_, lane) => (lane === PRACTICE_LANE ? myName : botName(lane)));
  return { id: `local:${seed}`, names, setup: { seed, lanes, myLane: PRACTICE_LANE, clock: (perf) => perf - gate, local: true } };
}

export function botName(lane: number): string {
  return DERBY_BOT_NAMES[lane] ?? `lane ${lane + 1}`;
}
