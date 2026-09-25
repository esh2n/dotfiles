// env.mjs — validate the boundary between the shell and the scripts: the four
// environment variables, the CLI flags and the viewer allow-list file.
//
// Everything here fails fast with a message a human can act on. Nothing here
// touches the network, and the API token is never echoed, logged or written.

import { readFileSync } from "node:fs";

import { REQUIRED_ENV } from "./constants.mjs";

/** A setup/teardown failure that is the operator's to fix, not a bug. */
export class SetupError extends Error {
  constructor(message, hint = null) {
    super(message);
    this.name = "SetupError";
    this.hint = hint;
  }
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TEAM_DOMAIN_RE = /^[a-z0-9-]+\.cloudflareaccess\.com$/i;

/** `team`, `team.cloudflareaccess.com`, `https://team…/` -> `team.cloudflareaccess.com`. */
export function normalizeTeamDomain(raw) {
  const trimmed = String(raw ?? "").trim().replace(/^https?:\/\//i, "").replace(/\/+$/, "");
  const full = trimmed.includes(".") ? trimmed : `${trimmed}.cloudflareaccess.com`;
  if (!TEAM_DOMAIN_RE.test(full)) {
    throw new SetupError(
      `ACCESS_TEAM_DOMAIN is not a Zero Trust team domain: ${trimmed || "(empty)"}`,
      "Expected something like acme.cloudflareaccess.com (Zero Trust > Settings > Custom Pages > team domain).",
    );
  }
  return full.toLowerCase();
}

export function normalizeEmail(raw, label) {
  const value = String(raw ?? "").trim().toLowerCase();
  if (!EMAIL_RE.test(value)) {
    throw new SetupError(`${label} is not an email address: ${value || "(empty)"}`);
  }
  return value;
}

/** Read and validate the four required variables. Returns a frozen object. */
export function readEnvironment(env = process.env) {
  const missing = REQUIRED_ENV.filter((name) => String(env[name] ?? "").trim() === "");
  if (missing.length > 0) {
    throw new SetupError(
      `missing environment variables: ${missing.join(", ")}`,
      "See SETUP.md — all four are required, and CLOUDFLARE_API_TOKEN must never be committed.",
    );
  }
  return Object.freeze({
    apiToken: String(env.CLOUDFLARE_API_TOKEN).trim(),
    accountId: String(env.CLOUDFLARE_ACCOUNT_ID).trim(),
    teamDomain: normalizeTeamDomain(env.ACCESS_TEAM_DOMAIN),
    ownerEmail: normalizeEmail(env.OWNER_EMAIL, "OWNER_EMAIL"),
  });
}

/** Minimal flag parser: `--dry-run`, `--yes`, `--viewers <path>`. */
export function parseArgs(argv) {
  const flags = { dryRun: false, yes: false, viewersFile: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--dry-run") flags.dryRun = true;
    else if (arg === "--yes") flags.yes = true;
    else if (arg === "--viewers") {
      const value = argv[i + 1];
      if (!value || value.startsWith("--")) throw new SetupError("--viewers needs a path to a JSON file");
      flags.viewersFile = value;
      i += 1;
    } else if (arg === "--help" || arg === "-h") flags.help = true;
    else throw new SetupError(`unknown argument: ${arg}`, "Supported: --dry-run, --yes, --viewers <path>, --help");
  }
  return Object.freeze(flags);
}

/**
 * Parse the viewer allow-list. Accepts `["a@b.c"]` or `{"viewers":["a@b.c"]}`.
 * Never trusts the file: every entry is validated as an email.
 */
export function parseViewers(text, source = "viewers file") {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (cause) {
    throw new SetupError(`${source} is not valid JSON`, String(cause));
  }
  const list = Array.isArray(parsed) ? parsed : parsed?.viewers;
  if (!Array.isArray(list)) {
    throw new SetupError(`${source} must be a JSON array of emails, or {"viewers": [...]}`);
  }
  const emails = list.map((entry, index) => normalizeEmail(entry, `${source}[${index}]`));
  return Object.freeze([...new Set(emails)].sort());
}

/** Read the allow-list from disk. A missing file means "no extra viewers yet". */
export function readViewersFile(path, { required = false } = {}) {
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch (cause) {
    if (required || cause?.code !== "ENOENT") {
      throw new SetupError(`could not read the viewer list at ${path}`, String(cause));
    }
    return Object.freeze([]);
  }
  return parseViewers(text, path);
}
