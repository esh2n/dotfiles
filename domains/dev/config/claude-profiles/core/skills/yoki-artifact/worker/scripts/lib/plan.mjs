// plan.mjs — what setup/teardown *would* do, as data.
//
// Pure: given a snapshot of what already exists in the account, this builds an
// ordered list of frozen steps. Nothing here performs an API call, spawns a
// process or writes a file — `execute.mjs` does that, and `--dry-run` simply
// prints the same list. That split is what makes the whole thing unit-testable
// without a network, and what makes idempotency checkable: a step whose
// resource is already there comes back with `skip` set and its `known` value.
//
// Ordering is forced by two real dependencies:
//   1. the Access application's `destinations: [{type:"worker", …}]` names a
//      Worker, so the Worker must be deployed before the application exists;
//   2. ACCESS_AUD only exists once the application does, so the vars are
//      patched and the Worker redeployed afterwards.

import {
  ACCESS_APP_NAME,
  ALLOW_POLICY_NAME,
  CLIENT_SECRET_ENV,
  D1_DATABASE_NAME,
  R2_BUCKET_NAME,
  SERVICE_AUTH_POLICY_NAME,
  SERVICE_TOKEN_DURATION,
  SERVICE_TOKEN_NAME,
  SESSION_DURATION,
  VIEWERS_GROUP_NAME,
  WORKER_NAME,
  WRANGLER_RUNNER,
} from "./constants.mjs";

const freeze = Object.freeze;

/** A value only known once an earlier step has run. Resolved by the executor. */
export const ref = (stepId, path) => freeze({ $ref: stepId, path });

export const isRef = (value) => Boolean(value) && typeof value === "object" && typeof value.$ref === "string";

/**
 * A path segment only known at run time, written inline so a URL stays a
 * readable string in the dry-run output: `…/access/apps/{access-app.id}/…`.
 * `execute.mjs` substitutes it from the earlier step's result.
 */
export const pathRef = (stepId, path) => `{${stepId}.${path}}`;
export const PATH_REF_RE = /\{([a-z0-9-]+)\.([a-z0-9_]+)\}/gi;

const apiStep = ({ id, describe, method, path, body = null, skip = null, known = null }) =>
  freeze({ id, kind: "api", describe, method, path, body, skip, known });

const execStep = ({ id, describe, command, args, skip = null }) =>
  freeze({ id, kind: "exec", describe, command, args: freeze([...args]), skip, known: null });

const fileStep = ({ id, describe, writer, values, skip = null }) =>
  freeze({ id, kind: "file", describe, writer, values, skip, known: null });

const wrangler = (...args) => ({ command: WRANGLER_RUNNER[0], args: [...WRANGLER_RUNNER.slice(1), ...args] });

const byName = (list, name) => (Array.isArray(list) ? (list.find((item) => item?.name === name) ?? null) : null);

const sameMembers = (a, b) => a.length === b.length && a.every((value, index) => value === b[index]);

/** Emails currently included in an Access group, normalised for comparison. */
export function groupEmails(group) {
  const include = Array.isArray(group?.include) ? group.include : [];
  const emails = include
    .map((rule) => rule?.email?.email)
    .filter((email) => typeof email === "string")
    .map((email) => email.trim().toLowerCase());
  return [...new Set(emails)].sort();
}

const emailInclude = (emails) => emails.map((email) => ({ email: { email } }));

/** The empty snapshot: what `--dry-run` plans against, and a fresh account. */
export const EMPTY_STATE = freeze({
  d1Databases: freeze([]),
  r2Buckets: freeze([]),
  accessApps: freeze([]),
  accessPolicies: freeze([]),
  accessGroups: freeze([]),
  serviceTokens: freeze([]),
  workersSubdomain: null,
  wranglerVars: freeze({}),
});

function readState(state) {
  return { ...EMPTY_STATE, ...(state ?? {}) };
}

function workerUrl(subdomain) {
  return typeof subdomain === "string" && subdomain.trim() !== ""
    ? `https://${WORKER_NAME}.${subdomain.trim()}.workers.dev`
    : null;
}

function d1Steps(existing, accountId) {
  const found = byName(existing.d1Databases, D1_DATABASE_NAME);
  return [
    apiStep({
      id: "d1-database",
      describe: `D1 database "${D1_DATABASE_NAME}"`,
      method: "POST",
      path: `/accounts/${accountId}/d1/database`,
      body: { name: D1_DATABASE_NAME },
      skip: found ? "already exists" : null,
      known: found,
    }),
    fileStep({
      id: "wrangler-database-id",
      describe: "wrangler.toml: database_id",
      writer: "wrangler-database-id",
      values: { database_id: found ? found.uuid : ref("d1-database", "uuid") },
      skip: found && existing.wranglerVars?.database_id === found.uuid ? "already set" : null,
    }),
  ];
}

function r2Step(existing, accountId) {
  const found = byName(existing.r2Buckets, R2_BUCKET_NAME);
  return apiStep({
    id: "r2-bucket",
    describe: `R2 bucket "${R2_BUCKET_NAME}"`,
    method: "POST",
    path: `/accounts/${accountId}/r2/buckets`,
    body: { name: R2_BUCKET_NAME },
    skip: found ? "already exists" : null,
    known: found,
  });
}

function accessAppStep(existing, accountId) {
  const found = byName(existing.accessApps, ACCESS_APP_NAME);
  return apiStep({
    id: "access-app",
    describe: `Access application "${ACCESS_APP_NAME}" (worker destination)`,
    method: "POST",
    path: `/accounts/${accountId}/access/apps`,
    body: {
      name: ACCESS_APP_NAME,
      type: "self_hosted",
      // S7 flagged this enum UNVERIFIED. execute.mjs prints the manual
      // dashboard steps instead of guessing if the API rejects it.
      destinations: [{ type: "worker", worker_id: WORKER_NAME }],
      session_duration: SESSION_DURATION,
      app_launcher_visible: false,
      auto_redirect_to_identity: false,
      http_only_cookie_attribute: true,
      skip_interstitial: false,
    },
    skip: found ? "already exists" : null,
    known: found,
  });
}

function viewersGroupStep(existing, accountId, viewers) {
  const found = byName(existing.accessGroups, VIEWERS_GROUP_NAME);
  const body = { name: VIEWERS_GROUP_NAME, include: emailInclude(viewers) };
  if (!found) {
    return apiStep({
      id: "viewers-group",
      describe: `Access group "${VIEWERS_GROUP_NAME}" (${viewers.length} viewer(s))`,
      method: "POST",
      path: `/accounts/${accountId}/access/groups`,
      body,
    });
  }
  const unchanged = sameMembers(groupEmails(found), viewers);
  return apiStep({
    id: "viewers-group",
    describe: `Access group "${VIEWERS_GROUP_NAME}": update members (${viewers.length})`,
    method: "PUT",
    path: `/accounts/${accountId}/access/groups/${found.id}`,
    body,
    skip: unchanged ? "members already match" : null,
    known: found,
  });
}

function policySteps(existing, accountId, appId, ownerEmail) {
  const appPath = `/accounts/${accountId}/access/apps/${appId}/policies`;
  const allow = byName(existing.accessPolicies, ALLOW_POLICY_NAME);
  const serviceAuth = byName(existing.accessPolicies, SERVICE_AUTH_POLICY_NAME);
  return [
    apiStep({
      id: "allow-policy",
      describe: `Allow policy "${ALLOW_POLICY_NAME}" (owner + ${VIEWERS_GROUP_NAME})`,
      method: "POST",
      path: appPath,
      body: {
        name: ALLOW_POLICY_NAME,
        decision: "allow",
        precedence: 1,
        include: [{ email: { email: ownerEmail } }, { group: { id: ref("viewers-group", "id") } }],
      },
      skip: allow ? "already exists" : null,
      known: allow,
    }),
    apiStep({
      id: "service-auth-policy",
      describe: `Service Auth policy "${SERVICE_AUTH_POLICY_NAME}" (${SERVICE_TOKEN_NAME})`,
      method: "POST",
      path: appPath,
      body: {
        name: SERVICE_AUTH_POLICY_NAME,
        decision: "non_identity",
        precedence: 2,
        include: [{ service_token: { token_id: ref("service-token", "id") } }],
      },
      skip: serviceAuth ? "already exists" : null,
      known: serviceAuth,
    }),
  ];
}

function serviceTokenStep(existing, accountId) {
  const found = byName(existing.serviceTokens, SERVICE_TOKEN_NAME);
  return apiStep({
    id: "service-token",
    describe: `service token "${SERVICE_TOKEN_NAME}" (secret shown once, on stderr)`,
    method: "POST",
    path: `/accounts/${accountId}/access/service_tokens`,
    body: { name: SERVICE_TOKEN_NAME, duration: SERVICE_TOKEN_DURATION },
    skip: found ? "already exists (its secret cannot be read again — rotate to get a new one)" : null,
    known: found,
  });
}

/**
 * Build the full setup plan.
 *
 * @param existing snapshot from `discover()` (or EMPTY_STATE for a dry run)
 * @param params   {accountId, teamDomain, ownerEmail, viewers}
 */
export function planSetup(existing, { accountId, teamDomain, ownerEmail, viewers = [] }) {
  const state = readState(existing);
  const app = byName(state.accessApps, ACCESS_APP_NAME);
  const appId = app ? app.id : pathRef("access-app", "id");
  const aud = app ? app.aud : ref("access-app", "aud");
  const varsInSync =
    Boolean(app) &&
    state.wranglerVars?.ACCESS_AUD === app.aud &&
    state.wranglerVars?.ACCESS_TEAM_DOMAIN === teamDomain &&
    state.wranglerVars?.OWNER_EMAIL === ownerEmail;

  const steps = [
    ...d1Steps(state, accountId),
    r2Step(state, accountId),
    execStep({
      id: "d1-migrations",
      describe: `apply migrations to ${D1_DATABASE_NAME} (remote)`,
      ...wrangler("d1", "migrations", "apply", D1_DATABASE_NAME, "--remote"),
    }),
    execStep({
      id: "deploy-worker",
      describe: `deploy ${WORKER_NAME} (the Access application needs the Worker to exist)`,
      ...wrangler("deploy"),
    }),
    accessAppStep(state, accountId),
    viewersGroupStep(state, accountId, viewers),
    serviceTokenStep(state, accountId),
    ...policySteps(state, accountId, appId, ownerEmail),
    fileStep({
      id: "wrangler-vars",
      describe: "wrangler.toml [vars]: ACCESS_AUD, ACCESS_TEAM_DOMAIN, OWNER_EMAIL",
      writer: "wrangler-vars",
      values: { ACCESS_AUD: aud, ACCESS_TEAM_DOMAIN: teamDomain, OWNER_EMAIL: ownerEmail },
      skip: varsInSync ? "already set" : null,
    }),
    execStep({
      id: "redeploy-worker",
      describe: `redeploy ${WORKER_NAME} with the real ACCESS_AUD`,
      ...wrangler("deploy"),
      skip: varsInSync ? "vars unchanged" : null,
    }),
    fileStep({
      id: "user-config",
      describe: "~/.config/yoki-artifact/config.json (never holds the secret)",
      writer: "user-config",
      values: {
        accountId,
        workerName: WORKER_NAME,
        workerUrl: workerUrl(state.workersSubdomain),
        teamDomain,
        ownerEmail,
        accessAud: aud,
        serviceTokenClientId: ref("service-token", "client_id"),
        clientSecretEnv: CLIENT_SECRET_ENV,
      },
    }),
  ];
  return freeze({ kind: "setup", steps: freeze(steps) });
}

/** Reverse of `planSetup`: delete only what actually exists. */
export function planTeardown(existing, { accountId }) {
  const state = readState(existing);
  const app = byName(state.accessApps, ACCESS_APP_NAME);
  const group = byName(state.accessGroups, VIEWERS_GROUP_NAME);
  const token = byName(state.serviceTokens, SERVICE_TOKEN_NAME);
  const database = byName(state.d1Databases, D1_DATABASE_NAME);
  const bucket = byName(state.r2Buckets, R2_BUCKET_NAME);

  const deletion = (id, describe, path, known) =>
    apiStep({ id, describe, method: "DELETE", path, skip: known ? null : "not found", known });

  const steps = [
    deletion(
      "delete-access-app",
      `Access application "${ACCESS_APP_NAME}" (its policies go with it)`,
      `/accounts/${accountId}/access/apps/${app ? app.id : ":app_id"}`,
      app,
    ),
    deletion(
      "delete-viewers-group",
      `Access group "${VIEWERS_GROUP_NAME}"`,
      `/accounts/${accountId}/access/groups/${group ? group.id : ":group_id"}`,
      group,
    ),
    deletion(
      "delete-service-token",
      `service token "${SERVICE_TOKEN_NAME}"`,
      `/accounts/${accountId}/access/service_tokens/${token ? token.id : ":token_id"}`,
      token,
    ),
    deletion(
      "delete-d1-database",
      `D1 database "${D1_DATABASE_NAME}" (every artifact row)`,
      `/accounts/${accountId}/d1/database/${database ? database.uuid : ":database_id"}`,
      database,
    ),
    deletion(
      "delete-r2-bucket",
      `R2 bucket "${R2_BUCKET_NAME}" (must be empty first)`,
      `/accounts/${accountId}/r2/buckets/${R2_BUCKET_NAME}`,
      bucket,
    ),
    execStep({
      id: "delete-worker",
      describe: `delete the ${WORKER_NAME} Worker`,
      ...wrangler("delete", "--name", WORKER_NAME),
    }),
  ];
  return freeze({ kind: "teardown", steps: freeze(steps) });
}
