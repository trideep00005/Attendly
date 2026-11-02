import bcrypt from "bcryptjs";
import type { Env } from "../types";
import { constantTimeEqual } from "../lib/crypto";
import { json } from "../lib/http";

/** One-time server-side bootstrap. A separate admin account avoids elevating a student account. */
export async function handleAdminBootstrap(request: Request, env: Env): Promise<Response | null> {
  if (new URL(request.url).pathname !== "/api/admin/bootstrap" || request.method !== "POST") return null;

  const suppliedToken = request.headers.get("x-attendly-bootstrap-token") || "";
  const configuredToken = env.SUPER_ADMIN_BOOTSTRAP_TOKEN || "";
  if (configuredToken.length < 32 || !(await constantTimeEqual(suppliedToken, configuredToken))) {
    return json({ error: "Bootstrap is not configured or the bootstrap token is invalid." }, 403);
  }

  const username = env.SUPER_ADMIN_USERNAME?.trim();
  const email = env.SUPER_ADMIN_EMAIL?.trim().toLowerCase();
  const password = env.SUPER_ADMIN_PASSWORD;
  if (!username || username.length < 3 || username.length > 32 || !/^[a-zA-Z0-9_.-]+$/.test(username) ||
      !email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
      !password || password.length < 12 || password.length > 128) {
    return json({ error: "Configure a valid Super Admin username, email and a 12–128 character password in Worker Secrets." }, 503);
  }

  const existingAdmin = await env.DB.prepare("SELECT id FROM app_user WHERE role='SUPER_ADMIN' LIMIT 1").first<{ id: number }>();
  if (existingAdmin) return json({ error: "The Super Admin has already been created. Bootstrap is permanently closed." }, 409);

  // Never promote an imported student just because an environment username/email matches.
  const collision = await env.DB.prepare("SELECT id FROM app_user WHERE username=? COLLATE NOCASE OR email=? COLLATE NOCASE LIMIT 1")
    .bind(username, email).first<{ id: number }>();
  if (collision) return json({ error: "That username or email is already in use. Choose a separate Super Admin account; existing student accounts will not be changed." }, 409);

  const passwordHash = await bcrypt.hash(password, 12);
  try {
    const created = await env.DB.prepare(`INSERT INTO app_user(username,email,password_hash,role,account_status)
      VALUES(?,?,?,'SUPER_ADMIN','ACTIVE')`).bind(username, email, passwordHash).run();
    const adminId = Number(created.meta.last_row_id);
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO app_settings(setting_key,setting_value,updated_by)
        VALUES('super_admin_bootstrap_consumed','true',?)`).bind(adminId),
      env.DB.prepare(`INSERT INTO audit_logs(actor_user_id,action,target_type,target_id,reason,metadata_json)
        VALUES(?,?,?,?,?,?)`).bind(adminId, "SUPER_ADMIN_BOOTSTRAPPED", "USER", String(adminId), "Initial Super Admin created through protected one-time environment bootstrap.", JSON.stringify({ username, email })),
    ]);
    return json({ ok: true, message: "Initial Super Admin account created. Sign in using the configured Super Admin username and password." }, 201);
  } catch (error) {
    if (String(error).toLowerCase().includes("unique")) return json({ error: "A Super Admin or matching account already exists. Bootstrap was not completed." }, 409);
    throw error;
  }
}
