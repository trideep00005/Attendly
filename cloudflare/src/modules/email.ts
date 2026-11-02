import type { Env } from "../types";
import { HttpError } from "../lib/http";

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character] || character);
}

export async function sendOtpEmail(
  env: Env,
  recipient: string,
  recipientName: string,
  otp: string,
  purpose: "REGISTER" | "PASSWORD_RESET" | "ADMIN_LOGIN",
): Promise<void> {
  const apiKey = env.BREVO_API_KEY?.trim();
  const senderEmail = env.BREVO_SENDER_EMAIL?.trim();
  const senderName = (env.BREVO_SENDER_NAME || "Attendly").trim();
  if (!apiKey || !senderEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(senderEmail)) {
    throw new HttpError(503, "Email verification is not configured yet. Please try again later.");
  }

  const isRegistration = purpose === "REGISTER";
  const isPasswordReset = purpose === "PASSWORD_RESET";
  const subject = isRegistration
    ? "Verify your Attendly email"
    : isPasswordReset ? "Reset your Attendly password" : "Your Attendly administrator sign-in code";
  const action = isRegistration
    ? "verify your email address"
    : isPasswordReset ? "reset your password" : "complete your administrator sign-in";
  const safeName = escapeHtml(recipientName || "there");
  const htmlContent = `<!doctype html><html><body style="margin:0;background:#f5f7fb;font-family:Arial,sans-serif;color:#25324a;padding:28px"><div style="max-width:520px;margin:auto;background:#fff;border:1px solid #e8edf5;border-radius:16px;padding:30px"><div style="font-size:13px;font-weight:800;letter-spacing:2px;color:#5278eb">ATTENDLY</div><h1 style="font-size:23px;margin:22px 0 8px">Your verification code</h1><p style="color:#62708a;line-height:1.6">Hello ${safeName}, use this code to ${action}.</p><div style="margin:26px 0;padding:18px;background:#f1f4ff;border-radius:12px;text-align:center;font-size:34px;letter-spacing:9px;font-weight:800;color:#405fce">${otp}</div><p style="color:#62708a;line-height:1.6">This code expires in <strong>10 minutes</strong>. You have a maximum of five verification attempts. If you did not request this, you can safely ignore this email.</p><p style="margin-top:26px;color:#929caf;font-size:12px">Attendly account security</p></div></body></html>`;
  let response: Response;
  try {
    response = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        "accept": "application/json",
        "api-key": apiKey,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        sender: { name: senderName, email: senderEmail },
        to: [{ email: recipient, name: recipientName || recipient }],
        subject,
        // Brevo accepts a single message body representation; use the styled HTML body.
        htmlContent,
        tags: [isRegistration ? "attendly-registration-otp" : isPasswordReset ? "attendly-password-reset" : "attendly-admin-login-otp"],
      }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new HttpError(502, "The email service could not be reached. Please try again later.");
  }
  if (!response.ok) {
    // Do not return Brevo's body to the browser: it can contain provider diagnostics.
    console.error("Brevo transactional email failed", response.status);
    throw new HttpError(502, "We could not send the email. Check the sender configuration and try again.");
  }
}
