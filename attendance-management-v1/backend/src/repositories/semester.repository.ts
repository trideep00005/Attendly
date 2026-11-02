import db from '../database/connection.js';
import type { SemesterRecord, TimetableDay, TimetableDayInput } from '../models/semester.model.js';

export function findSemesterByIdAndUser(id: number, userId: number): SemesterRecord | undefined {
  return db.prepare('SELECT * FROM semesters WHERE id = ? AND user_id = ?').get(id, userId) as SemesterRecord | undefined;
}

export function listSemestersByUser(userId: number): SemesterRecord[] {
  return db.prepare('SELECT * FROM semesters WHERE user_id = ? ORDER BY start_date DESC').all(userId) as SemesterRecord[];
}

export function createSemester(input: {
  userId: number; name: string; startDate: string; endDate: string; targetPercentage: number; massBunkPolicy: 'ABSENT' | 'EXCLUDE';
}): number {
  const info = db.prepare(`INSERT INTO semesters(user_id,name,start_date,end_date,target_percentage,mass_bunk_policy)
    VALUES(?,?,?,?,?,?)`).run(input.userId, input.name, input.startDate, input.endDate, input.targetPercentage, input.massBunkPolicy);
  const id = Number(info.lastInsertRowid);
  const insert = db.prepare('INSERT INTO timetable(semester_id,weekday,class_count) VALUES(?,?,?)');
  const tx = db.transaction(() => {
    for (let day = 0; day <= 6; day++) insert.run(id, day, day === 0 || day === 6 ? 0 : 5);
  });
  tx();
  return id;
}

export function updateSemester(id: number, input: {
  name: string; startDate: string; endDate: string; targetPercentage: number; massBunkPolicy: 'ABSENT' | 'EXCLUDE';
}): void {
  db.prepare(`UPDATE semesters SET name=?,start_date=?,end_date=?,target_percentage=?,mass_bunk_policy=? WHERE id=?`)
    .run(input.name, input.startDate, input.endDate, input.targetPercentage, input.massBunkPolicy, id);
}

export function deleteSemester(id: number): void {
  db.prepare('DELETE FROM semesters WHERE id=?').run(id);
}

export function listTimetable(semesterId: number): TimetableDay[] {
  return db.prepare('SELECT weekday, class_count FROM timetable WHERE semester_id = ? ORDER BY weekday')
    .all(semesterId) as TimetableDay[];
}

export function getScheduleCount(semesterId: number, date: string): number {
  const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
  const row = db.prepare('SELECT class_count FROM timetable WHERE semester_id = ? AND weekday = ?')
    .get(semesterId, weekday) as { class_count: number } | undefined;
  return row?.class_count ?? 0;
}

export function saveTimetable(semesterId: number, days: TimetableDayInput[]): void {
  const update = db.prepare(`INSERT INTO timetable(semester_id,weekday,class_count) VALUES(?,?,?)
    ON CONFLICT(semester_id,weekday) DO UPDATE SET class_count=excluded.class_count`);
  const tx = db.transaction(() => days.forEach((day) => update.run(semesterId, day.weekday, day.classCount)));
  tx();
}

export function countUnassignedAttendance(semesterId: number): number {
  return (db.prepare('SELECT COUNT(*) AS n FROM attendance WHERE semester_id = ? AND subject_id IS NULL')
    .get(semesterId) as { n: number }).n;
}
