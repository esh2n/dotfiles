/**
 * The environment every adapter reads the same way. One place, so pi's
 * in-process extension, the CLI hook Claude Code and DSH run, and any
 * future adapter agree on which variables mean what.
 */

import { homedir } from "node:os";
import { join } from "node:path";
import type { HookProfile } from "../../domain/hooks/decision";

const PROFILES: readonly HookProfile[] = ["minimal", "standard", "strict"];

type Env = Readonly<Record<string, string | undefined>>;

/**
 * JIG_HOOK_PROFILE is the name going forward; YOKI_HOOK_PROFILE is honored
 * while machines still export it. An unrecognized value falls back to
 * "standard" — never to a narrower profile.
 */
export function resolveProfile(env: Env): HookProfile {
  const raw = env.JIG_HOOK_PROFILE ?? env.YOKI_HOOK_PROFILE;
  return PROFILES.includes(raw as HookProfile) ? (raw as HookProfile) : "standard";
}

/** Where the shared guard policy is read from: JIG_POLICY_FILE, else the machine-linked default. */
export function resolvePolicyPath(env: Env): string {
  return env.JIG_POLICY_FILE ?? join(homedir(), ".config", "jig", "policy", "guard-rules.json");
}

/** Where jig keeps state that outlives a process (logs, audit): JIG_STATE_DIR, else XDG state. */
export function resolveStateDir(env: Env): string {
  return env.JIG_STATE_DIR ?? join(homedir(), ".local", "state", "jig");
}

/** The guard audit log's path, derived from the state dir. */
export function resolveAuditPath(env: Env): string {
  return join(resolveStateDir(env), "guard-audit.jsonl");
}

/**
 * Where the skill router reads the list a Claude Code session shows:
 * `JIG_SKILL_ROOT`, else `<config dir>/skills` — the directory Claude Code
 * itself loads from, in the configuration directory the session runs in.
 * `CLAUDE_CONFIG_DIR` is honored because Claude Code honors it and hands its
 * environment to the hook: a session in `~/.claude-pstack` must be offered
 * that directory's skills, not `~/.claude`'s.
 */
export function resolveSkillRoot(env: Env, home: string = homedir()): string {
  return env.JIG_SKILL_ROOT ?? join(env.CLAUDE_CONFIG_DIR ?? join(home, ".claude"), "skills");
}

/**
 * The rules profile a configuration directory's AGENTS.md renders:
 * `JIG_PROFILE` names `harness/profiles/<name>/`. Unset or blank means the
 * default — every common rule and every accepted decision.
 */
export function resolveRulesProfile(env: Env): string | undefined {
  const raw = env.JIG_PROFILE?.trim();
  if (raw === undefined || raw === "") return undefined;
  // A directory name and nothing else: the value is joined under
  // `harness/profiles/`, and a `../` here would render files from anywhere
  // into AGENTS.md as always-on rules.
  if (!/^[a-z][a-z0-9-]*$/.test(raw)) {
    throw new Error(
      `JIG_PROFILE="${raw}" is not a profile name (lowercase letters, digits and hyphens)`,
    );
  }
  return raw;
}

/**
 * The rules profile one apply target may render under. A profile belongs to
 * a second Claude Code configuration directory and nowhere else: with
 * `JIG_PROFILE` set, the Claude target needs `CLAUDE_CONFIG_DIR` set too
 * (the default `~/.claude` must never get a reduced AGENTS.md), and every
 * other target refuses, so a `JIG_PROFILE` left exported in a shell cannot
 * quietly rewrite the Codex, pi or DSH rules.
 */
export function resolveRulesProfileFor(env: Env, target: string): string | undefined {
  const name = resolveRulesProfile(env);
  if (name === undefined) return undefined;
  if (target !== "claude") {
    throw new Error(
      `JIG_PROFILE="${name}" applies only to --target claude; unset it for --target ${target}`,
    );
  }
  if (env.CLAUDE_CONFIG_DIR === undefined || env.CLAUDE_CONFIG_DIR.trim() === "") {
    throw new Error(
      `JIG_PROFILE="${name}" needs CLAUDE_CONFIG_DIR: a rules profile renders into its own configuration directory, never into ~/.claude`,
    );
  }
  return name;
}

/**
 * Where each session's model is recorded at `SessionStart` and read back on
 * every `PreToolUse`. Derived from the state dir like the audit log, so the
 * writer and the reader — two different processes — agree without being told.
 */
export function resolveSessionsPath(env: Env): string {
  return join(resolveStateDir(env), "sessions.jsonl");
}
