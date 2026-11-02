import { Router } from 'express';
import { asyncHandler } from '../middlewares/async-handler.middleware.js';
import { requireAuth } from '../middlewares/auth.middleware.js';
import * as analyticsController from '../controllers/analytics.controller.js';
const router = Router();
router.use(requireAuth);
router.get('/:semesterId', asyncHandler(analyticsController.getSemesterAnalytics));
export default router;
