/**
 * Converts a merged permission layer set into the shape Claude Code's
 * settings.json expects, plus the hook-enforced deny subset that
 * `pre-permission-guard.js` reads from `<CLAUDE_DIR>/.yoki/permissions.json`.
 * Ported from yoki's `runtime/yoki/scripts/lib/permissions/{to-claude,guard-deny}.js`.
 *
 * This module does not yet write hookEnforced anywhere — the compose CLI
 * only emits `settings.json`. A later iteration writes `.yoki/permissions.json`.
 */

import type { MergedPermissions } from "./types";

export interface ClaudePermissionsSettings {
  readonly allow: readonly string[];
  readonly deny: readonly string[];
  readonly defaultMode: string;
}

export interface HookEnforcedDenyEntry {
  readonly pattern: string;
  readonly reason: string;
}

export function toClaudeSettings(merged: MergedPermissions): ClaudePermissionsSettings {
  return {
    allow: merged.allow.map((entry) => entry.pattern),
    deny: merged.deny.map((entry) => entry.pattern),
    defaultMode: merged.defaultMode || "auto",
  };
}

/**
 * The deny entries marked `enforce: [hook]` — patterns that cannot be fully
 * trusted to a declarative permission match alone (shell redirection,
 * wildcard rm targets, the write side of in-workspace secret globs).
 */
export function hookEnforcedDeny(merged: MergedPermissions): HookEnforcedDenyEntry[] {
  return merged.deny
    .filter((entry) => Array.isArray(entry.enforce) && entry.enforce.includes("hook"))
    .map((entry) => ({ pattern: entry.pattern, reason: entry.reason ?? "" }));
}
