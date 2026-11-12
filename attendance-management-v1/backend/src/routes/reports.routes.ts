import { Router } from 'express';
import { asyncHandler } from '../middlewares/async-handler.middleware.js';
import { requireAuth } from '../middlewares/auth.middleware.js';
import * as reportsController from '../controllers/reports.controller.js';
const router = Router();
router.use(requireAuth);
// This authenticated JSON response is consumed by the in-browser PDF generator.
// CSV export has been removed; no user-facing backup/restore endpoints are mounted.
router.get('/:semesterId.json', asyncHandler(reportsController.downloadJson));
export default router;
