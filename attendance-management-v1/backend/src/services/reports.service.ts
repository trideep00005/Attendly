import * as attendanceRepository from '../repositories/attendance.repository.js';
import { getOwnedSemester } from './semester.service.js';
import { getSemesterStats, getSubjectStats } from './analytics.service.js';

/** Data payload used only by the authenticated client-side PDF report generator. */
export function createJsonReport(semesterId: number, userId: number) {
  const semester = getOwnedSemester(semesterId, userId);
  return {
    semester: { id: semester.id, name: semester.name, startDate: semester.start_date, endDate: semester.end_date, targetPercentage: semester.target_percentage, massBunkPolicy: semester.mass_bunk_policy },
    stats: getSemesterStats(semester),
    subjects: getSubjectStats(semester),
    entries: attendanceRepository.listAttendanceForJson(semesterId),
  };
}
