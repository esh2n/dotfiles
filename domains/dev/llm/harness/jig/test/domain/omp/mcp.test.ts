import { describe, expect, test } from "bun:test";
import type { McpServer } from "../../../src/domain/mcp/types";
import {
  OMP_MCP_SCHEMA_URL,
  buildOmpMcpServers,
  planOmpMcpJson,
  renderOmpMcpBlock,
} from "../../../src/domain/omp/mcp";

const SERVERS: readonly McpServer[] = [
  {
    name: "serena",
    transport: "stdio",
    command: "uvx",
    args: ["serena", "--context", "claude-code"],
    env: {},
    targets: { claude: true, omp: true },
    targetOverrides: { omp: { args: ["serena", "--context", "codex"] } },
  },
  {
    name: "codebase-memory-mcp",
    transport: "stdio",
    command: "{{HOME}}/bin/cmm",
    args: [],
    env: { CMM_MODE: "${CMM_MODE}" },
    targets: { omp: true },
  },
  {
    name: "figma-remote",
    transport: "http",
    url: "https://mcp.figma.com/mcp",
    headers: { Authorization: "Bearer ${FIGMA_TOKEN}" },
    targets: { omp: true },
  },
  { name: "legacy", transport: "sse", url: "https://x/sse", targets: { omp: true } },
  { name: "claude-only", transport: "stdio", command: "x", targets: { claude: true } },
];

describe("buildOmpMcpServers", () => {
  test("one entry per omp-targeted server in omp's shape: explicit type, override applied, {{HOME}} substituted, ${VAR} left for omp", () => {
    const entries = buildOmpMcpServers(SERVERS, { HOME: "/home/u" });
    expect(entries.map((entry) => entry.name)).toEqual([
      "serena",
      "codebase-memory-mcp",
      "figma-remote",
      "legacy",
    ]);
    expect(entries[0]?.entry).toEqual({
      type: "stdio",
      command: "uvx",
      args: ["serena", "--context", "codex"],
    });
    expect(entries[1]?.entry).toEqual({
      type: "stdio",
      command: "/home/u/bin/cmm",
      env: { CMM_MODE: "${CMM_MODE}" },
    });
    expect(entries[2]?.entry).toEqual({
      type: "http",
      url: "https://mcp.figma.com/mcp",
      headers: { Authorization: "Bearer ${FIGMA_TOKEN}" },
    });
    expect(entries[3]?.entry).toEqual({ type: "sse", url: "https://x/sse" });
  });
});

describe("planOmpMcpJson", () => {
  const entries = buildOmpMcpServers(SERVERS, { HOME: "/home/u" });

  test("no file: jig's entries under the documented $schema, nothing carried, no current block", () => {
    const plan = planOmpMcpJson(undefined, entries);
    expect(plan.currentBlock).toBeUndefined();
    expect(plan.foreign).toEqual([]);
    expect(plan.carried).toEqual([]);
    expect(plan.invalid).toBeUndefined();
    const parsed = JSON.parse(plan.text) as {
      $schema: string;
      mcpServers: Record<string, unknown>;
    };
    expect(parsed.$schema).toBe(OMP_MCP_SCHEMA_URL);
    expect(Object.keys(parsed.mcpServers)).toEqual([
      "serena",
      "codebase-memory-mcp",
      "figma-remote",
      "legacy",
    ]);
    expect(plan.block).toBe(renderOmpMcpBlock(entries));
  });

  test("a hand-added server and every other top-level key are carried through; jig's entries come first in source order", () => {
    const current = JSON.stringify(
      {
        $schema: "https://example.invalid/mine.json",
        mcpServers: {
          mine: { type: "stdio", command: "mine" },
          "codebase-memory-mcp": { type: "stdio", command: "/home/u/bin/cmm" },
          serena: { type: "stdio", command: "uvx", args: ["serena", "--context", "codex"] },
        },
        disabledServers: ["figma-remote"],
      },
      null,
      2,
    );
    const plan = planOmpMcpJson(current, entries);
    expect(plan.foreign).toEqual(["mine"]);
    expect(plan.carried).toEqual(["$schema", "disabledServers"]);
    const parsed = JSON.parse(plan.text) as {
      $schema: string;
      mcpServers: Record<string, unknown>;
      disabledServers: string[];
    };
    expect(parsed.$schema).toBe("https://example.invalid/mine.json");
    expect(parsed.disabledServers).toEqual(["figma-remote"]);
    expect(Object.keys(parsed.mcpServers)).toEqual([
      "serena",
      "codebase-memory-mcp",
      "figma-remote",
      "legacy",
      "mine",
    ]);
    expect(parsed.mcpServers.mine).toEqual({ type: "stdio", command: "mine" });
    // The current block is the two present entries, in SOURCE order, so a
    // reordering by hand is not a difference.
    expect(plan.currentBlock).toBe(
      renderOmpMcpBlock([
        {
          name: "serena",
          entry: { type: "stdio", command: "uvx", args: ["serena", "--context", "codex"] },
        },
        { name: "codebase-memory-mcp", entry: { type: "stdio", command: "/home/u/bin/cmm" } },
      ]),
    );
  });

  test("a file that already holds exactly jig's entries has a current block equal to the generated one", () => {
    const plan = planOmpMcpJson(planOmpMcpJson(undefined, entries).text, entries);
    expect(plan.currentBlock).toBe(plan.block);
  });

  test("an `enabled: false` set on a jig entry by /mcp disable shows up in the current block, not silently kept or dropped", () => {
    const first = planOmpMcpJson(undefined, entries).text;
    const edited = first.replace('"command": "uvx",', '"command": "uvx",\n      "enabled": false,');
    const plan = planOmpMcpJson(edited, entries);
    expect(plan.currentBlock).toContain('"enabled": false');
    expect(plan.currentBlock).not.toBe(plan.block);
    expect(plan.text).not.toContain('"enabled"');
  });

  test("unparseable or non-object content is reported as invalid and returned untouched", () => {
    const broken = planOmpMcpJson("{ not json", entries);
    expect(broken.invalid).toBeDefined();
    expect(broken.text).toBe("{ not json");
    const list = planOmpMcpJson("[]", entries);
    expect(list.invalid).toBe("the top level is not a JSON object");
  });

  test("an empty file is a missing one", () => {
    expect(planOmpMcpJson("", entries).currentBlock).toBeUndefined();
    expect(planOmpMcpJson("\n", entries).invalid).toBeUndefined();
  });
});
