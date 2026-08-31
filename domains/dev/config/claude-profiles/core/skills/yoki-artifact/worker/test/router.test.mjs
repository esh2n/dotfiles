// router.test.mjs — route dispatch, the CSRF rule and the configuration guard.

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { CSRF_HEADER, REQUIRED_VARS, ROUTES, assertCsrf, matchRoute, readConfig } from "../src/router.mjs";
import { AUD, OWNER_EMAIL, TEAM_DOMAIN, testEnv } from "./fixtures/access.mjs";

const human = { kind: "human", id: OWNER_EMAIL, email: OWNER_EMAIL, label: OWNER_EMAIL };
const service = { kind: "service", id: "yoki-cli", email: null, label: "service:yoki-cli" };

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
    assert.doesNotThrow(() => assertCsrf(new Request("https://host.example/"), human));
  });

  test("a service token (the CLI) carries no ambient cookie and is allowed", () => {
    assert.doesNotThrow(() => assertCsrf(mutate({}), service));
  });

  test("a browser request must be same-origin", () => {
    assert.doesNotThrow(() => assertCsrf(mutate({ "sec-fetch-site": "same-origin" }), human));
    assert.throws(() => assertCsrf(mutate({ "sec-fetch-site": "cross-site" }), human), (err) => err.code === "cross_site");
    assert.throws(() => assertCsrf(mutate({ "sec-fetch-site": "none" }), human), (err) => err.status === 403);
  });

  test("without Sec-Fetch-Site the CSRF header is required", () => {
    assert.throws(() => assertCsrf(mutate({}), human), (err) => err.code === "csrf_missing");
    assert.doesNotThrow(() => assertCsrf(mutate({ [CSRF_HEADER]: "1" }), human));
  });
});

describe("readConfig", () => {
  test("returns the normalised configuration", () => {
    const config = readConfig(testEnv({ OWNER_EMAIL: "Owner@Example.com" }));
    assert.deepEqual({ ...config }, { teamDomain: TEAM_DOMAIN, aud: AUD, ownerEmail: "owner@example.com" });
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
