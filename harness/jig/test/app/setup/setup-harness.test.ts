import { describe, expect, test } from "bun:test";
import { type SetupPorts, setupHarness } from "../../../src/app/setup/setup-harness";
import { expandPlaceholders } from "../../../src/domain/setup/expand";

const ROOT = "/repo";
const HOME = "/home/me";
const DSH = `${HOME}/.dsh`;
const PLUGIN = `${ROOT}/harness/jig/adapters/dsh`;
const DSH_SRC = `${ROOT}/home/shared/harness/dsh`;
const CODEX = `${ROOT}/home/shared/harness/codex`;

interface Fake {
  readonly ports: SetupPorts;
  readonly files: Map<string, string>;
  readonly calls: string[];
  readonly warnings: string[];
}

function fake(options: {
  files?: Record<string, string>;
  dirs?: string[];
  tools?: string[];
  failing?: string[];
  unreadable?: string[];
}): Fake {
  const files = new Map(Object.entries(options.files ?? {}));
  const dirs = new Set(options.dirs ?? []);
  const tools = new Set(options.tools ?? ["bun", "pnpm", "codex"]);
  const failing = new Set(options.failing ?? []);
  const unreadable = new Set(options.unreadable ?? []);
  const calls: string[] = [];
  const warnings: string[] = [];
  const ports: SetupPorts = {
    readText: async (path) => {
      if (unreadable.has(path)) throw new Error(`EACCES: ${path}`);
      return files.get(path);
    },
    writeText: async (path, text) => {
      files.set(path, text);
    },
    isDir: async (path) => dirs.has(path),
    listDirs: async (path) =>
      [...dirs]
        .filter((d) => d.startsWith(`${path}/`) && !d.slice(path.length + 1).includes("/"))
        .map((d) => d.slice(path.length + 1))
        .sort(),
    have: async (bin) => tools.has(bin),
    run: async (bin, args, cwd) => {
      const line = `${bin} ${args.join(" ")} (in ${cwd})`;
      calls.push(line);
      return failing.has(`${bin} ${args.join(" ")}`) ? 1 : 0;
    },
    jig: async (argv) => {
      calls.push(`jig ${argv.join(" ")}`);
      return failing.has(`jig ${argv.join(" ")}`) ? 1 : 0;
    },
    warn: (message) => {
      warnings.push(message);
    },
  };
  return { ports, files, calls, warnings };
}

const paths = { root: ROOT, dshHome: DSH, home: HOME, user: "me" };

describe("expandPlaceholders", () => {
  test("fills the three placeholders and leaves any other alone", () => {
    expect(
      expandPlaceholders("{{HOME}} {{USER}} {{DOTFILES_ROOT}} {{OTHER}} {{HOME}}", {
        home: "/h",
        user: "u",
        dotfilesRoot: "/r",
      }),
    ).toBe("/h u /r {{OTHER}} /h");
  });
});

describe("setupHarness", () => {
  test("jig applies every harness in order, then registers codex", async () => {
    const f = fake({});
    expect(await setupHarness(paths, f.ports)).toBe(0);
    expect(f.calls.filter((c) => c.startsWith("jig "))).toEqual([
      "jig apply --target claude --write",
      "jig apply --target codex --write",
      "jig apply --target pi --write",
      "jig apply --target omp --write",
      "jig apply --target dsh --write",
      "jig codex register --write",
    ]);
  });

  test("dsh gets its hooks file expanded, and scaffolded profiles their patch and the plugin", async () => {
    const f = fake({
      files: {
        [`${PLUGIN}/src/index.ts`]: "",
        [`${DSH_SRC}/hooks.claude.json`]: '{"root": "{{DOTFILES_ROOT}}", "home": "{{HOME}}"}\n',
        [`${DSH_SRC}/profiles/proxy/cordis.patch.yml`]: "plugin: {{DOTFILES_ROOT}}\n",
      },
      dirs: [`${DSH_SRC}/profiles/proxy`, `${DSH}/profiles/proxy`],
    });
    expect(await setupHarness(paths, f.ports)).toBe(0);
    expect(f.files.get(`${DSH}/hooks.claude.json`)).toBe(
      `{"root": "${ROOT}", "home": "${HOME}"}\n`,
    );
    expect(f.files.get(`${DSH}/profiles/proxy/cordis.patch.yml`)).toBe(`plugin: ${ROOT}\n`);
    expect(f.calls).toContain(`bun run build (in ${PLUGIN})`);
    expect(f.calls).toContain(`pnpm add link:${PLUGIN} (in ${DSH}/profiles/proxy)`);
    // the copies land before jig writes its block into them
    const pnpm = f.calls.findIndex((c) => c.startsWith("pnpm"));
    const dsh = f.calls.indexOf("jig apply --target dsh --write");
    expect(pnpm).toBeLessThan(dsh);
  });

  test("a profile not scaffolded on this machine is skipped", async () => {
    const f = fake({
      files: {
        [`${PLUGIN}/src/index.ts`]: "",
        [`${DSH_SRC}/profiles/proxy/cordis.patch.yml`]: "x\n",
      },
      dirs: [`${DSH_SRC}/profiles/proxy`],
    });
    expect(await setupHarness(paths, f.ports)).toBe(0);
    expect(f.files.has(`${DSH}/profiles/proxy/cordis.patch.yml`)).toBe(false);
    expect(f.calls.some((c) => c.startsWith("pnpm"))).toBe(false);
  });

  test("a failed plugin build is a warning, and no profile is linked", async () => {
    const f = fake({
      files: { [`${PLUGIN}/src/index.ts`]: "" },
      dirs: [`${DSH_SRC}/profiles/proxy`, `${DSH}/profiles/proxy`],
      failing: ["bun run build"],
    });
    expect(await setupHarness(paths, f.ports)).toBe(0);
    expect(f.warnings.some((w) => w.includes("plugin not built"))).toBe(true);
    expect(f.calls.some((c) => c.startsWith("pnpm"))).toBe(false);
  });

  test("without pnpm the plugin is built but not linked", async () => {
    const f = fake({
      files: { [`${PLUGIN}/src/index.ts`]: "" },
      dirs: [`${DSH_SRC}/profiles/proxy`, `${DSH}/profiles/proxy`],
      tools: ["bun", "codex"],
    });
    expect(await setupHarness(paths, f.ports)).toBe(0);
    expect(f.calls).toContain(`bun run build (in ${PLUGIN})`);
    expect(f.calls.some((c) => c.startsWith("pnpm"))).toBe(false);
  });

  test("without codex, register is skipped but its apply still runs", async () => {
    const f = fake({ tools: ["bun", "pnpm"] });
    expect(await setupHarness(paths, f.ports)).toBe(0);
    expect(f.calls).not.toContain("jig codex register --write");
    expect(f.calls).toContain("jig apply --target codex --write");
  });

  test("codex's config is seeded once from the default, never overwritten", async () => {
    const seeded = fake({ files: { [`${CODEX}/config.toml.default`]: "seed = true\n" } });
    await setupHarness(paths, seeded.ports);
    expect(seeded.files.get(`${CODEX}/config.toml`)).toBe("seed = true\n");

    const kept = fake({
      files: {
        [`${CODEX}/config.toml.default`]: "seed = true\n",
        [`${CODEX}/config.toml`]: "trust = 1\n",
      },
    });
    await setupHarness(paths, kept.ports);
    expect(kept.files.get(`${CODEX}/config.toml`)).toBe("trust = 1\n");
  });

  test("a failing apply is a warning; the rest still run and the exit is 0", async () => {
    const f = fake({ failing: ["jig apply --target codex --write"] });
    expect(await setupHarness(paths, f.ports)).toBe(0);
    expect(f.warnings).toContain("jig apply --target codex failed");
    expect(f.calls).toContain("jig apply --target dsh --write");
  });

  test("--target narrows every step to that harness", async () => {
    const f = fake({
      files: {
        [`${PLUGIN}/src/index.ts`]: "",
        [`${CODEX}/config.toml.default`]: "seed = true\n",
      },
    });
    expect(await setupHarness(paths, f.ports, ["pi"])).toBe(0);
    expect(f.calls).toEqual(["jig apply --target pi --write"]);
    expect(f.files.has(`${CODEX}/config.toml`)).toBe(false);
  });

  test("an unreadable config.toml is never taken for a missing one", async () => {
    const f = fake({
      files: {
        [`${CODEX}/config.toml.default`]: "seed = true\n",
        [`${CODEX}/config.toml`]: "trust = 1\n",
      },
      unreadable: [`${CODEX}/config.toml`],
    });
    expect(await setupHarness(paths, f.ports)).toBe(0);
    expect(f.files.get(`${CODEX}/config.toml`)).toBe("trust = 1\n");
    expect(f.warnings.some((w) => w.startsWith("codex's config.toml: EACCES"))).toBe(true);
    expect(f.calls).toContain("jig apply --target dsh --write");
  });
});
