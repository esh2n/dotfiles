#!/usr/bin/env bun
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ClaudeApplyPaths } from "../app/apply/apply-claude";
import type { ApplyTargetPaths } from "../app/apply/apply-tiers";
import { reportCoverage } from "../app/coverage/report-coverage";
import { resolveAuditPath, resolveStateDir } from "../app/hooks/environment";
import { reportSkillUsage } from "../app/skills/report-usage";
import type { Ports } from "../domain/ports";
import { createNodeApplyFs } from "../infra/apply/node-apply-fs";
import { JsonlAuditLog } from "../infra/audit/jsonl-audit";
import { SystemClock } from "../infra/clock/system-clock";
import { readAudit, readClaudeCalls, readCodexCalls } from "../infra/coverage/read-calls";
import { createHttpDecisionClient } from "../infra/decision/http-decision-client";
import { RemoteDecisionProvider } from "../infra/decision/remote-provider";
import { BunFileSystem } from "../infra/fs/bun-fs";
import { ConsoleLogger } from "../infra/logger/console-logger";
import { appendRouterLog } from "../infra/logs/router-log";
import { appendTierLog } from "../infra/logs/tier-log";
import { currentJudgmentKind } from "../infra/metrics/judgment-kind";
import { MetricsRegistry } from "../infra/metrics/registry";
import { BunProcessRunner } from "../infra/proc/bun-runner";
import { readSkillCatalog } from "../infra/skills/catalog";
import { findTranscripts, parseSkillTurns } from "../infra/transcripts/transcript";
import { applyCli } from "./apply";
import { codexCli } from "./codex";
import { parseCoverageArgs, renderCoverage } from "./coverage";
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

/**
 * Paths `jig apply --target claude` reads — the same three `claude-profiles`
 * layer roots yoki-switch's `merge_settings()` reads, under the same
 * `JIG_APPLY_ROOT`-overridable root `resolveApplyRoot()` uses for pi/dsh/
 * litellm, plus the real `~/.claude` (or `$CLAUDE_CONFIG_DIR`) for
 * `.claude-packs` and the reference settings.json this dry-run diffs
 * against. Never written to by this increment — see apply-claude.ts.
 */
function resolveClaudeApplyPaths(): ClaudeApplyPaths {
  const root = resolveApplyRoot();
  const profilesDir = join(root, "domains", "dev", "config", "claude-profiles");
  const claudeDir = process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude");
  const dotfilesRoot = process.env.DOTFILES_ROOT ?? root;
  return {
    packsFile: join(claudeDir, ".claude-packs"),
    packsDefaultFile: join(profilesDir, "packs.default"),
    coreDir: join(profilesDir, "core"),
    packsDir: join(profilesDir, "packs"),
    personalDir: join(profilesDir, "personal"),
    destSettingsPath: join(claudeDir, "settings.json"),
    templateVars: {
      HOME: homedir(),
      DOTFILES_ROOT: dotfilesRoot,
      USER: process.env.USER ?? "",
      DOTFILES_PARENT: dirname(dotfilesRoot),
    },
  };
}

/** Where the skill router reads the list a harness shows. Overridable for tests. */
function resolveSkillRoot(env: Record<string, string | undefined> = process.env): string {
  return env.JIG_SKILL_ROOT ?? join(homedir(), ".claude", ".skills-merged");
}

/**
 * Where the harnesses keep their session transcripts. Two directories, because the harnesses
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
    audit: new JsonlAuditLog(resolveAuditPath(process.env)),
  };
}

/**
 * How codex should invoke jig: absolute paths only, since no environment is
 * promised to a codex hook. The mise shim survives bun upgrades, but with
 * no PATH at all it mangles HOME (observed), so PATH is pinned in front.
 */
function codexRegistration(): {
  paths: { hooksJson: string; configToml: string };
  input: { command: string; matcher: string; timeoutSeconds: number };
} {
  const codexHome = process.env.CODEX_HOME ?? join(homedir(), ".codex");
  const shim = join(homedir(), ".local", "share", "mise", "shims", "bun");
  const bun = existsSync(shim) ? shim : process.execPath;
  const jig = fileURLToPath(import.meta.url);
  return {
    paths: { hooksJson: join(codexHome, "hooks.json"), configToml: join(codexHome, "config.toml") },
    input: {
      command: `/usr/bin/env PATH=/usr/bin:/bin '${bun}' '${jig}' hooks pre-tool-use --harness codex`,
      // The MCP tails let jig see the destructive Terraform/container-use tool
      // calls the ask-mcp-* rules judge; read-only MCP tools stay unmatched and
      // untaxed. (Whether codex fires PreToolUse for MCP at all is confirmed
      // per-deployment before this is relied on — see the codex MCP note.)
      matcher:
        "Bash|apply_patch|Write|Edit" +
        "|mcp__terraform__(create_|delete_|update_|attach_|detach_|action_run|add_team_member|grant_team_access|force_unlock_workspace)" +
        "|mcp__container-use__environment_(create|config|run_cmd|file_edit|file_write|file_delete|checkpoint|add_service)",
      timeoutSeconds: 10,
    },
  };
}

/** `--harness <name>` after a hook subcommand: who the adapter says is calling. */
function harnessFlag(argv: readonly string[]): string | undefined {
  const at = argv.indexOf("--harness");
  return at === -1 ? undefined : argv[at + 1];
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
        const harness = harnessFlag(argv);
        process.stdout.write(
          await preToolUse(stdin, ports, harness === undefined ? {} : { harness }),
        );
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
                appendRouterLog(join(resolveStateDir(process.env), "skill-router.jsonl"), entry),
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
      const applyPorts = createNodeApplyFs({
        stateDir: resolveStateDir(process.env),
        jigVersion: VERSION,
      });
      const result = await applyCli(argv.slice(1), applyPorts, {
        ...resolveApplyPaths(),
        claudePaths: resolveClaudeApplyPaths(),
      });
      process.stdout.write(result.stdout);
      return result.code;
    }
    case "codex": {
      const { paths, input } = codexRegistration();
      const applyPorts = createNodeApplyFs({
        stateDir: resolveStateDir(process.env),
        jigVersion: VERSION,
      });
      const result = await codexCli(argv.slice(1), applyPorts, paths, input, (text) => {
        Bun.TOML.parse(text);
      });
      process.stdout.write(result.stdout);
      return result.code;
    }
    case "report": {
      if (subcommand === "guard-coverage") {
        const parsed = parseCoverageArgs(argv.slice(2));
        if ("error" in parsed) {
          process.stderr.write(`${parsed.error}\n`);
          return 2;
        }
        const since = new Date(Date.now() - parsed.days * 24 * 60 * 60 * 1000);
        const claudeRoot = join(
          process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude"),
          "projects",
        );
        const codexRoot = join(process.env.CODEX_HOME ?? join(homedir(), ".codex"), "sessions");
        const result = await reportCoverage({
          readAudit: () => readAudit(resolveAuditPath(process.env), since),
          readRecorded: async () => [
            ...(await readClaudeCalls(claudeRoot, since)),
            ...(await readCodexCalls(codexRoot, since)),
          ],
        });
        process.stdout.write(renderCoverage(result, parsed));
        return 0;
      }
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
        recordTier: (entry) =>
          appendTierLog(join(resolveStateDir(process.env), "tier-router.jsonl"), entry),
        recordSkill: (entry) =>
          appendRouterLog(join(resolveStateDir(process.env), "skill-router.jsonl"), entry),
      });
      // The service is meant to live until launchd stops it: never resolve, so
      // the entrypoint's `process.exit` below is never reached.
      return await new Promise<never>(() => {});
    }
    default:
      process.stdout.write(
        "usage: jig <version | hooks pre-tool-use | hooks user-prompt-submit | decide | tier | serve | report skills | report guard-coverage | apply [--target pi|dsh|litellm|claude|all] [--write] | codex register [--write]>\n" +
          "  hooks user-prompt-submit picks the skill a prompt matches and returns it as context;\n" +
          "  it never blocks the prompt (empty output means no opinion).\n" +
          "  report skills [--days N] [--json] reads both harnesses' session transcripts and\n" +
          "  shows what the router injected against what the model actually opened.\n" +
          "  apply regenerates pi/models.json and dsh/settings.yaml's managed block from policy/tiers.json.\n" +
          "  dry-run by default (shows a diff, writes nothing); --write stages+renames atomically.\n" +
          "  litellm is writer+dry-run only this phase — --write is always refused there; apply that\n" +
          "  target's config.yaml change by hand after reviewing the diff.\n" +
          "  claude composes settings.json from claude-profiles' core/packs/personal layers (same\n" +
          "  layers yoki-switch reads) and diffs it against the real settings.json — dry-run only\n" +
          "  this phase, --write is always refused; not part of --target all yet.\n" +
          "  Machine delivery is unchanged: this writes the repo files jig's existing symlink\n" +
          "  machinery already points pi/dsh at — it does not itself install or symlink anything.\n",
      );
      return command === undefined ? 0 : 1;
  }
}

if (import.meta.main) {
  main(Bun.argv.slice(2)).then((code) => process.exit(code));
}
