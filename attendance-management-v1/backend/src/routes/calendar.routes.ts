import { Router } from 'express';
import { asyncHandler } from '../middlewares/async-handler.middleware.js';
import { requireAuth } from '../middlewares/auth.middleware.js';
import * as calendarController from '../controllers/calendar.controller.js';
const router = Router();
router.use(requireAuth);
router.get('/:semesterId', asyncHandler(calendarController.getMonth));
export default router;
