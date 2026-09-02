// execute.mjs — run a plan, one step at a time, in order.
//
// A step's result is remembered under its id so later steps can reference it
// (`ref("access-app", "aud")`); a skipped step contributes the resource that
// was already there, so a re-run resolves the same references without creating
// anything. Any failure stops the run: half a plan is easier to reason about
// than a plan that limped on with a missing id.

import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { ApiError } from "./cf-api.mjs";
import { SetupError } from "./env.mjs";
import { PATH_REF_RE, SUBDOMAIN_PLACEHOLDER, isRef } from "./plan.mjs";
import { patchTopLevelKey, patchVars } from "./toml.mjs";

/** Replace every `ref` in a value with what the referenced step returned. */
export function resolve(value, results) {
  if (isRef(value)) {
    const source = results.get(value.$ref);
    const resolved = source?.[value.path];
    if (resolved === undefined || resolved === null) {
      throw new SetupError(`step "${value.$ref}" did not provide "${value.path}"`);
    }
    return resolved;
  }
  if (Array.isArray(value)) return value.map((item) => resolve(item, results));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, resolve(item, results)]));
  }
  return value;
}

/** Substitute `{step-id.field}` placeholders in a request path. */
export function resolvePath(path, results) {
  return String(path).replace(PATH_REF_RE, (_match, stepId, field) => {
    const value = results.get(stepId)?.[field];
    if (value === undefined || value === null) {
      throw new SetupError(`step "${stepId}" did not provide "${field}" for the request path`);
    }
    return encodeURIComponent(value);
  });
}

/**
 * Retry an api step with its declared fallback body. Verified live 2026-09:
 * POST /access/apps with a worker destination 400s (12130) on some accounts,
 * while the self_hosted + workers.dev-hostname form succeeds — so a rejected
 * body is retried automatically instead of stopping the run. The subdomain is
 * fetched here when discovery could not read it (`subdomainPath` is set).
 */
async function runFallback(step, rejection, { api, io, results }) {
  io.err(`  rejected: ${rejection.message}`);
  io.out(`  ${step.fallback.describe}`);
  const body = { ...resolve(step.fallback.body, results) };
  if (step.fallback.subdomainPath && String(body.domain).includes(SUBDOMAIN_PLACEHOLDER)) {
    const subdomain = (await api.call("GET", step.fallback.subdomainPath))?.subdomain;
    if (typeof subdomain !== "string" || subdomain.trim() === "") {
      throw new SetupError(
        `the workers.dev subdomain could not be read (GET ${step.fallback.subdomainPath})`,
        "The fallback hostname cannot be built without it. Deploy the Worker once, or create the Access application by hand.",
      );
    }
    body.domain = body.domain.replace(SUBDOMAIN_PLACEHOLDER, subdomain.trim());
  }
  return api.call(step.method, resolvePath(step.path, results), body);
}

function runCommand(step, { cwd, io, spawn }) {
  io.out(`$ ${step.command} ${step.args.join(" ")}`);
  const result = spawn(step.command, step.args, { cwd, stdio: "inherit", env: process.env });
  if (result.error) {
    throw new SetupError(`could not run ${step.command}`, String(result.error));
  }
  if (result.status !== 0) {
    throw new SetupError(`${step.command} ${step.args.join(" ")} exited with ${result.status}`);
  }
  return null;
}

function writeWranglerToml(step, { paths, results }) {
  const values = resolve(step.values, results);
  const before = readFileSync(paths.wranglerToml, "utf8");
  const after =
    step.writer === "wrangler-vars"
      ? patchVars(before, values)
      : patchTopLevelKey(before, "database_id", values.database_id);
  writeFileSync(paths.wranglerToml, after, "utf8");
  return values;
}

function writeUserConfig(step, { paths, results }) {
  const values = resolve(step.values, results);
  const config = { ...values, updatedAt: new Date().toISOString() };
  mkdirSync(dirname(paths.userConfig), { recursive: true, mode: 0o700 });
  writeFileSync(paths.userConfig, `${JSON.stringify(config, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  return config;
}

const FILE_WRITERS = Object.freeze({
  "wrangler-database-id": writeWranglerToml,
  "wrangler-vars": writeWranglerToml,
  "user-config": writeUserConfig,
});

/**
 * @param plan  from planSetup/planTeardown
 * @param deps  {api, paths:{wranglerToml,userConfig,cwd}, io:{out,err}, spawn,
 *              onApiError} — `spawn` and `api` are seams so a test can drive a
 *              whole run without a network or a child process.
 * @returns Map of step id -> result (or the pre-existing resource, when skipped)
 */
export async function runPlan(plan, { api, paths, io, spawn = spawnSync, onApiError = null }) {
  const results = new Map();
  for (const [index, step] of plan.steps.entries()) {
    const label = `[${index + 1}/${plan.steps.length}] ${step.describe}`;
    if (step.skip) {
      io.out(`${label} — skipped (${step.skip})`);
      if (step.known) results.set(step.id, step.known);
      continue;
    }
    io.out(label);
    if (step.kind === "api") {
      const body = step.body === null ? null : resolve(step.body, results);
      try {
        results.set(step.id, await api.call(step.method, resolvePath(step.path, results), body));
      } catch (err) {
        if (err instanceof ApiError && err.isValidation && step.fallback) {
          try {
            results.set(step.id, await runFallback(step, err, { api, io, results }));
          } catch (fallbackErr) {
            // Both forms failed (or the fallback could not even be built):
            // hand the step over so the manual dashboard steps get printed.
            if (onApiError) onApiError(step, fallbackErr);
            throw fallbackErr;
          }
        } else {
          if (onApiError && err instanceof ApiError) onApiError(step, err);
          throw err;
        }
      }
    } else if (step.kind === "exec") {
      runCommand(step, { cwd: paths.cwd, io, spawn });
    } else if (step.kind === "file") {
      const writer = FILE_WRITERS[step.writer];
      if (!writer) throw new SetupError(`unknown file writer: ${step.writer}`);
      results.set(step.id, writer(step, { paths, results }));
    } else {
      throw new SetupError(`unknown step kind: ${step.kind}`);
    }
  }
  return results;
}
