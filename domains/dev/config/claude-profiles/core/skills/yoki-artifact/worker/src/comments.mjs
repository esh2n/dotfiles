// comments.mjs — comment threads and the agent bridge.
//
// A thread is one root comment plus its replies (one level, no nesting).
// `to_agent` marks a comment as addressed to the agent; the CLI polls
// `?to_agent=1&since=<ISO>` with a service token and calls /seen once it has
// picked the comment up, which is what drives the owner index's unread count.

import { badRequest, forbidden, notFound, readJsonBody } from "./http.mjs";
import { isOwner } from "./auth.mjs";
import { loadArtifactContext } from "./access.mjs";

export const MAX_COMMENT_LENGTH = 8000;

/** Every distinct thing an identity can try to do with a comment. */
export const COMMENT_ACTIONS = Object.freeze(["read", "post", "reply", "resolve", "seen"]);

/**
 * The authorization matrix, as one pure function.
 *
 *            | owner / service token | listed viewer        | anyone else
 *   read     | yes                   | yes                  | no
 *   post     | yes                   | yes                  | no
 *   reply    | yes                   | yes                  | no
 *   resolve  | yes                   | only own comment     | no
 *   seen     | yes                   | no                   | no
 */
export function canActOnComments(action, identity, { ownerEmail, viewers = [], comment = null, reader = null } = {}) {
  if (!COMMENT_ACTIONS.includes(action)) return false;
  const owner = isOwner(identity, ownerEmail);
  if (owner) return true;
  // `reader` lets a caller reuse an access decision already made upstream.
  const isReader =
    reader === null
      ? viewers.some((email) => String(email).trim().toLowerCase() === identity?.email)
      : reader === true;
  if (!isReader) return false;
  switch (action) {
    case "read":
    case "post":
    case "reply":
      return true;
    case "resolve":
      return comment !== null && comment.author === identity.label;
    default:
      return false;
  }
}

function requireCommentAction(action, identity, context) {
  if (!canActOnComments(action, identity, context)) {
    throw forbidden("comment_forbidden", `You are not allowed to ${action} comments on this artifact.`);
  }
}

export function serializeComment(row) {
  return {
    id: row.id,
    channel: row.channel,
    version: row.version,
    parent_id: row.parent_id ?? null,
    author: row.author,
    body: row.body,
    created_at: row.created_at,
    resolved_at: row.resolved_at ?? null,
    resolved_by: row.resolved_by ?? null,
    to_agent: row.to_agent === 1 || row.to_agent === true,
    agent_seen_at: row.agent_seen_at ?? null,
  };
}

/** A service token replying speaks for the owner, and says so. */
export function replyAuthor(identity, ownerEmail) {
  return identity.kind === "service" ? `agent via ${ownerEmail}` : identity.label;
}

function assertBody(value) {
  if (typeof value !== "string" || value.trim() === "") {
    throw badRequest("empty_comment", "Write something before posting the comment.");
  }
  if (value.length > MAX_COMMENT_LENGTH) {
    throw badRequest("comment_too_long", `Comments are limited to ${MAX_COMMENT_LENGTH} characters.`);
  }
  return value.trim();
}

function normalizeSince(raw) {
  if (raw === null || raw === "") return null;
  const parsed = Date.parse(raw);
  if (Number.isNaN(parsed)) {
    throw badRequest("bad_since", "`since` must be an ISO-8601 timestamp.");
  }
  return new Date(parsed).toISOString();
}

async function assertVersionExists(store, channel, version, latest) {
  const wanted = version === undefined || version === null ? latest : version;
  if (!Number.isInteger(wanted) || wanted < 1) {
    throw badRequest("bad_version", "`version` must be a positive whole number.");
  }
  const row = await store.getVersion(channel, wanted);
  if (!row) {
    throw notFound("no_such_version", "That artifact version does not exist.");
  }
  return wanted;
}

async function loadCommentContext({ id, store, config, identity }) {
  const comment = await store.getComment(id);
  if (!comment) {
    throw notFound("no_such_comment", "That comment does not exist.");
  }
  const context = await loadArtifactContext({
    store,
    config,
    identity,
    channel: comment.channel,
    includeRevoked: true,
  });
  return { comment, ...context };
}

// --- handlers -------------------------------------------------------------

export async function handleListComments({ url, params, identity, config, store }) {
  const { channel, viewers } = await loadArtifactContext({
    store,
    config,
    identity,
    channel: params.channel,
    includeRevoked: isOwner(identity, config.ownerEmail),
  });
  requireCommentAction("read", identity, { ownerEmail: config.ownerEmail, viewers, reader: true });
  const since = normalizeSince(url.searchParams.get("since"));
  const toAgentOnly = url.searchParams.get("to_agent") === "1";
  const rows = await store.listComments({ channel, since, toAgentOnly });
  return { channel, comments: rows.map(serializeComment) };
}

export async function handlePostComment({ request, params, identity, config, store, now = new Date() }) {
  const { channel, artifact, viewers } = await loadArtifactContext({
    store,
    config,
    identity,
    channel: params.channel,
    includeRevoked: isOwner(identity, config.ownerEmail),
  });
  requireCommentAction("post", identity, { ownerEmail: config.ownerEmail, viewers, reader: true });

  const payload = await readJsonBody(request);
  const body = assertBody(payload.body);
  const version = await assertVersionExists(store, channel, payload.version, artifact.latest_version);

  let parentId = null;
  if (payload.parent_id !== undefined && payload.parent_id !== null) {
    const parent = await store.getComment(String(payload.parent_id));
    if (!parent || parent.channel !== channel) {
      throw badRequest("no_such_parent", "The comment you are replying to no longer exists.");
    }
    // Threads are one level deep: replying to a reply joins its thread.
    parentId = parent.parent_id ?? parent.id;
  }

  const row = {
    id: crypto.randomUUID(),
    channel,
    version,
    parent_id: parentId,
    author: identity.label,
    body,
    created_at: now.toISOString(),
    to_agent: payload.to_agent === true || payload.to_agent === 1 ? 1 : 0,
  };
  await store.insertComment(row);
  return { comment: serializeComment({ ...row, resolved_at: null, resolved_by: null, agent_seen_at: null }) };
}

export async function handleReplyComment({ request, params, identity, config, store, now = new Date() }) {
  const { comment, channel, viewers } = await loadCommentContext({ id: params.id, store, config, identity });
  requireCommentAction("reply", identity, { ownerEmail: config.ownerEmail, viewers, reader: true, comment });

  const payload = await readJsonBody(request);
  const body = assertBody(payload.body);
  const row = {
    id: crypto.randomUUID(),
    channel,
    version: comment.version,
    parent_id: comment.parent_id ?? comment.id,
    author: replyAuthor(identity, config.ownerEmail),
    body,
    created_at: now.toISOString(),
    to_agent: 0,
  };
  await store.insertComment(row);
  return { comment: serializeComment({ ...row, resolved_at: null, resolved_by: null, agent_seen_at: null }) };
}

export async function handleResolveComment({ params, identity, config, store, now = new Date() }) {
  const { comment, viewers } = await loadCommentContext({ id: params.id, store, config, identity });
  requireCommentAction("resolve", identity, { ownerEmail: config.ownerEmail, viewers, reader: true, comment });
  if (comment.resolved_at) {
    // Idempotent: the first resolution stands.
    return { comment: serializeComment(comment) };
  }
  const resolvedAt = now.toISOString();
  await store.resolveComment({ id: comment.id, resolvedAt, resolvedBy: identity.label });
  return { comment: serializeComment({ ...comment, resolved_at: resolvedAt, resolved_by: identity.label }) };
}

export async function handleSeenComment({ params, identity, config, store, now = new Date() }) {
  const { comment, viewers } = await loadCommentContext({ id: params.id, store, config, identity });
  requireCommentAction("seen", identity, { ownerEmail: config.ownerEmail, viewers, reader: true, comment });
  if (comment.agent_seen_at) {
    return { comment: serializeComment(comment) };
  }
  const seenAt = now.toISOString();
  await store.markCommentSeen({ id: comment.id, seenAt });
  return { comment: serializeComment({ ...comment, agent_seen_at: seenAt }) };
}
