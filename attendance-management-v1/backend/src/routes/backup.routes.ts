import { Router } from 'express';
import { asyncHandler } from '../middlewares/async-handler.middleware.js';
import { requireAuth } from '../middlewares/auth.middleware.js';
import * as backupController from '../controllers/backup.controller.js';
const router = Router();
router.use(requireAuth);
router.get('/', asyncHandler(backupController.downloadBackup));
router.post('/restore', asyncHandler(backupController.restoreBackup));
export default router;
