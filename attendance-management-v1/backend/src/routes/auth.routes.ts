import { Router } from 'express';
import { asyncHandler } from '../middlewares/async-handler.middleware.js';
import { requireAuth } from '../middlewares/auth.middleware.js';
import * as authController from '../controllers/auth.controller.js';

const router = Router();
router.post('/setup', asyncHandler(authController.setupFirstAccount));
router.post('/register', asyncHandler(authController.register));
router.post('/login', asyncHandler(authController.login));
router.post('/logout', asyncHandler(authController.logout));
router.get('/me', requireAuth, asyncHandler(authController.me));
router.patch('/profile', requireAuth, asyncHandler(authController.updateProfile));
export default router;
