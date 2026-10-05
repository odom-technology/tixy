import { NextResponse } from 'next/server';

import { requireIdentity } from '@/server/auth';
import { isGuestIdentity } from '@/server/auth/guest';
import { broadcast } from '@/server/events';
import { query, queryOne } from '@/server/db/client';
import type { DerbyChatMessage } from '@/server/arcade/derby/derby-shared';

export const dynamic = 'force-dynamic';

const CHAT_MAX_LEN = 280;
const CHAT_COOLDOWN_MS = 2_000;
const CHAT_HISTORY_LIMIT = 30;

// In-memory per-user cooldown. Pinned on globalThis so it survives the dev
// server's module reloads (and is shared across route handler instances).
declare global {
   
  var __derbyChatLimiter__: Map<string, number> | undefined;
}
const chatLimiter = (globalThis.__derbyChatLimiter__ ??= new Map<string, number>());

type ChatRow = { id: string; user_name: string; body: string; created_at: Date };

function toMessage(row: ChatRow): DerbyChatMessage {
  return {
    id: Number(row.id),
    name: row.user_name,
    body: row.body,
    at: new Date(row.created_at).getTime(),
  };
}

export async function GET() {
  try {
    const result = await query<ChatRow>(
      `SELECT id, user_name, body, created_at
         FROM derby_chat
         ORDER BY id DESC
         LIMIT $1`,
      [CHAT_HISTORY_LIMIT],
    );
    // Return oldest-first so the client can append newer messages at the tail.
    const messages = result.rows.map(toMessage).reverse();
    return NextResponse.json({ messages });
  } catch {
    return NextResponse.json({ messages: [] });
  }
}

export async function POST(request: Request) {
  let identity;
  try {
    identity = await requireIdentity({ allowExternal: true, allowGuest: true });
  } catch {
    return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  }

  // Chat is for account holders only — guests may spectate and bet, not talk.
  if (isGuestIdentity(identity)) {
    return NextResponse.json({ error: 'Sign in to chat.' }, { status: 403 });
  }

  let payload: { body?: unknown };
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 });
  }

  const raw = typeof payload.body === 'string' ? payload.body : '';
  const body = raw.trim().slice(0, CHAT_MAX_LEN);
  if (!body) {
    return NextResponse.json({ error: 'Message is empty.' }, { status: 400 });
  }

  const now = Date.now();
  // Opportunistic sweep so the cooldown map can't grow unbounded.
  if (chatLimiter.size > 512) {
    for (const [key, ts] of chatLimiter) {
      if (now - ts > CHAT_COOLDOWN_MS) chatLimiter.delete(key);
    }
  }
  const last = chatLimiter.get(identity.userId) ?? 0;
  if (now - last < CHAT_COOLDOWN_MS) {
    const response = NextResponse.json(
      { error: 'You are chatting too fast.' },
      { status: 429 },
    );
    response.headers.set(
      'Retry-After',
      String(Math.max(1, Math.ceil((CHAT_COOLDOWN_MS - (now - last)) / 1000))),
    );
    return response;
  }
  chatLimiter.set(identity.userId, now);

  const name = identity.name?.trim() || 'Player';

  // Best-effort: tag the message with the round it was sent during. A read-only
  // lookup against Agent A's table — falls back to null if the round loop hasn't
  // created a row yet.
  let roundId: string | null = null;
  try {
    const round = await queryOne<{ id: string }>(
      `SELECT id FROM derby_rounds ORDER BY round_number DESC LIMIT 1`,
    );
    roundId = round?.id ?? null;
  } catch {
    roundId = null;
  }

  let inserted: ChatRow | null;
  try {
    inserted = await queryOne<ChatRow>(
      `INSERT INTO derby_chat (user_id, user_name, body, round_id)
         VALUES ($1, $2, $3, $4)
         RETURNING id, user_name, body, created_at`,
      [identity.userId, name, body, roundId],
    );
  } catch {
    // Roll back the cooldown so a transient DB error doesn't mute the user.
    chatLimiter.delete(identity.userId);
    return NextResponse.json({ error: 'Could not send message.' }, { status: 500 });
  }

  if (!inserted) {
    return NextResponse.json({ error: 'Could not send message.' }, { status: 500 });
  }

  const msg = toMessage(inserted);
  broadcast('derby', { type: 'chat', msg });

  return NextResponse.json({ msg });
}
