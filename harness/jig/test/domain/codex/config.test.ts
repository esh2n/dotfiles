import { describe, expect, test } from "bun:test";
import {
  CODEX_STATUS_LINE,
  MCP_BLOCK_BEGIN,
  MCP_BLOCK_END,
  buildCodexMcpTables,
  currentMcpBlock,
  ownedView,
  planMcpBlock,
  renderMcpBlock,
  yokiLeftovers,
} from "../../../src/domain/codex/config";
import type { McpServer } from "../../../src/domain/mcp/types";

const SERVERS: readonly McpServer[] = [
  {
    name: "serena",
    transport: "stdio",
    command: "uvx",
    args: ["serena", "--context", "claude-code"],
    env: {},
    targets: { claude: true, codex: true },
    targetOverrides: { codex: { args: ["serena", "--context", "codex"] } },
  },
  {
    name: "codebase-memory-mcp",
    transport: "stdio",
    command: "{{HOME}}/bin/cmm",
    args: [],
    env: { CMM_MODE: "${CMM_MODE}" },
    targets: { codex: true },
  },
  {
    name: "figma-remote",
    transport: "http",
    url: "https://mcp.figma.com/mcp",
    targets: { codex: true },
  },
  { name: "claude-only", transport: "stdio", command: "x", targets: { claude: true } },
];

describe("buildCodexMcpTables", () => {
  test("one [mcp_servers.<name>] per codex-targeted server, override applied, {{HOME}} substituted, and valid TOML", () => {
    const tables = buildCodexMcpTables(SERVERS, { HOME: "/home/u" });
    expect(tables.map((table) => table.name)).toEqual([
      "serena",
      "codebase-memory-mcp",
      "figma-remote",
    ]);
    expect(tables[0]?.text).toBe(
      '[mcp_servers.serena]\ncommand = "uvx"\nargs = ["serena", "--context", "codex"]\n',
    );
    expect(tables[1]?.text).toBe(
      '[mcp_servers.codebase-memory-mcp]\ncommand = "/home/u/bin/cmm"\nargs = []\nenv = { CMM_MODE = "${CMM_MODE}" }\n',
    );
    expect(tables[2]?.text).toBe('[mcp_servers.figma-remote]\nurl = "https://mcp.figma.com/mcp"\n');

    const parsed = Bun.TOML.parse(renderMcpBlock(tables)) as {
      mcp_servers: Record<string, Record<string, unknown>>;
    };
    expect(Object.keys(parsed.mcp_servers)).toEqual([
      "serena",
      "codebase-memory-mcp",
      "figma-remote",
    ]);
    expect(parsed.mcp_servers.serena?.args).toEqual(["serena", "--context", "codex"]);
    expect(parsed.mcp_servers["codebase-memory-mcp"]?.env).toEqual({ CMM_MODE: "${CMM_MODE}" });
  });

  test("a name TOML cannot write bare is quoted", () => {
    const [table] = buildCodexMcpTables(
      [{ name: "odd.name", transport: "http", url: "https://x", targets: { codex: true } }],
      {},
    );
    expect(table?.text.startsWith('[mcp_servers."odd.name"]')).toBe(true);
  });
});

describe("planMcpBlock", () => {
  const tables = buildCodexMcpTables(SERVERS, { HOME: "/h" });
  const block = renderMcpBlock(tables);
  const names = tables.map((table) => table.name);

  test("appends the block to a file that has none, after a blank line", () => {
    const plan = planMcpBlock("[features]\nhooks = true\n", tables);
    expect(plan.changed).toBe(true);
    expect(plan.currentBlock).toBeUndefined();
    expect(plan.configToml).toBe(`[features]\nhooks = true\n\n${block}`);
  });

  test("an empty file gets just the block, and reads back as that block", () => {
    expect(planMcpBlock(undefined, tables).configToml).toBe(block);
    expect(currentMcpBlock(block, names)).toBe(block);
  });

  test("finds its tables by name after Codex has regrouped the file, and the result loads", () => {
    const first = planMcpBlock('[projects."/x"]\ntrust_level = "trusted"\n', tables).configToml;
    // What codex-cli 0.160 does on its next write: tables regrouped by parent,
    // jig's markers left where they were, a [tui] sub-table of its own.
    const lines = first.split("\n");
    const serverStart = lines.findIndex((line) => line.startsWith("[mcp_servers."));
    const regrouped = [
      '[projects."/x"]',
      'trust_level = "trusted"',
      "",
      "[tui.model_availability_nux]",
      '"gpt-5.5" = 2',
      MCP_BLOCK_END,
      "",
      MCP_BLOCK_BEGIN,
      ...lines
        .slice(serverStart)
        .filter(
          (line) =>
            !line.startsWith("#") && !line.startsWith("[tui]") && !line.startsWith("status_line"),
        ),
      "[mcp_servers.probe]",
      'command = "echo"',
      "",
    ].join("\n");
    expect(currentMcpBlock(regrouped, names)).not.toBe(block); // the status line went missing
    const plan = planMcpBlock(regrouped, tables);
    const parsed = Bun.TOML.parse(plan.configToml) as {
      mcp_servers: Record<string, unknown>;
      tui: { status_line: string[]; model_availability_nux: Record<string, number> };
      projects: Record<string, unknown>;
    };
    expect(Object.keys(parsed.mcp_servers).sort()).toEqual([...names, "probe"].sort());
    expect(parsed.tui.status_line).toEqual([...CODEX_STATUS_LINE]);
    expect(parsed.tui.model_availability_nux).toEqual({ "gpt-5.5": 2 });
    expect(plan.configToml.match(/# jig:begin mcp/g)).toHaveLength(1);
    expect(plan.configToml.match(/# jig:end mcp/g)).toHaveLength(1);
    expect(planMcpBlock(plan.configToml, tables).changed).toBe(false);
  });

  test("the status line joins a [tui] table the file already has instead of declaring a second one", () => {
    const before = '[tui]\nanimations = false\nstatus_line = ["model"]\n';
    const plan = planMcpBlock(before, tables);
    const parsed = Bun.TOML.parse(plan.configToml) as {
      tui: { status_line: string[]; animations: boolean };
    };
    expect(parsed.tui).toEqual({ animations: false, status_line: [...CODEX_STATUS_LINE] });
    expect(plan.configToml.match(/^\[tui\]$/gm)).toHaveLength(1);
    // unedited, the file still reads back as exactly jig's canonical block
    expect(currentMcpBlock(plan.configToml, names)).toBe(block);
  });

  test("a server jig wrote last time and no longer writes is removed; other servers stay", () => {
    const before = `${MCP_BLOCK_BEGIN}\n[mcp_servers.gone]\ncommand = "old"\n${MCP_BLOCK_END}\n\n[mcp_servers.mine]\ncommand = "x"\n`;
    const plan = planMcpBlock(before, tables, ["gone"]);
    expect(plan.configToml).not.toContain("mcp_servers.gone");
    expect(plan.configToml).toContain('[mcp_servers.mine]\ncommand = "x"');
  });

  test("every table jig does not own survives, yoki's block and the hooks block included", () => {
    const before = [
      '# yoki:begin\n[permissions.yoki]\nextends = ":workspace"\n# yoki:end\n\n',
      '[projects."/x"]\ntrust_level = "trusted"\n\n# jig:begin hooks\n[hooks.state."k"]\nenabled = true\n# jig:end hooks\n',
    ].join("");
    const plan = planMcpBlock(before, tables);
    expect(plan.configToml).toContain('[permissions.yoki]\nextends = ":workspace"');
    expect(plan.configToml).toContain(
      '# jig:begin hooks\n[hooks.state."k"]\nenabled = true\n# jig:end hooks',
    );
    expect(plan.configToml.endsWith(block)).toBe(true);
  });
});

describe("yokiLeftovers", () => {
  test("names yoki's block and its permissions tables, nothing when the file is clean", () => {
    const toml =
      '# yoki:begin\n# GENERATED by yoki\n[permissions.yoki]\nextends = ":workspace"\n\n[permissions.yoki.filesystem]\n"~/.ssh/id_*" = "deny"\n# yoki:end\n';
    expect(yokiLeftovers(toml)).toEqual([
      "# yoki:begin … # yoki:end block (8 lines)",
      "[permissions.yoki]",
      "[permissions.yoki.filesystem]",
    ]);
    expect(yokiLeftovers("[features]\nhooks = true\n")).toEqual([]);
  });
});

describe("the status line", () => {
  test("the block sets Codex's built-in status line items, as valid TOML", () => {
    const parsed = Bun.TOML.parse(renderMcpBlock([])) as { tui?: { status_line?: string[] } };
    expect(parsed.tui?.status_line).toEqual([
      "model-with-reasoning",
      "current-dir",
      "git-branch",
      "context-used",
      "used-tokens",
    ]);
  });

  test("it sits beside the MCP servers without breaking them", () => {
    const parsed = Bun.TOML.parse(renderMcpBlock(buildCodexMcpTables(SERVERS, { HOME: "/h" }))) as {
      mcp_servers?: Record<string, unknown>;
      tui?: unknown;
    };
    expect(Object.keys(parsed.mcp_servers ?? {}).length).toBeGreaterThan(0);
    expect(parsed.tui).toBeDefined();
  });
});

describe("ownedView", () => {
  const tables = buildCodexMcpTables(SERVERS, { HOME: "/h" });
  const names = tables.map((table) => table.name);

  test("is the same after Codex drops an empty args array and moves the tables", () => {
    const written = Bun.TOML.parse(planMcpBlock("", tables).configToml);
    const rewritten = Bun.TOML.parse(
      planMcpBlock("", tables).configToml.replace(/\nargs = \[\]/g, ""),
    );
    expect(ownedView(rewritten, names)).toBe(ownedView(written, names));
  });

  test("changes when an owned value changes, not when another table does", () => {
    const text = planMcpBlock("", tables).configToml;
    const base = ownedView(Bun.TOML.parse(text), names);
    expect(ownedView(Bun.TOML.parse(`${text}\n[features]\nhooks = true\n`), names)).toBe(base);
    const edited = text.replace('command = "uvx"', 'command = "pipx"');
    expect(ownedView(Bun.TOML.parse(edited), names)).not.toBe(base);
  });

  test("nothing owned in the file reads as nothing", () => {
    expect(ownedView(Bun.TOML.parse("[features]\nhooks = true\n"), names)).toBeUndefined();
  });
});
