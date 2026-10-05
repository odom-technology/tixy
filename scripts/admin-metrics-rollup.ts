/**
 * One-time backfill of the admin metrics rollup tables.
 *
 *   npm run admin-metrics:rollup -- --days=400
 *
 * Rolls the last N UTC days (default 3) into admin_*_days, most recent first,
 * then any day missing from the last 31. Safe to run again: each day is deleted
 * and rebuilt in one transaction. Reads DATABASE_URL from env/.env.local like
 * the other scripts. Sources that were pruned (game_time_metrics_daily keeps
 * this and last month) leave older days thinner; that is expected.
 */
import fs from 'node:fs';
import path from 'node:path';

for (const f of ['env/.env.local', 'env/.env', '.env.local', '.env']) {
  try {
    const text = fs.readFileSync(path.join(process.cwd(), f), 'utf8');
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const i = line.indexOf('=');
      if (i === -1) continue;
      const k = line.slice(0, i).trim();
      let v = line.slice(i + 1).trim();
      if (!k || process.env[k] !== undefined) continue;
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      process.env[k] = v;
    }
  } catch {
    /* file may not exist */
  }
}

const arg = process.argv.find((a) => a.startsWith('--days='));
const days = arg ? Number.parseInt(arg.slice('--days='.length), 10) : 3;
if (!Number.isFinite(days) || days < 1 || days > 1000) {
  console.error('Usage: npm run admin-metrics:rollup -- --days=<1..1000>');
  process.exit(1);
}

const { runRollup } = await import('../src/server/admin/metrics/rollup');
const { getPool } = await import('../src/server/db/client');

try {
  const result = await runRollup({ days });
  console.log(`Rolled ${result.days} days in ${(result.durationMs / 1000).toFixed(1)} s.`);
} finally {
  await getPool().end();
}
