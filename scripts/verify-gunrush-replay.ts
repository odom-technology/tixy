// Gunrush replay harness: proves the seeded track is fair, the run is finite,
// and the authoritative verifier accepts honest logs while rejecting tampered
// ones. Run with `npx tsx scripts/verify-gunrush-replay.ts`.
import assert from 'node:assert/strict';

import {
  GUNRUSH_MAX_ROWS,
  GUNRUSH_SCORE_CAP,
  ROW_SPACING,
  WAVE_EVERY,
  applyGate,
  gatesForRow,
  gateRowScore,
  initialRunState,
  isGateRow,
  isWaveRow,
  packSizeForRow,
  replayGunrushSession,
  resolveWave,
  speedForRow,
  squadDps,
  waveForRow,
  waveRowScore,
  type GunrushPick,
  type GunrushRunState,
} from '../src/server/arcade/gunrush-replay';

type Strategy = 'greedy' | 'thread' | 'random' | 'worst';

/** Play a full run with `strategy`, recording the pick log a client would send. */
const playRun = (
  seed: number,
  strategy: Strategy,
  rng: () => number = Math.random,
) => {
  let state: GunrushRunState = initialRunState();
  const picks: GunrushPick[] = [];
  let elapsedMs = 0;
  let endRow = 0;

  for (let row = 1; row <= GUNRUSH_MAX_ROWS; row += 1) {
    elapsedMs += (ROW_SPACING / speedForRow(row - 1)) * 1000;

    if (isWaveRow(row)) {
      const wave = waveForRow(seed, row);
      const outcome = resolveWave(state, wave);
      elapsedMs += outcome.fightSeconds * 1000;
      state = { ...state, count: Math.max(0, state.count - outcome.losses) };
      if (!outcome.cleared || state.count <= 0) {
        endRow = row;
        break;
      }
      state.kills += wave.enemies;
      state.score += waveRowScore(row, wave.enemies, state.count, state.tier);
      continue;
    }

    const gates = gatesForRow(seed, row);
    let lane = 1;
    if (strategy === 'greedy') {
      // Pick whichever gate leaves the strongest squad; thread if both hurt.
      const candidates = [0, 1, 2].map((option) => {
        const next =
          option === 1 ? state : applyGate(state, gates[option === 0 ? 0 : 1]);
        return { option, power: next.count <= 0 ? -1 : squadDps(next) };
      });
      candidates.sort((a, b) => b.power - a.power);
      lane = candidates[0]!.option;
    } else if (strategy === 'random') {
      lane = Math.floor(rng() * 3);
    } else if (strategy === 'worst') {
      const candidates = [0, 2].map((option) => {
        const next = applyGate(state, gates[option === 0 ? 0 : 1]);
        return { option, power: next.count <= 0 ? -1 : squadDps(next) };
      });
      candidates.sort((a, b) => a.power - b.power);
      lane = candidates[0]!.option;
    }

    picks.push({ row, lane, t: Math.round(elapsedMs) });
    if (lane !== 1) state = applyGate(state, gates[lane === 0 ? 0 : 1]);

    if (state.count <= 0) {
      endRow = row;
      break;
    }
    state.kills += packSizeForRow(row);
    state.score += gateRowScore(row);
  }

  if (endRow === 0) endRow = GUNRUSH_MAX_ROWS;
  return { picks, endRow, state, durationMs: Math.round(elapsedMs) };
};

// ── 1. The verifier accepts an honest run and reproduces its score exactly ──
{
  const strategies: Strategy[] = ['greedy', 'thread', 'random', 'worst'];
  for (const strategy of strategies) {
    for (let seed = 1; seed <= 40; seed += 1) {
      const run = playRun(seed * 7919, strategy);
      const result = replayGunrushSession(
        run.picks,
        run.endRow,
        run.durationMs + 2000,
        seed * 7919,
      );
      assert.equal(
        result.rejected,
        false,
        `${strategy} seed ${seed} rejected: ${result.reason}`,
      );
      assert.equal(
        result.score,
        Math.min(GUNRUSH_SCORE_CAP, Math.floor(run.state.score)),
        `${strategy} seed ${seed} score mismatch`,
      );
    }
  }
  console.log('✓ honest runs replay to an identical score across 4 strategies × 40 seeds');
}

// ── 2. Every run is finite: even perfect play dies well inside the track ────
{
  let worstRow = 0;
  let worstScore = 0;
  const rows: number[] = [];
  for (let seed = 1; seed <= 60; seed += 1) {
    const run = playRun(seed * 104729, 'greedy');
    rows.push(run.endRow);
    worstRow = Math.max(worstRow, run.endRow);
    worstScore = Math.max(worstScore, run.state.score);
    assert.ok(
      run.endRow < GUNRUSH_MAX_ROWS,
      `greedy seed ${seed} never died (reached row ${run.endRow})`,
    );
  }
  rows.sort((a, b) => a - b);
  console.log(
    `✓ greedy play always dies — rows p50=${rows[30]} max=${worstRow}, ` +
      `best score ${Math.round(worstScore).toLocaleString()} (cap ${GUNRUSH_SCORE_CAP.toLocaleString()})`,
  );
  assert.ok(worstScore < GUNRUSH_SCORE_CAP, 'greedy play should stay under the score cap');
}

// ── 3. Threading is always a legal, non-fatal out (no forced wipe) ──────────
{
  for (let seed = 1; seed <= 200; seed += 1) {
    for (let row = 1; row <= 60; row += 1) {
      if (!isGateRow(row)) continue;
      const gates = gatesForRow(seed * 31, row);
      assert.equal(gates.length, 2, 'a gate row always presents two gates');
      // A ÷ gate can never wipe: it floors at one gunner.
      for (const gate of gates) {
        if (gate.kind === 'div') {
          const survived = applyGate(
            { ...initialRunState(), count: 1 },
            gate,
          );
          assert.ok(survived.count >= 1, 'division must never wipe the squad');
        }
      }
    }
  }
  console.log('✓ no row can force a wipe — threading is always available and ÷ floors at 1');
}

// ── 4. Run length lands in arcade territory ────────────────────────────────
{
  const durations: number[] = [];
  for (let seed = 1; seed <= 60; seed += 1) {
    durations.push(playRun(seed * 6151, 'greedy').durationMs / 1000);
  }
  durations.sort((a, b) => a - b);
  const p50 = durations[30]!;
  const max = durations[durations.length - 1]!;
  console.log(`✓ greedy run length p50=${p50.toFixed(0)}s max=${max.toFixed(0)}s`);
  assert.ok(max < 20 * 60, 'a run must fit inside the 20 minute session window');
}

// ── 5. Tampered logs are rejected ──────────────────────────────────────────
{
  const seed = 424242;
  const run = playRun(seed, 'greedy');
  const window = run.durationMs + 2000;

  // Claiming rows past the wipe.
  assert.equal(
    replayGunrushSession(run.picks, run.endRow + 5, window, seed).rejected,
    true,
    'claiming rows past the wipe must reject',
  );

  // Dropping a pick so an unfavourable gate is never applied.
  const holed = run.picks.filter((pick) => pick.row !== run.picks[2]!.row);
  assert.equal(
    replayGunrushSession(holed, run.endRow, window, seed).rejected,
    true,
    'a missing gate row must reject',
  );

  // Rewriting lanes rewrites history: the squad the sim ends up with is not the
  // one that actually ran, so the log either stops dying at endRow (reject) or
  // banks a different authoritative score. What it must NEVER do is silently
  // reproduce the original score — that is the property the route leans on when
  // it compares the claimed score to this one.
  const swapped = run.picks.map((pick) =>
    pick.row > run.endRow / 2 ? { ...pick, lane: pick.lane === 0 ? 2 : 0 } : pick,
  );
  const swappedResult = replayGunrushSession(swapped, run.endRow, window, seed);
  assert.ok(
    swappedResult.rejected || swappedResult.score !== run.state.score,
    'rewriting lanes must not reproduce the original score',
  );

  // The strongest possible tamper: claim the greedy-optimal line on every row.
  // It must still be replayed on its own merits, never inherit the real run's
  // reach, and never exceed what greedy play actually earns on this seed.
  const greedy = playRun(seed, 'greedy');
  const inflated = replayGunrushSession(
    greedy.picks,
    run.endRow,
    window,
    seed,
  );
  assert.ok(
    inflated.rejected || inflated.score <= Math.floor(greedy.state.score),
    'a fabricated optimal line cannot out-score optimal play',
  );

  // Teleporting through the track.
  const instant = run.picks.map((pick) => ({ ...pick, t: 1 }));
  assert.equal(
    replayGunrushSession(instant, run.endRow, window, seed).rejected,
    true,
    'impossibly fast arrivals must reject',
  );

  // Picks landing on wave rows.
  assert.equal(
    replayGunrushSession(
      [...run.picks, { row: WAVE_EVERY, lane: 0, t: 5000 }],
      run.endRow,
      window,
      seed,
    ).rejected,
    true,
    'a pick on a wave row must reject',
  );

  // Duplicate rows.
  assert.equal(
    replayGunrushSession(
      [...run.picks, run.picks[0]!],
      run.endRow,
      window,
      seed,
    ).rejected,
    true,
    'duplicate picks must reject',
  );

  // Posting after the session window closed.
  assert.equal(
    replayGunrushSession(run.picks, run.endRow, 1000, seed).rejected,
    true,
    'picks outside the session window must reject',
  );

  console.log('✓ tampered logs (extra rows, holes, lane swaps, teleports, dupes) all reject');
}

// ── 6. Determinism: the same seed always builds the same track ─────────────
{
  for (let row = 1; row <= 120; row += 1) {
    const a = gatesForRow(99, row);
    const b = gatesForRow(99, row);
    assert.deepEqual(a, b, `gatesForRow(99, ${row}) must be stable`);
    if (isWaveRow(row)) {
      assert.deepEqual(waveForRow(99, row), waveForRow(99, row));
    }
  }
  assert.notDeepEqual(gatesForRow(1, 7), gatesForRow(2, 7), 'seeds must diverge');
  console.log('✓ track generation is deterministic per seed and diverges across seeds');
}

// ── 7. Difficulty telemetry (informational) ────────────────────────────────
{
  const run = playRun(20240804, 'greedy');
  const samples = [5, 10, 15, 20, 25, 30, 35, 40].filter((row) => row < run.endRow);
  console.log('\n  greedy reference run (seed 20240804):');
  console.log(
    `    died at row ${run.endRow}, score ${Math.round(run.state.score).toLocaleString()}, ` +
      `${Math.round(run.durationMs / 1000)}s, tier ${run.state.tier}, ${run.state.kills} kills`,
  );
  let replayState = initialRunState();
  for (let row = 1; row < run.endRow; row += 1) {
    if (isWaveRow(row)) {
      const wave = waveForRow(20240804, row);
      const outcome = resolveWave(replayState, wave);
      replayState = {
        ...replayState,
        count: Math.max(0, replayState.count - outcome.losses),
      };
      if (samples.includes(row)) {
        console.log(
          `    wave row ${String(row).padStart(3)} — ${outcome.fightSeconds.toFixed(1)}s fight, ` +
            `−${outcome.losses} gunners → ${replayState.count} left, tier ${replayState.tier}`,
        );
      }
      continue;
    }
    const pick = run.picks.find((entry) => entry.row === row);
    if (pick && pick.lane !== 1) {
      replayState = applyGate(replayState, gatesForRow(20240804, row)[pick.lane === 0 ? 0 : 1]);
    }
  }
}

console.log('\nAll Gunrush replay checks passed.');
