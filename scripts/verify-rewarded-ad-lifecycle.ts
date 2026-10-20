import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createRewardedAdAttempt } from '../src/features/monetization/components/rewarded-ad-button';

type Options = Parameters<typeof createRewardedAdAttempt>[0];
type GoogleTag = ReturnType<Options['getGoogleTag']>;
type PubAds = ReturnType<GoogleTag['pubads']>;
type Listener = Parameters<PubAds['addEventListener']>[1];

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
const intent = { intent: { id: 'isolated-intent', amount: 25 }, adUnitPath: '/mock/rewarded' };
const claim = { success: true, wallet: { storeCredits: 25 } };

function harness(config: {
  queued?: boolean;
  unsupported?: boolean;
  visible?: boolean;
  request?: Options['request'];
  timeoutMs?: number;
} = {}) {
  const events = new Map<string, Set<Listener>>();
  const queued: Array<() => void> = [];
  const phases: string[] = [];
  const errors: Array<string | null> = [];
  const rewards: unknown[] = [];
  const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
  let destroyed = 0;
  let displayed = 0;
  let finished = 0;
  const slot = { addService: () => slot };
  const pubads: PubAds = {
    addEventListener(name, callback) {
      if (!events.has(name)) events.set(name, new Set());
      events.get(name)!.add(callback);
    },
    removeEventListener(name, callback) { events.get(name)?.delete(callback); },
  };
  const googleTag: GoogleTag = {
    cmd: [],
    enums: { OutOfPageFormat: { REWARDED: 'rewarded' } },
    defineOutOfPageSlot: () => config.unsupported ? null : slot,
    pubads: () => pubads,
    enableServices() {},
    display() { displayed++; },
    destroySlots() { destroyed++; },
  };
  googleTag.cmd.push = (callback) => {
    if (config.queued) queued.push(callback);
    else callback();
    return 1;
  };
  const request: NonNullable<Options['request']> = async <T>(url: string, body: Record<string, unknown>, signal?: AbortSignal) => {
    calls.push({ url, body });
    return config.request
      ? config.request<T>(url, body, signal)
      : (url.endsWith('/claim') ? claim : intent) as T;
  };
  const attempt = createRewardedAdAttempt({
    rewardType: 'store_tickets', gameType: null,
    getGoogleTag: () => googleTag,
    onPhase: (phase) => phases.push(phase),
    onError: (error) => errors.push(error),
    onReward: (reward) => rewards.push(reward),
    onFinish: () => { finished++; },
    request, timeoutMs: config.timeoutMs,
  });
  const emit = (name: string, extra: Record<string, unknown> = {}) => {
    for (const listener of [...(events.get(name) ?? [])]) listener({ slot, ...extra });
  };
  return {
    attempt, calls, phases, errors, rewards, events, emit,
    ready: () => emit('rewardedSlotReady', { makeRewardedVisible: () => config.visible !== false }),
    flushQueue: () => queued.splice(0).forEach((callback) => callback()),
    get destroyed() { return destroyed; },
    get displayed() { return displayed; },
    get finished() { return finished; },
    get claims() { return calls.filter((call) => call.url.endsWith('/claim')); },
  };
}

test('early grant credits once, keeps creative until user closes, and removes listeners', async () => {
  const h = harness();
  await h.attempt.start();
  await h.attempt.start();
  assert.equal(h.calls.length, 1, 'a second start must not create another intent');
  h.ready();
  h.emit('rewardedSlotGranted');
  h.emit('rewardedSlotGranted');
  await flush();
  assert.equal(h.claims.length, 1);
  assert.equal(h.rewards.length, 1);
  assert.equal(h.destroyed, 0, 'earning the reward must not terminate the creative');
  assert.equal(h.finished, 0);
  h.emit('rewardedSlotClosed');
  assert.equal(h.destroyed, 1);
  assert.equal(h.phases.at(-1), 'done');
  assert.equal(h.finished, 1);
  assert.ok([...h.events.values()].every((listeners) => listeners.size === 0));
});

test('closing before grant never claims, including a stale late grant callback', async () => {
  const h = harness();
  await h.attempt.start();
  h.ready();
  const lateGrant = [...h.events.get('rewardedSlotGranted')!][0]!;
  h.emit('rewardedSlotClosed');
  lateGrant({});
  await flush();
  assert.equal(h.claims.length, 0);
  assert.equal(h.rewards.length, 0);
  assert.equal(h.destroyed, 1);
  assert.equal(h.phases.at(-1), 'idle');
});

test('closing while claim is in flight destroys only slot and waits for confirmation', async () => {
  let resolveClaim!: (result: typeof claim) => void;
  const pending = new Promise<typeof claim>((resolve) => { resolveClaim = resolve; });
  const h = harness({ request: async <T>(url: string) => (url.endsWith('/claim') ? await pending : intent) as T });
  await h.attempt.start();
  h.ready();
  h.emit('rewardedSlotGranted');
  h.emit('rewardedSlotClosed');
  assert.equal(h.finished, 0);
  assert.equal(h.destroyed, 1);
  resolveClaim(claim);
  await flush();
  assert.equal(h.rewards.length, 1);
  assert.equal(h.phases.at(-1), 'done');
  assert.equal(h.destroyed, 1);
});

test('failed earned reward retries same intent and grant id without another ad', async () => {
  let attempts = 0;
  const h = harness({ request: async <T>(url: string) => {
    if (!url.endsWith('/claim')) return intent as T;
    if (++attempts === 1) throw new Error('Temporary connection failure.');
    return claim as T;
  } });
  await h.attempt.start();
  h.ready();
  h.emit('rewardedSlotGranted');
  await flush();
  assert.equal(h.destroyed, 0);
  h.emit('rewardedSlotClosed');
  assert.equal(h.phases.at(-1), 'retry');
  h.attempt.retryClaim();
  h.attempt.retryClaim();
  await flush();
  assert.equal(h.claims.length, 2);
  assert.deepEqual(h.claims[0], h.claims[1]);
  assert.equal(h.calls.length, 3, 'one intent and two attempts to claim it');
  assert.equal(h.displayed, 1);
  assert.equal(h.rewards.length, 1);
  assert.equal(h.phases.at(-1), 'done');
});

for (const failure of ['no-fill', 'unsupported', 'display-refused'] as const) {
  test(`${failure} releases attempt and never grants a reward`, async () => {
    const h = harness({ unsupported: failure === 'unsupported', visible: failure !== 'display-refused' });
    await h.attempt.start();
    if (failure === 'no-fill') h.emit('slotRenderEnded', { isEmpty: true });
    if (failure === 'display-refused') h.ready();
    assert.equal(h.claims.length, 0);
    assert.equal(h.rewards.length, 0);
    assert.equal(h.finished, 1);
    assert.equal(h.phases.at(-1), 'idle');
    assert.ok(h.errors.at(-1));
  });
}

test('blocked GPT times out; late queued callback cannot display or claim', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = harness({ queued: true, timeoutMs: 100 });
  await h.attempt.start();
  t.mock.timers.tick(100);
  h.flushQueue();
  assert.equal(h.displayed, 0);
  assert.equal(h.claims.length, 0);
  assert.equal(h.finished, 1);
  assert.equal(h.phases.at(-1), 'idle');
});

test('script error invalidates queued work and releases loading state', async () => {
  const h = harness({ queued: true });
  await h.attempt.start();
  h.attempt.failLoading('Script could not load.');
  h.flushQueue();
  assert.equal(h.displayed, 0);
  assert.equal(h.finished, 1);
  assert.equal(h.errors.at(-1), 'Script could not load.');
});

test('unmount while intent loads ignores its late response', async () => {
  let resolveIntent!: (result: typeof intent) => void;
  const pending = new Promise<typeof intent>((resolve) => { resolveIntent = resolve; });
  const h = harness({ request: async <T>() => await pending as T });
  const starting = h.attempt.start();
  h.attempt.cancel();
  resolveIntent(intent);
  await starting;
  assert.equal(h.displayed, 0);
  assert.equal(h.rewards.length, 0);
  assert.deepEqual(h.phases, ['loading']);
});

test('unmount during claim destroys slot and ignores late UI callbacks', async () => {
  let resolveClaim!: (result: typeof claim) => void;
  const pending = new Promise<typeof claim>((resolve) => { resolveClaim = resolve; });
  const h = harness({ request: async <T>(url: string) => (url.endsWith('/claim') ? await pending : intent) as T });
  await h.attempt.start();
  h.ready();
  h.emit('rewardedSlotGranted');
  h.attempt.cancel();
  resolveClaim(claim);
  await flush();
  assert.equal(h.destroyed, 1);
  assert.equal(h.rewards.length, 0);
  assert.equal(h.finished, 0);
});

test('claim timeout permits retry of earned reward without replaying the ad', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let claims = 0;
  const h = harness({ timeoutMs: 100, request: async <T>(url: string, _body: Record<string, unknown>, signal?: AbortSignal) => {
    if (!url.endsWith('/claim')) return intent as T;
    if (++claims > 1) return claim as T;
    return await new Promise<T>((_resolve, reject) => {
      signal!.addEventListener('abort', () => reject(new Error('Aborted')), { once: true });
    });
  } });
  await h.attempt.start();
  h.ready();
  h.emit('rewardedSlotGranted');
  h.emit('rewardedSlotClosed');
  t.mock.timers.tick(100);
  await flush();
  assert.equal(h.phases.at(-1), 'retry');
  h.attempt.retryClaim();
  await flush();
  assert.equal(h.phases.at(-1), 'done');
  assert.equal(h.rewards.length, 1);
  assert.equal(h.displayed, 1);
});
