import * as subjectRepository from '../repositories/subject.repository.js';
import * as semesterRepository from '../repositories/semester.repository.js';
import { getOwnedSemester } from './semester.service.js';
import { getSubjectStats } from './analytics.service.js';
import { AppError, isUniqueConstraintError } from '../utils/app-error.js';
import { validateSubjectInput, validateSubjectTimetable } from '../validators/subject.validator.js';

export function listSemesterSubjects(semesterId: number, userId: number) {
  const semester = getOwnedSemester(semesterId, userId);
  return { subjects: getSubjectStats(semester), unassignedEntries: semesterRepository.countUnassignedAttendance(semesterId) };
}

export function createSemesterSubject(semesterId: number, userId: number, body: Record<string, unknown>) {
  getOwnedSemester(semesterId, userId);
  const input = validateSubjectInput(body);
  let id: number;
  try {
    id = subjectRepository.createSubject({ semesterId, ...input });
  } catch (error) {
    if (isUniqueConstraintError(error)) throw new AppError('A subject with that name already exists in this semester.', 409);
    throw error;
  }
  return { id, name: input.name, code: input.code, target_percentage: input.targetPercentage };
}

export function updateSemesterSubject(semesterId: number, subjectId: number, userId: number, body: Record<string, unknown>): void {
  getOwnedSemester(semesterId, userId);
  const current = subjectRepository.findSubject(subjectId, semesterId);
  if (!current) throw new AppError('Subject not found.', 404);
  const input = validateSubjectInput(body, current);
  try {
    subjectRepository.updateSubject(subjectId, semesterId, input);
  } catch (error) {
    if (isUniqueConstraintError(error)) throw new AppError('A subject with that name already exists in this semester.', 409);
    throw error;
  }
}

export function deleteSemesterSubject(semesterId: number, subjectId: number, userId: number): void {
  getOwnedSemester(semesterId, userId);
  if (!subjectRepository.deleteSubject(subjectId, semesterId)) throw new AppError('Subject not found.', 404);
}

export function getSemesterSubjectTimetable(semesterId: number, userId: number) {
  getOwnedSemester(semesterId, userId);
  return subjectRepository.listSubjectTimetable(semesterId);
}

export function updateSemesterSubjectTimetable(semesterId: number, userId: number, slotsValue: unknown) {
  getOwnedSemester(semesterId, userId);
  const slots = validateSubjectTimetable(slotsValue);
  const seen = new Set<string>();
  const timetable = semesterRepository.listTimetable(semesterId);
  for (const slot of slots) {
    if (!Number.isInteger(slot.weekday) || slot.weekday < 0 || slot.weekday > 6 || !Number.isInteger(slot.classNumber) || slot.classNumber < 1 || slot.classNumber > 5) throw new AppError('Invalid weekday or class number in subject timetable.', 400);
    const key = `${slot.weekday}-${slot.classNumber}`;
    if (seen.has(key)) throw new AppError('Duplicate timetable slot.', 400);
    seen.add(key);
    const classCount = timetable.find((day) => day.weekday === slot.weekday)?.class_count ?? 0;
    if (slot.classNumber > classCount) throw new AppError('A subject is assigned to a class slot that is not scheduled.', 400);
    if (slot.subjectId !== null && slot.subjectId !== undefined && !subjectRepository.findSubject(slot.subjectId, semesterId)) throw new AppError('One of the selected subjects does not belong to this semester.', 400);
  }
  subjectRepository.saveSubjectTimetable(semesterId, slots);
  return { ok: true, count: slots.filter((slot) => slot.subjectId !== null && slot.subjectId !== undefined).length };
}

export function applySemesterSubjectTimetable(semesterId: number, userId: number) {
  getOwnedSemester(semesterId, userId);
  return { ok: true, updated: subjectRepository.applySubjectTimetable(semesterId) };
}
