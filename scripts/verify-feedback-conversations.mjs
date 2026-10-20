#!/usr/bin/env node
/**
 * Live feedback contract checks. Creates synthetic accounts and tickets; use a
 * disposable local database. No default host or credentials are supplied.
 *
 * Required: FEEDBACK_QA_BASE_URL, FEEDBACK_QA_OWNER_EMAIL,
 * FEEDBACK_QA_OTHER_EMAIL, FEEDBACK_QA_ADMIN_EMAIL, FEEDBACK_QA_PASSWORD.
 * Configure the app's ARCADE_ADMIN_EMAILS with FEEDBACK_QA_ADMIN_EMAIL before
 * starting it. Each email must be unused in the disposable database.
 */
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';

function required(name) {
  const value = process.env[name]?.trim();
  assert(value, `${name} must be supplied explicitly.`);
  return value;
}

const base = new URL(required('FEEDBACK_QA_BASE_URL'));
assert(
  ['http:', 'https:'].includes(base.protocol)
    && ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname)
    && !base.username && !base.password && !base.search && !base.hash
    && base.pathname === '/',
  'FEEDBACK_QA_BASE_URL must be a loopback HTTP(S) origin without credentials, path, query, or fragment.',
);
const emails = {
  owner: required('FEEDBACK_QA_OWNER_EMAIL'),
  other: required('FEEDBACK_QA_OTHER_EMAIL'),
  admin: required('FEEDBACK_QA_ADMIN_EMAIL'),
};
assert(new Set(Object.values(emails)).size === 3, 'Provide three distinct synthetic account emails.');
const password = required('FEEDBACK_QA_PASSWORD');
const runId = randomBytes(5).toString('hex');
const guestEmail = `qa-feedback-guest-${runId}@example.com`;
let checks = 0;

function pass(label) {
  checks += 1;
  console.log(`ok ${label}`);
}

async function request(path, { cookie, method = 'GET', json, raw } = {}) {
  const headers = { origin: base.origin };
  if (cookie) headers.cookie = cookie;
  if (json !== undefined || raw !== undefined) headers['content-type'] = 'application/json';
  const response = await fetch(new URL(path, base), {
    method,
    headers,
    body: raw ?? (json !== undefined ? JSON.stringify(json) : undefined),
    redirect: 'manual',
    signal: AbortSignal.timeout(30_000),
  });
  const text = await response.text();
  let data;
  try { data = JSON.parse(text); } catch { data = null; }
  return { response, data };
}

async function expect(path, options, status, label) {
  const result = await request(path, options);
  assert.equal(result.response.status, status, `${label}: unexpected HTTP status.`);
  assert(result.data && typeof result.data === 'object', `${label}: expected JSON.`);
  pass(label);
  return result;
}

function safePayload(value, scope = 'payload') {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    assert(![
      'email', 'contactEmail', 'userId', 'authorId', 'authorUserId', 'userAgent',
      'user_agent', 'statusUpdatedBy', 'dateKey', 'date_key',
    ].includes(key), `Player response exposes a private field: ${key}.`);
    if (key === 'adminNote') {
      assert(['entry', 'entries[]'].includes(scope), 'Legacy admin notes belong only to ticket entries.');
      assert(child === null || typeof child === 'string', 'Legacy admin note must be text or null.');
    }
    if (Array.isArray(child)) child.forEach((item) => safePayload(item, `${key}[]`));
    else safePayload(child, key);
  }
}

function commentShape(comment, expectedRole) {
  assert(comment && typeof comment.id === 'string', 'Comment must have an id.');
  assert.equal(comment.authorRole, expectedRole, 'Comment author role must come from its authenticated session.');
  assert.equal(typeof comment.authorName, 'string', 'Comment must have a display name.');
  assert.equal(typeof comment.message, 'string', 'Comment must preserve its message.');
  assert.equal(typeof comment.createdAt, 'number', 'Comment must have a numeric timestamp.');
  safePayload(comment);
}

async function register(role) {
  const username = `qafb_${role}_${runId}`;
  const { response, data } = await expect('/api/account/register', {
    method: 'POST', json: { email: emails[role], password, username },
  }, 200, `${role} fixture signup`);
  const cookie = response.headers.getSetCookie().map((line) => line.split(';')[0]).filter(Boolean).join('; ');
  assert(cookie, 'Signup must issue a session cookie.');
  assert.equal(typeof data.account?.id, 'string', 'Signup must return an account id.');
  return { cookie, id: data.account.id, username };
}

const owner = await register('owner');
const other = await register('other');
const admin = await register('admin');
await expect('/api/admin/feedback', { cookie: admin.cookie }, 200, 'admin fixture has admin access');
await expect('/api/admin/feedback', { cookie: owner.cookie }, 403, 'player cannot access admin feedback list');

const submitted = await expect('/api/feedback', {
  cookie: owner.cookie, method: 'POST', json: {
    category: 'bug', message: `QA conversation ${runId}: the scoreboard needs a second look.`,
    pagePath: '/feedback', contactEmail: guestEmail,
  },
}, 201, 'owner creates a ticket');
safePayload(submitted.data);
const ticketId = submitted.data.entry?.id;
assert.equal(typeof ticketId, 'string', 'Created ticket must have an id.');
const threadPath = `/api/feedback/${encodeURIComponent(ticketId)}`;
const playerReplyPath = `${threadPath}/comments`;
const adminReplyPath = `/api/admin/feedback/${encodeURIComponent(ticketId)}/comments`;
const reply = (cookie, message) => ({ cookie, method: 'POST', json: { message } });

await expect(threadPath, {}, 401, 'anonymous cannot read a ticket');
await expect(playerReplyPath, reply(null, 'Anonymous reply should fail.'), 401, 'anonymous cannot reply');
await expect(threadPath, { cookie: other.cookie }, 404, 'unrelated player cannot read a ticket');
await expect(playerReplyPath, reply(other.cookie, 'Unrelated reply should fail.'), 404, 'unrelated player cannot reply');
await expect(adminReplyPath, reply(owner.cookie, 'Pretend admin reply should fail.'), 403, 'player cannot use admin reply endpoint');
await expect(adminReplyPath, reply(null, 'Anonymous admin reply should fail.'), 401, 'anonymous cannot use admin reply endpoint');
const missingPath = '/api/feedback/00000000-0000-0000-0000-000000000000';
await expect(missingPath, { cookie: owner.cookie }, 404, 'unknown ticket stays hidden');

const ownerThread = await expect(threadPath, { cookie: owner.cookie }, 200, 'owner can read their ticket');
safePayload(ownerThread.data);
assert(Array.isArray(ownerThread.data.comments), 'Thread must include a comment array.');
assert.equal(typeof ownerThread.data.hasMore, 'boolean', 'Thread must report whether more comments exist.');
const adminThread = await expect(threadPath, { cookie: admin.cookie }, 200, 'admin can read a ticket');
assert(adminThread.data.contactEmail === emails.owner, 'Admin must see the stored account email, not a submitted override.');

for (const [label, payload] of [
  ['blank', { message: '   ' }],
  ['wrong message type', { message: 17 }],
  ['null message', { message: null }],
  ['missing message', {}],
  ['oversize message', { message: 'x'.repeat(3001) }],
  ['array body', []],
  ['null body', null],
]) {
  await expect(playerReplyPath, { cookie: owner.cookie, method: 'POST', json: payload }, 400, `reject ${label}`);
}
await expect(playerReplyPath, { cookie: owner.cookie, method: 'POST', raw: '{' }, 400, 'reject malformed JSON');
await expect(playerReplyPath, { cookie: owner.cookie, method: 'POST', json: { message: 'x'.repeat(17_000) } }, 413, 'reject oversized request');

const firstReply = await expect(playerReplyPath, reply(owner.cookie, 'Here is a reproducible example from my last run.'), 201, 'owner adds a comment');
commentShape(firstReply.data.comment, 'player');
safePayload(firstReply.data);
const forged = await request(playerReplyPath, {
  cookie: owner.cookie, method: 'POST', json: {
    message: 'This author must still be the authenticated player.',
    authorRole: 'admin', authorName: admin.username, authorUserId: admin.id,
    userId: other.id, email: emails.admin,
  },
});
assert.equal(forged.response.status, 400, 'Forged author fields must be rejected.');
pass('comment author fields cannot be forged');

const staffReply = await expect(adminReplyPath, reply(admin.cookie, 'Thanks for the details. We can follow up directly in this ticket.'), 201, 'admin replies in the ticket');
commentShape(staffReply.data.comment, 'admin');
const roundtrip = await expect(threadPath, { cookie: owner.cookie }, 200, 'owner receives persisted conversation');
safePayload(roundtrip.data);
const commentIds = roundtrip.data.comments.map((comment) => comment.id);
assert(commentIds.includes(firstReply.data.comment.id), 'Persisted thread must include owner comment.');
assert(commentIds.includes(staffReply.data.comment.id), 'Persisted thread must include admin comment.');
assert(commentIds.indexOf(firstReply.data.comment.id) < commentIds.indexOf(staffReply.data.comment.id), 'Conversation must present comments chronologically.');
for (let index = 1; index < roundtrip.data.comments.length; index += 1) {
  assert(roundtrip.data.comments[index - 1].createdAt <= roundtrip.data.comments[index].createdAt, 'Comment timestamps must be chronological.');
}

const ownerList = await expect('/api/feedback', { cookie: owner.cookie }, 200, 'owner list returns their ticket');
safePayload(ownerList.data);
assert(ownerList.data.entries.some((entry) => entry.id === ticketId), 'Owner list must include their ticket.');
const otherList = await expect('/api/feedback', { cookie: other.cookie }, 200, 'unrelated player list excludes ticket');
safePayload(otherList.data);
assert(!otherList.data.entries.some((entry) => entry.id === ticketId), 'Other account must not receive ticket.');

const notificationHref = `/feedback/${ticketId}`;
const alerts = await expect('/api/notifications', { cookie: owner.cookie }, 200, 'owner notification list loads');
assert(alerts.data.notifications.some((notification) => notification.href === notificationHref), 'Admin reply must notify the ticket owner.');
const otherAlerts = await expect('/api/notifications', { cookie: other.cookie }, 200, 'unrelated notification list loads');
assert(!otherAlerts.data.notifications.some((notification) => notification.href === notificationHref), 'Unrelated account must not receive ticket notification.');

const guest = await expect('/api/feedback', {
  method: 'POST', json: { category: 'account', message: `Guest contact request ${runId}: please help with this question.`, contactEmail: guestEmail },
}, 201, 'guest may submit an email contact request');
safePayload(guest.data);
const guestPath = `/api/feedback/${encodeURIComponent(guest.data.entry.id)}`;
await expect(guestPath, { cookie: owner.cookie }, 404, 'signed-in account cannot claim a guest ticket');
const guestForAdmin = await expect(guestPath, { cookie: admin.cookie }, 200, 'admin can read guest ticket');
assert(guestForAdmin.data.contactEmail === guestEmail, 'Admin must see the guest contact email.');
const anonymousList = await expect('/api/feedback', {}, 200, 'anonymous list does not reveal guest tickets');
assert(Array.isArray(anonymousList.data.entries) && anonymousList.data.entries.length === 0, 'Anonymous feedback list must be empty.');
safePayload(anonymousList.data);

const legacyNote = 'Staff response submitted through the previous feedback update interface.';
await expect('/api/admin/feedback', {
  cookie: admin.cookie, method: 'PATCH', json: { id: ticketId, status: 'open', adminNote: legacyNote },
}, 200, 'legacy note remains compatible');
const legacyThread = await expect(threadPath, { cookie: owner.cookie }, 200, 'owner can still read earlier staff response');
safePayload(legacyThread.data);
const legacyComment = legacyThread.data.comments.find((comment) => comment.message === legacyNote);
assert(legacyComment, 'Legacy update interface must append the response to the conversation.');
commentShape(legacyComment, 'admin');

const closed = await expect('/api/admin/feedback', {
  cookie: admin.cookie, method: 'PATCH', json: { id: ticketId, status: 'resolved' },
}, 200, 'admin resolves a ticket');
assert.equal(closed.data.entry.status, 'resolved', 'Resolve must persist status.');
await expect(playerReplyPath, reply(owner.cookie, 'This closed reply must fail.'), 409, 'resolved ticket refuses owner reply');
await expect(adminReplyPath, reply(admin.cookie, 'This closed admin reply must fail.'), 409, 'resolved ticket refuses admin reply');
const closedThread = await expect(threadPath, { cookie: owner.cookie }, 200, 'resolved conversation remains readable');
safePayload(closedThread.data);
assert.equal(closedThread.data.entry.status, 'resolved', 'Owner must see resolved status.');
assert(closedThread.data.comments.some((comment) => comment.id === legacyComment.id), 'Status changes must preserve earlier staff response.');
await expect('/api/admin/feedback', { cookie: admin.cookie, method: 'PATCH', json: { id: ticketId, status: 'open' } }, 200, 'admin reopens a ticket');
const reopenedReply = await expect(playerReplyPath, reply(owner.cookie, 'Thank you, this reopened conversation accepts my follow-up.'), 201, 'reopened ticket accepts a reply');
commentShape(reopenedReply.data.comment, 'player');
safePayload(reopenedReply.data);

await expect('/api/admin/feedback', { cookie: admin.cookie, method: 'PATCH', json: { id: ticketId, status: 'dismissed' } }, 200, 'legacy dismissed status remains compatible');
await expect(playerReplyPath, reply(owner.cookie, 'This legacy closed reply must fail.'), 409, 'legacy dismissed ticket refuses owner reply');
await expect(adminReplyPath, reply(admin.cookie, 'This legacy closed admin reply must fail.'), 409, 'legacy dismissed ticket refuses admin reply');
await expect('/api/admin/feedback', { cookie: admin.cookie, method: 'PATCH', json: { id: ticketId, status: 'open' } }, 200, 'legacy dismissed ticket can reopen');

console.log(`Feedback conversation checks passed (${checks} HTTP checks). Dispose of the local fixture database after verification.`);
