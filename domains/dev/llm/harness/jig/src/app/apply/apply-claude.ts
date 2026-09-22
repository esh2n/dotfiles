/**
 * `jig apply --target claude` — compose `~/.claude/settings.json` from the
 * sources under `llm/harness/`, and either show the diff (default) or write it
 * (`--write`).
 *
 * This is milestone 1 of the generator that retires `yoki-switch`: the Claude
 * Code target owns exactly `hooks`, `permissions.{allow,deny,defaultMode}`,
 * `sandbox` and `mcpServers`, plus the absence of the retired harness's `env`
 * keys. The symlinked directories (`skills`, `rules`, `agents`, `commands`,
 * `CLAUDE.md`) stay with yoki-switch until milestone 2.
 *
 * The dependency direction is the one
 * `rules/decisions/2026-09-22-config-layout-no-personal-layer.md` fixes:
 * sources → output, one way. The destination is read for two reasons and no
 * others — to carry unmanaged keys through, and to say what is leaving. That
 * is a property of `domain/claude/settings.ts`, which is why this module hands
 * it the parsed file and takes back both the result and the report, rather
 * than consulting the file itself.
 *
 * Hand-edit detection reuses `domain/tiers/plan.ts` and the same manifest the
 * tier targets use: a settings.json that matches neither jig's last write nor
 * the newly generated text is a conflict, not something to overwrite.
 */

import {
  type SkippedDecision,
  decisionLines,
  renderDecisionSection,
} from "../../domain/claude/agents-md";
import { type ClaudeHookPaths, buildClaudeHooks } from "../../domain/claude/hooks";
import { DEFAULT_PERMITS } from "../../domain/claude/permits";
import {
  NO_SANDBOX_SOURCE,
  type SandboxSource,
  hostSandbox,
  parseSandboxSource,
} from "../../domain/claude/sandbox";
import {
  type ClaudeComposition,
  composeClaudeSettings,
  renderClaudeSettings,
} from "../../domain/claude/settings";
import type { JsonObject } from "../../domain/compose/merge";
import { applyTemplate } from "../../domain/compose/template";
import { parseMcpLayer } from "../../domain/mcp/parse";
import { buildClaudeMcpServers } from "../../domain/mcp/to-claude";
import { parsePolicy } from "../../domain/policy/parse";
import {
  type ClaudePermissions,
  toClaudePermissions,
} from "../../domain/policy/to-claude-permissions";
import { unifiedDiff } from "../../domain/tiers/diff";
import { planApply } from "../../domain/tiers/plan";
import type { ClaudeApplyPorts } from "./ports";

export interface ClaudeApplyPaths {
  /** `llm/harness/policy/guard-rules.json`. */
  readonly guardRules: string;
  /** `llm/harness/mcp/servers.json`. */
  readonly mcpServers: string;
  /** `llm/harness/policy/sandbox.json`. Absent is tolerated, and reported. */
  readonly sandbox: string;
  /** `llm/harness/rules/decisions/`. */
  readonly decisions: string;
  /** Destination: `~/.claude/settings.json`. */
  readonly settings: string;
  /** Substituted into mcp command paths; `{{HOME}}`. */
  readonly home: string;
}

export type ClaudeOutcome = "write" | "noop" | "conflict";

export interface ClaudeApplyReport {
  readonly outcome: ClaudeOutcome;
  readonly diff: string;
  readonly wrote: boolean;
  readonly composition: ClaudeComposition;
  /** Rules the guard enforces that no native permission can express. */
  readonly hookOnly: ClaudePermissions["hookOnly"];
  /** The five hook command lines, for the dry-run listing. */
  readonly hookCommands: readonly { readonly event: string; readonly command: string }[];
  /** Milestone-2 preview: never written, only shown. */
  readonly agentsMdPreview: string;
  /** Decision notes the AGENTS.md renderer skipped, with why. */
  readonly agentsMdSkipped: readonly SkippedDecision[];
  /** `undefined` when `policy/sandbox.json` does not exist yet. */
  readonly sandboxSourcePath: string | undefined;
  readonly message?: string;
}

async function readJson(
  ports: ClaudeApplyPorts,
  path: string,
): Promise<{ readonly text: string; readonly json: unknown } | undefined> {
  const text = await ports.readFile(path);
  if (text === undefined) return undefined;
  return { text, json: JSON.parse(text) as unknown };
}

/**
 * The allow list: the guard policy's own `permit` rules, plus the three
 * defaults the decision requires be present from the start. A default that is
 * also a real permit rule collapses to one entry.
 */
function allowList(projected: ClaudePermissions): readonly string[] {
  return [...new Set([...projected.allow, ...DEFAULT_PERMITS.map((permit) => permit.rule)])].sort();
}

async function buildMcpServers(
  ports: ClaudeApplyPorts,
  paths: ClaudeApplyPaths,
): Promise<JsonObject> {
  const read = await readJson(ports, paths.mcpServers);
  if (read === undefined) {
    throw new Error(`jig apply --target claude: MCP source not found at ${paths.mcpServers}`);
  }
  const layer = parseMcpLayer(read.text, paths.mcpServers);
  const servers = buildClaudeMcpServers(layer.servers);
  return applyTemplate(servers, { HOME: paths.home }) as JsonObject;
}

/**
 * `policy/sandbox.json`, or the empty default when it does not exist yet.
 *
 * Tolerating absence is deliberate and one-directional: an empty
 * `excludedCommands` is the *tightest* answer, so a missing source can only
 * over-restrict. The apply reports which of the two it used, because an empty
 * list that nobody chose and an empty list somebody chose are different facts.
 */
async function readSandboxSource(
  ports: ClaudeApplyPorts,
  path: string,
): Promise<{ readonly source: SandboxSource; readonly found: boolean }> {
  const read = await readJson(ports, path);
  if (read === undefined) return { source: NO_SANDBOX_SOURCE, found: false };
  return { source: parseSandboxSource(read.json, path), found: true };
}

async function buildAgentsMdPreview(
  ports: ClaudeApplyPorts,
  decisionsDir: string,
): Promise<{ readonly preview: string; readonly skipped: readonly SkippedDecision[] }> {
  const names = [...(await ports.listDir(decisionsDir))].filter((name) => name.endsWith(".md"));
  names.sort();
  const sources: { file: string; text: string }[] = [];
  for (const file of names) {
    const text = await ports.readFile(`${decisionsDir}/${file}`);
    if (text !== undefined) sources.push({ file, text });
  }
  const result = decisionLines(sources);
  return { preview: renderDecisionSection(result), skipped: result.skipped };
}

export async function applyClaude(
  input: {
    readonly paths: ClaudeApplyPaths;
    readonly hookPaths: ClaudeHookPaths;
    readonly write: boolean;
  },
  ports: ClaudeApplyPorts,
): Promise<ClaudeApplyReport> {
  const policySource = await readJson(ports, input.paths.guardRules);
  if (policySource === undefined) {
    throw new Error(
      `jig apply --target claude: guard policy not found at ${input.paths.guardRules}`,
    );
  }
  const projected = toClaudePermissions(parsePolicy(policySource.json as Record<string, unknown>));

  const sandbox = await readSandboxSource(ports, input.paths.sandbox);

  const hooks = buildClaudeHooks(input.hookPaths);
  const composition = composeClaudeSettings(
    (await readJson(ports, input.paths.settings))?.json as JsonObject | undefined,
    {
      hooks,
      allow: allowList(projected),
      deny: projected.deny,
      // Per rules/decisions/2026-09-22-allow-from-guard-permit.md: the narrow
      // allow list above is what survives auto mode's first stage; the mode
      // itself stays auto so everything unlisted still reaches the classifier.
      defaultMode: "auto",
      sandbox: hostSandbox(sandbox.source),
      mcpServers: await buildMcpServers(ports, input.paths),
    },
  );

  const currentText = (await ports.readFile(input.paths.settings)) ?? "";
  const generated = renderClaudeSettings(composition.settings);
  const diff = unifiedDiff(input.paths.settings, currentText, "generated", generated);

  const manifest = { ...(await ports.readManifest()) };
  const plan = planApply({
    currentContent: currentText === "" ? undefined : currentText,
    generatedContent: generated,
    manifestHash: manifest[input.paths.settings],
    sha256: ports.sha256,
  });

  const agents = await buildAgentsMdPreview(ports, input.paths.decisions);
  const hookCommands = Object.entries(hooks).map(([event, value]) => ({
    event,
    command: firstCommand(value),
  }));

  const base = {
    diff,
    composition,
    hookOnly: projected.hookOnly,
    hookCommands,
    agentsMdPreview: agents.preview,
    agentsMdSkipped: agents.skipped,
    sandboxSourcePath: sandbox.found ? input.paths.sandbox : undefined,
  };

  if (input.write && plan.action === "write") {
    await ports.writeAtomic(input.paths.settings, generated);
    manifest[input.paths.settings] = ports.sha256(generated);
    await ports.writeManifest(manifest);
    await ports.writeProvenance(dirOf(input.paths.settings), {
      sourceFile: input.paths.guardRules,
      sourceSha256: ports.sha256(policySource.text),
      generatedAt: ports.now().toISOString(),
      jigVersion: ports.jigVersion,
    });
    return { ...base, outcome: "write", wrote: true };
  }

  if (input.write && plan.action === "noop" && manifest[input.paths.settings] === undefined) {
    // Seed the manifest so a LATER hand edit is detected as one. No file
    // content changes: this is out-of-repo state only.
    manifest[input.paths.settings] = ports.sha256(generated);
    await ports.writeManifest(manifest);
  }

  return {
    ...base,
    outcome: plan.action,
    wrote: false,
    ...(plan.action === "conflict"
      ? {
          message:
            "hand-edit conflict: settings.json differs from both jig's last write and the newly generated content — reconcile before --write",
        }
      : {}),
  };
}

/** The one command line inside an event's single group, for the dry-run listing. */
function firstCommand(eventValue: unknown): string {
  const group = Array.isArray(eventValue) ? eventValue[0] : undefined;
  const hooks = (group as { hooks?: unknown } | undefined)?.hooks;
  const hook = Array.isArray(hooks) ? hooks[0] : undefined;
  const command = (hook as { command?: unknown } | undefined)?.command;
  return typeof command === "string" ? command : "(none)";
}

function dirOf(path: string): string {
  return path.slice(0, Math.max(path.lastIndexOf("/"), 0));
}
