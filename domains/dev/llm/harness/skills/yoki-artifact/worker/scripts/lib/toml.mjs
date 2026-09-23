// toml.mjs — the two edits setup makes to wrangler.toml, as pure string
// functions so they can be tested without touching the file.
//
// Deliberately not a TOML parser: the file is hand-written and kept in the
// repo with its comments, and a round-trip through a serialiser would lose
// them. Each edit rewrites exactly one `key = "value"` line and fails loudly
// if that line is not where it is expected.

import { SetupError } from "./env.mjs";

const escape = (value) => String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');

/** Replace `key = "…"` inside the whole file (used for `database_id`). */
export function patchTopLevelKey(toml, key, value) {
  const pattern = new RegExp(`^(\\s*${key}\\s*=\\s*)"[^"]*"`, "m");
  if (!pattern.test(toml)) {
    throw new SetupError(`wrangler.toml has no \`${key} = "…"\` line to update`);
  }
  return toml.replace(pattern, `$1"${escape(value)}"`);
}

/** Rewrite one or more keys inside the `[vars]` table. */
export function patchVars(toml, values) {
  const start = toml.search(/^\[vars\]\s*$/m);
  if (start < 0) throw new SetupError("wrangler.toml has no [vars] table");
  const rest = toml.slice(start + 1);
  const nextTable = rest.search(/^\[/m);
  const end = nextTable < 0 ? toml.length : start + 1 + nextTable;
  const head = toml.slice(0, start);
  const tail = toml.slice(end);
  const section = Object.entries(values).reduce(
    (acc, [key, value]) => patchTopLevelKey(acc, key, value),
    toml.slice(start, end),
  );
  return `${head}${section}${tail}`;
}

/** Read back the values setup cares about, for idempotency checks. */
export function readWranglerValues(toml) {
  const pick = (key) => {
    const match = toml.match(new RegExp(`^\\s*${key}\\s*=\\s*"([^"]*)"`, "m"));
    return match ? match[1] : null;
  };
  return Object.freeze({
    database_id: pick("database_id"),
    ACCESS_AUD: pick("ACCESS_AUD"),
    ACCESS_TEAM_DOMAIN: pick("ACCESS_TEAM_DOMAIN"),
    OWNER_EMAIL: pick("OWNER_EMAIL"),
    SERVICE_TOKEN_NAME: pick("SERVICE_TOKEN_NAME"),
  });
}
