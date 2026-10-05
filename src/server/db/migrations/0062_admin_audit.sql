-- One audit log for every admin write. Append-only: no code path updates or
-- deletes a row here, and none should be added. Corrections are new rows.
-- `status` is the HTTP status the route returned, so refused attempts (4xx)
-- are kept next to the ones that went through.
CREATE TABLE IF NOT EXISTS admin_audit_log (
  id BIGSERIAL PRIMARY KEY,
  created_at BIGINT NOT NULL,
  actor_user_id TEXT NOT NULL,
  actor_name TEXT,
  action TEXT NOT NULL,
  method TEXT NOT NULL,
  route TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  reason TEXT,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  status INT NOT NULL,
  correlation_id TEXT
);

CREATE INDEX IF NOT EXISTS idx_admin_audit_created ON admin_audit_log(created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_admin_audit_target ON admin_audit_log(target_type, target_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_audit_actor ON admin_audit_log(actor_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_audit_action ON admin_audit_log(action, created_at DESC);
