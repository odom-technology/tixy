/**
 * Checks the 3D kit's adaptive quality controller against the rules in
 * docs/design/tixy-rebrand/THREE.md, with synthetic frame times.
 *
 *   npx tsx scripts/verify-midway-quality.ts
 */
import {
  createMidwayQualityController,
  midwayBulbCount,
  midwayParticleCount,
  type MidwayTier,
} from '../src/features/arcade/lib/midway-quality';

let failures = 0;
function check(condition: boolean, message: string) {
  if (condition) {
    console.log(`ok    ${message}`);
  } else {
    failures += 1;
    console.log(`FAIL  ${message}`);
  }
}

/** Feed frames of a fixed length; returns the time each tier change happened. */
function run(
  start: MidwayTier,
  frames: Array<{ ms: number; count: number }>,
): { tier: MidwayTier; changes: Array<{ at: number; tier: MidwayTier }> } {
  const quality = createMidwayQualityController({ game: 'verify', start });
  const changes: Array<{ at: number; tier: MidwayTier }> = [];
  let now = 1000;
  quality.frame(now, 0);
  for (const block of frames) {
    for (let i = 0; i < block.count; i += 1) {
      now += block.ms;
      const next = quality.frame(now);
      if (next) changes.push({ at: now, tier: next });
    }
  }
  return { tier: quality.tier(), changes };
}

// Steady 60 fps on medium: no drop. Promotion needs 3 s under 12 ms.
{
  const r = run('medium', [{ ms: 16.7, count: 600 }]);
  check(r.tier === 'medium' && r.changes.length === 0, '60 fps holds medium, no change');
}

// 120 fps on medium: climbs to high once, after about 3 s.
{
  const r = run('medium', [{ ms: 8.3, count: 1200 }]);
  check(r.tier === 'high', '120 fps on medium promotes to high');
  const first = r.changes[0];
  check(
    r.changes.length === 1 && first !== undefined && first.at - 1000 >= 3000 && first.at - 1000 < 4500,
    `promotion waits for 3 s of headroom (at ${first ? Math.round(first.at - 1000) : '-'} ms)`,
  );
}

// 25 ms frames on medium: drops to low after about 1 s over budget, then stays.
{
  const r = run('medium', [{ ms: 25, count: 400 }]);
  const first = r.changes[0];
  check(r.tier === 'low', '25 ms frames drop medium to low');
  check(
    first !== undefined && first.at - 1000 >= 1000 && first.at - 1000 < 2600,
    `the drop waits for p90 over 18 ms for 1 s (at ${first ? Math.round(first.at - 1000) : '-'} ms)`,
  );
}

// High drops one tier at a time.
{
  const r = run('high', [{ ms: 25, count: 600 }]);
  check(
    r.changes.map((c) => c.tier).join(',') === 'medium,low',
    `high steps down to medium, then low (${r.changes.map((c) => c.tier).join(',')})`,
  );
}

// After a drop it never climbs back, even with headroom.
{
  const r = run('high', [
    { ms: 25, count: 60 },
    { ms: 8.3, count: 2000 },
  ]);
  check(r.tier === 'medium', `no climb after a drop (ended on ${r.tier})`);
}

// A short hitch (a shader compile) does not drop a tier.
{
  const r = run('medium', [
    { ms: 16.7, count: 120 },
    { ms: 120, count: 3 },
    { ms: 16.7, count: 240 },
  ]);
  check(r.tier === 'medium', 'three 120 ms hitches in 2 s do not drop');
}

// Very slow frames still get judged (fewer than 8 frames per second).
{
  const r = run('medium', [{ ms: 166, count: 40 }]);
  check(r.tier === 'low', '166 ms frames still drop medium to low');
}

// Gaps over a second are a parked loop, not a frame.
{
  const r = run('medium', [
    { ms: 16.7, count: 60 },
    { ms: 5000, count: 4 },
    { ms: 16.7, count: 60 },
  ]);
  check(r.tier === 'medium', 'parked-loop gaps are ignored');
}

// A park (deltaMs 0, or reset) forgets the slow frames before it.
{
  const quality = createMidwayQualityController({ game: 'verify', start: 'medium' });
  let now = 1000;
  quality.frame(now, 0);
  for (let i = 0; i < 32; i += 1) quality.frame((now += 25)); // 0.8 s slow
  quality.frame((now += 3000), 0); // the loop parked and restarted
  for (let i = 0; i < 20; i += 1) quality.frame((now += 16.7));
  quality.reset();
  for (let i = 0; i < 20; i += 1) quality.frame((now += 16.7));
  check(quality.tier() === 'medium', 'slow frames, a park, then fast frames do not drop');
}

// A hold delays the change until the decision is over, and nothing else is
// decided meanwhile.
{
  const quality = createMidwayQualityController({ game: 'verify', start: 'high' });
  const applied: string[] = [];
  quality.onChange((tier) => applied.push(tier));
  let now = 1000;
  quality.frame(now, 0);
  quality.hold(true);
  for (let i = 0; i < 200; i += 1) quality.frame((now += 25)); // 5 s slow, held
  check(
    quality.tier() === 'medium' && quality.appliedTier() === 'high' && applied.length === 0,
    `a drop decided while held waits (decided ${quality.tier()}, applied ${quality.appliedTier()})`,
  );
  quality.hold(false);
  check(applied.join(',') === 'medium', `releasing the hold applies it once (${applied.join(',')})`);
}

// Sampling pauses while deferred textures upload, plus a grace period.
{
  const quality = createMidwayQualityController({ game: 'verify', start: 'medium' });
  let now = performance.now();
  quality.frame(now, 0);
  quality.pauseSampling();
  for (let i = 0; i < 100; i += 1) quality.frame((now += 40));
  check(quality.tier() === 'medium', 'slow frames while sampling is paused do not drop');
  quality.resumeSampling(0);
  for (let i = 0; i < 100; i += 1) quality.frame((now += 40));
  check(quality.tier() === 'low', 'after resuming, slow frames drop again');
}

// A drop earlier in the session stops a later visit from climbing.
{
  const store = new Map<string, string>();
  const globals = globalThis as unknown as { window?: unknown };
  globals.window = {
    sessionStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
    },
    location: { search: '' },
  };
  try {
    const first = createMidwayQualityController({ game: 'verify-session', start: 'medium' });
    let now = 1000;
    first.frame(now, 0);
    for (let i = 0; i < 60; i += 1) first.frame((now += 25));
    check(store.get('midway-tier:verify-session') === 'low', 'a drop is stored for the session');
    const second = createMidwayQualityController({ game: 'verify-session', start: 'medium' });
    now = 1000;
    second.frame(now, 0);
    for (let i = 0; i < 1200; i += 1) second.frame((now += 8.3));
    check(second.tier() === 'medium', 'a later visit after a drop never climbs to high');
  } finally {
    delete globals.window;
  }
}

check(midwayBulbCount(11, 'low') === 6 && midwayBulbCount(11, 'medium') === 11, 'bulb counts per tier');
check(
  midwayParticleCount(10, 'low') === 4 && midwayParticleCount(10, 'high') === 10 && midwayParticleCount(1, 'low') === 1,
  'particle budgets per tier',
);

if (failures > 0) {
  console.log(`\n${failures} MIDWAY QUALITY CHECK(S) FAILED.`);
  process.exit(1);
}
console.log('\nALL MIDWAY QUALITY CHECKS PASS.');
