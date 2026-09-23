// validate.mjs — client-side input checks.
//
// The Worker validates all of this again (it must: the CLI is not the only
// possible caller). Checking here too just turns a round trip and a 400 into
// an instant, clearer message — these rules mirror worker/src/store.mjs and
// worker/src/api.mjs, which remain the authority.

import { usageError } from "./errors.mjs";

export const CHANNEL_RE = /^[a-z0-9][a-z0-9-]{1,62}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function assertChannel(value, { flag = false } = {}) {
  if (typeof value !== "string" || !CHANNEL_RE.test(value)) {
    throw usageError(
      "invalid_channel",
      `${flag ? "--channel" : "The channel"} must be 2-63 characters of lowercase letters, digits or hyphens, ` +
        `starting with a letter or digit (got "${String(value ?? "").slice(0, 80)}").`,
    );
  }
  return value;
}

export function assertEmails(values, command) {
  if (!Array.isArray(values) || values.length === 0) {
    throw usageError("no_recipients", `${command} needs at least one --to <email>.`);
  }
  return Object.freeze(
    values.map((value) => {
      const email = String(value).trim().toLowerCase();
      if (!EMAIL_RE.test(email)) {
        throw usageError("bad_email", `"${value}" is not an email address.`);
      }
      return email;
    }),
  );
}

export function requirePositional(positionals, index, name, command) {
  const value = positionals[index];
  if (typeof value !== "string" || value.trim() === "") {
    throw usageError("missing_argument", `${command} needs <${name}>.`);
  }
  return value;
}
