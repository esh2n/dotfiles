// auth.test.mjs — Access JWT verification against a real RSA key pair, the
// JWKS cache, identity extraction and the authorization predicates.

import { after, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  ACCESS_JWT_HEADER,
  JWKS_TTL_MS,
  authenticate,
  canRead,
  canWrite,
  certsUrl,
  identityFromClaims,
  identityKey,
  isOwner,
  isPinnedService,
  loadJwks,
  normalizeTeamDomain,
  resetJwksCache,
  verifyAccessJwt,
} from "../src/auth.mjs";
import {
  AUD,
  ISSUER,
  OWNER_EMAIL,
  SERVICE_TOKEN_NAME,
  TEAM_DOMAIN,
  accessRequest,
  createSigner,
  jwksFetcher,
  personClaims,
  serviceClaims,
  signJwt,
} from "./fixtures/access.mjs";

const signer = await createSigner();
const otherSigner = await createSigner({ kid: "rotated-key" });
const config = { teamDomain: TEAM_DOMAIN, aud: AUD, ownerEmail: OWNER_EMAIL };

beforeEach(() => resetJwksCache());
after(() => resetJwksCache());

async function verify(token, { jwks = signer.jwks, now = Date.now() } = {}) {
  const { fetchImpl } = jwksFetcher(jwks);
  return await verifyAccessJwt(token, { teamDomain: TEAM_DOMAIN, aud: AUD, fetchImpl, now });
}

async function expectFailure(promise, code, status = 401) {
  await assert.rejects(promise, (err) => {
    assert.equal(err.code, code, `expected code ${code}, got ${err.code}`);
    assert.equal(err.status, status);
    return true;
  });
}

describe("team domain handling", () => {
  test("accepts a bare host, a scheme and a trailing slash", () => {
    assert.equal(normalizeTeamDomain(TEAM_DOMAIN), ISSUER);
    assert.equal(normalizeTeamDomain(`${ISSUER}/`), ISSUER);
    assert.equal(certsUrl(TEAM_DOMAIN), `${ISSUER}/cdn-cgi/access/certs`);
  });

  test("an empty team domain is a configuration failure, not a 500", () => {
    assert.throws(() => normalizeTeamDomain(""), (err) => err.code === "access_misconfigured");
  });
});

describe("verifyAccessJwt", () => {
  test("accepts a valid token and returns its claims", async () => {
    const token = await signJwt(signer, personClaims({ email: "viewer@example.com" }));
    const claims = await verify(token);
    assert.equal(claims.email, "viewer@example.com");
    assert.equal(claims.aud, AUD);
  });

  test("rejects a token minted for another application (wrong aud)", async () => {
    const token = await signJwt(signer, personClaims({ aud: "some-other-application" }));
    await expectFailure(verify(token), "bad_audience");
  });

  test("rejects a token from another organisation (wrong iss)", async () => {
    const token = await signJwt(signer, personClaims({ iss: "https://someone-else.cloudflareaccess.com" }));
    await expectFailure(verify(token), "bad_issuer");
  });

  test("rejects an expired token, including the clock tolerance", async () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const token = await signJwt(signer, personClaims({ nowSec: nowSec - 7200, ttlSec: 3600 }));
    await expectFailure(verify(token), "token_expired");
  });

  test("rejects a token whose payload was tampered with", async () => {
    const token = await signJwt(signer, personClaims({ email: "viewer@example.com" }));
    const [header, , signature] = token.split(".");
    const forged = btoa(JSON.stringify(personClaims({ email: "attacker@example.com" })))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    await expectFailure(verify(`${header}.${forged}.${signature}`), "bad_signature");
  });

  test("rejects a token signed by a key the JWKS does not publish", async () => {
    const token = await signJwt(otherSigner, personClaims());
    await expectFailure(verify(token, { jwks: signer.jwks }), "unknown_key");
  });

  test("rejects an algorithm other than RS256", async () => {
    const token = await signJwt(signer, personClaims(), { header: { alg: "HS256" } });
    await expectFailure(verify(token), "bad_alg");
  });

  test("rejects a malformed token", async () => {
    await expectFailure(verify("not.a.jwt"), "malformed_token");
    await expectFailure(verify("two.parts"), "malformed_token");
  });

  test("refuses to verify when ACCESS_AUD is unset", async () => {
    const token = await signJwt(signer, personClaims());
    const { fetchImpl } = jwksFetcher(signer.jwks);
    await expectFailure(
      verifyAccessJwt(token, { teamDomain: TEAM_DOMAIN, aud: "", fetchImpl }),
      "access_misconfigured",
    );
  });
});

describe("JWKS cache", () => {
  test("fetches once per isolate inside the 10 minute TTL, then refetches", async () => {
    const { fetchImpl, calls } = jwksFetcher(signer.jwks);
    const start = Date.now();
    await loadJwks(TEAM_DOMAIN, { fetchImpl, now: start });
    await loadJwks(TEAM_DOMAIN, { fetchImpl, now: start + JWKS_TTL_MS - 1 });
    assert.equal(calls.length, 1);
    await loadJwks(TEAM_DOMAIN, { fetchImpl, now: start + JWKS_TTL_MS + 1 });
    assert.equal(calls.length, 2);
    assert.equal(calls[0], `${ISSUER}/cdn-cgi/access/certs`);
  });

  test("an unknown kid forces one refresh before giving up", async () => {
    const { fetchImpl, calls } = jwksFetcher(signer.jwks);
    const token = await signJwt(otherSigner, personClaims());
    await expectFailure(verifyAccessJwt(token, { teamDomain: TEAM_DOMAIN, aud: AUD, fetchImpl }), "unknown_key");
    assert.equal(calls.length, 2, "cached keys plus one forced refresh");
  });

  test("an unreachable certs endpoint fails closed", async () => {
    const fetchImpl = async () => ({ ok: false, status: 503, json: async () => ({}) });
    await expectFailure(loadJwks(TEAM_DOMAIN, { fetchImpl }), "jwks_unreachable");
  });
});

describe("identity", () => {
  test("a person is identified by email, lowercased", () => {
    const identity = identityFromClaims({ email: "Viewer@Example.COM" });
    assert.deepEqual({ ...identity }, {
      kind: "human",
      id: "viewer@example.com",
      common_name: null,
      email: "viewer@example.com",
      label: "viewer@example.com",
    });
  });

  test("a service token is identified by common_name, which is kept verbatim", () => {
    const identity = identityFromClaims(serviceClaims({ commonName: "yoki-cli" }));
    assert.equal(identity.kind, "service");
    assert.equal(identity.id, "yoki-cli");
    assert.equal(identity.common_name, "yoki-cli", "the owner pin compares against this claim");
    assert.equal(identity.label, "service:yoki-cli");
    assert.equal(identity.email, null);
  });

  test("claims with neither email nor common_name are refused", () => {
    assert.throws(() => identityFromClaims({ sub: "x" }), (err) => err.code === "no_identity" && err.status === 403);
  });
});

describe("authenticate", () => {
  test("reads the Cf-Access-Jwt-Assertion header", async () => {
    const token = await signJwt(signer, personClaims({ email: OWNER_EMAIL }));
    const { fetchImpl } = jwksFetcher(signer.jwks);
    const identity = await authenticate(accessRequest("https://host.example/", { token }), config, { fetchImpl });
    assert.equal(identity.email, OWNER_EMAIL);
  });

  test("a request without the header is rejected", async () => {
    const { fetchImpl } = jwksFetcher(signer.jwks);
    await expectFailure(authenticate(new Request("https://host.example/"), config, { fetchImpl }), "missing_token");
  });

  test("the header name matches what Access sets", () => {
    assert.equal(ACCESS_JWT_HEADER, "cf-access-jwt-assertion");
  });
});

describe("authorization predicates", () => {
  const owner = { kind: "human", id: OWNER_EMAIL, common_name: null, email: OWNER_EMAIL, label: OWNER_EMAIL };
  const viewer = { kind: "human", id: "viewer@example.com", common_name: null, email: "viewer@example.com", label: "viewer@example.com" };
  const stranger = { kind: "human", id: "nobody@example.com", common_name: null, email: "nobody@example.com", label: "nobody@example.com" };
  const service = identityFromClaims(serviceClaims());
  const otherService = identityFromClaims(serviceClaims({ commonName: "someone-else.access" }));
  const pinned = { ownerEmail: OWNER_EMAIL, serviceTokenName: SERVICE_TOKEN_NAME };

  test("the owner and the pinned service token own everything", () => {
    assert.equal(isOwner(owner, pinned), true);
    assert.equal(isOwner(service, pinned), true);
    assert.equal(isOwner(viewer, pinned), false);
    assert.equal(isOwner(null, pinned), false);
  });

  // The finding: any service-token identity used to be a full owner, so a
  // second token on the same Access application silently became one.
  test("a service token that is not the pinned one is NOT an owner", () => {
    assert.equal(isOwner(otherService, pinned), false);
    assert.equal(canWrite(otherService, pinned), false);
    assert.equal(isPinnedService(otherService, SERVICE_TOKEN_NAME), false);
    assert.equal(isPinnedService(service, SERVICE_TOKEN_NAME), true);
  });

  // Fail-closed: a deployment that has not re-run setup.mjs has no pin, and
  // an unpinned deployment grants owner rights to no service token at all.
  test("an unset SERVICE_TOKEN_NAME makes every service token a non-owner", () => {
    for (const unset of [undefined, null, "", "   "]) {
      const policy = { ownerEmail: OWNER_EMAIL, serviceTokenName: unset };
      assert.equal(isOwner(service, policy), false, `serviceTokenName=${JSON.stringify(unset)}`);
      assert.equal(isPinnedService(service, unset), false);
    }
    // A bare ownerEmail string reads the same way — never an accidental yes.
    assert.equal(isOwner(service, OWNER_EMAIL), false);
    assert.equal(isOwner(owner, OWNER_EMAIL), true);
  });

  test("a listed viewer may read but not write", () => {
    const context = { ...pinned, viewers: ["Viewer@Example.com"] };
    assert.equal(canRead(viewer, context), true);
    assert.equal(canRead(stranger, context), false);
    assert.equal(canWrite(viewer, pinned), false);
    assert.equal(canWrite(service, pinned), true);
  });

  test("a non-pinned service token reads only where a viewer could", () => {
    assert.equal(canRead(otherService, { ...pinned, viewers: ["viewer@example.com"] }), false);
    assert.equal(canRead(otherService, { ...pinned, viewers: ["someone-else.access"] }), true);
    assert.equal(canWrite(otherService, { ...pinned, viewers: ["someone-else.access"] }), false);
  });

  test("identityKey is the email for people and the common_name for tokens", () => {
    assert.equal(identityKey(viewer), "viewer@example.com");
    assert.equal(identityKey(service), SERVICE_TOKEN_NAME);
    assert.equal(identityKey(null), null);
  });
});
