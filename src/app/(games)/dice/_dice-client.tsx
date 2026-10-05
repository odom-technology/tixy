"use client";

import {
  useState,
  useCallback,
  useEffect,
  useRef,
  useMemo,
  type CSSProperties,
} from "react";
import { Dices } from "lucide-react";
import { useGamesWallet } from "@/features/arcade/components/shell/games-wallet-provider";
import {
  GameShell,
  GameStat,
  type GameHowTo,
} from "@/features/arcade/components/shell/game-shell";
import {
  ArcadeMachine,
  MachineButton,
  MachineChoice,
  MachineGlass,
  machineError,
  useMachineBet,
  useMachineKey,
} from "@/features/arcade/components/wagers/arcade-machine";
import { ArcadeWagerResultPlate } from "@/features/arcade/components/results/arcade-run-result";
import { useGameFeedback } from "@/features/arcade/lib/use-game-feedback";
import { SoundManager } from "@/features/arcade/lib/sound-manager";
import { playHaptic } from "@/features/arcade/lib/game-haptics";
import { ArcadeStub } from "@/features/arcade/components/ui/arcade-ui";
import { useWagerSession } from "@/features/arcade/lib/use-wager-session";
import { ARCADE_MIN_BET } from "@/server/arcade/arcade-constants";

/* ========================================================================== */
/*  Helpers                                                                   */
/* ========================================================================== */

type Direction = "over" | "under";

const RTP = 0.97;

const HOW_TO: GameHowTo = {
  lines: [
    "Set a number from 2 to 98, pick over or under, then roll.",
    "The roll is 1 to 100, and you win when it lands on your side of the number.",
    "A win pays 97 divided by your chance in percent: over 50 pays 1.94×, under 2 pays 97×.",
  ],
};

/** A server or rules error with a sentence ready for the notice. */
class RollError extends Error {}

function winChance(target: number, direction: Direction): number {
  return direction === "under" ? (target - 1) / 100 : (100 - target) / 100;
}

function calcMultiplier(target: number, direction: Direction): number {
  const wc = winChance(target, direction);
  if (wc <= 0) return 0;
  return Math.floor((RTP / wc) * 100) / 100;
}

function reconstructRoll(seed: number): number {
  let s = seed | 0;
  s = (s + 0x6d2b79f5) | 0;
  let t = Math.imul(s ^ (s >>> 15), 1 | s);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  const val = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  return Math.floor(val * 100) + 1;
}

// The roll is a die swinging across the gauge, then damping onto the number.
// It runs from the click, so latency never adds a dead beat: the swing holds
// for at least SWING_MIN_MS, then takes DAMP_MS to settle, about a second in
// all. The position is sampled every frame. Presentation only.
const SWING_PERIOD_MS = 880; // one sweep left and back
const SWING_MIN_MS = 450; // swing at least this long before it settles
const DAMP_MS = 520; // the settle onto the rolled number
const SWING_REACH = 44; // how far from the middle the swing goes, in points

const easeOut = (x: number) => 1 - Math.pow(1 - x, 3);

/* ========================================================================== */
/*  Component                                                                 */
/* ========================================================================== */

export default function DiceClient() {
  const { trigger: triggerFeedback } = useGameFeedback();
  const {
    wallet,
    loaded: walletLoaded,
    refresh: refreshWallet,
    adjustCredits,
  } = useGamesWallet();
  const balance = walletLoaded ? wallet.credits : null;
  const [isRolling, setIsRolling] = useState(false);
  const [wager, setWager] = useMachineBet(balance, 10, { locked: isRolling });
  const [target, setTarget] = useState(50);
  const [direction, setDirection] = useState<Direction>("over");
  const [error, setError] = useState<string | null>(null);
  const [roundId, setRoundId] = useState<string | null>(null);
  // The settings the last roll was bought with; the plate and receipt print them.
  const [settledCall, setSettledCall] = useState<string>("");

  // The die's place on the gauge, in roll points (1 to 100, fractional while
  // it swings). Null until the first roll.
  const [track, setTrack] = useState<number | null>(null);
  // The settled roll.
  const [rollIndicator, setRollIndicator] = useState<number | null>(null);
  const [rollWon, setRollWon] = useState<boolean | null>(null);
  const [lastPayout, setLastPayout] = useState<number | null>(null);
  const [lastMult, setLastMult] = useState<number | null>(null);
  const [settledWager, setSettledWager] = useState(10);

  // The swing in flight: when it began, where the die was, and (once the
  // server has answered) the number it settles on and when it starts to.
  const swingRef = useRef<{
    start: number;
    from: number;
    final: number | null;
    settleAt: number;
    onLand: () => void;
  } | null>(null);
  const frameRef = useRef<number | null>(null);
  const trackRef = useRef(50);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (frameRef.current != null) cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
      swingRef.current = null;
    };
  }, []);

  // Provably fair (hook also owns the session/settle round-trips)
  const {
    revealedSeed,
    start: startSession,
    settle: settleSession,
    achievements,
  } = useWagerSession("arcade-dice");

  // One frame loop for the swing: the die and the number follow `v`.
  const runSwing = useCallback(() => {
    const tick = (now: number) => {
      const swing = swingRef.current;
      if (!swing) {
        frameRef.current = null;
        return;
      }
      const t = now - swing.start;
      // The swing eases out from where the die was, around the middle.
      const e = easeOut(Math.min(1, t / 200));
      const centre = swing.from + (50.5 - swing.from) * e;
      const swung =
        centre +
        SWING_REACH * e * Math.sin((2 * Math.PI * t) / SWING_PERIOD_MS);
      let v = swung;
      let done = false;
      if (swing.final != null && now >= swing.settleAt) {
        const w = easeOut(Math.min(1, (now - swing.settleAt) / DAMP_MS));
        v = swing.final * w + swung * (1 - w);
        done = w >= 1;
      }
      trackRef.current = v;
      setTrack(v);
      if (done) {
        frameRef.current = null;
        swingRef.current = null;
        swing.onLand();
        return;
      }
      frameRef.current = requestAnimationFrame(tick);
    };
    frameRef.current = requestAnimationFrame(tick);
  }, []);

  // ─── Roll ─────────────────────────────────────────────────────────────
  const handleRoll = useCallback(async () => {
    if (isRolling) return;
    if (wager < ARCADE_MIN_BET) {
      setError(`The smallest bet is ${ARCADE_MIN_BET} tickets.`);
      return;
    }
    if (balance == null || wager > balance) {
      setError(`You need ${wager} tickets for this bet.`);
      return;
    }

    setError(null);
    setIsRolling(true);
    setSettledWager(wager);
    setSettledCall(`${direction} ${target}`);
    setRoundId(null);
    SoundManager.play("arcadeRoll");
    playHaptic("tap");

    // Optimistic debit
    adjustCredits(-wager);

    setRollIndicator(null);
    setRollWon(null);
    setLastPayout(null);
    setLastMult(null);

    const currentTarget = target;
    const currentDirection = direction;
    const currentWager = wager;

    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    // The die starts swinging on the click and keeps going until the server
    // answers.
    if (frameRef.current != null) cancelAnimationFrame(frameRef.current);
    swingRef.current = null;
    if (!reduced) {
      swingRef.current = {
        start: performance.now(),
        from: trackRef.current,
        final: null,
        settleAt: 0,
        onLand: () => undefined,
      };
      runSwing();
    }

    const stopSwing = () => {
      if (frameRef.current != null) cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
      swingRef.current = null;
    };

    try {
      const session = await startSession(currentWager, {
        target: currentTarget,
        direction: currentDirection,
      });
      if (!session.ok)
        throw new RollError(
          machineError(session.error, "The machine could not start the round."),
        );

      const settled = await settleSession<{
        seed: number;
        payout: number;
        multiplier: number;
        roundId?: string | null;
      }>();
      if (!settled.ok)
        throw new RollError(
          machineError(
            settled.error,
            "The roll did not go through. Try again.",
          ),
        );
      const settleData = settled.data;
      if (!mountedRef.current) return;

      const roll = reconstructRoll(settleData.seed);
      const won =
        currentDirection === "under"
          ? roll < currentTarget
          : roll > currentTarget;

      // The number, the plate, the sound and the haptic all land together,
      // when the die does.
      const land = () => {
        if (!mountedRef.current) return;
        trackRef.current = roll;
        setTrack(roll);
        setRollIndicator(roll);
        setRollWon(won);
        setLastPayout(settleData.payout);
        setLastMult(settleData.multiplier);
        setRoundId(settleData.roundId ?? null);
        triggerFeedback(
          won ? (settleData.multiplier >= 5 ? "jackpot" : "round-win") : "loss",
        );
        playHaptic(won ? "success" : "failure");
        setIsRolling(false);
      };

      const swing = swingRef.current;
      if (swing) {
        swing.final = roll;
        swing.settleAt = Math.max(
          performance.now(),
          swing.start + SWING_MIN_MS,
        );
        swing.onLand = land;
      } else {
        land();
      }

      void refreshWallet();
    } catch (err) {
      stopSwing();
      if (!mountedRef.current) return;
      setError(
        err instanceof RollError
          ? err.message
          : "The machine lost its connection. Try again.",
      );
      setIsRolling(false);
      void refreshWallet();
    }
  }, [
    isRolling,
    wager,
    balance,
    target,
    direction,
    refreshWallet,
    adjustCredits,
    startSession,
    settleSession,
    triggerFeedback,
    runSwing,
  ]);

  // Space rolls (the machine hook ignores presses on controls and fields)
  useMachineKey(useMemo(() => () => void handleRoll(), [handleRoll]));

  // ─── Computed ──────────────────────────────────────────────────────────
  const wc = winChance(target, direction);
  const mult = calcMultiplier(target, direction);
  const potentialPayout = Math.floor(wager * mult);
  const affordable = balance != null && wager <= balance;
  const settled = rollIndicator != null && rollWon != null && !isRolling;

  // The gauge, in percent of its width. Roll n takes the cell from n - 1 to n,
  // so the number you chose is a loss on both sides: over 50 wins from 51 up
  // (the win zone starts at 50%), under 50 wins up to 49 (it ends at 49%).
  const winFrom = direction === "over" ? target : 0;
  const winTo = direction === "over" ? 100 : target - 1;
  const markerAt = direction === "over" ? target : target - 1;
  const loseFrom = direction === "over" ? 0 : target - 1;
  const loseTo = direction === "over" ? target : 100;
  const dieAt = Math.min(100, Math.max(0, (track ?? 50) - 0.5));
  const shownRoll = Math.min(100, Math.max(1, Math.round(track ?? 50)));
  // A zone label shows when its zone is wide enough to hold it.
  const winLabel = winTo - winFrom >= 14;
  const loseLabel = loseTo - loseFrom >= 14;

  const net = (lastPayout ?? 0) - settledWager;
  const tone = settled ? (rollWon ? "win" : "loss") : "idle";
  const readoutMain = isRolling
    ? "rolling"
    : settled
      ? rollWon
        ? "you win"
        : "you lose"
      : `${direction} ${target}`;
  const readoutSub = isRolling
    ? `Win when the roll is ${direction} ${target}.`
    : settled
      ? rollWon
        ? `Rolled ${rollIndicator}, ${settledCall}. Paid ${(lastPayout ?? 0).toLocaleString()} at ${lastMult}×.`
        : `Rolled ${rollIndicator}, not ${settledCall}. Bet of ${settledWager.toLocaleString()} lost.`
      : `Win when the roll is ${direction} ${target}: ${(wc * 100).toFixed(0)}% chance, pays ${mult.toFixed(2)}×.`;

  const screen = (
    <div className="arc-machine-fit dice-screen">
      {/* The rolled number, big. It counts as the die swings and lands with it. */}
      <p
        className="dice-number arcade-num"
        data-tone={tone}
        data-rolling={isRolling || undefined}
        aria-hidden
      >
        {track == null ? "?" : settled ? rollIndicator : shownRoll}
      </p>

      <div className="dice-readout" data-tone={tone}>
        <p className="dice-readout-main">{readoutMain}</p>
        <p className="dice-readout-sub">{readoutSub}</p>
        {tone === "win" ? (
          <ArcadeStub size="lg" className="dice-readout-side">
            +{net.toLocaleString()}
          </ArcadeStub>
        ) : tone === "loss" ? (
          <p className="dice-readout-side dice-readout-net">
            {`−${(settledWager - (lastPayout ?? 0)).toLocaleString()}`}
          </p>
        ) : null}
      </div>

      {/* Screen-reader round status: the visual readout is decorative while
          a roll resolves; only settled outcomes are announced. */}
      <p className="sr-only" role="status">
        {settled
          ? rollWon
            ? `Rolled ${rollIndicator}, won ${(lastPayout ?? 0).toLocaleString()} tickets.`
            : `Rolled ${rollIndicator}, missed.`
          : ""}
      </p>

      {/* The gauge: the win range is red, the rest quiet, the number you
          chose is a marked line with its label, and the die swings along it. */}
      <div
        className="dice-gauge"
        style={
          {
            "--win-from": `${winFrom}%`,
            "--win-to": `${winTo}%`,
            "--lose-from": `${loseFrom}%`,
            "--lose-to": `${loseTo}%`,
            "--marker": `${markerAt}%`,
            "--die": `${dieAt}%`,
          } as CSSProperties
        }
      >
        <div className="dice-track">
          <span className="dice-zone dice-zone-lose">
            {loseLabel ? "lose" : null}
          </span>
          <span className="dice-zone dice-zone-win">
            {winLabel ? "win" : null}
          </span>
        </div>
        <div className="dice-marker" aria-hidden>
          <span
            className="dice-marker-tag arcade-num"
            data-edge={
              markerAt < 14 ? "left" : markerAt > 86 ? "right" : undefined
            }
          >
            {direction} {target}
          </span>
        </div>
        <div
          className="dice-die"
          data-tone={tone}
          data-shown={track != null || undefined}
          aria-hidden
        >
          <Dices size="55%" aria-hidden />
        </div>
        {/* Etched scale labels under the gauge */}
        <div className="dice-scale" aria-hidden>
          {[1, 25, 50, 75, 100].map((n) => (
            <span key={n} className="arcade-num">
              {n}
            </span>
          ))}
        </div>
      </div>

      <style jsx global>{`
        .arc-shell[data-game="dice"] .arc-machine-frame:not([data-wide]) {
          --machine-screen-min: 17rem;
        }
        .dice-screen {
          --dice-track: clamp(2.5rem, 8cqh, 4.25rem);
          --dice-plate: 5.25rem;
          gap: clamp(0.5rem, 2cqh, 1.25rem);
          padding: 0.75rem clamp(0.75rem, 4cqi, 2rem);
          background: var(--screen-well);
        }
        .dice-screen > * {
          width: min(100%, 52rem);
        }
        /* the rolled number: the biggest thing on the screen */
        .dice-number {
          margin: 0;
          flex: none;
          font-size: clamp(3.25rem, min(22cqi, 20cqh), 10rem);
          font-weight: var(--tixy-weight-num);
          line-height: 0.95;
          letter-spacing: var(--tixy-tracking-num);
          text-align: center;
          color: var(--tixy-paper);
        }
        .dice-number[data-tone="idle"]:not([data-rolling]) {
          color: var(--tixy-on-ink-3);
        }
        .dice-number[data-tone="loss"] {
          color: var(--tixy-on-ink-2);
        }
        /* the plate under it: red for a win, an ink plate for a loss */
        .dice-readout {
          display: grid;
          flex: none;
          grid-template-columns: minmax(0, 1fr) auto;
          grid-template-areas:
            "main side"
            "sub  side";
          align-items: center;
          column-gap: 1rem;
          box-sizing: border-box;
          height: var(--dice-plate);
          padding: 0.375rem 1rem;
          border-radius: var(--tixy-radius-panel-sm);
          color: var(--tixy-paper);
        }
        .dice-readout[data-tone="idle"] {
          padding-inline: 0;
          justify-items: center;
          text-align: center;
          grid-template-columns: minmax(0, 1fr);
          grid-template-areas: "main" "sub";
        }
        .dice-readout[data-tone="win"] {
          background: var(--tixy-red);
          color: var(--tixy-on-red);
        }
        .dice-readout[data-tone="loss"] {
          background: var(--tixy-screen-2);
        }
        .dice-readout-main {
          grid-area: main;
          margin: 0;
          font-family: var(--tixy-font-num);
          font-size: 2rem;
          font-weight: var(--tixy-weight-num);
          line-height: 1.1;
          letter-spacing: var(--tixy-tracking-num);
        }
        .dice-readout-sub {
          grid-area: sub;
          margin: 0.125rem 0 0;
          overflow: hidden;
          font-size: 0.9375rem;
          line-height: 1.25;
          color: var(--tixy-on-ink-2);
          text-overflow: ellipsis;
          display: -webkit-box;
          -webkit-box-orient: vertical;
          -webkit-line-clamp: 2;
        }
        .dice-readout[data-tone="win"] .dice-readout-sub {
          color: var(--tixy-on-red);
        }
        .dice-readout-side {
          grid-area: side;
        }
        .dice-readout-net {
          margin: 0;
          font-family: var(--tixy-font-num);
          font-size: 2.25rem;
          font-weight: var(--tixy-weight-num);
          line-height: 1;
          color: var(--tixy-on-ink-2);
        }
        /* the gauge: a track 2.5 to 4.25 rem thick, with room above for the label
           and below for the scale */
        .dice-gauge {
          position: relative;
          flex: none;
          height: calc(var(--dice-track) + 4rem);
        }
        .dice-track {
          position: absolute;
          top: 2.25rem;
          left: 0;
          right: 0;
          height: var(--dice-track);
          overflow: hidden;
          border-radius: 10px;
          background: var(--tixy-screen-2);
        }
        .dice-zone {
          position: absolute;
          top: 0;
          bottom: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 0.9375rem;
          font-weight: var(--tixy-weight-button);
          transition:
            left var(--tixy-panel-fast) ease-out,
            width var(--tixy-panel-fast) ease-out;
        }
        .dice-zone-win {
          left: var(--win-from);
          width: calc(var(--win-to) - var(--win-from));
          background: var(--tixy-red);
          color: var(--tixy-on-red);
        }
        .dice-zone-lose {
          left: var(--lose-from);
          width: calc(var(--lose-to) - var(--lose-from));
          color: var(--tixy-on-ink-3);
        }
        /* the number you chose: a line through the track, labelled above */
        .dice-marker {
          position: absolute;
          top: 1.5rem;
          bottom: 1.25rem;
          left: var(--marker);
          width: 3px;
          margin-left: -1.5px;
          border-radius: 2px;
          background: var(--tixy-paper);
          transition: left var(--tixy-panel-fast) ease-out;
        }
        .dice-marker-tag {
          position: absolute;
          bottom: 100%;
          left: 50%;
          padding: 0.0625rem 0.5rem;
          border-radius: 6px;
          background: var(--tixy-paper);
          color: var(--tixy-ink);
          font-size: 1.125rem;
          font-weight: var(--tixy-weight-num);
          line-height: 1.3;
          white-space: nowrap;
          transform: translateX(-50%);
        }
        /* near an end the label sits inside the gauge instead of past it */
        .dice-marker-tag[data-edge="left"] {
          left: 0;
          transform: translateX(-1.5px);
        }
        .dice-marker-tag[data-edge="right"] {
          left: auto;
          right: 0;
          transform: translateX(1.5px);
        }
        /* the die: a paper chip that rides the track; red when the roll won,
           an ink chip when it lost */
        .dice-die {
          position: absolute;
          top: 2.25rem;
          left: var(--die);
          display: flex;
          align-items: center;
          justify-content: center;
          width: var(--dice-track);
          height: var(--dice-track);
          margin-left: calc(var(--dice-track) / -2);
          border-radius: 10px;
          background: var(--tixy-paper);
          color: var(--tixy-ink);
          box-shadow: 0 3px 0 #00000059;
          opacity: 0;
        }
        .dice-die[data-shown] {
          opacity: 1;
        }
        .dice-die[data-tone="win"] {
          background: var(--tixy-red);
          color: var(--tixy-on-red);
        }
        .dice-die[data-tone="loss"] {
          background: var(--tixy-screen-2);
          color: var(--tixy-on-ink-2);
          box-shadow:
            0 3px 0 #00000059,
            inset 0 0 0 2px var(--tixy-on-ink-3);
        }
        .dice-scale {
          position: absolute;
          bottom: 0;
          left: 0;
          right: 0;
          display: flex;
          justify-content: space-between;
          font-size: 0.9375rem;
          color: var(--tixy-on-ink-3);
        }
        /* a short screen (a phone): a smaller plate, so the slider under it
           stays on the page */
        @container (max-height: 26rem) {
          .dice-screen {
            --dice-plate: 4.75rem;
            gap: 0.5rem;
          }
          .dice-readout-main {
            font-size: 1.75rem;
          }
        }
        @media (prefers-reduced-motion: no-preference) {
          .dice-readout[data-tone="win"],
          .dice-readout[data-tone="loss"],
          .dice-number:not([data-tone="idle"]):not([data-rolling]) {
            animation: arc-stub-pop var(--motion-reveal) var(--ease-spring) both;
          }
          .dice-die:not([data-tone="idle"]) {
            animation: arc-stub-pop var(--motion-reveal) var(--ease-spring) both;
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .dice-zone,
          .dice-marker {
            transition: none;
          }
        }
      `}</style>
    </div>
  );

  const action = (
    <MachineButton
      onClick={() => void handleRoll()}
      disabled={!affordable || wager < ARCADE_MIN_BET}
      aria-disabled={isRolling || undefined}
      aria-label={`roll, ${wager} tickets`}
    >
      roll
    </MachineButton>
  );

  const pickDirection = (next: Direction) => {
    if (next === direction) return;
    SoundManager.play("arcadeBet");
    playHaptic("light");
    setDirection(next);
  };

  const controls = (
    <>
      <MachineChoice
        label="win when the roll is"
        options={[
          { value: "under", label: `under ${target}` },
          { value: "over", label: `over ${target}` },
        ]}
        value={direction}
        onChange={pickDirection}
        disabled={isRolling}
      />
      <div className="dice-target">
        <label htmlFor="dice-target" className="arc-machine-label">
          number <span className="arcade-num">{target}</span>
        </label>
        <input
          id="dice-target"
          type="range"
          min={2}
          max={98}
          value={target}
          onChange={(e) => setTarget(Number(e.target.value))}
          disabled={isRolling}
          className="dice-slider"
        />
      </div>
      <style jsx global>{`
        .dice-target {
          width: 20rem;
          max-width: 100%;
        }
        .dice-slider {
          display: block;
          width: 100%;
          height: 2.75rem;
          appearance: none;
          background: transparent;
          cursor: pointer;
        }
        .dice-slider:disabled {
          cursor: not-allowed;
          opacity: 0.5;
        }
        .dice-slider::-webkit-slider-runnable-track {
          height: 6px;
          border-radius: 9999px;
          background: var(--tixy-screen);
        }
        .dice-slider::-moz-range-track {
          height: 6px;
          border-radius: 9999px;
          background: var(--tixy-screen);
        }
        .dice-slider::-webkit-slider-thumb {
          appearance: none;
          width: 1.25rem;
          height: 1.25rem;
          margin-top: -7px;
          border-radius: 9999px;
          background: var(--tixy-paper);
        }
        .dice-slider::-moz-range-thumb {
          width: 1.25rem;
          height: 1.25rem;
          border: 0;
          border-radius: 9999px;
          background: var(--tixy-paper);
        }
        .dice-slider:focus-visible {
          outline: 2px solid var(--tixy-paper);
          outline-offset: 2px;
        }
      `}</style>
    </>
  );

  const receipt = settled ? (
    <ArcadeWagerResultPlate
      result={{
        payout: lastPayout ?? 0,
        stake: settledWager,
        multiplier: lastMult,
      }}
      kicker="dice"
      headline={String(rollIndicator)}
      detail={settledCall}
      fairness={{ seedHash: null, revealedSeed }}
      achievements={achievements}
      roundId={roundId ?? undefined}
      sound={false}
    />
  ) : null;

  return (
    <GameShell
      game="dice"
      stat={<GameStat value={`${mult.toFixed(2)}×`} label="pays" />}
      howTo={HOW_TO}
    >
      <ArcadeMachine
        name="dice"
        glass={
          <MachineGlass
            name="dice"
            rules={["Roll 1 to 100. Land on your side of the number to win."]}
            paytable={[
              { label: "chance", value: `${(wc * 100).toFixed(0)}%` },
              {
                label: "pays",
                value: `${mult.toFixed(2)}×`,
                lit: settled && rollWon === true,
              },
              { label: "on a win", value: potentialPayout.toLocaleString() },
            ]}
          />
        }
        action={action}
        bet={{
          value: wager,
          onChange: (v) => {
            playHaptic("light");
            setWager(v);
          },
          balance,
          disabled: isRolling,
        }}
        controls={controls}
        receipt={receipt}
        receiptKey={roundId}
        notice={error}
      >
        {screen}
      </ArcadeMachine>
    </GameShell>
  );
}
