-- Email verification / password recovery OTPs and persistent authentication rate limits.
-- OTP values are never stored in plaintext. Pending registration payloads contain
-- a bcrypt password hash only, never a raw password.

CREATE TABLE IF NOT EXISTS auth_email_otps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL COLLATE NOCASE,
  purpose TEXT NOT NULL CHECK (purpose IN ('REGISTER','PASSWORD_RESET','ADMIN_LOGIN')),
  otp_hash TEXT NOT NULL,
  otp_salt TEXT NOT NULL,
  payload_json TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count BETWEEN 0 AND 5),
  expires_at TEXT NOT NULL,
  sent_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  consumed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_auth_email_otps_lookup
  ON auth_email_otps(email, purpose, created_at DESC, consumed_at, expires_at);
CREATE INDEX IF NOT EXISTS idx_auth_email_otps_expiry
  ON auth_email_otps(expires_at);

CREATE TABLE IF NOT EXISTS auth_rate_limits (
  key_hash TEXT PRIMARY KEY,
  window_start_epoch INTEGER NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_auth_rate_limits_updated
  ON auth_rate_limits(updated_at);

CREATE INDEX IF NOT EXISTS idx_app_user_email_verified
  ON app_user(email, email_verified_at);
