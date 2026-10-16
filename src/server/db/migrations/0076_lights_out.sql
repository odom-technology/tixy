-- Contributor pilot: deterministic score-only puzzle, with no economy writers.
CREATE TABLE IF NOT EXISTS lights_out_sessions (
  id TEXT PRIMARY KEY REFERENCES game_sessions(id) ON DELETE CASCADE,
  rules INTEGER NOT NULL CHECK (rules > 0)
);

CREATE TABLE IF NOT EXISTS lights_out_runs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES arcade_accounts(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  rules INTEGER NOT NULL CHECK (rules > 0),
  moves_json TEXT NOT NULL,
  score INTEGER NOT NULL CHECK (score BETWEEN 0 AND 1000),
  solved BOOLEAN NOT NULL,
  move_count INTEGER NOT NULL CHECK (move_count BETWEEN 1 AND 24),
  created_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS lights_out_scores (
  user_id TEXT NOT NULL REFERENCES arcade_accounts(id) ON DELETE CASCADE,
  rules INTEGER NOT NULL CHECK (rules > 0),
  user_name TEXT NOT NULL,
  score INTEGER NOT NULL CHECK (score BETWEEN 0 AND 1000),
  created_at BIGINT NOT NULL,
  PRIMARY KEY (user_id, rules)
);

CREATE INDEX IF NOT EXISTS idx_lights_out_board
  ON lights_out_scores (rules, score DESC, created_at, user_id);
