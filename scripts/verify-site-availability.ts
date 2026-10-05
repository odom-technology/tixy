import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import {
  DEFAULT_SITE_AVAILABILITY,
  SITE_SECTIONS,
  getGameRestriction,
  getPathRestriction,
  normalizeSiteAvailabilityConfig,
  validateSiteAvailabilityConfig,
  type SiteAvailabilityConfig,
  type SiteSectionId,
} from '../src/lib/site-availability';

// This check edits live site controls. Require the disposable local QA setup.
const baseValue = process.env.QA_BASE_URL;
const qaEmail = process.env.QA_SMOKE_EMAIL;
const qaPassword = process.env.QA_SMOKE_PASSWORD;
const databaseValue = process.env.DATABASE_URL;
if (!baseValue || !qaEmail || !qaPassword || !databaseValue) {
  throw new Error('QA_BASE_URL, QA_SMOKE_EMAIL, QA_SMOKE_PASSWORD, and DATABASE_URL are required.');
}
const base = new URL(baseValue);
const database = new URL(databaseValue);
const loopback = (host: string) => ['127.0.0.1', 'localhost', '[::1]'].includes(host);
if (
  base.protocol !== 'http:' || !loopback(base.hostname) || base.pathname !== '/' ||
  !['postgres:', 'postgresql:'].includes(database.protocol) || !loopback(database.hostname) ||
  !(process.env.CI === 'true' || process.env.QA_SITE_AVAILABILITY_ISOLATED === 'true') ||
  !(database.pathname === '/arcade' && process.env.CI === 'true') &&
    !/^\/arcade[_-](?:availability|test|ci)(?:[_-].*)?$/.test(database.pathname)
) {
  throw new Error('Availability QA only runs against an HTTP loopback app and disposable local CI/test database.');
}
if (!(process.env.ARCADE_ADMIN_EMAILS ?? '').split(',').map((value) => value.trim().toLowerCase()).includes(qaEmail.toLowerCase())) {
  throw new Error('QA_SMOKE_EMAIL must be listed in ARCADE_ADMIN_EMAILS for the isolated test app.');
}
const baseUrl = base.origin;

type AvailabilityDetails = { config: SiteAvailabilityConfig; updatedAt: number | null };
type SettingsResponse = { siteAvailability: AvailabilityDetails };

function checkPurePolicy() {
  assert.deepEqual(normalizeSiteAvailabilityConfig(null), DEFAULT_SITE_AVAILABILITY);
  assert.deepEqual(validateSiteAvailabilityConfig(DEFAULT_SITE_AVAILABILITY), DEFAULT_SITE_AVAILABILITY);
  assert.equal(SITE_SECTIONS.length, 6);
  const normalized = normalizeSiteAvailabilityConfig({
    sections: { games: false },
    disabledGames: ['reaction-time', 'reaction-time', 'unknown'],
    message: '  Temporarily closed  ',
  });
  assert.equal(normalized.sections.games, false);
  assert.equal(normalized.sections.store, true);
  assert.deepEqual(normalized.disabledGames, ['reaction-time']);
  assert.equal(normalized.message, 'Temporarily closed');
  assert.throws(() => validateSiteAvailabilityConfig({ ...DEFAULT_SITE_AVAILABILITY, disabledGames: ['unknown'] }));
  assert.throws(() => validateSiteAvailabilityConfig({ ...DEFAULT_SITE_AVAILABILITY, sections: { games: true } }));
  assert.throws(() => validateSiteAvailabilityConfig({ ...DEFAULT_SITE_AVAILABILITY, message: 'x'.repeat(1201) }));

  const paused = {
    ...DEFAULT_SITE_AVAILABILITY,
    sections: Object.fromEntries(SITE_SECTIONS.map(({ id }) => [id, false])) as SiteAvailabilityConfig['sections'],
    registrationEnabled: false,
    ticketBundlesEnabled: false,
    disabledGames: ['21'],
  };
  assert.equal(getGameRestriction(paused, 'arcade-blackjack')?.id, '21');
  const sectionRoutes: Array<[SiteSectionId, string, string]> = [
    ['games', '/reaction-time', '/api/games/pangram/puzzle'],
    ['store', '/store', '/api/store'],
    ['social', '/social', '/api/social/bootstrap'],
    ['leaderboards', '/leaderboard', '/api/leaderboard/account-level'],
    ['tour', '/tour', '/api/games/arcade-tour'],
    ['seasonPass', '/battlepass', '/api/battlepass'],
  ];
  for (const [id, page, api] of sectionRoutes) {
    const config = {
      ...DEFAULT_SITE_AVAILABILITY,
      sections: { ...DEFAULT_SITE_AVAILABILITY.sections, [id]: false },
    };
    assert.ok(getPathRestriction(config, page), `${id} page must pause`);
    assert.ok(getPathRestriction(config, api), `${id} API must pause`);
  }
  for (const slug of ['pangram', 'word-grid', 'connections']) {
    const config = { ...DEFAULT_SITE_AVAILABILITY, disabledGames: [slug] };
    assert.equal(getPathRestriction(config, `/api/games/${slug}/puzzle`)?.id, slug);
    assert.equal(getPathRestriction(config, `/api/games/${slug}/leaderboard`), null);
  }
  assert.equal(getPathRestriction(paused, '/api/games/multiplayer/session/existing'), null);
  assert.equal(getPathRestriction(paused, '/api/store/ticket-packs')?.id, 'ticketBundles');
  assert.equal(getPathRestriction(paused, '/api/account/register')?.id, 'registration');
  for (const path of [
    '/admin/site-settings', '/api/admin/site-settings', '/api/stripe/webhook',
    '/api/cron/example', '/signin', '/recover', '/api/account/session',
    '/api/account/recover', '/api/store/inventory', '/api/store/equip',
    '/api/wagers/settle', '/api/wagers/action',
  ]) {
    assert.equal(getPathRestriction(paused, path), null, `${path} must stay reachable`);
  }
  console.log('✓ pure defaults, normalization, validation, aliases, and policy exemptions');
}

async function request(path: string, options: RequestInit = {}, cookie?: string) {
  const headers = new Headers(options.headers);
  if (cookie) headers.set('cookie', cookie);
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers,
    redirect: 'manual',
    signal: AbortSignal.timeout(20_000),
  });
  return response;
}

function jsonBody(value: unknown): RequestInit {
  return { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(value) };
}

function cookieFrom(response: Response) {
  const token = response.headers.getSetCookie().find((header) => header.startsWith('arcade_session='));
  assert.ok(token, 'session cookie missing');
  return token.split(';', 1)[0];
}

async function expectStatus(label: string, response: Response, status: number) {
  assert.equal(response.status, status, `${label}: expected HTTP ${status}, got ${response.status}`);
  console.log(`✓ ${label}`);
  return response;
}

async function settings(cookie: string): Promise<AvailabilityDetails> {
  const response = await expectStatus('admin settings GET', await request('/api/admin/site-settings', {}, cookie), 200);
  const payload = await response.json() as SettingsResponse;
  assert.ok(payload.siteAvailability?.config, 'availability details missing');
  return payload.siteAvailability;
}

async function patchAvailability(cookie: string, details: AvailabilityDetails, next: SiteAvailabilityConfig) {
  const response = await request('/api/admin/site-settings', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ siteAvailability: next, siteAvailabilityUpdatedAt: details.updatedAt }),
  }, cookie);
  assert.equal(response.status, 200, `availability PATCH returned HTTP ${response.status}`);
  const payload = await response.json() as SettingsResponse;
  assert.deepEqual(payload.siteAvailability.config, normalizeSiteAvailabilityConfig(next));
  return payload.siteAvailability;
}

async function runHttpPolicy() {
  const login = await expectStatus('QA admin login', await request('/api/account/session', jsonBody({ emailOrUsername: qaEmail, password: qaPassword })), 200);
  const adminCookie = cookieFrom(login);
  const original = await settings(adminCookie);
  assert.deepEqual(original.config, DEFAULT_SITE_AVAILABILITY, 'isolated CI site must start fully open');
  let current = original;
  try {
    const suffix = randomUUID().slice(0, 8);
    const playerEmail = `qa-availability-${suffix}@example.com`;
    const player = await expectStatus('create isolated player', await request('/api/account/register', jsonBody({
      email: playerEmail, username: `qa-av-${suffix}`, password: qaPassword,
    })), 200);
    const playerCookie = cookieFrom(player);

    await expectStatus('guest admin GET rejected', await request('/api/admin/site-settings'), 401);
    await expectStatus('guest admin PATCH rejected', await request('/api/admin/site-settings', {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ siteAvailability: original.config }),
    }), 401);
    await expectStatus('player admin GET rejected', await request('/api/admin/site-settings', {}, playerCookie), 403);
    await expectStatus('player admin PATCH rejected', await request('/api/admin/site-settings', {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ siteAvailability: original.config }),
    }, playerCookie), 403);

    await expectStatus('invalid availability rejected', await request('/api/admin/site-settings', {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ siteAvailability: { ...original.config, disabledGames: ['unknown-game'] }, siteAvailabilityUpdatedAt: current.updatedAt }),
    }, adminCookie), 400);
    await expectStatus('missing availability version rejected', await request('/api/admin/site-settings', {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ siteAvailability: original.config }),
    }, adminCookie), 400);
    assert.deepEqual((await settings(adminCookie)).config, original.config, 'invalid PATCH must not change settings');

    const sectionCases: Array<[SiteSectionId, string, string]> = [
      ['games', '/reaction-time', '/api/games/pangram/puzzle'],
      ['store', '/store', '/api/store'],
      ['social', '/social', '/api/social/bootstrap'],
      ['leaderboards', '/leaderboard', '/api/leaderboard/account-level'],
      ['tour', '/tour', '/api/games/arcade-tour'],
      ['seasonPass', '/battlepass', '/api/battlepass'],
    ];
    for (const [id, page, api] of sectionCases) {
      current = await patchAvailability(adminCookie, current, {
        ...current.config, sections: { ...current.config.sections, [id]: false },
      });
      await expectStatus(`${id} page paused`, await request(page), 503);
      await expectStatus(`${id} API paused`, await request(api), 503);
      current = await patchAvailability(adminCookie, current, {
        ...current.config, sections: { ...current.config.sections, [id]: true },
      });
    }

    current = await patchAvailability(adminCookie, current, {
      ...current.config, sections: { ...current.config.sections, store: false },
    });
    await expectStatus('stale availability version rejected', await request('/api/admin/site-settings', {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ siteAvailability: original.config, siteAvailabilityUpdatedAt: original.updatedAt }),
    }, adminCookie), 409);
    assert.deepEqual((await settings(adminCookie)).config, current.config, 'stale PATCH must not overwrite newer settings');
    const storePage = await expectStatus('closed store page', await request('/store'), 503);
    assert.match(await storePage.text(), /temporarily unavailable|taking a break/i);
    const storeApi = await expectStatus('closed store API', await request('/api/store'), 503);
    assert.equal((await storeApi.json() as { unavailable?: string }).unavailable, 'store');
    const inventory = await request('/api/store/inventory', {}, adminCookie);
    assert.notEqual(inventory.status, 503, 'existing inventory remains reachable');
    console.log('✓ existing inventory remains reachable');

    current = await patchAvailability(adminCookie, current, {
      ...current.config, sections: { ...current.config.sections, store: true }, ticketBundlesEnabled: false,
    });
    const storeWithBundlesOff = await expectStatus('store remains open without ticket bundles', await request('/store'), 200);
    const storeHtml = await storeWithBundlesOff.text();
    assert.match(storeHtml, /Optional ad reward/i, 'store should render its non-bundle state');
    assert.doesNotMatch(storeHtml, />Ticket bundles</i, 'bundle purchase section should be absent');
    await expectStatus('ticket pack list hidden', await request('/api/store/ticket-packs'), 503);
    await expectStatus('ticket checkout blocked before Stripe', await request('/api/store/ticket-packs/checkout', jsonBody({})), 503);

    current = await patchAvailability(adminCookie, current, {
      ...current.config, ticketBundlesEnabled: true, registrationEnabled: false,
    });
    const signup = await expectStatus('closed signup page still explains status', await request('/signup'), 200);
    assert.match(await signup.text(), /registration is temporarily unavailable/i);
    await expectStatus('registration API blocked', await request('/api/account/register', jsonBody({})), 503);
    await expectStatus('sign-in remains open', await request('/signin'), 200);
    await expectStatus('account recovery remains open', await request('/recover'), 200);

    current = await patchAvailability(adminCookie, current, {
      ...current.config, registrationEnabled: true, disabledGames: ['reaction-time', '21', 'pangram', 'word-grid', 'connections'],
    });
    const reactionPage = await expectStatus('paused reaction-time page', await request('/reaction-time'), 503);
    assert.match(await reactionPage.text(), /taking a break/i);
    await expectStatus('paused shared game session start', await request('/api/games/session', jsonBody({ gameType: 'reaction-time' }), adminCookie), 503);
    await expectStatus('paused 21 page', await request('/21'), 503);
    await expectStatus('blackjack alias blocks new wager before hold', await request('/api/wagers/session', jsonBody({ gameType: 'arcade-blackjack', wager: 0 }), adminCookie), 503);
    for (const slug of ['pangram', 'word-grid', 'connections']) {
      await expectStatus(`paused ${slug} puzzle API`, await request(`/api/games/${slug}/puzzle`), 503);
    }
    const existingTable = await request('/api/games/multiplayer/session/qa-no-table', {}, adminCookie);
    assert.equal(existingTable.status, 404, 'existing match polling API remains reachable');
    console.log('✓ existing match polling API remains reachable');
    const settlement = await request('/api/wagers/settle', jsonBody({}), adminCookie);
    assert.notEqual(settlement.status, 503, 'existing wager settlement must remain reachable');
    assert.equal(settlement.status, 400, 'invalid no-token settlement should be safely rejected');
    console.log('✓ existing wager settlement route remains reachable');
  } finally {
    // Re-read the current version before restoring; a failed assertion must not leave CI closed.
    const latest = await settings(adminCookie);
    if (JSON.stringify(latest.config) !== JSON.stringify(original.config)) {
      current = await patchAvailability(adminCookie, latest, original.config);
    }
    assert.deepEqual(current.config, original.config, 'initial availability must be restored');
    console.log('✓ initial availability restored');
  }
}

checkPurePolicy();
await runHttpPolicy();
