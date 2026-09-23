#!/usr/bin/env bun
import { existsSync } from "node:fs";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ClaudeApplyPaths } from "../app/apply/apply-claude";
import type { CodexApplyOptions, CodexApplyPaths } from "../app/apply/apply-codex";
import type { DshApplyPaths } from "../app/apply/apply-dsh";
import type { OmpApplyOptions, OmpApplyPaths } from "../app/apply/apply-omp";
import type { PiApplyPaths } from "../app/apply/apply-pi";
import type { ApplyTargetPaths } from "../app/apply/apply-tiers";
import type { BoxPorts } from "../app/box/ports";
import { reportCoverage } from "../app/coverage/report-coverage";
import { resolveAuditPath, resolveSessionsPath, resolveStateDir } from "../app/hooks/environment";
import { skillQuestionMode } from "../app/routing/select-skills";
import { reportSkillUsage } from "../app/skills/report-usage";
import type { SkillRootPorts } from "../app/skills/toggle-invocation";
import { type AgentModels, parseAgentModels } from "../domain/claude/agent-models";
import type { ClaudeHookPaths } from "../domain/claude/hooks";
import { DSH_PROFILES_DIR, DSH_PROFILE_PATCH_FILENAME, resolveDshHome } from "../domain/dsh/home";
import { resolveOmpAgentDir } from "../domain/omp/agent-dir";
import { resolvePiAgentDir } from "../domain/pi/agent-dir";
import { PI_MCP_USER_CONFIG } from "../domain/pi/mcp";
import type { Ports } from "../domain/ports";
import { createNodeApplyFs } from "../infra/apply/node-apply-fs";
import { JsonlAuditLog } from "../infra/audit/jsonl-audit";
import { createGitRunner } from "../infra/box/git-cli";
import { createJigSourceReader } from "../infra/box/jig-source";
import { createKitWriter } from "../infra/box/kit-writer";
import { createSbxRunner } from "../infra/box/sbx-cli";
import { SystemClock } from "../infra/clock/system-clock";
import { readAudit, readClaudeCalls, readCodexCalls } from "../infra/coverage/read-calls";
import { createHttpDecisionClient } from "../infra/decision/http-decision-client";
import { RemoteDecisionProvider } from "../infra/decision/remote-provider";
import { BunFileSystem } from "../infra/fs/bun-fs";
import { commandExists, createPrompter, spawnHarness } from "../infra/interactive/prompter";
import { ConsoleLogger } from "../infra/logger/console-logger";
import { appendRouterLog } from "../infra/logs/router-log";
import { appendSessionLog } from "../infra/logs/session-log";
import { appendTierLog } from "../infra/logs/tier-log";
import { currentJudgmentKind } from "../infra/metrics/judgment-kind";
import { recordJudgmentUsage } from "../infra/metrics/judgment-usage";
import { MetricsRegistry } from "../infra/metrics/registry";
import { BunProcessRunner } from "../infra/proc/bun-runner";
import { runCommand } from "../infra/proc/exec-file";
import { readSkillCatalog } from "../infra/skills/catalog";
import { detectRepoSignals } from "../infra/skills/repo-signals";
import { findTranscripts, parseSkillTurns } from "../infra/transcripts/transcript";
import { applyCli } from "./apply";
import { type BoxCliContext, boxCli } from "./box";
import { codexCli } from "./codex";
import { parseCoverageArgs, renderCoverage } from "./coverage";
import { decide } from "./decide";
import { postToolUseFormat } from "./hooks/post-tool-use-format";
import { preToolUse } from "./hooks/pre-tool-use";
import { sessionStart } from "./hooks/session-start";
import { stopGate } from "./hooks/stop-gate";
import { userPromptSubmit } from "./hooks/user-prompt-submit";
import { interactive } from "./interactive";
import { parseReportArgs, renderSkillUsage } from "./report";
import { buildJudgmentProvider, serveDecisionService } from "./serve";
import { skillsCli } from "./skills";
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

/** The harness source tree: `domains/dev/llm/harness/`, the one place sources live. */
function harnessRoot(): string {
  return join(resolveApplyRoot(), "domains", "dev", "llm", "harness");
}

/**
 * Where the Claude Code target reads from and writes to.
 *
 * `CLAUDE_CONFIG_DIR` is honored for the destination because Claude Code
 * honors it: a machine that moved its configuration directory must not have
 * jig quietly compose a second settings.json at the default path. The
 * symlink targets are absolute under the harness root, so they hold from
 * wherever `~/.claude` is.
 */
function resolveClaudeApplyPaths(): ClaudeApplyPaths {
  const harness = harnessRoot();
  const claudeDir = process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude");
  return {
    harnessRoot: harness,
    guardRules: join(harness, "policy", "guard-rules.json"),
    mcpServers: join(harness, "mcp", "servers.json"),
    sandbox: join(harness, "policy", "sandbox.json"),
    decisions: join(harness, "rules", "decisions"),
    settings: join(claudeDir, "settings.json"),
    agentsMd: join(claudeDir, "AGENTS.md"),
    claudeMd: join(claudeDir, "CLAUDE.md"),
    skills: join(claudeDir, "skills"),
    agents: join(claudeDir, "agents"),
    rulesDir: join(claudeDir, "rules"),
    commands: join(claudeDir, "commands"),
    home: homedir(),
  };
}

/**
 * Where the Codex target reads from and writes to.
 *
 * `CODEX_HOME` is honored for the same reason `CLAUDE_CONFIG_DIR` is: Codex
 * honors it, so a moved configuration directory must not get a second copy
 * at the default path. `~/.agents/skills` is not under it — it is the user
 * scope of Codex's skill discovery (https://learn.chatgpt.com/docs/build-skills)
 * and the directory pi and omp read, so it lives under `$HOME` whatever
 * `CODEX_HOME` says. The former skill roots are the `claude-profiles/` tree
 * yoki-switch linked from before the sources moved (milestone 2); links
 * under it are stale, not somebody's.
 */
function resolveCodexApplyPaths(): CodexApplyPaths {
  const harness = harnessRoot();
  const codexHome = process.env.CODEX_HOME ?? join(homedir(), ".codex");
  return {
    harnessRoot: harness,
    mcpServers: join(harness, "mcp", "servers.json"),
    decisions: join(harness, "rules", "decisions"),
    formerSkillRoots: [join(resolveApplyRoot(), "domains", "dev", "config", "claude-profiles")],
    agentsSkills: join(homedir(), ".agents", "skills"),
    codexSkills: join(codexHome, "skills"),
    agentsMd: join(codexHome, "AGENTS.md"),
    agentsDir: join(codexHome, "agents"),
    configToml: join(codexHome, "config.toml"),
    hooksJson: join(codexHome, "hooks.json"),
    home: homedir(),
  };
}

/**
 * `agents/models.json`: the ruled Claude-tier → model table the Codex and
 * omp targets read (`domain/claude/agent-models.ts`; the file's `_comment`
 * carries the ruling, the prices and the sources). It is a source like
 * `mcp/servers.json`, so a missing or malformed file is an error naming it,
 * never an empty map: `policy/tiers.json` maps tiers to the proxy's
 * backends, not to another harness's ids, and the generator never guesses.
 */
async function readAgentModels(): Promise<{ readonly path: string; readonly models: AgentModels }> {
  const path = join(harnessRoot(), "agents", "models.json");
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch {
    throw new Error(`jig apply: agent model table not found at ${path}`);
  }
  return { path, models: parseAgentModels(text, path) };
}

/**
 * What the Codex target needs beyond its paths: the `codex` table of
 * `agents/models.json`, and TOML validation of every generated file with
 * Bun's parser before it is written.
 */
function codexApplyOptions(
  agentModels: Awaited<ReturnType<typeof readAgentModels>>,
): CodexApplyOptions {
  return {
    codexModels: agentModels.models.codex,
    modelsSource: agentModels.path,
    validateToml: (text) => {
      Bun.TOML.parse(text);
    },
  };
}

/**
 * Where the omp target reads from and writes to.
 *
 * The agent directory follows omp's own rules (`domain/omp/agent-dir.ts`:
 * `PI_CODING_AGENT_DIR`, `OMP_PROFILE`/`PI_PROFILE`, `PI_CONFIG_DIR`), for
 * the reason the other two targets honour their overrides. `~/.agents/skills`
 * is the same mount the Codex target delivers, under `$HOME` whatever the
 * agent directory is. The extension target is jig's own omp adapter inside
 * this checkout, linked by absolute path so the link holds from wherever
 * the agent directory is.
 */
function resolveOmpApplyPaths(): OmpApplyPaths {
  const harness = harnessRoot();
  const agentDir = resolveOmpAgentDir(process.env, homedir()).dir;
  return {
    harnessRoot: harness,
    mcpServers: join(harness, "mcp", "servers.json"),
    formerSkillRoots: [join(resolveApplyRoot(), "domains", "dev", "config", "claude-profiles")],
    agentsSkills: join(homedir(), ".agents", "skills"),
    agentDir,
    agentsDir: join(agentDir, "agents"),
    mcpJson: join(agentDir, "mcp.json"),
    extensionsDir: join(agentDir, "extensions"),
    extensionTarget: join(harness, "jig", "adapters", "omp", "src", "index.ts"),
    home: homedir(),
  };
}

/**
 * What the omp target needs beyond its paths: the `omp` table of
 * `agents/models.json` — empty until ruled, because omp wants a
 * provider-qualified selector or a `modelRoles` alias and no ruling has
 * named one; filling that table is the whole change. The frontmatter is
 * validated as YAML with Bun's parser before a file is written, so a
 * description that breaks the frontmatter is refused here rather than
 * dropped by omp at discovery.
 */
function ompApplyOptions(
  agentModels: Awaited<ReturnType<typeof readAgentModels>>,
): OmpApplyOptions {
  return {
    ompModels: agentModels.models.omp,
    validateFrontmatter: (yaml) => {
      Bun.YAML.parse(yaml);
    },
  };
}

/**
 * Where the pi target's agent-directory half reads from and writes to.
 *
 * The agent directory follows pi's own rule (`domain/pi/agent-dir.ts`:
 * `PI_CODING_AGENT_DIR`, else `~/.pi/agent`). `~/.agents/skills` is the
 * mount the Codex and omp targets deliver, under `$HOME` whatever the agent
 * directory is. The MCP file is pi-mcp-adapter's user-global shared config,
 * `~/.config/mcp/mcp.json` as its README spells it (`domain/pi/mcp.ts`; no
 * XDG variable is documented, so none is honoured). The repo-side paths
 * name what `core/config/manager.sh link_pi_resources` links today: the
 * settings file (read as the `packages` source), the extensions directory
 * (reported), and the AGENTS.md that retires.
 */
function resolvePiApplyPaths(): PiApplyPaths {
  const harness = harnessRoot();
  const agentDir = resolvePiAgentDir(process.env, homedir()).dir;
  const repoPi = join(resolveApplyRoot(), "domains", "dev", "config", "pi");
  return {
    harnessRoot: harness,
    mcpServers: join(harness, "mcp", "servers.json"),
    decisions: join(harness, "rules", "decisions"),
    formerSkillRoots: [join(resolveApplyRoot(), "domains", "dev", "config", "claude-profiles")],
    agentsSkills: join(homedir(), ".agents", "skills"),
    agentDir,
    agentsMd: join(agentDir, "AGENTS.md"),
    mcpJson: join(homedir(), PI_MCP_USER_CONFIG),
    adapterOverride: join(agentDir, "mcp.json"),
    extensionsDir: join(agentDir, "extensions"),
    repoExtensionsDir: join(repoPi, "extensions"),
    repoSettings: join(repoPi, "settings.json"),
    retiredAgentsMd: join(repoPi, "AGENTS.md"),
    home: homedir(),
  };
}

/**
 * Where the DSH target's harness-home half reads from and writes to.
 *
 * The home follows DSH's own rule (`domain/dsh/home.ts`: `DSH_HOME`, else
 * `~/.dsh`), the rule `core/config/manager.sh link_dsh_resources` reads
 * too. Profiles live under `<home>/profiles/<name>`, scaffolded by DSH; the
 * repo's own profile patches are under `domains/dev/config/dsh/profiles`.
 * The skills root DSH reads is `$DSH_AGENTS_HOME/skills`, else
 * `~/.agents/skills` (dsh-skill-filesystem README) — the mount the Codex,
 * omp and pi targets deliver; reported here, not planned. The guard plugin
 * is jig's own dsh adapter inside this checkout.
 */
function resolveDshApplyPaths(): DshApplyPaths {
  const harness = harnessRoot();
  const dshHome = resolveDshHome(process.env, homedir());
  const agentsHome = process.env.DSH_AGENTS_HOME?.trim();
  return {
    harnessRoot: harness,
    mcpServers: join(harness, "mcp", "servers.json"),
    decisions: join(harness, "rules", "decisions"),
    dshHome: dshHome.dir,
    dshHomeVia: dshHome.via,
    profilesDir: join(dshHome.dir, DSH_PROFILES_DIR),
    repoProfilesDir: join(resolveApplyRoot(), "domains", "dev", "config", "dsh", "profiles"),
    agentsMd: join(dshHome.dir, "AGENTS.md"),
    homePatch: join(dshHome.dir, DSH_PROFILE_PATCH_FILENAME),
    agentsSkills:
      agentsHome === undefined || agentsHome === ""
        ? join(homedir(), ".agents", "skills")
        : join(agentsHome, "skills"),
    agentsSkillsVia: agentsHome === undefined || agentsHome === "" ? "default" : "DSH_AGENTS_HOME",
    settingsYaml: join(dshHome.dir, "settings.yaml"),
    hooksClaudeJson: join(dshHome.dir, "hooks.claude.json"),
    pluginDir: join(harness, "jig", "adapters", "dsh"),
    home: homedir(),
  };
}

/**
 * How Claude Code should invoke jig from a hook: absolute paths only, for the
 * same reason the Codex registration uses them — a hook runs in whatever
 * environment the harness hands it, which is not a login shell and promises
 * nothing about PATH. The mise shim survives bun upgrades, so it wins when it
 * exists; otherwise the bun currently running this process.
 */
function claudeHookPaths(): ClaudeHookPaths {
  const shim = join(homedir(), ".local", "share", "mise", "shims", "bun");
  return {
    bun: existsSync(shim) ? shim : process.execPath,
    jig: fileURLToPath(import.meta.url),
  };
}

/**
 * Where the skill router reads the list a harness shows: `~/.claude/skills`,
 * the directory Claude Code itself loads from. After `jig apply --target
 * claude --write` that is the managed directory of per-skill links into the
 * harness; before it, yoki-switch's symlink to the same content. Overridable
 * for tests.
 */
function resolveSkillRoot(env: Record<string, string | undefined> = process.env): string {
  return env.JIG_SKILL_ROOT ?? join(homedir(), ".claude", "skills");
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

/** Composition root for `jig box`: the sbx, kit, source and git adapters. */
function buildBoxPorts(): BoxPorts {
  return {
    sbx: createSbxRunner(),
    kit: createKitWriter(),
    source: createJigSourceReader(),
    git: createGitRunner(new BunProcessRunner()),
  };
}

/**
 * Where the box commands find everything outside the process. The posture
 * mixins live in the repo next to the rest of the sbx configuration and are
 * resolved from the same root `jig apply` uses, so a checkout moved or copied
 * anywhere still finds its own.
 */
function boxContext(env: Record<string, string | undefined> = process.env): BoxCliContext {
  const postures = join(resolveApplyRoot(), "domains", "dev", "config", "sbx", "kits", "postures");
  return {
    cwd: process.cwd(),
    postureKits: { guarded: join(postures, "guarded"), connected: join(postures, "connected") },
    dryRun: env.JIG_BOX_DRY_RUN === "1",
    noAttach: env.JIG_BOX_NO_ATTACH === "1",
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

/** Filesystem side of `jig skills hide|show`. Forgiving reads, plain writes. */
function skillRootPorts(): SkillRootPorts {
  return {
    listEntries: async (root) => {
      try {
        return await readdir(root);
      } catch {
        return [];
      }
    },
    readFile: async (path) => {
      try {
        return await readFile(path, "utf8");
      } catch {
        return undefined;
      }
    },
    // No stage-and-rename: the file being edited is a symlink into a repository, and an
    // atomic rename over one replaces the link with a regular file, silently detaching the
    // skill from the checkout it belongs to.
    writeFile: (path, text) => writeFile(path, text, "utf8"),
    join: (...parts) => join(...parts),
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
        const harness = harnessFlag(argv);
        process.stdout.write(
          await preToolUse(stdin, ports, harness === undefined ? {} : { harness }),
        );
        return 0;
      }
      if (subcommand === "session-start") {
        const stdin = await new Response(Bun.stdin.stream()).text();
        const harness = harnessFlag(argv);
        // Nothing is written to stdout: Claude Code treats a SessionStart
        // hook's stdout as context for the model, and this hook's business is
        // with the log, not with Claude.
        await sessionStart(stdin, {
          record: (entry) => appendSessionLog(resolveSessionsPath(process.env), entry),
          clock: ports.clock,
          logger: ports.logger,
          ...(harness === undefined ? {} : { harness }),
        });
        return 0;
      }
      if (subcommand === "user-prompt-submit") {
        const stdin = await new Response(Bun.stdin.stream()).text();
        const threshold = Number.parseFloat(process.env.JIG_SKILL_ROUTER_THRESHOLD ?? "");
        const harness = harnessFlag(argv);
        process.stdout.write(
          await userPromptSubmit(
            stdin,
            {
              provider: ports.decision,
              // `includeHidden` follows the fallback switch, which the hook decides: a
              // listing that is hidden and a catalog that skips hidden skills would leave
              // arm B' with no candidates at all.
              catalog: (includeHidden) => readSkillCatalog(resolveSkillRoot(), { includeHidden }),
              record: (entry) =>
                appendRouterLog(join(resolveStateDir(process.env), "skill-router.jsonl"), entry),
              // The cwd is the repository the prompt is about; the hook is started in it by
              // the harness. Only consulted when the fallback fires.
              signals: () => detectRepoSignals(process.cwd()),
              logger: ports.logger,
            },
            {
              ...(Number.isFinite(threshold) ? { threshold } : {}),
              ...(harness === undefined ? {} : { harness }),
              ...(argv.includes("--fallback") ? { fallback: true } : {}),
              question: skillQuestionMode(process.env),
            },
          ),
        );
        return 0;
      }
      if (subcommand === "post-tool-use-format") {
        const stdin = await new Response(Bun.stdin.stream()).text();
        // Nothing reaches stdout: Claude Code shows a PostToolUse hook's
        // output to the model, and a formatter has nothing to tell it.
        await postToolUseFormat(stdin, { run: runCommand, logger: ports.logger });
        return 0;
      }
      if (subcommand === "stop-gate") {
        const stdin = await new Response(Bun.stdin.stream()).text();
        process.stdout.write(await stopGate(stdin, { run: runCommand, logger: ports.logger }));
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
      const agentModels = await readAgentModels();
      const result = await applyCli(
        argv.slice(1),
        applyPorts,
        resolveApplyPaths(),
        { ports: applyPorts, paths: resolveClaudeApplyPaths(), hookPaths: claudeHookPaths() },
        {
          ports: applyPorts,
          paths: resolveCodexApplyPaths(),
          options: codexApplyOptions(agentModels),
        },
        { ports: applyPorts, paths: resolveOmpApplyPaths(), options: ompApplyOptions(agentModels) },
        { ports: applyPorts, paths: resolvePiApplyPaths() },
        { ports: applyPorts, paths: resolveDshApplyPaths() },
      );
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
    case "box": {
      const result = await boxCli(argv.slice(1), buildBoxPorts(), boxContext());
      process.stdout.write(result.stdout);
      return result.code;
    }
    case "skills": {
      const result = await skillsCli(argv.slice(1), skillRootPorts(), resolveSkillRoot());
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
        options: { openedVia: parsed.openedVia },
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
        // …and to the request in flight, so its router-log line can carry what it cost.
        recordJudgmentUsage(usage);
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
    default: {
      // No arguments on a terminal is the interactive entry point: the
      // question "which harness, and host or box" is the one worth asking,
      // and it is the only one jig asks. Piped or scripted, with no terminal
      // to prompt on, this stays the usage text it has always been.
      if (command === undefined && process.stdin.isTTY === true) {
        const result = await interactive({
          prompt: createPrompter(),
          which: commandExists,
          spawn: spawnHarness,
          box: buildBoxPorts(),
          context: boxContext(),
        });
        process.stdout.write(result.stdout);
        return result.code;
      }
      process.stdout.write(
        "usage: jig <version | hooks <pre-tool-use|session-start|user-prompt-submit|post-tool-use-format|stop-gate> | decide | tier | serve | report skills | report guard-coverage | apply [--target claude|codex|omp|pi|dsh|litellm|all] [--write] | codex register [--write] | skills <hide|show> [--write] | box <new|list|resume|fetch|rm>>\n" +
          "  run with no arguments on a terminal for the interactive entry point:\n" +
          "  which harness, then host or box (an sbx microVM around a clone of this repo).\n" +
          "  box new [--agent claude|codex] [--pr] [--path <dir>] [--dry-run] creates one;\n" +
          "  without --pr the box holds no credentials and its work leaves only by\n" +
          "  box fetch <name>, which pulls into refs/remotes/sandbox-<name>/*.\n" +
          "  hooks session-start [--harness claude] records the session's model to sessions.jsonl;\n" +
          "  Claude Code sends `model` only on SessionStart, so a PreToolUse judgment can only\n" +
          "  learn which model is calling by looking it up there. Prints nothing, never fails.\n" +
          "  hooks user-prompt-submit picks the skill a prompt matches and returns it as context;\n" +
          "  it never blocks the prompt (empty output means no opinion).\n" +
          "  --fallback (or JIG_ROUTER_FALLBACK=1) makes a router that produced no selection inject\n" +
          "  the catalog of skills relevant to this repository's languages instead of nothing, and\n" +
          "  lets it offer skills `jig skills hide` marked disable-model-invocation — one switch,\n" +
          "  because hiding the listing while skipping hidden skills leaves an empty catalog.\n" +
          "  Off by default: where the listing is visible, the fallback would be a second copy of it.\n" +
          "  JIG_SKILL_ROUTER_QUESTION=choice|bool picks the shape of the one judgment question.\n" +
          "  bool (default) asks one yes/no per candidate against a shared material — 54 questions,\n" +
          "  2 jev requests. choice asks ONE question listing every candidate plus an explicit\n" +
          "  `none`, in the English wording frozen as PROTOCOL.md §3b `choice-en`, and ranks the\n" +
          "  options by the probabilities the reply now carries; the threshold and the cap of 3\n" +
          "  apply to those probabilities unchanged. It is arm C of the skill-selection experiment\n" +
          "  (rules/research/skill-selection-experiment/PROTOCOL-C.md); the default stays bool until\n" +
          "  that arm is chosen. Both the hook and the service read this variable, so the two paths\n" +
          "  never ask different questions into the same log.\n" +
          "  JIG_SKILL_ROUTER_THRESHOLD=<0..1> sets the gate (default 0.8) for either shape.\n" +
          "  skills hide|show [--write] [--root <dir>] sets or clears disable-model-invocation on\n" +
          "  every skill under the root (default ~/.claude/skills, or JIG_SKILL_ROOT) —\n" +
          "  the switch that hides the harness's listing. Dry-run by default; it prints the list\n" +
          "  it would change, edits that one frontmatter key and nothing else, and refuses any\n" +
          "  skill that sets user-invocable.\n" +
          "  report skills [--days N] [--json] [--opened-via read|skill|any] reads both harnesses'\n" +
          "  session transcripts and shows what the router injected against what the model opened;\n" +
          "  opens count through the read tool and the Skill tool, --opened-via read for the older numbers.\n" +
          "  hooks post-tool-use-format formats the one file an edit tool just wrote, silently;\n" +
          "  hooks stop-gate runs the project's typecheck/lint once at the end of a turn and hands a\n" +
          "  failure back as a block reason, honouring stop_hook_active so it never loops.\n" +
          "  apply --target claude composes ~/.claude/settings.json's hooks, permissions and sandbox\n" +
          "  from policy/guard-rules.json; every other key in the live file is preserved (a leftover\n" +
          "  mcpServers key is removed: Claude Code never read it there). Dry-run prints the whole-file\n" +
          "  diff plus owned/left/REMOVED key lists, and one paste-able `claude mcp add --scope user`\n" +
          "  line per targets.claude server in mcp/servers.json — jig never writes ~/.claude.json and\n" +
          "  never runs the claude CLI, so those lines are run by hand, once.\n" +
          "  The same run generates ~/.claude/AGENTS.md from rules/common and rules/decisions (with\n" +
          "  CLAUDE.md -> AGENTS.md), manages skills/, agents/ and rules/ as real directories of\n" +
          "  per-entry links into llm/harness/ (entries that are not jig's, such as Claude Code's\n" +
          "  own skills/synced, are left alone), and retires commands/. A file or real directory\n" +
          "  in a link's way is renamed aside, never deleted; hooks, scripts, workflows and the\n" +
          "  .<x>-merged staging dirs are not touched.\n" +
          "  It is never part of --target all: it writes into $HOME, so it has to be named.\n" +
          "  apply --target codex delivers the same sources to Codex ($CODEX_HOME, default ~/.codex):\n" +
          "  ~/.agents/skills (one link per skill; the mount Codex, pi and omp read) as a managed\n" +
          "  directory — links yoki-switch left into the old tree, or dangling, are removed; ~/.codex/skills\n" +
          "  is not managed at all (no Codex-specific ports), its entries are listed as leftovers;\n" +
          "  ~/.codex/AGENTS.md, the same generated file as ~/.claude/AGENTS.md;\n" +
          "  ~/.codex/agents/<name>.toml generated from agents/*.md (tools become a sentence in\n" +
          "  developer_instructions; model and model_reasoning_effort from agents/models.json's codex\n" +
          "  table, or the agent's own models.codex override; an unmapped tier is left out and counted);\n" +
          "  and [mcp_servers.*] for targets.codex servers inside a `# jig:begin mcp` block of\n" +
          "  ~/.codex/config.toml, every other table preserved. A server already declared outside the\n" +
          "  block is a conflict to clean up by hand once. hooks.json is jig codex register's.\n" +
          "  Dry-run by default; --write does all of it in one run; never part of --target all.\n" +
          "  apply --target omp delivers the same sources to omp (~/.omp/agent, or the active profile's\n" +
          "  agent dir per OMP_PROFILE/PI_PROFILE/PI_CODING_AGENT_DIR): the same ~/.agents/skills mount the\n" +
          "  codex target delivers (one plan, either target); ~/.omp/agent/agents/<name>.md generated from\n" +
          "  agents/*.md (omp's own frontmatter; tools mapped to omp ids, unmappable ones dropped and counted;\n" +
          "  model from agents/models.json's omp table, empty until ruled, so left out and counted; body\n" +
          "  verbatim); jig's entries in\n" +
          "  ~/.omp/agent/mcp.json for targets.omp servers, every other entry and key carried through; and\n" +
          "  extensions/jig.ts -> jig's omp extension. yoki-hooks.json, RULES.md, .yoki/, config.yml and\n" +
          "  yoki's extension links are reported as leftovers, not touched; config.yml is not jig's yet.\n" +
          "  Conditional paths: rules are not delivered to omp in this milestone (the dry-run says so).\n" +
          "  Dry-run by default; --write does all of it in one run; never part of --target all.\n" +
          "  apply --target pi runs both halves for the one harness: pi/models.json from policy/tiers.json\n" +
          "  (the tiers half, the only part --target all runs), then the agent directory (~/.pi/agent, or\n" +
          "  PI_CODING_AGENT_DIR): the same ~/.agents/skills mount the codex and omp targets deliver;\n" +
          "  ~/.pi/agent/AGENTS.md, the same generated file as ~/.claude/AGENTS.md — today a symlink into the\n" +
          "  repo, replaced by the generated file on --write (the repo file is untouched and reported as unused);\n" +
          "  and jig's entries in pi-mcp-adapter's ~/.config/mcp/mcp.json for targets.pi servers, every other\n" +
          "  entry and key carried through. Report only: whether packages in domains/dev/config/pi/settings.json\n" +
          "  declares pi-mcp-adapter and @tintinweb/pi-subagents (the paste-able line is printed when not),\n" +
          "  what ~/.pi/agent/extensions holds (manager.sh's links until milestone 4), and the two gaps\n" +
          "  (no native subagents; conditional paths: rules not delivered). Dry-run by default; --write.\n" +
          "  apply --target dsh runs both halves for the one harness: dsh/settings.yaml's managed block from\n" +
          "  policy/tiers.json (the tiers half, the only part --target all runs), then the harness home\n" +
          "  ($DSH_HOME, default ~/.dsh): jig's @deepseek-ai/dsh-mcp-client rows for targets.dsh servers (only\n" +
          "  serena, codebase-memory, context7 — DSH loads MCP schemas eagerly) inside a `# jig:begin mcp` block\n" +
          "  of each profile's cordis.patch.yml, for every profile DSH has scaffolded under $DSH_HOME/profiles\n" +
          "  that the repo also owns (domains/dev/config/dsh/profiles/<name>/), every other row carried through;\n" +
          "  and $DSH_HOME/AGENTS.md, the same generated file as ~/.claude/AGENTS.md (DSH reads it first, then\n" +
          "  the project chain). No matching profile: nothing is delivered and no directory is created. Report\n" +
          "  only: ~/.agents/skills (DSH reads it natively; the codex/omp/pi mount), the home-level\n" +
          "  cordis.patch.yml, settings.yaml, hooks.claude.json and the jig-guard plugin (manager.sh's until\n" +
          "  milestone 4), and the [unverified] list. Dry-run by default; --write.\n" +
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
}

if (import.meta.main) {
  main(Bun.argv.slice(2)).then((code) => process.exit(code));
}
