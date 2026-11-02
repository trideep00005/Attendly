import * as semesterRepository from '../repositories/semester.repository.js';
import { getSemesterStats } from './analytics.service.js';
import { AppError } from '../utils/app-error.js';
import { validateSemesterInput, validateWeeklyTimetable } from '../validators/semester.validator.js';
import type { SemesterRecord, TimetableDay } from '../models/semester.model.js';

export function getOwnedSemester(semesterId: number, userId: number): SemesterRecord {
  const semester = semesterRepository.findSemesterByIdAndUser(semesterId, userId);
  if (!semester) throw new AppError('Semester not found.', 404);
  return semester;
}

export function listSemesters(userId: number) {
  return semesterRepository.listSemestersByUser(userId).map((semester) => ({ ...semester, ...getSemesterStats(semester) }));
}

export function createSemester(userId: number, body: Record<string, unknown>) {
  const input = validateSemesterInput({ targetPercentage: 70, massBunkPolicy: 'ABSENT', ...body });
  const id = semesterRepository.createSemester({ userId, ...input });
  return semesterRepository.findSemesterByIdAndUser(id, userId);
}

export function updateSemester(semesterId: number, userId: number, body: Record<string, unknown>) {
  const current = getOwnedSemester(semesterId, userId);
  const input = validateSemesterInput(body, current);
  semesterRepository.updateSemester(semesterId, input);
  return semesterRepository.findSemesterByIdAndUser(semesterId, userId);
}

export function deleteSemester(semesterId: number, userId: number): void {
  getOwnedSemester(semesterId, userId);
  semesterRepository.deleteSemester(semesterId);
}

export function getTimetable(semesterId: number, userId: number) {
  getOwnedSemester(semesterId, userId);
  return semesterRepository.listTimetable(semesterId);
}

export function updateTimetable(semesterId: number, userId: number, daysValue: unknown) {
  getOwnedSemester(semesterId, userId);
  const days = validateWeeklyTimetable(daysValue);
  semesterRepository.saveTimetable(semesterId, days);
  return semesterRepository.listTimetable(semesterId);
}
