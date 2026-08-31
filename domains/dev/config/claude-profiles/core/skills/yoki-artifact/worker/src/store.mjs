// store.mjs — persistence, behind one narrow interface.
//
// Everything above this file talks to a `Store` (the tables) and a `Blobs`
// (the artifact HTML), never to D1 or R2 directly. `d1Store()` and
// `r2Blobs()` are the production implementations; the tests hand the same
// methods backed by Maps, so no SQL parsing fake is needed.
//
//   Store
//     getArtifact(channel)                  -> row | null
//     listArtifacts()                       -> row[]  (+ unread_agent_comments)
//     insertArtifact(row)                   -> void  (throws on duplicate)
//     updateArtifactHead({channel, title, latestVersion, updatedAt,
//                         expectedVersion})    -> boolean: sets head + clears
//                                              revoked_at, only while the head
//                                              still equals expectedVersion
//                                              (null = unconditional)
//     setRevokedAt(channel, revokedAt)      -> void
//     getVersion(channel, version)          -> row | null
//     listVersions(channel)                 -> row[]  (newest first)
//     insertVersion(row)                    -> void
//     listViewers(channel)                  -> string[]
//     addViewer(channel, email, addedAt)    -> void
//     removeViewer(channel, email)          -> void
//     insertComment(row)                    -> void
//     getComment(id)                        -> row | null
//     listComments({channel, since, toAgentOnly}) -> row[]  (oldest first)
//     resolveComment({id, resolvedAt, resolvedBy}) -> void
//     markCommentSeen({id, seenAt})         -> void
//
//   Blobs
//     put(key, bytes, meta) -> void
//     get(key)              -> { body, size } | null
//
// D1 access is always through bound parameters — no string interpolation.

import { badRequest, conflict, misconfigured, tooLarge } from "./http.mjs";

/** Channel names live in URLs and R2 keys, so keep them boring. */
export const CHANNEL_RE = /^[a-z0-9][a-z0-9-]{1,62}$/;
export const MAX_HTML_BYTES = 16 * 1024 * 1024;
export const HTML_CONTENT_TYPE = "text/html; charset=utf-8";

export const LIMITS = Object.freeze({
  title: 200,
  label: 60,
  note: 2000,
  email: 254,
});

export function isValidChannel(value) {
  return typeof value === "string" && CHANNEL_RE.test(value);
}

export function assertChannel(value) {
  if (!isValidChannel(value)) {
    throw badRequest(
      "invalid_channel",
      "Channel names must be 2-63 characters of lowercase letters, digits or hyphens, starting with a letter or digit.",
      `channel=${String(value).slice(0, 80)}`,
    );
  }
  return value;
}

export function objectKey(channel, version) {
  return `a/${channel}/${version}.html`;
}

export async function sha256Hex(bytes) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Strip control characters and clamp — header-sourced text is untrusted. */
export function cleanText(value, maxLength) {
  if (typeof value !== "string") return null;
  const stripped = value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  if (stripped === "") return null;
  return stripped.slice(0, maxLength);
}

// --- D1 -------------------------------------------------------------------

const ARTIFACT_COLUMNS = "channel, title, owner, latest_version, created_at, updated_at, revoked_at";

export function d1Store(db) {
  if (!db || typeof db.prepare !== "function") {
    throw misconfigured("Storage is unavailable.", "DB binding missing or not a D1Database");
  }
  const all = async (stmt) => {
    const result = await stmt.all();
    return Array.isArray(result?.results) ? result.results : [];
  };
  return Object.freeze({
    async getArtifact(channel) {
      return await db.prepare(`SELECT ${ARTIFACT_COLUMNS} FROM artifacts WHERE channel = ?`).bind(channel).first();
    },
    async listArtifacts() {
      return await all(
        db.prepare(
          `SELECT a.channel, a.title, a.owner, a.latest_version, a.created_at, a.updated_at, a.revoked_at,
                  (SELECT COUNT(*) FROM comments c
                    WHERE c.channel = a.channel AND c.to_agent = 1 AND c.agent_seen_at IS NULL)
                  AS unread_agent_comments
             FROM artifacts a
            ORDER BY a.updated_at DESC`,
        ),
      );
    },
    async insertArtifact(row) {
      await db
        .prepare(
          `INSERT INTO artifacts (channel, title, owner, latest_version, created_at, updated_at, revoked_at)
           VALUES (?, ?, ?, ?, ?, ?, NULL)`,
        )
        .bind(row.channel, row.title, row.owner, row.latest_version, row.created_at, row.updated_at)
        .run();
    },
    // `expectedVersion` makes this a compare-and-swap: the UPDATE only lands
    // while the head still holds the version the caller read. That single
    // statement is what serializes two concurrent publishes to one channel —
    // D1 has no interactive transaction to wrap the read and the write in.
    // Returns whether a row actually moved.
    async updateArtifactHead({ channel, title, latestVersion, updatedAt, expectedVersion = null }) {
      const result = await db
        .prepare(
          `UPDATE artifacts
              SET title = ?, latest_version = ?, updated_at = ?, revoked_at = NULL
            WHERE channel = ? AND (? IS NULL OR latest_version = ?)`,
        )
        .bind(title, latestVersion, updatedAt, channel, expectedVersion, expectedVersion)
        .run();
      return (result?.meta?.changes ?? 1) > 0;
    },
    async setRevokedAt(channel, revokedAt) {
      await db
        .prepare("UPDATE artifacts SET revoked_at = ?, updated_at = ? WHERE channel = ?")
        .bind(revokedAt, revokedAt, channel)
        .run();
    },
    async getVersion(channel, version) {
      return await db
        .prepare("SELECT channel, version, sha256, bytes, label, note, created_at FROM versions WHERE channel = ? AND version = ?")
        .bind(channel, version)
        .first();
    },
    async listVersions(channel) {
      return await all(
        db
          .prepare(
            "SELECT channel, version, sha256, bytes, label, note, created_at FROM versions WHERE channel = ? ORDER BY version DESC",
          )
          .bind(channel),
      );
    },
    async insertVersion(row) {
      await db
        .prepare(
          `INSERT INTO versions (channel, version, sha256, bytes, label, note, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(row.channel, row.version, row.sha256, row.bytes, row.label, row.note, row.created_at)
        .run();
    },
    async listViewers(channel) {
      const rows = await all(db.prepare("SELECT email FROM viewers WHERE channel = ? ORDER BY email").bind(channel));
      return rows.map((row) => row.email);
    },
    async addViewer(channel, email, addedAt) {
      await db
        .prepare("INSERT OR IGNORE INTO viewers (channel, email, added_at) VALUES (?, ?, ?)")
        .bind(channel, email, addedAt)
        .run();
    },
    async removeViewer(channel, email) {
      await db.prepare("DELETE FROM viewers WHERE channel = ? AND email = ?").bind(channel, email).run();
    },
    async insertComment(row) {
      await db
        .prepare(
          `INSERT INTO comments (id, channel, version, parent_id, author, body, created_at, resolved_at, resolved_by, to_agent, agent_seen_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, NULL)`,
        )
        .bind(row.id, row.channel, row.version, row.parent_id, row.author, row.body, row.created_at, row.to_agent)
        .run();
    },
    async getComment(id) {
      return await db.prepare("SELECT * FROM comments WHERE id = ?").bind(id).first();
    },
    async listComments({ channel, since = null, toAgentOnly = false }) {
      return await all(
        db
          .prepare(
            `SELECT * FROM comments
              WHERE channel = ?
                AND (? IS NULL OR created_at > ?)
                AND (? = 0 OR to_agent = 1)
              ORDER BY created_at ASC, id ASC`,
          )
          .bind(channel, since, since, toAgentOnly ? 1 : 0),
      );
    },
    async resolveComment({ id, resolvedAt, resolvedBy }) {
      await db
        .prepare("UPDATE comments SET resolved_at = ?, resolved_by = ? WHERE id = ?")
        .bind(resolvedAt, resolvedBy, id)
        .run();
    },
    async markCommentSeen({ id, seenAt }) {
      await db.prepare("UPDATE comments SET agent_seen_at = ? WHERE id = ?").bind(seenAt, id).run();
    },
  });
}

// --- R2 -------------------------------------------------------------------

export function r2Blobs(bucket) {
  if (!bucket || typeof bucket.put !== "function") {
    throw misconfigured("Storage is unavailable.", "R2 binding missing or not an R2Bucket");
  }
  return Object.freeze({
    async put(key, bytes, meta = {}) {
      await bucket.put(key, bytes, {
        httpMetadata: { contentType: HTML_CONTENT_TYPE },
        customMetadata: { ...meta },
      });
    },
    async get(key) {
      const object = await bucket.get(key);
      if (!object) return null;
      return { body: object.body, size: object.size };
    },
  });
}

// --- publishing -----------------------------------------------------------

/**
 * Store one HTML payload as the next version of a channel.
 *
 * Identical bytes never create a version: the sha256 of the current head is
 * compared first, and a match returns `{ unchanged: true }` with the existing
 * version number. Publishing always clears `revoked_at` — re-publishing is how
 * a revoked channel comes back.
 */
export async function publishVersion({ store, blobs, channel, html, title, label, note, owner, now = new Date() }) {
  assertChannel(channel);
  const bytes = html instanceof Uint8Array ? html : new TextEncoder().encode(String(html ?? ""));
  if (bytes.byteLength === 0) {
    throw badRequest("empty_body", "The request body was empty; send the artifact HTML as the body.");
  }
  if (bytes.byteLength > MAX_HTML_BYTES) {
    throw tooLarge(
      "too_large",
      `Artifacts are limited to ${MAX_HTML_BYTES / (1024 * 1024)} MiB; this one is ${(bytes.byteLength / (1024 * 1024)).toFixed(1)} MiB.`,
    );
  }

  const sha = await sha256Hex(bytes);
  const at = now.toISOString();
  const existing = await store.getArtifact(channel);
  const cleanTitle = cleanText(title, LIMITS.title);

  if (existing && existing.latest_version > 0) {
    const head = await store.getVersion(channel, existing.latest_version);
    if (head && head.sha256 === sha) {
      // Same bytes: keep the version, but honour the title and un-revoke.
      await store.updateArtifactHead({
        channel,
        title: cleanTitle ?? existing.title,
        latestVersion: existing.latest_version,
        updatedAt: at,
      });
      return Object.freeze({ channel, version: existing.latest_version, unchanged: true, sha256: sha, bytes: bytes.byteLength });
    }
  }

  // Claim the version number before writing anything under it. Two publishes
  // racing on one channel both read the same `latest_version`, so the claim —
  // a conditional UPDATE, or the artifacts primary key for a brand-new
  // channel — is what decides which one owns `version`. The loser is told so
  // (409) instead of overwriting the winner's R2 object with bytes the
  // surviving versions row does not describe.
  const version = existing ? existing.latest_version + 1 : 1;
  if (existing) {
    const claimed = await store.updateArtifactHead({
      channel,
      title: cleanTitle ?? existing.title,
      latestVersion: version,
      updatedAt: at,
      expectedVersion: existing.latest_version,
    });
    if (!claimed) throw versionConflict(channel, version);
  } else {
    try {
      await store.insertArtifact({
        channel,
        title: cleanTitle ?? channel,
        owner,
        latest_version: version,
        created_at: at,
        updated_at: at,
      });
    } catch {
      throw versionConflict(channel, version);
    }
  }

  await blobs.put(objectKey(channel, version), bytes, { sha256: sha });
  await store.insertVersion({
    channel,
    version,
    sha256: sha,
    bytes: bytes.byteLength,
    label: cleanText(label, LIMITS.label),
    note: cleanText(note, LIMITS.note),
    created_at: at,
  });
  return Object.freeze({ channel, version, unchanged: false, sha256: sha, bytes: bytes.byteLength });
}

function versionConflict(channel, version) {
  return conflict(
    "version_conflict",
    "Another publish to this artifact landed first; re-read the current version and publish again.",
    `channel=${channel} version=${version}`,
  );
}
