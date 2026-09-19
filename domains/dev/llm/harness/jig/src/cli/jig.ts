#!/usr/bin/env bun
import type { Ports } from "../domain/ports";
import { SystemClock } from "../infra/clock/system-clock";
import { BunFileSystem } from "../infra/fs/bun-fs";
import { ConsoleLogger } from "../infra/logger/console-logger";
import { BunProcessRunner } from "../infra/proc/bun-runner";
import { preToolUse } from "./hooks/pre-tool-use";

const VERSION = "0.0.0";

type LogLevel = "debug" | "info" | "warn" | "error";

/** Composition root: build the concrete adapters and hand them to use-cases. */
export function buildPorts(): Ports {
  return {
    logger: new ConsoleLogger((process.env.JIG_LOG_LEVEL as LogLevel | undefined) ?? "info"),
    clock: new SystemClock(),
    fs: new BunFileSystem(),
    proc: new BunProcessRunner(),
  };
}

export async function main(argv: readonly string[]): Promise<number> {
  const [command, subcommand] = argv;
  const ports = buildPorts();

  switch (command) {
    case "version":
    case "--version":
      process.stdout.write(`jig ${VERSION}\n`);
      return 0;
    case "hooks": {
      if (subcommand === "pre-tool-use") {
        const stdin = await new Response(Bun.stdin.stream()).text();
        process.stdout.write(preToolUse(stdin, ports));
        return 0;
      }
      ports.logger.error("unknown hook subcommand", { subcommand });
      return 2;
    }
    default:
      process.stdout.write("usage: jig <version | hooks pre-tool-use>\n");
      return command === undefined ? 0 : 1;
  }
}

if (import.meta.main) {
  main(Bun.argv.slice(2)).then((code) => process.exit(code));
}
