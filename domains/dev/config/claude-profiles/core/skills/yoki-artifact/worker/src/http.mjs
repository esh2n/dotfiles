// http.mjs — the error type every handler throws, plus response builders.
//
// Two rules the rest of the Worker relies on:
//   1. every /api response body is JSON; failures are `{ error, code }`;
//   2. the message handed to the client is user-facing prose, while anything
//      diagnostic travels in `HttpError.detail` and is logged, never sent.

/** An error with an HTTP status and a stable machine-readable `code`. */
export class HttpError extends Error {
  constructor(status, code, message, detail = null) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.code = code;
    this.detail = detail;
  }
}

export const badRequest = (code, message, detail = null) => new HttpError(400, code, message, detail);
export const unauthorized = (code, message, detail = null) => new HttpError(401, code, message, detail);
export const forbidden = (code, message, detail = null) => new HttpError(403, code, message, detail);
export const notFound = (code, message, detail = null) => new HttpError(404, code, message, detail);
export const conflict = (code, message, detail = null) => new HttpError(409, code, message, detail);
export const tooLarge = (code, message, detail = null) => new HttpError(413, code, message, detail);
export const rateLimited = (code, message, detail = null) => new HttpError(429, code, message, detail);
export const misconfigured = (message, detail = null) => new HttpError(500, "misconfigured", message, detail);

/** Headers every Worker-generated response carries. Nothing here is cacheable:
 * each response is personalised by the caller's Access identity. */
export const BASE_HEADERS = Object.freeze({
  "cache-control": "private, no-store",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
  "cross-origin-resource-policy": "same-origin",
  "x-robots-tag": "noindex, nofollow",
});

/** CSP for the viewer shell and the owner index. All script and style live in
 * separate files under public/, so no 'unsafe-inline' is needed; the artifact
 * itself is reachable only through the sandboxed <iframe> (frame-src 'self'). */
export const VIEWER_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "frame-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

export function jsonResponse(data, { status = 200, headers = {} } = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...BASE_HEADERS,
      "content-type": "application/json; charset=utf-8",
      ...headers,
    },
  });
}

export function textResponse(body, { status = 200, headers = {} } = {}) {
  return new Response(body, {
    status,
    headers: {
      ...BASE_HEADERS,
      "content-type": "text/plain; charset=utf-8",
      ...headers,
    },
  });
}

/**
 * Read and validate a JSON request body. Callers get a plain object or a 400
 * with a user-facing message — never a raw `SyntaxError`.
 */
export async function readJsonBody(request, { maxBytes = 64 * 1024 } = {}) {
  const contentType = (request.headers.get("content-type") ?? "").toLowerCase();
  if (!contentType.includes("application/json")) {
    throw badRequest("bad_content_type", "Send this request as application/json.", `content-type=${contentType}`);
  }
  const text = await request.text();
  if (text.length > maxBytes) {
    throw tooLarge("body_too_large", "The request body is too large.");
  }
  if (text.trim() === "") return {};
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (cause) {
    throw badRequest("bad_json", "The request body is not valid JSON.", String(cause));
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw badRequest("bad_json", "The request body must be a JSON object.");
  }
  return parsed;
}

/**
 * Turn any thrown value into a response. Known `HttpError`s keep their status,
 * code and user-facing message; everything else becomes a generic 500 so an
 * internal message (a D1 error string, a stack) can never reach the client.
 */
export function errorResponse(err, { logger = console, headers = {} } = {}) {
  if (err instanceof HttpError) {
    if (err.detail !== null || err.status >= 500) {
      logger.error(`[yoki-artifact] ${err.status} ${err.code}: ${err.message}`, err.detail ?? "");
    }
    return jsonResponse({ error: err.message, code: err.code }, { status: err.status, headers });
  }
  logger.error("[yoki-artifact] unhandled error", err instanceof Error ? (err.stack ?? err.message) : err);
  return jsonResponse({ error: "internal error", code: "internal" }, { status: 500, headers });
}
