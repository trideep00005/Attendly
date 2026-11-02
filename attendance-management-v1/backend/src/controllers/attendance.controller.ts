import type { Request, Response } from 'express';
import { saveDailyAttendance } from '../services/attendance.service.js';

export function saveDaily(req: Request, res: Response): void {
  const semesterId = Number(req.params.semesterId);
  const date = req.params.date;

  if (!Number.isInteger(semesterId) || !date) {
    res.status(400).json({ error: 'Invalid semester ID or date' });
    return;
  }

  if (!req.userId) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  res.json(
    saveDailyAttendance(semesterId, req.userId, date, req.body?.entries)
  );
}