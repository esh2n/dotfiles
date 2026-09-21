/**
 * The guard policy: rules written as "who, what operation, on what" instead of a
 * regex over a raw string.
 *
 * The shape follows Cedar's principal / action / resource: an `effect`
 * (forbid beats ask beats permit), an `action` (the operation family, one
 * vocabulary for every harness), a structured `subject` matched against
 * what subject extraction proved or suspected, and optional `principals`
 * (which harness the rule applies to). `match`, the v1 raw-string regex, is
 * kept for migration and for suspicion-side matching.
 *
 * Two things live outside `rules`. `floor` holds forbids that no profile,
 * mode or adapter setting can switch off — the last line before the
 * sandbox. `mode` says, per action, whether an unmatched call is allowed
 * (`denylist`, today's behavior) or must be covered by a permit rule
 * (`allowlist`, the staged destination).
 */

import type { HookProfile } from "../hooks/decision";

export type Effect = "forbid" | "ask" | "permit";

export type Action = "shell.exec" | "fs.write" | "fs.edit" | "net.fetch" | "mcp.call";

export const ACTIONS: readonly Action[] = [
  "shell.exec",
  "fs.write",
  "fs.edit",
  "net.fetch",
  "mcp.call",
];

export type Mode = "denylist" | "allowlist";

/** What a rule is matched against. Every field is optional; all present fields must hold. */
export interface SubjectPattern {
  /**
   * Program basename, as a regex anchored to the whole name: `git` matches
   * `/usr/bin/git` and nothing else, `mkfs(\..+)?` matches every mkfs
   * variant. shell.exec; the server name for mcp.call.
   */
  readonly program?: RegExp;
  /** Regex over the arguments joined by single spaces. shell.exec; tool name for mcp.call. */
  readonly argv?: RegExp;
  /** Regex over the path: the file for fs.*, a redirect target for shell.exec. */
  readonly path?: RegExp;
  /** Regex over the host for net.fetch. */
  readonly host?: RegExp;
}

export interface Rule {
  readonly id: string;
  readonly effect: Effect;
  readonly action: Action;
  readonly subject: SubjectPattern | undefined;
  /** Raw-string regex (the command, the path, the url). Compat with v1. */
  readonly match: RegExp | undefined;
  /** Required for forbid and ask: codex fails open on a deny without a reason. */
  readonly why: string | undefined;
  readonly profiles: readonly HookProfile[];
  /** Harness names this rule applies to; undefined means all. */
  readonly principals: readonly string[] | undefined;
}

/** A forbid that ignores profiles, principals and mode. */
export interface FloorRule {
  readonly id: string;
  readonly action: Action;
  readonly subject: SubjectPattern | undefined;
  readonly match: RegExp | undefined;
  readonly why: string;
}

export interface Policy {
  readonly version: 1;
  readonly floor: readonly FloorRule[];
  readonly mode: Readonly<Record<Action, Mode>>;
  readonly rules: readonly Rule[];
}
