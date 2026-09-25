// client.mjs — the only place that talks to the Worker.
//
// Every request carries the Cloudflare Access service-token pair
// (CF-Access-Client-Id / CF-Access-Client-Secret); Access resolves it to a
// service identity before the Worker ever runs. The secret lives in this
// closure and is never included in an error message: a 403 says "Access
// rejected the service token", not what was sent.

import { networkError, sizeError } from "./errors.mjs";

export const CLIENT_ID_HEADER = "CF-Access-Client-Id";
export const CLIENT_SECRET_HEADER = "CF-Access-Client-Secret";
export const CSRF_HEADER = "x-yoki-csrf";
export const TITLE_HEADER = "x-yoki-title";
export const LABEL_HEADER = "x-yoki-label";
export const NOTE_HEADER = "x-yoki-note";
export const DEFAULT_TIMEOUT_MS = 60_000;

/** Header values are latin-1 on the wire; the Worker decodeURIComponent()s them. */
export function encodeHeaderText(value) {
  return typeof value === "string" && value.trim() !== "" ? encodeURIComponent(value.trim()) : null;
}

function describeFailure(status, payload) {
  const message = typeof payload?.error === "string" ? payload.error : `HTTP ${status}`;
  if (status === 401 || status === 403) {
    return `Access rejected the request (${status}): ${message}`;
  }
  return `${message} (HTTP ${status})`;
}

export function createClient({ baseUrl, clientId, secret, fetchImpl = fetch, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  const authHeaders = Object.freeze({
    [CLIENT_ID_HEADER]: clientId,
    [CLIENT_SECRET_HEADER]: secret,
  });

  const buildUrl = (pathname, query) => {
    const url = new URL(`${baseUrl}${pathname}`);
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
    }
    return url;
  };

  async function request(method, pathname, { query, body, contentType, headers, expectJson = true } = {}) {
    const url = buildUrl(pathname, query);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response;
    try {
      response = await fetchImpl(url, {
        method,
        headers: {
          ...authHeaders,
          [CSRF_HEADER]: "1",
          accept: "application/json",
          ...(contentType ? { "content-type": contentType } : {}),
          ...(headers ?? {}),
        },
        body,
        signal: controller.signal,
        redirect: "manual",
      });
    } catch (cause) {
      const reason = controller.signal.aborted ? `timed out after ${timeoutMs}ms` : String(cause);
      throw networkError("unreachable", `Cannot reach ${url.origin}: ${reason}`);
    } finally {
      clearTimeout(timer);
    }

    // Access serves its login page as a redirect to the team domain — with a
    // service token that means the token is not authorised for this app.
    if (response.status >= 300 && response.status < 400) {
      throw networkError(
        "access_redirect",
        `Access redirected the request (${response.status}) — the service token is not authorised for this app.`,
        response.headers.get("location") ?? null,
      );
    }

    const text = await response.text();
    let payload = null;
    if (text.trim() !== "") {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = null;
      }
    }

    if (!response.ok) {
      const message = describeFailure(response.status, payload);
      // `status` rides along so a caller can tell a transient failure from a
      // permanent one (the watch loop retries the first, gives up on the
      // second) without re-parsing the message.
      if (response.status === 413) throw Object.assign(sizeError("too_large", message), { status: 413 });
      throw Object.assign(networkError(payload?.code ?? `http_${response.status}`, message, text.slice(0, 400)), {
        status: response.status,
      });
    }
    if (expectJson && payload === null) {
      throw networkError("bad_response", `${url.pathname} did not return JSON.`, text.slice(0, 400));
    }
    return Object.freeze({ status: response.status, body: payload });
  }

  return Object.freeze({
    baseUrl,
    request,
    viewerUrl: (channel) => `${baseUrl}/a/${encodeURIComponent(channel)}`,
  });
}
