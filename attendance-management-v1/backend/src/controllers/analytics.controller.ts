import type { Request, Response } from 'express';
import { getOwnedSemester } from '../services/semester.service.js';
import { getAnalytics } from '../services/analytics.service.js';

export function getSemesterAnalytics(req: Request, res: Response): void {
  const semester = getOwnedSemester(Number(req.params.semesterId), req.userId!);
  res.json(getAnalytics(semester));
}
