import type { Request, Response } from 'express';
import * as reportsService from '../services/reports.service.js';

export function downloadCsv(req: Request, res: Response): void {
  const semesterId = Number(req.params.semesterId);
  const csv = reportsService.createCsvReport(semesterId, req.userId!);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="attendance-${semesterId}.csv"`);
  res.send(`\uFEFF${csv}`);
}

export function downloadJson(req: Request, res: Response): void {
  res.json(reportsService.createJsonReport(Number(req.params.semesterId), req.userId!));
}
