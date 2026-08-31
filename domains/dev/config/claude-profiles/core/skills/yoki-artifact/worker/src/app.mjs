// app.mjs — the request pipeline: configure, route, authenticate, check CSRF,
// rate-limit, dispatch, and turn anything thrown into the right kind of
// response (JSON for the API, plain text inside the artifact frame).
//
// Collaborators arrive through `deps` so the whole pipeline can be driven in
// tests without D1, R2 or a live Access endpoint.

import { HttpError, errorResponse, jsonResponse, notFound, rateLimited } from "./http.mjs";
import { authenticate } from "./auth.mjs";
import { d1Store, r2Blobs } from "./store.mjs";
import { renderErrorResponse } from "./render.mjs";
import { assertCsrf, matchRoute, readConfig } from "./router.mjs";
import { createRateLimiter } from "./ratelimit.mjs";

/** One limiter per isolate; tests pass their own through `deps`. */
const sharedRateLimiter = createRateLimiter();

function failureResponse(err, { pathname, headers = {}, logger }) {
  if (pathname.startsWith("/r/")) {
    if (err instanceof HttpError) {
      if (err.detail !== null || err.status >= 500) {
        logger.error(`[yoki-artifact] ${err.status} ${err.code}: ${err.message}`, err.detail ?? "");
      }
      return renderErrorResponse(err);
    }
    logger.error("[yoki-artifact] unhandled render error", err instanceof Error ? (err.stack ?? err.message) : err);
    return renderErrorResponse(new HttpError(500, "internal", "internal error"));
  }
  return errorResponse(err, { headers, logger });
}

function toResponse(result) {
  if (result instanceof Response) return result;
  if (result && typeof result === "object" && typeof result.status === "number" && "body" in result) {
    return jsonResponse(result.body, { status: result.status });
  }
  return jsonResponse(result);
}

export async function handleRequest(request, env, deps = {}) {
  const logger = deps.logger ?? console;
  const url = new URL(request.url);
  const now = deps.now ?? new Date();
  try {
    const config = readConfig(env);
    const match = matchRoute(request.method, url.pathname);
    if (match === null) {
      throw notFound("no_such_route", "Not found.");
    }
    if (match.route === null) {
      return failureResponse(
        new HttpError(405, "method_not_allowed", `This endpoint accepts ${match.allow.join(", ")}.`),
        { pathname: url.pathname, headers: { allow: match.allow.join(", ") }, logger },
      );
    }

    const identity = await authenticate(request, config, {
      fetchImpl: deps.fetchImpl ?? fetch,
      now: now.getTime(),
    });
    assertCsrf(request, identity);

    const limiter = deps.rateLimiter ?? sharedRateLimiter;
    const verdict = limiter.check(`${identity.kind}:${identity.id}`, now.getTime());
    if (!verdict.ok) {
      return failureResponse(rateLimited("rate_limited", "Too many requests. Wait a moment and try again."), {
        pathname: url.pathname,
        headers: { "retry-after": String(verdict.retryAfterSec) },
        logger,
      });
    }

    const context = {
      request,
      url,
      env,
      config,
      identity,
      params: match.params,
      store: deps.store ?? d1Store(env?.DB),
      blobs: deps.blobs ?? r2Blobs(env?.R2),
      now,
      logger,
    };
    return toResponse(await match.route.handler(context));
  } catch (err) {
    return failureResponse(err, { pathname: url.pathname, logger });
  }
}
