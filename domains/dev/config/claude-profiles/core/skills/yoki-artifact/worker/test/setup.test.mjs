// setup.test.mjs — the provisioning planner.
//
// The planner is pure, so the whole question "what would setup do to this
// account?" is answered by handing it a fake listing of existing resources.
// Nothing here touches the network: `discover` is driven by a recording fake
// API, and the plan itself is compared as data. The one thing that cannot be
// tested here is whether Cloudflare accepts the `destinations` worker shape —
// S7 flagged it UNVERIFIED, and the fallback for a rejection is asserted
// instead (execute.mjs hands the step to `onApiError`).

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ApiError, createApi, discover } from "../scripts/lib/cf-api.mjs";
import {
  ACCESS_APP_NAME,
  D1_DATABASE_NAME,
  R2_BUCKET_NAME,
  SERVICE_TOKEN_NAME,
  VIEWERS_GROUP_NAME,
} from "../scripts/lib/constants.mjs";
import { EMPTY_STATE, groupEmails, planSetup, planTeardown } from "../scripts/lib/plan.mjs";
import { renderPlan } from "../scripts/lib/render-plan.mjs";
import { normalizeTeamDomain, parseArgs, parseViewers, readEnvironment, readViewersFile } from "../scripts/lib/env.mjs";
import { patchTopLevelKey, patchVars, readWranglerValues } from "../scripts/lib/toml.mjs";
import { resolve, resolvePath, runPlan } from "../scripts/lib/execute.mjs";
import { manualAccessAppSteps } from "../scripts/lib/manual-steps.mjs";

const ACCOUNT = "acct-1";
const PARAMS = Object.freeze({
  accountId: ACCOUNT,
  teamDomain: "acme.cloudflareaccess.com",
  ownerEmail: "owner@example.com",
  viewers: ["viewer@example.com"],
});

const APP = Object.freeze({ id: "app-1", name: ACCESS_APP_NAME, aud: "aud-1" });

const step = (plan, id) => plan.steps.find((s) => s.id === id);
const doing = (plan) => plan.steps.filter((s) => !s.skip).map((s) => s.id);
const apiCalls = (plan) =>
  plan.steps.filter((s) => !s.skip && s.kind === "api").map((s) => `${s.method} ${s.path}`);

/** A snapshot in which every resource already exists. */
const fullState = (overrides = {}) => ({
  ...EMPTY_STATE,
  d1Databases: [{ uuid: "db-1", name: D1_DATABASE_NAME }],
  r2Buckets: [{ name: R2_BUCKET_NAME }],
  accessApps: [APP],
  accessPolicies: [
    { id: "p-1", name: "yoki-artifact-allow" },
    { id: "p-2", name: "yoki-artifact-service-auth" },
  ],
  accessGroups: [
    { id: "g-1", name: VIEWERS_GROUP_NAME, include: [{ email: { email: "viewer@example.com" } }] },
  ],
  serviceTokens: [{ id: "t-1", name: SERVICE_TOKEN_NAME, client_id: "client-1" }],
  workersSubdomain: "esh2n",
  wranglerVars: {
    database_id: "db-1",
    ACCESS_AUD: "aud-1",
    ACCESS_TEAM_DOMAIN: PARAMS.teamDomain,
    OWNER_EMAIL: PARAMS.ownerEmail,
    // The owner pin is the service token's CLIENT ID, not its name — that is
    // what Access puts in the JWT `common_name` claim.
    SERVICE_TOKEN_NAME: "client-1",
  },
  ...overrides,
});

describe("planSetup on an empty account", () => {
  const plan = planSetup(EMPTY_STATE, PARAMS);

  test("creates every resource, in an order the dependencies force", () => {
    assert.deepEqual(doing(plan), [
      "d1-database",
      "wrangler-database-id",
      "r2-bucket",
      "d1-migrations",
      "deploy-worker",
      "access-app",
      "viewers-group",
      "service-token",
      "allow-policy",
      "service-auth-policy",
      "wrangler-vars",
      "redeploy-worker",
      "user-config",
    ]);
  });

  test("the Worker is deployed before the Access application that names it", () => {
    const ids = plan.steps.map((s) => s.id);
    assert.ok(ids.indexOf("deploy-worker") < ids.indexOf("access-app"));
    assert.ok(ids.indexOf("access-app") < ids.indexOf("wrangler-vars"));
    assert.ok(ids.indexOf("wrangler-vars") < ids.indexOf("redeploy-worker"));
  });

  test("emits exactly the API calls the spec asks for", () => {
    assert.deepEqual(apiCalls(plan), [
      `POST /accounts/${ACCOUNT}/d1/database`,
      `POST /accounts/${ACCOUNT}/r2/buckets`,
      `POST /accounts/${ACCOUNT}/access/apps`,
      `POST /accounts/${ACCOUNT}/access/groups`,
      `POST /accounts/${ACCOUNT}/access/service_tokens`,
      `POST /accounts/${ACCOUNT}/access/apps/{access-app.id}/policies`,
      `POST /accounts/${ACCOUNT}/access/apps/{access-app.id}/policies`,
    ]);
  });

  test("the Access application carries the S7 worker destination", () => {
    assert.deepEqual(step(plan, "access-app").body.destinations, [{ type: "worker", worker_id: "yoki-artifact" }]);
    assert.equal(step(plan, "access-app").body.type, "self_hosted");
    assert.equal(step(plan, "access-app").body.http_only_cookie_attribute, true);
  });

  // Verified live 2026-09: the worker destination can 400 (12130), and the
  // self_hosted + workers.dev hostname form is what those accounts accept.
  test("the Access application declares the workers.dev-hostname fallback", () => {
    const { fallback } = step(plan, "access-app");
    assert.equal(fallback.body.type, "self_hosted");
    assert.equal(fallback.body.http_only_cookie_attribute, true);
    assert.equal(fallback.body.destinations, undefined, "the fallback must not repeat the rejected shape");
    // EMPTY_STATE knows no subdomain, so the hostname carries a placeholder
    // and the executor is told where to fetch the real value.
    assert.equal(fallback.body.domain, "yoki-artifact.<workers-subdomain>.workers.dev");
    assert.equal(fallback.subdomainPath, `/accounts/${ACCOUNT}/workers/subdomain`);
  });

  test("a discovered subdomain lands in the fallback hostname directly", () => {
    const { fallback } = step(planSetup(fullState({ accessApps: [] }), PARAMS), "access-app");
    assert.equal(fallback.body.domain, "yoki-artifact.esh2n.workers.dev");
    assert.equal(fallback.subdomainPath, null, "no extra GET is needed when discovery already read it");
  });

  test("the Allow policy admits the owner and the viewers group", () => {
    const { body } = step(plan, "allow-policy");
    assert.equal(body.decision, "allow");
    assert.deepEqual(body.include[0], { email: { email: "owner@example.com" } });
    assert.deepEqual(body.include[1].group.id, { $ref: "viewers-group", path: "id" });
  });

  test("the Service Auth policy is non_identity and references the created token", () => {
    const { body } = step(plan, "service-auth-policy");
    assert.equal(body.decision, "non_identity");
    assert.deepEqual(body.include, [{ service_token: { token_id: { $ref: "service-token", path: "id" } } }]);
  });

  test("the service token is the one the CLI uses", () => {
    assert.equal(step(plan, "service-token").body.name, "yoki-artifact-cli");
  });

  test("the viewers group is built from the local JSON list", () => {
    assert.deepEqual(step(plan, "viewers-group").body.include, [{ email: { email: "viewer@example.com" } }]);
    assert.equal(step(plan, "viewers-group").method, "POST");
  });

  test("ACCESS_AUD is written from the application, not invented", () => {
    assert.deepEqual(step(plan, "wrangler-vars").values, {
      ACCESS_AUD: { $ref: "access-app", path: "aud" },
      ACCESS_TEAM_DOMAIN: PARAMS.teamDomain,
      OWNER_EMAIL: PARAMS.ownerEmail,
      SERVICE_TOKEN_NAME: { $ref: "service-token", path: "client_id" },
    });
  });

  // The Worker compares SERVICE_TOKEN_NAME against the JWT `common_name`
  // claim, which Access fills with the token's Client ID.
  test("SERVICE_TOKEN_NAME pins the service token by its client id", () => {
    assert.deepEqual(step(plan, "wrangler-vars").values.SERVICE_TOKEN_NAME, {
      $ref: "service-token",
      path: "client_id",
    });
  });

  test("the local config records the client id and never the secret", () => {
    const { values } = step(plan, "user-config");
    assert.deepEqual(values.serviceTokenClientId, { $ref: "service-token", path: "client_id" });
    assert.equal(values.clientSecretEnv, "YOKI_ARTIFACT_CLIENT_SECRET");
    const serialised = JSON.stringify(plan);
    assert.ok(!/client_secret|secret"\s*:/.test(serialised), "no plan step carries a secret value");
  });

  // Without this the CLI's `share` has no way to reach the Access group, and
  // the D1 viewer list and the edge allow-list drift apart silently.
  test("the local config records the Access group id for share/unshare", () => {
    assert.deepEqual(step(plan, "user-config").values.accessGroupId, { $ref: "viewers-group", path: "id" });
  });
});

describe("planSetup is idempotent", () => {
  test("a fully provisioned account creates nothing", () => {
    const plan = planSetup(fullState(), PARAMS);
    assert.deepEqual(apiCalls(plan), []);
    assert.deepEqual(doing(plan), ["d1-migrations", "deploy-worker", "user-config"]);
  });

  test("skipped steps carry the existing resource so references still resolve", () => {
    const plan = planSetup(fullState(), PARAMS);
    assert.equal(step(plan, "access-app").known.aud, "aud-1");
    assert.equal(step(plan, "d1-database").known.uuid, "db-1");
    assert.equal(step(plan, "wrangler-database-id").skip, "already set");
    assert.match(step(plan, "service-token").skip, /already exists/);
  });

  test("a deployment that predates the owner pin gets SERVICE_TOKEN_NAME written", () => {
    const stale = fullState({
      wranglerVars: {
        database_id: "db-1",
        ACCESS_AUD: "aud-1",
        ACCESS_TEAM_DOMAIN: PARAMS.teamDomain,
        OWNER_EMAIL: PARAMS.ownerEmail,
        SERVICE_TOKEN_NAME: null,
      },
    });
    const plan = planSetup(stale, PARAMS);
    assert.equal(step(plan, "wrangler-vars").skip, null);
    assert.equal(step(plan, "wrangler-vars").values.SERVICE_TOKEN_NAME, "client-1");
    assert.equal(step(plan, "redeploy-worker").skip, null, "the pin only takes effect after a redeploy");
  });

  test("a stale ACCESS_AUD in wrangler.toml is repatched and redeployed", () => {
    const plan = planSetup(fullState({ wranglerVars: { database_id: "db-1", ACCESS_AUD: "old" } }), PARAMS);
    assert.equal(step(plan, "wrangler-vars").skip, null);
    assert.deepEqual(step(plan, "wrangler-vars").values.ACCESS_AUD, "aud-1");
    assert.equal(step(plan, "redeploy-worker").skip, null);
  });

  test("only the D1 database missing means only the D1 database is created", () => {
    const plan = planSetup(fullState({ d1Databases: [] }), PARAMS);
    assert.deepEqual(apiCalls(plan), [`POST /accounts/${ACCOUNT}/d1/database`]);
    assert.deepEqual(step(plan, "wrangler-database-id").values.database_id, { $ref: "d1-database", path: "uuid" });
  });

  test("a changed viewer list updates the group in place instead of creating one", () => {
    const plan = planSetup(fullState(), { ...PARAMS, viewers: ["viewer@example.com", "second@example.com"] });
    const group = step(plan, "viewers-group");
    assert.equal(group.method, "PUT");
    assert.equal(group.path, `/accounts/${ACCOUNT}/access/groups/g-1`);
    assert.equal(group.skip, null);
    assert.equal(group.body.include.length, 2);
  });

  test("an unchanged viewer list leaves the group alone", () => {
    assert.equal(step(planSetup(fullState(), PARAMS), "viewers-group").skip, "members already match");
  });

  test("groupEmails normalises whatever the API returned", () => {
    assert.deepEqual(groupEmails({ include: [{ email: { email: " B@x.test " } }, { everyone: {} }] }), ["b@x.test"]);
    assert.deepEqual(groupEmails(null), []);
  });
});

describe("planTeardown", () => {
  test("deletes only what exists", () => {
    const plan = planTeardown(fullState(), { accountId: ACCOUNT });
    assert.deepEqual(apiCalls(plan), [
      `DELETE /accounts/${ACCOUNT}/access/apps/app-1`,
      `DELETE /accounts/${ACCOUNT}/access/groups/g-1`,
      `DELETE /accounts/${ACCOUNT}/access/service_tokens/t-1`,
      `DELETE /accounts/${ACCOUNT}/d1/database/db-1`,
      `DELETE /accounts/${ACCOUNT}/r2/buckets/yoki-artifact`,
    ]);
  });

  test("an empty account deletes nothing at all", () => {
    const plan = planTeardown(EMPTY_STATE, { accountId: ACCOUNT });
    assert.deepEqual(apiCalls(plan), []);
    assert.deepEqual(doing(plan), ["delete-worker"]);
  });
});

describe("discover reads the account without mutating it", () => {
  function fakeApi(routes) {
    const calls = [];
    return {
      calls,
      async call(method, path) {
        calls.push(`${method} ${path}`);
        if (method !== "GET") throw new Error(`discover must not issue ${method}`);
        return routes[path] ?? [];
      },
      get(path) {
        return this.call("GET", path);
      },
    };
  }

  test("only GETs, and R2's nested bucket list is unwrapped", async () => {
    const api = fakeApi({
      [`/accounts/${ACCOUNT}/d1/database`]: [{ uuid: "db-1", name: D1_DATABASE_NAME }],
      [`/accounts/${ACCOUNT}/r2/buckets`]: { buckets: [{ name: R2_BUCKET_NAME }] },
      [`/accounts/${ACCOUNT}/access/apps`]: [APP],
      [`/accounts/${ACCOUNT}/access/apps/app-1/policies`]: [{ id: "p-1", name: "yoki-artifact-allow" }],
      [`/accounts/${ACCOUNT}/workers/subdomain`]: { subdomain: "esh2n" },
    });
    const state = await discover(api, ACCOUNT, { wranglerVars: { ACCESS_AUD: "aud-1" } });
    assert.deepEqual(state.r2Buckets, [{ name: R2_BUCKET_NAME }]);
    assert.equal(state.workersSubdomain, "esh2n");
    assert.equal(state.accessPolicies.length, 1);
    assert.ok(api.calls.every((call) => call.startsWith("GET ")));
  });

  test("the policy listing is skipped when the application does not exist yet", async () => {
    const api = fakeApi({});
    const state = await discover(api, ACCOUNT);
    assert.deepEqual(state.accessPolicies, []);
    assert.ok(!api.calls.some((call) => call.includes("/policies")));
  });

  test("a planned worker URL comes from the discovered subdomain", async () => {
    const withSubdomain = planSetup(fullState(), PARAMS);
    assert.equal(step(withSubdomain, "user-config").values.workerUrl, "https://yoki-artifact.esh2n.workers.dev");
    const without = planSetup(fullState({ workersSubdomain: null }), PARAMS);
    assert.equal(step(without, "user-config").values.workerUrl, null);
  });
});

describe("--dry-run rendering", () => {
  const text = renderPlan(planSetup(EMPTY_STATE, PARAMS));

  test("prints every API call with its method, URL and body", () => {
    assert.match(text, /POST https:\/\/api\.cloudflare\.com\/client\/v4\/accounts\/acct-1\/d1\/database/);
    assert.match(text, /POST https:\/\/api\.cloudflare\.com\/client\/v4\/accounts\/acct-1\/access\/service_tokens/);
    assert.match(text, /"worker_id": "yoki-artifact"/);
  });

  test("prints the wrangler commands verbatim", () => {
    assert.match(text, /\$ pnpm exec wrangler d1 migrations apply yoki-artifact --remote/);
    assert.match(text, /\$ pnpm exec wrangler deploy/);
  });

  test("run-time values print as readable placeholders", () => {
    assert.match(text, /<access-app\.aud>/);
    assert.match(text, /<service-token\.client_id>/);
  });

  test("the access-app step shows its workers.dev-hostname fallback", () => {
    assert.match(text, /on a rejected body \(400\/422\): retry as self_hosted with the workers\.dev hostname/);
    assert.match(text, /"domain": "yoki-artifact\.<workers-subdomain>\.workers\.dev"/);
  });

  test("skipped steps say why", () => {
    assert.match(renderPlan(planSetup(fullState(), PARAMS)), /\[skip\].*already exists/);
  });
});

describe("reference resolution", () => {
  test("a ref is replaced by the referenced step's field", () => {
    const results = new Map([["access-app", { id: "app-9", aud: "aud-9" }]]);
    assert.deepEqual(resolve({ a: { $ref: "access-app", path: "aud" } }, results), { a: "aud-9" });
  });

  test("a missing reference fails loudly instead of sending undefined", () => {
    assert.throws(() => resolve({ $ref: "access-app", path: "aud" }, new Map()), /did not provide "aud"/);
  });

  test("a path placeholder is substituted and URL-encoded", () => {
    const results = new Map([["access-app", { id: "app 9" }]]);
    assert.equal(
      resolvePath("/accounts/a/access/apps/{access-app.id}/policies", results),
      "/accounts/a/access/apps/app%209/policies",
    );
    assert.throws(() => resolvePath("/apps/{access-app.id}", new Map()), /did not provide "id"/);
  });
});

describe("running a plan (API, child process and filesystem all faked)", () => {
  const CREATED = Object.freeze({
    "POST /accounts/acct-1/d1/database": { uuid: "db-9", name: D1_DATABASE_NAME },
    "POST /accounts/acct-1/r2/buckets": { name: R2_BUCKET_NAME },
    "POST /accounts/acct-1/access/apps": { id: "app-9", name: ACCESS_APP_NAME, aud: "aud-9" },
    "POST /accounts/acct-1/access/groups": { id: "g-9", name: VIEWERS_GROUP_NAME },
    "POST /accounts/acct-1/access/service_tokens": {
      id: "t-9",
      name: SERVICE_TOKEN_NAME,
      client_id: "client-9",
      client_secret: "s3cret-shown-once",
    },
    "POST /accounts/acct-1/access/apps/app-9/policies": { id: "p-9" },
  });

  function harness(responses = CREATED) {
    const dir = mkdtempSync(join(tmpdir(), "yoki-artifact-setup-"));
    const wranglerToml = join(dir, "wrangler.toml");
    writeFileSync(
      wranglerToml,
      [
        'name = "yoki-artifact"',
        'database_id = "00000000-0000-0000-0000-000000000000"',
        "",
        "[vars]",
        'ACCESS_TEAM_DOMAIN = "REPLACE-team.cloudflareaccess.com"',
        'ACCESS_AUD = "REPLACE-access-application-aud"',
        'OWNER_EMAIL = "REPLACE-owner@example.com"',
        'SERVICE_TOKEN_NAME = "REPLACE-service-token-client-id"',
        "",
      ].join("\n"),
    );
    const calls = [];
    const spawned = [];
    const out = [];
    const err = [];
    return {
      dir,
      calls,
      spawned,
      out,
      err,
      paths: { cwd: dir, wranglerToml, userConfig: join(dir, "config", "config.json") },
      io: { out: (line) => out.push(String(line)), err: (line) => err.push(String(line)) },
      spawn: (command, args) => {
        spawned.push(`${command} ${args.join(" ")}`);
        return { status: 0 };
      },
      api: {
        async call(method, path, body) {
          calls.push({ method, path, body });
          const entry = responses[`${method} ${path}`];
          const response = typeof entry === "function" ? entry({ method, path, body }) : entry;
          if (response instanceof Error) throw response;
          return response ?? null;
        },
      },
    };
  }

  test("a full first run resolves every reference and writes both files", async () => {
    const h = harness();
    const results = await runPlan(planSetup(EMPTY_STATE, PARAMS), h);

    assert.deepEqual(
      h.calls.map((c) => `${c.method} ${c.path}`),
      [
        "POST /accounts/acct-1/d1/database",
        "POST /accounts/acct-1/r2/buckets",
        "POST /accounts/acct-1/access/apps",
        "POST /accounts/acct-1/access/groups",
        "POST /accounts/acct-1/access/service_tokens",
        "POST /accounts/acct-1/access/apps/app-9/policies",
        "POST /accounts/acct-1/access/apps/app-9/policies",
      ],
    );
    assert.deepEqual(h.spawned, [
      "pnpm exec wrangler d1 migrations apply yoki-artifact --remote",
      "pnpm exec wrangler deploy",
      "pnpm exec wrangler deploy",
    ]);

    const policy = h.calls.find((c) => c.path.endsWith("/policies") && c.body.decision === "allow");
    assert.deepEqual(policy.body.include[1], { group: { id: "g-9" } });

    const toml = readFileSync(h.paths.wranglerToml, "utf8");
    assert.deepEqual(readWranglerValues(toml), {
      database_id: "db-9",
      ACCESS_AUD: "aud-9",
      ACCESS_TEAM_DOMAIN: PARAMS.teamDomain,
      OWNER_EMAIL: PARAMS.ownerEmail,
      SERVICE_TOKEN_NAME: "client-9",
    });

    const config = JSON.parse(readFileSync(h.paths.userConfig, "utf8"));
    assert.equal(config.accessAud, "aud-9");
    assert.equal(config.serviceTokenClientId, "client-9");
    assert.equal(config.accessGroupId, "g-9", "share/unshare reads the group id from here");
    assert.ok(!JSON.stringify(config).includes("s3cret"), "the secret is never written to disk");
    assert.equal(results.get("service-token").client_secret, "s3cret-shown-once");
    rmSync(h.dir, { recursive: true, force: true });
  });

  test("a re-run against a provisioned account calls no write endpoint", async () => {
    const h = harness();
    await runPlan(planSetup(fullState(), PARAMS), h);
    assert.deepEqual(h.calls, []);
    assert.deepEqual(h.spawned, [
      "pnpm exec wrangler d1 migrations apply yoki-artifact --remote",
      "pnpm exec wrangler deploy",
    ]);
    const config = JSON.parse(readFileSync(h.paths.userConfig, "utf8"));
    assert.equal(config.accessAud, "aud-1", "the AUD comes from the existing application");
    assert.equal(config.accessGroupId, "g-1", "and the group id from the existing group");
    rmSync(h.dir, { recursive: true, force: true });
  });

  const workerRejection = () =>
    new ApiError('POST /access/apps failed (400): 12130: worker_id "yoki-artifact" is invalid', {
      status: 400,
      errors: [{ code: 12130, message: 'worker_id "yoki-artifact" is invalid' }],
    });

  // The live failure of 2026-09: the worker destination 400s, the hostname
  // form succeeds — the run must carry on with the fallback's result.
  test("a rejected worker destination retries with the workers.dev hostname", async () => {
    const h = harness({
      ...CREATED,
      "POST /accounts/acct-1/access/apps": ({ body }) => {
        if (body.destinations) return workerRejection();
        return { id: "app-9", name: ACCESS_APP_NAME, aud: "aud-9" };
      },
      "GET /accounts/acct-1/workers/subdomain": { subdomain: "esh2n" },
    });
    const results = await runPlan(planSetup(EMPTY_STATE, PARAMS), h);

    const appCalls = h.calls.filter((c) => c.path === "/accounts/acct-1/access/apps");
    assert.equal(appCalls.length, 2, "the rejected form is retried exactly once");
    assert.deepEqual(appCalls[1].body, {
      name: ACCESS_APP_NAME,
      type: "self_hosted",
      domain: "yoki-artifact.esh2n.workers.dev",
      session_duration: "24h",
      http_only_cookie_attribute: true,
    });
    assert.ok(
      h.calls.some((c) => c.method === "GET" && c.path === "/accounts/acct-1/workers/subdomain"),
      "the subdomain is fetched, not guessed",
    );
    assert.equal(results.get("access-app").aud, "aud-9", "later steps see the fallback's application");
    const config = JSON.parse(readFileSync(h.paths.userConfig, "utf8"));
    assert.equal(config.accessAud, "aud-9");
    rmSync(h.dir, { recursive: true, force: true });
  });

  test("both forms rejected hands the step to the manual fallback", async () => {
    const h = harness({
      ...CREATED,
      "POST /accounts/acct-1/access/apps": () => workerRejection(),
      "GET /accounts/acct-1/workers/subdomain": { subdomain: "esh2n" },
    });
    const seen = [];
    await assert.rejects(
      runPlan(planSetup(EMPTY_STATE, PARAMS), {
        ...h,
        onApiError: (step, err) => seen.push([step.id, err.isValidation]),
      }),
      /worker_id "yoki-artifact" is invalid/,
    );
    assert.deepEqual(seen, [["access-app", true]]);
    const appCalls = h.calls.filter((c) => c.path === "/accounts/acct-1/access/apps");
    assert.equal(appCalls.length, 2, "the hostname form was tried before giving up");
    assert.match(manualAccessAppSteps({ ownerEmail: PARAMS.ownerEmail }), /Zero Trust > Access > Applications/);
    rmSync(h.dir, { recursive: true, force: true });
  });

  test("an unreadable subdomain fails the fallback loudly instead of guessing", async () => {
    const h = harness({
      ...CREATED,
      "POST /accounts/acct-1/access/apps": () => workerRejection(),
      // no GET workers/subdomain route: the fake returns null
    });
    const seen = [];
    await assert.rejects(
      runPlan(planSetup(EMPTY_STATE, PARAMS), {
        ...h,
        onApiError: (step) => seen.push(step.id),
      }),
      /subdomain could not be read/,
    );
    assert.deepEqual(seen, ["access-app"], "the manual fallback still gets its chance");
    rmSync(h.dir, { recursive: true, force: true });
  });

  test("a failed command stops the run instead of carrying on", async () => {
    const h = harness();
    await assert.rejects(
      runPlan(planSetup(EMPTY_STATE, PARAMS), { ...h, spawn: () => ({ status: 1 }) }),
      /exited with 1/,
    );
    rmSync(h.dir, { recursive: true, force: true });
  });
});

describe("the API client", () => {
  const fakeFetch = (status, payload) => async () => ({
    ok: status >= 200 && status < 300,
    status,
    text: async () => (payload === undefined ? "" : JSON.stringify(payload)),
  });

  test("unwraps `result` on success", async () => {
    const api = createApi({ apiToken: "t", fetchImpl: fakeFetch(200, { success: true, result: { id: "x" } }) });
    assert.deepEqual(await api.get("/accounts/a/access/apps"), { id: "x" });
  });

  test("turns an error envelope into an ApiError that knows it is a validation failure", async () => {
    const api = createApi({
      apiToken: "t",
      fetchImpl: fakeFetch(400, { success: false, errors: [{ code: 1000, message: "bad destinations" }] }),
    });
    await assert.rejects(api.call("POST", "/accounts/a/access/apps", {}), (err) => {
      assert.ok(err instanceof ApiError);
      assert.equal(err.isValidation, true);
      assert.match(err.message, /1000: bad destinations/);
      return true;
    });
  });

  test("a 403 on a listing reads as an empty list, not a crash", async () => {
    const api = createApi({ apiToken: "t", fetchImpl: fakeFetch(403, { success: false, errors: [] }) });
    const state = await discover(api, ACCOUNT);
    assert.deepEqual(state.accessApps, []);
  });

  test("an empty API token is refused before any request is made", () => {
    assert.throws(() => createApi({ apiToken: "  " }), /CLOUDFLARE_API_TOKEN is empty/);
  });
});

describe("input validation at the boundary", () => {
  test("all four environment variables are required", () => {
    assert.throws(
      () => readEnvironment({ CLOUDFLARE_API_TOKEN: "t", CLOUDFLARE_ACCOUNT_ID: "a" }),
      /missing environment variables: ACCESS_TEAM_DOMAIN, OWNER_EMAIL/,
    );
  });

  test("a team domain is normalised, a nonsense one is rejected", () => {
    assert.equal(normalizeTeamDomain("https://Acme.cloudflareaccess.com/"), "acme.cloudflareaccess.com");
    assert.equal(normalizeTeamDomain("acme"), "acme.cloudflareaccess.com");
    assert.throws(() => normalizeTeamDomain("acme.example.com"), /not a Zero Trust team domain/);
  });

  test("only the documented flags are accepted", () => {
    assert.deepEqual({ ...parseArgs(["--dry-run"]) }, { dryRun: true, yes: false, viewersFile: null });
    assert.equal(parseArgs(["--yes"]).yes, true);
    assert.equal(parseArgs(["--viewers", "list.json"]).viewersFile, "list.json");
    assert.equal(parseArgs(["--help"]).help, true);
    assert.throws(() => parseArgs(["--viewers"]), /--viewers needs a path/);
    assert.throws(() => parseArgs(["--force"]), /unknown argument: --force/);
  });

  test("a missing viewer list means no viewers, unless it was asked for by path", () => {
    const dir = mkdtempSync(join(tmpdir(), "yoki-artifact-viewers-"));
    const path = join(dir, "viewers.json");
    assert.deepEqual(readViewersFile(path), []);
    assert.throws(() => readViewersFile(path, { required: true }), /could not read the viewer list/);
    writeFileSync(path, '["a@x.test"]');
    assert.deepEqual(readViewersFile(path), ["a@x.test"]);
    rmSync(dir, { recursive: true, force: true });
  });

  test("the viewer list is validated, deduplicated and sorted", () => {
    assert.deepEqual(parseViewers('["B@x.test","a@x.test","b@x.test"]'), ["a@x.test", "b@x.test"]);
    assert.deepEqual(parseViewers('{"viewers":["a@x.test"]}'), ["a@x.test"]);
    assert.throws(() => parseViewers('["not-an-email"]'), /not an email address/);
    assert.throws(() => parseViewers("{"), /not valid JSON/);
  });
});

describe("wrangler.toml edits", () => {
  const toml = [
    'name = "yoki-artifact"',
    'database_id = "00000000-0000-0000-0000-000000000000"',
    "",
    "[vars]",
    'ACCESS_TEAM_DOMAIN = "REPLACE-team.cloudflareaccess.com"',
    'ACCESS_AUD = "REPLACE-access-application-aud"',
    'OWNER_EMAIL = "REPLACE-owner@example.com"',
    'SERVICE_TOKEN_NAME = "REPLACE-service-token-client-id"',
    "",
    "[observability]",
    "enabled = true",
    "",
  ].join("\n");

  test("only the named key changes", () => {
    const patched = patchTopLevelKey(toml, "database_id", "db-1");
    assert.match(patched, /database_id = "db-1"/);
    assert.match(patched, /name = "yoki-artifact"/);
  });

  test("vars are rewritten inside [vars] and nothing after it is touched", () => {
    const patched = patchVars(toml, { ACCESS_AUD: "aud-1", OWNER_EMAIL: "owner@example.com" });
    assert.deepEqual(readWranglerValues(patched), {
      database_id: "00000000-0000-0000-0000-000000000000",
      ACCESS_AUD: "aud-1",
      ACCESS_TEAM_DOMAIN: "REPLACE-team.cloudflareaccess.com",
      OWNER_EMAIL: "owner@example.com",
      SERVICE_TOKEN_NAME: "REPLACE-service-token-client-id",
    });
    assert.match(patched, /\[observability\]\nenabled = true/);
  });

  test("a missing key is an error, not a silent no-op", () => {
    assert.throws(() => patchTopLevelKey('name = "x"', "database_id", "db-1"), /no `database_id/);
    assert.throws(() => patchVars('name = "x"', { ACCESS_AUD: "a" }), /no \[vars\] table/);
  });
});
