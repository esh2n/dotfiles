/**
 * Whether Claude Code's settings carry the hooks the findings check reads from
 * (`rules/decisions/2026-10-23-findings-verification-check.md`).
 *
 * The Stop gate runs on settings that `jig apply` wrote at some earlier time. When the
 * checkout moved on and apply was not run, the gate is new and the recorders are missing:
 * nothing records a skill use, so the check finds no review and passes without a word.
 * Only the gate can notice, because it is the one hook old settings already run.
 */

import { isJigHookCommand } from "../claude/settings";

/** The record kinds the PostToolUse matcher must let through (domain/claude/hooks.ts). */
const RECORDED_TOOLS = ["Skill", "SubagentHandback"] as const;

interface HookGroup {
  readonly matcher?: unknown;
  readonly hooks?: unknown;
}

function jigGroups(settings: unknown, event: string): readonly HookGroup[] {
  const hooks = (settings as { hooks?: Record<string, unknown> } | null)?.hooks;
  const groups = hooks?.[event];
  if (!Array.isArray(groups)) return [];
  return groups.filter((group): group is HookGroup => {
    const inner = (group as HookGroup | null)?.hooks;
    return (
      Array.isArray(inner) &&
      inner.some((hook) => {
        const command = (hook as { command?: unknown } | null)?.command;
        return typeof command === "string" && isJigHookCommand(command);
      })
    );
  });
}

/**
 * What the settings lack for the findings check to see a review, as short names; empty
 * when nothing is missing. Settings that are not an object say nothing either way and
 * give the empty list: the gate cannot tell a missing file from one it may not read.
 */
export function missingFindingsHooks(settings: unknown): readonly string[] {
  if (typeof settings !== "object" || settings === null) return [];
  const missing: string[] = [];
  const matchers = jigGroups(settings, "PostToolUse").map((group) =>
    typeof group.matcher === "string" ? group.matcher.split("|") : [],
  );
  for (const tool of RECORDED_TOOLS) {
    if (!matchers.some((tools) => tools.includes(tool))) missing.push(`PostToolUse ${tool}`);
  }
  if (jigGroups(settings, "SubagentStop").length === 0) missing.push("SubagentStop");
  return missing;
}

/** What the owner is told, once per session. */
export function staleSettingsNotice(missing: readonly string[], path: string): string {
  return `jig: ${path} lacks the hooks the findings check records from (${missing.join(", ")}), so it cannot see a review and passes every turn. Run \`jig apply\` (or \`make up\`) and restart the session.`;
}
