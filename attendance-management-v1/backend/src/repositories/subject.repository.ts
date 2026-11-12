import db from '../database/connection.js';
import type { SubjectRecord, } from '../models/subject.model.js';
import type { SubjectTimetableSlot } from '../models/semester.model.js';

export function listSubjects(semesterId: number): SubjectRecord[] {
  return db.prepare('SELECT * FROM subjects WHERE semester_id = ? ORDER BY name COLLATE NOCASE')
    .all(semesterId) as SubjectRecord[];
}

export function findSubject(subjectId: number, semesterId: number): SubjectRecord | undefined {
  return db.prepare('SELECT * FROM subjects WHERE id = ? AND semester_id = ?')
    .get(subjectId, semesterId) as SubjectRecord | undefined;
}

export function createSubject(input: { semesterId: number; name: string; code: string | null; targetPercentage: number | null }): number {
  const info = db.prepare('INSERT INTO subjects(semester_id,name,code,target_percentage) VALUES(?,?,?,?)')
    .run(input.semesterId, input.name, input.code, input.targetPercentage);
  return Number(info.lastInsertRowid);
}

export function updateSubject(subjectId: number, semesterId: number, input: { name: string; code: string | null; targetPercentage: number | null }): void {
  db.prepare('UPDATE subjects SET name=?,code=?,target_percentage=? WHERE id=? AND semester_id=?')
    .run(input.name, input.code, input.targetPercentage, subjectId, semesterId);
}

export function countSubjectTimetableAssignments(subjectId: number, semesterId: number): number {
  const row = db.prepare('SELECT COUNT(*) AS count FROM timetable_subjects WHERE semester_id=? AND subject_id=?')
    .get(semesterId, subjectId) as { count: number } | undefined;
  return Number(row?.count ?? 0);
}

export function countSubjectAttendanceRecords(subjectId: number, semesterId: number): number {
  const row = db.prepare('SELECT COUNT(*) AS count FROM attendance WHERE semester_id=? AND subject_id=?')
    .get(semesterId, subjectId) as { count: number } | undefined;
  return Number(row?.count ?? 0);
}

export function deleteSubject(subjectId: number, semesterId: number): number {
  // Atomic reference checks prevent ON DELETE SET NULL from erasing historical links.
  return db.prepare(`DELETE FROM subjects WHERE id=? AND semester_id=?
    AND NOT EXISTS (SELECT 1 FROM timetable_subjects WHERE semester_id=? AND subject_id=?)
    AND NOT EXISTS (SELECT 1 FROM attendance WHERE semester_id=? AND subject_id=?)`)
    .run(subjectId, semesterId, semesterId, subjectId, semesterId, subjectId).changes;
}

export function listSubjectTimetable(semesterId: number): unknown[] {
  return db.prepare(`SELECT weekday, class_number, subject_id FROM timetable_subjects
    WHERE semester_id = ? AND subject_id IS NOT NULL ORDER BY weekday, class_number`).all();
}

export function saveSubjectTimetable(semesterId: number, slots: SubjectTimetableSlot[]): void {
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM timetable_subjects WHERE semester_id=?').run(semesterId);
    const insert = db.prepare('INSERT INTO timetable_subjects(semester_id,weekday,class_number,subject_id) VALUES(?,?,?,?)');
    for (const slot of slots) {
      if (slot.subjectId !== null && slot.subjectId !== undefined) insert.run(semesterId, slot.weekday, slot.classNumber, slot.subjectId);
    }
  });
  tx();
}

export function getSubjectTimetableMapping(semesterId: number, date: string): Array<{ class_number: number; id: number; name: string; code: string | null }> {
  const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
  return db.prepare(`SELECT class_number, id, name, code FROM (
      SELECT a.class_number, s.id, s.name, s.code, 1 AS priority
      FROM attendance a JOIN subjects s ON s.id=a.subject_id
      WHERE a.semester_id=? AND a.attendance_date=?
      UNION ALL
      SELECT ts.class_number, s.id, s.name, s.code, 2 AS priority
      FROM timetable_subjects ts JOIN subjects s ON s.id=ts.subject_id
      WHERE ts.semester_id=? AND ts.weekday=?
    ) ORDER BY priority`).all(semesterId, date, semesterId, weekday) as Array<{ class_number: number; id: number; name: string; code: string | null }>;
}

export function applySubjectTimetable(semesterId: number): number {
  return db.prepare(`UPDATE attendance AS a
    SET subject_id = (
      SELECT ts.subject_id FROM timetable_subjects ts
      WHERE ts.semester_id = a.semester_id
        AND ts.weekday = CAST(strftime('%w', a.attendance_date) AS INTEGER)
        AND ts.class_number = a.class_number
    )
    WHERE a.semester_id = ? AND a.subject_id IS NULL
      AND EXISTS (
        SELECT 1 FROM timetable_subjects ts
        WHERE ts.semester_id = a.semester_id
          AND ts.weekday = CAST(strftime('%w', a.attendance_date) AS INTEGER)
          AND ts.class_number = a.class_number
          AND ts.subject_id IS NOT NULL
      )`).run(semesterId).changes;
}
