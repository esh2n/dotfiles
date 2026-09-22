/**
 * `jig apply` — regenerate a target's configuration from the canonical sources
 * under `llm/harness/` and either show the diff (default) or write it
 * (`--write`). Thin: argv parsing and text formatting only, delegating the
 * actual decision-making to `app/apply/*`. The composition root (`./jig.ts`)
 * builds the real ports and resolves the paths; this module never touches
 * `process.env` or the filesystem itself, so it is testable with any fake
 * ports and any paths.
 *
 * Two kinds of target live behind the one verb:
 *
 * - **pi / dsh / litellm** — model tiers, from `policy/tiers.json`, into files
 *   inside this repository (`app/apply/apply-tiers.ts`).
 * - **claude** — `~/.claude/settings.json`, from `policy/guard-rules.json` and
 *   `mcp/servers.json` (`app/apply/apply-claude.ts`). Milestone 1 of the
 *   generator that retires `yoki-switch`.
 *
 * `--target all` means the first group only. The claude target writes into
 * `$HOME` rather than into the checkout, so it has to be named: a verb that
 * reaches a user's live harness configuration by default is one keystroke
 * from a surprise, and nothing about the word "all" says which files it means.
 */

import {
  type ClaudeApplyPaths,
  type ClaudeApplyReport,
  applyClaude,
} from "../app/apply/apply-claude";
import {
  ALL_APPLY_TARGETS,
  type ApplyTarget,
  type ApplyTargetPaths,
  type TargetResult,
  applyTiers,
} from "../app/apply/apply-tiers";
import type { ApplyPorts, ClaudeApplyPorts } from "../app/apply/ports";
import type { ClaudeHookPaths } from "../domain/claude/hooks";
import { DEFAULT_PERMITS, defaultPermitPolicyFragment } from "../domain/claude/permits";
import { KNOWN_MACOS_EXCLUSION_CANDIDATES } from "../domain/claude/sandbox";

export interface ApplyCliResult {
  readonly stdout: string;
  readonly code: number;
}

interface ParsedArgs {
  readonly targets: readonly ApplyTarget[];
  readonly claude: boolean;
  readonly write: boolean;
}

function parseArgs(args: readonly string[]): ParsedArgs | { readonly error: string } {
  let targetArg: string | undefined;
  let write = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--write") {
      write = true;
    } else if (arg === "--target") {
      i++;
      targetArg = args[i];
    } else if (arg?.startsWith("--target=")) {
      targetArg = arg.slice("--target=".length);
    } else {
      return { error: `unknown argument ${JSON.stringify(arg)}` };
    }
  }

  const targetName = targetArg ?? "all";
  if (targetName === "claude") {
    return { targets: [], claude: true, write };
  }
  if (targetName === "all") {
    return { targets: ALL_APPLY_TARGETS, claude: false, write };
  }
  if ((ALL_APPLY_TARGETS as readonly string[]).includes(targetName)) {
    return { targets: [targetName as ApplyTarget], claude: false, write };
  }
  return {
    error: `unknown --target ${JSON.stringify(targetName)} (expected claude, pi, dsh, litellm, or all)`,
  };
}

function formatResult(result: TargetResult): string {
  const lines: string[] = [`== ${result.target} ==`, `outcome: ${result.outcome}`];
  if (result.message) {
    lines.push(`message: ${result.message}`);
  }
  if (result.diff !== "") {
    lines.push("--- diff (current vs generated) ---", result.diff);
  } else if (result.preview !== undefined) {
    lines.push("--- generated block (no diff: markers not present yet) ---", result.preview);
  } else {
    lines.push("(no differences)");
  }
  if (result.dropped.length > 0) {
    lines.push(`dropped fields (${result.dropped.length}):`);
    for (const d of result.dropped) {
      lines.push(`  - ${d.tier}:${d.field} — ${d.reason}`);
    }
  }
  return lines.join("\n");
}

/** A --write request for pi/dsh that could not actually write (no markers, no dest) is a real failure; litellm refusing --write is the documented, correct behavior. */
function isBlockedWriteFailure(result: TargetResult, wroteRequested: boolean): boolean {
  if (!wroteRequested || result.target === "litellm") return false;
  return result.outcome === "markers-missing" || result.outcome === "dest-missing";
}

const PAD = 17;

/**
 * The Claude Code target's dry-run. Three questions in order — what jig now
 * owns, what it leaves alone, what it takes away — because the third is the
 * one a reader has to agree to before `--write`, and burying it under a
 * 200-line diff is how a one-time cleanup becomes a surprise.
 */
function formatClaude(report: ClaudeApplyReport, dest: string): string {
  const { composition } = report;
  const lines: string[] = [
    "== claude ==",
    `outcome: ${report.outcome}`,
    `dest: ${dest}`,
    ...(report.message === undefined ? [] : [`message: ${report.message}`]),
    "",
    `hooks (${report.hookCommands.length}):`,
    ...report.hookCommands.map((h) => `  ${h.event.padEnd(PAD)}${h.command}`),
    "",
    `keys jig now owns (${composition.owned.length}):`,
    ...composition.owned.map((key) => `  ${key}`),
    "",
    `keys left as-is (${composition.left.length}):`,
    ...composition.left.map((key) => `  ${key}`),
    "",
  ];

  const removedTotal = composition.removed.reduce((sum, group) => sum + group.items.length, 0);
  lines.push(
    `keys jig would REMOVE (${removedTotal} values across ${composition.removed.length} keys):`,
  );
  if (composition.removed.length === 0) lines.push("  (nothing)");
  for (const group of composition.removed) {
    lines.push(`  ${group.key} (${group.items.length}):`);
    for (const item of group.items) lines.push(`    - ${item}`);
  }

  lines.push(
    "",
    `default permits, fallback until they exist in the policy file (${DEFAULT_PERMITS.length}):`,
    ...DEFAULT_PERMITS.map((permit) => `  ${permit.rule.padEnd(24)}${permit.why}`),
    "",
    "  policy/guard-rules.json is not agent-writable by design (floor-policy-write).",
    "  Paste these into its `rules` array by hand; the projection then produces the",
    "  same entries and the fallback above becomes a no-op:",
    ...defaultPermitPolicyFragment()
      .split("\n")
      .map((line) => `  ${line}`),
    "",
    `guard rules with no native form (${report.hookOnly.length}):`,
    "  permissions.deny is a backstop only. Enforcement is the PreToolUse hook —",
    "  a hook deny holds in every permission mode, and these rules have no native",
    "  form at all, so removing the hook removes them entirely.",
    ...report.hookOnly.map((rule) => `  ${rule.id.padEnd(30)}${rule.reason}`),
    "",
    ...sandboxLines(report),
    "",
  );

  lines.push(
    report.diff === "" ? "(no differences)" : "--- diff (current vs generated) ---",
    ...(report.diff === "" ? [] : [report.diff]),
    "",
    "--- AGENTS.md: milestone 2, PREVIEW ONLY (nothing is written) ---",
    report.agentsMdPreview.trimEnd(),
  );

  const missingRule = report.agentsMdSkipped.filter((skipped) => skipped.missingRule);
  if (missingRule.length > 0) {
    lines.push(
      "",
      `  WARNING: ${missingRule.length} accepted decision note(s) carry no \`rule:\` line and are NOT bound:`,
      ...missingRule.map((skipped) => `    - ${skipped.file}`),
      "    A human writes that line at the time of the ruling; the generator never invents it.",
    );
  }
  const other = report.agentsMdSkipped.filter((skipped) => !skipped.missingRule);
  if (other.length > 0) {
    lines.push(
      `  (${other.length} not rendered: ${other.map((s) => `${s.file} — ${s.reason}`).join("; ")})`,
    );
  }
  return lines.join("\n");
}

/** The sandbox block's provenance and its cost, both stated. */
function sandboxLines(report: ClaudeApplyReport): readonly string[] {
  const excluded = (report.composition.settings.sandbox as { excludedCommands?: unknown })
    ?.excludedCommands;
  const list = Array.isArray(excluded) ? excluded : [];
  const provenance =
    report.sandboxSourcePath === undefined
      ? "sandbox: host mode, strict. NO policy/sandbox.json — excludedCommands defaults to empty (the tightest answer; create the file to choose)."
      : `sandbox: host mode, strict. excludedCommands copied from ${report.sandboxSourcePath}: ${list.length === 0 ? "(none)" : list.join(", ")}`;
  return [
    provenance,
    "  An excluded command runs outside the OS sandbox but still goes through jig's guard.",
    "  What an empty list costs on macOS, per the sandboxing doc:",
    ...KNOWN_MACOS_EXCLUSION_CANDIDATES.map((candidate) => `    - ${candidate}`),
  ];
}

export interface ClaudeCliContext {
  readonly ports: ClaudeApplyPorts;
  readonly paths: ClaudeApplyPaths;
  readonly hookPaths: ClaudeHookPaths;
}

export async function applyCli(
  args: readonly string[],
  ports: ApplyPorts,
  paths: { readonly tiersJsonPath: string; readonly destPaths: ApplyTargetPaths },
  claude?: ClaudeCliContext,
): Promise<ApplyCliResult> {
  const parsed = parseArgs(args);
  if ("error" in parsed) {
    return { stdout: `jig apply: ${parsed.error}\n`, code: 2 };
  }

  if (parsed.claude) {
    if (claude === undefined) {
      return { stdout: "jig apply: --target claude is not wired in this context\n", code: 2 };
    }
    const report = await applyClaude(
      { paths: claude.paths, hookPaths: claude.hookPaths, write: parsed.write },
      claude.ports,
    );
    return {
      stdout: `${formatClaude(report, claude.paths.settings)}\n`,
      code: report.outcome === "conflict" ? 1 : 0,
    };
  }

  const report = await applyTiers(
    { tiersJsonPath: paths.tiersJsonPath, destPaths: paths.destPaths, options: parsed },
    ports,
  );

  const out = report.results.map(formatResult).join("\n\n");
  const hasBlockedWrite = report.results.some((r) => isBlockedWriteFailure(r, parsed.write));
  const code = report.hasConflict || hasBlockedWrite ? 1 : 0;

  return { stdout: `${out}\n`, code };
}
