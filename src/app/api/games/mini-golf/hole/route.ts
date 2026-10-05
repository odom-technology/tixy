import { NextResponse } from 'next/server';

import { queryOne, withTransaction } from '@/server/db/client';
import { isNewBest } from '@/features/arcade/lib/new-best';
import { broadcast } from '@/server/events';
import { awardGameRunCredits } from '@/server/arcade/rewards';
import { recordGameTimeMetric } from '@/server/arcade/game-time-metrics';
import { runAntiCheat, type ActionEntry, type EnvFingerprint } from '@/server/arcade/anti-cheat';
import { MG_HOLES } from '@/server/arcade/mini-golf-engine';
import {
  MG_CLOCK_SLACK_MS,
  MG_ROUND_OPEN_MS,
  mgCheckHole,
  mgCourseCached,
  mgParsePutts,
  mgParseStoredHoles,
  mgParseStoredPutts,
  mgRoundPoints,
  mgSamePutts,
  type MgStoredHole,
} from '@/server/arcade/mini-golf-round';
import { recordRunAchievements } from '../../_shared/run-achievements';
import { authenticateGamePlayer, isErrorResponse, parsePayload, rejectScore } from '../../_shared/score-helpers';

export const dynamic = 'force-dynamic';

type Payload = {
  roundId?: unknown;
  hole?: unknown;
  /** Every putt of this hole so far, the newest last. */
  putts?: unknown;
  /** True when the client says the hole is over (in, or the sixth stroke). */
  done?: unknown;
  /** The hole's score when done: strokes, or 7 for a pickup. */
  score?: unknown;
  env?: EnvFingerprint;
};

type RoundRow = {
  id: string;
  od_user_id: string;
  round_date: string;
  holes_json: string;
  current_json: string;
  scores_json: string;
  holes_done: number;
  strokes: number;
  par: number;
  aces: number;
  started_at: string | number;
  finished_at: string | number | null;
};

type Outcome =
  | { kind: 'reject'; stage: string; reason: string; status?: number; publicMessage: string }
  | { kind: 'duplicate'; row: RoundRow }
  | { kind: 'progress'; row: RoundRow }
  | { kind: 'saved'; row: RoundRow; finished: boolean; scores: number[]; holes: MgStoredHole[] };

/** A typed 4xx thrown inside the transaction so it rolls back. */
class Reject extends Error {
  constructor(
    public stage: string,
    public reason: string,
    public publicMessage: string,
    public status = 403,
  ) {
    super(reason);
  }
}

function roundState(row: RoundRow, scores: number[]) {
  return {
    id: row.id,
    dateKey: row.round_date,
    holesDone: Number(row.holes_done),
    scores,
    strokes: Number(row.strokes),
    par: Number(row.par),
    aces: Number(row.aces),
    finished: row.finished_at != null,
  };
}

/**
 * Save one finished hole of today's counted round. The server replays the
 * hole's putts from the tee through the shared engine on the course for
 * the round's date; the client's stroke count must match the replay. The
 * ninth hole closes the round and pays it, once.
 */
export async function POST(request: Request) {
  const auth = await authenticateGamePlayer('mini-golf');
  if (isErrorResponse(auth)) return auth;
  const { identity, identityName } = auth;

  const payload = await parsePayload<Payload>(request);
  if (payload instanceof NextResponse) return payload;

  const roundId = typeof payload.roundId === 'string' ? payload.roundId : null;
  const holeIndex = typeof payload.hole === 'number' ? payload.hole : NaN;
  const done = payload.done === true;
  const claimed = done && typeof payload.score === 'number' ? Math.floor(payload.score) : done ? NaN : null;
  const putts = mgParsePutts(payload.putts);
  if (!roundId || !Number.isInteger(holeIndex) || (claimed !== null && !Number.isFinite(claimed)) || !putts) {
    return rejectScore('mini-golf', {
      userId: identity.userId,
      userName: identityName,
      score: 0,
      stage: 'payload',
      reason: 'Malformed hole payload',
      status: 400,
      publicMessage: 'Invalid hole data.',
    });
  }

  const now = Date.now();
  // The ninth hole runs the shared checks (webdriver, devtools, the clock)
  // before anything is written.
  if (done && holeIndex === MG_HOLES - 1) {
    const actions: ActionEntry[] = putts.map((p, i) => ({ t: Math.max(0, Math.floor(p.t)), d: { putt: i } }));
    const antiCheat = await runAntiCheat({
      gameType: 'mini-golf',
      userId: identity.userId,
      userName: identityName,
      score: claimed ?? 0,
      actions,
      env: payload.env ?? null,
    });
    if (!antiCheat.ok) {
      return NextResponse.json({ error: 'Score validation failed.', details: antiCheat.reason }, { status: 403 });
    }
  }

  let outcome: Outcome;
  try {
    outcome = await withTransaction<Outcome>(async (client) => {
      const row = (
        await client.query<RoundRow>(
          `SELECT id, od_user_id, round_date, holes_json, current_json, scores_json, holes_done, strokes, par, aces, started_at, finished_at
             FROM mini_golf_rounds
            WHERE id = $1 AND od_user_id = $2
            FOR UPDATE`,
          [roundId, identity.userId],
        )
      ).rows[0];
      if (!row) throw new Reject('round', `No round ${roundId}`, 'No round to save to.', 404);
      const holesDone = Number(row.holes_done);
      // A retry of a hole already saved: answer with the round, write nothing.
      if (holeIndex < holesDone) return { kind: 'duplicate', row };
      if (row.finished_at != null) throw new Reject('round', 'Round already finished', 'This round is finished.', 409);
      if (holeIndex !== holesDone) {
        throw new Reject('order', `Hole ${holeIndex + 1} posted after ${holesDone}`, 'Holes must be saved in order.', 409);
      }
      // The putts must carry on from the ones saved: an earlier putt can't
      // be changed, and a hole can't be started again.
      const current = mgParseStoredPutts(row.current_json);
      if (!mgSamePutts(current, putts)) {
        throw new Reject('rewrite', `Hole ${holeIndex + 1}: posted putts don't continue the ${current.length} saved`, 'Score validation failed.');
      }
      if (putts.length === current.length && !done) return { kind: 'duplicate', row };
      const startedAt = Number(row.started_at);
      if (now - startedAt > MG_ROUND_OPEN_MS) {
        throw new Reject('clock', `Round open ${now - startedAt}ms`, 'This round has closed.', 410);
      }

      const course = mgCourseCached(row.round_date);
      const check = mgCheckHole(course, holeIndex, putts, claimed);
      if (check.ok === false) throw new Reject('server-replay', check.reason, 'Score validation failed.');

      const holes = mgParseStoredHoles(row.holes_json);
      const playSoFar = holes.reduce((sum, h) => sum + (Number(h.playMs) || 0), 0) + check.strikeMs;
      if (now - startedAt + MG_CLOCK_SLACK_MS < playSoFar) {
        throw new Reject(
          'clock',
          `Holes 1 to ${holeIndex + 1} need ${Math.round(playSoFar)}ms; the round has run ${now - startedAt}ms`,
          'Score validation failed.',
        );
      }

      if (!check.finished) {
        const saved = (
          await client.query<RoundRow>(
            `UPDATE mini_golf_rounds SET current_json = $2, updated_at = $3
              WHERE id = $1 AND holes_done = $4
              RETURNING id, od_user_id, round_date, holes_json, current_json, scores_json, holes_done, strokes, par, aces, started_at, finished_at`,
            [row.id, JSON.stringify(putts), now, holesDone],
          )
        ).rows[0];
        if (!saved) throw new Reject('order', 'Putt raced another post', 'Holes must be saved in order.', 409);
        return { kind: 'progress', row: saved };
      }

      const score = check.result.score;
      const nextHoles: MgStoredHole[] = [...holes, { putts, score, playMs: Math.round(check.playMs) }];
      let scores: number[] = [];
      try {
        scores = JSON.parse(row.scores_json) as number[];
      } catch {
        scores = [];
      }
      scores = [...scores.slice(0, holeIndex), score];
      const finished = holeIndex === MG_HOLES - 1;
      const updated = (
        await client.query<RoundRow>(
          `UPDATE mini_golf_rounds
              SET holes_json = $2, current_json = '[]', scores_json = $3, holes_done = holes_done + 1,
                  strokes = strokes + $4, aces = aces + $5, updated_at = $6,
                  finished_at = CASE WHEN $7 THEN $6 ELSE finished_at END
            WHERE id = $1 AND holes_done = $8
            RETURNING id, od_user_id, round_date, holes_json, current_json, scores_json, holes_done, strokes, par, aces, started_at, finished_at`,
          [row.id, JSON.stringify(nextHoles), JSON.stringify(scores), score, score === 1 ? 1 : 0, now, finished, holesDone],
        )
      ).rows[0];
      if (!updated) throw new Reject('order', 'Hole raced another post', 'Holes must be saved in order.', 409);
      return { kind: 'saved', row: updated, finished, scores, holes: nextHoles };
    });
  } catch (error) {
    if (error instanceof Reject) {
      outcome = { kind: 'reject', stage: error.stage, reason: error.reason, status: error.status, publicMessage: error.publicMessage };
    } else {
      console.error('Failed to save mini golf hole:', error);
      return NextResponse.json({ error: 'Failed to save the hole.' }, { status: 500 });
    }
  }

  if (outcome.kind === 'reject') {
    return rejectScore('mini-golf', {
      userId: identity.userId,
      userName: identityName,
      score: typeof claimed === 'number' && Number.isFinite(claimed) ? claimed : 0,
      stage: outcome.stage,
      reason: outcome.reason,
      status: outcome.status,
      publicMessage: outcome.publicMessage,
    });
  }

  const parseScores = (json: string) => {
    try {
      const parsed = JSON.parse(json) as unknown;
      return Array.isArray(parsed) ? (parsed as number[]) : [];
    } catch {
      return [];
    }
  };

  const row = outcome.row;
  const scores = outcome.kind === 'saved' ? outcome.scores : parseScores(row.scores_json);
  const finished = row.finished_at != null;
  // A retried ninth hole pays again only through the ledger's dedup, so a
  // payout lost to a network error is picked up and never doubled.
  if (!finished || (outcome.kind !== 'saved' && holeIndex !== MG_HOLES - 1)) {
    return NextResponse.json({
      success: true,
      duplicate: outcome.kind === 'duplicate' || undefined,
      inProgress: outcome.kind === 'progress' || undefined,
      round: roundState(row, scores),
    });
  }

  // The round is in: pay it once (the ledger's source id is the day's round),
  // then stats, achievements and play time.
  const points = mgRoundPoints(scores);
  const aces = scores.filter((s) => s === 1).length;
  const durationMs = Math.max(0, Number(row.finished_at) - Number(row.started_at));
  // A round is always nine holes, so points are 63 less the strokes: the
  // best before today is the fewest strokes on any other day.
  const before = await queryOne<{ strokes: number | string | null }>(
    `SELECT MIN(strokes) AS strokes FROM mini_golf_rounds
      WHERE od_user_id = $1 AND id <> $2 AND finished_at IS NOT NULL`,
    [identity.userId, row.id],
  ).catch(() => null);
  const bestBefore = before?.strokes != null ? MG_HOLES * 7 - Number(before.strokes) : 0;
  try {
    const reward = await awardGameRunCredits({
      userId: identity.userId,
      context: { gameType: 'mini-golf', score: points },
      sourceId: `mini-golf:${row.round_date}`,
      meta: { roundDate: row.round_date, strokes: Number(row.strokes), par: Number(row.par), points, aces },
    });
    const fresh = outcome.kind === 'saved';
    const achievements = fresh
      ? await recordRunAchievements(identity.userId, { gameType: 'mini-golf', score: points }, reward, {
          durationMs,
          golfAces: aces,
        })
      : [];
    if (fresh) {
      await recordGameTimeMetric({
        userId: identity.userId,
        gameType: 'mini-golf',
        durationMs: Math.min(durationMs, MG_ROUND_OPEN_MS),
        playedAtMs: now,
      });
      broadcast('gameLeaderboards', { gameType: 'mini-golf', roundDate: row.round_date, updatedAt: now });
    }
    return NextResponse.json({
      success: true,
      duplicate: !fresh || undefined,
      round: roundState(row, scores),
      points,
      // A first round has nothing to beat: no "New best" on day one.
      isNewBest: before?.strokes != null && isNewBest(points, bestBefore),
      reward,
      achievements,
    });
  } catch (error) {
    console.error('Failed to pay mini golf round:', error);
    return NextResponse.json(
      { success: true, round: roundState(row, scores), points, error: 'Your round is saved. The tickets could not be paid yet.' },
      { status: 502 },
    );
  }
}
