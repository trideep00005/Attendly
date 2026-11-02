import { Router } from 'express';
import { asyncHandler } from '../middlewares/async-handler.middleware.js';
import { requireAuth } from '../middlewares/auth.middleware.js';
import * as attendanceController from '../controllers/attendance.controller.js';
const router = Router();
router.use(requireAuth);
router.put('/:semesterId/:date', asyncHandler(attendanceController.saveDaily));
export default router;
