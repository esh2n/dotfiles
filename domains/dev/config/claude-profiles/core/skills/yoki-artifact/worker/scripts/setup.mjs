#!/usr/bin/env node
// setup.mjs — one-time provisioning for the yoki-artifact Worker.
//
//   CLOUDFLARE_API_TOKEN=… CLOUDFLARE_ACCOUNT_ID=… \
//   ACCESS_TEAM_DOMAIN=acme.cloudflareaccess.com OWNER_EMAIL=me@example.com \
//   node scripts/setup.mjs [--dry-run] [--viewers path/to/viewers.json]
//
// What it does is described by scripts/lib/plan.mjs and printed in full by
// `--dry-run`, which makes no network calls at all: it plans as if nothing
// existed yet, so it is safe to run with a throwaway token.
//
// Re-running is safe. Resources are found by name, so a second run creates
// nothing and only re-applies migrations, the deploy and the local files.
//
// The prerequisites that cannot be automated — Zero Trust onboarding, the
// Google and GitHub identity providers, R2 activation, the API token itself —
// are in SETUP.md. Read that first.

import { fileURLToPath } from "node:url";
import { dirname, join, resolve as resolvePath } from "node:path";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";

import { createApi, discover } from "./lib/cf-api.mjs";
import { isMain, runCli } from "./lib/cli.mjs";
import {
  CLIENT_SECRET_ENV,
  USER_CONFIG_DIR,
  USER_CONFIG_FILE,
  VIEWERS_FILE,
  VIEWERS_GROUP_NAME,
} from "./lib/constants.mjs";
import { SetupError, parseArgs, readEnvironment, readViewersFile } from "./lib/env.mjs";
import { EMPTY_STATE, planSetup } from "./lib/plan.mjs";
import { manualAccessAppSteps } from "./lib/manual-steps.mjs";
import { renderPlan } from "./lib/render-plan.mjs";
import { readWranglerValues } from "./lib/toml.mjs";
import { runPlan } from "./lib/execute.mjs";

const WORKER_DIR = dirname(dirname(fileURLToPath(import.meta.url)));

const USAGE = `usage: node scripts/setup.mjs [--dry-run] [--viewers <path>]

  --dry-run          print every API call, command and file write, then exit.
                     Makes no network calls.
  --viewers <path>   JSON array of viewer emails (default: ./${VIEWERS_FILE})

Required environment: CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID,
ACCESS_TEAM_DOMAIN, OWNER_EMAIL. See SETUP.md.`;

function paths(viewersFile) {
  return Object.freeze({
    cwd: WORKER_DIR,
    wranglerToml: join(WORKER_DIR, "wrangler.toml"),
    userConfig: join(homedir(), USER_CONFIG_DIR, USER_CONFIG_FILE),
    viewers: viewersFile ? resolvePath(process.cwd(), viewersFile) : join(WORKER_DIR, VIEWERS_FILE),
  });
}

function localWranglerValues(tomlPath) {
  try {
    return readWranglerValues(readFileSync(tomlPath, "utf8"));
  } catch (cause) {
    throw new SetupError(`could not read ${tomlPath}`, String(cause));
  }
}

/** The service-token secret is shown exactly once, on stderr, and never stored. */
function reportServiceToken(results, io) {
  const token = results.get("service-token");
  if (!token) return;
  io.out(`service token client id: ${token.client_id ?? "(unchanged)"}`);
  if (!token.client_secret) {
    io.out("service token secret: unchanged (Cloudflare shows it only at creation)");
    return;
  }
  io.err("");
  io.err("=== service token secret — shown once, right now ===");
  io.err(token.client_secret);
  io.err("");
  io.err(`Store it in 1Password now, and export it as ${CLIENT_SECRET_ENV} for the CLI.`);
  io.err("It is not written to config.json and cannot be read back from Cloudflare.");
  io.err("");
}

/**
 * The Access group id goes into config.json so `yoki-artifact share/unshare`
 * can update the edge allow-list itself, instead of leaving it to the next
 * setup run. Without it the CLI refuses (exit 2) and prints the manual step.
 */
function reportViewersGroup(results, io) {
  const group = results.get("viewers-group");
  if (!group?.id) return;
  io.out(`Access group ${VIEWERS_GROUP_NAME}: ${group.id} (recorded as accessGroupId)`);
}

export async function main(argv = process.argv.slice(2), io = { out: console.log, err: console.error }) {
  const flags = parseArgs(argv);
  if (flags.help) {
    io.out(USAGE);
    return 0;
  }
  const env = readEnvironment();
  const dirs = paths(flags.viewersFile);
  const viewers = readViewersFile(dirs.viewers, { required: Boolean(flags.viewersFile) });
  const wranglerVars = localWranglerValues(dirs.wranglerToml);
  const params = { accountId: env.accountId, teamDomain: env.teamDomain, ownerEmail: env.ownerEmail, viewers };

  if (flags.dryRun) {
    io.out(renderPlan(planSetup({ ...EMPTY_STATE, wranglerVars }, params)));
    io.out("");
    io.out("dry run: nothing was created, deployed or written.");
    return 0;
  }

  const api = createApi({ apiToken: env.apiToken });
  const existing = await discover(api, env.accountId, { wranglerVars });
  const plan = planSetup(existing, params);
  const results = await runPlan(plan, {
    api,
    paths: dirs,
    io,
    onApiError: (step, err) => {
      if (step.id === "access-app" && err.isValidation) io.err(manualAccessAppSteps({ ownerEmail: env.ownerEmail }));
    },
  });
  reportServiceToken(results, io);
  reportViewersGroup(results, io);
  io.out(`wrote ${dirs.userConfig}`);
  return 0;
}

if (isMain(import.meta.url)) runCli(main, "setup");
