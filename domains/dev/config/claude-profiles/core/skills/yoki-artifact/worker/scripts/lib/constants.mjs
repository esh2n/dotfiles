// constants.mjs — every name and endpoint the setup/teardown scripts use.
//
// Resources are found by name, never by a stored id, which is what makes
// `setup.mjs` re-runnable: a second run discovers what the first one created.
// Change a name here and the scripts will happily create a second resource
// beside the old one, so treat these as fixed once a deployment exists.

export const WORKER_NAME = "yoki-artifact";
export const D1_DATABASE_NAME = "yoki-artifact";
export const R2_BUCKET_NAME = "yoki-artifact";
export const ACCESS_APP_NAME = "yoki-artifact";
export const VIEWERS_GROUP_NAME = "yoki-artifact-viewers";
export const ALLOW_POLICY_NAME = "yoki-artifact-allow";
export const SERVICE_AUTH_POLICY_NAME = "yoki-artifact-service-auth";
export const SERVICE_TOKEN_NAME = "yoki-artifact-cli";

export const API_BASE = "https://api.cloudflare.com/client/v4";

/** Access session length for a browser sign-in. */
export const SESSION_DURATION = "24h";
/** Service-token lifetime. Cloudflare's maximum is one year. */
export const SERVICE_TOKEN_DURATION = "8760h";

/**
 * S7: no global wrangler exists and the project pins its own
 * (`pnpm add -D wrangler`), so every wrangler invocation goes through pnpm.
 */
export const WRANGLER_RUNNER = Object.freeze(["pnpm", "exec", "wrangler"]);

/** Where the CLI half of the skill reads its deployment coordinates. */
export const USER_CONFIG_DIR = ".config/yoki-artifact";
export const USER_CONFIG_FILE = "config.json";

/** The env var the CLI reads the service-token secret from. Never written to disk. */
export const CLIENT_SECRET_ENV = "YOKI_ARTIFACT_CLIENT_SECRET";

/** Default location of the viewer allow-list (a JSON array of emails). */
export const VIEWERS_FILE = "viewers.json";

export const REQUIRED_ENV = Object.freeze([
  "CLOUDFLARE_API_TOKEN",
  "CLOUDFLARE_ACCOUNT_ID",
  "ACCESS_TEAM_DOMAIN",
  "OWNER_EMAIL",
]);
