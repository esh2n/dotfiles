/**
 * Port of yoki's `runtime/yoki/scripts/lib/mcp-inventory/source.js`
 * (`mergeLayers`) — tests tagged [yoki-verified].
 */

import { describe, expect, test } from "bun:test";
import { mergeMcpLayers } from "../../../src/domain/mcp/merge";
import type { McpLayer } from "../../../src/domain/mcp/types";

const layer = (servers: McpLayer["servers"]): McpLayer => ({
  schemaVersion: "ecc.mcp.v1",
  servers,
});

describe("mergeMcpLayers", () => {
  test("[yoki-verified] order = first-seen name across layers", () => {
    const core = layer([
      { name: "a", transport: "stdio", command: "a1" },
      { name: "b", transport: "stdio", command: "b1" },
    ]);
    const personal = layer([{ name: "c", transport: "stdio", command: "c1" }]);
    const merged = mergeMcpLayers([core, personal]);
    expect(merged.map((s) => s.name)).toEqual(["a", "b", "c"]);
  });

  test("[yoki-verified] a later layer's server of the same name REPLACES the earlier one wholesale", () => {
    const core = layer([{ name: "a", transport: "stdio", command: "core-cmd", args: ["core"] }]);
    const personal = layer([{ name: "a", transport: "http", url: "https://example.test" }]);
    const merged = mergeMcpLayers([core, personal]);
    expect(merged).toEqual([{ name: "a", transport: "http", url: "https://example.test" }]);
  });

  test("[yoki-verified] a missing/empty layer contributes nothing", () => {
    const core = layer([{ name: "a", transport: "stdio", command: "x" }]);
    const empty: McpLayer = { schemaVersion: "ecc.mcp.v1", servers: [] };
    expect(mergeMcpLayers([core, empty]).map((s) => s.name)).toEqual(["a"]);
  });
});
