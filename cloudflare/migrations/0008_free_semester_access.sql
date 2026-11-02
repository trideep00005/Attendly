-- Free plan semester workspace selection.
-- All historical semesters remain visible. A Free student can edit one selected
-- semester; the remaining semesters are read-only until Pro access is active.

CREATE TABLE IF NOT EXISTS user_semester_preferences (
  user_id INTEGER PRIMARY KEY REFERENCES app_user(id) ON DELETE CASCADE,
  free_active_semester_id INTEGER REFERENCES semesters(id) ON DELETE SET NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Existing users who already have multiple semesters keep all of them. The most
-- recently created semester becomes the initial Free workspace if/when Pro expires.
INSERT OR IGNORE INTO user_semester_preferences(user_id, free_active_semester_id)
SELECT u.id,
  (SELECT s.id FROM semesters s WHERE s.user_id=u.id ORDER BY s.created_at DESC, s.id DESC LIMIT 1)
FROM app_user u
WHERE u.role='STUDENT'
  AND EXISTS (SELECT 1 FROM semesters s WHERE s.user_id=u.id);

CREATE INDEX IF NOT EXISTS idx_user_semester_preferences_active
  ON user_semester_preferences(free_active_semester_id);
