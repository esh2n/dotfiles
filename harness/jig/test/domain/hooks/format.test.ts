import { describe, expect, test } from "bun:test";
import {
  PHP_CS_FIXER_CONFIG_FILES,
  STYLELINT_CONFIG_FILES,
  cargoEdition,
  csharpProject,
  formatPlanFor,
  formatterFor,
  ktlintConfigured,
  projectRoot,
  rustfmtArgs,
  stylelintConfigured,
} from "../../../src/domain/hooks/format";

const exists = (paths: readonly string[]) => (path: string) => paths.includes(path);
const texts = (files: Readonly<Record<string, string>>) => (path: string) => files[path];
const dirs = (listing: Readonly<Record<string, readonly string[]>>) => (dir: string) =>
  listing[dir] ?? [];

describe("formatPlanFor: the project's hooks first, the table only without them", () => {
  test("a lefthook.yml project: lefthook on that one file, relative to the config's root", () => {
    expect(
      formatPlanFor("/repo/src/a.ts", exists(["/repo/lefthook.yml", "/repo/biome.json"])),
    ).toEqual({
      source: "project",
      bin: "lefthook",
      args: ["run", "pre-commit", "--file", "src/a.ts"],
      cwd: "/repo",
    });
  });

  test("a pre-commit project: pre-commit on that one file", () => {
    expect(
      formatPlanFor(
        "/repo/pkg/a.py",
        exists(["/repo/.pre-commit-config.yaml", "/repo/pyproject.toml"]),
      ),
    ).toEqual({
      source: "project",
      bin: "pre-commit",
      args: ["run", "--files", "pkg/a.py"],
      cwd: "/repo",
    });
  });

  test("the project's hooks apply to every extension, including ones the table has no formatter for", () => {
    expect(formatPlanFor("/repo/notes.md", exists(["/repo/lefthook.yml"]))?.source).toBe("project");
  });

  test("the project's hooks win over a stylelint config too", () => {
    expect(
      formatPlanFor("/repo/src/a.scss", exists(["/repo/lefthook.yml", "/repo/.stylelintrc"])),
    ).toEqual({
      source: "project",
      bin: "lefthook",
      args: ["run", "pre-commit", "--file", "src/a.scss"],
      cwd: "/repo",
    });
  });

  test("no hook config: the table, run from the project root", () => {
    expect(formatPlanFor("/repo/src/a.ts", exists(["/repo/biome.json"]))).toEqual({
      source: "table",
      bin: "biome",
      args: ["check", "--write", "/repo/src/a.ts"],
      cwd: "/repo",
    });
  });

  test("no hook config and nothing in the table: undefined", () => {
    expect(formatPlanFor("/repo/notes.md", exists(["/repo/package.json"]))).toBeUndefined();
  });
});

describe("stylelint: config or silence", () => {
  test("the documented config file names are recognized, each one alone", () => {
    expect(STYLELINT_CONFIG_FILES).toEqual([
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
    ]);
    for (const name of STYLELINT_CONFIG_FILES) {
      expect(stylelintConfigured("/repo", exists([`/repo/${name}`]))).toBe(true);
    }
    expect(stylelintConfigured("/repo", exists(["/repo/package.json"]))).toBe(false);
  });

  test("a `stylelint` key in package.json counts as a config", () => {
    const has = texts({ "/repo/package.json": '{"name":"x","stylelint":{"extends":"a"}}' });
    const hasNot = texts({ "/repo/package.json": '{"name":"x"}' });
    expect(stylelintConfigured("/repo", exists(["/repo/package.json"]), has)).toBe(true);
    expect(stylelintConfigured("/repo", exists(["/repo/package.json"]), hasNot)).toBe(false);
  });

  test("an unreadable or malformed package.json is no config", () => {
    expect(stylelintConfigured("/repo", exists(["/repo/package.json"]))).toBe(false);
    const broken = texts({ "/repo/package.json": "{not json" });
    expect(stylelintConfigured("/repo", exists(["/repo/package.json"]), broken)).toBe(false);
  });

  test("with a config, every stylesheet extension gets `stylelint --fix <file>`", () => {
    const configured = exists(["/repo/stylelint.config.js", "/repo/biome.json"]);
    for (const ext of [".css", ".scss", ".sass", ".less"]) {
      expect(formatterFor(`/repo/src/a${ext}`, "/repo", configured)).toEqual({
        bin: "stylelint",
        args: ["--fix", `/repo/src/a${ext}`],
      });
    }
  });

  test("the vendored stylelint is preferred, as with biome", () => {
    expect(
      formatterFor(
        "/repo/src/a.css",
        "/repo",
        exists(["/repo/.stylelintrc.json", "/repo/node_modules/.bin/stylelint"]),
      )?.bin,
    ).toBe("/repo/node_modules/.bin/stylelint");
  });

  test("without a config, .css keeps its biome / prettier entry", () => {
    expect(formatterFor("/repo/src/a.css", "/repo", exists(["/repo/biome.json"]))).toEqual({
      bin: "biome",
      args: ["check", "--write", "/repo/src/a.css"],
    });
    expect(formatterFor("/repo/src/a.css", "/repo", exists([]))).toEqual({
      bin: "prettier",
      args: ["--write", "/repo/src/a.css"],
    });
  });

  test("without a config, .scss .sass .less go nowhere — never to biome or prettier", () => {
    for (const ext of [".scss", ".sass", ".less"]) {
      expect(
        formatterFor(`/repo/src/a${ext}`, "/repo", exists(["/repo/biome.json"])),
      ).toBeUndefined();
      expect(formatterFor(`/repo/src/a${ext}`, "/repo", exists([]))).toBeUndefined();
    }
  });
});

describe("rustfmt: the project's edition, not a hard-coded one", () => {
  test("cargoEdition reads [package] edition and nothing else", () => {
    expect(cargoEdition('[package]\nname = "x"\nedition = "2024"\n')).toBe("2024");
    expect(cargoEdition('[package]\nname="x"\nedition="2018"')).toBe("2018");
    expect(cargoEdition('  [ package ]\n  edition = "2021" # comment\n')).toBe("2021");
    // Only the [package] table: an edition elsewhere is not the crate's.
    expect(cargoEdition('[workspace.package]\nedition = "2021"\n[package]\nname = "x"\n')).toBe(
      undefined,
    );
    expect(cargoEdition('[package]\nname = "x"\n[dependencies]\nedition = "2021"\n')).toBe(
      undefined,
    );
    // Inherited from the workspace: the value is in another file, so unknown.
    expect(cargoEdition("[package]\nedition.workspace = true\n")).toBeUndefined();
    expect(cargoEdition("")).toBeUndefined();
  });

  test("a rustfmt.toml or .rustfmt.toml: nothing is passed, rustfmt's own lookup owns the edition", () => {
    const cargo = texts({ "/repo/Cargo.toml": '[package]\nedition = "2018"\n' });
    expect(rustfmtArgs("/repo", exists(["/repo/rustfmt.toml", "/repo/Cargo.toml"]), cargo)).toEqual(
      [],
    );
    expect(rustfmtArgs("/repo", exists(["/repo/.rustfmt.toml"]))).toEqual([]);
    expect(formatterFor("/repo/src/main.rs", "/repo", exists(["/repo/rustfmt.toml"]))).toEqual({
      bin: "rustfmt",
      args: ["/repo/src/main.rs"],
    });
  });

  test("no rustfmt config: --edition from the root Cargo.toml", () => {
    const cargo = texts({ "/repo/Cargo.toml": '[package]\nname = "x"\nedition = "2024"\n' });
    expect(rustfmtArgs("/repo", exists(["/repo/Cargo.toml"]), cargo)).toEqual([
      "--edition",
      "2024",
    ]);
    expect(formatterFor("/repo/src/main.rs", "/repo", exists(["/repo/Cargo.toml"]), cargo)).toEqual(
      {
        bin: "rustfmt",
        args: ["--edition", "2024", "/repo/src/main.rs"],
      },
    );
  });

  test("no rustfmt config and no readable edition: --edition 2021, as before", () => {
    expect(rustfmtArgs("/repo", exists([]))).toEqual(["--edition", "2021"]);
    expect(rustfmtArgs("/repo", exists(["/repo/Cargo.toml"]))).toEqual(["--edition", "2021"]);
    const inherited = texts({ "/repo/Cargo.toml": "[package]\nedition.workspace = true\n" });
    expect(rustfmtArgs("/repo", exists(["/repo/Cargo.toml"]), inherited)).toEqual([
      "--edition",
      "2021",
    ]);
  });
});

describe("the project root", () => {
  test("is found by a hook config alone", () => {
    expect(projectRoot("/repo/src", exists(["/repo/.pre-commit-config.yaml"]))).toBe("/repo");
    expect(projectRoot("/repo/src", exists(["/repo/.lefthook.yml"]))).toBe("/repo");
  });

  test("is found by the seven new languages' markers", () => {
    for (const marker of [
      "CMakeLists.txt",
      "pom.xml",
      "build.gradle",
      "build.gradle.kts",
      "settings.gradle.kts",
      "cpanfile",
      "composer.json",
      "Package.swift",
    ]) {
      expect(projectRoot("/repo/src/deep", exists([`/repo/${marker}`]))).toBe("/repo");
    }
  });
});

describe("the seven languages of the all-languages ruling, one formatter each", () => {
  const none = exists([]);

  test("C/C++: clang-format -i on every source and header spelling", () => {
    for (const ext of [".cpp", ".cc", ".cxx", ".hpp", ".hh", ".h", ".c"]) {
      expect(formatterFor(`/repo/src/a${ext}`, "/repo", none)).toEqual({
        bin: "clang-format",
        args: ["-i", `/repo/src/a${ext}`],
      });
    }
  });

  test("C#: dotnet format on the enclosing .csproj, --include the file relative to the root", () => {
    const listing = dirs({
      "/repo/src/App": ["App.csproj", "Program.cs"],
      "/repo": ["Everything.sln", "src"],
    });
    expect(csharpProject("/repo/src/App/Program.cs", "/repo", listing)).toBe(
      "/repo/src/App/App.csproj",
    );
    expect(formatterFor("/repo/src/App/Program.cs", "/repo", none, undefined, listing)).toEqual({
      bin: "dotnet",
      args: ["format", "/repo/src/App/App.csproj", "--include", "src/App/Program.cs"],
    });
    // No .csproj above the file: the root's .sln.
    expect(csharpProject("/repo/tools/x.cs", "/repo", listing)).toBe("/repo/Everything.sln");
    // Neither: nothing formats it — dotnet format needs a project or solution.
    expect(formatterFor("/repo/x.cs", "/repo", none)).toBeUndefined();
    // Two .csproj in one directory: the first by name, deterministically.
    const two = dirs({ "/repo": ["Z.csproj", "A.csproj"] });
    expect(csharpProject("/repo/x.cs", "/repo", two)).toBe("/repo/A.csproj");
  });

  test("Java: google-java-format --replace", () => {
    expect(formatterFor("/repo/src/A.java", "/repo", none)).toEqual({
      bin: "google-java-format",
      args: ["--replace", "/repo/src/A.java"],
    });
  });

  test("Kotlin: ktlint --format when .editorconfig has a [*.{kt,kts}] section, else ktfmt", () => {
    const withSection = texts({
      "/repo/.editorconfig": "root = true\n\n[*.{kt,kts}]\nktlint_code_style = ktlint_official\n",
    });
    const withoutSection = texts({
      "/repo/.editorconfig": "root = true\n\n[*.py]\nindent_size = 4\n",
    });
    const editorconfig = exists(["/repo/.editorconfig"]);

    expect(ktlintConfigured("/repo", editorconfig, withSection)).toBe(true);
    expect(ktlintConfigured("/repo", editorconfig, withoutSection)).toBe(false);
    expect(ktlintConfigured("/repo", none, withSection)).toBe(false);
    // Other spellings of the Kotlin section count too.
    expect(
      ktlintConfigured("/repo", editorconfig, texts({ "/repo/.editorconfig": "[*.kt]\n" })),
    ).toBe(true);
    expect(
      ktlintConfigured("/repo", editorconfig, texts({ "/repo/.editorconfig": "[{*.kt,*.kts}]\n" })),
    ).toBe(true);

    for (const ext of [".kt", ".kts"]) {
      expect(formatterFor(`/repo/src/A${ext}`, "/repo", editorconfig, withSection)).toEqual({
        bin: "ktlint",
        args: ["--format", `/repo/src/A${ext}`],
      });
      expect(formatterFor(`/repo/src/A${ext}`, "/repo", editorconfig, withoutSection)).toEqual({
        bin: "ktfmt",
        args: [`/repo/src/A${ext}`],
      });
      expect(formatterFor(`/repo/src/A${ext}`, "/repo", none)).toEqual({
        bin: "ktfmt",
        args: [`/repo/src/A${ext}`],
      });
    }
  });

  test("Perl: perltidy -b -bext=/ (in place, backup deleted on success) on every Perl spelling", () => {
    for (const ext of [".pl", ".pm", ".t", ".psgi", ".cgi"]) {
      expect(formatterFor(`/repo/lib/A${ext}`, "/repo", none)).toEqual({
        bin: "perltidy",
        args: ["-b", "-bext=/", `/repo/lib/A${ext}`],
      });
    }
  });

  test("PHP: pint with pint.json or a vendored pint, php-cs-fixer with its config, pint otherwise", () => {
    expect(formatterFor("/repo/src/A.php", "/repo", exists(["/repo/pint.json"]))).toEqual({
      bin: "pint",
      args: ["/repo/src/A.php"],
    });
    // The vendored binary is preferred, and is itself reason enough to pick pint.
    expect(formatterFor("/repo/src/A.php", "/repo", exists(["/repo/vendor/bin/pint"]))).toEqual({
      bin: "/repo/vendor/bin/pint",
      args: ["/repo/src/A.php"],
    });
    expect(PHP_CS_FIXER_CONFIG_FILES).toEqual([".php-cs-fixer.dist.php", ".php-cs-fixer.php"]);
    for (const config of PHP_CS_FIXER_CONFIG_FILES) {
      expect(formatterFor("/repo/src/A.php", "/repo", exists([`/repo/${config}`]))).toEqual({
        bin: "php-cs-fixer",
        args: ["fix", "/repo/src/A.php"],
      });
      expect(
        formatterFor(
          "/repo/src/A.php",
          "/repo",
          exists([`/repo/${config}`, "/repo/vendor/bin/php-cs-fixer"]),
        )?.bin,
      ).toBe("/repo/vendor/bin/php-cs-fixer");
    }
    // Both configs: pint, the first branch.
    expect(
      formatterFor(
        "/repo/src/A.php",
        "/repo",
        exists(["/repo/pint.json", "/repo/.php-cs-fixer.php"]),
      )?.bin,
    ).toBe("pint");
    // Neither: pint, which needs no config.
    expect(formatterFor("/repo/src/A.php", "/repo", none)).toEqual({
      bin: "pint",
      args: ["/repo/src/A.php"],
    });
  });

  test("Swift: swiftformat on the file", () => {
    expect(formatterFor("/repo/Sources/A.swift", "/repo", none)).toEqual({
      bin: "swiftformat",
      args: ["/repo/Sources/A.swift"],
    });
  });

  test("the plan runs from the language's own project root, and readDir reaches the table", () => {
    expect(
      formatPlanFor(
        "/repo/lib/A.pm",
        exists(["/repo/cpanfile", "/repo/lib/A.pm"]),
        undefined,
        dirs({}),
      ),
    ).toEqual({
      source: "table",
      bin: "perltidy",
      args: ["-b", "-bext=/", "/repo/lib/A.pm"],
      cwd: "/repo",
    });
    expect(
      formatPlanFor(
        "/repo/src/App/Program.cs",
        exists(["/repo/.git"]),
        undefined,
        dirs({ "/repo/src/App": ["App.csproj"] }),
      ),
    ).toEqual({
      source: "table",
      bin: "dotnet",
      args: ["format", "/repo/src/App/App.csproj", "--include", "src/App/Program.cs"],
      cwd: "/repo",
    });
  });
});
