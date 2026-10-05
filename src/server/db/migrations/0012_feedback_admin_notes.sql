ALTER TABLE arcade_feedback
  ADD COLUMN IF NOT EXISTS admin_note TEXT;

ALTER TABLE arcade_feedback
  ADD COLUMN IF NOT EXISTS status_updated_by TEXT;

ALTER TABLE arcade_feedback
  ADD COLUMN IF NOT EXISTS status_updated_at BIGINT;
