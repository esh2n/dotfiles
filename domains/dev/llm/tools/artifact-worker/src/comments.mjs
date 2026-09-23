// comments.mjs — comment threads and the agent bridge.
//
// A thread is one root comment plus its replies (one level, no nesting).
// `to_agent` marks a comment as addressed to the agent; the CLI polls
// `?to_agent=1&since=<ISO>` with a service token and calls /seen once it has
// picked the comment up, which is what drives the owner index's unread count.
//
// Authorship is told two different ways depending on who is asking. The owner
// runs the deployment and already holds the viewer list, so they get the real
// addresses. Everyone else gets a pseudonym and no raw address at all: being
// shared one page is not a reason to learn who else was shared it.

import { badRequest, forbidden, notFound, readJsonBody } from "./http.mjs";
import { identityKey, isOwner } from "./auth.mjs";
import { loadArtifactContext } from "./access.mjs";

export const MAX_COMMENT_LENGTH = 8000;

/** Every distinct thing an identity can try to do with a comment. */
export const COMMENT_ACTIONS = Object.freeze(["read", "post", "reply", "resolve", "seen"]);

/**
 * The authorization matrix, as one pure function.
 *
 *            | owner / pinned token  | listed viewer        | anyone else
 *   read     | yes                   | yes                  | no
 *   post     | yes                   | yes                  | no
 *   reply    | yes                   | yes                  | no
 *   resolve  | yes                   | only own comment     | no
 *   seen     | yes                   | no                   | no
 *
 * "owner" here means OWNER_EMAIL or the pinned SERVICE_TOKEN_NAME — a service
 * token that is not the pinned one lands in the "listed viewer / anyone else"
 * columns like any other identity, so it can never mark comments seen.
 */
export function canActOnComments(
  action,
  identity,
  { ownerEmail, serviceTokenName = null, viewers = [], comment = null, reader = null } = {},
) {
  if (!COMMENT_ACTIONS.includes(action)) return false;
  const owner = isOwner(identity, { ownerEmail, serviceTokenName });
  if (owner) return true;
  // `reader` lets a caller reuse an access decision already made upstream.
  const key = identityKey(identity);
  const isReader =
    reader === null
      ? key !== null && viewers.some((email) => String(email).trim().toLowerCase() === key)
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

/**
 * True only for a stored label that is itself an address.
 *
 * The other two labels this column ever holds — `agent via <owner>` and
 * `service:<name>` — are roles, not people, and stay legible to everyone: a
 * reader has to be able to tell the agent's replies from a stranger's.
 */
function isAddressLabel(label) {
  return typeof label === "string" && /^[^\s@]+@[^\s@]+$/.test(label);
}

/**
 * The pseudonym a non-owner sees instead of an address.
 *
 * The channel is hashed in alongside the address so the same person is a
 * different `viewer-…` on every artifact. Without that salt, one reader who
 * worked out which pseudonym was whom on one page would recognise that person
 * on every other page they were ever shared, which is the leak the pseudonym
 * exists to prevent. Truncating to 8 hex characters keeps the label readable;
 * it is a label, not a secret, and the address is never sent alongside it.
 */
export async function displayAuthor(label, channel) {
  if (!isAddressLabel(label)) return label;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${label}${channel}`));
  const head = new Uint8Array(digest).subarray(0, 4);
  return `viewer-${Array.from(head, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

/**
 * @param owner  true when the caller is the owner (or the pinned service
 *               token). Defaults to false so a call site that forgets to pass
 *               it discloses less, never more.
 */
export async function serializeComment(row, { owner = false } = {}) {
  const channel = row.channel;
  const resolvedBy = row.resolved_by ?? null;
  return {
    id: row.id,
    channel,
    version: row.version,
    parent_id: row.parent_id ?? null,
    // Omitted rather than blanked for a non-owner: a client that reads
    // `author` gets nothing to render, instead of a plausible-looking empty
    // string it might print as the author.
    ...(owner ? { author: row.author } : {}),
    author_display: await displayAuthor(row.author, channel),
    body: row.body,
    created_at: row.created_at,
    resolved_at: row.resolved_at ?? null,
    ...(owner ? { resolved_by: resolvedBy } : {}),
    resolved_by_display: resolvedBy === null ? null : await displayAuthor(resolvedBy, channel),
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
  // Same rule as every other entry point: a revoked artifact looks like it
  // never existed to anyone but the owner. Holding a comment id from before
  // the revoke must not be a way back in — reply/resolve/seen all land here.
  // The owner (and the CLI's service identity, which isOwner() covers) still
  // sees revoked channels, which is what `seen` needs.
  const owner = isOwner(identity, config);
  const context = await loadArtifactContext({
    store,
    config,
    identity,
    channel: comment.channel,
    includeRevoked: owner,
  });
  return { comment, owner, ...context };
}

// --- handlers -------------------------------------------------------------

export async function handleListComments({ url, params, identity, config, store }) {
  const owner = isOwner(identity, config);
  const { channel, viewers } = await loadArtifactContext({
    store,
    config,
    identity,
    channel: params.channel,
    includeRevoked: owner,
  });
  requireCommentAction("read", identity, { ownerEmail: config.ownerEmail, serviceTokenName: config.serviceTokenName, viewers, reader: true });
  const since = normalizeSince(url.searchParams.get("since"));
  const toAgentOnly = url.searchParams.get("to_agent") === "1";
  const rows = await store.listComments({ channel, since, toAgentOnly });
  return { channel, comments: await Promise.all(rows.map((row) => serializeComment(row, { owner }))) };
}

export async function handlePostComment({ request, params, identity, config, store, now = new Date() }) {
  const owner = isOwner(identity, config);
  const { channel, artifact, viewers } = await loadArtifactContext({
    store,
    config,
    identity,
    channel: params.channel,
    includeRevoked: owner,
  });
  requireCommentAction("post", identity, { ownerEmail: config.ownerEmail, serviceTokenName: config.serviceTokenName, viewers, reader: true });

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
  return { comment: await serializeComment({ ...row, resolved_at: null, resolved_by: null, agent_seen_at: null }, { owner }) };
}

export async function handleReplyComment({ request, params, identity, config, store, now = new Date() }) {
  const { comment, channel, viewers, owner } = await loadCommentContext({ id: params.id, store, config, identity });
  requireCommentAction("reply", identity, { ownerEmail: config.ownerEmail, serviceTokenName: config.serviceTokenName, viewers, reader: true, comment });

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
  return { comment: await serializeComment({ ...row, resolved_at: null, resolved_by: null, agent_seen_at: null }, { owner }) };
}

export async function handleResolveComment({ params, identity, config, store, now = new Date() }) {
  const { comment, viewers, owner } = await loadCommentContext({ id: params.id, store, config, identity });
  requireCommentAction("resolve", identity, { ownerEmail: config.ownerEmail, serviceTokenName: config.serviceTokenName, viewers, reader: true, comment });
  if (comment.resolved_at) {
    // Idempotent: the first resolution stands.
    return { comment: await serializeComment(comment, { owner }) };
  }
  const resolvedAt = now.toISOString();
  await store.resolveComment({ id: comment.id, resolvedAt, resolvedBy: identity.label });
  return { comment: await serializeComment({ ...comment, resolved_at: resolvedAt, resolved_by: identity.label }, { owner }) };
}

export async function handleSeenComment({ params, identity, config, store, now = new Date() }) {
  const { comment, viewers, owner } = await loadCommentContext({ id: params.id, store, config, identity });
  requireCommentAction("seen", identity, { ownerEmail: config.ownerEmail, serviceTokenName: config.serviceTokenName, viewers, reader: true, comment });
  if (comment.agent_seen_at) {
    return { comment: await serializeComment(comment, { owner }) };
  }
  const seenAt = now.toISOString();
  await store.markCommentSeen({ id: comment.id, seenAt });
  return { comment: await serializeComment({ ...comment, agent_seen_at: seenAt }, { owner }) };
}
