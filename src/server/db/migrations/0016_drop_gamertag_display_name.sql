-- Identity is username-only. Before dropping the legacy columns, give every
-- account a username so the drop never strands a row, regardless of whether
-- scripts/backfill-usernames.ts already ran. Derivation mirrors that script:
-- username -> gamertag -> display_name -> email local part, sanitized to
-- USERNAME_RE's alphabet, reserved names skipped, numeric suffix on
-- username_normalized collisions. (The TS script additionally folds
-- diacritics; running it first is still the nicer path.)
--
-- The whole backfill is guarded + dynamic so this migration also applies
-- cleanly on fresh databases whose arcade_accounts was created without the
-- legacy columns (ensureAccountSchema in new code).
DO $$
DECLARE
  r RECORD;
  candidate TEXT;
  base TEXT;
  new_username TEXT;
  new_normalized TEXT;
  n INT;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'arcade_accounts' AND column_name = 'gamertag'
  ) THEN
    RETURN;
  END IF;

  FOR r IN EXECUTE
    'SELECT id, email, username, gamertag, display_name
     FROM arcade_accounts
     WHERE username IS NULL OR username_normalized IS NULL
     ORDER BY created_at'
  LOOP
    base := NULL;
    FOREACH candidate IN ARRAY ARRAY[
      r.username, r.gamertag, r.display_name, split_part(r.email, '@', 1)
    ]
    LOOP
      CONTINUE WHEN candidate IS NULL;
      candidate := regexp_replace(btrim(candidate), '\s+', '-', 'g');
      candidate := regexp_replace(candidate, '[^a-zA-Z0-9_-]', '', 'g');
      candidate := left(candidate, 24);
      IF length(candidate) >= 3 AND lower(candidate) NOT IN (
        'admin', 'administrator', 'api', 'arcade', 'me',
        'root', 'staff', 'support', 'system'
      ) THEN
        base := candidate;
        EXIT;
      END IF;
    END LOOP;

    IF base IS NULL THEN
      base := 'player-' || left(regexp_replace(r.id, '[^a-zA-Z0-9]', '', 'g'), 8);
    END IF;

    new_username := base;
    new_normalized := lower(new_username);
    n := 2;
    WHILE EXISTS (
      SELECT 1 FROM arcade_accounts
      WHERE username_normalized = new_normalized AND id <> r.id
    ) LOOP
      new_username := left(base, 24 - length(n::text)) || n::text;
      new_normalized := lower(new_username);
      n := n + 1;
    END LOOP;

    UPDATE arcade_accounts
    SET username = new_username,
        username_normalized = new_normalized,
        updated_at = (extract(epoch FROM now()) * 1000)::bigint
    WHERE id = r.id;
  END LOOP;
END $$;

ALTER TABLE arcade_accounts DROP COLUMN IF EXISTS gamertag;
ALTER TABLE arcade_accounts DROP COLUMN IF EXISTS display_name;
