-- Defense-in-depth: enforce non-negative balances at the database level.
--
-- Balance integrity is currently guaranteed only in application code
-- (mutateWalletAndLedger plus the FOR UPDATE row locks). These CHECK constraints
-- add a second line of defense so that any path -- a future bug, a manual psql
-- fix, or a job that bypasses the wallet helper -- cannot drive a currency
-- balance below zero.
--
-- Each constraint is added NOT VALID so this migration can never fail on a
-- pre-existing row: it is enforced for every new INSERT/UPDATE immediately,
-- while legacy rows are left unvalidated (they can be checked later with
-- ALTER TABLE ... VALIDATE CONSTRAINT once confirmed clean). Postgres has no
-- ADD CONSTRAINT ... IF NOT EXISTS, so each ADD is wrapped in a DO block keyed
-- on conname, making the migration safe to re-run.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'wallets_credits_nonneg') THEN
    ALTER TABLE wallets
      ADD CONSTRAINT wallets_credits_nonneg CHECK (credits >= 0) NOT VALID;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'wallets_store_credits_nonneg') THEN
    ALTER TABLE wallets
      ADD CONSTRAINT wallets_store_credits_nonneg CHECK (store_credits >= 0) NOT VALID;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'wallets_wupiupi_nonneg') THEN
    ALTER TABLE wallets
      ADD CONSTRAINT wallets_wupiupi_nonneg CHECK (wupiupi >= 0) NOT VALID;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'currency_ledger_balance_after_nonneg') THEN
    ALTER TABLE currency_ledger
      ADD CONSTRAINT currency_ledger_balance_after_nonneg CHECK (balance_after >= 0) NOT VALID;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'store_credit_ledger_balance_after_nonneg') THEN
    ALTER TABLE store_credit_ledger
      ADD CONSTRAINT store_credit_ledger_balance_after_nonneg CHECK (balance_after >= 0) NOT VALID;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_entitlement_ledger_balance_after_nonneg') THEN
    ALTER TABLE user_entitlement_ledger
      ADD CONSTRAINT user_entitlement_ledger_balance_after_nonneg CHECK (balance_after >= 0) NOT VALID;
  END IF;
END $$;
