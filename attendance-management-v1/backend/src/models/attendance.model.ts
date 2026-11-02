import type { AttendanceStatus } from '../config/constants.js';

export interface AttendanceRecord {
  id?: number;
  semester_id: number;
  attendance_date: string;
  class_number: number;
  status: AttendanceStatus;
  subject_id: number | null;
  created_at?: string;
  updated_at?: string;
}

export interface AttendanceInput {
  classNumber: number;
  status: AttendanceStatus | null;
}
