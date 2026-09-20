#!/usr/bin/env bun
import { homedir } from "node:os";
import { join } from "node:path";
import type { ApplyTargetPaths } from "../app/apply/apply-tiers";
import { reportSkillUsage } from "../app/skills/report-usage";
import type { Ports } from "../domain/ports";
import { createNodeApplyFs } from "../infra/apply/node-apply-fs";
import { SystemClock } from "../infra/clock/system-clock";
import { createHttpDecisionClient } from "../infra/decision/http-decision-client";
import { RemoteDecisionProvider } from "../infra/decision/remote-provider";
import { BunFileSystem } from "../infra/fs/bun-fs";
import { appendRouterLog } from "../infra/logs/router-log";
import { ConsoleLogger } from "../infra/logger/console-logger";
import { currentJudgmentKind } from "../infra/metrics/judgment-kind";
import { MetricsRegistry } from "../infra/metrics/registry";
import { BunProcessRunner } from "../infra/proc/bun-runner";
import { readSkillCatalog } from "../infra/skills/catalog";
import { findTranscripts, parseSkillTurns } from "../infra/transcripts/transcript";
import { applyCli } from "./apply";
import { decide } from "./decide";
import { preToolUse } from "./hooks/pre-tool-use";
import { userPromptSubmit } from "./hooks/user-prompt-submit";
import { parseReportArgs, renderSkillUsage } from "./report";
import { buildJudgmentProvider, serveDecisionService } from "./serve";
import { tier } from "./tier";

const VERSION = "0.0.0";

/**
 * Repo root `jig apply`'s destination paths are resolved against — found
 * relative to this file (`src/cli/`) rather than `process.cwd()`, since jig
 * may be invoked from anywhere. `JIG_APPLY_ROOT` overrides it for tests (and
 * for anyone dry-running apply against a scratch copy of the repo).
 */
function resolveApplyRoot(): string {
  return (
    process.env.JIG_APPLY_ROOT ?? join(import.meta.dir, "..", "..", "..", "..", "..", "..", "..")
  );
}

function resolveApplyPaths(): { tiersJsonPath: string; destPaths: ApplyTargetPaths } {
  const root = resolveApplyRoot();
  return {
    tiersJsonPath: join(root, "domains", "dev", "llm", "harness", "policy", "tiers.json"),
    destPaths: {
      pi: join(root, "domains", "dev", "config", "pi", "models.json"),
      dsh: join(root, "domains", "dev", "config", "dsh", "settings.yaml"),
      litellm: join(root, "domains", "dev", "config", "litellm", "config.yaml"),
    },
  };
}

/** Where the skill router reads the list a harness shows. Overridable for tests. */
function resolveSkillRoot(env: Record<string, string | undefined> = process.env): string {
  return env.JIG_SKILL_ROOT ?? join(homedir(), ".claude", ".skills-merged");
}

/** `JIG_STATE_DIR` overrides where the hand-edit-detection manifest lives, for tests. */
function resolveStateDir(): string {
  return process.env.JIG_STATE_DIR ?? join(homedir(), ".local", "state", "jig");
}

/**
 * Where the fronts keep their session transcripts. Two directories, because the fronts
 * are two programs; each honors its own override first (`PI_CODING_AGENT_SESSION_DIR`,
 * `CLAUDE_CONFIG_DIR`) so a moved session tree keeps working, then jig's override.
 */
function resolveSessionRoots(env: Record<string, string | undefined> = process.env): string[] {
  const pi =
    env.JIG_PI_SESSIONS ??
    env.PI_CODING_AGENT_SESSION_DIR ??
    join(homedir(), ".pi", "agent", "sessions");
  const claudeProjects =
    env.JIG_CLAUDE_PROJECTS ??
    join(env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude"), "projects");
  return env.JIG_SESSION_ROOTS === undefined
    ? [pi, claudeProjects]
    : env.JIG_SESSION_ROOTS.split(":").filter((entry) => entry !== "");
}

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
      if (subcommand === "user-prompt-submit") {
        const stdin = await new Response(Bun.stdin.stream()).text();
        const threshold = Number.parseFloat(process.env.JIG_SKILL_ROUTER_THRESHOLD ?? "");
        process.stdout.write(
          await userPromptSubmit(
            stdin,
            {
              provider: ports.decision,
              catalog: () => readSkillCatalog(resolveSkillRoot()),
              record: (entry) =>
                appendRouterLog(join(resolveStateDir(), "skill-router.jsonl"), entry),
              logger: ports.logger,
            },
            Number.isFinite(threshold) ? { threshold } : {},
          ),
        );
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
    case "apply": {
      const applyPorts = createNodeApplyFs({ stateDir: resolveStateDir(), jigVersion: VERSION });
      const result = await applyCli(argv.slice(1), applyPorts, resolveApplyPaths());
      process.stdout.write(result.stdout);
      return result.code;
    }
    case "report": {
      if (subcommand !== "skills") {
        ports.logger.error("unknown report", { subcommand });
        return 2;
      }
      const parsed = parseReportArgs(argv.slice(2));
      if ("error" in parsed) {
        process.stderr.write(`${parsed.error}\n`);
        return 2;
      }
      const since = new Date(Date.now() - parsed.days * 24 * 60 * 60 * 1000);
      const files = await findTranscripts(resolveSessionRoots(), { since });
      const known = new Set(
        (await readSkillCatalog(resolveSkillRoot())).map((skill) => skill.name),
      );
      const { report } = await reportSkillUsage({
        files,
        parse: (text, session) => parseSkillTurns(text, session, known),
        read: (path) => Bun.file(path).text(),
      });
      process.stdout.write(renderSkillUsage(report, parsed));
      return 0;
    }
    case "serve": {
      const port =
        Number.parseInt(process.env.JIG_DECISION_PORT ?? "", 10) || DEFAULT_DECISION_PORT;
      // One registry for the process: the provider's usage hook feeds the same
      // counters that `/metrics` renders, so what Prometheus scrapes is the spend.
      const metrics = new MetricsRegistry();
      const provider = buildJudgmentProvider(process.env, (usage) => {
        // The kind comes from the async context of the request being served, so
        // these counts answer per-endpoint cost and not just total spend.
        const kind = currentJudgmentKind() ?? "unknown";
        ports.logger.info("decision.usage", { ...usage, kind });
        metrics.countTokens(usage.model, "input", usage.input_tokens, kind);
        metrics.countTokens(usage.model, "output", usage.output_tokens, kind);
      });
      serveDecisionService({
        provider,
        port,
        logger: ports.logger,
        clock: ports.clock,
        metrics,
        // The `/skill` path has no client-side record — the harness that calls it decides
        // nothing — so the service is the only place that judgment can be written down.
        recordSkill: (entry) =>
          appendRouterLog(join(resolveStateDir(), "skill-router.jsonl"), entry),
      });
      // The service is meant to live until launchd stops it: never resolve, so
      // the entrypoint's `process.exit` below is never reached.
      return await new Promise<never>(() => {});
    }
    default:
      process.stdout.write(
        "usage: jig <version | hooks pre-tool-use | hooks user-prompt-submit | decide | tier | serve | report skills | apply [--target pi|dsh|litellm|all] [--write]>\n" +
          "  hooks user-prompt-submit picks the skill a prompt matches and returns it as context;\n" +
          "  it never blocks the prompt (empty output means no opinion).\n" +
          "  report skills [--days N] [--json] reads both fronts' session transcripts and\n" +
          "  shows what the router injected against what the model actually opened.\n" +
          "  apply regenerates pi/models.json and dsh/settings.yaml's managed block from policy/tiers.json.\n" +
          "  dry-run by default (shows a diff, writes nothing); --write stages+renames atomically.\n" +
          "  litellm is writer+dry-run only this phase — --write is always refused there; apply that\n" +
          "  target's config.yaml change by hand after reviewing the diff.\n" +
          "  Machine delivery is unchanged: this writes the repo files jig's existing symlink\n" +
          "  machinery already points pi/dsh at — it does not itself install or symlink anything.\n",
      );
      return command === undefined ? 0 : 1;
  }
}

if (import.meta.main) {
  main(Bun.argv.slice(2)).then((code) => process.exit(code));
}
