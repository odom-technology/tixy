"use client";

import { useCallback, useRef, useState } from "react";

import { useRevealedSeedHash } from "./provably-fair";
import { useArcadeRunResult } from "./run-result";

/** POST /api/wagers/session response. */
export type WagerSessionData = {
  sessionId: string;
  token: string;
  config: Record<string, unknown>;
};

/**
 * HTTP-level failures resolve to `{ ok: false, error }` carrying the
 * server's error string (possibly undefined) so each game supplies its
 * own fallback copy. Network failures (fetch/json rejections) propagate
 * to the caller's try/catch so each game keeps its own
 * "Network error — …" message.
 */
// Both arms carry both properties (as `undefined` on the irrelevant arm)
// so member access compiles even without strictNullChecks narrowing.
export type WagerResult<T> =
  | { ok: true; data: T; error?: undefined; status?: undefined }
  | { ok: false; data?: undefined; error?: string; status: number };

async function postJson<T>(
  url: string,
  body: Record<string, unknown>,
): Promise<{ res: Response; data: T & { error?: string } }> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json()) as T & { error?: string };
  return { res, data };
}

/**
 * Shared client plumbing for server-authoritative wager games: session
 * creation, in-round actions, settling, and the provably-fair
 * seedHash/revealedSeed pair every game feeds to ArcadeProvablyFair.
 *
 * `start` stores the session token (later calls read it from the ref) and
 * resets the revealed seed; `settle` reveals the seed from its response.
 * Actions that reveal a seed mid-round (busts, chain completions) are
 * game-specific — use `setRevealedSeed` at whatever moment the game's
 * animation calls for.
 */
export function useWagerSession(gameType: string) {
  const tokenRef = useRef<string | null>(null);
  const [revealedSeed, setRevealedSeed] = useState<number | null>(null);
  // The seed hash is derived from the revealed seed (post-round only) — it is
  // never received from the server before/during play.
  const seedHash = useRevealedSeedHash(revealedSeed);
  const {
    achievements,
    capture: captureRunResult,
    reset: resetRunResult,
  } = useArcadeRunResult();

  const start = useCallback(
    async (
      wager: number,
      config?: Record<string, unknown>,
    ): Promise<WagerResult<WagerSessionData>> => {
      // JSON.stringify drops `config` when undefined, matching games that
      // omit it from the payload entirely.
      const { res, data } = await postJson<WagerSessionData>(
        "/api/wagers/session",
        {
          gameType,
          wager,
          config,
        },
      );
      if (!res.ok) return { ok: false, error: data.error, status: res.status };
      tokenRef.current = data.token;
      setRevealedSeed(null);
      resetRunResult();
      return { ok: true, data };
    },
    [gameType, resetRunResult],
  );

  const action = useCallback(
    async <T>(
      action: string,
      payload?: Record<string, unknown>,
    ): Promise<WagerResult<T>> => {
      const { res, data } = await postJson<T>("/api/wagers/action", {
        token: tokenRef.current,
        action,
        ...payload,
      });
      if (!res.ok) return { ok: false, error: data.error, status: res.status };
      captureRunResult(data);
      return { ok: true, data };
    },
    [captureRunResult],
  );

  const settle = useCallback(async <T>(): Promise<WagerResult<T>> => {
    const { res, data } = await postJson<T>("/api/wagers/settle", {
      token: tokenRef.current,
      action: "cashout",
    });
    if (!res.ok) return { ok: false, error: data.error, status: res.status };
    setRevealedSeed((data as { seed?: number }).seed ?? null);
    captureRunResult(data);
    return { ok: true, data };
  }, [captureRunResult]);

  const reset = useCallback(() => {
    tokenRef.current = null;
    setRevealedSeed(null);
    resetRunResult();
  }, [resetRunResult]);

  // tokenRef is exposed for games that guard against acting before a
  // session exists — treat it as read-only; start/reset manage it.
  return {
    tokenRef,
    seedHash,
    revealedSeed,
    setRevealedSeed,
    achievements,
    start,
    action,
    settle,
    reset,
  };
}
