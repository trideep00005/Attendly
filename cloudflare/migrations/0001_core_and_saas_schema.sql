-- Attendly Cloud schema foundation.
-- This is a fresh D1 schema. Existing local data is imported separately by
-- tools/export-local-db-for-d1.mjs after this migration has been applied.

CREATE TABLE IF NOT EXISTS app_user (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  email TEXT UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'STUDENT' CHECK(role IN ('STUDENT','SUPPORT_ADMIN','ADMIN','SUPER_ADMIN')),
  account_status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(account_status IN ('ACTIVE','SUSPENDED','DEACTIVATED')),
  email_verified_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token_hash TEXT NOT NULL UNIQUE,
  user_id INTEGER NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_sessions_user_expiry ON sessions(user_id, expires_at);

CREATE TABLE IF NOT EXISTS semesters (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  target_percentage REAL NOT NULL DEFAULT 70,
  mass_bunk_policy TEXT NOT NULL DEFAULT 'ABSENT' CHECK(mass_bunk_policy IN ('ABSENT','EXCLUDE')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK(start_date <= end_date)
);
CREATE INDEX IF NOT EXISTS idx_semesters_user_dates ON semesters(user_id, start_date DESC);

CREATE TABLE IF NOT EXISTS timetable (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  semester_id INTEGER NOT NULL REFERENCES semesters(id) ON DELETE CASCADE,
  weekday INTEGER NOT NULL CHECK(weekday BETWEEN 0 AND 6),
  class_count INTEGER NOT NULL CHECK(class_count BETWEEN 0 AND 5),
  UNIQUE(semester_id, weekday)
);

CREATE TABLE IF NOT EXISTS subjects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  semester_id INTEGER NOT NULL REFERENCES semesters(id) ON DELETE CASCADE,
  name TEXT NOT NULL COLLATE NOCASE,
  code TEXT,
  target_percentage REAL CHECK(target_percentage IS NULL OR (target_percentage >= 1 AND target_percentage <= 100)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(semester_id, name)
);
CREATE INDEX IF NOT EXISTS idx_subjects_semester ON subjects(semester_id, name);

CREATE TABLE IF NOT EXISTS timetable_subjects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  semester_id INTEGER NOT NULL REFERENCES semesters(id) ON DELETE CASCADE,
  weekday INTEGER NOT NULL CHECK(weekday BETWEEN 0 AND 6),
  class_number INTEGER NOT NULL CHECK(class_number BETWEEN 1 AND 5),
  subject_id INTEGER REFERENCES subjects(id) ON DELETE SET NULL,
  UNIQUE(semester_id, weekday, class_number)
);

-- Legacy MASS_BUNK is retained only for historical migration compatibility.
-- The new Other/custom-category UI is introduced in a later schema version.
CREATE TABLE IF NOT EXISTS attendance (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  semester_id INTEGER NOT NULL REFERENCES semesters(id) ON DELETE CASCADE,
  attendance_date TEXT NOT NULL,
  class_number INTEGER NOT NULL CHECK(class_number BETWEEN 1 AND 5),
  status TEXT NOT NULL CHECK(status IN ('PRESENT','ABSENT','HOLIDAY','MASS_BUNK','OTHER')),
  subject_id INTEGER REFERENCES subjects(id) ON DELETE SET NULL,
  category_id INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(semester_id, attendance_date, class_number)
);
CREATE INDEX IF NOT EXISTS idx_attendance_semester_date ON attendance(semester_id, attendance_date);
CREATE INDEX IF NOT EXISTS idx_attendance_subject ON attendance(semester_id, subject_id, attendance_date);

CREATE TABLE IF NOT EXISTS attendance_categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  semester_id INTEGER REFERENCES semesters(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  attendance_effect TEXT NOT NULL DEFAULT 'EXCLUDE' CHECK(attendance_effect IN ('PRESENT','ABSENT','EXCLUDE')),
  is_system INTEGER NOT NULL DEFAULT 0 CHECK(is_system IN (0,1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, semester_id, name)
);

CREATE TABLE IF NOT EXISTS subscription_plans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  price_inr INTEGER NOT NULL CHECK(price_inr >= 0),
  duration_days INTEGER,
  tier TEXT NOT NULL CHECK(tier IN ('FREE','PRO')),
  features_json TEXT NOT NULL DEFAULT '{}',
  enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS user_subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  plan_id INTEGER NOT NULL REFERENCES subscription_plans(id),
  status TEXT NOT NULL CHECK(status IN ('PENDING','ACTIVE','EXPIRED','CANCELLED','REJECTED','SUPERSEDED')),
  starts_at TEXT,
  expires_at TEXT,
  amount_paid_inr INTEGER NOT NULL DEFAULT 0,
  payment_transaction_id INTEGER,
  activated_by INTEGER REFERENCES app_user(id),
  activation_reason TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_user_subscriptions_current ON user_subscriptions(user_id, status, expires_at);

CREATE TABLE IF NOT EXISTS payment_claims (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  plan_id INTEGER NOT NULL REFERENCES subscription_plans(id),
  expected_amount_inr INTEGER NOT NULL CHECK(expected_amount_inr > 0),
  utr_reference TEXT,
  student_note TEXT,
  status TEXT NOT NULL DEFAULT 'SUBMITTED' CHECK(status IN ('SUBMITTED','UNDER_REVIEW','APPROVED','REJECTED')),
  rejection_reason TEXT,
  reviewed_by INTEGER REFERENCES app_user(id),
  reviewed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_payment_claims_status ON payment_claims(status, created_at);
CREATE INDEX IF NOT EXISTS idx_payment_claims_user ON payment_claims(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS payment_transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES app_user(id),
  plan_id INTEGER NOT NULL REFERENCES subscription_plans(id),
  payment_claim_id INTEGER UNIQUE REFERENCES payment_claims(id),
  amount_inr INTEGER NOT NULL CHECK(amount_inr > 0),
  utr_reference TEXT NOT NULL UNIQUE,
  verified_by INTEGER NOT NULL REFERENCES app_user(id),
  verified_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_payment_transactions_user ON payment_transactions(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS admin_permission_overrides (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  admin_user_id INTEGER NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  permission_key TEXT NOT NULL,
  allowed INTEGER NOT NULL CHECK(allowed IN (0,1)),
  updated_by INTEGER NOT NULL REFERENCES app_user(id),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(admin_user_id, permission_key)
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_user_id INTEGER REFERENCES app_user(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  reason TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor ON audit_logs(actor_user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS app_settings (
  setting_key TEXT PRIMARY KEY,
  setting_value TEXT NOT NULL,
  updated_by INTEGER REFERENCES app_user(id),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  scheduled_for TEXT,
  sent_at TEXT,
  read_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, read_at, created_at DESC);
