import { describe, expect, test } from "bun:test";
import {
  MCP_BLOCK_BEGIN,
  MCP_BLOCK_END,
  buildCodexMcpTables,
  currentMcpBlock,
  mcpServersDeclaredOutside,
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
  const block = renderMcpBlock(buildCodexMcpTables(SERVERS, { HOME: "/h" }));

  test("appends the block to a file that has none, after a blank line", () => {
    const plan = planMcpBlock("[features]\nhooks = true\n", block);
    expect(plan.changed).toBe(true);
    expect(plan.currentBlock).toBeUndefined();
    expect(plan.configToml).toBe(`[features]\nhooks = true\n\n${block}`);
    expect(plan.configToml.endsWith(`${MCP_BLOCK_END}\n`)).toBe(true);
  });

  test("replaces its own block wholesale and leaves every other table and the hooks block alone", () => {
    const before = [
      '# yoki:begin\n[permissions.yoki]\nextends = ":workspace"\n# yoki:end\n\n',
      `${MCP_BLOCK_BEGIN}\n[mcp_servers.gone]\ncommand = "old"\n${MCP_BLOCK_END}\n\n`,
      '[projects."/x"]\ntrust_level = "trusted"\n\n# jig:begin hooks\n[hooks.state."k"]\nenabled = true\n# jig:end hooks\n',
    ].join("");
    const plan = planMcpBlock(before, block);
    expect(plan.currentBlock).toBe(
      `${MCP_BLOCK_BEGIN}\n[mcp_servers.gone]\ncommand = "old"\n${MCP_BLOCK_END}\n`,
    );
    expect(plan.configToml).not.toContain("mcp_servers.gone");
    expect(plan.configToml).toContain('[projects."/x"]\ntrust_level = "trusted"');
    expect(plan.configToml).toContain(
      '# jig:begin hooks\n[hooks.state."k"]\nenabled = true\n# jig:end hooks',
    );
    expect(plan.configToml).toContain('[permissions.yoki]\nextends = ":workspace"');
    expect(plan.configToml.endsWith(block)).toBe(true);
    // Idempotent.
    expect(planMcpBlock(plan.configToml, block)).toMatchObject({ changed: false });
  });

  test("an empty file gets just the block", () => {
    expect(planMcpBlock(undefined, block).configToml).toBe(block);
    expect(currentMcpBlock(block)).toBe(block);
  });
});

describe("mcpServersDeclaredOutside", () => {
  test("names each server jig would write that some other table already declares, with its line", () => {
    const toml = [
      '[mcp_servers.context7]\ncommand = "npx"\n\n',
      '[mcp_servers."notion-mcp"]\nurl = "u"\n\n',
      '[mcp_servers.serena.env]\nX = "1"\n\n',
      '[mcp_servers.unrelated]\ncommand = "x"\n\n',
      `${MCP_BLOCK_BEGIN}\n[mcp_servers.figma-remote]\nurl = "f"\n${MCP_BLOCK_END}\n`,
    ].join("");
    expect(
      mcpServersDeclaredOutside(toml, ["context7", "notion-mcp", "serena", "figma-remote"]),
    ).toEqual([
      { name: "context7", line: 1 },
      { name: "notion-mcp", line: 4 },
      { name: "serena", line: 7 },
    ]);
  });

  test("nothing outside: nothing to refuse over", () => {
    expect(mcpServersDeclaredOutside("[features]\nhooks = true\n", ["serena"])).toEqual([]);
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
