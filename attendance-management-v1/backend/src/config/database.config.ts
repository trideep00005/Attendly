import path from 'node:path';

/**
 * Keep the original database location: backend/data/attendance.db when the
 * process is started from the backend directory. DATABASE_PATH is optional.
 */
export const DATABASE_PATH = process.env.DATABASE_PATH
  ? path.resolve(process.env.DATABASE_PATH)
  : path.resolve(process.cwd(), 'data', 'attendance.db');
