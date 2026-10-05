/**
 * Set every unclaimed quest on a game complete, so players can claim it as
 * normal. Run it on the day the game's route starts to redirect.
 *
 *   npx tsx scripts/complete-quests-for-game.ts swerve sky-climber --dry-run
 *   npx tsx scripts/complete-quests-for-game.ts swerve sky-climber
 *
 * Each argument is a registry slug (not a route). --dry-run counts the rows
 * and writes nothing. Safe to run twice: it only touches unclaimed quests
 * below their goal. It refuses a game that is on the floor. Reads DATABASE_URL
 * from env/.env.local like the seed scripts.
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

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const slugs = args.filter((arg) => !arg.startsWith('--'));
  if (slugs.length === 0) {
    console.error('Usage: tsx scripts/complete-quests-for-game.ts <slug...> [--dry-run]');
    process.exit(2);
  }
  const { completeQuestsForGame } = await import('../src/server/arcade/battlepass/complete-on-redirect');
  for (const slug of slugs) {
    const result = await completeQuestsForGame(slug, { dryRun });
    const verb = dryRun ? 'would complete' : 'completed';
    const { user_daily_quests: daily, user_weekly_cards: cards } = result.completed;
    console.log(`${slug}: ${verb} ${result.total} (daily ${daily}, card ${cards})`);
  }
  process.exit(0);
}

main().catch((error) => {
  console.error('[complete-quests-for-game] failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
