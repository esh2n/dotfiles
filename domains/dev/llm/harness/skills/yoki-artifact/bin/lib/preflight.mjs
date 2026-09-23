// preflight.mjs — everything `publish` checks before it opens a socket.
//
// Order matters and is deliberate: cheap structural checks first (exists,
// single file, size), then the content gates, so a 40 MiB file is refused
// without being scanned and a page with a leaked key is refused without being
// uploaded. Nothing here performs I/O against the network.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { externalError, secretError, sizeError, usageError } from "./errors.mjs";
import { scanExternalRefs, scanSecrets } from "./scan.mjs";

export const MAX_HTML_BYTES = 16 * 1024 * 1024;
export const HTML_EXTENSIONS = Object.freeze([".html", ".htm"]);
/** writeup-kit pages are recognisable by their role-named component classes. */
export const WRITEUP_KIT_MARKER = 'class="wu-';
export const SELF_CHECK_TIMEOUT_MS = 120_000;

export function selfCheckPath(env = process.env) {
  if (env.YOKI_ARTIFACT_SELF_CHECK?.trim()) return env.YOKI_ARTIFACT_SELF_CHECK.trim();
  return path.join(env.HOME ?? "", ".claude", "skills", "writeup-kit", "bin", "self-check.mjs");
}

export function looksLikeWriteupKit(html) {
  return html.includes(WRITEUP_KIT_MARKER);
}

function statFile(file) {
  let stats;
  try {
    stats = fs.statSync(file);
  } catch (cause) {
    if (cause?.code === "ENOENT") {
      throw usageError("no_such_file", `No such file: ${file}`);
    }
    throw usageError("unreadable_file", `Cannot read ${file}.`, String(cause));
  }
  if (stats.isDirectory()) {
    throw usageError("not_a_file", `${file} is a directory — publish a single HTML file.`);
  }
  if (!stats.isFile()) {
    throw usageError("not_a_file", `${file} is not a regular file — publish a single HTML file.`);
  }
  return stats;
}

function assertHtmlName(file) {
  const ext = path.extname(file).toLowerCase();
  if (!HTML_EXTENSIONS.includes(ext)) {
    throw usageError(
      "not_html",
      `${file} is not an HTML file (expected one of ${HTML_EXTENSIONS.join(", ")}).`,
    );
  }
}

function runSelfCheck(script, file) {
  const result = spawnSync(process.execPath, [script, file], {
    encoding: "utf8",
    timeout: SELF_CHECK_TIMEOUT_MS,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error) {
    throw usageError("self_check_failed", `Could not run writeup-kit self-check: ${script}`, String(result.error));
  }
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
  if (result.status !== 0) {
    throw usageError(
      "self_check_failed",
      `writeup-kit self-check failed (exit ${result.status}). Fix the page, then publish again.`,
      output,
    );
  }
  return Object.freeze({ ran: true, script, output });
}

/**
 * @returns {{file: string, bytes: number, html: string, selfCheck: object|null,
 *            warnings: ReadonlyArray<string>}}
 */
export function preflightPublish({ file, allowExternal = false, env = process.env } = {}) {
  if (typeof file !== "string" || file.trim() === "") {
    throw usageError("no_file", "publish needs a path to an HTML file.");
  }
  const resolved = path.resolve(file);
  const stats = statFile(resolved);
  assertHtmlName(resolved);

  if (stats.size > MAX_HTML_BYTES) {
    throw sizeError(
      "too_large",
      `${resolved} is ${(stats.size / (1024 * 1024)).toFixed(1)} MiB; the limit is ${MAX_HTML_BYTES / (1024 * 1024)} MiB.`,
    );
  }

  const html = fs.readFileSync(resolved, "utf8");

  const secrets = scanSecrets(html);
  if (secrets.length > 0) {
    const where = secrets.map((f) => `line ${f.line}: ${f.label}`).join("; ");
    throw secretError(
      "secret_found",
      `Refusing to publish: ${resolved} looks like it contains a credential (${where}). Remove it, then publish again.`,
    );
  }

  const external = scanExternalRefs(html);
  const warnings = [];
  if (external.length > 0) {
    const where = external.map((f) => `line ${f.line}: ${f.url}`).join("; ");
    if (!allowExternal) {
      throw externalError(
        "external_refs",
        `Refusing to publish: ${resolved} references hosts outside the artifact CSP allowlist (${where}). ` +
          "They would be blocked in the viewer. Inline them, or pass --allow-external.",
      );
    }
    warnings.push(`external references will be blocked by the viewer CSP (${where})`);
  }

  let selfCheck = null;
  const script = selfCheckPath(env);
  if (looksLikeWriteupKit(html) && script && fs.existsSync(script)) {
    selfCheck = runSelfCheck(script, resolved);
  }

  return Object.freeze({
    file: resolved,
    bytes: Buffer.byteLength(html),
    html,
    selfCheck,
    external,
    warnings: Object.freeze(warnings),
  });
}
