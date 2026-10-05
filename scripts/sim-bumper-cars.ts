/* Tunes bumper cars by simulation: plays rounds of bots on the shared engine
   and prints what a round looks like (bumps, points, speeds, stuck cars) by
   bot skill. The reward curve is fitted to these numbers.

     npx tsx scripts/sim-bumper-cars.ts [rounds]                 */

import { BOT_SKILLS, botInput, createBot, type BotSkill } from '../src/features/arcade/lib/bumper-cars/bots';
import { COUNTDOWN_TICKS, MAX_CARS, ROUND_TICKS } from '../src/features/arcade/lib/bumper-cars/constants';
import { createSim, setInputs, stepSim, type SimEvent } from '../src/features/arcade/lib/bumper-cars/sim';
import { bumperCarsTickets, roundScore } from '../src/features/arcade/lib/bumper-cars/rules';

const rounds = Number(process.argv[2] ?? 200);
const lineups: Array<{ name: string; skills: Array<keyof typeof BOT_SKILLS> }> = [
  { name: 'mixed', skills: ['hard', 'medium', 'medium', 'easy', 'hard', 'medium', 'easy', 'medium'] },
  { name: 'all medium', skills: new Array(MAX_CARS).fill('medium') },
];

const pct = (xs: number[], p: number) => {
  const s = xs.slice().sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))] ?? 0;
};

for (const lineup of lineups) {
  const bySkill = new Map<string, { points: number[]; bumps: number[]; tickets: number[]; wins: number }>();
  const closing: number[] = [];
  let stuckTicks = 0;
  let carTicks = 0;
  let walls = 0;
  let crowdedTicks = 0;
  let roundTicks = 0;
  for (let r = 0; r < rounds; r += 1) {
    const sim = createSim();
    const bots = lineup.skills.map((s, seat) => createBot(seat, 1000 + r, BOT_SKILLS[s] as BotSkill));
    const events: SimEvent[] = [];
    // Count in: no power.
    for (let t = 0; t < COUNTDOWN_TICKS; t += 1) stepSim(sim);
    sim.tick = 0;
    sim.powered = true;
    for (let t = 0; t < ROUND_TICKS; t += 1) {
      setInputs(sim, bots.map((b) => botInput(b, sim)));
      events.length = 0;
      stepSim(sim, events);
      for (const e of events) {
        if (e.type === 'bump') closing.push(e.speed);
        if (e.type === 'wall') walls += 1;
      }
      // A scrum: four or more cars within 2.4 m of one car.
      roundTicks += 1;
      let crowded = false;
      for (const a of sim.cars) {
        let n = 0;
        for (const b of sim.cars) if (a !== b && Math.hypot(a.x - b.x, a.z - b.z) < 2.4) n += 1;
        if (n >= 3) crowded = true;
      }
      if (crowded) crowdedTicks += 1;
      for (const c of sim.cars) {
        carTicks += 1;
        if (Math.hypot(c.vx, c.vz) < 0.3) stuckTicks += 1;
      }
    }
    const best = Math.max(...sim.points);
    lineup.skills.forEach((skill, seat) => {
      const row = bySkill.get(skill) ?? { points: [], bumps: [], tickets: [], wins: 0 };
      row.points.push(sim.points[seat]!);
      row.bumps.push(sim.bumps[seat]!);
      const place = 1 + sim.points.filter((p) => p > sim.points[seat]!).length;
      row.tickets.push(bumperCarsTickets(roundScore(sim.points[seat]!, place, MAX_CARS)));
      if (sim.points[seat] === best) row.wins += 1;
      bySkill.set(skill, row);
    });
  }
  console.log(`\n${lineup.name}, ${rounds} rounds of 90 s`);
  console.log('skill    points p10/p50/p90   bumps p50   tickets p10/p50/p90   wins');
  for (const [skill, row] of bySkill) {
    console.log(
      `${skill.padEnd(8)} ${pct(row.points, 0.1)}/${pct(row.points, 0.5)}/${pct(row.points, 0.9)}`.padEnd(30) +
        `${pct(row.bumps, 0.5)}`.padEnd(12) +
        `${pct(row.tickets, 0.1)}/${pct(row.tickets, 0.5)}/${pct(row.tickets, 0.9)}`.padEnd(22) +
        `${((row.wins / rounds) * 100 / lineup.skills.filter((s) => s === skill).length).toFixed(0)}%`,
    );
  }
  console.log(
    `closing speed p10/p50/p90 ${pct(closing, 0.1).toFixed(1)}/${pct(closing, 0.5).toFixed(1)}/${pct(closing, 0.9).toFixed(1)} m/s, ` +
      `big bumps ${((closing.filter((c) => c >= 4).length / Math.max(1, closing.length)) * 100).toFixed(0)}%, ` +
      `bumps a round ${(closing.length / rounds).toFixed(0)}, rail hits a round ${(walls / rounds).toFixed(0)}, ` +
      `standing still ${((stuckTicks / carTicks) * 100).toFixed(0)}% of the time, ` +
      `a scrum of 4 or more ${((crowdedTicks / roundTicks) * 100).toFixed(0)}% of the round`,
  );
}
