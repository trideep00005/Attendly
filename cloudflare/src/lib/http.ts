export const json = (payload: unknown, status = 200, headers?: HeadersInit): Response => {
  const output = new Headers(headers);
  output.set("content-type", "application/json; charset=utf-8");
  output.set("cache-control", "no-store");
  output.set("x-content-type-options", "nosniff");
  return new Response(JSON.stringify(payload), { status, headers: output });
};

export const text = (payload: string, status = 200, headers?: HeadersInit): Response => {
  const output = new Headers(headers);
  output.set("cache-control", "no-store");
  output.set("x-content-type-options", "nosniff");
  return new Response(payload, { status, headers: output });
};

export async function readJson<T = Record<string, unknown>>(request: Request): Promise<T> {
  const maxBytes = 2_000_000;
  const contentLength = Number(request.headers.get("content-length") || "0");
  if (contentLength > maxBytes) throw new HttpError(413, "Request body is too large.");
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(400, "Request body is required.");
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel();
        throw new HttpError(413, "Request body is too large.");
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, "Could not read the request body.");
  }
  const merged = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) { merged.set(chunk, offset); offset += chunk.byteLength; }
  try {
    return JSON.parse(new TextDecoder().decode(merged)) as T;
  } catch {
    throw new HttpError(400, "Request body must be valid JSON.");
  }
}

export class HttpError extends Error {
  readonly code?: string;
  readonly details: Record<string, unknown>;

  constructor(
    public status: number,
    message: string,
    code?: string,
    details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "HttpError";
    this.code = code;
    this.details = details;
  }
}

export function isDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function dateInTimeZone(timeZone = "Asia/Kolkata", value = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const part = (name: string) => parts.find((item) => item.type === name)?.value || "00";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export const dayOfWeek = (date: string): number => new Date(`${date}T12:00:00.000Z`).getUTCDay();
export const dateRange = (start: string, end: string): string[] => {
  if (start > end) return [];
  const result: string[] = [];
  const cursor = new Date(`${start}T12:00:00.000Z`);
  const until = new Date(`${end}T12:00:00.000Z`);
  while (cursor <= until) {
    result.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return result;
};

export function parseCookies(request: Request): Record<string, string> {
  const value = request.headers.get("cookie") || "";
  const result: Record<string, string> = {};
  for (const part of value.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    const key = part.slice(0, separator).trim();
    const raw = part.slice(separator + 1).trim();
    try { result[key] = decodeURIComponent(raw); } catch { result[key] = raw; }
  }
  return result;
}

export function cookieHeader(name: string, value: string, options: {
  maxAge?: number; secure?: boolean; clear?: boolean;
} = {}): string {
  const parts = [`${name}=${options.clear ? "" : encodeURIComponent(value)}`, "Path=/", "HttpOnly", "SameSite=Lax"];
  if (options.secure) parts.push("Secure");
  if (options.maxAge !== undefined) parts.push(`Max-Age=${options.maxAge}`);
  return parts.join("; ");
}

export function validateOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try { return new URL(origin).origin === new URL(request.url).origin; }
  catch { return false; }
}
