import type Database from 'better-sqlite3';

export function runDatabaseMigrations(db: InstanceType<typeof Database>): void {

function hasColumn(table: string, column: string): boolean {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).some((item) => item.name === column);
}

// Backwards-compatible, additive upgrades for databases created by earlier local releases.
const userSql = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='app_user'").get() as { sql?: string } | undefined;
if (userSql?.sql?.includes('CHECK (id = 1)') || userSql?.sql?.includes('CHECK(id = 1)')) {
  db.exec(`
    BEGIN IMMEDIATE;
    CREATE TABLE app_user_multi (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO app_user_multi(id, username, password_hash, created_at)
      SELECT id, username, password_hash, created_at FROM app_user;
    DROP TABLE app_user;
    ALTER TABLE app_user_multi RENAME TO app_user;
    COMMIT;
  `);
}
if (!hasColumn('app_user', 'email')) db.exec('ALTER TABLE app_user ADD COLUMN email TEXT');
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_app_user_email ON app_user(email COLLATE NOCASE) WHERE email IS NOT NULL');
if (!hasColumn('sessions', 'user_id')) db.exec('ALTER TABLE sessions ADD COLUMN user_id INTEGER NOT NULL DEFAULT 1');
if (!hasColumn('semesters', 'user_id')) db.exec('ALTER TABLE semesters ADD COLUMN user_id INTEGER NOT NULL DEFAULT 1');
if (!hasColumn('attendance', 'subject_id')) db.exec('ALTER TABLE attendance ADD COLUMN subject_id INTEGER REFERENCES subjects(id) ON DELETE SET NULL');
db.exec('CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id)');
db.exec('CREATE INDEX IF NOT EXISTS idx_semesters_user ON semesters(user_id, start_date DESC)');
db.exec('CREATE INDEX IF NOT EXISTS idx_attendance_subject ON attendance(semester_id, subject_id, attendance_date)');
db.exec('CREATE INDEX IF NOT EXISTS idx_subjects_semester ON subjects(semester_id, name)');
db.exec('CREATE INDEX IF NOT EXISTS idx_timetable_subjects_semester ON timetable_subjects(semester_id, weekday, class_number)');



}
