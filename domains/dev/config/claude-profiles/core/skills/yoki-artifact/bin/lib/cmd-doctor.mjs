// cmd-doctor.mjs — "why doesn't this work?", answered in three checks.
//
// Unlike every other command, doctor must survive its own failures: it runs
// each check, records ok/failed, and never lets a broken config abort the
// report. It is the one command that builds its own client, because a missing
// config is exactly what it exists to diagnose.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { EXIT } from "./errors.mjs";
import { createClient } from "./client.mjs";
import { configPath, loadConfig, resolveSecret } from "./config.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** bin/lib -> skill root -> worker/SETUP.md */
export const SETUP_DOC = path.join(HERE, "..", "..", "worker", "SETUP.md");

/** Shown when worker/SETUP.md is not next to the CLI (a partial install). */
export const FALLBACK_HINTS = [
  "Setup checklist:",
  "  1. Deploy the Worker: cd worker && pnpm wrangler deploy",
  "     (needs CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID in the environment)",
  "  2. Put the Worker behind a Cloudflare Access application, and set",
  "     ACCESS_TEAM_DOMAIN / ACCESS_AUD / OWNER_EMAIL on the Worker.",
  "  3. Create an Access service token and add it to that application's policy",
  "     (Service Auth), otherwise every request is redirected to the login page.",
  "  4. Write ~/.config/yoki-artifact/config.json with baseUrl + clientId, and",
  "     provide the secret via YOKI_ARTIFACT_CLIENT_SECRET or secretCommand.",
];

/** SETUP.md is a full guide; a failing doctor gets the head of it, not all of it. */
export const HINT_LINE_LIMIT = 30;

export function setupHints(file = SETUP_DOC) {
  let text = "";
  try {
    text = fs.readFileSync(file, "utf8").trim();
  } catch {
    // No SETUP.md next to the CLI (a partial install) — use the built-in list.
  }
  if (text === "") return FALLBACK_HINTS;

  const lines = text.split("\n");
  const head = lines.slice(0, HINT_LINE_LIMIT);
  return [
    `Setup notes (${file}):`,
    ...head,
    ...(lines.length > head.length ? [`… ${lines.length - head.length} more lines in ${file}`] : []),
  ];
}

const ok = (name, detail) => Object.freeze({ name, ok: true, detail });
const failed = (name, detail) => Object.freeze({ name, ok: false, detail });

export async function cmdDoctor({ env = process.env, fetchImpl = fetch } = {}) {
  const checks = [];
  let config = null;
  let secret = null;

  try {
    config = loadConfig(env);
    checks.push(
      ok("config", `baseUrl from ${config.sources.baseUrl}, clientId from ${config.sources.clientId} (${config.file})`),
    );
  } catch (cause) {
    checks.push(failed("config", cause.message));
  }

  if (config === null) {
    checks.push(failed("secret", `skipped — no usable config (${configPath(env)})`));
    checks.push(failed("api", "skipped — no usable config"));
  } else {
    try {
      const resolved = resolveSecret(config, env);
      secret = resolved.secret;
      checks.push(ok("secret", `resolved from ${resolved.source === "env" ? "the environment" : "secretCommand"}`));
    } catch (cause) {
      checks.push(failed("secret", cause.message));
    }

    if (secret === null) {
      checks.push(failed("api", "skipped — no client secret"));
    } else {
      const client = createClient({ baseUrl: config.baseUrl, clientId: config.clientId, secret, fetchImpl });
      try {
        const { body } = await client.request("GET", "/api/artifacts");
        const count = Array.isArray(body?.artifacts) ? body.artifacts.length : 0;
        checks.push(ok("api", `GET ${config.baseUrl}/api/artifacts -> ${count} artifact(s)`));
      } catch (cause) {
        checks.push(failed("api", cause.message));
      }
    }
  }

  const healthy = checks.every((check) => check.ok);
  const configOk = checks[0].ok && (checks[1]?.ok ?? false);
  const lines = checks.map((check) => `${check.ok ? "ok  " : "FAIL"}  ${check.name}: ${check.detail}`);

  return Object.freeze({
    exitCode: healthy ? EXIT.ok : configOk ? EXIT.network : EXIT.usage,
    json: Object.freeze({ ok: healthy, checks: Object.freeze(checks), hints: healthy ? [] : setupHints() }),
    lines: healthy ? lines : [...lines, "", ...setupHints()],
  });
}
