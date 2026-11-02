-- Replace the legacy Mass Bunk status with the neutral Other category while
-- preserving its previous official attendance treatment.
ALTER TABLE attendance_categories
  ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0,1));

CREATE INDEX IF NOT EXISTS idx_attendance_categories_user_semester_active
  ON attendance_categories(user_id, semester_id, is_active, name);

-- Every existing semester receives a system-owned Other category. Its default
-- effect is EXCLUDE, except legacy semesters where Mass Bunk counted as absent.
INSERT INTO attendance_categories
  (user_id, semester_id, name, description, attendance_effect, is_system, is_active)
SELECT s.user_id, s.id, 'Other', 'Default category for attendance circumstances not covered by the standard statuses.',
       CASE WHEN s.mass_bunk_policy='ABSENT' AND EXISTS (SELECT 1 FROM attendance a WHERE a.semester_id=s.id AND a.status='MASS_BUNK') THEN 'ABSENT' ELSE 'EXCLUDE' END, 1, 1
FROM semesters s
WHERE NOT EXISTS (
  SELECT 1 FROM attendance_categories c
  WHERE c.user_id=s.user_id AND c.semester_id=s.id AND lower(c.name)='other'
);

UPDATE attendance
SET category_id = (
  SELECT c.id FROM attendance_categories c
  WHERE c.semester_id=attendance.semester_id AND lower(c.name)='other' AND c.is_system=1
  LIMIT 1
), status='OTHER'
WHERE status='MASS_BUNK';
