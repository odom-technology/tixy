import { getGameRestriction } from '@/lib/site-availability';
import { getSiteAvailabilitySettings } from '@/server/site-settings';

export class GameUnavailableError extends Error {
  readonly status = 503;
}

export async function assertGameAvailable(gameType: string): Promise<void> {
  const { config } = await getSiteAvailabilitySettings();
  const restriction = getGameRestriction(config, gameType);
  if (restriction) throw new GameUnavailableError(restriction.message);
}

export function gameUnavailableResponse(error: unknown): Response | null {
  if (!(error instanceof GameUnavailableError)) return null;
  return Response.json(
    { error: error.message },
    { status: error.status, headers: { 'Cache-Control': 'no-store', 'Retry-After': '300' } },
  );
}

export async function checkNewGameAvailability(gameType: string): Promise<Response | null> {
  try {
    await assertGameAvailable(gameType);
    return null;
  } catch (error) {
    const response = gameUnavailableResponse(error);
    if (response) return response;
    throw error;
  }
}

// A reconnect may finish an already issued round; pausing never strands its result.
export async function checkGameSessionResume(gameType: string, startedAt: number): Promise<void> {
  const { config, updatedAt } = await getSiteAvailabilitySettings();
  const restriction = getGameRestriction(config, gameType);
  if (restriction && (updatedAt === null || startedAt > updatedAt)) {
    throw new GameUnavailableError(restriction.message);
  }
}
