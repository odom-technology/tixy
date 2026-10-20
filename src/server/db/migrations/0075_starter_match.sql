-- Score-only contributor example. No wallet, XP, quest, or paid-board writers.
CREATE TABLE IF NOT EXISTS starter_match_sessions (
  id TEXT PRIMARY KEY REFERENCES game_sessions(id) ON DELETE CASCADE,
  rules INTEGER NOT NULL CHECK (rules > 0)
);

CREATE TABLE IF NOT EXISTS starter_match_runs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES arcade_accounts(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  rules INTEGER NOT NULL CHECK (rules > 0),
  choices_json TEXT NOT NULL,
  score INTEGER NOT NULL CHECK (score BETWEEN 0 AND 800),
  created_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS starter_match_scores (
  user_id TEXT NOT NULL REFERENCES arcade_accounts(id) ON DELETE CASCADE,
  rules INTEGER NOT NULL CHECK (rules > 0),
  user_name TEXT NOT NULL,
  score INTEGER NOT NULL CHECK (score BETWEEN 0 AND 800),
  created_at BIGINT NOT NULL,
  PRIMARY KEY (user_id, rules)
);

CREATE INDEX IF NOT EXISTS idx_starter_match_board
  ON starter_match_scores (rules, score DESC, created_at, user_id);
