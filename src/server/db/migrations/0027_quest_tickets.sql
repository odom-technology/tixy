-- Daily quests now also pay out Tickets (credits) on claim, in addition to
-- season XP. reward_tickets is the per-quest credit grant.
ALTER TABLE user_daily_quests
  ADD COLUMN IF NOT EXISTS reward_tickets INTEGER NOT NULL DEFAULT 0;
