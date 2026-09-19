import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// Blast-radius guard for the local lane — the pi-side counterpart of yoki's
// git-guard.sh (hooks are Claude Code-only; pi needs its own enforcement).
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

type GuardTier = "deny" | "confirm";
interface GuardRule {
  readonly id: string;
  readonly tier: GuardTier;
  readonly tools: readonly string[];
  readonly match: RegExp;
  readonly why: string;
  readonly profiles: readonly string[];
}

const PROFILES = ["minimal", "standard", "strict"] as const;
type HookProfile = (typeof PROFILES)[number];

function resolveProfile(env: NodeJS.ProcessEnv): HookProfile {
  const raw = env.JIG_HOOK_PROFILE ?? env.YOKI_HOOK_PROFILE;
  return (PROFILES as readonly string[]).includes(raw ?? "") ? (raw as HookProfile) : "standard";
}

function policyPath(): string {
  return process.env.JIG_POLICY_FILE ?? join(homedir(), ".config", "jig", "policy", "guard-rules.json");
}

type Loaded = { readonly rules: readonly GuardRule[] } | { readonly error: string };

// Read once, at the first tool_call (not at module load — the env may not be
// settled yet), then cached for the rest of the process.
let cache: { readonly path: string; readonly loaded: Loaded } | undefined;

function loadPolicy(path: string): Loaded {
  if (cache !== undefined && cache.path === path) return cache.loaded;

  let loaded: Loaded;
  try {
    const doc = JSON.parse(readFileSync(path, "utf8")) as {
      rules: Array<{
        id: string;
        tier: GuardTier;
        tools: string[];
        match: string;
        why: string;
        profiles: string[];
      }>;
    };
    loaded = { rules: doc.rules.map((r) => ({ ...r, match: new RegExp(r.match) })) };
  } catch (err) {
    loaded = { error: err instanceof Error ? err.message : String(err) };
  }

  cache = { path, loaded };
  return loaded;
}

export default function (pi: ExtensionAPI) {
  pi.on("tool_call", async (event, ctx) => {
    if (event.toolName !== "bash" && event.toolName !== "bash_background") return;
    const cmd: string = (event.input as any)?.command ?? "";
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

    const matches = (rule: GuardRule) =>
      rule.tools.includes("shell") && rule.profiles.includes(profile) && rule.match.test(cmd);

    const denyRule = loaded.rules.find((r) => r.tier === "deny" && matches(r));
    if (denyRule) {
      return {
        block: true,
        reason:
          `Blocked: ${denyRule.why}. This is a hard rule — do not retry or work around it with a variant. ` +
          `State what you wanted to do and why, and let the user decide.`,
      };
    }

    const confirmRule = loaded.rules.find((r) => r.tier === "confirm" && matches(r));
    if (confirmRule) {
      let ok = false;
      try {
        ok = await ctx.ui.confirm(`Guarded command (${confirmRule.why})`, cmd.slice(0, 300));
      } catch {
        ok = false; // headless: deny by default
      }
      if (!ok) {
        return {
          block: true,
          reason:
            `Blocked: ${confirmRule.why}. Do not retry this command or work around the block with a variant. ` +
            `Explain to the user what you wanted to do and why, and let them decide.`,
        };
      }
      return; // user approved this one call — approval is not blanket
    }
  });
}
