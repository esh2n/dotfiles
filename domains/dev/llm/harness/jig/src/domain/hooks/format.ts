/**
 * Which formatter one edited file gets, and where its project starts.
 *
 * `rules/decisions/2026-09-22-format-on-edit-gate-on-stop.md`: 整形は編集ごと、
 * 編集したファイルだけ、無音。The "edited file only, never the tree" part is
 * enforced by shape — every function here takes a single file.
 *
 * `rules/decisions/2026-09-23-project-hooks-first-jig-table-fallback.md` puts
 * one branch in front of all of that: a project with its own hook runner
 * (`lefthook.yml` / `.lefthook.yml` / `.pre-commit-config.yaml`) gets that
 * runner on the edited file, and the extension table below is only for
 * projects with none. `formatPlanFor` is that precedence; `formatterFor` is
 * the table alone.
 *
 * `rules/decisions/2026-09-23-hooks-carry-formatters-only-stylelint-added.md`
 * adds one entry to the table and takes one guess out of it:
 *
 * - stylelint on `.css .scss .sass .less`, only when the project has a
 *   stylelint config — 「設定か沈黙か」. The config names are stylelint's own
 *   (https://stylelint.io/user-guide/configure): `stylelint.config.js` /
 *   `.mjs` / `.cjs`, and the legacy `.stylelintrc.js` / `.mjs` / `.cjs`,
 *   `.stylelintrc` (YAML or JSON), `.stylelintrc.yml` / `.yaml` / `.json`,
 *   and a `stylelint` property in `package.json`. The command is
 *   `stylelint --fix <file>` (https://stylelint.io/user-guide/cli: 「--fix:
 *   Automatically fix, where possible, problems reported by rules.」).
 *   `.css` goes to biome / prettier only when no stylelint config exists;
 *   `.scss .sass .less` never do.
 * - rustfmt reads the project's edition instead of a hard-coded one.
 *   https://rust-lang.github.io/rustfmt/ ("edition"): default `"2015"`; cargo
 *   fmt passes the edition from `Cargo.toml`, but bare `rustfmt` does not
 *   read `Cargo.toml` and takes 2015 unless `rustfmt.toml` / `.rustfmt.toml`
 *   sets it or `--edition` is passed. So: a `rustfmt.toml` / `.rustfmt.toml`
 *   at the root means rustfmt's own lookup and nothing is passed; else the
 *   root `Cargo.toml`'s `[package] edition` is passed as `--edition`; else
 *   `--edition 2021`, the same default as before.
 *
 * Pure: `exists` and `readText` are injected, nothing is executed. The
 * harness adapters (`cli/hooks/post-tool-use-format.ts` for Claude Code,
 * `adapters/omp/src/format.ts` for omp) supply the event decoding and the
 * runner; this decides only what to run.
 */

import { dirname, extname, join, relative } from "node:path";
import { PROJECT_HOOK_MARKERS, projectHookCommand, projectHooksFor } from "./project-hooks";

/** Reads one file's text, or `undefined` when it cannot be read. */
export type ReadText = (path: string) => string | undefined;

const NO_TEXT: ReadText = () => undefined;

/**
 * Where a file's project starts: the nearest ancestor with a project marker.
 * The hook configs are markers too, so a project that has nothing but a
 * `lefthook.yml` still has a root.
 */
const ROOT_MARKERS = [
  ...PROJECT_HOOK_MARKERS,
  "package.json",
  "biome.json",
  "biome.jsonc",
  "go.mod",
  "pyproject.toml",
  "Cargo.toml",
  ".git",
];

export function projectRoot(from: string, exists: (path: string) => boolean): string {
  let dir = from;
  for (;;) {
    for (const marker of ROOT_MARKERS) if (exists(join(dir, marker))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return from;
    dir = parent;
  }
}

export interface FormatCommand {
  readonly bin: string;
  readonly args: readonly string[];
}

const WEB_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".mts",
  ".cts",
  ".json",
  ".jsonc",
  ".css",
]);

/** The stylesheet extensions stylelint formats; `.css` is also in the web table. */
const STYLE_EXTENSIONS = new Set([".css", ".scss", ".sass", ".less"]);

/**
 * stylelint's config file names, from https://stylelint.io/user-guide/configure
 * — the preferred `stylelint.config.*` first, then the legacy `.stylelintrc*`
 * spellings the page still lists. The `package.json` property is checked
 * separately, since it is a key inside a file, not a file.
 */
export const STYLELINT_CONFIG_FILES: readonly string[] = [
  "stylelint.config.js",
  "stylelint.config.mjs",
  "stylelint.config.cjs",
  ".stylelintrc.js",
  ".stylelintrc.mjs",
  ".stylelintrc.cjs",
  ".stylelintrc",
  ".stylelintrc.yml",
  ".stylelintrc.yaml",
  ".stylelintrc.json",
];

/** True when `package.json`'s text carries a `stylelint` property. */
function packageJsonHasStylelint(text: string | undefined): boolean {
  if (text === undefined) return false;
  try {
    const parsed: unknown = JSON.parse(text);
    return (
      typeof parsed === "object" &&
      parsed !== null &&
      !Array.isArray(parsed) &&
      (parsed as Record<string, unknown>).stylelint !== undefined
    );
  } catch {
    return false;
  }
}

/** Whether the project at `root` configures stylelint, by the documented locations. */
export function stylelintConfigured(
  root: string,
  exists: (path: string) => boolean,
  readText: ReadText = NO_TEXT,
): boolean {
  if (STYLELINT_CONFIG_FILES.some((name) => exists(join(root, name)))) return true;
  const packageJson = join(root, "package.json");
  return exists(packageJson) && packageJsonHasStylelint(readText(packageJson));
}

const RUSTFMT_CONFIG_FILES: readonly string[] = ["rustfmt.toml", ".rustfmt.toml"];
const DEFAULT_RUST_EDITION = "2021";

/**
 * The `edition = "…"` of a `Cargo.toml`'s `[package]` table, or `undefined`
 * when the table or the key is absent (a workspace-inherited
 * `edition.workspace = true` is absent too: the value lives in another
 * file). A line scanner, not a TOML parser — the one key, in the one table,
 * as a quoted string, which is the only form Cargo accepts for it.
 */
export function cargoEdition(cargoToml: string): string | undefined {
  let inPackage = false;
  for (const raw of cargoToml.split("\n")) {
    const line = raw.trim();
    if (line.startsWith("[")) {
      inPackage = /^\[\s*package\s*\]/.test(line);
      continue;
    }
    if (!inPackage) continue;
    const match = /^edition\s*=\s*"(\d{4})"/.exec(line);
    if (match?.[1] !== undefined) return match[1];
  }
  return undefined;
}

/**
 * rustfmt's arguments before the file: nothing when the project has a
 * `rustfmt.toml` / `.rustfmt.toml` (rustfmt's own lookup owns the edition),
 * else `--edition` from the root `Cargo.toml`, else `--edition 2021`.
 */
export function rustfmtArgs(
  root: string,
  exists: (path: string) => boolean,
  readText: ReadText = NO_TEXT,
): readonly string[] {
  if (RUSTFMT_CONFIG_FILES.some((name) => exists(join(root, name)))) return [];
  const cargoToml = join(root, "Cargo.toml");
  const edition = exists(cargoToml) ? cargoEdition(readText(cargoToml) ?? "") : undefined;
  return ["--edition", edition ?? DEFAULT_RUST_EDITION];
}

/**
 * The formatter for one file: the project's stylelint for a stylesheet when
 * it is configured; biome when the project configures it (and the local
 * binary when the project vendors one), else prettier, else the language's
 * own. `undefined` means "nothing formats this", which is a skip, not an
 * error.
 */
export function formatterFor(
  file: string,
  root: string,
  exists: (path: string) => boolean,
  readText: ReadText = NO_TEXT,
): FormatCommand | undefined {
  const ext = extname(file).toLowerCase();
  const local = (name: string): string | undefined => {
    const bin = join(root, "node_modules", ".bin", name);
    return exists(bin) ? bin : undefined;
  };
  if (STYLE_EXTENSIONS.has(ext)) {
    if (stylelintConfigured(root, exists, readText)) {
      return { bin: local("stylelint") ?? "stylelint", args: ["--fix", file] };
    }
    // No config: `.css` still has the web table; the preprocessor
    // extensions have nothing, by the ruling (「設定か沈黙か」).
    if (ext !== ".css") return undefined;
  }
  if (WEB_EXTENSIONS.has(ext)) {
    const biome = exists(join(root, "biome.json")) || exists(join(root, "biome.jsonc"));
    if (biome) {
      // `check --write` is format plus the safe lint fixes in one pass, the
      // same invocation the repo's own scripts use.
      return { bin: local("biome") ?? "biome", args: ["check", "--write", file] };
    }
    return { bin: local("prettier") ?? "prettier", args: ["--write", file] };
  }
  switch (ext) {
    case ".go":
      return { bin: "gofmt", args: ["-w", file] };
    case ".py":
      return { bin: "ruff", args: ["format", file] };
    case ".rs":
      return { bin: "rustfmt", args: [...rustfmtArgs(root, exists, readText), file] };
    default:
      return undefined;
  }
}

/**
 * What formats one file, with where the answer came from: `project` is the
 * project's own hook runner, `table` is jig's extension table. The adapters
 * log `source`; the ruling's "never substitute" clause depends on their
 * treating a missing `project` tool differently from a missing `table` one.
 */
export interface FormatPlan extends FormatCommand {
  readonly source: "project" | "table";
  /** The directory to run in: the hook config's, or the table's project root. */
  readonly cwd: string;
}

/** The project's hooks on this one file if it has any, else the table. */
export function formatPlanFor(
  file: string,
  exists: (path: string) => boolean,
  readText: ReadText = NO_TEXT,
): FormatPlan | undefined {
  const hooks = projectHooksFor(dirname(file), exists);
  if (hooks !== undefined) {
    const command = projectHookCommand(hooks, [relative(hooks.root, file)]);
    return { source: "project", bin: command.bin, args: command.args, cwd: hooks.root };
  }
  const root = projectRoot(dirname(file), exists);
  const command = formatterFor(file, root, exists, readText);
  return command === undefined ? undefined : { source: "table", ...command, cwd: root };
}
