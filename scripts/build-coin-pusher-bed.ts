/**
 * Writes the coin pusher's starting bed:
 *
 *   npx tsx scripts/build-coin-pusher-bed.ts
 *
 * Every new machine starts from this bed (src/features/arcade/lib/coin-pusher/bed.json).
 * It is cpBuildBed()'s output, settled. verify-coin-pusher-rtp.ts rebuilds it and
 * fails if the file and the builder disagree.
 */
import { writeFileSync } from 'node:fs';
import path from 'node:path';

import { cpBuildBed, cpHash } from '@/features/arcade/lib/coin-pusher/engine';

const bed = cpBuildBed();
const file = path.join(process.cwd(), 'src/features/arcade/lib/coin-pusher/bed.json');
writeFileSync(file, `${JSON.stringify(bed)}\n`);
console.log(`bed: ${bed.coins.length} coins, step ${bed.step}, settled ${bed.settled}, hash ${cpHash(bed)}`);
