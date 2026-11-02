import db from '../database/connection.js';
import type { SessionRecord, UserRecord } from '../models/user.model.js';

export function countUsers(): number {
  return (db.prepare('SELECT COUNT(*) AS n FROM app_user').get() as { n: number }).n;
}

export function createUser(username: string, email: string, passwordHash: string): number {
  const info = db.prepare('INSERT INTO app_user(username, email, password_hash) VALUES(?, ?, ?)')
    .run(username, email, passwordHash);
  return Number(info.lastInsertRowid);
}

export function findUserByUsername(username: string): UserRecord | undefined {
  return db.prepare('SELECT id, username, email, password_hash, created_at FROM app_user WHERE username = ?')
    .get(username) as UserRecord | undefined;
}

export function findPublicUserById(userId: number): { username: string; email: string | null } | undefined {
  return db.prepare('SELECT username, email FROM app_user WHERE id = ?').get(userId) as { username: string; email: string | null } | undefined;
}

export function updateUserEmail(userId: number, email: string): void {
  db.prepare('UPDATE app_user SET email = ? WHERE id = ?').run(email, userId);
}

export function createSession(tokenHash: string, userId: number, expiresAt: string): void {
  db.prepare('INSERT INTO sessions(token_hash, user_id, expires_at) VALUES(?, ?, ?)')
    .run(tokenHash, userId, expiresAt);
}

export function findSessionByTokenHash(tokenHash: string): SessionRecord | undefined {
  return db.prepare('SELECT id, user_id, expires_at FROM sessions WHERE token_hash = ?')
    .get(tokenHash) as SessionRecord | undefined;
}

export function deleteSessionById(id: number): void {
  db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
}

export function deleteSessionByTokenHash(tokenHash: string): void {
  db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
}

export function deleteExpiredSessions(): number {
  return db.prepare("DELETE FROM sessions WHERE julianday(expires_at) <= julianday('now')").run().changes;
}
