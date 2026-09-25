// shell.mjs — `/` and `/a/:channel` both return public/viewer.html; viewer.js
// picks the view from the path and fills it from the API. The shell is fetched
// through the ASSETS binding rather than served by the asset router directly,
// so it can carry the viewer CSP and the no-store headers.

import { BASE_HEADERS, HttpError, VIEWER_CSP, misconfigured } from "./http.mjs";
import { HTML_CONTENT_TYPE, assertChannel } from "./store.mjs";

const SHELL_ASSET = "/viewer.html";

export function shellHeaders() {
  return {
    ...BASE_HEADERS,
    "content-type": HTML_CONTENT_TYPE,
    "content-security-policy": VIEWER_CSP,
    "cross-origin-opener-policy": "same-origin",
  };
}

export async function serveShell({ url, env, params }) {
  if (params.channel !== undefined) assertChannel(params.channel);
  if (!env?.ASSETS || typeof env.ASSETS.fetch !== "function") {
    throw misconfigured("The viewer could not be loaded.", "ASSETS binding missing");
  }
  const asset = await env.ASSETS.fetch(new Request(new URL(SHELL_ASSET, url), { headers: { accept: "text/html" } }));
  if (!asset.ok) {
    throw new HttpError(500, "shell_missing", "The viewer could not be loaded.", `ASSETS returned ${asset.status}`);
  }
  return new Response(asset.body, { status: 200, headers: shellHeaders() });
}
