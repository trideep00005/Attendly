import type { Request, Response } from 'express';
import * as semesterService from '../services/semester.service.js';

export function list(req: Request, res: Response): void { res.json(semesterService.listSemesters(req.userId!)); }
export function create(req: Request, res: Response): void { res.status(201).json(semesterService.createSemester(req.userId!, req.body ?? {})); }
export function update(req: Request, res: Response): void { res.json(semesterService.updateSemester(Number(req.params.id), req.userId!, req.body ?? {})); }
export function remove(req: Request, res: Response): void { semesterService.deleteSemester(Number(req.params.id), req.userId!); res.json({ ok: true }); }
export function getTimetable(req: Request, res: Response): void { res.json(semesterService.getTimetable(Number(req.params.id), req.userId!)); }
export function updateTimetable(req: Request, res: Response): void { res.json(semesterService.updateTimetable(Number(req.params.id), req.userId!, req.body?.days)); }
