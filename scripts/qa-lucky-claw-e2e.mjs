#!/usr/bin/env node
/**
 * Authenticated Postgres-backed QA coverage for Lucky Cage and Prize Claw.
 *
 *   npm run test:qa-lucky-claw
 *   QA_BASE_URL=http://127.0.0.1:3000 node scripts/qa-lucky-claw-e2e.mjs
 *
 * Runs against a REAL app + REAL Postgres as the CI QA account, and asserts
 * both cabinets end to end:
 *
 *   money / session invariants  → API-first (POST /api/wagers/session,
 *                                 /api/wagers/action, /api/wagers/settle,
 *                                 GET /api/wagers/history and the wallet)
 *   interaction / animation /   → Chromium, on the shipped pages
 *   layout
 *
 * ── The independent oracle ────────────────────────────────────────────────
 *
 * This file deliberately does NOT import the game modules. It restates the
 * published maths — mulberry32, the sha256 sub-seed derivation, the unbiased
 * payout rounding, the Lucky Cage combinatorics, and the Prize Claw bed
 * generator — so a bug inside the shared module cannot mark itself correct.
 * Every claw round cross-checks the ported bed against the server's answer
 * (target index/tier/exposure/coordinates and the grip chance), which is also
 * how "the public bedSeed reproduces the populated bed" is proved. The browser
 * pass proves it a second time through the real shared module, via the
 * cabinet's own "Bed check" panel.
 *
 * ── Randomness safety ─────────────────────────────────────────────────────
 *
 * Nothing here requires a particular win or loss. Outcomes are asserted as
 * FUNCTIONS of the revealed seed (grabRoll < grip → grabbed, and so on), and
 * the only outcome pinned by construction is `empty`, which is reached by
 * aiming at a bed corner no prize centroid can legally occupy.
 *
 * ── Secrets ───────────────────────────────────────────────────────────────
 *
 * Reads QA_BASE_URL / QA_SMOKE_EMAIL / QA_SMOKE_PASSWORD, plus the optional
 * QA_ALLOW_ADMIN_FUNDING flag for the isolated Forgejo `app` service.
 * Credentials, cookies, session tokens and raw auth bodies are never printed,
 * screenshotted or written to disk; every log line goes through redact().
 * Screenshots are refused if the page text contains the QA email.
 */
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

/* ══════════════════════════════════════════════════════════════════════════
   Config
   ══════════════════════════════════════════════════════════════════════════ */

const requiredQaEnv = ['QA_BASE_URL', 'QA_SMOKE_EMAIL', 'QA_SMOKE_PASSWORD'];
const missingQaEnv = requiredQaEnv.filter((name) => !process.env[name]);
if (missingQaEnv.length > 0) {
  throw new Error(`Missing required QA environment: ${missingQaEnv.join(', ')}`);
}
const BASE = process.env.QA_BASE_URL.replace(/\/$/, '');
const EMAIL = process.env.QA_SMOKE_EMAIL;
const PASSWORD = process.env.QA_SMOKE_PASSWORD;
const QA_SUITE = process.env.QA_DEEP_SUITE ?? 'all';
const QA_PROFILE = process.env.QA_DEEP_PROFILE ?? 'full';
if (!['all', 'cage', 'claw'].includes(QA_SUITE)) {
  throw new Error(`QA_DEEP_SUITE must be all, cage, or claw (received ${QA_SUITE})`);
}
if (!['required', 'full'].includes(QA_PROFILE)) {
  throw new Error(`QA_DEEP_PROFILE must be required or full (received ${QA_PROFILE})`);
}
const RUN_CAGE = QA_SUITE === 'all' || QA_SUITE === 'cage';
const RUN_CLAW = QA_SUITE === 'all' || QA_SUITE === 'claw';
const FULL_TIMELINE = QA_PROFILE === 'full';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const EVIDENCE_DIR = path.join(ROOT, 'qa-evidence');

/** Smallest legal stake. Every API round bets exactly this. */
const STAKE = 5;
/** Ticket balance the browser pass wants available before it starts. */
const FUND_TARGET = 900;
/** Absolute ceiling the wager validator accepts — used to provoke a clean 402. */
const ABSURD_WAGER = 1_000_000_000_000;

const DESKTOP = { width: 1440, height: 900 };
const MOBILE = { width: 390, height: 844 };

/** Wall-clock budget for one Lucky Cage draw (timeline is ~9.3 s at full motion). */
const CAGE_ROUND_MS = 20_000;
/** Wall-clock budget for one claw drop (timeline is ~6.0 s at full motion). */
const CLAW_DROP_MS = 20_000;
/** Client-side positioning clock before Prize Claw auto-commits. */
const CLAW_COMMIT_MS = 12_000;
/** Hard stop for the whole harness, well inside the CI step timeout. */
const HARNESS_BUDGET_MS = 13 * 60_000;

/* ══════════════════════════════════════════════════════════════════════════
   Redaction + reporting
   ══════════════════════════════════════════════════════════════════════════ */

const SECRETS = [EMAIL, PASSWORD].filter(Boolean);

/** Strip anything credential-shaped before it reaches stdout. */
function redact(value) {
  let text = typeof value === 'string' ? value : String(value);
  for (const secret of SECRETS) {
    if (secret) text = text.split(secret).join('«redacted»');
  }
  // Session tokens and cookies are long opaque strings; never echo one.
  text = text.replace(/\b[A-Za-z0-9_-]{40,}\b/g, '«redacted-token»');
  return text;
}

function say(line) {
  console.log(redact(line));
}

const matrix = [];
let failures = 0;

function record(area, name, status, http, state, delta, note) {
  if (status === 'FAIL') failures += 1;
  matrix.push({
    area,
    name,
    status,
    http: http ?? '',
    state: state ?? '',
    delta: delta === undefined || delta === null ? '' : String(delta),
    note: note ?? '',
  });
  const glyph = status === 'PASS' ? '✓' : status === 'SKIP' ? '·' : '✗';
  say(
    `${glyph} ${area} · ${name}` +
      (http ? ` · HTTP ${http}` : '') +
      (state ? ` · ${state}` : '') +
      (delta === undefined || delta === null ? '' : ` · Δ${delta}`) +
      (note ? ` · ${note}` : ''),
  );
}

function check(condition, message) {
  if (!condition) throw new Error(message);
}

function near(a, b, tolerance = 1e-9) {
  return Math.abs(a - b) <= tolerance;
}

/** Run one case, capture its own PASS/FAIL row, and never abort the suite. */
async function step(area, name, fn) {
  try {
    const outcome = (await fn()) ?? {};
    record(
      area,
      name,
      outcome.status ?? 'PASS',
      outcome.http,
      outcome.state,
      outcome.delta,
      outcome.note,
    );
    return outcome;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    record(area, name, 'FAIL', undefined, undefined, undefined, message.slice(0, 220));
    return null;
  }
}

/* ══════════════════════════════════════════════════════════════════════════
   Oracle — restated published maths, imported from nothing
   ══════════════════════════════════════════════════════════════════════════ */

/** mulberry32, as published in src/server/arcade/arcade-rng.ts. */
function mulberry32(seed) {
  let s = seed | 0;
  return function next() {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seededShuffle(items, seed) {
  const arr = [...items];
  const rng = mulberry32(seed);
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    const a = arr[i];
    arr[i] = arr[j];
    arr[j] = a;
  }
  return arr;
}

/** sha256(`${seed}:${label}`) → first big-endian uint32. */
function deriveSubSeed(seed, label) {
  return crypto.createHash('sha256').update(`${seed}:${label}`).digest().readUInt32BE(0);
}

/** The shared unbiased fractional-ticket rounding. */
function roundArcadePayout(exactPayout, seed, label) {
  if (!Number.isFinite(exactPayout) || exactPayout <= 0) return 0;
  const integerPart = Math.floor(exactPayout);
  const fractionalPart = exactPayout - integerPart;
  if (fractionalPart <= 0) return integerPart;
  const rng = mulberry32(deriveSubSeed(seed, `arcade-payout:${label}`));
  return integerPart + (rng() < fractionalPart ? 1 : 0);
}

/* ── Lucky Cage ─────────────────────────────────────────────────────────── */

const CAGE_BALLS = 20;
const CAGE_DRAW = 5;
const CAGE_COMBINATIONS = 15_504;
const CAGE_HIGH_THRESHOLD = 11;
const CAGE_RACK_SIZE = 4;
const CAGE_RACK_COUNT = CAGE_BALLS / CAGE_RACK_SIZE;
const CAGE_RACK_THRESHOLD = 3;
const CAGE_RTP = 0.99;

function binomial(n, k) {
  if (k < 0 || k > n || n < 0) return 0;
  const kk = Math.min(k, n - k);
  let num = 1;
  let den = 1;
  for (let i = 0; i < kk; i += 1) {
    num *= n - i;
    den *= i + 1;
  }
  return num / den;
}

/** Exact probability of one ticket id, straight from the combinatorics. */
function cageTicketProbability(ticketId) {
  const [family, rawValue] = ticketId.split(':');
  const value = Number(rawValue);
  if (family === 'ball') return binomial(CAGE_BALLS - 1, CAGE_DRAW - 1) / CAGE_COMBINATIONS;
  if (family === 'head') {
    return binomial(CAGE_BALLS - 1, CAGE_DRAW - 1) / (CAGE_COMBINATIONS * CAGE_DRAW);
  }
  if (family === 'rack') {
    let num = 0;
    for (let k = CAGE_RACK_THRESHOLD; k <= CAGE_RACK_SIZE; k += 1) {
      num += binomial(CAGE_RACK_SIZE, k) * binomial(CAGE_BALLS - CAGE_RACK_SIZE, CAGE_DRAW - k);
    }
    return num / CAGE_COMBINATIONS;
  }
  if (family === 'tier') {
    const half = CAGE_BALLS / 2;
    return (binomial(half, value) * binomial(half, CAGE_DRAW - value)) / CAGE_COMBINATIONS;
  }
  throw new Error(`unknown ticket family in ${ticketId}`);
}

function cageTicketMultiplier(ticketId) {
  return (1 / cageTicketProbability(ticketId)) * CAGE_RTP;
}

function cageDraw(seed) {
  const all = Array.from({ length: CAGE_BALLS }, (_, i) => i + 1);
  return seededShuffle(all, seed).slice(0, CAGE_DRAW);
}

function cageRackOf(ball) {
  return Math.floor((ball - 1) / CAGE_RACK_SIZE);
}

function cageRackCounts(draw) {
  const counts = new Array(CAGE_RACK_COUNT).fill(0);
  for (const ball of draw) counts[cageRackOf(ball)] += 1;
  return counts;
}

function cageHighCount(draw) {
  return draw.filter((b) => b >= CAGE_HIGH_THRESHOLD).length;
}

function cageTicketWins(ticketId, draw) {
  const [family, rawValue] = ticketId.split(':');
  const value = Number(rawValue);
  if (family === 'ball') return draw.includes(value);
  if (family === 'head') return draw[0] === value;
  if (family === 'rack') return (cageRackCounts(draw)[value] ?? 0) >= CAGE_RACK_THRESHOLD;
  if (family === 'tier') return cageHighCount(draw) === value;
  return false;
}

/* ── Prize Claw — bed geometry, ported from the shared pure module ──────── */

const CLAW_BED_X = 1.15;
const CLAW_BED_Z0 = 0.35;
const CLAW_BED_Z1 = 2.45;
const CLAW_R_GRIP = 0.26;
const CLAW_R_OVERLAP = 0.34;
const CLAW_MIN_SEPARATION = 0.22;
const CLAW_BRUSH_BAND = 0.12;
const CLAW_GRID_COLS = 3;
const CLAW_GRID_ROWS = 3;
const CLAW_CELL_X = 0.66;
const CLAW_CELL_Z = 0.62;
const CLAW_JITTER = 0.28;
const CLAW_PLACE_X = CLAW_BED_X - CLAW_R_GRIP;
const CLAW_PLACE_Z0 = CLAW_BED_Z0 + CLAW_R_GRIP;
const CLAW_PLACE_Z1 = CLAW_BED_Z1 - CLAW_R_GRIP;
const CLAW_BED_MID_Z = (CLAW_BED_Z0 + CLAW_BED_Z1) / 2;
const PRIZE_CLAW_RTP = 0.97;

const CLAW_EXPOSURE_MULT = { clear: 1.0, leaning: 0.8, buried: 0.55 };
const CLAW_TIER_IDS = ['A', 'B', 'C', 'D', 'E'];
const CLAW_TIER_RANK = { A: 0, B: 1, C: 2, D: 3, E: 4 };

function makeTier(id, name, multiplier, holdChance) {
  return {
    id,
    name,
    multiplier,
    holdChance,
    grabChanceMax: PRIZE_CLAW_RTP / (holdChance * multiplier),
  };
}

const CLAW_TIERS = {
  A: makeTier('A', 'Felt Duck', 1.6, 0.92),
  B: makeTier('B', 'Tin Robot', 3.0, 0.84),
  C: makeTier('C', 'Brass Bear', 8.0, 0.72),
  D: makeTier('D', 'Porcelain Cat', 25, 0.58),
  E: makeTier('E', 'Gilt Trophy', 120, 0.42),
};

const CLAW_CABINETS = {
  plush: { id: 'plush', name: 'Plush Row', tiers: ['A', 'A', 'A', 'A', 'A', 'A', 'B', 'B', 'B'] },
  curio: { id: 'curio', name: 'Curio Case', tiers: ['A', 'A', 'A', 'B', 'B', 'B', 'C', 'C'] },
  top: { id: 'top', name: 'Top Shelf', tiers: ['B', 'B', 'C', 'C', 'D', 'D', 'E'] },
};

function clawCabinetTiers(cabinet) {
  const stocked = new Set(CLAW_CABINETS[cabinet].tiers);
  return CLAW_TIER_IDS.filter((id) => stocked.has(id));
}

function clamp(value, lo, hi) {
  return value < lo ? lo : value > hi ? hi : value;
}

function clawShuffle(items, seed) {
  return seededShuffle(items, seed);
}

function clawBedSubSeed(bedSeed, tag) {
  let h = (bedSeed ^ 0x9e3779b9) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
  h = (h + Math.imul(tag + 1, 0xc2b2ae35)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0x27d4eb2f) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

function slotDistance(a, b) {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

function clawExposureFor(neighbours) {
  if (neighbours <= 0) return 'clear';
  if (neighbours === 1) return 'leaning';
  return 'buried';
}

function classifyPrizes(prizes) {
  for (const prize of prizes) {
    let count = 0;
    for (const other of prizes) {
      if (other === prize) continue;
      if (slotDistance(prize, other) < CLAW_R_OVERLAP) count += 1;
    }
    prize.neighbours = count;
    prize.exposure = prize.forcedClear ? 'clear' : clawExposureFor(count);
  }
}

function clampSlot(prize) {
  prize.x = clamp(prize.x, -CLAW_PLACE_X, CLAW_PLACE_X);
  prize.z = clamp(prize.z, CLAW_PLACE_Z0, CLAW_PLACE_Z1);
}

function nudgeClear(prizes, target) {
  for (let stepIndex = 0; stepIndex < 12; stepIndex += 1) {
    let cx = 0;
    let cz = 0;
    let crowders = 0;
    for (const other of prizes) {
      if (other === target) continue;
      if (slotDistance(target, other) >= CLAW_R_OVERLAP) continue;
      cx += other.x;
      cz += other.z;
      crowders += 1;
    }
    if (crowders === 0) return;
    const dx = target.x - cx / crowders;
    const dz = target.z - cz / crowders;
    const len = Math.hypot(dx, dz);
    const angle = len > 1e-6 ? Math.atan2(dz, dx) : target.index * 2.39996;
    const beforeX = target.x;
    const beforeZ = target.z;
    target.x += Math.cos(angle) * 0.06;
    target.z += Math.sin(angle) * 0.06;
    clampSlot(target);
    if (target.x === beforeX && target.z === beforeZ) return;
  }
}

/** Faithful port of generatePrizeBed(bedSeed, cabinet). */
function generatePrizeBed(bedSeed, cabinet) {
  const spec = CLAW_CABINETS[cabinet];
  const count = spec.tiers.length;
  const cellCount = CLAW_GRID_COLS * CLAW_GRID_ROWS;

  const cells = clawShuffle(
    Array.from({ length: cellCount }, (_, i) => i),
    clawBedSubSeed(bedSeed, 1),
  )
    .slice(0, count)
    .sort((a, b) => a - b);

  const rng = mulberry32(clawBedSubSeed(bedSeed, 2));
  const prizes = cells.map((cell, index) => {
    const col = cell % CLAW_GRID_COLS;
    const row = Math.floor(cell / CLAW_GRID_COLS);
    const baseX = (col - (CLAW_GRID_COLS - 1) / 2) * CLAW_CELL_X;
    const baseZ = CLAW_BED_MID_Z + (row - (CLAW_GRID_ROWS - 1) / 2) * CLAW_CELL_Z;
    const slot = {
      index,
      tier: spec.tiers[0],
      x: baseX + (rng() * 2 - 1) * CLAW_JITTER,
      z: baseZ + (rng() * 2 - 1) * CLAW_JITTER,
      neighbours: 0,
      exposure: 'clear',
      yaw: (rng() * 2 - 1) * 0.55,
      variant: Math.floor(rng() * 4),
      forcedClear: false,
    };
    clampSlot(slot);
    return slot;
  });

  const pool = [...spec.tiers].sort((a, b) => CLAW_TIER_RANK[b] - CLAW_TIER_RANK[a]);
  let deepest = 0;
  for (let i = 1; i < prizes.length; i += 1) {
    if (prizes[i].z > prizes[deepest].z) deepest = i;
  }
  prizes[deepest].tier = pool[0];
  const rest = clawShuffle(pool.slice(1), clawBedSubSeed(bedSeed, 3));
  let cursor = 0;
  for (const prize of prizes) {
    if (prize.index === prizes[deepest].index) continue;
    prize.tier = rest[cursor];
    cursor += 1;
  }

  for (let pass = 0; pass < 6; pass += 1) {
    let moved = false;
    for (let i = 0; i < prizes.length; i += 1) {
      for (let j = i + 1; j < prizes.length; j += 1) {
        const a = prizes[i];
        const b = prizes[j];
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const d = Math.hypot(dx, dz);
        if (d >= CLAW_MIN_SEPARATION) continue;
        moved = true;
        const angle = d > 1e-6 ? Math.atan2(dz, dx) : (i * 7 + j) * 2.39996;
        const push = (CLAW_MIN_SEPARATION - d) / 2 + 0.005;
        a.x -= Math.cos(angle) * push;
        a.z -= Math.sin(angle) * push;
        b.x += Math.cos(angle) * push;
        b.z += Math.sin(angle) * push;
        clampSlot(a);
        clampSlot(b);
      }
    }
    if (!moved) break;
  }

  classifyPrizes(prizes);

  const stocked = clawCabinetTiers(cabinet);
  for (let attempt = 0; attempt < 4; attempt += 1) {
    let repaired = false;
    for (const tier of stocked) {
      const instances = prizes.filter((p) => p.tier === tier);
      if (instances.some((p) => p.exposure === 'clear')) continue;
      repaired = true;
      let best = instances[0];
      for (const candidate of instances) {
        if (candidate.neighbours < best.neighbours) best = candidate;
      }
      nudgeClear(prizes, best);
      classifyPrizes(prizes);
    }
    if (!repaired) break;
  }

  for (const tier of stocked) {
    const instances = prizes.filter((p) => p.tier === tier);
    if (instances.some((p) => p.exposure === 'clear')) continue;
    let best = instances[0];
    for (const candidate of instances) {
      if (candidate.neighbours < best.neighbours) best = candidate;
    }
    best.forcedClear = true;
    best.exposure = 'clear';
  }

  return { cabinet, bedSeed, prizes };
}

function clampToBed(x, z) {
  const rawX = typeof x === 'number' && Number.isFinite(x) ? x : 0;
  const rawZ = typeof z === 'number' && Number.isFinite(z) ? z : CLAW_BED_MID_Z;
  return {
    x: clamp(rawX, -CLAW_BED_X, CLAW_BED_X),
    z: clamp(rawZ, CLAW_BED_Z0, CLAW_BED_Z1),
  };
}

function clawTargetAt(bed, x, z) {
  let best = null;
  for (const prize of bed.prizes) {
    const d = Math.hypot(prize.x - x, prize.z - z);
    if (d > CLAW_R_GRIP) continue;
    if (best && d >= best.distance) continue;
    best = { prize, distance: d, aimError: Math.min(1, d / CLAW_R_GRIP) };
  }
  return best;
}

function clawGripCurve(aimError) {
  const e = clamp(aimError, 0, 1);
  return 1 - e * e;
}

function clawAimAt(bed, x, z) {
  const target = clawTargetAt(bed, x, z);
  if (!target) return { target: null, grip: 0, holdChance: 0, multiplier: 0 };
  const tier = CLAW_TIERS[target.prize.tier];
  const grip =
    tier.grabChanceMax * CLAW_EXPOSURE_MULT[target.prize.exposure] * clawGripCurve(target.aimError);
  return { target, grip, holdChance: tier.holdChance, multiplier: tier.multiplier };
}

/** The clear prize with the highest multiplier — the cross a player should pick. */
function bestClearPrize(bed) {
  let best = null;
  for (const prize of bed.prizes) {
    if (prize.exposure !== 'clear') continue;
    if (!best || CLAW_TIERS[prize.tier].multiplier > CLAW_TIERS[best.tier].multiplier) {
      best = prize;
    }
  }
  return best;
}

/**
 * A bed corner no legal prize centroid can reach: centroids are confined to
 * |x| <= 0.89, 0.61 <= z <= 2.19, so this point is at least 0.367 away from
 * any of them — beyond the 0.26 grip footprint. Guaranteed bare felt, with no
 * dependence on the bed roll.
 */
const BARE_FELT_POINT = { x: CLAW_BED_X, z: CLAW_BED_Z0 };

/* ══════════════════════════════════════════════════════════════════════════
   HTTP helpers
   ══════════════════════════════════════════════════════════════════════════ */

/** @type {import('playwright').APIRequestContext} */
let api;

async function postJson(route, body) {
  const response = await api.post(`${BASE}${route}`, {
    headers: { 'content-type': 'application/json' },
    data: typeof body === 'string' ? body : JSON.stringify(body),
  });
  let data = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }
  return { status: response.status(), data: data ?? {} };
}

async function getJson(route) {
  const response = await api.get(`${BASE}${route}`, { headers: { accept: 'application/json' } });
  let data = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }
  return { status: response.status(), data: data ?? {} };
}

async function balance() {
  const { status, data } = await getJson('/api/store/inventory');
  check(status === 200, `wallet read returned HTTP ${status}`);
  const credits = data?.wallet?.credits;
  check(Number.isInteger(credits), 'wallet.credits was not an integer');
  return credits;
}

async function history(limit = 30) {
  const { status, data } = await getJson('/api/wagers/history');
  check(status === 200, `history returned HTTP ${status}`);
  return (data.history ?? []).slice(0, limit);
}

/** Newest history row for a game type carrying this seed. */
async function historyRowForSeed(gameType, seed) {
  const rows = await history();
  return rows.find((row) => row.gameType === gameType && Number(row.seed) === Number(seed)) ?? null;
}

/** Deep scan for a leaked private seed in a pre-settle payload. */
function containsSeedKey(value, keyPath = '') {
  if (value === null || typeof value !== 'object') return null;
  for (const [key, child] of Object.entries(value)) {
    const here = keyPath ? `${keyPath}.${key}` : key;
    if (/^seed$/i.test(key)) return here;
    const nested = containsSeedKey(child, here);
    if (nested) return nested;
  }
  return null;
}

function createSession(gameType, wager, config) {
  return postJson('/api/wagers/session', { gameType, wager, config });
}

function settle(token, action = 'cashout') {
  return postJson('/api/wagers/settle', { token, action });
}

function actOn(token, action, data) {
  return postJson('/api/wagers/action', { token, action, data });
}

/* ══════════════════════════════════════════════════════════════════════════
   Funding — existing admin mechanism only, loopback only
   ══════════════════════════════════════════════════════════════════════════ */

function isSafeFundingTarget() {
  try {
    const url = new URL(BASE);
    const loopback =
      url.hostname === '127.0.0.1' ||
      url.hostname === 'localhost' ||
      url.hostname === '::1' ||
      url.hostname === '[::1]';
    const forgejoService =
      process.env.QA_ALLOW_ADMIN_FUNDING === 'true' &&
      url.protocol === 'http:' &&
      url.hostname === 'app';
    return loopback || forgejoService;
  } catch {
    return false;
  }
}

/**
 * Top the QA wallet up to `target` using mechanisms that already exist in the
 * app: the admin ticket adjustment (the CI QA account is the first account on a
 * fresh database, so it holds the bootstrap admin role) and, failing that, the
 * ordinary daily claim. Never touches the database directly, never adds a
 * route, and refuses to run outside loopback or the explicitly enabled,
 * isolated Forgejo `app` service.
 */
async function ensureFunds(target) {
  let credits = await balance();
  if (credits >= target) return { credits, via: 'existing balance' };

  if (isSafeFundingTarget()) {
    const grant = await postJson('/api/admin/db/rewards', {
      action: 'bulk-adjust-currency',
      currencyType: 'credits',
      amount: target - credits,
      reason: 'CI QA harness: fund Lucky Cage / Prize Claw coverage',
    });
    if (grant.status === 200) {
      credits = await balance();
      if (credits >= target) return { credits, via: 'admin ticket adjustment' };
    }
  }

  const claim = await postJson('/api/games/daily-claim', {});
  if (claim.status === 200) {
    credits = await balance();
    if (credits >= target) return { credits, via: 'daily claim' };
  }

  return { credits, via: 'unfunded — running at minimum stake' };
}

/* ══════════════════════════════════════════════════════════════════════════
   Lucky Cage — API suite
   ══════════════════════════════════════════════════════════════════════════ */

/** One representative ticket per family. */
const CAGE_TICKETS = [
  { id: 'ball:7', family: 'ball' },
  { id: 'head:20', family: 'head' },
  { id: 'rack:2', family: 'rack' },
  { id: 'tier:3', family: 'tier' },
];

/** Assert everything a settle response must say about the round. */
function assertCageSettlement(ticketId, wager, settled) {
  const seed = settled.seed;
  check(Number.isInteger(seed) && seed >= 0, 'settle did not reveal an integer seed');

  const draw = settled.draw;
  check(Array.isArray(draw) && draw.length === CAGE_DRAW, 'draw was not five balls');
  check(
    draw.every((n) => Number.isInteger(n) && n >= 1 && n <= CAGE_BALLS),
    'draw contained a ball outside 1..20',
  );
  check(new Set(draw).size === CAGE_DRAW, 'draw repeated a ball — not a legal 5-of-20');

  const expected = cageDraw(seed);
  check(
    expected.every((n, i) => n === draw[i]),
    'draw does not match the seeded shuffle recomputed from the revealed seed',
  );

  check(settled.head === draw[0], 'head ball is not the first out of the chute');
  check(settled.highCount === cageHighCount(draw), 'highCount disagrees with the draw');
  const racks = cageRackCounts(draw);
  check(
    Array.isArray(settled.rackCounts) && settled.rackCounts.every((c, i) => c === racks[i]),
    'rackCounts disagree with the draw',
  );

  const won = cageTicketWins(ticketId, draw);
  check(settled.won === won, `won flag disagrees with the ticket rule for ${ticketId}`);

  // The ticket's multiplier is (1 / exact probability) × 0.99 when it comes in,
  // and exactly 0 when it does not.
  const multiplier = cageTicketMultiplier(ticketId);
  const reported = won ? multiplier : 0;
  check(
    near(settled.multiplier, reported, 1e-9),
    `multiplier ${settled.multiplier} != exact ${reported}`,
  );

  const payout = won ? roundArcadePayout(wager * multiplier, seed, `lucky-cage:${ticketId}`) : 0;
  check(settled.payout === payout, `payout ${settled.payout} != oracle ${payout}`);

  return { seed, draw, won, payout, multiplier };
}

async function luckyCageApiSuite() {
  const area = 'cage/api';
  /** @type {{token: string, seed: number, payout: number, wager: number} | null} */
  let replaySubject = null;

  for (const ticket of CAGE_TICKETS) {
    await step(area, `session+settle ${ticket.id}`, async () => {
      const before = await balance();

      const created = await createSession('arcade-lucky-cage', STAKE, { ticket: ticket.id });
      check(created.status === 200, `session create returned HTTP ${created.status}`);
      check(created.data.config?.ticket === ticket.id, 'session echoed a different ticket');
      const leaked = containsSeedKey(created.data);
      check(!leaked, `private seed leaked before settle at ${leaked}`);

      const held = await balance();
      check(held === before - STAKE, `hold debited ${before - held}, expected ${STAKE}`);

      const settled = await settle(created.data.token);
      check(settled.status === 200, `settle returned HTTP ${settled.status}`);
      const round = assertCageSettlement(ticket.id, STAKE, settled.data);

      const after = await balance();
      check(after === held + round.payout, `wallet delta ${after - held} != payout ${round.payout}`);

      const row = await historyRowForSeed('arcade-lucky-cage', round.seed);
      check(row, 'settled round is missing from /api/wagers/history');
      check(row.wagerAmount === STAKE, 'history wager disagrees with the stake');
      check(row.payoutAmount === round.payout, 'history payout disagrees with the settlement');

      if (!replaySubject) {
        replaySubject = {
          token: created.data.token,
          seed: round.seed,
          payout: round.payout,
          wager: STAKE,
        };
      }

      return {
        http: settled.status,
        state: `${ticket.family} draw=${round.draw.join('/')} won=${round.won}`,
        delta: after - before,
      };
    });
  }

  await step(area, 'same-token settle replay pays once', async () => {
    check(replaySubject, 'no settled session available to replay');
    const before = await balance();
    const replay = await settle(replaySubject.token);
    check(replay.status === 200, `replay returned HTTP ${replay.status}`);
    check(replay.data.replayed === true, 'replay response was not marked replayed');
    check(replay.data.seed === replaySubject.seed, 'replay revealed a different seed');
    check(replay.data.payout === replaySubject.payout, 'replay reported a different payout');
    const after = await balance();
    check(after === before, `replay moved the wallet by ${after - before}`);
    return { http: replay.status, state: 'replayed=true deterministic', delta: 0 };
  });

  await step(area, 'invalid ticket rejected', async () => {
    const before = await balance();
    const created = await createSession('arcade-lucky-cage', STAKE, { ticket: 'ball:99' });
    check(created.status === 400, `expected HTTP 400, got ${created.status}`);
    const after = await balance();
    check(after === before, `rejected ticket moved the wallet by ${after - before}`);
    return { http: created.status, state: 'no session, no hold', delta: 0 };
  });

  await step(area, 'insufficient balance rejected', async () => {
    const before = await balance();
    const created = await createSession('arcade-lucky-cage', ABSURD_WAGER, { ticket: 'ball:7' });
    check(created.status === 402, `expected HTTP 402, got ${created.status}`);
    const after = await balance();
    check(after === before, `rejected wager moved the wallet by ${after - before}`);
    return { http: created.status, state: 'no hold taken', delta: 0 };
  });
}

/* ══════════════════════════════════════════════════════════════════════════
   Prize Claw — API suite
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Cross-check one drop response against the ported bed and the revealed seed.
 * This is where "the public bedSeed reproduces the populated bed" is proved:
 * the harness regenerates the bed from bedSeed alone and must agree with the
 * server on which prize the fingers closed over and how likely the grip was.
 */
function assertClawDrop(cabinet, wager, aimPoint, drop) {
  check(drop.cabinet === cabinet, 'drop echoed a different cabinet');
  check(Number.isFinite(drop.bedSeed), 'bedSeed was not a finite number');
  check(Number.isInteger(drop.seed) && drop.seed >= 0, 'drop did not reveal an integer seed');
  check(drop.bedSeed !== drop.seed, 'public bedSeed equals the private session seed');

  const expectedPoint = clampToBed(aimPoint.x, aimPoint.z);
  check(
    near(drop.point.x, expectedPoint.x, 1e-12) && near(drop.point.z, expectedPoint.z, 1e-12),
    `server clamped to (${drop.point.x}, ${drop.point.z}), expected (${expectedPoint.x}, ${expectedPoint.z})`,
  );

  const bed = generatePrizeBed(drop.bedSeed, cabinet);
  check(
    bed.prizes.length === CLAW_CABINETS[cabinet].tiers.length,
    'regenerated bed has the wrong prize count',
  );
  const aim = clawAimAt(bed, expectedPoint.x, expectedPoint.z);

  if (!aim.target) {
    check(drop.target === null, 'server found a prize where the ported bed has bare felt');
    check(drop.outcome === 'empty', `bare felt resolved as ${drop.outcome}`);
    check(drop.grip === 0 && drop.multiplier === 0, 'bare felt reported a non-zero grip or payout');
  } else {
    check(drop.target, 'server reported bare felt where the ported bed has a prize');
    check(drop.target.index === aim.target.prize.index, 'target prize index disagrees with the bed');
    check(drop.target.tier === aim.target.prize.tier, 'target tier disagrees with the bed');
    check(
      drop.target.exposure === aim.target.prize.exposure,
      'target exposure disagrees with the bed',
    );
    check(
      near(drop.target.x, aim.target.prize.x, 1e-9) && near(drop.target.z, aim.target.prize.z, 1e-9),
      'target grip cross disagrees with the bed',
    );
    check(near(drop.aimError, aim.target.aimError, 1e-9), 'aimError disagrees with the bed');
    check(near(drop.grip, aim.grip, 1e-9), `grip ${drop.grip} != oracle ${aim.grip}`);
    check(near(drop.holdChance, aim.holdChance, 1e-12), 'holdChance disagrees with the tier table');
  }

  const grabRoll = mulberry32(deriveSubSeed(drop.seed, 'prize-claw:grab'))();
  const holdRoll = mulberry32(deriveSubSeed(drop.seed, 'prize-claw:hold'))();
  check(near(drop.grabRoll, grabRoll, 1e-12), 'grabRoll is not the seeded grab sub-stream');
  check(near(drop.holdRoll, holdRoll, 1e-12), 'holdRoll is not the seeded hold sub-stream');

  const grabbed = aim.target ? grabRoll < aim.grip : false;
  const held = grabbed && holdRoll < aim.holdChance;
  check(drop.grabbed === grabbed, 'grabbed flag is not grabRoll < grip');
  check(drop.held === held, 'held flag is not holdRoll < holdChance');

  let outcome;
  if (!aim.target) outcome = 'empty';
  else if (grabbed) outcome = held ? 'won' : 'slipped';
  else if (grabRoll < aim.grip + CLAW_BRUSH_BAND) outcome = 'brushed';
  else outcome = 'missed';
  check(drop.outcome === outcome, `outcome ${drop.outcome} != derived ${outcome}`);

  const multiplier = outcome === 'won' ? aim.multiplier : 0;
  check(near(drop.multiplier, multiplier, 1e-12), 'multiplier disagrees with the outcome');

  const payout =
    outcome === 'won'
      ? roundArcadePayout(wager * multiplier, drop.seed, `prize-claw:${drop.target?.tier ?? 'x'}`)
      : 0;
  check(drop.payout === payout, `payout ${drop.payout} != oracle ${payout}`);

  check(drop.script && Number.isFinite(drop.script.totalMs), 'drop did not carry an animation script');

  return { payout, outcome, bed, aim };
}

/** Open a session and return { token, bedSeed, bed }. Debits the stake. */
async function openClawSession(cabinet, wager = STAKE) {
  const created = await createSession('arcade-prize-claw', wager, { cabinet });
  check(created.status === 200, `session create returned HTTP ${created.status}`);
  const config = created.data.config ?? {};
  check(config.cabinet === cabinet, 'session echoed a different cabinet');
  check(Number.isInteger(config.bedSeed), 'session did not mint an integer bedSeed');
  const leaked = containsSeedKey(created.data);
  check(!leaked, `private seed leaked before settle at ${leaked}`);
  return {
    token: created.data.token,
    bedSeed: config.bedSeed,
    bed: generatePrizeBed(config.bedSeed, cabinet),
  };
}

async function prizeClawApiSuite() {
  const area = 'claw/api';
  /** @type {{token: string, point: {x: number, z: number}, payout: number, outcome: string} | null} */
  let replaySubject = null;

  for (const cabinet of ['plush', 'curio', 'top']) {
    await step(area, `${CLAW_CABINETS[cabinet].name} clear-cross drop`, async () => {
      const before = await balance();
      const session = await openClawSession(cabinet);

      const held = await balance();
      check(held === before - STAKE, `hold debited ${before - held}, expected ${STAKE}`);

      const prize = bestClearPrize(session.bed);
      check(prize, 'regenerated bed exposed no clear prize — reroll-proof invariant broken');
      const aimPoint = { x: prize.x, z: prize.z };

      const drop = await actOn(session.token, 'drop', aimPoint);
      check(drop.status === 200, `drop returned HTTP ${drop.status}`);
      const round = assertClawDrop(cabinet, STAKE, aimPoint, drop.data);

      check(drop.data.target?.exposure === 'clear', 'the targeted prize was not clear');
      check(near(drop.data.aimError, 0, 1e-9), 'a dead-centre commit did not report zero aim error');
      const tier = CLAW_TIERS[drop.data.target.tier];
      check(
        near(drop.data.grip, tier.grabChanceMax, 1e-9),
        'a clear prize cross did not pay the tier maximum grip chance',
      );

      const after = await balance();
      check(
        after === held + round.payout,
        `wallet delta ${after - held} != payout ${round.payout}`,
      );

      const row = await historyRowForSeed('arcade-prize-claw', drop.data.seed);
      check(row, 'settled drop is missing from /api/wagers/history');
      check(row.wagerAmount === STAKE, 'history wager disagrees with the stake');
      check(row.payoutAmount === round.payout, 'history payout disagrees with the settlement');

      if (!replaySubject) {
        replaySubject = {
          token: session.token,
          point: drop.data.point,
          payout: round.payout,
          outcome: round.outcome,
        };
      }

      return {
        http: drop.status,
        state: `${drop.data.target.tierName} clear grip=${(drop.data.grip * 100).toFixed(1)}% → ${round.outcome}`,
        delta: after - before,
      };
    });
  }

  await step(area, 'bare-felt aim closes on nothing', async () => {
    const before = await balance();
    const session = await openClawSession('curio');
    const drop = await actOn(session.token, 'drop', BARE_FELT_POINT);
    check(drop.status === 200, `drop returned HTTP ${drop.status}`);
    const round = assertClawDrop('curio', STAKE, BARE_FELT_POINT, drop.data);
    check(round.outcome === 'empty', `bare felt resolved as ${round.outcome}`);
    const after = await balance();
    check(after === before - STAKE, `bare felt moved the wallet by ${after - before}`);
    return { http: drop.status, state: 'outcome=empty payout=0', delta: after - before };
  });

  await step(area, 'back out before the drop refunds in full', async () => {
    const before = await balance();
    const session = await openClawSession('plush');
    const held = await balance();
    check(held === before - STAKE, 'hold was not taken');
    const refund = await settle(session.token);
    check(refund.status === 200, `settle returned HTTP ${refund.status}`);
    check(refund.data.refunded === true, 'settle did not refund an un-dropped session');
    const after = await balance();
    check(after === before, `refund left the wallet ${after - before} off`);
    return { http: refund.status, state: 'refunded=true', delta: 0 };
  });

  await step(area, 'replay with a second coordinate keeps the first', async () => {
    check(replaySubject, 'no settled drop available to replay');
    const before = await balance();
    const hostileSecond = { x: -replaySubject.point.x, z: CLAW_BED_Z1 };
    const replay = await actOn(replaySubject.token, 'drop', hostileSecond);
    check(replay.status === 200, `replay returned HTTP ${replay.status}`);
    check(replay.data.replayed === true, 'replay response was not marked replayed');
    check(
      near(replay.data.point.x, replaySubject.point.x, 1e-12) &&
        near(replay.data.point.z, replaySubject.point.z, 1e-12),
      'a second coordinate overwrote the committed point',
    );
    check(replay.data.payout === replaySubject.payout, 'replay reported a different payout');
    check(replay.data.outcome === replaySubject.outcome, 'replay reported a different outcome');
    const after = await balance();
    check(after === before, `replay moved the wallet by ${after - before}`);
    return { http: replay.status, state: 'first point preserved, no second payment', delta: 0 };
  });

  await step(area, 'concurrent same-token drops settle once', async () => {
    const before = await balance();
    const session = await openClawSession('curio');
    const prize = bestClearPrize(session.bed);
    check(prize, 'regenerated bed exposed no clear prize');
    const pointA = { x: prize.x, z: prize.z };
    const pointB = BARE_FELT_POINT;

    const [first, second] = await Promise.all([
      actOn(session.token, 'drop', pointA),
      actOn(session.token, 'drop', pointB),
    ]);
    check(first.status === 200, `first concurrent drop returned HTTP ${first.status}`);
    check(second.status === 200, `second concurrent drop returned HTTP ${second.status}`);
    check(
      near(first.data.point.x, second.data.point.x, 1e-12) &&
        near(first.data.point.z, second.data.point.z, 1e-12),
      'concurrent drops resolved against different commit points',
    );
    check(first.data.payout === second.data.payout, 'concurrent drops reported different payouts');
    check(first.data.outcome === second.data.outcome, 'concurrent drops reported different outcomes');

    const winner = first.data.point;
    const matchesA = near(winner.x, pointA.x, 1e-12) && near(winner.z, pointA.z, 1e-12);
    const matchesB = near(winner.x, pointB.x, 1e-12) && near(winner.z, pointB.z, 1e-12);
    check(matchesA || matchesB, 'the settled point is neither request coordinate');

    assertClawDrop('curio', STAKE, winner, first.data);

    const after = await balance();
    check(
      after === before - STAKE + first.data.payout,
      `concurrent drops moved the wallet by ${after - before}, expected ${first.data.payout - STAKE}`,
    );
    return {
      http: `${first.status}/${second.status}`,
      state: `one commit point, one settlement (${first.data.outcome})`,
      delta: after - before,
    };
  });

  await step(area, 'hostile and out-of-bounds coordinates', async () => {
    const before = await balance();
    const session = await openClawSession('top');

    // Sent as a RAW body: JSON.stringify would turn Infinity into null, so the
    // literal `1e999` is written by hand. JSON.parse revives it as Infinity,
    // which the route must refuse — leaving the session open and unsettled.
    const nonFinite = await postJson(
      '/api/wagers/action',
      `{"token":${JSON.stringify(session.token)},"action":"drop","data":{"x":1e999,"z":1.4}}`,
    );
    check(nonFinite.status === 400, `non-finite x expected HTTP 400, got ${nonFinite.status}`);

    const wrongType = await actOn(session.token, 'drop', { x: '0.5', z: null });
    check(wrongType.status === 400, `non-numeric coords expected HTTP 400, got ${wrongType.status}`);

    const rejected = await balance();
    check(rejected === before - STAKE, 'a rejected drop moved the wallet beyond the hold');

    // Wildly out of bounds is clamped, never rejected, and lands on the corner
    // of the felt that no prize centroid can occupy.
    const drop = await actOn(session.token, 'drop', { x: 999, z: -999 });
    check(drop.status === 200, `clamped drop returned HTTP ${drop.status}`);
    check(
      near(drop.data.point.x, CLAW_BED_X, 1e-12) && near(drop.data.point.z, CLAW_BED_Z0, 1e-12),
      `clamp landed at (${drop.data.point.x}, ${drop.data.point.z})`,
    );
    const round = assertClawDrop('top', STAKE, { x: 999, z: -999 }, drop.data);
    check(round.outcome === 'empty', `clamped corner resolved as ${round.outcome}`);

    const after = await balance();
    check(after === before - STAKE, `hostile-coordinate round moved the wallet by ${after - before}`);
    return {
      http: '400/400/200',
      state: 'non-finite rejected, out-of-bounds clamped to the felt corner',
      delta: after - before,
    };
  });

  await step(area, 'invalid cabinet rejected', async () => {
    const before = await balance();
    const created = await createSession('arcade-prize-claw', STAKE, { cabinet: 'bouncy-castle' });
    check(created.status === 400, `expected HTTP 400, got ${created.status}`);
    const after = await balance();
    check(after === before, `rejected cabinet moved the wallet by ${after - before}`);
    return { http: created.status, state: 'no session, no hold', delta: 0 };
  });

  await step(area, 'insufficient balance rejected', async () => {
    const before = await balance();
    const created = await createSession('arcade-prize-claw', ABSURD_WAGER, { cabinet: 'plush' });
    check(created.status === 402, `expected HTTP 402, got ${created.status}`);
    const after = await balance();
    check(after === before, `rejected wager moved the wallet by ${after - before}`);
    return { http: created.status, state: 'no hold taken', delta: 0 };
  });
}

/* ══════════════════════════════════════════════════════════════════════════
   Browser helpers
   ══════════════════════════════════════════════════════════════════════════ */

/** Fail loudly rather than screenshot a page that is showing a credential. */
async function screenshot(page, name, focusSelector) {
  if (focusSelector) {
    await page.locator(focusSelector).first().scrollIntoViewIfNeeded().catch(() => {});
    await page.waitForTimeout(250);
  }
  const text = await page.evaluate(() => document.body.innerText ?? '');
  for (const secret of SECRETS) {
    if (secret && text.includes(secret)) {
      throw new Error(`refused to save ${name}: page text contains a QA credential`);
    }
  }
  const file = path.join(EVIDENCE_DIR, `${name}.png`);
  await page.screenshot({ path: file });
  return `qa-evidence/${name}.png`;
}

/** Layout gate shared by both cabinets at both viewports. */
async function assertLayout(page, viewport) {
  const report = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
    dialogs: document.querySelectorAll('[role="dialog"]').length,
    guestNudge: document.querySelectorAll('#guest-auth-nudge-title').length,
    canvases: document.querySelectorAll('canvas').length,
  }));
  check(
    report.scrollWidth <= report.innerWidth + 1,
    `horizontal overflow: scrollWidth ${report.scrollWidth} > viewport ${report.innerWidth}`,
  );
  check(report.dialogs === 0, `${report.dialogs} modal dialog(s) covering the cabinet`);
  check(report.guestNudge === 0, 'guest sign-up nudge shown to a signed-in account');
  check(report.innerWidth === viewport.width, `viewport width is ${report.innerWidth}`);
  return report;
}

async function assertNoWebglFallback(page, overlaySelector) {
  const fallbacks = await page.locator(overlaySelector).count();
  check(fallbacks === 0, 'the WebGL fallback read-out replaced the 3D cabinet');
  const canvases = await page.locator('canvas').count();
  check(canvases >= 1, 'no canvas rendered');
}

/** Background `page` by activating a scratch tab; returns the observed state. */
async function withHiddenTab(context, page, fn) {
  const decoy = await context.newPage();
  await decoy.goto('about:blank');
  await decoy.bringToFront();
  const hiddenSeen = await page.evaluate(() => document.visibilityState);
  try {
    return { hiddenSeen, result: await fn() };
  } finally {
    await page.bringToFront();
    await decoy.close();
  }
}

/* ══════════════════════════════════════════════════════════════════════════
   Lucky Cage — browser suite
   ══════════════════════════════════════════════════════════════════════════ */

const CAGE_CRANK = 'button:has-text("Turn the crank")';
const CAGE_CHUTE_BALLS = '.lc-chute .lc-ball:not(.lc-ball-empty)';

async function openCagePage(context, viewport) {
  const page = await context.newPage();
  await page.setViewportSize(viewport);
  await page.goto(`${BASE}/lucky-cage`, { waitUntil: 'load', timeout: 45_000 });
  await page.waitForSelector('.lc-chute', { timeout: 30_000 });
  // Let hydration, the wallet fetch and the guest-nudge delay (2.5 s) all pass.
  await page.waitForTimeout(3_500);
  return page;
}

/** Pick the lowest offered stake so browser rounds stay cheap. */
async function selectLowestBet(page) {
  const pills = page.locator('.arc-bet-pill');
  await pills.first().waitFor({ timeout: 15_000 });
  await pills.first().click();
  return (await pills.first().innerText()).trim();
}

/** Wait for a draw to finish: five cradles filled and the crank re-armed. */
async function waitForCageResult(page, timeout = CAGE_ROUND_MS) {
  await page.waitForFunction(
    () => {
      const seated = document.querySelectorAll('.lc-chute .lc-ball:not(.lc-ball-empty)').length;
      const drawing = Array.from(document.querySelectorAll('button')).some((b) =>
        (b.textContent ?? '').includes('Drawing'),
      );
      return seated === 5 && !drawing;
    },
    undefined,
    { timeout },
  );
  const balls = await page.locator(CAGE_CHUTE_BALLS).allInnerTexts();
  const drawn = balls.map((b) => Number(b.trim()));
  check(drawn.length === 5, `expected five seated balls, saw ${drawn.length}`);
  check(new Set(drawn).size === 5, 'the cradles show a repeated ball');
  check(
    drawn.every((n) => Number.isInteger(n) && n >= 1 && n <= CAGE_BALLS),
    'a cradle shows a ball outside 1..20',
  );
  return drawn;
}

async function luckyCageBrowserSuite(browser) {
  const area = 'cage/ui';
  const context = await browser.newContext({ viewport: DESKTOP, storageState: authState });

  await step(area, 'desktop 1440x900 · clickable crank', async () => {
    const page = await openCagePage(context, DESKTOP);
    try {
      const layout = await assertLayout(page, DESKTOP);
      await assertNoWebglFallback(page, '.lc-overlay');
      check(
        (await page.locator('.lc-chute .lc-cradle').count()) === 5,
        'the chute does not present five result slots',
      );

      const stake = await selectLowestBet(page);
      const before = await balance();
      await page.locator(CAGE_CRANK).click();
      const drawn = await waitForCageResult(page);
      const after = await balance();

      await page.waitForSelector('text=Recomputed from the revealed seed', { timeout: 10_000 });
      const verdict = await page.locator('text=Matches the draw the cabinet played').count();
      check(verdict === 1, 'the client-side draw check did not confirm the revealed seed');

      const evidence = await screenshot(page, 'lucky-cage-desktop-1440x900', '.lc-chute');
      return {
        state: `5 slots, draw=${drawn.join('/')}, stake=${stake}, canvases=${layout.canvases}`,
        delta: after - before,
        note: evidence,
      };
    } finally {
      await page.close();
    }
  });

  if (FULL_TIMELINE) {
    await step(area, 'keyboard crank (Space) and reset', async () => {
    const page = await openCagePage(context, DESKTOP);
    try {
      await selectLowestBet(page);
      const before = await balance();
      const topBefore = (await history())[0]?.id ?? null;
      // Nothing may hold focus: real buttons and the stage answer Space
      // themselves, and the window shortcut deliberately steps aside for them.
      await page.evaluate(() => document.activeElement?.blur?.());
      await page.keyboard.press('Space');
      const drawn = await waitForCageResult(page);
      const after = await balance();
      const topAfter = (await history())[0] ?? null;
      check(topAfter && topAfter.id !== topBefore, 'the keyboard crank banked no new round');
      check(
        topAfter.gameType === 'arcade-lucky-cage',
        `the newest banked round is ${topAfter.gameType}`,
      );
      // Reset: the crank is offered again and the cabinet is idle.
      const label = (await page.locator(CAGE_CRANK).innerText()).trim();
      check(label === 'Turn the crank', `crank reads "${label}" after the round`);
      check(
        (await page.locator(CAGE_CHUTE_BALLS).count()) === 5,
        'the result slots were cleared before the player could read them',
      );
      return { state: `space crank draw=${drawn.join('/')}, crank re-armed`, delta: after - before };
    } finally {
      await page.close();
    }
    });

    await step(area, 'hidden tab still completes on wall clock', async () => {
    const page = await openCagePage(context, DESKTOP);
    try {
      await selectLowestBet(page);
      const before = await balance();
      await page.locator(CAGE_CRANK).click();
      const { hiddenSeen } = await withHiddenTab(context, page, async () => {
        await page.waitForTimeout(CAGE_ROUND_MS * 0.75);
      });
      const drawn = await waitForCageResult(page);
      const after = await balance();
      return {
        status: hiddenSeen === 'hidden' ? 'PASS' : 'SKIP',
        state: `visibilityState=${hiddenSeen}, draw=${drawn.join('/')}`,
        delta: after - before,
        note:
          hiddenSeen === 'hidden'
            ? 'round resolved with no animation frames'
            : 'headless Chromium never reported hidden; wall-clock completion still asserted',
      };
    } finally {
      await page.close();
    }
    });
  }

  await context.close();

  const reducedContext = await browser.newContext({
    viewport: DESKTOP,
    reducedMotion: 'reduce',
    storageState: authState,
  });
  await step(area, 'reduced motion completes the draw', async () => {
    const page = await openCagePage(reducedContext, DESKTOP);
    try {
      await page.waitForSelector('text=Reduced motion is on', { timeout: 15_000 });
      await selectLowestBet(page);
      const before = await balance();
      await page.locator(CAGE_CRANK).click();
      const drawn = await waitForCageResult(page, CAGE_ROUND_MS);
      const after = await balance();
      return { state: `compressed draw=${drawn.join('/')}`, delta: after - before };
    } finally {
      await page.close();
    }
  });
  await reducedContext.close();

  const mobileContext = await browser.newContext({
    viewport: MOBILE,
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    storageState: authState,
  });
  await step(area, 'mobile 390x844 · five result slots', async () => {
    const page = await openCagePage(mobileContext, MOBILE);
    try {
      const layout = await assertLayout(page, MOBILE);
      check(layout.innerWidth === 390, `mobile viewport is ${layout.innerWidth}px wide`);
      await assertNoWebglFallback(page, '.lc-overlay');
      await selectLowestBet(page);
      const before = await balance();
      await page.locator(CAGE_CRANK).click();
      const drawn = await waitForCageResult(page);
      const after = await balance();
      const evidence = await screenshot(page, 'lucky-cage-mobile-390x844', '.lc-chute');
      return {
        state: `390x844 no overflow, draw=${drawn.join('/')}`,
        delta: after - before,
        note: evidence,
      };
    } finally {
      await page.close();
    }
  });
  await mobileContext.close();
}

/* ══════════════════════════════════════════════════════════════════════════
   Prize Claw — browser suite
   ══════════════════════════════════════════════════════════════════════════ */

const CLAW_BUY = 'button:has-text("Buy a drop")';
const CLAW_DROP = 'button:has-text("Drop")';
const CLAW_BACK_OUT = 'button:has-text("Back out")';

async function openClawPage(context, viewport) {
  const page = await context.newPage();
  await page.setViewportSize(viewport);
  await page.goto(`${BASE}/prize-claw`, { waitUntil: 'load', timeout: 45_000 });
  await page.waitForSelector('.pc-readout', { timeout: 30_000 });
  await page.waitForTimeout(3_500);
  return page;
}

/** Buy a drop and wait for the armed phase (bed loaded, clock running). */
async function armClaw(page) {
  await page.locator(CLAW_BUY).click();
  await page.waitForSelector('.pc-clock', { timeout: 30_000 });
  await page.waitForSelector(CLAW_BACK_OUT, { timeout: 30_000 });
}

/** The claw's live world coordinates, straight from the stage footer. */
async function readAim(page) {
  const text = await page.locator('text=/Claw x/').first().innerText();
  const match = text.match(/x\s*(-?[\d.]+)\s*·\s*z\s*(-?[\d.]+)/);
  check(match, `could not parse the claw read-out from "${text}"`);
  return { x: Number(match[1]), z: Number(match[2]) };
}

/**
 * Press Drop. If the 12-second positioning clock happened to auto-commit first
 * the button is already gone — that is still a committed drop, so swallow the
 * click failure and let waitForClawResult do the asserting.
 */
async function commitDropInBrowser(page) {
  try {
    await page.locator(CLAW_DROP).first().click({ timeout: 5_000 });
  } catch {
    /* auto-committed */
  }
}

async function waitForClawResult(page, timeout = CLAW_DROP_MS) {
  await page.waitForSelector('text=Verify this drop', { timeout });
  const verify = await page.locator('.pc-verify').innerText();
  // `innerText()` reflects the Midway theme's text-transform: uppercase.
  check(/Bed seed \(public\)/i.test(verify), 'the verify panel did not publish the bed seed');
  check(/Session seed/i.test(verify), 'the verify panel did not reveal the session seed');
  return verify;
}

async function prizeClawBrowserSuite(browser) {
  const area = 'claw/ui';
  const context = await browser.newContext({ viewport: DESKTOP, storageState: authState });

  await step(area, 'desktop 1440x900 · aim, countdown, drop', async () => {
    const page = await openClawPage(context, DESKTOP);
    try {
      const layout = await assertLayout(page, DESKTOP);
      await assertNoWebglFallback(page, '.pc-overlay');

      await selectLowestBet(page);
      const before = await balance();
      await armClaw(page);

      // The cabinet parks on the best clear prize; confirm the readout agrees.
      const parked = await readAim(page);
      const readout = await page.locator('.pc-readout').innerText();
      check(/Grip\s+\d/.test(readout), `armed readout shows no grip chance: ${readout}`);
      check(/Clear|Leaning|Buried/i.test(readout), 'armed readout shows no exposure class');
      const clock = (await page.locator('.pc-clock').innerText()).trim();
      check(/^\d+\.\d+s$/.test(clock), `countdown reads "${clock}"`);

      const evidence = await screenshot(page, 'prize-claw-desktop-1440x900-armed', '.pc-viewport');

      await commitDropInBrowser(page);
      await waitForClawResult(page);
      const after = await balance();

      const bedCheck = await page.locator('text=Matches the grip chance the cabinet rolled against').count();
      check(bedCheck === 1, 'the bed rebuilt from the public bedSeed did not match the round');

      return {
        state: `parked (${parked.x.toFixed(2)}, ${parked.z.toFixed(2)}), clock=${clock}, canvases=${layout.canvases}`,
        delta: after - before,
        note: evidence,
      };
    } finally {
      await page.close();
    }
  });

  if (FULL_TIMELINE) {
    await step(area, 'keyboard aim, fine movement, Space drop', async () => {
    const page = await openClawPage(context, DESKTOP);
    try {
      await selectLowestBet(page);
      const before = await balance();
      await armClaw(page);

      const start = await readAim(page);
      await page.keyboard.press('ArrowLeft');
      await page.waitForTimeout(120);
      const coarse = await readAim(page);
      check(
        Math.abs(coarse.x - start.x) > 0.02,
        `ArrowLeft moved the claw ${Math.abs(coarse.x - start.x).toFixed(4)} — expected ~0.04`,
      );

      await page.keyboard.down('Shift');
      await page.keyboard.press('ArrowRight');
      await page.keyboard.up('Shift');
      await page.waitForTimeout(120);
      const fine = await readAim(page);
      const fineStep = Math.abs(fine.x - coarse.x);
      check(
        fineStep > 0 && fineStep < Math.abs(coarse.x - start.x),
        `Shift+Arrow step ${fineStep.toFixed(4)} was not finer than the coarse step`,
      );

      await page.keyboard.press('ArrowUp');
      await page.waitForTimeout(120);
      const deeper = await readAim(page);
      check(deeper.z > fine.z, 'ArrowUp did not push the claw deeper into the bed');

      await page.keyboard.press('Space');
      await waitForClawResult(page);
      const after = await balance();
      return {
        state: `coarse ${Math.abs(coarse.x - start.x).toFixed(3)} / fine ${fineStep.toFixed(3)} world units`,
        delta: after - before,
      };
    } finally {
      await page.close();
    }
    });
  }

  if (FULL_TIMELINE) {
    await step(area, 'pointer aim moves the claw', async () => {
    const page = await openClawPage(context, DESKTOP);
    try {
      await selectLowestBet(page);
      const before = await balance();
      await armClaw(page);
      const start = await readAim(page);

      await page.locator('.pc-viewport').scrollIntoViewIfNeeded();
      const box = await page.locator('.pc-viewport').boundingBox();
      check(box, 'the cabinet stage has no bounding box');
      // Screen-right is world -x, so aim at whichever side of the cabinet the
      // claw is NOT parked on. The drag then has to cross most of the bed and
      // the assertion cannot accidentally land back where it started.
      const toU = start.x > 0 ? 0.85 : 0.15;
      await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width * toU, box.y + box.height * 0.45, { steps: 8 });
      await page.mouse.up();
      await page.waitForTimeout(150);
      const dragged = await readAim(page);
      check(
        Math.abs(dragged.x - start.x) > 0.2,
        `dragging across the cabinet moved the claw ${Math.abs(dragged.x - start.x).toFixed(3)} in x`,
      );
      // Lifting the pointer must never commit.
      check(
        (await page.locator(CLAW_BACK_OUT).count()) === 1,
        'releasing the pointer committed the drop',
      );

      await commitDropInBrowser(page);
      await waitForClawResult(page);
      const after = await balance();
      return {
        state: `drag moved to (${dragged.x.toFixed(2)}, ${dragged.z.toFixed(2)}), lift-off did not commit`,
        delta: after - before,
      };
    } finally {
      await page.close();
    }
    });

    await step(area, 'back out returns the wager', async () => {
    const page = await openClawPage(context, DESKTOP);
    try {
      await selectLowestBet(page);
      const before = await balance();
      await armClaw(page);
      const held = await balance();
      check(held < before, 'buying a drop did not hold the wager');
      await page.locator(CLAW_BACK_OUT).click();
      await page.waitForSelector('text=Your wager was returned in full', { timeout: 20_000 });
      await page.waitForTimeout(500);
      const after = await balance();
      check(after === before, `back out left the wallet ${after - before} off`);
      return { state: 'wager returned in full', delta: 0 };
    } finally {
      await page.close();
    }
    });
  }

  if (FULL_TIMELINE) {
    await step(area, '12-second clock auto-commits', async () => {
    const page = await openClawPage(context, DESKTOP);
    try {
      await selectLowestBet(page);
      const before = await balance();
      await armClaw(page);
      const startedAt = Date.now();
      await waitForClawResult(page, CLAW_COMMIT_MS + CLAW_DROP_MS + 10_000);
      const elapsed = Date.now() - startedAt;
      check(
        elapsed >= CLAW_COMMIT_MS - 1_500,
        `auto-commit fired after ${elapsed}ms, before the 12 s clock ran out`,
      );
      const after = await balance();
      return { state: `auto-committed after ${(elapsed / 1000).toFixed(1)}s`, delta: after - before };
    } finally {
      await page.close();
    }
    });

    await step(area, 'hidden tab still completes the drop', async () => {
    const page = await openClawPage(context, DESKTOP);
    try {
      await selectLowestBet(page);
      const before = await balance();
      await armClaw(page);
      await commitDropInBrowser(page);
      const { hiddenSeen } = await withHiddenTab(context, page, async () => {
        await page.waitForTimeout(CLAW_DROP_MS * 0.5);
      });
      await waitForClawResult(page);
      const after = await balance();
      return {
        status: hiddenSeen === 'hidden' ? 'PASS' : 'SKIP',
        state: `visibilityState=${hiddenSeen}, verify panel rendered`,
        delta: after - before,
        note:
          hiddenSeen === 'hidden'
            ? 'drop resolved with no animation frames'
            : 'headless Chromium never reported hidden; wall-clock completion still asserted',
      };
    } finally {
      await page.close();
    }
    });

    await step(area, 'reset offers a fresh drop', async () => {
    const page = await openClawPage(context, DESKTOP);
    try {
      await selectLowestBet(page);
      await armClaw(page);
      await commitDropInBrowser(page);
      await waitForClawResult(page);
      const buyAgain = page.locator(CLAW_BUY);
      await buyAgain.waitFor({ timeout: 10_000 });
      check(await buyAgain.isEnabled(), 'the cabinet did not re-arm for another drop');
      check((await page.locator('.pc-clock').count()) === 0, 'the commit clock is still running');
      return { state: 'phase back to idle, Buy a drop enabled' };
    } finally {
      await page.close();
    }
    });
  }

  await context.close();

  const reducedContext = await browser.newContext({
    viewport: DESKTOP,
    reducedMotion: 'reduce',
    storageState: authState,
  });
  await step(area, 'reduced motion completes the drop', async () => {
    const page = await openClawPage(reducedContext, DESKTOP);
    try {
      await page.waitForSelector('text=Reduced motion is on', { timeout: 15_000 });
      await selectLowestBet(page);
      const before = await balance();
      await armClaw(page);
      await commitDropInBrowser(page);
      await waitForClawResult(page);
      const after = await balance();
      return { state: 'compressed script, verify panel rendered', delta: after - before };
    } finally {
      await page.close();
    }
  });
  await reducedContext.close();

  const mobileContext = await browser.newContext({
    viewport: MOBILE,
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    storageState: authState,
  });
  await step(area, 'mobile 390x844 · touch aim, countdown, target', async () => {
    const page = await openClawPage(mobileContext, MOBILE);
    try {
      const layout = await assertLayout(page, MOBILE);
      check(layout.innerWidth === 390, `mobile viewport is ${layout.innerWidth}px wide`);
      await assertNoWebglFallback(page, '.pc-overlay');

      await selectLowestBet(page);
      const before = await balance();
      await armClaw(page);
      const start = await readAim(page);

      await page.locator('.pc-viewport').scrollIntoViewIfNeeded();
      const box = await page.locator('.pc-viewport').boundingBox();
      check(box, 'the cabinet stage has no bounding box');
      // Same trick as the desktop drag: tap the far side of the cabinet from
      // wherever the claw parked, so the movement cannot be a rounding artefact.
      const tapU = start.x > 0 ? 0.85 : 0.15;
      await page.touchscreen.tap(box.x + box.width * tapU, box.y + box.height * 0.55);
      await page.waitForTimeout(250);
      const tapped = await readAim(page);
      check(
        Math.abs(tapped.x - start.x) > 0.2,
        `a touch tap moved the claw ${Math.abs(tapped.x - start.x).toFixed(3)} in x`,
      );

      const clock = (await page.locator('.pc-clock').innerText()).trim();
      const readout = await page.locator('.pc-readout').innerText();
      const evidence = await screenshot(page, 'prize-claw-mobile-390x844-armed', '.pc-viewport');

      await commitDropInBrowser(page);
      await waitForClawResult(page);
      const after = await balance();
      const resultEvidence = await screenshot(page, 'prize-claw-mobile-390x844-result', '.pc-verify');

      return {
        state: `390x844 no overflow, clock=${clock}, readout="${readout.replace(/\s+/g, ' ').slice(0, 60)}"`,
        delta: after - before,
        note: `${evidence}, ${resultEvidence}`,
      };
    } finally {
      await page.close();
    }
  });
  await mobileContext.close();
}

/* ══════════════════════════════════════════════════════════════════════════
   Main
   ══════════════════════════════════════════════════════════════════════════ */

/** Authenticated storage state, reused by every browser context. */
let authState = null;

async function main() {
  say(`Lucky Cage + Prize Claw QA harness → ${BASE} (${QA_SUITE}, ${QA_PROFILE})`);
  await fs.mkdir(EVIDENCE_DIR, { recursive: true });

  const watchdog = setTimeout(() => {
    say(`harness exceeded its ${HARNESS_BUDGET_MS / 60_000}-minute budget — aborting`);
    process.exit(1);
  }, HARNESS_BUDGET_MS);

  const browser = await chromium.launch({
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  // This context is the harness's API client for the whole run — it stays open
  // until the very end, and every browser context reuses its storage state.
  const authContext = await browser.newContext({ viewport: DESKTOP });
  api = authContext.request;

  const login = await api.post(`${BASE}/api/account/session`, {
    data: { emailOrUsername: EMAIL, password: PASSWORD },
  });
  if (!login.ok()) {
    // The body can echo the submitted identifier — report the status only.
    record('auth', 'sign in', 'FAIL', login.status(), 'login rejected');
    clearTimeout(watchdog);
    await browser.close();
    return 1;
  }
  record('auth', 'sign in', 'PASS', login.status(), 'account session established');

  await step('auth', 'authenticated wallet available', async () => {
    const me = await getJson('/api/account/me');
    check(me.status === 200, `/api/account/me returned HTTP ${me.status}`);
    check(me.data.account?.username, 'signed-in account has no username');
    const funding = await ensureFunds(FUND_TARGET);
    check(funding.credits >= STAKE * 4, `wallet holds ${funding.credits} tickets — too few to play`);
    return {
      http: 200,
      state: `balance=${funding.credits} via ${funding.via}`,
      note: funding.credits >= FUND_TARGET ? '' : 'running at minimum stake',
    };
  });

  authState = await authContext.storageState();

  try {
    if (RUN_CAGE) {
      await luckyCageApiSuite();
      await luckyCageBrowserSuite(browser);
    }
    if (RUN_CLAW) {
      await prizeClawApiSuite();
      await prizeClawBrowserSuite(browser);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    record('harness', 'suite aborted', 'FAIL', undefined, undefined, undefined, message.slice(0, 220));
  } finally {
    clearTimeout(watchdog);
    await authContext.close().catch(() => {});
    await browser.close().catch(() => {});
  }

  // ── redacted path matrix ────────────────────────────────────────────────
  const headers = ['AREA', 'CASE', 'RESULT', 'HTTP', 'STATE', 'ΔWALLET', 'NOTES'];
  const rows = matrix.map((r) => [r.area, r.name, r.status, r.http, r.state, r.delta, r.note]);
  const widths = headers.map((h, i) =>
    Math.min(64, Math.max(h.length, ...rows.map((row) => String(row[i] ?? '').length))),
  );
  const line = (cells) =>
    cells.map((c, i) => String(c ?? '').slice(0, widths[i]).padEnd(widths[i])).join('  ');

  say('');
  say(line(headers));
  say(widths.map((w) => '-'.repeat(w)).join('  '));
  for (const row of rows) say(line(row));

  const passed = matrix.filter((r) => r.status === 'PASS').length;
  const skipped = matrix.filter((r) => r.status === 'SKIP').length;
  say('');
  say(`${passed} passed · ${skipped} skipped · ${failures} failed (${matrix.length} cases)`);
  say('evidence: qa-evidence/');
  return failures === 0 ? 0 : 1;
}

let exitCode = 1;
try {
  exitCode = await main();
} catch (error) {
  say(`harness crashed: ${error instanceof Error ? error.message : String(error)}`);
}
process.exit(exitCode);
