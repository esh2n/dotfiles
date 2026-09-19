/**
 * Types for the shared guard policy — `domains/dev/llm/harness/policy/guard-rules.json`,
 * the single source of command-pattern guard rules consumed by jig's own
 * PreToolUse hook and, outside this repo, by pi's `extensions/guard.ts`
 * loader. JSON (not YAML) on purpose: both consumers parse it with zero
 * dependencies, under Bun and under Node.
 *
 * Only pattern-expressible rules live here. Contextual guards — real branch
 * detection, the PR preflight gate, git identity checks — stay in
 * `domains/dev/config/claude-profiles/personal/hooks/git-guard.sh` and are
 * out of scope for this policy.
 */

import type { HookProfile } from "../hooks/decision";

/** "deny" never proceeds; "confirm" asks for interactive approval. */
export type GuardTier = "deny" | "confirm";

/**
 * The abstract tool vocabulary a rule's `tools` field is written against.
 * Each consuming harness maps its own tool names onto these three — see
 * `TOOL_ALIASES` in `./evaluate`.
 */
export type GuardTool = "shell" | "write" | "edit";

/** One parsed, ready-to-evaluate rule. `match` is compiled once at parse time. */
export interface GuardRule {
  readonly id: string;
  readonly tier: GuardTier;
  readonly tools: readonly GuardTool[];
  readonly match: RegExp;
  readonly why: string;
  /** Which hook profiles this rule is active in — set membership, not a hierarchy. */
  readonly profiles: readonly HookProfile[];
}

/** The parsed `guard-rules.json` document. */
export interface GuardPolicy {
  readonly version: 1;
  readonly rules: readonly GuardRule[];
}
