// Bumper cars rooms over HTTP: find or make a room and get a one-use ticket
// for the socket. The round itself runs on /ws/bumper-cars.
//
//   GET                       your room, if you sit in one, and your friends to invite
//   POST { action: 'play' }   play now: your room, an open lobby, or a new one
//   POST { action: 'create' } a room for friends, with a code and a link
//   POST { action: 'join', roomId? , code? }
//   POST { action: 'ticket', roomId }   a fresh ticket to (re)connect
//   POST { action: 'invite', roomId, friendId }   a notification with the link
import { NextResponse } from 'next/server';

import { checkNewGameAvailability } from '@/server/arcade/game-availability';
import { getGameBanStatus } from '@/server/arcade/game-bans';
import { areArcadeFriends } from '@/server/arcade/multiplayer';
import { getArcadeFriendUserSummaries } from '@/server/arcade/friend-users';
import { addAntiCheatLog } from '@/server/arcade/anti-cheat-logs';
import { requireIdentity } from '@/server/auth';
import { query } from '@/server/db/client';
import { isGuestUserId } from '@/server/auth/guest';
import { createNotification } from '@/server/services/notifications';
import {
  BumperRoomError,
  createInviteRoom,
  findPlayerRoom,
  getRoom,
  getRoomByCode,
  issueTicket,
  joinRoom,
  quickPlay,
  wireRoom,
  type BumperRoom,
} from '@/server/arcade/bumper-cars/rooms';
import { BUMPER_WS_PATH } from '@/features/arcade/lib/bumper-cars/protocol';

export const dynamic = 'force-dynamic';

declare global {
  var __bumperCarsRate__: Map<string, number[]> | undefined;
}
const buckets: Map<string, number[]> = (globalThis.__bumperCarsRate__ ??= new Map<string, number[]>());

/** Requests a player may make: 12 in 10 s, like the other lobby routes. */
const LIMIT = 12;
const WINDOW_MS = 10_000;

function limited(key: string, now = Date.now()): boolean {
  if (buckets.size > 5000) for (const [k, v] of buckets) if (!v.some((t) => t > now - WINDOW_MS)) buckets.delete(k);
  const recent = (buckets.get(key) ?? []).filter((t) => t > now - WINDOW_MS);
  if (recent.length >= LIMIT) {
    buckets.set(key, recent);
    return true;
  }
  recent.push(now);
  buckets.set(key, recent);
  return false;
}

type Who = { userId: string; name: string };

async function gate(): Promise<Who | Response> {
  const unavailable = await checkNewGameAvailability('bumper-cars');
  if (unavailable) return unavailable;
  let identity;
  try {
    identity = await requireIdentity({ allowExternal: true, allowGuest: true });
  } catch {
    return NextResponse.json({ error: 'Sign in to play bumper cars.' }, { status: 401 });
  }
  if (isGuestUserId(identity.userId)) {
    return NextResponse.json({ error: 'Sign in to play bumper cars.' }, { status: 401 });
  }
  const ban = await getGameBanStatus(identity.userId);
  if (ban.isBanned) return NextResponse.json({ error: 'You are currently banned from games.' }, { status: 403 });
  return { userId: identity.userId, name: identity.name || 'Player' };
}

function joined(room: BumperRoom, who: Who) {
  return NextResponse.json({
    room: wireRoom(room),
    seat: room.seats.findIndex((s) => s.kind === 'human' && s.userId === who.userId),
    ticket: issueTicket(who.userId, who.name, room.id),
    ws: BUMPER_WS_PATH,
    host: room.hostUserId === who.userId,
  });
}

export async function GET() {
  const who = await gate();
  if (who instanceof Response) return who;
  const room = findPlayerRoom(who.userId);
  let friends: Array<{ userId: string; name: string }> = [];
  try {
    friends = (await getArcadeFriendUserSummaries(who.userId)).slice(0, 50).map((f) => ({ userId: f.userId, name: f.name }));
  } catch {
    friends = [];
  }
  // Your best round's points, for the strip and the new-best moment.
  let best: number | null = null;
  try {
    const row = await query<{ best: number | null }>(
      `SELECT MAX(points)::int AS best FROM bumper_car_players WHERE user_id = $1 AND result IN ('finished', 'timeout')`,
      [who.userId],
    );
    best = row.rows[0]?.best ?? null;
  } catch {
    best = null;
  }
  return NextResponse.json({ room: room ? wireRoom(room) : null, friends, best });
}

export async function POST(request: Request) {
  const who = await gate();
  if (who instanceof Response) return who;
  if (limited(who.userId)) {
    void addAntiCheatLog({
      ts: Date.now(),
      gameType: 'bumper-cars',
      userId: who.userId,
      score: 0,
      result: 'flag',
      reason: `room: over ${LIMIT} requests in ${WINDOW_MS} ms`,
      stage: 'bumper-cars-room',
      checks: [],
    }).catch(() => undefined);
    return NextResponse.json({ error: 'Slow down a moment.' }, { status: 429 });
  }
  let body: { action?: unknown; roomId?: unknown; code?: unknown; friendId?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'Bad request.' }, { status: 400 });
  }
  const roomId = typeof body.roomId === 'string' && body.roomId.length <= 64 ? body.roomId : null;
  const code = typeof body.code === 'string' && /^[A-Za-z0-9]{4,8}$/.test(body.code.trim()) ? body.code.trim().toUpperCase() : null;
  try {
    switch (body.action) {
      case 'play':
        return joined(quickPlay(who.userId, who.name), who);
      case 'create':
        return joined(createInviteRoom(who.userId, who.name), who);
      case 'join': {
        const target = roomId ? getRoom(roomId) : code ? getRoomByCode(code) : null;
        return joined(joinRoom(target, who.userId, who.name), who);
      }
      case 'ticket': {
        const room = roomId ? getRoom(roomId) : findPlayerRoom(who.userId);
        if (!room || !room.seats.some((s) => s.kind === 'human' && s.userId === who.userId && !s.left)) {
          return NextResponse.json({ error: 'That round has closed.' }, { status: 404 });
        }
        return joined(room, who);
      }
      case 'invite': {
        const room = roomId ? getRoom(roomId) : null;
        const friendId = typeof body.friendId === 'string' ? body.friendId : '';
        if (!room || !room.seats.some((s) => s.kind === 'human' && s.userId === who.userId)) {
          return NextResponse.json({ error: 'That round has closed.' }, { status: 404 });
        }
        if (!friendId || !(await areArcadeFriends(who.userId, friendId))) {
          return NextResponse.json({ error: 'You can invite friends only.' }, { status: 403 });
        }
        await createNotification({
          userId: friendId,
          type: 'game_turn',
          title: 'Bumper cars',
          body: `${who.name} saved you a car. Code ${room.code}.`,
          href: `/bumper-cars?join=${encodeURIComponent(room.id)}`,
          preferenceKey: 'game_notifications',
          dedupeKey: `bumper-cars:${room.id}:${friendId}`,
        });
        return NextResponse.json({ ok: true });
      }
      default:
        return NextResponse.json({ error: 'Bad request.' }, { status: 400 });
    }
  } catch (error) {
    if (error instanceof BumperRoomError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error('[bumper-cars] room route', error);
    return NextResponse.json({ error: 'The rink is busy. Try again.' }, { status: 500 });
  }
}
