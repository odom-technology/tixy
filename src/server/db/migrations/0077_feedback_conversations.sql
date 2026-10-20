-- Ticket replies retain their author and text; only ticket owners/admins can access them.
-- Keep legacy admin_note values intact so existing responses remain visible.
CREATE TABLE IF NOT EXISTS arcade_feedback_comments (
  id TEXT PRIMARY KEY,
  feedback_id TEXT NOT NULL REFERENCES arcade_feedback(id),
  author_user_id TEXT NOT NULL,
  author_name TEXT NOT NULL,
  author_role TEXT NOT NULL CHECK (author_role IN ('player', 'admin')),
  message TEXT NOT NULL CHECK (char_length(message) BETWEEN 1 AND 3000),
  created_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_feedback_comments_ticket
  ON arcade_feedback_comments(feedback_id, created_at, id);
CREATE INDEX IF NOT EXISTS idx_feedback_comments_author
  ON arcade_feedback_comments(author_user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_arcade_feedback_updated
  ON arcade_feedback(updated_at DESC, id);
