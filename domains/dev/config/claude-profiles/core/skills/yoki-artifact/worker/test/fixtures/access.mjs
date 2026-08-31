// Access fixtures: a real RSA-2048 key pair generated with WebCrypto, a JWT
// signer, and a fake JWKS endpoint. The tests sign genuine RS256 tokens so
// src/auth.mjs runs its actual verification path — nothing about the signature
// check is stubbed.

export const TEAM_DOMAIN = "yoki-test.cloudflareaccess.com";
export const ISSUER = `https://${TEAM_DOMAIN}`;
export const AUD = "0123456789abcdef0123456789abcdef";
export const OWNER_EMAIL = "owner@example.com";

const encoder = new TextEncoder();

export function b64url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function createSigner({ kid = "test-key-1" } = {}) {
  const pair = await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  );
  const exported = await crypto.subtle.exportKey("jwk", pair.publicKey);
  const publicJwk = { kty: exported.kty, n: exported.n, e: exported.e, alg: "RS256", use: "sig", kid };
  return { kid, privateKey: pair.privateKey, publicJwk, jwks: { keys: [publicJwk] } };
}

export async function signJwt(signer, claims, { header = {} } = {}) {
  const headerSegment = b64url(encoder.encode(JSON.stringify({ alg: "RS256", typ: "JWT", kid: signer.kid, ...header })));
  const payloadSegment = b64url(encoder.encode(JSON.stringify(claims)));
  const signed = encoder.encode(`${headerSegment}.${payloadSegment}`);
  const signature = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", signer.privateKey, signed));
  return `${headerSegment}.${payloadSegment}.${b64url(signature)}`;
}

/** Claims shaped like a real Access application token. */
export function personClaims({ email = OWNER_EMAIL, nowSec = Math.floor(Date.now() / 1000), aud = AUD, iss = ISSUER, ttlSec = 3600 } = {}) {
  return { aud, iss, email, sub: `sub-${email}`, iat: nowSec, nbf: nowSec, exp: nowSec + ttlSec, type: "app" };
}

/** Service-token claims: `common_name` set, `sub` empty, no email. */
export function serviceClaims({ commonName = "yoki-cli.example.access", nowSec = Math.floor(Date.now() / 1000), aud = AUD, iss = ISSUER, ttlSec = 3600 } = {}) {
  return { aud, iss, common_name: commonName, sub: "", iat: nowSec, exp: nowSec + ttlSec, type: "app" };
}

/** A fetch stand-in for `<team>/cdn-cgi/access/certs` that records its calls. */
export function jwksFetcher(jwks) {
  const calls = [];
  return {
    calls,
    fetchImpl: async (url) => {
      calls.push(String(url));
      return { ok: true, status: 200, json: async () => jwks };
    },
  };
}

export function testEnv(overrides = {}) {
  return {
    ACCESS_TEAM_DOMAIN: TEAM_DOMAIN,
    ACCESS_AUD: AUD,
    OWNER_EMAIL: OWNER_EMAIL,
    ASSETS: {
      fetch: async () => new Response("<!doctype html><title>shell</title>", { status: 200 }),
    },
    ...overrides,
  };
}

export function accessRequest(url, { token, method = "GET", headers = {}, body = undefined } = {}) {
  return new Request(url, {
    method,
    headers: { ...(token ? { "cf-access-jwt-assertion": token } : {}), ...headers },
    body,
  });
}
