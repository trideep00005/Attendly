import type { Request, Response } from 'express';
import * as subjectService from '../services/subject.service.js';

export function list(req: Request, res: Response): void { res.json(subjectService.listSemesterSubjects(Number(req.params.id), req.userId!)); }
export function create(req: Request, res: Response): void { res.status(201).json(subjectService.createSemesterSubject(Number(req.params.id), req.userId!, req.body ?? {})); }
export function update(req: Request, res: Response): void { subjectService.updateSemesterSubject(Number(req.params.id), Number(req.params.subjectId), req.userId!, req.body ?? {}); res.json({ ok: true }); }
export function remove(req: Request, res: Response): void { subjectService.deleteSemesterSubject(Number(req.params.id), Number(req.params.subjectId), req.userId!); res.json({ ok: true }); }
export function getTimetable(req: Request, res: Response): void { res.json(subjectService.getSemesterSubjectTimetable(Number(req.params.id), req.userId!)); }
export function updateTimetable(req: Request, res: Response): void { res.json(subjectService.updateSemesterSubjectTimetable(Number(req.params.id), req.userId!, req.body?.slots)); }
export function applyTimetable(req: Request, res: Response): void { res.json(subjectService.applySemesterSubjectTimetable(Number(req.params.id), req.userId!)); }
