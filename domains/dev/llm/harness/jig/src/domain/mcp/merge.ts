/**
 * Merges `mcp.json` layers in priority order (core, then packs, then
 * personal) — ported from yoki's
 * `runtime/yoki/scripts/lib/mcp-inventory/source.js` (`mergeLayers`).
 *
 * A server named in a later layer entirely REPLACES an earlier layer's
 * server of the same name (personal always wins) rather than being
 * field-merged with it. Order = first-seen name, using each name's LAST
 * layer's entry.
 */

import type { McpLayer, McpServer } from "./types";

export function mergeMcpLayers(layers: readonly McpLayer[]): McpServer[] {
  const order: string[] = [];
  const byName = new Map<string, McpServer>();

  for (const layer of layers) {
    for (const server of layer.servers) {
      if (!byName.has(server.name)) order.push(server.name);
      byName.set(server.name, server);
    }
  }

  return order.map((name) => {
    const server = byName.get(name);
    if (!server) throw new Error(`unreachable: mergeMcpLayers lost server "${name}"`);
    return server;
  });
}
