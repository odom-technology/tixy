#!/usr/bin/env node
/**
 * Bumper cars sync test: eight real browsers in one real round.
 *
 * Each page is its own signed-up player in Chromium at 390 x 844 (touch),
 * its CPU throttled through CDP, reaching the server through its own TCP
 * proxy that adds 25 to 75 ms each way (50 to 150 ms round trips) with
 * jitter. All eight press play; the round starts when the eighth sits down.
 * Players drive with held arrow keys that change every second or so.
 * 30 s in, player 3's network goes down for 6 s (every connection through its
 * proxy is cut and new ones refused) and it must rejoin the same round on its
 * own. 50 s in, player 5 reloads the page and must land back in its car.
 *
 * Passes when every page ends on the same scoreboard as the server's settled
 * round in the database, with one ledger row per player who scored.
 *
 *   QA_BASE_URL=http://127.0.0.1:3256 DATABASE_URL=... node scripts/qa-bumper-cars-sync.mjs [outdir]
 *   QA_THROTTLE=4 (CPU slowdown, default 4)
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';

import pg from 'pg';
import { chromium } from 'playwright';

const outdir = process.argv[2] ?? '/tmp/gbc-sync';
mkdirSync(outdir, { recursive: true });
const base = new URL(process.env.QA_BASE_URL ?? 'http://127.0.0.1:3256');
const THROTTLE = Number(process.env.QA_THROTTLE ?? 4);
const N = 8;
const DROPPER = 3;
const RELOADER = 5;
const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);

// ── A latency proxy per player ───────────────────────────────────────────
function proxy(oneWayMs, jitterMs) {
  const sockets = new Set();
  let down = false;
  const server = net.createServer((client) => {
    if (down) {
      client.destroy();
      return;
    }
    const upstream = net.connect(Number(base.port), base.hostname);
    sockets.add(client);
    sockets.add(upstream);
    const pipe = (from, to) => {
      // One queue per direction, drained in order by one timer.
      const queue = [];
      let timer = null;
      let last = 0;
      const drain = () => {
        timer = null;
        const now = Date.now();
        while (queue.length > 0 && queue[0].at <= now) {
          const { chunk, end } = queue.shift();
          if (end) to.destroy();
          else if (!to.destroyed) to.write(chunk);
        }
        if (queue.length > 0) timer = setTimeout(drain, Math.max(0, queue[0].at - Date.now()));
      };
      const push = (item) => {
        queue.push(item);
        if (!timer) timer = setTimeout(drain, Math.max(0, queue[0].at - Date.now()));
      };
      from.on('data', (chunk) => {
        const at = Math.max(last, Date.now() + oneWayMs + (Math.random() * 2 - 1) * jitterMs);
        last = at;
        push({ at, chunk });
      });
      from.on('close', () => push({ at: Math.max(last, Date.now() + oneWayMs), end: true }));
      from.on('error', () => to.destroy());
    };
    pipe(client, upstream);
    pipe(upstream, client);
    client.on('close', () => sockets.delete(client));
    upstream.on('close', () => sockets.delete(upstream));
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({
        port: server.address().port,
        cut(ms) {
          down = true;
          for (const s of sockets) s.destroy();
          setTimeout(() => {
            down = false;
          }, ms);
        },
        close: () => server.close(),
      });
    });
  });
}

const browser = await chromium.launch({
  args: ['--use-angle=gl-egl', '--ignore-gpu-blocklist', '--disable-renderer-backgrounding', '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows'],
});
const suffix = Math.random().toString(36).slice(2, 7);
const players = [];
for (let i = 0; i < N; i += 1) {
  const oneWay = 25 + Math.round((i / (N - 1)) * 50);
  const px = await proxy(oneWay, 10);
  const origin = `http://127.0.0.1:${px.port}`;
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 1 });
  const page = await context.newPage();
  page.on('pageerror', (err) => log(`p${i} pageerror`, err.message));
  const username = `bc${suffix}${i}`;
  const res = await page.request.post(`${origin}/api/account/register`, {
    data: { email: `${username}@example.com`, password: 'bumper-cars-sync-1', username },
  });
  if (!res.ok()) throw new Error(`register ${i}: ${res.status()} ${await res.text()}`);
  players.push({ i, oneWay, px, origin, context, page, username });
}
log(`${N} players signed up, one-way latency ${players.map((p) => p.oneWay).join('/')} ms`);

const open = async (p) => {
  await p.page.goto(`${p.origin}/bumper-cars?arcadePerf=1&midwayTier=low`, { waitUntil: 'domcontentloaded', timeout: 180000 });
  await p.page.waitForFunction(() => typeof window.__bumperInfo === 'function', null, { timeout: 120000 });
  const cdp = await p.context.newCDPSession(p.page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: THROTTLE });
};
await Promise.all(players.map(open));
await Promise.all(players.map((p) => p.page.waitForFunction(() => !document.body.innerText.includes('Loading the rink.'), null, { timeout: 120000 })));
log(`pages open, CPU throttled ${THROTTLE}x`);

// Player 0 makes a room for friends; the others type its code. The round
// starts by itself when the eighth car is taken.
await players[0].page.getByRole('button', { name: 'friends', exact: true }).click();
await players[0].page.getByRole('button', { name: 'make a room', exact: true }).click();
await players[0].page.waitForSelector('.bc-lobby-code-value', { timeout: 30000 });
const code = (await players[0].page.textContent('.bc-lobby-code-value')).trim();
log(`player 0 made a room, code ${code}`);
await Promise.all(
  players.slice(1).map(async (p) => {
    await p.page.getByRole('button', { name: 'friends', exact: true }).click();
    await p.page.fill('#bc-code', code);
    await p.page.getByRole('button', { name: 'join', exact: true }).click();
  }),
);
const info = (p) => p.page.evaluate(() => window.__bumperInfo?.() ?? null).catch(() => null);
let rooms = await Promise.all(players.map(info));
for (let k = 0; k < 20 && rooms.some((r) => !r?.room); k += 1) {
  await new Promise((r) => setTimeout(r, 500));
  rooms = await Promise.all(players.map(info));
}
const roomIds = new Set(rooms.map((r) => r?.room));
log(`rooms: ${[...roomIds].join(', ')}`);
if (roomIds.size !== 1) throw new Error('players landed in different rooms');

// Drive: hold the throttle, change the wheel now and then.
const KEYS = ['ArrowLeft', 'ArrowRight', null];
let driving = true;
const drive = async (p) => {
  let held = null;
  await p.page.keyboard.down('ArrowUp').catch(() => {});
  while (driving) {
    const next = KEYS[Math.floor(Math.random() * KEYS.length)];
    if (held) await p.page.keyboard.up(held).catch(() => {});
    if (next) await p.page.keyboard.down(next).catch(() => {});
    held = next;
    await new Promise((r) => setTimeout(r, 300 + Math.random() * 1200));
    if (Math.random() < 0.08) {
      await p.page.keyboard.up('ArrowUp').catch(() => {});
      await p.page.keyboard.down('ArrowDown').catch(() => {});
      await new Promise((r) => setTimeout(r, 500));
      await p.page.keyboard.up('ArrowDown').catch(() => {});
      await p.page.keyboard.down('ArrowUp').catch(() => {});
    }
  }
};
const drivers = players.map((p) => drive(p));

// Wait for the power, then the drop and the reload.
const roundTick = async (p) => (await info(p))?.roundTick ?? -999;
while ((await roundTick(players[0])) < 0) await new Promise((r) => setTimeout(r, 500));
log('power on');
const samples = [];
const sampler = setInterval(async () => {
  const s = await Promise.all(players.map(info));
  samples.push(s);
}, 5000);
while ((await roundTick(players[0])) < 30 * 60) await new Promise((r) => setTimeout(r, 500));
log(`player ${DROPPER}: network down for 6 s`);
players[DROPPER].px.cut(6000);
let back = false;
const watchBack = (async () => {
  for (let k = 0; k < 60; k += 1) {
    await new Promise((r) => setTimeout(r, 500));
    const s = await info(players[DROPPER]);
    if (k > 12 && s?.status === 'live') {
      back = true;
      log(`player ${DROPPER} back in its car (reconnects ${s.net?.reconnects})`);
      return;
    }
  }
})();
while ((await roundTick(players[0])) < 50 * 60) await new Promise((r) => setTimeout(r, 500));
log(`player ${RELOADER}: reloads the page`);
await players[RELOADER].page.reload({ waitUntil: 'domcontentloaded' });
await players[RELOADER].page.waitForFunction(() => window.__bumperInfo?.()?.status === 'live', null, { timeout: 60000 });
const reloadInfo = await info(players[RELOADER]);
log(`player ${RELOADER} back after reload: room ${reloadInfo.room === [...roomIds][0] ? 'the same' : 'DIFFERENT'}, round tick ${reloadInfo.roundTick}`);
const cdp5 = await players[RELOADER].context.newCDPSession(players[RELOADER].page);
await cdp5.send('Emulation.setCPUThrottlingRate', { rate: THROTTLE });
drivers.push(drive(players[RELOADER]));
await watchBack;

// The end: every page's result card, settled.
await Promise.all(
  players.map((p) =>
    p.page.waitForFunction(
      () => {
        const ol = document.querySelector('[data-testid="bumper-standings"]');
        return Boolean(ol);
      },
      null,
      { timeout: 180000 },
    ),
  ),
);
driving = false;
clearInterval(sampler);
await new Promise((r) => setTimeout(r, 3000));
const boards = await Promise.all(
  players.map((p) =>
    p.page.evaluate(() => {
      const ol = document.querySelector('[data-testid="bumper-standings"]');
      return {
        round: ol?.getAttribute('data-round'),
        rows: [...(ol?.querySelectorAll('li') ?? [])].map((li) => `${li.getAttribute('data-seat')}:${li.getAttribute('data-points')}`),
        text: document.body.innerText.match(/tickets\s*\n?\s*(\d+)/i)?.[1] ?? null,
      };
    }),
  ),
);
for (const [i, p] of players.entries()) await p.page.screenshot({ path: path.join(outdir, `player-${i}-result.png`) });

// The database: wait for the settle.
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
const roundId = boards[0].round;
let round = null;
for (let k = 0; k < 60; k += 1) {
  round = (await db.query('SELECT status, standings_json FROM bumper_car_rounds WHERE id = $1', [roundId])).rows[0];
  if (round?.status === 'settled') break;
  await new Promise((r) => setTimeout(r, 500));
}
const ledger = (await db.query(`SELECT user_id, amount FROM currency_ledger WHERE source_id LIKE $1`, [`bumper-cars:${roundId}:%`])).rows;
const dbBoard = JSON.parse(round?.standings_json ?? '[]').map((s) => `${s.seat}:${s.points}`);
await db.end();

const same = boards.every((b) => b.round === roundId && b.rows.join(',') === dbBoard.join(','));
log(`round ${roundId}: ${round?.status}`);
log(`server scoreboard: ${dbBoard.join(' ')}`);
boards.forEach((b, i) => log(`player ${i}: ${b.rows.join(' ')} ${b.rows.join(',') === dbBoard.join(',') ? 'same' : 'DIFFERENT'}`));
const scored = JSON.parse(round?.standings_json ?? '[]').filter((s) => s.result !== 'bot' && s.result !== 'forfeit' && s.points > 0).length;
log(`ledger rows for the round: ${ledger.length} (players who scored: ${scored}), tickets ${ledger.map((l) => l.amount).join('/')}`);

// Netcode numbers, from the last sample in the round.
const live = samples.filter((s) => s.every((x) => x?.phase === 'live')).pop() ?? samples.pop() ?? [];
live.forEach((s, i) => {
  const n = s?.net;
  if (!n) return;
  log(
    `player ${i}: rtt ${n.rttMs.toFixed(0)} ms, input lead ${n.ibMean.toFixed(1)} ticks, own car moved by ${n.myMoved} snapshots ` +
      `(mean ${(n.myMovedMean * 100).toFixed(1)} cm, max ${(n.myMovedMax * 100).toFixed(0)} cm), others ${(n.othersMovedMean * 100).toFixed(1)} cm, tier ${s.tier}`,
  );
});
writeFileSync(path.join(outdir, 'result.json'), JSON.stringify({ roundId, dbBoard, boards, ledger, samples }, null, 2));

const pass = same && round?.status === 'settled' && ledger.length === scored && back && reloadInfo.room === [...roomIds][0];
log(pass ? 'PASS' : 'FAIL');
await browser.close();
for (const p of players) p.px.close();
process.exit(pass ? 0 : 1);
