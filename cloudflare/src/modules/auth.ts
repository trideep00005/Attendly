import bcrypt from "bcryptjs";
import type { Env, UserRow } from "../types";
import { cookieHeader, json, parseCookies, readJson, HttpError, validateOrigin } from "../lib/http";
import { constantTimeEqual, randomToken, SESSION_COOKIE, SESSION_SECONDS, sha256 } from "../lib/crypto";
import { authRateAllowed, allowRate, requestIp } from "../lib/rate-limit";
import { sendOtpEmail } from "./email";
import { CURRENT_POLICY_VERSIONS } from "./legal";
import { getPlatformControls } from "../lib/platform-controls";

export interface AuthContext { user: UserRow; }

type OtpPurpose = "REGISTER" | "PASSWORD_RESET" | "ADMIN_LOGIN";
type OtpRow = {
  id: number; email: string; purpose: OtpPurpose; otp_hash: string; otp_salt: string;
  payload_json: string | null; attempt_count: number; expires_at: string; consumed_at: string | null;
};

function validUsername(username: unknown): username is string {
  return typeof username === "string" && username.trim().length >= 3 && username.trim().length <= 32 && /^[a-zA-Z0-9_.-]+$/.test(username.trim());
}
function validPassword(password: unknown): password is string {
  return typeof password === "string" && password.length >= 12 && password.length <= 128;
}
function validEmail(email: unknown): email is string {
  return typeof email === "string" && email.trim().length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}
function normalizeEmail(value: string): string { return value.trim().toLowerCase(); }
function otpCode(): string {
  // Rejection sampling avoids modulo bias when generating a six-digit code.
  const range = 4_294_000_000;
  let value = 0;
  do { value = crypto.getRandomValues(new Uint32Array(1))[0]; } while (value >= range);
  return String(value % 1_000_000).padStart(6, "0");
}
function isoAfter(seconds: number): string { return new Date(Date.now() + seconds * 1000).toISOString().slice(0, 19).replace("T", " "); }
function maskEmail(email: string): string {
  const [name, domain] = email.split("@");
  return `${name.slice(0, 2)}${"*".repeat(Math.max(2, Math.min(8, name.length - 2)))}@${domain}`;
}

async function createSession(request: Request, env: Env, userId: number): Promise<string> {
  const token = randomToken();
  const expiresAt = new Date(Date.now() + SESSION_SECONDS * 1000).toISOString();
  await env.DB.prepare("INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)")
    .bind(await sha256(token), userId, expiresAt).run();
  return cookieHeader(SESSION_COOKIE, token, {
    maxAge: SESSION_SECONDS,
    secure: new URL(request.url).protocol === "https:",
  });
}

export async function authenticate(request: Request, env: Env): Promise<AuthContext | null> {
  const token = parseCookies(request)[SESSION_COOKIE];
  if (!token) return null;
  const tokenHash = await sha256(token);
  const row = await env.DB.prepare(`
    SELECT u.id,u.username,u.email,u.role,u.account_status,u.suspension_reason,u.created_at,
      s.id AS session_id,s.expires_at
    FROM sessions s JOIN app_user u ON u.id=s.user_id
    WHERE s.token_hash=? LIMIT 1
  `).bind(tokenHash).first<UserRow & { session_id: number; expires_at: string; suspension_reason: string | null }>();
  if (!row) return null;
  if (Date.parse(row.expires_at) <= Date.now()) {
    await env.DB.prepare("DELETE FROM sessions WHERE id=?").bind(row.session_id).run();
    return null;
  }
  if (row.account_status === "SUSPENDED") {
    throw new HttpError(403, "Your Attendly account has been suspended. Review the administrator's notice and sign out.", "ACCOUNT_SUSPENDED", {
      reason: row.suspension_reason || "Your account is temporarily suspended. Please contact Attendly support for assistance.",
    });
  }
  if (row.account_status !== "ACTIVE") {
    await env.DB.prepare("DELETE FROM sessions WHERE id=?").bind(row.session_id).run();
    return null;
  }
  const { session_id: _sessionId, expires_at: _expiresAt, suspension_reason: _suspensionReason, ...user } = row;
  return { user };
}

function clearSessionCookie(request: Request): string {
  return cookieHeader(SESSION_COOKIE, "", { clear: true, maxAge: 0, secure: new URL(request.url).protocol === "https:" });
}

async function createStudentAccount(env: Env, username: string, email: string, passwordHash: string): Promise<number> {
  const freePlan = await env.DB.prepare("SELECT id FROM subscription_plans WHERE code='FREE' AND enabled=1").first<{ id: number }>();
  if (!freePlan) throw new Error("Free subscription plan is missing. Apply the D1 plan seed migration before enabling registration.");
  const result = await env.DB.prepare("INSERT INTO app_user(username,email,password_hash,role,email_verified_at) VALUES(?,?,?,'STUDENT',CURRENT_TIMESTAMP)")
    .bind(username, email, passwordHash).run();
  const userId = Number(result.meta.last_row_id);
  try {
    const free = await env.DB.prepare(`INSERT INTO user_subscriptions(user_id,plan_id,status,starts_at,expires_at,amount_paid_inr)
      VALUES(?,?,'ACTIVE',CURRENT_TIMESTAMP,NULL,0)`).bind(userId, freePlan.id).run();
    if (Number(free.meta.changes || 0) !== 1) throw new Error("Could not activate the Free plan.");
    return userId;
  } catch (error) {
    await env.DB.prepare("DELETE FROM app_user WHERE id=?").bind(userId).run();
    throw error;
  }
}

async function checkResendCooldown(env: Env, email: string, purpose: OtpPurpose): Promise<void> {
  const previous = await env.DB.prepare(`SELECT created_at FROM auth_email_otps
    WHERE email=? AND purpose=? AND consumed_at IS NULL ORDER BY id DESC LIMIT 1`)
    .bind(email, purpose).first<{ created_at: string }>();
  if (!previous) return;
  const created = new Date(`${previous.created_at.replace(" ", "T")}Z`).getTime();
  if (Number.isFinite(created) && Date.now() - created < 60_000) {
    throw new HttpError(429, "Please wait 60 seconds before requesting another code.");
  }
}

async function createAndSendOtp(
  env: Env,
  email: string,
  displayName: string,
  purpose: OtpPurpose,
  payload: Record<string, unknown> | null,
): Promise<void> {
  await checkResendCooldown(env, email, purpose);
  const code = otpCode();
  const salt = randomToken(16);
  const codeHash = await otpDigest(env, salt, code);
  const results = await env.DB.batch([
    env.DB.prepare(`UPDATE auth_email_otps SET consumed_at=CURRENT_TIMESTAMP
      WHERE email=? AND purpose=? AND consumed_at IS NULL`).bind(email, purpose),
    env.DB.prepare(`INSERT INTO auth_email_otps
      (email,purpose,otp_hash,otp_salt,payload_json,attempt_count,expires_at)
      VALUES(?,?,?,?,?,0,?)`).bind(email, purpose, codeHash, salt, payload ? JSON.stringify(payload) : null, isoAfter(600)),
  ]);
  const otpId = Number(results[1]?.meta.last_row_id || 0);
  if (!otpId) throw new HttpError(503, "We could not create a verification code. Please try again later.");
  try {
    await sendOtpEmail(env, email, displayName, code, purpose);
  } catch (error) {
    await env.DB.prepare("UPDATE auth_email_otps SET consumed_at=CURRENT_TIMESTAMP WHERE id=?").bind(otpId).run();
    throw error;
  }
}

async function findOtp(env: Env, email: string, purpose: OtpPurpose): Promise<OtpRow | null> {
  return env.DB.prepare(`SELECT id,email,purpose,otp_hash,otp_salt,payload_json,attempt_count,expires_at,consumed_at
    FROM auth_email_otps WHERE email=? AND purpose=? AND consumed_at IS NULL
      AND datetime(expires_at)>CURRENT_TIMESTAMP ORDER BY id DESC LIMIT 1`)
    .bind(email, purpose).first<OtpRow>();
}

async function otpDigest(env: Env, salt: string, code: string): Promise<string> {
  const secret = env.OTP_HASH_SECRET?.trim();
  if (!secret || secret.length < 32) throw new HttpError(503, "Email security is not configured. Please contact support.");
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(`${salt}:${code}`));
  return Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function verifyOtpHash(env: Env, row: OtpRow, supplied: string): Promise<boolean> {
  if (row.attempt_count >= 5) return false;
  const matches = await constantTimeEqual(row.otp_hash, await otpDigest(env, row.otp_salt, supplied));
  if (!matches) {
    await env.DB.prepare(`UPDATE auth_email_otps SET attempt_count=MIN(attempt_count+1,5)
      WHERE id=? AND consumed_at IS NULL AND attempt_count<5`).bind(row.id).run();
  }
  return matches;
}

async function consumeOtp(env: Env, row: OtpRow): Promise<boolean> {
  // Unique marker prevents concurrent requests from reusing one successfully verified OTP.
  const marker = `${new Date().toISOString()}-${randomToken(8)}`;
  const result = await env.DB.prepare(`UPDATE auth_email_otps SET consumed_at=?
    WHERE id=? AND consumed_at IS NULL AND attempt_count<5 AND datetime(expires_at)>CURRENT_TIMESTAMP`)
    .bind(marker, row.id).run();
  return Number(result.meta.changes || 0) === 1;
}

async function startRegistrationOtp(request: Request, env: Env): Promise<Response> {
  if (!validateOrigin(request)) return json({ error: "Invalid request origin." }, 403);
  const platform = await getPlatformControls(env);
  if (platform.maintenanceEnabled) return json({ error: platform.maintenanceReason || "Attendly is temporarily unavailable while we carry out maintenance.", code: "PLATFORM_MAINTENANCE", maintenanceMode: true }, 503);
  if (platform.registrationPaused || env.REGISTRATION_ENABLED === "false") {
    return json({ error: platform.registrationReason || "New registrations are temporarily paused by the Attendly administrator. Existing accounts can still sign in.", code: "REGISTRATION_PAUSED", registrationPaused: true }, 403);
  }
  const body = await readJson<{ username?: unknown; password?: unknown; email?: unknown; acceptTerms?: unknown; acceptPrivacy?: unknown }>(request);
  if (body.acceptTerms !== true || body.acceptPrivacy !== true) return json({ error: "Please accept the Terms, Refund and Acceptable Use policies and acknowledge the Privacy Policy before registering." }, 400);
  if (!validUsername(body.username)) return json({ error: "Username must be 3–32 characters and use only letters, numbers, dot, underscore or hyphen." }, 400);
  if (!validPassword(body.password)) return json({ error: "Password must contain 12–128 characters." }, 400);
  if (!validEmail(body.email)) return json({ error: "Enter a valid email address." }, 400);
  const email = normalizeEmail(body.email);
  const username = body.username.trim();

  if (!(await authRateAllowed(env, request, "register-ip", "all", 6, 3600)) ||
      !(await authRateAllowed(env, request, "register-email", email, 3, 3600)) ||
      !(await allowRate(env, "register-email-global", email, 3, 3600))) {
    return json({ error: "Too many registration attempts. Please try again later." }, 429, { "retry-after": "3600" });
  }
  const collision = await env.DB.prepare("SELECT id FROM app_user WHERE username=? COLLATE NOCASE OR email=? COLLATE NOCASE LIMIT 1")
    .bind(username, email).first<{ id: number }>();
  if (collision) return json({ error: "That username or email is already registered. Please sign in or use another email." }, 409);

  const passwordHash = await bcrypt.hash(body.password, 12);
  const acceptedAt = new Date().toISOString();
  await createAndSendOtp(env, email, username, "REGISTER", { username, passwordHash, acceptedAt, policyVersions: CURRENT_POLICY_VERSIONS });
  return json({ ok: true, requiresOtp: true, email: maskEmail(email), expiresInSeconds: 600, resendAfterSeconds: 60 }, 202);
}

async function verifyRegistrationOtp(request: Request, env: Env): Promise<Response> {
  if (!validateOrigin(request)) return json({ error: "Invalid request origin." }, 403);
  const platform = await getPlatformControls(env);
  if (platform.maintenanceEnabled) return json({ error: platform.maintenanceReason || "Attendly is temporarily unavailable while we carry out maintenance.", code: "PLATFORM_MAINTENANCE", maintenanceMode: true }, 503);
  if (platform.registrationPaused || env.REGISTRATION_ENABLED === "false") {
    return json({ error: platform.registrationReason || "New registrations are temporarily paused by the Attendly administrator. Existing accounts can still sign in.", code: "REGISTRATION_PAUSED", registrationPaused: true }, 403);
  }
  const body = await readJson<{ email?: unknown; otp?: unknown }>(request);
  if (!validEmail(body.email) || typeof body.otp !== "string" || !/^\d{6}$/.test(body.otp)) return json({ error: "Enter your registered email and the six-digit verification code." }, 400);
  const email = normalizeEmail(body.email);
  if (!(await authRateAllowed(env, request, "register-verify", email, 12, 3600))) return json({ error: "Too many verification attempts. Request a new code later." }, 429);
  const row = await findOtp(env, email, "REGISTER");
  if (!row || row.attempt_count >= 5) return json({ error: "The verification code is invalid or expired. Request a new code." }, 400);
  if (!(await verifyOtpHash(env, row, body.otp))) return json({ error: "Incorrect verification code. Check the code and try again." }, 400);
  let payload: { username?: string; passwordHash?: string; acceptedAt?: string; policyVersions?: typeof CURRENT_POLICY_VERSIONS };
  try { payload = JSON.parse(row.payload_json || "{}"); } catch { throw new HttpError(400, "Registration request is invalid. Please register again."); }
  if (!validUsername(payload.username) || typeof payload.passwordHash !== "string" || !payload.passwordHash.startsWith("$2") ||
      typeof payload.acceptedAt !== "string" || !Number.isFinite(Date.parse(payload.acceptedAt)) ||
      !payload.policyVersions || Object.entries(CURRENT_POLICY_VERSIONS).some(([key, version]) => payload.policyVersions?.[key as keyof typeof CURRENT_POLICY_VERSIONS] !== version)) {
    throw new HttpError(400, "Registration request is invalid or policy consent is missing. Please register again and accept the current policies.");
  }
  const freePlan = await env.DB.prepare("SELECT id FROM subscription_plans WHERE code='FREE' AND enabled=1").first<{ id: number }>();
  if (!freePlan) throw new HttpError(503, "Free plan configuration is unavailable. Please contact support.");

  if (!(await consumeOtp(env, row))) {
    throw new HttpError(409, "This verification request has already been used or expired. Please register again.");
  }
  try {
    const acceptedAt = payload.acceptedAt;
    const policyVersions = payload.policyVersions;
    const results = await env.DB.batch([
      env.DB.prepare(`INSERT INTO app_user(username,email,password_hash,role,email_verified_at)
        VALUES(?,?,?,'STUDENT',CURRENT_TIMESTAMP)`).bind(payload.username, email, payload.passwordHash),
      env.DB.prepare(`INSERT INTO user_subscriptions(user_id,plan_id,status,starts_at,expires_at,amount_paid_inr)
        SELECT id,?,'ACTIVE',CURRENT_TIMESTAMP,NULL,0 FROM app_user WHERE email=? COLLATE NOCASE`).bind(freePlan.id, email),
      env.DB.prepare(`INSERT INTO audit_logs(actor_user_id,action,target_type,target_id,reason,metadata_json)
        SELECT id,'STUDENT_REGISTERED','USER',CAST(id AS TEXT),'Email OTP verified during registration and current policies accepted.',json_object('emailVerified',true,'policyVersion','1.0')
        FROM app_user WHERE email=? COLLATE NOCASE`).bind(email),
      ...([
        ['TERMS', policyVersions.TERMS],
        ['PRIVACY', policyVersions.PRIVACY],
        ['REFUND', policyVersions.REFUND],
        ['ACCEPTABLE_USE', policyVersions.ACCEPTABLE_USE],
      ] as const).map(([key, version]) => env.DB.prepare(`INSERT INTO policy_acceptances
        (user_id,policy_key,policy_version,accepted_at,accepted_via)
        SELECT id,?,?,?,'REGISTRATION' FROM app_user WHERE email=? COLLATE NOCASE`)
        .bind(key, version, acceptedAt, email)),
    ]);
    if (Number(results[1]?.meta.changes || 0) !== 1) {
      throw new HttpError(500, "Your account could not be fully initialized. Please contact support.");
    }
    const user = await env.DB.prepare("SELECT id,username FROM app_user WHERE email=? COLLATE NOCASE LIMIT 1")
      .bind(email).first<{ id: number; username: string }>();
    if (!user) throw new Error("Registration account was not created.");
    const cookie = await createSession(request, env, user.id);
    return json({ user: { username: user.username }, emailVerified: true }, 201, { "set-cookie": cookie });
  } catch (error) {
    if (error instanceof HttpError) throw error;
    if (String(error).toLowerCase().includes("unique")) return json({ error: "That username or email is already registered. Please sign in." }, 409);
    throw error;
  }
}

async function startPasswordReset(request: Request, env: Env): Promise<Response> {
  if (!validateOrigin(request)) return json({ error: "Invalid request origin." }, 403);
  const body = await readJson<{ email?: unknown }>(request);
  if (!validEmail(body.email)) return json({ error: "Enter a valid email address." }, 400);
  const email = normalizeEmail(body.email);
  if (!(await authRateAllowed(env, request, "password-reset-ip", "all", 10, 3600)) ||
      !(await authRateAllowed(env, request, "password-reset-email", email, 3, 3600)) ||
      !(await allowRate(env, "password-reset-email-global", email, 3, 3600))) {
    return json({ error: "Too many password reset requests. Please try again later." }, 429, { "retry-after": "3600" });
  }
  if (!env.BREVO_API_KEY || !env.BREVO_SENDER_EMAIL || (env.OTP_HASH_SECRET || "").trim().length < 32) {
    return json({ error: "Password recovery is temporarily unavailable. Please contact support." }, 503);
  }
  const user = await env.DB.prepare(`SELECT id,username,email FROM app_user
    WHERE email=? COLLATE NOCASE AND account_status='ACTIVE' AND role IN ('STUDENT','ADMIN','SUPPORT_ADMIN','SUPER_ADMIN') LIMIT 1`)
    .bind(email).first<{ id: number; username: string; email: string }>();
  // Avoid account enumeration even when the mail provider is temporarily unavailable.
  if (user) {
    try { await createAndSendOtp(env, email, user.username, "PASSWORD_RESET", { userId: user.id }); }
    catch (error) { console.error("Password reset email delivery failed", error); }
  }
  return json({ ok: true, message: "If an active Attendly account uses that email, a verification code has been sent. Check your inbox and spam folder." }, 202);
}

async function completePasswordReset(request: Request, env: Env): Promise<Response> {
  if (!validateOrigin(request)) return json({ error: "Invalid request origin." }, 403);
  const body = await readJson<{ email?: unknown; otp?: unknown; newPassword?: unknown }>(request);
  if (!validEmail(body.email) || typeof body.otp !== "string" || !/^\d{6}$/.test(body.otp) || !validPassword(body.newPassword)) {
    return json({ error: "Enter a valid email, six-digit code and a new password of 12–128 characters." }, 400);
  }
  const email = normalizeEmail(body.email);
  if (!(await authRateAllowed(env, request, "password-reset-verify", email, 10, 3600))) return json({ error: "Too many verification attempts. Please try again later." }, 429);
  const row = await findOtp(env, email, "PASSWORD_RESET");
  if (!row || row.attempt_count >= 5) return json({ error: "The verification code is invalid or expired. Request another code." }, 400);
  if (!(await verifyOtpHash(env, row, body.otp))) return json({ error: "Incorrect verification code. Check the code and try again." }, 400);
  let payload: { userId?: number };
  try { payload = JSON.parse(row.payload_json || "{}"); } catch { throw new HttpError(400, "Password reset request is invalid."); }
  if (!Number.isInteger(payload.userId) || Number(payload.userId) < 1) throw new HttpError(400, "Password reset request is invalid.");
  const passwordHash = await bcrypt.hash(body.newPassword, 12);
  if (!(await consumeOtp(env, row))) {
    throw new HttpError(409, "This password reset request has already been used or expired. Request another code.");
  }
  const results = await env.DB.batch([
    env.DB.prepare(`UPDATE app_user SET password_hash=?,email_verified_at=COALESCE(email_verified_at,CURRENT_TIMESTAMP),updated_at=CURRENT_TIMESTAMP
      WHERE id=? AND email=? COLLATE NOCASE AND account_status='ACTIVE'`).bind(passwordHash, payload.userId, email),
    // These follow-up statements are guarded by the exact new hash so they only run
    // when the account update above succeeded in this atomic D1 batch.
    env.DB.prepare(`DELETE FROM sessions WHERE user_id=? AND EXISTS (
      SELECT 1 FROM app_user WHERE id=? AND password_hash=? AND account_status='ACTIVE'
    )`).bind(payload.userId, payload.userId, passwordHash),
    env.DB.prepare(`INSERT INTO audit_logs(actor_user_id,action,target_type,target_id,reason,metadata_json)
      SELECT id,'PASSWORD_RESET_COMPLETED','USER',CAST(id AS TEXT),'Password reset verified by email OTP.',json_object('sessionsRevoked',true)
      FROM app_user WHERE id=? AND password_hash=? AND account_status='ACTIVE'`)
      .bind(payload.userId, passwordHash),
  ]);
  if (Number(results[0]?.meta.changes || 0) !== 1) {
    throw new HttpError(409, "This password reset request can no longer be completed. Request another code.");
  }
  return json({ ok: true, message: "Your password has been updated. Please sign in with your new password." });
}

async function verifyAdminLoginOtp(request: Request, env: Env): Promise<Response> {
  if (!validateOrigin(request)) return json({ error: "Invalid request origin." }, 403);
  const body = await readJson<{ email?: unknown; otp?: unknown }>(request);
  if (!validEmail(body.email) || typeof body.otp !== "string" || !/^\d{6}$/.test(body.otp)) {
    return json({ error: "Enter the administrator email and six-digit verification code." }, 400);
  }
  const email = normalizeEmail(body.email);
  if (!(await authRateAllowed(env, request, "admin-login-verify", email, 10, 3600)) ||
      !(await allowRate(env, "admin-login-verify-global", email, 10, 3600))) {
    return json({ error: "Too many verification attempts. Please try again later." }, 429, { "retry-after": "3600" });
  }
  const row = await findOtp(env, email, "ADMIN_LOGIN");
  if (!row || row.attempt_count >= 5) return json({ error: "The sign-in code is invalid or expired. Sign in again to request a new code." }, 400);
  if (!(await verifyOtpHash(env, row, body.otp))) return json({ error: "Incorrect verification code. Check the code and try again." }, 400);
  let payload: { userId?: number };
  try { payload = JSON.parse(row.payload_json || "{}"); } catch { throw new HttpError(400, "Administrator sign-in request is invalid."); }
  if (!Number.isInteger(payload.userId) || Number(payload.userId) < 1) throw new HttpError(400, "Administrator sign-in request is invalid.");
  const user = await env.DB.prepare(`SELECT id,username,email,role,account_status FROM app_user
    WHERE id=? AND email=? COLLATE NOCASE`).bind(payload.userId, email)
    .first<{ id: number; username: string; email: string; role: string; account_status: string }>();
  if (!user || user.role === "STUDENT" || user.account_status !== "ACTIVE") return json({ error: "This administrator sign-in is no longer valid." }, 403);
  if (!(await consumeOtp(env, row))) return json({ error: "This sign-in code has already been used. Sign in again." }, 409);
  await env.DB.batch([
    env.DB.prepare("UPDATE app_user SET email_verified_at=COALESCE(email_verified_at,CURRENT_TIMESTAMP) WHERE id=?").bind(user.id),
    env.DB.prepare(`INSERT INTO audit_logs(actor_user_id,action,target_type,target_id,reason,metadata_json)
      VALUES(?,'ADMIN_LOGIN_OTP_VERIFIED','USER',?,'Administrator email OTP verified.',json_object('mfa','email-otp'))`)
      .bind(user.id, String(user.id)),
  ]);
  const cookie = await createSession(request, env, user.id);
  return json({ user: { username: user.username }, mfaVerified: true }, 200, { "set-cookie": cookie });
}

async function resendAdminLoginOtp(request: Request, env: Env): Promise<Response> {
  if (!validateOrigin(request)) return json({ error: "Invalid request origin." }, 403);
  const body = await readJson<{ email?: unknown }>(request);
  if (!validEmail(body.email)) return json({ error: "Enter a valid administrator email address." }, 400);
  const email = normalizeEmail(body.email);
  if (!(await authRateAllowed(env, request, "admin-login-resend-ip", email, 6, 3600)) ||
      !(await allowRate(env, "admin-login-resend-global", email, 3, 3600))) {
    return json({ error: "Too many code requests. Please try again later." }, 429, { "retry-after": "3600" });
  }
  const user = await env.DB.prepare(`SELECT id,username,email FROM app_user
    WHERE email=? COLLATE NOCASE AND role IN ('ADMIN','SUPPORT_ADMIN','SUPER_ADMIN') AND account_status='ACTIVE' LIMIT 1`)
    .bind(email).first<{ id: number; username: string; email: string }>();
  if (!user) return json({ ok: true, message: "If this is an active administrator account, a new code has been sent." }, 202);
  await createAndSendOtp(env, email, user.username, "ADMIN_LOGIN", { userId: user.id });
  return json({ ok: true, email: maskEmail(email), message: "A new administrator sign-in code has been sent." }, 202);
}

export async function handleAuth(request: Request, env: Env): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method.toUpperCase();

  if (path === "/api/status" && method === "GET") {
    const [row, controls] = await Promise.all([
      env.DB.prepare("SELECT COUNT(*) AS total FROM app_user").first<{ total: number }>(),
      getPlatformControls(env),
    ]);
    const registrationPaused = controls.registrationPaused || env.REGISTRATION_ENABLED === "false";
    return json({
      setupRequired: Number(row?.total || 0) === 0,
      registrationEnabled: !registrationPaused,
      registrationPaused,
      registrationReason: controls.registrationReason || (env.REGISTRATION_ENABLED === "false" ? "Registration is temporarily disabled by the deployment configuration." : ""),
      maintenanceEnabled: controls.maintenanceEnabled,
      maintenanceReason: controls.maintenanceReason,
      maintenanceType: controls.maintenanceType,
      emailVerificationRequired: true,
    });
  }

  // The protected Super Admin bootstrap is the only account-creation route for initial deployment.
  if (path === "/api/auth/setup" && method === "POST") {
    return json({ error: "Initial account setup is handled through the protected administrator bootstrap. Use email-verified registration for student accounts." }, 403);
  }

  if (path === "/api/auth/register/start" && method === "POST") return startRegistrationOtp(request, env);
  if (path === "/api/auth/register/verify" && method === "POST") return verifyRegistrationOtp(request, env);
  if (path === "/api/auth/password-reset/start" && method === "POST") return startPasswordReset(request, env);
  if (path === "/api/auth/password-reset/complete" && method === "POST") return completePasswordReset(request, env);
  if (path === "/api/auth/admin-login/verify" && method === "POST") return verifyAdminLoginOtp(request, env);
  if (path === "/api/auth/admin-login/resend" && method === "POST") return resendAdminLoginOtp(request, env);

  if (path === "/api/auth/login" && method === "POST") {
    if (!validateOrigin(request)) return json({ error: "Invalid request origin." }, 403);
    const body = await readJson<{ username?: unknown; password?: unknown }>(request);
    const username = typeof body.username === "string" ? body.username.trim() : "";
    // Bound login inputs before bcrypt work to avoid oversized-input CPU abuse.
    if (username.length < 3 || username.length > 32 || typeof body.password !== "string" || body.password.length < 1 || body.password.length > 128) {
      return json({ error: "Incorrect username or password." }, 401);
    }
    const ip = requestIp(request);
    const ipAllowed = await allowRate(env, "login-ip", ip, 40, 900);
    const accountAllowed = await authRateAllowed(env, request, "login-account", username || "unknown", 10, 900);
    const globalAccountAllowed = await allowRate(env, "login-account-global", username.toLowerCase() || "unknown", 20, 3600);
    if (!ipAllowed || !accountAllowed || !globalAccountAllowed) return json({ error: "Too many sign-in attempts. Please wait before trying again." }, 429, { "retry-after": "900" });
    const user = await env.DB.prepare(`SELECT id,username,email,password_hash,role,account_status,suspension_reason,created_at
      FROM app_user WHERE username=? COLLATE NOCASE LIMIT 1`).bind(username)
      .first<UserRow & { password_hash: string; suspension_reason: string | null }>();
    if (!user || typeof body.password !== "string" || !(await bcrypt.compare(body.password, user.password_hash))) {
      return json({ error: "Incorrect username or password." }, 401);
    }
    if (user.account_status === "SUSPENDED") {
      return json({
        error: "Your Attendly account has been suspended.",
        code: "ACCOUNT_SUSPENDED",
        reason: user.suspension_reason || "Your account is temporarily suspended. Please contact Attendly support for assistance.",
      }, 403);
    }
    if (user.account_status !== "ACTIVE") return json({ error: "Incorrect username or password." }, 401);
    if (user.role === "STUDENT") {
      const platform = await getPlatformControls(env);
      if (platform.maintenanceEnabled) {
        return json({
          error: platform.maintenanceReason || "Attendly is temporarily unavailable. Only administrators can sign in during maintenance.",
          code: "PLATFORM_MAINTENANCE",
          maintenanceMode: true,
        }, 503);
      }
    }
    if (user.role !== "STUDENT") {
      if (!user.email) return json({ error: "This administrator account has no email address configured. Contact the Super Admin." }, 409);
      await createAndSendOtp(env, normalizeEmail(user.email), user.username, "ADMIN_LOGIN", { userId: user.id });
      return json({ requiresOtp: true, email: user.email, maskedEmail: maskEmail(user.email) }, 202);
    }
    const cookie = await createSession(request, env, user.id);
    return json({ user: { username: user.username } }, 200, { "set-cookie": cookie });
  }

  if (path === "/api/auth/logout" && method === "POST") {
    if (!validateOrigin(request)) return json({ error: "Invalid request origin." }, 403);
    const token = parseCookies(request)[SESSION_COOKIE];
    if (token) await env.DB.prepare("DELETE FROM sessions WHERE token_hash=?").bind(await sha256(token)).run();
    return json({ ok: true }, 200, { "set-cookie": clearSessionCookie(request) });
  }

  if (path === "/api/auth/me" && method === "GET") {
    const auth = await authenticate(request, env);
    if (!auth) return json({ error: "Please log in to continue." }, 401, { "set-cookie": clearSessionCookie(request) });
    const verification = await env.DB.prepare("SELECT email_verified_at FROM app_user WHERE id=?").bind(auth.user.id).first<{ email_verified_at: string | null }>();
    return json({ user: { username: auth.user.username, email: auth.user.email, role: auth.user.role, emailVerified: Boolean(verification?.email_verified_at) } });
  }
  return null;
}
