import type { Request, Response } from 'express';
import * as reportsService from '../services/reports.service.js';

export function downloadBackup(req: Request, res: Response): void {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', 'attachment; filename="attendance-backup.json"');
  res.json(reportsService.createUserBackup(req.userId!));
}

export function restoreBackup(req: Request, res: Response): void {
  try {
    reportsService.restoreUserBackup(req.userId!, req.body);
    res.json({ ok: true, message: 'Your backup was restored successfully.' });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : 'Could not restore backup.' });
  }
}
