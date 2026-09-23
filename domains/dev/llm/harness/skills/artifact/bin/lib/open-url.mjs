// open-url.mjs — hand a URL to the desktop.
//
// macOS only, on purpose: this skill's `open` is a convenience for the machine
// the agent runs on, and guessing at xdg-open elsewhere would fail in a way
// that reads like a bug. The child is spawned with shell=false and detached so
// the CLI can exit immediately.

import { spawn } from "node:child_process";

import { usageError } from "./errors.mjs";

export const OPEN_COMMAND = "open";

export function openUrl(url, { platform = process.platform, spawnImpl = spawn } = {}) {
  if (platform !== "darwin") {
    throw usageError("open_unsupported", `Opening a URL is macOS-only; open it yourself: ${url}`);
  }
  const child = spawnImpl(OPEN_COMMAND, [url], { shell: false, stdio: "ignore", detached: true });
  child.unref?.();
  return url;
}
