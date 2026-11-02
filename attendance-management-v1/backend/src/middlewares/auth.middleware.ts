import type { RequestHandler } from 'express';
import { AUTH_COOKIE_NAME } from '../config/constants.js';
import { findSessionByTokenHash, deleteSessionById } from '../repositories/auth.repository.js';
import { hashToken } from '../utils/crypto.util.js';

export const requireAuth: RequestHandler = (req, res, next) => {
  const token = req.cookies?.[AUTH_COOKIE_NAME];
  if (!token || typeof token !== 'string') {
    res.status(401).json({ error: 'Please log in to continue.' });
    return;
  }

  const session = findSessionByTokenHash(hashToken(token));
  if (!session || Date.parse(session.expires_at) < Date.now()) {
    if (session) deleteSessionById(session.id);
    res.clearCookie(AUTH_COOKIE_NAME, { path: '/' });
    res.status(401).json({ error: 'Your session has expired. Please log in again.' });
    return;
  }

  req.userId = session.user_id;
  next();
};
