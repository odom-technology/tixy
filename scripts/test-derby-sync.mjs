#!/usr/bin/env node
/**
 * Derby's sync test: eight phones in one water race.
 *
 *   node scripts/test-derby-sync.mjs --base=http://127.0.0.1:3245 [--clients=8]
 *     [--throttle=4] [--drop=3] [--offline=5] [--db=arcade_dw] [--headed]
 *
 * - Registers one throwaway account per client, opens eight headless
 *   Chromium pages at 390 x 844 (touch, SwiftShader, the CPU throttled
 *   through CDP), and puts them in one invite race: client 0 opens it, the
 *   others follow the invite link, client 0 starts it.
 * - Every page aims through the stage's own path: a hand inside the page
 *   chases the target with its own reaction time, wander and lapses; the
 *   stage samples it every tick, predicts its horse and sends the samples
 *   to the server in batches.
 * - Client --drop closes its page once the server holds 3 s of its aim and
 *   opens /derby again; it must come back to the same lane of the same
 *   race, with what it sent before, and aim on. Client --offline loses its
 *   network for 12 s mid-race and keeps its page.
 * - When every page has reached the wire, each page's result (winner, end
 *   time, order) and every lane's distance at the wire, computed from the
 *   samples it holds, must equal the server's to the last bit, and the
 *   database must hold one settlement and one ticket row per paid player.
 *
 * Exits 1 on any mismatch. Prints how late other lanes' news arrived on
 * each phone (a horse carried forward glides to the news).
 */
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    return m ? [m[1], m[2] ?? true] : [a, true];
  }),
);
const BASE = String(args.base ?? 'http://127.0.0.1:3245').replace(/\/$/, '');
const CLIENTS = Number(args.clients ?? 8);
const THROTTLE = Number(args.throttle ?? 4);
const DROP = Number(args.drop ?? 3);
const OFFLINE = Number(args.offline ?? 5);
const DB = String(args.db ?? 'arcade_dw');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(`[${new Date().toISOString().slice(11, 23)}]`, ...a);
const fail = [];

// One browser per phone: each gets its own GPU process, as each phone has
// its own GPU.
const browsers = [];
const launch = () =>
  chromium.launch({
    headless: !args.headed,
    args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist'],
  });

async function openClient(i) {
  const browser = await launch();
  browsers.push(browser);
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
  const name = `sync${i}${Math.random().toString(36).slice(2, 7)}`;
  const reg = await ctx.request.post(`${BASE}/api/account/register`, {
    data: { email: `${name}@example.com`, password: 'derby-sync-pass-123', username: name },
  });
  if (!reg.ok()) throw new Error(`register ${i}: ${reg.status()} ${await reg.text()}`);
  const userId = (await reg.json()).account?.id;
  return { i, ctx, name, userId, page: null };
}

async function openPage(client, path, { throttleAfterLoad = false } = {}) {
  const page = await client.ctx.newPage();
  page.on('pageerror', (e) => log(`client ${client.i} pageerror`, e.message));
  const cdp = THROTTLE > 1 ? await client.ctx.newCDPSession(page) : null;
  if (cdp && !throttleAfterLoad) await cdp.send('Emulation.setCPUThrottlingRate', { rate: THROTTLE });
  await page.goto(`${BASE}${path}`, { waitUntil: 'load', timeout: 180_000 });
  await page.waitForFunction(() => !!window.__derby, null, { timeout: 180_000 });
  if (cdp && throttleAfterLoad) await cdp.send('Emulation.setCPUThrottlingRate', { rate: THROTTLE });
  // Frame times from here on.
  await page.evaluate(() => {
    window.__frames = [];
    let last = performance.now();
    const step = (now) => {
      window.__frames.push(now - last);
      last = now;
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
  client.page = page;
  return page;
}

/** Aim from inside the page until the wire: a hand that sees the target a
 *  reaction time late, wanders a little and lets go now and then. */
async function startAiming(page, seed) {
  await page.evaluate((seed) => {
    let s = seed >>> 0;
    const rnd = () => {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = Math.imul(s ^ (s >>> 15), s | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const skill = 0.5 + rnd() * 0.5;
    const lag = 260 - 110 * skill;
    const sigma = 0.12 - 0.07 * skill;
    const hist = [];
    let ex = 0;
    let ey = 0;
    let ax = 0;
    let ay = 0;
    let lapse = 0;
    const step = () => {
      const g = window.__derby;
      if (!g) return;
      if (g.phaseNow === 'finish') return;
      const now = performance.now();
      const t = g.targetNow();
      hist.push({ now, x: t.x, y: t.y });
      while (hist.length > 2 && now - hist[1].now > lag) hist.shift();
      ex = ex * 0.97 + (rnd() - 0.5) * sigma * 0.5;
      ey = ey * 0.97 + (rnd() - 0.5) * sigma * 0.4;
      ax += (hist[0].x + ex - ax) * (0.2 + 0.25 * skill);
      ay += (hist[0].y + ey - ay) * (0.2 + 0.25 * skill);
      if (lapse <= 0 && rnd() < 0.004) lapse = 10 + rnd() * 25;
      if (lapse > 0) lapse -= 1;
      g.debugAim(ax, ay, lapse <= 0);
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }, seed);
}

const psql = (sql) =>
  execFileSync('docker', ['exec', 'arcade-dev-postgres', 'psql', '-U', 'arcade', '-d', DB, '-At', '-F', '|', '-c', sql], {
    encoding: 'utf8',
  }).trim();

try {
  log(`registering ${CLIENTS} accounts`);
  const clients = [];
  for (let i = 0; i < CLIENTS; i += 1) clients.push(await openClient(i));

  // Client 0 opens an invite race.
  const host = clients[0];
  const created = await host.ctx.request.post(`${BASE}/api/games/derby/race`, { data: { kind: 'invite' } });
  const { raceId, invite } = await created.json();
  log('race', raceId, 'code', invite.code);
  await openPage(host, `/derby?derbyDebug=1&race=${raceId}`);
  // The others follow the link.
  await Promise.all(clients.slice(1).map((c) => openPage(c, `/derby?derbyDebug=1&code=${invite.code}`)));
  // Wait for every join to land. A full lobby (8 of 8) starts by itself.
  let before = null;
  for (let k = 0; k < 120; k += 1) {
    before = await (await host.ctx.request.get(`${BASE}/api/games/derby/race/${raceId}`)).json();
    if (before.lanes.filter((l) => l.kind === 'human').length >= CLIENTS || before.status !== 'lobby') break;
    await sleep(500);
  }
  const humans = before.lanes.filter((l) => l.kind === 'human');
  log('lanes taken', humans.length, humans.map((l) => `${l.lane}:${l.name}`).join(' '), 'status', before.status);
  if (humans.length !== CLIENTS) fail.push(`lobby has ${humans.length} people, wanted ${CLIENTS}`);
  if (before.status === 'lobby') {
    const start = await host.ctx.request.post(`${BASE}/api/games/derby/race/${raceId}/start`);
    if (!start.ok()) {
      // The eighth join can start a full lobby a moment before the host does.
      const now = await (await host.ctx.request.get(`${BASE}/api/games/derby/race/${raceId}`)).json();
      if (now.status !== 'running') throw new Error(`start ${start.status()}`);
    }
  }
  const started = Date.now();
  log('started');
  await Promise.all(clients.map((c, i) => startAiming(c.page, 1000 + i * 7919)));

  // A network drop: one phone loses its connection for 12 s mid-race and
  // keeps its page; the poll and the pushes bring it back in step.
  const offliner = clients[OFFLINE];
  const offlineRun = offliner
    ? (async () => {
        await sleep(Math.max(0, started + 3_000 + 6_000 - Date.now()));
        log(`client ${OFFLINE} goes offline`);
        await offliner.ctx.setOffline(true);
        await sleep(12_000);
        await offliner.ctx.setOffline(false);
        log(`client ${OFFLINE} back online`);
      })()
    : Promise.resolve();

  // A rejoin: one phone closes the race page once the server holds 3 s of
  // its aim and opens /derby again. It must come back to the same lane of
  // the same race, with what it sent before, and aim on. (The page loads
  // unthrottled and is throttled once loaded: a throttled cold load under
  // eight SwiftShader pages on one machine is the test rig, not the game.)
  const dropper = clients[DROP];
  let rejoin = null;
  if (dropper) {
    let snapBefore = null;
    for (let k = 0; k < 240; k += 1) {
      snapBefore = await (await dropper.ctx.request.get(`${BASE}/api/games/derby/race/${raceId}?since=999999`)).json();
      if ((snapBefore.lanes.find((l) => l.lane === snapBefore.myLane)?.next ?? 0) >= 120) break;
      await sleep(250);
    }
    const myLane = snapBefore.myLane;
    const ticksBefore = snapBefore.lanes.find((l) => l.lane === myLane).next;
    log(`client ${DROP} closes its page (lane ${myLane}, ${ticksBefore} ticks held)`);
    await dropper.page.close();
    const closedAt = Date.now();
    const page = await openPage(dropper, '/derby?derbyDebug=1', { throttleAfterLoad: true });
    await page.waitForFunction(() => window.__derby.stats().phase !== 'idle', null, { timeout: 150_000 });
    const back = await page.evaluate(() => window.__derby.myLane);
    await page.waitForFunction((lane) => (window.__derby.debugState().known?.[lane] ?? 0) > 0, myLane, { timeout: 60_000 }).catch(() => undefined);
    const known = await page.evaluate((lane) => window.__derby.debugState().known[lane], myLane);
    rejoin = { lane: myLane, back, ticksBefore, known, awayMs: Date.now() - closedAt };
    log(`client ${DROP} back in lane ${back} after ${((Date.now() - closedAt) / 1000).toFixed(1)} s, holds ${known} of its ticks`);
    if (back !== myLane) fail.push(`rejoined lane ${back}, was ${myLane}`);
    if (known < ticksBefore) fail.push(`rejoined phone holds ${known} of ${ticksBefore} earlier ticks`);
    await startAiming(page, 4242);
  }
  await offlineRun;

  // Wait for every page to reach the wire.
  const deadline = Date.now() + 160_000;
  for (;;) {
    const phases = await Promise.all(clients.map((c) => c.page.evaluate(() => window.__derby.stats().phase).catch(() => 'gone')));
    if (phases.every((p) => p === 'finish')) break;
    if (Date.now() > deadline) {
      fail.push(`not every page finished: ${phases.join(', ')}`);
      break;
    }
    await sleep(1_000);
  }
  // Let the last pushes land and the server settle.
  let server = null;
  for (let k = 0; k < 20; k += 1) {
    server = await (await host.ctx.request.get(`${BASE}/api/games/derby/race/${raceId}?since=999999`)).json();
    if (server.status === 'finished') break;
    await sleep(500);
  }
  await sleep(2_500);
  log('server', server.status, 'winner lane', server.result?.winner + 1, 'end', server.result?.endT?.toFixed(3), 'ms');

  // Every page against the server: the result and every lane's distance
  // at the wire, from the samples each phone holds.
  const serverOrder = server.result.order.join(' ');
  const states = await Promise.all(clients.map((c) => c.page.evaluate(() => window.__derby.debugState())));
  const frames = await Promise.all(clients.map((c) => c.page.evaluate(() => window.__frames.slice(30))));
  const rows = [];
  states.forEach((state, i) => {
    const r = state.result;
    const same =
      r &&
      r.winner === server.result.winner &&
      r.endT === server.result.endT &&
      r.order.join(' ') === serverOrder &&
      r.distance.every((d, lane) => d === server.result.distance[lane]);
    if (!same) fail.push(`client ${i} result ${JSON.stringify(r && { w: r.winner, e: r.endT, o: r.order, d: r.distance })} differs from the server's`);
    const f = [...frames[i]].sort((a, b) => a - b);
    const med = f.length ? f[Math.floor(f.length / 2)] : 0;
    const ages = [...state.sync.ages].sort((a, b) => a - b);
    const ageMed = ages.length ? ages[Math.floor(ages.length / 2)] : 0;
    rows.push(
      `| ${i}${i === DROP ? ' (closed and reopened)' : i === OFFLINE ? ' (offline 12 s)' : ''} | ${r ? r.winner + 1 : '-'} | ${r ? r.endT.toFixed(3) : '-'} | ${r ? r.order.map((l) => l + 1).join(' ') : '-'} | ${state.sync.remote} | ${ageMed} | ${state.sync.late} | ${state.sync.maxLateMs.toFixed(0)} | ${state.sync.maxOffset.toFixed(2)} | ${state.sync.gaps} | ${med.toFixed(1)} | ${same ? 'yes' : 'NO'} |`,
    );
  });
  console.log('');
  console.log('| Phone | Winner lane | End (ms) | Order (lanes) | Batches from others | News age, median (ms) | Over 450 ms old | Oldest (ms) | Largest glide (lengths) | Gaps refetched | Frame median (ms) | Matches server |');
  console.log('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const row of rows) console.log(row);
  console.log('');

  // The ledger: one settle, one ticket row per paid player, no forfeits.
  const settled = psql(`SELECT status, settled_at IS NOT NULL FROM derby_water_races WHERE id = '${raceId}'`);
  const lanes = psql(`SELECT lane, place, coalesce(forfeit, '-'), tickets, paid_at IS NOT NULL FROM derby_water_lanes WHERE race_id = '${raceId}' AND kind = 'human' ORDER BY place`);
  const ledger = psql(`SELECT count(*), count(DISTINCT source_id), coalesce(sum(amount), 0) FROM currency_ledger WHERE source_id LIKE 'derby:${raceId}:%'`);
  const paidLanes = psql(`SELECT count(*), coalesce(sum(tickets), 0) FROM derby_water_lanes WHERE race_id = '${raceId}' AND tickets > 0`);
  log('race row', settled);
  log('lanes (lane|place|forfeit|tickets|paid)\n' + lanes);
  log('ledger rows|distinct|sum', ledger, ' lanes paid|sum', paidLanes);
  const [rowsN, distinctN, sum] = ledger.split('|').map(Number);
  const [paidN, paidSum] = paidLanes.split('|').map(Number);
  if (settled !== 'finished|t') fail.push(`race row ${settled}`);
  if (rowsN !== distinctN || rowsN !== paidN || sum !== paidSum) fail.push(`ledger ${ledger} against lanes ${paidLanes}`);
  if (/\|(timeout|left|idle)\|/.test(lanes)) fail.push('a player forfeited');
  // Every phone aimed to the end, the dropped ones included.
  const tails = psql(`SELECT l.lane, l.batches, l.wet_ticks, l.next_tick * 25 - r.end_t FROM derby_water_lanes l JOIN derby_water_races r ON r.id = l.race_id WHERE l.race_id = '${raceId}' AND l.kind = 'human' ORDER BY l.lane`);
  log('aim by lane (lane|batches|ticks with water|ms held past the wire)\n' + tails);
  for (const line of tails.split('\n')) {
    const [lane, batches, wet, past] = line.split('|').map(Number);
    if (batches < 20 || wet < 200 || past < -1_500) fail.push(`lane ${lane} stopped aiming (${batches} batches, ${wet} wet ticks, held to ${past} ms from the wire)`);
  }
  if (rejoin) {
    const after = Number(psql(`SELECT next_tick FROM derby_water_lanes WHERE race_id = '${raceId}' AND lane = ${rejoin.lane}`));
    rejoin.ticksAfter = after;
    log('rejoin', JSON.stringify(rejoin));
    if (after <= rejoin.ticksBefore + 40) fail.push('the rejoined phone sent no aim after it came back');
  }

  // Settling again changes nothing: a sweep and a heartbeat after the finish.
  await host.ctx.request.post(`${BASE}/api/games/derby/race/${raceId}/heartbeat`);
  await sleep(3_000);
  const ledgerAfter = psql(`SELECT count(*), coalesce(sum(amount), 0) FROM currency_ledger WHERE source_id LIKE 'derby:${raceId}:%'`);
  log('ledger after another sweep', ledgerAfter);
  if (ledgerAfter.split('|')[0] !== String(rowsN)) fail.push(`ledger changed after the race: ${ledgerAfter}`);
} catch (error) {
  fail.push(String(error?.stack ?? error));
} finally {
  await Promise.all(browsers.map((b) => b.close().catch(() => undefined)));
}

if (fail.length) {
  console.log('FAIL');
  for (const f of fail) console.log(' -', f);
  process.exit(1);
}
console.log("PASS: every phone reached the server's result from the same samples, the dropped phone came back to its lane, and the race paid once.");
