// api.test.mjs — the request pipeline end to end: a signed Access token goes
// in at handleRequest() and a real Response comes out. Only D1 and R2 are
// faked, so routing, JWT verification, CSRF, authorization, publishing and the
// JSON error contract are all exercised together.

import { after, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";

import { handleRequest } from "../src/app.mjs";
import { resetJwksCache } from "../src/auth.mjs";
import { VIEWER_CSP } from "../src/http.mjs";
import { RENDER_CSP } from "../src/render.mjs";
import { MAX_HTML_BYTES } from "../src/store.mjs";
import { createRateLimiter } from "../src/ratelimit.mjs";
import { AUD, OWNER_EMAIL, accessRequest, createSigner, jwksFetcher, personClaims, serviceClaims, signJwt, testEnv } from "./fixtures/access.mjs";
import { fakeBlobs, fakeStore } from "./fixtures/fake-bindings.mjs";

const NOW = new Date("2026-08-31T12:00:00.000Z");
const NOW_SEC = Math.floor(NOW.getTime() / 1000);
const signer = await createSigner();
const silentLogger = { error: () => {} };

const ownerToken = await signJwt(signer, personClaims({ nowSec: NOW_SEC }));
const viewerToken = await signJwt(signer, personClaims({ nowSec: NOW_SEC, email: "viewer@example.com" }));
const strangerToken = await signJwt(signer, personClaims({ nowSec: NOW_SEC, email: "nobody@example.com" }));
const serviceToken = await signJwt(signer, serviceClaims({ nowSec: NOW_SEC }));
const foreignToken = await signJwt(signer, personClaims({ nowSec: NOW_SEC, aud: "another-application" }));

beforeEach(() => resetJwksCache());
after(() => resetJwksCache());

function harness({ store = fakeStore(), blobs = fakeBlobs(), rateLimiter = createRateLimiter() } = {}) {
  const { fetchImpl } = jwksFetcher(signer.jwks);
  const env = testEnv();
  const call = (path, { token = ownerToken, method = "GET", headers = {}, body } = {}) =>
    handleRequest(accessRequest(`https://host.example${path}`, { token, method, headers, body }), env, {
      store,
      blobs,
      fetchImpl,
      now: NOW,
      rateLimiter,
      logger: silentLogger,
    });
  return { call, store, blobs, env };
}

const publishBody = (html, headers = {}) => ({
  method: "PUT",
  token: serviceToken,
  headers: { "content-type": "text/html; charset=utf-8", ...headers },
  body: html,
});

const jsonPost = (payload, headers = {}) => ({
  method: "POST",
  headers: { "content-type": "application/json", "x-yoki-csrf": "1", ...headers },
  body: JSON.stringify(payload),
});

describe("authentication at the edge of the Worker", () => {
  test("a request without an Access token is 401 JSON", async () => {
    const { call } = harness();
    const response = await call("/api/artifacts", { token: null });
    assert.equal(response.status, 401);
    assert.equal(response.headers.get("content-type"), "application/json; charset=utf-8");
    assert.deepEqual(await response.json(), {
      error: "This page must be reached through Cloudflare Access. Reload to sign in.",
      code: "missing_token",
    });
  });

  test("a token for another Access application is refused", async () => {
    const { call } = harness();
    const response = await call("/api/artifacts", { token: foreignToken });
    assert.equal(response.status, 401);
    assert.equal((await response.json()).code, "bad_audience");
  });

  test("the token's audience is the one this deployment configures", () => {
    assert.equal(testEnv().ACCESS_AUD, AUD);
  });
});

describe("publish", () => {
  test("creates version 1 and answers with the viewer URL", async () => {
    const { call, blobs } = harness();
    const response = await call("/api/artifacts/notes", publishBody("<h1>one</h1>", { "x-yoki-title": "Design notes" }));
    assert.equal(response.status, 201);
    assert.deepEqual(await response.json(), {
      channel: "notes",
      version: 1,
      url: "https://host.example/a/notes?v=1",
    });
    assert.ok(blobs._objects.has("a/notes/1.html"));
  });

  test("identical bytes answer 200 unchanged", async () => {
    const { call } = harness();
    await call("/api/artifacts/notes", publishBody("<h1>same</h1>"));
    const response = await call("/api/artifacts/notes", publishBody("<h1>same</h1>"));
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.unchanged, true);
    assert.equal(body.version, 1);
  });

  test("a percent-encoded title header survives", async () => {
    const { call, store } = harness();
    await call("/api/artifacts/notes", publishBody("<p>x</p>", { "x-yoki-title": encodeURIComponent("設計メモ") }));
    assert.equal((await store.getArtifact("notes")).title, "設計メモ");
  });

  test("a non-HTML content type is refused", async () => {
    const { call } = harness();
    const response = await call("/api/artifacts/notes", {
      method: "PUT",
      token: serviceToken,
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).code, "bad_content_type");
  });

  test("an announced size over 16 MiB is refused before the body is read", async () => {
    const { call } = harness();
    const response = await call("/api/artifacts/notes", {
      method: "PUT",
      token: serviceToken,
      headers: { "content-type": "text/html", "content-length": String(MAX_HTML_BYTES + 1) },
      body: "<p>small lie</p>",
    });
    assert.equal(response.status, 413);
    assert.equal((await response.json()).code, "too_large");
  });

  test("an invalid channel name is refused", async () => {
    const { call } = harness();
    const response = await call("/api/artifacts/Not%20Valid", publishBody("<p>x</p>"));
    assert.equal(response.status, 400);
    assert.equal((await response.json()).code, "invalid_channel");
  });

  test("a listed viewer cannot publish", async () => {
    const { call } = harness();
    await call("/api/artifacts/notes", publishBody("<p>x</p>"));
    const response = await call("/api/artifacts/notes", {
      ...publishBody("<p>y</p>"),
      token: viewerToken,
      headers: { "content-type": "text/html", "x-yoki-csrf": "1" },
    });
    assert.equal(response.status, 403);
    assert.equal((await response.json()).code, "not_owner");
  });
});

describe("reading artifacts", () => {
  async function seeded() {
    const context = harness();
    await context.call("/api/artifacts/notes", publishBody("<h1>one</h1>", { "x-yoki-title": "Notes" }));
    await context.call("/api/artifacts/notes", publishBody("<h1>two</h1>", { "x-yoki-label": "second" }));
    await context.call("/api/artifacts/notes/viewers", jsonPost({ add: ["Viewer@Example.com"] }));
    return context;
  }

  test("the owner index lists channels with their unread agent comments", async () => {
    const { call } = await seeded();
    await call("/api/artifacts/notes/comments", jsonPost({ body: "look here", to_agent: true }));
    const response = await call("/api/artifacts");
    assert.equal(response.status, 200);
    const { artifacts } = await response.json();
    assert.equal(artifacts.length, 1);
    assert.deepEqual(
      { channel: artifacts[0].channel, latest: artifacts[0].latest_version, revoked: artifacts[0].revoked, unread: artifacts[0].unread_agent_comments },
      { channel: "notes", latest: 2, revoked: false, unread: 1 },
    );
  });

  test("a viewer may not list every channel", async () => {
    const { call } = await seeded();
    const response = await call("/api/artifacts", { token: viewerToken });
    assert.equal(response.status, 403);
  });

  test("one channel comes back with its versions; the viewer list is owner-only", async () => {
    const { call } = await seeded();
    const asOwner = await (await call("/api/artifacts/notes")).json();
    assert.deepEqual(asOwner.versions.map((version) => version.version), [2, 1]);
    assert.deepEqual(asOwner.viewers, ["viewer@example.com"]);

    const asViewer = await (await call("/api/artifacts/notes", { token: viewerToken })).json();
    assert.equal(asViewer.viewers, undefined);
    assert.equal(asViewer.artifact.title, "Notes");
  });

  test("a stranger gets 403 on a channel they are not on", async () => {
    const { call } = await seeded();
    const response = await call("/api/artifacts/notes", { token: strangerToken });
    assert.equal(response.status, 403);
    assert.equal((await response.json()).code, "not_a_viewer");
  });

  test("versions are listed on their own endpoint", async () => {
    const { call } = await seeded();
    const body = await (await call("/api/artifacts/notes/versions")).json();
    assert.equal(body.channel, "notes");
    assert.equal(body.versions[0].label, "second");
  });

  test("removing a viewer takes their access away", async () => {
    const { call } = await seeded();
    await call("/api/artifacts/notes/viewers", jsonPost({ remove: ["viewer@example.com"] }));
    const response = await call("/api/artifacts/notes", { token: viewerToken });
    assert.equal(response.status, 403);
  });

  test("a malformed email is refused before anything is stored", async () => {
    const { call } = await seeded();
    const response = await call("/api/artifacts/notes/viewers", jsonPost({ add: ["not-an-email"] }));
    assert.equal(response.status, 400);
    assert.equal((await response.json()).code, "bad_email");
  });
});

describe("revoke and render", () => {
  async function seeded() {
    const context = harness();
    await context.call("/api/artifacts/notes", publishBody("<h1>hello</h1>"));
    await context.call("/api/artifacts/notes/viewers", jsonPost({ add: ["viewer@example.com"] }));
    return context;
  }

  test("the render endpoint streams the stored HTML with the sandbox CSP", async () => {
    const { call } = await seeded();
    const response = await call("/r/notes/1", { token: viewerToken });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-security-policy"), RENDER_CSP);
    assert.equal(await response.text(), "<h1>hello</h1>");
  });

  test("revoking makes the channel a 404 for everyone", async () => {
    const { call } = await seeded();
    const revoked = await call("/api/artifacts/notes/revoke", jsonPost({}));
    assert.equal(revoked.status, 200);
    assert.equal((await revoked.json()).revoked_at, NOW.toISOString());

    const asViewer = await call("/r/notes/1", { token: viewerToken });
    assert.equal(asViewer.status, 404);
    assert.equal(asViewer.headers.get("content-type"), "text/plain; charset=utf-8");
  });

  test("the owner can still see a revoked version with the explicit header", async () => {
    const { call } = await seeded();
    await call("/api/artifacts/notes/revoke", jsonPost({}));
    const response = await call("/r/notes/1", { headers: { "x-yoki-include-revoked": "1" } });
    assert.equal(response.status, 200);
  });

  test("publishing again brings the channel back", async () => {
    const { call } = await seeded();
    await call("/api/artifacts/notes/revoke", jsonPost({}));
    await call("/api/artifacts/notes", publishBody("<h1>back</h1>"));
    const response = await call("/r/notes/2", { token: viewerToken });
    assert.equal(response.status, 200);
  });
});

describe("comment flow through the API", () => {
  test("a viewer asks the agent, the agent replies and marks it seen", async () => {
    const { call } = harness();
    await call("/api/artifacts/notes", publishBody("<h1>one</h1>"));
    await call("/api/artifacts/notes/viewers", jsonPost({ add: ["viewer@example.com"] }));

    const posted = await call("/api/artifacts/notes/comments", {
      ...jsonPost({ body: "the axis labels are cut off", to_agent: true }),
      token: viewerToken,
    });
    assert.equal(posted.status, 200);
    const { comment } = await posted.json();
    assert.equal(comment.to_agent, true);

    const inbox = await (await call(`/api/artifacts/notes/comments?to_agent=1`, { token: serviceToken })).json();
    assert.deepEqual(inbox.comments.map((entry) => entry.id), [comment.id]);

    const replied = await call(`/api/comments/${comment.id}/reply`, {
      ...jsonPost({ body: "fixed in v2" }),
      token: serviceToken,
    });
    assert.equal((await replied.json()).comment.author, `agent via ${OWNER_EMAIL}`);

    await call(`/api/comments/${comment.id}/seen`, { ...jsonPost({}), token: serviceToken });
    const after = await (await call("/api/artifacts")).json();
    assert.equal(after.artifacts[0].unread_agent_comments, 0);
  });

  /**
   * Read against the wire, not the handler return value: a leak that only
   * showed up once the object was serialised would slip past a unit test.
   */
  test("nothing a non-owner receives carries another reader's address", async () => {
    const { call } = harness();
    await call("/api/artifacts/notes", publishBody("<h1>one</h1>", { "x-yoki-title": "Notes" }));
    await call("/api/artifacts/notes/viewers", jsonPost({ add: ["viewer@example.com", "second@example.com"] }));

    // One thread carrying every kind of byline the column ever holds: a
    // reader's address, the agent's role, and a resolution by the owner.
    const { comment } = await (
      await call("/api/artifacts/notes/comments", {
        ...jsonPost({ body: "the axis labels are cut off", to_agent: true }),
        token: viewerToken,
      })
    ).json();
    await call(`/api/comments/${comment.id}/reply`, { ...jsonPost({ body: "fixed in v2" }), token: serviceToken });
    await call(`/api/comments/${comment.id}/resolve`, jsonPost({}));

    const paths = ["/api/artifacts/notes", "/api/artifacts/notes/versions", "/api/artifacts/notes/comments"];
    for (const path of paths) {
      const raw = await (await call(path, { token: viewerToken })).text();
      for (const reader of ["viewer@example.com", "second@example.com"]) {
        assert.equal(raw.includes(reader), false, `${path} named ${reader}`);
      }
    }

    const thread = await (await call("/api/artifacts/notes/comments", { token: viewerToken })).text();
    // The owner's own address is not a secret here — the deployment prints it
    // in the agent's byline on purpose, so a reader knows who is answering —
    // but it must be the only address the payload contains.
    assert.deepEqual(
      [...new Set(thread.match(/[\w.+-]+@[\w.-]+\.\w+/g) ?? [])],
      [OWNER_EMAIL],
      "the only address left is the one inside the agent byline",
    );
    assert.match(thread, new RegExp(`agent via ${OWNER_EMAIL}`));

    // Both rows carry the same created_at from the fixed clock, so pick them
    // by their place in the thread rather than by list order.
    const rows = JSON.parse(thread).comments;
    assert.equal(rows.length, 2);
    for (const row of rows) {
      assert.equal("author" in row, false);
      assert.equal("resolved_by" in row, false);
    }
    const root = rows.find((row) => row.parent_id === null);
    const reply = rows.find((row) => row.parent_id !== null);
    assert.match(root.author_display, /^viewer-[0-9a-f]{8}$/);
    assert.match(root.resolved_by_display, /^viewer-[0-9a-f]{8}$/);
    assert.equal(reply.author_display, `agent via ${OWNER_EMAIL}`);

    // The same request as the owner is the control: the addresses are there.
    const asOwner = JSON.parse(await (await call("/api/artifacts/notes/comments")).text());
    const ownerRoot = asOwner.comments.find((row) => row.parent_id === null);
    assert.equal(ownerRoot.author, "viewer@example.com");
    assert.equal(ownerRoot.resolved_by, OWNER_EMAIL);
  });
});

describe("the viewer shell", () => {
  test("/ and /a/:channel serve public/viewer.html with the viewer CSP", async () => {
    const { call } = harness();
    for (const path of ["/", "/a/notes"]) {
      const response = await call(path);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("content-security-policy"), VIEWER_CSP);
      assert.equal(response.headers.get("content-type"), "text/html; charset=utf-8");
      assert.match(await response.text(), /<title>shell<\/title>/);
    }
  });

  test("an invalid channel in the path never reaches the asset", async () => {
    const { call } = harness();
    const response = await call("/a/NOT-VALID");
    assert.equal(response.status, 400);
  });
});

describe("protocol errors", () => {
  test("an unknown path is 404 JSON", async () => {
    const { call } = harness();
    const response = await call("/nothing/here");
    assert.equal(response.status, 404);
    assert.equal((await response.json()).code, "no_such_route");
  });

  test("a known path with the wrong method reports Allow", async () => {
    const { call } = harness();
    const response = await call("/api/artifacts/notes", { method: "DELETE" });
    assert.equal(response.status, 405);
    assert.equal(response.headers.get("allow"), "GET, PUT");
  });

  test("a browser mutation without the CSRF proof is refused", async () => {
    const { call } = harness();
    const response = await call("/api/artifacts/notes/revoke", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    assert.equal(response.status, 403);
    assert.equal((await response.json()).code, "csrf_missing");
  });

  test("a cross-site mutation is refused even with the CSRF header", async () => {
    const { call } = harness();
    const response = await call("/api/artifacts/notes/revoke", {
      ...jsonPost({}),
      headers: { "content-type": "application/json", "x-yoki-csrf": "1", "sec-fetch-site": "cross-site" },
    });
    assert.equal(response.status, 403);
    assert.equal((await response.json()).code, "cross_site");
  });

  test("the per-identity rate limit answers 429 with Retry-After", async () => {
    const { call } = harness({ rateLimiter: createRateLimiter({ limit: 2, windowMs: 60000 }) });
    await call("/api/artifacts");
    await call("/api/artifacts");
    const response = await call("/api/artifacts");
    assert.equal(response.status, 429);
    assert.equal((await response.json()).code, "rate_limited");
    assert.equal(response.headers.get("retry-after"), "60");
  });

  test("responses are never cached", async () => {
    const { call } = harness();
    const response = await call("/api/artifacts");
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.equal(response.headers.get("x-robots-tag"), "noindex, nofollow");
  });
});
