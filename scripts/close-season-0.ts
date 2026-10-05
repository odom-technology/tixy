/**
 * UNUSED AFTER THE RESET. Season 0 was restarted on the new card (key
 * `season-0-r2`) instead of closing, so there is no close to run and nothing
 * calls this. Unclaimed tiers and quests of the old season 0 are not paid. The
 * script stays in the repo as the record of how a close worked. It refuses to
 * run unless ALLOW_RETIRED_SEASON_0_CLOSE=1 is set, so a copied runbook can't
 * pay out the old season by accident. Its check (verify-season-0-close) was
 * removed with the reset.
 *
 * Close season 0: grant what players earned and close the rest.
 *
 *   npx tsx scripts/close-season-0.ts --dry-run --out /tmp/season-0-dry-run.json
 *   npx tsx scripts/close-season-0.ts --out /tmp/season-0-close.json
 *
 * --dry-run reads and writes nothing. It prints the report as JSON on stdout
 * (players, tickets, XP and items, in totals and per player) and a summary on
 * stderr. --out also writes the JSON to a file.
 *
 * The real run grants what a player could still claim in the app: every
 * reached, unclaimed tier on both tracks, season and weekly quests at goal, and
 * the final day's dailies at goal, through the normal claim paths. It then
 * closes every other quest with no payout, including earlier days' dailies that
 * expired unclaimed. It refuses to run before
 * SEASON_0_END (src/server/arcade/battlepass/season-0.ts) unless --force-date
 * is given, which is for a test database. A second run grants nothing.
 * Reads DATABASE_URL from env/.env.local like the seed scripts. The runbook is
 * in docs/deploy.md.
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


const usage = `Usage:
  tsx scripts/close-season-0.ts --dry-run [--out report.json]
  tsx scripts/close-season-0.ts [--force-date] [--out report.json]`;

const SUMMARY_PLAYERS = 20;

const summary = (
  report: import('../src/server/arcade/battlepass/close-season-0').CloseReport,
) => {
  const t = report.totals;
  const verb = report.mode === 'dry-run' ? 'would grant' : 'granted';
  const lines = [
    `Season 0 close, ${report.mode}. Season ends ${report.endsAt}. Dailies of ${report.finalDayKey} are claimed; earlier days' are closed.`,
    `${t.players} players with a season 0 row; ${t.playersGranted} ${verb} something; ${t.playersAffected} touched in all.`,
    `${verb}: ${t.tickets} tickets (${t.ticketsFromTiers} from ${t.tiers} tiers, ${t.ticketsFromQuests} from quests, ${t.ticketsFromLevels} from level milestones the quest XP reaches), ${t.xp} season XP from quests, ${t.items} items.`,
    `quests claimed: daily ${t.questsClaimed.daily}, weekly ${t.questsClaimed.weekly}, season ${t.questsClaimed.season}.`,
    `quests closed with no payout: daily ${t.questsClosed.daily} (${t.expiredDailies} finished but expired), weekly ${t.questsClosed.weekly}, season ${t.questsClosed.season}.`,
  ];
  const items = Object.entries(t.itemsById).sort((a, b) => b[1] - a[1]);
  if (items.length) lines.push(`items: ${items.map(([id, n]) => `${id} x${n}`).join(', ')}`);
  const top = [...report.players].sort((a, b) => b.tickets - a.tickets).slice(0, SUMMARY_PLAYERS);
  lines.push(`top ${top.length} players by tickets:`);
  for (const p of top) {
    lines.push(
      `  ${(p.username ?? p.userId).padEnd(24)} tier ${p.tierBefore} -> ${p.tierAfter}, ${p.tickets} tickets, ${p.items.length} items, ${p.quests.length} quests, ${p.tiers.length} tiers`,
    );
  }
  if (report.failures.length) {
    lines.push(`${report.failures.length} FAILURES:`);
    for (const f of report.failures.slice(0, 20)) lines.push(`  ${f.userId} ${f.step}: ${f.error}`);
  }
  return lines.join('\n');
};

async function main() {
  if (process.env.ALLOW_RETIRED_SEASON_0_CLOSE !== '1') {
    console.error(
      'Season 0 was restarted on the new card (season-0-r2), so there is no close to run. ' +
        'This script is unused and refuses to run. Set ALLOW_RETIRED_SEASON_0_CLOSE=1 only if you mean to pay the old season 0.',
    );
    process.exit(4);
  }
  const args = process.argv.slice(2);
  const known = new Set(['--dry-run', '--force-date', '--out']);
  const outIndex = args.indexOf('--out');
  const outPath = outIndex >= 0 ? args[outIndex + 1] : undefined;
  const unknown = args.filter((a, i) => !(known.has(a) || (outIndex >= 0 && i === outIndex + 1)));
  if (unknown.length || (outIndex >= 0 && !outPath)) {
    console.error(usage);
    process.exit(2);
  }
  const dryRun = args.includes('--dry-run');
  const forceDate = args.includes('--force-date');
  const { SEASON_0_END } = await import('../src/server/arcade/battlepass/season-0');
  const { planSeason0Close, runSeason0Close } = await import('../src/server/arcade/battlepass/close-season-0');

  if (!dryRun && Date.now() < SEASON_0_END.getTime() && !forceDate) {
    console.error(
      `Refusing to run before ${SEASON_0_END.toISOString()}. Use --dry-run to see what it would do, or --force-date on a test database.`,
    );
    process.exit(3);
  }
  const report = dryRun ? await planSeason0Close() : await runSeason0Close();
  const json = JSON.stringify(report, null, 2);
  if (outPath) fs.writeFileSync(outPath, `${json}\n`);
  console.log(json);
  console.error(`\n${summary(report)}`);
  process.exit(report.failures.length ? 1 : 0);
}

main().catch((error) => {
  console.error('[close-season-0] failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
