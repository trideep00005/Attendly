import { AppError } from '../utils/app-error.js';
import { isDate } from '../utils/date.util.js';
import type { SemesterRecord, TimetableDayInput } from '../models/semester.model.js';

export interface SemesterInput {
  name: string;
  startDate: string;
  endDate: string;
  targetPercentage: number;
  massBunkPolicy: 'ABSENT' | 'EXCLUDE';
}

export function validateSemesterInput(body: Record<string, unknown>, current?: SemesterRecord): SemesterInput {
  const name = body.name ?? current?.name;
  const startDate = body.startDate ?? current?.start_date;
  const endDate = body.endDate ?? current?.end_date;
  const targetPercentage = body.targetPercentage ?? current?.target_percentage ?? 70;
  const massBunkPolicy = body.massBunkPolicy ?? current?.mass_bunk_policy ?? 'ABSENT';

  if (typeof name !== 'string' || name.trim().length < 2 || name.trim().length > 60) {
    throw new AppError('Enter a semester name (2–60 characters).', 400);
  }
  if (!isDate(startDate) || !isDate(endDate) || startDate > endDate) {
    throw new AppError('Enter a valid semester date range.', 400);
  }
  if (typeof targetPercentage !== 'number' || !Number.isFinite(targetPercentage) || targetPercentage < 1 || targetPercentage > 100) {
    throw new AppError('Target must be between 1 and 100.', 400);
  }
  if (massBunkPolicy !== 'ABSENT' && massBunkPolicy !== 'EXCLUDE') {
    throw new AppError('Invalid Mass Bunk policy.', 400);
  }
  return { name: name.trim(), startDate, endDate, targetPercentage, massBunkPolicy };
}

export function validateWeeklyTimetable(value: unknown): TimetableDayInput[] {
  if (!Array.isArray(value) || value.length !== 7) {
    throw new AppError('Provide a class count from 0 to 5 for each weekday.', 400);
  }
  const days = value as TimetableDayInput[];
  if (days.some((day) => !Number.isInteger(day.weekday) || day.weekday < 0 || day.weekday > 6 || !Number.isInteger(day.classCount) || day.classCount < 0 || day.classCount > 5) || new Set(days.map((day) => day.weekday)).size !== 7) {
    throw new AppError('Provide a class count from 0 to 5 for each weekday.', 400);
  }
  return days;
}
