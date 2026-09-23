import { describe, expect, test } from "bun:test";
import {
  STYLELINT_CONFIG_FILES,
  cargoEdition,
  formatPlanFor,
  formatterFor,
  projectRoot,
  rustfmtArgs,
  stylelintConfigured,
} from "../../../src/domain/hooks/format";

const exists = (paths: readonly string[]) => (path: string) => paths.includes(path);
const texts = (files: Readonly<Record<string, string>>) => (path: string) => files[path];

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
});
