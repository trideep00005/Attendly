import * as attendanceRepository from '../repositories/attendance.repository.js';
import { getOwnedSemester } from './semester.service.js';
import { getSemesterStats, getSubjectStats } from './analytics.service.js';
import { csvCell } from '../utils/csv.util.js';
import { validateBackup } from '../validators/backup.validator.js';

export function createCsvReport(semesterId: number, userId: number): string {
  getOwnedSemester(semesterId, userId);
  const rows = attendanceRepository.listAttendanceForCsv(semesterId);
  return ['Date,Class,Subject,Status', ...rows.map((row) => [row.attendance_date, row.class_number, row.subject, row.status].map(csvCell).join(','))].join('\r\n');
}

export function createJsonReport(semesterId: number, userId: number) {
  const semester = getOwnedSemester(semesterId, userId);
  return {
    semester: { id: semester.id, name: semester.name, startDate: semester.start_date, endDate: semester.end_date, targetPercentage: semester.target_percentage, massBunkPolicy: semester.mass_bunk_policy },
    stats: getSemesterStats(semester),
    subjects: getSubjectStats(semester),
    entries: attendanceRepository.listAttendanceForJson(semesterId),
  };
}

export function createUserBackup(userId: number) {
  return attendanceRepository.listUserBackupData(userId);
}

export function restoreUserBackup(userId: number, data: unknown): void {
  const backup = validateBackup(data);
  attendanceRepository.restoreUserBackup(userId, backup);
}

