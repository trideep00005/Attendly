import { Router } from 'express';
import { asyncHandler } from '../middlewares/async-handler.middleware.js';
import { requireAuth } from '../middlewares/auth.middleware.js';
import * as reportsController from '../controllers/reports.controller.js';
const router = Router();
router.use(requireAuth);
router.get('/:semesterId.csv', asyncHandler(reportsController.downloadCsv));
router.get('/:semesterId.json', asyncHandler(reportsController.downloadJson));
export default router;
