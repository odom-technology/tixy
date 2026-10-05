import crypto from 'node:crypto';
import { query } from '@/server/db/client';

// fallow-ignore-next-line duplicate-export
export type GameEventRow = {
  id: string;
  sessionId: string;
  odUserId: string;
  gameType: string;
  eventType: string;
  ts: number;
  data?: unknown;
};

type GameEventQueryOptions = {
  startTs?: number;
  endTs?: number;
  limit?: number;
};

type GameEventDbRow = {
  id: string;
  session_id: string;
  od_user_id: string;
  game_type: string;
  event_type: string;
  ts: string | number;
  data_json: string | null;
};

const toNumber = (value: string | number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

export const recordGameEvent = async (event: Omit<GameEventRow, 'id'>) => {
  await query(
    `INSERT INTO game_events
      (id, session_id, od_user_id, game_type, event_type, ts, data_json)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      crypto.randomUUID(),
      event.sessionId,
      event.odUserId,
      event.gameType,
      event.eventType,
      event.ts,
      event.data ? JSON.stringify(event.data) : null,
    ],
  );
};

export const getGameEvents = async (
  sessionId: string,
  eventType?: string,
  options: GameEventQueryOptions = {},
): Promise<GameEventRow[]> => {
  const clauses = ['session_id = $1'];
  const params: Array<string | number> = [sessionId];

  if (eventType) {
    params.push(eventType);
    clauses.push(`event_type = $${params.length}`);
  }
  if (typeof options.startTs === 'number') {
    params.push(Math.floor(options.startTs));
    clauses.push(`ts >= $${params.length}`);
  }
  if (typeof options.endTs === 'number') {
    params.push(Math.floor(options.endTs));
    clauses.push(`ts <= $${params.length}`);
  }

  let sql = `SELECT id, session_id, od_user_id, game_type, event_type, ts, data_json
    FROM game_events
    WHERE ${clauses.join(' AND ')}
    ORDER BY ts ASC`;
  if (typeof options.limit === 'number' && Number.isFinite(options.limit)) {
    params.push(Math.max(1, Math.floor(options.limit)));
    sql += ` LIMIT $${params.length}`;
  }

  const result = await query<GameEventDbRow>(sql, params);

  return result.rows.map((row) => ({
    id: row.id,
    sessionId: row.session_id,
    odUserId: row.od_user_id,
    gameType: row.game_type,
    eventType: row.event_type,
    ts: toNumber(row.ts),
    data: row.data_json ? JSON.parse(row.data_json) : undefined,
  }));
};
