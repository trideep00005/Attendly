import bcrypt from "bcryptjs";
import type { Env, UserRole } from "../types";
import { json, readJson } from "../lib/http";
import type { AuthContext } from "./auth";
import { getPlatformControls } from "../lib/platform-controls";

const rows = <T>(result: D1Result<T>): T[] => result.results || [];
const PERMISSIONS = ["dashboard.read", "users.read", "users.status", "payments.read", "payments.verify", "subscriptions.read", "subscriptions.grant", "plans.read", "plans.manage", "admins.manage", "audit.read"] as const;
type Permission = typeof PERMISSIONS[number];
const DEFAULTS: Record<Exclude<UserRole, "STUDENT" | "SUPER_ADMIN">, Permission[]> = {
  ADMIN: ["dashboard.read", "users.read", "users.status", "payments.read", "payments.verify", "subscriptions.read", "subscriptions.grant", "plans.read", "audit.read"],
  SUPPORT_ADMIN: ["dashboard.read", "users.read", "subscriptions.read"],
};

async function can(env: Env, auth: AuthContext, permission: Permission): Promise<boolean> {
  if (auth.user.role === "SUPER_ADMIN") return true;
  if (auth.user.role === "STUDENT") return false;
  const override = await env.DB.prepare("SELECT allowed FROM admin_permission_overrides WHERE admin_user_id=? AND permission_key=?")
    .bind(auth.user.id, permission).first<{ allowed: number }>();
  if (override) return override.allowed === 1;
  return DEFAULTS[auth.user.role as "ADMIN" | "SUPPORT_ADMIN"].includes(permission);
}

async function requirePermission(env: Env, auth: AuthContext, permission: Permission): Promise<boolean> {
  return can(env, auth, permission);
}

async function audit(env: Env, actorId: number, action: string, targetType: string, targetId: string, reason: string, metadata: unknown = {}): Promise<void> {
  await env.DB.prepare(`INSERT INTO audit_logs(actor_user_id,action,target_type,target_id,reason,metadata_json)
    VALUES(?,?,?,?,?,?)`).bind(actorId, action, targetType, targetId, reason, JSON.stringify(metadata)).run();
}

function sqlDateTime(date: Date): string {
  return date.toISOString().slice(0, 19).replace("T", " ");
}
function asDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const normalized = value.includes("T") ? value : `${value.replace(" ", "T")}Z`;
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export async function handleAdmin(request: Request, env: Env, auth: AuthContext): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method.toUpperCase();
  if (!path.startsWith("/api/admin/")) return null;

  // Global platform switches are deliberately restricted to the Super Admin.
  // They affect every student account and therefore must not be delegated by
  // ordinary Admin or Support Admin permission overrides.
  if (path === "/api/admin/platform-controls" && method === "GET") {
    if (auth.user.role !== "SUPER_ADMIN") return json({ error: "Only the Super Admin can view global platform controls." }, 403);
    const controls = await getPlatformControls(env);
    return json({ controls: {
      ...controls,
      registrationPaused: controls.registrationPaused || env.REGISTRATION_ENABLED === "false",
      registrationReason: controls.registrationReason || (env.REGISTRATION_ENABLED === "false" ? "Registration is disabled in the deployment configuration." : ""),
    } });
  }

  if (path === "/api/admin/platform-controls" && method === "PUT") {
    if (auth.user.role !== "SUPER_ADMIN") return json({ error: "Only the Super Admin can change global platform controls." }, 403);
    const body = await readJson<{
      maintenanceEnabled?: unknown;
      maintenanceType?: unknown;
      maintenanceReason?: unknown;
      registrationPaused?: unknown;
      registrationReason?: unknown;
    }>(request);
    if (typeof body.maintenanceEnabled !== "boolean" || typeof body.registrationPaused !== "boolean") {
      return json({ error: "Choose valid maintenance and registration states." }, 400);
    }
    const maintenanceTypes = ["MAINTENANCE", "NEW_UPDATE", "PROBLEM_FIX", "OTHER"];
    const maintenanceType = typeof body.maintenanceType === "string" && maintenanceTypes.includes(body.maintenanceType)
      ? body.maintenanceType : "OTHER";
    const maintenanceReason = typeof body.maintenanceReason === "string" ? body.maintenanceReason.trim() : "";
    const registrationReason = typeof body.registrationReason === "string" ? body.registrationReason.trim() : "";
    if (body.maintenanceEnabled && (maintenanceReason.length < 4 || maintenanceReason.length > 500)) {
      return json({ error: "Enter a maintenance explanation between 4 and 500 characters." }, 400);
    }
    if (body.registrationPaused && (registrationReason.length < 4 || registrationReason.length > 500)) {
      return json({ error: "Enter a registration-pause message between 4 and 500 characters." }, 400);
    }
    if (env.REGISTRATION_ENABLED === "false" && !body.registrationPaused) {
      return json({ error: "Registration is disabled by the Cloudflare deployment variable REGISTRATION_ENABLED=false. Update that variable before reopening registration." }, 409);
    }

    const previous = await getPlatformControls(env);
    const settings: Array<[string, string]> = [
      ["platform_maintenance_enabled", String(body.maintenanceEnabled)],
      ["platform_maintenance_type", maintenanceType],
      ["platform_maintenance_reason", maintenanceReason],
      ["platform_registration_paused", String(body.registrationPaused)],
      ["platform_registration_reason", registrationReason],
    ];
    await env.DB.batch([
      ...settings.map(([key, value]) => env.DB.prepare(`INSERT INTO app_settings(setting_key,setting_value,updated_by)
        VALUES(?,?,?) ON CONFLICT(setting_key) DO UPDATE SET setting_value=excluded.setting_value,
        updated_by=excluded.updated_by,updated_at=CURRENT_TIMESTAMP`).bind(key, value, auth.user.id)),
      env.DB.prepare(`INSERT INTO audit_logs(actor_user_id,action,target_type,target_id,reason,metadata_json)
        VALUES(?, 'PLATFORM_CONTROLS_UPDATED', 'PLATFORM', 'GLOBAL', ?, ?)`)
        .bind(auth.user.id,
          [body.maintenanceEnabled ? `Maintenance enabled: ${maintenanceReason}` : "Maintenance disabled",
           body.registrationPaused ? `Registration paused: ${registrationReason}` : "Registration reopened"].join("; "),
          JSON.stringify({
            previous: { maintenanceEnabled: previous.maintenanceEnabled, registrationPaused: previous.registrationPaused },
            current: { maintenanceEnabled: body.maintenanceEnabled, maintenanceType, registrationPaused: body.registrationPaused },
          })),
    ]);
    const controls = await getPlatformControls(env);
    return json({ ok: true, message: "Global platform controls updated.", controls });
  }

  if (path === "/api/admin/overview" && method === "GET") {
    if (!(await requirePermission(env, auth, "dashboard.read"))) return json({ error: "You do not have permission to view the admin dashboard." }, 403);
    const now = new Date();
    const monthStart = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-01`;
    const quarterMonth = Math.floor(now.getUTCMonth() / 3) * 3 + 1;
    const quarterStart = `${now.getUTCFullYear()}-${String(quarterMonth).padStart(2, "0")}-01`;
    const yearStart = `${now.getUTCFullYear()}-01-01`;
    const [users, plans, pending, revenue, registrations] = await Promise.all([
      env.DB.prepare(`SELECT COUNT(*) AS total,
          SUM(CASE WHEN account_status='ACTIVE' THEN 1 ELSE 0 END) AS active,
          SUM(CASE WHEN account_status<>'ACTIVE' THEN 1 ELSE 0 END) AS inactive
        FROM app_user WHERE role='STUDENT'`).first<Record<string, number>>(),
      env.DB.prepare(`SELECT COALESCE(p.tier,'FREE') AS tier,COUNT(*) AS users
        FROM app_user u
        LEFT JOIN user_subscriptions us ON us.id=(
          SELECT candidate.id
          FROM user_subscriptions candidate
          JOIN subscription_plans cp ON cp.id=candidate.plan_id
          WHERE candidate.user_id=u.id AND (
            (candidate.status='ACTIVE' AND (cp.tier='FREE' OR candidate.expires_at IS NULL OR datetime(candidate.expires_at)>datetime('now')))
            OR
            (candidate.status='PENDING' AND cp.tier='PRO' AND candidate.starts_at IS NOT NULL
              AND datetime(candidate.starts_at)<=datetime('now')
              AND (candidate.expires_at IS NULL OR datetime(candidate.expires_at)>datetime('now')))
          )
          ORDER BY CASE WHEN cp.tier='PRO' THEN 0 ELSE 1 END,
            CASE WHEN candidate.status='ACTIVE' THEN 0 ELSE 1 END,
            candidate.id DESC
          LIMIT 1
        )
        LEFT JOIN subscription_plans p ON p.id=us.plan_id
        WHERE u.role='STUDENT'
        GROUP BY COALESCE(p.tier,'FREE')`).all<{ tier: string; users: number }>(),
      env.DB.prepare("SELECT COUNT(*) AS total FROM payment_claims WHERE status IN ('SUBMITTED','UNDER_REVIEW')").first<{ total: number }>(),
      env.DB.prepare(`SELECT COUNT(*) AS payments,COALESCE(SUM(amount_inr),0) AS total,
          COALESCE(SUM(CASE WHEN substr(verified_at,1,7)=substr(CURRENT_DATE,1,7) THEN amount_inr ELSE 0 END),0) AS month,
          COALESCE(SUM(CASE WHEN verified_at>=? THEN amount_inr ELSE 0 END),0) AS quarter,
          COALESCE(SUM(CASE WHEN verified_at>=? THEN amount_inr ELSE 0 END),0) AS year
        FROM payment_transactions`).bind(quarterStart, yearStart).first<Record<string, number>>(),
      env.DB.prepare(`SELECT substr(created_at,1,7) AS month,COUNT(*) AS registrations
        FROM app_user WHERE role='STUDENT' AND created_at>=datetime('now','-6 months')
        GROUP BY substr(created_at,1,7) ORDER BY month`).all<{ month: string; registrations: number }>(),
    ]);
    const planCounts = rows(plans);
    const mayViewRevenue = await requirePermission(env, auth, "payments.read");
    const totalStudents = Number(users?.total || 0);
    const proUsers = Number(planCounts.find((p) => p.tier === "PRO")?.users || 0);
    return json({
      users: { total: totalStudents, active: Number(users?.active || 0), inactive: Number(users?.inactive || 0), free: Number(planCounts.find((p) => p.tier === "FREE")?.users || 0), pro: proUsers, conversionRate: totalStudents ? Number((proUsers / totalStudents * 100).toFixed(2)) : 0 },
      subscriptions: { active: Number(planCounts.reduce((sum, p) => sum + Number(p.users || 0), 0)), pendingPayments: mayViewRevenue ? Number(pending?.total || 0) : 0 },
      revenue: mayViewRevenue ? { successfulPayments: Number(revenue?.payments || 0), totalInr: Number(revenue?.total || 0), monthlyInr: Number(revenue?.month || 0), quarterlyInr: Number(revenue?.quarter || 0), yearlyInr: Number(revenue?.year || 0) } : { successfulPayments: 0, totalInr: 0, monthlyInr: 0, quarterlyInr: 0, yearlyInr: 0 },
      registrations: rows(registrations),
    });
  }

  if (path === "/api/admin/users" && method === "GET") {
    if (!(await requirePermission(env, auth, "users.read"))) return json({ error: "You do not have permission to view users." }, 403);
    const search = (url.searchParams.get("q") || "").trim().slice(0, 100);
    const result = await env.DB.prepare(`SELECT u.id,u.username,u.email,u.role,u.account_status,u.created_at,
        COALESCE(p.code,'FREE') AS plan_code,COALESCE(p.name,'Free') AS plan_name,
        CASE WHEN us.status='PENDING' THEN 'ACTIVE' ELSE COALESCE(us.status,'ACTIVE') END AS subscription_status,us.expires_at
      FROM app_user u
      LEFT JOIN user_subscriptions us ON us.id=(SELECT s.id FROM user_subscriptions s
        JOIN subscription_plans sp ON sp.id=s.plan_id
        WHERE s.user_id=u.id AND (
          (s.status='ACTIVE' AND (sp.tier='FREE' OR s.expires_at IS NULL OR datetime(s.expires_at)>datetime('now')))
          OR (s.status='PENDING' AND sp.tier='PRO' AND s.starts_at IS NOT NULL
            AND datetime(s.starts_at)<=datetime('now') AND (s.expires_at IS NULL OR datetime(s.expires_at)>datetime('now')))
        )
        ORDER BY CASE WHEN sp.tier='PRO' THEN 0 ELSE 1 END,
          CASE WHEN s.status='ACTIVE' THEN 0 ELSE 1 END, s.id DESC LIMIT 1)
      LEFT JOIN subscription_plans p ON p.id=us.plan_id
      WHERE u.role='STUDENT' AND (?='' OR u.username LIKE '%'||?||'%' OR u.email LIKE '%'||?||'%' OR CAST(u.id AS TEXT)=?)
      ORDER BY u.created_at DESC LIMIT 100`).bind(search, search, search, search).all();
    return json({ users: rows(result) });
  }

  if (path === "/api/admin/payment-claims" && method === "GET") {
    if (!(await requirePermission(env, auth, "payments.read"))) return json({ error: "You do not have permission to view payment requests." }, 403);
    const status = url.searchParams.get("status") || "OPEN";
    const allowed = ["OPEN", "SUBMITTED", "UNDER_REVIEW", "APPROVED", "REJECTED", "ALL"];
    if (!allowed.includes(status)) return json({ error: "Invalid payment status filter." }, 400);
    const condition = status === "OPEN" ? "pc.status IN ('SUBMITTED','UNDER_REVIEW')" : status === "ALL" ? "1=1" : "pc.status=?";
    const statement = env.DB.prepare(`SELECT pc.id,pc.user_id,pc.expected_amount_inr,pc.utr_reference,pc.student_note,pc.status,pc.rejection_reason,pc.created_at,pc.reviewed_at,
        u.username,u.email,p.code AS plan_code,p.name AS plan_name
      FROM payment_claims pc JOIN app_user u ON u.id=pc.user_id JOIN subscription_plans p ON p.id=pc.plan_id
      WHERE ${condition} ORDER BY pc.created_at DESC LIMIT 200`);
    const result = status === "OPEN" || status === "ALL" ? await statement.all() : await statement.bind(status).all();
    return json({ claims: rows(result) });
  }

  const paymentMatch = path.match(/^\/api\/admin\/payment-claims\/(\d+)\/(approve|reject)$/);
  if (paymentMatch && method === "POST") {
    const action = paymentMatch[2];
    if (!(await requirePermission(env, auth, action === "approve" ? "payments.verify" : "payments.verify"))) return json({ error: "You do not have permission to review payments." }, 403);
    const claimId = Number(paymentMatch[1]);
    const claim = await env.DB.prepare(`SELECT pc.*,p.name AS plan_name,p.code AS plan_code,p.duration_days,p.tier
      FROM payment_claims pc JOIN subscription_plans p ON p.id=pc.plan_id WHERE pc.id=?`)
      .bind(claimId).first<Record<string, unknown>>();
    if (!claim) return json({ error: "Payment request not found." }, 404);
    if (claim.status !== "SUBMITTED" && claim.status !== "UNDER_REVIEW") return json({ error: "This payment request has already been reviewed." }, 409);

    if (action === "reject") {
      const body = await readJson<{ reason?: unknown }>(request);
      const reason = typeof body.reason === "string" ? body.reason.trim() : "";
      if (reason.length < 4 || reason.length > 500) return json({ error: "Enter a rejection reason (4–500 characters)." }, 400);
      const result = await env.DB.prepare(`UPDATE payment_claims SET status='REJECTED',rejection_reason=?,reviewed_by=?,reviewed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP
        WHERE id=? AND status IN ('SUBMITTED','UNDER_REVIEW')`).bind(reason, auth.user.id, claimId).run();
      if (Number(result.meta.changes || 0) !== 1) return json({ error: "This payment request was already reviewed." }, 409);
      await audit(env, auth.user.id, "PAYMENT_REJECTED", "PAYMENT_CLAIM", String(claimId), reason, { userId: claim.user_id, planCode: claim.plan_code });
      return json({ ok: true, message: "Payment request rejected." });
    }

    if (claim.tier !== "PRO" || !Number(claim.duration_days)) return json({ error: "The selected plan is not a valid paid subscription." }, 400);
    const userId = Number(claim.user_id);
    const [activePro, queued] = await Promise.all([
      env.DB.prepare(`SELECT us.expires_at FROM user_subscriptions us JOIN subscription_plans p ON p.id=us.plan_id
        WHERE us.user_id=? AND us.status='ACTIVE' AND p.tier='PRO' ORDER BY us.id DESC LIMIT 1`).bind(userId).first<{ expires_at: string | null }>(),
      env.DB.prepare(`SELECT expires_at FROM user_subscriptions WHERE user_id=? AND status='PENDING' ORDER BY expires_at DESC LIMIT 1`).bind(userId).first<{ expires_at: string | null }>(),
    ]);
    const now = new Date();
    const ends = [asDate(activePro?.expires_at), asDate(queued?.expires_at)].filter((d): d is Date => !!d && d.getTime() > now.getTime());
    const base = ends.length ? new Date(Math.max(...ends.map((d) => d.getTime()))) : now;
    const startsAt = sqlDateTime(base);
    const expiresAt = sqlDateTime(new Date(base.getTime() + Number(claim.duration_days) * 86400000));
    const nextStatus = activePro || queued ? "PENDING" : "ACTIVE";
    const statements: D1PreparedStatement[] = [
      env.DB.prepare(`UPDATE payment_claims SET status='APPROVED',reviewed_by=?,reviewed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP
        WHERE id=? AND status IN ('SUBMITTED','UNDER_REVIEW')`).bind(auth.user.id, claimId),
      env.DB.prepare(`INSERT INTO payment_transactions(user_id,plan_id,payment_claim_id,amount_inr,utr_reference,verified_by,verified_at)
        SELECT user_id,plan_id,id,expected_amount_inr,utr_reference,?,CURRENT_TIMESTAMP FROM payment_claims
        WHERE id=? AND status='APPROVED' AND reviewed_by=?`).bind(auth.user.id, claimId, auth.user.id),
    ];
    if (nextStatus === "ACTIVE") {
      statements.push(env.DB.prepare("UPDATE user_subscriptions SET status='SUPERSEDED',updated_at=CURRENT_TIMESTAMP WHERE user_id=? AND status='ACTIVE'").bind(userId));
    }
    statements.push(env.DB.prepare(`INSERT INTO user_subscriptions(user_id,plan_id,status,starts_at,expires_at,amount_paid_inr,payment_transaction_id,activated_by,activation_reason)
      SELECT pc.user_id,pc.plan_id,?,?,?,pc.expected_amount_inr,pt.id,?,'UPI payment manually verified by administrator'
      FROM payment_claims pc JOIN payment_transactions pt ON pt.payment_claim_id=pc.id
      WHERE pc.id=? AND pc.status='APPROVED' AND pc.reviewed_by=?`)
      .bind(nextStatus, startsAt, expiresAt, auth.user.id, claimId, auth.user.id));
    statements.push(env.DB.prepare(`INSERT INTO audit_logs(actor_user_id,action,target_type,target_id,reason,metadata_json)
      SELECT ?, 'PAYMENT_APPROVED','PAYMENT_CLAIM',?,'UPI payment reference verified',?
      WHERE EXISTS(SELECT 1 FROM payment_transactions WHERE payment_claim_id=?)`)
      .bind(auth.user.id, String(claimId), JSON.stringify({ userId, planCode: claim.plan_code, amount: claim.expected_amount_inr, startsAt, expiresAt, subscriptionStatus: nextStatus }), claimId));
    try {
      await env.DB.batch(statements);
    } catch (error) {
      if (String(error).toLowerCase().includes("unique")) return json({ error: "This payment reference or payment request has already been used." }, 409);
      throw error;
    }
    const transaction = await env.DB.prepare("SELECT id FROM payment_transactions WHERE payment_claim_id=?").bind(claimId).first<{ id: number }>();
    if (!transaction) return json({ error: "The payment could not be activated. Please refresh and check its status." }, 409);
    return json({ ok: true, message: nextStatus === "PENDING" ? "Payment verified. The renewal is queued after the current subscription." : "Payment verified and Pro subscription activated.", subscriptionStatus: nextStatus, startsAt, expiresAt });
  }

  if (path === "/api/admin/plans" && method === "GET") {
    if (!(await requirePermission(env, auth, "plans.read"))) return json({ error: "You do not have permission to view plans." }, 403);
    const result = await env.DB.prepare("SELECT * FROM subscription_plans ORDER BY sort_order,price_inr").all();
    return json({ plans: rows(result).map((plan: any) => ({ ...plan, features: safeJson(plan.features_json) })) });
  }

  const planMatch = path.match(/^\/api\/admin\/plans\/(\d+)$/);
  if (planMatch && method === "PATCH") {
    if (auth.user.role !== "SUPER_ADMIN") return json({ error: "Only the Super Admin can change plan pricing and features." }, 403);
    const id = Number(planMatch[1]);
    const current = await env.DB.prepare("SELECT * FROM subscription_plans WHERE id=?").bind(id).first<Record<string, unknown>>();
    if (!current) return json({ error: "Plan not found." }, 404);
    const body = await readJson<{ name?: unknown; priceInr?: unknown; durationDays?: unknown; enabled?: unknown; features?: unknown }>(request);
    const name = body.name === undefined ? String(current.name) : String(body.name).trim();
    const price = body.priceInr === undefined ? Number(current.price_inr) : Number(body.priceInr);
    const duration = body.durationDays === undefined ? current.duration_days as number | null : Number(body.durationDays);
    const enabled = body.enabled === undefined ? Number(current.enabled) : body.enabled === true ? 1 : body.enabled === false ? 0 : -1;
    const features = body.features === undefined ? String(current.features_json) : JSON.stringify(body.features);
    if (name.length < 2 || name.length > 60 || !Number.isInteger(price) || price < 0 || price > 100000 || ![0,1].includes(enabled)) return json({ error: "Check the plan name, price and enabled setting." }, 400);
    if (String(current.code) === "FREE" && (price !== 0 || enabled !== 1)) return json({ error: "The Free plan must remain enabled and priced at ₹0 so new students can register." }, 400);
    if (String(current.tier) === "PRO" && (!Number.isInteger(duration) || Number(duration) < 1 || Number(duration) > 3650 || price < 1)) return json({ error: "Paid plans need a positive price and duration of 1–3650 days." }, 400);
    if (body.features !== undefined && (!body.features || typeof body.features !== "object" || Array.isArray(body.features))) return json({ error: "Features must be a JSON object." }, 400);
    await env.DB.prepare(`UPDATE subscription_plans SET name=?,price_inr=?,duration_days=?,enabled=?,features_json=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
      .bind(name, price, duration, enabled, features, id).run();
    await audit(env, auth.user.id, "PLAN_UPDATED", "SUBSCRIPTION_PLAN", String(id), "Plan configuration changed", { name, price, duration, enabled });
    return json({ ok: true });
  }

  const grantMatch = path.match(/^\/api\/admin\/users\/(\d+)\/grant-subscription$/);
  if (grantMatch && method === "POST") {
    if (!(await requirePermission(env, auth, "subscriptions.grant"))) return json({ error: "You do not have permission to grant subscriptions." }, 403);
    const targetUserId = Number(grantMatch[1]);
    const body = await readJson<{ reason?: unknown; durationDays?: unknown }>(request);
    const reason = typeof body.reason === "string" ? body.reason.trim() : "";
    const duration = Number(body.durationDays);
    if (reason.length < 4 || reason.length > 500) return json({ error: "A reason is required (4–500 characters)." }, 400);
    if (![7, 14, 30].includes(duration)) return json({ error: "Complimentary Pro access must be 7, 14 or 30 days." }, 400);
    const user = await env.DB.prepare("SELECT id,role,account_status FROM app_user WHERE id=?").bind(targetUserId)
      .first<{ id: number; role: string; account_status: string }>();
    if (!user || user.role !== "STUDENT") return json({ error: "Student account not found." }, 404);
    if (user.account_status !== "ACTIVE") return json({ error: "Activate the student's account before granting Pro access." }, 409);
    const plan = await env.DB.prepare("SELECT id,code,tier FROM subscription_plans WHERE code='PRO_MONTHLY' AND tier='PRO' LIMIT 1")
      .first<{ id: number; code: string; tier: string }>();
    if (!plan) return json({ error: "The Pro entitlement plan is missing. Check the subscription plan seed." }, 503);

    // Never replace paid access. Complimentary time is queued after the latest active/queued Pro expiry.
    const latestPro = await env.DB.prepare(`SELECT MAX(us.expires_at) AS latest_expiry
      FROM user_subscriptions us JOIN subscription_plans p ON p.id=us.plan_id
      WHERE us.user_id=? AND p.tier='PRO' AND us.status IN ('ACTIVE','PENDING') AND us.expires_at IS NOT NULL`)
      .bind(targetUserId).first<{ latest_expiry: string | null }>();
    const now = new Date();
    const existingExpiry = asDate(latestPro?.latest_expiry);
    const starts = existingExpiry && existingExpiry.getTime() > now.getTime() ? existingExpiry : now;
    const queued = starts.getTime() > now.getTime() + 1000;
    const expires = new Date(starts.getTime() + duration * 86400000);
    const status = queued ? "PENDING" : "ACTIVE";

    const statements = [] as D1PreparedStatement[];
    if (!queued) {
      statements.push(env.DB.prepare(`UPDATE user_subscriptions SET status='SUPERSEDED',updated_at=CURRENT_TIMESTAMP
        WHERE user_id=? AND status='ACTIVE' AND plan_id IN (SELECT id FROM subscription_plans WHERE tier='FREE')`).bind(targetUserId));
    }
    statements.push(env.DB.prepare(`INSERT INTO user_subscriptions(user_id,plan_id,status,starts_at,expires_at,amount_paid_inr,activated_by,activation_reason)
      VALUES(?,?,?,?,?,0,?,?)`).bind(targetUserId, plan.id, status, sqlDateTime(starts), sqlDateTime(expires), auth.user.id, reason));
    statements.push(env.DB.prepare(`INSERT INTO audit_logs(actor_user_id,action,target_type,target_id,reason,metadata_json)
      VALUES(?,'COMPLIMENTARY_SUBSCRIPTION_GRANTED','USER',?,?,?)`).bind(auth.user.id, String(targetUserId), reason,
        JSON.stringify({ planCode: plan.code, durationDays: duration, startsAt: sqlDateTime(starts), expiresAt: sqlDateTime(expires), queued })));
    await env.DB.batch(statements);
    return json({ ok: true, status, startsAt: sqlDateTime(starts), expiresAt: sqlDateTime(expires), queued,
      message: queued ? `Complimentary Pro access is queued for ${duration} days after the current Pro period.` : `Complimentary Pro access granted for ${duration} days.` });
  }

  const deleteUserMatch = path.match(/^\/api\/admin\/users\/(\d+)$/);
  if (deleteUserMatch && method === "DELETE") {
    // Permanent data erasure is deliberately restricted to the Super Admin.
    if (auth.user.role !== "SUPER_ADMIN") return json({ error: "Only the Super Admin can permanently delete student accounts." }, 403);
    const targetUserId = Number(deleteUserMatch[1]);
    if (!Number.isInteger(targetUserId) || targetUserId < 1 || targetUserId === auth.user.id) return json({ error: "Invalid student account." }, 400);
    const target = await env.DB.prepare("SELECT id,username,email,role FROM app_user WHERE id=?")
      .bind(targetUserId).first<{ id: number; username: string; email: string | null; role: string }>();
    if (!target || target.role !== "STUDENT") return json({ error: "Student account not found." }, 404);
    const body = await readJson<{ confirmUsername?: unknown }>(request);
    const confirmation = typeof body.confirmUsername === "string" ? body.confirmUsername.trim() : "";
    if (confirmation.toLowerCase() !== target.username.toLowerCase()) {
      return json({ error: `Type ${target.username} exactly to confirm permanent deletion.` }, 400);
    }

    // A student account is a complete personal-data container. Child records
    // (sessions, semesters, attendance, subjects, timetables, categories,
    // subscriptions, claims, notifications and policy acceptances) are removed
    // by the declared ON DELETE CASCADE relationships on app_user.
    // payment_transactions intentionally has restrictive accounting references,
    // so check unusual verifier references before deleting anything.
    const verifierReferences = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM payment_transactions WHERE verified_by=?"
    ).bind(targetUserId).first<{ count: number }>();
    if (Number(verifierReferences?.count || 0) > 0) {
      return json({
        error: "This student account is referenced as a payment verifier. Resolve that administrative reference before deleting the account; no data was changed.",
        code: "ACCOUNT_HAS_PAYMENT_AUDIT_REFERENCE",
      }, 409);
    }

    const statements: D1PreparedStatement[] = [];
    // Remove account-owned financial transactions before payment claims cascade.
    statements.push(env.DB.prepare(`DELETE FROM payment_transactions
      WHERE user_id=? OR payment_claim_id IN (SELECT id FROM payment_claims WHERE user_id=?)`)
      .bind(targetUserId, targetUserId));
    // Keep other users' administrative/payment records valid if this account was
    // ever referenced as an actor. Student records themselves are still erased.
    statements.push(env.DB.prepare("UPDATE user_subscriptions SET activated_by=NULL WHERE activated_by=?").bind(targetUserId));
    statements.push(env.DB.prepare("UPDATE payment_claims SET reviewed_by=NULL WHERE reviewed_by=?").bind(targetUserId));
    statements.push(env.DB.prepare("UPDATE app_settings SET updated_by=NULL WHERE updated_by=?").bind(targetUserId));
    statements.push(env.DB.prepare("UPDATE admin_permission_overrides SET updated_by=? WHERE updated_by=?")
      .bind(auth.user.id, targetUserId));
    // Sessions and email OTP payloads are explicitly cleared before account removal.
    statements.push(env.DB.prepare("DELETE FROM sessions WHERE user_id=?").bind(targetUserId));
    if (target.email) {
      statements.push(env.DB.prepare("DELETE FROM auth_email_otps WHERE email=? COLLATE NOCASE").bind(target.email));
    }
    // Remove logs authored by the student and logs that identify their account,
    // payment claims or attendance categories. Retain only a non-identifying
    // accountability event after the user row has been deleted.
    statements.push(env.DB.prepare(`DELETE FROM audit_logs
      WHERE actor_user_id=?
        OR (target_type='USER' AND target_id=?)
        OR (target_type='PAYMENT_CLAIM' AND CAST(target_id AS INTEGER) IN
            (SELECT id FROM payment_claims WHERE user_id=?))
        OR (target_type='ATTENDANCE_CATEGORY' AND CAST(target_id AS INTEGER) IN
            (SELECT id FROM attendance_categories WHERE user_id=?))`)
      .bind(targetUserId, String(targetUserId), targetUserId, targetUserId));

    const deleteUserStatementIndex = statements.length;
    statements.push(env.DB.prepare("DELETE FROM app_user WHERE id=? AND role='STUDENT'").bind(targetUserId));
    statements.push(env.DB.prepare(`INSERT INTO audit_logs(actor_user_id,action,target_type,target_id,reason,metadata_json)
      VALUES(?,'STUDENT_ACCOUNT_PERMANENTLY_DELETED','USER_ACCOUNT',NULL,
      'Student account and associated personal data permanently deleted.',json_object('personalDataPurged',true))`)
      .bind(auth.user.id));

    const deletion = await env.DB.batch(statements);
    if (Number(deletion[deleteUserStatementIndex]?.meta.changes || 0) !== 1) {
      return json({ error: "The student account could not be deleted. Refresh the directory and try again." }, 409);
    }
    return json({ ok: true, message: `Student account ${target.username} and all associated academic, attendance, routine, subscription and payment data were permanently deleted.` });
  }

  const statusMatch = path.match(/^\/api\/admin\/users\/(\d+)\/status$/);
  if (statusMatch && method === "PATCH") {
    if (!(await requirePermission(env, auth, "users.status"))) return json({ error: "You do not have permission to change account status." }, 403);
    const targetUserId = Number(statusMatch[1]);
    if (targetUserId === auth.user.id) return json({ error: "You cannot change your own account status here." }, 400);
    const body = await readJson<{ status?: unknown; reason?: unknown }>(request);
    if (!(["ACTIVE", "SUSPENDED", "DEACTIVATED"] as unknown[]).includes(body.status)) return json({ error: "Invalid account status." }, 400);
    const reason = typeof body.reason === "string" ? body.reason.trim() : "";
    if (reason.length < 4 || reason.length > 500) return json({ error: "Enter a reason (4–500 characters)." }, 400);
    const target = await env.DB.prepare("SELECT id,role FROM app_user WHERE id=?").bind(targetUserId).first<{ id: number; role: string }>();
    if (!target || target.role !== "STUDENT") return json({ error: "Student account not found." }, 404);
    await env.DB.batch([
      env.DB.prepare(`UPDATE app_user SET account_status=?,
        suspension_reason=CASE WHEN ?='SUSPENDED' THEN ? ELSE NULL END,
        updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(body.status, body.status, body.status === "SUSPENDED" ? reason : null, targetUserId),
      // Keep sessions only while suspended so each active browser can receive the reason.
      // Authentication rejects every protected request for a suspended account. On reactivation
      // (or deactivation), all old sessions are deleted so they cannot silently become valid again.
      ...(body.status === "SUSPENDED" ? [] : [env.DB.prepare("DELETE FROM sessions WHERE user_id=?").bind(targetUserId)]),
      env.DB.prepare(`INSERT INTO audit_logs(actor_user_id,action,target_type,target_id,reason,metadata_json) VALUES(?,?,?,?,?,?)`)
        .bind(auth.user.id, "STUDENT_STATUS_CHANGED", "USER", String(targetUserId), reason, JSON.stringify({ status: body.status })),
    ]);
    return json({ ok: true, message: body.status === "SUSPENDED" ? "Student suspended. The notice will be shown on their next app request." : "Student account status updated." });
  }

  if (path === "/api/admin/admin-users" && method === "GET") {
    if (auth.user.role !== "SUPER_ADMIN") return json({ error: "Only the Super Admin can manage administrator accounts." }, 403);
    const [result, overrideResult] = await Promise.all([
      env.DB.prepare("SELECT id,username,email,role,account_status,created_at FROM app_user WHERE role IN ('ADMIN','SUPPORT_ADMIN','SUPER_ADMIN') ORDER BY role,created_at").all(),
      env.DB.prepare("SELECT admin_user_id,permission_key,allowed FROM admin_permission_overrides").all<{admin_user_id:number;permission_key:string;allowed:number}>(),
    ]);
    const overrides = new Map<number, Record<string, boolean>>();
    for (const item of rows(overrideResult)) { const entry=overrides.get(item.admin_user_id)||{}; entry[item.permission_key]=item.allowed===1; overrides.set(item.admin_user_id,entry); }
    return json({ admins: rows(result).map((admin:any)=>({...admin,overrides:overrides.get(admin.id)||{}})), permissions: PERMISSIONS });
  }

  if (path === "/api/admin/admin-users" && method === "POST") {
    if (auth.user.role !== "SUPER_ADMIN") return json({ error: "Only the Super Admin can create administrator accounts." }, 403);
    const body = await readJson<{ username?: unknown; email?: unknown; password?: unknown; role?: unknown }>(request);
    const username = typeof body.username === "string" ? body.username.trim() : "";
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const password = typeof body.password === "string" ? body.password : "";
    const role = body.role;
    if (!/^[a-zA-Z0-9_.-]{3,32}$/.test(username) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 12 || password.length > 128 || (role !== "ADMIN" && role !== "SUPPORT_ADMIN")) return json({ error: "Enter a valid username, email, 12–128 character password and administrator role." }, 400);
    try {
      const passwordHash = await bcrypt.hash(password, 12);
      const result = await env.DB.prepare("INSERT INTO app_user(username,email,password_hash,role,account_status) VALUES(?,?,?,?,'ACTIVE')")
        .bind(username, email, passwordHash, role).run();
      const id = Number(result.meta.last_row_id);
      await audit(env, auth.user.id, "ADMIN_ACCOUNT_CREATED", "USER", String(id), `Created ${role} account`, { username, email, role });
      return json({ ok: true, id, username, email, role }, 201);
    } catch (error) {
      if (String(error).toLowerCase().includes("unique")) return json({ error: "That username or email is already registered." }, 409);
      throw error;
    }
  }

  const adminRoleMatch = path.match(/^\/api\/admin\/admin-users\/(\d+)\/role$/);
  if (adminRoleMatch && method === "PATCH") {
    if (auth.user.role !== "SUPER_ADMIN") return json({ error: "Only the Super Admin can change administrator roles." }, 403);
    const adminId=Number(adminRoleMatch[1]);
    if(adminId===auth.user.id) return json({ error: "You cannot change your own administrator role." }, 400);
    const target=await env.DB.prepare("SELECT id,role FROM app_user WHERE id=?").bind(adminId).first<{id:number;role:string}>();
    if(!target || !["ADMIN","SUPPORT_ADMIN"].includes(target.role)) return json({ error: "Administrator account not found." },404);
    const body=await readJson<{role?:unknown;reason?:unknown}>(request);
    if(body.role!=="ADMIN" && body.role!=="SUPPORT_ADMIN") return json({error:"Choose Admin or Support Admin."},400);
    const reason=typeof body.reason==="string"?body.reason.trim():"Role updated by Super Admin";
    await env.DB.batch([
      env.DB.prepare("UPDATE app_user SET role=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(body.role,adminId),
      env.DB.prepare("DELETE FROM admin_permission_overrides WHERE admin_user_id=?").bind(adminId),
      env.DB.prepare("INSERT INTO audit_logs(actor_user_id,action,target_type,target_id,reason,metadata_json) VALUES(?,'ADMIN_ROLE_CHANGED','USER',?,?,?)").bind(auth.user.id,String(adminId),reason,JSON.stringify({from:target.role,to:body.role})),
    ]);
    return json({ok:true});
  }

  const adminStatusMatch = path.match(/^\/api\/admin\/admin-users\/(\d+)\/status$/);
  if(adminStatusMatch && method === "PATCH") {
    if(auth.user.role!=="SUPER_ADMIN") return json({error:"Only the Super Admin can change administrator account status."},403);
    const adminId=Number(adminStatusMatch[1]);
    if(adminId===auth.user.id) return json({error:"You cannot deactivate your own account."},400);
    const target=await env.DB.prepare("SELECT id,role FROM app_user WHERE id=?").bind(adminId).first<{id:number;role:string}>();
    if(!target || !["ADMIN","SUPPORT_ADMIN"].includes(target.role)) return json({error:"Administrator account not found."},404);
    const body=await readJson<{status?:unknown;reason?:unknown}>(request);
    if(body.status!=="ACTIVE" && body.status!=="SUSPENDED" && body.status!=="DEACTIVATED") return json({error:"Invalid account status."},400);
    const reason=typeof body.reason==="string"?body.reason.trim():"";
    if(reason.length<4 || reason.length>500) return json({error:"Enter a reason (4–500 characters)."},400);
    await env.DB.batch([
      env.DB.prepare("UPDATE app_user SET account_status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(body.status,adminId),
      ...(body.status==="ACTIVE"?[]:[env.DB.prepare("DELETE FROM sessions WHERE user_id=?").bind(adminId)]),
      env.DB.prepare("INSERT INTO audit_logs(actor_user_id,action,target_type,target_id,reason,metadata_json) VALUES(?,'ADMIN_STATUS_CHANGED','USER',?,?,?)").bind(auth.user.id,String(adminId),reason,JSON.stringify({status:body.status})),
    ]);
    return json({ok:true});
  }

  const permissionMatch = path.match(/^\/api\/admin\/admin-users\/(\d+)\/permissions$/);
  if (permissionMatch && method === "PUT") {
    if (auth.user.role !== "SUPER_ADMIN") return json({ error: "Only the Super Admin can change administrator permissions." }, 403);
    const adminId = Number(permissionMatch[1]);
    const target = await env.DB.prepare("SELECT id,role FROM app_user WHERE id=?").bind(adminId).first<{ id: number; role: string }>();
    if (!target || (target.role !== "ADMIN" && target.role !== "SUPPORT_ADMIN")) return json({ error: "Administrator account not found." }, 404);
    const body = await readJson<{ permissionKey?: unknown; allowed?: unknown }>(request);
    if (typeof body.permissionKey !== "string" || !(PERMISSIONS as readonly string[]).includes(body.permissionKey) || typeof body.allowed !== "boolean") return json({ error: "Choose a valid permission and allowed value." }, 400);
    await env.DB.prepare(`INSERT INTO admin_permission_overrides(admin_user_id,permission_key,allowed,updated_by)
      VALUES(?,?,?,?) ON CONFLICT(admin_user_id,permission_key) DO UPDATE SET allowed=excluded.allowed,updated_by=excluded.updated_by,updated_at=CURRENT_TIMESTAMP`)
      .bind(adminId, body.permissionKey, body.allowed ? 1 : 0, auth.user.id).run();
    await audit(env, auth.user.id, "ADMIN_PERMISSION_UPDATED", "USER", String(adminId), "Administrator permission override changed", { permission: body.permissionKey, allowed: body.allowed });
    return json({ ok: true });
  }

  if (path === "/api/admin/audit-logs" && method === "GET") {
    if (!(await requirePermission(env, auth, "audit.read"))) return json({ error: "You do not have permission to view audit logs." }, 403);
    const result = await env.DB.prepare(`SELECT a.id,a.action,a.target_type,a.target_id,a.reason,a.metadata_json,a.created_at,u.username AS actor
      FROM audit_logs a LEFT JOIN app_user u ON u.id=a.actor_user_id ORDER BY a.created_at DESC LIMIT 200`).all();
    return json({ logs: rows(result) });
  }
  return json({ error: "Admin endpoint not found." }, 404);
}

function safeJson(value: unknown): Record<string, unknown> {
  try { const result = JSON.parse(String(value || "{}")); return result && typeof result === "object" ? result : {}; }
  catch { return {}; }
}
