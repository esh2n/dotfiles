/**
 * Where pi keeps its user-level configuration, resolved the way pi resolves
 * it. https://pi.dev/docs/latest/configuration ("Agent directory"):
 * "User-level configuration lives in the agent directory, which defaults to
 * `~/.pi/agent`. ... Set its location with the `PI_CODING_AGENT_DIR`
 * environment variable"; https://pi.dev/docs/latest/environment-variables
 * ("Pi Process Configuration"): `PI_CODING_AGENT_DIR` — "Override the config
 * directory; default is `~/.pi/agent`". Honoured for the reason the other
 * targets honour theirs: a moved directory must not get a second copy at the
 * default path.
 *
 * Pure.
 */

export interface PiAgentDir {
  readonly dir: string;
  /** Which rule decided it, for the dry-run. */
  readonly via: "PI_CODING_AGENT_DIR" | "default";
}

export function resolvePiAgentDir(
  env: Readonly<Record<string, string | undefined>>,
  home: string,
): PiAgentDir {
  const override = env.PI_CODING_AGENT_DIR;
  if (override !== undefined && override !== "") {
    return { dir: override, via: "PI_CODING_AGENT_DIR" };
  }
  return { dir: `${home}/.pi/agent`, via: "default" };
}
