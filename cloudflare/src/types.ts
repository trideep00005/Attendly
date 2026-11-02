export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  APP_NAME?: string;
  APP_BASE_URL?: string;
  APP_TIME_ZONE?: string;
  APP_ENV?: string;
  WHATSAPP_NUMBER?: string;
  SUPPORT_EMAIL?: string;
  REGISTRATION_ENABLED?: string;
  SUPER_ADMIN_USERNAME?: string;
  SUPER_ADMIN_EMAIL?: string;
  SUPER_ADMIN_PASSWORD?: string;
  SUPER_ADMIN_BOOTSTRAP_TOKEN?: string;
  BREVO_API_KEY?: string;
  BREVO_SENDER_EMAIL?: string;
  BREVO_SENDER_NAME?: string;
  OTP_HASH_SECRET?: string;
}

export type AttendanceStatus = "PRESENT" | "ABSENT" | "HOLIDAY" | "OTHER";
export type UserRole = "STUDENT" | "SUPPORT_ADMIN" | "ADMIN" | "SUPER_ADMIN";
export interface UserRow {
  id: number;
  username: string;
  email: string | null;
  role: UserRole;
  account_status: "ACTIVE" | "SUSPENDED" | "DEACTIVATED";
  password_hash?: string;
  created_at: string;
}
export interface SemesterRow {
  id: number;
  user_id: number;
  name: string;
  start_date: string;
  end_date: string;
  target_percentage: number;
  mass_bunk_policy: "ABSENT" | "EXCLUDE";
  created_at: string;
}
export interface AttendanceRow {
  id: number;
  semester_id: number;
  attendance_date: string;
  class_number: number;
  status: AttendanceStatus;
  subject_id: number | null;
  created_at: string;
  updated_at: string;
}
