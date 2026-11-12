import type { EffectivePlanSnapshot, Env } from "../types";
import { allowRate } from "../lib/rate-limit";
import { json, readJson } from "../lib/http";
import type { AuthContext } from "./auth";

const rows = <T>(result: D1Result<T>): T[] => result.results || [];

type PlanRow = {
  id: number; code: string; name: string; price_inr: number; duration_days: number | null;
  tier: "FREE" | "PRO"; features_json: string; enabled: number; sort_order: number;
};

/** Keeps the account on Free after expiry and promotes any queued renewal automatically. */
export async function refreshSubscriptionStates(env: Env): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(`UPDATE user_subscriptions SET status='EXPIRED',updated_at=CURRENT_TIMESTAMP
      WHERE status='ACTIVE' AND expires_at IS NOT NULL AND datetime(expires_at)<=datetime('now')
      AND plan_id IN (SELECT id FROM subscription_plans WHERE tier='PRO')`),
    // A queued Pro subscription replaces the permanent Free row when its start date arrives.
    env.DB.prepare(`UPDATE user_subscriptions SET status='SUPERSEDED',updated_at=CURRENT_TIMESTAMP
      WHERE status='ACTIVE' AND plan_id IN (SELECT id FROM subscription_plans WHERE tier='FREE')
      AND EXISTS (SELECT 1 FROM user_subscriptions queued JOIN subscription_plans qp ON qp.id=queued.plan_id
        WHERE queued.user_id=user_subscriptions.user_id AND queued.status='PENDING' AND qp.tier='PRO'
          AND queued.starts_at IS NOT NULL AND datetime(queued.starts_at)<=datetime('now'))`),
    // Promote only the earliest due queued plan for each user, never multiple rows at once.
    env.DB.prepare(`UPDATE user_subscriptions SET status='ACTIVE',updated_at=CURRENT_TIMESTAMP
      WHERE id IN (SELECT q.id FROM user_subscriptions q
        WHERE q.status='PENDING' AND q.starts_at IS NOT NULL AND datetime(q.starts_at)<=datetime('now')
          AND NOT EXISTS (SELECT 1 FROM user_subscriptions active WHERE active.user_id=q.user_id AND active.status='ACTIVE')
          AND q.id=(SELECT q2.id FROM user_subscriptions q2 WHERE q2.user_id=q.user_id AND q2.status='PENDING'
            AND q2.starts_at IS NOT NULL AND datetime(q2.starts_at)<=datetime('now')
            ORDER BY datetime(q2.starts_at),q2.id LIMIT 1))`),
    env.DB.prepare(`INSERT INTO user_subscriptions(user_id,plan_id,status,starts_at,expires_at,amount_paid_inr)
      SELECT u.id,p.id,'ACTIVE',CURRENT_TIMESTAMP,NULL,0
      FROM app_user u JOIN subscription_plans p ON p.code='FREE' AND p.enabled=1
      WHERE u.role='STUDENT'
        AND NOT EXISTS (SELECT 1 FROM user_subscriptions a WHERE a.user_id=u.id AND a.status='ACTIVE')
        AND NOT EXISTS (SELECT 1 FROM user_subscriptions q WHERE q.user_id=u.id AND q.status='PENDING')`),
  ]);
}

function parseFeatures(value: string): Record<string, unknown> {
  try { const parsed = JSON.parse(value); return parsed && typeof parsed === "object" ? parsed : {}; }
  catch { return {}; }
}

/**
 * Resolve the effective plan with one read-only, user-scoped query.
 * Expired Pro rows are ignored immediately even if the hourly cron has not
 * yet materialised the Free subscription row. A due queued Pro row is treated
 * as active immediately; the scheduled job later normalises its stored status.
 * This function never runs global UPDATE batches.
 */
export async function getEffectivePlan(env: Env, userId: number): Promise<EffectivePlanSnapshot | null> {
  const current = await env.DB.prepare(`SELECT us.id AS subscription_id,
      CASE WHEN us.status='PENDING' THEN 'ACTIVE' ELSE us.status END AS status,
      us.starts_at,us.expires_at,us.amount_paid_inr,
      p.id AS plan_id,p.code AS plan_code,p.name AS plan_name,p.tier,p.features_json,p.duration_days
    FROM user_subscriptions us
    JOIN subscription_plans p ON p.id=us.plan_id
    WHERE us.user_id=? AND (
      (us.status='ACTIVE' AND (p.tier='FREE' OR us.expires_at IS NULL OR datetime(us.expires_at)>datetime('now')))
      OR
      (us.status='PENDING' AND p.tier='PRO' AND us.starts_at IS NOT NULL
        AND datetime(us.starts_at)<=datetime('now')
        AND (us.expires_at IS NULL OR datetime(us.expires_at)>datetime('now')))
    )
    ORDER BY CASE WHEN p.tier='PRO' THEN 0 ELSE 1 END,
      CASE WHEN us.status='ACTIVE' THEN 0 ELSE 1 END,
      us.id DESC
    LIMIT 1`).bind(userId).first<EffectivePlanSnapshot>();
  if (current) return current;

  // If a previous Pro row was superseded and the hourly cron has not run yet,
  // still enforce Free permissions without writing or globally refreshing data.
  const free = await env.DB.prepare(`SELECT id AS plan_id,code AS plan_code,name AS plan_name,
      tier,features_json,duration_days FROM subscription_plans
    WHERE code='FREE' AND enabled=1 LIMIT 1`).first<Omit<EffectivePlanSnapshot,
      'subscription_id'|'status'|'starts_at'|'expires_at'|'amount_paid_inr'>>();
  if (!free) return null;
  return {
    subscription_id: null,
    status: 'ACTIVE',
    starts_at: null,
    expires_at: null,
    amount_paid_inr: 0,
    ...free,
  };
}

export async function hasFeature(
  env: Env,
  userId: number,
  feature: string,
  resolvedPlan?: EffectivePlanSnapshot | null,
): Promise<boolean> {
  const current = resolvedPlan === undefined ? await getEffectivePlan(env, userId) : resolvedPlan;
  if (!current) return false;
  const features = parseFeatures(String(current.features_json || "{}"));
  return features[feature] === true;
}

export async function requireFeature(env: Env, userId: number, feature: string): Promise<boolean> {
  return hasFeature(env, userId, feature);
}

export async function handleSubscriptions(request: Request, env: Env, auth: AuthContext): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method.toUpperCase();
  const userId = auth.user.id;

  if (path === "/api/billing/overview" && method === "GET") {
    const [planResult, current, historyResult, claimsResult, transactionsResult] = await Promise.all([
      env.DB.prepare("SELECT * FROM subscription_plans WHERE enabled=1 ORDER BY sort_order,price_inr").all<PlanRow>(),
      auth.plan === undefined ? getEffectivePlan(env, userId) : Promise.resolve(auth.plan),
      env.DB.prepare(`SELECT us.id,us.status,us.starts_at,us.expires_at,us.amount_paid_inr,us.created_at,
          p.code AS plan_code,p.name AS plan_name,p.tier,p.duration_days
        FROM user_subscriptions us JOIN subscription_plans p ON p.id=us.plan_id
        WHERE us.user_id=? ORDER BY us.created_at DESC LIMIT 30`).bind(userId).all(),
      env.DB.prepare(`SELECT pc.id,pc.expected_amount_inr,pc.utr_reference,pc.student_note,pc.status,
          pc.rejection_reason,pc.created_at,pc.reviewed_at,p.code AS plan_code,p.name AS plan_name
        FROM payment_claims pc JOIN subscription_plans p ON p.id=pc.plan_id
        WHERE pc.user_id=? ORDER BY pc.created_at DESC LIMIT 20`).bind(userId).all(),
      env.DB.prepare(`SELECT pt.id,pt.amount_inr,pt.utr_reference,pt.verified_at,p.name AS plan_name
        FROM payment_transactions pt JOIN subscription_plans p ON p.id=pt.plan_id
        WHERE pt.user_id=? ORDER BY pt.verified_at DESC LIMIT 20`).bind(userId).all(),
    ]);
    const whatsappNumber = (env.WHATSAPP_NUMBER || "").replace(/[^0-9]/g, "");
    const configured = whatsappNumber.length >= 10 && !/X{4,}/i.test(env.WHATSAPP_NUMBER || "");
    return json({
      plans: rows(planResult).map((plan) => ({ ...plan, features: parseFeatures(plan.features_json) })),
      currentSubscription: current ? {
        ...current,
        features: parseFeatures(String(current.features_json || "{}")),
      } : null,
      history: rows(historyResult),
      paymentClaims: rows(claimsResult),
      paymentHistory: rows(transactionsResult),
      whatsapp: { configured, number: configured ? whatsappNumber : null, email: auth.user.email },
    });
  }

  if (path === "/api/billing/payment-claims" && method === "POST") {
    if (!(await allowRate(env, "payment-claim-user", String(userId), 5, 3600))) {
      return json({ error: "You have submitted too many payment claims. Please try again later." }, 429, { "retry-after": "3600" });
    }
    const body = await readJson<{ planCode?: unknown; utrReference?: unknown; studentNote?: unknown }>(request);
    const planCode = typeof body.planCode === "string" ? body.planCode.trim().toUpperCase() : "";
    const utr = typeof body.utrReference === "string" ? body.utrReference.trim().toUpperCase() : "";
    const note = typeof body.studentNote === "string" ? body.studentNote.trim() : "";
    if (!/^[A-Z0-9-]{8,30}$/.test(utr)) return json({ error: "Enter a valid UPI UTR/reference (8–30 letters, numbers or hyphens)." }, 400);
    if (note.length > 500) return json({ error: "The note must be 500 characters or fewer." }, 400);
    const plan = await env.DB.prepare("SELECT id,name,price_inr,tier FROM subscription_plans WHERE code=? AND enabled=1")
      .bind(planCode).first<{ id: number; name: string; price_inr: number; tier: string }>();
    if (!plan || plan.tier !== "PRO" || plan.price_inr <= 0) return json({ error: "Select an available paid plan." }, 400);
    const openClaim = await env.DB.prepare("SELECT id FROM payment_claims WHERE user_id=? AND status IN ('SUBMITTED','UNDER_REVIEW') LIMIT 1")
      .bind(userId).first<{ id: number }>();
    if (openClaim) return json({ error: "You already have a payment verification request under review." }, 409);
    try {
      const result = await env.DB.prepare(`INSERT INTO payment_claims(user_id,plan_id,expected_amount_inr,utr_reference,student_note,status)
        VALUES(?,?,?,?,?,'SUBMITTED')`).bind(userId, plan.id, plan.price_inr, utr, note || null).run();
      return json({ ok: true, claimId: Number(result.meta.last_row_id), message: "Payment reference submitted. Your subscription will activate after admin verification." }, 201);
    } catch (error) {
      if (String(error).toLowerCase().includes("unique")) return json({ error: "This UTR/reference has already been submitted. Check the number and contact support if you think this is a mistake." }, 409);
      throw error;
    }
  }
  return null;
}
