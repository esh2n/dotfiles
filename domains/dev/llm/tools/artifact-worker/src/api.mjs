// api.mjs — the artifact half of the JSON API (publish, list, versions,
// revoke, viewers). Comment endpoints live in comments.mjs.
//
// Handlers return plain objects; index.mjs turns them into responses. They
// throw `HttpError` for every refusal, so the shape `{ error, code }` is
// produced in exactly one place.

import { badRequest, readJsonBody, tooLarge } from "./http.mjs";
import { isOwner, requireOwner } from "./auth.mjs";
import { loadArtifactContext, loadOwnedArtifactContext } from "./access.mjs";
import { LIMITS, MAX_HTML_BYTES, assertChannel, cleanText, publishVersion } from "./store.mjs";

export const TITLE_HEADER = "x-yoki-title";
export const LABEL_HEADER = "x-yoki-label";
export const NOTE_HEADER = "x-yoki-note";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function serializeArtifact(row) {
  return {
    channel: row.channel,
    title: row.title,
    owner: row.owner,
    latest_version: row.latest_version,
    created_at: row.created_at,
    updated_at: row.updated_at,
    revoked: Boolean(row.revoked_at),
    revoked_at: row.revoked_at ?? null,
    ...(row.unread_agent_comments === undefined
      ? {}
      : { unread_agent_comments: Number(row.unread_agent_comments) || 0 }),
  };
}

export function serializeVersion(row) {
  return {
    version: row.version,
    sha256: row.sha256,
    bytes: row.bytes,
    label: row.label ?? null,
    note: row.note ?? null,
    created_at: row.created_at,
  };
}

/** Header values are latin-1 on the wire; the CLI percent-encodes non-ASCII. */
export function headerText(request, name, maxLength) {
  const raw = request.headers.get(name);
  if (raw === null) return null;
  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    // Not percent-encoded (a bare "%" is legal prose) — keep the raw value.
    decoded = raw;
  }
  return cleanText(decoded, maxLength);
}

export function normalizeEmail(value) {
  if (typeof value !== "string") {
    throw badRequest("bad_email", "Viewer entries must be email addresses.");
  }
  const email = value.trim().toLowerCase();
  if (email.length > LIMITS.email || !EMAIL_RE.test(email)) {
    throw badRequest("bad_email", `"${email.slice(0, 60)}" is not a valid email address.`);
  }
  return email;
}

function emailList(value, field) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw badRequest("bad_viewer_list", `"${field}" must be an array of email addresses.`);
  }
  if (value.length > 100) {
    throw badRequest("bad_viewer_list", `"${field}" accepts at most 100 addresses at a time.`);
  }
  return value.map(normalizeEmail);
}

function declaredLength(request) {
  const raw = request.headers.get("content-length");
  if (raw === null) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

// --- handlers -------------------------------------------------------------

export async function handlePublish({ request, url, params, identity, config, store, blobs, now = new Date() }) {
  requireOwner(identity, config);
  const channel = assertChannel(params.channel);

  const contentType = (request.headers.get("content-type") ?? "").toLowerCase();
  if (!contentType.startsWith("text/html")) {
    throw badRequest("bad_content_type", "Publish the artifact as text/html.", `content-type=${contentType}`);
  }
  const announced = declaredLength(request);
  if (announced !== null && announced > MAX_HTML_BYTES) {
    // Refuse before reading the body when the sender already told us the size.
    throw tooLarge("too_large", `Artifacts are limited to ${MAX_HTML_BYTES / (1024 * 1024)} MiB.`);
  }

  const html = new Uint8Array(await request.arrayBuffer());
  const result = await publishVersion({
    store,
    blobs,
    channel,
    html,
    title: headerText(request, TITLE_HEADER, LIMITS.title),
    label: headerText(request, LABEL_HEADER, LIMITS.label),
    note: headerText(request, NOTE_HEADER, LIMITS.note),
    owner: config.ownerEmail,
    now,
  });

  const viewUrl = new URL(`/a/${channel}?v=${result.version}`, url).toString();
  return {
    status: result.unchanged ? 200 : 201,
    body: {
      channel: result.channel,
      version: result.version,
      url: viewUrl,
      ...(result.unchanged ? { unchanged: true } : {}),
    },
  };
}

export async function handleListArtifacts({ identity, config, store }) {
  requireOwner(identity, config);
  const rows = await store.listArtifacts();
  return { artifacts: rows.map(serializeArtifact) };
}

export async function handleGetArtifact({ params, identity, config, store }) {
  const owner = isOwner(identity, config);
  const { channel, artifact, viewers } = await loadArtifactContext({
    store,
    config,
    identity,
    channel: params.channel,
    includeRevoked: owner,
  });
  const versions = await store.listVersions(channel);
  return {
    artifact: serializeArtifact(artifact),
    versions: versions.map(serializeVersion),
    // The viewer list is the owner's business only.
    viewers: owner ? [...viewers] : undefined,
  };
}

export async function handleListVersions({ params, identity, config, store }) {
  const { channel } = await loadArtifactContext({
    store,
    config,
    identity,
    channel: params.channel,
    includeRevoked: isOwner(identity, config),
  });
  const versions = await store.listVersions(channel);
  return { channel, versions: versions.map(serializeVersion) };
}

export async function handleRevoke({ params, identity, config, store, now = new Date() }) {
  const { channel, artifact } = await loadOwnedArtifactContext({ store, config, identity, channel: params.channel });
  if (artifact.revoked_at) {
    return { channel, revoked_at: artifact.revoked_at, unchanged: true };
  }
  const revokedAt = now.toISOString();
  await store.setRevokedAt(channel, revokedAt);
  return { channel, revoked_at: revokedAt };
}

export async function handleViewers({ request, params, identity, config, store, now = new Date() }) {
  const { channel } = await loadOwnedArtifactContext({ store, config, identity, channel: params.channel });
  const payload = await readJsonBody(request);
  const add = emailList(payload.add, "add");
  const remove = emailList(payload.remove, "remove");
  if (add.length === 0 && remove.length === 0) {
    throw badRequest("nothing_to_do", 'Provide "add" and/or "remove" as arrays of email addresses.');
  }
  const at = now.toISOString();
  for (const email of add) {
    await store.addViewer(channel, email, at);
  }
  for (const email of remove) {
    await store.removeViewer(channel, email);
  }
  const viewers = await store.listViewers(channel);
  return { channel, viewers, added: add, removed: remove };
}
