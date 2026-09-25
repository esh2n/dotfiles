import { describe, expect, test } from "bun:test";
import type { McpServer } from "../../../src/domain/mcp/types";
import {
  PI_MCP_USER_CONFIG,
  buildPiMcpServers,
  planPiMcpJson,
  renderPiMcpBlock,
} from "../../../src/domain/pi/mcp";

const SERVERS: readonly McpServer[] = [
  {
    name: "serena",
    transport: "stdio",
    command: "uvx",
    args: ["serena", "--context", "claude-code"],
    env: {},
    targets: { claude: true, pi: true },
    targetOverrides: { pi: { args: ["serena", "--context", "codex"] } },
  },
  {
    name: "codebase-memory-mcp",
    transport: "stdio",
    command: "{{HOME}}/bin/cmm",
    args: [],
    env: { CMM_MODE: "${CMM_MODE}" },
    targets: { pi: true },
  },
  {
    name: "figma-remote",
    transport: "http",
    url: "https://mcp.figma.com/mcp",
    headers: { Authorization: "Bearer ${FIGMA_TOKEN}" },
    targets: { pi: true },
  },
  { name: "legacy", transport: "sse", url: "https://x/sse", targets: { pi: true } },
  { name: "claude-only", transport: "stdio", command: "x", targets: { claude: true } },
  { name: "pi-off", transport: "stdio", command: "x", targets: { pi: false, omp: true } },
];

describe("buildPiMcpServers", () => {
  test("one entry per pi-targeted server in the adapter's documented fields: no `type`, override applied, {{HOME}} substituted, ${VAR} left for the adapter", () => {
    const entries = buildPiMcpServers(SERVERS, { HOME: "/home/u" });
    expect(entries.map((entry) => entry.name)).toEqual([
      "serena",
      "codebase-memory-mcp",
      "figma-remote",
      "legacy",
    ]);
    expect(entries[0]?.entry).toEqual({
      command: "uvx",
      args: ["serena", "--context", "codex"],
    });
    expect(entries[1]?.entry).toEqual({
      command: "/home/u/bin/cmm",
      env: { CMM_MODE: "${CMM_MODE}" },
    });
    expect(entries[2]?.entry).toEqual({
      url: "https://mcp.figma.com/mcp",
      headers: { Authorization: "Bearer ${FIGMA_TOKEN}" },
    });
    // The adapter's `url` is StreamableHTTP with an SSE fallback; a source
    // `sse` server is a plain url entry.
    expect(entries[3]?.entry).toEqual({ url: "https://x/sse" });
    for (const entry of entries) expect(entry.entry).not.toHaveProperty("type");
  });

  test("the user-global path is the one the README spells", () => {
    expect(PI_MCP_USER_CONFIG).toBe(".config/mcp/mcp.json");
  });
});

describe("planPiMcpJson", () => {
  const entries = buildPiMcpServers(SERVERS, { HOME: "/home/u" });

  test("no file: jig's entries alone, no $schema added, nothing carried, no current block", () => {
    const plan = planPiMcpJson(undefined, entries);
    expect(plan.currentBlock).toBeUndefined();
    expect(plan.foreign).toEqual([]);
    expect(plan.carried).toEqual([]);
    expect(plan.invalid).toBeUndefined();
    const parsed = JSON.parse(plan.text) as Record<string, unknown>;
    expect(Object.keys(parsed)).toEqual(["mcpServers"]);
    expect(Object.keys(parsed.mcpServers as object)).toEqual([
      "serena",
      "codebase-memory-mcp",
      "figma-remote",
      "legacy",
    ]);
    expect(plan.block).toBe(renderPiMcpBlock(entries));
  });

  test("a hand-added server, the adapter's `settings` and a `$schema` are carried through; jig's entries come first in source order", () => {
    const current = JSON.stringify(
      {
        $schema: "https://example.invalid/mine.json",
        settings: { hostConfigDiscovery: "off" },
        mcpServers: {
          mine: { command: "mine", lifecycle: "eager" },
          "codebase-memory-mcp": { command: "/home/u/bin/cmm", env: { CMM_MODE: "${CMM_MODE}" } },
          serena: { command: "uvx", args: ["serena", "--context", "codex"] },
        },
      },
      null,
      2,
    );
    const plan = planPiMcpJson(current, entries);
    expect(plan.foreign).toEqual(["mine"]);
    expect(plan.carried).toEqual(["$schema", "settings"]);
    const parsed = JSON.parse(plan.text) as {
      $schema: string;
      settings: Record<string, unknown>;
      mcpServers: Record<string, unknown>;
    };
    expect(parsed.$schema).toBe("https://example.invalid/mine.json");
    expect(parsed.settings).toEqual({ hostConfigDiscovery: "off" });
    expect(Object.keys(parsed.mcpServers)).toEqual([
      "serena",
      "codebase-memory-mcp",
      "figma-remote",
      "legacy",
      "mine",
    ]);
    expect(parsed.mcpServers.mine).toEqual({ command: "mine", lifecycle: "eager" });
    expect(plan.currentBlock).toBe(
      plan.block.replace(/,\n {2}"figma-remote"[\s\S]*\n}\n$/, "\n}\n"),
    );
  });

  test("a file that already holds exactly jig's entries has a current block equal to the generated one", () => {
    const plan = planPiMcpJson(planPiMcpJson(undefined, entries).text, entries);
    expect(plan.currentBlock).toBe(plan.block);
  });

  test("a `disabled: true` written by hand into a jig entry shows up in the current block, not silently kept or dropped", () => {
    const first = planPiMcpJson(undefined, entries).text;
    const edited = first.replace('"command": "uvx",', '"command": "uvx",\n      "disabled": true,');
    const plan = planPiMcpJson(edited, entries);
    expect(plan.currentBlock).toContain('"disabled": true');
    expect(plan.currentBlock).not.toBe(plan.block);
    expect(plan.text).not.toContain('"disabled"');
  });

  test("unparseable or non-object content is reported as invalid and returned untouched", () => {
    const broken = planPiMcpJson("{ not json", entries);
    expect(broken.invalid).toBeDefined();
    expect(broken.text).toBe("{ not json");
    expect(planPiMcpJson("[]", entries).invalid).toBe("the top level is not a JSON object");
  });
});
