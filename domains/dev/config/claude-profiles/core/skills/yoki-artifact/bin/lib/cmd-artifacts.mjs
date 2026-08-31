// cmd-artifacts.mjs — the artifact-level commands: list, versions, revoke,
// share, unshare, open. Each returns { json, lines }; printing is the
// dispatcher's job so --json behaves identically everywhere.

import { assertChannel, assertEmails, requirePositional } from "./validate.mjs";
import { openUrl } from "./open-url.mjs";

const JSON_CONTENT_TYPE = "application/json";

const channelArg = (positionals, command) =>
  assertChannel(requirePositional(positionals, 0, "channel", command));

export async function cmdList({ client }) {
  const { body } = await client.request("GET", "/api/artifacts");
  const artifacts = Array.isArray(body?.artifacts) ? body.artifacts : [];
  return Object.freeze({
    json: Object.freeze({ artifacts }),
    lines:
      artifacts.length === 0
        ? ["no artifacts yet"]
        : artifacts.map((artifact) => {
            const unread = artifact.unread_agent_comments ?? 0;
            const marks = [
              artifact.revoked ? "revoked" : null,
              unread > 0 ? `${unread} unread` : null,
            ].filter(Boolean);
            const columns = [
              artifact.channel,
              `v${artifact.latest_version}`,
              artifact.updated_at,
              marks.length > 0 ? `[${marks.join(", ")}]` : null,
              artifact.title,
            ].filter(Boolean);
            return columns.join("  ");
          }),
  });
}

export async function cmdVersions({ client, positionals }) {
  const channel = channelArg(positionals, "versions");
  const { body } = await client.request("GET", `/api/artifacts/${encodeURIComponent(channel)}/versions`);
  const versions = Array.isArray(body?.versions) ? body.versions : [];
  return Object.freeze({
    json: Object.freeze({ channel, versions }),
    lines:
      versions.length === 0
        ? [`${channel}: no versions`]
        : versions.map(
            (version) =>
              `v${version.version}  ${version.created_at}  ${version.bytes} bytes  ` +
              `${version.label ?? "-"}`,
          ),
  });
}

export async function cmdRevoke({ client, positionals }) {
  const channel = channelArg(positionals, "revoke");
  const { body } = await client.request("POST", `/api/artifacts/${encodeURIComponent(channel)}/revoke`);
  return Object.freeze({
    json: Object.freeze({ channel, revoked_at: body?.revoked_at ?? null, unchanged: body?.unchanged === true }),
    lines: [
      body?.unchanged === true
        ? `${channel} was already revoked at ${body?.revoked_at}`
        : `${channel} revoked at ${body?.revoked_at}`,
    ],
  });
}

async function changeViewers({ client, positionals, flags }, command, field) {
  const channel = channelArg(positionals, command);
  const emails = assertEmails(flags.to, command);
  const { body } = await client.request("POST", `/api/artifacts/${encodeURIComponent(channel)}/viewers`, {
    body: JSON.stringify({ [field]: emails }),
    contentType: JSON_CONTENT_TYPE,
  });
  const viewers = Array.isArray(body?.viewers) ? body.viewers : [];
  return Object.freeze({
    json: Object.freeze({ channel, viewers, [field]: emails }),
    lines: [
      `${channel}: ${field === "add" ? "shared with" : "unshared from"} ${emails.join(", ")}`,
      `viewers: ${viewers.length === 0 ? "(none)" : viewers.join(", ")}`,
    ],
  });
}

export const cmdShare = (context) => changeViewers(context, "share", "add");
export const cmdUnshare = (context) => changeViewers(context, "unshare", "remove");

export async function cmdOpen({ client, positionals }) {
  const channel = channelArg(positionals, "open");
  const url = client.viewerUrl(channel);
  openUrl(url);
  return Object.freeze({ json: Object.freeze({ channel, url }), lines: [url] });
}
