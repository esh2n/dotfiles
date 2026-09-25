/**
 * Where omp (oh-my-pi) keeps its user-level configuration — the directory
 * every destination of `jig apply --target omp` sits under.
 *
 * omp documents the resolution in two places, both followed here:
 *
 * - docs/environment-variables.md §6 "Storage and config root paths"
 *   (https://github.com/can1357/oh-my-pi/blob/main/docs/environment-variables.md):
 *   `OMP_PROFILE` — "Canonical named profile selector; wins over `PI_PROFILE`
 *   even when explicitly empty"; `PI_PROFILE` — "Legacy profile selector used
 *   only when `OMP_PROFILE` is undefined"; `PI_CONFIG_DIR` — "Config root
 *   dirname under home (default `.omp`)"; `PI_CODING_AGENT_DIR` — "Full
 *   agent-directory override for the default profile only; named profiles
 *   ignore it".
 * - docs/config-usage.md "Profiles"
 *   (https://github.com/can1357/oh-my-pi/blob/main/docs/config-usage.md#profiles):
 *   "`default`, empty, or whitespace selects the default profile. When a
 *   profile is active, every OMP-native user-level path written here as
 *   `~/.omp/agent/...` normally resolves to `~/.omp/profiles/<name>/agent/...`."
 *
 * Honoured for the same reason `CLAUDE_CONFIG_DIR` and `CODEX_HOME` are: a
 * machine that moved its configuration must not have jig quietly compose a
 * second copy at the default path. The XDG relocation the same page describes
 * covers data, state and cache, not the agent directory, so it is not read.
 *
 * Pure: an environment record in, a path out.
 */

/** The four variables read: `OMP_PROFILE`, `PI_PROFILE`, `PI_CONFIG_DIR`, `PI_CODING_AGENT_DIR`. */
export type OmpDirEnv = Readonly<Record<string, string | undefined>>;

export interface OmpAgentDir {
  readonly dir: string;
  /** Which rule produced the path, for the dry-run's `dest:` line. */
  readonly how: "PI_CODING_AGENT_DIR" | "profile" | "default";
  /** The named profile when one is active. */
  readonly profile?: string;
}

/** The active profile name, or nothing for the default profile. */
export function activeOmpProfile(env: OmpDirEnv): string | undefined {
  const selected = env.OMP_PROFILE !== undefined ? env.OMP_PROFILE : env.PI_PROFILE;
  const name = selected?.trim() ?? "";
  return name === "" || name === "default" ? undefined : name;
}

export function resolveOmpAgentDir(env: OmpDirEnv, home: string): OmpAgentDir {
  const configDir = env.PI_CONFIG_DIR?.trim() || ".omp";
  const profile = activeOmpProfile(env);
  if (profile !== undefined) {
    return { dir: `${home}/${configDir}/profiles/${profile}/agent`, how: "profile", profile };
  }
  const explicit = env.PI_CODING_AGENT_DIR?.trim() ?? "";
  if (explicit !== "") return { dir: explicit, how: "PI_CODING_AGENT_DIR" };
  return { dir: `${home}/${configDir}/agent`, how: "default" };
}
