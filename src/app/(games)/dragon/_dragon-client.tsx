"use client";

import { useState, useCallback, useMemo, type CSSProperties } from "react";
import { Egg, Flame } from "lucide-react";
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
import { useWagerSession } from "@/features/arcade/lib/use-wager-session";
import { ARCADE_MIN_BET } from "@/server/arcade/arcade-constants";

/* ===========================================================================
 *  Types + constants (mirror server: src/server/arcade/wager-games/dragon.ts)
 * ========================================================================= */

type GamePhase = "setup" | "playing" | "won" | "lost";
type Difficulty = "easy" | "medium" | "hard" | "expert";

const ROWS = 9;
const RTP = 0.97;
const MAX_MULT = 500;

type DifficultyDetail = {
  tiles: number;
  safe: number;
  fairMult: number;
  label: string;
  /** The eggs in each row, for the glass. */
  sub: string;
};

const DIFFICULTY: Record<Difficulty, DifficultyDetail> = {
  easy: { tiles: 4, safe: 3, fairMult: 4 / 3, label: "easy", sub: "1 egg in 4" },
  medium: { tiles: 3, safe: 2, fairMult: 3 / 2, label: "medium", sub: "1 egg in 3" },
  hard: { tiles: 2, safe: 1, fairMult: 2 / 1, label: "hard", sub: "1 egg in 2" },
  expert: { tiles: 4, safe: 1, fairMult: 4 / 1, label: "expert", sub: "3 eggs in 4" },
};

const DIFFICULTY_KEYS = Object.keys(DIFFICULTY) as Difficulty[];

/* ---------- Multiplier helper (mirrors getDragonCumulativeMultiplier) ---------- */

/** Cumulative display multiplier after climbing `rows` rows at a difficulty. */
function computeMultiplier(
  rowsClimbed: number,
  difficulty: Difficulty,
): number {
  if (rowsClimbed <= 0) return 0;
  if (rowsClimbed > ROWS) return 0;
  const fair = Math.pow(DIFFICULTY[difficulty].fairMult, rowsClimbed);
  return Math.floor(Math.min(MAX_MULT, fair * RTP) * 100) / 100;
}

function formatMult(m: number): string {
  if (m >= 100) return `${m.toFixed(0)}×`;
  return `${m.toFixed(2)}×`;
}

const HOW_TO: GameHowTo = {
  lines: [
    "Pick a difficulty and a bet, press climb, then pick one tile per row from the bottom of the 9-row tower.",
    "A safe tile climbs and raises the payout; a dragon egg takes the bet, so cash out after any row.",
    `All 9 rows pay ${formatMult(computeMultiplier(ROWS, "easy"))} on easy, ${formatMult(computeMultiplier(ROWS, "medium"))} on medium, ${formatMult(computeMultiplier(ROWS, "hard"))} on hard and ${formatMult(computeMultiplier(ROWS, "expert"))} on expert.`,
  ],
};

/* ---------- Per-tile visual state ---------- */
// 'hidden'  — unrevealed keycap (an active-row tile is also interactive)
// 'climbed' — the safe tile the player chose on a cleared row
// 'safe'    — a safe tile revealed at round end (not the one chosen)
// 'egg'     — a dragon egg revealed at round end
// 'hit'     — the egg the player struck (bust)
type TileVisual = "hidden" | "climbed" | "safe" | "egg" | "hit";

type ClimbResponse = {
  alive?: boolean;
  completed?: boolean;
  currentMultiplier?: number;
  payout?: number;
  seed?: number;
  rows?: number[][];
  roundId?: string | null;
};

type DragonSettleResponse = {
  payout?: number;
  multiplier?: number;
  seed?: number;
  rows?: number[][];
  roundId?: string | null;
};

/* ===========================================================================
 *  Component
 * ========================================================================= */

export default function DragonClient() {
  const { trigger: triggerFeedback } = useGameFeedback();
  const {
    wallet,
    loaded: walletLoaded,
    refresh: refreshWallet,
    adjustCredits,
  } = useGamesWallet();
  const balance = walletLoaded ? wallet.credits : null;

  /* -- game state -- */
  const [phase, setPhase] = useState<GamePhase>("setup");

  /* -- setup -- */
  const [difficulty, setDifficulty] = useState<Difficulty>("medium");
  const [wager, setWager] = useMachineBet(balance, 10, {
    locked: phase === "playing",
  });
  /* The stake the open climb was bought with; the receipt prints it. */
  const [roundStake, setRoundStake] = useState(0);
  const [roundId, setRoundId] = useState<string | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const [rowsClimbed, setRowsClimbed] = useState(0);
  const [currentMultiplier, setCurrentMultiplier] = useState(0);
  const [payout, setPayout] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [isClimbing, setIsClimbing] = useState(false);
  /* Player's chosen column per cleared row (index = row). */
  const [pickedTiles, setPickedTiles] = useState<number[]>([]);
  /* Full revealed layout (safe column indices per row) once the round ends. */
  const [revealedRows, setRevealedRows] = useState<number[][] | null>(null);
  /* The egg tile the player struck on a bust (row + tile), for the blast. */
  const [hitTile, setHitTile] = useState<{ row: number; tile: number } | null>(
    null,
  );

  /* -- session / provably fair -- */
  const {
    revealedSeed,
    setRevealedSeed,
    start: startSession,
    action: sessionAction,
    settle: settleSession,
    achievements,
  } = useWagerSession("arcade-dragon");

  const detail = DIFFICULTY[difficulty];

  /* ---------- Start ---------- */
  const handleStart = useCallback(async () => {
    if (isStarting || balance == null) return;
    setError(null);
    if (wager > balance) {
      setError(`You need ${wager} tickets for this bet.`);
      return;
    }
    setIsStarting(true);
    try {
      const session = await startSession(wager, { difficulty });
      if (!session.ok) {
        setError(
          machineError(session.error, "The machine could not start the climb."),
        );
        return;
      }

      SoundManager.play("arcadeBet");

      setRowsClimbed(0);
      setCurrentMultiplier(0);
      setPayout(0);
      setPickedTiles([]);
      setRevealedRows(null);
      setHitTile(null);
      setRoundStake(wager);
      setRoundId(null);
      setPhase("playing");

      adjustCredits(-wager);
    } catch {
      setError("The machine lost its connection. Try again.");
    } finally {
      setIsStarting(false);
    }
  }, [isStarting, wager, balance, difficulty, startSession, adjustCredits]);

  /* ---------- Climb one row ---------- */
  const handleClimb = useCallback(
    async (tile: number) => {
      if (phase !== "playing" || isClimbing) return;
      setIsClimbing(true);
      setError(null);
      try {
        const climbed = await sessionAction<ClimbResponse>("climb", {
          data: { tile },
        });
        if (!climbed.ok) {
          setError(
            machineError(climbed.error, "The step did not go through. Try again."),
          );
          setIsClimbing(false);
          return;
        }
        const data = climbed.data;
        const climbingRow = rowsClimbed; // 0-based row we just attempted

        if (data.alive) {
          // Safe — climbed this row.
          SoundManager.play("arcadeReveal");
          setPickedTiles((prev) => {
            const next = [...prev];
            next[climbingRow] = tile;
            return next;
          });
          const newRows = climbingRow + 1;
          setRowsClimbed(newRows);
          const mult =
            data.currentMultiplier ?? computeMultiplier(newRows, difficulty);
          setCurrentMultiplier(mult);

          if (data.completed) {
            // Terminal win — top of the tower. Server already settled.
            setPayout(data.payout ?? Math.floor(roundStake * mult));
            if (data.rows) setRevealedRows(data.rows);
            setRevealedSeed(data.seed ?? null);
            setRoundId(data.roundId ?? null);
            setPhase("won");
            triggerFeedback("jackpot");
            void refreshWallet();
          }
        } else {
          // Hit a dragon egg — busted. Server already settled as a loss.
          SoundManager.play("arcadeExplode");
          setHitTile({ row: climbingRow, tile });
          if (data.rows) setRevealedRows(data.rows);
          setRevealedSeed(data.seed ?? null);
          setRoundId(data.roundId ?? null);
          setPayout(0);
          setPhase("lost");
        }
      } catch {
        setError("The machine lost its connection. Try the step again.");
      } finally {
        setIsClimbing(false);
      }
    },
    [
      phase,
      isClimbing,
      rowsClimbed,
      difficulty,
      roundStake,
      sessionAction,
      setRevealedSeed,
      refreshWallet,
      triggerFeedback,
    ],
  );

  /* ---------- Cash out ---------- */
  const handleCashout = useCallback(async () => {
    if (phase !== "playing" || rowsClimbed === 0 || isClimbing) return;
    setError(null);
    try {
      const settled = await settleSession<DragonSettleResponse>();
      if (!settled.ok) {
        setError(
          machineError(
            settled.error,
            "The cash out did not go through. Try again.",
          ),
        );
        return;
      }
      const data = settled.data;
      const finalMult = data.multiplier ?? currentMultiplier;
      setPayout(data.payout ?? Math.floor(roundStake * currentMultiplier));
      setRoundId(data.roundId ?? null);
      setCurrentMultiplier(finalMult);
      if (data.rows) setRevealedRows(data.rows);
      setPhase("won");
      SoundManager.play("arcadeCashout");
      SoundManager.play(finalMult >= 5 ? "arcadeBigWin" : "arcadeWin");
      void refreshWallet();
    } catch {
      setError("The machine lost its connection. Try the cash out again.");
    }
  }, [
    phase,
    rowsClimbed,
    isClimbing,
    roundStake,
    currentMultiplier,
    settleSession,
    refreshWallet,
  ]);

  /* ---------- Computed ---------- */
  const potentialWin = Math.floor(roundStake * currentMultiplier);
  const nextMultiplier = computeMultiplier(rowsClimbed + 1, difficulty);
  const ended = phase === "won" || phase === "lost";
  const playing = phase === "playing";
  const affordable = balance != null && wager <= balance;

  /* ---------- Keyboard: Space starts a climb, never cashes out ---------- */
  useMachineKey(
    useMemo(
      () => (playing ? null : () => void handleStart()),
      [playing, handleStart],
    ),
  );

  const statusLine =
    phase === "setup"
      ? `${detail.sub} tiles on each of ${ROWS} rows.`
      : playing
        ? rowsClimbed === 0
          ? `Pick a tile on row 1. It pays ${formatMult(nextMultiplier)}.`
          : rowsClimbed < ROWS
            ? `${formatMult(currentMultiplier)} now. Row ${rowsClimbed + 1} pays ${formatMult(nextMultiplier)}.`
            : `${formatMult(currentMultiplier)} at the top.`
        : phase === "won"
          ? `Cashed out at ${formatMult(currentMultiplier)}.`
          : `A dragon egg on row ${rowsClimbed + 1}.`;

  /* Decide each tile's visual for a given (row, col). Rows render top-down
     (row ROWS-1 at the top, row 0 at the bottom) so the player climbs upward. */
  const tileVisual = useCallback(
    (row: number, col: number): TileVisual => {
      // Player's chosen safe tile on a cleared row.
      if (row < rowsClimbed && pickedTiles[row] === col) return "climbed";

      if (ended && revealedRows) {
        if (hitTile && hitTile.row === row && hitTile.tile === col)
          return "hit";
        const safeCols = revealedRows[row] ?? [];
        return safeCols.includes(col) ? "safe" : "egg";
      }
      return "hidden";
    },
    [rowsClimbed, pickedTiles, ended, revealedRows, hitTile],
  );

  /* ---------- Stage: the tower ---------- */
  const screen = (
    <div className="arc-machine-fit dragon-stage">
      <p role="status" className="arc-machine-status">
        {statusLine}
      </p>
      <div className="dragon-tower-wrap">
        <div className="dragon-tower">
          {Array.from({ length: ROWS }).map((_, idxFromTop) => {
            // Render top row first; row index counts up from the bottom.
            const row = ROWS - 1 - idxFromTop;
            const isActive = phase === "playing" && row === rowsClimbed;
            const isCleared = row < rowsClimbed;
            const rowMult = computeMultiplier(row + 1, difficulty);
            return (
              <div
                key={row}
                className="dragon-row"
                data-active={isActive || undefined}
                data-cleared={isCleared || undefined}
              >
                <span className="dragon-row-mult arcade-num" aria-hidden>
                  {formatMult(rowMult)}
                </span>
                <div
                  className="dragon-row-tiles"
                  style={{ "--cols": detail.tiles } as CSSProperties}
                >
                  {Array.from({ length: detail.tiles }).map((__, col) => {
                    const visual = tileVisual(row, col);
                    const interactive = isActive && !isClimbing;
                    return (
                      <button
                        key={col}
                        type="button"
                        onClick={() => void handleClimb(col)}
                        disabled={!interactive}
                        aria-label={
                          visual === "climbed"
                            ? "safe step"
                            : visual === "egg" || visual === "hit"
                              ? "dragon egg"
                              : visual === "safe"
                                ? "safe tile"
                                : `row ${row + 1}, tile ${col + 1}`
                        }
                        className="dragon-tile"
                        data-visual={visual}
                        data-active={isActive || undefined}
                      >
                        {visual === "climbed" && (
                          <span
                            className="dragon-glyph dragon-step"
                            aria-hidden
                          >
                            <Flame
                              size={20}
                              fill="currentColor"
                              strokeWidth={1.25}
                            />
                          </span>
                        )}
                        {(visual === "egg" || visual === "hit") && (
                          <span className="dragon-glyph dragon-egg" aria-hidden>
                            {visual === "hit" && (
                              <span className="dragon-blast" aria-hidden />
                            )}
                            <Egg
                              size={20}
                              fill="currentColor"
                              strokeWidth={1.5}
                            />
                          </span>
                        )}
                        {visual === "safe" && (
                          <span
                            className="dragon-glyph dragon-safe"
                            aria-hidden
                          >
                            <Flame size={18} strokeWidth={1.5} />
                          </span>
                        )}
                        {visual === "hidden" && isActive && (
                          <span className="dragon-glyph dragon-q" aria-hidden>
                            ?
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );

  const glass = (
    <MachineGlass
      name="dragon tower"
      rules={[
        "Pick a safe tile in each row. Easy hides 1 egg in 4 tiles, medium 1 in 3, hard 1 in 2, expert 3 in 4.",
      ]}
      paytable={DIFFICULTY_KEYS.map((key) => ({
        label: `${DIFFICULTY[key].label}, 9 rows`,
        value: formatMult(computeMultiplier(ROWS, key)),
        lit: key === difficulty,
      }))}
    />
  );

  const action = playing ? (
    <MachineButton
      onClick={() => void handleCashout()}
      disabled={rowsClimbed === 0}
      aria-disabled={isClimbing || undefined}
      aria-label={
        rowsClimbed === 0
          ? "cash out, clear a row first"
          : `cash out ${potentialWin} tickets`
      }
    >
      cash out
    </MachineButton>
  ) : (
    <MachineButton
      onClick={() => void handleStart()}
      disabled={!affordable || wager < ARCADE_MIN_BET}
      aria-disabled={isStarting || undefined}
      aria-label={`climb, ${wager} tickets`}
    >
      climb
    </MachineButton>
  );

  const receipt = ended ? (
    <ArcadeWagerResultPlate
      result={{
        payout: phase === "won" ? payout : 0,
        stake: roundStake,
        multiplier: phase === "won" ? currentMultiplier : 0,
      }}
      kicker="dragon tower"
      headline={phase === "won" ? formatMult(currentMultiplier) : "egg"}
      detail={`${detail.label}, ${rowsClimbed} of ${ROWS} rows`}
      fairness={{ seedHash: null, revealedSeed }}
      achievements={achievements}
      roundId={roundId ?? undefined}
      sound={false}
    />
  ) : null;

  /* ---------- Render ---------- */
  return (
    <GameShell
      game="dragon"
      stat={
        <GameStat
          value={formatMult(computeMultiplier(ROWS, difficulty))}
          label="top"
        />
      }
      howTo={HOW_TO}
    >
      <ArcadeMachine
        name="dragon tower"
        glass={glass}
        action={action}
        bet={{
          value: wager,
          onChange: setWager,
          balance,
          disabled: playing,
        }}
        controls={
          <MachineChoice<Difficulty>
            label="difficulty"
            options={DIFFICULTY_KEYS.map((key) => ({
              value: key,
              label: DIFFICULTY[key].label,
            }))}
            value={difficulty}
            onChange={setDifficulty}
            disabled={playing}
          />
        }
        receipt={receipt}
        receiptKey={roundId}
        notice={error}
      >
        {screen}
      </ArcadeMachine>

      {/* ── Midway dragon-tower material (scoped to .dragon-stage) ──────────
          A lacquered-wood tower of beveled keycaps in a recessed well. The
          active row glows-free via an amber enamel ring; cleared steps are
          painted teal flames, dragon eggs are dark cast enamel. Tokens only;
          works across all four cabinet sub-themes. Nothing glows. */}
      <style jsx global>{`
        /* phones: room for nine rows of tiles */
        .arc-shell[data-game="dragon"] .arc-machine-frame:not([data-wide]) {
          --machine-screen-min: 28rem;
        }
        .dragon-tower-wrap {
          flex: none;
          margin-inline: auto;
          width: 100%;
          max-width: clamp(20rem, 60cqi, 34rem);
        }
        .dragon-tower {
          display: flex;
          flex-direction: column;
          gap: clamp(5px, 1.4vw, 9px);
          padding: clamp(8px, 2.4vw, 14px);
          border-radius: var(--radius-well);
          background:
            repeating-linear-gradient(
              0deg,
              transparent 0 calc(11.11% - 1px),
              #ffffff08 calc(11.11% - 1px) 11.11%
            ),
            var(--screen-well);
          border: 1px solid var(--border-ink);
          box-shadow:
            inset 0 3px 12px #000000bb,
            inset 0 0 0 1px #ffffff0a;
        }

        .dragon-row {
          display: grid;
          grid-template-columns: clamp(2.5rem, 9cqi, 3.75rem) 1fr;
          align-items: center;
          gap: clamp(6px, 1.6vw, 12px);
          padding: clamp(3px, 0.8vw, 5px);
          border-radius: var(--radius-tag);
          transition:
            background var(--motion-press) var(--ease-snap),
            box-shadow var(--motion-press) var(--ease-snap);
        }
        /* the row the player is on — amber enamel hairline frame with a slow
           beckoning pulse (stilled under reduced motion), no glow */
        .dragon-row[data-active] {
          background: #f2a33c14;
          box-shadow:
            inset 0 0 0 1.5px var(--enamel-tickets-edge, #9a621a),
            inset 0 1px 0 #ffffff12;
        }
        @keyframes dragon-row-beckon {
          0%,
          100% {
            background: #f2a33c14;
            box-shadow:
              inset 0 0 0 1.5px var(--enamel-tickets-edge, #9a621a),
              inset 0 1px 0 #ffffff12;
          }
          50% {
            background: #f2a33c22;
            box-shadow:
              inset 0 0 0 2px var(--enamel-tickets, #f2a33c),
              inset 0 1px 0 #ffffff12;
          }
        }
        .dragon-row[data-cleared] {
          opacity: 0.96;
        }

        /* Multiplier ladder — mono numerals, readable at rest (the old faint
           labels made the ladder invisible until you were on the row) */
        .dragon-row-mult {
          text-align: right;
          font-family: var(--font-mono-arcade), monospace;
          font-size: clamp(0.7rem, 2.6cqi, 0.9rem);
          font-weight: 700;
          color: var(--text-body);
          letter-spacing: 0.02em;
        }
        .dragon-row[data-active] .dragon-row-mult {
          color: var(--enamel-tickets-text, #f2a33c);
        }
        .dragon-row[data-cleared] .dragon-row-mult {
          color: var(--enamel-prize-text, #3fc9b6);
        }

        .dragon-row-tiles {
          display: grid;
          grid-template-columns: repeat(var(--cols), 1fr);
          gap: clamp(5px, 1.4vw, 9px);
        }

        .dragon-tile {
          position: relative;
          /* nine rows share the screen's height under the status line */
          height: clamp(1.5rem, (100cqh - 16rem) / 9, 3.25rem);
          border-radius: var(--radius-tag);
          border: 1px solid var(--border-ink);
          color: var(--text-faint);
          font-weight: 700;
          background: linear-gradient(
            180deg,
            var(--surface-raised),
            var(--surface-panel)
          );
          box-shadow:
            inset 0 2px 0 var(--bevel-hi),
            inset 0 -3px 5px #00000055,
            0 3px 0 var(--shadow-color),
            0 5px 9px #00000040;
          transition:
            transform var(--motion-press) var(--ease-snap),
            box-shadow var(--motion-press) var(--ease-snap),
            filter var(--motion-press) var(--ease-snap);
          cursor: default;
        }
        .dragon-tile[data-active]:not(:disabled) {
          cursor: pointer;
          /* warm the playable tiles so the climb target reads instantly */
          background: linear-gradient(
            180deg,
            color-mix(
              in srgb,
              var(--enamel-tickets) 12%,
              var(--surface-raised)
            ),
            color-mix(in srgb, var(--enamel-tickets) 6%, var(--surface-panel))
          );
          color: var(--text-body);
        }
        .dragon-tile[data-active]:not(:disabled):hover {
          filter: brightness(1.1);
        }
        .dragon-tile[data-active]:not(:disabled):active {
          transform: translateY(3px);
          box-shadow:
            inset 0 2px 0 var(--bevel-hi),
            inset 0 -2px 4px #00000055,
            0 1px 0 var(--shadow-color),
            0 2px 5px #00000040;
        }
        .dragon-tile:focus-visible {
          outline: var(--focus-outline);
          outline-offset: var(--focus-offset);
        }
        /* dim unrevealed tiles on rows that aren't in play yet — kept gentle
           so the tower still reads as a climbable structure, not a dark wall */
        .dragon-tile[data-visual="hidden"]:not([data-active]) {
          filter: saturate(0.88) brightness(0.92);
          box-shadow:
            inset 0 1px 0 var(--bevel-hi),
            inset 0 -2px 4px #00000055,
            0 2px 0 var(--shadow-color);
        }

        /* climbed safe step — teal enamel flame on a painted face */
        .dragon-tile[data-visual="climbed"] {
          background: linear-gradient(
            180deg,
            var(--enamel-prize-hi),
            var(--enamel-prize-edge)
          );
          border-color: var(--enamel-prize-edge);
          color: var(--enamel-prize-on);
          box-shadow:
            inset 0 1px 0 #ffffff45,
            inset 0 -3px 5px #00000050,
            inset 0 0 0 1px #00000030,
            0 2px 0 var(--shadow-color);
          transform: none;
          filter: none;
        }
        /* unchosen safe tile revealed at round end — quiet outline */
        .dragon-tile[data-visual="safe"] {
          background: linear-gradient(
            180deg,
            var(--surface-raised),
            var(--surface-panel)
          );
          border-color: var(--enamel-prize-edge);
          color: var(--enamel-prize-text, #3fc9b6);
          opacity: 0.7;
          box-shadow:
            inset 0 1px 0 var(--bevel-hi),
            inset 0 -2px 4px #00000055;
          transform: none;
        }
        /* dragon egg — dark cast enamel on a darkened cell */
        .dragon-tile[data-visual="egg"] {
          background: linear-gradient(180deg, #241a13, #140d08);
          border-color: var(--border-ink);
          color: #f0e6d6;
          box-shadow:
            inset 0 1px 0 #ffffff14,
            inset 0 -2px 5px #000000aa,
            inset 0 0 0 1px #00000040;
          transform: none;
          filter: none;
        }
        .dragon-tile[data-visual="hit"] {
          background: linear-gradient(
            180deg,
            var(--enamel-danger),
            var(--enamel-danger-edge)
          );
          border-color: var(--enamel-danger-edge);
          color: var(--enamel-danger-on);
          transform: none;
          filter: none;
        }

        .dragon-glyph {
          position: absolute;
          inset: 0;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .dragon-q {
          font-size: clamp(0.9rem, 3.4cqi, 1.1rem);
          opacity: 0.65;
        }
        .dragon-step {
          filter: drop-shadow(0 2px 2px #00000055);
        }
        .dragon-egg {
          filter: drop-shadow(0 1px 1px #000000aa);
        }
        .dragon-safe {
          opacity: 0.8;
        }

        /* blast ring behind the struck egg */
        .dragon-blast {
          position: absolute;
          inset: -2px;
          border-radius: var(--radius-tag);
          background: radial-gradient(
            circle,
            var(--enamel-tickets-hi) 0%,
            var(--enamel-primary) 45%,
            transparent 70%
          );
          opacity: 0;
        }

        /* ── motion: mechanical flip-in for revealed faces; a hard punch on
              the struck egg. Degrades fully under reduced motion. ─────────── */
        @media (prefers-reduced-motion: no-preference) {
          .dragon-row[data-active] {
            animation: dragon-row-beckon 2s ease-in-out infinite;
          }
          .dragon-tile[data-visual="climbed"] {
            animation: dragon-flip var(--motion-reveal) var(--ease-spring) both;
          }
          .dragon-tile[data-visual="egg"],
          .dragon-tile[data-visual="safe"] {
            animation: dragon-flip var(--motion-reveal) var(--ease-spring) both;
          }
          .dragon-tile[data-visual="hit"] {
            animation: dragon-punch 360ms var(--ease-spring) both;
          }
          .dragon-tile[data-visual="hit"] .dragon-blast {
            animation: dragon-blast 460ms var(--ease-out) both;
          }
          .dragon-row[data-active] {
            animation: dragon-row-in var(--motion-reveal) var(--ease-spring)
              both;
          }
        }

        @keyframes dragon-flip {
          0% {
            transform: perspective(420px) rotateX(-72deg) scale(0.94);
            opacity: 0;
          }
          60% {
            opacity: 1;
          }
          100% {
            transform: perspective(420px) rotateX(0deg) scale(1);
            opacity: 1;
          }
        }
        @keyframes dragon-punch {
          0% {
            transform: scale(0.7);
          }
          45% {
            transform: scale(1.16);
          }
          70% {
            transform: scale(0.96);
          }
          100% {
            transform: scale(1);
          }
        }
        @keyframes dragon-blast {
          0% {
            transform: scale(0.4);
            opacity: 0.9;
          }
          100% {
            transform: scale(1.9);
            opacity: 0;
          }
        }
        @keyframes dragon-row-in {
          0% {
            transform: translateY(2px);
          }
          100% {
            transform: translateY(0);
          }
        }
      `}</style>
    </GameShell>
  );
}
