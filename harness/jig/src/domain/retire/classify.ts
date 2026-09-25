/**
 * The classifiers of `jig retire yoki` for files, links and directories:
 * each takes what `lstat` (and a listing) found and answers with a
 * `RetireItem` — what the path is, the evidence it is yoki's, and the action.
 *
 * Every function here is pure. The use-case (`app/retire/retire-yoki.ts`)
 * inspects the paths and hands over what it found; the adapter removes only
 * what came back as a removal, and refuses on its own account a tree that
 * holds a regular file outside `.yoki/`.
 *
 * The evidence, per kind of artifact:
 *
 * - **a `.<x>-merged` staging directory** (`~/.claude/`): yoki-switch's
 *   `merge_dir()` builds it as a directory holding only symlinks into
 *   `claude-profiles/`. Removable when every entry is a symlink or the
 *   directory is empty; a real file inside is somebody's and stops it. Also
 *   stopped while `~/.claude/<x>` is still a symlink to it — removing the
 *   target first would leave the harness a dangling directory; `jig apply
 *   --target claude --write` replaces those links (`hooks` excepted: this
 *   command removes that link itself, in the same run).
 * - **a `.yoki/` state directory**: yoki's own, by name. The one tree whose
 *   regular files (`permissions.json`, `*-manifest.json`) are removed.
 * - **a yoki file by name** (`.claude-packs`, `yoki-hooks.json`, `rules/yoki.rules`,
 *   `RULES.md`): a regular file at the path; where the file carries a
 *   generated-by-yoki header, the header is required too.
 * - **a link into a retired tree** (`~/.claude/hooks` → `.hooks-merged`,
 *   omp's `yoki-*.ts`, Codex's skill ports, Cursor's rules): a symlink whose
 *   target lies under the named root.
 * - **a Codex `cmd-<name>` skill directory**: yoki's command→skill
 *   conversion. No `cmd-*` `SKILL.md` carries a yoki marker (checked on the
 *   live files, 2026-09-23: the frontmatter is `name`/`description` only),
 *   so the evidence is yoki's own record — `~/.codex/.yoki/codex-manifest.json`
 *   lists every `SKILL.md` it wrote — and, when that manifest is gone, the
 *   inventory's sixteen names. The directory must hold that one file and
 *   nothing else.
 */

import type { PathState } from "../claude/links";
import { type RetireHarness, type RetireItem, basename, describeFound, linksUnder } from "./items";

export interface FoundEntry {
  readonly name: string;
  readonly state: PathState;
}

/** The `~/.claude/<x>` directories yoki-switch staged as `.<x>-merged`. */
export const MERGED_DIR_NAMES = [
  "skills",
  "hooks",
  "scripts",
  "commands",
  "agents",
  "rules",
  "workflows",
] as const;

export type MergedDirName = (typeof MERGED_DIR_NAMES)[number];

export function mergedDirPath(claudeDir: string, name: MergedDirName): string {
  return `${claudeDir}/.${name}-merged`;
}

export interface MergedDirInput {
  readonly claudeDir: string;
  readonly name: MergedDirName;
  readonly state: PathState;
  /** The staging directory's entries; `[]` when it is not a directory. */
  readonly entries: readonly FoundEntry[];
  /** What stands at `~/.claude/<name>` — the live path that may still link here. */
  readonly liveState: PathState;
}

export function classifyMergedDir(input: MergedDirInput): RetireItem {
  const path = mergedDirPath(input.claudeDir, input.name);
  const base = {
    harness: "claude" as const,
    path,
    what: `yoki-switch's staging directory for ~/.claude/${input.name} (merge_dir)`,
    evidence: "a directory holding only symlinks into claude-profiles/, or empty",
  };
  switch (input.state.kind) {
    case "missing":
      return { ...base, action: { kind: "absent" } };
    case "file":
    case "symlink":
      return {
        ...base,
        action: {
          kind: "skip",
          reason: `expected a directory, found ${describeFound(input.state)}`,
        },
      };
    case "dir":
      break;
  }
  const real = input.entries.filter((entry) => entry.state.kind !== "symlink");
  if (real.length > 0) {
    const names = real
      .map((entry) => entry.name)
      .sort()
      .join(", ");
    return {
      ...base,
      action: {
        kind: "skip",
        reason: `holds ${real.length} non-symlink entr${real.length === 1 ? "y" : "ies"} (${names}) — somebody's, not a staging directory of links`,
      },
    };
  }
  const live = `${input.claudeDir}/${input.name}`;
  if (
    input.name !== "hooks" &&
    input.liveState.kind === "symlink" &&
    linksUnder(input.liveState.target, input.claudeDir, [path])
  ) {
    return {
      ...base,
      action: {
        kind: "skip",
        reason: `${live} is still a symlink to it — run \`jig apply --target claude --write\` first, which replaces that link with a managed directory`,
      },
    };
  }
  return { ...base, action: { kind: "remove-tree" } };
}

/** A `.yoki/` state directory under a harness's home. */
export function classifyStateDir(
  harness: RetireHarness,
  path: string,
  state: PathState,
  what: string,
): RetireItem {
  const base = {
    harness,
    path,
    what,
    evidence: `yoki's state directory, by name (${basename(path)})`,
  };
  switch (state.kind) {
    case "missing":
      return { ...base, action: { kind: "absent" } };
    case "dir":
      return { ...base, action: { kind: "remove-tree" } };
    case "file":
    case "symlink":
      return {
        ...base,
        action: { kind: "skip", reason: `expected a directory, found ${describeFound(state)}` },
      };
  }
}

export interface YokiFileInput {
  readonly harness: RetireHarness;
  readonly path: string;
  readonly state: PathState;
  readonly what: string;
  /** When set, the file's text must contain this marker to count as yoki's. */
  readonly marker?: { readonly text: string | undefined; readonly needle: string };
}

/** A regular file yoki wrote, known by its name and (where it has one) its generated-by header. */
export function classifyYokiFile(input: YokiFileInput): RetireItem {
  const evidence =
    input.marker === undefined
      ? `yoki's file, by name (${basename(input.path)})`
      : `yoki's file, by name and by its \`${input.marker.needle}\` header`;
  const base = { harness: input.harness, path: input.path, what: input.what, evidence };
  switch (input.state.kind) {
    case "missing":
      return { ...base, action: { kind: "absent" } };
    case "dir":
    case "symlink":
      return {
        ...base,
        action: {
          kind: "skip",
          reason: `expected a regular file, found ${describeFound(input.state)}`,
        },
      };
    case "file":
      break;
  }
  if (input.marker !== undefined && !(input.marker.text ?? "").includes(input.marker.needle)) {
    return {
      ...base,
      action: {
        kind: "skip",
        reason: `no \`${input.marker.needle}\` header in the file — not recognisably yoki's`,
      },
    };
  }
  return { ...base, action: { kind: "remove-file" } };
}

export interface LinkIntoInput {
  readonly harness: RetireHarness;
  readonly path: string;
  readonly state: PathState;
  readonly what: string;
  /** Trees a yoki link points into. */
  readonly roots: readonly string[];
  /** The dry-run's name for the roots. */
  readonly rootsLabel: string;
}

/** A symlink yoki (or yoki-switch) made, recognised by where it points. */
export function classifyLinkInto(input: LinkIntoInput): RetireItem {
  const base = {
    harness: input.harness,
    path: input.path,
    what: input.what,
    evidence: `a symlink into ${input.rootsLabel}`,
  };
  switch (input.state.kind) {
    case "missing":
      return { ...base, action: { kind: "absent" } };
    case "file":
    case "dir":
      return {
        ...base,
        action: { kind: "skip", reason: `expected a symlink, found ${describeFound(input.state)}` },
      };
    case "symlink":
      break;
  }
  const dir = input.path.slice(0, Math.max(input.path.lastIndexOf("/"), 0));
  if (!linksUnder(input.state.target, dir, input.roots)) {
    return {
      ...base,
      action: {
        kind: "skip",
        reason: `a symlink elsewhere (→ ${input.state.target}), not into ${input.rootsLabel}`,
      },
    };
  }
  return { ...base, action: { kind: "remove-link" } };
}

/**
 * The `cmd-*` names yoki's `codex-skills.js` generated on the inventoried
 * machine (2026-09-23), the fallback when `.yoki/codex-manifest.json` is gone.
 */
export const KNOWN_CMD_SKILLS: readonly string[] = [
  "cmd-aside",
  "cmd-build-fix",
  "cmd-cost-report",
  "cmd-gitmsg",
  "cmd-instinct-status",
  "cmd-learn",
  "cmd-plan",
  "cmd-prompts-explain",
  "cmd-prompts-fix-error",
  "cmd-prompts-refactor",
  "cmd-prompts-write-test",
  "cmd-quality-gate",
  "cmd-refactor-clean",
  "cmd-test-coverage",
  "cmd-update-codemaps",
  "cmd-update-docs",
];

export const SKILL_MD = "SKILL.md";

export interface CmdSkillDirInput {
  /** `~/.codex/skills/cmd-<name>`. */
  readonly path: string;
  readonly state: PathState;
  readonly entries: readonly FoundEntry[];
  /** The paths listed by `~/.codex/.yoki/codex-manifest.json`, or `undefined` when there is none. */
  readonly manifestPaths: readonly string[] | undefined;
}

/**
 * One `cmd-*` directory: two items when it is yoki's — its `SKILL.md`
 * (a regular file, removed first) and the directory (removed last, empty by
 * then). A directory holding anything else, or one neither the manifest nor
 * the known list vouches for, is skipped whole.
 */
export function classifyCmdSkillDir(input: CmdSkillDirInput): readonly RetireItem[] {
  const name = basename(input.path);
  const skillMd = `${input.path}/${SKILL_MD}`;
  const inManifest = input.manifestPaths?.includes(skillMd) === true;
  // The name list is the fallback for a machine whose manifest is gone; a
  // manifest that exists and does not list the directory is the last word.
  const known = input.manifestPaths === undefined && KNOWN_CMD_SKILLS.includes(name);
  const evidence = inManifest
    ? "listed in yoki's .yoki/codex-manifest.json"
    : known
      ? "no manifest; the name is one of the sixteen cmd-* skills the inventory lists"
      : input.manifestPaths === undefined
        ? "no manifest, and the name is not in the inventory's list"
        : "not listed in yoki's .yoki/codex-manifest.json";
  const base = {
    harness: "codex" as const,
    path: input.path,
    what: "yoki's command→skill conversion (codex-skills.js); commands are skills now",
    evidence,
  };
  if (input.state.kind === "missing") return [{ ...base, action: { kind: "absent" } }];
  if (input.state.kind !== "dir") {
    return [
      {
        ...base,
        action: {
          kind: "skip",
          reason: `expected a directory, found ${describeFound(input.state)}`,
        },
      },
    ];
  }
  if (!inManifest && !known) {
    return [{ ...base, action: { kind: "skip", reason: "no evidence it is yoki's" } }];
  }
  const others = input.entries.filter((entry) => entry.name !== SKILL_MD);
  const skill = input.entries.find((entry) => entry.name === SKILL_MD);
  if (skill === undefined || skill.state.kind !== "file" || others.length > 0) {
    const found =
      skill === undefined
        ? `no ${SKILL_MD}`
        : skill.state.kind !== "file"
          ? `${SKILL_MD} is ${describeFound(skill.state)}`
          : `holds ${others.map((entry) => entry.name).join(", ")} besides ${SKILL_MD}`;
    return [
      {
        ...base,
        action: { kind: "skip", reason: `${found} — not the one-file directory yoki wrote` },
      },
    ];
  }
  return [
    { ...base, path: skillMd, what: "the generated SKILL.md", action: { kind: "remove-file" } },
    { ...base, action: { kind: "remove-tree" } },
  ];
}

/** `~/.codex/.yoki/codex-manifest.json`: a JSON array of the paths yoki wrote. Anything else reads as no manifest. */
export function parseCodexManifest(text: string | undefined): readonly string[] | undefined {
  if (text === undefined) return undefined;
  try {
    const parsed: unknown = JSON.parse(text);
    if (!Array.isArray(parsed)) return undefined;
    return parsed.filter((entry): entry is string => typeof entry === "string");
  } catch {
    return undefined;
  }
}

export interface CursorRulesInput {
  readonly dir: string;
  readonly entries: readonly FoundEntry[];
  /** `claude-profiles/runtime/yoki/.cursor/rules`. */
  readonly yokiCursorRules: string;
}

export interface CursorRulesResult {
  readonly items: readonly RetireItem[];
  /** Entries that are not links into yoki's tree: counted, left alone. */
  readonly foreign: readonly FoundEntry[];
}

/** `~/.cursor/rules/*`: every symlink into yoki's `.cursor/rules` goes; the directory and everything else stays. */
export function classifyCursorRules(input: CursorRulesInput): CursorRulesResult {
  const items: RetireItem[] = [];
  const foreign: FoundEntry[] = [];
  for (const entry of [...input.entries].sort((a, b) => compare(a.name, b.name))) {
    const path = `${input.dir}/${entry.name}`;
    if (
      entry.state.kind === "symlink" &&
      linksUnder(entry.state.target, input.dir, [input.yokiCursorRules])
    ) {
      items.push({
        harness: "cursor",
        path,
        what: "yoki-switch's Cursor rule link",
        evidence: "a symlink into claude-profiles/runtime/yoki/.cursor/rules/",
        action: { kind: "remove-link" },
      });
    } else {
      foreign.push(entry);
    }
  }
  return { items, foreign };
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
