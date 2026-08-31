// router.mjs — the route table, path matching, the CSRF rule and the
// configuration guard. Pure: nothing here touches storage or the network, so
// the whole dispatch surface is testable without any binding.
//
// Route table (everything is behind Cloudflare Access):
//   GET  /                              owner index (viewer shell)
//   GET  /a/:channel[?v=N]              artifact viewer (viewer shell)
//   GET  /r/:channel/:version           the stored HTML, sandboxed
//   PUT  /api/artifacts/:channel        publish (body = HTML)
//   GET  /api/artifacts                 owner: every channel
//   GET  /api/artifacts/:channel        one channel + its versions
//   GET  /api/artifacts/:channel/versions
//   POST /api/artifacts/:channel/revoke
//   POST /api/artifacts/:channel/viewers
//   GET  /api/artifacts/:channel/comments[?since=&to_agent=1]
//   POST /api/artifacts/:channel/comments
//   POST /api/comments/:id/resolve | /reply | /seen

import { forbidden, misconfigured } from "./http.mjs";
import { handleRender } from "./render.mjs";
import { serveShell } from "./shell.mjs";
import {
  handleGetArtifact,
  handleListArtifacts,
  handleListVersions,
  handlePublish,
  handleRevoke,
  handleViewers,
} from "./api.mjs";
import {
  handleListComments,
  handlePostComment,
  handleReplyComment,
  handleResolveComment,
  handleSeenComment,
} from "./comments.mjs";

export const REQUIRED_VARS = Object.freeze(["ACCESS_TEAM_DOMAIN", "ACCESS_AUD", "OWNER_EMAIL"]);
export const CSRF_HEADER = "x-yoki-csrf";
const SAFE_METHODS = new Set(["GET", "HEAD"]);
const PLACEHOLDER_PREFIX = "REPLACE-";

/**
 * Read and validate the environment. Missing or still-templated vars are a
 * deployment fault: fail every request loudly instead of serving something
 * that cannot verify an identity.
 */
export function readConfig(env) {
  const missing = REQUIRED_VARS.filter((name) => {
    const value = env?.[name];
    return typeof value !== "string" || value.trim() === "" || value.startsWith(PLACEHOLDER_PREFIX);
  });
  if (missing.length > 0) {
    throw misconfigured("This deployment is not configured yet.", `unset or placeholder vars: ${missing.join(", ")}`);
  }
  return Object.freeze({
    teamDomain: env.ACCESS_TEAM_DOMAIN.trim(),
    aud: env.ACCESS_AUD.trim(),
    ownerEmail: env.OWNER_EMAIL.trim().toLowerCase(),
  });
}

function splitPath(pathname) {
  return pathname.split("/").filter((segment) => segment !== "");
}

const route = (name, method, pattern, handler, kind = "json") =>
  Object.freeze({ name, method, segments: Object.freeze(splitPath(pattern)), handler, kind });

export const ROUTES = Object.freeze([
  route("owner-index", "GET", "/", serveShell, "raw"),
  route("viewer", "GET", "/a/:channel", serveShell, "raw"),
  route("render", "GET", "/r/:channel/:version", handleRender, "raw"),
  route("publish", "PUT", "/api/artifacts/:channel", handlePublish),
  route("list-artifacts", "GET", "/api/artifacts", handleListArtifacts),
  route("get-artifact", "GET", "/api/artifacts/:channel", handleGetArtifact),
  route("list-versions", "GET", "/api/artifacts/:channel/versions", handleListVersions),
  route("revoke", "POST", "/api/artifacts/:channel/revoke", handleRevoke),
  route("viewers", "POST", "/api/artifacts/:channel/viewers", handleViewers),
  route("list-comments", "GET", "/api/artifacts/:channel/comments", handleListComments),
  route("post-comment", "POST", "/api/artifacts/:channel/comments", handlePostComment),
  route("resolve-comment", "POST", "/api/comments/:id/resolve", handleResolveComment),
  route("reply-comment", "POST", "/api/comments/:id/reply", handleReplyComment),
  route("seen-comment", "POST", "/api/comments/:id/seen", handleSeenComment),
]);

function matchSegments(pattern, segments) {
  if (pattern.length !== segments.length) return null;
  const params = {};
  for (let i = 0; i < pattern.length; i += 1) {
    const expected = pattern[i];
    if (expected.startsWith(":")) {
      try {
        params[expected.slice(1)] = decodeURIComponent(segments[i]);
      } catch {
        return null;
      }
    } else if (expected !== segments[i]) {
      return null;
    }
  }
  return Object.freeze(params);
}

/**
 * @returns null when no route owns the path, `{ route, params }` on a hit, or
 *          `{ route: null, allow }` when the path exists but not for `method`.
 */
export function matchRoute(method, pathname) {
  const segments = splitPath(pathname);
  const candidates = [];
  for (const candidate of ROUTES) {
    const params = matchSegments(candidate.segments, segments);
    if (params !== null) candidates.push({ route: candidate, params });
  }
  if (candidates.length === 0) return null;
  const wanted = method === "HEAD" ? "GET" : method;
  const hit = candidates.find((candidate) => candidate.route.method === wanted);
  if (hit) return { route: hit.route, params: hit.params, allow: null };
  const allow = [...new Set(candidates.map((candidate) => candidate.route.method))].sort();
  return { route: null, params: null, allow };
}

/**
 * Mutations must be same-origin. Browsers state that in `Sec-Fetch-Site`; the
 * CLI (a service token) has no ambient cookie to abuse, and anything else must
 * prove it is script by sending the CSRF header a form cannot set.
 */
export function assertCsrf(request, identity) {
  if (SAFE_METHODS.has(request.method)) return;
  if (identity.kind === "service") return;
  const site = request.headers.get("sec-fetch-site");
  if (site !== null) {
    if (site !== "same-origin") {
      throw forbidden("cross_site", "This request did not come from the yoki-artifact viewer.", `sec-fetch-site=${site}`);
    }
    return;
  }
  if (request.headers.get(CSRF_HEADER) !== "1") {
    throw forbidden("csrf_missing", "This request did not come from the yoki-artifact viewer.", "no CSRF header");
  }
}
