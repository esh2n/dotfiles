#!/usr/bin/env node
// teardown.mjs — delete everything setup.mjs created.
//
//   node scripts/teardown.mjs --dry-run      # show what would be deleted
//   node scripts/teardown.mjs --yes          # actually delete it
//
// There is no interactive prompt on purpose: `--yes` is the only confirmation,
// so this can never be triggered by a stray Enter. Without it the script
// prints the plan and exits non-zero.
//
// This destroys data. The D1 database holds every artifact row and the R2
// bucket every published HTML version; neither is recoverable afterwards.
// Cloudflare refuses to delete a bucket that still has objects — empty it
// first (`pnpm exec wrangler r2 object delete …`) if that step fails.

import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readFileSync } from "node:fs";

import { createApi, discover } from "./lib/cf-api.mjs";
import { isMain, runCli } from "./lib/cli.mjs";
import { VIEWERS_GROUP_NAME } from "./lib/constants.mjs";
import { parseArgs, readEnvironment } from "./lib/env.mjs";
import { EMPTY_STATE, planTeardown } from "./lib/plan.mjs";
import { renderPlan } from "./lib/render-plan.mjs";
import { readWranglerValues } from "./lib/toml.mjs";
import { runPlan } from "./lib/execute.mjs";

const WORKER_DIR = dirname(dirname(fileURLToPath(import.meta.url)));

const USAGE = `usage: node scripts/teardown.mjs (--dry-run | --yes)

  --dry-run   print what would be deleted. Makes no network calls.
  --yes       required to delete anything. There is no interactive prompt.

Deletes the Access application and its policies, the ${VIEWERS_GROUP_NAME} group,
the service token, the D1 database, the R2 bucket and the Worker.`;

export async function main(argv = process.argv.slice(2), io = { out: console.log, err: console.error }) {
  const flags = parseArgs(argv);
  if (flags.help) {
    io.out(USAGE);
    return 0;
  }
  const env = readEnvironment();
  const dirs = Object.freeze({ cwd: WORKER_DIR, wranglerToml: join(WORKER_DIR, "wrangler.toml"), userConfig: null });

  if (flags.dryRun) {
    io.out(renderPlan(planTeardown(EMPTY_STATE, { accountId: env.accountId })));
    io.out("");
    io.out("dry run: nothing was deleted.");
    return 0;
  }
  if (!flags.yes) {
    io.err("teardown deletes the D1 database, the R2 bucket and the Access application.");
    io.err("Re-run with --yes once you are sure, or with --dry-run to see the plan.");
    return 2;
  }

  const api = createApi({ apiToken: env.apiToken });
  const wranglerVars = readWranglerValues(readFileSync(dirs.wranglerToml, "utf8"));
  const existing = await discover(api, env.accountId, { wranglerVars });
  const plan = planTeardown(existing, { accountId: env.accountId });
  await runPlan(plan, { api, paths: dirs, io });
  io.out("");
  io.out("Deleted. wrangler.toml still holds the old ids — reset them before running setup again.");
  io.out("Revoke the service-token secret you stored in 1Password: it is now dead.");
  return 0;
}

if (isMain(import.meta.url)) runCli(main, "teardown");
