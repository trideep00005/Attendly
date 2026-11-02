import { AppError } from '../utils/app-error.js';
import type { SubjectTimetableSlot } from '../models/semester.model.js';

export interface SubjectInput {
  name: string;
  code: string | null;
  targetPercentage: number | null;
}

export function validateSubjectInput(body: Record<string, unknown>, current?: { name: string; code: string | null; target_percentage: number | null }): SubjectInput {
  const name = body.name ?? current?.name;
  const code = body.code ?? current?.code ?? '';
  const targetPercentage = body.targetPercentage === undefined ? (current?.target_percentage ?? null) : body.targetPercentage;
  if (typeof name !== 'string' || name.trim().length < 2 || name.trim().length > 80) {
    throw new AppError('Subject name must be 2–80 characters.', 400);
  }
  if (typeof code !== 'string' || code.trim().length > 20) {
    throw new AppError('Subject code must be 20 characters or fewer.', 400);
  }
  if (targetPercentage !== null && (typeof targetPercentage !== 'number' || !Number.isFinite(targetPercentage) || targetPercentage < 1 || targetPercentage > 100)) {
    throw new AppError('Subject target must be between 1 and 100, or left blank to use the semester target.', 400);
  }
  return { name: name.trim(), code: code.trim() || null, targetPercentage: targetPercentage as number | null };
}

export function validateSubjectTimetable(value: unknown): SubjectTimetableSlot[] {
  if (!Array.isArray(value) || value.length > 35) throw new AppError('Provide a valid weekly subject timetable.', 400);
  const slots = value as SubjectTimetableSlot[];
  const seen = new Set<string>();
  for (const slot of slots) {
    if (!Number.isInteger(slot.weekday) || slot.weekday < 0 || slot.weekday > 6 || !Number.isInteger(slot.classNumber) || slot.classNumber < 1 || slot.classNumber > 5) {
      throw new AppError('Invalid weekday or class number in subject timetable.', 400);
    }
    if (slot.subjectId !== null && slot.subjectId !== undefined && (!Number.isInteger(slot.subjectId) || slot.subjectId < 1)) {
      throw new AppError('Invalid subject selected in the timetable.', 400);
    }
    const key = `${slot.weekday}-${slot.classNumber}`;
    if (seen.has(key)) throw new AppError('Duplicate timetable slot.', 400);
    seen.add(key);
  }
  return slots;
}
