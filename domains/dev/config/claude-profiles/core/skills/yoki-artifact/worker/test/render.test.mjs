// render.test.mjs — the /r/* response: its header block (the only isolation
// this single-origin deployment has) and its visibility rules.

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { INCLUDE_REVOKED_HEADER, RENDER_CSP, handleRender, parseVersion, renderHeaders } from "../src/render.mjs";
import { OWNER_EMAIL } from "./fixtures/access.mjs";
import { fakeBlobs, fakeStore } from "./fixtures/fake-bindings.mjs";

const config = { teamDomain: "team.cloudflareaccess.com", aud: "aud", ownerEmail: OWNER_EMAIL };
const owner = { kind: "human", id: OWNER_EMAIL, email: OWNER_EMAIL, label: OWNER_EMAIL };
const viewer = { kind: "human", id: "viewer@example.com", email: "viewer@example.com", label: "viewer@example.com" };
const stranger = { kind: "human", id: "nobody@example.com", email: "nobody@example.com", label: "nobody@example.com" };

function seed({ revoked = null } = {}) {
  return {
    store: fakeStore({
      artifacts: [
        {
          channel: "notes",
          title: "Notes",
          owner: OWNER_EMAIL,
          latest_version: 1,
          created_at: "2026-08-31T10:00:00.000Z",
          updated_at: "2026-08-31T10:00:00.000Z",
          revoked_at: revoked,
        },
      ],
      versions: [
        { channel: "notes", version: 1, sha256: "abc", bytes: 12, label: null, note: null, created_at: "2026-08-31T10:00:00.000Z" },
      ],
      viewers: { notes: ["viewer@example.com"] },
    }),
    blobs: fakeBlobs({ "a/notes/1.html": "<h1>hello</h1>" }),
  };
}

function render({ identity = owner, params = { channel: "notes", version: "1" }, headers = {}, ...rest }) {
  const { store, blobs } = rest.seeded ?? seed();
  return handleRender({
    request: new Request("https://host.example/r/notes/1", { headers }),
    params,
    identity,
    config,
    store: rest.store ?? store,
    blobs: rest.blobs ?? blobs,
    logger: { error: () => {} },
  });
}

describe("headers", () => {
  test("the CSP is exactly the agreed policy", () => {
    assert.equal(
      RENDER_CSP,
      "sandbox allow-scripts allow-forms allow-popups allow-modals; " +
        "default-src 'none'; " +
        "script-src 'unsafe-inline' https://cdnjs.cloudflare.com https://cdn.jsdelivr.net/npm/ https://cdn.tailwindcss.com https://code.jquery.com; " +
        "style-src 'unsafe-inline' https://fonts.googleapis.com; " +
        "font-src data: https://fonts.gstatic.com; " +
        "img-src data: blob:; " +
        "media-src data: blob:; " +
        "connect-src 'none'; " +
        "frame-ancestors 'self'; " +
        "base-uri 'none'; " +
        "form-action 'none'",
    );
  });

  test("the sandbox never grants allow-same-origin", () => {
    assert.ok(RENDER_CSP.includes("sandbox allow-scripts"));
    assert.ok(!RENDER_CSP.includes("allow-same-origin"));
  });

  test("every required header is present on the response", async () => {
    const response = await render({});
    assert.equal(response.status, 200);
    assert.equal(await response.text(), "<h1>hello</h1>");
    const expected = {
      "content-type": "text/html; charset=utf-8",
      "content-security-policy": RENDER_CSP,
      "cache-control": "private, no-store",
      "x-robots-tag": "noindex, nofollow",
      "cross-origin-resource-policy": "same-origin",
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
    };
    for (const [name, value] of Object.entries(expected)) {
      assert.equal(response.headers.get(name), value, `header ${name}`);
    }
    assert.deepEqual(Object.keys(renderHeaders()).sort(), Object.keys(expected).sort());
  });
});

describe("version parsing", () => {
  test("accepts positive integers only", () => {
    assert.equal(parseVersion("1"), 1);
    assert.equal(parseVersion("42"), 42);
    assert.equal(parseVersion("0"), null);
    assert.equal(parseVersion("-1"), null);
    assert.equal(parseVersion("1.5"), null);
    assert.equal(parseVersion("latest"), null);
    assert.equal(parseVersion("9999999999999"), null);
  });
});

describe("visibility", () => {
  test("a listed viewer may render", async () => {
    const response = await render({ identity: viewer });
    assert.equal(response.status, 200);
  });

  test("someone not listed gets 403", async () => {
    await assert.rejects(render({ identity: stranger }), (err) => err.status === 403 && err.code === "not_a_viewer");
  });

  test("an unknown channel or version is 404", async () => {
    await assert.rejects(render({ params: { channel: "missing", version: "1" } }), (err) => err.status === 404);
    await assert.rejects(render({ params: { channel: "notes", version: "9" } }), (err) => err.code === "no_such_version");
  });

  test("a revoked channel is 404 even for the owner", async () => {
    const seeded = seed({ revoked: "2026-08-31T12:00:00.000Z" });
    await assert.rejects(render({ seeded }), (err) => err.status === 404 && err.code === "no_such_artifact");
  });

  test("the owner can still ask for a revoked version explicitly", async () => {
    const seeded = seed({ revoked: "2026-08-31T12:00:00.000Z" });
    const response = await render({ seeded, headers: { [INCLUDE_REVOKED_HEADER]: "1" } });
    assert.equal(response.status, 200);
  });

  test("a viewer cannot use the include-revoked header", async () => {
    const seeded = seed({ revoked: "2026-08-31T12:00:00.000Z" });
    await assert.rejects(
      render({ seeded, identity: viewer, headers: { [INCLUDE_REVOKED_HEADER]: "1" } }),
      (err) => err.status === 404,
    );
  });

  test("a versions row without its R2 object is 404, not a crash", async () => {
    const seeded = seed();
    await assert.rejects(
      render({ seeded, blobs: fakeBlobs() }),
      (err) => err.status === 404 && err.code === "object_missing",
    );
  });
});
