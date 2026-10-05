/* A real round, played against the server. Rocket League's model:

   - Prediction. The page runs the same engine as the server, ahead of it by
     about half a round trip plus a few ticks, so your car answers your finger
     in the same frame. The other cars are predicted too, each driven by the
     last input the server saw from it, so a hit lands where you see it.
   - Reconciliation. Each snapshot is the server's world at tick K. The page
     loads it, replays its own inputs from K to now, and keeps the result.
     With the same inputs the replay lands on the server's numbers exactly
     (the engine is deterministic on a fixed grid), so only other players'
     changes of mind move anything.
   - Smoothing. When a replay moves a car, the move goes into an offset that
     decays over 120 ms (60 ms for yours), so corrections glide instead of
     pop. Cars are drawn between two ticks at display refresh.
   - Timing. The server reports how far ahead of it your newest input arrives
     (`ib`). The page runs its clock up to 6% fast or slow to hold that at a
     few ticks plus the jitter it sees, so inputs land before they're needed.
   - Score. Only the server scores. A bump you predict gets its squash, spark,
     sound and buzz at once; the +1 comes with the server's word, a round
     trip later.

   Socket-agnostic so the sync test can run it in Node. */

import {
  CAR_COLORS,
  COAST_TICKS,
  COUNTDOWN_TICKS,
  DT,
  INPUT_EVERY,
  INPUT_REDUNDANCY,
  MAX_CARS,
  ROUND_TICKS,
} from './constants';
import type { ClientMessage, ServerMessage, WireCar, WireRoom, WireStanding, WireReward } from './protocol';
import { PoseHistory, RenderLag, type BumperView, type FeelEvent, type Pose, type RoundPhase, type SeatInfo } from './runtime';
import { createSim, setInputs, stepSim, unpackCarInto, type CarInput, type SimEvent, type SimState } from './sim';


const TICK_MS = DT * 1000;
const END_TICK = COUNTDOWN_TICKS + ROUND_TICKS;
const FINAL_TICK = END_TICK + COAST_TICKS;

export type SocketLike = {
  readyState: number;
  send: (data: string) => void;
  close: (code?: number, reason?: string) => void;
  onopen: ((ev?: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev?: unknown) => void) | null;
  onerror: ((ev?: unknown) => void) | null;
};

export type TicketInfo = { ticket: string; room: WireRoom; seat: number; ws: string };

export type OnlineOptions = {
  /** Make a socket to this path. The page builds ws(s)://host/path. */
  connect: (path: string) => SocketLike;
  /** A fresh ticket for the room: the first join, and every reconnect. */
  ticket: () => Promise<TicketInfo>;
  first: TicketInfo;
  onRoom?: (room: WireRoom, seat: number) => void;
  onEnd?: (end: { round: string; standings: WireStanding[]; reward: WireReward; settled: boolean }) => void;
  onStatus?: (status: OnlineStatus, detail?: string) => void;
  reducedMotion?: () => boolean;
  /** Draw the others from the snapshots 100 ms back instead of predicting them. */
  interpolateOthers?: boolean;
  now?: () => number;
};

export type OnlineStatus = 'connecting' | 'live' | 'reconnecting' | 'closed';

type Offset = { x: number; z: number; a: number };

export type NetStats = {
  rttMs: number;
  ib: number;
  rate: number;
  lead: number;
  snapshots: number;
  corrections: number;
  /** Correction to your own car, metres, in the last snapshot. */
  myCorrection: number;
  /** Over the live round: snapshots that moved your car, the mean and the
   *  largest move, and the mean input lead. */
  myMoved: number;
  myMovedMean: number;
  myMovedMax: number;
  othersMovedMean: number;
  ibMean: number;
  reconnects: number;
  resyncs: number;
  predTick: number;
  serverTick: number;
};

export class OnlineRound implements BumperView {
  readonly mode = 'online' as const;
  private socket: SocketLike | null = null;
  private status: OnlineStatus = 'connecting';
  private room: WireRoom;
  private seat: number;
  private sim: SimState;
  private predTick = 0;
  private running = false;
  private clockTick = 0;
  private rate = 1;
  private lastNow: number | null = null;
  private renderTick = 0;
  private history = new PoseHistory();
  private lag = new RenderLag();
  private offsets: Offset[] = Array.from({ length: MAX_CARS }, () => ({ x: 0, z: 0, a: 0 }));
  private myInputs = new Map<number, CarInput>();
  private remoteInputs: CarInput[] = Array.from({ length: MAX_CARS }, () => ({ steer: 0, throttle: 0 }));
  private input: CarInput = { steer: 0, throttle: 0 };
  private serverPoints: number[] = new Array(MAX_CARS).fill(0);
  private serverBumps: number[] = new Array(MAX_CARS).fill(0);
  private events: FeelEvent[] = [];
  private stepEvents: SimEvent[] = [];
  private predicted: Array<{ a: number; b: number; tick: number }> = [];
  private phaseNow: RoundPhase = 'waiting';
  private seatInfo: SeatInfo[] = [];
  private rttMs = 150;
  private ibAvg = 4;
  private ibDev = 1;
  private lastIb = 0;
  private jumpQuietUntil = 0;
  private lastSentTick = 0;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelay = 400;
  private disposed = false;
  private serverTick = 0;
  private snapshots: Array<{ tick: number; cars: WireCar[] }> = [];
  private stats: NetStats = {
    rttMs: 0, ib: 0, rate: 1, lead: 0, snapshots: 0, corrections: 0, myCorrection: 0, reconnects: 0, resyncs: 0, predTick: 0, serverTick: 0,
    myMoved: 0, myMovedMean: 0, myMovedMax: 0, othersMovedMean: 0, ibMean: 0,
  };
  private acc = { n: 0, my: 0, others: 0, ib: 0 };
  private readonly now: () => number;
  private readonly reduced: () => boolean;

  constructor(private readonly opts: OnlineOptions) {
    this.now = opts.now ?? (() => performance.now());
    this.reduced = opts.reducedMotion ?? (() => false);
    this.room = opts.first.room;
    this.seat = opts.first.seat;
    this.sim = this.parkedSim();
    this.history.record(this.sim);
    this.refreshSeats();
    this.open(opts.first);
  }

  // ── BumperView ─────────────────────────────────────────────────────────

  phase(): RoundPhase {
    return this.phaseNow;
  }

  roundTick(): number {
    return Math.floor(this.renderTick) - COUNTDOWN_TICKS;
  }

  seats(): readonly SeatInfo[] {
    return this.seatInfo;
  }

  mySeat(): number {
    return this.seat;
  }

  points(): readonly number[] {
    return this.serverPoints;
  }

  bumps(): readonly number[] {
    return this.serverBumps;
  }

  setInput(steer: number, throttle: number): void {
    this.input = { steer, throttle };
  }

  hitStop(nowMs: number): void {
    this.lag.hit(nowMs, this.reduced());
  }

  drainEvents(): FeelEvent[] {
    const out = this.events;
    this.events = [];
    return out;
  }

  pose(seat: number, out: Pose): void {
    if (this.opts.interpolateOthers && seat !== this.seat && this.running && this.snapshots.length >= 2) {
      this.interpolated(seat, out);
      return;
    }
    if (!this.history.sample(seat, this.renderTick, out)) return;
    const o = this.offsets[seat]!;
    out.x += o.x;
    out.z += o.z;
    if (o.a !== 0) {
      const c = Math.cos(o.a);
      const s = Math.sin(o.a);
      const fx = out.fx * c - out.fz * s;
      const fz = out.fx * s + out.fz * c;
      out.fx = fx;
      out.fz = fz;
    }
  }

  update(nowMs: number): void {
    const last = this.lastNow ?? nowMs;
    // The clock follows real time even through long frames: the server's
    // doesn't stop, so a slow phone steps more ticks in a frame, not fewer.
    const dtMs = Math.min(2000, Math.max(0, nowMs - last));
    this.lastNow = nowMs;
    if (this.running) {
      this.clockTick += (dtMs / TICK_MS) * this.rate;
      const target = Math.min(Math.floor(this.clockTick), FINAL_TICK);
      let steps = 0;
      while (this.predTick < target && steps < 90) {
        this.stepForward();
        steps += 1;
      }
      // Inputs go out every INPUT_EVERY ticks, and at most once a frame: a
      // slow frame steps many ticks with the same input anyway.
      if (this.predTick - this.lastSentTick >= INPUT_EVERY) {
        this.sendInputs();
        this.lastSentTick = this.predTick;
      }
      const frac = Math.min(1, Math.max(0, this.clockTick - this.predTick));
      this.renderTick = this.predTick - 1 + frac - this.lag.update(nowMs);
      // Corrections glide out.
      for (let i = 0; i < MAX_CARS; i += 1) {
        const o = this.offsets[i]!;
        const tau = i === this.seat ? 60 : 120;
        const k = Math.exp(-dtMs / tau);
        o.x *= k;
        o.z *= k;
        o.a *= k;
      }
    } else {
      this.renderTick = this.sim.tick;
    }
    this.updatePhase();
  }

  dispose(): void {
    this.disposed = true;
    if (this.pingTimer) clearInterval(this.pingTimer);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    const s = this.socket;
    this.socket = null;
    if (s) {
      s.onclose = null;
      s.onmessage = null;
      try {
        s.close(1000, 'bye');
      } catch {
        /* closed */
      }
    }
    this.setStatus('closed');
  }

  // ── Room actions ───────────────────────────────────────────────────────

  start(): void {
    this.sendMsg({ t: 'start' });
  }

  rematch(): void {
    this.sendMsg({ t: 'rematch' });
  }

  leave(): void {
    this.sendMsg({ t: 'leave' });
  }

  currentRoom(): WireRoom {
    return this.room;
  }

  netStats(): NetStats {
    return { ...this.stats, rttMs: this.rttMs, rate: this.rate, ib: this.lastIb, lead: this.targetLead(), predTick: this.predTick, serverTick: this.serverTick };
  }

  /** The predicted world, read only: the autopilot and the tests read it. */
  predictedState(): Readonly<SimState> {
    return this.sim;
  }

  isRunning(): boolean {
    return this.running;
  }

  connectionStatus(): OnlineStatus {
    return this.status;
  }

  /** Simulate a dropped connection (the sync test). */
  dropForTest(): void {
    try {
      this.socket?.close(4100, 'test drop');
    } catch {
      /* closed */
    }
  }

  // ── The socket ─────────────────────────────────────────────────────────

  private setStatus(status: OnlineStatus, detail?: string): void {
    if (this.status === status && !detail) return;
    this.status = status;
    this.opts.onStatus?.(status, detail);
  }

  private open(info: TicketInfo): void {
    if (this.disposed) return;
    const socket = this.opts.connect(info.ws);
    this.socket = socket;
    const sentAt = this.now();
    socket.onopen = () => {
      socket.send(JSON.stringify({ t: 'hello', ticket: info.ticket } satisfies ClientMessage));
      this.rttMs = Math.max(20, this.now() - sentAt);
    };
    socket.onmessage = (ev) => {
      if (typeof ev.data !== 'string') return;
      let msg: ServerMessage;
      try {
        msg = JSON.parse(ev.data) as ServerMessage;
      } catch {
        return;
      }
      this.onMessage(msg);
    };
    socket.onclose = () => {
      if (this.socket !== socket) return;
      this.socket = null;
      if (this.pingTimer) clearInterval(this.pingTimer);
      this.pingTimer = null;
      if (this.disposed || this.room.ph === 'closed') {
        this.setStatus('closed');
        return;
      }
      this.scheduleReconnect();
    };
    socket.onerror = () => {
      /* onclose follows */
    };
  }

  private scheduleReconnect(): void {
    if (this.disposed || this.reconnectTimer) return;
    this.setStatus('reconnecting');
    const delay = this.reconnectDelay;
    this.reconnectDelay = Math.min(4000, this.reconnectDelay * 2);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.opts
        .ticket()
        .then((info) => {
          this.stats.reconnects += 1;
          this.room = info.room;
          this.seat = info.seat;
          this.open(info);
        })
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : '';
          if (/closed|not in|left/i.test(message)) {
            this.room = { ...this.room, ph: 'closed' };
            this.setStatus('closed', message);
            return;
          }
          this.scheduleReconnect();
        });
    }, delay);
  }

  private sendMsg(msg: ClientMessage): void {
    const s = this.socket;
    if (!s || s.readyState !== 1) return;
    try {
      s.send(JSON.stringify(msg));
    } catch {
      /* closed */
    }
  }

  private onMessage(msg: ServerMessage): void {
    switch (msg.t) {
      case 'welcome': {
        this.reconnectDelay = 400;
        this.seat = msg.seat;
        this.setRoom(msg.room);
        this.serverPoints = msg.p.slice();
        this.serverBumps = msg.b.slice();
        if (msg.room.ph === 'running' && msg.c.length === MAX_CARS) {
          this.beginFrom(msg.k, msg.c, true);
        } else if (msg.room.ph === 'lobby') {
          this.toLobby();
        } else if (msg.c.length === MAX_CARS) {
          this.loadCars(msg.k, msg.c);
          this.running = false;
        }
        this.setStatus('live');
        if (this.pingTimer) clearInterval(this.pingTimer);
        this.pingTimer = setInterval(() => this.sendMsg({ t: 'ping', c: this.now() }), 1000);
        this.sendMsg({ t: 'ping', c: this.now() });
        break;
      }
      case 'room': {
        const was = this.room.ph;
        this.setRoom(msg.room);
        if (msg.room.ph === 'lobby' && was !== 'lobby') this.toLobby();
        break;
      }
      case 'start':
        this.serverPoints = new Array(MAX_CARS).fill(0);
        this.serverBumps = new Array(MAX_CARS).fill(0);
        this.room = { ...this.room, ph: 'running', round: msg.round };
        this.beginFrom(msg.k, msg.c, false);
        break;
      case 's':
        this.onSnapshot(msg);
        break;
      case 'end':
        this.serverPoints = new Array(MAX_CARS).fill(0);
        for (const s of msg.standings) this.serverPoints[s.seat] = s.points;
        this.opts.onEnd?.(msg);
        break;
      case 'pong': {
        const rtt = Math.max(1, this.now() - msg.c);
        this.rttMs = this.rttMs * 0.8 + rtt * 0.2;
        break;
      }
      case 'err':
        if (msg.fatal) {
          this.room = { ...this.room, ph: 'closed' };
          this.setStatus('closed', msg.m);
        }
        break;
    }
  }

  private setRoom(room: WireRoom): void {
    this.room = room;
    this.refreshSeats();
    this.opts.onRoom?.(room, this.seat);
  }

  private refreshSeats(): void {
    this.seatInfo = this.room.seats.map((s, i) => ({
      name: s.n,
      kind: s.k === 'e' ? 'empty' : i === this.seat ? 'you' : s.k === 'b' ? 'bot' : 'player',
      color: CAR_COLORS[i]!,
      away: Boolean(s.a),
      left: Boolean(s.l),
    }));
  }

  // ── The world ──────────────────────────────────────────────────────────

  private parkedSim(): SimState {
    const active = this.room.seats.map((s) => s.k !== 'e');
    // Before a round everyone in the lobby is parked at their spawn.
    return createSim(active.some(Boolean) ? active : new Array(MAX_CARS).fill(true));
  }

  private toLobby(): void {
    this.running = false;
    this.sim = this.parkedSim();
    this.predTick = 0;
    this.history = new PoseHistory();
    this.history.record(this.sim);
    this.renderTick = 0;
    this.snapshots = [];
    this.serverPoints = new Array(MAX_CARS).fill(0);
    this.serverBumps = new Array(MAX_CARS).fill(0);
  }

  private loadCars(tick: number, cars: readonly WireCar[]): void {
    this.sim.tick = tick;
    this.sim.powered = tick >= COUNTDOWN_TICKS && tick < END_TICK;
    for (let i = 0; i < MAX_CARS; i += 1) {
      const car = this.sim.cars[i]!;
      const w = cars[i];
      if (!w) continue;
      car.active = true;
      unpackCarInto(car, w);
      car.steer = w[7] ?? 0;
      car.throttle = w[8] ?? 0;
      car.slip = w[9] ?? 0;
      this.remoteInputs[i] = { steer: car.steer, throttle: car.throttle };
    }
  }

  /** Start predicting from a server state: a new round, or a rejoin. */
  private beginFrom(tick: number, cars: readonly WireCar[], rejoin: boolean): void {
    this.sim = createSim(new Array(MAX_CARS).fill(true));
    this.loadCars(tick, cars);
    for (let i = 0; i < MAX_CARS; i += 1) this.sim.points[i] = this.serverPoints[i] ?? 0;
    this.history = new PoseHistory();
    this.history.record(this.sim);
    this.predTick = tick;
    this.lastSentTick = tick;
    this.myInputs.clear();
    this.predicted = [];
    this.snapshots = [];
    this.offsets.forEach((o) => {
      o.x = 0;
      o.z = 0;
      o.a = 0;
    });
    this.running = true;
    // Run ahead of the server by half a round trip plus the lead.
    this.clockTick = tick + this.rttMs / 2 / TICK_MS + this.targetLead();
    this.serverTick = tick;
    if (rejoin) this.stats.resyncs += 1;
  }

  private targetLead(): number {
    // A few ticks plus the jitter, capped: a late input costs a small
    // correction, but a long lead stretches every other car's extrapolation.
    return Math.min(10, Math.max(3, 3 + this.ibDev * 1.2));
  }

  private stepForward(): void {
    const sim = this.sim;
    const tick = this.predTick;
    const mine = { steer: this.input.steer, throttle: this.input.throttle };
    this.myInputs.set(tick, mine);
    this.applyInputs(tick);
    sim.powered = tick >= COUNTDOWN_TICKS && tick < END_TICK;
    this.stepEvents.length = 0;
    stepSim(sim, this.stepEvents);
    this.predTick = sim.tick;
    this.history.record(sim);
    for (const e of this.stepEvents) {
      if (e.type === 'bump') {
        this.predicted.push({ a: e.a, b: e.b, tick: e.tick });
        this.events.push({ kind: 'bump', a: e.a, b: e.b, speed: e.speed, x: e.x, z: e.z, nx: e.nx, nz: e.nz, pa: e.pa, pb: e.pb });
      } else if (e.type === 'touch') {
        this.events.push({ kind: 'touch', a: e.a, b: e.b, speed: e.speed, x: e.x, z: e.z, nx: e.nx, nz: e.nz });
      } else {
        this.events.push({ kind: 'wall', car: e.car, speed: e.speed, x: e.x, z: e.z });
      }
    }
    if (this.predicted.length > 64) this.predicted.splice(0, this.predicted.length - 64);
  }

  private applyInputs(tick: number): void {
    const inputs: Array<CarInput | null> = new Array(MAX_CARS);
    for (let i = 0; i < MAX_CARS; i += 1) {
      inputs[i] = i === this.seat ? this.myInputs.get(tick) ?? this.input : this.remoteInputs[i]!;
    }
    setInputs(this.sim, inputs);
  }

  private sendInputs(): void {
    const k = this.predTick - 1;
    const pairs: number[] = [];
    const from = Math.max(0, k - INPUT_REDUNDANCY + 1);
    for (let t = from; t <= k; t += 1) {
      const inp = this.myInputs.get(t) ?? this.input;
      pairs.push(inp.steer, inp.throttle);
    }
    if (pairs.length > 0) this.sendMsg({ t: 'in', k, d: pairs });
  }

  private onSnapshot(msg: Extract<ServerMessage, { t: 's' }>): void {
    this.stats.snapshots += 1;
    this.serverTick = msg.k;
    // Scores are the server's.
    const prevPoints = this.serverPoints;
    this.serverPoints = msg.p.slice();
    this.serverBumps = msg.b.slice();
    if (msg.e) this.confirmBumps(msg.e, prevPoints);
    if (!this.running) return;

    // Keep the inputs arriving a few ticks early.
    this.lastIb = msg.ib;
    this.ibAvg = this.ibAvg * 0.9 + msg.ib * 0.1;
    this.ibDev = this.ibDev * 0.9 + Math.abs(msg.ib - this.ibAvg) * 0.1;
    const lead = this.targetLead();
    // Inputs arriving late by more than a few ticks, or far too early: jump
    // the clock by the error once, then wait a round trip to see it land.
    const nowMs = this.now();
    if ((msg.ib < -4 || msg.ib > lead + 24) && nowMs >= this.jumpQuietUntil) {
      this.clockTick += lead - msg.ib;
      this.jumpQuietUntil = nowMs + this.rttMs + 150;
      this.stats.resyncs += 1;
    }
    const err = lead - msg.ib;
    this.rate = err > 1 ? 1 + Math.min(0.06, err * 0.012) : err < -2 ? 1 - Math.min(0.06, -err * 0.012) : 1;

    this.snapshots.push({ tick: msg.k, cars: msg.c });
    if (this.snapshots.length > 8) this.snapshots.shift();

    // Reconcile.
    if (msg.k >= this.predTick) {
      // The server is ahead of the prediction (a stall here): jump to it.
      this.loadCars(msg.k, msg.c);
      this.predTick = msg.k;
      this.history.record(this.sim);
      this.clockTick = Math.max(this.clockTick, msg.k + lead);
      return;
    }
    const before = this.sim.cars.map((c) => ({ x: c.x, z: c.z, a: Math.atan2(c.fz, c.fx) }));
    this.loadCars(msg.k, msg.c);
    this.history.record(this.sim);
    const until = this.predTick;
    while (this.sim.tick < until) {
      this.applyInputs(this.sim.tick);
      this.sim.powered = this.sim.tick >= COUNTDOWN_TICKS && this.sim.tick < END_TICK;
      stepSim(this.sim, null);
      this.history.record(this.sim);
    }
    let moved = 0;
    let others = 0;
    for (let i = 0; i < MAX_CARS; i += 1) {
      const c = this.sim.cars[i]!;
      const o = this.offsets[i]!;
      const dx = before[i]!.x - c.x;
      const dz = before[i]!.z - c.z;
      let da = before[i]!.a - Math.atan2(c.fz, c.fx);
      while (da > Math.PI) da -= Math.PI * 2;
      while (da < -Math.PI) da += Math.PI * 2;
      const d = Math.hypot(dx, dz);
      if (d > 1e-6 || Math.abs(da) > 1e-6) this.stats.corrections += 1;
      if (i === this.seat) moved = d;
      else others += d / (MAX_CARS - 1);
      if (d > 3) {
        o.x = 0;
        o.z = 0;
        o.a = 0;
      } else {
        o.x += dx;
        o.z += dz;
        o.a += da;
      }
    }
    this.stats.myCorrection = moved;
    if (msg.k >= COUNTDOWN_TICKS && msg.k < END_TICK) {
      const a = this.acc;
      a.n += 1;
      a.my += moved;
      a.others += others;
      a.ib += msg.ib;
      if (moved > 0.0005) this.stats.myMoved += 1;
      this.stats.myMovedMax = Math.max(this.stats.myMovedMax, moved);
      this.stats.myMovedMean = a.my / a.n;
      this.stats.othersMovedMean = a.others / a.n;
      this.stats.ibMean = a.ib / a.n;
    }
    for (const t of this.myInputs.keys()) if (t < msg.k - 30) this.myInputs.delete(t);
  }

  /** Server-scored bumps: the +1s, and the squash for any the page missed. */
  private confirmBumps(bumps: readonly number[][], _prev: number[]): void {
    for (const [tick, a, b, pa, pb, speedCm] of bumps as Array<[number, number, number, number, number, number]>) {
      const seen = this.predicted.some((p) => p.a === a && p.b === b && Math.abs(p.tick - tick) <= 15);
      if (!seen && this.running) {
        const ca = this.sim.cars[a]!;
        const cb = this.sim.cars[b]!;
        const dx = cb.x - ca.x;
        const dz = cb.z - ca.z;
        const len = Math.hypot(dx, dz) || 1;
        this.events.push({ kind: 'bump', a, b, speed: speedCm / 100, x: (ca.x + cb.x) / 2, z: (ca.z + cb.z) / 2, nx: dx / len, nz: dz / len, pa, pb });
      }
      if (pa > 0) this.events.push({ kind: 'score', seat: a, points: pa, victim: b, big: pa > 1 });
      if (pb > 0) this.events.push({ kind: 'score', seat: b, points: pb, victim: a, big: pb > 1 });
    }
  }

  private interpolated(seat: number, out: Pose): void {
    // Snapshots are 2 ticks apart; draw 6 ticks (100 ms) behind the newest.
    const t = this.serverTick - 6 + Math.min(2, Math.max(0, (this.clockTick - this.predTick)));
    let a = this.snapshots[0]!;
    let b = this.snapshots[this.snapshots.length - 1]!;
    for (let i = 0; i < this.snapshots.length - 1; i += 1) {
      if (this.snapshots[i]!.tick <= t && this.snapshots[i + 1]!.tick >= t) {
        a = this.snapshots[i]!;
        b = this.snapshots[i + 1]!;
        break;
      }
    }
    const span = Math.max(1, b.tick - a.tick);
    const k = Math.min(1, Math.max(0, (t - a.tick) / span));
    const ca = a.cars[seat]!;
    const cb = b.cars[seat]!;
    const l = (i: number, s: number) => (ca[i]! + (cb[i]! - ca[i]!) * k) / s;
    out.x = l(0, 1000);
    out.z = l(1, 1000);
    const fx = l(4, 100000);
    const fz = l(5, 100000);
    const len = Math.hypot(fx, fz) || 1;
    out.fx = fx / len;
    out.fz = fz / len;
    out.speed = Math.hypot(l(2, 1000), l(3, 1000));
    out.w = l(6, 10000);
    out.ax = 0;
    out.az = 0;
  }

  private updatePhase(): void {
    let phase: RoundPhase;
    if (this.room.ph === 'lobby') phase = 'waiting';
    else if (this.room.ph === 'running' && this.running) {
      const t = Math.floor(this.renderTick);
      phase = t < COUNTDOWN_TICKS ? 'countdown' : t < END_TICK ? 'live' : 'over';
    } else phase = 'over';
    if (phase !== this.phaseNow) {
      this.phaseNow = phase;
      this.events.push({ kind: 'phase', phase });
    }
  }

  /** True once the coast after the horn has run out on this page. */
  finished(): boolean {
    return this.running && this.predTick >= FINAL_TICK;
  }
}
