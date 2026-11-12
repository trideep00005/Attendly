import type { Request, Response } from 'express';
import * as reportsService from '../services/reports.service.js';

export function downloadJson(req: Request, res: Response): void {
  res.json(reportsService.createJsonReport(Number(req.params.semesterId), req.userId!));
}
