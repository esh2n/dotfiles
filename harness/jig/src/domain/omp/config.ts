/**
 * omp's `~/.omp/agent/config.yml`: the keys jig owns, and the rest carried
 * through as omp wrote them (owner's ruling 2026-09-27: jig writes its own
 * keys, omp keeps writing the others — the way jig treats Claude Code's
 * settings.json).
 *
 * omp rewrites this file itself (theme changes, setup bumps), so a marked
 * block like the Codex one would not survive; ownership is by key.
 *
 * Owned:
 *  - `modelRoles` — every role on a LiteLLM tier (owner's ruling
 *    2026-09-23): the thorough roles (`slow`, `plan`, `advisor`) on
 *    `complex`, everything lightweight on `main`. `deterministic` is picked
 *    by hand, never by a role.
 *  - `tools.approvalMode` and `tools.approval.eval` — untrusted repositories
 *    go to the sandbox, so the host runs `yolo`; `eval` still asks, since no
 *    Claude permission can express it and `bash.patterns` does not gate what
 *    an `eval` spawns.
 *  - `statusLine` — the same content as Claude Code's statusline.sh in omp's
 *    own segments (rules/research/2026-09-27-statusline-across-harnesses.md):
 *    model and effort, directory, git, context used on the left; extension
 *    statuses (the tier, the Swarm), time spent and cost on the right.
 *
 * Written only when the file does not exist yet (omp's own afterwards):
 * `symbolPreset`, `composer`, `theme`, `setupVersion`.
 *
 * Pure: objects in, objects out. YAML is the caller's.
 */

export type YamlValue =
  | string
  | number
  | boolean
  | null
  | YamlValue[]
  | { [key: string]: YamlValue };
export type YamlObject = { [key: string]: YamlValue };

const MODEL_ROLES: YamlObject = {
  default: "proxy/main",
  smol: "proxy/main",
  tiny: "proxy/main",
  commit: "proxy/main",
  task: "proxy/main",
  slow: "proxy/complex",
  plan: "proxy/complex",
  advisor: "proxy/complex",
};

const STATUS_LINE: YamlObject = {
  preset: "custom",
  leftSegments: ["model", "path", "git", "context_pct"],
  rightSegments: ["status", "time_spent", "cost"],
  segmentOptions: {
    model: { showThinkingLevel: true },
    path: { abbreviate: true },
    git: { showBranch: true, showStaged: true, showUnstaged: true, showUntracked: true },
  },
};

const BOOTSTRAP: YamlObject = {
  symbolPreset: "unicode",
  composer: { shape: "box" },
  theme: { light: "light" },
  setupVersion: 2,
};

/** Dotted paths jig owns, in the order the owned view lists them. */
export const OMP_OWNED_PATHS: readonly string[] = [
  "modelRoles",
  "tools.approvalMode",
  "tools.approval.eval",
  "statusLine",
];

const OWNED_VALUES: Readonly<Record<string, YamlValue>> = {
  modelRoles: MODEL_ROLES,
  "tools.approvalMode": "yolo",
  "tools.approval.eval": "prompt",
  statusLine: STATUS_LINE,
};

function isObject(value: YamlValue | undefined): value is YamlObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function get(root: YamlObject, path: string): YamlValue | undefined {
  let at: YamlValue | undefined = root;
  for (const part of path.split(".")) {
    if (!isObject(at)) return undefined;
    at = at[part];
  }
  return at;
}

/** A copy of `root` with `value` at `path`, creating objects on the way (a non-object in the way is replaced). */
function set(root: YamlObject, path: string, value: YamlValue): YamlObject {
  const [head, ...rest] = path.split(".");
  if (head === undefined) return root;
  if (rest.length === 0) return { ...root, [head]: value };
  const child = root[head];
  return { ...root, [head]: set(isObject(child) ? child : {}, rest.join("."), value) };
}

export interface OmpConfigComposition {
  readonly config: YamlObject;
  /** Top-level keys carried through as found. */
  readonly carried: readonly string[];
}

/** `current` is the parsed file, or undefined when there is none yet. */
export function composeOmpConfig(current: YamlObject | undefined): OmpConfigComposition {
  let config: YamlObject = current === undefined ? { ...BOOTSTRAP } : { ...current };
  for (const path of OMP_OWNED_PATHS) {
    const value = OWNED_VALUES[path];
    if (value !== undefined) config = set(config, path, value);
  }
  const owned = new Set(["modelRoles", "statusLine"]);
  const carried =
    current === undefined ? [] : Object.keys(current).filter((key) => !owned.has(key));
  return { config, carried };
}

/**
 * The owned part alone, as one string: what a hand edit is judged on (omp
 * rewrites the other keys itself, so a whole-file comparison would take its
 * every theme change for a hand edit of jig's content). A path the file does
 * not have is left out.
 */
export function ompOwnedView(config: YamlObject | undefined): string {
  if (config === undefined) return "[]";
  return JSON.stringify(
    OMP_OWNED_PATHS.flatMap((path) => {
      const value = get(config, path);
      return value === undefined ? [] : [[path, value]];
    }),
  );
}
