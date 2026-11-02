import type { SemesterRecord } from '../models/semester.model.js';
import * as attendanceRepository from '../repositories/attendance.repository.js';
import * as semesterRepository from '../repositories/semester.repository.js';
import * as subjectRepository from '../repositories/subject.repository.js';
import { localDateString } from '../utils/date.util.js';

export function getSemesterStats(semester: SemesterRecord) {
  const entries = attendanceRepository.listAttendanceForSemester(semester.id);
  let present = 0, absent = 0, missed = 0, holiday = 0, massBunk = 0, countable = 0;
  for (const item of entries) {
    if (item.status === 'PRESENT') { present++; countable++; }
    if (item.status === 'ABSENT') { absent++; missed++; countable++; }
    if (item.status === 'HOLIDAY') holiday++;
    if (item.status === 'MASS_BUNK') {
      massBunk++;
      if (semester.mass_bunk_policy === 'ABSENT') { missed++; countable++; }
    }
  }
  const target = Number(semester.target_percentage) / 100;
  const percentage = countable ? (present / countable) * 100 : 0;
  const safeLeaves = target > 0 && countable ? Math.max(0, Math.floor((present / target) - countable + 1e-9)) : 0;
  const recoveryClasses = percentage >= Number(semester.target_percentage) ? 0 : (target >= 1 ? null : Math.ceil(Math.max(0, (target * countable - present) / (1 - target)) - 1e-9));
  const today = localDateString();
  const start = today > semester.start_date ? today : semester.start_date;
  let futureScheduled = 0;
  if (start <= semester.end_date) {
    const cursor = new Date(`${start}T12:00:00Z`);
    const end = new Date(`${semester.end_date}T12:00:00Z`);
    while (cursor <= end) {
      futureScheduled += semesterRepository.getScheduleCount(semester.id, cursor.toISOString().slice(0, 10));
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
  }
  const futureRecorded = start <= semester.end_date ? attendanceRepository.countAttendanceBetween(semester.id, start, semester.end_date) : 0;
  const remaining = Math.max(0, futureScheduled - futureRecorded);
  const bestCase = (present + remaining) / Math.max(1, countable + remaining) * 100;

  const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayISO = localDateString(yesterday);
  const pastEnd = yesterdayISO < semester.end_date ? yesterdayISO : semester.end_date;
  let pastScheduled = 0;
  if (pastEnd >= semester.start_date) {
    const cursor = new Date(`${semester.start_date}T12:00:00Z`);
    const endPast = new Date(`${pastEnd}T12:00:00Z`);
    while (cursor <= endPast) {
      pastScheduled += semesterRepository.getScheduleCount(semester.id, cursor.toISOString().slice(0, 10));
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
  }
  const pastRecorded = pastEnd >= semester.start_date ? attendanceRepository.countAttendanceBetween(semester.id, semester.start_date, pastEnd) : 0;
  const pendingPast = Math.max(0, pastScheduled - pastRecorded);
  const recordedSlots = attendanceRepository.countAttendance(semester.id);
  const recordedDays = attendanceRepository.countRecordedDays(semester.id);

  const dayRows = attendanceRepository.getDayAttendanceRows(semester.id);
  const dayMap = new Map(dayRows.map((row) => [row.attendance_date, row]));
  const asOf = today < semester.end_date ? today : semester.end_date;
  let collegeOpenDays = 0, presentDays = 0;
  if (asOf >= semester.start_date) {
    const cursor = new Date(`${semester.start_date}T12:00:00Z`);
    const dayEnd = new Date(`${asOf}T12:00:00Z`);
    while (cursor <= dayEnd) {
      const date = cursor.toISOString().slice(0, 10);
      const scheduledClasses = semesterRepository.getScheduleCount(semester.id, date);
      if (scheduledClasses > 0) {
        const day = dayMap.get(date);
        const fullDayHoliday = (day?.holiday_slots ?? 0) === scheduledClasses;
        if (!fullDayHoliday) {
          collegeOpenDays++;
          if ((day?.present_slots ?? 0) > 0) presentDays++;
        }
      }
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
  }
  return { present, absent, missed, holiday, massBunk, pendingPast, total: countable, percentage: Number(percentage.toFixed(2)), target: Number(semester.target_percentage), safeLeaves, recoveryClasses, remainingScheduled: remaining, bestCase: Number(bestCase.toFixed(2)), recordedSlots, recordedDays, collegeOpenDays, presentDays, massBunkPolicy: semester.mass_bunk_policy };
}

export function getSubjectStats(semester: SemesterRecord) {
  const subjects = subjectRepository.listSubjects(semester.id);
  const today = localDateString();
  return subjects.map((subject) => {
    const rows = attendanceRepository.listAttendanceForSubject(semester.id, subject.id);
    let present = 0, absent = 0, holiday = 0, massBunk = 0, total = 0;
    for (const row of rows) {
      if (row.status === 'PRESENT') { present++; total++; }
      else if (row.status === 'ABSENT') { absent++; total++; }
      else if (row.status === 'HOLIDAY') holiday++;
      else if (row.status === 'MASS_BUNK') { massBunk++; if (semester.mass_bunk_policy === 'ABSENT') total++; }
    }
    const targetPercentage = subject.target_percentage == null ? Number(semester.target_percentage) : Number(subject.target_percentage);
    const target = targetPercentage / 100;
    const percentage = total ? present / total * 100 : 0;
    const safeLeaves = total && target > 0 ? Math.max(0, Math.floor((present / target) - total + 1e-9)) : 0;
    const recoveryClasses = percentage >= targetPercentage || total === 0 ? 0 : target >= 1 ? null : Math.ceil(Math.max(0, (target * total - present) / (1 - target)) - 1e-9);

    const remainingStart = today > semester.start_date ? today : semester.start_date;
    let remainingScheduled = 0;
    if (remainingStart <= semester.end_date) {
      const weekdays = attendanceRepository.getSubjectScheduledSlots(semester.id, subject.id);
      const counts = new Map(weekdays.map((row) => [row.weekday, row.slots] as [number, number]));
      const cursor = new Date(`${remainingStart}T12:00:00Z`);
      const end = new Date(`${semester.end_date}T12:00:00Z`);
      while (cursor <= end) {
        remainingScheduled += counts.get(cursor.getUTCDay()) ?? 0;
        cursor.setUTCDate(cursor.getUTCDate() + 1);
      }
      const alreadyRecorded = attendanceRepository.countSubjectAttendanceBetween(semester.id, subject.id, remainingStart, semester.end_date);
      remainingScheduled = Math.max(0, remainingScheduled - alreadyRecorded);
    }
    const bestCase = (present + remainingScheduled) / Math.max(1, total + remainingScheduled) * 100;
    return { ...subject, targetPercentage, present, absent, holiday, massBunk, total, percentage: Number(percentage.toFixed(2)), safeLeaves, recoveryClasses, remainingScheduled, bestCase: Number(bestCase.toFixed(2)) };
  });
}

export function getAnalytics(semester: SemesterRecord) {
  const stats = getSemesterStats(semester);
  const monthly = attendanceRepository.getMonthlyAttendanceRows(semester.id, semester.mass_bunk_policy)
    .map((row: any) => ({ ...row, percentage: row.total ? Number((row.present / row.total * 100).toFixed(2)) : 0 }));
  const subjects = getSubjectStats(semester);
  const unassignedEntries = (awaitlessCountUnassigned(semester.id));
  return { semester: { id: semester.id, name: semester.name, startDate: semester.start_date, endDate: semester.end_date }, stats, monthly, subjects, unassignedEntries };
}

function awaitlessCountUnassigned(semesterId: number): number {
  return semesterRepository.countUnassignedAttendance(semesterId);
}
