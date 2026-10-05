CREATE TABLE IF NOT EXISTS arcade_feedback (
  id TEXT PRIMARY KEY,
  date_key TEXT NOT NULL,
  user_id TEXT,
  user_name TEXT,
  email TEXT,
  category TEXT NOT NULL,
  rating INTEGER,
  message TEXT NOT NULL,
  page_path TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  user_agent TEXT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_arcade_feedback_date
  ON arcade_feedback(date_key, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_arcade_feedback_user
  ON arcade_feedback(user_id, created_at DESC);
