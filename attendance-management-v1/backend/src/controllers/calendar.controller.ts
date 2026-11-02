import type { Request, Response } from 'express';
import { getCalendarMonth } from '../services/calendar.service.js';

export function getMonth(req: Request, res: Response): void {
  res.json(getCalendarMonth(Number(req.params.semesterId), req.userId!, req.query.month));
}
