import bcrypt from 'bcryptjs';
import { SESSION_DAYS } from '../config/constants.js';
import * as authRepository from '../repositories/auth.repository.js';
import { createSessionToken, hashToken } from '../utils/crypto.util.js';
import { AppError, isUniqueConstraintError } from '../utils/app-error.js';
import { validateCredentials, validateEmail } from '../validators/auth.validator.js';

export async function registerUser(usernameValue: unknown, emailValue: unknown, passwordValue: unknown, firstAccountOnly = false): Promise<{ userId: number; username: string }> {
  if (firstAccountOnly && authRepository.countUsers() > 0) {
    throw new AppError('The first account already exists. Please sign in or create another account.', 409);
  }
  const credentials = validateCredentials(usernameValue, passwordValue);
  const email = validateEmail(emailValue);
  const username = credentials.username;
  const passwordHash = await bcrypt.hash(credentials.password, 12);
  let userId: number;
  try {
    userId = authRepository.createUser(username, email, passwordHash);
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      const message = firstAccountOnly
        ? 'That username or email is already registered.'
        : 'That username or email is already registered. Please choose another.';
      throw new AppError(message, 409);
    }
    throw error;
  }
  return { userId, username };
}

export async function authenticateUser(usernameValue: unknown, passwordValue: unknown): Promise<{ userId: number; username: string }> {
  const username = typeof usernameValue === 'string' ? usernameValue.trim() : '';
  const user = authRepository.findUserByUsername(username);
  if (!user || typeof passwordValue !== 'string' || !(await bcrypt.compare(passwordValue, user.password_hash))) {
    throw new AppError('Incorrect username or password.', 401);
  }
  return { userId: user.id, username: user.username };
}

export function createLoginSession(userId: number): { token: string; expiresAt: string } {
  const token = createSessionToken();
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86400000).toISOString();
  authRepository.createSession(hashToken(token), userId, expiresAt);
  return { token, expiresAt };
}

export function logout(token: string | undefined): void {
  if (token) authRepository.deleteSessionByTokenHash(hashToken(token));
}

export function getCurrentUser(userId: number) {
  return authRepository.findPublicUserById(userId);
}

export function updateProfileEmail(userId: number, emailValue: unknown): { username: string; email: string | null } | undefined {
  const email = validateEmail(emailValue);
  try {
    authRepository.updateUserEmail(userId, email);
  } catch (error) {
    if (isUniqueConstraintError(error)) throw new AppError('This email address is already registered to another account.', 409);
    throw error;
  }
  return authRepository.findPublicUserById(userId);
}
