import { AppError } from '../utils/app-error.js';

export function validateCredentials(username: unknown, password: unknown): { username: string; password: string } {
  if (typeof username !== 'string' || username.trim().length < 3 || username.trim().length > 32 || !/^[a-zA-Z0-9_.-]+$/.test(username.trim())) {
    throw new AppError('Username must be 3–32 characters and use only letters, numbers, dot, underscore or hyphen.', 400);
  }
  if (typeof password !== 'string' || password.length < 10 || password.length > 128) {
    throw new AppError('Password must contain 10–128 characters.', 400);
  }
  return { username: username.trim(), password };
}

export function validateEmail(email: unknown): string {
  if (typeof email !== 'string' || email.trim().length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
    throw new AppError('Enter a valid email address.', 400);
  }
  return email.trim().toLowerCase();
}
