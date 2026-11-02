import * as attendanceRepository from '../repositories/attendance.repository.js';
import * as semesterRepository from '../repositories/semester.repository.js';
import * as subjectRepository from '../repositories/subject.repository.js';
import { getOwnedSemester } from './semester.service.js';
import { AppError } from '../utils/app-error.js';
import { dayOfWeek } from '../utils/date.util.js';

export function getCalendarMonth(semesterId: number, userId: number, monthValue: unknown) {
  const semester = getOwnedSemester(semesterId, userId);
  const month = String(monthValue ?? '');
  if (!/^\d{4}-\d{2}$/.test(month)) throw new AppError('Month must use YYYY-MM format.', 400);
  const year = Number(month.slice(0, 4));
  const monthNo = Number(month.slice(5, 7));
  if (monthNo < 1 || monthNo > 12) throw new AppError('Invalid month.', 400);
  const last = new Date(Date.UTC(year, monthNo, 0)).getUTCDate();
  const days = [];
  for (let day = 1; day <= last; day++) {
    const date = `${year}-${String(monthNo).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const inSemester = date >= semester.start_date && date <= semester.end_date;
    const classCount = inSemester ? semesterRepository.getScheduleCount(semester.id, date) : 0;
    const entries = attendanceRepository.listAttendanceForDate(semester.id, date);
    const byClass: Record<number, string> = {};
    entries.forEach((entry) => { byClass[entry.class_number] = entry.status; });
    const mapped = subjectRepository.getSubjectTimetableMapping(semester.id, date);
    const subjectByClass: Record<number, { id: number; name: string; code: string | null }> = {};
    mapped.forEach((subject) => {
      if (!subjectByClass[subject.class_number]) subjectByClass[subject.class_number] = { id: subject.id, name: subject.name, code: subject.code };
    });
    days.push({ date, inSemester, classCount, entries: byClass, subjectByClass, recorded: entries.length });
  }
  return { semester: { id: semester.id, name: semester.name, startDate: semester.start_date, endDate: semester.end_date }, month, days };
}
