import { AppError } from '../utils/app-error.js';
import { isDate } from '../utils/date.util.js';

export interface ValidatedBackup {
  semesters: any[];
  timetable: any[];
  subjects: any[];
  subjectTimetable: any[];
  attendance: any[];
}

export function validateBackup(value: unknown): ValidatedBackup {
  if (!value || typeof value !== 'object') throw new AppError('This backup file is not supported.', 400);
  const backup = value as Record<string, any>;
  if (![1, 2].includes(backup.version) || !Array.isArray(backup.semesters) || !Array.isArray(backup.timetable) || !Array.isArray(backup.attendance)) {
    throw new AppError('This backup file is not supported.', 400);
  }
  if (backup.semesters.length > 100 || backup.attendance.length > 100000 || backup.timetable.length > 700 || (backup.subjects?.length ?? 0) > 3000 || (backup.subjectTimetable?.length ?? 0) > 3500) {
    throw new AppError('Backup exceeds safe import limits.', 400);
  }
  const subjects = backup.subjects ?? [];
  const subjectTimetable = backup.subjectTimetable ?? [];
  if (!Array.isArray(subjects) || !Array.isArray(subjectTimetable)) throw new AppError('This backup file is not supported.', 400);
  for (const semester of backup.semesters) {
    if (!Number.isInteger(semester.id) || !semester.id || typeof semester.name !== 'string' || !semester.name || !isDate(semester.start_date) || !isDate(semester.end_date) || semester.start_date > semester.end_date || !Number.isFinite(semester.target_percentage) || semester.target_percentage < 1 || semester.target_percentage > 100 || !['ABSENT', 'EXCLUDE'].includes(semester.mass_bunk_policy)) throw new AppError('Invalid semester data in backup.', 400);
  }
  for (const row of backup.timetable) {
    if (!Number.isInteger(row.weekday) || row.weekday < 0 || row.weekday > 6 || !Number.isInteger(row.class_count) || row.class_count < 0 || row.class_count > 5) throw new AppError('Invalid timetable data in backup.', 400);
  }
  for (const subject of subjects) {
    if (!Number.isInteger(subject.id) || !Number.isInteger(subject.semester_id) || typeof subject.name !== 'string' || subject.name.trim().length < 2 || (subject.target_percentage !== null && subject.target_percentage !== undefined && (!Number.isFinite(subject.target_percentage) || subject.target_percentage < 1 || subject.target_percentage > 100))) throw new AppError('Invalid subject data in backup.', 400);
  }
  for (const slot of subjectTimetable) {
    if (!Number.isInteger(slot.weekday) || slot.weekday < 0 || slot.weekday > 6 || !Number.isInteger(slot.class_number) || slot.class_number < 1 || slot.class_number > 5) throw new AppError('Invalid subject timetable data in backup.', 400);
  }
  for (const item of backup.attendance) {
    if (!Number.isInteger(item.semester_id) || !isDate(item.attendance_date) || !Number.isInteger(item.class_number) || item.class_number < 1 || item.class_number > 5 || !['PRESENT', 'ABSENT', 'HOLIDAY', 'MASS_BUNK'].includes(item.status)) throw new AppError('Invalid attendance data in backup.', 400);
  }
  return { semesters: backup.semesters, timetable: backup.timetable, subjects, subjectTimetable, attendance: backup.attendance };
}
