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
 * `rules/decisions/2026-09-23-all-languages-format-and-gate.md` takes the
 * table from four languages to eleven — C++, C#, Java, Kotlin, Perl, PHP and
 * Swift join TS/JS, Go, Python and Rust — 「言語で品質に差をつけない」. Each
 * entry is the language's de-facto formatter in its documented file-scoped,
 * in-place form; the URL sits next to the entry. Where a language has two
 * standard formatters (Kotlin, PHP) the project's config file picks. A
 * missing tool is a silent skip, as before.
 *
 * Pure: `exists`, `readText` and `readDir` are injected, nothing is executed.
 * The harness adapters (`cli/hooks/post-tool-use-format.ts` for Claude Code,
 * `adapters/omp/src/format.ts` for omp) supply the event decoding and the
 * runner; this decides only what to run.
 */

import { dirname, extname, join, relative } from "node:path";
import { PROJECT_HOOK_MARKERS, projectHookCommand, projectHooksFor } from "./project-hooks";

/** Reads one file's text, or `undefined` when it cannot be read. */
export type ReadText = (path: string) => string | undefined;

/** Lists one directory's entry names, or `[]` when it cannot be read. */
export type ReadDir = (dir: string) => readonly string[];

const NO_TEXT: ReadText = () => undefined;
const NO_DIR: ReadDir = () => [];

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
  "CMakeLists.txt",
  "pom.xml",
  "build.gradle",
  "build.gradle.kts",
  "settings.gradle",
  "settings.gradle.kts",
  "cpanfile",
  "composer.json",
  "Package.swift",
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
 * C and C++ sources and headers, all of which clang-format formats. `.h` is
 * here on the C++ side, which is where a header without a `.hpp` spelling
 * usually is.
 */
const CLANG_EXTENSIONS = new Set([".cpp", ".cc", ".cxx", ".hpp", ".hh", ".h", ".c"]);

/** Perl: scripts, modules, tests, PSGI apps and CGI scripts — perltidy's own list of what it formats. */
const PERL_EXTENSIONS = new Set([".pl", ".pm", ".t", ".psgi", ".cgi"]);

/**
 * php-cs-fixer's config names, from https://cs.symfony.com/doc/usage.html
 * (the `.dist` one first, as the docs' examples use it).
 */
export const PHP_CS_FIXER_CONFIG_FILES: readonly string[] = [
  ".php-cs-fixer.dist.php",
  ".php-cs-fixer.php",
];

/**
 * True when the root `.editorconfig` has a Kotlin section: a `[…]` header
 * whose glob names `kt` or `kts`, which is where ktlint reads every one of
 * its properties (https://pinterest.github.io/ktlint/latest/rules/configuration-ktlint/:
 * 「Properties can be overridden, provided they are specified under
 * `[*.{kt,kts}]`.」). The header alone decides — a project that wrote that
 * section wrote it for ktlint.
 */
export function ktlintConfigured(
  root: string,
  exists: (path: string) => boolean,
  readText: ReadText = NO_TEXT,
): boolean {
  const editorconfig = join(root, ".editorconfig");
  if (!exists(editorconfig)) return false;
  const text = readText(editorconfig);
  return text !== undefined && /^\s*\[[^\]\n]*\bkts?\b[^\]\n]*\]/m.test(text);
}

/**
 * The nearest `.csproj` at or above `file`'s directory, stopping at `root`;
 * else a `.sln` at `root`; else `undefined`. `dotnet format` needs the
 * project or solution named (https://learn.microsoft.com/dotnet/core/tools/dotnet-format:
 * 「dotnet format [<PROJECT | SOLUTION>]」 — without it the command looks in the
 * cwd and fails when it finds more than one), and a file belongs to the
 * project whose directory encloses it.
 */
export function csharpProject(
  file: string,
  root: string,
  readDir: ReadDir = NO_DIR,
): string | undefined {
  const named = (dir: string, ext: string): string | undefined => {
    const found = readDir(dir)
      .filter((name) => name.toLowerCase().endsWith(ext))
      .sort();
    return found[0] === undefined ? undefined : join(dir, found[0]);
  };
  let dir = dirname(file);
  for (;;) {
    const project = named(dir, ".csproj");
    if (project !== undefined) return project;
    if (dir === root || dirname(dir) === dir) break;
    dir = dirname(dir);
  }
  return named(root, ".sln");
}

/**
 * The formatter for one file: the project's stylelint for a stylesheet when
 * it is configured; biome when the project configures it (and the local
 * binary when the project vendors one), else prettier, else the language's
 * own. `undefined` means "nothing formats this", which is a skip, not an
 * error.
 *
 * The seven languages of `2026-09-23-all-languages-format-and-gate.md`, each
 * in the form its documentation gives for one file, in place:
 *
 * - C/C++ → `clang-format -i <file>`.
 *   https://clang.llvm.org/docs/ClangFormat.html: 「-i  Inplace edit <file>s,
 *   if specified.」
 * - C# → `dotnet format <project-or-sln> --include <file>`, the file relative
 *   to the cwd this runs in (the project root).
 *   https://learn.microsoft.com/dotnet/core/tools/dotnet-format: 「--include
 *   <INCLUDE>: A space-separated list of relative file or folder paths to
 *   include in formatting. The default is all files in the solution or
 *   project.」 The docs give no form without a project or solution that works
 *   for a lone file, so the project is found (`csharpProject`) and a file
 *   under none is a skip.
 * - Java → `google-java-format --replace <file>`.
 *   https://github.com/google/google-java-format: 「The formatter can act on
 *   whole files … passing through to standard-out (default) or altered
 *   in-place (`--replace`).」
 * - Kotlin → `ktlint --format <file>` when the root `.editorconfig` has a
 *   `[*.{kt,kts}]` section (ktlint's config), else `ktfmt <file>`.
 *   https://pinterest.github.io/ktlint/latest/install/cli/: 「ktlint --format
 *   # or ktlint -F」 and, under Globs, 「Globs can be used to specify more
 *   exactly what files and directories are to be validated.」
 *   https://github.com/facebook/ktfmt: 「ktfmt … [--kotlinlang-style |
 *   --google-style] [files...]」 — no config file of its own, so it is the
 *   default.
 * - Perl → `perltidy -b -bext=/ <file>`.
 *   https://perltidy.sourceforge.net/perltidy.html: 「-b, --backup-and-modify-in-place:
 *   Modify the input file or files in-place and save the original with the
 *   extension .bak.」 and 「-bext=ext … To indicate that the backup should be
 *   deleted include one forward slash, /, in the extension.」 with the table
 *   row 「-bext='/'  .bak  Delete if no errors」 — so no `.bak` is left behind
 *   on success, and on a perltidy error the original survives as `.bak`.
 * - PHP → `pint <file>` when `pint.json` exists or `vendor/bin/pint` is
 *   vendored; else `php-cs-fixer fix <file>` when `.php-cs-fixer.dist.php` /
 *   `.php-cs-fixer.php` exists; else pint, the default with no config. The
 *   vendored `vendor/bin/*` is preferred over PATH.
 *   https://laravel.com/docs/pint: 「You may also run Pint on specific files or
 *   directories: ./vendor/bin/pint app/Models/User.php」 and 「Pint does not
 *   require any configuration.」
 *   https://cs.symfony.com/doc/usage.html: 「php php-cs-fixer.phar fix」 … 「You
 *   can also specify a path to execute a command only over a nested directory
 *   or a file.」
 * - Swift → `swiftformat <file>`.
 *   https://github.com/nicklockwood/SwiftFormat: 「swiftformat . … In place of
 *   the `.`, you can instead type an absolute or relative path to the file or
 *   directory that you want to format.」
 */
export function formatterFor(
  file: string,
  root: string,
  exists: (path: string) => boolean,
  readText: ReadText = NO_TEXT,
  readDir: ReadDir = NO_DIR,
): FormatCommand | undefined {
  const ext = extname(file).toLowerCase();
  const local = (name: string): string | undefined => {
    const bin = join(root, "node_modules", ".bin", name);
    return exists(bin) ? bin : undefined;
  };
  const vendored = (name: string): string | undefined => {
    const bin = join(root, "vendor", "bin", name);
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
  if (CLANG_EXTENSIONS.has(ext)) return { bin: "clang-format", args: ["-i", file] };
  if (PERL_EXTENSIONS.has(ext)) return { bin: "perltidy", args: ["-b", "-bext=/", file] };
  switch (ext) {
    case ".go":
      return { bin: "gofmt", args: ["-w", file] };
    case ".py":
      return { bin: "ruff", args: ["format", file] };
    case ".rs":
      return { bin: "rustfmt", args: [...rustfmtArgs(root, exists, readText), file] };
    case ".cs": {
      const project = csharpProject(file, root, readDir);
      if (project === undefined) return undefined;
      return { bin: "dotnet", args: ["format", project, "--include", relative(root, file)] };
    }
    case ".java":
      return { bin: "google-java-format", args: ["--replace", file] };
    case ".kt":
    case ".kts":
      return ktlintConfigured(root, exists, readText)
        ? { bin: "ktlint", args: ["--format", file] }
        : { bin: "ktfmt", args: [file] };
    case ".php": {
      const pint = vendored("pint");
      if (pint !== undefined || exists(join(root, "pint.json"))) {
        return { bin: pint ?? "pint", args: [file] };
      }
      if (PHP_CS_FIXER_CONFIG_FILES.some((name) => exists(join(root, name)))) {
        return { bin: vendored("php-cs-fixer") ?? "php-cs-fixer", args: ["fix", file] };
      }
      return { bin: "pint", args: [file] };
    }
    case ".swift":
      return { bin: "swiftformat", args: [file] };
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
  readDir: ReadDir = NO_DIR,
): FormatPlan | undefined {
  const hooks = projectHooksFor(dirname(file), exists);
  if (hooks !== undefined) {
    const command = projectHookCommand(hooks, [relative(hooks.root, file)]);
    return { source: "project", bin: command.bin, args: command.args, cwd: hooks.root };
  }
  const root = projectRoot(dirname(file), exists);
  const command = formatterFor(file, root, exists, readText, readDir);
  return command === undefined ? undefined : { source: "table", ...command, cwd: root };
}
