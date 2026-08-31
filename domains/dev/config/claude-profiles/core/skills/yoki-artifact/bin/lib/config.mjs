// config.mjs — where the base URL, the client id and the client secret come
// from, and in what order.
//
// Precedence, per field: environment wins over the config file. The secret is
// the one field that is never read from the config file at all — it comes from
// $YOKI_ARTIFACT_CLIENT_SECRET or from running `secretCommand` (a keychain /
// 1Password read), so a plaintext service-token secret never lands on disk.
// Nothing in this module logs or returns the secret in a diagnostic string.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { usageError } from "./errors.mjs";
import { tokenizeCommand } from "./tokenize.mjs";

export const CONFIG_DIR_NAME = "yoki-artifact";
export const CONFIG_FILE_NAME = "config.json";
export const SECRET_COMMAND_TIMEOUT_MS = 20_000;
export const SECRET_MAX_BYTES = 8 * 1024;

/** Honours XDG_CONFIG_HOME so a test (and a non-default machine) can relocate it. */
export function configPath(env = process.env) {
  const base = env.XDG_CONFIG_HOME?.trim()
    ? env.XDG_CONFIG_HOME
    : path.join(env.HOME ?? "", ".config");
  return path.join(base, CONFIG_DIR_NAME, CONFIG_FILE_NAME);
}

function readConfigFile(file) {
  let raw;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch (cause) {
    if (cause?.code === "ENOENT") return null;
    throw usageError("config_unreadable", `Cannot read ${file}.`, String(cause));
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (cause) {
    throw usageError("config_invalid", `${file} is not valid JSON.`, String(cause));
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw usageError("config_invalid", `${file} must contain a JSON object.`);
  }
  return parsed;
}

function stringField(value, field, file) {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || value.trim() === "") {
    throw usageError("config_invalid", `"${field}" in ${file} must be a non-empty string.`);
  }
  return value.trim();
}

function normalizeBaseUrl(value, source) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw usageError("bad_base_url", `${source} is not a valid URL: ${value}`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw usageError("bad_base_url", `${source} must be an http(s) URL: ${value}`);
  }
  return url.origin + url.pathname.replace(/\/+$/, "");
}

/**
 * Resolve configuration without touching the network or the secret store.
 * Missing required fields fail here — at startup — rather than at request time.
 *
 * @returns {{baseUrl: string, clientId: string, secretCommand: string|null,
 *            file: string, fileExists: boolean, sources: object}}
 */
export function loadConfig(env = process.env) {
  const file = configPath(env);
  const fromFile = readConfigFile(file) ?? {};
  const fileExists = Object.keys(fromFile).length > 0 || fs.existsSync(file);

  const envUrl = env.YOKI_ARTIFACT_URL?.trim();
  const envClientId = env.YOKI_ARTIFACT_CLIENT_ID?.trim();
  const fileUrl = stringField(fromFile.baseUrl, "baseUrl", file);
  const fileClientId = stringField(fromFile.clientId, "clientId", file);
  const secretCommand = stringField(fromFile.secretCommand, "secretCommand", file);

  const rawBaseUrl = envUrl || fileUrl;
  if (!rawBaseUrl) {
    throw usageError(
      "no_base_url",
      `No base URL. Set YOKI_ARTIFACT_URL or "baseUrl" in ${file}.`,
    );
  }
  const clientId = envClientId || fileClientId;
  if (!clientId) {
    throw usageError(
      "no_client_id",
      `No Access client id. Set YOKI_ARTIFACT_CLIENT_ID or "clientId" in ${file}.`,
    );
  }

  return Object.freeze({
    baseUrl: normalizeBaseUrl(rawBaseUrl, envUrl ? "YOKI_ARTIFACT_URL" : `"baseUrl" in ${file}`),
    clientId,
    secretCommand,
    file,
    fileExists,
    sources: Object.freeze({
      baseUrl: envUrl ? "env" : "file",
      clientId: envClientId ? "env" : "file",
    }),
  });
}

/** Run `secretCommand` with shell=false and take its stdout as the secret. */
function runSecretCommand(command, env) {
  const argv = tokenizeCommand(command);
  if (argv.length === 0) {
    throw usageError("bad_secret_command", "`secretCommand` is empty.");
  }
  let stdout;
  try {
    stdout = execFileSync(argv[0], argv.slice(1), {
      shell: false,
      encoding: "utf8",
      timeout: SECRET_COMMAND_TIMEOUT_MS,
      maxBuffer: SECRET_MAX_BYTES,
      stdio: ["ignore", "pipe", "pipe"],
      env,
    });
  } catch (cause) {
    // stderr may quote the item path but never the secret itself (the command
    // failed, so it printed nothing on stdout).
    const stderr = typeof cause?.stderr === "string" ? cause.stderr.trim() : "";
    throw usageError(
      "secret_command_failed",
      `\`secretCommand\` failed: ${argv[0]} exited ${cause?.status ?? "abnormally"}.`,
      stderr || String(cause),
    );
  }
  const secret = stdout.trim();
  if (secret === "") {
    throw usageError("secret_command_empty", "`secretCommand` printed nothing on stdout.");
  }
  return secret;
}

/**
 * @returns {{secret: string, source: "env"|"command"}} the secret is returned
 *          to the caller only; never printed, never written to disk.
 */
export function resolveSecret(config, env = process.env) {
  const fromEnv = env.YOKI_ARTIFACT_CLIENT_SECRET?.trim();
  if (fromEnv) return Object.freeze({ secret: fromEnv, source: "env" });
  if (!config.secretCommand) {
    throw usageError(
      "no_client_secret",
      `No Access client secret. Set YOKI_ARTIFACT_CLIENT_SECRET or "secretCommand" in ${config.file}.`,
    );
  }
  return Object.freeze({ secret: runSecretCommand(config.secretCommand, env), source: "command" });
}
