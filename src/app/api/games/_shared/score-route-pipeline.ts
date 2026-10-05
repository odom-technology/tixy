import { NextResponse } from 'next/server';

type AntiCheatResultLike = {
  ok: boolean;
  reason?: string | null;
};

type ScoreRouteIdentity = {
  name?: string | null;
  email?: string | null;
};

type ScorePipelineContext = {
  now: number;
  userName: string;
};

type PublicRouteError = Error & {
  status?: number;
};

function scoreValidationFailedResponse(reason?: string | null) {
  return NextResponse.json(
    {
      error: 'Score validation failed.',
      details: reason ?? undefined,
    },
    { status: 403 },
  );
}

export async function runScoreRoutePipeline<
  TPayload extends Record<string, unknown>,
>({
  antiCheat,
  identity,
  persist,
  saveErrorMessage = 'Failed to save score.',
}: {
  antiCheat: AntiCheatResultLike;
  identity: ScoreRouteIdentity;
  persist: (ctx: ScorePipelineContext) => Promise<TPayload>;
  saveErrorMessage?: string;
}) {
  if (!antiCheat.ok) {
    return scoreValidationFailedResponse(antiCheat.reason);
  }

  try {
    const now = Date.now();
    const userName = identity.name || 'Anonymous';
    const payload = await persist({ now, userName });
    return NextResponse.json(payload);
  } catch (error) {
    const routeError = error as PublicRouteError;
    if (
      typeof routeError.status === 'number' &&
      routeError.status >= 400 &&
      routeError.status < 500
    ) {
      return NextResponse.json(
        { error: routeError.message || saveErrorMessage },
        { status: routeError.status },
      );
    }
    console.error('Failed to save score:', error);
    return NextResponse.json(
      { error: saveErrorMessage },
      { status: 500 },
    );
  }
}
