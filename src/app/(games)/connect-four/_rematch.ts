'use client';

// ---------------------------------------------------------------------------
// Finding a rematch, with the routes connect four already has.
//
// Connect four has no challenge route, so a rematch is an ordinary open match
// that the creator waits in. The create route takes no invited user, so these
// helpers find the opponent's offer instead.
//
// The match route only answers the match's own players, so a waiting match
// can't be read by id. `findOffer` reads the open list instead, which is the
// newest 20 waiting matches. It runs when the lobby topic announces a new
// match, which is the moment the offer is the newest of them, and on a poll as
// the backstop for a missed event. Only 20 other matches appearing between an
// event and its read could hide an offer.
//
// An offer is a waiting match by the opponent, with no stake, made after the
// previous game finished. A stranger's play now can still take it from the
// open list; that is what the join error "They started another game." covers.
// ---------------------------------------------------------------------------

import type { ConnectFourMatch } from '@/features/arcade/lib/connect-four/types';

export type RematchOffer = { matchId: string; senderName: string };

function asOffer(
  m: ConnectFourMatch | undefined | null,
  opponentId: string,
  afterTs: number,
  excludeId: string,
): RematchOffer | null {
  if (!m) return null;
  if (m.player1Id !== opponentId || m.status !== 'waiting' || m.player2Id) return null;
  if (m.wagerAmount || m.tournamentMatchId) return null;
  if (m.id === excludeId || m.createdAt < afterTs) return null;
  // A match reserved for someone else is not ours to join.
  if (m.invitedUserId) return null;
  return { matchId: m.id, senderName: m.player1Name };
}

/** One match by id, or null if it can't be read. */
export async function fetchMatch(matchId: string): Promise<ConnectFourMatch | null> {
  try {
    const res = await fetch(`/api/games/connect-four/match/${matchId}`, { cache: 'no-store' });
    if (!res.ok) return null;
    const payload = (await res.json()) as { match?: ConnectFourMatch };
    return payload.match ?? null;
  } catch {
    return null;
  }
}

/** The opponent's offer among the open matches (newest 20), or null. */
export async function findOffer(
  opponentId: string,
  afterTs: number,
  excludeId: string,
): Promise<RematchOffer | null> {
  try {
    const res = await fetch('/api/games/connect-four/matches', { cache: 'no-store' });
    if (!res.ok) return null;
    const payload = (await res.json()) as { openMatches?: ConnectFourMatch[] };
    for (const m of payload.openMatches ?? []) {
      const offer = asOffer(m, opponentId, afterTs, excludeId);
      if (offer) return offer;
    }
  } catch {
    /* the next event or poll tries again */
  }
  return null;
}

/** When a finished match ended, for "newer than the last game". */
export function endedAt(match: Pick<ConnectFourMatch, 'completedAt' | 'updatedAt'>): number {
  return match.completedAt ?? match.updatedAt;
}
