// router.test.mjs — route dispatch, the CSRF rule and the configuration guard.

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { CSRF_HEADER, REQUIRED_VARS, ROUTES, assertCsrf, matchRoute, readConfig } from "../src/router.mjs";
import { AUD, OWNER_EMAIL, SERVICE_TOKEN_NAME, TEAM_DOMAIN, testEnv } from "./fixtures/access.mjs";

const human = { kind: "human", id: OWNER_EMAIL, common_name: null, email: OWNER_EMAIL, label: OWNER_EMAIL };
const service = {
  kind: "service",
  id: SERVICE_TOKEN_NAME,
  common_name: SERVICE_TOKEN_NAME,
  email: null,
  label: `service:${SERVICE_TOKEN_NAME}`,
};
const otherService = {
  kind: "service",
  id: "someone-else.access",
  common_name: "someone-else.access",
  email: null,
  label: "service:someone-else.access",
};
const pinned = { serviceTokenName: SERVICE_TOKEN_NAME };
const unpinned = { serviceTokenName: null };

describe("matchRoute", () => {
  const cases = [
    ["GET", "/", "owner-index", {}],
    ["GET", "/a/design-notes", "viewer", { channel: "design-notes" }],
    ["GET", "/r/design-notes/3", "render", { channel: "design-notes", version: "3" }],
    ["PUT", "/api/artifacts/design-notes", "publish", { channel: "design-notes" }],
    ["GET", "/api/artifacts", "list-artifacts", {}],
    ["GET", "/api/artifacts/design-notes", "get-artifact", { channel: "design-notes" }],
    ["GET", "/api/artifacts/design-notes/versions", "list-versions", { channel: "design-notes" }],
    ["POST", "/api/artifacts/design-notes/revoke", "revoke", { channel: "design-notes" }],
    ["POST", "/api/artifacts/design-notes/viewers", "viewers", { channel: "design-notes" }],
    ["GET", "/api/artifacts/design-notes/comments", "list-comments", { channel: "design-notes" }],
    ["POST", "/api/artifacts/design-notes/comments", "post-comment", { channel: "design-notes" }],
    ["POST", "/api/comments/abc-123/resolve", "resolve-comment", { id: "abc-123" }],
    ["POST", "/api/comments/abc-123/reply", "reply-comment", { id: "abc-123" }],
    ["POST", "/api/comments/abc-123/seen", "seen-comment", { id: "abc-123" }],
  ];

  for (const [method, pathname, name, params] of cases) {
    test(`${method} ${pathname} -> ${name}`, () => {
      const match = matchRoute(method, pathname);
      assert.ok(match, `${pathname} did not match any route`);
      assert.equal(match.route?.name, name);
      assert.deepEqual({ ...match.params }, params);
    });
  }

  test("every route is reachable by exactly the method it declares", () => {
    assert.equal(ROUTES.length, cases.length);
  });

  test("HEAD is served by the GET route", () => {
    assert.equal(matchRoute("HEAD", "/a/notes")?.route?.name, "viewer");
  });

  test("an unknown path matches nothing", () => {
    assert.equal(matchRoute("GET", "/nope"), null);
    assert.equal(matchRoute("GET", "/api/unknown/thing/here"), null);
  });

  test("a known path with the wrong method reports the allowed methods", () => {
    const match = matchRoute("DELETE", "/api/artifacts/notes");
    assert.equal(match.route, null);
    assert.deepEqual(match.allow, ["GET", "PUT"]);
  });

  test("percent-encoded segments are decoded once", () => {
    assert.equal(matchRoute("GET", "/a/design%2Dnotes")?.params.channel, "design-notes");
  });

  test("trailing slashes do not create phantom segments", () => {
    assert.equal(matchRoute("GET", "/api/artifacts/")?.route?.name, "list-artifacts");
  });
});

describe("assertCsrf", () => {
  const mutate = (headers) => new Request("https://host.example/api/artifacts/x/revoke", { method: "POST", headers });

  test("safe methods are never challenged", () => {
    assert.doesNotThrow(() => assertCsrf(new Request("https://host.example/"), human, pinned));
  });

  test("the pinned service token (the CLI) carries no ambient cookie and is allowed", () => {
    assert.doesNotThrow(() => assertCsrf(mutate({}), service, pinned));
  });

  test("another service token gets no exemption — it takes the normal check", () => {
    assert.throws(() => assertCsrf(mutate({}), otherService, pinned), (err) => err.code === "csrf_missing");
    assert.doesNotThrow(() => assertCsrf(mutate({ [CSRF_HEADER]: "1" }), otherService, pinned));
    assert.throws(
      () => assertCsrf(mutate({ "sec-fetch-site": "cross-site" }), otherService, pinned),
      (err) => err.code === "cross_site",
    );
  });

  test("with SERVICE_TOKEN_NAME unset, no service token is exempt", () => {
    assert.throws(() => assertCsrf(mutate({}), service, unpinned), (err) => err.code === "csrf_missing");
    assert.throws(() => assertCsrf(mutate({}), service, undefined), (err) => err.code === "csrf_missing");
  });

  test("a browser request must be same-origin", () => {
    assert.doesNotThrow(() => assertCsrf(mutate({ "sec-fetch-site": "same-origin" }), human, pinned));
    assert.throws(() => assertCsrf(mutate({ "sec-fetch-site": "cross-site" }), human, pinned), (err) => err.code === "cross_site");
    assert.throws(() => assertCsrf(mutate({ "sec-fetch-site": "none" }), human, pinned), (err) => err.status === 403);
  });

  test("without Sec-Fetch-Site the CSRF header is required", () => {
    assert.throws(() => assertCsrf(mutate({}), human, pinned), (err) => err.code === "csrf_missing");
    assert.doesNotThrow(() => assertCsrf(mutate({ [CSRF_HEADER]: "1" }), human, pinned));
  });
});

describe("readConfig", () => {
  test("returns the normalised configuration", () => {
    const config = readConfig(testEnv({ OWNER_EMAIL: "Owner@Example.com" }));
    assert.deepEqual({ ...config }, {
      teamDomain: TEAM_DOMAIN,
      aud: AUD,
      ownerEmail: "owner@example.com",
      serviceTokenName: SERVICE_TOKEN_NAME,
    });
  });

  // SERVICE_TOKEN_NAME is optional so an existing deployment keeps serving —
  // it just stops treating any service token as an owner.
  test("an unset or still-templated SERVICE_TOKEN_NAME reads as no pin, not a 500", () => {
    for (const value of [undefined, "", "   ", "REPLACE-service-token-client-id"]) {
      const config = readConfig(testEnv({ SERVICE_TOKEN_NAME: value }));
      assert.equal(config.serviceTokenName, null, `SERVICE_TOKEN_NAME=${String(value)}`);
    }
  });

  test("SERVICE_TOKEN_NAME is not in REQUIRED_VARS", () => {
    assert.ok(!REQUIRED_VARS.includes("SERVICE_TOKEN_NAME"));
  });

  test("refuses to run with a missing, empty or still-templated var", () => {
    for (const name of REQUIRED_VARS) {
      for (const value of [undefined, "", "   ", "REPLACE-me"]) {
        assert.throws(
          () => readConfig(testEnv({ [name]: value })),
          (err) => err.status === 500 && err.code === "misconfigured",
          `${name}=${String(value)} should be rejected`,
        );
      }
    }
  });
});
