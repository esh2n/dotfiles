/**
 * Composing `~/.claude/settings.json`.
 *
 * The invariant this module exists to hold, from
 * `rules/decisions/2026-09-22-config-layout-no-personal-layer.md`:
 *
 *   「生成器の依存は元 → 出力の一方向。出力先やハーネス自身のファイルを
 *    読んでよいのは、自分が管理しない鍵をそのまま戻すためだけで、読んだ内容で
 *    管理する鍵の値や診断の出力を変えない。」
 *
 * So `current` enters this function for exactly two purposes: to carry
 * unmanaged keys through unchanged, and to say what is being removed. No
 * managed value is ever derived from it. `autoMode`, `enabledPlugins`,
 * `statusLine`, `model`, `effortLevel`, `theme` and everything else Claude
 * Code writes for itself survive byte-for-byte in value — the same
 * runtime-owned-key carryover yoki-switch does for `.autoMode`, generalized to
 * "everything jig did not claim".
 *
 * Key order follows `current` so a diff shows changes and not a reshuffle;
 * keys jig adds that were not there (`sandbox`) append at the end.
 *
 * `hooks` is owned PER ENTRY, not as a whole: jig replaces the entries whose
 * command is jig's own (`…/jig.ts hooks …`) and carries every other entry
 * through — it does not know or judge other programs' hooks. Claude
 * Code's own tooling writes into the same key — Orca's agent-hooks put a
 * `~/.orca/agent-hooks/claude-hook.sh` entry on every event (measured
 * 2026-09-24: 12 events, ~28 KB) — and replacing the key outright made every
 * Orca launch a "hand-edit conflict" that stopped `--write`. The five-hooks
 * ruling (`2026-09-22-hooks-five-events.md`) bounds what jig registers, not
 * what other programs may.
 *
 * One key is neither owned nor carried: `mcpServers`. Milestone 1 wrote it on
 * the assumption that Claude Code reads MCP servers from settings.json; it does
 * not (mcp.md, settings.md — the user-scope source is `~/.claude.json`, written
 * only by `claude mcp add`). So the key is jig's own dead value: it leaves on
 * write and is reported under the removals with that reason. The servers
 * themselves are delivered as printed `claude mcp add` lines
 * (domain/claude/claude-json.ts writes them into ~/.claude.json).
 *
 * Pure. No IO, no clock, no paths.
 */

import type { Json, JsonObject } from "../compose/merge";

/**
 * Environment variables the retired harness owned. Their removal is jig's one
 * claim on `env` — every other key is carried through, because no ruling makes
 * the generator the owner of the environment block.
 *
 * `CLAUDE_PLUGIN_ROOT` is named explicitly and not covered by the prefix: it
 * does not start with `YOKI_`, but its value points into
 * `claude-profiles/runtime/yoki`, so it retires with the runtime it names.
 * Naming it here rather than matching on the value keeps the rule readable and
 * keeps this module from inspecting what it removes.
 */
export const RETIRED_ENV_PREFIX = /^YOKI_/;
export const RETIRED_ENV_NAMES: ReadonlySet<string> = new Set(["CLAUDE_PLUGIN_ROOT"]);

/** Whether an `env` key belongs to the retiring harness and leaves with it. */
export function isRetiredEnvKey(key: string): boolean {
  return RETIRED_ENV_PREFIX.test(key) || RETIRED_ENV_NAMES.has(key);
}

/** A hook command jig itself registers (domain/claude/hooks.ts): replaced on every apply; nothing else is jig's. */
export const JIG_HOOK_COMMAND = /\/jig\.ts hooks /;

export function isJigHookCommand(command: string): boolean {
  return JIG_HOOK_COMMAND.test(command);
}

export interface ClaudeManagedInput {
  /** The five hook entries (domain/claude/hooks.ts). Replaces jig's own entries; other programs' entries are carried. */
  readonly hooks: JsonObject;
  /** Projected from guard-rules.json plus the decision's default permits. */
  readonly allow: readonly string[];
  /** Projected from guard-rules.json. */
  readonly deny: readonly string[];
  readonly defaultMode: string;
  /** The host-mode sandbox block (domain/claude/sandbox.ts). */
  readonly sandbox: JsonObject;
}

/** One group of values the apply would drop, named so the dry-run can print them. */
export interface Removal {
  /** Dotted path of the key the values are leaving, e.g. `hooks.PreToolUse`. */
  readonly key: string;
  readonly items: readonly string[];
  /** Why the whole key goes, when it is not merely "no longer generated". */
  readonly reason?: string;
}

/**
 * Keys jig wrote in an earlier milestone on a wrong assumption. They are not
 * owned (nothing regenerates them) and not carried (they are jig's, not the
 * user's); the apply removes each with its reason.
 */
export const DEAD_KEYS: ReadonlyMap<string, string> = new Map([
  [
    "mcpServers",
    "settings.json is not an MCP source (docs: mcp.md); delivered into ~/.claude.json's mcpServers instead",
  ],
]);

export interface ClaudeComposition {
  readonly settings: JsonObject;
  /** Dotted paths jig now owns the value of. */
  readonly owned: readonly string[];
  /** Dotted paths present in `current` and carried through untouched. */
  readonly left: readonly string[];
  readonly removed: readonly Removal[];
}

/** Every key whose value this module replaces; `env` is partial (see RETIRED_ENV_PREFIX). */
export const OWNED_KEYS: readonly string[] = [
  "hooks",
  "permissions.allow",
  "permissions.deny",
  "permissions.defaultMode",
  "sandbox",
];

function isJsonObject(value: Json | undefined): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asStrings(value: Json | undefined): readonly string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

/** Order-preserving replace-and-append: `current`'s keys first, then anything new. */
function mergeInOrder(
  current: JsonObject | undefined,
  replacements: Readonly<Record<string, Json>>,
): JsonObject {
  const out: Record<string, Json> = {};
  for (const [key, value] of Object.entries(current ?? {})) {
    const replacement = replacements[key];
    out[key] = replacement === undefined ? value : replacement;
  }
  for (const [key, value] of Object.entries(replacements)) {
    if (!(key in out)) out[key] = value;
  }
  return out;
}

function composePermissions(
  current: Json | undefined,
  managed: ClaudeManagedInput,
): { readonly value: JsonObject; readonly left: readonly string[] } {
  const currentObject = isJsonObject(current) ? current : undefined;
  const value = mergeInOrder(currentObject, {
    allow: [...managed.allow],
    deny: [...managed.deny],
    defaultMode: managed.defaultMode,
  });
  const owned = new Set(["allow", "deny", "defaultMode"]);
  const left = Object.keys(currentObject ?? {})
    .filter((key) => !owned.has(key))
    .map((key) => `permissions.${key}`);
  return { value, left };
}

function composeEnv(current: Json | undefined): {
  readonly value: JsonObject | undefined;
  readonly removed: readonly string[];
} {
  if (!isJsonObject(current)) return { value: undefined, removed: [] };
  const kept: Record<string, Json> = {};
  const removed: string[] = [];
  for (const [key, value] of Object.entries(current)) {
    if (isRetiredEnvKey(key)) removed.push(`${key}=${JSON.stringify(value)}`);
    else kept[key] = value;
  }
  return { value: kept, removed };
}

function removedFromArray(
  key: string,
  current: Json | undefined,
  next: readonly string[],
): readonly Removal[] {
  const keep = new Set(next);
  const gone = asStrings(current).filter((entry) => !keep.has(entry));
  return gone.length === 0 ? [] : [{ key, items: gone }];
}

/** The commands of one hook group (an entry may carry several). */
function groupCommands(group: Json): readonly string[] {
  if (!isJsonObject(group) || !Array.isArray(group.hooks)) return [];
  return group.hooks.flatMap((hook) =>
    isJsonObject(hook) && typeof hook.command === "string" ? [hook.command] : [],
  );
}

/** Is this current hook group jig's own? A group with no readable command is not — it is not jig's to judge. */
function isJigGroup(group: Json): boolean {
  const commands = groupCommands(group);
  return commands.length > 0 && commands.every(isJigHookCommand);
}

/**
 * Per event: jig's generated entries first, then every other entry of the
 * current file in its original order. Only jig's own stale entries (an old
 * path) leave, and they are reported. An event jig does not register keeps
 * its other entries; an event that ends up empty is dropped.
 */
function composeHooks(
  current: Json | undefined,
  managed: JsonObject,
): {
  readonly value: JsonObject;
  readonly carried: readonly string[];
  readonly removed: readonly Removal[];
} {
  const currentObject = isJsonObject(current) ? current : {};
  const value: Record<string, Json> = {};
  const carried: string[] = [];
  const removed: Removal[] = [];
  const events = [...new Set([...Object.keys(currentObject), ...Object.keys(managed)])];
  for (const event of events) {
    const currentGroups = Array.isArray(currentObject[event]) ? currentObject[event] : [];
    const managedGroups = Array.isArray(managed[event]) ? managed[event] : [];
    const keep = new Set(managedGroups.flatMap(groupCommands));
    const foreign: Json[] = [];
    const gone: string[] = [];
    for (const group of currentGroups) {
      if (!isJigGroup(group)) {
        foreign.push(group);
        continue;
      }
      for (const command of groupCommands(group)) if (!keep.has(command)) gone.push(command);
    }
    const composed = [...managedGroups, ...foreign];
    if (composed.length > 0) value[event] = composed;
    if (foreign.length > 0) carried.push(`hooks.${event} (${foreign.length} carried)`);
    if (gone.length > 0) removed.push({ key: `hooks.${event}`, items: gone });
  }
  return { value, carried, removed };
}

/**
 * A dead key leaves whole. Its items are named for the report — the server
 * names of a `mcpServers` object — so the reader sees what to re-register with
 * `claude mcp add`; a shape jig does not recognize is still reported, as one
 * opaque entry, rather than vanishing from the summary.
 */
function removedDeadKeys(current: JsonObject | undefined): readonly Removal[] {
  if (current === undefined) return [];
  const out: Removal[] = [];
  for (const [key, reason] of DEAD_KEYS) {
    if (!(key in current)) continue;
    const value = current[key];
    const items = isJsonObject(value) ? Object.keys(value) : ["(unrecognized value)"];
    out.push({ key, items, reason });
  }
  return out;
}

function withoutDeadKeys(current: JsonObject | undefined): JsonObject | undefined {
  if (current === undefined) return undefined;
  const out: Record<string, Json> = {};
  for (const [key, value] of Object.entries(current)) {
    if (!DEAD_KEYS.has(key)) out[key] = value;
  }
  return out;
}

/**
 * @param current the parsed `~/.claude/settings.json`, or `undefined` when the
 *   file does not exist yet. Read for preservation and for the removal report
 *   only — never to decide a managed value.
 */
export function composeClaudeSettings(
  current: JsonObject | undefined,
  managed: ClaudeManagedInput,
): ClaudeComposition {
  const permissions = composePermissions(current?.permissions, managed);
  const env = composeEnv(current?.env);
  const hooks = composeHooks(current?.hooks, managed.hooks);

  const replacements: Record<string, Json> = {
    hooks: hooks.value,
    permissions: permissions.value,
    sandbox: managed.sandbox,
    ...(env.value === undefined ? {} : { env: env.value }),
  };

  const settings = mergeInOrder(withoutDeadKeys(current), replacements);

  const claimed = new Set(["hooks", "permissions", "sandbox", "env", ...DEAD_KEYS.keys()]);
  const left = [
    ...Object.keys(current ?? {}).filter((key) => !claimed.has(key)),
    ...permissions.left,
    ...hooks.carried,
    ...(env.value === undefined ? [] : [`env (${Object.keys(env.value).length} keys)`]),
  ];

  const removed: Removal[] = [
    ...hooks.removed,
    ...removedFromArray(
      "permissions.allow",
      isJsonObject(current?.permissions) ? current.permissions.allow : undefined,
      managed.allow,
    ),
    ...removedFromArray(
      "permissions.deny",
      isJsonObject(current?.permissions) ? current.permissions.deny : undefined,
      managed.deny,
    ),
    ...removedDeadKeys(current),
    ...(env.removed.length === 0 ? [] : [{ key: "env", items: env.removed }]),
  ];

  return { settings, owned: OWNED_KEYS, left, removed };
}

/** Exactly how the file is written: 2-space JSON, one trailing newline. */
export function renderClaudeSettings(settings: JsonObject): string {
  return `${JSON.stringify(settings, null, 2)}\n`;
}
