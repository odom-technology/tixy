-- The daily spin (docs/design/tixy-rebrand/DAILY_WHEEL.md): the claim is a
-- wheel the server draws. Each claim row keeps the drawn unit (0 to 49), the
-- slot's base value, the streak multiplier and the wheel layout's version.
-- Older rows (the flat ladder) keep NULLs. Additive only.
ALTER TABLE daily_credit_claims
  ADD COLUMN IF NOT EXISTS wheel_unit SMALLINT;
ALTER TABLE daily_credit_claims
  ADD COLUMN IF NOT EXISTS wheel_value INTEGER;
ALTER TABLE daily_credit_claims
  ADD COLUMN IF NOT EXISTS wheel_multiplier SMALLINT;
ALTER TABLE daily_credit_claims
  ADD COLUMN IF NOT EXISTS wheel_version SMALLINT;
