import { describe, expect, test } from "bun:test";
import {
  DSH_MCP_CLIENT,
  MCP_BLOCK_BEGIN,
  MCP_BLOCK_END,
  buildDshMcpRows,
  renderDshMcpBlock,
  renderDshScalar,
} from "../../../src/domain/dsh/mcp";
import type { McpServer } from "../../../src/domain/mcp/types";

const SERVERS: readonly McpServer[] = [
  {
    name: "serena",
    transport: "stdio",
    command: "uvx",
    args: ["serena", "--context", "claude-code"],
    env: {},
    targets: { claude: true, dsh: true },
    targetOverrides: { dsh: { args: ["serena", "--context", "codex"] } },
  },
  {
    name: "codebase-memory-mcp",
    transport: "stdio",
    command: "{{HOME}}/bin/cmm",
    args: [],
    env: { CMM_MODE: "${CMM_MODE}", CMM_HOME: "{{HOME}}/.cmm" },
    targets: { dsh: true },
  },
  {
    name: "figma-remote",
    transport: "http",
    url: "https://mcp.figma.com/mcp",
    headers: { Authorization: "Bearer ${FIGMA_TOKEN}" },
    targets: { dsh: true },
  },
  { name: "legacy", transport: "sse", url: "https://x/sse", targets: { dsh: true } },
  { name: "claude-only", transport: "stdio", command: "x", targets: { claude: true } },
  { name: "dsh-off", transport: "stdio", command: "x", targets: { dsh: false, omp: true } },
];

describe("buildDshMcpRows", () => {
  test("one row per dsh-targeted server in the README's fields: id mcp-<name>, the client's name, override applied, {{HOME}} substituted, both remote transports as streamable-http", () => {
    const rows = buildDshMcpRows(SERVERS, { HOME: "/home/u" });
    expect(rows.map((row) => row.id)).toEqual([
      "mcp-serena",
      "mcp-codebase-memory-mcp",
      "mcp-figma-remote",
      "mcp-legacy",
    ]);
    for (const row of rows) expect(row.name).toBe(DSH_MCP_CLIENT);
    expect(rows[0]?.config).toEqual({
      serverName: "serena",
      transport: "stdio",
      command: "uvx",
      args: ["serena", "--context", "codex"],
    });
    expect(rows[1]?.config).toEqual({
      serverName: "codebase-memory-mcp",
      transport: "stdio",
      command: "/home/u/bin/cmm",
      env: { CMM_MODE: "${CMM_MODE}", CMM_HOME: "/home/u/.cmm" },
    });
    expect(rows[2]?.config).toEqual({
      serverName: "figma-remote",
      transport: "streamable-http",
      url: "https://mcp.figma.com/mcp",
      headers: { Authorization: "Bearer ${FIGMA_TOKEN}" },
    });
    expect(rows[3]?.config).toEqual({
      serverName: "legacy",
      transport: "streamable-http",
      url: "https://x/sse",
    });
  });
});

describe("renderDshScalar", () => {
  test("a plain string is single-quoted, quotes doubled", () => {
    expect(renderDshScalar("uvx")).toBe("'uvx'");
    expect(renderDshScalar("it's")).toBe("'it''s'");
    expect(renderDshScalar("@deepseek-ai/dsh-mcp-client")).toBe("'@deepseek-ai/dsh-mcp-client'");
  });

  test("an env reference becomes the README's !!js forms: bare access alone, a template literal when mixed, a fallback for ${VAR:-default}", () => {
    expect(renderDshScalar("${TOKEN}")).toBe("!!js process.env.TOKEN");
    expect(renderDshScalar("Bearer ${TOKEN}")).toBe("!!js '`Bearer ${process.env.TOKEN}`'");
    expect(renderDshScalar("${MODE:-fast}")).toBe("!!js (process.env.MODE ?? 'fast')");
    // The JS quotes around the fallback double inside the YAML single-quoted scalar.
    expect(renderDshScalar("${A}/${B:-x}")).toBe(
      "!!js '`${process.env.A}/${(process.env.B ?? ''x'')}`'",
    );
    expect(Bun.YAML.parse(`v: ${renderDshScalar("${A}/${B:-x}")}`)).toEqual({
      v: "`${process.env.A}/${(process.env.B ?? 'x')}`",
    });
  });

  test("literal backticks and ${ in a mixed string are escaped inside the template", () => {
    expect(renderDshScalar("a`b ${X} ${literal")).toBe(
      "!!js '`a\\`b ${process.env.X} \\${literal`'",
    );
  });
});

describe("renderDshMcpBlock", () => {
  const rows = buildDshMcpRows(SERVERS, { HOME: "/home/u" });

  test("one `- insert:` patch row between the markers, parsing back to the rows DSH expects", () => {
    const block = renderDshMcpBlock(rows);
    expect(block.startsWith(`${MCP_BLOCK_BEGIN}\n- insert:\n`)).toBe(true);
    expect(block.endsWith(`${MCP_BLOCK_END}\n`)).toBe(true);
    const parsed = Bun.YAML.parse(block) as { insert: Record<string, unknown>[] }[];
    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.insert.map((entry) => entry.id)).toEqual(rows.map((row) => row.id));
    expect(parsed[0]?.insert[0]).toEqual({
      id: "mcp-serena",
      name: DSH_MCP_CLIENT,
      config: {
        serverName: "serena",
        transport: "stdio",
        command: "uvx",
        args: ["serena", "--context", "codex"],
      },
    });
    // Bun reads a `!!js` scalar as its text; DSH evaluates it at boot.
    expect(parsed[0]?.insert[1]?.config).toEqual({
      serverName: "codebase-memory-mcp",
      transport: "stdio",
      command: "/home/u/bin/cmm",
      env: { CMM_MODE: "process.env.CMM_MODE", CMM_HOME: "/home/u/.cmm" },
    });
    expect(block).toContain("CMM_MODE: !!js process.env.CMM_MODE");
    expect(block).toContain("Authorization: !!js '`Bearer ${process.env.FIGMA_TOKEN}`'");
    expect(block).not.toContain("cwd");
    expect(block).not.toContain("claude-only");
  });

  test("no rows, no block", () => {
    expect(renderDshMcpBlock([])).toBe("");
  });
});
