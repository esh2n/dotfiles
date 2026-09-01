#!/usr/bin/env node
// yoki-artifact.mjs — argv in, one command out.
//
// This file does dispatch and nothing else: parse, build the client, run the
// command, print. Every command returns `{ json, lines }`, so `--json` is
// handled once, here, and every refusal is a `CliError` carrying the exit code
// the caller branches on.

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { CliError, EXIT, usageError } from "./lib/errors.mjs";
import { createClient } from "./lib/client.mjs";
import { loadConfig, resolveSecret } from "./lib/config.mjs";
import { nodeVersionGuardMessage, nodeVersionOk } from "./lib/node-version.mjs";
import { parseArgs } from "./lib/args.mjs";
import { USAGE } from "./lib/usage.mjs";
import { cmdList, cmdOpen, cmdRevoke, cmdShare, cmdUnshare, cmdVersions } from "./lib/cmd-artifacts.mjs";
import { cmdComments, cmdReply, cmdResolve, cmdSeen } from "./lib/cmd-comments.mjs";
import { cmdDoctor } from "./lib/cmd-doctor.mjs";
import { cmdPublish } from "./lib/cmd-publish.mjs";
import { cmdWatch } from "./lib/cmd-watch.mjs";

/** Commands that need an authenticated client. `doctor` builds its own. */
export const COMMANDS = Object.freeze({
  publish: cmdPublish,
  list: cmdList,
  versions: cmdVersions,
  revoke: cmdRevoke,
  share: cmdShare,
  unshare: cmdUnshare,
  open: cmdOpen,
  comments: cmdComments,
  reply: cmdReply,
  resolve: cmdResolve,
  seen: cmdSeen,
  watch: cmdWatch,
});

/** The config travels with the client: `share` needs `accessGroupId` from it. */
function connect(env, fetchImpl) {
  const config = loadConfig(env);
  const { secret } = resolveSecret(config, env);
  return {
    config,
    client: createClient({ baseUrl: config.baseUrl, clientId: config.clientId, secret, fetchImpl }),
  };
}

export async function run({ argv, env = process.env, stdout, stderr, fetchImpl = fetch } = {}) {
  const print = (line) => stdout.write(`${line}\n`);
  const { command, positionals, flags } = parseArgs(argv);
  const asJson = flags.json === true;

  if (flags.help === true || command === "help") {
    stdout.write(USAGE);
    return EXIT.ok;
  }
  if (command === null) {
    // No command is a usage error, but the help still goes to stdout so a
    // human piping it somewhere gets something useful.
    stdout.write(USAGE);
    return EXIT.usage;
  }

  let result;
  if (command === "doctor") {
    result = await cmdDoctor({ env, fetchImpl });
  } else {
    const handler = COMMANDS[command];
    if (handler === undefined) {
      throw usageError("unknown_command", `Unknown command "${command}". Run --help for the list.`);
    }
    // connect() throws before the handler runs when the config or the secret
    // is unusable, so no command has to re-check them.
    const { client, config } = connect(env, fetchImpl);
    result = await handler({ client, config, flags, positionals, env, print, stderr, fetchImpl });
  }

  if (asJson) {
    print(JSON.stringify({ ok: (result.exitCode ?? EXIT.ok) === EXIT.ok, ...result.json }));
  } else {
    for (const line of result.lines) print(line);
  }
  return result.exitCode ?? EXIT.ok;
}

async function main() {
  if (!nodeVersionOk(process.version)) {
    process.stderr.write(`${nodeVersionGuardMessage(process.version)}\n`);
    return EXIT.usage;
  }
  const argv = process.argv.slice(2);
  try {
    return await run({ argv, env: process.env, stdout: process.stdout, stderr: process.stderr });
  } catch (cause) {
    const asJson = argv.includes("--json");
    if (cause instanceof CliError) {
      if (asJson) {
        process.stdout.write(`${JSON.stringify({ ok: false, code: cause.code, error: cause.message })}\n`);
      } else {
        process.stderr.write(`yoki-artifact: ${cause.message}\n`);
        if (cause.detail) process.stderr.write(`${cause.detail}\n`);
      }
      return cause.exitCode;
    }
    if (asJson) {
      process.stdout.write(`${JSON.stringify({ ok: false, code: "internal", error: String(cause) })}\n`);
    } else {
      process.stderr.write(`yoki-artifact: ${cause instanceof Error ? (cause.stack ?? cause.message) : cause}\n`);
    }
    return EXIT.usage;
  }
}

// Only run when invoked as the entrypoint — importing this file (the tests do)
// must not start a command.
//
// ~/.claude/skills/yoki-artifact is a directory symlink into this repo, so in
// real use process.argv[1] is the path *through* that symlink while
// import.meta.url is the resolved one. A plain string compare would therefore
// be false, main() would never run, and the CLI would exit 0 having done
// nothing — silent success, the worst failure mode. Compare realpaths instead
// (this is the bug ui-capture's capture.mjs already had to fix). argv[1] may be
// absent or point at nothing, in which case realpathSync throws and the raw
// value is used.
function realOrSelf(p) {
  try {
    return fs.realpathSync(p);
  } catch {
    return p;
  }
}

const isMain =
  process.argv[1] !== undefined &&
  realOrSelf(path.resolve(process.argv[1])) === realOrSelf(fileURLToPath(import.meta.url));

if (isMain) {
  main().then((code) => {
    process.exitCode = code;
  });
}
