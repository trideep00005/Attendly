export const BASE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS app_user (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  email TEXT UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token_hash TEXT NOT NULL UNIQUE,
  user_id INTEGER NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
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
CREATE TABLE IF NOT EXISTS timetable (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  semester_id INTEGER NOT NULL REFERENCES semesters(id) ON DELETE CASCADE,
  weekday INTEGER NOT NULL CHECK(weekday BETWEEN 0 AND 6),
  class_count INTEGER NOT NULL CHECK(class_count BETWEEN 0 AND 5),
  UNIQUE(semester_id, weekday)
);
CREATE TABLE IF NOT EXISTS attendance (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  semester_id INTEGER NOT NULL REFERENCES semesters(id) ON DELETE CASCADE,
  attendance_date TEXT NOT NULL,
  class_number INTEGER NOT NULL CHECK(class_number BETWEEN 1 AND 5),
  status TEXT NOT NULL CHECK(status IN ('PRESENT','ABSENT','HOLIDAY','MASS_BUNK')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(semester_id, attendance_date, class_number)
);
CREATE INDEX IF NOT EXISTS idx_attendance_semester_date ON attendance(semester_id, attendance_date);
CREATE TABLE IF NOT EXISTS subjects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  semester_id INTEGER NOT NULL REFERENCES semesters(id) ON DELETE CASCADE,
  name TEXT NOT NULL COLLATE NOCASE,
  code TEXT,
  target_percentage REAL CHECK(target_percentage IS NULL OR (target_percentage >= 1 AND target_percentage <= 100)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(semester_id, name)
);
CREATE TABLE IF NOT EXISTS timetable_subjects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  semester_id INTEGER NOT NULL REFERENCES semesters(id) ON DELETE CASCADE,
  weekday INTEGER NOT NULL CHECK(weekday BETWEEN 0 AND 6),
  class_number INTEGER NOT NULL CHECK(class_number BETWEEN 1 AND 5),
  subject_id INTEGER REFERENCES subjects(id) ON DELETE SET NULL,
  UNIQUE(semester_id, weekday, class_number)
);
`;
