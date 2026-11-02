import { deleteExpiredSessions } from '../repositories/auth.repository.js';

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/** Removes expired sessions so the sessions table does not grow forever. */
export function startSessionCleanupJob(): ReturnType<typeof setInterval> {
  const run = () => {
    try {
      const deleted = deleteExpiredSessions();
      if (deleted > 0) console.info(`[job:session-cleanup] Removed ${deleted} expired session(s).`);
    } catch (error) {
      console.error('[job:session-cleanup] Failed:', error);
    }
  };
  run();
  const timer = setInterval(run, ONE_DAY_MS);
  if (typeof timer === 'object' && timer !== null && 'unref' in timer) {
    (timer as NodeJS.Timeout).unref?.();
  }
  return timer;
}
