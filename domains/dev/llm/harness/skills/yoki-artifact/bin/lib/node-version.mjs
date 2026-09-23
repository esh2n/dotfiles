// node-version.mjs — the Node floor, as pure functions so a test can check the
// guard without spawning an old Node (mirrors ui-capture's capture.mjs guard).
//
// 22 is the floor this skill targets: it is the active LTS, and it is what the
// zero-dependency design assumes is present (global fetch, node:test, the
// stdlib the CLI uses instead of packages). Checking it here turns "runs under
// whatever Node mise selected for this repo" into one clear message at the
// door, rather than a failure deep inside a request.

export const MIN_NODE_MAJOR = 22;

export function nodeMajorVersion(version) {
  const match = /^v?(\d+)\./.exec(String(version ?? ""));
  return match ? Number(match[1]) : null;
}

export function nodeVersionOk(version) {
  const major = nodeMajorVersion(version);
  return major !== null && major >= MIN_NODE_MAJOR;
}

export function nodeVersionGuardMessage(version) {
  return [
    `yoki-artifact needs Node >= ${MIN_NODE_MAJOR} (running ${version}).`,
    "Set YOKI_ARTIFACT_NODE to a newer node binary, or run it from a shell",
    "whose PATH has one.",
  ].join("\n");
}
