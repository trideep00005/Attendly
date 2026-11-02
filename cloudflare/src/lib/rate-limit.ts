import type { Env } from "../types";
import { sha256 } from "./crypto";

/** D1-backed atomic fixed-window limiter. Keys are hashed before storage. */
export async function allowRate(
  env: Env,
  scope: string,
  identity: string,
  limit: number,
  windowSeconds: number,
): Promise<boolean> {
  const now = Math.floor(Date.now() / 1000);
  const keyHash = await sha256(`${scope}:${identity}`);
  const row = await env.DB.prepare(`
    INSERT INTO auth_rate_limits(key_hash,window_start_epoch,request_count,updated_at)
    VALUES(?,?,1,CURRENT_TIMESTAMP)
    ON CONFLICT(key_hash) DO UPDATE SET
      request_count=CASE
        WHEN auth_rate_limits.window_start_epoch <= ? THEN 1
        ELSE auth_rate_limits.request_count + 1
      END,
      window_start_epoch=CASE
        WHEN auth_rate_limits.window_start_epoch <= ? THEN excluded.window_start_epoch
        ELSE auth_rate_limits.window_start_epoch
      END,
      updated_at=CURRENT_TIMESTAMP
    RETURNING request_count
  `).bind(keyHash, now, now - windowSeconds, now - windowSeconds)
    .first<{ request_count: number }>();
  return Number(row?.request_count || 0) <= limit;
}

export function requestIp(request: Request): string {
  // The Worker is reached through Cloudflare; CF-Connecting-IP is the edge-provided client IP.
  return (request.headers.get("cf-connecting-ip") || "unknown").slice(0, 80);
}

export async function authRateAllowed(
  env: Env,
  request: Request,
  scope: string,
  identity: string,
  limit: number,
  windowSeconds: number,
): Promise<boolean> {
  const ip = requestIp(request);
  return allowRate(env, scope, `${ip}:${identity.toLowerCase().slice(0, 254)}`, limit, windowSeconds);
}
