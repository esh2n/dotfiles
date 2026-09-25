/**
 * What the end-of-turn gate runs, and how much of a failure the model sees.
 *
 * `rules/decisions/2026-09-22-format-on-edit-gate-on-stop.md`: 型検査と lint は
 * 応答の終わりで関門にし、出力は末尾だけに切り詰める。One project, one check —
 * the gate is a backstop behind the LSP diagnostics and the per-edit
 * formatter, not a build.
 *
 * The decision's cost note is the reason for `tail`: 「Stop の関門は空回りすると
 * 高い(35k トークン・20 分の記録)」. A whole `tsc` log in the model's context is
 * exactly that cost, and the last lines are what it needs to act.
 *
 * `rules/decisions/2026-09-23-project-hooks-first-jig-table-fallback.md` puts
 * one branch in front of the marker table: a project with its own hook runner
 * (`lefthook.yml` / `.lefthook.yml` / `.pre-commit-config.yaml`) is gated by
 * that runner on the files touched this turn, and the table below is only for
 * projects with none. `gatePlanFor` is that precedence; `gateCommandFor` is
 * the table alone. The touched files are collected by the adapter (the
 * `ChangedFiles` port in `changed.ts`) and handed in as a list, so this stays
 * pure.
 *
 * `rules/decisions/2026-09-23-all-languages-format-and-gate.md` takes the
 * table from four markers to eleven languages, each gated by its toolchain's
 * own incremental compile or type check, and makes two things plural:
 *
 * - a plan is a *list* of commands, run in order, the first failure reported
 *   — Perl's `perl -c` and PHP's `php -l` are one process per touched file,
 *   and PHP's phpstan follows them;
 * - the changed-files list is an input to the table too, not only to the
 *   project's hook runner, because those two gates are file-scoped. The
 *   adapters ask git only when `gateWantsChangedFiles` says the plan needs
 *   the list.
 *
 * Pure: `exists` and `readDir` are injected, nothing is executed.
 */

import { extname, join } from "node:path";
import type { ReadDir } from "./format";
import {
  type ProjectHookTool,
  type ProjectHooks,
  projectHookCommand,
  projectHooksFor,
} from "./project-hooks";

export { projectHooksFor };
export type { ProjectHooks };

const TAIL_LINES = 40;
const TAIL_CHARS = 4_000;

const NO_DIR: ReadDir = () => [];

export interface GateCommand {
  readonly label: string;
  readonly bin: string;
  readonly args: readonly string[];
}

/** Why the table has nothing to run for a project it otherwise recognizes. */
export type NothingReason = "no-check" | "no-git" | "no-changes" | "no-build-dir";

/** What the marker table says for one project: commands, or a reason. */
export type TableGate =
  | { readonly kind: "run"; readonly commands: readonly GateCommand[] }
  | { readonly kind: "nothing"; readonly reason: NothingReason };

/**
 * The table's answer before the changed-files list is known: `wants-changed`
 * means the entry reached is file-scoped and the list decides. `marker` says
 * whether a marker file put it there (then a missing list is "git could not
 * say") or the markerless Perl fallback did (then it is "nothing to check").
 */
type Resolved = TableGate | { readonly kind: "wants-changed"; readonly marker: boolean };

/** CMake build trees, in the order they are looked for; the first that exists is built. */
export const CMAKE_BUILD_DIRS: readonly string[] = ["build", "out/build", "cmake-build-debug"];

/**
 * phpstan's config names, from https://phpstan.org/config-reference: 「PHPStan
 * will look for files named phpstan.neon, phpstan.neon.dist, or
 * phpstan.dist.neon in the current directory.」
 */
export const PHPSTAN_CONFIG_FILES: readonly string[] = [
  "phpstan.neon",
  "phpstan.neon.dist",
  "phpstan.dist.neon",
];

const PERL_SOURCE = new Set([".pl", ".pm"]);

const count = (n: number): string => (n === 1 ? "1 file" : `${n} files`);

/** The first entry of `dir` with the extension, sorted, as a path under `dir`. */
function firstNamed(dir: string, ext: string, readDir: ReadDir): string | undefined {
  const found = readDir(dir)
    .filter((name) => name.toLowerCase().endsWith(ext))
    .sort();
  return found[0] === undefined ? undefined : join(dir, found[0]);
}

/**
 * `perl -c` on each touched `.pl` / `.pm`, one process per file.
 * https://perldoc.perl.org/perlrun#-c: 「causes Perl to check the syntax of
 * the program and then exit without executing it. … If the syntax check is
 * successful perl will exit with a status of zero … On failure perl will
 * print any detected errors and exit with a non-zero status.」 One file per
 * process because `perl -c a.pl b.pl` checks `a.pl` with `b.pl` as its
 * `@ARGV`, not both.
 */
function perlGate(changed: readonly string[]): TableGate {
  const files = changed.filter((file) => PERL_SOURCE.has(extname(file).toLowerCase()));
  if (files.length === 0) return { kind: "nothing", reason: "no-changes" };
  return {
    kind: "run",
    commands: files.map((file) => ({ label: `perl -c ${file}`, bin: "perl", args: ["-c", file] })),
  };
}

/**
 * `php -l` on each touched `.php`, one process per file, then phpstan on all
 * of them when the project configures it.
 * https://www.php.net/manual/en/features.commandline.options.php: 「-l
 * --syntax-check: Syntax check but do not execute the given PHP code. … each
 * filename will be checked.」 — the manual lists one filename; per file keeps
 * one failing file's message its own.
 * https://phpstan.org/user-guide/command-line-usage: 「vendor/bin/phpstan
 * analyse [options] [<paths>...]: As <paths> you can pass one or multiple
 * paths to PHP files or directories separated by spaces. … Relative paths
 * are resolved based on the current working directory.」 and 「--no-progress:
 * Turns off the progress bar.」 The vendored binary is the documented one;
 * PATH is the fallback.
 */
function phpGate(
  cwd: string,
  exists: (path: string) => boolean,
  changed: readonly string[],
): TableGate {
  const files = changed.filter((file) => extname(file).toLowerCase() === ".php");
  if (files.length === 0) return { kind: "nothing", reason: "no-changes" };
  const commands: GateCommand[] = files.map((file) => ({
    label: `php -l ${file}`,
    bin: "php",
    args: ["-l", file],
  }));
  if (PHPSTAN_CONFIG_FILES.some((name) => exists(join(cwd, name)))) {
    const vendored = join(cwd, "vendor", "bin", "phpstan");
    commands.push({
      label: `phpstan analyse (${count(files.length)})`,
      bin: exists(vendored) ? vendored : "phpstan",
      args: ["analyse", "--no-progress", ...files],
    });
  }
  return { kind: "run", commands };
}

/**
 * The Gradle tasks for what is at the root: `compileJava` for `src/main/java`,
 * `compileKotlin` for `src/main/kotlin`, both when both; `classes` when
 * neither is at the root (a multi-module build keeps its sources in the
 * subprojects, and `classes` aggregates every compile task each of them
 * wires in).
 * https://docs.gradle.org/current/userguide/command_line_interface.html:
 * 「gradle [taskName...] [--option-name...]」, 「You can also specify multiple
 * tasks.」, 「-q, --quiet: Log errors only.」 and 「Use of the Gradle Wrapper is
 * highly encouraged. Substitute ./gradlew … for gradle」.
 * https://docs.gradle.org/current/userguide/java_plugin.html: 「classes —
 * Depends on: compileJava, processResources. This is an aggregate task that
 * just depends on other tasks. Other plugins may attach additional
 * compilation tasks to it.」
 */
function gradleGate(cwd: string, exists: (path: string) => boolean): TableGate {
  const tasks: string[] = [];
  if (exists(join(cwd, "src", "main", "java"))) tasks.push("compileJava");
  if (exists(join(cwd, "src", "main", "kotlin"))) tasks.push("compileKotlin");
  if (tasks.length === 0) tasks.push("classes");
  const wrapper = join(cwd, "gradlew");
  const bin = exists(wrapper) ? wrapper : "gradle";
  const shown = exists(wrapper) ? "./gradlew" : "gradle";
  return {
    kind: "run",
    commands: [{ label: `${shown} -q ${tasks.join(" ")}`, bin, args: ["-q", ...tasks] }],
  };
}

/**
 * The marker table, in precedence order. The four that were here first stay
 * first, then the seven of `2026-09-23-all-languages-format-and-gate.md` in
 * the ruling's own order, then a markerless Perl fallback:
 *
 *  1. `tsconfig.json`            → `bunx tsc --noEmit`
 *  2. `go.mod`                   → `go vet ./...`
 *  3. `pyproject.toml` / `ruff.toml` / `.ruff.toml` → `ruff check .`
 *  4. `Cargo.toml`               → `cargo check --quiet`
 *  5. `CMakeLists.txt`           → `cmake --build <dir>`, `<dir>` the first of
 *     `build/`, `out/build`, `cmake-build-debug` that exists; none →
 *     `no-build-dir`. https://cmake.org/cmake/help/latest/manual/cmake.1.html:
 *     「Build a Project: cmake --build <dir> [<options>] [-- <build-tool-options>]」
 *  6. a `.sln` at the cwd, else a `.csproj` at the cwd (first by name) →
 *     `dotnet build <that> --no-restore --nologo -clp:ErrorsOnly`.
 *     https://learn.microsoft.com/dotnet/core/tools/dotnet-build: 「--no-restore:
 *     Doesn't execute an implicit restore during build.」, 「--nologo: Doesn't
 *     display the startup banner or the copyright message.」 and 「the dotnet
 *     build command accepts MSBuild options」; `-clp:ErrorsOnly` is MSBuild's
 *     https://learn.microsoft.com/visualstudio/msbuild/msbuild-command-line-reference:
 *     「-consoleLoggerParameters:{parameters} / -clp:{parameters} … ErrorsOnly.
 *     Show only errors.」 The file is named because a folder with more than
 *     one project or solution makes a bare `dotnet build` fail.
 *  7. `pom.xml`                  → `./mvnw -q compile` when the wrapper is at
 *     the cwd, else `mvn -q compile`.
 *     https://maven.apache.org/ref/current/maven-embedder/cli.html: 「-q,--quiet
 *     Quiet output - only show errors」
 *  8. `build.gradle` / `build.gradle.kts` → `gradleGate` above.
 *  9. `cpanfile`                 → `perl -c` per touched `.pl` / `.pm`
 *     (`perlGate`); no touched Perl file → `no-changes`.
 * 10. `composer.json`            → `php -l` per touched `.php`, then
 *     `phpstan analyse --no-progress <files>` when `phpstan.neon` /
 *     `phpstan.neon.dist` exists (`phpGate`); no touched PHP file →
 *     `no-changes`.
 * 11. `Package.swift`            → `swift build`.
 *     https://docs.swift.org/swiftpm/documentation/packagemanagerdocs/
 *     (the redirect target of https://www.swift.org/documentation/package-manager/):
 *     「swift build」 builds the package in the current directory.
 * 12. no marker, but a touched `.pl` / `.pm` → `perl -c` on those; nothing
 *     touched → `no-check`.
 */
function resolve(
  cwd: string,
  exists: (path: string) => boolean,
  readDir: ReadDir,
  changed: readonly string[] | undefined,
): Resolved {
  const has = (name: string): boolean => exists(join(cwd, name));
  const one = (label: string, bin: string, args: readonly string[]): TableGate => ({
    kind: "run",
    commands: [{ label, bin, args }],
  });
  if (has("tsconfig.json")) return one("bunx tsc --noEmit", "bunx", ["tsc", "--noEmit"]);
  if (has("go.mod")) return one("go vet ./...", "go", ["vet", "./..."]);
  if (has("pyproject.toml") || has("ruff.toml") || has(".ruff.toml")) {
    return one("ruff check", "ruff", ["check", "."]);
  }
  if (has("Cargo.toml")) return one("cargo check", "cargo", ["check", "--quiet"]);
  if (has("CMakeLists.txt")) {
    const dir = CMAKE_BUILD_DIRS.find((name) => has(name));
    if (dir === undefined) return { kind: "nothing", reason: "no-build-dir" };
    return one(`cmake --build ${dir}`, "cmake", ["--build", dir]);
  }
  const dotnet = firstNamed(cwd, ".sln", readDir) ?? firstNamed(cwd, ".csproj", readDir);
  if (dotnet !== undefined) {
    return one("dotnet build", "dotnet", [
      "build",
      dotnet,
      "--no-restore",
      "--nologo",
      "-clp:ErrorsOnly",
    ]);
  }
  if (has("pom.xml")) {
    return has("mvnw")
      ? one("./mvnw -q compile", join(cwd, "mvnw"), ["-q", "compile"])
      : one("mvn -q compile", "mvn", ["-q", "compile"]);
  }
  if (has("build.gradle") || has("build.gradle.kts")) return gradleGate(cwd, exists);
  if (has("cpanfile")) {
    return changed === undefined ? { kind: "wants-changed", marker: true } : perlGate(changed);
  }
  if (has("composer.json")) {
    return changed === undefined
      ? { kind: "wants-changed", marker: true }
      : phpGate(cwd, exists, changed);
  }
  if (has("Package.swift")) return one("swift build", "swift", ["build"]);
  if (changed === undefined) return { kind: "wants-changed", marker: false };
  const perl = perlGate(changed);
  return perl.kind === "run" ? perl : { kind: "nothing", reason: "no-check" };
}

/**
 * The check this project answers to, by what is in its root — the table
 * alone, without the project-hooks precedence.
 *
 * @param changed the files touched this turn, relative to `cwd`, or
 *   `undefined` when git could not list them (or was not asked). A
 *   file-scoped entry without the list is `no-git` behind a marker and
 *   `no-check` behind none.
 */
export function gateCommandFor(
  cwd: string,
  exists: (path: string) => boolean,
  changed: readonly string[] | undefined = undefined,
  readDir: ReadDir = NO_DIR,
): TableGate {
  const resolved = resolve(cwd, exists, readDir, changed);
  if (resolved.kind !== "wants-changed") return resolved;
  return { kind: "nothing", reason: resolved.marker ? "no-git" : "no-check" };
}

/**
 * Whether the plan for `cwd` needs this turn's changed files: the project has
 * a hook config (its runner takes the list), or the table's entry for it is
 * file-scoped. The adapters ask git only when this says so, since a `tsc`
 * project has no use for the list.
 */
export function gateWantsChangedFiles(
  cwd: string,
  exists: (path: string) => boolean,
  readDir: ReadDir = NO_DIR,
): boolean {
  if (projectHooksFor(cwd, exists) !== undefined) return true;
  return resolve(cwd, exists, readDir, undefined).kind === "wants-changed";
}

/**
 * What the gate does for this project:
 *
 * - `run` — commands in order (the first failure is the one reported), with
 *   `source` saying whether they are the project's own hooks or jig's table,
 *   and `cwd` the directory to run them in.
 * - `nothing` — with the reason: the project has neither hook config nor a
 *   recognized marker (`no-check`); a file-scoped gate could not get its list
 *   because git is not there (`no-git`); the list has nothing for the gate
 *   (`no-changes`); or a CMake project has no build tree yet
 *   (`no-build-dir`). A hook config never falls through to the table.
 */
export type GatePlan =
  | {
      readonly kind: "run";
      readonly source: "project" | "table";
      readonly cwd: string;
      readonly tool?: ProjectHookTool;
      readonly commands: readonly GateCommand[];
    }
  | { readonly kind: "nothing"; readonly reason: NothingReason };

/**
 * @param changed the files touched this turn, relative to the hook config's
 *   root (or to `cwd` for the table), or `undefined` when git could not list
 *   them. Paths that no longer exist are dropped, since a deleted file is not
 *   one to check.
 */
export function gatePlanFor(
  cwd: string,
  exists: (path: string) => boolean,
  changed: readonly string[] | undefined,
  readDir: ReadDir = NO_DIR,
): GatePlan {
  const present = (root: string): readonly string[] | undefined =>
    changed === undefined
      ? undefined
      : [...new Set(changed)].filter((file) => file !== "" && exists(join(root, file)));
  const hooks = projectHooksFor(cwd, exists);
  if (hooks !== undefined) {
    const files = present(hooks.root);
    if (files === undefined) return { kind: "nothing", reason: "no-git" };
    if (files.length === 0) return { kind: "nothing", reason: "no-changes" };
    const command = projectHookCommand(hooks, files);
    return {
      kind: "run",
      source: "project",
      cwd: hooks.root,
      tool: hooks.tool,
      commands: [command],
    };
  }
  const table = gateCommandFor(cwd, exists, present(cwd), readDir);
  if (table.kind === "nothing") return table;
  return { kind: "run", source: "table", cwd, commands: table.commands };
}

/** The last lines of a failed run, which is all the model needs to act. */
export function tail(text: string, lines = TAIL_LINES, chars = TAIL_CHARS): string {
  const kept = text.trimEnd().split("\n").slice(-lines).join("\n");
  return kept.length <= chars ? kept : kept.slice(kept.length - chars);
}
