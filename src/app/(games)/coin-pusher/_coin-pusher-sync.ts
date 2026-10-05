/* ──────────────────────────────────────────────────────────────────────────
   COIN PUSHER — keeping the browser's machine and the server's in step.

   The browser draws ahead with the shared engine; the server decides. Each
   drop is poured locally at the next step and sent with that step, the bet,
   the aim and a fresh request id. Requests go one at a time, in order, so
   the server always sees the steps in the order the player made them. A
   lost answer is retried with the same request id, which the server answers
   from its record without charging again.

   Every answer carries the server's hash at the step it reached. The browser
   compares it with its own hash at that step (taken when it sent the
   request). A mismatch, a clamped step or a refused drop reloads the machine
   from the server once the queue is empty.
   ────────────────────────────────────────────────────────────────────────── */

import { cpHash, cpParse, type CpMachine } from '@/features/arcade/lib/coin-pusher/engine';

import type { PusherRuntime } from './_coin-pusher-runtime';

export type PusherAnswer = {
  requestId: string;
  kind: 'drop' | 'collect';
  entryStep: number | null;
  claimedStep: number | null;
  committedStep: number;
  hash: string;
  coinsWon: number;
  paid: number;
  carry: number;
  balance: number;
  bet: number;
  coins: number;
  achievements: unknown[];
  replayed: boolean;
  serverNow: number;
};

export type PusherView = {
  machine: CpMachine;
  hash: string;
  serverNow: number;
  committedStep: number;
  carry: number;
  balance: number;
  coinsWon: number;
  paid: number;
};

type Item = {
  kind: 'drop' | 'collect';
  body: Record<string, unknown>;
  claimed: number;
  hash: string;
  bet: number;
};

export type SyncHandlers = {
  onAnswer: (answer: PusherAnswer) => void;
  /** A drop the server refused (402 no tickets, 429 chute full, 4xx). */
  onRefused: (status: number, message: string, bet: number) => void;
  /** The server's machine replaced the browser's. */
  onResync: (view: PusherView) => void;
  onOffline: () => void;
};

const newId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;

/** The clock offset from one request. The server stamps `serverNow` as it
    answers, so the stamp is about one return trip old when it arrives; this
    takes it as current, which puts the page's clock a little behind the
    server's. A claimed step is then never in the future, and a slow server
    (a cold route takes seconds) can't push the page's clock back by half its
    delay, as a round-trip midpoint would. */
export function offsetFrom(serverNow: number, _sentAt: number, receivedAt: number): number {
  return serverNow - receivedAt;
}

export async function fetchMachine(): Promise<{ status: number; view?: PusherView; offset?: number; error?: string }> {
  const sentAt = Date.now();
  const res = await fetch('/api/coin-pusher/machine', { cache: 'no-store' });
  const receivedAt = Date.now();
  const data = (await res.json().catch(() => ({}))) as Partial<PusherView> & { error?: string };
  if (!res.ok) return { status: res.status, error: data.error };
  const machine = cpParse(data.machine);
  if (!machine) return { status: 500, error: 'The machine sent a state this page could not read.' };
  return {
    status: 200,
    view: { ...(data as PusherView), machine },
    offset: offsetFrom(data.serverNow ?? receivedAt, sentAt, receivedAt),
  };
}

export class PusherSync {
  private queue: Item[] = [];
  private busy = false;
  private needResync = false;
  private disposed = false;
  /** Collects waiting in the queue: at most one. */
  private collectQueued = false;

  constructor(
    private readonly runtime: () => PusherRuntime | null,
    private readonly handlers: SyncHandlers,
  ) {}

  dispose() {
    this.disposed = true;
  }

  idle(): boolean {
    return !this.busy && this.queue.length === 0;
  }

  /** Pour locally at the next step and send it. Returns false if nothing ran. */
  drop(bet: number, x: number, coins: number): boolean {
    const rt = this.runtime();
    if (!rt) return false;
    const claimed = rt.nextStep();
    rt.pour(x, coins, claimed);
    this.queue.push({
      kind: 'drop',
      body: { requestId: newId(), bet, x, step: claimed },
      claimed,
      hash: cpHash(rt.m),
      bet,
    });
    void this.pump();
    return true;
  }

  /** Ask the server to pay for what has fallen up to the step on screen. */
  collect() {
    const rt = this.runtime();
    if (!rt || this.collectQueued) return;
    this.collectQueued = true;
    this.queue.push({
      kind: 'collect',
      body: { requestId: newId(), step: rt.m.step },
      claimed: rt.m.step,
      hash: cpHash(rt.m),
      bet: 0,
    });
    void this.pump();
  }

  private async send(item: Item): Promise<{ status: number; data: PusherAnswer & { error?: string }; sentAt: number; receivedAt: number } | null> {
    // The same request id on every try: the server answers a repeat from
    // its record, so a retry can never charge or pay twice.
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        const sentAt = Date.now();
        const res = await fetch(`/api/coin-pusher/${item.kind}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(item.body),
        });
        const receivedAt = Date.now();
        const data = (await res.json().catch(() => ({}))) as PusherAnswer & { error?: string };
        if (res.status >= 500 && attempt < 3) {
          await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
          continue;
        }
        return { status: res.status, data, sentAt, receivedAt };
      } catch {
        if (this.disposed) return null;
        await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
      }
    }
    return null;
  }

  private async pump() {
    if (this.busy || this.disposed) return;
    this.busy = true;
    try {
      while (this.queue.length > 0 && !this.disposed) {
        const item = this.queue.shift()!;
        if (item.kind === 'collect') this.collectQueued = false;
        const result = await this.send(item);
        if (this.disposed) return;
        if (!result) {
          this.needResync = true;
          this.handlers.onOffline();
          continue;
        }
        const { status, data } = result;
        if (status !== 200) {
          this.needResync = true;
          if (item.kind === 'drop') this.handlers.onRefused(status, data.error ?? '', item.bet);
          continue;
        }
        const matches =
          data.committedStep === item.claimed - (item.kind === 'drop' ? 1 : 0) &&
          (item.kind === 'collect' || data.entryStep === item.claimed) &&
          data.hash === item.hash;
        if (!matches) {
          this.needResync = true;
          if (process.env.NODE_ENV !== 'production') {
            console.warn('[coin-pusher] answer differs from this machine; reloading', { kind: item.kind, claimed: item.claimed, entry: data.entryStep, committed: data.committedStep });
          }
        }
        // Nudge the clock toward the server's, a tenth at a time, when the
        // round trip was quick enough to trust.
        const rt = this.runtime();
        if (rt && result.receivedAt - result.sentAt < 400) {
          const sample = offsetFrom(data.serverNow, result.sentAt, result.receivedAt);
          rt.offsetMs += (sample - rt.offsetMs) * 0.1;
        }
        this.handlers.onAnswer(data);
      }
      if (this.needResync && !this.disposed) {
        this.needResync = false;
        const loaded = await fetchMachine().catch(() => null);
        if (loaded?.view && !this.disposed) {
          const rt = this.runtime();
          if (rt && loaded.offset !== undefined) rt.load(loaded.view.machine, loaded.offset);
          this.handlers.onResync(loaded.view);
        }
      }
    } finally {
      this.busy = false;
    }
    // Something arrived while the resync ran.
    if (this.queue.length > 0 && !this.disposed) void this.pump();
  }
}
