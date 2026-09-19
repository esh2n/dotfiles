#!/usr/bin/env bun
import type { Ports } from "../domain/ports";
import { SystemClock } from "../infra/clock/system-clock";
import { createHttpDecisionClient } from "../infra/decision/http-decision-client";
import { RemoteDecisionProvider } from "../infra/decision/remote-provider";
import { BunFileSystem } from "../infra/fs/bun-fs";
import { ConsoleLogger } from "../infra/logger/console-logger";
import { MetricsRegistry } from "../infra/metrics/registry";
import { BunProcessRunner } from "../infra/proc/bun-runner";
import { decide } from "./decide";
import { preToolUse } from "./hooks/pre-tool-use";
import { buildJudgmentProvider, serveDecisionService } from "./serve";
import { tier } from "./tier";

const VERSION = "0.0.0";

/** Where the harness-side loopback client looks for the judgment service. */
const DEFAULT_DECISION_URL = "http://127.0.0.1:4100/decide";

/** Where the judgment service itself listens. */
const DEFAULT_DECISION_PORT = 4100;

type LogLevel = "debug" | "info" | "warn" | "error";

/** Composition root: build the concrete adapters and hand them to use-cases. */
export function buildPorts(): Ports {
  const logger = new ConsoleLogger((process.env.JIG_LOG_LEVEL as LogLevel | undefined) ?? "info");
  return {
    logger,
    clock: new SystemClock(),
    fs: new BunFileSystem(),
    proc: new BunProcessRunner(),
    // The harness never holds the judgment key: it gets a client pointed at the
    // judgment service on the loopback, which is the one process doing the
    // credentialed call. Constructing it does not connect, so a harness with no
    // service running still starts and its guard rails still work.
    decision: new RemoteDecisionProvider({
      client: createHttpDecisionClient({
        url: process.env.JIG_DECISION_URL ?? DEFAULT_DECISION_URL,
        logger,
      }),
    }),
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
        process.stdout.write(await preToolUse(stdin, ports));
        return 0;
      }
      ports.logger.error("unknown hook subcommand", { subcommand });
      return 2;
    }
    case "decide": {
      const stdin = await new Response(Bun.stdin.stream()).text();
      const result = await decide(stdin, ports.decision, ports.logger);
      process.stdout.write(result.stdout);
      process.stderr.write(result.stderr);
      return result.code;
    }
    case "tier": {
      const stdin = await new Response(Bun.stdin.stream()).text();
      const threshold = Number.parseFloat(process.env.JIG_TIER_THRESHOLD ?? "");
      const result = await tier(stdin, ports.decision, {
        logger: ports.logger,
        clock: ports.clock,
        ...(Number.isFinite(threshold) ? { options: { threshold } } : {}),
      });
      process.stdout.write(result.stdout);
      process.stderr.write(result.stderr);
      return result.code;
    }
    case "serve": {
      const port =
        Number.parseInt(process.env.JIG_DECISION_PORT ?? "", 10) || DEFAULT_DECISION_PORT;
      // One registry for the process: the provider's usage hook feeds the same
      // counters that `/metrics` renders, so what Prometheus scrapes is the spend.
      const metrics = new MetricsRegistry();
      const provider = buildJudgmentProvider(process.env, (usage) => {
        ports.logger.info("decision.usage", { ...usage });
        metrics.countTokens(usage.model, "input", usage.input_tokens);
        metrics.countTokens(usage.model, "output", usage.output_tokens);
      });
      serveDecisionService({
        provider,
        port,
        logger: ports.logger,
        clock: ports.clock,
        metrics,
      });
      // The service is meant to live until launchd stops it: never resolve, so
      // the entrypoint's `process.exit` below is never reached.
      return await new Promise<never>(() => {});
    }
    default:
      process.stdout.write("usage: jig <version | hooks pre-tool-use | decide | tier | serve>\n");
      return command === undefined ? 0 : 1;
  }
}

if (import.meta.main) {
  main(Bun.argv.slice(2)).then((code) => process.exit(code));
}
