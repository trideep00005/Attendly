import type { Env } from "./types";
import { HttpError, json, readJson, validateOrigin } from "./lib/http";
import { handleAuth, authenticate } from "./modules/auth";
import { handleAcademic } from "./modules/academic";
import { handleSubscriptions, refreshSubscriptionStates } from "./modules/subscriptions";
import { handleAdmin } from "./modules/admin";
import { handleAdminBootstrap } from "./modules/admin-bootstrap";
import { handleLegal } from "./modules/legal";
import { allowRate, requestIp } from "./lib/rate-limit";
import { getPlatformControls, maintenanceBlockedResponse } from "./lib/platform-controls";

const API_PREFIX = "/api/";

function secureResponse(response: Response, request: Request): Response {
  const headers = new Headers(response.headers);
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "DENY");
  headers.set("X-Permitted-Cross-Domain-Policies", "none");
  // Never allow browsers or intermediary caches to store API responses that may
  // contain account, session, payment, attendance or one-time-code metadata.
  if (new URL(request.url).pathname.startsWith(API_PREFIX)) {
    headers.set("Cache-Control", "no-store, no-cache, must-revalidate, private");
    headers.set("Pragma", "no-cache");
  }
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  headers.set("Cross-Origin-Opener-Policy", "same-origin");
  headers.set("Cross-Origin-Resource-Policy", "same-origin");
  headers.set("X-XSS-Protection", "0");
  if (new URL(request.url).protocol === "https:") headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  if ((headers.get("content-type") || "").includes("text/html")) {
    headers.set("Content-Security-Policy", [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' data: https://fonts.gstatic.com",
      "img-src 'self' data: blob: https:",
      "connect-src 'self'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
      "upgrade-insecure-requests",
    ].join("; "));
  }
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

async function routeRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith(API_PREFIX)) return env.ASSETS.fetch(request);

  try {
    if (["POST", "PUT", "PATCH", "DELETE"].includes(request.method.toUpperCase())) {
      if (!validateOrigin(request) || request.headers.get("sec-fetch-site") === "cross-site") {
        return json({ error: "Cross-site request rejected." }, 403);
      }
    }

    // A coarse edge-facing API limiter complements route-specific account/IP limits.
    if (request.method !== "GET" && url.pathname !== "/api/admin/bootstrap") {
      const allowed = await allowRate(env, "write-api-ip", requestIp(request), 240, 60);
      if (!allowed) return json({ error: "Too many requests. Please slow down and try again." }, 429, { "retry-after": "60" });
    }

    // During maintenance, expose only the read-only status endpoint and the
    // administrator authentication flow. Every other API request requires an
    // already authenticated non-student account. The password login endpoint
    // is handled separately so it can reject STUDENT credentials after lookup.
    const platformControls = await getPlatformControls(env);
    const isPublicStatus = url.pathname === "/api/status" && request.method === "GET";
    const isAllowedAuthFlow =
      (url.pathname === "/api/auth/login" && request.method === "POST") ||
      (url.pathname === "/api/auth/admin-login/verify" && request.method === "POST") ||
      (url.pathname === "/api/auth/admin-login/resend" && request.method === "POST") ||
      (url.pathname === "/api/auth/logout" && request.method === "POST");
    if (platformControls.maintenanceEnabled && !isPublicStatus && !isAllowedAuthFlow) {
      const maintenanceAuth = await authenticate(request, env);
      if (!maintenanceAuth || maintenanceAuth.user.role === "STUDENT") {
        return maintenanceBlockedResponse(platformControls.maintenanceReason);
      }
    }

    if (url.pathname === "/api/health" && request.method === "GET") {
      const result = await env.DB.prepare("SELECT 1 AS ok").first<{ ok: number }>();
      return json({
        ok: result?.ok === 1,
        app: env.APP_NAME || "Attendly",
        database: "connected",
        deploymentStage: "cloud-saas-account-security",
      });
    }

    const bootstrapResponse = await handleAdminBootstrap(request, env);
    if (bootstrapResponse) return bootstrapResponse;

    const authResponse = await handleAuth(request, env);
    if (authResponse) return authResponse;

    const auth = await authenticate(request, env);
    if (!auth) return json({ error: "Please log in to continue." }, 401);

    const legalResponse = await handleLegal(request, env, auth.user.id);
    if (legalResponse) return legalResponse;

    if (url.pathname === "/api/auth/profile" && request.method === "PATCH") {
      const body = await readJson<{ email?: unknown }>(request);
      if (typeof body.email !== "string" || body.email.trim().length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email.trim())) {
        return json({ error: "Enter a valid email address." }, 400);
      }
      const requestedEmail = body.email.trim().toLowerCase();
      const currentEmail = (auth.user.email || "").toLowerCase();
      if (requestedEmail !== currentEmail) {
        return json({ error: "Changing your account email requires verification of the new address. This self-service change is not enabled yet." }, 403);
      }
      return json({ user: { username: auth.user.username, email: currentEmail, role: auth.user.role } });
    }

    if (url.pathname.startsWith("/api/admin/")) {
      const adminAllowed = await allowRate(env, "admin-api-user", String(auth.user.id), 120, 60);
      if (!adminAllowed) return json({ error: "Administrator request limit reached. Please slow down." }, 429, { "retry-after": "60" });
    }

    const subscriptionResponse = await handleSubscriptions(request, env, auth);
    if (subscriptionResponse) return subscriptionResponse;

    const adminResponse = await handleAdmin(request, env, auth);
    if (adminResponse) return adminResponse;

    const academicResponse = await handleAcademic(request, env, auth);
    if (academicResponse) return academicResponse;

    return json({ error: "API endpoint not found." }, 404);
  } catch (error) {
    if (error instanceof HttpError) return json({ error: error.message, ...(error.code ? { code: error.code } : {}), ...error.details }, error.status);
    console.error("[Attendly API error]", error);
    return json({ error: "An unexpected server error occurred. Please try again." }, 500);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const response = await routeRequest(request, env);
    return secureResponse(response, request);
  },
  async scheduled(_event: { cron?: string }, env: Env, ctx: { waitUntil(promise: Promise<unknown>): void }) {
    ctx.waitUntil((async () => {
      await refreshSubscriptionStates(env);
      await env.DB.batch([
        env.DB.prepare("DELETE FROM auth_email_otps WHERE datetime(expires_at)<datetime('now','-2 days') OR (consumed_at IS NOT NULL AND datetime(consumed_at)<datetime('now','-2 days'))"),
        env.DB.prepare("DELETE FROM auth_rate_limits WHERE datetime(updated_at)<datetime('now','-2 days')"),
        env.DB.prepare("DELETE FROM sessions WHERE datetime(expires_at)<datetime('now','-1 day')"),
      ]);
    })());
  },
};
