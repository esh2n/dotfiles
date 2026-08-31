// api-server.mjs — a local stand-in for the deployed Worker.
//
// It implements only the routes the CLI calls, with the same JSON shapes as
// worker/src/api.mjs and worker/src/comments.mjs, and it enforces the Access
// service-token headers so the tests prove the CLI actually sends them. It
// listens on 127.0.0.1 with an ephemeral port: no network leaves the machine.

import crypto from "node:crypto";
import http from "node:http";

export const CLIENT_ID = "test-client-id.access";
export const CLIENT_SECRET = "test-client-secret";

const json = (res, status, body) => {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(payload);
};

const sha256 = (text) => crypto.createHash("sha256").update(text).digest("hex");

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

/**
 * @param {{clientId?: string, clientSecret?: string, comments?: Array}} options
 */
export async function startApiServer(options = {}) {
  const clientId = options.clientId ?? CLIENT_ID;
  const clientSecret = options.clientSecret ?? CLIENT_SECRET;
  const artifacts = new Map(); // channel -> { title, versions: [] }
  const comments = new Map();
  for (const comment of options.comments ?? []) comments.set(comment.id, { ...comment });
  const requests = [];

  const server = http.createServer((req, res) => {
    handle(req, res).catch((cause) => json(res, 500, { error: String(cause), code: "internal" }));
  });

  async function handle(req, res) {
    const url = new URL(req.url, "http://127.0.0.1");
    const segments = url.pathname.split("/").filter(Boolean);
    requests.push({
      method: req.method,
      path: url.pathname,
      query: Object.fromEntries(url.searchParams),
      headers: req.headers,
    });

    if (
      req.headers["cf-access-client-id"] !== clientId ||
      req.headers["cf-access-client-secret"] !== clientSecret
    ) {
      return json(res, 403, { error: "invalid service token", code: "access_denied" });
    }

    // PUT /api/artifacts/:channel
    if (req.method === "PUT" && segments.length === 3 && segments[0] === "api" && segments[1] === "artifacts") {
      const channel = segments[2];
      const html = await readBody(req);
      const digest = sha256(html);
      const record = artifacts.get(channel) ?? { title: null, versions: [] };
      const latest = record.versions.at(-1);
      if (latest && latest.sha256 === digest) {
        return json(res, 200, {
          channel,
          version: latest.version,
          url: `/a/${channel}?v=${latest.version}`,
          unchanged: true,
        });
      }
      const version = record.versions.length + 1;
      const next = {
        ...record,
        title: req.headers["x-yoki-title"] ? decodeURIComponent(req.headers["x-yoki-title"]) : record.title,
        versions: [
          ...record.versions,
          {
            version,
            sha256: digest,
            bytes: Buffer.byteLength(html),
            label: req.headers["x-yoki-label"] ? decodeURIComponent(req.headers["x-yoki-label"]) : null,
            note: req.headers["x-yoki-note"] ? decodeURIComponent(req.headers["x-yoki-note"]) : null,
            created_at: new Date().toISOString(),
          },
        ],
      };
      artifacts.set(channel, next);
      return json(res, 201, { channel, version, url: `/a/${channel}?v=${version}` });
    }

    // GET /api/artifacts
    if (req.method === "GET" && segments.length === 2 && segments[1] === "artifacts") {
      return json(res, 200, {
        artifacts: [...artifacts.entries()].map(([channel, record]) => ({
          channel,
          title: record.title,
          owner: "owner@example.test",
          latest_version: record.versions.length,
          created_at: record.versions[0]?.created_at ?? null,
          updated_at: record.versions.at(-1)?.created_at ?? null,
          revoked: Boolean(record.revoked_at),
          revoked_at: record.revoked_at ?? null,
          unread_agent_comments: 0,
        })),
      });
    }

    // GET /api/artifacts/:channel/versions
    if (req.method === "GET" && segments.length === 4 && segments[3] === "versions") {
      const record = artifacts.get(segments[2]);
      if (!record) return json(res, 404, { error: "no such artifact", code: "no_such_artifact" });
      return json(res, 200, { channel: segments[2], versions: [...record.versions].reverse() });
    }

    // GET /api/artifacts/:channel/comments
    if (req.method === "GET" && segments.length === 4 && segments[3] === "comments") {
      const channel = segments[2];
      const since = url.searchParams.get("since");
      const toAgentOnly = url.searchParams.get("to_agent") === "1";
      const rows = [...comments.values()]
        .filter((comment) => comment.channel === channel)
        .filter((comment) => !toAgentOnly || comment.to_agent === true)
        .filter((comment) => since === null || comment.created_at > since);
      return json(res, 200, { channel, comments: rows });
    }

    // POST /api/artifacts/:channel/revoke | /viewers
    if (req.method === "POST" && segments.length === 4 && segments[1] === "artifacts") {
      const channel = segments[2];
      const record = artifacts.get(channel);
      if (!record) return json(res, 404, { error: "no such artifact", code: "no_such_artifact" });
      if (segments[3] === "revoke") {
        const revokedAt = new Date().toISOString();
        artifacts.set(channel, { ...record, revoked_at: revokedAt });
        return json(res, 200, { channel, revoked_at: revokedAt });
      }
      if (segments[3] === "viewers") {
        const payload = JSON.parse((await readBody(req)) || "{}");
        const current = new Set(record.viewers ?? []);
        for (const email of payload.add ?? []) current.add(email);
        for (const email of payload.remove ?? []) current.delete(email);
        artifacts.set(channel, { ...record, viewers: [...current] });
        return json(res, 200, { channel, viewers: [...current], added: payload.add ?? [], removed: payload.remove ?? [] });
      }
    }

    // POST /api/comments/:id/(reply|resolve|seen)
    if (req.method === "POST" && segments.length === 4 && segments[1] === "comments") {
      const comment = comments.get(segments[2]);
      if (!comment) return json(res, 404, { error: "no such comment", code: "no_such_comment" });
      const now = new Date().toISOString();
      if (segments[3] === "seen") {
        const updated = { ...comment, agent_seen_at: comment.agent_seen_at ?? now };
        comments.set(comment.id, updated);
        return json(res, 200, { comment: updated });
      }
      if (segments[3] === "resolve") {
        const updated = { ...comment, resolved_at: comment.resolved_at ?? now, resolved_by: "agent" };
        comments.set(comment.id, updated);
        return json(res, 200, { comment: updated });
      }
      if (segments[3] === "reply") {
        const payload = JSON.parse((await readBody(req)) || "{}");
        const reply = {
          id: `reply-${comments.size + 1}`,
          channel: comment.channel,
          version: comment.version,
          parent_id: comment.parent_id ?? comment.id,
          author: "agent via owner@example.test",
          body: payload.body,
          created_at: now,
          resolved_at: null,
          resolved_by: null,
          to_agent: false,
          agent_seen_at: null,
        };
        comments.set(reply.id, reply);
        return json(res, 200, { comment: reply });
      }
    }

    return json(res, 404, { error: "not found", code: "not_found" });
  }

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    requests,
    artifacts,
    comments,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

/** A comment row shaped like worker/src/comments.mjs serializeComment(). */
export function makeComment(overrides = {}) {
  return {
    id: "c1",
    channel: "demo",
    version: 1,
    parent_id: null,
    author: "reader@example.test",
    body: "please fix the heading",
    created_at: "2026-08-30T10:00:00.000Z",
    resolved_at: null,
    resolved_by: null,
    to_agent: true,
    agent_seen_at: null,
    ...overrides,
  };
}
