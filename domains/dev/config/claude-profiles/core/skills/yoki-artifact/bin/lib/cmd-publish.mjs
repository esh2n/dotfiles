// cmd-publish.mjs — `publish`: preflight, PUT, then say where it landed.
//
// Preflight runs first and unconditionally; the client is only reached once
// every gate has passed, so a refused publish costs no network call and leaks
// no bytes.

import { assertChannel, requirePositional } from "./validate.mjs";
import { LABEL_HEADER, NOTE_HEADER, TITLE_HEADER, encodeHeaderText } from "./client.mjs";
import { openUrl } from "./open-url.mjs";
import { preflightPublish } from "./preflight.mjs";

const HTML_CONTENT_TYPE = "text/html; charset=utf-8";

function textHeaders(flags) {
  const entries = [
    [TITLE_HEADER, encodeHeaderText(flags.title)],
    [LABEL_HEADER, encodeHeaderText(flags.label)],
    [NOTE_HEADER, encodeHeaderText(flags.note)],
  ].filter(([, value]) => value !== null);
  return Object.fromEntries(entries);
}

export async function cmdPublish({ client, flags, positionals, env }) {
  const file = requirePositional(positionals, 0, "file.html", "publish");
  const channel = assertChannel(flags.channel, { flag: true });

  const checked = preflightPublish({
    file,
    allowExternal: flags["allow-external"] === true,
    env,
  });

  const response = await client.request("PUT", `/api/artifacts/${encodeURIComponent(channel)}`, {
    body: checked.html,
    contentType: HTML_CONTENT_TYPE,
    headers: textHeaders(flags),
  });

  const viewerUrl = client.viewerUrl(channel);
  const unchanged = response.body?.unchanged === true;
  if (flags.open === true) openUrl(viewerUrl);

  return Object.freeze({
    json: Object.freeze({
      channel,
      version: response.body?.version ?? null,
      url: viewerUrl,
      version_url: response.body?.url ?? null,
      bytes: checked.bytes,
      unchanged,
      self_check: checked.selfCheck === null ? null : "passed",
      warnings: checked.warnings,
    }),
    lines: [
      ...checked.warnings.map((warning) => `warning: ${warning}`),
      unchanged
        ? `unchanged — already published as version ${response.body?.version}`
        : `published version ${response.body?.version} (${checked.bytes} bytes)`,
      viewerUrl,
    ],
  });
}
