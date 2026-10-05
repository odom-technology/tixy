CREATE TABLE IF NOT EXISTS arcade_skill_duel_results (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  user_name TEXT NOT NULL,
  game_type TEXT NOT NULL,
  game_session_id TEXT,
  mode_sec INTEGER NOT NULL,
  wpm DOUBLE PRECISION NOT NULL,
  raw_wpm DOUBLE PRECISION NOT NULL,
  accuracy DOUBLE PRECISION NOT NULL,
  correct_chars INTEGER NOT NULL,
  incorrect_chars INTEGER NOT NULL,
  total_chars INTEGER NOT NULL,
  words_completed INTEGER NOT NULL,
  created_at BIGINT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_arcade_skill_duel_results_session_user
  ON arcade_skill_duel_results(session_id, user_id);

CREATE INDEX IF NOT EXISTS idx_arcade_skill_duel_results_session
  ON arcade_skill_duel_results(session_id, created_at);
