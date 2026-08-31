// access.mjs — resolve a channel to { artifact, viewers } and decide, once,
// whether this identity may see it at all. Every handler that names a channel
// goes through here so the "revoked looks like it never existed" rule and the
// viewer list are enforced in exactly one place.

import { forbidden, notFound } from "./http.mjs";
import { canRead, requireOwner } from "./auth.mjs";
import { assertChannel } from "./store.mjs";

/**
 * @param includeRevoked  true when the caller has already established the
 *                        right to see a revoked channel (owner + explicit ask).
 */
export async function loadArtifactContext({ store, config, identity, channel, includeRevoked = false }) {
  const name = assertChannel(channel);
  const artifact = await store.getArtifact(name);
  if (!artifact) {
    throw notFound("no_such_artifact", "That artifact does not exist.");
  }
  const viewers = await store.listViewers(name);
  const readable = canRead(identity, { ownerEmail: config.ownerEmail, viewers });
  if (!readable) {
    throw forbidden("not_a_viewer", "You do not have access to this artifact.");
  }
  if (artifact.revoked_at && !includeRevoked) {
    // Revoked is a 404 even for readers: the link is meant to be dead.
    throw notFound("no_such_artifact", "That artifact does not exist.");
  }
  return Object.freeze({ channel: name, artifact: Object.freeze({ ...artifact }), viewers: Object.freeze([...viewers]) });
}

/** Owner-only variant used by the write endpoints. */
export async function loadOwnedArtifactContext({ store, config, identity, channel }) {
  requireOwner(identity, config.ownerEmail);
  return await loadArtifactContext({ store, config, identity, channel, includeRevoked: true });
}
