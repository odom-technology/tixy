'use client';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type RefObject,
} from 'react';

import { SoundManager } from '@/features/arcade/lib/sound-manager';
import { playHaptic, type HapticCue } from '@/features/arcade/lib/game-haptics';
import {
  createHitStop,
  createPitchLadder,
  createShake,
  feelReducedMotion,
  subscribeReducedMotion,
  type HitStop,
  type PitchLadder,
  type ShakeOffset,
} from '@/features/arcade/lib/game-feel';
import {
  useGameJuice,
  type GameJuiceKind,
} from '@/features/arcade/lib/use-game-juice';

/** Renderer-independent vocabulary used across wager, board, and action games. */
export type GameFeedbackEvent =
  | 'press'
  | 'move'
  | 'impact'
  | 'collect'
  | 'combo'
  | 'capture'
  | 'near-miss'
  | 'round-win'
  | 'loss'
  | 'cashout'
  | 'jackpot'
  | 'level-up';

export type GameFeedbackOptions = {
  /** Disable one side when the renderer already owns that feedback channel. */
  motion?: boolean;
  sound?: boolean;
  /** Haptics remain opt-in so desktop clicks and programmatic events stay inert. */
  haptic?: boolean;
  volume?: number;
  /** Frequency multiplier. Use `ladder.next()` for a pitch ladder. */
  pitch?: number;
  /**
   * Shake the stage with force 0 to 1 (2 to 4 px). Impacts only; ignored on
   * press and move. Nothing under reduced motion.
   */
  shake?: number;
  /**
   * Hit-stop: `true` for 50 ms or a length in ms (clamped to 40 to 60). The
   * biggest impact in a game only. 0 under reduced motion.
   */
  hitStop?: boolean | number;
};

export type UseGameFeedbackOptions = {
  /** DOM element to shake. Canvas games read `shakeOffset()` instead. */
  stage?: RefObject<HTMLElement | null>;
};

const EVENT_JUICE: Partial<Record<GameFeedbackEvent, Exclude<GameJuiceKind, 'idle'>>> = {
  impact: 'hit',
  collect: 'collect',
  combo: 'combo',
  capture: 'hit',
  'near-miss': 'near-miss',
  'round-win': 'win',
  loss: 'bust',
  cashout: 'cashout',
  jackpot: 'big-win',
  'level-up': 'level-up',
};

/** Exported so the build-time cue audit also covers indirect semantic plays. */
export const GAME_FEEDBACK_SOUND_CUES: Readonly<Record<GameFeedbackEvent, string>> = {
  press: 'arcadeBet',
  move: 'arcadeTick',
  impact: 'arcadeBounce',
  collect: 'arcadeReveal',
  combo: 'arcadeWin',
  capture: 'arcadeReveal',
  'near-miss': 'arcadeTick',
  'round-win': 'arcadeWin',
  loss: 'arcadeLose',
  cashout: 'arcadeCashout',
  jackpot: 'arcadeBigWin',
  'level-up': 'tetrisLevelUp',
};

/** Exported for the feel-kit verifier. Scoring ticks, wins get the heavy cue. */
export const GAME_FEEDBACK_HAPTICS: Readonly<Record<GameFeedbackEvent, HapticCue>> = {
  press: 'tap',
  move: 'tap',
  impact: 'medium',
  collect: 'tick',
  combo: 'tick',
  capture: 'medium',
  'near-miss': 'light',
  'round-win': 'win',
  loss: 'failure',
  cashout: 'win',
  jackpot: 'win',
  'level-up': 'success',
};

const INPUT_EVENTS: ReadonlySet<GameFeedbackEvent> = new Set(['press', 'move']);

/** Live reduced-motion flag for render code (true on the server). */
export function useFeelReducedMotion(): boolean {
  return useSyncExternalStore(subscribeReducedMotion, feelReducedMotion, () => true);
}

/** A pitch ladder that lives as long as the component. */
export function usePitchLadder(options?: { maxSteps?: number }): PitchLadder {
  const [ladder] = useState(() => createPitchLadder(options));
  return ladder;
}

export type FeedbackPlan = {
  /** Cue to play, or null. */
  sound: string | null;
  haptic: HapticCue | null;
  /** Shake force, 0 for none. */
  shake: number;
  /** Hit-stop length to request (undefined means the 50 ms default), or null. */
  hitStop: number | undefined | null;
  juice: Exclude<GameJuiceKind, 'idle'> | null;
};

/**
 * What one trigger does, without doing it. Pure, so the verifier can check
 * that press and move never shake or freeze.
 */
export function planFeedback(
  event: GameFeedbackEvent,
  options?: GameFeedbackOptions,
): FeedbackPlan {
  const input = INPUT_EVENTS.has(event);
  return {
    sound: options?.sound === false ? null : GAME_FEEDBACK_SOUND_CUES[event],
    haptic: options?.haptic ? GAME_FEEDBACK_HAPTICS[event] : null,
    shake: !input && options?.shake != null && options.shake > 0 ? options.shake : 0,
    hitStop:
      input || !options?.hitStop
        ? null
        : typeof options.hitStop === 'number'
          ? options.hitStop
          : undefined,
    juice: input || options?.motion === false ? null : (EVENT_JUICE[event] ?? null),
  };
}

let warnedUnreadHitStop = false;

/**
 * Coordinates semantic sound and stage motion without coupling either to game
 * rules. Rapid events can opt out of React-driven motion while retaining their
 * zero-latency procedural cue; major events receive the shared stage grammar.
 *
 * `trigger` is synchronous. `trigger('press')` touches no React state: it
 * plays a click and (with `haptic`) a tap, nothing else. Call it first thing
 * in the input handler, before any await, so every input answers this frame.
 */
export function useGameFeedback(options?: UseGameFeedbackOptions) {
  const { juice, trigger: triggerJuice, clear } = useGameJuice();
  const [hitStopClock] = useState<HitStop>(() => createHitStop());
  const [shake] = useState(() => createShake());
  const stageRef = options?.stage;
  const shakeFrame = useRef<number | null>(null);
  /** The stage's own inline translate, put back when the shake ends. */
  const priorTranslate = useRef<string | null>(null);

  const runDomShake = useCallback(() => {
    if (!stageRef || typeof requestAnimationFrame === 'undefined') return;
    if (shakeFrame.current != null) return;
    const step = () => {
      const element = stageRef.current;
      const now = performance.now();
      if (!element || !shake.active(now)) {
        if (element && priorTranslate.current !== null) {
          element.style.translate = priorTranslate.current;
        }
        priorTranslate.current = null;
        shakeFrame.current = null;
        return;
      }
      if (priorTranslate.current === null) priorTranslate.current = element.style.translate;
      const { x, y } = shake.offset(now);
      // The individual `translate` property composes with any transform
      // animation already on the stage (data-juice keyframes).
      element.style.translate = `${x}px ${y}px`;
      shakeFrame.current = requestAnimationFrame(step);
    };
    shakeFrame.current = requestAnimationFrame(step);
  }, [shake, stageRef]);

  useEffect(
    () => () => {
      if (shakeFrame.current != null) cancelAnimationFrame(shakeFrame.current);
      shakeFrame.current = null;
      const element = stageRef?.current;
      if (element && priorTranslate.current !== null) {
        element.style.translate = priorTranslate.current;
      }
      priorTranslate.current = null;
    },
    [stageRef],
  );

  const trigger = useCallback(
    (event: GameFeedbackEvent, options?: GameFeedbackOptions) => {
      const plan = planFeedback(event, options);
      if (plan.sound) {
        SoundManager.play(plan.sound, {
          volume: options?.volume,
          pitch: options?.pitch,
        });
      }
      if (plan.haptic) playHaptic(plan.haptic);
      if (INPUT_EVENTS.has(event)) return;
      if (plan.hitStop !== null) {
        hitStopClock.freeze(plan.hitStop);
        if (process.env.NODE_ENV !== 'production' && !warnedUnreadHitStop) {
          setTimeout(() => {
            if (hitStopClock.consulted || warnedUnreadHitStop) return;
            warnedUnreadHitStop = true;
            console.warn(
              '[feel] trigger({ hitStop }) fired but nothing reads hitStopClock. ' +
                'Pass it to createGameFrameLoop({ hitStop: hitStopClock }) or check isFrozen(). See FEEL.md.',
            );
          }, 250);
        }
      }
      if (plan.shake > 0) {
        shake.kick(plan.shake);
        if (shake.active()) runDomShake();
      }
      if (plan.juice) triggerJuice(plan.juice);
    },
    [hitStopClock, runDomShake, shake, triggerJuice],
  );

  /** Canvas games: add this to the camera each frame. {0, 0} when still. */
  const shakeOffset = useCallback(
    (now?: number): ShakeOffset => shake.offset(now),
    [shake],
  );

  return { juice, trigger, clear, hitStopClock, shakeOffset } as const;
}
