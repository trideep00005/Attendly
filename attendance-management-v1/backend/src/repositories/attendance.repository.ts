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

export function listAttendanceForCsv(semesterId: number): Array<{ attendance_date: string; class_number: number; status: AttendanceStatus; subject: string }> {
  return db.prepare(`SELECT a.attendance_date,a.class_number,a.status,COALESCE(s.name,'Unassigned') AS subject
    FROM attendance a LEFT JOIN subjects s ON s.id=a.subject_id WHERE a.semester_id=? ORDER BY a.attendance_date,a.class_number`)
    .all(semesterId) as Array<{ attendance_date: string; class_number: number; status: AttendanceStatus; subject: string }>;
}

export function listAttendanceForJson(semesterId: number): unknown[] {
  return db.prepare(`SELECT a.attendance_date,a.class_number,a.status,a.subject_id,s.name AS subject_name,s.code AS subject_code
    FROM attendance a LEFT JOIN subjects s ON s.id=a.subject_id WHERE a.semester_id=? ORDER BY a.attendance_date,a.class_number`)
    .all(semesterId);
}

export function listUserBackupData(userId: number): Record<string, unknown> {
  return {
    version: 2,
    exportedAt: new Date().toISOString(),
    semesters: db.prepare('SELECT * FROM semesters WHERE user_id = ? ORDER BY id').all(userId),
    timetable: db.prepare('SELECT t.* FROM timetable t JOIN semesters s ON s.id=t.semester_id WHERE s.user_id = ? ORDER BY t.id').all(userId),
    subjects: db.prepare('SELECT sub.* FROM subjects sub JOIN semesters s ON s.id=sub.semester_id WHERE s.user_id = ? ORDER BY sub.id').all(userId),
    subjectTimetable: db.prepare('SELECT ts.* FROM timetable_subjects ts JOIN semesters s ON s.id=ts.semester_id WHERE s.user_id = ? ORDER BY ts.id').all(userId),
    attendance: db.prepare('SELECT a.* FROM attendance a JOIN semesters s ON s.id=a.semester_id WHERE s.user_id = ? ORDER BY a.attendance_date,a.class_number').all(userId),
  };
}

export function restoreUserBackup(userId: number, data: {
  semesters: any[]; timetable: any[]; subjects: any[]; subjectTimetable: any[]; attendance: any[];
}): void {
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM semesters WHERE user_id = ?').run(userId);
    const sem = db.prepare('INSERT INTO semesters(user_id,name,start_date,end_date,target_percentage,mass_bunk_policy,created_at) VALUES(?,?,?,?,?,?,?)');
    const time = db.prepare('INSERT INTO timetable(semester_id,weekday,class_count) VALUES(?,?,?)');
    const subj = db.prepare('INSERT INTO subjects(semester_id,name,code,target_percentage,created_at) VALUES(?,?,?,?,?)');
    const subjectTime = db.prepare('INSERT INTO timetable_subjects(semester_id,weekday,class_number,subject_id) VALUES(?,?,?,?)');
    const att = db.prepare('INSERT INTO attendance(semester_id,attendance_date,class_number,status,subject_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?)');
    const semesterIdMap = new Map<number, number>();
    const subjectIdMap = new Map<number, number>();
    for (const semester of data.semesters) {
      const info = sem.run(userId, semester.name, semester.start_date, semester.end_date, semester.target_percentage, semester.mass_bunk_policy, semester.created_at ?? new Date().toISOString());
      semesterIdMap.set(semester.id, Number(info.lastInsertRowid));
    }
    for (const row of data.timetable) {
      const newSemesterId = semesterIdMap.get(row.semester_id);
      if (!newSemesterId) throw new Error('Invalid timetable data in backup.');
      time.run(newSemesterId, row.weekday, row.class_count);
    }
    for (const subject of data.subjects) {
      const newSemesterId = semesterIdMap.get(subject.semester_id);
      if (!newSemesterId) throw new Error('Invalid subject data in backup.');
      const info = subj.run(newSemesterId, subject.name, subject.code ?? null, subject.target_percentage ?? null, subject.created_at ?? new Date().toISOString());
      subjectIdMap.set(subject.id, Number(info.lastInsertRowid));
    }
    for (const slot of data.subjectTimetable) {
      const newSemesterId = semesterIdMap.get(slot.semester_id);
      const newSubjectId = subjectIdMap.get(slot.subject_id);
      if (!newSemesterId || !newSubjectId) throw new Error('Invalid subject timetable data in backup.');
      subjectTime.run(newSemesterId, slot.weekday, slot.class_number, newSubjectId);
    }
    for (const item of data.attendance) {
      const newSemesterId = semesterIdMap.get(item.semester_id);
      const newSubjectId = item.subject_id == null ? null : (subjectIdMap.get(item.subject_id) ?? null);
      if (!newSemesterId) throw new Error('Invalid attendance data in backup.');
      att.run(newSemesterId, item.attendance_date, item.class_number, item.status, newSubjectId, item.created_at ?? new Date().toISOString(), item.updated_at ?? new Date().toISOString());
    }
  });
  tx();
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
