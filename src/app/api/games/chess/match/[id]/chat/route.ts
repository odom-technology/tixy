import { NextResponse } from 'next/server';

import { ensureNotGameBanned } from '@/app/api/games/_shared/ban-helpers';
import { requireIdentity } from '@/server/auth';
import { getMatch, isMatchSpectatable } from '@/server/arcade/chess-match';
import { broadcast } from '@/server/events';
import {
  findMatchConversationId,
  getOrCreateMatchConversation,
  listMessages,
  postMessage,
  type ArcadeMessage,
} from '@/server/social/messaging';

export const dynamic = 'force-dynamic';

const GAME_TYPE = 'chess';
const REACTION_EMOJIS = ['👏', '😂', '😮', '🔥', '😭', '♟', '💀', '🤝'];

// Adapter: chess match chat now persists in the unified messaging backend, while
// keeping the exact request/response shape the existing _match-chat.tsx expects.
function toLegacy(message: ArcadeMessage, matchId: string) {
  return {
    id: message.id,
    matchId,
    userId: message.senderUserId,
    userName: message.senderName,
    type: message.type === 'text' ? 'message' : message.type,
    content: message.content,
    createdAt: message.createdAt,
  };
}

function humanPlayerIds(match: { player1Id: string | null; player2Id: string | null }): string[] {
  return [match.player1Id, match.player2Id].filter(
    (id): id is string => Boolean(id) && !id.startsWith('bot:'),
  );
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  let identity;
  try {
    identity = await requireIdentity({ allowExternal: true });
  } catch {
    return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  }

  const { id: matchId } = await params;
  const match = await getMatch(matchId);
  if (!match) return NextResponse.json({ error: 'Match not found.' }, { status: 404 });

  const isPlayer = match.player1Id === identity.userId || match.player2Id === identity.userId;
  if (!isPlayer && !isMatchSpectatable(match)) {
    return NextResponse.json({ error: 'Not a player in this match.' }, { status: 403 });
  }
  if (match.player2Id?.startsWith('bot:')) {
    return NextResponse.json({ messages: [] });
  }

  const conversationId = await findMatchConversationId(matchId, GAME_TYPE);
  if (!conversationId) return NextResponse.json({ messages: [] });

  const { searchParams } = new URL(request.url);
  const sinceParam = searchParams.get('since');
  const parsedSince = sinceParam ? parseInt(sinceParam, 10) : 0;
  const since = Number.isFinite(parsedSince) && parsedSince > 0 ? parsedSince : undefined;

  const messages = (await listMessages({ conversationId, since, limit: 100 })).map((message) =>
    toLegacy(message, matchId),
  );
  return NextResponse.json({ messages });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  let identity;
  try {
    identity = await requireIdentity({ allowExternal: true });
  } catch {
    return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  }
  // Block banned users from griefing via chat.
  const banResponse = await ensureNotGameBanned(identity.userId);
  if (banResponse) return banResponse;

  const { id: matchId } = await params;
  const match = await getMatch(matchId);
  if (!match) return NextResponse.json({ error: 'Match not found.' }, { status: 404 });

  const isPlayer = match.player1Id === identity.userId || match.player2Id === identity.userId;
  if (!isPlayer && !isMatchSpectatable(match)) {
    return NextResponse.json({ error: 'Not a player in this match.' }, { status: 403 });
  }
  if (match.player2Id?.startsWith('bot:')) {
    return NextResponse.json({ error: 'Chat is not available in bot matches.' }, { status: 400 });
  }

  let body: { content?: string; type?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 });
  }

  const conversation = await getOrCreateMatchConversation({
    matchId,
    gameType: GAME_TYPE,
    participantIds: humanPlayerIds(match),
  });

  const result = await postMessage({
    conversationId: conversation.id,
    senderUserId: identity.userId,
    senderName: identity.name || 'Anonymous',
    type: body.type === 'reaction' ? 'reaction' : 'text',
    content: typeof body.content === 'string' ? body.content : '',
    reactionSet: REACTION_EMOJIS,
    notify: false,
  });

  if (!result.ok) {
    const response = NextResponse.json({ error: result.error }, { status: result.status });
    if (result.retryAfterMs) {
      response.headers.set('Retry-After', String(Math.max(1, Math.ceil(result.retryAfterMs / 1000))));
    }
    return response;
  }

  // Notice-only events the existing chess UI subscribes to (no body on the wire).
  broadcast('chessChat', { matchId, type: 'chat_updated' });
  broadcast([`chess:${matchId}`, 'chessMatch'], { matchId, type: 'chat_updated' });

  return NextResponse.json({ message: toLegacy(result.message, matchId) });
}
