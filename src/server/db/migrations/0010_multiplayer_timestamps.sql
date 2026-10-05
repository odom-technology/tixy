ALTER TABLE IF EXISTS arcade_friendships
  ALTER COLUMN created_at TYPE BIGINT USING created_at::bigint,
  ALTER COLUMN updated_at TYPE BIGINT USING updated_at::bigint,
  ALTER COLUMN accepted_at TYPE BIGINT USING accepted_at::bigint;

ALTER TABLE IF EXISTS arcade_game_invites
  ALTER COLUMN created_at TYPE BIGINT USING created_at::bigint,
  ALTER COLUMN updated_at TYPE BIGINT USING updated_at::bigint,
  ALTER COLUMN expires_at TYPE BIGINT USING expires_at::bigint,
  ALTER COLUMN claimed_at TYPE BIGINT USING claimed_at::bigint;
