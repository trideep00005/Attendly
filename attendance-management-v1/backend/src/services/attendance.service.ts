import * as attendanceRepository from '../repositories/attendance.repository.js';
import * as semesterRepository from '../repositories/semester.repository.js';
import { getOwnedSemester } from './semester.service.js';
import { getSemesterStats } from './analytics.service.js';
import { AppError } from '../utils/app-error.js';
import { dayOfWeek, isDate } from '../utils/date.util.js';
import { validateAttendanceEntries } from '../validators/attendance.validator.js';

export function saveDailyAttendance(semesterId: number, userId: number, date: string, entriesValue: unknown) {
  const semester = getOwnedSemester(semesterId, userId);
  if (!isDate(date) || date < semester.start_date || date > semester.end_date) throw new AppError('Date must fall within the selected semester.', 400);
  const classCount = semesterRepository.getScheduleCount(semester.id, date);
  if (classCount === 0) throw new AppError('No classes are scheduled for this weekday. Update the timetable in Settings if needed.', 400);
  const entries = validateAttendanceEntries(entriesValue, classCount);
  attendanceRepository.saveAttendance(semester.id, date, dayOfWeek(date), entries);
  const saved = attendanceRepository.getSavedAttendanceForDate(semester.id, date);
  return { date, entries: saved, analytics: getSemesterStats(semester) };
}
