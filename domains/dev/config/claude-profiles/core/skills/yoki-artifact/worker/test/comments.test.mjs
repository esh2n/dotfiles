// comments.test.mjs — the authorization matrix and the comment handlers,
// including the agent bridge (to_agent -> /seen) and service-token replies.

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  COMMENT_ACTIONS,
  canActOnComments,
  handleListComments,
  handlePostComment,
  handleReplyComment,
  handleResolveComment,
  handleSeenComment,
  replyAuthor,
} from "../src/comments.mjs";
import { OWNER_EMAIL, SERVICE_TOKEN_NAME } from "./fixtures/access.mjs";
import { fakeStore } from "./fixtures/fake-bindings.mjs";

const config = {
  teamDomain: "team.cloudflareaccess.com",
  aud: "aud",
  ownerEmail: OWNER_EMAIL,
  serviceTokenName: SERVICE_TOKEN_NAME,
};
const owner = { kind: "human", id: OWNER_EMAIL, common_name: null, email: OWNER_EMAIL, label: OWNER_EMAIL };
const viewer = { kind: "human", id: "viewer@example.com", common_name: null, email: "viewer@example.com", label: "viewer@example.com" };
const stranger = { kind: "human", id: "nobody@example.com", common_name: null, email: "nobody@example.com", label: "nobody@example.com" };
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

const NOW = new Date("2026-08-31T12:00:00.000Z");

function seeded(comments = []) {
  return fakeStore({
    artifacts: [
      {
        channel: "notes",
        title: "Notes",
        owner: OWNER_EMAIL,
        latest_version: 2,
        created_at: "2026-08-31T10:00:00.000Z",
        updated_at: "2026-08-31T11:00:00.000Z",
        revoked_at: null,
      },
    ],
    versions: [
      { channel: "notes", version: 1, sha256: "a", bytes: 1, label: null, note: null, created_at: "2026-08-31T10:00:00.000Z" },
      { channel: "notes", version: 2, sha256: "b", bytes: 1, label: null, note: null, created_at: "2026-08-31T11:00:00.000Z" },
    ],
    viewers: { notes: ["viewer@example.com"] },
    comments,
  });
}

const rootComment = {
  id: "c1",
  channel: "notes",
  version: 1,
  parent_id: null,
  author: "viewer@example.com",
  body: "please look at the chart",
  created_at: "2026-08-31T11:30:00.000Z",
  resolved_at: null,
  resolved_by: null,
  to_agent: 1,
  agent_seen_at: null,
};

function jsonRequest(body) {
  return new Request("https://host.example/api", {
    method: "POST",
    headers: { "content-type": "application/json", "x-yoki-csrf": "1" },
    body: JSON.stringify(body),
  });
}

describe("authorization matrix", () => {
  const context = (comment = null) => ({
    ownerEmail: OWNER_EMAIL,
    serviceTokenName: SERVICE_TOKEN_NAME,
    viewers: ["viewer@example.com"],
    comment,
  });

  const expectations = [
    ["owner", owner, { read: true, post: true, reply: true, resolve: true, seen: true }],
    ["pinned service token", service, { read: true, post: true, reply: true, resolve: true, seen: true }],
    ["listed viewer", viewer, { read: true, post: true, reply: true, resolve: true, seen: false }],
    ["stranger", stranger, { read: false, post: false, reply: false, resolve: false, seen: false }],
    // A second token on the same Access application is not the owner, so it
    // cannot mark comments seen and drain the owner's unread count.
    ["another service token", otherService, { read: false, post: false, reply: false, resolve: false, seen: false }],
  ];

  for (const [name, identity, allowed] of expectations) {
    test(`${name} permissions`, () => {
      for (const action of COMMENT_ACTIONS) {
        // `resolve` is checked against a comment the viewer authored.
        assert.equal(
          canActOnComments(action, identity, context(rootComment)),
          allowed[action],
          `${name} ${action}`,
        );
      }
    });
  }

  test("a viewer may not resolve someone else's comment", () => {
    const otherComment = { ...rootComment, author: "someone@example.com" };
    assert.equal(canActOnComments("resolve", viewer, context(otherComment)), false);
    assert.equal(canActOnComments("resolve", owner, context(otherComment)), true);
  });

  test("unknown actions are refused", () => {
    assert.equal(canActOnComments("delete", owner, context()), false);
  });

  test("a service token replies on behalf of the owner", () => {
    assert.equal(replyAuthor(service, OWNER_EMAIL), `agent via ${OWNER_EMAIL}`);
    assert.equal(replyAuthor(viewer, OWNER_EMAIL), "viewer@example.com");
  });
});

describe("listing", () => {
  const url = (query = "") => new URL(`https://host.example/api/artifacts/notes/comments${query}`);

  test("returns the thread, newest last", async () => {
    const store = seeded([rootComment, { ...rootComment, id: "c2", created_at: "2026-08-31T11:40:00.000Z", to_agent: 0 }]);
    const result = await handleListComments({ url: url(), params: { channel: "notes" }, identity: viewer, config, store });
    assert.deepEqual(result.comments.map((comment) => comment.id), ["c1", "c2"]);
    assert.equal(result.comments[0].to_agent, true);
  });

  test("?to_agent=1 and ?since= narrow the agent's inbox", async () => {
    const store = seeded([
      rootComment,
      { ...rootComment, id: "c2", created_at: "2026-08-31T11:40:00.000Z", to_agent: 1 },
      { ...rootComment, id: "c3", created_at: "2026-08-31T11:45:00.000Z", to_agent: 0 },
    ]);
    const result = await handleListComments({
      url: url("?to_agent=1&since=2026-08-31T11:35:00.000Z"),
      params: { channel: "notes" },
      identity: service,
      config,
      store,
    });
    assert.deepEqual(result.comments.map((comment) => comment.id), ["c2"]);
  });

  test("a bad `since` is a 400, not an empty list", async () => {
    await assert.rejects(
      handleListComments({ url: url("?since=yesterday"), params: { channel: "notes" }, identity: owner, config, store: seeded() }),
      (err) => err.status === 400 && err.code === "bad_since",
    );
  });

  test("a stranger gets 403", async () => {
    await assert.rejects(
      handleListComments({ url: url(), params: { channel: "notes" }, identity: stranger, config, store: seeded() }),
      (err) => err.status === 403,
    );
  });
});

describe("posting", () => {
  test("a viewer can post to the agent on the latest version", async () => {
    const store = seeded();
    const { comment } = await handlePostComment({
      request: jsonRequest({ body: "  needs a legend  ", to_agent: true }),
      params: { channel: "notes" },
      identity: viewer,
      config,
      store,
      now: NOW,
    });
    assert.equal(comment.author, "viewer@example.com");
    assert.equal(comment.body, "needs a legend");
    assert.equal(comment.version, 2, "defaults to the latest version");
    assert.equal(comment.to_agent, true);
    assert.equal(comment.parent_id, null);
    assert.equal(store._comments.size, 1);
  });

  test("an explicit version must exist", async () => {
    await assert.rejects(
      handlePostComment({
        request: jsonRequest({ body: "hi", version: 9 }),
        params: { channel: "notes" },
        identity: owner,
        config,
        store: seeded(),
        now: NOW,
      }),
      (err) => err.status === 404 && err.code === "no_such_version",
    );
  });

  test("an empty or oversized body is refused", async () => {
    const attempt = (body) =>
      handlePostComment({
        request: jsonRequest({ body }),
        params: { channel: "notes" },
        identity: owner,
        config,
        store: seeded(),
        now: NOW,
      });
    await assert.rejects(attempt("   "), (err) => err.code === "empty_comment");
    await assert.rejects(attempt("x".repeat(8001)), (err) => err.code === "comment_too_long");
  });

  test("replying to a reply joins the same thread", async () => {
    const store = seeded([rootComment, { ...rootComment, id: "c2", parent_id: "c1", to_agent: 0 }]);
    const { comment } = await handlePostComment({
      request: jsonRequest({ body: "agreed", parent_id: "c2" }),
      params: { channel: "notes" },
      identity: owner,
      config,
      store,
      now: NOW,
    });
    assert.equal(comment.parent_id, "c1");
  });

  test("a parent from another channel is refused", async () => {
    const store = seeded([{ ...rootComment, channel: "other" }]);
    await assert.rejects(
      handlePostComment({
        request: jsonRequest({ body: "hi", parent_id: "c1" }),
        params: { channel: "notes" },
        identity: owner,
        config,
        store,
        now: NOW,
      }),
      (err) => err.code === "no_such_parent",
    );
  });
});

describe("reply, resolve and seen", () => {
  test("the agent's reply is attributed to the agent", async () => {
    const store = seeded([rootComment]);
    const { comment } = await handleReplyComment({
      request: jsonRequest({ body: "added a legend in v3" }),
      params: { id: "c1" },
      identity: service,
      config,
      store,
      now: NOW,
    });
    assert.equal(comment.author, `agent via ${OWNER_EMAIL}`);
    assert.equal(comment.parent_id, "c1");
    assert.equal(comment.to_agent, false);
  });

  test("resolve records who resolved it and is idempotent", async () => {
    const store = seeded([rootComment]);
    const first = await handleResolveComment({ params: { id: "c1" }, identity: owner, config, store, now: NOW });
    assert.equal(first.comment.resolved_by, OWNER_EMAIL);
    assert.equal(first.comment.resolved_at, NOW.toISOString());

    const later = new Date("2026-08-31T13:00:00.000Z");
    const second = await handleResolveComment({ params: { id: "c1" }, identity: owner, config, store, now: later });
    assert.equal(second.comment.resolved_at, NOW.toISOString(), "the first resolution stands");
  });

  test("a stranger cannot resolve", async () => {
    await assert.rejects(
      handleResolveComment({ params: { id: "c1" }, identity: stranger, config, store: seeded([rootComment]), now: NOW }),
      (err) => err.status === 403,
    );
  });

  test("/seen is the agent's bookkeeping and viewers cannot call it", async () => {
    const store = seeded([rootComment]);
    await assert.rejects(
      handleSeenComment({ params: { id: "c1" }, identity: viewer, config, store, now: NOW }),
      (err) => err.status === 403 && err.code === "comment_forbidden",
    );
    const { comment } = await handleSeenComment({ params: { id: "c1" }, identity: service, config, store, now: NOW });
    assert.equal(comment.agent_seen_at, NOW.toISOString());
  });

  test("an unknown comment id is 404", async () => {
    await assert.rejects(
      handleResolveComment({ params: { id: "nope" }, identity: owner, config, store: seeded(), now: NOW }),
      (err) => err.status === 404 && err.code === "no_such_comment",
    );
  });
});

describe("revocation closes the comment endpoints too", () => {
  /** A revoked artifact whose viewer list was never cleared — exactly what
   *  `yoki-artifact revoke` leaves behind. */
  function revoked(comments = [rootComment]) {
    const store = seeded(comments);
    store._artifacts.set("notes", {
      ...store._artifacts.get("notes"),
      revoked_at: "2026-08-31T11:45:00.000Z",
    });
    return store;
  }

  test("a viewer holding a comment id cannot reply after a revoke", async () => {
    await assert.rejects(
      handleReplyComment({
        request: jsonRequest({ body: "still here" }),
        params: { id: "c1" },
        identity: viewer,
        config,
        store: revoked(),
        now: NOW,
      }),
      (err) => err.status === 404,
    );
  });

  test("a viewer cannot resolve their own comment after a revoke", async () => {
    await assert.rejects(
      handleResolveComment({ params: { id: "c1" }, identity: viewer, config, store: revoked(), now: NOW }),
      (err) => err.status === 404,
    );
  });

  test("the owner and the CLI service token still reach a revoked artifact's comments", async () => {
    const store = revoked();
    const { comment } = await handleSeenComment({ params: { id: "c1" }, identity: service, config, store, now: NOW });
    assert.equal(comment.agent_seen_at, NOW.toISOString());

    const resolved = await handleResolveComment({ params: { id: "c1" }, identity: owner, config, store, now: NOW });
    assert.equal(resolved.comment.resolved_by, OWNER_EMAIL);
  });
});
