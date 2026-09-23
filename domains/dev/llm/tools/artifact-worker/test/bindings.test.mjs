// bindings.test.mjs — the D1 and R2 adapters. A recording stand-in for
// `db.prepare(...).bind(...)` proves that every value reaches SQLite as a bound
// parameter (no interpolation anywhere) and that each method issues the
// statement it claims to. Query semantics themselves are SQLite's job and are
// checked by the `wrangler dev --local` run, not here.

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { HTML_CONTENT_TYPE, d1Store, r2Blobs } from "../src/store.mjs";

function fakeD1({ first = null, results = [] } = {}) {
  const calls = [];
  const db = {
    calls,
    prepare(sql) {
      const call = { sql, args: [], op: null };
      calls.push(call);
      const statement = {
        bind(...args) {
          call.args = args;
          return statement;
        },
        async first() {
          call.op = "first";
          return first;
        },
        async all() {
          call.op = "all";
          return { results };
        },
        async run() {
          call.op = "run";
          return { success: true };
        },
      };
      return statement;
    },
  };
  return db;
}

const last = (db) => db.calls[db.calls.length - 1];

describe("binding guards", () => {
  test("a missing D1 or R2 binding is a configuration failure", () => {
    for (const build of [d1Store, r2Blobs]) {
      assert.throws(() => build(undefined), (err) => err.status === 500 && err.code === "misconfigured");
      assert.throws(() => build({}), (err) => err.code === "misconfigured");
    }
  });
});

describe("d1Store statements", () => {
  test("reads bind the channel instead of interpolating it", async () => {
    const db = fakeD1({ first: { channel: "notes" } });
    const store = d1Store(db);
    await store.getArtifact("notes");
    assert.match(last(db).sql, /FROM artifacts\s+WHERE channel = \?/);
    assert.deepEqual(last(db).args, ["notes"]);
    assert.ok(!last(db).sql.includes("notes"));
  });

  test("listArtifacts carries the unread agent-comment count", async () => {
    const db = fakeD1({ results: [{ channel: "notes", unread_agent_comments: 2 }] });
    const rows = await d1Store(db).listArtifacts();
    assert.equal(rows[0].unread_agent_comments, 2);
    assert.match(last(db).sql, /to_agent = 1 AND c\.agent_seen_at IS NULL/);
  });

  test("writes bind every column value in order", async () => {
    const db = fakeD1();
    const store = d1Store(db);

    await store.insertArtifact({
      channel: "notes",
      title: "Notes",
      owner: "owner@example.com",
      latest_version: 1,
      created_at: "t0",
      updated_at: "t0",
    });
    assert.deepEqual(last(db).args, ["notes", "Notes", "owner@example.com", 1, "t0", "t0"]);

    await store.insertVersion({
      channel: "notes",
      version: 2,
      sha256: "deadbeef",
      bytes: 10,
      label: null,
      note: null,
      created_at: "t1",
    });
    assert.deepEqual(last(db).args, ["notes", 2, "deadbeef", 10, null, null, "t1"]);

    await store.updateArtifactHead({ channel: "notes", title: "Notes", latestVersion: 2, updatedAt: "t1" });
    assert.match(last(db).sql, /revoked_at = NULL/);
    // The last two are the compare-and-swap guard, null here = unconditional.
    assert.deepEqual(last(db).args, ["Notes", 2, "t1", "notes", null, null]);

    await store.updateArtifactHead({
      channel: "notes",
      title: "Notes",
      latestVersion: 3,
      updatedAt: "t2",
      expectedVersion: 2,
    });
    assert.match(last(db).sql, /\(\? IS NULL OR latest_version = \?\)/);
    assert.deepEqual(last(db).args, ["Notes", 3, "t2", "notes", 2, 2]);

    await store.setRevokedAt("notes", "t2");
    assert.deepEqual(last(db).args, ["t2", "t2", "notes"]);
  });

  test("viewer rows are inserted idempotently and read as plain emails", async () => {
    const db = fakeD1({ results: [{ email: "viewer@example.com" }] });
    const store = d1Store(db);
    await store.addViewer("notes", "viewer@example.com", "t0");
    assert.match(last(db).sql, /INSERT OR IGNORE INTO viewers/);
    assert.deepEqual(await store.listViewers("notes"), ["viewer@example.com"]);
  });

  test("listComments binds since twice and the to_agent flag as 0/1", async () => {
    const db = fakeD1({ results: [] });
    const store = d1Store(db);
    await store.listComments({ channel: "notes", since: "t0", toAgentOnly: true });
    assert.deepEqual(last(db).args, ["notes", "t0", "t0", 1]);
    await store.listComments({ channel: "notes" });
    assert.deepEqual(last(db).args, ["notes", null, null, 0]);
  });

  test("comment updates target a single id", async () => {
    const db = fakeD1();
    const store = d1Store(db);
    await store.resolveComment({ id: "c1", resolvedAt: "t1", resolvedBy: "owner@example.com" });
    assert.deepEqual(last(db).args, ["t1", "owner@example.com", "c1"]);
    await store.markCommentSeen({ id: "c1", seenAt: "t2" });
    assert.deepEqual(last(db).args, ["t2", "c1"]);
  });
});

describe("r2Blobs", () => {
  function fakeBucket(objects = new Map()) {
    const puts = [];
    return {
      puts,
      objects,
      async put(key, value, options) {
        puts.push({ key, value, options });
        objects.set(key, { body: value, size: value.byteLength ?? String(value).length });
      },
      async get(key) {
        return objects.get(key) ?? null;
      },
    };
  }

  test("stores HTML with its content type and sha", async () => {
    const bucket = fakeBucket();
    const bytes = new TextEncoder().encode("<p>x</p>");
    await r2Blobs(bucket).put("a/notes/1.html", bytes, { sha256: "abc" });
    assert.deepEqual(bucket.puts[0].options, {
      httpMetadata: { contentType: HTML_CONTENT_TYPE },
      customMetadata: { sha256: "abc" },
    });
  });

  test("a missing object reads as null, not an exception", async () => {
    const bucket = fakeBucket();
    const blobs = r2Blobs(bucket);
    assert.equal(await blobs.get("a/notes/9.html"), null);
    await blobs.put("a/notes/1.html", new TextEncoder().encode("<p>x</p>"));
    assert.equal((await blobs.get("a/notes/1.html")).size, 8);
  });
});
