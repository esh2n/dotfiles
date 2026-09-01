// cmd-artifacts.mjs — the artifact-level commands: list, versions, revoke,
// share, unshare, open. Each returns { json, lines }; printing is the
// dispatcher's job so --json behaves identically everywhere.

import { assertChannel, assertEmails, requirePositional } from "./validate.mjs";
import { openUrl } from "./open-url.mjs";
import { EXIT } from "./errors.mjs";
import {
  VIEWERS_GROUP_NAME,
  manualAccessGroupSteps,
  resolveAccessGroupTarget,
  syncAccessGroup,
} from "./access-group.mjs";

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

/**
 * `share` / `unshare` — the ONE entry point for viewer access.
 *
 * Two lists have to agree or the result is a lie: the D1 rows the Worker
 * checks, and the Cloudflare Access group the edge checks. This updates D1
 * first (that is the authoritative record and the call has not changed), then
 * the Access group.
 *
 * When the Access half cannot be done — no API token, no account, no group id,
 * or Cloudflare refused — the command exits 2 and prints the exact manual step.
 * It never reports plain success for a half-applied change.
 */
async function changeViewers(
  { client, positionals, flags, config = null, env = process.env, fetchImpl = fetch },
  command,
  field,
) {
  const channel = channelArg(positionals, command);
  const emails = assertEmails(flags.to, command);
  const { body } = await client.request("POST", `/api/artifacts/${encodeURIComponent(channel)}/viewers`, {
    body: JSON.stringify({ [field]: emails }),
    contentType: JSON_CONTENT_TYPE,
  });
  const viewers = Array.isArray(body?.viewers) ? body.viewers : [];
  const head = [
    `${channel}: ${field === "add" ? "shared with" : "unshared from"} ${emails.join(", ")}`,
    `viewers: ${viewers.length === 0 ? "(none)" : viewers.join(", ")}`,
  ];
  const base = { channel, viewers, [field]: emails };
  const configFile = config?.file ?? "~/.config/yoki-artifact/config.json";

  const refuse = ({ missing = [], cause = null, accountId = null }) => {
    const steps = manualAccessGroupSteps({
      command,
      channel,
      emails: [...emails],
      configFile,
      accountId,
      missing,
      cause,
    });
    return Object.freeze({
      exitCode: EXIT.network,
      json: Object.freeze({
        ...base,
        access_group: Object.freeze({ updated: false, missing: Object.freeze([...missing]), error: cause }),
        manual_steps: Object.freeze(steps.filter((line) => line !== "")),
      }),
      lines: [...head, ...steps],
    });
  };

  const target = resolveAccessGroupTarget({ env, config });
  if (!target.ok) return refuse({ missing: [...target.missing], accountId: target.accountId });

  let group;
  try {
    group = await syncAccessGroup({
      apiToken: target.apiToken,
      accountId: target.accountId,
      groupId: target.groupId,
      add: field === "add" ? emails : [],
      remove: field === "remove" ? emails : [],
      fetchImpl,
    });
  } catch (cause) {
    return refuse({ cause: cause?.message ?? String(cause), accountId: target.accountId });
  }

  return Object.freeze({
    json: Object.freeze({
      ...base,
      access_group: Object.freeze({
        updated: true,
        id: target.groupId,
        unchanged: group.unchanged,
        emails: group.emails,
      }),
    }),
    lines: [
      ...head,
      `Access group ${VIEWERS_GROUP_NAME}: ${group.unchanged ? "already in sync" : "updated"} ` +
        `(${group.emails.length === 0 ? "no emails" : group.emails.join(", ")})`,
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
