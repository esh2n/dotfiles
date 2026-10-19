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

/**
 * Where the skill router reads the list a Claude Code session shows:
 * `JIG_SKILL_ROOT`, else `<config dir>/skills`, the directory Claude Code
 * itself loads from. `CLAUDE_CONFIG_DIR` is honored because Claude Code
 * honors it and hands its environment to the hook.
 */
export function resolveSkillRoot(env: Env, home: string = homedir()): string {
  return env.JIG_SKILL_ROOT ?? join(env.CLAUDE_CONFIG_DIR ?? join(home, ".claude"), "skills");
}

/**
 * Where external skill packs are checked out (`harness/plugins/<name>/`
 * names them; `dotctl setup plugins` fetches them): `JIG_PLUGINS_DIR`, else
 * `$XDG_DATA_HOME/jig/plugins`, else `~/.local/share/jig/plugins`. dotctl
 * resolves the same way, so the two agree without passing a path.
 */
export function resolvePluginsDir(env: Env, home: string = homedir()): string {
  if (env.JIG_PLUGINS_DIR) return env.JIG_PLUGINS_DIR;
  const data = env.XDG_DATA_HOME ? env.XDG_DATA_HOME : join(home, ".local", "share");
  return join(data, "jig", "plugins");
}

/** The guard audit log's path, derived from the state dir. */
export function resolveAuditPath(env: Env): string {
  return join(resolveStateDir(env), "guard-audit.jsonl");
}

/**
 * Where each session's model is recorded at `SessionStart` and read back on
 * every `PreToolUse`. Derived from the state dir like the audit log, so the
 * writer and the reader — two different processes — agree without being told.
 */
export function resolveSessionsPath(env: Env): string {
  return join(resolveStateDir(env), "sessions.jsonl");
}
