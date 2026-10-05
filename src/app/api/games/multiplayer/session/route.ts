import { gameUnavailableResponse } from '@/server/arcade/game-availability';
import { NextResponse } from 'next/server';

import { ensureNotGameBanned } from '@/app/api/games/_shared/ban-helpers';
import { requireIdentity } from '@/server/auth';
import {
  createGameInviteCode,
  createMultiplayerSession,
  getGameCodeJoinHref,
  getMultiplayerGameConfig,
  getMultiplayerTargetJoinHref,
  isMultiplayerGameType,
  listOpenMultiplayerSessionSnapshots,
  withAbsoluteUrl,
  type MultiplayerSessionVisibility,
} from '@/server/arcade/multiplayer';

export const dynamic = 'force-dynamic';

type CreateSessionPayload = {
  gameType?: string;
  visibility?: string;
  minPlayers?: number;
  maxPlayers?: number;
  metadata?: unknown;
  createInvite?: boolean;
};

export async function GET(request: Request) {
  try {
    await requireIdentity({ allowExternal: true });
  } catch {
    return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  }

  const url = new URL(request.url);
  const rawGameType = url.searchParams.get('gameType')?.trim();
  if (rawGameType && !isMultiplayerGameType(rawGameType)) {
    return NextResponse.json({ error: 'Unknown multiplayer game type.' }, { status: 400 });
  }
  const gameType = rawGameType && isMultiplayerGameType(rawGameType)
    ? rawGameType
    : undefined;

  const sessions = await listOpenMultiplayerSessionSnapshots({
    gameType,
  });
  return NextResponse.json({ sessions });
}

export async function POST(request: Request) {
  let identity;
  try {
    identity = await requireIdentity({ allowExternal: true });
  } catch {
    return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  }
  const banResponse = await ensureNotGameBanned(identity.userId);
  if (banResponse) return banResponse;

  let body: CreateSessionPayload;
  try {
    body = (await request.json()) as CreateSessionPayload;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 });
  }

  const rawGameType = body.gameType?.trim();
  if (!rawGameType || !isMultiplayerGameType(rawGameType)) {
    return NextResponse.json({ error: 'Valid gameType is required.' }, { status: 400 });
  }

  const config = getMultiplayerGameConfig(rawGameType);
  try {
    const userName = identity.name || 'Anonymous';
    const snapshot = await createMultiplayerSession({
      gameType: rawGameType,
      ownerUserId: identity.userId,
      ownerUserName: userName,
      visibility: normalizeVisibility(body.visibility),
      minPlayers: body.minPlayers,
      maxPlayers: body.maxPlayers,
      metadata: normalizeMetadata(body.metadata),
    });

    let invite = null;
    if (body.createInvite !== false) {
      const remainingSeats = Math.max(
        1,
        snapshot.session.maxPlayers - snapshot.session.currentPlayerCount,
      );
      const code = await createGameInviteCode({
        gameType: rawGameType,
        targetKind: config.targetKind,
        targetId: snapshot.session.id,
        matchId: snapshot.session.id,
        createdByUserId: identity.userId,
        maxClaims: remainingSeats,
      });
      const href = getGameCodeJoinHref(rawGameType, code.code);
      const targetHref = getMultiplayerTargetJoinHref({
        gameType: rawGameType,
        targetKind: config.targetKind,
        targetId: snapshot.session.id,
      });
      invite = {
        ...code,
        href,
        url: withAbsoluteUrl(href, request),
        targetHref,
        targetUrl: withAbsoluteUrl(targetHref, request),
        ...(config.targetKind === 'table'
          ? { tableId: snapshot.session.id }
          : { matchId: snapshot.session.id }),
      };
    }

    return NextResponse.json({
      ...snapshot,
      invite,
    });
  } catch (error) {
    const unavailable = gameUnavailableResponse(error);
    if (unavailable) return unavailable;
    return NextResponse.json(
      { error: (error as Error).message || 'Failed to create table.' },
      { status: 500 },
    );
  }
}

function normalizeVisibility(value: unknown): MultiplayerSessionVisibility {
  return value === 'public' || value === 'private' ? value : 'invite';
}

function normalizeMetadata(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}
