// render.mjs — GET /r/:channel/:version, the only place artifact HTML is served.
//
// All artifacts share one origin (workers.dev is on the Public Suffix List, so
// no per-artifact origin is available), which means isolation has to be
// synthesised per response. The `sandbox` CSP directive is what does it: it
// applies even when someone opens /r/... directly as a top-level navigation,
// and it never grants `allow-same-origin` — combined with `allow-scripts` that
// would let the page remove its own sandbox and read the viewer's session.
//
// The script/style/font allowlist mirrors the Claude Code Artifact CDN
// allowlist so a page authored for either host renders in both.

import { forbidden, notFound, textResponse } from "./http.mjs";
import { canRead, isOwner } from "./auth.mjs";
import { HTML_CONTENT_TYPE, assertChannel, objectKey } from "./store.mjs";

export const INCLUDE_REVOKED_HEADER = "x-yoki-include-revoked";

export const RENDER_CSP = [
  "sandbox allow-scripts allow-forms allow-popups allow-modals",
  "default-src 'none'",
  "script-src 'unsafe-inline' https://cdnjs.cloudflare.com https://cdn.jsdelivr.net/npm/ https://cdn.tailwindcss.com https://code.jquery.com",
  "style-src 'unsafe-inline' https://fonts.googleapis.com",
  "font-src data: https://fonts.gstatic.com",
  "img-src data: blob:",
  "media-src data: blob:",
  "connect-src 'none'",
  "frame-ancestors 'self'",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");

/** The exact header block every /r/* response carries. */
export function renderHeaders() {
  return {
    "content-type": HTML_CONTENT_TYPE,
    "content-security-policy": RENDER_CSP,
    "cache-control": "private, no-store",
    "x-robots-tag": "noindex, nofollow",
    "cross-origin-resource-policy": "same-origin",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
  };
}

export function parseVersion(raw) {
  if (!/^[0-9]{1,9}$/.test(String(raw))) return null;
  const version = Number(raw);
  return version >= 1 ? version : null;
}

/**
 * A revoked channel is a 404 for everyone — except the owner asking for one
 * explicit version with `X-Yoki-Include-Revoked: 1`, which is how the owner
 * checks what was published before revoking.
 */
export function revokedIsVisible(request, identity, config) {
  return isOwner(identity, config) && request.headers.get(INCLUDE_REVOKED_HEADER) === "1";
}

export async function handleRender({ request, params, identity, config, store, blobs, logger = console }) {
  const channel = assertChannel(params.channel);
  const version = parseVersion(params.version);
  if (version === null) {
    throw notFound("no_such_version", "That artifact version does not exist.");
  }

  const artifact = await store.getArtifact(channel);
  if (!artifact) {
    throw notFound("no_such_artifact", "That artifact does not exist.");
  }
  if (artifact.revoked_at && !revokedIsVisible(request, identity, config)) {
    throw notFound("no_such_artifact", "That artifact does not exist.");
  }

  const viewers = await store.listViewers(channel);
  if (!canRead(identity, { ownerEmail: config.ownerEmail, serviceTokenName: config.serviceTokenName, viewers })) {
    throw forbidden("not_a_viewer", "You do not have access to this artifact.");
  }

  const versionRow = await store.getVersion(channel, version);
  if (!versionRow) {
    throw notFound("no_such_version", "That artifact version does not exist.");
  }

  const object = await blobs.get(objectKey(channel, version));
  if (!object) {
    // A versions row without its object means the R2 write was lost; that is a
    // server-side fault, so log it and tell the caller only that it is gone.
    logger.error(`[yoki-artifact] missing R2 object for ${objectKey(channel, version)}`);
    throw notFound("object_missing", "That artifact version is no longer stored.");
  }

  return new Response(object.body, { status: 200, headers: renderHeaders() });
}

/** Errors on /r/* are plain text: the response is consumed inside an iframe. */
export function renderErrorResponse(err) {
  const status = typeof err?.status === "number" ? err.status : 500;
  const message = status >= 500 ? "This artifact could not be loaded." : (err?.message ?? "Not found");
  return textResponse(`${message}\n`, { status, headers: { "content-security-policy": RENDER_CSP } });
}
