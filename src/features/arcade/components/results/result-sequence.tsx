'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type PointerEvent,
} from 'react';

import { useFeelReducedMotion } from '@/features/arcade/lib/use-game-feedback';

/* The clock behind the result, the ticket strip and the receipt. A result
   reveals in order: the outcome stamps in, the tickets print and the host
   brings them over, the XP counts into the level bar, a level up punches
   the badge, the season bar fills, then each achievement lands. Under 2 s,
   skippable with a tap. Reduced motion jumps every sequence to its end;
   sound is unchanged. */

export const STRIP_TIMING = {
  stampMs: 320,
  statsAt: 150,
  statsMs: 500,
  /** When the strip starts printing inside ArcadeRunResult. */
  stripAt: 300,
  /** When it starts on its own (ArcadeRunRewards without a result card). */
  stripAloneAt: 150,
  stubGap: 180,
  stubMs: 300,
  totalAfter: 120,
  totalMs: 450,
  tearAfter: 380,
  tearMs: 520,
  hostLead: 200,
  hostMs: 620,
  /** Everything has landed; the other actions come up. */
  actionsAt: 2000,
  /** The strip fits inside this, however many stubs it prints. */
  capMs: 2000,
} as const;

/* The rewards beside the strip, in ms from the result's first frame. The
   XP counts on the balance's 700 ms; the bar follows 120 ms behind. A level
   up fills the bar, then punches the badge to the new number. */
export const REVEAL_TIMING = {
  /** The level panel starts: the XP counts, the bar moves. */
  progressAt: 700,
  xpCountMs: 700,
  barDelay: 120,
  /** A level up: the bar runs to the end... */
  fillToLevelMs: 360,
  /** ...and the badge punches this long after the panel starts. */
  levelAfter: 500,
  punchMs: 460,
  /** A run across several levels steps through each one: up to this many
   *  levels, then the badge jumps to the last with a count. */
  stepsMax: 5,
  /** The steps after the first share this, one step at most `stepMaxMs`
   *  and at least `stepMinMs`, so the whole reveal stays near 1.8 s. */
  stepsBudgetMs: 800,
  stepMaxMs: 300,
  stepMinMs: 140,
  /** The season bar fills, after the level panel starts. */
  seasonAfter: 620,
  /** The first achievement lands, after the level panel starts. */
  achievementsAfter: 760,
  /** Between achievements. */
  achievementGap: 140,
} as const;

/* The receipt (ROADMAP.md, R1): the paper feeds out on one eased curve,
   the lines type in on a steady beat as it passes them, and the net lands
   last with one small settle. About 1 s from first frame to settled. */
export const RECEIPT_TIMING = {
  /** The paper feeding out of the printer. */
  feedMs: 720,
  /** The first line types in. */
  firstLineAt: 140,
  /** One line per beat after that. */
  beatMs: 95,
  /** The pause before the net lands, after the last line. */
  netPauseMs: 70,
  /** The net's settle. */
  netMs: 300,
  /** Reduced motion: the whole receipt fades in. */
  fadeMs: 180,
} as const;

/** Reduced motion, from the feel kit (kept live). */
export const useReducedMotion = useFeelReducedMotion;

export type ResultClock = {
  /** performance.now() when the result appeared. */
  startedAt: number;
  /** A tap skipped to the end. */
  skipped: boolean;
  /** Reduced motion: every sequence is already at its end. */
  instant: boolean;
  /** Past `actionsAt` (2 s) or skipped: the actions are up. */
  settled: boolean;
  skip: () => void;
  /** A strip or receipt reports whether it is still printing. */
  setPrinting: (id: string, printing: boolean) => void;
  printing: boolean;
};

const ResultClockContext = createContext<ResultClock | null>(null);
export const ResultClockProvider = ResultClockContext.Provider;

/** The clock of the enclosing ArcadeRunResult, if any. */
export function useParentResultClock() {
  return useContext(ResultClockContext);
}

/**
 * A clock that starts on mount; remount (a `key`) to start again.
 * `settleAt` is when the actions come up: 2 s when a strip prints, sooner
 * when there is nothing to print. It can change while the clock runs.
 */
export function useResultClock({
  settleAt = STRIP_TIMING.actionsAt,
}: { settleAt?: number } = {}): ResultClock {
  const instant = useReducedMotion();
  const [startedAt] = useState(() =>
    typeof performance === 'undefined' ? 0 : performance.now(),
  );
  const [skipped, setSkipped] = useState(false);
  const [capped, setCapped] = useState(false);
  const [printingIds, setPrintingIds] = useState<ReadonlySet<string>>(() => new Set());

  useEffect(() => {
    if (instant || skipped || capped) return;
    const remaining = settleAt - (performance.now() - startedAt);
    const timer = window.setTimeout(() => setCapped(true), Math.max(0, remaining));
    return () => window.clearTimeout(timer);
  }, [instant, skipped, capped, settleAt, startedAt]);

  const skip = useCallback(() => setSkipped(true), []);
  const setPrinting = useCallback((id: string, printing: boolean) => {
    setPrintingIds((current) => {
      if (current.has(id) === printing) return current;
      const next = new Set(current);
      if (printing) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  return useMemo(
    () => ({
      startedAt,
      skipped,
      instant,
      settled: instant || skipped || capped,
      skip,
      setPrinting,
      printing: printingIds.size > 0,
    }),
    [startedAt, skipped, instant, capped, skip, setPrinting, printingIds],
  );
}

/**
 * A tap while a sequence runs skips it. The pointerdown and the click that
 * follows it stop at the result, so a pointerdown or click handler on an
 * ancestor in the React tree (a stage overlay's "tap to play again") doesn't
 * also fire. It does not stop keyboard restarts or listeners on window or
 * document. Once everything is printed, taps pass through.
 */
export function useSkipOnTap(clock: ResultClock) {
  const busy = !clock.instant && !clock.skipped && (!clock.settled || clock.printing);
  const swallowClick = useRef(false);
  const onPointerDown = useCallback(
    (event: PointerEvent<HTMLElement>) => {
      if (!busy) return;
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      swallowClick.current = true;
      window.setTimeout(() => {
        swallowClick.current = false;
      }, 600);
      clock.skip();
    },
    [busy, clock],
  );
  const onClickCapture = useCallback((event: MouseEvent<HTMLElement>) => {
    if (!swallowClick.current) return;
    swallowClick.current = false;
    event.preventDefault();
    event.stopPropagation();
  }, []);
  return { onPointerDown, onClickCapture, 'data-sequence': busy ? 'running' : 'done' } as const;
}

/**
 * Runs `cues` (ms from now) once per `key`. Visual steps are skipped by
 * `stop`; sound cues still play under reduced motion (`instant`), at the
 * same times, because sound is unchanged there.
 */
export function useCueTimers(
  key: string | null,
  cues: ReadonlyArray<{ at: number; run: () => void }>,
  stop: boolean,
) {
  const cuesRef = useRef(cues);
  cuesRef.current = cues;
  const timersRef = useRef<number[]>([]);

  useEffect(() => {
    if (key == null) return;
    timersRef.current = cuesRef.current.map(({ at, run }) =>
      window.setTimeout(run, Math.max(0, at)),
    );
    const timers = timersRef.current;
    return () => {
      for (const timer of timers) window.clearTimeout(timer);
    };
  }, [key]);

  useEffect(() => {
    if (!stop) return;
    for (const timer of timersRef.current) window.clearTimeout(timer);
    timersRef.current = [];
  }, [stop]);
}
