/**
 * Where DSH keeps its harness home, resolved the way DSH resolves it.
 * `@deepseek-ai/dsh-home-paths` README (0.1.5-rc.2, "Resolving the home"):
 * "An explicit configured path has the highest precedence, then `$DSH_HOME`,
 * then the default `~/.dsh`. An empty or whitespace-only `$DSH_HOME` is
 * treated as unset, so a blank override never resolves the home to the
 * current working directory." jig has no configured path, so the rule here
 * is the variable, else the default. Honoured for the reason the other
 * targets honour theirs: a moved home must not get a second copy at the
 * default path. `core/config/manager.sh link_dsh_resources` reads the same
 * variable (`${DSH_HOME:-${HOME}/.dsh}`).
 *
 * Pure.
 */

export interface DshHome {
  readonly dir: string;
  /** Which rule decided it, for the dry-run. */
  readonly via: "DSH_HOME" | "default";
}

export function resolveDshHome(
  env: Readonly<Record<string, string | undefined>>,
  home: string,
): DshHome {
  const override = env.DSH_HOME;
  if (override !== undefined && override.trim() !== "") {
    return { dir: override, via: "DSH_HOME" };
  }
  return { dir: `${home}/.dsh`, via: "default" };
}

/** `$DSH_HOME/profiles`: "Directory under the Harness home holding every profile" (dsh-app-boot `profile.d.ts`, `PROFILES_DIR`). */
export const DSH_PROFILES_DIR = "profiles";

/** "The user patch layer inside a profile directory" (dsh-app-boot `profile.d.ts`, `PROFILE_PATCH_FILENAME`). */
export const DSH_PROFILE_PATCH_FILENAME = "cordis.patch.yml";
