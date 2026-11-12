import type { Request, Response } from 'express';

/** User-facing JSON backup and restore were removed. Keep a defensive handler so
 * an accidentally re-mounted legacy route can never export or overwrite data. */
export function downloadBackup(_req: Request, res: Response): void {
  res.status(410).json({ error: 'JSON backup has been retired. Use the PDF attendance report instead.' });
}

export function restoreBackup(_req: Request, res: Response): void {
  res.status(410).json({ error: 'JSON backup restore has been retired. Your existing attendance data is unchanged.' });
}
