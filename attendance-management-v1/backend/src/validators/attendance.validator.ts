import { ATTENDANCE_STATUSES } from '../config/constants.js';
import type { AttendanceInput } from '../models/attendance.model.js';
import { AppError } from '../utils/app-error.js';

export function validateAttendanceEntries(value: unknown, scheduledClassCount: number): AttendanceInput[] {
  if (!Array.isArray(value)) throw new AppError('Invalid class attendance data.', 400);
  const entries = value as AttendanceInput[];
  if (entries.some((entry) => !Number.isInteger(entry.classNumber) || entry.classNumber < 1 || entry.classNumber > scheduledClassCount || !(entry.status === null || ATTENDANCE_STATUSES.includes(entry.status)))) {
    throw new AppError('Invalid class attendance data.', 400);
  }
  if (new Set(entries.map((entry) => entry.classNumber)).size !== entries.length) {
    throw new AppError('Duplicate class numbers are not allowed.', 400);
  }
  return entries;
}
