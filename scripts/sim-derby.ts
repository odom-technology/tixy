/**
 * Derby by simulation: how fast each skill runs, places and tickets.
 *
 *   npx tsx scripts/sim-derby.ts [--races=400]
 *
 * A simulated player is one of the bot skills (DERBY_BOT_SKILLS): the same
 * hand model the bots use, with its own seed. Races put that player in lane
 * 3 against seven bots drawn from the seed exactly as a real race fills
 * them, through DerbyRaceModel, the model the server judges with. Tickets
 * are derbyTickets for the place. A minute of play is a race plus 3 s of
 * countdown and 12 s between races (the result, rematch and the next gate).
 * Deterministic: every seed is fixed.
 */
import {
  DERBY_BOT_SKILLS,
  DERBY_DISTANCE,
  DERBY_MAX_TICKS,
  DERBY_TICK_MS,
  DerbyRaceModel,
  derbyBotSamples,
  derbyPlaceOf,
  derbyTickets,
  derbyTracking,
} from '../src/features/arcade/lib/derby';

const args = Object.fromEntries(
  process.argv.slice(2).map((arg) => {
    const match = arg.match(/^--([^=]+)(?:=(.*))?$/);
    return match ? [match[1], match[2] ?? 'true'] : [arg, 'true'];
  }),
) as Record<string, string>;

const RACES = Number(args.races ?? 400);
const LANE = 3;

type Row = { name: string; solo: number[]; race: number[]; places: number[]; tickets: number[]; onShare: number[]; bull: number[]; meanOn: number[] };

const rows: Row[] = DERBY_BOT_SKILLS.map((s) => ({ name: s.name, solo: [], race: [], places: [], tickets: [], onShare: [], bull: [], meanOn: [] }));

for (let r = 0; r < RACES; r += 1) {
  const seed = (0x51ed270b + r * 2654435761) >>> 0;
  for (let skill = 0; skill < DERBY_BOT_SKILLS.length; skill += 1) {
    const model = new DerbyRaceModel(seed, [{ lane: LANE, kind: 'human' }]);
    // The player: the skill's hand on its own seed.
    const mine = derbyBotSamples(seed ^ 0x5bd1e995, LANE, skill, model.path);
    model.confirm(LANE, 0, 0, mine);
    const result = model.decided();
    if (!result) throw new Error('undecided');
    const place = derbyPlaceOf(result, LANE);
    const row = rows[skill]!;
    row.race.push(result.endT);
    row.places.push(place);
    row.tickets.push(derbyTickets(place));
    const cross = model.crossTime(LANE);
    row.solo.push(cross ?? Infinity);
    const track = derbyTracking(model, LANE, cross !== null ? Math.ceil(cross / DERBY_TICK_MS) : DERBY_MAX_TICKS);
    row.onShare.push(track.squirting ? track.onTarget / track.squirting : 0);
    row.bull.push(track.squirting ? track.onBull / track.squirting : 0);
    row.meanOn.push(track.meanOn);
  }
}

const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
const median = (a: number[]) => {
  const s = [...a].sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)]!;
};
const pct = (n: number) => `${Math.round(n * 100)}%`;

console.log(`${RACES} races per skill, ${DERBY_DISTANCE} lengths\n`);
console.log('| Player | Own time to the wire (median) | Mean race | Win | Top 3 | Mean place | On target | On the bull | Mean distance on target | Tickets a race | Tickets a minute |');
console.log('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
for (const row of rows) {
  const race = mean(row.race) / 1000;
  const perMin = (mean(row.tickets) * 60) / (race + 15);
  console.log(
    `| ${row.name} | ${Number.isFinite(median(row.solo)) ? `${(median(row.solo) / 1000).toFixed(1)} s` : 'not home'} | ${race.toFixed(1)} s | ${pct(mean(row.places.map((p) => (p === 1 ? 1 : 0))))} | ${pct(mean(row.places.map((p) => (p <= 3 ? 1 : 0))))} | ${mean(row.places).toFixed(2)} | ${pct(mean(row.onShare))} | ${pct(mean(row.bull))} | ${mean(row.meanOn).toFixed(2)} | ${Math.round(mean(row.tickets))} | ${Math.round(perMin)} |`,
  );
}
