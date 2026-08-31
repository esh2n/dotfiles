// auth.mjs — Cloudflare Access identity, verified in the Worker itself.
//
// Spike S7 §B1: a Worker with Static Assets runs behind an internal router
// Worker, and that router "does not pass `ctx.access` to the user Worker".
// So `ctx.access` is unusable here and the `cf-access-authenticated-user-email`
// header is convenience only (an unsigned header). Every request therefore
// validates the `Cf-Access-Jwt-Assertion` header itself: RS256 over the JWKS
// published at https://<team>/cdn-cgi/access/certs, matched by `kid`.
//
// Zero dependencies: WebCrypto (`RSASSA-PKCS1-v1_5` + SHA-256) covers RS256,
// which is the only algorithm Access issues, so `jose` is not needed. The JWKS
// is cached in-isolate for 10 minutes (one subrequest per cold isolate).
//
// Identity: `email` for people, `common_name` for service tokens (a
// service-token JWT carries an empty `sub` and the Client ID as
// `common_name`), per the Access application-token docs.

import { forbidden, unauthorized } from "./http.mjs";

export const ACCESS_JWT_HEADER = "cf-access-jwt-assertion";
export const JWKS_TTL_MS = 10 * 60 * 1000;
/** Accepted clock skew between Access and the Worker, in seconds. */
export const CLOCK_TOLERANCE_SEC = 60;

const SUPPORTED_ALG = "RS256";
const RSA_PARAMS = Object.freeze({ name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" });

/** teamDomain -> { keys, expiresAt }. Module scope = per-isolate cache. */
const jwksCache = new Map();

/** Test seam: drop the cached JWKS so a test starts from a cold isolate. */
export function resetJwksCache() {
  jwksCache.clear();
}

/** `team.cloudflareaccess.com` / `https://team…/` -> `https://team…`. */
export function normalizeTeamDomain(raw) {
  if (typeof raw !== "string" || raw.trim() === "") {
    throw unauthorized("access_misconfigured", "Access is not configured for this deployment.");
  }
  const trimmed = raw.trim().replace(/\/+$/, "");
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

export function certsUrl(teamDomain) {
  return `${normalizeTeamDomain(teamDomain)}/cdn-cgi/access/certs`;
}

function base64UrlToBytes(segment) {
  const normalized = segment.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  let binary;
  try {
    binary = atob(padded);
  } catch (cause) {
    throw unauthorized("malformed_token", "Access token is malformed.", String(cause));
  }
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function jsonFromSegment(segment) {
  try {
    return JSON.parse(new TextDecoder().decode(base64UrlToBytes(segment)));
  } catch (cause) {
    throw unauthorized("malformed_token", "Access token is malformed.", String(cause));
  }
}

/** Split a compact JWS into its parts without verifying anything yet. */
export function parseJwt(token) {
  if (typeof token !== "string" || token === "") {
    throw unauthorized("missing_token", "Access token is missing.");
  }
  const parts = token.split(".");
  if (parts.length !== 3) {
    throw unauthorized("malformed_token", "Access token is malformed.", `expected 3 segments, got ${parts.length}`);
  }
  return Object.freeze({
    header: jsonFromSegment(parts[0]),
    claims: jsonFromSegment(parts[1]),
    signature: base64UrlToBytes(parts[2]),
    signedData: new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
  });
}

/**
 * Fetch (or reuse) the Access signing keys. `force` bypasses the cache, which
 * is what a rotated `kid` needs — Access publishes two keys and rotates them.
 */
export async function loadJwks(teamDomain, { fetchImpl = fetch, now = Date.now(), force = false } = {}) {
  const key = normalizeTeamDomain(teamDomain);
  const cached = jwksCache.get(key);
  if (!force && cached && cached.expiresAt > now) return cached.keys;

  let response;
  try {
    response = await fetchImpl(certsUrl(key));
  } catch (cause) {
    throw unauthorized("jwks_unreachable", "Could not reach Cloudflare Access to verify the session.", String(cause));
  }
  if (!response || !response.ok) {
    throw unauthorized(
      "jwks_unreachable",
      "Could not reach Cloudflare Access to verify the session.",
      `certs endpoint returned ${response ? response.status : "no response"}`,
    );
  }
  const body = await response.json();
  const keys = Array.isArray(body?.keys) ? body.keys.filter((k) => k && k.kty === "RSA") : [];
  if (keys.length === 0) {
    throw unauthorized("jwks_empty", "Cloudflare Access published no usable signing keys.");
  }
  const frozen = Object.freeze(keys.map((k) => Object.freeze({ ...k })));
  jwksCache.set(key, Object.freeze({ keys: frozen, expiresAt: now + JWKS_TTL_MS }));
  return frozen;
}

async function importVerifyKey(jwk) {
  // Rebuild a minimal JWK: Access ships `use`/`key_ops` hints that some
  // runtimes reject when combined with an explicit key-usage list.
  const material = { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: SUPPORTED_ALG, ext: true };
  try {
    return await crypto.subtle.importKey("jwk", material, RSA_PARAMS, false, ["verify"]);
  } catch (cause) {
    throw unauthorized("bad_key", "Cloudflare Access signing key could not be used.", String(cause));
  }
}

function assertClaims(claims, { issuer, aud, now }) {
  const skewMs = CLOCK_TOLERANCE_SEC * 1000;
  if (typeof claims.iss !== "string" || claims.iss.replace(/\/+$/, "") !== issuer) {
    throw unauthorized("bad_issuer", "Access token was issued for another organisation.", `iss=${claims.iss}`);
  }
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!audiences.includes(aud)) {
    throw unauthorized("bad_audience", "Access token was issued for another application.");
  }
  if (typeof claims.exp !== "number" || claims.exp * 1000 + skewMs <= now) {
    throw unauthorized("token_expired", "Your session has expired. Reload the page to sign in again.");
  }
  if (typeof claims.nbf === "number" && claims.nbf * 1000 - skewMs > now) {
    throw unauthorized("token_not_yet_valid", "Access token is not valid yet.");
  }
}

/**
 * Verify a `Cf-Access-Jwt-Assertion` token and return its claims.
 * Throws `HttpError` (401) with a stable `code` for every failure mode.
 */
export async function verifyAccessJwt(token, { teamDomain, aud, fetchImpl = fetch, now = Date.now() }) {
  if (typeof aud !== "string" || aud === "") {
    throw unauthorized("access_misconfigured", "Access is not configured for this deployment.", "ACCESS_AUD empty");
  }
  const issuer = normalizeTeamDomain(teamDomain);
  const { header, claims, signature, signedData } = parseJwt(token);

  if (header.alg !== SUPPORTED_ALG) {
    throw unauthorized("bad_alg", "Access token uses an unsupported signature algorithm.", `alg=${header.alg}`);
  }
  if (typeof header.kid !== "string" || header.kid === "") {
    throw unauthorized("bad_kid", "Access token does not name a signing key.");
  }

  let keys = await loadJwks(issuer, { fetchImpl, now });
  let jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) {
    // Unknown kid: the keys may have rotated inside the 10 minute TTL.
    keys = await loadJwks(issuer, { fetchImpl, now, force: true });
    jwk = keys.find((k) => k.kid === header.kid);
  }
  if (!jwk) {
    throw unauthorized("unknown_key", "Access token was signed by an unknown key.", `kid=${header.kid}`);
  }

  const verified = await crypto.subtle.verify(RSA_PARAMS.name, await importVerifyKey(jwk), signature, signedData);
  if (!verified) {
    throw unauthorized("bad_signature", "Access token signature is invalid.");
  }
  assertClaims(claims, { issuer, aud, now });
  return Object.freeze({ ...claims });
}

/**
 * Map verified claims to an identity.
 *   - service token: `common_name` (the Client ID), `sub` is empty
 *   - person: `email`
 * `label` is what gets stored as comment authorship.
 */
export function identityFromClaims(claims) {
  const commonName = typeof claims.common_name === "string" ? claims.common_name.trim() : "";
  if (commonName !== "") {
    return Object.freeze({ kind: "service", id: commonName, email: null, label: `service:${commonName}` });
  }
  const email = typeof claims.email === "string" ? claims.email.trim().toLowerCase() : "";
  if (email === "") {
    throw forbidden("no_identity", "Access token carries neither an email nor a service-token name.");
  }
  return Object.freeze({ kind: "human", id: email, email, label: email });
}

/** Verify the request's Access header and return its identity. */
export async function authenticate(request, config, { fetchImpl = fetch, now = Date.now() } = {}) {
  const token = request.headers.get(ACCESS_JWT_HEADER);
  if (!token) {
    throw unauthorized(
      "missing_token",
      "This page must be reached through Cloudflare Access. Reload to sign in.",
      "Cf-Access-Jwt-Assertion header absent",
    );
  }
  const claims = await verifyAccessJwt(token, {
    teamDomain: config.teamDomain,
    aud: config.aud,
    fetchImpl,
    now,
  });
  return identityFromClaims(claims);
}

/** Owner = the configured OWNER_EMAIL, or any service token (the agent/CLI). */
export function isOwner(identity, ownerEmail) {
  if (!identity) return false;
  if (identity.kind === "service") return true;
  return typeof ownerEmail === "string" && identity.email === ownerEmail.trim().toLowerCase();
}

/** A person may read a channel if they own it or are listed in `viewers`. */
export function canRead(identity, { ownerEmail, viewers = [] }) {
  if (isOwner(identity, ownerEmail)) return true;
  if (!identity || identity.kind !== "human") return false;
  return viewers.some((email) => String(email).trim().toLowerCase() === identity.email);
}

/** Only the owner (or a service token) may publish, revoke or share. */
export function canWrite(identity, ownerEmail) {
  return isOwner(identity, ownerEmail);
}

export function requireRead(identity, context) {
  if (!canRead(identity, context)) {
    throw forbidden("not_a_viewer", "You do not have access to this artifact.");
  }
}

export function requireOwner(identity, ownerEmail) {
  if (!canWrite(identity, ownerEmail)) {
    throw forbidden("not_owner", "Only the owner of this deployment can do that.");
  }
}
