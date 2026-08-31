// manual-steps.mjs — the dashboard fallback.
//
// S7 left the Access `destinations` enum UNVERIFIED: a Worker-level
// application may not be creatable through the API on this account. Rather
// than guess at another shape, setup prints these steps and stops, so the
// operator finishes the one part that needs a human and re-runs.

import {
  ACCESS_APP_NAME,
  ALLOW_POLICY_NAME,
  SERVICE_AUTH_POLICY_NAME,
  SERVICE_TOKEN_NAME,
  SESSION_DURATION,
  VIEWERS_GROUP_NAME,
  WORKER_NAME,
} from "./constants.mjs";

export function manualAccessAppSteps({ ownerEmail }) {
  return [
    "",
    "The API would not create the Access application with a Worker destination.",
    "Create it once by hand in the dashboard, then re-run this script — it will",
    "find the application by name and carry on:",
    "",
    "  1. Zero Trust > Access > Applications > Add an application > Self-hosted",
    `  2. Application name: ${ACCESS_APP_NAME}`,
    `  3. Session duration: ${SESSION_DURATION}`,
    `  4. Public hostname: choose "Worker" (or "Select a Worker") and pick ${WORKER_NAME}.`,
    "     If the account offers no Worker destination, use the workers.dev hostname",
    `     (${WORKER_NAME}.<your-subdomain>.workers.dev) instead.`,
    "  5. Identity providers: leave every configured provider enabled (Google + GitHub).",
    "  6. Settings > Cookie settings: enable the HTTP Only cookie attribute.",
    `  7. Policies > Add a policy: name "${ALLOW_POLICY_NAME}", action Allow,`,
    `     include Emails = ${ownerEmail} OR Access Groups = ${VIEWERS_GROUP_NAME}.`,
    `  8. Policies > Add a policy: name "${SERVICE_AUTH_POLICY_NAME}", action`,
    `     Service Auth, include Service Token = ${SERVICE_TOKEN_NAME}.`,
    "",
    "Then: node scripts/setup.mjs",
    "",
  ].join("\n");
}
