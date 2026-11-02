import type { Env } from "../types";
import { HttpError, json, readJson, validateOrigin } from "../lib/http";

export const CURRENT_POLICY_VERSIONS = {
  TERMS: "1.0",
  PRIVACY: "1.0",
  REFUND: "1.0",
  ACCEPTABLE_USE: "1.0",
} as const;

type PolicyKey = keyof typeof CURRENT_POLICY_VERSIONS;

export async function handleLegal(request: Request, env: Env, userId: number): Promise<Response | null> {
  const url = new URL(request.url);
  const method = request.method.toUpperCase();

  if (url.pathname === "/api/legal/acceptance" && method === "GET") {
    const rows = await env.DB.prepare(`SELECT policy_key,policy_version,accepted_at,accepted_via
      FROM policy_acceptances WHERE user_id=? ORDER BY accepted_at DESC`).bind(userId)
      .all<{ policy_key: PolicyKey; policy_version: string; accepted_at: string; accepted_via: string }>();
    const accepted: Record<string, { version: string; acceptedAt: string; source: string }> = {};
    for (const row of rows.results || []) {
      if (!accepted[row.policy_key]) accepted[row.policy_key] = {
        version: row.policy_version, acceptedAt: row.accepted_at, source: row.accepted_via,
      };
    }
    const supportEmail = env.SUPPORT_EMAIL && !/example\.com$/i.test(env.SUPPORT_EMAIL)
      ? env.SUPPORT_EMAIL : null;
    return json({ currentVersions: CURRENT_POLICY_VERSIONS, accepted, supportEmail });
  }

  if (url.pathname === "/api/legal/accept" && method === "POST") {
    if (!validateOrigin(request)) return json({ error: "Invalid request origin." }, 403);
    const body = await readJson<{ acceptTerms?: unknown; acceptPrivacy?: unknown }>(request);
    if (body.acceptTerms !== true || body.acceptPrivacy !== true) {
      return json({ error: "Please acknowledge the Terms, Refund and Acceptable Use policies and the Privacy Policy." }, 400);
    }
    const acceptedAt = new Date().toISOString();
    const policyKeys = Object.keys(CURRENT_POLICY_VERSIONS) as PolicyKey[];
    const statements = policyKeys.map((key) => env.DB.prepare(`INSERT INTO policy_acceptances
      (user_id,policy_key,policy_version,accepted_at,accepted_via) VALUES(?,?,?,?, 'IN_APP')
      ON CONFLICT(user_id,policy_key,policy_version) DO NOTHING`)
      .bind(userId, key, CURRENT_POLICY_VERSIONS[key], acceptedAt));
    statements.push(env.DB.prepare(`INSERT INTO audit_logs(actor_user_id,action,target_type,target_id,reason,metadata_json)
      VALUES(?,'POLICIES_ACKNOWLEDGED','USER',?,'User acknowledged the current Attendly policies.',json_object('termsVersion',?,'privacyVersion',?,'refundVersion',?,'acceptableUseVersion',?))`)
      .bind(userId, String(userId), CURRENT_POLICY_VERSIONS.TERMS, CURRENT_POLICY_VERSIONS.PRIVACY,
        CURRENT_POLICY_VERSIONS.REFUND, CURRENT_POLICY_VERSIONS.ACCEPTABLE_USE));
    await env.DB.batch(statements);
    return json({ ok: true, acceptedAt, versions: CURRENT_POLICY_VERSIONS });
  }

  return null;
}
