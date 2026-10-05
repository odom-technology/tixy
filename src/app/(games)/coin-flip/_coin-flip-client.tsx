"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { GameInventoryButton } from "@/features/arcade/components/game-inventory-button";
import { GameInventoryModal } from "@/features/arcade/components/game-inventory-modal";
import {
  GameShell,
  GameStat,
  type GameHowTo,
} from "@/features/arcade/components/shell/game-shell";
import {
  ArcadeMachine,
  MachineButton,
  MachineGlass,
  machineError,
  useMachineBet,
  useMachineKey,
} from "@/features/arcade/components/wagers/arcade-machine";
import { ArcadeWagerResultPlate } from "@/features/arcade/components/results/arcade-run-result";
import { useGameFeedback } from "@/features/arcade/lib/use-game-feedback";
import { SoundManager } from "@/features/arcade/lib/sound-manager";
import { playHaptic } from "@/features/arcade/lib/game-haptics";
import { XpGainBurst } from "@/features/arcade/components/xp-gain-burst";
import type { AccountXpReward } from "@/server/arcade/rewards/types";
import { useArcadeRunResult } from "@/features/arcade/lib/run-result";
import { useRollingNumber } from "@/features/arcade/lib/use-rolling-number";
import { formatNum } from "@/features/arcade/components/ui/num-format";
import { ARCADE_MIN_BET } from "@/server/arcade/arcade-constants";
import {
  buildCoinFlipTheme,
  DEFAULT_COIN_FLIP_THEME,
  type CoinFlipTheme,
} from "./_coin-flip-theme";

type CoinFace = "heads" | "tails";
type GamePhase = "ready" | "flipping" | "resolved";

type InventoryPayload = {
  wallet?: { credits?: number };
  dailyGameCredits?: { earned?: number; cap?: number };
  equipped?: {
    slot: string;
    item: { assetRef: Record<string, unknown> | null };
  }[];
};

type CoinFlipActionResponse = {
  result: CoinFace;
  pickedSide: CoinFace;
  won: boolean;
  payout: number;
  multiplier: number;
  seed: number;
  roundId?: string | null;
  account?: AccountXpReward | null;
};

const WIN_MULTIPLIER = 1.94;

// The toss is one ballistic arc with a spin riding on it. Height is a
// parabola in flight progress `p` (0 at the hand, 1 on the table); the
// coin leaves on click and, until the result is in, hangs at the top of
// the arc still spinning. When the result arrives the spin is bent a
// little over the rest of the fall so it lands flat on the right face,
// with no snap.
const TOSS_MS = 1100;
/** Spin, in degrees a second: about 4 turns over a toss. */
const SPIN_DEG_S = 1500;
/** The spin ramps up over this long, so the throw has no pop. */
const SPIN_RAMP_MS = 140;
/** One small bounce on the table after it lands. */
const SETTLE_MS = 240;
const SETTLE_BOUNCE = 0.07;
const FACE_DEG: Record<CoinFace, number> = { heads: 0, tails: 180 };

type Toss = {
  last: number;
  elapsed: number;
  /** Flight progress, 0 to 1. */
  p: number;
  /** Degrees about the horizontal axis. */
  angle: number;
  /** The result, once known. `null` face: bring it down on either face. */
  pending: { face: CoinFace | null; land: (() => void) | null } | null;
  /** The descent, once the result has been taken in. */
  plan: {
    t: number;
    p0: number;
    angle0: number;
    spin: number;
    bend: number;
    ms: number;
    land: (() => void) | null;
  } | null;
  /** Seconds into the settle, or null while in the air. */
  settle: number | null;
  /** Peak height in px, measured at the throw. */
  height: number;
};

/** Room under the coin for its shadow on the table, in px. */
const COIN_TABLE_PX = 24;

const smooth = (u: number) => u * u * (3 - 2 * u);

const HOW_TO: GameHowTo = {
  lines: [
    "Pick a bet, then press heads or tails to flip.",
    "The coin lands heads or tails, one in two each.",
    `A right call pays ${WIN_MULTIPLIER}×: 10 tickets returns 19 or 20.`,
  ],
};

/** A server error with a sentence ready for the notice. */
class FlipError extends Error {}
const STAR_LAYOUT = [
  { left: "8%", top: "14%", size: "h-1.5 w-1.5", delay: "0s" },
  { left: "18%", top: "30%", size: "h-1 w-1", delay: "0.8s" },
  { left: "32%", top: "10%", size: "h-1.5 w-1.5", delay: "1.6s" },
  { left: "48%", top: "22%", size: "h-1 w-1", delay: "0.4s" },
  { left: "62%", top: "12%", size: "h-1.5 w-1.5", delay: "1.1s" },
  { left: "76%", top: "28%", size: "h-1 w-1", delay: "0.2s" },
  { left: "86%", top: "16%", size: "h-1.5 w-1.5", delay: "1.9s" },
];
const PARTICLE_LAYOUT = [
  { left: "12%", top: "72%", size: 84, opacity: 0.12 },
  { left: "38%", top: "82%", size: 112, opacity: 0.1 },
  { left: "68%", top: "70%", size: 96, opacity: 0.12 },
  { left: "88%", top: "78%", size: 72, opacity: 0.08 },
];

export default function CoinFlipClient() {
  const { trigger: triggerFeedback } = useGameFeedback();
  const {
    achievements,
    capture: captureRunResult,
    reset: resetRunResult,
  } = useArcadeRunResult();
  const [phase, setPhase] = useState<GamePhase>("ready");
  const [walletBalances, setWalletBalances] = useState({
    credits: 0,
  });
  const [walletLoaded, setWalletLoaded] = useState(false);
  const balance = walletLoaded ? walletBalances.credits : null;
  const [wager, setWager] = useMachineBet(balance, 10, {
    locked: phase === "flipping",
  });
  const [roundId, setRoundId] = useState<string | null>(null);
  const [theme, setTheme] = useState<CoinFlipTheme>(DEFAULT_COIN_FLIP_THEME);
  const [showInventory, setShowInventory] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentPick, setCurrentPick] = useState<CoinFace | null>(null);
  // Last side actually wagered — survives New Round so Space can re-flip it.
  const [lastSide, setLastSide] = useState<CoinFace | null>(null);
  const [runAccountXp, setRunAccountXp] = useState<AccountXpReward | null>(
    null,
  );
  const [lastResult, setLastResult] = useState<CoinFace | null>(null);
  const [didWin, setDidWin] = useState<boolean | null>(null);
  const [lastPayout, setLastPayout] = useState<number | null>(null);
  const [lastMultiplier, setLastMultiplier] = useState<number | null>(null);
  const [settledWager, setSettledWager] = useState(25);
  const [revealedSeed, setRevealedSeed] = useState<number | null>(null);
  // The coin is off the table: the skin's trail runs while it is.
  const [inFlight, setInFlight] = useState(false);

  // The toss runs on refs and writes the coin's transform straight to the
  // DOM each frame, so React never renders mid-flight.
  const stageRef = useRef<HTMLDivElement>(null);
  const liftRef = useRef<HTMLDivElement>(null);
  const coinRef = useRef<HTMLDivElement>(null);
  const shadowRef = useRef<HTMLDivElement>(null);
  const tossRef = useRef<Toss | null>(null);
  const frameRef = useRef<number | null>(null);
  // Where the coin rests between tosses: 0 shows heads, 180 shows tails.
  const restAngleRef = useRef(0);
  const mountedRef = useRef(true);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setPrefersReducedMotion(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  const loadWalletAndTheme = useCallback(async () => {
    try {
      const response = await fetch("/api/store/inventory?gameType=coin-flip", {
        cache: "no-store",
      });
      if (!response.ok) return;
      const payload = (await response.json()) as InventoryPayload;
      if (!mountedRef.current) return;
      setWalletBalances({
        credits: payload.wallet?.credits ?? 0,
      });
      setWalletLoaded(true);
      if (payload.equipped) {
        setTheme(buildCoinFlipTheme(payload.equipped));
      }
    } catch {
      if (!mountedRef.current) return;
      setWalletBalances({ credits: 0 });
    }
  }, []);

  useEffect(() => {
    void loadWalletAndTheme();
    const onInventoryUpdated = () => void loadWalletAndTheme();
    window.addEventListener("store-inventory-updated", onInventoryUpdated);
    return () =>
      window.removeEventListener("store-inventory-updated", onInventoryUpdated);
  }, [loadWalletAndTheme]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      tossRef.current = null;
      if (frameRef.current != null) cancelAnimationFrame(frameRef.current);
    };
  }, []);

  const refreshWallet = useCallback(async () => {
    await loadWalletAndTheme();
  }, [loadWalletAndTheme]);

  /* ---------- The toss ---------- */

  /** Draw the coin at a height (px) and angle: lift and scale, spin, and the
   *  shadow on the table, which shrinks and fades as the coin climbs. */
  const drawCoin = useCallback((lift: number, peak: number, angle: number) => {
    const rise = peak > 0 ? Math.min(1.2, Math.max(0, lift / peak)) : 0;
    if (liftRef.current) {
      liftRef.current.style.transform = `translate3d(0, ${-lift}px, 0) scale(${1 + 0.1 * rise})`;
    }
    if (coinRef.current) {
      coinRef.current.style.transform = `rotateX(${angle}deg)`;
    }
    if (shadowRef.current) {
      shadowRef.current.style.transform = `scaleX(${1 - 0.5 * rise})`;
      shadowRef.current.style.opacity = String(1 - 0.65 * rise);
    }
  }, []);

  const tossFrame = useCallback(
    (now: number) => {
      frameRef.current = null;
      const s = tossRef.current;
      if (!s || !mountedRef.current) return;
      const dt = Math.min(48, now - s.last);
      s.last = now;
      s.elapsed += dt;

      if (s.settle != null) {
        // On the table: one small bounce, flat on its face.
        s.settle += dt;
        const u = Math.min(1, s.settle / SETTLE_MS);
        drawCoin(
          s.height * SETTLE_BOUNCE * Math.sin(Math.PI * u),
          s.height,
          s.angle,
        );
        if (u >= 1) {
          s.angle = ((s.angle % 360) + 360) % 360;
          restAngleRef.current = s.angle;
          drawCoin(0, s.height, s.angle);
          tossRef.current = null;
          return;
        }
      } else if (s.plan) {
        // The descent: the same fall, with the spin bent onto the face.
        const plan = s.plan;
        plan.t += dt;
        const u = Math.min(1, plan.t / plan.ms);
        s.p = plan.p0 + (1 - plan.p0) * u;
        s.angle = plan.angle0 + plan.spin * u + plan.bend * smooth(u);
        drawCoin(s.height * 4 * s.p * (1 - s.p), s.height, s.angle);
        if (u >= 1) {
          s.settle = 0;
          setInFlight(false);
          plan.land?.();
        }
      } else {
        // Open-ended: up and over the top, hanging there until the result is
        // in. The spin ramps in, so the throw has no pop.
        const ramp = Math.min(1, s.elapsed / SPIN_RAMP_MS);
        s.angle += SPIN_DEG_S * (1 - (1 - ramp) * (1 - ramp)) * (dt / 1000);
        s.p = Math.min(0.5, s.p + dt / TOSS_MS);
        drawCoin(s.height * 4 * s.p * (1 - s.p), s.height, s.angle);

        // Take the result in once the spin is up to speed.
        if (s.pending && s.elapsed >= SPIN_RAMP_MS) {
          const ms = (1 - s.p) * TOSS_MS;
          const spin = SPIN_DEG_S * (ms / 1000);
          const end = s.angle + spin;
          // The face to land on nearest the spin's natural end: the bend
          // stays under half a turn.
          const aim = (face: CoinFace) =>
            FACE_DEG[face] +
            360 * Math.round((end - FACE_DEG[face]) / 360) -
            end;
          const bends = s.pending.face
            ? [aim(s.pending.face)]
            : [aim("heads"), aim("tails")];
          const bend = bends.reduce((a, b) =>
            Math.abs(b) < Math.abs(a) ? b : a,
          );
          s.plan = {
            t: 0,
            p0: s.p,
            angle0: s.angle,
            spin,
            bend,
            ms,
            land: s.pending.land,
          };
        }
      }
      frameRef.current = requestAnimationFrame(tossFrame);
    },
    [drawCoin],
  );

  /** Throw the coin now. It does not wait for the network. */
  const startToss = useCallback(() => {
    if (prefersReducedMotion) {
      // No flight: the coin stays put until it shows the result.
      setInFlight(false);
      return;
    }
    const stage = stageRef.current;
    const coin = coinRef.current;
    // Peak height: as far as the stage allows without touching the status
    // line above it. The coin sits on the table row at the stage's foot.
    const room =
      stage && coin
        ? stage.clientHeight - coin.offsetHeight * 1.12 - COIN_TABLE_PX
        : 120;
    tossRef.current = {
      last: performance.now(),
      elapsed: 0,
      p: 0,
      angle: restAngleRef.current,
      pending: null,
      plan: null,
      settle: null,
      height: Math.max(48, room),
    };
    setInFlight(true);
    if (frameRef.current == null) {
      frameRef.current = requestAnimationFrame(tossFrame);
    }
  }, [prefersReducedMotion, tossFrame]);

  /** The result is in: bring the coin down on `face` (or, with none, on
   *  whichever is nearest) and call `land` at touchdown. */
  const landToss = useCallback(
    (face: CoinFace | null, land: (() => void) | null) => {
      const s = tossRef.current;
      if (!s) {
        // Reduced motion (or no toss): show the face and land at once.
        if (face) {
          restAngleRef.current = FACE_DEG[face];
          drawCoin(0, 1, FACE_DEG[face]);
        }
        window.setTimeout(() => {
          if (mountedRef.current) land?.();
        }, 120);
        return;
      }
      s.pending = { face, land };
    },
    [drawCoin],
  );

  const handlePick = useCallback(
    async (side: CoinFace) => {
      if (phase === "flipping") return;
      if (wager < ARCADE_MIN_BET) {
        setError(`The smallest bet is ${ARCADE_MIN_BET} tickets.`);
        return;
      }
      if (balance == null || wager > balance) {
        setError(`You need ${wager} tickets for this bet.`);
        return;
      }

      // Press-time feedback and the throw itself come first: the toss
      // whoosh, the haptic and the coin leaving the table all happen on
      // click, not after the network round-trip.
      SoundManager.play("coinFlip");
      playHaptic("light");
      startToss();

      setError(null);
      setPhase("flipping");
      setCurrentPick(side);
      setSettledWager(wager);
      setLastSide(side);
      setRunAccountXp(null);
      setLastResult(null);
      setDidWin(null);
      setLastPayout(null);
      setLastMultiplier(null);
      setRevealedSeed(null);
      setRoundId(null);
      resetRunResult();

      setWalletBalances((prev) => ({
        ...prev,
        credits: prev.credits - wager,
      }));

      try {
        const sessionRes = await fetch("/api/wagers/session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            gameType: "arcade-coin-flip",
            wager,
          }),
        });
        const sessionData = (await sessionRes.json()) as {
          error?: string;
          token?: string;
        };
        if (!mountedRef.current) return;
        if (!sessionRes.ok || !sessionData.token) {
          throw new FlipError(
            machineError(
              sessionData.error,
              "The machine could not start the round.",
            ),
          );
        }

        const actionRes = await fetch("/api/wagers/action", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            token: sessionData.token,
            action: "flip",
            data: { side },
          }),
        });
        const actionData =
          (await actionRes.json()) as CoinFlipActionResponse & {
            error?: string;
          };
        if (!mountedRef.current) return;
        if (!actionRes.ok) {
          throw new FlipError(
            machineError(
              actionData.error,
              "The flip did not go through. Try again.",
            ),
          );
        }
        captureRunResult(actionData);

        // The coin is already in the air: bring it down on the result.
        landToss(actionData.result, () => {
          if (!mountedRef.current) return;
          setLastResult(actionData.result);
          setDidWin(actionData.won);
          setLastPayout(actionData.payout);
          setLastMultiplier(actionData.multiplier);
          setRevealedSeed(actionData.seed);
          setRoundId(actionData.roundId ?? null);
          setRunAccountXp(actionData.account ?? null);
          setPhase("resolved");
          triggerFeedback(actionData.won ? "round-win" : "loss");

          if (actionData.won) {
            playHaptic("success");
          } else {
            playHaptic("failure");
          }

          void refreshWallet();
          window.dispatchEvent(new Event("store-inventory-updated"));
        });
      } catch (err) {
        if (!mountedRef.current) return;
        // No result is coming: set the coin down on whichever face is
        // nearest and say why.
        landToss(null, null);
        setError(
          err instanceof FlipError
            ? err.message
            : "The machine lost its connection. Try again.",
        );
        setPhase("ready");
        setCurrentPick(null);
        void refreshWallet();
      }
    },
    [
      phase,
      refreshWallet,
      startToss,
      landToss,
      captureRunResult,
      resetRunResult,
      triggerFeedback,
      balance,
      wager,
    ],
  );

  // Space flips the last side called again, from ready or from a result.
  useMachineKey(
    useMemo(
      () =>
        phase !== "flipping" && lastSide != null
          ? () => void handlePick(lastSide)
          : null,
      [phase, lastSide, handlePick],
    ),
  );

  const flipping = phase === "flipping";
  const affordable = balance != null && wager <= balance;
  const resolved = phase === "resolved" && lastResult != null;
  const won = resolved && didWin === true;
  const net = (lastPayout ?? 0) - settledWager;
  // The net counts up from 0 as the plate lands.
  const shownNet = useRollingNumber(resolved ? net : 0, { duration: 500 });

  const faceStyle = (
    primary: string,
    secondary: string,
    extra: CSSProperties,
  ): CSSProperties => ({
    backfaceVisibility: "hidden",
    // Flat enamel: one fill, a rim ring in the second colour and a hard
    // block under it. Only an equipped skin that asks for it glows.
    background: primary,
    borderColor: theme.border,
    boxShadow: `inset 0 0 0 0.4rem ${secondary}, 0 4px 0 ${theme.border}${theme.glow ? `, 0 0 ${theme.glowSize}px ${theme.glowColor}` : ""}`,
    ...extra,
  });
  const faceLetter = (color: string): CSSProperties => ({
    color,
    fontSize: "calc(var(--coin) * 0.42)",
    fontFamily: "var(--font-mono-arcade, ui-monospace, monospace)",
  });

  const renderCoin = () => (
    <div className="coin-rest">
      <div
        ref={liftRef}
        className="coin-lift relative"
        data-flying={inFlight || undefined}
      >
        {theme.trailEnabled && inFlight ? (
          <div className="pointer-events-none absolute inset-0">
            {Array.from({ length: theme.trailCount }).map((_, index) => {
              const angle = (360 / theme.trailCount) * index;
              const delay = `${(index * 0.08).toFixed(2)}s`;
              return (
                <div
                  key={index}
                  className="absolute left-1/2 top-1/2 h-2 w-2 rounded-full"
                  style={{
                    background:
                      index % 2 === 0
                        ? theme.trailColor
                        : theme.trailSecondaryColor,
                    transform: `translate(-50%, -50%) rotate(${angle}deg) translateY(-${theme.trailSpread + 30}px)`,
                    animation: `coinTrailParticle 1.4s ease-out ${delay} infinite`,
                    opacity: 0,
                  }}
                />
              );
            })}
          </div>
        ) : null}

        <div className="coin-persp">
          <div
            ref={coinRef}
            className="coin-body"
            style={{
              transformStyle: "preserve-3d",
              transform: `rotateX(${restAngleRef.current}deg)`,
            }}
          >
            <div
              className="absolute inset-0 flex items-center justify-center rounded-full border-4"
              style={faceStyle(theme.headsPrimary, theme.headsSecondary, {
                transform: "translateZ(2px)",
              })}
            >
              <span className="font-black" style={faceLetter(theme.headsText)}>
                H
              </span>
            </div>
            <div
              className="absolute inset-0 flex items-center justify-center rounded-full border-4"
              style={faceStyle(theme.tailsPrimary, theme.tailsSecondary, {
                transform: "rotateX(180deg) translateZ(2px)",
              })}
            >
              <span className="font-black" style={faceLetter(theme.tailsText)}>
                T
              </span>
            </div>
          </div>
        </div>
      </div>
      <div ref={shadowRef} className="coin-shadow" />
    </div>
  );

  // ── Screen: themed coin scene ──────────────────────────────────────────
  // The status line sits above the stage, never over the coin: the coin
  // only rises inside the stage below it.
  const statusLine = resolved
    ? `You called ${currentPick}. It landed ${lastResult}: ${Math.abs(net).toLocaleString()} tickets ${won ? "won" : "lost"}.`
    : flipping
      ? `You called ${currentPick} for ${settledWager.toLocaleString()} tickets. The coin is in the air.`
      : "Call heads or tails.";

  const screen = (
    <div
      className="arc-machine-fit coin-screen"
      style={
        theme.bgGradientStart
          ? {
              background: `linear-gradient(180deg, ${theme.bgGradientStart} 0%, ${theme.bgGradientEnd || theme.bgGradientStart} 100%)`,
            }
          : undefined
      }
    >
      {theme.bgStars ? (
        <div className="pointer-events-none absolute inset-0">
          {STAR_LAYOUT.map((star) => (
            <span
              key={`${star.left}-${star.top}`}
              className={`coin-twinkle absolute rounded-full bg-white/70 ${star.size} animate-[coinTwinkle_2.4s_ease-in-out_infinite]`}
              style={{
                left: star.left,
                top: star.top,
                animationDelay: star.delay,
              }}
            />
          ))}
        </div>
      ) : null}
      {theme.bgParticles ? (
        <div className="pointer-events-none absolute inset-0">
          {PARTICLE_LAYOUT.map((particle) => (
            <span
              key={`${particle.left}-${particle.top}`}
              className="absolute rounded-full blur-3xl"
              style={{
                left: particle.left,
                top: particle.top,
                width: `${particle.size}px`,
                height: `${particle.size}px`,
                background:
                  theme.bgParticleColor ||
                  theme.bgAccentColor ||
                  "rgba(34, 211, 238, 0.35)",
                opacity: particle.opacity,
              }}
            />
          ))}
        </div>
      ) : null}

      <p className="arc-machine-status relative z-10" aria-live="polite">
        {statusLine}
      </p>

      <div ref={stageRef} className="coin-stage">
        {/* The result: the face that landed, then what it paid, big. Red
            plate and amber stub for a win; a quiet ink plate for a loss. */}
        {resolved ? (
          <div className="coin-result">
            <p className="coin-plate" data-win={won || undefined}>
              <span>{lastResult}</span>
              <b>{formatNum(shownNet, { signed: true })}</b>
            </p>
            {runAccountXp ? (
              <div className="mx-auto w-full max-w-xs">
                <XpGainBurst account={runAccountXp} />
              </div>
            ) : null}
          </div>
        ) : null}
        {renderCoin()}
      </div>
    </div>
  );

  const flipButton = (side: CoinFace) => (
    <MachineButton
      onClick={() => void handlePick(side)}
      disabled={!affordable || wager < ARCADE_MIN_BET}
      aria-disabled={flipping || undefined}
      aria-label={`flip ${side}, ${wager} tickets`}
    >
      {side}
    </MachineButton>
  );

  const receipt =
    phase === "resolved" && lastResult ? (
      <ArcadeWagerResultPlate
        result={{
          payout: lastPayout ?? 0,
          stake: settledWager,
          multiplier: lastMultiplier,
        }}
        kicker="coin flip"
        headline={lastResult}
        detail={currentPick ? `called ${currentPick}` : undefined}
        fairness={{ seedHash: null, revealedSeed }}
        achievements={achievements}
        roundId={roundId ?? undefined}
        sound={false}
      />
    ) : null;

  return (
    <GameShell
      game="coin-flip"
      stat={<GameStat value={`${WIN_MULTIPLIER}×`} label="top" />}
      howTo={HOW_TO}
      tickets={balance ?? undefined}
      below={<GameInventoryButton onClick={() => setShowInventory(true)} />}
    >
      <ArcadeMachine
        name="coin flip"
        glass={
          <MachineGlass
            name="coin flip"
            rules={["Call heads or tails. A right call pays its bet times:"]}
            paytable={[
              { label: "chance", value: "50%" },
              { label: "pays", value: `${WIN_MULTIPLIER}×`, lit: won },
              {
                label: "on a win",
                value: Math.round(wager * WIN_MULTIPLIER).toLocaleString(),
              },
            ]}
          />
        }
        action={
          <>
            {flipButton("heads")}
            {flipButton("tails")}
          </>
        }
        bet={{ value: wager, onChange: setWager, balance, disabled: flipping }}
        receipt={receipt}
        receiptKey={roundId}
        notice={error}
      >
        {screen}
      </ArcadeMachine>

      <GameInventoryModal
        open={showInventory}
        onOpenChange={setShowInventory}
        gameType="coin-flip"
        title="coin flip inventory"
        description="Your equipped coin flip cosmetics."
      />

      <style jsx global>{`
        .arc-shell[data-game="coin-flip"] .arc-machine-frame:not([data-wide]) {
          --machine-screen-min: 21rem;
        }
        .coin-screen {
          position: relative;
          overflow-x: hidden;
          /* The coin scales with the screen: 7 rem on a small phone up to
             14 rem where there is room. */
          --coin: clamp(7rem, min(38cqw, 40cqh), 14rem);
        }
        /* A phone's status line can wrap to two lines mid-toss: keep the
           room so the stage never changes height under the coin. */
        @container (max-width: 32rem) {
          .coin-screen .arc-machine-status {
            display: flex;
            align-items: center;
            justify-content: center;
            min-height: 3rem;
          }
        }
        /* The stage is everything under the status line. The coin rests at
           its foot and throws up inside it; the result sits above the coin. */
        .coin-stage {
          position: relative;
          flex: 1 1 0;
          width: 100%;
          min-height: calc(var(--coin) + 5rem);
        }
        .coin-rest {
          position: absolute;
          left: 50%;
          bottom: 0;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 0.75rem;
          width: var(--coin);
          transform: translateX(-50%);
        }
        .coin-lift {
          width: var(--coin);
          height: var(--coin);
          will-change: transform;
        }
        .coin-persp {
          width: 100%;
          height: 100%;
          perspective: 800px;
        }
        .coin-body {
          position: relative;
          width: 100%;
          height: 100%;
          will-change: transform;
        }
        /* The coin's shadow on the table: a flat ink ellipse. */
        .coin-shadow {
          width: 80%;
          height: ${COIN_TABLE_PX - 12}px;
          border-radius: 50%;
          background: rgba(0, 0, 0, 0.4);
          will-change: transform, opacity;
        }
        .coin-result {
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 0.5rem;
        }
        /* The plate: red for a win, ink for a loss. The amber stub holds
           the net; a loss's stub goes quiet. */
        .coin-plate {
          display: inline-flex;
          align-items: center;
          gap: 1rem;
          margin: 0;
          padding: 0.375rem 0.5rem 0.375rem 1.25rem;
          border-radius: 0.75rem;
          background: var(--tixy-ink, #1f1a16);
          color: var(--tixy-paper, #f4ebdc);
          box-shadow: 0 3px 0 rgb(0 0 0 / 0.3);
          white-space: nowrap;
          animation: coinPlate 320ms
            var(--tixy-ease-spring, cubic-bezier(0.2, 1.5, 0.4, 1)) both;
        }
        .coin-plate > span {
          font-size: clamp(1.5rem, 7cqw, 2rem);
          font-weight: 800;
          line-height: 1;
        }
        .coin-plate > b {
          min-width: 3.5rem;
          padding: 0.25rem 0.75rem;
          border-radius: 0.5rem;
          background: var(--tixy-screen, #2a231d);
          color: var(--tixy-on-ink-2, #c9c1b4);
          font-family: var(--tixy-font-num, inherit);
          font-size: clamp(2.25rem, 11cqw, 3.25rem);
          font-weight: var(--tixy-weight-num, 700);
          letter-spacing: var(--tixy-tracking-num, 0);
          line-height: 1;
          text-align: center;
        }
        .coin-plate[data-win] {
          background: var(--tixy-red, #b83627);
          color: var(--tixy-on-red, #f4ebdc);
        }
        .coin-plate[data-win] > b {
          background: var(--tixy-ticket, #f2a33c);
          color: var(--tixy-on-ticket, #2a1b06);
        }
        @keyframes coinPlate {
          from {
            opacity: 0;
            transform: scale(0.6);
          }
          to {
            opacity: 1;
            transform: scale(1);
          }
        }

        @keyframes coinTrailParticle {
          0% {
            opacity: 0;
            transform: translate(-50%, -50%) scale(0.5);
          }
          20% {
            opacity: 0.9;
            transform: translate(-50%, -50%) scale(1.2);
          }
          100% {
            opacity: 0;
            transform: translate(-50%, -50%) scale(0) translateY(-40px);
          }
        }

        @keyframes coinTwinkle {
          0%,
          100% {
            opacity: 0.25;
            transform: scale(0.9);
          }
          50% {
            opacity: 0.9;
            transform: scale(1.15);
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .coin-twinkle {
            animation: none;
          }
          .coin-plate {
            animation: none;
          }
        }
      `}</style>
    </GameShell>
  );
}
