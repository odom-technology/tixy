/* Derby's network side on the phone: the server clock, the race's pushes,
   a poll as a backstop, heartbeats and aim batches. 8-ball's plumbing:
   HTTP for actions, `/api/live` server-sent events for pushes. */

import type { DerbyResult } from '@/features/arcade/lib/derby';
import { subscribeLive, type LiveEventPayload } from '@/lib/liveEvents';

export type DerbyLaneView = {
  lane: number;
  kind: 'human' | 'bot';
  userId: string | null;
  name: string;
  botSkill: number | null;
  /** Ticks the server holds for this lane. */
  next: number;
  place: number | null;
  forfeit: 'left' | 'timeout' | 'idle' | null;
  tickets: number | null;
  away: boolean;
};

export type DerbyRewardView = {
  reward: {
    awardedTickets: number;
    wantedTickets: number;
    awardedCredits: number;
    wantedCredits: number;
    dateKey: string;
    earnedTodayTotal: number;
    capRemaining: number;
  };
  achievements: unknown[];
};

/** A batch the server kept: ticks [prev, from) dry, then the samples. */
export type DerbyBatchView = { lane: number; prev: number; from: number; samples: number[] };

export type DerbySnapshotView = {
  id: string;
  kind: 'practice' | 'public' | 'invite';
  status: 'lobby' | 'running' | 'finished' | 'cancelled';
  seed: number;
  rules: number;
  hostUserId: string;
  fillAt: number | null;
  startAt: number | null;
  serverNow: number;
  myLane: number | null;
  lanes: DerbyLaneView[];
  batches: DerbyBatchView[];
  /** Ticks final for every lane. */
  sealed: number;
  result: DerbyResult | null;
  rematch: string | null;
  reward: DerbyRewardView | null;
};

export type DerbyAimAnswer = {
  /** What was kept, or null when nothing was. */
  kept: { prev: number; from: number; n: number } | null;
  /** Send from here next. */
  next: number;
  sealed: number;
  serverNow: number;
};

export type DerbyInvite = { code: string; href: string; url: string };

type ClockSample = { offset: number; rtt: number; at: number };

/** The server's clock from performance.now(): server ms = perf + offset. */
export class DerbyClock {
  private samples: ClockSample[] = [];
  offset: number | null = null;

  record(sentPerf: number, receivedPerf: number, serverNow: number) {
    if (!Number.isFinite(serverNow)) return;
    const rtt = receivedPerf - sentPerf;
    const offset = serverNow - (sentPerf + receivedPerf) / 2;
    this.samples.push({ offset, rtt, at: receivedPerf });
    // Keep the last minute; trust the quickest round trip (Cristian).
    this.samples = this.samples.filter((s) => receivedPerf - s.at < 60_000).slice(-16);
    const best = this.samples.reduce((a, b) => (b.rtt < a.rtt ? b : a));
    this.offset = best.offset;
  }

  serverAt(perf: number): number {
    return perf + (this.offset ?? Date.now() - performance.now());
  }
}

export class DerbyHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: Record<string, unknown>,
  ) {
    super(message);
  }
}

export class DerbyNet {
  readonly clock = new DerbyClock();

  async call<T>(url: string, init?: RequestInit): Promise<T> {
    const sent = performance.now();
    const response = await fetch(url, {
      cache: 'no-store',
      ...init,
      headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    });
    const received = performance.now();
    const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    const serverNow = Number(
      (body.serverNow as number | undefined) ??
        ((body.snapshot as { serverNow?: number } | undefined)?.serverNow ?? NaN),
    );
    if (Number.isFinite(serverNow)) this.clock.record(sent, received, serverNow);
    if (!response.ok) {
      throw new DerbyHttpError(String(body.error ?? 'The booth could not be reached.'), response.status, body);
    }
    return body as T;
  }

  snapshot(raceId: string, since = 0) {
    return this.call<DerbySnapshotView>(`/api/games/derby/race/${encodeURIComponent(raceId)}?since=${Math.max(0, since | 0)}`);
  }

  create(kind: 'practice' | 'public' | 'invite') {
    return this.call<{ raceId: string; invite: DerbyInvite | null; snapshot: DerbySnapshotView }>('/api/games/derby/race', {
      method: 'POST',
      body: JSON.stringify({ kind }),
    });
  }

  active() {
    return this.call<{ raceId: string | null }>('/api/games/derby/race/active');
  }

  join(raceId: string) {
    return this.call<{ snapshot: DerbySnapshotView }>(`/api/games/derby/race/${encodeURIComponent(raceId)}/join`, { method: 'POST' });
  }

  joinCode(code: string) {
    return this.call<{ raceId: string; snapshot: DerbySnapshotView }>('/api/games/derby/join-code', {
      method: 'POST',
      body: JSON.stringify({ code }),
    });
  }

  start(raceId: string) {
    return this.call<{ ok: boolean }>(`/api/games/derby/race/${encodeURIComponent(raceId)}/start`, { method: 'POST' });
  }

  leave(raceId: string) {
    return this.call<{ ok: boolean }>(`/api/games/derby/race/${encodeURIComponent(raceId)}/leave`, { method: 'POST' });
  }

  heartbeat(raceId: string) {
    return this.call<{ serverNow: number }>(`/api/games/derby/race/${encodeURIComponent(raceId)}/heartbeat`, { method: 'POST' });
  }

  rematch(raceId: string) {
    return this.call<{ raceId: string; invite: DerbyInvite; snapshot: DerbySnapshotView }>(
      `/api/games/derby/race/${encodeURIComponent(raceId)}/rematch`,
      { method: 'POST' },
    );
  }

  aims(raceId: string, from: number, samples: number[]) {
    return this.call<DerbyAimAnswer>(`/api/games/derby/race/${encodeURIComponent(raceId)}/aims`, {
      method: 'POST',
      body: JSON.stringify({ from, samples }),
    });
  }

  /** Pushes for one race. Returns the unsubscribe. */
  listen(raceId: string, handler: (event: LiveEventPayload) => void): () => void {
    return subscribeLive([`derbyRace:${raceId}`], (payload) => {
      if (payload && payload.raceId === raceId) handler(payload);
    });
  }
}
