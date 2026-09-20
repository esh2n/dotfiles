import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// Blast-radius guard for the local lane (hooks are Claude Code-only; pi needs
// its own enforcement).
//
// This no longer embeds its own rules. The CANONICAL rule data lives in
// `domains/dev/llm/harness/policy/guard-rules.json` and the CANONICAL
// evaluator is jig's `src/domain/policy` (parse.ts / evaluate.ts) — this
// file is a small, deliberately duplicated re-implementation of that
// evaluator (pi and jig are separate deployables, so no cross-package
// import), kept in sync by hand if the shared schema changes.
//
// Two tiers, same as before:
//  - deny: never allowed, no confirmation offered
//  - confirm: destructive enough to require interactive approval; denied by
//    default when running headless

export type GuardTier = "deny" | "confirm";

export interface GuardRule {
  readonly id: string;
  readonly tier: GuardTier;
  readonly tools: readonly string[];
  readonly match: RegExp;
  readonly why: string;
  readonly profiles: readonly string[];
}

export const PROFILES = ["minimal", "standard", "strict"] as const;
export type HookProfile = (typeof PROFILES)[number];

export function resolveProfile(env: NodeJS.ProcessEnv): HookProfile {
  const raw = env.JIG_HOOK_PROFILE ?? env.YOKI_HOOK_PROFILE;
  return (PROFILES as readonly string[]).includes(raw ?? "") ? (raw as HookProfile) : "standard";
}

export function policyPath(): string {
  return (
    process.env.JIG_POLICY_FILE ?? join(homedir(), ".config", "jig", "policy", "guard-rules.json")
  );
}

export interface GuardDoc {
  readonly rules: readonly GuardRule[];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const TIERS: ReadonlySet<string> = new Set<GuardTier>(["deny", "confirm"]);

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.length > 0 && value.every((v) => typeof v === "string");
}

/**
 * Strict validation, mirroring jig's own `src/domain/policy/parse.ts`: ANY
 * invalid rule fails the WHOLE document (never silently drops or
 * misinterprets one bad rule), so a malformed shared policy blocks here
 * exactly as it blocks jig's own hook — instead of this hand-duplicated
 * evaluator quietly doing less (a mistyped tier never matching, or a
 * missing `tools`/`profiles` throwing a TypeError out of the `tool_call`
 * handler, which a fail-open extension host would read as "proceed").
 */
export function validateGuardDoc(json: unknown): GuardDoc {
  if (!isPlainObject(json)) {
    throw new Error("guard policy: expected a JSON object at the top level");
  }

  const { rules } = json;
  if (!Array.isArray(rules)) {
    throw new Error('guard policy: "rules" must be an array');
  }

  const parsed = rules.map((raw, index): GuardRule => {
    if (!isPlainObject(raw)) {
      throw new Error(`guard policy: rules[${index}] must be an object`);
    }

    const { id, tier, tools, match, why, profiles } = raw;

    if (typeof id !== "string" || id === "") {
      throw new Error(`guard policy: rules[${index}] is missing a non-empty string "id"`);
    }
    const label = `guard policy: rule "${id}"`;

    if (typeof tier !== "string" || !TIERS.has(tier)) {
      throw new Error(
        `${label} has unknown tier ${JSON.stringify(tier)} (expected "deny" or "confirm")`,
      );
    }

    if (!isStringArray(tools)) {
      throw new Error(`${label} must have a non-empty "tools" array of strings`);
    }

    if (typeof match !== "string" || match === "") {
      throw new Error(`${label} is missing a non-empty string "match"`);
    }
    let compiled: RegExp;
    try {
      compiled = new RegExp(match);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(`${label} has an invalid "match" regex: ${reason}`);
    }

    if (typeof why !== "string" || why === "") {
      throw new Error(`${label} is missing a non-empty string "why"`);
    }

    if (!isStringArray(profiles)) {
      throw new Error(`${label} must have a non-empty "profiles" array of strings`);
    }

    return { id, tier: tier as GuardTier, tools, match: compiled, why, profiles };
  });

  return { rules: parsed };
}

export interface GuardCommand {
  readonly tool: string;
  /** The string a rule's `match` runs against: the shell command, or the file path for write/edit. */
  readonly command: string;
}

/**
 * pi tool name -> the abstract `tools` vocabulary rules are written against,
 * plus the subject to match (mirrors jig's `TOOL_ALIASES` / `subjectFor`).
 * pi's write/edit tools carry the file path as `path` (not Claude Code's
 * `file_path`); both are accepted so either payload shape reaches the same
 * rules. Returns `undefined` for tools the policy has no vocabulary for.
 */
export function guardCommandFor(
  toolName: string,
  input: Readonly<Record<string, unknown>> | undefined,
): GuardCommand | undefined {
  if (toolName === "bash" || toolName === "bash_background") {
    const command = input?.command;
    return { tool: "shell", command: typeof command === "string" ? command : "" };
  }
  if (toolName === "write" || toolName === "edit") {
    const filePath = input?.file_path ?? input?.path;
    return { tool: toolName, command: typeof filePath === "string" ? filePath : "" };
  }
  return undefined;
}

export interface GuardMatch {
  readonly tier: GuardTier;
  readonly why: string;
}

/**
 * Pure: deny always outranks confirm when both match (mirrors jig's
 * `src/domain/policy/evaluate.ts`). Returns `undefined` when nothing
 * matches — the caller decides what "no opinion" means for its host.
 */
export function evaluateGuardRules(
  rules: readonly GuardRule[],
  input: GuardCommand,
  profile: HookProfile,
): GuardMatch | undefined {
  const matches = (rule: GuardRule) =>
    rule.tools.includes(input.tool) &&
    rule.profiles.includes(profile) &&
    rule.match.test(input.command);

  const deny = rules.find((rule) => rule.tier === "deny" && matches(rule));
  if (deny !== undefined) return { tier: "deny", why: deny.why };

  const confirm = rules.find((rule) => rule.tier === "confirm" && matches(rule));
  if (confirm !== undefined) return { tier: "confirm", why: confirm.why };

  return undefined;
}

type Loaded = GuardDoc | { readonly error: string };

// Read once, at the first tool_call (not at module load — the env may not be
// settled yet). Only a SUCCESSFUL load is cached, for the rest of the
// process: a transient read/parse failure (the shared policy symlink
// briefly unreadable mid `manager.sh link`, say) must retry on the NEXT
// call rather than hard-blocking every bash call for the rest of the pi
// session — a cached error here would need a full pi restart to clear, a
// materially worse failure mode than the file being permanently missing.
let cache: { readonly path: string; readonly loaded: GuardDoc } | undefined;

export function loadPolicy(path: string): Loaded {
  if (cache !== undefined && cache.path === path) return cache.loaded;

  try {
    const doc = validateGuardDoc(JSON.parse(readFileSync(path, "utf8")));
    cache = { path, loaded: doc };
    return doc;
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

export default function (pi: ExtensionAPI) {
  pi.on("tool_call", async (event, ctx) => {
    const guarded = guardCommandFor(event.toolName, event.input as Record<string, unknown>);
    if (guarded === undefined) return;
    const cmd = guarded.command;
    const profile = resolveProfile(process.env);
    const path = policyPath();

    const loaded = loadPolicy(path);
    if ("error" in loaded) {
      return {
        block: true,
        reason:
          `jig guard policy unreadable at ${path} (${loaded.error}) — fix the link ` +
          `(manager.sh link_jig_policy) or set JIG_POLICY_FILE`,
      };
    }

    const match = evaluateGuardRules(loaded.rules, guarded, profile);
    if (match === undefined) return;

    if (match.tier === "deny") {
      return {
        block: true,
        reason:
          `Blocked: ${match.why}. This is a hard rule — do not retry or work around it with a variant. ` +
          `State what you wanted to do and why, and let the user decide.`,
      };
    }

    let ok = false;
    try {
      ok = await ctx.ui.confirm(`Guarded command (${match.why})`, cmd.slice(0, 300));
    } catch {
      ok = false; // headless: deny by default
    }
    if (!ok) {
      return {
        block: true,
        reason:
          `Blocked: ${match.why}. Do not retry this command or work around the block with a variant. ` +
          `Explain to the user what you wanted to do and why, and let them decide.`,
      };
    }
    return; // user approved this one call — approval is not blanket
  });
}
