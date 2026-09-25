import { describe, expect, test } from "bun:test";
import { planClaudeJsonMcp, toClaudeEntry } from "../../../src/domain/claude/claude-json";
import { type ClaudeMcpAdd, buildClaudeMcpServers } from "../../../src/domain/mcp/to-claude";
import type { McpServer } from "../../../src/domain/mcp/types";

const SERVERS: McpServer[] = [
  {
    name: "serena",
    transport: "stdio",
    command: "uvx",
    args: ["serena"],
    env: { A: "{{HOME}}/a" },
    targets: { claude: true },
  },
  {
    name: "figma-remote",
    transport: "http",
    url: "https://mcp.figma.com/mcp",
    headers: { Authorization: "Bearer ${FIGMA_TOKEN}" },
    targets: { claude: true },
  },
  { name: "events", transport: "sse", url: "https://x/sse", targets: { claude: true } },
  { name: "playwright", transport: "stdio", command: "npx", targets: { claude: false } },
  {
    name: "cmm",
    transport: "stdio",
    command: "cmm",
    targets: { claude: true },
    targetOverrides: { claude: { command: "{{HOME}}/bin/cmm" } },
  },
] as McpServer[];

const adds = buildClaudeMcpServers(SERVERS, { HOME: "/home/u" });
const at = (i: number): ClaudeMcpAdd => {
  const add = adds[i];
  if (add === undefined) throw new Error(`no server ${i}`);
  return add;
};

describe("the servers Claude Code gets", () => {
  test("targets.claude only, overrides applied, {{HOME}} filled, ${VAR} left for Claude Code", () => {
    expect(adds.map((a) => a.name)).toEqual(["serena", "figma-remote", "events", "cmm"]);
    expect(toClaudeEntry(at(0))).toEqual({
      type: "stdio",
      command: "uvx",
      args: ["serena"],
      env: { A: "/home/u/a" },
    });
    expect(toClaudeEntry(at(1))).toEqual({
      type: "http",
      url: "https://mcp.figma.com/mcp",
      headers: { Authorization: "Bearer ${FIGMA_TOKEN}" },
    });
    expect(toClaudeEntry(at(2))).toEqual({ type: "sse", url: "https://x/sse", headers: {} });
    expect(toClaudeEntry(at(3))).toMatchObject({ command: "/home/u/bin/cmm" });
  });
});

describe("planClaudeJsonMcp", () => {
  test("a missing file becomes one holding only mcpServers", () => {
    const plan = planClaudeJsonMcp(undefined, adds.slice(0, 1), []);
    expect(plan.outcome).toBe("write");
    expect(plan.added).toEqual(["serena"]);
    expect(JSON.parse(plan.content ?? "")).toEqual({
      mcpServers: { serena: toClaudeEntry(at(0)) },
    });
    expect(plan.content?.endsWith("}\n")).toBe(true);
  });

  test("already current is a noop, and key order of the rest of the file is kept on a write", () => {
    const current = JSON.stringify({ a: 1, mcpServers: { serena: toClaudeEntry(at(0)) }, z: 2 });
    expect(planClaudeJsonMcp(current, adds.slice(0, 1), ["serena"]).outcome).toBe("noop");
    const plan = planClaudeJsonMcp(current, adds.slice(0, 2), ["serena"]);
    expect(Object.keys(JSON.parse(plan.content ?? ""))).toEqual(["a", "mcpServers", "z"]);
    expect(plan.added).toEqual(["figma-remote"]);
  });

  test("a changed server of jig's is updated; the same entry by hand under jig's name is not a clash", () => {
    const current = JSON.stringify({
      mcpServers: { serena: { type: "stdio", command: "old", args: [], env: {} } },
    });
    expect(planClaudeJsonMcp(current, adds.slice(0, 1), ["serena"]).changed).toEqual(["serena"]);
    const identical = JSON.stringify({ mcpServers: { serena: toClaudeEntry(at(0)) } });
    const plan = planClaudeJsonMcp(identical, adds.slice(0, 1), []);
    expect(plan.outcome).toBe("noop");
    expect(plan.owned).toEqual(["serena"]);
  });

  test("what cannot be read is a conflict and nothing is written", () => {
    for (const bad of ["{", "[]", "3", JSON.stringify({ mcpServers: [] })]) {
      const plan = planClaudeJsonMcp(bad, adds, ["x"]);
      expect(plan.outcome).toBe("conflict");
      expect(plan.content).toBeUndefined();
      expect(plan.owned).toEqual(["x"]);
    }
    expect(planClaudeJsonMcp("  ", adds.slice(0, 1), []).outcome).toBe("write");
  });
});
