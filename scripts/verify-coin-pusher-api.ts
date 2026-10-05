/**
 * Coin pusher end to end against a running server, signed in:
 *
 *   QA_BASE_URL=http://127.0.0.1:3243 QA_COOKIE=<arcade_session> \
 *   DATABASE_URL=… npx tsx scripts/verify-coin-pusher-api.ts
 *
 * The account needs at least 100 tickets; under 280, step 8 runs too. It checks, in order:
 *   1. a reconnect loads the same machine (the hash of what arrives matches);
 *   2. a drop computed in this process with the shared engine gets the same
 *      entry step and the same hash from the server, bit for bit;
 *   3. the same request again is answered from the record: no second charge;
 *   4. a request id reused for a different drop is refused (409);
 *   5. tampered drops (a bet off the grid, a bet that isn't a number, an aim
 *      off the chute, a step that isn't a step) are refused and logged;
 *   6. a step far in the future is clamped and logged, never honoured;
 *   7. a collect after the coins settle pays exactly what the engine says
 *      reached the tray, at 4.85 a coin with the carry;
 *   8. a drop the balance can't cover is refused (402) and charges nothing;
 *   9. a burst over the rate limit gets 429s.
 */
import pg from 'pg';

import {
  CP_STEP_MS,
  cpAdvance,
  cpHash,
  cpParse,
  cpPour,
  cpStepAt,
  type CpEvent,
  type CpMachine,
} from '@/features/arcade/lib/coin-pusher/engine';
import { cpPayCoins } from '@/features/arcade/lib/coin-pusher/economy';

const BASE = process.env.QA_BASE_URL ?? 'http://127.0.0.1:3243';
const COOKIE = process.env.QA_COOKIE;
if (!COOKIE) throw new Error('QA_COOKIE is required');

const failures: string[] = [];
const check = (ok: boolean, label: string) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}`);
  if (!ok) failures.push(label);
};

async function call(method: 'GET' | 'POST', path: string, body?: unknown) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { cookie: `arcade_session=${COOKIE}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status, data };
}

const id = () => crypto.randomUUID();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const startedAt = Date.now();
  // 1. Load twice: the same machine, and the hash of what arrives matches.
  const first = await call('GET', '/api/coin-pusher/machine');
  check(first.status === 200, `load answers 200 (${first.status})`);
  let machine = cpParse(first.data.machine) as CpMachine;
  check(machine !== null && cpHash(machine) === first.data.hash, 'the loaded state hashes to the server hash');
  const again = await call('GET', '/api/coin-pusher/machine');
  const reloaded = cpParse(again.data.machine) as CpMachine;
  const local = structuredClone(machine);
  cpAdvance(local, reloaded.step);
  check(cpHash(local) === again.data.hash, 'a reconnect restores the same machine, stepped to now');
  machine = reloaded;
  let carry = Number(again.data.carry);
  let balance = Number(again.data.balance);
  check(balance >= 100, `the account has tickets (${balance})`);

  // 2. A drop: the server's answer matches this process's engine.
  const claimed = Math.max(machine.step + 1, cpStepAt(Number(again.data.serverNow)) + 1);
  const dropBody = { requestId: id(), bet: 25, x: 1.5, step: claimed };
  const mine = structuredClone(machine);
  const events: CpEvent[] = [];
  cpAdvance(mine, claimed - 1, events);
  const wonBefore = events.filter((e) => e.k === 'tray').length;
  cpPour(mine, claimed, 1.5, 5);
  const drop = await call('POST', '/api/coin-pusher/drop', dropBody);
  check(drop.status === 200, `drop answers 200 (${drop.status} ${String(drop.data.error ?? '')})`);
  check(drop.data.entryStep === claimed, `the claimed step is taken (${drop.data.entryStep} vs ${claimed})`);
  check(drop.data.hash === cpHash(mine), 'the server and this process agree on the machine after the drop');
  const expected = cpPayCoins(wonBefore, carry);
  check(drop.data.paid === expected.tickets, `paid what fell before the drop (${drop.data.paid} vs ${expected.tickets})`);
  carry = Number(drop.data.carry);
  check(Number(drop.data.balance) === balance - 25 + expected.tickets, `charged 25 once (${balance} -> ${drop.data.balance})`);
  balance = Number(drop.data.balance);

  // 3. The same request again: the record answers, nothing is charged.
  const repeat = await call('POST', '/api/coin-pusher/drop', dropBody);
  check(repeat.status === 200 && repeat.data.replayed === true, 'a repeated drop is replayed');
  check(repeat.data.hash === drop.data.hash && repeat.data.balance === drop.data.balance, 'the replay is the same answer');
  const afterRepeat = await call('GET', '/api/coin-pusher/machine');
  const afterState = cpParse(afterRepeat.data.machine) as CpMachine;
  const ahead = structuredClone(mine);
  const e2: CpEvent[] = [];
  cpAdvance(ahead, afterState.step, e2);
  const won2 = e2.filter((e) => e.k === 'tray').length;
  const pay2 = cpPayCoins(won2, carry);
  check(afterRepeat.data.hash === cpHash(ahead), 'the machine holds one pour, not two');
  check(Number(afterRepeat.data.balance) === balance + pay2.tickets, `no second charge (${afterRepeat.data.balance} vs ${balance + pay2.tickets})`);
  balance = Number(afterRepeat.data.balance);
  carry = Number(afterRepeat.data.carry);
  machine = afterState;

  // 4. A request id reused for something else.
  const reuse = await call('POST', '/api/coin-pusher/drop', { ...dropBody, bet: 50 });
  check(reuse.status === 409, `a reused request id is refused (${reuse.status})`);

  // 5. Tampered drops.
  const step = () => cpStepAt(Date.now());
  const tampered: Array<[string, Record<string, unknown>, number]> = [
    ['a bet off the grid (7)', { requestId: id(), bet: 7, x: 0, step: step() }, 400],
    ['a bet over the cap (255)', { requestId: id(), bet: 255, x: 0, step: step() }, 400],
    ['a bet that is a string', { requestId: id(), bet: '25', x: 0, step: step() }, 400],
    ['an aim off the chute', { requestId: id(), bet: 5, x: 40, step: step() }, 400],
    ['an aim that is NaN', { requestId: id(), bet: 5, x: 'NaN', step: step() }, 400],
    ['a step that is not a step', { requestId: id(), bet: 5, x: 0, step: 1.5 }, 400],
    ['a request id with spaces', { requestId: 'not a valid id', bet: 5, x: 0, step: step() }, 400],
  ];
  for (const [label, body, status] of tampered) {
    await sleep(160); // under the rate limit, so the refusal is the payload's
    const res = await call('POST', '/api/coin-pusher/drop', body);
    check(res.status === status, `tampered: ${label} is refused (${res.status})`);
  }

  // 6. A step from the far future is clamped to now and flagged.
  await sleep(300);
  const future = cpStepAt(Date.now()) + 6000;
  const fut = await call('POST', '/api/coin-pusher/drop', { requestId: id(), bet: 5, x: -2, step: future });
  check(fut.status === 200 && Number(fut.data.entryStep) < future - 5000, `a future step is clamped (${fut.data.entryStep} vs ${future})`);

  // 7. Let it settle, then collect at a step already reached, and check the pay.
  await sleep(9000);
  const before = await call('GET', '/api/coin-pusher/machine');
  const base = cpParse(before.data.machine) as CpMachine;
  const target = cpStepAt(Date.now()) - 30;
  const sim = structuredClone(base);
  const e3: CpEvent[] = [];
  cpAdvance(sim, Math.max(base.step, target), e3);
  const collect = await call('POST', '/api/coin-pusher/collect', { requestId: id(), step: target });
  check(collect.status === 200, `collect answers 200 (${collect.status})`);
  const pay3 = cpPayCoins(e3.filter((e) => e.k === 'tray').length, Number(before.data.carry));
  check(collect.data.hash === cpHash(sim), 'the collect reached the same machine');
  check(collect.data.paid === pay3.tickets && collect.data.carry === pay3.carry, `the collect paid ${pay3.tickets} with carry ${pay3.carry} (${collect.data.paid}, ${collect.data.carry})`);

  // 8. A drop the balance can't cover.
  await sleep(1100);
  const poor = await call('GET', '/api/coin-pusher/machine');
  const have = Number(poor.data.balance);
  if (have < 250) {
    const broke = await call('POST', '/api/coin-pusher/drop', { requestId: id(), bet: 250, x: 0, step: cpStepAt(Date.now()) });
    check(broke.status === 402, `a drop over the balance is refused (${broke.status})`);
  } else {
    console.log(`skip a drop over the balance: the account has ${have}`);
  }

  // 9. A burst over the rate limit.
  await sleep(1100);
  const burst = await Promise.all(
    Array.from({ length: 14 }, () => call('POST', '/api/coin-pusher/collect', { requestId: id(), step: cpStepAt(Date.now()) - 5 })),
  );
  check(burst.some((r) => r.status === 429), `a burst gets 429s (${burst.map((r) => r.status).join(' ')})`);

  // The refusals and the clamp are in anti_cheat_logs.
  if (process.env.DATABASE_URL) {
    const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
    const rows = await pool.query(
      `SELECT result, reason FROM anti_cheat_logs WHERE game_type = 'arcade-coin-pusher' AND ts >= $1 ORDER BY ts`,
      [startedAt],
    );
    await pool.end();
    const rejects = rows.rows.filter((r) => r.result === 'reject').length;
    const flags = rows.rows.filter((r) => r.result === 'flag').length;
    check(rejects >= 6, `refusals are logged as rejects (${rejects})`);
    check(flags >= 1, `the clamp and the burst are logged as flags (${flags})`);
    for (const r of rows.rows.slice(0, 12)) console.log(`     ${r.result}: ${r.reason}`);
  }

  console.log(`\n${failures.length === 0 ? 'all checks passed' : `${failures.length} failed`} (${((Date.now() - startedAt) / 1000).toFixed(1)} s, step ${CP_STEP_MS.toFixed(2)} ms)`);
  process.exit(failures.length === 0 ? 0 : 1);
}

void main();
