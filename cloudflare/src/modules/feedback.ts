import type { Env } from "../types";
import { allowRate } from "../lib/rate-limit";
import { json, readJson } from "../lib/http";
import type { AuthContext } from "./auth";

const FEEDBACK_CATEGORIES = ["GENERAL", "BUG_REPORT", "FEATURE_REQUEST", "UI_UX", "OTHER"] as const;
type FeedbackCategory = typeof FEEDBACK_CATEGORIES[number];

export async function handleFeedback(request: Request, env: Env, auth: AuthContext): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== "/api/feedback") return null;
  if (auth.user.role !== "STUDENT") return json({ error: "Feedback can only be submitted from a student account." }, 403);

  if (request.method === "GET") {
    const result = await env.DB.prepare(`SELECT id,category,rating,message,contact_allowed,status,created_at,reviewed_at
      FROM student_feedback WHERE user_id=? ORDER BY created_at DESC,id DESC LIMIT 25`)
      .bind(auth.user.id).all<Record<string, unknown>>();
    return json({ feedback: result.results || [] });
  }

  if (request.method === "POST") {
    if (!(await allowRate(env, "student-feedback", String(auth.user.id), 5, 86400))) {
      return json({ error: "You have reached the feedback limit for today. Please try again tomorrow." }, 429, { "retry-after": "86400" });
    }

    const body = await readJson<{
      category?: unknown;
      rating?: unknown;
      message?: unknown;
      contactAllowed?: unknown;
    }>(request);
    const category = typeof body.category === "string" ? body.category.trim().toUpperCase() : "GENERAL";
    const message = typeof body.message === "string" ? body.message.trim() : "";
    const rating = body.rating === null || body.rating === undefined || body.rating === "" ? null : Number(body.rating);
    const contactAllowed = body.contactAllowed === true;

    if (!(FEEDBACK_CATEGORIES as readonly string[]).includes(category)) return json({ error: "Choose a valid feedback category." }, 400);
    if (message.length < 10 || message.length > 2000) return json({ error: "Feedback must contain 10–2,000 characters." }, 400);
    if (rating !== null && (!Number.isInteger(rating) || rating < 1 || rating > 5)) return json({ error: "Choose a rating from 1 to 5, or leave it empty." }, 400);

    const result = await env.DB.prepare(`INSERT INTO student_feedback(user_id,category,rating,message,contact_allowed)
      VALUES(?,?,?,?,?)`).bind(auth.user.id, category as FeedbackCategory, rating, message, contactAllowed ? 1 : 0).run();
    return json({
      ok: true,
      feedback: { id: Number(result.meta.last_row_id), category, rating, message, contact_allowed: contactAllowed ? 1 : 0, status: "NEW" },
      message: "Thank you for your feedback. Your message has been sent to the Attendly team.",
    }, 201);
  }

  return json({ error: "Method not allowed." }, 405, { Allow: "GET, POST" });
}
