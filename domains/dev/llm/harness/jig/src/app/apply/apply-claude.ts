/**
 * `jig apply --target claude`'s use-case: read `.claude-packs`, compose
 * settings.json from the same core/packs/personal layers yoki-switch's
 * `merge_settings()` reads (settings.layer.json, permissions.yaml, mcp.json),
 * and diff the result against a reference settings.json — never write it.
 *
 * Dry-run only, on purpose: `--write` is refused, same pattern
 * `applyLitellm` (../../app/apply/apply-tiers.ts) already uses for a target
 * this phase isn't ready to write. See
 * .tmp-research/install-pipeline-plan.md for the design this implements.
 */

import { join } from "node:path";
import { type PermissionsSidecar, composeSettings } from "../../domain/compose/compose";
import { type PackDefinition, selectLayers } from "../../domain/compose/layers";
import type { JsonObject } from "../../domain/compose/merge";
import { type TemplateVars, applyTemplate } from "../../domain/compose/template";
import { mergeMcpLayers } from "../../domain/mcp/merge";
import { EMPTY_MCP_LAYER, parseMcpLayer } from "../../domain/mcp/parse";
import { buildClaudeMcpServers } from "../../domain/mcp/to-claude";
import type { McpLayer } from "../../domain/mcp/types";
import { mergePermissionLayers } from "../../domain/permissions/merge";
import { parseYamlPermissions } from "../../domain/permissions/parse";
import { toClaudeSettings } from "../../domain/permissions/to-claude";
import type { PermissionLayer } from "../../domain/permissions/types";
import { unifiedDiff } from "../../domain/tiers/diff";
import type { TargetResult } from "./apply-tiers";
import type { ApplyPorts } from "./ports";

/**
 * Every path `applyClaudeSettings` reads or diffs against. `packsDir`/
 * `coreDir`/`personalDir` are the three `claude-profiles` layer roots;
 * `packsDefaultFile` mirrors `enabled_packs()`'s dry-run fallback to
 * `packs.default` when `.claude-packs` doesn't exist yet (this target is
 * always dry-run this phase, so that fallback always applies — see
 * `yoki-switch::enabled_packs`, `PLAN_MODE` branch).
 */
export interface ClaudeApplyPaths {
  readonly packsFile: string;
  readonly packsDefaultFile: string;
  readonly coreDir: string;
  readonly packsDir: string;
  readonly personalDir: string;
  /** The settings.json this run's composed output is diffed against. */
  readonly destSettingsPath: string;
  readonly templateVars: TemplateVars;
}

const refusalMessage =
  "deferred: dry-run only this increment (jig apply --target claude never writes) — review the diff and edit settings.json by hand";

/**
 * Ported from `yoki-switch::enabled_packs`'s `grep -vE '^\s*(#|$)' | sort -u`:
 * strip blank lines and full-line `#` comments, dedupe, sort. No trimming —
 * a real `.claude-packs` (written by `save_packs`) never has stray
 * whitespace, and neither generator should silently tolerate it if one did.
 */
export function parseEnabledPacks(text: string): readonly string[] {
  const names = text.split(/\r?\n/).filter((line) => !/^\s*(#|$)/.test(line));
  return [...new Set(names)].sort();
}

async function resolveEnabledPacks(
  ports: ApplyPorts,
  paths: ClaudeApplyPaths,
): Promise<readonly string[]> {
  const packsText = await ports.readFile(paths.packsFile);
  if (packsText !== undefined) return parseEnabledPacks(packsText);
  const defaultText = await ports.readFile(paths.packsDefaultFile);
  return defaultText === undefined ? [] : parseEnabledPacks(defaultText);
}

/** `undefined` when the file doesn't exist — the caller decides what "missing" means for that layer kind. */
async function readLayerJson(ports: ApplyPorts, path: string): Promise<JsonObject | undefined> {
  const text = await ports.readFile(path);
  return text === undefined ? undefined : (JSON.parse(text) as JsonObject);
}

/** A missing permissions.yaml is an empty layer — same contract as `parseYamlPermissions("")` / yoki's `loadLayer` catch branch. */
async function readPermissionLayer(ports: ApplyPorts, path: string): Promise<PermissionLayer> {
  const text = await ports.readFile(path);
  return parseYamlPermissions(text ?? "");
}

/** A missing mcp.json is `EMPTY_MCP_LAYER` — same contract as yoki's `loadLayer` catch branch. */
async function readMcpLayer(ports: ApplyPorts, path: string, label: string): Promise<McpLayer> {
  const text = await ports.readFile(path);
  return text === undefined ? EMPTY_MCP_LAYER : parseMcpLayer(text, label);
}

/** Recursively sorts object keys; leaves array order alone. */
function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (typeof value === "object" && value !== null) {
    const obj = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(obj)
        .sort()
        .map((key) => [key, sortKeysDeep(obj[key])]),
    );
  }
  return value;
}

/**
 * Canonicalizes a settings.json for comparison. Two normalizations, both so
 * the diff reflects a REAL change, not noise:
 *  - drop the runtime-owned `.autoMode` key (Claude Code writes it in itself;
 *    no layer carries it, so a dry-run must never treat its presence as a diff
 *    — install-pipeline-plan.md §4);
 *  - sort every object's keys, because jq (yoki-switch) and jig serialize the
 *    same object's keys in different order (e.g. mcpServers' `url`/`type`), and
 *    key order is not meaningful to Claude Code. Array order IS preserved —
 *    hooks run in order.
 * Falls back to the raw text if it isn't valid JSON, so a diff against a
 * hand-broken file still shows something rather than throwing.
 */
function canonicalize(text: string | undefined): string {
  if (text === undefined) return "";
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return text;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return text;
  const { autoMode: _autoMode, ...rest } = parsed as Record<string, unknown>;
  return `${JSON.stringify(sortKeysDeep(rest), null, 2)}\n`;
}

export async function applyClaudeSettings(
  paths: ClaudeApplyPaths,
  ports: ApplyPorts,
  write: boolean,
): Promise<TargetResult> {
  const enabled = await resolveEnabledPacks(ports, paths);

  const coreSettings = (await readLayerJson(ports, join(paths.coreDir, "settings.layer.json"))) ?? {};
  const personalSettings =
    (await readLayerJson(ports, join(paths.personalDir, "settings.personal.json"))) ?? {};

  const packs: PackDefinition[] = [];
  for (const name of enabled) {
    const settings = await readLayerJson(ports, join(paths.packsDir, name, "settings.layer.json"));
    if (settings !== undefined) packs.push({ name, settings });
  }

  const permissionLayers: PermissionLayer[] = [
    await readPermissionLayer(ports, join(paths.coreDir, "permissions.yaml")),
  ];
  for (const name of enabled) {
    permissionLayers.push(
      await readPermissionLayer(ports, join(paths.packsDir, name, "permissions.yaml")),
    );
  }
  permissionLayers.push(await readPermissionLayer(ports, join(paths.personalDir, "permissions.yaml")));
  const permissions: PermissionsSidecar = toClaudeSettings(mergePermissionLayers(permissionLayers));

  const mcpLayers: McpLayer[] = [
    await readMcpLayer(ports, join(paths.coreDir, "mcp.json"), "core/mcp.json"),
  ];
  for (const name of enabled) {
    mcpLayers.push(
      await readMcpLayer(ports, join(paths.packsDir, name, "mcp.json"), `packs/${name}/mcp.json`),
    );
  }
  mcpLayers.push(await readMcpLayer(ports, join(paths.personalDir, "mcp.json"), "personal/mcp.json"));
  const mcpServers = buildClaudeMcpServers(mergeMcpLayers(mcpLayers));

  const selection = selectLayers({
    core: coreSettings,
    packs,
    enabled,
    personal: personalSettings,
  });

  const composed = composeSettings({ ...selection, permissions, mcpServers });
  const templated = applyTemplate(composed, paths.templateVars) as JsonObject;
  const generatedText = `${JSON.stringify(sortKeysDeep(templated), null, 2)}\n`;

  const currentText = await ports.readFile(paths.destSettingsPath);
  const diff = unifiedDiff(
    paths.destSettingsPath,
    canonicalize(currentText),
    "generated",
    generatedText,
  );

  if (write) {
    return {
      target: "claude",
      outcome: "refused",
      diff,
      dropped: [],
      wrote: false,
      message: refusalMessage,
    };
  }

  return {
    target: "claude",
    outcome: diff === "" ? "noop" : "write",
    diff,
    dropped: [],
    wrote: false,
  };
}
