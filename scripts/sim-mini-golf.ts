/**
 * Mini golf tuning by simulation: every template, both mirrors, every slot,
 * with and without a bowl, played by each simulated skill. Prints mean
 * strokes, the share of holes in one and the pickups, so par and the
 * physics can be set from numbers.
 *
 *   npx tsx scripts/sim-mini-golf.ts [trials=24] [templateId]
 *
 * One template per process; run them side by side:
 *   for t in pier dogleg ...; do npx tsx scripts/sim-mini-golf.ts 40 $t & done; wait
 */
import { MG_TEMPLATES, mgBuildHole, type MgBuildOptions } from '../src/server/arcade/mini-golf-course';
import { SKILLS, distanceField, playHole, rngFrom } from './lib/mini-golf-bot';

const trials = Number(process.argv[2] ?? 24);
const only = process.argv[3];
for (const t of MG_TEMPLATES) {
  if (only && t.id !== only) continue;
  const variants: MgBuildOptions[] = [];
  for (const mirror of [false, true]) {
    for (const slot of t.slot ?? ['none']) {
      for (const bowl of t.bowl === 'maybe' ? [false, true] : [Boolean(t.bowl)]) {
        variants.push({ mirror, slot, bowl, millPhase: 0.37, cupDx: 0, cupDy: 0, teeDx: 0 });
      }
    }
  }
  const line: string[] = [`${t.id.padEnd(10)} par ${t.par}`];
  for (const skill of SKILLS) {
    let total = 0;
    let n = 0;
    let pickups = 0;
    let ones = 0;
    let worst = 0;
    for (const [vi, v] of variants.entries()) {
      const hole = mgBuildHole(t, v);
      const field = distanceField(hole);
      const rng = rngFrom(1000 + vi * 97 + skill.name.length * 13);
      for (let i = 0; i < Math.ceil(trials / variants.length); i += 1) {
        const r = playHole(hole, skill, rng, field);
        total += r.score;
        n += 1;
        if (!r.holed) pickups += 1;
        if (r.score === 1) ones += 1;
        worst = Math.max(worst, r.score);
      }
    }
    line.push(`${skill.name} ${(total / n).toFixed(2)} ace ${((100 * ones) / n).toFixed(0)}% pick ${pickups} worst ${worst}`);
  }
  console.log(line.join(' | '));
}
