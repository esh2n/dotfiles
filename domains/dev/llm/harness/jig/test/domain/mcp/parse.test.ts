/**
 * Port of the validation behavior in yoki's
 * `runtime/yoki/scripts/lib/mcp-inventory/source.js` (`loadLayer`,
 * `assertNoLiteralSecrets`, `assertKnownTargetKeys`) — tests tagged
 * [yoki-verified] assert the same behavior as that module.
 */

import { describe, expect, test } from "bun:test";
import { EMPTY_MCP_LAYER, parseMcpLayer } from "../../../src/domain/mcp/parse";

const validLayer = (servers: unknown[]) => JSON.stringify({ schemaVersion: "jig.mcp.v1", servers });

describe("parseMcpLayer", () => {
  test("[yoki-verified] parses a well-formed layer", () => {
    const text = validLayer([
      {
        name: "ctx7",
        transport: "stdio",
        command: "npx",
        args: ["-y", "ctx7"],
        targets: { claude: true },
      },
    ]);
    const result = parseMcpLayer(text, "test.json");
    expect(result.schemaVersion).toBe("jig.mcp.v1");
    expect(result.servers).toHaveLength(1);
    expect(result.servers[0]?.name).toBe("ctx7");
  });

  test("[yoki-verified] an unsupported schemaVersion throws", () => {
    const text = JSON.stringify({ schemaVersion: "wrong.v2", servers: [] });
    expect(() => parseMcpLayer(text, "test.json")).toThrow(/unsupported schemaVersion/);
  });

  test("[yoki-verified] an env value that is a ${VAR} reference is always fine", () => {
    const text = validLayer([
      {
        name: "s",
        transport: "stdio",
        command: "x",
        env: { API_KEY: "${MY_API_KEY}" },
        targets: {},
      },
    ]);
    expect(() => parseMcpLayer(text, "test.json")).not.toThrow();
  });

  test("[yoki-verified] a literal secret-shaped value throws", () => {
    const text = validLayer([
      {
        name: "s",
        transport: "stdio",
        command: "x",
        env: { OPENAI_API_KEY: "sk-abcdefghijklmnopqrstuvwx" },
        targets: {},
      },
    ]);
    expect(() => parseMcpLayer(text, "test.json")).toThrow(/looks like a literal secret/);
  });

  test("[yoki-verified] a secret-named key with a non-obviously-secret literal value throws", () => {
    const text = validLayer([
      {
        name: "s",
        transport: "stdio",
        command: "x",
        env: { AUTH_TOKEN: "plain-value" },
        targets: {},
      },
    ]);
    expect(() => parseMcpLayer(text, "test.json")).toThrow(/looks like a literal secret/);
  });

  test("a non-secret-shaped literal env value does not throw", () => {
    const text = validLayer([
      { name: "s", transport: "stdio", command: "x", env: { LOG_LEVEL: "debug" }, targets: {} },
    ]);
    expect(() => parseMcpLayer(text, "test.json")).not.toThrow();
  });

  test("[yoki-verified] an unknown targets key throws", () => {
    const text = validLayer([
      { name: "s", transport: "stdio", command: "x", targets: { claude: true, bogus: true } },
    ]);
    expect(() => parseMcpLayer(text, "test.json")).toThrow(/not a known target key/);
  });

  test("[yoki-verified] an unknown targetOverrides key throws", () => {
    const text = validLayer([
      {
        name: "s",
        transport: "stdio",
        command: "x",
        targets: { claude: true },
        targetOverrides: { bogus: { command: "y" } },
      },
    ]);
    expect(() => parseMcpLayer(text, "test.json")).toThrow(/not a known target key/);
  });

  test("[yoki-verified] a leading-underscore key inside targets is ignored (a _comment)", () => {
    const text = validLayer([
      { name: "s", transport: "stdio", command: "x", targets: { claude: true, _comment: "note" } },
    ]);
    expect(() => parseMcpLayer(text, "test.json")).not.toThrow();
  });

  test("EMPTY_MCP_LAYER matches parsing an empty-servers document", () => {
    expect(parseMcpLayer(validLayer([]), "test.json")).toEqual(EMPTY_MCP_LAYER);
  });
});
