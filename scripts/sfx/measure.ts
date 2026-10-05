/* How loud every cue is, as the player hears it. Renders each procedural
   cue offline and decodes each sample in a headless Chromium on a running
   server's /kit/sounds, then prints the loudest 50 ms of each (dBFS, at
   volume 1). For a sampled cue it also prints the volume that would put
   the sample level with the procedural sound it replaces: start there,
   then lift the moments that should stand out.

     TIXY_URL=http://localhost:3002 npx tsx scripts/sfx/measure.ts [--all] [--json] */

import { chromium } from 'playwright';

type Row = { cue: string; synthDb: number | null; sfx: string | null; volume: number; sampleDb: number | null };

const base = process.env.TIXY_URL ?? 'http://localhost:3002';
const all = process.argv.includes('--all');
const json = process.argv.includes('--json');

const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  // tsx keeps function names with a __name helper the page does not have.
  await page.addInitScript('globalThis.__name = (fn) => fn');
  await page.goto(`${base}/kit/sounds`, { waitUntil: 'load' });
  await page.waitForFunction(() => '__tixySound' in window, undefined, { timeout: 60_000 });
  const result = await page.evaluate(async () => {
    type Api = {
      renderProceduralCue: (name: string) => Promise<Float32Array | null>;
      SFX_BANK: Record<string, { files: readonly string[] }>;
      SAMPLED_CUES: Record<string, { sfx: string; volume?: number }>;
      ARCADE_SOUND_CUES: readonly string[];
    };
    const api = (window as unknown as { __tixySound: Api }).__tixySound;
    const punch = (d: Float32Array) => {
      const win = 2205;
      let sum = 0;
      let best = 0;
      for (let i = 0; i < d.length; i += 1) {
        sum += d[i]! * d[i]!;
        if (i >= win) sum -= d[i - win]! * d[i - win]!;
        if (sum > best) best = sum;
      }
      return Math.sqrt(best / Math.min(win, Math.max(1, d.length)));
    };
    const db = (x: number) => Math.round(20 * Math.log10(Math.max(x, 1e-9)) * 10) / 10;
    const decoder = new OfflineAudioContext(1, 44100, 44100);
    const sfxDb: Record<string, number> = {};
    for (const [id, entry] of Object.entries(api.SFX_BANK)) {
      const levels = await Promise.all(
        entry.files.map(async (url) => {
          const bytes = await (await fetch(url)).arrayBuffer();
          return punch((await decoder.decodeAudioData(bytes)).getChannelData(0));
        }),
      );
      sfxDb[id] = db(levels.reduce((a, b) => a + b, 0) / levels.length);
    }
    const rows: Row[] = [];
    for (const cue of api.ARCADE_SOUND_CUES) {
      const synth = await api.renderProceduralCue(cue);
      const mapped = api.SAMPLED_CUES[cue];
      rows.push({
        cue,
        synthDb: synth ? db(punch(synth)) : null,
        sfx: mapped?.sfx ?? null,
        volume: mapped?.volume ?? 1,
        sampleDb: mapped ? sfxDb[mapped.sfx]! : null,
      });
    }
    return { rows, sfxDb };
  });

  if (json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    const fmt = (n: number | null) => (n === null ? '     -' : n.toFixed(1).padStart(6));
    console.log('cue                      synth  sample(at volume)  volume  level match');
    for (const r of result.rows) {
      if (!all && !r.sfx) continue;
      const heard = r.sampleDb === null ? null : Math.round((r.sampleDb + 20 * Math.log10(r.volume)) * 10) / 10;
      const match = r.synthDb !== null && r.sampleDb !== null
        ? (Math.pow(10, (r.synthDb - r.sampleDb) / 20)).toFixed(2)
        : '';
      console.log(`${r.cue.padEnd(24)} ${fmt(r.synthDb)}  ${fmt(heard)} ${(r.sfx ?? '').padEnd(16)} ${r.volume.toFixed(2).padStart(5)}  ${match}`);
    }
    if (all) {
      console.log('\nsample              level');
      for (const [id, level] of Object.entries(result.sfxDb)) console.log(`${id.padEnd(20)}${fmt(level)}`);
    }
  }
} finally {
  await browser.close();
}
