-- Versioned legal-policy acceptance history. This migration is additive.
-- A single registration checkbox for Terms also covers Refund and Acceptable Use.
CREATE TABLE IF NOT EXISTS policy_acceptances (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  policy_key TEXT NOT NULL CHECK(policy_key IN ('TERMS','PRIVACY','REFUND','ACCEPTABLE_USE')),
  policy_version TEXT NOT NULL,
  accepted_at TEXT NOT NULL,
  accepted_via TEXT NOT NULL CHECK(accepted_via IN ('REGISTRATION','IN_APP')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, policy_key, policy_version)
);
CREATE INDEX IF NOT EXISTS idx_policy_acceptances_user
  ON policy_acceptances(user_id, accepted_at DESC);
CREATE INDEX IF NOT EXISTS idx_policy_acceptances_policy
  ON policy_acceptances(policy_key, policy_version, accepted_at DESC);
