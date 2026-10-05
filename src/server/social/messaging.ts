// ---------------------------------------------------------------------------
// Unified messaging backend. Serves 1:1 friend DMs AND per-match chat through
// one conversation/message model. Match-chat routes adapt onto this (preserving
// their legacy wire shape); DMs use the /api/messages routes.
//
// Realtime: postMessage publishes a NOTICE only (no body) to the dm channel and
// each recipient's user inbox; clients re-fetch the auth-gated endpoint. This is
// the chess "notice + re-fetch" pattern (the pool route used to leak full bodies).
// ---------------------------------------------------------------------------
import { randomUUID } from 'node:crypto';

import { getAccountsByIds } from '@/server/accounts';
import { areArcadeFriends, sortFriendPair } from '@/server/arcade/multiplayer';
import { query, queryOne, withTransaction } from '@/server/db/client';
import { broadcast } from '@/server/events';
import { isUserOnline } from '@/server/realtime/pubsub';
import { createNotification } from '@/server/services/notifications';
import { isBlocked } from '@/server/social/blocks';

export type ConversationKind = 'dm' | 'match' | 'channel';
export type MessageType = 'text' | 'reaction' | 'system';

export const MAX_MESSAGE_LENGTH = 200;
const SEND_MIN_INTERVAL_MS = 500;
const DEFAULT_REACTIONS = ['👍', '😂', '😮', '🔥', '😭', '💀', '🤝', '❤️'];

export type ArcadeMessage = {
  id: string;
  conversationId: string;
  senderUserId: string;
  senderName: string;
  type: MessageType;
  content: string;
  createdAt: number;
  deletedAt: number | null;
  senderImageUrl?: string | null;
};

export type ConversationSummary = {
  id: string;
  kind: ConversationKind;
  gameType: string | null;
  otherMembers: Array<{ userId: string; name: string; imageUrl: string | null }>;
  lastMessage: ArcadeMessage | null;
  unreadCount: number;
  muted: boolean;
  updatedAt: number;
};

// Single shape (not a discriminated union): this repo runs strict:false, where
// `!result.ok` does not narrow union arms, so every field lives on one type.
export type PostMessageResult = {
  ok: boolean;
  message?: ArcadeMessage;
  status?: 400 | 403 | 429;
  error?: string;
  retryAfterMs?: number;
};

type MessageRow = {
  id: string;
  conversation_id: string;
  sender_user_id: string;
  sender_name: string;
  type: string;
  content: string;
  created_at: string | number;
  deleted_at?: string | number | null;
};

// Cheap in-memory first-gate for the per-user send rate limit (single server process).
const lastSendAt = new Map<string, number>();

function rowToMessage(row: MessageRow): ArcadeMessage {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    senderUserId: row.sender_user_id,
    senderName: row.sender_name,
    type: row.type as MessageType,
    content: row.deleted_at == null ? row.content : 'Message removed',
    createdAt: Number(row.created_at),
    deletedAt: row.deleted_at == null ? null : Number(row.deleted_at),
  };
}

export const ARCADE_LOBBY_CONVERSATION_ID = 'arcade-lobby';

function dmContextRef(a: string, b: string): string {
  const [x, y] = sortFriendPair(a, b);
  return `${x}__${y}`;
}

export async function getConversation(conversationId: string) {
  return queryOne<{ id: string; kind: ConversationKind; context_ref: string | null; game_type: string | null }>(
    `SELECT id, kind, context_ref, game_type FROM arcade_conversations WHERE id = $1`,
    [conversationId],
  );
}

/** Existing match conversation id, or null — used by GET polls so they don't upsert. */
export async function findMatchConversationId(matchId: string, gameType: string): Promise<string | null> {
  const row = await queryOne<{ id: string }>(
    `SELECT id FROM arcade_conversations WHERE kind = 'match' AND game_type = $1 AND context_ref = $2`,
    [gameType, matchId],
  );
  return row?.id ?? null;
}

export async function isConversationMember(conversationId: string, userId: string): Promise<boolean> {
  const row = await queryOne(
    `SELECT 1 FROM arcade_conversation_members WHERE conversation_id = $1 AND user_id = $2 LIMIT 1`,
    [conversationId, userId],
  );
  return row !== null;
}

/** Membership check scoped to DM conversations only — keeps the /api/messages
 *  endpoints off match-chat rows in one query. */
export async function isDmMember(conversationId: string, userId: string): Promise<boolean> {
  const row = await queryOne(
    `SELECT 1 FROM arcade_conversation_members m
     JOIN arcade_conversations c ON c.id = m.conversation_id
     WHERE m.conversation_id = $1 AND m.user_id = $2 AND c.kind = 'dm'
     LIMIT 1`,
    [conversationId, userId],
  );
  return row !== null;
}

async function listMemberIds(conversationId: string): Promise<string[]> {
  const result = await query<{ user_id: string }>(
    `SELECT user_id FROM arcade_conversation_members WHERE conversation_id = $1`,
    [conversationId],
  );
  return result.rows.map((row) => row.user_id);
}

async function isMemberMuted(conversationId: string, userId: string): Promise<boolean> {
  const row = await queryOne<{ muted: boolean }>(
    `SELECT muted FROM arcade_conversation_members WHERE conversation_id = $1 AND user_id = $2`,
    [conversationId, userId],
  );
  return row?.muted === true;
}

/** Deterministic 1:1 conversation for a friend pair (one row per pair). */
export async function getOrCreateDmConversation(
  userA: string,
  userB: string,
): Promise<{ id: string; created: boolean }> {
  if (userA === userB) throw new Error('Cannot start a conversation with yourself.');
  const ref = dmContextRef(userA, userB);
  const now = Date.now();

  return withTransaction(async (client) => {
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO arcade_conversations (id, kind, context_ref, game_type, created_by, created_at, updated_at)
       VALUES ($1, 'dm', $2, NULL, $3, $4, $4)
       ON CONFLICT (kind, COALESCE(game_type, ''), context_ref) DO NOTHING
       RETURNING id`,
      [randomUUID(), ref, userA, now],
    );

    let conversationId: string;
    let created = false;
    if (inserted.rows[0]) {
      conversationId = inserted.rows[0].id;
      created = true;
    } else {
      const existing = await client.query<{ id: string }>(
        `SELECT id FROM arcade_conversations WHERE kind = 'dm' AND context_ref = $1`,
        [ref],
      );
      conversationId = existing.rows[0].id;
    }

    for (const userId of [userA, userB]) {
      await client.query(
        `INSERT INTO arcade_conversation_members (conversation_id, user_id, role, joined_at)
         VALUES ($1, $2, 'member', $3)
         ON CONFLICT (conversation_id, user_id) DO NOTHING`,
        [conversationId, userId, now],
      );
    }
    return { id: conversationId, created };
  });
}

/** Conversation for a match (keyed by matchId + gameType), seeding human players. */
export async function getOrCreateMatchConversation(input: {
  matchId: string;
  gameType: string;
  participantIds: string[];
}): Promise<{ id: string; created: boolean }> {
  const now = Date.now();
  return withTransaction(async (client) => {
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO arcade_conversations (id, kind, context_ref, game_type, created_by, created_at, updated_at)
       VALUES ($1, 'match', $2, $3, NULL, $4, $4)
       ON CONFLICT (kind, COALESCE(game_type, ''), context_ref) DO NOTHING
       RETURNING id`,
      [randomUUID(), input.matchId, input.gameType, now],
    );

    let conversationId: string;
    let created = false;
    if (inserted.rows[0]) {
      conversationId = inserted.rows[0].id;
      created = true;
    } else {
      const existing = await client.query<{ id: string }>(
        `SELECT id FROM arcade_conversations WHERE kind = 'match' AND game_type = $1 AND context_ref = $2`,
        [input.gameType, input.matchId],
      );
      conversationId = existing.rows[0].id;
    }

    for (const participantId of input.participantIds) {
      await client.query(
        `INSERT INTO arcade_conversation_members (conversation_id, user_id, role, joined_at)
         VALUES ($1, $2, 'member', $3)
         ON CONFLICT (conversation_id, user_id) DO NOTHING`,
        [conversationId, participantId, now],
      );
    }
    return { id: conversationId, created };
  });
}

/** Central write path: validate, rate-limit, block-gate (dm), persist, publish, notify. */
export async function postMessage(input: {
  conversationId: string;
  senderUserId: string;
  senderName: string;
  type: Exclude<MessageType, 'system'>;
  content: string;
  reactionSet?: string[];
  notify?: boolean;
}): Promise<PostMessageResult> {
  const now = Date.now();
  const content = input.content.trim();

  if (!content) return { ok: false, status: 400, error: 'Message is empty.' };
  if (input.type === 'text' && content.length > MAX_MESSAGE_LENGTH) {
    return { ok: false, status: 400, error: `Messages are limited to ${MAX_MESSAGE_LENGTH} characters.` };
  }
  if (input.type === 'reaction') {
    const set = input.reactionSet ?? DEFAULT_REACTIONS;
    if (!set.includes(content)) return { ok: false, status: 400, error: 'Unsupported reaction.' };
  }

  const conversation = await getConversation(input.conversationId);
  if (!conversation) return { ok: false, status: 400, error: 'Conversation not found.' };

  const minimumInterval = conversation.kind === 'channel' ? 2_500 : SEND_MIN_INTERVAL_MS;
  const last = lastSendAt.get(input.senderUserId) ?? 0;
  if (now - last < minimumInterval) {
    return {
      ok: false,
      status: 429,
      error: conversation.kind === 'channel' ? 'Lobby slow mode is active.' : 'You are sending messages too quickly.',
      retryAfterMs: minimumInterval - (now - last),
    };
  }
  if (conversation.kind === 'channel' && /(?:https?:\/\/|www\.)/i.test(content)) {
    return { ok: false, status: 400, error: 'Links are not allowed in the tixy Lobby.' };
  }

  const memberIds = await listMemberIds(input.conversationId);
  const recipientIds = memberIds.filter((id) => id !== input.senderUserId);

  if (conversation.kind === 'dm') {
    for (const recipient of recipientIds) {
      if (await isBlocked(input.senderUserId, recipient)) {
        return { ok: false, status: 403, error: 'You cannot message this user.' };
      }
      // Re-check friendship on every send: an existing DM must not survive an unfriend.
      if (!(await areArcadeFriends(input.senderUserId, recipient))) {
        return { ok: false, status: 403, error: 'You can only message friends.' };
      }
    }
  }

  lastSendAt.set(input.senderUserId, now);

  const message: ArcadeMessage = {
    id: randomUUID(),
    conversationId: input.conversationId,
    senderUserId: input.senderUserId,
    senderName: input.senderName,
    type: input.type,
    content,
    createdAt: now,
    deletedAt: null,
  };

  await query(
    `INSERT INTO arcade_messages (id, conversation_id, sender_user_id, sender_name, type, content, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [message.id, message.conversationId, message.senderUserId, message.senderName, message.type, message.content, message.createdAt],
  );
  await query(
    `UPDATE arcade_conversations SET updated_at = $2, last_message_at = $2, last_message_id = $3 WHERE id = $1`,
    [input.conversationId, now, message.id],
  );

  // Notice-only fan-out (no body) → recipients re-fetch the auth-gated endpoint.
  // Only DMs target recipient inboxes (user:{id}); match chat drives its own
  // legacy channel from the adapter, so it must not bump anyone's DM badge.
  const inboxTopics = conversation.kind === 'dm' ? recipientIds.map((id) => `user:${id}`) : [];
  broadcast(
    [conversation.kind === 'channel' ? 'social:lobby' : `dm:${input.conversationId}`, ...inboxTopics],
    {
      type: 'message_updated',
      conversationId: input.conversationId,
      kind: conversation.kind,
      senderUserId: input.senderUserId,
      gameType: conversation.game_type,
      matchId: conversation.kind === 'match' ? conversation.context_ref : undefined,
    },
  );

  // Notify offline DM recipients (best-effort; live recipients get the notice).
  if (conversation.kind === 'dm' && (input.notify ?? true)) {
    const preview = message.type === 'reaction' ? message.content : message.content.slice(0, 80);
    for (const recipient of recipientIds) {
      if (isUserOnline(recipient)) continue;
      if (await isMemberMuted(input.conversationId, recipient)) continue;
      try {
        await createNotification({
          userId: recipient,
          type: 'new_message',
          title: 'New message',
          body: `${message.senderName}: ${preview}`,
          href: `/social?view=dm&c=${input.conversationId}`,
          preferenceKey: 'game_notifications',
        });
      } catch {
        // best-effort
      }
    }
  }

  return { ok: true, message };
}

export async function listMessages(input: {
  conversationId: string;
  before?: number;
  since?: number;
  limit?: number;
}): Promise<ArcadeMessage[]> {
  const limit = Math.min(Math.max(input.limit ?? 100, 1), 200);
  const clauses = ['conversation_id = $1'];
  const params: unknown[] = [input.conversationId];
  if (typeof input.before === 'number') {
    params.push(input.before);
    clauses.push(`created_at < $${params.length}`);
  }
  if (typeof input.since === 'number') {
    params.push(input.since);
    clauses.push(`created_at >= $${params.length}`);
  }
  params.push(limit);
  const result = await query<MessageRow>(
    `SELECT id, conversation_id, sender_user_id, sender_name, type, content, created_at, deleted_at
     FROM arcade_messages
     WHERE ${clauses.join(' AND ')}
     ORDER BY created_at DESC
     LIMIT $${params.length}`,
    params,
  );
  return result.rows.map(rowToMessage).reverse();
}

export async function markRead(conversationId: string, userId: string): Promise<void> {
  await query(
    `UPDATE arcade_conversation_members SET last_read_at = $3
     WHERE conversation_id = $1 AND user_id = $2`,
    [conversationId, userId, Date.now()],
  );
}

export async function listConversationsForUser(userId: string): Promise<ConversationSummary[]> {
  const conversations = await query<{
    id: string;
    kind: ConversationKind;
    game_type: string | null;
    updated_at: string | number;
    last_message_id: string | null;
    muted: boolean;
  }>(
    `SELECT c.id, c.kind, c.game_type, c.updated_at, c.last_message_id, m.muted
     FROM arcade_conversation_members m
     JOIN arcade_conversations c ON c.id = m.conversation_id
     WHERE m.user_id = $1 AND c.kind = 'dm'
     ORDER BY c.updated_at DESC
     LIMIT 100`,
    [userId],
  );
  if (conversations.rows.length === 0) return [];

  const conversationIds = conversations.rows.map((row) => row.id);

  const otherMembers = await query<{ conversation_id: string; user_id: string }>(
    `SELECT conversation_id, user_id FROM arcade_conversation_members
     WHERE conversation_id = ANY($1::text[]) AND user_id <> $2`,
    [conversationIds, userId],
  );
  const otherIdsByConvo = new Map<string, string[]>();
  for (const row of otherMembers.rows) {
    const list = otherIdsByConvo.get(row.conversation_id) ?? [];
    list.push(row.user_id);
    otherIdsByConvo.set(row.conversation_id, list);
  }

  const accounts = await getAccountsByIds([...new Set(otherMembers.rows.map((row) => row.user_id))]);
  const accountById = new Map(accounts.map((account) => [account.id, account]));

  const lastMessageIds = conversations.rows.map((row) => row.last_message_id).filter((id): id is string => Boolean(id));
  const lastMessages = lastMessageIds.length
    ? await query<MessageRow>(
        `SELECT id, conversation_id, sender_user_id, sender_name, type, content, created_at, deleted_at
         FROM arcade_messages WHERE id = ANY($1::text[])`,
        [lastMessageIds],
      )
    : { rows: [] as MessageRow[] };
  const lastMessageById = new Map(lastMessages.rows.map((row) => [row.id, rowToMessage(row)]));

  const unread = await query<{ conversation_id: string; cnt: string | number }>(
    `SELECT msg.conversation_id, COUNT(*)::int AS cnt
     FROM arcade_messages msg
     JOIN arcade_conversation_members mem
       ON mem.conversation_id = msg.conversation_id AND mem.user_id = $2
     WHERE msg.conversation_id = ANY($1::text[])
       AND msg.created_at > mem.last_read_at
       AND msg.sender_user_id <> $2
     GROUP BY msg.conversation_id`,
    [conversationIds, userId],
  );
  const unreadByConvo = new Map(unread.rows.map((row) => [row.conversation_id, Number(row.cnt)]));

  return conversations.rows.map((row) => {
    const otherIds = otherIdsByConvo.get(row.id) ?? [];
    return {
      id: row.id,
      kind: row.kind,
      gameType: row.game_type,
      otherMembers: otherIds.map((id) => {
        const account = accountById.get(id);
        return {
          userId: id,
          name: account?.username || 'Player',
          imageUrl: account?.imageUrl ?? null,
        };
      }),
      lastMessage: row.last_message_id ? lastMessageById.get(row.last_message_id) ?? null : null,
      unreadCount: unreadByConvo.get(row.id) ?? 0,
      muted: row.muted,
      updatedAt: Number(row.updated_at),
    };
  });
}

/** Number of DM conversations with unread messages — drives the nav badge. */
export async function getUnreadConversationCount(userId: string): Promise<number> {
  const row = await queryOne<{ cnt: string | number }>(
    `SELECT COUNT(DISTINCT msg.conversation_id)::int AS cnt
     FROM arcade_messages msg
     JOIN arcade_conversation_members mem
       ON mem.conversation_id = msg.conversation_id AND mem.user_id = $1
     JOIN arcade_conversations c ON c.id = msg.conversation_id AND c.kind = 'dm'
     WHERE msg.created_at > mem.last_read_at AND msg.sender_user_id <> $1`,
    [userId],
  );
  return Number(row?.cnt ?? 0);
}

export async function ensureArcadeLobbyMember(userId: string): Promise<void> {
  const now = Date.now();
  await query(
    `INSERT INTO arcade_conversations (id, kind, context_ref, game_type, created_by, created_at, updated_at)
     VALUES ($1, 'channel', $1, NULL, NULL, $2, $2)
     ON CONFLICT (id) DO NOTHING`,
    [ARCADE_LOBBY_CONVERSATION_ID, now],
  );
  await query(
    `INSERT INTO arcade_conversation_members (conversation_id, user_id, role, joined_at)
     VALUES ($1, $2, 'member', $3)
     ON CONFLICT (conversation_id, user_id) DO NOTHING`,
    [ARCADE_LOBBY_CONVERSATION_ID, userId, now],
  );
}

export async function listArcadeLobbyMessages(userId: string, limit = 100) {
  await ensureArcadeLobbyMember(userId);
  const [messages, blocks] = await Promise.all([
    listMessages({
      conversationId: ARCADE_LOBBY_CONVERSATION_ID,
      limit: Math.min(Math.max(limit, 1), 100),
    }),
    query<{ other_id: string }>(
      `SELECT blocked_user_id AS other_id
         FROM arcade_user_blocks
        WHERE blocker_user_id = $1`,
      [userId],
    ),
  ]);
  const blocked = new Set(blocks.rows.map((row) => row.other_id));
  const visible = messages.filter((message) => !blocked.has(message.senderUserId));
  const accounts = await getAccountsByIds([...new Set(visible.map((message) => message.senderUserId))]);
  const accountById = new Map(accounts.map((account) => [account.id, account]));
  return visible.map((message) => ({
    ...message,
    senderImageUrl: accountById.get(message.senderUserId)?.imageUrl ?? null,
  }));
}

export async function getArcadeLobbyUnreadCount(userId: string): Promise<number> {
  await ensureArcadeLobbyMember(userId);
  const row = await queryOne<{ cnt: string | number }>(
    `SELECT COUNT(*)::int AS cnt
       FROM arcade_messages msg
       JOIN arcade_conversation_members mem
         ON mem.conversation_id = msg.conversation_id AND mem.user_id = $2
      WHERE msg.conversation_id = $1
        AND msg.created_at > mem.last_read_at
        AND msg.sender_user_id <> $2
        AND msg.deleted_at IS NULL
        AND NOT EXISTS (
          SELECT 1
            FROM arcade_user_blocks block
           WHERE block.blocker_user_id = $2
             AND block.blocked_user_id = msg.sender_user_id
        )`,
    [ARCADE_LOBBY_CONVERSATION_ID, userId],
  );
  return Number(row?.cnt ?? 0);
}

export async function reportArcadeLobbyMessage(input: {
  reporterUserId: string;
  messageId: string;
  reason?: string;
}) {
  const message = await queryOne<{ sender_user_id: string }>(
    `SELECT sender_user_id FROM arcade_messages
      WHERE id = $1 AND conversation_id = $2 AND deleted_at IS NULL`,
    [input.messageId, ARCADE_LOBBY_CONVERSATION_ID],
  );
  if (!message || message.sender_user_id === input.reporterUserId) return false;
  await query(
    `INSERT INTO arcade_message_reports (id, message_id, reporter_user_id, reason, created_at)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (message_id, reporter_user_id) DO NOTHING`,
    [randomUUID(), input.messageId, input.reporterUserId, input.reason?.trim().slice(0, 160) || 'Inappropriate message', Date.now()],
  );
  return true;
}

export async function removeArcadeLobbyMessage(input: {
  messageId: string;
  actorUserId: string;
}) {
  const result = await query(
    `UPDATE arcade_messages
        SET deleted_at = COALESCE(deleted_at, $1), deleted_by = COALESCE(deleted_by, $2)
      WHERE id = $3 AND conversation_id = $4`,
    [Date.now(), input.actorUserId, input.messageId, ARCADE_LOBBY_CONVERSATION_ID],
  );
  if ((result.rowCount ?? 0) > 0) {
    broadcast('social:lobby', { type: 'message_updated', conversationId: ARCADE_LOBBY_CONVERSATION_ID, kind: 'channel' });
  }
  return (result.rowCount ?? 0) > 0;
}

export type LobbyMessageReport = {
  id: string;
  messageId: string;
  reporterUserId: string;
  senderUserId: string;
  senderName: string;
  content: string;
  reason: string;
  createdAt: number;
};

export async function listOpenLobbyMessageReports(limit = 100): Promise<LobbyMessageReport[]> {
  const result = await query<{
    id: string;
    message_id: string;
    reporter_user_id: string;
    sender_user_id: string;
    sender_name: string;
    content: string;
    reason: string;
    created_at: string | number;
  }>(
    `SELECT r.id, r.message_id, r.reporter_user_id, m.sender_user_id,
            m.sender_name, m.content, r.reason, r.created_at
       FROM arcade_message_reports r
       JOIN arcade_messages m ON m.id = r.message_id
      WHERE r.status = 'open'
      ORDER BY r.created_at ASC
      LIMIT $1`,
    [Math.min(Math.max(limit, 1), 200)],
  );
  return result.rows.map((row) => ({
    id: row.id,
    messageId: row.message_id,
    reporterUserId: row.reporter_user_id,
    senderUserId: row.sender_user_id,
    senderName: row.sender_name,
    content: row.content,
    reason: row.reason,
    createdAt: Number(row.created_at),
  }));
}

export async function resolveLobbyMessageReport(input: {
  reportId: string;
  actorUserId: string;
  removeMessage: boolean;
}) {
  const report = await queryOne<{ message_id: string }>(
    `SELECT message_id FROM arcade_message_reports WHERE id = $1 AND status = 'open'`,
    [input.reportId],
  );
  if (!report) return false;
  if (input.removeMessage) {
    await removeArcadeLobbyMessage({
      messageId: report.message_id,
      actorUserId: input.actorUserId,
    });
  }
  await query(
    `UPDATE arcade_message_reports
        SET status = $1, resolved_at = $2, resolved_by = $3
      WHERE id = $4`,
    [input.removeMessage ? 'removed' : 'dismissed', Date.now(), input.actorUserId, input.reportId],
  );
  return true;
}
