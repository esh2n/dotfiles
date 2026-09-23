// cmd-comments.mjs — reading comment threads and answering them.
//
// reply/resolve/seen address a comment by id, and the Worker resolves the
// channel from the comment itself (/api/comments/:id/...). The channel is
// still a required argument here so the command reads like the rest of the CLI
// and so a copy-pasted id cannot be sent against the wrong artifact by accident
// — it is validated, and echoed back in the result.

import { assertChannel, requirePositional } from "./validate.mjs";

const JSON_CONTENT_TYPE = "application/json";

/**
 * Whoever the Worker was willing to name.
 *
 * `author` is sent only to the owner; a non-owner identity gets
 * `author_display`, a per-channel pseudonym, and no `author` key at all. The
 * CLI normally runs as the pinned service token and so sees addresses, but it
 * must not depend on that — `--json` hands the rows through untouched, and this
 * line is the only place that has to pick one.
 */
function authorOf(comment) {
  return comment.author ?? comment.author_display ?? "unknown";
}

function commentLine(comment) {
  const marks = [
    comment.to_agent ? "to-agent" : null,
    comment.resolved_at ? "resolved" : null,
    comment.agent_seen_at ? "seen" : null,
    comment.parent_id ? "reply" : null,
  ].filter(Boolean);
  const body = comment.body.replace(/\s+/g, " ").trim();
  return `${comment.created_at}  ${comment.id}  ${authorOf(comment)}` +
    `${marks.length > 0 ? `  [${marks.join(", ")}]` : ""}\n    ${body}`;
}

export async function cmdComments({ client, positionals, flags }) {
  const channel = assertChannel(requirePositional(positionals, 0, "channel", "comments"));
  const { body } = await client.request("GET", `/api/artifacts/${encodeURIComponent(channel)}/comments`, {
    query: { since: flags.since, to_agent: flags["to-agent"] === true ? "1" : undefined },
  });
  const comments = Array.isArray(body?.comments) ? body.comments : [];
  return Object.freeze({
    json: Object.freeze({ channel, comments }),
    lines: comments.length === 0 ? [`${channel}: no comments`] : comments.map(commentLine),
  });
}

export async function cmdReply({ client, positionals }) {
  const channel = assertChannel(requirePositional(positionals, 0, "channel", "reply"));
  const id = requirePositional(positionals, 1, "comment-id", "reply");
  const text = requirePositional(positionals, 2, "text", "reply");
  const { body } = await client.request("POST", `/api/comments/${encodeURIComponent(id)}/reply`, {
    body: JSON.stringify({ body: text }),
    contentType: JSON_CONTENT_TYPE,
  });
  return Object.freeze({
    json: Object.freeze({ channel, comment: body?.comment ?? null }),
    lines: [
      `replied to ${id} as ${body?.comment?.author ?? body?.comment?.author_display ?? "the agent"}` +
        ` (${body?.comment?.id ?? "?"})`,
    ],
  });
}

export async function cmdResolve({ client, positionals }) {
  const channel = assertChannel(requirePositional(positionals, 0, "channel", "resolve"));
  const id = requirePositional(positionals, 1, "comment-id", "resolve");
  const { body } = await client.request("POST", `/api/comments/${encodeURIComponent(id)}/resolve`);
  return Object.freeze({
    json: Object.freeze({ channel, comment: body?.comment ?? null }),
    lines: [`resolved ${id} at ${body?.comment?.resolved_at ?? "?"}`],
  });
}

export async function cmdSeen({ client, positionals }) {
  const channel = assertChannel(requirePositional(positionals, 0, "channel", "seen"));
  const id = requirePositional(positionals, 1, "comment-id", "seen");
  const { body } = await client.request("POST", `/api/comments/${encodeURIComponent(id)}/seen`);
  return Object.freeze({
    json: Object.freeze({ channel, comment: body?.comment ?? null }),
    lines: [`marked ${id} seen at ${body?.comment?.agent_seen_at ?? "?"}`],
  });
}
