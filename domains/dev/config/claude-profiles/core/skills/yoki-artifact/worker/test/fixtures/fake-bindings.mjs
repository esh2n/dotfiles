// In-memory stand-ins for the Store and Blobs interfaces documented at the top
// of src/store.mjs. They exist so the handler tests never need D1 or R2 (and
// never need a SQL parser); d1Store()/r2Blobs() are exercised against the real
// bindings by the `wrangler dev --local` integration run, not here.

const versionKey = (channel, version) => `${channel}#${version}`;
const copy = (row) => (row ? { ...row } : null);

export function fakeStore(seed = {}) {
  const artifacts = new Map((seed.artifacts ?? []).map((row) => [row.channel, { ...row }]));
  const versions = new Map((seed.versions ?? []).map((row) => [versionKey(row.channel, row.version), { ...row }]));
  const viewers = new Map(Object.entries(seed.viewers ?? {}).map(([channel, list]) => [channel, [...list]]));
  const comments = new Map((seed.comments ?? []).map((row) => [row.id, { ...row }]));

  return {
    // exposed for assertions only
    _artifacts: artifacts,
    _versions: versions,
    _viewers: viewers,
    _comments: comments,

    async getArtifact(channel) {
      return copy(artifacts.get(channel));
    },
    async listArtifacts() {
      return [...artifacts.values()]
        .map((row) => ({
          ...row,
          unread_agent_comments: [...comments.values()].filter(
            (comment) => comment.channel === row.channel && comment.to_agent === 1 && !comment.agent_seen_at,
          ).length,
        }))
        .sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
    },
    async insertArtifact(row) {
      if (artifacts.has(row.channel)) throw new Error(`duplicate artifact ${row.channel}`);
      artifacts.set(row.channel, { revoked_at: null, ...row });
    },
    // Mirrors the D1 compare-and-swap: with `expectedVersion` set, the head
    // only moves while it still holds that version, and the return value says
    // whether it did.
    async updateArtifactHead({ channel, title, latestVersion, updatedAt, expectedVersion = null }) {
      const current = artifacts.get(channel);
      if (!current) throw new Error(`no artifact ${channel}`);
      if (expectedVersion !== null && current.latest_version !== expectedVersion) return false;
      artifacts.set(channel, {
        ...current,
        title,
        latest_version: latestVersion,
        updated_at: updatedAt,
        revoked_at: null,
      });
      return true;
    },
    async setRevokedAt(channel, revokedAt) {
      const current = artifacts.get(channel);
      if (!current) throw new Error(`no artifact ${channel}`);
      artifacts.set(channel, { ...current, revoked_at: revokedAt, updated_at: revokedAt });
    },
    async getVersion(channel, version) {
      return copy(versions.get(versionKey(channel, version)));
    },
    async listVersions(channel) {
      return [...versions.values()]
        .filter((row) => row.channel === channel)
        .sort((a, b) => b.version - a.version)
        .map((row) => ({ ...row }));
    },
    async insertVersion(row) {
      versions.set(versionKey(row.channel, row.version), { ...row });
    },
    async listViewers(channel) {
      return [...(viewers.get(channel) ?? [])].sort();
    },
    async addViewer(channel, email) {
      const current = viewers.get(channel) ?? [];
      if (!current.includes(email)) viewers.set(channel, [...current, email]);
    },
    async removeViewer(channel, email) {
      viewers.set(channel, (viewers.get(channel) ?? []).filter((entry) => entry !== email));
    },
    async insertComment(row) {
      comments.set(row.id, {
        resolved_at: null,
        resolved_by: null,
        agent_seen_at: null,
        parent_id: null,
        ...row,
      });
    },
    async getComment(id) {
      return copy(comments.get(id));
    },
    async listComments({ channel, since = null, toAgentOnly = false }) {
      return [...comments.values()]
        .filter((row) => row.channel === channel)
        .filter((row) => since === null || String(row.created_at) > since)
        .filter((row) => !toAgentOnly || row.to_agent === 1)
        .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)) || a.id.localeCompare(b.id))
        .map((row) => ({ ...row }));
    },
    async resolveComment({ id, resolvedAt, resolvedBy }) {
      const current = comments.get(id);
      if (!current) throw new Error(`no comment ${id}`);
      comments.set(id, { ...current, resolved_at: resolvedAt, resolved_by: resolvedBy });
    },
    async markCommentSeen({ id, seenAt }) {
      const current = comments.get(id);
      if (!current) throw new Error(`no comment ${id}`);
      comments.set(id, { ...current, agent_seen_at: seenAt });
    },
  };
}

export function fakeBlobs(seed = {}) {
  const objects = new Map(Object.entries(seed).map(([key, value]) => [key, { bytes: value, meta: {} }]));
  return {
    _objects: objects,
    async put(key, bytes, meta = {}) {
      objects.set(key, { bytes, meta: { ...meta } });
    },
    async get(key) {
      const object = objects.get(key);
      if (!object) return null;
      const bytes = typeof object.bytes === "string" ? new TextEncoder().encode(object.bytes) : object.bytes;
      return { body: bytes, size: bytes.byteLength };
    },
  };
}
