export interface SemesterRecord {
  id: number;
  user_id: number;
  name: string;
  start_date: string;
  end_date: string;
  target_percentage: number;
  mass_bunk_policy: 'ABSENT' | 'EXCLUDE';
  created_at: string;
}

export interface TimetableDay {
  weekday: number;
  class_count: number;
}

/** Request payload shape used by PUT /api/semesters/:id/timetable. */
export interface TimetableDayInput {
  weekday: number;
  classCount: number;
}

export interface SubjectTimetableSlot {
  weekday: number;
  classNumber: number;
  subjectId?: number | null;
}
