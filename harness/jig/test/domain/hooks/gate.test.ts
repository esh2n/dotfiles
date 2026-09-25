import { describe, expect, test } from "bun:test";
import {
  CMAKE_BUILD_DIRS,
  PHPSTAN_CONFIG_FILES,
  gateCommandFor,
  gatePlanFor,
  gateWantsChangedFiles,
} from "../../../src/domain/hooks/gate";

const exists = (paths: readonly string[]) => (path: string) => paths.includes(path);
const dirs = (listing: Readonly<Record<string, readonly string[]>>) => (dir: string) =>
  listing[dir] ?? [];

describe("gatePlanFor: the project's hooks on the touched files, the table only without them", () => {
  const lefthook = exists([
    "/repo/lefthook.yml",
    "/repo/tsconfig.json",
    "/repo/src/a.ts",
    "/repo/b.md",
  ]);

  test("a lefthook project runs lefthook on the changed files, not the table's tsc", () => {
    expect(gatePlanFor("/repo", lefthook, ["src/a.ts", "b.md"])).toEqual({
      kind: "run",
      source: "project",
      tool: "lefthook",
      cwd: "/repo",
      commands: [
        {
          label: "lefthook run pre-commit (2 files)",
          bin: "lefthook",
          args: ["run", "pre-commit", "--file", "src/a.ts", "--file", "b.md"],
        },
      ],
    });
  });

  test("a pre-commit project passes every file after one --files", () => {
    const plan = gatePlanFor(
      "/repo",
      exists(["/repo/.pre-commit-config.yaml", "/repo/x.py", "/repo/y.py"]),
      ["x.py", "y.py"],
    );
    expect(plan.kind === "run" && plan.commands[0]?.args).toEqual([
      "run",
      "--files",
      "x.py",
      "y.py",
    ]);
  });

  test("duplicates and files that no longer exist are dropped", () => {
    const plan = gatePlanFor("/repo", lefthook, ["src/a.ts", "src/a.ts", "gone.ts", ""]);
    expect(plan.kind === "run" && plan.commands[0]?.args).toEqual([
      "run",
      "pre-commit",
      "--file",
      "src/a.ts",
    ]);
  });

  test("git absent: nothing runs, and the reason says so — never the table", () => {
    expect(gatePlanFor("/repo", lefthook, undefined)).toEqual({
      kind: "nothing",
      reason: "no-git",
    });
  });

  test("nothing changed: nothing runs", () => {
    expect(gatePlanFor("/repo", lefthook, [])).toEqual({ kind: "nothing", reason: "no-changes" });
    expect(gatePlanFor("/repo", lefthook, ["gone.ts"])).toEqual({
      kind: "nothing",
      reason: "no-changes",
    });
  });

  test("the config is found above the cwd, and the run happens in its directory", () => {
    const plan = gatePlanFor(
      "/repo/packages/a",
      exists(["/repo/packages/a/package.json", "/repo/lefthook.yml", "/repo/packages/a/x.ts"]),
      ["packages/a/x.ts"],
    );
    expect(plan.kind === "run" && plan.cwd).toBe("/repo");
  });

  test("no hook config: the table, in the cwd", () => {
    expect(gatePlanFor("/repo", exists(["/repo/tsconfig.json"]), undefined)).toEqual({
      kind: "run",
      source: "table",
      cwd: "/repo",
      commands: [{ label: "bunx tsc --noEmit", bin: "bunx", args: ["tsc", "--noEmit"] }],
    });
  });

  test("no hook config and no marker: no check", () => {
    expect(gatePlanFor("/repo", exists(["/repo/README.md"]), undefined)).toEqual({
      kind: "nothing",
      reason: "no-check",
    });
  });
});

describe("the table's seven new languages, one marker each", () => {
  const argv = (
    names: readonly string[],
    changed?: readonly string[],
    readDir?: (dir: string) => readonly string[],
  ): string[][] | { reason: string } => {
    const table = gateCommandFor("/repo", exists(names.map((n) => `/repo/${n}`)), changed, readDir);
    return table.kind === "run"
      ? table.commands.map((c) => [c.bin, ...c.args])
      : { reason: table.reason };
  };

  test("C++: CMakeLists.txt builds the first existing build tree, else no-build-dir", () => {
    expect(CMAKE_BUILD_DIRS).toEqual(["build", "out/build", "cmake-build-debug"]);
    expect(argv(["CMakeLists.txt", "build"])).toEqual([["cmake", "--build", "build"]]);
    expect(argv(["CMakeLists.txt", "out/build"])).toEqual([["cmake", "--build", "out/build"]]);
    expect(argv(["CMakeLists.txt", "cmake-build-debug"])).toEqual([
      ["cmake", "--build", "cmake-build-debug"],
    ]);
    // Precedence among the three is the list's order.
    expect(argv(["CMakeLists.txt", "cmake-build-debug", "build"])).toEqual([
      ["cmake", "--build", "build"],
    ]);
    expect(argv(["CMakeLists.txt"])).toEqual({ reason: "no-build-dir" });
  });

  test("C#: a .sln at the cwd, else a .csproj, named explicitly — dotnet build --no-restore --nologo -clp:ErrorsOnly", () => {
    const both = dirs({ "/repo": ["App.csproj", "App.sln", "Lib.csproj", "README.md"] });
    expect(argv([], undefined, both)).toEqual([
      ["dotnet", "build", "/repo/App.sln", "--no-restore", "--nologo", "-clp:ErrorsOnly"],
    ]);
    const projects = dirs({ "/repo": ["Lib.csproj", "App.csproj"] });
    expect(argv([], undefined, projects)).toEqual([
      ["dotnet", "build", "/repo/App.csproj", "--no-restore", "--nologo", "-clp:ErrorsOnly"],
    ]);
    // A directory that cannot be listed is not a .NET project.
    expect(argv([])).toEqual({ reason: "no-check" });
  });

  test("Java: pom.xml → mvn -q compile, the wrapper when the project ships one", () => {
    expect(argv(["pom.xml"])).toEqual([["mvn", "-q", "compile"]]);
    expect(argv(["pom.xml", "mvnw"])).toEqual([["/repo/mvnw", "-q", "compile"]]);
  });

  test("Java/Kotlin: build.gradle(.kts) → compileJava / compileKotlin by the sources present, classes when neither is at the root", () => {
    expect(argv(["build.gradle", "gradlew", "src/main/java"])).toEqual([
      ["/repo/gradlew", "-q", "compileJava"],
    ]);
    expect(argv(["build.gradle.kts", "gradlew", "src/main/kotlin"])).toEqual([
      ["/repo/gradlew", "-q", "compileKotlin"],
    ]);
    expect(argv(["build.gradle.kts", "gradlew", "src/main/java", "src/main/kotlin"])).toEqual([
      ["/repo/gradlew", "-q", "compileJava", "compileKotlin"],
    ]);
    expect(argv(["build.gradle.kts", "gradlew"])).toEqual([["/repo/gradlew", "-q", "classes"]]);
    // No wrapper: the gradle on PATH.
    expect(argv(["build.gradle", "src/main/java"])).toEqual([["gradle", "-q", "compileJava"]]);
  });

  test("Perl: cpanfile → perl -c on each touched .pl / .pm, one process per file", () => {
    expect(argv(["cpanfile"], ["lib/A.pm", "bin/run.pl", "t/a.t", "README.md"])).toEqual([
      ["perl", "-c", "lib/A.pm"],
      ["perl", "-c", "bin/run.pl"],
    ]);
    expect(argv(["cpanfile"], ["README.md"])).toEqual({ reason: "no-changes" });
    expect(argv(["cpanfile"], undefined)).toEqual({ reason: "no-git" });
  });

  test("Perl without a marker: touched .pl / .pm files alone are enough", () => {
    expect(argv([], ["lib/A.pm"])).toEqual([["perl", "-c", "lib/A.pm"]]);
    expect(argv([], ["README.md"])).toEqual({ reason: "no-check" });
    expect(argv([], undefined)).toEqual({ reason: "no-check" });
  });

  test("PHP: composer.json → php -l per touched .php, then phpstan when configured", () => {
    expect(argv(["composer.json"], ["src/A.php", "src/B.php", "x.js"])).toEqual([
      ["php", "-l", "src/A.php"],
      ["php", "-l", "src/B.php"],
    ]);
    expect(PHPSTAN_CONFIG_FILES).toEqual([
      "phpstan.neon",
      "phpstan.neon.dist",
      "phpstan.dist.neon",
    ]);
    for (const config of PHPSTAN_CONFIG_FILES) {
      expect(argv(["composer.json", config], ["src/A.php"])).toEqual([
        ["php", "-l", "src/A.php"],
        ["phpstan", "analyse", "--no-progress", "src/A.php"],
      ]);
    }
    // The vendored phpstan is preferred.
    expect(argv(["composer.json", "phpstan.neon", "vendor/bin/phpstan"], ["src/A.php"])).toEqual([
      ["php", "-l", "src/A.php"],
      ["/repo/vendor/bin/phpstan", "analyse", "--no-progress", "src/A.php"],
    ]);
    expect(argv(["composer.json"], ["x.js"])).toEqual({ reason: "no-changes" });
    expect(argv(["composer.json"], undefined)).toEqual({ reason: "no-git" });
  });

  test("Swift: Package.swift → swift build", () => {
    expect(argv(["Package.swift"])).toEqual([["swift", "build"]]);
  });

  test("precedence: the first four markers win over the new seven, in the documented order", () => {
    expect(argv(["tsconfig.json", "CMakeLists.txt", "build"])).toEqual([
      ["bunx", "tsc", "--noEmit"],
    ]);
    expect(argv(["Cargo.toml", "Package.swift"])).toEqual([["cargo", "check", "--quiet"]]);
    expect(argv(["CMakeLists.txt", "build", "pom.xml"])).toEqual([["cmake", "--build", "build"]]);
    expect(argv(["pom.xml", "build.gradle"])).toEqual([["mvn", "-q", "compile"]]);
    expect(argv(["build.gradle", "cpanfile"], ["a.pl"])).toEqual([["gradle", "-q", "classes"]]);
    expect(argv(["cpanfile", "composer.json"], ["a.pl", "a.php"])).toEqual([
      ["perl", "-c", "a.pl"],
    ]);
    expect(argv(["composer.json", "Package.swift"], ["a.php"])).toEqual([["php", "-l", "a.php"]]);
  });

  test("through gatePlanFor, a file-scoped gate drops touched files that no longer exist", () => {
    const plan = gatePlanFor("/repo", exists(["/repo/composer.json", "/repo/src/A.php"]), [
      "src/A.php",
      "src/Gone.php",
      "src/A.php",
    ]);
    expect(plan).toEqual({
      kind: "run",
      source: "table",
      cwd: "/repo",
      commands: [{ label: "php -l src/A.php", bin: "php", args: ["-l", "src/A.php"] }],
    });
  });
});

describe("gateWantsChangedFiles: when the adapters must ask git", () => {
  test("a hook config, a file-scoped marker, or no marker at all", () => {
    expect(gateWantsChangedFiles("/repo", exists(["/repo/lefthook.yml"]))).toBe(true);
    expect(gateWantsChangedFiles("/repo", exists(["/repo/cpanfile"]))).toBe(true);
    expect(gateWantsChangedFiles("/repo", exists(["/repo/composer.json"]))).toBe(true);
    expect(gateWantsChangedFiles("/repo", exists([]))).toBe(true);
  });

  test("never for a whole-project gate", () => {
    for (const marker of ["tsconfig.json", "go.mod", "Cargo.toml", "pom.xml", "Package.swift"]) {
      expect(gateWantsChangedFiles("/repo", exists([`/repo/${marker}`]))).toBe(false);
    }
    expect(gateWantsChangedFiles("/repo", exists([]), dirs({ "/repo": ["A.csproj"] }))).toBe(false);
  });
});
