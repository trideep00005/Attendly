-- Basic student feedback inbox for authenticated students and administrator review.
CREATE TABLE IF NOT EXISTS student_feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  category TEXT NOT NULL CHECK(category IN ('GENERAL','BUG_REPORT','FEATURE_REQUEST','UI_UX','OTHER')),
  rating INTEGER CHECK(rating IS NULL OR rating BETWEEN 1 AND 5),
  message TEXT NOT NULL CHECK(length(trim(message)) BETWEEN 10 AND 2000),
  contact_allowed INTEGER NOT NULL DEFAULT 0 CHECK(contact_allowed IN (0,1)),
  status TEXT NOT NULL DEFAULT 'NEW' CHECK(status IN ('NEW','REVIEWED')),
  reviewed_by INTEGER REFERENCES app_user(id) ON DELETE SET NULL,
  reviewed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_student_feedback_user_created
  ON student_feedback(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_student_feedback_status_created
  ON student_feedback(status, created_at DESC);
