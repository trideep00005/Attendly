export const APP_PORT = Number(process.env.PORT || 8000);
export const AUTH_COOKIE_NAME = 'attendance_session';
export const SESSION_DAYS = 7;
export const SESSION_MAX_AGE_MS = SESSION_DAYS * 24 * 60 * 60 * 1000;
export const ATTENDANCE_STATUSES = ['PRESENT', 'ABSENT', 'HOLIDAY', 'MASS_BUNK'] as const;
export type AttendanceStatus = typeof ATTENDANCE_STATUSES[number];
