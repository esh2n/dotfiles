/**
 * An external skill pack: `harness/plugins/<name>/source.json` names where
 * it comes from and which of its directories are skills and agents
 * (`rules/decisions/2026-10-18-pstack-shared-skills.md`). `dotctl setup
 * plugins` fetches it into `<plugins dir>/<name>`; `jig apply` links its
 * skills and agents beside the house's own. Nothing from it is copied into
 * the repository.
 *
 * `translated` lists the names the house's translation rule covers
 * (`rules/common/80-pstack.md`). A pack written for one harness names that
 * harness's tools; when its own adapter table gains a row the rule does not
 * cover, `untranslated` says so and the apply reports it.
 *
 * Pure. No IO.
 */

export interface PluginSource {
  readonly name: string;
  /** `https://github.com/<owner>/<repo>`: GitHub only, so the fetch goes nowhere else. */
  readonly repo: string;
  /** The branch followed on every `make up`. */
  readonly ref: string;
  /** A pinned commit; when set, the pack stays there instead of following `ref`. */
  readonly commit?: string;
  /** Skill directories, relative to the checkout. */
  readonly skills: string;
  /** Agent definitions (`<name>.md`), relative to the checkout. */
  readonly agents?: string;
  /** The pack's own tool-name table for another harness, relative to the checkout. */
  readonly adapter?: string;
  readonly translated: readonly string[];
}

const NAME_RE = /^[a-z][a-z0-9-]*$/;
const REPO_RE = /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const REF_RE = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;
const COMMIT_RE = /^[0-9a-f]{40}$/;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A path inside the checkout: relative, no `..` segment, no empty segment. */
function insidePath(name: string, key: string, value: unknown): string {
  const ok =
    typeof value === "string" &&
    value !== "" &&
    !value.startsWith("/") &&
    value.split("/").every((part) => part !== "" && part !== "." && part !== "..");
  if (!ok) throw new Error(`plugin "${name}": "${key}" must be a path inside the checkout`);
  return value;
}

function optionalPath(name: string, key: string, value: unknown): string | undefined {
  return value === undefined ? undefined : insidePath(name, key, value);
}

export function parsePluginSource(name: string, text: string): PluginSource {
  if (!NAME_RE.test(name)) {
    throw new Error(`plugin name "${name}" is not lowercase letters, digits and hyphens`);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    throw new Error(`plugin "${name}": source.json is not JSON (${String(error)})`);
  }
  if (!isObject(raw)) throw new Error(`plugin "${name}": source.json must be an object`);

  if (typeof raw.repo !== "string" || !REPO_RE.test(raw.repo)) {
    throw new Error(
      `plugin "${name}": "repo" must be a GitHub repository, https://github.com/<owner>/<repo>`,
    );
  }
  if (typeof raw.ref !== "string" || !REF_RE.test(raw.ref) || raw.ref.includes("..")) {
    throw new Error(`plugin "${name}": "ref" must be a branch name`);
  }
  if (raw.commit !== undefined && (typeof raw.commit !== "string" || !COMMIT_RE.test(raw.commit))) {
    throw new Error(`plugin "${name}": "commit" must be a 40 hex commit id`);
  }
  const translated = raw.translated;
  if (!Array.isArray(translated) || !translated.every((item) => typeof item === "string")) {
    throw new Error(`plugin "${name}": "translated" must be an array of names`);
  }
  const agents = optionalPath(name, "agents", raw.agents);
  const adapter = optionalPath(name, "adapter", raw.adapter);
  return {
    name,
    repo: raw.repo,
    ref: raw.ref,
    ...(raw.commit === undefined ? {} : { commit: raw.commit as string }),
    skills: insidePath(name, "skills", raw.skills),
    ...(agents === undefined ? {} : { agents }),
    ...(adapter === undefined ? {} : { adapter }),
    translated: [...(translated as string[])],
  };
}

/**
 * The names an adapter table translates: every code span in the first cell
 * of each table row, header and divider rows aside. In order, once each.
 */
export function adapterNames(markdown: string): readonly string[] {
  const names: string[] = [];
  for (const line of markdown.split("\n")) {
    if (!line.startsWith("|")) continue;
    const first = line.split("|")[1] ?? "";
    for (const match of first.matchAll(/`([^`]+)`/g)) {
      const name = match[1] ?? "";
      if (name !== "" && !names.includes(name)) names.push(name);
    }
  }
  return names;
}

/** The adapter's names the house translation does not list. */
export function untranslated(markdown: string, translated: readonly string[]): readonly string[] {
  const covered = new Set(translated);
  return adapterNames(markdown).filter((name) => !covered.has(name));
}

/** Frontmatter keys a pack's skill or agent may not carry: Claude Code registers them. */
const RISKY_KEYS = ["hooks", "mcpServers"] as const;

/**
 * Which of `hooks` and `mcpServers` a definition's YAML frontmatter declares
 * at its top level. No frontmatter, none.
 */
export function riskyFrontmatterKeys(text: string): readonly string[] {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
  if (match === null) return [];
  const keys = new Set(
    (match[1] ?? "").split(/\r?\n/).flatMap((line) => {
      const key = /^([A-Za-z_][\w-]*)\s*:/.exec(line)?.[1];
      return key === undefined ? [] : [key];
    }),
  );
  return RISKY_KEYS.filter((key) => keys.has(key));
}
