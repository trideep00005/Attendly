import type { Request, Response } from 'express';
import { AUTH_COOKIE_NAME, SESSION_MAX_AGE_MS } from '../config/constants.js';
import * as authService from '../services/auth.service.js';
import * as authRepository from '../repositories/auth.repository.js';
import { hashToken } from '../utils/crypto.util.js';

function setSessionCookie(res: Response, token: string): void {
  res.cookie(AUTH_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.COOKIE_SECURE === 'true',
    maxAge: SESSION_MAX_AGE_MS,
    path: '/',
  });
}

export async function getStatus(_req: Request, res: Response): Promise<void> {
  const count = authRepository.countUsers();
  res.json({ setupRequired: count === 0, registrationEnabled: true });
}

export async function setupFirstAccount(req: Request, res: Response): Promise<void> {
  const { username, email, password } = req.body ?? {};
  const result = await authService.registerUser(username, email, password, true);
  const session = authService.createLoginSession(result.userId);
  setSessionCookie(res, session.token);
  res.status(201).json({ user: { username: result.username } });
}

export async function register(req: Request, res: Response): Promise<void> {
  const { username, email, password } = req.body ?? {};
  const result = await authService.registerUser(username, email, password);
  const session = authService.createLoginSession(result.userId);
  setSessionCookie(res, session.token);
  res.status(201).json({ user: { username: result.username } });
}

export async function login(req: Request, res: Response): Promise<void> {
  const { username, password } = req.body ?? {};
  const result = await authService.authenticateUser(username, password);
  const session = authService.createLoginSession(result.userId);
  setSessionCookie(res, session.token);
  res.json({ user: { username: result.username } });
}

export function logout(req: Request, res: Response): void {
  const token = req.cookies?.[AUTH_COOKIE_NAME];
  authService.logout(typeof token === 'string' ? token : undefined);
  res.clearCookie(AUTH_COOKIE_NAME, { path: '/' });
  res.json({ ok: true });
}

export function me(req: Request, res: Response): void {
  res.json({ user: authService.getCurrentUser(req.userId!) });
}

export function updateProfile(req: Request, res: Response): void {
  const user = authService.updateProfileEmail(req.userId!, req.body?.email);
  res.json({ user });
}
