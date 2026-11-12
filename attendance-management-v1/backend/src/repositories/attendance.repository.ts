import db from '../database/connection.js';
import type { AttendanceInput, AttendanceRecord } from '../models/attendance.model.js';
import type { AttendanceStatus } from '../config/constants.js';

export function listAttendanceForSemester(semesterId: number): Array<{ status: AttendanceStatus; attendance_date: string }> {
  return db.prepare('SELECT status, attendance_date FROM attendance WHERE semester_id = ?').all(semesterId) as Array<{ status: AttendanceStatus; attendance_date: string }>;
}

export function listAttendanceForSubject(semesterId: number, subjectId: number): Array<{ status: AttendanceStatus }> {
  return db.prepare('SELECT status FROM attendance WHERE semester_id = ? AND subject_id = ?').all(semesterId, subjectId) as Array<{ status: AttendanceStatus }>;
}

export function countAttendanceBetween(semesterId: number, startDate: string, endDate: string): number {
  return (db.prepare(`SELECT COUNT(*) AS n FROM attendance WHERE semester_id = ? AND attendance_date >= ? AND attendance_date <= ?`)
    .get(semesterId, startDate, endDate) as { n: number }).n;
}

export function countAttendance(semesterId: number): number {
  return (db.prepare('SELECT COUNT(*) AS n FROM attendance WHERE semester_id = ?').get(semesterId) as { n: number }).n;
}

export function countRecordedDays(semesterId: number): number {
  return (db.prepare('SELECT COUNT(DISTINCT attendance_date) AS n FROM attendance WHERE semester_id = ?').get(semesterId) as { n: number }).n;
}

export function getDayAttendanceRows(semesterId: number): Array<{ attendance_date: string; recorded_slots: number; present_slots: number; holiday_slots: number }> {
  return db.prepare(`SELECT attendance_date,
      COUNT(*) AS recorded_slots,
      SUM(CASE WHEN status='PRESENT' THEN 1 ELSE 0 END) AS present_slots,
      SUM(CASE WHEN status='HOLIDAY' THEN 1 ELSE 0 END) AS holiday_slots
    FROM attendance WHERE semester_id=? GROUP BY attendance_date`).all(semesterId) as Array<{ attendance_date: string; recorded_slots: number; present_slots: number; holiday_slots: number }>;
}

export function getSubjectScheduledSlots(semesterId: number, subjectId: number): Array<{ weekday: number; slots: number }> {
  return db.prepare(`SELECT weekday, COUNT(*) AS slots FROM timetable_subjects
    WHERE semester_id = ? AND subject_id = ? GROUP BY weekday`).all(semesterId, subjectId) as Array<{ weekday: number; slots: number }>;
}

export function countSubjectAttendanceBetween(semesterId: number, subjectId: number, startDate: string, endDate: string): number {
  return (db.prepare(`SELECT COUNT(*) AS n FROM attendance a
    WHERE a.semester_id = ? AND a.subject_id = ? AND a.attendance_date >= ? AND a.attendance_date <= ?`)
    .get(semesterId, subjectId, startDate, endDate) as { n: number }).n;
}

export function listAttendanceForDate(semesterId: number, date: string): Array<{ class_number: number; status: AttendanceStatus }> {
  return db.prepare('SELECT class_number,status FROM attendance WHERE semester_id=? AND attendance_date=?')
    .all(semesterId, date) as Array<{ class_number: number; status: AttendanceStatus }>;
}

export function saveAttendance(semesterId: number, date: string, weekday: number, entries: AttendanceInput[]): void {
  const upsert = db.prepare(`INSERT INTO attendance(semester_id,attendance_date,class_number,status,subject_id,updated_at)
    VALUES(?,?,?,?,(SELECT subject_id FROM timetable_subjects WHERE semester_id=? AND weekday=? AND class_number=?),CURRENT_TIMESTAMP)
    ON CONFLICT(semester_id,attendance_date,class_number) DO UPDATE SET
      status=excluded.status, subject_id=COALESCE(excluded.subject_id,attendance.subject_id), updated_at=CURRENT_TIMESTAMP`);
  const remove = db.prepare('DELETE FROM attendance WHERE semester_id=? AND attendance_date=? AND class_number=?');
  const tx = db.transaction(() => entries.forEach((entry) => {
    if (entry.status === null) remove.run(semesterId, date, entry.classNumber);
    else upsert.run(semesterId, date, entry.classNumber, entry.status, semesterId, weekday, entry.classNumber);
  }));
  tx();
}

export function getSavedAttendanceForDate(semesterId: number, date: string): Array<{ class_number: number; status: AttendanceStatus }> {
  return db.prepare('SELECT class_number,status FROM attendance WHERE semester_id=? AND attendance_date=? ORDER BY class_number')
    .all(semesterId, date) as Array<{ class_number: number; status: AttendanceStatus }>;
}

export function listAttendanceForJson(semesterId: number): unknown[] {
  return db.prepare(`SELECT a.attendance_date,a.class_number,a.status,a.subject_id,s.name AS subject_name,s.code AS subject_code
    FROM attendance a LEFT JOIN subjects s ON s.id=a.subject_id WHERE a.semester_id=? ORDER BY a.attendance_date,a.class_number`)
    .all(semesterId);
}

export function getMonthlyAttendanceRows(semesterId: number, massBunkPolicy: string): any[] {
  return db.prepare(`SELECT substr(attendance_date,1,7) AS month,
    SUM(CASE WHEN status='PRESENT' THEN 1 ELSE 0 END) AS present,
    SUM(CASE WHEN status='ABSENT' THEN 1 ELSE 0 END) AS absent,
    SUM(CASE WHEN status='MASS_BUNK' THEN 1 ELSE 0 END) AS massBunk,
    SUM(CASE WHEN status='HOLIDAY' THEN 1 ELSE 0 END) AS holiday,
    SUM(CASE WHEN status='PRESENT' THEN 1 WHEN status='ABSENT' THEN 1 WHEN status='MASS_BUNK' AND ?='ABSENT' THEN 1 ELSE 0 END) AS total
    FROM attendance WHERE semester_id=? GROUP BY substr(attendance_date,1,7) ORDER BY month`)
    .all(massBunkPolicy, semesterId) as any[];
}
